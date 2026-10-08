import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'api_service.dart';

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

  // Get current position once (for check-in / check-out)
  Future<Position?> getCurrentPosition() async {
    final hasPermission = await checkAndRequestPermissions();
    if (!hasPermission) return null;

    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      currentPositionNotifier.value = pos;
      return pos;
    } catch (e) {
      debugPrint('Error getting current position: $e');
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
      currentPositionNotifier.value = position;

      // Ping location to backend
      ApiService().sendLocationTrack(
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        speed: position.speed,
        altitude: position.altitude,
      );
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
