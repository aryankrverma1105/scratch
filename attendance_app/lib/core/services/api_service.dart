import 'dart:io';
import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../models/user_model.dart';
import '../../models/attendance_model.dart';
import '../../models/location_model.dart';
import 'sync_service.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  late Dio _dio;
  String _baseUrl = 'http://10.0.2.2:5000'; // Default for Android emulator to localhost
  String? _token;
  UserModel? _currentUser;

  String get baseUrl => _baseUrl;
  String? get token => _token;
  UserModel? get currentUser => _currentUser;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _baseUrl = prefs.getString('server_base_url') ?? 'http://10.0.2.2:5000';
    _token = prefs.getString('jwt_token');

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

  Future<void> setToken(String? token) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    if (token != null) {
      await prefs.setString('jwt_token', token);
    } else {
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
      final response = await _dio.post('/api/auth/login', data: {
        'identifier': identifier,
        'password': password,
      });

      if (response.statusCode == 200) {
        final data = response.data;
        await setToken(data['token']);
        _currentUser = UserModel.fromJson(data['user']);
        return data;
      }
      throw Exception(response.data['error'] ?? 'Login failed');
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? e.message ?? 'Connection error');
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
      final response = await _dio.get('/api/attendance/current');
      return response.data;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to get status');
    }
  }

  Future<AttendanceRecord> checkIn({
    required double latitude,
    required double longitude,
    String? address,
    required File selfieFile,
  }) async {
    try {
      final formData = FormData.fromMap({
        'latitude': latitude.toString(),
        'longitude': longitude.toString(),
        'address': address ?? 'Lat: $latitude, Lng: $longitude',
        'selfie': await MultipartFile.fromFile(
          selfieFile.path,
          filename: 'checkin_${DateTime.now().millisecondsSinceEpoch}.jpg',
        ),
      });

      final response = await _dio.post('/api/attendance/check-in', data: formData);
      return AttendanceRecord.fromJson(response.data['attendance']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Check-in failed');
    }
  }

  Future<AttendanceRecord> checkOut({
    required double latitude,
    required double longitude,
    String? address,
    required File selfieFile,
  }) async {
    try {
      final formData = FormData.fromMap({
        'latitude': latitude.toString(),
        'longitude': longitude.toString(),
        'address': address ?? 'Lat: $latitude, Lng: $longitude',
        'selfie': await MultipartFile.fromFile(
          selfieFile.path,
          filename: 'checkout_${DateTime.now().millisecondsSinceEpoch}.jpg',
        ),
      });

      final response = await _dio.post('/api/attendance/check-out', data: formData);
      return AttendanceRecord.fromJson(response.data['attendance']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Check-out failed');
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
