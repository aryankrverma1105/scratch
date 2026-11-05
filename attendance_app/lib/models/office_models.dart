import 'dart:convert';

class OfficeModel {
  final int id;
  final String officeName;
  final String? address;
  final double latitude;
  final double longitude;
  final double radiusMeters;
  final String? description;
  final String status;
  final List<String> assignedDepartments;
  final List<int> assignedUserIds;
  final String? createdAt;
  final String? updatedAt;

  OfficeModel({
    required this.id,
    required this.officeName,
    this.address,
    required this.latitude,
    required this.longitude,
    required this.radiusMeters,
    this.description,
    required this.status,
    this.assignedDepartments = const [],
    this.assignedUserIds = const [],
    this.createdAt,
    this.updatedAt,
  });

  bool get isActive => status.toLowerCase() == 'active';

  factory OfficeModel.fromJson(Map<String, dynamic> json) {
    List<String> depts = [];
    if (json['assigned_departments'] is List) {
      depts = (json['assigned_departments'] as List).map((e) => e.toString()).toList();
    } else if (json['assigned_departments'] is String && json['assigned_departments'].isNotEmpty) {
      try {
        final decoded = jsonDecode(json['assigned_departments']);
        if (decoded is List) depts = decoded.map((e) => e.toString()).toList();
      } catch (_) {}
    }

    List<int> userIds = [];
    if (json['assigned_user_ids'] is List) {
      userIds = (json['assigned_user_ids'] as List).map((e) => int.tryParse(e.toString()) ?? 0).where((i) => i > 0).toList();
    } else if (json['assigned_user_ids'] is String && json['assigned_user_ids'].isNotEmpty) {
      try {
        final decoded = jsonDecode(json['assigned_user_ids']);
        if (decoded is List) {
          userIds = decoded.map((e) => int.tryParse(e.toString()) ?? 0).where((i) => i > 0).toList();
        }
      } catch (_) {}
    }

    return OfficeModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      officeName: json['office_name'] ?? json['name'] ?? 'Unnamed Office',
      address: json['address'],
      latitude: (json['latitude'] is num) ? (json['latitude'] as num).toDouble() : double.tryParse(json['latitude']?.toString() ?? '0') ?? 0.0,
      longitude: (json['longitude'] is num) ? (json['longitude'] as num).toDouble() : double.tryParse(json['longitude']?.toString() ?? '0') ?? 0.0,
      radiusMeters: (json['radius_meters'] is num) ? (json['radius_meters'] as num).toDouble() : double.tryParse(json['radius_meters']?.toString() ?? '100') ?? 100.0,
      description: json['description'],
      status: json['status'] ?? 'active',
      assignedDepartments: depts,
      assignedUserIds: userIds,
      createdAt: json['created_at'],
      updatedAt: json['updated_at'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'office_name': officeName,
      'address': address,
      'latitude': latitude,
      'longitude': longitude,
      'radius_meters': radiusMeters,
      'description': description,
      'status': status,
      'assigned_departments': assignedDepartments,
      'assigned_user_ids': assignedUserIds,
    };
  }
}

class AttendanceReviewModel {
  final int id;
  final int employeeId;
  final String? employeeName;
  final String? department;
  final String? checkInTime;
  final String? checkInTimeIst;
  final double? submittedLatitude;
  final double? submittedLongitude;
  final double? distanceFromOffice;
  final double? accuracyMeters;
  final String? locationSource;
  final int? batteryPercentage;
  final String? networkStatus;
  final int? officeId;
  final String? officeName;
  final double? officeRadius;
  final String? selfiePath;
  final String reviewStatus;
  final String? reviewReason;
  final String? outsideReason;
  final String? createdAt;

  AttendanceReviewModel({
    required this.id,
    required this.employeeId,
    this.employeeName,
    this.department,
    this.checkInTime,
    this.checkInTimeIst,
    this.submittedLatitude,
    this.submittedLongitude,
    this.distanceFromOffice,
    this.accuracyMeters,
    this.locationSource,
    this.batteryPercentage,
    this.networkStatus,
    this.officeId,
    this.officeName,
    this.officeRadius,
    this.selfiePath,
    required this.reviewStatus,
    this.reviewReason,
    this.outsideReason,
    this.createdAt,
  });

  bool get isPending => reviewStatus == 'pending_review';
  bool get isApproved => reviewStatus == 'approved';
  bool get isRejected => reviewStatus == 'rejected';

  factory AttendanceReviewModel.fromJson(Map<String, dynamic> json) {
    return AttendanceReviewModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      employeeId: json['employee_id'] is int ? json['employee_id'] : int.tryParse(json['employee_id'].toString()) ?? 0,
      employeeName: json['employee_name'] ?? json['full_name'],
      department: json['department'],
      checkInTime: json['check_in_time'],
      checkInTimeIst: json['check_in_time_ist'],
      submittedLatitude: json['submitted_latitude'] != null ? double.tryParse(json['submitted_latitude'].toString()) : null,
      submittedLongitude: json['submitted_longitude'] != null ? double.tryParse(json['submitted_longitude'].toString()) : null,
      distanceFromOffice: json['distance_from_office'] != null ? double.tryParse(json['distance_from_office'].toString()) : null,
      accuracyMeters: json['accuracy_meters'] != null ? double.tryParse(json['accuracy_meters'].toString()) : null,
      locationSource: json['location_source'],
      batteryPercentage: json['battery_percentage'] != null ? int.tryParse(json['battery_percentage'].toString()) : null,
      networkStatus: json['network_status'],
      officeId: json['office_id'] != null ? int.tryParse(json['office_id'].toString()) : null,
      officeName: json['office_name'],
      officeRadius: json['office_radius'] != null ? double.tryParse(json['office_radius'].toString()) : null,
      selfiePath: json['selfie_path'],
      reviewStatus: json['review_status'] ?? 'pending_review',
      reviewReason: json['review_reason'],
      outsideReason: json['outside_reason'],
      createdAt: json['created_at'],
    );
  }
}

