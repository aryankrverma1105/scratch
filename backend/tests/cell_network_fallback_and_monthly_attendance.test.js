const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const cellularPositioningService = require('../src/services/cellularPositioningService');
const attendanceSummaryService = require('../src/services/attendanceSummaryService');
const leaveService = require('../src/services/leaveService');
const locationController = require('../src/controllers/locationController');

describe('Cell Network Fallback, Monthly Attendance Summary & Salaried Annual Leave Calendar Tests', () => {
  let salariedUserId = null;
  let dailyWageUserId = null;

  before(async () => {
    // 1. Create a Salaried Test User
    const salRes = await db.run(
      `INSERT INTO users (full_name, email, password_hash, role, department, is_active)
       VALUES ('Salaried Test Emp', 'salaried.test@sologix.com', 'hashed_pass', 'employee', 'Engineering', 1)`
    );
    salariedUserId = salRes.lastID || (await db.get("SELECT id FROM users WHERE email = 'salaried.test@sologix.com'")).id;

    await db.run(
      `INSERT INTO employee_salary_configs (user_id, salary_type, monthly_basic_salary, effective_date)
       VALUES (?, 'fixed_monthly', 45000, '2026-01-01')`,
      [salariedUserId]
    );

    // 2. Create a Daily Wage Test User
    const dailyRes = await db.run(
      `INSERT INTO users (full_name, email, password_hash, role, department, is_active)
       VALUES ('Daily Wage Test Emp', 'dailywage.test@sologix.com', 'hashed_pass', 'employee', 'Operations', 1)`
    );
    dailyWageUserId = dailyRes.lastID || (await db.get("SELECT id FROM users WHERE email = 'dailywage.test@sologix.com'")).id;

    await db.run(
      `INSERT INTO employee_salary_configs (user_id, salary_type, daily_wage_override, effective_date)
       VALUES (?, 'daily_wage', 800, '2026-01-01')`,
      [dailyWageUserId]
    );

    // Ensure leave years exist
    await leaveService.ensureLeaveYearExists('2026');
  });

  after(async () => {
    // Cleanup test data
    const userIds = [salariedUserId, dailyWageUserId].filter(Boolean);
    for (const uid of userIds) {
      await db.run('DELETE FROM attendance WHERE user_id = ?', [uid]);
      await db.run('DELETE FROM location_tracks WHERE user_id = ?', [uid]);
      await db.run('DELETE FROM leave_records WHERE user_id = ?', [uid]);
      await db.run('DELETE FROM leave_balances WHERE user_id = ?', [uid]);
      await db.run('DELETE FROM leave_accruals WHERE user_id = ?', [uid]);
      await db.run('DELETE FROM employee_salary_configs WHERE user_id = ?', [uid]);
      await db.run('DELETE FROM users WHERE id = ?', [uid]);
    }
  });

  // =========================================================================
  // 1. CELLULAR & NETWORK LOCATION TELEMETRY TESTS
  // =========================================================================
  describe('Part 1: Location Source Priority & Telemetry Evaluation', () => {
    it('should correctly normalize location sources into standard taxonomy', () => {
      assert.strictEqual(cellularPositioningService.normalizeLocationSource('gps'), 'GPS');
      assert.strictEqual(cellularPositioningService.normalizeLocationSource('cell_tower'), 'CELL_TOWER');
      assert.strictEqual(cellularPositioningService.normalizeLocationSource('cell_network'), 'CELL_TOWER');
      assert.strictEqual(cellularPositioningService.normalizeLocationSource('network'), 'NETWORK');
      assert.strictEqual(cellularPositioningService.normalizeLocationSource('fused'), 'NETWORK');
      assert.strictEqual(cellularPositioningService.normalizeLocationSource('last_known'), 'LAST_KNOWN');
      assert.strictEqual(cellularPositioningService.normalizeLocationSource('unknown_device'), 'GPS');
    });

    it('should mark locations older than 5 minutes as STALE and stale flag true', () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const status = cellularPositioningService.evaluateLocationStatus({
        timestamp: tenMinutesAgo,
        locationSource: 'GPS',
        isGpsOff: false,
      });

      assert.strictEqual(status, 'STALE');
    });

    it('should mark location as UNAVAILABLE when Location Services is disabled', () => {
      const freshTimestamp = new Date().toISOString();
      const status = cellularPositioningService.evaluateLocationStatus({
        timestamp: freshTimestamp,
        locationSource: 'GPS',
        isGpsOff: true,
        interruptionReason: 'LOCATION_SERVICES_DISABLED',
      });

      assert.strictEqual(status, 'UNAVAILABLE');
    });

    it('should resolve cell tower coordinates or return null without fabrication', async () => {
      // Cell tower without positioning key or provider should return null and not fabricate
      const coords = await cellularPositioningService.resolveCellTowerCoordinates({
        cellId: 12345,
        lac: 6789,
        mcc: 404,
        mnc: 45,
      });

      assert.strictEqual(coords.success, false);
      assert.strictEqual(coords.latitude, undefined);
    });
  });

  // =========================================================================
  // 2. MONTHLY ATTENDANCE SUMMARY TESTS
  // =========================================================================
  describe('Part 2: Monthly Attendance Summary Calculation', () => {
    it('should strictly aggregate multiple check-in sessions on the same IST date as 1 present day', async () => {
      const testDate = '2026-11-04'; // Wednesday

      // Insert session 1: Morning 09:00 - 12:00
      await db.run(
        `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status, review_status)
         VALUES (?, ?, '2026-11-04 03:30:00Z', '2026-11-04 06:30:00Z', 23.3441, 85.3095, 'present', 'approved')`,
        [salariedUserId, testDate]
      );

      // Insert session 2: Afternoon 13:00 - 18:00
      await db.run(
        `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status, review_status)
         VALUES (?, ?, '2026-11-04 07:30:00Z', '2026-11-04 12:30:00Z', 23.3441, 85.3095, 'present', 'approved')`,
        [salariedUserId, testDate]
      );

      // Insert session 3: Evening OT 19:00 - 21:00
      await db.run(
        `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status, review_status)
         VALUES (?, ?, '2026-11-04 13:30:00Z', '2026-11-04 15:30:00Z', 23.3441, 85.3095, 'present', 'approved')`,
        [salariedUserId, testDate]
      );

      const summary = await attendanceSummaryService.getEmployeeMonthlySummary(salariedUserId, '2026-11');
      assert.strictEqual(summary.presentDays, 1, '3 sessions on the same IST date must equal strictly 1 present day');
      assert.ok(summary.presentDates.includes('2026-11-04'));
    });

    it('should exclude Sundays and company holidays from working days count', async () => {
      // In November 2026: Nov 1, Nov 8, Nov 15, Nov 22, Nov 29 are Sundays
      const summary = await attendanceSummaryService.getEmployeeMonthlySummary(salariedUserId, '2026-11');

      assert.strictEqual(summary.yearMonth, '2026-11');
      assert.strictEqual(summary.monthName, 'November 2026');
      assert.ok(summary.sundaysCount >= 1, 'Should count Sundays in elapsed month');
      assert.ok(summary.totalWorkingDays <= summary.elapsedCalendarDays, 'Working days must be <= elapsed days');
      assert.strictEqual(summary.absentDays, summary.totalWorkingDays - summary.presentDays);
      assert.ok(typeof summary.attendancePercentage === 'number');
    });

    it('should return all employees monthly summary with search filtering', async () => {
      const allSummary = await attendanceSummaryService.getAllEmployeesMonthlySummary('2026-11', 'Salaried Test Emp');

      assert.strictEqual(allSummary.success, true);
      assert.strictEqual(allSummary.yearMonth, '2026-11');
      assert.ok(allSummary.employees.length >= 1);
      const emp = allSummary.employees.find(e => e.userId === salariedUserId);
      assert.ok(emp, 'Should find the salaried test employee');
      assert.strictEqual(emp.presentDays, 1);
    });
  });

  // =========================================================================
  // 3. ANNUAL LEAVE CALENDAR FOR SALARIED EMPLOYEES ONLY TESTS
  // =========================================================================
  describe('Part 3: Salaried Annual Leave Calendar (Jan 1 - Dec 31)', () => {
    it('should strictly reject daily-wage employees from salaried annual leave calculation', async () => {
      const calc = await leaveService.calculateLeaveRequest(dailyWageUserId, '2026-11-10', '2026-11-12');

      assert.strictEqual(calc.isSalaried, false);
      assert.strictEqual(calc.isEligible, false);
      assert.ok(calc.ineligibleReason.toLowerCase().includes('salaried'));
    });

    it('should return isSalaried: false and explanatory message on daily-wage leave balance query', async () => {
      const bal = await leaveService.getUserLeaveBalance(dailyWageUserId, '2026');

      assert.strictEqual(bal.isSalaried, false);
      assert.strictEqual(bal.balance, 0);
      assert.strictEqual(bal.accrued, 0);
      assert.ok(bal.message.toLowerCase().includes('salaried'));
    });

    it('should enforce 26 cumulative present days requirement for salaried employees in calendar year', async () => {
      // Salaried employee currently has only 1 present day in 2026
      const calc = await leaveService.calculateLeaveRequest(salariedUserId, '2026-11-10', '2026-11-11');

      assert.strictEqual(calc.isSalaried, true);
      assert.strictEqual(calc.isEligible, false);
      assert.strictEqual(calc.cumulativePresentDays, 1);
      assert.strictEqual(calc.requiredPresentDays, 26);
      assert.ok(calc.ineligibleReason.includes('26 valid present days'));
    });

    it('should return available annual leave calendar years', async () => {
      const years = await leaveService.getAvailableLeaveYears();

      assert.ok(Array.isArray(years));
      assert.ok(years.length >= 3);
      const codes = years.map(y => y.code);
      assert.ok(codes.includes('2026'));
      assert.ok(codes.includes('2025'));
      assert.ok(codes.includes('2024'));
    });

    it('should perform annual leave reset: expire unused balance, preserve history, initialize fresh year', async () => {
      // Clear any prior test audit log for 2026 reset
      await db.run("DELETE FROM leave_audit_logs WHERE action = 'YEAR_RESET'");

      // Create test balance for salaried user in 2025
      await db.run(
        `INSERT OR REPLACE INTO leave_balances (user_id, leave_year, accrued, used, expired, balance)
         VALUES (?, '2025', 10, 4, 0, 6)`,
        [salariedUserId]
      );

      // Perform reset from 2025 to 2026
      const resetResult = await leaveService.performAnnualLeaveYearReset('2025', '2026');
      assert.strictEqual(resetResult.success, true);

      // Verify old 2025 balance is expired
      const oldBal = await db.get('SELECT * FROM leave_balances WHERE user_id = ? AND leave_year = ?', [salariedUserId, '2025']);
      assert.strictEqual(oldBal.balance, 0, 'Unused balance must be 0 in expired year');
      assert.strictEqual(oldBal.expired, 6, 'Expired column must hold the 6 remaining days');

      // Verify fresh 2026 balance initialized
      const newBal = await db.get('SELECT * FROM leave_balances WHERE user_id = ? AND leave_year = ?', [salariedUserId, '2026']);
      assert.ok(newBal, 'New year balance row must exist');
    });
  });
});
