import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dio/dio.dart';
import 'api_service.dart';

class SyncStatus {
  final bool isOnline;
  final bool isSyncing;
  final int pendingLocationsCount;
  final DateTime? lastSyncedAt;
  final String? message;

  const SyncStatus({
    this.isOnline = true,
    this.isSyncing = false,
    this.pendingLocationsCount = 0,
    this.lastSyncedAt,
    this.message,
  });

  SyncStatus copyWith({
    bool? isOnline,
    bool? isSyncing,
    int? pendingLocationsCount,
    DateTime? lastSyncedAt,
    String? message,
  }) {
    return SyncStatus(
      isOnline: isOnline ?? this.isOnline,
      isSyncing: isSyncing ?? this.isSyncing,
      pendingLocationsCount: pendingLocationsCount ?? this.pendingLocationsCount,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      message: message ?? this.message,
    );
  }
}

class SyncService {
  static final SyncService _instance = SyncService._internal();
  factory SyncService() => _instance;
  SyncService._internal();

  static const String _offlineQueueKey = 'offline_pending_locations_v1';
  final ValueNotifier<SyncStatus> statusNotifier = ValueNotifier(const SyncStatus());

  Timer? _periodicSyncTimer;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final queue = _getQueue(prefs);
    statusNotifier.value = statusNotifier.value.copyWith(
      pendingLocationsCount: queue.length,
    );

    // Periodic sync check every 45 seconds
    _periodicSyncTimer?.cancel();
    _periodicSyncTimer = Timer.periodic(const Duration(seconds: 45), (_) {
      syncNow();
    });

    // Initial check
    syncNow();
  }

  List<Map<String, dynamic>> _getQueue(SharedPreferences prefs) {
    final raw = prefs.getString(_offlineQueueKey);
    if (raw == null || raw.isEmpty) return [];
    try {
      final List decoded = jsonDecode(raw);
      return decoded.map((e) => Map<String, dynamic>.from(e)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> _saveQueue(SharedPreferences prefs, List<Map<String, dynamic>> queue) async {
    await prefs.setString(_offlineQueueKey, jsonEncode(queue));
    statusNotifier.value = statusNotifier.value.copyWith(
      pendingLocationsCount: queue.length,
    );
  }

  // Queue location point if network is offline or request fails
  Future<void> queueLocationPoint({
    required double latitude,
    required double longitude,
    double? accuracy,
    double? speed,
    double? altitude,
    bool isGpsOff = false,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final queue = _getQueue(prefs);

    queue.add({
      'latitude': latitude,
      'longitude': longitude,
      'accuracy': accuracy,
      'speed': speed,
      'altitude': altitude,
      'is_gps_off': isGpsOff,
      'timestamp': DateTime.now().toIso8601String(),
    });

    // Keep max 500 points in offline cache to prevent memory explosion
    if (queue.length > 500) {
      queue.removeRange(0, queue.length - 500);
    }

    await _saveQueue(prefs, queue);
  }

  // Trigger full cloud synchronization with GCP VM
  Future<bool> syncNow() async {
    if (statusNotifier.value.isSyncing) return false;

    statusNotifier.value = statusNotifier.value.copyWith(isSyncing: true);

    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('jwt_token');

    try {
      // 1. Health check probe to GCP server
      final dio = Dio(BaseOptions(
        baseUrl: ApiService().baseUrl,
        connectTimeout: const Duration(seconds: 8),
        receiveTimeout: const Duration(seconds: 8),
      ));

      final healthRes = await dio.get('/api/health');
      if (healthRes.statusCode != 200) {
        statusNotifier.value = statusNotifier.value.copyWith(
          isOnline: false,
          isSyncing: false,
          message: 'Server unreachable',
        );
        return false;
      }

      // If user is logged in, sync offline queue
      if (token != null) {
        final queue = _getQueue(prefs);
        if (queue.isNotEmpty) {
          // Batch upload queued points
          final uploadDio = Dio(BaseOptions(
            baseUrl: ApiService().baseUrl,
            connectTimeout: const Duration(seconds: 15),
            headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
          ));

          await uploadDio.post('/api/location/track', data: {
            'locations': queue,
          });

          // Successfully uploaded, clear offline queue
          await _saveQueue(prefs, []);
        }
      }

      statusNotifier.value = statusNotifier.value.copyWith(
        isOnline: true,
        isSyncing: false,
        lastSyncedAt: DateTime.now(),
        message: 'Synchronized with GCP server',
      );
      return true;
    } catch (e) {
      debugPrint('Sync failed or offline: $e');
      statusNotifier.value = statusNotifier.value.copyWith(
        isOnline: false,
        isSyncing: false,
        message: 'Network offline. Actions will sync upon reconnect.',
      );
      return false;
    }
  }

  void dispose() {
    _periodicSyncTimer?.cancel();
  }
}
