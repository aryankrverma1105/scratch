import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;
import 'package:uuid/uuid.dart';
import 'package:dio/dio.dart';

class AuthRevokedException implements Exception {
  final int statusCode;
  AuthRevokedException(this.statusCode);
  @override
  String toString() => 'Authentication revoked by server ($statusCode)';
}

class OutboxFlushResult {
  final bool success;
  final int flushedCount;
  final bool activeTracking;
  final bool authRevoked;

  OutboxFlushResult({
    required this.success,
    this.flushedCount = 0,
    this.activeTracking = true,
    this.authRevoked = false,
  });
}

class OutboxService {
  static final OutboxService _instance = OutboxService._internal();
  factory OutboxService() => _instance;
  OutboxService._internal();

  static const _uuid = Uuid();
  Database? _db;
  int _consecutiveFailures = 0;
  DateTime? _nextAllowedFlushTime;

  Future<Database> get database async {
    if (_db != null && _db!.isOpen) return _db!;
    _db = await _initDb();
    return _db!;
  }

  Future<Database> _initDb() async {
    final databasesPath = await getDatabasesPath();
    final path = p.join(databasesPath, 'sologix_outbox.db');

    return await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE location_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_point_id TEXT UNIQUE NOT NULL,
            captured_at TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            accuracy REAL,
            speed REAL,
            battery_level REAL,
            is_mocked INTEGER DEFAULT 0,
            is_gps_off INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
          )
        ''');

        await db.execute('''
          CREATE TABLE selfie_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_action_id TEXT UNIQUE NOT NULL,
            action_type TEXT NOT NULL,
            selfie_path TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            accuracy REAL,
            is_mocked INTEGER DEFAULT 0,
            address TEXT,
            captured_at TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )
        ''');
      },
    );
  }

  // Enqueue a location point from the background isolate
  Future<void> enqueueLocationPoint({
    required double latitude,
    required double longitude,
    double? accuracy,
    double? speed,
    double? batteryLevel,
    bool isMocked = false,
    bool isGpsOff = false,
    DateTime? capturedAt,
  }) async {
    final db = await database;
    final now = capturedAt ?? DateTime.now();
    // UTC ISO-8601 strictly formatted with 'Z'
    final isoZ = now.toUtc().toIso8601String().replaceAll(RegExp(r'\+00:00$'), 'Z');
    final formattedIso = isoZ.endsWith('Z') ? isoZ : '${isoZ}Z';

    await db.insert(
      'location_outbox',
      {
        'client_point_id': _uuid.v4(),
        'captured_at': formattedIso,
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
        'speed': speed,
        'battery_level': batteryLevel,
        'is_mocked': isMocked ? 1 : 0,
        'is_gps_off': isGpsOff ? 1 : 0,
        'created_at': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }

  // Enqueue an offline check-in or check-out selfie action
  Future<String> enqueueSelfieAction({
    required String actionType,
    required String selfiePath,
    required double latitude,
    required double longitude,
    double? accuracy,
    bool isMocked = false,
    String? address,
    DateTime? capturedAt,
  }) async {
    final db = await database;
    final actionId = _uuid.v4();
    final now = capturedAt ?? DateTime.now();
    final isoZ = now.toUtc().toIso8601String();
    final formattedIso = isoZ.endsWith('Z') ? isoZ : '${isoZ}Z';

    await db.insert('selfie_outbox', {
      'client_action_id': actionId,
      'action_type': actionType,
      'selfie_path': selfiePath,
      'latitude': latitude,
      'longitude': longitude,
      'accuracy': accuracy,
      'is_mocked': isMocked ? 1 : 0,
      'address': address,
      'captured_at': formattedIso,
      'created_at': DateTime.now().millisecondsSinceEpoch,
    });

    return actionId;
  }

  Future<int> getPendingPointsCount() async {
    final db = await database;
    final res = await db.rawQuery('SELECT COUNT(*) as count FROM location_outbox');
    return Sqflite.firstIntValue(res) ?? 0;
  }

  Future<int> getPendingSelfiesCount() async {
    final db = await database;
    final res = await db.rawQuery('SELECT COUNT(*) as count FROM selfie_outbox');
    return Sqflite.firstIntValue(res) ?? 0;
  }

  // Flush up to 50 points with exponential backoff
  Future<OutboxFlushResult> flushBatch({
    required String baseUrl,
    required String token,
  }) async {
    // Check if in backoff cooldown
    final now = DateTime.now();
    if (_nextAllowedFlushTime != null && now.isBefore(_nextAllowedFlushTime!)) {
      return OutboxFlushResult(success: false);
    }

    final db = await database;
    final rows = await db.query(
      'location_outbox',
      orderBy: 'id ASC',
      limit: 50,
    );

    if (rows.isEmpty) {
      _consecutiveFailures = 0;
      _nextAllowedFlushTime = null;
      return OutboxFlushResult(success: true, flushedCount: 0);
    }

    final pointsPayload = rows.map((r) => {
      'client_point_id': r['client_point_id'],
      'captured_at': r['captured_at'],
      'latitude': r['latitude'],
      'longitude': r['longitude'],
      'accuracy': r['accuracy'],
      'speed': r['speed'],
      'battery_level': r['battery_level'],
      'is_mocked': r['is_mocked'] == 1,
      'is_gps_off': r['is_gps_off'] == 1,
    }).toList();

    try {
      final dio = Dio(BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 10),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      ));

      final response = await dio.post('/api/location/track-batch', data: {
        'points': pointsPayload,
      });

      if (response.statusCode == 200 || response.statusCode == 201) {
        // Ack received: safely delete flushed rows by ID
        final ids = rows.map((r) => r['id']).toList();
        await db.delete(
          'location_outbox',
          where: 'id IN (${List.filled(ids.length, '?').join(',')})',
          whereArgs: ids,
        );

        _consecutiveFailures = 0;
        _nextAllowedFlushTime = null;

        final activeTracking = response.data['activeTracking'] != false;
        return OutboxFlushResult(
          success: true,
          flushedCount: rows.length,
          activeTracking: activeTracking,
        );
      } else {
        _applyBackoff();
        return OutboxFlushResult(success: false);
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 401 || e.response?.statusCode == 403) {
        // Token revoked / user deactivated: stop tracking!
        return OutboxFlushResult(
          success: false,
          authRevoked: true,
          activeTracking: false,
        );
      }
      _applyBackoff();
      return OutboxFlushResult(success: false);
    } catch (_) {
      _applyBackoff();
      return OutboxFlushResult(success: false);
    }
  }

  // Replay any offline selfies in chronological order
  Future<void> replaySelfies({
    required String baseUrl,
    required String token,
  }) async {
    final db = await database;
    final rows = await db.query('selfie_outbox', orderBy: 'id ASC');

    for (final row in rows) {
      final selfiePath = row['selfie_path'] as String;
      final file = File(selfiePath);
      if (!file.existsSync()) {
        // File gone, discard row
        await db.delete('selfie_outbox', where: 'id = ?', whereArgs: [row['id']]);
        continue;
      }

      final actionType = row['action_type'] as String;
      final endpoint = actionType == 'check_in' ? '/api/attendance/check-in' : '/api/attendance/check-out';

      try {
        final dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 25),
          receiveTimeout: const Duration(seconds: 25),
          headers: {'Authorization': 'Bearer $token'},
        ));

        final formData = FormData.fromMap({
          'latitude': row['latitude'].toString(),
          'longitude': row['longitude'].toString(),
          if (row['accuracy'] != null) 'accuracy': row['accuracy'].toString(),
          'is_mocked': (row['is_mocked'] == 1).toString(),
          'address': row['address'] ?? '',
          'captured_at': row['captured_at'],
          'selfie': await MultipartFile.fromFile(
            file.path,
            filename: 'replay_${row['client_action_id']}.jpg',
          ),
        });

        final res = await dio.post(endpoint, data: formData);
        if (res.statusCode == 200 || res.statusCode == 201) {
          await db.delete('selfie_outbox', where: 'id = ?', whereArgs: [row['id']]);
        }
      } catch (e) {
        debugPrint('Failed to replay offline selfie ($actionType): $e');
        break; // retry on next flush
      }
    }
  }

  void _applyBackoff() {
    _consecutiveFailures++;
    // Exponential backoff: 2s, 4s, 8s, 16s... up to max 120s
    final backoffSec = min(120, pow(2, _consecutiveFailures).toInt());
    _nextAllowedFlushTime = DateTime.now().add(Duration(seconds: backoffSec));
    debugPrint('Outbox backoff applied: $_consecutiveFailures consecutive failures, wait ${backoffSec}s');
  }

  Future<void> clearAll() async {
    final db = await database;
    await db.delete('location_outbox');
    await db.delete('selfie_outbox');
    _consecutiveFailures = 0;
    _nextAllowedFlushTime = null;
  }
}
