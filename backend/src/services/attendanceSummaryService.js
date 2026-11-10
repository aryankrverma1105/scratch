/**
 * Attendance Summary Service
 * 
 * Provides monthly attendance summaries with exact IST date aggregation.
 * Rules:
 * 1. Count attendance by unique calendar date in IST. Multiple sessions on the same date = 1 present day.
 * 2. Exclude Sundays and configured active company holidays from working days.
 * 3. Exclude pending_review and rejected attendance from approved present days.
 * 4. Do not count future dates as absent.
 * 5. Calculate attendance percentage using actual eligible working days elapsed in the month.
 *    Formula:
 *      Present Days = Number of unique approved present dates.
 *      Absent Days = Eligible elapsed working days - Present Days - Approved non-absent (e.g. approved leaves).
 *      Attendance Percentage = (Present Days / Eligible elapsed working days) * 100.
 */

const db = require('../db');
const { getCompanyDate } = require('../utils/timeUtils');
const { isSunday, generateDateRange } = require('../utils/leaveUtils');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Get monthly attendance summary for a specific employee
 * @param {number} userId
 * @param {string} [yearMonth] e.g. '2026-11'
 */
async function getEmployeeMonthlySummary(userId, yearMonth) {
  const todayStr = getCompanyDate();
  const targetMonth = yearMonth || todayStr.substring(0, 7);
  const [yearNum, monthNum] = targetMonth.split('-').map(Number);
  const monthName = `${MONTH_NAMES[monthNum - 1]} ${yearNum}`;

  // User details
  const user = await db.get(
    'SELECT id, full_name, email, department, role FROM users WHERE id = ?',
    [userId]
  );
  if (!user) throw new Error('User not found');

  // Verify salary configuration (Salaried vs Daily-Wage)
  const salConfig = await db.get(
    'SELECT salary_type FROM employee_salary_configs WHERE user_id = ?',
    [userId]
  );
  const salaryType = salConfig?.salary_type || 'daily_wage';
  const isSalaried = salaryType === 'fixed_monthly';

  // Month date range
  const startDate = `${targetMonth}-01`;
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const endDateOfMonth = `${targetMonth}-${String(daysInMonth).padStart(2, '0')}`;

  // If daily wage employee: monthly salaried summary does not apply
  if (!isSalaried) {
    return {
      success: true,
      userId,
      employeeName: user.full_name,
      userName: user.full_name,
      department: user.department || 'General',
      isSalaried: false,
      salaryType,
      month: targetMonth,
      yearMonth: targetMonth,
      monthName,
      presentDays: 0,
      workingDays: 0,
      totalWorkingDays: 0,
      absentDays: 0,
      approvedLeaveDays: 0,
      attendancePercentage: 0.0,
      totalCalendarDays: daysInMonth,
      elapsedCalendarDays: 0,
      sundaysCount: 0,
      holidaysCount: 0,
      presentDates: [],
      cumulativePresentDaysYear: 0,
      requiredPresentDaysYear: 26,
      is26DayRequirementMet: false,
      isFutureMonth: false,
      dailyBreakdown: [],
      message: 'Monthly attendance summary is applicable only for salaried employees. Daily-wage employees are compensated per daily shift.',
    };
  }

  const currentMonthStr = todayStr.substring(0, 7);
  let elapsedEndDate;
  if (targetMonth === currentMonthStr) {
    elapsedEndDate = todayStr; // up to today for current month
  } else if (targetMonth < currentMonthStr) {
    elapsedEndDate = endDateOfMonth; // whole month for past months
  } else {
    // Future month
    return {
      userId,
      employeeName: user.full_name,
      department: user.department || 'General',
      month: targetMonth,
      monthName,
      presentDays: 0,
      workingDays: 0,
      absentDays: 0,
      approvedLeaveDays: 0,
      attendancePercentage: 100.0,
      totalCalendarDays: daysInMonth,
      elapsedWorkingDays: 0,
      sundaysCount: 0,
      holidaysCount: 0,
      isFutureMonth: true,
      dailyBreakdown: [],
    };
  }

  // Generate all calendar dates in the elapsed period
  const elapsedDates = generateDateRange(startDate, elapsedEndDate);

  // Fetch active company holidays in this period
  const leaveYear = `${yearNum}`;
  const holidays = await db.query(
    'SELECT date, name FROM company_holidays WHERE (leave_year = ? OR leave_year = ?) AND is_active = 1',
    [leaveYear, `${yearNum}-${yearNum + 1}`]
  );
  const holidayMap = new Map();
  for (const h of holidays) {
    holidayMap.set(h.date, h.name);
  }

  // Fetch unique approved present dates for this user in the target month
  // Strictly 1 present day per calendar date, regardless of multiple check-in/out records
  const presentDatesQuery = await db.query(
    `SELECT DISTINCT date 
     FROM attendance 
     WHERE user_id = ? AND date >= ? AND date <= ?
       AND (status IS NULL OR status NOT IN ('cancelled', 'rejected'))
       AND (review_status IS NULL OR review_status NOT IN ('pending_review', 'rejected'))`,
    [userId, startDate, elapsedEndDate]
  );
  const presentDatesSet = new Set(presentDatesQuery.map((r) => r.date));

  // Fetch approved leaves in this period
  const approvedLeavesQuery = await db.query(
    `SELECT start_date, end_date, days_deducted 
     FROM leave_records 
     WHERE user_id = ? AND status = 'confirmed' 
       AND NOT (end_date < ? OR start_date > ?)`,
    [userId, startDate, elapsedEndDate]
  );
  const approvedLeaveDatesSet = new Set();
  for (const lr of approvedLeavesQuery) {
    const lStart = lr.start_date < startDate ? startDate : lr.start_date;
    const lEnd = lr.end_date > elapsedEndDate ? elapsedEndDate : lr.end_date;
    try {
      const dates = generateDateRange(lStart, lEnd);
      for (const d of dates) {
        approvedLeaveDatesSet.add(d);
      }
    } catch (_) {}
  }

  let workingDays = 0;
  let sundaysCount = 0;
  let holidaysCount = 0;
  const dailyBreakdown = [];

  for (const dStr of elapsedDates) {
    const isSun = isSunday(dStr);
    const holidayName = holidayMap.get(dStr);
    const isPresent = presentDatesSet.has(dStr);
    const isLeave = !isPresent && approvedLeaveDatesSet.has(dStr);

    let dayCategory = 'WORKING_DAY';
    if (isSun) {
      sundaysCount++;
      dayCategory = 'SUNDAY';
    } else if (holidayName) {
      holidaysCount++;
      dayCategory = 'HOLIDAY';
    } else {
      workingDays++;
    }

    let status = 'ABSENT';
    if (isPresent) {
      status = 'PRESENT';
    } else if (isLeave) {
      status = 'APPROVED_LEAVE';
    } else if (isSun) {
      status = 'SUNDAY';
    } else if (holidayName) {
      status = 'HOLIDAY';
    }

    dailyBreakdown.push({
      date: dStr,
      status,
      category: dayCategory,
      holidayName: holidayName || null,
      isPresent,
      isWorkingDay: !isSun && !holidayName,
    });
  }

  // Count present dates on working days or any approved present day
  const presentDays = presentDatesSet.size;

  // Approved leave on eligible working days where employee was not present
  let approvedLeaveDays = 0;
  for (const dStr of elapsedDates) {
    if (!isSunday(dStr) && !holidayMap.has(dStr) && !presentDatesSet.has(dStr) && approvedLeaveDatesSet.has(dStr)) {
      approvedLeaveDays++;
    }
  }

  // Absent days: working days - present days - approved leaves
  const absentDays = Math.max(0, workingDays - presentDays - approvedLeaveDays);

  // Attendance percentage based strictly on actual eligible working days elapsed
  const attendancePercentage = workingDays > 0
    ? Number(((presentDays / workingDays) * 100).toFixed(1))
    : 100.0;

  // Annual cumulative unique present days for salaried leave calendar (1 Jan - 31 Dec)
  const leaveYearStart = `${yearNum}-01-01`;
  const leaveYearEnd = `${yearNum}-12-31`;
  const cumulativeRow = await db.get(
    `SELECT COUNT(DISTINCT date) as count
     FROM attendance
     WHERE user_id = ? AND date >= ? AND date <= ?
       AND (status IS NULL OR status NOT IN ('cancelled', 'rejected'))
       AND (review_status IS NULL OR review_status NOT IN ('pending_review', 'rejected'))`,
    [userId, leaveYearStart, leaveYearEnd]
  );
  const cumulativePresentDaysYear = cumulativeRow?.count || 0;
  const is26DayRequirementMet = cumulativePresentDaysYear >= 26;

  return {
    success: true,
    userId,
    employeeName: user.full_name,
    userName: user.full_name,
    department: user.department || 'General',
    isSalaried: true,
    salaryType: 'fixed_monthly',
    month: targetMonth,
    yearMonth: targetMonth,
    monthName,
    presentDays,
    workingDays,
    totalWorkingDays: workingDays,
    absentDays,
    approvedLeaveDays,
    attendancePercentage,
    totalCalendarDays: daysInMonth,
    elapsedCalendarDays: elapsedDates.length,
    sundaysCount,
    holidaysCount,
    presentDates: Array.from(presentDatesSet).sort(),
    cumulativePresentDaysYear,
    requiredPresentDaysYear: 26,
    is26DayRequirementMet,
    isFutureMonth: false,
    dailyBreakdown,
  };
}

