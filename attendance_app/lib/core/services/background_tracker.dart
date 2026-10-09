import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dio/dio.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api_service.dart';

class BackgroundTrackerService {
  static final BackgroundTrackerService _instance = BackgroundTrackerService._internal();
  factory BackgroundTrackerService() => _instance;
  BackgroundTrackerService._internal();

  static Future<void> initializeService() async {
    final flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();

    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      'attendance_tracking_channel',
      'Sologix Attendance Tracking',
      description: 'Continuous duty GPS tracking in progress for Sologix Energy',
      importance: Importance.low,
    );

    await flutterLocalNotificationsPlugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);

    final service = FlutterBackgroundService();

    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: onStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: 'attendance_tracking_channel',
        initialNotificationTitle: 'Sologix Energy Tracking Active',
        initialNotificationContent: 'Continuous duty GPS tracking in progress...',
        foregroundServiceNotificationId: 888,
        foregroundServiceTypes: [AndroidForegroundType.location],
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: onStart,
        onBackground: onIosBackground,
      ),
    );
  }

  static Future<void> startTracking() async {
    final service = FlutterBackgroundService();
    if (!await service.isRunning()) {
      await service.startService();
    }
  }

  static Future<void> stopTracking() async {
    final service = FlutterBackgroundService();
    if (await service.isRunning()) {
      service.invoke('stopService');
    }
  }
}

@pragma('vm:entry-point')
Future<bool> onIosBackground(ServiceInstance service) async {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();
  return true;
}

@pragma('vm:entry-point')
void onStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();

  service.on('stopService').listen((event) {
    service.stopSelf();
  });

  // Background GPS periodic ping every 30 seconds
  Timer.periodic(const Duration(seconds: 30), (timer) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('jwt_token');
      final baseUrl = prefs.getString('server_base_url') ?? ApiService.defaultBaseUrl;

      if (token == null) {
        // Not logged in or checked out
        return;
      }

      // Check if location permission is revoked mid-shift
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        _sendGpsAlert(baseUrl, token, 'LOCATION_PERMISSION_REVOKED');
        return;
      }

      bool isEnabled = await Geolocator.isLocationServiceEnabled();
      if (!isEnabled) {
        // Notify backend GPS is disabled
        _sendGpsAlert(baseUrl, token, 'DISABLED');
        return;
      }

      Position position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );

      // Post to backend
      final dio = Dio(BaseOptions(
        baseUrl: baseUrl,
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ));

      await dio.post('/api/location/track', data: {
        'latitude': position.latitude,
        'longitude': position.longitude,
        'accuracy': position.accuracy,
        'speed': position.speed,
        'altitude': position.altitude,
        'is_gps_off': false,
        'timestamp': DateTime.now().toIso8601String(),
      });

      debugPrint('📍 Background GPS Ping Sent: ${position.latitude}, ${position.longitude}');
    } catch (e) {
      debugPrint('Background location ping error: $e');
    }
  });
}

Future<void> _sendGpsAlert(String baseUrl, String token, String status) async {
  try {
    final dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
    ));

    final message = status == 'LOCATION_PERMISSION_REVOKED'
        ? 'Location permission revoked during active duty shift'
        : 'Employee turned off GPS while app is minimized/running in background';

    await dio.post('/api/location/gps-status', data: {
      'status': status,
      'message': message,
    });
  } catch (_) {}
}
