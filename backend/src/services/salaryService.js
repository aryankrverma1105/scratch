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
 * Get all dates between startDateStr and endDateStr (inclusive)
 * @param {string} startDateStr YYYY-MM-DD
 * @param {string} endDateStr YYYY-MM-DD
 * @returns {string[]} Array of YYYY-MM-DD
 */
function getDatesInDateRange(startDateStr, endDateStr) {
  const dates = [];
  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);

  const current = new Date(Date.UTC(sy, sm - 1, sd, 12, 0, 0));
  const end = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0));

  while (current <= end) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Calculate the salary cycle boundary for any given date in IST.
 * Standard cycle starts on cycleStartDay (default: 3) of month M at 00:00 IST
 * and ends on (cycleStartDay - 1) of month M + 1 (e.g. 3 Nov to 2 Dec).
 */
function getSalaryCycleForDate(dateStr, cycleStartDay = 3) {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);

  let startYear, startMonth;
  let nextCycleYear, nextCycleMonth;

  if (day >= cycleStartDay) {
    startYear = year;
    startMonth = month;
    if (month === 12) {
      nextCycleYear = year + 1;
      nextCycleMonth = 1;
    } else {
      nextCycleYear = year;
      nextCycleMonth = month + 1;
    }
  } else {
    // Falls in cycle that started previous month
    if (month === 1) {
      startYear = year - 1;
      startMonth = 12;
    } else {
      startYear = year;
      startMonth = month - 1;
    }
    nextCycleYear = year;
    nextCycleMonth = month;
  }

  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(cycleStartDay).padStart(2, '0')}`;

  // End date is 1 calendar day before next cycle start date
  const nextStartUtc = new Date(Date.UTC(nextCycleYear, nextCycleMonth - 1, cycleStartDay, 12, 0, 0));
  nextStartUtc.setUTCDate(nextStartUtc.getUTCDate() - 1);
  const endDate = `${nextStartUtc.getUTCFullYear()}-${String(nextStartUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextStartUtc.getUTCDate()).padStart(2, '0')}`;

  const cycleCode = `${startDate}_${endDate}`;
  return {
    cycleCode,
    startDate,
    endDate,
    label: `${startDate} to ${endDate}`,
  };
}

/**
 * Calculate the next salary cycle given a current cycle start date.
 */
function getNextSalaryCycle(currentStartDateStr, cycleStartDay = 3) {
  const [yStr, mStr] = currentStartDateStr.split('-');
  let year = parseInt(yStr, 10);
  let month = parseInt(mStr, 10);

  let nextYear, nextMonth;
  if (month === 12) {
    nextYear = year + 1;
    nextMonth = 1;
  } else {
    nextYear = year;
    nextMonth = month + 1;
  }

  const nextStartDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(cycleStartDay).padStart(2, '0')}`;
  return getSalaryCycleForDate(nextStartDate, cycleStartDay);
}

/**
 * Get common salary settings
 */
async function getSalarySettings() {
  let settings = await db.get('SELECT * FROM salary_settings ORDER BY id ASC LIMIT 1');
  if (!settings) {
    await db.run("INSERT INTO salary_settings (common_daily_wage, official_start_date, cycle_start_day) VALUES (650.0, '2026-11-03', 3)");
    settings = await db.get('SELECT * FROM salary_settings ORDER BY id ASC LIMIT 1');
  }
  return settings;
}

/**
 * Update common salary settings
 */
