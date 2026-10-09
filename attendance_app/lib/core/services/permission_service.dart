import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:geolocator/geolocator.dart';

class PermissionStatusResult {
  final bool hasNotification;
  final bool hasForegroundLocation;
  final bool hasBackgroundLocation;
  final bool isGpsEnabled;

  const PermissionStatusResult({
    required this.hasNotification,
    required this.hasForegroundLocation,
    required this.hasBackgroundLocation,
    required this.isGpsEnabled,
  });

  bool get isReadyForCheckIn => hasForegroundLocation && isGpsEnabled;
  bool get isFullyCompliant => hasNotification && hasBackgroundLocation && isGpsEnabled;
}

class PermissionService {
  static final FlutterLocalNotificationsPlugin _notificationsPlugin =
      FlutterLocalNotificationsPlugin();

  /// Check current status of all critical tracking permissions
  static Future<PermissionStatusResult> checkAllPermissions() async {
    // 1. GPS hardware state
    final isGpsEnabled = await Geolocator.isLocationServiceEnabled();

    // 2. Location permissions
    final locationPerm = await Geolocator.checkPermission();
    final hasForegroundLocation =
        locationPerm == LocationPermission.always || locationPerm == LocationPermission.whileInUse;
    final hasBackgroundLocation = locationPerm == LocationPermission.always;

    // 3. Notification permission (Android 13+)
    bool hasNotification = true;
    try {
      final androidImplementation = _notificationsPlugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      if (androidImplementation != null) {
        final areEnabled = await androidImplementation.areNotificationsEnabled();
        hasNotification = areEnabled ?? false;
      }
    } catch (_) {
      hasNotification = true;
    }

    return PermissionStatusResult(
      hasNotification: hasNotification,
      hasForegroundLocation: hasForegroundLocation,
      hasBackgroundLocation: hasBackgroundLocation,
      isGpsEnabled: isGpsEnabled,
    );
  }

  /// Request Notification permission (Android 13+)
  static Future<bool> requestNotificationPermission() async {
    try {
      final androidImplementation = _notificationsPlugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      if (androidImplementation != null) {
        final granted = await androidImplementation.requestNotificationsPermission();
        return granted ?? false;
      }
    } catch (_) {}
    return true;
  }

  /// Request Foreground Location permission
  static Future<LocationPermission> requestForegroundLocation() async {
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return permission;
  }

  /// Prompt user to upgrade to "Allow all the time" (Background Location)
  /// Returns true if granted directly, false if system requires opening settings
  static Future<bool> requestBackgroundLocation() async {
    // 1. Check if already granted
    final locationPerm = await Geolocator.checkPermission();
    if (locationPerm == LocationPermission.always) return true;

    // 2. Attempt requesting through geolocator (works on Android 10 or when allowed by OS)
    try {
      final res = await Geolocator.requestPermission();
      if (res == LocationPermission.always) return true;
    } catch (_) {}

    // 3. Verify again
    final checkAfter = await Geolocator.checkPermission();
    return checkAfter == LocationPermission.always;
  }

  /// Open device app settings so user can choose "Allow all the time"
  static Future<bool> openAppSettings() async {
    return await Geolocator.openAppSettings();
  }

  /// Open location settings to enable GPS hardware
  static Future<bool> openLocationSettings() async {
    return await Geolocator.openLocationSettings();
  }
}
