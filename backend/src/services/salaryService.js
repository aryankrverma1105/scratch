const db = require('../db');
const { getLeaveYear, isSunday } = require('../utils/leaveUtils');
const { getCompanyDate } = require('../utils/timeUtils');
const { logActivity } = require('./activityLogger');

/**
 * Standard rounding to 2 decimal places.
 */
function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

/**
 * Get all dates in a month YYYY-MM
 * @param {string} monthStr YYYY-MM
 * @returns {string[]} Array of YYYY-MM-DD
 */
function getDatesInMonth(monthStr) {
  const [yearStr, moStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(moStr, 10);
  const lastDay = new Date(year, month, 0).getDate();
  const dates = [];
  for (let d = 1; d <= lastDay; d++) {
    const dayStr = String(d).padStart(2, '0');
    dates.push(`${monthStr}-${dayStr}`);
  }
  return dates;
}

/**
 * Get common salary settings
 */
async function getSalarySettings() {
  let settings = await db.get('SELECT * FROM salary_settings ORDER BY id ASC LIMIT 1');
  if (!settings) {
    await db.run('INSERT INTO salary_settings (common_daily_wage) VALUES (650.0)');
    settings = await db.get('SELECT * FROM salary_settings ORDER BY id ASC LIMIT 1');
  }
  return settings;
}

/**
 * Update common daily wage rate
 */
async function updateSalarySettings(commonDailyWage, userId) {
  const wage = parseFloat(commonDailyWage);
  if (isNaN(wage) || wage < 0) {
    throw new Error('Invalid common daily wage amount');
  }
  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE salary_settings
     SET common_daily_wage = ?, updated_by = ?, updated_at = ?
     WHERE id = (SELECT id FROM salary_settings ORDER BY id ASC LIMIT 1)`,
    [wage, userId, nowIso]
  );
  await logActivity({
    userId,
    action: 'COMMON_DAILY_WAGE_UPDATED',
    entityType: 'salary_settings',
    details: `Updated common daily wage rate to ₹${wage}`,
  });
  return getSalarySettings();
}

/**
 * Get an employee's salary configuration
 */
async function getEmployeeSalaryConfig(userId) {
  const config = await db.get(
    `SELECT sc.*, u.full_name, u.email, u.role, u.department
     FROM employee_salary_configs sc
     JOIN users u ON sc.user_id = u.id
     WHERE sc.user_id = ?`,
    [userId]
  );
  return config;
}

/**
 * Upsert an employee's salary configuration
 */
async function upsertEmployeeSalaryConfig({
  userId,
  salaryType,
  monthlyBasicSalary = 0,
  dailyWageOverride = null,
  effectiveDate,
  remarks,
  createdBy,
}) {
  if (!['daily_wage', 'fixed_monthly'].includes(salaryType)) {
    throw new Error("Invalid salary type. Must be 'daily_wage' or 'fixed_monthly'");
  }
  if (!effectiveDate) {
    effectiveDate = getCompanyDate();
  }

  const user = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) {
    throw new Error('Employee not found');
  }

  const nowIso = new Date().toISOString();
  const existing = await db.get('SELECT id FROM employee_salary_configs WHERE user_id = ?', [userId]);

  if (existing) {
    await db.run(
      `UPDATE employee_salary_configs
       SET salary_type = ?, monthly_basic_salary = ?, daily_wage_override = ?,
           effective_date = ?, remarks = ?, created_by = ?, updated_at = ?
       WHERE user_id = ?`,
      [
        salaryType,
        parseFloat(monthlyBasicSalary) || 0,
        dailyWageOverride !== null && dailyWageOverride !== undefined && dailyWageOverride !== ''
          ? parseFloat(dailyWageOverride)
          : null,
        effectiveDate,
        remarks || null,
        createdBy,
        nowIso,
        userId,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO employee_salary_configs (user_id, salary_type, monthly_basic_salary, daily_wage_override, effective_date, remarks, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        salaryType,
        parseFloat(monthlyBasicSalary) || 0,
        dailyWageOverride !== null && dailyWageOverride !== undefined && dailyWageOverride !== ''
          ? parseFloat(dailyWageOverride)
          : null,
        effectiveDate,
        remarks || null,
        createdBy,
        nowIso,
      ]
    );
  }

  return getEmployeeSalaryConfig(userId);
}

/**
 * Calculate attendance metrics for an employee in a given month (YYYY-MM).
 * Reads attendance, confirmed leaves, absences, company holidays, Sundays, joining & exit dates.
 */
async function getAttendanceMetricsForMonth(userId, monthStr) {
  const user = await db.get('SELECT id, joining_date, exit_date FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('User not found');

  const monthDates = getDatesInMonth(monthStr);
  const leaveYear = getLeaveYear(monthDates[0]);

  // Fetch holidays in this month
  const holidays = await db.query(
    `SELECT date, name FROM company_holidays
     WHERE leave_year = ? AND date LIKE ? AND is_active = 1`,
    [leaveYear, `${monthStr}%`]
  );
  const holidayDates = new Set(holidays.map((h) => h.date));

  // Determine working calendar days in the month (excluding Sundays & Holidays)
  const workingCalendarDates = [];
  for (const dt of monthDates) {
    if (!isSunday(dt) && !holidayDates.has(dt)) {
      workingCalendarDates.push(dt);
    }
  }
  const totalWorkingDays = workingCalendarDates.length;

  // Filter for employment bounds
  const activeWorkingDates = workingCalendarDates.filter((dt) => {
    if (user.joining_date && dt < user.joining_date) return false;
    if (user.exit_date && dt > user.exit_date) return false;
    return true;
  });

  // Get attendance records for this user in this month
  const attendanceRows = await db.query(
    `SELECT date, status FROM attendance
     WHERE user_id = ? AND date LIKE ?`,
    [userId, `${monthStr}%`]
  );
  const presentDates = new Set(
    attendanceRows
      .filter((r) => r.status === 'checked_out' || r.status === 'checked_in')
      .map((r) => r.date)
  );

  // Get confirmed leaves in this month
  const confirmedLeaves = await db.query(
    `SELECT start_date, end_date, working_days, days_deducted FROM leave_records
     WHERE user_id = ? AND status = 'confirmed'
       AND (start_date <= ? AND end_date >= ?)`,
    [userId, `${monthStr}-31`, `${monthStr}-01`]
  );

  const paidLeaveDates = new Set();
  for (const lr of confirmedLeaves) {
    const dates = getDatesInMonth(monthStr).filter(
      (d) => d >= lr.start_date && d <= lr.end_date && !isSunday(d) && !holidayDates.has(d)
    );
    for (const d of dates) {
      paidLeaveDates.add(d);
    }
  }

  // Get absences in this month
  const absences = await db.query(
    `SELECT date, absence_type FROM attendance_absences
     WHERE user_id = ? AND date LIKE ?`,
    [userId, `${monthStr}%`]
  );
  const unpaidAbsenceDates = new Set();
  for (const abs of absences) {
    if (abs.absence_type === 'unpaid') {
      unpaidAbsenceDates.add(abs.date);
    } else if (abs.absence_type === 'earned_leave_deducted') {
      paidLeaveDates.add(abs.date);
    }
  }

  // Calculate day counts
  let presentDaysCount = 0;
  let paidLeaveDaysCount = 0;
  let absentDaysCount = 0;

  for (const dt of activeWorkingDates) {
    if (presentDates.has(dt)) {
      presentDaysCount += 1;
    } else if (paidLeaveDates.has(dt)) {
      paidLeaveDaysCount += 1;
    } else {
      absentDaysCount += 1;
    }
  }

  const payableDays = presentDaysCount + paidLeaveDaysCount;

  return {
    totalWorkingDays, // total possible working days in month (standard calendar)
    activeWorkingDays: activeWorkingDates.length,
    presentDays: presentDaysCount,
    paidLeaveDays: paidLeaveDaysCount,
    payableDays,
    absentDays: absentDaysCount,
    holidayDates: Array.from(holidayDates),
  };
}

/**
 * Calculate salary for a single employee for a given month (YYYY-MM).
 * Server-side source of truth.
 */
async function calculateSalaryForEmployee(userId, monthStr) {
  const user = await db.get('SELECT id, full_name, email, role, department FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('Employee not found');

  const settings = await getSalarySettings();
  let empConfig = await db.get('SELECT * FROM employee_salary_configs WHERE user_id = ?', [userId]);

  // Default to daily_wage if not configured
  if (!empConfig) {
    empConfig = {
      salary_type: 'daily_wage',
      monthly_basic_salary: 0,
      daily_wage_override: null,
    };
  }

  const attendanceMetrics = await getAttendanceMetricsForMonth(userId, monthStr);

  // Fetch approved daily incentives in this month
  const incentives = await db.query(
    `SELECT SUM(amount) as total FROM daily_incentives
     WHERE user_id = ? AND date LIKE ? AND status = 'approved'`,
    [userId, `${monthStr}%`]
  );
  const incentiveSalary = round2(incentives[0]?.total || 0);

  // Fetch approved overtime in this month
  const overtimes = await db.query(
    `SELECT SUM(hours) as total_hours, SUM(amount) as total_amount
     FROM overtime_records
     WHERE user_id = ? AND date LIKE ? AND status = 'approved'`,
    [userId, `${monthStr}%`]
  );
  const overtimeHours = round2(overtimes[0]?.total_hours || 0);
  const overtimeAmount = round2(overtimes[0]?.total_amount || 0);

  let basicSalary = 0;
  let grossSalary = 0;
  let employeeEpf = 0;
  let employeeEsic = 0;
  let totalDeductions = 0;
  let gratuityDeduction = 0;
  let netSalary = 0;
  let employerEpf = 0;
  let employerEsic = 0;
  let ctc = 0;
  let baseRate = 0;
  let excessAbsentDays = 0;

  if (empConfig.salary_type === 'daily_wage') {
    // Daily-Wage Formula
    const dailyWage = empConfig.daily_wage_override !== null && empConfig.daily_wage_override !== undefined
      ? parseFloat(empConfig.daily_wage_override)
      : parseFloat(settings.common_daily_wage);

    baseRate = dailyWage;
    basicSalary = round2(dailyWage * attendanceMetrics.payableDays);
    grossSalary = round2(basicSalary + incentiveSalary + overtimeAmount);

    // Employee Deductions
    employeeEpf = round2(basicSalary * 0.12); // 12%
    employeeEsic = round2(basicSalary * 0.0075); // 0.75%
    totalDeductions = round2(employeeEpf + employeeEsic);
    netSalary = round2(grossSalary - totalDeductions);

    // Employer Contributions
    employerEpf = round2(basicSalary * 0.12); // 12%
    employerEsic = round2(basicSalary * 0.0325); // 3.25%
    ctc = round2(grossSalary + employerEpf + employerEsic);
  } else {
    // Fixed Monthly Salary Formula
    const monthlyBasic = parseFloat(empConfig.monthly_basic_salary) || 0;
    baseRate = monthlyBasic;

    const totalWorkingDays = attendanceMetrics.totalWorkingDays || 26;
    const dailySalary = totalWorkingDays > 0 ? (monthlyBasic / totalWorkingDays) : 0;

    // Step 2 & 3: Excess absent days (allowed 2 days)
    excessAbsentDays = Math.max(attendanceMetrics.absentDays - 2, 0);
    const absenceDeduction = round2(dailySalary * excessAbsentDays);

    // Step 4: Gross Salary
    grossSalary = round2(monthlyBasic - absenceDeduction);

    // Step 5: Company-Specified 5% Deduction (Gratuity Deduction) on original basic salary
    gratuityDeduction = round2(monthlyBasic * 0.05);
    totalDeductions = gratuityDeduction;

    // Step 6: Net Salary
    netSalary = round2(grossSalary - gratuityDeduction);

    // No EPF/ESIC for fixed monthly formula
    employeeEpf = 0;
    employeeEsic = 0;
    employerEpf = 0;
    employerEsic = 0;
    ctc = grossSalary;
  }

  return {
    userId: user.id,
    fullName: user.full_name,
    email: user.email,
    department: user.department,
    payrollPeriod: monthStr,
    salaryType: empConfig.salary_type,
    baseRate,
    totalWorkingDays: attendanceMetrics.totalWorkingDays,
    presentDays: attendanceMetrics.presentDays,
    paidLeaveDays: attendanceMetrics.paidLeaveDays,
    payableDays: attendanceMetrics.payableDays,
    absentDays: attendanceMetrics.absentDays,
    excessAbsentDays,
    basicSalary,
    incentiveSalary,
    overtimeHours,
    overtimeAmount,
    grossSalary,
    employeeEpf,
    employeeEsic,
    totalDeductions,
    gratuityDeduction,
    netSalary,
    employerEpf,
    employerEsic,
    ctc,
    attendanceSnapshot: attendanceMetrics,
  };
}

/**
 * Preview payroll calculations for all active employees for a given month.
 */
async function previewPayrollForMonth(monthStr) {
  const users = await db.query('SELECT id, full_name, email, role, is_active FROM users WHERE is_active = 1 ORDER BY id ASC');
  const results = [];
  for (const u of users) {
    try {
      const calc = await calculateSalaryForEmployee(u.id, monthStr);
      results.push(calc);
    } catch (err) {
      console.error(`Error calculating salary for user ${u.id}:`, err.message);
    }
  }
  return results;
}

/**
 * Finalize and lock a payroll period.
 * Saves immutable snapshot of all payroll records in a transaction.
 */
async function finalizePayroll(monthStr, adminUserId, notes = '') {
  return await db.withTransaction(async (tx) => {
    // Check if already finalized
    const period = await tx.get('SELECT * FROM payroll_periods WHERE month = ?', [monthStr]);
    if (period && period.status === 'finalized') {
      throw new Error(`Payroll for period ${monthStr} is already finalized and locked.`);
    }

    const calculations = await previewPayrollForMonth(monthStr);
    const nowIso = new Date().toISOString();

    // Create or update period
    if (period) {
      await tx.run(
        `UPDATE payroll_periods
         SET status = 'finalized', finalized_by = ?, finalized_at = ?, notes = ?
         WHERE month = ?`,
        [adminUserId, nowIso, notes, monthStr]
      );
    } else {
      await tx.run(
        `INSERT INTO payroll_periods (month, status, finalized_by, finalized_at, notes, created_at)
         VALUES (?, 'finalized', ?, ?, ?, ?)`,
        [monthStr, adminUserId, nowIso, notes, nowIso]
      );
    }

    // Insert or update payroll_records
    for (const c of calculations) {
      const existing = await tx.get(
        'SELECT id, status FROM payroll_records WHERE payroll_period = ? AND user_id = ?',
        [monthStr, c.userId]
      );

      const snapshotStr = JSON.stringify(c.attendanceSnapshot);

      if (existing) {
        await tx.run(
          `UPDATE payroll_records
           SET salary_type = ?, base_rate = ?, total_working_days = ?, present_days = ?,
               paid_leave_days = ?, payable_days = ?, absent_days = ?, excess_absent_days = ?,
               basic_salary = ?, incentive_salary = ?, overtime_hours = ?, overtime_amount = ?,
               gross_salary = ?, employee_epf = ?, employee_esic = ?, total_employee_deductions = ?,
               gratuity_deduction = ?, net_salary = ?, employer_epf = ?, employer_esic = ?,
               ctc = ?, status = 'finalized', attendance_snapshot = ?, updated_at = ?
           WHERE id = ?`,
          [
            c.salaryType,
            c.baseRate,
            c.totalWorkingDays,
            c.presentDays,
            c.paidLeaveDays,
            c.payableDays,
            c.absentDays,
            c.excessAbsentDays,
            c.basicSalary,
            c.incentiveSalary,
            c.overtimeHours,
            c.overtimeAmount,
            c.grossSalary,
            c.employeeEpf,
            c.employeeEsic,
            c.totalDeductions,
            c.gratuityDeduction,
            c.netSalary,
            c.employerEpf,
            c.employerEsic,
            c.ctc,
            snapshotStr,
            nowIso,
            existing.id,
          ]
        );
      } else {
        await tx.run(
          `INSERT INTO payroll_records (
             payroll_period, user_id, salary_type, base_rate, total_working_days,
             present_days, paid_leave_days, payable_days, absent_days, excess_absent_days,
             basic_salary, incentive_salary, overtime_hours, overtime_amount, gross_salary,
             employee_epf, employee_esic, total_employee_deductions, gratuity_deduction,
             net_salary, employer_epf, employer_esic, ctc, status, attendance_snapshot,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'finalized', ?, ?, ?)`,
          [
            monthStr,
            c.userId,
            c.salaryType,
            c.baseRate,
            c.totalWorkingDays,
            c.presentDays,
            c.paidLeaveDays,
            c.payableDays,
            c.absentDays,
            c.excessAbsentDays,
            c.basicSalary,
            c.incentiveSalary,
            c.overtimeHours,
            c.overtimeAmount,
            c.grossSalary,
            c.employeeEpf,
            c.employeeEsic,
            c.totalDeductions,
            c.gratuityDeduction,
            c.netSalary,
            c.employerEpf,
            c.employerEsic,
            c.ctc,
            snapshotStr,
            nowIso,
            nowIso,
          ]
        );
      }
    }

    await logActivity({
      userId: adminUserId,
      action: 'PAYROLL_FINALIZED',
      entityType: 'payroll_period',
      entityId: monthStr,
      details: `Finalized and locked payroll for ${monthStr} (${calculations.length} employee records)`,
    });

    return {
      message: `Payroll for period ${monthStr} successfully finalized and locked.`,
      recordsCount: calculations.length,
    };
  });
}

/**
 * Generate CSV formatted data matching the user's Google Sheet template:
 * S.No. | Name of Employees | No. of Days Present | No. of Days Absent | EPFO | ESIC | Advance | Daily rate of wage | Over time | Net Salary | Salary Deductions | Net Salary Payable | CTC | Remaining Advance | Paid Leave
 */
async function generatePayrollCsv(monthStr) {
  const calculations = await previewPayrollForMonth(monthStr);

  const headers = [
    'S.No.',
    'Name of Employees',
    'No. of Days Present',
    'No. of Days Absent',
    'EPFO',
    'ESIC',
    'Advance',
    'Daily rate of wage',
    'Over time',
    'Net Salary',
    'Salary Deductions',
    'Net Salary Payable',
    'CTC',
    'Remaining Advance',
    'Paid Leave',
  ];

  const rows = [headers.join(',')];

  calculations.forEach((c, idx) => {
    const row = [
      idx + 1,
      `"${c.fullName.replace(/"/g, '""')}"`,
      c.presentDays,
      c.absentDays,
      c.employeeEpf || 0,
      c.employeeEsic || 0,
      0, // Advance
      c.baseRate,
      c.overtimeAmount || 0,
      c.grossSalary,
      c.totalDeductions,
      c.netSalary,
      c.ctc,
      0, // Remaining advance
      c.paidLeaveDays,
    ];
    rows.push(row.join(','));
  });

  return rows.join('\n');
}

module.exports = {
  round2,
  getSalarySettings,
  updateSalarySettings,
  getEmployeeSalaryConfig,
  upsertEmployeeSalaryConfig,
  getAttendanceMetricsForMonth,
  calculateSalaryForEmployee,
  previewPayrollForMonth,
  finalizePayroll,
  generatePayrollCsv,
};
