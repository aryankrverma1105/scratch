import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../models/user_model.dart';
import '../../models/attendance_model.dart';
import '../../models/location_model.dart';
import 'sync_service.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  static const String defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://34.180.17.0:5050',
  );

  final _secureStorage = const FlutterSecureStorage();
  late Dio _dio;
  String _baseUrl = defaultBaseUrl;
  String? _token;
  UserModel? _currentUser;

  String get baseUrl => _baseUrl;
  String? get token => _token;
  UserModel? get currentUser => _currentUser;

  static String formatDioError(dynamic error) {
    if (error is DioException) {
      switch (error.type) {
        case DioExceptionType.connectionTimeout:
          return 'Connection timed out. Server is taking too long to respond.';
        case DioExceptionType.sendTimeout:
          return 'Sending request timed out. Please check your internet connection.';
        case DioExceptionType.receiveTimeout:
          return 'Server response timed out. Please try again.';
        case DioExceptionType.badCertificate:
          return 'Security certificate error. Connection could not be verified.';
        case DioExceptionType.connectionError:
          return "Can't reach the server. Check your internet connection or server address.";
        case DioExceptionType.cancel:
          return 'Request was cancelled.';
        case DioExceptionType.badResponse:
          final statusCode = error.response?.statusCode;
          final data = error.response?.data;
          String? serverMessage;
          if (data is Map && (data['error'] != null || data['message'] != null)) {
            serverMessage = (data['error'] ?? data['message']).toString();
          }
          if (statusCode == 401) {
            return serverMessage ?? 'Invalid username or password.';
          } else if (statusCode == 403) {
            return serverMessage ?? 'Access denied. Your account lacks required permissions.';
          } else if (statusCode == 404) {
            return serverMessage ?? 'Requested endpoint not found.';
          } else if (statusCode == 429) {
            return serverMessage ?? 'Too many requests. Please wait a minute and try again.';
          } else if (statusCode != null && statusCode >= 500) {
            return serverMessage ?? 'Server error ($statusCode). Please try again shortly.';
          }
          return serverMessage ?? 'Request failed with status $statusCode.';
        case DioExceptionType.unknown:
        default:
          if (error.message != null && error.message!.isNotEmpty) {
            return 'Network error: ${error.message}';
          }
          return 'Can\'t reach the server. Please check your internet connection.';
      }
    }
    return error?.toString().replaceFirst('Exception: ', '') ?? 'An unexpected error occurred.';
  }

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _baseUrl = prefs.getString('server_base_url') ?? defaultBaseUrl;

    try {
      _token = await _secureStorage.read(key: 'jwt_token');
    } catch (_) {
      _token = null;
    }

    // Migration from SharedPreferences if secure storage was empty
    if (_token == null && prefs.containsKey('jwt_token')) {
      final legacyToken = prefs.getString('jwt_token');
      if (legacyToken != null) {
        _token = legacyToken;
        try {
          await _secureStorage.write(key: 'jwt_token', value: legacyToken);
        } catch (_) {}
      }
    }

    _dio = Dio(
      BaseOptions(
        baseUrl: _baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (_token != null) {
            options.headers['Authorization'] = 'Bearer $_token';
          }
          return handler.next(options);
        },
        onError: (DioException e, handler) {
          return handler.next(e);
        },
      ),
    );
  }

  String getSelfieUrl(String? filename) {
    if (filename == null || filename.isEmpty) return '';
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      return filename;
    }
    final clean = filename
        .replaceAll('/uploads/selfies/', '')
        .replaceAll('uploads/selfies/', '')
        .replaceAll('/uploads/', '')
        .replaceAll('uploads/', '');
    return '$_baseUrl/api/files/selfies/$clean';
  }

  Map<String, String> get authHeaders => {
    if (_token != null) 'Authorization': 'Bearer $_token',
  };

  Future<void> setBaseUrl(String url) async {
    String cleanUrl = url.trim();
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.substring(0, cleanUrl.length - 1);
    }
    _baseUrl = cleanUrl;
    _dio.options.baseUrl = cleanUrl;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_base_url', cleanUrl);
  }

  Future<Response<T>> _executeWithRetry<T>(
    Future<Response<T>> Function() requestFn, {
    int maxRetries = 1,
    Duration delay = const Duration(milliseconds: 1500),
  }) async {
    int attempts = 0;
    while (true) {
      try {
        return await requestFn();
      } on DioException catch (e) {
        attempts++;
        final isTransient = e.type == DioExceptionType.connectionTimeout ||
            e.type == DioExceptionType.sendTimeout ||
            e.type == DioExceptionType.receiveTimeout ||
            e.type == DioExceptionType.connectionError;
        if (attempts <= maxRetries && isTransient) {
          await Future.delayed(delay * attempts);
          continue;
        }
        rethrow;
      }
    }
  }

  Future<Map<String, dynamic>> testConnection([String? customUrl]) async {
    final targetUrl = customUrl ?? _baseUrl;
    final stopwatch = Stopwatch()..start();
    try {
      final probeDio = Dio(
        BaseOptions(
          baseUrl: targetUrl,
          connectTimeout: const Duration(seconds: 5),
          receiveTimeout: const Duration(seconds: 5),
        ),
      );
      final response = await probeDio.get('/api/health');
      stopwatch.stop();
      return {
        'success': response.statusCode == 200,
        'latencyMs': stopwatch.elapsedMilliseconds,
        'message': 'Connected (${stopwatch.elapsedMilliseconds} ms)',
        'data': response.data,
      };
    } on DioException catch (e) {
      stopwatch.stop();
      return {
        'success': false,
        'latencyMs': stopwatch.elapsedMilliseconds,
        'message': formatDioError(e),
      };
    } catch (e) {
      stopwatch.stop();
      return {
        'success': false,
        'latencyMs': stopwatch.elapsedMilliseconds,
        'message': e.toString(),
      };
    }
  }

  Future<void> setToken(String? token) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    if (token != null) {
      try {
        await _secureStorage.write(key: 'jwt_token', value: token);
      } catch (_) {}
      await prefs.setString('jwt_token', token);
    } else {
      try {
        await _secureStorage.delete(key: 'jwt_token');
      } catch (_) {}
      await prefs.remove('jwt_token');
      _currentUser = null;
    }
  }

  void setCurrentUser(UserModel? user) {
    _currentUser = user;
  }

  // --- Auth Endpoints ---

  Future<Map<String, dynamic>> login(String identifier, String password) async {
    try {
      final response = await _executeWithRetry(
        () => _dio.post('/api/auth/login', data: {
          'identifier': identifier,
          'password': password,
        }),
      );

      if (response.statusCode == 200) {
        final data = response.data;
        await setToken(data['token']);
        _currentUser = UserModel.fromJson(data['user']);
        return data;
      }
      throw Exception(response.data['error'] ?? 'Login failed');
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<UserModel?> getProfile() async {
    try {
      final response = await _dio.get('/api/auth/me');
      if (response.statusCode == 200) {
        _currentUser = UserModel.fromJson(response.data['user']);
        return _currentUser;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<void> logout() async {
    await setToken(null);
  }

  // --- Attendance Endpoints ---

  Future<Map<String, dynamic>> getCurrentAttendanceStatus() async {
    try {
      final response = await _executeWithRetry(
        () => _dio.get('/api/attendance/current'),
      );
      return response.data;
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<AttendanceRecord> checkIn({
    required double latitude,
    required double longitude,
    double? accuracy,
    bool isMocked = false,
    String? address,
    required File selfieFile,
  }) async {
    try {
      final formMap = <String, dynamic>{
        'latitude': latitude.toString(),
        'longitude': longitude.toString(),
        'is_mocked': isMocked.toString(),
        'address': address ?? 'Lat: $latitude, Lng: $longitude',
        'selfie': await MultipartFile.fromFile(
          selfieFile.path,
          filename: 'checkin_${DateTime.now().millisecondsSinceEpoch}.jpg',
        ),
      };
      if (accuracy != null) {
        formMap['accuracy'] = accuracy.toString();
      }
      final formData = FormData.fromMap(formMap);

      final response = await _dio.post('/api/attendance/check-in', data: formData);
      return AttendanceRecord.fromJson(response.data['attendance']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? formatDioError(e));
    }
  }

  Future<AttendanceRecord> checkOut({
    required double latitude,
    required double longitude,
    double? accuracy,
    bool isMocked = false,
    String? address,
    required File selfieFile,
  }) async {
    try {
      final formMap = <String, dynamic>{
        'latitude': latitude.toString(),
        'longitude': longitude.toString(),
        'is_mocked': isMocked.toString(),
        'address': address ?? 'Lat: $latitude, Lng: $longitude',
        'selfie': await MultipartFile.fromFile(
          selfieFile.path,
          filename: 'checkout_${DateTime.now().millisecondsSinceEpoch}.jpg',
        ),
      };
      if (accuracy != null) {
        formMap['accuracy'] = accuracy.toString();
      }
      final formData = FormData.fromMap(formMap);

      final response = await _dio.post('/api/attendance/check-out', data: formData);
      return AttendanceRecord.fromJson(response.data['attendance']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? formatDioError(e));
    }
  }

  Future<List<AttendanceRecord>> getMyAttendanceHistory() async {
    try {
      final response = await _dio.get('/api/attendance/my-history');
      final list = (response.data['records'] as List)
          .map((item) => AttendanceRecord.fromJson(item))
          .toList();
      return list;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to load history');
    }
  }

  // --- Location Tracking & GPS Alert Endpoints ---

  Future<void> sendLocationTrack({
    required double latitude,
    required double longitude,
    double? accuracy,
    double? speed,
    double? altitude,
    bool isGpsOff = false,
  }) async {
    try {
      await _dio.post('/api/location/track', data: {
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
        'speed': speed,
        'altitude': altitude,
        'is_gps_off': isGpsOff,
        'timestamp': DateTime.now().toIso8601String(),
      });
    } catch (_) {
      // If network fails or phone is offline, queue in SyncService for later delivery
      SyncService().queueLocationPoint(
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy,
        speed: speed,
        altitude: altitude,
        isGpsOff: isGpsOff,
      );
    }
  }

  Future<void> reportGpsStatus({
    required String status, // 'DISABLED' | 'RESTORED'
    String? message,
    double? latitude,
    double? longitude,
  }) async {
    try {
      await _dio.post('/api/location/gps-status', data: {
        'status': status,
        'message': message,
        'latitude': latitude,
        'longitude': longitude,
      });
    } catch (_) {}
  }

  // --- Admin Endpoints ---

  Future<List<UserModel>> adminGetUsers() async {
    try {
      final response = await _dio.get('/api/admin/users');
      final list = (response.data['users'] as List)
          .map((u) => UserModel.fromJson(u))
          .toList();
      return list;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to load users');
    }
  }

  Future<UserModel> adminCreateUser({
    required String email,
    required String password,
    required String fullName,
    required String role, // 'admin' | 'employee'
    String? username,
    String? department,
    String? phone,
  }) async {
    try {
      final response = await _dio.post('/api/admin/users', data: {
        'email': email,
        'password': password,
        'full_name': fullName,
        'role': role,
        'username': username,
        'department': department,
        'phone': phone,
      });
      return UserModel.fromJson(response.data['user']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to create user');
    }
  }

  Future<List<LiveEmployeeLocation>> adminGetLiveLocations() async {
    try {
      final response = await _dio.get('/api/admin/live-locations');
      final list = (response.data['employees'] as List)
          .map((item) => LiveEmployeeLocation.fromJson(item))
          .toList();
      return list;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to load live locations');
    }
  }

  Future<Map<String, dynamic>> adminGetUserRoute(int userId, String date) async {
    try {
      final response = await _dio.get('/api/admin/users/$userId/route', queryParameters: {
        'date': date,
      });
      final points = (response.data['route'] as List)
          .map((p) => RoutePoint.fromJson(p))
          .toList();
      return {
        'user': UserModel.fromJson(response.data['user']),
        'route': points,
        'date': response.data['date'],
        'attendance': response.data['attendance'] != null
            ? AttendanceRecord.fromJson(response.data['attendance'])
            : null,
      };
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to load route');
    }
  }

  Future<List<GpsAlert>> adminGetAlerts() async {
    try {
      final response = await _dio.get('/api/admin/alerts');
      final list = (response.data['alerts'] as List)
          .map((a) => GpsAlert.fromJson(a))
          .toList();
      return list;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to load alerts');
    }
  }

  Future<void> adminResolveAlert(int alertId) async {
    try {
      await _dio.post('/api/admin/alerts/$alertId/resolve');
    } catch (_) {}
  }
}
