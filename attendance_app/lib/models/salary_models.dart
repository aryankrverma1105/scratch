class SalarySettingsModel {
  final double commonDailyWage;
  final String? updatedAt;

  SalarySettingsModel({
    required this.commonDailyWage,
    this.updatedAt,
  });

  factory SalarySettingsModel.fromJson(Map<String, dynamic> json) {
    return SalarySettingsModel(
      commonDailyWage: (json['common_daily_wage'] is num)
          ? (json['common_daily_wage'] as num).toDouble()
          : double.tryParse(json['common_daily_wage']?.toString() ?? '0') ?? 0.0,
      updatedAt: json['updated_at']?.toString(),
    );
  }
}

class EmployeeSalaryConfigModel {
  final int userId;
  final String fullName;
  final String email;
  final String? role;
  final String? department;
  final String salaryType; // 'daily_wage' | 'fixed_monthly'
  final double monthlyBasicSalary;
  final double? dailyWageOverride;
  final double dailyIncentiveRate;
  final String? effectiveDate;
  final String? remarks;

  EmployeeSalaryConfigModel({
    required this.userId,
    required this.fullName,
    required this.email,
    this.role,
    this.department,
    required this.salaryType,
    required this.monthlyBasicSalary,
    this.dailyWageOverride,
    this.dailyIncentiveRate = 0.0,
    this.effectiveDate,
    this.remarks,
  });

  factory EmployeeSalaryConfigModel.fromJson(Map<String, dynamic> json) {
    return EmployeeSalaryConfigModel(
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id']?.toString() ?? '0') ?? 0,
      fullName: json['full_name']?.toString() ?? 'Employee',
      email: json['email']?.toString() ?? '',
      role: json['role']?.toString(),
      department: json['department']?.toString(),
      salaryType: json['salary_type']?.toString() ?? 'daily_wage',
      monthlyBasicSalary: (json['monthly_basic_salary'] is num)
          ? (json['monthly_basic_salary'] as num).toDouble()
          : double.tryParse(json['monthly_basic_salary']?.toString() ?? '0') ?? 0.0,
      dailyWageOverride: json['daily_wage_override'] != null
          ? ((json['daily_wage_override'] is num)
              ? (json['daily_wage_override'] as num).toDouble()
              : double.tryParse(json['daily_wage_override'].toString()))
          : null,
      dailyIncentiveRate: (json['daily_incentive_rate'] is num)
          ? (json['daily_incentive_rate'] as num).toDouble()
          : double.tryParse(json['daily_incentive_rate']?.toString() ?? '0') ?? 0.0,
      effectiveDate: json['effective_date']?.toString(),
      remarks: json['remarks']?.toString(),
    );
  }
}

class DailyIncentiveModel {
  final int id;
  final int userId;
  final String? fullName;
  final String? department;
  final String date;
  final double amount;
  final String? description;
  final String status; // 'approved' | 'pending' | 'rejected'
  final String? payrollPeriod;
  final String? createdByName;
  final DateTime createdAt;

  DailyIncentiveModel({
    required this.id,
    required this.userId,
    this.fullName,
    this.department,
    required this.date,
    required this.amount,
    this.description,
    required this.status,
    this.payrollPeriod,
    this.createdByName,
    required this.createdAt,
  });

  factory DailyIncentiveModel.fromJson(Map<String, dynamic> json) {
    DateTime parseDt(dynamic val) {
      if (val == null) return DateTime.now();
      String s = val.toString().trim();
      if (!s.endsWith('Z') && !s.contains('+')) s = '${s}Z';
      return (DateTime.tryParse(s) ?? DateTime.now()).toLocal();
    }

    return DailyIncentiveModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id']?.toString() ?? '0') ?? 0,
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id']?.toString() ?? '0') ?? 0,
      fullName: json['full_name']?.toString(),
      department: json['department']?.toString(),
      date: json['date']?.toString() ?? '',
      amount: (json['amount'] is num)
          ? (json['amount'] as num).toDouble()
          : double.tryParse(json['amount']?.toString() ?? '0') ?? 0.0,
      description: json['description']?.toString(),
      status: json['status']?.toString() ?? 'approved',
      payrollPeriod: json['payroll_period']?.toString(),
      createdByName: json['created_by_name']?.toString(),
      createdAt: parseDt(json['created_at']),
    );
  }
}

