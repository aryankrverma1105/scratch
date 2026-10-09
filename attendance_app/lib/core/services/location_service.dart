import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'api_service.dart';

// Phase 3: Structured GPS acquisition result & exceptions
class AttendanceGpsResult {
  final Position position;
  final bool isLowAccuracy;
  final bool isMocked;
  final String? warningMessage;

  AttendanceGpsResult({
    required this.position,
    required this.isLowAccuracy,
    required this.isMocked,
    this.warningMessage,
  });
}

class GpsDisabledException implements Exception {
  final String message;
  GpsDisabledException([this.message = 'GPS / Location is turned OFF. Please turn on Location in device settings.']);
  @override
  String toString() => message;
}

class LocationPermissionDeniedException implements Exception {
  final String message;
  LocationPermissionDeniedException([this.message = 'Location permission is denied. Location access is mandatory for duty tracking.']);
  @override
  String toString() => message;
}

class GpsTimeoutException implements Exception {
  final String message;
  GpsTimeoutException([this.message = 'GPS signal acquisition timed out. Please check that you are in an open area.']);
  @override
  String toString() => message;
}

class LocationService {
  static final LocationService _instance = LocationService._internal();
  factory LocationService() => _instance;
  LocationService._internal();

  StreamSubscription<ServiceStatus>? _serviceStatusSubscription;
  StreamSubscription<Position>? _positionStreamSubscription;

  final ValueNotifier<bool> isGpsEnabledNotifier = ValueNotifier<bool>(true);
  final ValueNotifier<Position?> currentPositionNotifier = ValueNotifier<Position?>(null);
  
  bool _isTrackingActive = false;
  bool get isTrackingActive => _isTrackingActive;

  // Initialize GPS status monitoring
  void initGpsMonitoring({Function(bool isEnabled)? onStatusChanged}) {
    // Check initial service status
    Geolocator.isLocationServiceEnabled().then((enabled) {
      isGpsEnabledNotifier.value = enabled;
      if (!enabled) {
        _handleGpsDisabled();
      }
    });

    // Listen to GPS hardware toggle (Requirements 14 & 15)
    _serviceStatusSubscription?.cancel();
    _serviceStatusSubscription = Geolocator.getServiceStatusStream().listen((ServiceStatus status) {
      final isEnabled = status == ServiceStatus.enabled;
      isGpsEnabledNotifier.value = isEnabled;
      if (onStatusChanged != null) {
        onStatusChanged(isEnabled);
      }

      if (!isEnabled) {
        _handleGpsDisabled();
      } else {
        _handleGpsRestored();
      }
    });
  }

  void _handleGpsDisabled() {
    debugPrint('⚠️ GPS was TURNED OFF by employee!');
    // Report to backend to alert admin
    Position? lastPos = currentPositionNotifier.value;
    ApiService().reportGpsStatus(
      status: 'DISABLED',
      message: 'Employee turned device Location / GPS OFF',
      latitude: lastPos?.latitude,
      longitude: lastPos?.longitude,
    );
  }

  void _handleGpsRestored() {
    debugPrint('✅ GPS was RESTORED by employee');
    Position? lastPos = currentPositionNotifier.value;
    ApiService().reportGpsStatus(
      status: 'RESTORED',
      message: 'Employee turned device Location / GPS back ON',
      latitude: lastPos?.latitude,
      longitude: lastPos?.longitude,
    );
  }

