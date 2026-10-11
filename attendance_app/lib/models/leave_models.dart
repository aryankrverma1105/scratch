class LeaveBalanceModel {
  final int userId;
  final String leaveYear;
  final double accrued;
  final double used;
  final double expired;
  final double balance;
  final List<LeaveAccrualItem> accruals;

  LeaveBalanceModel({
    required this.userId,
    required this.leaveYear,
    required this.accrued,
    required this.used,
    required this.expired,
    required this.balance,
    this.accruals = const [],
  });

  factory LeaveBalanceModel.fromJson(Map<String, dynamic> json) {
    var rawAccruals = json['accruals'];
    List<LeaveAccrualItem> accrualList = [];
    if (rawAccruals is List) {
      accrualList = rawAccruals.map((a) => LeaveAccrualItem.fromJson(a)).toList();
    }

    return LeaveBalanceModel(
      userId: json['userId'] is int ? json['userId'] : int.tryParse(json['userId']?.toString() ?? '0') ?? 0,
      leaveYear: json['leaveYear']?.toString() ?? '',
      accrued: (json['accrued'] as num?)?.toDouble() ?? 0.0,
      used: (json['used'] as num?)?.toDouble() ?? 0.0,
      expired: (json['expired'] as num?)?.toDouble() ?? 0.0,
      balance: (json['balance'] as num?)?.toDouble() ?? 0.0,
      accruals: accrualList,
    );
  }
}

class LeaveAccrualItem {
  final String month;
  final double daysAccrued;
  final String? accruedAt;

  LeaveAccrualItem({
    required this.month,
    required this.daysAccrued,
    this.accruedAt,
  });

  factory LeaveAccrualItem.fromJson(Map<String, dynamic> json) {
    return LeaveAccrualItem(
      month: json['month']?.toString() ?? '',
      daysAccrued: (json['days_accrued'] as num?)?.toDouble() ?? 2.0,
      accruedAt: json['accrued_at']?.toString(),
    );
  }
}

class LeaveRecordModel {
  final int id;
  final int userId;
  final String? userName;
  final String? userEmail;
  final String? department;
  final String leaveYear;
  final String startDate;
  final String endDate;
  final int calendarDays;
  final int workingDays;
  final double daysDeducted;
  final String? reason;
  final String status; // 'confirmed' | 'cancelled'
  final String? cancelledAt;
  final String? cancelledReason;
  final String? createdAt;

  LeaveRecordModel({
    required this.id,
    required this.userId,
    this.userName,
    this.userEmail,
    this.department,
    required this.leaveYear,
    required this.startDate,
    required this.endDate,
    required this.calendarDays,
    required this.workingDays,
    required this.daysDeducted,
    this.reason,
    required this.status,
    this.cancelledAt,
    this.cancelledReason,
    this.createdAt,
  });

  bool get isConfirmed => status.toLowerCase() == 'confirmed';
  bool get isCancelled => status.toLowerCase() == 'cancelled';

  factory LeaveRecordModel.fromJson(Map<String, dynamic> json) {
    return LeaveRecordModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id']?.toString() ?? '0') ?? 0,
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id']?.toString() ?? '0') ?? 0,
      userName: json['full_name']?.toString(),
      userEmail: json['email']?.toString(),
      department: json['department']?.toString(),
      leaveYear: json['leave_year']?.toString() ?? '',
      startDate: json['start_date']?.toString() ?? '',
      endDate: json['end_date']?.toString() ?? '',
      calendarDays: json['calendar_days'] is int ? json['calendar_days'] : int.tryParse(json['calendar_days']?.toString() ?? '0') ?? 0,
      workingDays: json['working_days'] is int ? json['working_days'] : int.tryParse(json['working_days']?.toString() ?? '0') ?? 0,
      daysDeducted: (json['days_deducted'] as num?)?.toDouble() ?? 0.0,
      reason: json['reason']?.toString(),
      status: json['status']?.toString() ?? 'confirmed',
      cancelledAt: json['cancelled_at']?.toString(),
      cancelledReason: json['cancelled_reason']?.toString(),
      createdAt: json['created_at']?.toString(),
    );
  }
}

class AttendanceAbsenceModel {
  final int id;
  final int userId;
  final String? userName;
  final String? userEmail;
  final String? department;
  final String date;
  final String leaveYear;
  final String month;
  final String absenceType; // 'earned_leave_deducted' | 'unpaid'
  final String? reason;
  final bool isCorrected;
  final String? correctedByName;
  final String? correctionNotes;
  final String? createdAt;

  AttendanceAbsenceModel({
    required this.id,
    required this.userId,
    this.userName,
    this.userEmail,
    this.department,
    required this.date,
    required this.leaveYear,
    required this.month,
    required this.absenceType,
    this.reason,
    required this.isCorrected,
    this.correctedByName,
    this.correctionNotes,
    this.createdAt,
  });

