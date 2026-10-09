import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dio/dio.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:battery_plus/battery_plus.dart';
import 'api_service.dart';
import 'outbox_service.dart';

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
  WidgetsFlutterBinding.ensureInitialized();

  StreamSubscription<Position>? positionSubscription;
  Timer? heartbeatTimer;
  bool isProcessing = false;
  final battery = Battery();

  // Listen to external stop events
  service.on('stopService').listen((event) async {
    await positionSubscription?.cancel();
    heartbeatTimer?.cancel();
    service.stopSelf();
  });

  Future<void> handlePosition(Position position) async {
    if (isProcessing) return; // Prevent overlapping async executions
    isProcessing = true;

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.reload();
      final token = prefs.getString('jwt_token');
      final baseUrl = prefs.getString('server_base_url') ?? ApiService.defaultBaseUrl;

      if (token == null) {
        // Logged out: stop tracking immediately
        await positionSubscription?.cancel();
        heartbeatTimer?.cancel();
        service.stopSelf();
        return;
      }

      double? batteryPct;
      try {
        final lvl = await battery.batteryLevel;
        batteryPct = lvl.toDouble();
      } catch (_) {}

      // 1. Enqueue point into SQLite outbox
      await OutboxService().enqueueLocationPoint(
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        speed: position.speed,
        batteryLevel: batteryPct,
        isMocked: position.isMocked,
        isGpsOff: false,
        capturedAt: position.timestamp,
      );

      // 2. Flush outbox batch (up to 50 points)
      final flushRes = await OutboxService().flushBatch(
        baseUrl: baseUrl,
        token: token,
      );

      // 3. Stop tracking if auth revoked (401/403) or active shift ended
      if (flushRes.authRevoked || !flushRes.activeTracking) {
        debugPrint('Tracking ceased by server policy (authRevoked: ${flushRes.authRevoked}, active: ${flushRes.activeTracking})');
        await positionSubscription?.cancel();
        heartbeatTimer?.cancel();
        service.stopSelf();
        return;
      }

      // 4. Replay any pending offline selfies
      await OutboxService().replaySelfies(baseUrl: baseUrl, token: token);
    } catch (e) {
      debugPrint('Background location processing error: $e');
    } finally {
      isProcessing = false;
    }
  }

  // 1. Stream updates with distanceFilter of 20 meters
  try {
    positionSubscription = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 20, // 20-meter filter
      ),
    ).listen((pos) {
      handlePosition(pos);
    }, onError: (err) {
      debugPrint('Position stream error: $err');
    });
  } catch (e) {
    debugPrint('Failed to initialize position stream: $e');
  }

  // 2. 60-second heartbeat to ensure constant tracking even when stationary
  heartbeatTimer = Timer.periodic(const Duration(seconds: 60), (_) async {
    if (isProcessing) return;

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.reload();
      final token = prefs.getString('jwt_token');
      final baseUrl = prefs.getString('server_base_url') ?? ApiService.defaultBaseUrl;

      if (token == null) {
        await positionSubscription?.cancel();
        heartbeatTimer?.cancel();
        service.stopSelf();
        return;
      }

      // Check permission
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        _sendGpsAlert(baseUrl, token, 'LOCATION_PERMISSION_REVOKED');
        return;
      }

      final isGpsOn = await Geolocator.isLocationServiceEnabled();
      if (!isGpsOn) {
        _sendGpsAlert(baseUrl, token, 'DISABLED');
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 10),
        ),
      );

      await handlePosition(position);
    } catch (e) {
      debugPrint('Heartbeat tick error: $e');
    }
  });
}

Future<void> _sendGpsAlert(String baseUrl, String token, String status) async {
  try {
    final dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 8),
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