  // Request location permissions
  Future<bool> checkAndRequestPermissions() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    isGpsEnabledNotifier.value = serviceEnabled;
    if (!serviceEnabled) {
      return false;
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        return false;
      }
    }

    if (permission == LocationPermission.deniedForever) {
      return false;
    }

    return true;
  }

  // Phase 3: Robust GPS acquisition with fresh last-known position, timeLimit, and mock detection
  Future<AttendanceGpsResult> getAttendancePosition({required bool isCheckOut}) async {
    // 1. Hardware GPS check
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    isGpsEnabledNotifier.value = serviceEnabled;
    if (!serviceEnabled) {
      throw GpsDisabledException('GPS / Location is turned OFF. Please enable Location in quick settings.');
    }

    // 2. Permission check
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        throw LocationPermissionDeniedException('Location permissions are denied. Location access is required.');
      }
    } else if (permission == LocationPermission.deniedForever) {
      throw LocationPermissionDeniedException('Location permissions are permanently denied. Please enable them in app settings.');
    }

    Position? acquiredPos;

    // 3. Try fresh last-known position (< 2 min, accuracy < 50 m)
    try {
      final lastKnown = await Geolocator.getLastKnownPosition();
      if (lastKnown != null) {
        final age = DateTime.now().difference(lastKnown.timestamp);
        if (age.inMinutes < 2 && lastKnown.accuracy > 0 && lastKnown.accuracy <= 50) {
          acquiredPos = lastKnown;
        }
      }
    } catch (_) {}

    // 4. If no fresh last-known position, acquire via getCurrentPosition with 10s timeLimit
    if (acquiredPos == null) {
      try {
        acquiredPos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 10),
          ),
        );
      } on TimeoutException {
        // Timeout occurred: try fallback to any last-known position
        final fallback = await Geolocator.getLastKnownPosition();
        if (fallback != null) {
          acquiredPos = fallback;
        } else if (isCheckOut) {
          // Never block check-out on poor fix if any position can be constructed
          throw GpsTimeoutException('GPS signal timed out. Please step near a window or outdoors to complete check-out.');
        } else {
          throw GpsTimeoutException('GPS signal timed out. Please check your signal and step into an open area.');
        }
      } catch (e) {
        final fallback = await Geolocator.getLastKnownPosition();
        if (fallback != null) {
          acquiredPos = fallback;
        } else {
          throw GpsTimeoutException('Unable to acquire GPS fix: ${e.toString()}');
        }
      }
    }

    currentPositionNotifier.value = acquiredPos;

    final bool isLowAccuracy = acquiredPos.accuracy > 50 || acquiredPos.accuracy <= 0;
    final bool isMocked = acquiredPos.isMocked;

    String? warning;
    if (isMocked) {
      warning = '⚠️ Mock location (Fake GPS) detected!';
    } else if (isLowAccuracy) {
      warning = 'Low GPS accuracy (${acquiredPos.accuracy.toStringAsFixed(0)}m). Recorded with low-accuracy flag.';
    }

    return AttendanceGpsResult(
      position: acquiredPos,
      isLowAccuracy: isLowAccuracy,
      isMocked: isMocked,
      warningMessage: warning,
    );
  }

  // Get current position once (fallback helper)
  Future<Position?> getCurrentPosition() async {
    try {
      final res = await getAttendancePosition(isCheckOut: false);
      return res.position;
    } catch (_) {
      return null;
    }
  }

  // Start continuous tracking after Check-In (Requirement 8)
  void startContinuousTracking() {
    if (_isTrackingActive) return;
    _isTrackingActive = true;

    const locationSettings = LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 10, // update every 10 meters
    );

    _positionStreamSubscription?.cancel();
    _positionStreamSubscription = Geolocator.getPositionStream(
      locationSettings: locationSettings,
    ).listen((Position position) {
      // Single source of truth: Foreground service isolate does all tracking/posting.
      // UI isolate only updates position notifier for local UI/map rendering.
      currentPositionNotifier.value = position;
    });
  }

  // Stop continuous tracking after Check-Out (Requirement 9)
  void stopContinuousTracking() {
    _isTrackingActive = false;
    _positionStreamSubscription?.cancel();
    _positionStreamSubscription = null;
  }

  void dispose() {
    _serviceStatusSubscription?.cancel();
    _positionStreamSubscription?.cancel();
  }
}