/**
 * Get monthly attendance summary for all active employees (Admin overview)
 * Strictly filters to SALARIED employees as requested (daily-wage excluded from salaried monthly summary)
 * @param {string} [yearMonth] e.g. '2026-11'
 * @param {string} [search] search term
 */
async function getAllEmployeesMonthlySummary(yearMonth, search = '') {
  const todayStr = getCompanyDate();
  const targetMonth = yearMonth || todayStr.substring(0, 7);

  let sql = `
    SELECT u.id, u.full_name, u.email, u.department, u.role, esc.salary_type
    FROM users u
    JOIN employee_salary_configs esc ON esc.user_id = u.id AND esc.salary_type = 'fixed_monthly'
    WHERE u.role = 'employee' AND u.is_active = 1
  `;
  const params = [];
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    sql += " AND (u.full_name LIKE ? OR u.email LIKE ? OR CAST(u.id AS TEXT) LIKE ?)";
    params.push(term, term, term);
  }
  sql += " ORDER BY u.full_name ASC";

  const employees = await db.query(sql, params);

  const summaries = [];
  for (const emp of employees) {
    const sum = await getEmployeeMonthlySummary(emp.id, targetMonth);

    summaries.push({
      userId: emp.id,
      employeeId: emp.id,
      employeeName: emp.full_name,
      fullName: emp.full_name,
      department: emp.department || 'General',
      email: emp.email,
      salaryType: 'fixed_monthly',
      isSalaried: true,
      month: targetMonth,
      yearMonth: targetMonth,
      monthName: sum.monthName,
      presentDays: sum.presentDays,
      workingDays: sum.workingDays,
      absentDays: sum.absentDays,
      approvedLeaveDays: sum.approvedLeaveDays,
      attendancePercentage: sum.attendancePercentage,
      cumulativePresentDaysYear: sum.cumulativePresentDaysYear,
      requiredPresentDaysYear: sum.requiredPresentDaysYear,
      is26DayRequirementMet: sum.is26DayRequirementMet,
    });
  }

  // Get first summary metadata for working days / sundays / holidays
  const sampleSum = summaries.length > 0 ? await getEmployeeMonthlySummary(employees[0].id, targetMonth) : null;

  return {
    success: true,
    month: targetMonth,
    yearMonth: targetMonth,
    monthName: sampleSum?.monthName || targetMonth,
    totalWorkingDays: sampleSum?.totalWorkingDays ?? 0,
    sundaysCount: sampleSum?.sundaysCount ?? 0,
    holidaysCount: sampleSum?.holidaysCount ?? 0,
    totalEmployees: summaries.length,
    employees: summaries,
    summaries,
  };
}

module.exports = {
  getEmployeeMonthlySummary,
  getAllEmployeesMonthlySummary,
};
