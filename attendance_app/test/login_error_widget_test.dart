import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:attendance_app/core/services/api_service.dart';
import 'package:attendance_app/screens/auth/login_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('LoginScreen & Error Mapping Widget Tests', () {
    testWidgets('LoginScreen renders branding and input fields', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: LoginScreen(),
        ),
      );

      // Verify branding
      expect(find.text('Sologix Energy'), findsOneWidget);
      expect(find.text('Energizing Naturally • Field Attendance Portal'), findsOneWidget);
      expect(find.text('Sign In'), findsOneWidget);
      expect(find.text('Username or Email'), findsOneWidget);
      expect(find.text('Password'), findsOneWidget);
    });

    testWidgets('Tapping Sign In with empty fields displays friendly validation error',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: LoginScreen(),
        ),
      );

      // Tap Sign In button
      final signInButton = find.widgetWithText(ElevatedButton, 'Sign In');
      expect(signInButton, findsOneWidget);
      await tester.tap(signInButton);
      await tester.pump();

      // Verify friendly error message appears
      expect(find.text('Please enter username/email and password'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
    });

    test('ApiService.formatDioError maps raw Dio errors into friendly messages', () {
      // 1. Connection Error
      final connError = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        type: DioExceptionType.connectionError,
      );
      expect(
        ApiService.formatDioError(connError),
        equals("Can't reach the server. Check your internet connection or server address."),
      );

      // 2. Connection Timeout
      final timeoutError = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        type: DioExceptionType.connectionTimeout,
      );
      expect(
        ApiService.formatDioError(timeoutError),
        equals("Connection timed out. Server is taking too long to respond."),
      );

      // 3. Receive Timeout
      final receiveTimeout = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        type: DioExceptionType.receiveTimeout,
      );
      expect(
        ApiService.formatDioError(receiveTimeout),
        equals("Server response timed out. Please try again."),
      );

      // 4. 401 Unauthorized with custom message
      final unauthorizedWithMsg = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        type: DioExceptionType.badResponse,
        response: Response(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          statusCode: 401,
          data: {'error': 'Invalid username or password'},
        ),
      );
      expect(
        ApiService.formatDioError(unauthorizedWithMsg),
        equals("Invalid username or password"),
      );

      // 5. 403 Forbidden
      final forbiddenError = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        type: DioExceptionType.badResponse,
        response: Response(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          statusCode: 403,
        ),
      );
      expect(
        ApiService.formatDioError(forbiddenError),
        equals("Access denied. Your account lacks required permissions."),
      );

      // 6. 500 Internal Server Error
      final serverError = DioException(
        requestOptions: RequestOptions(path: '/api/auth/login'),
        type: DioExceptionType.badResponse,
        response: Response(
          requestOptions: RequestOptions(path: '/api/auth/login'),
          statusCode: 500,
        ),
      );
      expect(
        ApiService.formatDioError(serverError),
        equals("Server error (500). Please try again shortly."),
      );
    });
  });
}
