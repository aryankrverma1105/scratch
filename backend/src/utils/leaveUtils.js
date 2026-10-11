const { getCompanyDate } = require('./timeUtils');

/**
 * Get the Leave Year code (e.g. '2026-2027') for a given date in YYYY-MM-DD or Date object.
 * Company leave year runs 1 April through 31 March.
 * @param {string|Date} [dateInput]
 * @returns {string} e.g. '2026-2027'
 */
function getLeaveYear(dateInput) {
  let dateStr;
  if (!dateInput) {
    dateStr = getCompanyDate();
  } else if (dateInput instanceof Date) {
    dateStr = getCompanyDate(dateInput);
  } else if (typeof dateInput === 'string') {
    dateStr = dateInput.substring(0, 10);
  } else {
    dateStr = getCompanyDate();
  }

  const [year, month] = dateStr.split('-').map(Number);
  if (month >= 4) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

/**
 * Get start and end date of a leave year
 * @param {string} leaveYearCode '2026-2027'
 * @returns {{ startDate: string, endDate: string }}
 */
function getLeaveYearRange(leaveYearCode) {
  const parts = (leaveYearCode || getLeaveYear()).split('-');
  const startYear = parseInt(parts[0], 10);
  const endYear = parseInt(parts[1], 10);
  return {
    startDate: `${startYear}-04-01`,
    endDate: `${endYear}-03-31`,
  };
}

/**
 * Check if a given date string 'YYYY-MM-DD' is a Sunday
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {boolean}
 */
function isSunday(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return d.getUTCDay() === 0;
}

/**
 * Generate an array of all date strings 'YYYY-MM-DD' between startDate and endDate inclusive
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate 'YYYY-MM-DD'
 * @returns {string[]}
 */
function generateDateRange(startDate, endDate) {
  const dates = [];
  const [sY, sM, sD] = startDate.split('-').map(Number);
  const [eY, eM, eD] = endDate.split('-').map(Number);

  let cur = new Date(Date.UTC(sY, sM - 1, sD, 12, 0, 0));
  const end = new Date(Date.UTC(eY, eM - 1, eD, 12, 0, 0));

  if (cur.getTime() > end.getTime()) {
    throw new Error('Start date must be before or equal to end date');
  }

  while (cur.getTime() <= end.getTime()) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Calculate leave duration breakdown:
 * - Calendar days (used for 7-day continuous check)
 * - Sundays count
 * - Company holidays count
 * - Working days count (actual deduction from earned leave balance)
 * @param {string} startDate
 * @param {string} endDate
 * @param {Set<string>|string[]} [holidays]
 * @returns {object}
 */
function calculateLeaveBreakdown(startDate, endDate, holidays = new Set()) {
  const holidaySet = holidays instanceof Set ? holidays : new Set(holidays || []);
  const dates = generateDateRange(startDate, endDate);
  const calendarDays = dates.length;

  const sundayDates = [];
  const holidayDates = [];
  const workingDates = [];

  for (const date of dates) {
    if (isSunday(date)) {
      sundayDates.push(date);
    } else if (holidaySet.has(date)) {
      holidayDates.push(date);
    } else {
      workingDates.push(date);
    }
  }

  return {
    calendarDays,
    workingDays: workingDates.length,
    sundaysCount: sundayDates.length,
    holidaysCount: holidayDates.length,
    daysDeducted: workingDates.length, // Sundays & fixed holidays do NOT consume earned leave
    dates,
    workingDates,
    sundayDates,
    holidayDates,
  };
}

/**
 * Validate maximum 7 continuous calendar days and check for overlapping or adjacent bypasses.
 * @param {string} startDate
 * @param {string} endDate
 * @param {Array<{start_date: string, end_date: string, status?: string}>} existingLeaves
 */
function validateContinuousLeave(startDate, endDate, existingLeaves = []) {
  const dates = generateDateRange(startDate, endDate);
  const calendarDays = dates.length;

  if (calendarDays > 7) {
    throw new Error(
      `Leave period cannot exceed 7 consecutive calendar days (requested ${calendarDays} days: ${startDate} to ${endDate}).`
    );
  }

  const requestedSet = new Set(dates);
  const confirmedLeaves = existingLeaves.filter((l) => l.status !== 'cancelled');

  // Check for exact overlap
  for (const existing of confirmedLeaves) {
    const existingDates = generateDateRange(existing.start_date, existing.end_date);
    for (const d of existingDates) {
      if (requestedSet.has(d)) {
        throw new Error(
          `Leave request overlaps with an existing confirmed leave from ${existing.start_date} to ${existing.end_date}.`
        );
      }
    }
  }

  // Check for adjacent bypasses (combined contiguous span > 7 days)
  // Find previous adjacent date (day before startDate) and next adjacent date (day after endDate)
  const [sY, sM, sD] = startDate.split('-').map(Number);
  const dayBefore = new Date(Date.UTC(sY, sM - 1, sD, 12, 0, 0));
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const dayBeforeStr = dayBefore.toISOString().substring(0, 10);

  const [eY, eM, eD] = endDate.split('-').map(Number);
  const dayAfter = new Date(Date.UTC(eY, eM - 1, eD, 12, 0, 0));
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const dayAfterStr = dayAfter.toISOString().substring(0, 10);

  // Expand contiguous span backwards
  let spanStart = startDate;
  let changed = true;
  while (changed) {
    changed = false;
    for (const existing of confirmedLeaves) {
      if (existing.end_date === dayBeforeStr || (existing.end_date < spanStart && areDatesAdjacent(existing.end_date, spanStart))) {
        spanStart = existing.start_date;
        changed = true;
      }
    }
  }

  // Expand contiguous span forwards
  let spanEnd = endDate;
  changed = true;
  while (changed) {
    changed = false;
    for (const existing of confirmedLeaves) {
      if (existing.start_date === dayAfterStr || (existing.start_date > spanEnd && areDatesAdjacent(spanEnd, existing.start_date))) {
        spanEnd = existing.end_date;
        changed = true;
      }
    }
  }

  if (spanStart !== startDate || spanEnd !== endDate) {
    const combinedDays = generateDateRange(spanStart, spanEnd).length;
    if (combinedDays > 7) {
      throw new Error(
        `Leave request cannot be adjacent to existing leave. Combined continuous period from ${spanStart} to ${spanEnd} would be ${combinedDays} calendar days (maximum allowed is 7).`
      );
    }
  }

  return true;
}

function areDatesAdjacent(d1Str, d2Str) {
  const [y1, m1, day1] = d1Str.split('-').map(Number);
  const d1 = new Date(Date.UTC(y1, m1 - 1, day1, 12, 0, 0));
  d1.setUTCDate(d1.getUTCDate() + 1);
  return d1.toISOString().substring(0, 10) === d2Str;
}

/**
 * Check if a calendar month 'YYYY-MM' is fully completed as of current date
 * A month is completed once the current date has passed its last day.
 * @param {string} yearMonth 'YYYY-MM'
 * @param {string} [currentDateStr]
 * @returns {boolean}
 */
function isMonthCompleted(yearMonth, currentDateStr = getCompanyDate()) {
  const [y, m] = yearMonth.split('-').map(Number);
  // Last day of month
  const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDayStr = `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;
  return currentDateStr > lastDayStr;
}

/**
 * Get all 12 calendar month strings for a leave year (e.g. ['2026-04', ..., '2027-03'])
 * @param {string} leaveYearCode '2026-2027'
 * @returns {string[]}
 */
function getMonthsInLeaveYear(leaveYearCode) {
  const parts = (leaveYearCode || getLeaveYear()).split('-');
  const startYear = parseInt(parts[0], 10);
  const endYear = parseInt(parts[1], 10);
  const months = [];

  for (let m = 4; m <= 12; m++) {
    months.push(`${startYear}-${String(m).padStart(2, '0')}`);
  }
  for (let m = 1; m <= 3; m++) {
    months.push(`${endYear}-${String(m).padStart(2, '0')}`);
  }

  return months;
}

module.exports = {
  getLeaveYear,
  getLeaveYearRange,
  isSunday,
  generateDateRange,
  calculateLeaveBreakdown,
  validateContinuousLeave,
  isMonthCompleted,
  getMonthsInLeaveYear,
};
