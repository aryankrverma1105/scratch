class LiveEmployeeLocation {
  final int userId;
  final String fullName;
  final String email;
  final String? department;
  final String? phone;
  final int? attendanceId;
  final String? attendanceStatus;
  final DateTime? checkInTime;
  final String? checkInAddress;
  final double? lastLatitude;
  final double? lastLongitude;
  final double? lastAccuracy;
  final double? lastSpeed;
  final bool isGpsOff;
  final DateTime? lastLocationTime;
  final String? locationSource;
  final String? locationStatus;
  final String? cellNetworkType;
  final double? providerAccuracy;
  final String? interruptionReason;
  final bool isStale;
  final int? staleDurationMinutes;
  final String? appVersion;
  final int? batteryPercentage;
  final String? networkStatus;
  final String? officeName;
  final double? distanceFromOffice;
  final bool isMocked;

  LiveEmployeeLocation({
    required this.userId,
    required this.fullName,
    required this.email,
    this.department,
    this.phone,
    this.attendanceId,
    this.attendanceStatus,
    this.checkInTime,
    this.checkInAddress,
    this.lastLatitude,
    this.lastLongitude,
    this.lastAccuracy,
    this.lastSpeed,
    this.isGpsOff = false,
    this.isMocked = false,
    this.lastLocationTime,
    this.locationSource,
    this.locationStatus,
    this.cellNetworkType,
    this.providerAccuracy,
    this.interruptionReason,
    this.isStale = false,
    this.staleDurationMinutes,
    this.appVersion,
    this.batteryPercentage,
    this.networkStatus,
    this.officeName,
    this.distanceFromOffice,
  });

  bool get isWorking => attendanceStatus == 'checked_in';
  bool get hasValidLocation => lastLatitude != null && lastLongitude != null;

  // Visual status indicators
  bool get isUnavailable =>
      isGpsOff ||
      locationStatus == 'UNAVAILABLE' ||
      interruptionReason == 'LOCATION_SERVICES_DISABLED' ||
      interruptionReason == 'LOCATION_PERMISSION_REVOKED';

  bool get isStaleFlag => isStale || locationStatus == 'STALE';

  bool get isCellTower =>
      locationSource == 'CELL_TOWER' ||
      locationSource == 'CELL_NETWORK';

  bool get isNetwork =>
      locationSource == 'NETWORK' ||
      locationSource == 'ANDROID_NETWORK';

  bool get isLastKnown =>
      locationSource == 'LAST_KNOWN' ||
      locationStatus == 'STALE' ||
      isStale;

  bool get isGps =>
      (locationSource == 'GPS' || locationSource == null) &&
      !isCellTower &&
      !isNetwork &&
      !isLastKnown &&
      !isUnavailable;

  factory LiveEmployeeLocation.fromJson(Map<String, dynamic> json) {
    final lat = (json['last_latitude'] as num?)?.toDouble() ??
        (json['latitude'] as num?)?.toDouble() ??
        (json['check_in_lat'] as num?)?.toDouble();
    final lng = (json['last_longitude'] as num?)?.toDouble() ??
        (json['longitude'] as num?)?.toDouble() ??
        (json['check_in_lng'] as num?)?.toDouble();
    final acc = (json['last_accuracy'] as num?)?.toDouble() ??
        (json['accuracy'] as num?)?.toDouble() ??
        (json['provider_accuracy'] as num?)?.toDouble();
    final spd = (json['last_speed'] as num?)?.toDouble();

    final isGpsOff = json['is_gps_off'] == 1 ||
        json['is_gps_off'] == true ||
        json['last_is_gps_off'] == 1 ||
        json['last_is_gps_off'] == true ||
        json['last_location_services_enabled'] == 0 ||
        json['last_location_services_enabled'] == false ||
        json['interruption_reason'] == 'LOCATION_SERVICES_DISABLED' ||
        json['location_status'] == 'UNAVAILABLE';

    final isStale = json['is_stale'] == 1 ||
        json['is_stale'] == true ||
        json['location_status'] == 'STALE';

    return LiveEmployeeLocation(
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id'].toString()) ?? 0,
      fullName: json['full_name'] ?? json['employee_name'] ?? 'Employee',
      email: json['email'] ?? '',
      department: json['department'],
      phone: json['phone'],
      attendanceId: json['attendance_id'] != null ? int.tryParse(json['attendance_id'].toString()) : null,
      attendanceStatus: json['attendance_status'],
      checkInTime: json['check_in_time'] != null ? DateTime.tryParse(json['check_in_time'].toString())?.toLocal() : null,
      checkInAddress: json['check_in_address'],
      lastLatitude: lat,
      lastLongitude: lng,
      lastAccuracy: acc,
      lastSpeed: spd,
      isGpsOff: isGpsOff,
      isMocked: json['last_is_mocked'] == 1 || json['last_is_mocked'] == true,
      lastLocationTime: (json['last_location_time'] ?? json['last_update_time']) != null
          ? DateTime.tryParse((json['last_location_time'] ?? json['last_update_time']).toString())?.toLocal()
          : null,
      locationSource: json['last_location_source']?.toString() ?? json['location_source']?.toString(),
      locationStatus: json['location_status']?.toString(),
      cellNetworkType: json['cell_network_type']?.toString(),
      providerAccuracy: (json['provider_accuracy'] as num?)?.toDouble(),
      interruptionReason: json['interruption_reason']?.toString(),
      isStale: isStale,
      staleDurationMinutes: (json['stale_duration_minutes'] as num?)?.toInt(),
      appVersion: json['user_app_version']?.toString() ?? json['app_version']?.toString(),
      batteryPercentage: (json['last_battery_percentage'] as num?)?.toInt() ?? (json['battery_percentage'] as num?)?.toInt(),
      networkStatus: json['last_network_status']?.toString() ?? json['network_status']?.toString(),
      officeName: json['office_name']?.toString(),
      distanceFromOffice: (json['distance_from_office'] as num?)?.toDouble(),
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
      timestamp: (DateTime.tryParse(json['timestamp']?.toString() ?? '') ?? DateTime.now()).toLocal(),
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
      createdAt: _parseUtcToLocal(json['created_at']),
    );
  }

  static DateTime _parseUtcToLocal(dynamic raw) {
    if (raw == null) return DateTime.now();
    String str = raw.toString().trim();
    if (str.isEmpty) return DateTime.now();
    if (str.contains(' ') && !str.contains('T')) {
      str = str.replaceFirst(' ', 'T');
    }
    if (!str.endsWith('Z') && !str.contains('+') && !str.substring(str.length > 10 ? 10 : 0).contains('-')) {
      str = '${str}Z';
    }
    return (DateTime.tryParse(str) ?? DateTime.now()).toLocal();
  }
}