  bool get isEarnedLeaveDeducted => absenceType == 'earned_leave_deducted';
  bool get isUnpaid => absenceType == 'unpaid';

  factory AttendanceAbsenceModel.fromJson(Map<String, dynamic> json) {
    return AttendanceAbsenceModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id']?.toString() ?? '0') ?? 0,
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id']?.toString() ?? '0') ?? 0,
      userName: json['full_name']?.toString(),
      userEmail: json['email']?.toString(),
      department: json['department']?.toString(),
      date: json['date']?.toString() ?? '',
      leaveYear: json['leave_year']?.toString() ?? '',
      month: json['month']?.toString() ?? '',
      absenceType: json['absence_type']?.toString() ?? 'unpaid',
      reason: json['reason']?.toString(),
      isCorrected: json['is_corrected'] == 1 || json['is_corrected'] == true,
      correctedByName: json['corrected_by_name']?.toString(),
      correctionNotes: json['correction_notes']?.toString(),
      createdAt: json['created_at']?.toString(),
    );
  }
}

class CompanyHolidayModel {
  final int id;
  final String leaveYear;
  final String name;
  final String date;
  final String? description;
  final bool isActive;

  CompanyHolidayModel({
    required this.id,
    required this.leaveYear,
    required this.name,
    required this.date,
    this.description,
    required this.isActive,
  });

  factory CompanyHolidayModel.fromJson(Map<String, dynamic> json) {
    return CompanyHolidayModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id']?.toString() ?? '0') ?? 0,
      leaveYear: json['leave_year']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      date: json['date']?.toString() ?? '',
      description: json['description']?.toString(),
      isActive: json['is_active'] == 1 || json['is_active'] == true,
    );
  }
}

class HolidaysResponseModel {
  final String leaveYear;
  final int count;
  final int target;
  final bool isComplete;
  final String? warning;
  final List<CompanyHolidayModel> holidays;

  HolidaysResponseModel({
    required this.leaveYear,
    required this.count,
    required this.target,
    required this.isComplete,
    this.warning,
    required this.holidays,
  });

  factory HolidaysResponseModel.fromJson(Map<String, dynamic> json) {
    var rawList = json['holidays'];
    List<CompanyHolidayModel> holidayList = [];
    if (rawList is List) {
      holidayList = rawList.map((h) => CompanyHolidayModel.fromJson(h)).toList();
    }

    return HolidaysResponseModel(
      leaveYear: json['leaveYear']?.toString() ?? '',
      count: json['count'] is int ? json['count'] : int.tryParse(json['count']?.toString() ?? '0') ?? 0,
      target: json['target'] is int ? json['target'] : int.tryParse(json['target']?.toString() ?? '16') ?? 16,
      isComplete: json['isComplete'] == true,
      warning: json['warning']?.toString(),
      holidays: holidayList,
    );
  }
}

class LeaveCalculationModel {
  final String startDate;
  final String endDate;
  final String leaveYear;
  final int calendarDays;
  final int workingDays;
  final int sundaysCount;
  final int holidaysCount;
  final double daysDeducted;
  final double currentBalance;
  final double balanceAfter;
  final bool isEligible;
  final String? ineligibleReason;

  LeaveCalculationModel({
    required this.startDate,
    required this.endDate,
    required this.leaveYear,
    required this.calendarDays,
    required this.workingDays,
    required this.sundaysCount,
    required this.holidaysCount,
    required this.daysDeducted,
    required this.currentBalance,
    required this.balanceAfter,
    required this.isEligible,
    this.ineligibleReason,
  });

  factory LeaveCalculationModel.fromJson(Map<String, dynamic> json) {
    return LeaveCalculationModel(
      startDate: json['startDate']?.toString() ?? '',
      endDate: json['endDate']?.toString() ?? '',
      leaveYear: json['leaveYear']?.toString() ?? '',
      calendarDays: json['calendarDays'] is int ? json['calendarDays'] : int.tryParse(json['calendarDays']?.toString() ?? '0') ?? 0,
      workingDays: json['workingDays'] is int ? json['workingDays'] : int.tryParse(json['workingDays']?.toString() ?? '0') ?? 0,
      sundaysCount: json['sundaysCount'] is int ? json['sundaysCount'] : int.tryParse(json['sundaysCount']?.toString() ?? '0') ?? 0,
      holidaysCount: json['holidaysCount'] is int ? json['holidaysCount'] : int.tryParse(json['holidaysCount']?.toString() ?? '0') ?? 0,
      daysDeducted: (json['daysDeducted'] as num?)?.toDouble() ?? 0.0,
      currentBalance: (json['currentBalance'] as num?)?.toDouble() ?? 0.0,
      balanceAfter: (json['balanceAfter'] as num?)?.toDouble() ?? 0.0,
      isEligible: json['isEligible'] == true,
      ineligibleReason: json['ineligibleReason']?.toString(),
    );
  }
}

