import 'package:dio/dio.dart';

class ReverseGeocodingService {
  static final ReverseGeocodingService _instance = ReverseGeocodingService._internal();
  factory ReverseGeocodingService() => _instance;
  ReverseGeocodingService._internal();

  final Dio _dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 4),
      receiveTimeout: const Duration(seconds: 4),
      headers: {
        'User-Agent': 'SologixAttendanceApp/1.0 (contact@sologixenergy.com)',
        'Accept': 'application/json',
      },
    ),
  );

  // In-memory cache keyed by 3 decimal place coordinates (~110m precision)
  final Map<String, String> _cache = {};

  String _coordinateKey(double lat, double lng) {
    return '${lat.toStringAsFixed(3)},${lng.toStringAsFixed(3)}';
  }

  /// Resolve latitude & longitude to a clean, exact place name
  Future<String> getPlaceName(double lat, double lng) async {
    final key = _coordinateKey(lat, lng);
    if (_cache.containsKey(key)) {
      return _cache[key]!;
    }

    try {
      final response = await _dio.get(
        'https://nominatim.openstreetmap.org/reverse',
        queryParameters: {
          'lat': lat,
          'lon': lng,
          'format': 'json',
          'addressdetails': 1,
        },
      );

      if (response.statusCode == 200 && response.data != null) {
        final data = response.data;
        final address = data['address'] as Map<String, dynamic>?;

        String placeName = '';
        if (address != null) {
          final List<String> parts = [];

          // Primary location descriptor (building, landmark, road)
          final road = address['road'] ?? address['pedestrian'] ?? address['street'];
          final landmark = address['amenity'] ?? address['building'] ?? address['commercial'] ?? address['industrial'];
          if (landmark != null && landmark.toString().isNotEmpty) {
            parts.add(landmark.toString());
          }
          if (road != null && road.toString().isNotEmpty && !parts.contains(road.toString())) {
            parts.add(road.toString());
          }

          // Suburb / Area / Colony
          final suburb = address['suburb'] ?? address['neighbourhood'] ?? address['residential'] ?? address['subdistrict'];
          if (suburb != null && suburb.toString().isNotEmpty) {
            parts.add(suburb.toString());
          }

          // City / Town
          final city = address['city'] ?? address['town'] ?? address['village'] ?? address['county'];
          if (city != null && city.toString().isNotEmpty) {
            parts.add(city.toString());
          }

          // State
          final state = address['state'];
          if (state != null && state.toString().isNotEmpty) {
            parts.add(state.toString());
          }

          if (parts.isNotEmpty) {
            placeName = parts.join(', ');
          }
        }

        if (placeName.isEmpty && data['display_name'] != null) {
          // Take first 3-4 segments of display name
          final segments = data['display_name'].toString().split(',');
          placeName = segments.take(4).map((s) => s.trim()).join(', ');
        }

        if (placeName.isNotEmpty) {
          _cache[key] = placeName;
          return placeName;
        }
      }
    } catch (_) {
      // Ignore network errors and fallback cleanly
    }

    // Fallback representation
    final fallback = 'GPS: ${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)}';
    return fallback;
  }

  /// Synchronous cache lookup if already resolved
  String? getCachedPlace(double lat, double lng) {
    final key = _coordinateKey(lat, lng);
    return _cache[key];
  }
}