async function updateSalarySettings(args, userId) {
  let wage, officialStartDate, cycleStartDay;
  if (typeof args === 'object' && args !== null) {
    wage = parseFloat(args.commonDailyWage);
    officialStartDate = args.officialStartDate;
    cycleStartDay = args.cycleStartDay;
  } else {
    wage = parseFloat(args);
  }

  if (isNaN(wage) || wage < 0) {
    throw new Error('Invalid common daily wage amount');
  }

  const current = await getSalarySettings();
  const newStartDate = officialStartDate || current.official_start_date || '2026-11-03';
  const newStartDay = cycleStartDay ? parseInt(cycleStartDay, 10) : (current.cycle_start_day || 3);

  // If changing officialStartDate, ensure finalized payroll is not overwritten
  if (officialStartDate && officialStartDate !== current.official_start_date) {
    const finalized = await db.get("SELECT id FROM salary_cycles WHERE status IN ('finalized', 'paid') LIMIT 1");
    if (finalized) {
      throw new Error('Cannot change official salary start date after payroll has been finalized or paid.');
    }
  }

  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE salary_settings
     SET common_daily_wage = ?, official_start_date = ?, cycle_start_day = ?, updated_by = ?, updated_at = ?
     WHERE id = (SELECT id FROM salary_settings ORDER BY id ASC LIMIT 1)`,
    [wage, newStartDate, newStartDay, userId, nowIso]
  );

  await logActivity({
    userId,
    action: 'SALARY_SETTINGS_UPDATED',
    entityType: 'salary_settings',
    details: `Updated salary settings: Common Wage ₹${wage}, Start Date ${newStartDate}, Cycle Start Day ${newStartDay}`,
  });
  return getSalarySettings();
}

/**
 * Resolve whether a query string refers to a cycle or a legacy month.
 */
async function resolveCycleOrPeriod(periodOrMonth) {
  const settings = await getSalarySettings();
  const officialStartDate = settings.official_start_date || '2026-11-03';
  const cycleStartDay = settings.cycle_start_day || 3;

  // Case 1: No parameter provided -> fetch active cycle from DB
  if (!periodOrMonth) {
    let activeCycle = await db.get("SELECT * FROM salary_cycles WHERE status = 'active' ORDER BY start_date ASC LIMIT 1");
    if (!activeCycle) {
      activeCycle = await db.get("SELECT * FROM salary_cycles ORDER BY start_date DESC LIMIT 1");
    }
    if (activeCycle) {
      return {
        isCycle: true,
        cycleId: activeCycle.id,
        cycleCode: activeCycle.cycle_code,
        startDate: activeCycle.start_date,
        endDate: activeCycle.end_date,
        status: activeCycle.status,
        officialStartDate,
      };
    }
    const todayStr = getCompanyDate();
    const cycle = getSalaryCycleForDate(todayStr >= officialStartDate ? todayStr : officialStartDate, cycleStartDay);
    return {
      isCycle: true,
      cycleCode: cycle.cycleCode,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      status: 'active',
      officialStartDate,
    };
  }

  // Case 2: Exact cycle code (e.g. '2026-11-03_2026-12-02')
  if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(periodOrMonth)) {
    const [startDate, endDate] = periodOrMonth.split('_');
    const existing = await db.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [periodOrMonth]);
    return {
      isCycle: true,
      cycleId: existing?.id,
      cycleCode: periodOrMonth,
      startDate,
      endDate,
      status: existing?.status || 'active',
      officialStartDate,
    };
  }

  // Case 3: Month string YYYY-MM
  if (/^\d{4}-\d{2}$/.test(periodOrMonth)) {
    // If on or after production start month (2026-11), map to monthly cycle starting on the 3rd
    if (periodOrMonth >= '2026-11') {
      const cycle = getSalaryCycleForDate(`${periodOrMonth}-03`, cycleStartDay);
      const existing = await db.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [cycle.cycleCode]);
      return {
        isCycle: true,
        cycleId: existing?.id,
        cycleCode: cycle.cycleCode,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        status: existing?.status || 'active',
        officialStartDate,
      };
    } else {
      // Legacy calendar month before official start date (e.g. 2026-04 for test suite)
      const dates = getDatesInMonth(periodOrMonth);
      return {
        isCycle: false,
        cycleCode: periodOrMonth,
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        status: 'draft',
        officialStartDate: '2000-01-01', // Allow testing legacy months
      };
    }
  }

  // Fallback
  return {
    isCycle: false,
    cycleCode: periodOrMonth,
    startDate: `${periodOrMonth}-01`,
    endDate: `${periodOrMonth}-31`,
    status: 'draft',
    officialStartDate,
  };
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
  dailyIncentiveRate = 0,
  effectiveDate,
  remarks,
  createdBy,
}) {
  if (!salaryType || !['daily_wage', 'daily_wages', 'fixed_monthly'].includes(salaryType)) {
    throw new Error("Invalid salary type. Must be 'daily_wage' or 'fixed_monthly'");
  }
  const normSalaryType = salaryType === 'daily_wages' ? 'daily_wage' : salaryType;
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
           daily_incentive_rate = ?, effective_date = ?, remarks = ?, created_by = ?, updated_at = ?
       WHERE user_id = ?`,
      [
        normSalaryType,
        parseFloat(monthlyBasicSalary) || 0,
        dailyWageOverride !== null && dailyWageOverride !== undefined && dailyWageOverride !== ''
          ? parseFloat(dailyWageOverride)
          : null,
        dailyIncentiveRate !== null && dailyIncentiveRate !== undefined && dailyIncentiveRate !== ''
          ? parseFloat(dailyIncentiveRate)
          : 0,
        effectiveDate,
        remarks || null,
        createdBy,
        nowIso,
        userId,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO employee_salary_configs (user_id, salary_type, monthly_basic_salary, daily_wage_override, daily_incentive_rate, effective_date, remarks, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        normSalaryType,
        parseFloat(monthlyBasicSalary) || 0,
        dailyWageOverride !== null && dailyWageOverride !== undefined && dailyWageOverride !== ''
          ? parseFloat(dailyWageOverride)
          : null,
        dailyIncentiveRate !== null && dailyIncentiveRate !== undefined && dailyIncentiveRate !== ''
          ? parseFloat(dailyIncentiveRate)
          : 0,
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
 * Calculate attendance metrics for an employee in a given period/cycle.
 */
async function getAttendanceMetricsForPeriod(userId, periodOrMonth) {
  const user = await db.get('SELECT id, joining_date, exit_date FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('User not found');

  const resolved = await resolveCycleOrPeriod(periodOrMonth);
  const { startDate, endDate, officialStartDate, isCycle } = resolved;
  const cycleDates = getDatesInDateRange(startDate, endDate);
  const leaveYear = getLeaveYear(cycleDates[0]);

  // Fetch holidays in this period
  const holidays = await db.query(
    `SELECT date, name FROM company_holidays
     WHERE is_active = 1 AND date >= ? AND date <= ?`,
    [startDate, endDate]
  );
  const holidayDates = new Set(holidays.map((h) => h.date));

  // Determine working calendar dates (excluding Sundays & Holidays)
  const workingCalendarDates = [];
  for (const dt of cycleDates) {
    if (!isSunday(dt) && !holidayDates.has(dt)) {
      workingCalendarDates.push(dt);
    }
  }
  const totalWorkingDays = workingCalendarDates.length;

  // Filter for employment bounds and official salary start date
  const activeWorkingDates = workingCalendarDates.filter((dt) => {
    if (isCycle && dt < officialStartDate) return false;
    if (user.joining_date && dt < user.joining_date) return false;
    if (user.exit_date && dt > user.exit_date) return false;
    return true;
  });

  // Get attendance records for this user strictly in this date range
  const attendanceRows = await db.query(
    `SELECT date, status FROM attendance
     WHERE user_id = ? AND date >= ? AND date <= ?`,
    [userId, startDate, endDate]
  );
  const presentDates = new Set(
    attendanceRows
      .filter((r) => {
        if (isCycle && r.date < officialStartDate) return false;
        return r.status === 'checked_out' || r.status === 'checked_in';
      })
      .map((r) => r.date)
  );

  // Get confirmed leaves in this date range
  const confirmedLeaves = await db.query(
    `SELECT start_date, end_date, working_days, days_deducted FROM leave_records
     WHERE user_id = ? AND status = 'confirmed'
       AND (start_date <= ? AND end_date >= ?)`,
    [userId, endDate, startDate]
  );

  const paidLeaveDates = new Set();
  for (const lr of confirmedLeaves) {
    const dates = cycleDates.filter(
      (d) => d >= lr.start_date && d <= lr.end_date && !isSunday(d) && !holidayDates.has(d)
    );
    for (const d of dates) {
      if (!isCycle || d >= officialStartDate) {
        paidLeaveDates.add(d);
      }
    }
  }

  // Get absences in this date range
  const absences = await db.query(
    `SELECT date, absence_type FROM attendance_absences
     WHERE user_id = ? AND date >= ? AND date <= ?`,
    [userId, startDate, endDate]
  );
  const unpaidAbsenceDates = new Set();
  for (const abs of absences) {
    if (!isCycle || abs.date >= officialStartDate) {
      if (abs.absence_type === 'unpaid') {
        unpaidAbsenceDates.add(abs.date);
      } else if (abs.absence_type === 'earned_leave_deducted') {
        paidLeaveDates.add(abs.date);
      }
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
    periodCode: resolved.cycleCode,
    startDate,
    endDate,
    totalWorkingDays,
    activeWorkingDays: activeWorkingDates.length,
    presentDays: presentDaysCount,
    presentDates: Array.from(presentDates),
    paidLeaveDays: paidLeaveDaysCount,
    payableDays,
    absentDays: absentDaysCount,
    holidayDates: Array.from(holidayDates),
    isCycle: resolved.isCycle,
    officialStartDate,
  };
}

/**
 * Backward-compatible alias for getAttendanceMetricsForMonth
 */
async function getAttendanceMetricsForMonth(userId, monthStr) {
  return getAttendanceMetricsForPeriod(userId, monthStr);
}

/**
 * Calculate salary for a single employee for a given cycle or month.
 * Server-side source of truth.
 */
async function calculateSalaryForEmployee(userId, periodOrMonth) {
  const user = await db.get('SELECT id, full_name, email, role, department FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('Employee not found');

  const settings = await getSalarySettings();
  let empConfig = await db.get('SELECT * FROM employee_salary_configs WHERE user_id = ?', [userId]);

  const hasConfig = !!empConfig;
  if (!empConfig) {
    empConfig = {
      salary_type: 'daily_wage',
      monthly_basic_salary: 0,
      daily_wage_override: null,
      daily_incentive_rate: 0,
    };
  }

  const attendanceMetrics = await getAttendanceMetricsForPeriod(userId, periodOrMonth);

  // If daily_incentive_rate is fixed by admin (> 0), ensure daily incentive records exist for present attendance days
  const dailyIncentiveRate = parseFloat(empConfig.daily_incentive_rate || 0);
  if (empConfig.salary_type === 'daily_wage' && dailyIncentiveRate > 0) {
    const existingIncentives = await db.query(
      `SELECT date FROM daily_incentives WHERE user_id = ? AND date >= ? AND date <= ?`,
      [userId, attendanceMetrics.startDate, attendanceMetrics.endDate]
    );
    const existingSet = new Set(existingIncentives.map((r) => r.date));
    const nowIso = new Date().toISOString();

    for (const dt of attendanceMetrics.presentDates || []) {
      if (!existingSet.has(dt)) {
        await db.run(
          `INSERT INTO daily_incentives (user_id, date, amount, description, status, payroll_period, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            dt,
            dailyIncentiveRate,
            'Daily Fixed Incentive',
            'approved',
            attendanceMetrics.periodCode,
            empConfig.created_by || 1,
            nowIso,
            nowIso,
          ]
        );
        existingSet.add(dt);
      }
    }
  }

  // Fetch approved daily incentives in this date range
  const minDate = attendanceMetrics.isCycle ? attendanceMetrics.officialStartDate : '2000-01-01';
  const incentives = await db.query(
    `SELECT SUM(amount) as total FROM daily_incentives
     WHERE user_id = ? AND date >= ? AND date <= ? AND date >= ? AND status = 'approved'`,
    [userId, attendanceMetrics.startDate, attendanceMetrics.endDate, minDate]
  );
  const incentiveSalary = round2(incentives[0]?.total || 0);

  // Fetch approved overtime in this date range
  const overtimes = await db.query(
    `SELECT SUM(hours) as total_hours, SUM(amount) as total_amount
     FROM overtime_records
     WHERE user_id = ? AND date >= ? AND date <= ? AND date >= ? AND status = 'approved'`,
    [userId, attendanceMetrics.startDate, attendanceMetrics.endDate, minDate]
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
    netSalary = round2(Math.max(0, grossSalary - totalDeductions));

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

    // Proration if employee was eligible for partial cycle (e.g. joined mid-cycle)
    const effectiveMonthlyBasic = (attendanceMetrics.activeWorkingDays < totalWorkingDays && totalWorkingDays > 0)
      ? round2((monthlyBasic * attendanceMetrics.activeWorkingDays) / totalWorkingDays)
      : monthlyBasic;

    // If employee has 0 payable days (no attendance and no paid leave), earned salary is 0
    if (attendanceMetrics.payableDays === 0) {
      excessAbsentDays = attendanceMetrics.absentDays;
      basicSalary = 0;
      grossSalary = 0;
      gratuityDeduction = 0;
      totalDeductions = 0;
      netSalary = 0;
      ctc = 0;
    } else {
      // Excess absent days (allowed 2 days without deduction)
      excessAbsentDays = Math.max(attendanceMetrics.absentDays - 2, 0);
      const absenceDeduction = round2(dailySalary * excessAbsentDays);

      // Calculated basic salary after absence deductions
      basicSalary = round2(Math.max(0, effectiveMonthlyBasic - absenceDeduction));
      const calculatedGross = round2(basicSalary + incentiveSalary + overtimeAmount);

      // Rule: Eligible Gross Salary = min(calculated gross salary after applicable absence deductions, configured monthly salary cap)
      // The cap applies to gross earned salary before deductions; incentives/overtime cannot push it over cap
      const configuredMonthlyCap = effectiveMonthlyBasic;
      grossSalary = round2(Math.max(0, Math.min(calculatedGross, configuredMonthlyCap)));

      // Company-Specified 5% Deduction (Internal Retention / Welfare, not statutory gratuity)
      gratuityDeduction = round2(effectiveMonthlyBasic * 0.05);
      totalDeductions = gratuityDeduction;

      // Net Salary = grossSalary - totalDeductions (never below 0)
      netSalary = round2(Math.max(0, grossSalary - totalDeductions));
      ctc = grossSalary;
    }

    // No EPF/ESIC for fixed monthly formula
    employeeEpf = 0;
    employeeEsic = 0;
    employerEpf = 0;
    employerEsic = 0;
  }

  // Check disbursement and payment status if already recorded in DB
  let amountDisbursed = 0;
  let remainingPayable = netSalary;
  let paymentStatus = 'draft';
  let paymentDate = null;
  let disbursementReference = null;

  const cycleRecord = await db.get(
    `SELECT pr.* FROM payroll_records pr
     WHERE pr.user_id = ? AND (pr.payroll_period = ? OR pr.cycle_code = ?)`,
    [userId, attendanceMetrics.periodCode, attendanceMetrics.periodCode]
  );

  if (cycleRecord) {
    amountDisbursed = round2(cycleRecord.amount_disbursed || 0);
    remainingPayable = round2(Math.max(0, netSalary - amountDisbursed));
    paymentStatus = cycleRecord.payment_status || (amountDisbursed >= netSalary && netSalary > 0 ? 'paid' : (amountDisbursed > 0 ? 'partially_paid' : (cycleRecord.status === 'finalized' ? 'finalized' : 'draft')));
    paymentDate = cycleRecord.payment_date || null;
    disbursementReference = cycleRecord.disbursement_reference || null;
  }

  return {
    userId: user.id,
    fullName: user.full_name,
    email: user.email,
    department: user.department,
    payrollPeriod: attendanceMetrics.periodCode,
    cycleCode: attendanceMetrics.periodCode,
    startDate: attendanceMetrics.startDate,
    endDate: attendanceMetrics.endDate,
    isCycle: attendanceMetrics.isCycle,
    salaryType: empConfig.salary_type,
    baseRate,
    configuredMonthlyCap: empConfig.salary_type === 'fixed_monthly' ? parseFloat(empConfig.monthly_basic_salary || 0) : null,
    hasConfig,
    totalWorkingDays: attendanceMetrics.totalWorkingDays,
    activeWorkingDays: attendanceMetrics.activeWorkingDays,
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
    amountDisbursed,
    remainingPayable,
    paymentStatus,
    paymentDate,
    disbursementReference,
    attendanceSnapshot: attendanceMetrics,
  };
}

/**
 * Preview payroll calculations for all active employees for a given period or cycle.
 */
async function previewPayrollForPeriod(periodOrMonth) {
  const users = await db.query('SELECT id, full_name, email, role, is_active FROM users WHERE is_active = 1 ORDER BY id ASC');
  const results = [];
  for (const u of users) {
    try {
      const calc = await calculateSalaryForEmployee(u.id, periodOrMonth);
      results.push(calc);
    } catch (err) {
      console.error(`Error calculating salary for user ${u.id}:`, err.message);
    }
  }
  return results;
}

/**
 * Backward-compatible alias
 */
async function previewPayrollForMonth(monthStr) {
  return previewPayrollForPeriod(monthStr);
}

/**
 * Finalize and lock a payroll period or cycle.
 * Saves immutable snapshot of all payroll records in a transaction.
 */
async function finalizePayroll(periodOrMonth, adminUserId, notes = '') {
  return await db.withTransaction(async (tx) => {
    const resolved = await resolveCycleOrPeriod(periodOrMonth);
    const targetPeriod = resolved.cycleCode;

    // Check if already finalized
    const period = await tx.get('SELECT * FROM payroll_periods WHERE month = ?', [targetPeriod]);
    const cycle = await tx.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [targetPeriod]);

    if ((period && period.status === 'finalized') || (cycle && ['finalized', 'paid'].includes(cycle.status))) {
      throw new Error(`Payroll for period ${targetPeriod} is already finalized and locked.`);
    }

    const calculations = await previewPayrollForPeriod(targetPeriod);
    const nowIso = new Date().toISOString();

    const totalEligibleGross = round2(calculations.reduce((sum, c) => sum + c.grossSalary, 0));
    const totalDeductions = round2(calculations.reduce((sum, c) => sum + c.totalDeductions, 0));
    const totalNetPayable = round2(calculations.reduce((sum, c) => sum + c.netSalary, 0));

    // Update or insert salary_cycles
    if (cycle) {
      await tx.run(
        `UPDATE salary_cycles
         SET status = 'finalized', total_gross = ?, total_deductions = ?, total_net = ?,
             remaining_payable = ?, employee_count = ?, finalized_by = ?, finalized_at = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [
          totalEligibleGross,
          totalDeductions,
          totalNetPayable,
          round2(totalNetPayable - (cycle.total_disbursed || 0)),
          calculations.length,
          adminUserId,
          nowIso,
          notes,
          nowIso,
          cycle.id,
        ]
      );
    } else if (resolved.isCycle) {
      await tx.run(
        `INSERT INTO salary_cycles (
           cycle_code, start_date, end_date, status, total_gross, total_deductions,
           total_net, total_disbursed, remaining_payable, employee_count, finalized_by,
           finalized_at, notes, created_at, updated_at
         ) VALUES (?, ?, ?, 'finalized', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
        [
          targetPeriod,
          resolved.startDate,
          resolved.endDate,
          totalEligibleGross,
          totalDeductions,
          totalNetPayable,
          totalNetPayable,
          calculations.length,
          adminUserId,
          nowIso,
          notes,
          nowIso,
          nowIso,
        ]
      );
    }

    // Mirror to legacy payroll_periods
    if (period) {
      await tx.run(
        `UPDATE payroll_periods
         SET status = 'finalized', finalized_by = ?, finalized_at = ?, notes = ?
         WHERE month = ?`,
        [adminUserId, nowIso, notes, targetPeriod]
      );
    } else {
      await tx.run(
        `INSERT INTO payroll_periods (month, status, finalized_by, finalized_at, notes, created_at)
         VALUES (?, 'finalized', ?, ?, ?, ?)`,
        [targetPeriod, adminUserId, nowIso, notes, nowIso]
      );
    }

    // Insert or update payroll_records
    for (const c of calculations) {
      const existing = await tx.get(
        'SELECT id, amount_disbursed FROM payroll_records WHERE (payroll_period = ? OR cycle_code = ?) AND user_id = ?',
        [targetPeriod, targetPeriod, c.userId]
      );

      const snapshotStr = JSON.stringify(c.attendanceSnapshot);
      const existingDisbursed = round2(existing?.amount_disbursed || 0);
      const remPayable = round2(Math.max(0, c.netSalary - existingDisbursed));
      const payStatus = remPayable === 0 ? 'paid' : (existingDisbursed > 0 ? 'partially_paid' : 'finalized');

      if (existing) {
        await tx.run(
          `UPDATE payroll_records
           SET cycle_id = ?, cycle_code = ?, salary_type = ?, base_rate = ?, total_working_days = ?,
               present_days = ?, paid_leave_days = ?, payable_days = ?, absent_days = ?, excess_absent_days = ?,
               basic_salary = ?, incentive_salary = ?, overtime_hours = ?, overtime_amount = ?,
               gross_salary = ?, employee_epf = ?, employee_esic = ?, total_employee_deductions = ?,
               gratuity_deduction = ?, net_salary = ?, employer_epf = ?, employer_esic = ?,
               ctc = ?, status = 'finalized', remaining_payable = ?, payment_status = ?,
               attendance_snapshot = ?, updated_at = ?
           WHERE id = ?`,
          [
            cycle?.id || null,
            targetPeriod,
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
            remPayable,
            payStatus,
            snapshotStr,
            nowIso,
            existing.id,
          ]
        );
      } else {
        await tx.run(
          `INSERT INTO payroll_records (
             payroll_period, cycle_id, cycle_code, user_id, salary_type, base_rate, total_working_days,
             present_days, paid_leave_days, payable_days, absent_days, excess_absent_days,
             basic_salary, incentive_salary, overtime_hours, overtime_amount, gross_salary,
             employee_epf, employee_esic, total_employee_deductions, gratuity_deduction,
             net_salary, employer_epf, employer_esic, ctc, status, amount_disbursed,
             remaining_payable, payment_status, attendance_snapshot, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'finalized', 0, ?, ?, ?, ?, ?)`,
          [
            targetPeriod,
            cycle?.id || null,
            targetPeriod,
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
            remPayable,
            payStatus,
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
      entityId: targetPeriod,
      details: `Finalized and locked payroll for ${targetPeriod} (${calculations.length} employee records)`,
    });

    return {
      message: `Payroll for period ${targetPeriod} successfully finalized and locked.`,
      recordsCount: calculations.length,
    };
  });
}

/**
 * Record salary disbursement and advance to the next cycle.
 * Protected admin action.
 */
async function disburseSalaryAndAdvanceCycle({
  cycleCode,
  disbursementDate,
  amountPaid = null,
  paymentMethod = 'bank_transfer',
  notes = '',
  adminUserId,
}) {
  return await db.withTransaction(async (tx) => {
    // 1. Resolve target cycle
    const resolved = await resolveCycleOrPeriod(cycleCode);
    const targetCycleCode = resolved.cycleCode;

    let cycle = await tx.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [targetCycleCode]);
    if (!cycle) {
      await tx.run(
        `INSERT INTO salary_cycles (cycle_code, start_date, end_date, status)
         VALUES (?, ?, ?, 'active')`,
        [targetCycleCode, resolved.startDate, resolved.endDate]
      );
      cycle = await tx.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [targetCycleCode]);
    }

    if (cycle.status === 'paid') {
      throw new Error(`Cycle ${targetCycleCode} is already fully paid and closed.`);
    }

    // 2. Compute payroll calculations for all active employees
    const calculations = await previewPayrollForPeriod(targetCycleCode);
    if (!calculations || calculations.length === 0) {
      throw new Error('No employee payroll calculations available for this cycle.');
    }

    const totalEligibleGross = round2(calculations.reduce((sum, c) => sum + c.grossSalary, 0));
    const totalDeductions = round2(calculations.reduce((sum, c) => sum + c.totalDeductions, 0));
    const totalNetPayable = round2(calculations.reduce((sum, c) => sum + c.netSalary, 0));

    const existingDisbursed = round2(cycle.total_disbursed || 0);
    const totalRemainingPayable = round2(Math.max(0, totalNetPayable - existingDisbursed));

    // If amountPaid is not specified, default to full remaining net payable
    const actualDisbursementAmount = amountPaid !== null && amountPaid !== undefined
      ? round2(Math.min(parseFloat(amountPaid), totalRemainingPayable))
      : totalRemainingPayable;

    if (actualDisbursementAmount < 0) {
      throw new Error('Disbursement amount cannot be negative.');
    }

    const nowIso = new Date().toISOString();
    const effectivePaymentDate = disbursementDate || getCompanyDate();

    // 3. Generate unique Batch Reference
    const batchRef = `DISB-${targetCycleCode}-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const batchRes = await tx.run(
      `INSERT INTO salary_disbursement_batches (
         batch_reference, cycle_id, cycle_code, disbursement_date, total_amount,
         employee_count, disbursed_by, payment_method, notes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchRef,
        cycle.id,
        targetCycleCode,
        effectivePaymentDate,
        actualDisbursementAmount,
        calculations.length,
        adminUserId,
        paymentMethod,
        notes,
        nowIso,
      ]
    );
    const batchId = batchRes.lastID;

    // 4. Create / Update immutable payroll_records snapshot and salary_payments per employee
    for (const c of calculations) {
      let empShare = 0;
      if (totalRemainingPayable > 0 && actualDisbursementAmount > 0) {
        if (actualDisbursementAmount === totalRemainingPayable) {
          empShare = round2(Math.max(0, c.netSalary - (c.amountDisbursed || 0)));
        } else {
          // Pro-rate partial payment according to net salary share
          const ratio = totalNetPayable > 0 ? (c.netSalary / totalNetPayable) : 0;
          empShare = round2(actualDisbursementAmount * ratio);
        }
      }

      const prevDisbursed = round2(c.amountDisbursed || 0);
      const newDisbursed = round2(prevDisbursed + empShare);
      const newRemaining = round2(Math.max(0, c.netSalary - newDisbursed));
      const payStatus = newRemaining === 0 ? 'paid' : (newDisbursed > 0 ? 'partially_paid' : 'finalized');

      // Record individual payment if amount > 0
      if (empShare > 0) {
        const payRef = `PAY-${batchId}-${c.userId}-${Date.now().toString(36).toUpperCase()}`;
        await tx.run(
          `INSERT INTO salary_payments (
             payment_reference, batch_id, cycle_id, cycle_code, user_id,
             amount_paid, net_payable, remaining_balance, payment_date,
             status, recorded_by, notes, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
          [
            payRef,
            batchId,
            cycle.id,
            targetCycleCode,
            c.userId,
            empShare,
            c.netSalary,
            newRemaining,
            effectivePaymentDate,
            adminUserId,
            notes,
            nowIso,
          ]
        );
      }

      // Snapshot to payroll_records
      const existing = await tx.get(
        'SELECT id FROM payroll_records WHERE (payroll_period = ? OR cycle_code = ?) AND user_id = ?',
        [targetCycleCode, targetCycleCode, c.userId]
      );
      const snapshotStr = JSON.stringify(c.attendanceSnapshot);

      if (existing) {
        await tx.run(
          `UPDATE payroll_records
           SET cycle_id = ?, cycle_code = ?, salary_type = ?, base_rate = ?, total_working_days = ?,
               present_days = ?, paid_leave_days = ?, payable_days = ?, absent_days = ?, excess_absent_days = ?,
               basic_salary = ?, incentive_salary = ?, overtime_hours = ?, overtime_amount = ?,
               gross_salary = ?, employee_epf = ?, employee_esic = ?, total_employee_deductions = ?,
               gratuity_deduction = ?, net_salary = ?, employer_epf = ?, employer_esic = ?,
               ctc = ?, status = 'finalized', amount_disbursed = ?, remaining_payable = ?,
               payment_status = ?, payment_date = ?, disbursement_reference = ?,
               attendance_snapshot = ?, updated_at = ?
           WHERE id = ?`,
          [
            cycle.id,
            targetCycleCode,
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
            newDisbursed,
            newRemaining,
            payStatus,
            effectivePaymentDate,
            batchRef,
            snapshotStr,
            nowIso,
            existing.id,
          ]
        );
      } else {
        await tx.run(
          `INSERT INTO payroll_records (
             payroll_period, cycle_id, cycle_code, user_id, salary_type, base_rate,
             total_working_days, present_days, paid_leave_days, payable_days, absent_days,
             excess_absent_days, basic_salary, incentive_salary, overtime_hours, overtime_amount,
             gross_salary, employee_epf, employee_esic, total_employee_deductions, gratuity_deduction,
             net_salary, employer_epf, employer_esic, ctc, status, amount_disbursed,
             remaining_payable, payment_status, payment_date, disbursement_reference,
             attendance_snapshot, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'finalized', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            targetCycleCode,
            cycle.id,
            targetCycleCode,
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
            newDisbursed,
            newRemaining,
            payStatus,
            effectivePaymentDate,
            batchRef,
            snapshotStr,
            nowIso,
            nowIso,
          ]
        );
      }
    }

    // 5. Update Current Cycle
    const newTotalDisbursed = round2(existingDisbursed + actualDisbursementAmount);
    const newRemainingPayable = round2(Math.max(0, totalNetPayable - newTotalDisbursed));
    const cycleStatus = newRemainingPayable === 0 ? 'paid' : 'partially_paid';

    await tx.run(
      `UPDATE salary_cycles
       SET status = ?, total_gross = ?, total_deductions = ?, total_net = ?,
           total_disbursed = ?, remaining_payable = ?, employee_count = ?,
           finalized_by = ?, finalized_at = ?, closed_at = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        cycleStatus,
        totalEligibleGross,
        totalDeductions,
        totalNetPayable,
        newTotalDisbursed,
        newRemainingPayable,
        calculations.length,
        adminUserId,
        nowIso,
        nowIso,
        notes,
        nowIso,
        cycle.id,
      ]
    );

    // 6. Compute and create Next Cycle starting on the 3rd
    const settings = await getSalarySettings();
    const cycleStartDay = settings.cycle_start_day || 3;
    const nextCycleInfo = getNextSalaryCycle(resolved.startDate, cycleStartDay);

    let nextCycle = await tx.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [nextCycleInfo.cycleCode]);
    if (!nextCycle) {
      await tx.run(
        `INSERT INTO salary_cycles (
           cycle_code, start_date, end_date, status, total_gross, total_deductions,
           total_net, total_disbursed, remaining_payable, employee_count, created_at, updated_at
         ) VALUES (?, ?, ?, 'active', 0, 0, 0, 0, 0, 0, ?, ?)`,
        [
          nextCycleInfo.cycleCode,
          nextCycleInfo.startDate,
          nextCycleInfo.endDate,
          nowIso,
          nowIso,
        ]
      );
      nextCycle = await tx.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [nextCycleInfo.cycleCode]);
    } else if (nextCycle.status !== 'active') {
      await tx.run('UPDATE salary_cycles SET status = "active", updated_at = ? WHERE id = ?', [nowIso, nextCycle.id]);
    }

    // 7. Audit Log
    await logActivity({
      userId: adminUserId,
      action: 'SALARY_CYCLE_DISBURSED_AND_ADVANCED',
      entityType: 'salary_cycle',
      entityId: targetCycleCode,
      details: `Disbursed ₹${actualDisbursementAmount} for cycle ${targetCycleCode} (Batch: ${batchRef}, Payment Date: ${effectivePaymentDate}). Next cycle ${nextCycleInfo.cycleCode} started with zero opening balance.`,
    });

    return {
      success: true,
      batchReference: batchRef,
      cycleCode: targetCycleCode,
      disbursementDate: effectivePaymentDate,
      totalNetPayable,
      amountDisbursed: actualDisbursementAmount,
      remainingLiability: newRemainingPayable,
      status: cycleStatus,
      closedCycle: {
        id: cycle.id,
        cycleCode: targetCycleCode,
        status: cycleStatus,
        totalNet: totalNetPayable,
        totalDisbursed: newTotalDisbursed,
        remainingPayable: newRemainingPayable,
      },
      nextCycle: {
        id: nextCycle.id,
        cycleCode: nextCycleInfo.cycleCode,
        startDate: nextCycleInfo.startDate,
        endDate: nextCycleInfo.endDate,
        status: 'active',
      },
    };
  });
}

/**
 * Record additional/remaining payment against a past cycle's remaining liability.
 */
async function recordRemainingPayment({
  cycleCode,
  userId = null,
  amount,
  paymentDate,
  paymentMethod = 'bank_transfer',
  notes = '',
  adminUserId,
}) {
  return await db.withTransaction(async (tx) => {
    const cycle = await tx.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [cycleCode]);
    if (!cycle) throw new Error(`Cycle ${cycleCode} not found.`);

    const remaining = round2(cycle.remaining_payable || 0);
    if (remaining <= 0) {
      throw new Error(`Cycle ${cycleCode} has no remaining liability.`);
    }

    const payAmount = round2(Math.min(parseFloat(amount), remaining));
    if (payAmount <= 0) throw new Error('Payment amount must be greater than 0.');

    const nowIso = new Date().toISOString();
    const effectiveDate = paymentDate || getCompanyDate();
    const batchRef = `REMAIN-${cycleCode}-${Date.now().toString(36).toUpperCase()}`;

    // Insert batch
    const batchRes = await tx.run(
      `INSERT INTO salary_disbursement_batches (
         batch_reference, cycle_id, cycle_code, disbursement_date, total_amount,
         employee_count, disbursed_by, payment_method, notes, created_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [batchRef, cycle.id, cycleCode, effectiveDate, payAmount, adminUserId, paymentMethod, notes, nowIso]
    );

    // If specific employee, update their record
    if (userId) {
      const rec = await tx.get(
        'SELECT * FROM payroll_records WHERE (cycle_code = ? OR payroll_period = ?) AND user_id = ?',
        [cycleCode, cycleCode, userId]
      );
      if (rec) {
        const newDisb = round2((rec.amount_disbursed || 0) + payAmount);
        const newRem = round2(Math.max(0, rec.net_salary - newDisb));
        const status = newRem === 0 ? 'paid' : 'partially_paid';

        await tx.run(
          `UPDATE payroll_records
           SET amount_disbursed = ?, remaining_payable = ?, payment_status = ?, updated_at = ?
           WHERE id = ?`,
          [newDisb, newRem, status, nowIso, rec.id]
        );

        const payRef = `PAY-REM-${batchRes.lastID}-${userId}-${Date.now().toString(36).toUpperCase()}`;
        await tx.run(
          `INSERT INTO salary_payments (
             payment_reference, batch_id, cycle_id, cycle_code, user_id,
             amount_paid, net_payable, remaining_balance, payment_date,
             status, recorded_by, notes, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
          [payRef, batchRes.lastID, cycle.id, cycleCode, userId, payAmount, rec.net_salary, newRem, effectiveDate, adminUserId, notes, nowIso]
        );
      }
    }

    const updatedDisbursed = round2((cycle.total_disbursed || 0) + payAmount);
    const updatedRemaining = round2(Math.max(0, (cycle.total_net || 0) - updatedDisbursed));
    const newStatus = updatedRemaining === 0 ? 'paid' : 'partially_paid';

    await tx.run(
      `UPDATE salary_cycles
       SET total_disbursed = ?, remaining_payable = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [updatedDisbursed, updatedRemaining, newStatus, nowIso, cycle.id]
    );

    await logActivity({
      userId: adminUserId,
      action: 'SALARY_PAYMENT_RECORDED',
      entityType: 'salary_cycle',
      entityId: cycleCode,
      details: `Recorded additional payment of ₹${payAmount} for cycle ${cycleCode} (Remaining liability: ₹${updatedRemaining})`,
    });

    return {
      success: true,
      cycleCode,
      amountPaid: payAmount,
      remainingLiability: updatedRemaining,
      status: newStatus,
    };
  });
}

/**
 * Generate CSV formatted data matching the user's Google Sheet template:
 * S.No. | Name of Employees | No. of Days Present | No. of Days Absent | EPFO | ESIC | Advance | Daily rate of wage | Over time | Net Salary | Salary Deductions | Net Salary Payable | CTC | Remaining Advance | Paid Leave
 */
async function generatePayrollCsv(periodOrMonth) {
  const calculations = await previewPayrollForPeriod(periodOrMonth);

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
  getDatesInMonth,
  getDatesInDateRange,
  getSalaryCycleForDate,
  getNextSalaryCycle,
  resolveCycleOrPeriod,
  getSalarySettings,
  updateSalarySettings,
  getEmployeeSalaryConfig,
  upsertEmployeeSalaryConfig,
  getAttendanceMetricsForMonth,
  getAttendanceMetricsForPeriod,
  calculateSalaryForEmployee,
  previewPayrollForMonth,
  previewPayrollForPeriod,
  finalizePayroll,
  disburseSalaryAndAdvanceCycle,
  recordRemainingPayment,
  generatePayrollCsv,
};
