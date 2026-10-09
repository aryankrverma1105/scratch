const config = require('../config');

/**
 * Get current date string (YYYY-MM-DD) formatted in the company timezone
 * @param {Date|string|number} [date=new Date()]
 * @param {string} [timeZone=config.COMPANY_TZ]
 * @returns {string} YYYY-MM-DD
 */
function getCompanyDate(date = new Date(), timeZone = config.COMPANY_TZ || 'Asia/Kolkata') {
  const d = date instanceof Date ? date : new Date(date);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

/**
 * Get UTC range [startOfDayUtc, nextDayUtc] for a given date in company timezone.
 * Used for precise range queries: timestamp >= startUtc AND timestamp < nextDayUtc
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} [timeZone=config.COMPANY_TZ]
 * @returns {[string, string]} [startUtcIso, nextDayUtcIso]
 */
function getDayRangeUtc(dateStr, timeZone = config.COMPANY_TZ || 'Asia/Kolkata') {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    dateStr = getCompanyDate(new Date(), timeZone);
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const dStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

  // Determine timezone offset difference independent of host timezone
  const utcDate = new Date(dStart.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(dStart.toLocaleString('en-US', { timeZone }));
  const diffMs = tzDate.getTime() - utcDate.getTime();

  const startUtc = new Date(dStart.getTime() - diffMs);
  const nextDayUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  return [startUtc.toISOString(), nextDayUtc.toISOString()];
}

/**
 * Normalize timestamp to UTC ISO-8601 string.
 * Rejects timestamps more than 5 minutes in the future.
 * @param {string|number|Date} input
 * @returns {string} ISO-8601 UTC string
 */
function normalizeTimestamp(input) {
  if (!input) return new Date().toISOString();
  const d = new Date(input);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid timestamp format');
  }
  const maxFuture = Date.now() + 5 * 60 * 1000;
  if (d.getTime() > maxFuture) {
    throw new Error('Timestamp cannot be more than 5 minutes in the future');
  }
  return d.toISOString();
}

module.exports = {
  getCompanyDate,
  getDayRangeUtc,
  normalizeTimestamp,
};