class OvertimeRecordModel {
  final int id;
  final int userId;
  final String? fullName;
  final String? department;
  final String date;
  final double hours;
  final double amount;
  final String? remarks;
  final String status;
  final String? payrollPeriod;
  final String? createdByName;
  final DateTime createdAt;

  OvertimeRecordModel({
    required this.id,
    required this.userId,
    this.fullName,
    this.department,
    required this.date,
    required this.hours,
    required this.amount,
    this.remarks,
    required this.status,
    this.payrollPeriod,
    this.createdByName,
    required this.createdAt,
  });

  factory OvertimeRecordModel.fromJson(Map<String, dynamic> json) {
    DateTime parseDt(dynamic val) {
      if (val == null) return DateTime.now();
      String s = val.toString().trim();
      if (!s.endsWith('Z') && !s.contains('+')) s = '${s}Z';
      return (DateTime.tryParse(s) ?? DateTime.now()).toLocal();
    }

    return OvertimeRecordModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id']?.toString() ?? '0') ?? 0,
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id']?.toString() ?? '0') ?? 0,
      fullName: json['full_name']?.toString(),
      department: json['department']?.toString(),
      date: json['date']?.toString() ?? '',
      hours: (json['hours'] is num)
          ? (json['hours'] as num).toDouble()
          : double.tryParse(json['hours']?.toString() ?? '0') ?? 0.0,
      amount: (json['amount'] is num)
          ? (json['amount'] as num).toDouble()
          : double.tryParse(json['amount']?.toString() ?? '0') ?? 0.0,
      remarks: json['remarks']?.toString(),
      status: json['status']?.toString() ?? 'approved',
      payrollPeriod: json['payroll_period']?.toString(),
      createdByName: json['created_by_name']?.toString(),
      createdAt: parseDt(json['created_at']),
    );
  }
}

class SalaryCalculationModel {
  final int userId;
  final String fullName;
  final String email;
  final String? department;
  final String payrollPeriod;
  final String salaryType; // 'daily_wage' | 'fixed_monthly'
  final double baseRate;
  final double totalWorkingDays;
  final double presentDays;
  final double paidLeaveDays;
  final double payableDays;
  final double absentDays;
  final double excessAbsentDays;
  final double basicSalary;
  final double incentiveSalary;
  final double overtimeHours;
  final double overtimeAmount;
  final double grossSalary;
  final double employeeEpf;
  final double employeeEsic;
  final double totalDeductions;
  final double gratuityDeduction;
  final double netSalary;
  final double employerEpf;
  final double employerEsic;
  final double ctc;
  final bool isFinalized;

  SalaryCalculationModel({
    required this.userId,
    required this.fullName,
    required this.email,
    this.department,
    required this.payrollPeriod,
    required this.salaryType,
    required this.baseRate,
    required this.totalWorkingDays,
    required this.presentDays,
    required this.paidLeaveDays,
    required this.payableDays,
    required this.absentDays,
    required this.excessAbsentDays,
    required this.basicSalary,
    required this.incentiveSalary,
    required this.overtimeHours,
    required this.overtimeAmount,
    required this.grossSalary,
    required this.employeeEpf,
    required this.employeeEsic,
    required this.totalDeductions,
    required this.gratuityDeduction,
    required this.netSalary,
    required this.employerEpf,
    required this.employerEsic,
    required this.ctc,
    this.isFinalized = false,
  });

