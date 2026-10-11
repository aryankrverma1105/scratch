const cron = require('node-cron');
const config = require('../config');
const { getCompanyDate } = require('../utils/timeUtils');
const { getLeaveYear } = require('../utils/leaveUtils');
const leaveService = require('./leaveService');

function initLeaveCronJobs() {
  const timeZone = config.COMPANY_TZ || 'Asia/Kolkata';

  // 1. Monthly Accrual: Runs on the 1st day of every month at 00:05 AM IST
  // Calculates and accrues 2 earned leaves for the just-completed calendar month
  cron.schedule(
    '5 0 1 * *',
    async () => {
      console.log('⏰ [LEAVE-CRON] Running monthly leave accrual job...');
      try {
        const todayStr = getCompanyDate(new Date(), timeZone);
        const [y, m] = todayStr.split('-').map(Number);
        // Previous month
        let prevYear = y;
        let prevMonth = m - 1;
        if (prevMonth === 0) {
          prevMonth = 12;
          prevYear = y - 1;
        }
        const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
        const res = await leaveService.accrueMonthlyLeaves(prevMonthStr, true);
        console.log(`✅ [LEAVE-CRON] Monthly accrual for ${prevMonthStr} finished:`, res);
      } catch (err) {
        console.error('❌ [LEAVE-CRON] Error during monthly accrual:', err.message);
      }
    },
    { timezone: timeZone }
  );

  // 2. Daily Attendance Reconciliation: Runs daily at 23:30 IST (after 21:00 auto-checkout + grace period)
  // Detects missing attendance on completed working days and records automatic absence
  cron.schedule(
    '30 23 * * *',
    async () => {
      console.log('⏰ [LEAVE-CRON] Running daily attendance reconciliation job...');
      try {
        const todayStr = getCompanyDate(new Date(), timeZone);
        const res = await leaveService.reconcileDailyAttendance(todayStr);
        console.log(`✅ [LEAVE-CRON] Reconciliation for ${todayStr} finished:`, res);
      } catch (err) {
        console.error('❌ [LEAVE-CRON] Error during attendance reconciliation:', err.message);
      }
    },
    { timezone: timeZone }
  );

  // 3. Annual Leave Year Transition: Runs on 1 April at 00:01 AM IST
  // Closes previous leave year, expires unused earned leaves, initializes new leave year
  cron.schedule(
    '1 0 1 4 *',
    async () => {
      console.log('⏰ [LEAVE-CRON] Running annual 1 April leave year reset transition...');
      try {
        const todayStr = getCompanyDate(new Date(), timeZone);
        const [curYear] = todayStr.split('-').map(Number);
        const prevYearCode = `${curYear - 1}-${curYear}`;
        const newYearCode = `${curYear}-${curYear + 1}`;
        const res = await leaveService.performAnnualLeaveYearReset(prevYearCode, newYearCode);
        console.log(`✅ [LEAVE-CRON] Annual reset from ${prevYearCode} to ${newYearCode} finished:`, res);
      } catch (err) {
        console.error('❌ [LEAVE-CRON] Error during annual reset:', err.message);
      }
    },
    { timezone: timeZone }
  );

  // On server startup: catch up any missed completed months in current leave year
  leaveService
    .syncLeaveAccrualsForYear()
    .then((count) => {
      if (count > 0) {
        console.log(`⏰ [LEAVE-CRON] Synced ${count} missing monthly leave accrual(s) on startup.`);
      }
    })
    .catch((err) => {
      console.warn('⚠️ [LEAVE-CRON] Accrual sync check failed on startup:', err.message);
    });

  console.log(`⏰ Leave Management schedulers armed (accrual, reconciliation, annual reset: ${timeZone})`);
}

module.exports = {
  initLeaveCronJobs,
};
