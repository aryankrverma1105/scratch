import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dio/dio.dart';
import 'api_service.dart';
import 'outbox_service.dart';

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

  final ValueNotifier<SyncStatus> statusNotifier = ValueNotifier(const SyncStatus());
  Timer? _periodicSyncTimer;

  Future<void> init() async {
    await updatePendingCount();

    // Periodic sync check every 45 seconds
    _periodicSyncTimer?.cancel();
    _periodicSyncTimer = Timer.periodic(const Duration(seconds: 45), (_) {
      syncNow();
    });

    // Initial check
    syncNow();
  }

  Future<void> updatePendingCount() async {
    try {
      final count = await OutboxService().getPendingPointsCount();
      final selfieCount = await OutboxService().getPendingSelfiesCount();
      statusNotifier.value = statusNotifier.value.copyWith(
        pendingLocationsCount: count + selfieCount,
      );
    } catch (_) {}
  }

  // Queue location point using SQLite outbox
  Future<void> queueLocationPoint({
    required double latitude,
    required double longitude,
    double? accuracy,
    double? speed,
    double? altitude,
    bool isGpsOff = false,
  }) async {
    await OutboxService().enqueueLocationPoint(
      latitude: latitude,
      longitude: longitude,
      accuracy: accuracy,
      speed: speed,
      isGpsOff: isGpsOff,
    );
    await updatePendingCount();
  }

  // Trigger full cloud synchronization with GCP VM
  Future<bool> syncNow() async {
    if (statusNotifier.value.isSyncing) return false;

    statusNotifier.value = statusNotifier.value.copyWith(isSyncing: true);

    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('jwt_token');
    final baseUrl = ApiService().baseUrl;

    try {
      // 1. Health check probe to GCP server
      final dio = Dio(BaseOptions(
        baseUrl: baseUrl,
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

      // If user is logged in, flush SQLite outbox
      if (token != null) {
        await OutboxService().flushBatch(baseUrl: baseUrl, token: token);
        await OutboxService().replaySelfies(baseUrl: baseUrl, token: token);
      }

      await updatePendingCount();

      statusNotifier.value = statusNotifier.value.copyWith(
        isOnline: true,
        isSyncing: false,
        lastSyncedAt: DateTime.now(),
        message: 'Synchronized with GCP server',
      );
      return true;
    } catch (e) {
      debugPrint('Sync failed or offline: $e');
      await updatePendingCount();
      statusNotifier.value = statusNotifier.value.copyWith(
        isOnline: false,
        isSyncing: false,
        message: 'Network offline. Outbox will flush upon reconnect.',
      );
      return false;
    }
  }

  void dispose() {
    _periodicSyncTimer?.cancel();
  }
}
