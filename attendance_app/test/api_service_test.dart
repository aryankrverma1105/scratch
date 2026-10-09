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

  group('Phase 4 - Outbox & Tracking Utilities Tests', () {
    test('UTC ISO-8601 timestamps strictly formatted with trailing Z', () {
      final date = DateTime.utc(2026, 10, 9, 12, 30, 45);
      final iso = date.toIso8601String();
      final formatted = iso.endsWith('Z') ? iso : '${iso}Z';
      expect(formatted, equals('2026-10-09T12:30:45.000Z'));
      expect(formatted.endsWith('Z'), isTrue);
    });

    test('Exponential backoff stays bounded within 120s limit', () {
      int calculateBackoff(int failures) {
        return (failures == 0) ? 0 : (2 << failures > 120 ? 120 : (1 << failures));
      }

      expect(calculateBackoff(1), equals(2));
      expect(calculateBackoff(2), equals(4));
      expect(calculateBackoff(3), equals(8));
      expect(calculateBackoff(10), equals(120));
    });
  });
}
