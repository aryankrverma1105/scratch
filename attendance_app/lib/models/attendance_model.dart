class AttendanceRecord {
  final int id;
  final int userId;
  final String date;
  final DateTime checkInTime;
  final double checkInLat;
  final double checkInLng;
  final double? checkInAccuracy;
  final bool checkInIsMocked;
  final String? checkInAddress;
  final String? checkInSelfie;
  final DateTime? checkOutTime;
  final double? checkOutLat;
  final double? checkOutLng;
  final double? checkOutAccuracy;
  final bool checkOutIsMocked;
  final String? checkOutAddress;
  final String? checkOutSelfie;
  final String status; // 'checked_in' | 'checked_out'
  final String? employeeName;
  final String? employeeDepartment;

  AttendanceRecord({
    required this.id,
    required this.userId,
    required this.date,
    required this.checkInTime,
    required this.checkInLat,
    required this.checkInLng,
    this.checkInAccuracy,
    this.checkInIsMocked = false,
    this.checkInAddress,
    this.checkInSelfie,
    this.checkOutTime,
    this.checkOutLat,
    this.checkOutLng,
    this.checkOutAccuracy,
    this.checkOutIsMocked = false,
    this.checkOutAddress,
    this.checkOutSelfie,
    required this.status,
    this.employeeName,
    this.employeeDepartment,
  });

  bool get isCurrentlyCheckedIn => status == 'checked_in';

  Duration? get duration {
    if (checkOutTime != null) {
      return checkOutTime!.difference(checkInTime);
    }
    return DateTime.now().difference(checkInTime);
  }

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) {
    return AttendanceRecord(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id'].toString()) ?? 0,
      date: json['date'] ?? '',
      checkInTime: (DateTime.tryParse(json['check_in_time']?.toString() ?? '') ?? DateTime.now()).toLocal(),
      checkInLat: (json['check_in_lat'] as num?)?.toDouble() ?? 0.0,
      checkInLng: (json['check_in_lng'] as num?)?.toDouble() ?? 0.0,
      checkInAccuracy: (json['check_in_accuracy'] as num?)?.toDouble(),
      checkInIsMocked: json['check_in_is_mocked'] == 1 || json['check_in_is_mocked'] == true,
      checkInAddress: json['check_in_address'],
      checkInSelfie: json['check_in_selfie'],
      checkOutTime: json['check_out_time'] != null
          ? DateTime.tryParse(json['check_out_time'].toString())?.toLocal()
          : null,
      checkOutLat: (json['check_out_lat'] as num?)?.toDouble(),
      checkOutLng: (json['check_out_lng'] as num?)?.toDouble(),
      checkOutAccuracy: (json['check_out_accuracy'] as num?)?.toDouble(),
      checkOutIsMocked: json['check_out_is_mocked'] == 1 || json['check_out_is_mocked'] == true,
      checkOutAddress: json['check_out_address'],
      checkOutSelfie: json['check_out_selfie'],
      status: json['status'] ?? 'checked_in',
      employeeName: json['full_name'],
      employeeDepartment: json['department'],
    );
  }
}