class MonthlyLeaveSummaryModel {
  final String month;
  final String leaveYear;
  final double balance;
  final int missingAttendanceCount;
  final double earnedLeavesAccrued;
  final double earnedLeavesUsed;
  final int automaticAbsenceCount;
  final int unpaidAbsenceCount;
  final double remainingEarnedBalance;
  final bool thresholdExceeded;
  final String thresholdMessage;

  MonthlyLeaveSummaryModel({
    required this.month,
    required this.leaveYear,
    required this.balance,
    required this.missingAttendanceCount,
    required this.earnedLeavesAccrued,
    required this.earnedLeavesUsed,
    required this.automaticAbsenceCount,
    required this.unpaidAbsenceCount,
    required this.remainingEarnedBalance,
    required this.thresholdExceeded,
    required this.thresholdMessage,
  });

  factory MonthlyLeaveSummaryModel.fromJson(Map<String, dynamic> json) {
    final s = json['summary'] as Map<String, dynamic>? ?? {};
    return MonthlyLeaveSummaryModel(
      month: json['month']?.toString() ?? '',
      leaveYear: json['leaveYear']?.toString() ?? '',
      balance: (json['balance'] as num?)?.toDouble() ?? 0.0,
      missingAttendanceCount: s['missing_attendance_count'] is int ? s['missing_attendance_count'] : int.tryParse(s['missing_attendance_count']?.toString() ?? '0') ?? 0,
      earnedLeavesAccrued: (s['earned_leaves_accrued'] as num?)?.toDouble() ?? 0.0,
      earnedLeavesUsed: (s['earned_leaves_used'] as num?)?.toDouble() ?? 0.0,
      automaticAbsenceCount: s['automatic_absence_count'] is int ? s['automatic_absence_count'] : int.tryParse(s['automatic_absence_count']?.toString() ?? '0') ?? 0,
      unpaidAbsenceCount: s['unpaid_absence_count'] is int ? s['unpaid_absence_count'] : int.tryParse(s['unpaid_absence_count']?.toString() ?? '0') ?? 0,
      remainingEarnedBalance: (s['remaining_earned_balance'] as num?)?.toDouble() ?? 0.0,
      thresholdExceeded: json['thresholdExceeded'] == true || s['threshold_exceeded'] == 1,
      thresholdMessage: json['thresholdMessage']?.toString() ?? '',
    );
  }
}

class AdminUserLeaveSummaryModel {
  final int userId;
  final String fullName;
  final String email;
  final String role;
  final String? department;
  final double earnedAccrued;
  final double earnedUsed;
  final double earnedBalance;
  final int monthlyMissingCount;
  final int monthlyAutoAbsences;
  final int monthlyUnpaidAbsences;
  final bool thresholdExceeded;

  AdminUserLeaveSummaryModel({
    required this.userId,
    required this.fullName,
    required this.email,
    required this.role,
    this.department,
    required this.earnedAccrued,
    required this.earnedUsed,
    required this.earnedBalance,
    required this.monthlyMissingCount,
    required this.monthlyAutoAbsences,
    required this.monthlyUnpaidAbsences,
    required this.thresholdExceeded,
  });

  factory AdminUserLeaveSummaryModel.fromJson(Map<String, dynamic> json) {
    return AdminUserLeaveSummaryModel(
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id']?.toString() ?? '0') ?? 0,
      fullName: json['full_name']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      role: json['role']?.toString() ?? 'employee',
      department: json['department']?.toString(),
      earnedAccrued: (json['earned_accrued'] as num?)?.toDouble() ?? 0.0,
      earnedUsed: (json['earned_used'] as num?)?.toDouble() ?? 0.0,
      earnedBalance: (json['earned_balance'] as num?)?.toDouble() ?? 0.0,
      monthlyMissingCount: json['monthly_missing_count'] is int ? json['monthly_missing_count'] : int.tryParse(json['monthly_missing_count']?.toString() ?? '0') ?? 0,
      monthlyAutoAbsences: json['monthly_auto_absences'] is int ? json['monthly_auto_absences'] : int.tryParse(json['monthly_auto_absences']?.toString() ?? '0') ?? 0,
      monthlyUnpaidAbsences: json['monthly_unpaid_absences'] is int ? json['monthly_unpaid_absences'] : int.tryParse(json['monthly_unpaid_absences']?.toString() ?? '0') ?? 0,
      thresholdExceeded: json['threshold_exceeded'] == 1 || json['threshold_exceeded'] == true,
    );
  }
}
