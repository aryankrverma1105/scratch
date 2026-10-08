import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dio/dio.dart';

class BackgroundTrackerService {
  static final BackgroundTrackerService _instance = BackgroundTrackerService._internal();
  factory BackgroundTrackerService() => _instance;
  BackgroundTrackerService._internal();

  static Future<void> initializeService() async {
    final service = FlutterBackgroundService();

    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: onStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: 'attendance_tracking_channel',
        initialNotificationTitle: 'WorkFlow Pro Active',
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
      final baseUrl = prefs.getString('server_base_url') ?? 'http://10.0.2.2:5000';

      if (token == null) {
        // Not logged in or checked out
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

    await dio.post('/api/location/gps-status', data: {
      'status': status,
      'message': 'Employee turned off GPS while app is minimized/running in background',
    });
  } catch (_) {}
}