  factory SalaryCalculationModel.fromJson(Map<String, dynamic> json) {
    double toDbl(dynamic val) {
      if (val == null) return 0.0;
      if (val is num) return val.toDouble();
      return double.tryParse(val.toString()) ?? 0.0;
    }

    return SalaryCalculationModel(
      userId: json['userId'] is int
          ? json['userId']
          : json['user_id'] is int
              ? json['user_id']
              : int.tryParse((json['userId'] ?? json['user_id'])?.toString() ?? '0') ?? 0,
      fullName: json['fullName']?.toString() ?? json['full_name']?.toString() ?? 'Employee',
      email: json['email']?.toString() ?? '',
      department: json['department']?.toString(),
      payrollPeriod: json['payrollPeriod']?.toString() ?? json['payroll_period']?.toString() ?? '',
      salaryType: json['salaryType']?.toString() ?? json['salary_type']?.toString() ?? 'daily_wage',
      baseRate: toDbl(json['baseRate'] ?? json['base_rate']),
      totalWorkingDays: toDbl(json['totalWorkingDays'] ?? json['total_working_days']),
      presentDays: toDbl(json['presentDays'] ?? json['present_days']),
      paidLeaveDays: toDbl(json['paidLeaveDays'] ?? json['paid_leave_days']),
      payableDays: toDbl(json['payableDays'] ?? json['payable_days']),
      absentDays: toDbl(json['absentDays'] ?? json['absent_days']),
      excessAbsentDays: toDbl(json['excessAbsentDays'] ?? json['excess_absent_days']),
      basicSalary: toDbl(json['basicSalary'] ?? json['basic_salary']),
      incentiveSalary: toDbl(json['incentiveSalary'] ?? json['incentive_salary']),
      overtimeHours: toDbl(json['overtimeHours'] ?? json['overtime_hours']),
      overtimeAmount: toDbl(json['overtimeAmount'] ?? json['overtime_amount']),
      grossSalary: toDbl(json['grossSalary'] ?? json['gross_salary']),
      employeeEpf: toDbl(json['employeeEpf'] ?? json['employee_epf']),
      employeeEsic: toDbl(json['employeeEsic'] ?? json['employee_esic']),
      totalDeductions: toDbl(json['totalDeductions'] ?? json['total_employee_deductions']),
      gratuityDeduction: toDbl(json['gratuityDeduction'] ?? json['gratuity_deduction']),
      netSalary: toDbl(json['netSalary'] ?? json['net_salary']),
      employerEpf: toDbl(json['employerEpf'] ?? json['employer_epf']),
      employerEsic: toDbl(json['employerEsic'] ?? json['employer_esic']),
      ctc: toDbl(json['ctc']),
      isFinalized: json['status'] == 'finalized' || json['isFinalized'] == true,
    );
  }
}

class ActivityLogModel {
  final int id;
  final int? userId;
  final String userName;
  final String role;
  final String action;
  final String? entityType;
  final String? entityId;
  final String? details;
  final String? ipAddress;
  final int? targetUserId;
  final String? targetUserName;
  final DateTime createdAt;

  ActivityLogModel({
    required this.id,
    this.userId,
    required this.userName,
    required this.role,
    required this.action,
    this.entityType,
    this.entityId,
    this.details,
    this.ipAddress,
    this.targetUserId,
    this.targetUserName,
    required this.createdAt,
  });

  factory ActivityLogModel.fromJson(Map<String, dynamic> json) {
    DateTime parseDt(dynamic val) {
      if (val == null) return DateTime.now();
      String s = val.toString().trim();
      if (!s.endsWith('Z') && !s.contains('+')) s = '${s}Z';
      return (DateTime.tryParse(s) ?? DateTime.now()).toLocal();
    }

    return ActivityLogModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id']?.toString() ?? '0') ?? 0,
      userId: json['user_id'] is int ? json['user_id'] : int.tryParse(json['user_id']?.toString() ?? '0'),
      userName: json['user_name']?.toString() ?? 'System',
      role: json['role']?.toString() ?? 'admin',
      action: json['action']?.toString() ?? 'ACTION',
      entityType: json['entity_type']?.toString(),
      entityId: json['entity_id']?.toString(),
      details: json['details']?.toString(),
      ipAddress: json['ip_address']?.toString(),
      targetUserId: json['target_user_id'] is int
          ? json['target_user_id']
          : int.tryParse(json['target_user_id']?.toString() ?? '0'),
      targetUserName: json['target_user_name']?.toString(),
      createdAt: parseDt(json['created_at']),
    );
  }
}
