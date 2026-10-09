class LiveEmployeeLocation {
  final int userId;
  final String fullName;
  final String email;
  final String? department;
  final String? phone;
  final int? attendanceId;
  final String? attendanceStatus;
  final DateTime? checkInTime;
  final double? lastLatitude;
  final double? lastLongitude;
  final double? lastAccuracy;
  final double? lastSpeed;
  final bool isGpsOff;
  final DateTime? lastLocationTime;

  LiveEmployeeLocation({
    required this.userId,
    required this.fullName,
    required this.email,
    this.department,
    this.phone,
    this.attendanceId,
    this.attendanceStatus,
    this.checkInTime,
    this.lastLatitude,
    this.lastLongitude,
    this.lastAccuracy,
    this.lastSpeed,
    this.isGpsOff = false,
    this.isMocked = false,
    this.lastLocationTime,
  });

  final bool isMocked;
  bool get isWorking => attendanceStatus == 'checked_in';
  bool get hasValidLocation => lastLatitude != null && lastLongitude != null;

  factory LiveEmployeeLocation.fromJson(Map<String, dynamic> json) {
    return LiveEmployeeLocation(
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id'].toString()) ?? 0,
      fullName: json['full_name'] ?? 'Employee',
      email: json['email'] ?? '',
      department: json['department'],
      phone: json['phone'],
      attendanceId: json['attendance_id'] != null ? int.tryParse(json['attendance_id'].toString()) : null,
      attendanceStatus: json['attendance_status'],
      checkInTime: json['check_in_time'] != null ? DateTime.tryParse(json['check_in_time'].toString()) : null,
      lastLatitude: (json['last_latitude'] as num?)?.toDouble(),
      lastLongitude: (json['last_longitude'] as num?)?.toDouble(),
      lastAccuracy: (json['last_accuracy'] as num?)?.toDouble(),
      lastSpeed: (json['last_speed'] as num?)?.toDouble(),
      isGpsOff: json['last_is_gps_off'] == 1 || json['last_is_gps_off'] == true,
      isMocked: json['last_is_mocked'] == 1 || json['last_is_mocked'] == true,
      lastLocationTime: json['last_location_time'] != null
          ? DateTime.tryParse(json['last_location_time'].toString())
          : null,
    );
  }
}

class RoutePoint {
  final int id;
  final double latitude;
  final double longitude;
  final double? accuracy;
  final double? speed;
  final bool isGpsOff;
  final bool isMocked;
  final DateTime timestamp;

  RoutePoint({
    required this.id,
    required this.latitude,
    required this.longitude,
    this.accuracy,
    this.speed,
    this.isGpsOff = false,
    this.isMocked = false,
    required this.timestamp,
  });

  factory RoutePoint.fromJson(Map<String, dynamic> json) {
    return RoutePoint(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      accuracy: (json['accuracy'] as num?)?.toDouble(),
      speed: (json['speed'] as num?)?.toDouble(),
      isGpsOff: json['is_gps_off'] == 1 || json['is_gps_off'] == true,
      isMocked: json['is_mocked'] == 1 || json['is_mocked'] == true,
      timestamp: DateTime.tryParse(json['timestamp']?.toString() ?? '') ?? DateTime.now(),
    );
  }
}

class GpsAlert {
  final int id;
  final int userId;
  final String fullName;
  final String? department;
  final String alertType;
  final String message;
  final bool resolved;
  final DateTime createdAt;

  GpsAlert({
    required this.id,
    required this.userId,
    required this.fullName,
    this.department,
    required this.alertType,
    required this.message,
    required this.resolved,
    required this.createdAt,
  });

  factory GpsAlert.fromJson(Map<String, dynamic> json) {
    return GpsAlert(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id'].toString()) ?? 0,
      fullName: json['full_name'] ?? 'User',
      department: json['department'],
      alertType: json['alert_type'] ?? 'GPS_DISABLED',
      message: json['message'] ?? '',
      resolved: json['resolved'] == 1 || json['resolved'] == true,
      createdAt: DateTime.tryParse(json['created_at']?.toString() ?? '') ?? DateTime.now(),
    );
  }
}
