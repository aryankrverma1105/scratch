import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../models/user_model.dart';
import '../../models/attendance_model.dart';
import '../../models/location_model.dart';
import '../../models/leave_models.dart';
import '../../models/salary_models.dart';
import '../../models/office_models.dart';
import 'sync_service.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  static const String defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://34.180.17.0:5050',
  );

  static const String appVersion = '1.2.0';
  static const String appBuildNumber = '16';

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
          if (data is Map) {
            final base = (data['error'] ?? data['message'])?.toString();
            final details = data['details']?.toString();
            if (base != null && details != null && details.isNotEmpty) {
              serverMessage = '$base: $details';
            } else {
              serverMessage = base ?? details;
            }
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
          'app_version': appVersion,
          'app_build_number': appBuildNumber,
          'device_os': Platform.isAndroid ? 'Android' : 'iOS',
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
    String? locationSource,
    int? batteryPercentage,
    String? networkStatus,
    String? outsideReason,
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
      if (locationSource != null) {
        formMap['location_source'] = locationSource;
      }
      if (batteryPercentage != null) {
        formMap['battery_percentage'] = batteryPercentage.toString();
      }
      if (networkStatus != null) {
        formMap['network_status'] = networkStatus;
      }
      if (outsideReason != null && outsideReason.isNotEmpty) {
        formMap['outside_reason'] = outsideReason;
      }
      formMap['app_version'] = appVersion;
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
    String? salaryType,
    double? monthlyBasicSalary,
    double? dailyWageOverride,
    double? dailyIncentiveRate,
  }) async {
    try {
      final data = <String, dynamic>{
        'email': email,
        'password': password,
        'full_name': fullName,
        'role': role,
      };
      if (username != null && username.trim().isNotEmpty) {
        data['username'] = username.trim();
      }
      if (department != null && department.trim().isNotEmpty) {
        data['department'] = department.trim();
      }
      if (phone != null && phone.trim().isNotEmpty) {
        data['phone'] = phone.trim();
      }
      if (salaryType != null) {
        data['salaryType'] = salaryType;
      }
      if (monthlyBasicSalary != null) {
        data['monthlyBasicSalary'] = monthlyBasicSalary;
      }
      if (dailyWageOverride != null) {
        data['dailyWageOverride'] = dailyWageOverride;
      }
      if (dailyIncentiveRate != null) {
        data['dailyIncentiveRate'] = dailyIncentiveRate;
      }
      final response = await _dio.post('/api/admin/users', data: data);
      return UserModel.fromJson(response.data['user']);
    } on DioException catch (e) {
      String? detailMsg;
      if (e.response?.data is Map) {
        final data = e.response!.data as Map;
        if (data['details'] is List && (data['details'] as List).isNotEmpty) {
          detailMsg = (data['details'] as List).map((d) => d['message']).join(', ');
        } else if (data['error'] != null) {
          detailMsg = data['error'].toString();
        }
      }
      throw Exception(detailMsg ?? formatDioError(e));
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

  Future<UserModel> adminUpdateUser(
    int userId, {
    String? fullName,
    String? role,
    String? department,
    String? phone,
    bool? isActive,
    String? password,
  }) async {
    try {
      final data = <String, dynamic>{};
      if (fullName != null) data['full_name'] = fullName;
      if (role != null) data['role'] = role;
      if (department != null) data['department'] = department;
      if (phone != null) data['phone'] = phone;
      if (isActive != null) data['is_active'] = isActive;
      if (password != null && password.isNotEmpty) data['password'] = password;

      final response = await _dio.put('/api/admin/users/$userId', data: data);
      return UserModel.fromJson(response.data['user']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to update user');
    }
  }

  Future<void> adminDeleteUser(int userId) async {
    try {
      await _dio.delete('/api/admin/users/$userId');
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to delete user');
    }
  }


  Future<List<AttendanceRecord>> adminGetAttendance({String? date, int? userId, int limit = 200}) async {
    try {
      final report = await adminGetAttendanceReport(date: date, userId: userId, limit: limit);
      return (report['records'] as List).cast<AttendanceRecord>();
    } catch (e) {
      throw Exception(e.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<Map<String, dynamic>> adminGetAttendanceReport({String? date, int? userId, String? search, int limit = 200}) async {
    try {
      final query = <String, dynamic>{'limit': limit};
      if (date != null) query['date'] = date;
      if (userId != null) query['userId'] = userId;
      if (search != null && search.trim().isNotEmpty) query['search'] = search.trim();

      final response = await _dio.get('/api/admin/attendance', queryParameters: query);
      final list = (response.data['records'] as List? ?? [])
          .map((r) => AttendanceRecord.fromJson(r))
          .toList();
      return {
        'records': list,
        'totalPresent': response.data['totalPresent'] is int
            ? response.data['totalPresent']
            : int.tryParse(response.data['totalPresent']?.toString() ?? '0') ?? 0,
      };
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to load attendance');
    }
  }

  Future<Map<String, dynamic>> getUserProfile(int userId) async {
    try {
      final response = await _dio.get('/api/admin/users/$userId/profile');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch user profile');
    }
  }

  // --- LEAVE MANAGEMENT APIs ---

  Future<LeaveBalanceModel> getLeaveBalance({String? year}) async {
    try {
      final query = <String, dynamic>{};
      if (year != null) query['year'] = year;
      final response = await _dio.get('/api/leave/balance', queryParameters: query);
      return LeaveBalanceModel.fromJson(response.data);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch leave balance');
    }
  }

  Future<MonthlyLeaveSummaryModel> getLeaveSummary({String? month, String? year}) async {
    try {
      final query = <String, dynamic>{};
      if (month != null) query['month'] = month;
      if (year != null) query['year'] = year;
      final response = await _dio.get('/api/leave/summary', queryParameters: query);
      return MonthlyLeaveSummaryModel.fromJson(response.data);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch monthly leave summary');
    }
  }

  Future<Map<String, dynamic>> getLeaveHistory({String? year}) async {
    try {
      final query = <String, dynamic>{};
      if (year != null) query['year'] = year;
      final response = await _dio.get('/api/leave/history', queryParameters: query);
      final rawLeaves = response.data['leaves'] as List? ?? [];
      final rawAbsences = response.data['absences'] as List? ?? [];
      return {
        'leaveYear': response.data['leaveYear']?.toString() ?? '',
        'leaves': rawLeaves.map((l) => LeaveRecordModel.fromJson(l)).toList(),
        'absences': rawAbsences.map((a) => AttendanceAbsenceModel.fromJson(a)).toList(),
      };
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch leave history');
    }
  }

  Future<LeaveCalculationModel> calculateLeave(String startDate, String endDate) async {
    try {
      final response = await _dio.post('/api/leave/calculate', data: {
        'startDate': startDate,
        'endDate': endDate,
      });
      return LeaveCalculationModel.fromJson(response.data);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to calculate leave');
    }
  }

  Future<Map<String, dynamic>> requestLeave(String startDate, String endDate, {String? reason}) async {
    try {
      final response = await _dio.post('/api/leave/request', data: {
        'startDate': startDate,
        'endDate': endDate,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      });
      return response.data;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to submit leave request');
    }
  }

  Future<Map<String, dynamic>> cancelLeave(int leaveId, {String? reason}) async {
    try {
      final response = await _dio.post('/api/leave/$leaveId/cancel', data: {
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      });
      return response.data;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to cancel leave');
    }
  }

  Future<HolidaysResponseModel> getCompanyHolidays({String? year}) async {
    try {
      final query = <String, dynamic>{};
      if (year != null) query['year'] = year;
      final response = await _dio.get('/api/leave/holidays', queryParameters: query);
      return HolidaysResponseModel.fromJson(response.data);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch holidays');
    }
  }

  // --- ADMIN LEAVE APIs ---

  Future<Map<String, dynamic>> adminGetLeaveSummaries({String? month, String? year}) async {
    try {
      final query = <String, dynamic>{};
      if (month != null) query['month'] = month;
      if (year != null) query['year'] = year;
      final response = await _dio.get('/api/leave/admin/summaries', queryParameters: query);
      final rawSummaries = response.data['summaries'] as List? ?? [];
      final rawThreshold = response.data['thresholdExceededUsers'] as List? ?? [];
      return {
        'leaveYear': response.data['leaveYear']?.toString() ?? '',
        'month': response.data['month']?.toString() ?? '',
        'totalUsers': response.data['totalUsers'] ?? 0,
        'thresholdExceededCount': response.data['thresholdExceededCount'] ?? 0,
        'summaries': rawSummaries.map((s) => AdminUserLeaveSummaryModel.fromJson(s)).toList(),
        'thresholdExceededUsers': rawThreshold.map((s) => AdminUserLeaveSummaryModel.fromJson(s)).toList(),
      };
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch admin leave summaries');
    }
  }

  Future<List<LeaveRecordModel>> adminGetLeaveRecords({int? userId, String? year, String? status}) async {
    try {
      final query = <String, dynamic>{};
      if (userId != null) query['userId'] = userId;
      if (year != null) query['year'] = year;
      if (status != null) query['status'] = status;
      final response = await _dio.get('/api/leave/admin/records', queryParameters: query);
      final list = (response.data['records'] as List? ?? [])
          .map((r) => LeaveRecordModel.fromJson(r))
          .toList();
      return list;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch leave records');
    }
  }

  Future<List<AttendanceAbsenceModel>> adminGetAbsences({int? userId, String? month, String? year, bool? isCorrected}) async {
    try {
      final query = <String, dynamic>{};
      if (userId != null) query['userId'] = userId;
      if (month != null) query['month'] = month;
      if (year != null) query['year'] = year;
      if (isCorrected != null) query['isCorrected'] = isCorrected ? '1' : '0';
      final response = await _dio.get('/api/leave/admin/absences', queryParameters: query);
      final list = (response.data['absences'] as List? ?? [])
          .map((a) => AttendanceAbsenceModel.fromJson(a))
          .toList();
      return list;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch absences');
    }
  }

  Future<void> adminCorrectAbsence(int absenceId, String notes) async {
    try {
      await _dio.post('/api/leave/admin/absences/$absenceId/correct', data: {
        'notes': notes,
      });
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to correct absence record');
    }
  }

  Future<CompanyHolidayModel> adminCreateHoliday({
    required String leaveYear,
    required String name,
    required String date,
    String? description,
  }) async {
    try {
      final data = <String, dynamic>{
        'leaveYear': leaveYear,
        'name': name,
        'date': date,
      };
      if (description != null) data['description'] = description;
      final response = await _dio.post('/api/leave/admin/holidays', data: data);
      return CompanyHolidayModel.fromJson(response.data['holiday']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to create holiday');
    }
  }

  Future<CompanyHolidayModel> adminUpdateHoliday(
    int holidayId, {
    String? name,
    String? date,
    String? description,
    bool? isActive,
  }) async {
    try {
      final data = <String, dynamic>{};
      if (name != null) data['name'] = name;
      if (date != null) data['date'] = date;
      if (description != null) data['description'] = description;
      if (isActive != null) data['isActive'] = isActive;
      final response = await _dio.put('/api/leave/admin/holidays/$holidayId', data: data);
      return CompanyHolidayModel.fromJson(response.data['holiday']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to update holiday');
    }
  }

  Future<void> adminDeleteHoliday(int holidayId) async {
    try {
      await _dio.delete('/api/leave/admin/holidays/$holidayId');
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to delete holiday');
    }
  }

  // --- Salary & Payroll APIs ---

  Future<SalarySettingsModel> getSalarySettings() async {
    try {
      final response = await _dio.get('/api/salary/admin/settings');
      return SalarySettingsModel.fromJson(response.data['settings']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch salary settings');
    }
  }

  Future<SalarySettingsModel> updateSalarySettings(double commonDailyWage) async {
    try {
      final response = await _dio.put('/api/salary/admin/settings', data: {
        'commonDailyWage': commonDailyWage,
      });
      return SalarySettingsModel.fromJson(response.data['settings']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to update salary settings');
    }
  }

  Future<List<EmployeeSalaryConfigModel>> getEmployeeSalaryConfigs() async {
    try {
      final response = await _dio.get('/api/salary/admin/configs');
      final list = (response.data['configs'] as List? ?? []);
      return list.map((c) => EmployeeSalaryConfigModel.fromJson(c)).toList();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch employee configs');
    }
  }

  Future<EmployeeSalaryConfigModel> saveEmployeeSalaryConfig({
    required int userId,
    required String salaryType,
    double? monthlyBasicSalary,
    double? dailyWageOverride,
    double? dailyIncentiveRate,
    String? effectiveDate,
    String? remarks,
  }) async {
    try {
      final nowStr = DateTime.now().toIso8601String().substring(0, 10);
      final response = await _dio.post('/api/salary/admin/configs', data: {
        'userId': userId,
        'salaryType': salaryType,
        'monthlyBasicSalary': monthlyBasicSalary ?? 0.0,
        'dailyWageOverride': dailyWageOverride,
        'dailyIncentiveRate': dailyIncentiveRate ?? 0.0,
        'effectiveDate': (effectiveDate != null && effectiveDate.isNotEmpty) ? effectiveDate : nowStr,
        'remarks': remarks,
      });
      return EmployeeSalaryConfigModel.fromJson(response.data['config']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to save salary config');
    }
  }

  Future<Map<String, dynamic>> adminResetLeaveBalances({String? leaveYear, bool resetHolidays = false}) async {
    try {
      final data = <String, dynamic>{
        'resetHolidays': resetHolidays,
      };
      if (leaveYear != null) data['leaveYear'] = leaveYear;
      final response = await _dio.post('/api/leave/admin/reset-balances', data: data);
      return response.data;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to reset leave balances');
    }
  }

  Future<List<DailyIncentiveModel>> getAdminIncentives({String? month, int? userId}) async {
    try {
      final params = <String, dynamic>{};
      if (month != null) params['month'] = month;
      if (userId != null) params['userId'] = userId;
      final response = await _dio.get('/api/salary/admin/incentives', queryParameters: params);
      final list = (response.data['incentives'] as List? ?? []);
      return list.map((i) => DailyIncentiveModel.fromJson(i)).toList();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch incentives');
    }
  }

  Future<DailyIncentiveModel> createIncentive({
    required int userId,
    required String date,
    required double amount,
    String? description,
    String? status,
  }) async {
    try {
      final response = await _dio.post('/api/salary/admin/incentives', data: {
        'userId': userId,
        'date': date,
        'amount': amount,
        'description': description,
        'status': status ?? 'approved',
      });
      return DailyIncentiveModel.fromJson(response.data['incentive']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to create incentive');
    }
  }

  Future<void> deleteIncentive(int id) async {
    try {
      await _dio.delete('/api/salary/admin/incentives/$id');
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to delete incentive');
    }
  }

  Future<List<OvertimeRecordModel>> getAdminOvertime({String? month, int? userId}) async {
    try {
      final params = <String, dynamic>{};
      if (month != null) params['month'] = month;
      if (userId != null) params['userId'] = userId;
      final response = await _dio.get('/api/salary/admin/overtime', queryParameters: params);
      final list = (response.data['overtimes'] as List? ?? []);
      return list.map((o) => OvertimeRecordModel.fromJson(o)).toList();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch overtime');
    }
  }

  Future<OvertimeRecordModel> createOvertime({
    required int userId,
    required String date,
    required double hours,
    required double amount,
    String? remarks,
    String? status,
  }) async {
    try {
      final response = await _dio.post('/api/salary/admin/overtime', data: {
        'userId': userId,
        'date': date,
        'hours': hours,
        'amount': amount,
        'remarks': remarks,
        'status': status ?? 'approved',
      });
      return OvertimeRecordModel.fromJson(response.data['overtime']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to record overtime');
    }
  }

  Future<void> deleteOvertime(int id) async {
    try {
      await _dio.delete('/api/salary/admin/overtime/$id');
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to delete overtime');
    }
  }

  Future<Map<String, dynamic>> previewPayroll({String? month, String? cycleCode}) async {
    try {
      final params = <String, dynamic>{};
      if (month != null) params['month'] = month;
      if (cycleCode != null) params['cycleCode'] = cycleCode;
      final response = await _dio.get('/api/salary/admin/payroll/preview', queryParameters: params);
      final list = (response.data['calculations'] as List? ?? []);
      final calculations = list.map((c) => SalaryCalculationModel.fromJson(c)).toList();
      return {
        'month': response.data['month'],
        'cycleCode': response.data['cycleCode'],
        'isFinalized': response.data['isFinalized'] ?? false,
        'finalizedAt': response.data['finalizedAt'],
        'calculations': calculations,
      };
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to preview payroll');
    }
  }

  Future<void> finalizePayroll({String? month, String? cycleCode, String? notes}) async {
    try {
      final data = <String, dynamic>{};
      if (month != null) data['month'] = month;
      if (cycleCode != null) data['cycleCode'] = cycleCode;
      if (notes != null) data['notes'] = notes;
      await _dio.post('/api/salary/admin/payroll/finalize', data: data);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to finalize payroll');
    }
  }

  Future<String> exportPayrollCsv({String? month, String? cycleCode}) async {
    try {
      final params = <String, dynamic>{};
      if (month != null) params['month'] = month;
      if (cycleCode != null) params['cycleCode'] = cycleCode;
      final response = await _dio.get(
        '/api/salary/admin/payroll/export',
        queryParameters: params,
        options: Options(responseType: ResponseType.plain),
      );
      return response.data.toString();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to export payroll CSV');
    }
  }

  // --- Salary Cycles & Disbursement Batch APIs ---

  Future<SalaryCycleModel?> getActiveSalaryCycle() async {
    try {
      final response = await _dio.get('/api/salary/admin/cycles/active');
      if (response.data['cycle'] != null) {
        return SalaryCycleModel.fromJson(response.data['cycle']);
      }
      return null;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch active cycle');
    }
  }

  Future<List<SalaryCycleModel>> listSalaryCycles() async {
    try {
      final response = await _dio.get('/api/salary/admin/cycles');
      final list = (response.data['cycles'] as List? ?? []);
      return list.map((c) => SalaryCycleModel.fromJson(c)).toList();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch salary cycles');
    }
  }

  Future<Map<String, dynamic>> getSalaryCycleDetails(String cycleCode) async {
    try {
      final response = await _dio.get('/api/salary/admin/cycles/$cycleCode');
      return response.data;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch cycle details');
    }
  }

  Future<Map<String, dynamic>> disburseAndAdvanceCycle({
    required String cycleCode,
    required String paymentDate,
    required double totalDisbursed,
    String? disbursementMethod,
    String? notes,
  }) async {
    try {
      final response = await _dio.post('/api/salary/admin/cycles/disburse-and-advance', data: {
        'cycleCode': cycleCode,
        'paymentDate': paymentDate,
        'totalDisbursed': totalDisbursed,
        'disbursementMethod': disbursementMethod ?? 'bank_transfer',
        'notes': notes,
      });
      return response.data;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to record disbursement and advance cycle');
    }
  }

  Future<Map<String, dynamic>> recordAdditionalPayment({
    required String cycleCode,
    required int userId,
    required double amount,
    required String paymentDate,
    String? paymentMethod,
    String? remarks,
  }) async {
    try {
      final response = await _dio.post('/api/salary/admin/cycles/$cycleCode/record-payment', data: {
        'userId': userId,
        'amount': amount,
        'paymentDate': paymentDate,
        'paymentMethod': paymentMethod ?? 'bank_transfer',
        'remarks': remarks,
      });
      return response.data;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to record additional payment');
    }
  }

  Future<SalaryCalculationModel> getMySalary({String? month, String? cycleCode}) async {
    try {
      final params = <String, dynamic>{};
      if (month != null) params['month'] = month;
      if (cycleCode != null) params['cycleCode'] = cycleCode;
      final response = await _dio.get('/api/salary/my-salary', queryParameters: params);
      return SalaryCalculationModel.fromJson(response.data['salary']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch my salary');
    }
  }

  Future<List<DailyIncentiveModel>> getMyIncentives({String? month}) async {
    try {
      final params = <String, dynamic>{};
      if (month != null) params['month'] = month;
      final response = await _dio.get('/api/salary/my-incentives', queryParameters: params);
      final list = (response.data['incentives'] as List? ?? []);
      return list.map((i) => DailyIncentiveModel.fromJson(i)).toList();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch my incentives');
    }
  }

  Future<List<OvertimeRecordModel>> getMyOvertime({String? month}) async {
    try {
      final params = <String, dynamic>{};
      if (month != null) params['month'] = month;
      final response = await _dio.get('/api/salary/my-overtime', queryParameters: params);
      final list = (response.data['overtimes'] as List? ?? []);
      return list.map((o) => OvertimeRecordModel.fromJson(o)).toList();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch my overtime');
    }
  }

  Future<List<SalaryCalculationModel>> getMyPayrollHistory() async {
    try {
      final response = await _dio.get('/api/salary/my-history');
      final list = (response.data['history'] as List? ?? []);
      return list.map((h) => SalaryCalculationModel.fromJson(h)).toList();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch payroll history');
    }
  }

  // --- Admin Audit / Activity Logs ---

  // --- Salary Advances & EMI APIs ---

  Future<List<SalaryAdvanceModel>> getSalaryAdvances({int? userId, String? status}) async {
    try {
      final params = <String, dynamic>{};
      if (userId != null) params['userId'] = userId;
      if (status != null && status.isNotEmpty) params['status'] = status;
      final response = await _dio.get('/api/salary/admin/advances', queryParameters: params);
      final list = (response.data['advances'] as List? ?? []);
      return list.map((a) => SalaryAdvanceModel.fromJson(a)).toList();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch salary advances');
    }
  }

  Future<SalaryAdvanceModel> createSalaryAdvance({
    required int userId,
    required double amount,
    String? purpose,
    String? disbursementDate,
    String recoveryType = 'emi',
    int totalInstallments = 1,
    String? startMonth,
    String? notes,
  }) async {
    try {
      final response = await _dio.post('/api/salary/admin/advances', data: {
        'userId': userId,
        'amount': amount,
        if (purpose != null) 'purpose': purpose,
        if (disbursementDate != null) 'disbursementDate': disbursementDate,
        'recoveryType': recoveryType,
        'totalInstallments': totalInstallments,
        if (startMonth != null) 'startMonth': startMonth,
        if (notes != null) 'notes': notes,
      });
      return SalaryAdvanceModel.fromJson(response.data['advance']);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to create salary advance');
    }
  }

  Future<Map<String, dynamic>> getSalaryAdvanceDetails(int advanceId) async {
    try {
      final response = await _dio.get('/api/salary/admin/advances/$advanceId');
      final adv = SalaryAdvanceModel.fromJson(response.data['advance']);
      final emisList = (response.data['emis'] as List? ?? []);
      final emis = emisList.map((e) => SalaryAdvanceEmiModel.fromJson(e)).toList();
      return {
        'advance': adv,
        'emis': emis,
      };
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch advance details');
    }
  }

  Future<void> pauseSalaryAdvance(int advanceId) async {
    try {
      await _dio.put('/api/salary/admin/advances/$advanceId/pause');
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to pause salary advance');
    }
  }

  Future<void> resumeSalaryAdvance(int advanceId) async {
    try {
      await _dio.put('/api/salary/admin/advances/$advanceId/resume');
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to resume salary advance');
    }
  }

  Future<void> settleSalaryAdvanceEarly({
    required int advanceId,
    double? settlementAmount,
    String? paymentMethod,
    String? paymentReference,
    String? notes,
  }) async {
    try {
      await _dio.post('/api/salary/admin/advances/$advanceId/settle', data: {
        if (settlementAmount != null) 'settlementAmount': settlementAmount,
        if (paymentMethod != null) 'paymentMethod': paymentMethod,
        if (paymentReference != null) 'paymentReference': paymentReference,
        if (notes != null) 'notes': notes,
      });
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to settle salary advance');
    }
  }

  Future<Map<String, dynamic>> getMyAdvances() async {
    try {
      final response = await _dio.get('/api/salary/my-advances');
      final data = response.data as Map<String, dynamic>;
      final advsList = (data['advances'] as List? ?? []);
      final advances = advsList.map((a) => SalaryAdvanceModel.fromJson(a)).toList();
      final activeAdvsList = (data['activeAdvances'] as List? ?? []);
      final activeAdvances = activeAdvsList.map((a) => SalaryAdvanceModel.fromJson(a)).toList();
      final activeAdv = data['activeAdvance'] != null
          ? SalaryAdvanceModel.fromJson(data['activeAdvance'])
          : (activeAdvances.isNotEmpty ? activeAdvances.first : null);
      final nextEmi = data['nextEmi'] != null
          ? SalaryAdvanceEmiModel.fromJson(data['nextEmi'])
          : null;
      final emisList = (data['emis'] as List? ?? []);
      final emis = emisList.map((e) => SalaryAdvanceEmiModel.fromJson(e)).toList();
      final repsList = (data['repayments'] as List? ?? []);
      final repayments = repsList.map((e) => SalaryAdvanceEmiModel.fromJson(e)).toList();

      double toDbl(dynamic v) {
        if (v == null) return 0.0;
        if (v is num) return v.toDouble();
        return double.tryParse(v.toString()) ?? 0.0;
      }

      return {
        'advances': advances,
        'activeAdvances': activeAdvances,
        'activeAdvance': activeAdv,
        'nextEmi': nextEmi,
        'emis': emis,
        'repayments': repayments,
        'totalOriginalAdvance': toDbl(data['totalOriginalAdvance']),
        'totalAmountRepaid': toDbl(data['totalAmountRepaid']),
        'totalRemainingBalance': toDbl(data['totalRemainingBalance']),
        'totalMonthlyEmi': toDbl(data['totalMonthlyEmi']),
        'emisPaidCount': data['emisPaidCount'] is int ? data['emisPaidCount'] : int.tryParse(data['emisPaidCount']?.toString() ?? '0') ?? repayments.length,
        'emisRemainingCount': data['emisRemainingCount'] is int ? data['emisRemainingCount'] : int.tryParse(data['emisRemainingCount']?.toString() ?? '0') ?? 0,
        'repaymentStatus': data['repaymentStatus']?.toString() ?? (activeAdv?.status ?? 'none'),
      };
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  // --- Google Drive Automated Backups APIs ---

  Future<List<BackupDestinationModel>> getBackupDestinations() async {
    try {
      final response = await _dio.get('/api/admin/backups/destinations');
      final list = (response.data['destinations'] as List? ?? []);
      return list.map((d) => BackupDestinationModel.fromJson(d)).toList();
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<BackupDestinationModel> saveBackupDestination({
    int? id,
    required String name,
    String? folderId,
    String? clientId,
    String? clientSecret,
    String? refreshToken,
    String? accountEmail,
    bool isEnabled = true,
  }) async {
    try {
      final response = await _dio.post('/api/admin/backups/destinations', data: {
        if (id != null) 'id': id,
        'name': name,
        if (folderId != null) 'folderId': folderId,
        if (clientId != null) 'clientId': clientId,
        if (clientSecret != null) 'clientSecret': clientSecret,
        if (refreshToken != null) 'refreshToken': refreshToken,
        if (accountEmail != null) 'accountEmail': accountEmail,
        'isEnabled': isEnabled,
      });
      return BackupDestinationModel.fromJson(response.data['destination']);
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<Map<String, dynamic>> testBackupDestination(int id) async {
    try {
      final response = await _dio.post('/api/admin/backups/destinations/$id/test');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<void> deleteBackupDestination(int id) async {
    try {
      await _dio.delete('/api/admin/backups/destinations/$id');
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<List<BackupRecordModel>> getBackupHistory({int limit = 50}) async {
    try {
      final response = await _dio.get('/api/admin/backups/history', queryParameters: {'limit': limit});
      final list = (response.data['records'] as List? ?? []);
      return list.map((r) => BackupRecordModel.fromJson(r)).toList();
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<Map<String, dynamic>> triggerManualBackup({int? destinationId}) async {
    try {
      final response = await _dio.post(
        '/api/admin/backups/trigger',
        data: {
          if (destinationId != null) 'destinationId': destinationId,
        },
        options: Options(
          sendTimeout: const Duration(seconds: 120),
          receiveTimeout: const Duration(seconds: 120),
        ),
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<void> retryBackup(int recordId) async {
    try {
      await _dio.post('/api/admin/backups/records/$recordId/retry');
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<Map<String, dynamic>> verifyBackup(int recordId) async {
    try {
      final response = await _dio.post('/api/admin/backups/records/$recordId/verify');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<Map<String, dynamic>> restoreBackup(int recordId) async {
    try {
      final response = await _dio.post('/api/admin/backups/records/$recordId/restore');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  // --- Admin Audit / Activity Logs ---

  Future<Map<String, dynamic>> getActivityLogs({
    int page = 1,
    int limit = 50,
    String? action,
    String? module,
    String? search,
    String? startDate,
    String? endDate,
  }) async {
    try {
      final params = <String, dynamic>{
        'page': page,
        'limit': limit,
      };
      if (action != null && action.isNotEmpty) params['action'] = action;
      if (module != null && module.isNotEmpty) params['module'] = module;
      if (search != null && search.isNotEmpty) params['search'] = search;
      if (startDate != null && startDate.isNotEmpty) params['startDate'] = startDate;
      if (endDate != null && endDate.isNotEmpty) params['endDate'] = endDate;

      final response = await _dio.get('/api/admin/audit-logs', queryParameters: params);
      final list = (response.data['logs'] as List? ?? []);
      final logs = list.map((l) => ActivityLogModel.fromJson(l)).toList();
      return {
        'page': response.data['page'],
        'totalPages': response.data['totalPages'],
        'total': response.data['total'],
        'logs': logs,
      };
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch activity logs');
    }
  }

  Future<String> exportActivityLogsCsv({
    String? action,
    String? module,
    String? search,
    String? startDate,
    String? endDate,
  }) async {
    try {
      final params = <String, dynamic>{};
      if (action != null && action.isNotEmpty) params['action'] = action;
      if (module != null && module.isNotEmpty) params['module'] = module;
      if (search != null && search.isNotEmpty) params['search'] = search;
      if (startDate != null && startDate.isNotEmpty) params['startDate'] = startDate;
      if (endDate != null && endDate.isNotEmpty) params['endDate'] = endDate;

      final response = await _dio.get<String>(
        '/api/admin/audit-logs/export',
        queryParameters: params,
        options: Options(responseType: ResponseType.plain),
      );
      return response.data ?? '';
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to export activity logs CSV');
    }
  }

  // --- Multi-Office Geofencing ---

  Future<List<OfficeModel>> getOffices() async {
    try {
      final response = await _dio.get('/api/admin/offices');
      final list = (response.data['offices'] as List? ?? []);
      return list.map((o) => OfficeModel.fromJson(o)).toList();
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<List<OfficeModel>> getActiveOffices() async {
    try {
      final response = await _dio.get('/api/attendance/active-offices');
      final list = (response.data['offices'] as List? ?? []);
      return list.map((o) => OfficeModel.fromJson(o)).toList();
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<OfficeModel> createOffice(Map<String, dynamic> data) async {
    try {
      final response = await _dio.post('/api/admin/offices', data: data);
      return OfficeModel.fromJson(response.data['office']);
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<OfficeModel> updateOffice(int id, Map<String, dynamic> data) async {
    try {
      final response = await _dio.put('/api/admin/offices/$id', data: data);
      return OfficeModel.fromJson(response.data['office']);
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<void> deleteOffice(int id) async {
    try {
      await _dio.delete('/api/admin/offices/$id');
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  // --- Attendance Review System ---

  Future<List<AttendanceReviewModel>> getPendingAttendanceReviews() async {
    try {
      final response = await _dio.get('/api/admin/attendance-reviews/pending');
      final list = (response.data['reviews'] as List? ?? []);
      return list.map((r) => AttendanceReviewModel.fromJson(r)).toList();
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<Map<String, dynamic>> approveAttendanceReview(int attendanceId) async {
    try {
      final response = await _dio.post('/api/admin/attendance-reviews/$attendanceId/approve');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<Map<String, dynamic>> rejectAttendanceReview(int attendanceId, String rejectionReason) async {
    try {
      final response = await _dio.post('/api/admin/attendance-reviews/$attendanceId/reject', data: {
        'rejection_reason': rejectionReason,
      });
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<List<AttendanceReviewModel>> getMyAttendanceReviews() async {
    try {
      final response = await _dio.get('/api/attendance/my-reviews');
      final list = (response.data['reviews'] as List? ?? []);
      return list.map((r) => AttendanceReviewModel.fromJson(r)).toList();
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }

  Future<Map<String, dynamic>> getDashboardStats() async {
    try {
      final response = await _dio.get('/api/admin/dashboard/stats');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(formatDioError(e));
    }
  }
}

