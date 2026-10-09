import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:attendance_app/core/services/api_service.dart';

void main() {
  group('ApiService Phase 0 Error Mapping & URL Tests', () {
    test('defaultBaseUrl is initialized correctly', () {
      expect(ApiService.defaultBaseUrl, isNotEmpty);
      expect(ApiService().baseUrl, isNotEmpty);
    });

    test('formatDioError formats connectionTimeout cleanly', () {
      final dioError = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        type: DioExceptionType.connectionTimeout,
      );
      final msg = ApiService.formatDioError(dioError);
      expect(msg, contains('Connection timed out'));
    });

    test('formatDioError formats connectionError cleanly', () {
      final dioError = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        type: DioExceptionType.connectionError,
      );
      final msg = ApiService.formatDioError(dioError);
      expect(msg, contains("Can't reach the server"));
    });

    test('formatDioError formats 401 unauthorized cleanly', () {
      final dioError = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          statusCode: 401,
          data: {'error': 'Invalid credentials'},
        ),
        type: DioExceptionType.badResponse,
      );
      final msg = ApiService.formatDioError(dioError);
      expect(msg, equals('Invalid credentials'));
    });

    test('formatDioError formats 500 server error cleanly', () {
      final dioError = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        response: Response(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          statusCode: 500,
        ),
        type: DioExceptionType.badResponse,
      );
      final msg = ApiService.formatDioError(dioError);
      expect(msg, contains('Server error'));
    });
  });
}
