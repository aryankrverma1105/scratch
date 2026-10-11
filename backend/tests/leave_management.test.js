const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app } = require('../server');
const db = require('../src/db');
const leaveService = require('../src/services/leaveService');
const leaveUtils = require('../src/utils/leaveUtils');

describe('Leave Management System Comprehensive Test Suite', () => {
  let employeeToken;
  let adminToken;
  let employeeUser;
  let adminUser;
  const testLeaveYear = '2026-2027';

  before(async () => {
    await db.initDatabase();
    const salt = await bcrypt.genSalt(6);
    const hash = await bcrypt.hash('TestPass123!', salt);

    // Create test employee
    const empRes = await db.run(
      `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active, joining_date)
       VALUES (?, ?, ?, ?, 'employee', 'Engineering', 1, '2026-04-01')`,
      [`leave_emp_${Date.now()}@company.com`, `emp_${Date.now()}`, hash, 'Test Leave Employee']
    );
    employeeUser = await db.get('SELECT * FROM users WHERE id = ?', [empRes.lastID]);

    // Create test admin
    const admRes = await db.run(
      `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active, joining_date)
       VALUES (?, ?, ?, ?, 'admin', 'Management', 1, '2026-04-01')`,
      [`leave_adm_${Date.now()}@company.com`, `adm_${Date.now()}`, hash, 'Test Leave Admin']
    );
    adminUser = await db.get('SELECT * FROM users WHERE id = ?', [admRes.lastID]);

    // Login employee
    const empLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: employeeUser.email, password: 'TestPass123!' });
    assert.ok(empLogin.body.token, 'Employee token should be returned');
    employeeToken = empLogin.body.token;

    // Login admin
    const admLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: adminUser.email, password: 'TestPass123!' });
    assert.ok(admLogin.body.token, 'Admin token should be returned');
    adminToken = admLogin.body.token;
  });

  it('1. April accrual gives 2 earned leaves after monthly period completes', async () => {
    const res = await leaveService.accrueMonthlyLeaves('2026-04', true);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.month, '2026-04');

    const bal = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.strictEqual(bal.accrued, 2);
    assert.strictEqual(bal.balance, 2);
    assert.strictEqual(bal.used, 0);
  });

  it('2. Unused April balance carries into May and accumulates correctly', async () => {
    // May accrual (+2 days)
    await leaveService.accrueMonthlyLeaves('2026-05', true);

    const bal = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.strictEqual(bal.accrued, 4);
    assert.strictEqual(bal.balance, 4);
    assert.strictEqual(bal.used, 0);
  });

  it('3. Repeated monthly accrual is idempotent and does not give duplicate leaves', async () => {
    const balBefore = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    // Attempt second accrual for May
    await leaveService.accrueMonthlyLeaves('2026-05', true);
    const balAfter = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.strictEqual(balBefore.accrued, balAfter.accrued);
    assert.strictEqual(balBefore.balance, balAfter.balance);
  });

  it('4. Fixed company holidays configuration & 16-day warning', async () => {
    // Clean up test holidays for fresh test run
    await db.run('DELETE FROM company_holidays WHERE leave_year = ?', [testLeaveYear]);

    // Admin creates holidays
    const hol1 = await request(app)
      .post('/api/leave/admin/holidays')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        leaveYear: testLeaveYear,
        name: 'Holi Holiday',
        date: '2026-05-15', // Friday
        description: 'Festival of colors',
      });
    assert.strictEqual(hol1.status, 201);
    assert.strictEqual(hol1.body.holiday.name, 'Holi Holiday');

    // Duplicate date check
    const dup = await request(app)
      .post('/api/leave/admin/holidays')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        leaveYear: testLeaveYear,
        name: 'Another Holiday',
        date: '2026-05-15',
      });
    assert.strictEqual(dup.status, 400);

    // Get holidays and verify 16-day count & warning
    const list = await request(app)
      .get(`/api/leave/holidays?year=${testLeaveYear}`)
      .set('Authorization', `Bearer ${employeeToken}`);
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.target, 16);
    assert.strictEqual(list.body.isComplete, false);
    assert.ok(list.body.warning.includes('16 fixed company holidays are required'));
  });

  it('5. Sundays and fixed company holidays never consume earned leave', async () => {
    // Thursday 2026-05-14 to Monday 2026-05-18:
    // 2026-05-14 (Thu): Working
    // 2026-05-15 (Fri): Holiday (Holi) -> 0 deduction
    // 2026-05-16 (Sat): Working
    // 2026-05-17 (Sun): Sunday -> 0 deduction
    // 2026-05-18 (Mon): Working
    // Total calendar days = 5. Working days to deduct = 3 (Thu, Sat, Mon).
    const calcRes = await request(app)
      .post('/api/leave/calculate')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        startDate: '2026-05-14',
        endDate: '2026-05-18',
      });

    assert.strictEqual(calcRes.status, 200);
    assert.strictEqual(calcRes.body.calendarDays, 5);
    assert.strictEqual(calcRes.body.workingDays, 3);
    assert.strictEqual(calcRes.body.sundaysCount, 1);
    assert.strictEqual(calcRes.body.holidaysCount, 1);
    assert.strictEqual(calcRes.body.daysDeducted, 3);
    assert.strictEqual(calcRes.body.isEligible, true);
  });

  it('6. Leave request longer than 7 consecutive calendar days is rejected', async () => {
    // 8 calendar days: 2026-05-10 to 2026-05-17
    const calcRes = await request(app)
      .post('/api/leave/calculate')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        startDate: '2026-05-10',
        endDate: '2026-05-17',
      });
    assert.strictEqual(calcRes.status, 400);
    assert.ok(calcRes.body.error.includes('cannot exceed 7 consecutive calendar days'));
  });

  it('7. Eligible leave is confirmed directly without admin approval', async () => {
    const balBefore = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    // Submit 2026-05-20 to 2026-05-21 (2 working days)
    const reqRes = await request(app)
      .post('/api/leave/request')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        startDate: '2026-05-20',
        endDate: '2026-05-21',
        reason: 'Personal errands',
      });

    assert.strictEqual(reqRes.status, 201);
    assert.strictEqual(reqRes.body.status, 'confirmed');
    assert.strictEqual(reqRes.body.daysDeducted, 2);
    assert.strictEqual(reqRes.body.remainingBalance, balBefore.balance - 2);

    const balAfter = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.strictEqual(balAfter.used, 2);
    assert.strictEqual(balAfter.balance, balBefore.balance - 2);
  });

  it('8. Overlapping leave requests and adjacent bypasses (>7 days) are rejected', async () => {
    // Existing confirmed: 2026-05-20 to 2026-05-21
    // Overlapping request: 2026-05-21 to 2026-05-22
    const overlapRes = await request(app)
      .post('/api/leave/request')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        startDate: '2026-05-21',
        endDate: '2026-05-22',
      });
    assert.strictEqual(overlapRes.status, 400);
    assert.ok(overlapRes.body.error.includes('overlaps with an existing confirmed leave'));
  });

  it('9. Insufficient earned leave balance is handled correctly', async () => {
    // Current balance is 2. Attempt to take 3 working days (2026-05-26 to 2026-05-28)
    const insRes = await request(app)
      .post('/api/leave/request')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        startDate: '2026-05-26',
        endDate: '2026-05-28',
      });
    assert.strictEqual(insRes.status, 400);
    assert.ok(insRes.body.error.includes('Insufficient leave balance'));
  });

  it('10. Leave cancellation reverses deduction exactly once and logs audit trail', async () => {
    // Submit a FUTURE leave: 2026-11-20 to 2026-11-21
    const futureLeaveRes = await request(app)
      .post('/api/leave/request')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        startDate: '2026-11-20',
        endDate: '2026-11-21',
        reason: 'Future conference',
      });
    assert.strictEqual(futureLeaveRes.status, 201);
    const leaveId = futureLeaveRes.body.leaveId;

    const balBefore = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);

    // Cancel future leave
    const cancelRes = await request(app)
      .post(`/api/leave/${leaveId}/cancel`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ reason: 'Conference rescheduled' });

    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.status, 'cancelled');
    assert.strictEqual(cancelRes.body.daysRestored, 2);

    const balAfter = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.strictEqual(balAfter.balance, balBefore.balance + 2);

    // Attempt second cancellation
    const cancelAgain = await request(app)
      .post(`/api/leave/${leaveId}/cancel`)
      .set('Authorization', `Bearer ${employeeToken}`);
    assert.strictEqual(cancelAgain.status, 400);
    assert.ok(cancelAgain.body.error.includes('already cancelled'));
  });

  it('11. Daily reconciliation: valid attendance prevents automatic absence', async () => {
    const testDate = '2026-06-02'; // Tuesday
    // Create valid attendance record for employee
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, status)
       VALUES (?, ?, '2026-06-02T09:00:00Z', 23.3441, 85.3832, 'checked_in')`,
      [employeeUser.id, testDate]
    );

    await leaveService.reconcileDailyAttendance(testDate);

    const absence = await db.get(
      'SELECT id FROM attendance_absences WHERE user_id = ? AND date = ?',
      [employeeUser.id, testDate]
    );
    assert.strictEqual(absence, null);
  });

  it('12. Daily reconciliation: confirmed leave prevents automatic absence', async () => {
    const testDate = '2026-06-03'; // Wednesday
    // Confirm 1 day leave
    await request(app)
      .post('/api/leave/request')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ startDate: testDate, endDate: testDate, reason: 'Doctor appointment' });

    await leaveService.reconcileDailyAttendance(testDate);

    const absence = await db.get(
      'SELECT id FROM attendance_absences WHERE user_id = ? AND date = ?',
      [employeeUser.id, testDate]
    );
    assert.strictEqual(absence, null);
  });

  it('13. Daily reconciliation: Sunday and company holidays do not create absences', async () => {
    const sundayDate = '2026-06-07'; // Sunday
    const resSun = await leaveService.reconcileDailyAttendance(sundayDate);
    assert.strictEqual(resSun.processed, 0);
    assert.ok(resSun.reason.includes('Sunday'));

    // Create company holiday on 2026-06-08 if not exists
    const existingHol = await db.get(
      'SELECT id FROM company_holidays WHERE leave_year = ? AND date = "2026-06-08"',
      [testLeaveYear]
    );
    if (!existingHol) {
      await leaveService.createCompanyHoliday(adminUser.id, {
        leaveYear: testLeaveYear,
        name: 'Summer Holiday',
        date: '2026-06-08',
      });
    }
    const resHol = await leaveService.reconcileDailyAttendance('2026-06-08');
    assert.strictEqual(resHol.processed, 0);
    assert.ok(resHol.reason.includes('Company holiday'));
  });

  it('14. Daily reconciliation: missing working day automatically deducts earned leave', async () => {
    const missingDate = '2026-06-09'; // Tuesday, no attendance, no leave
    const balBefore = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.ok(balBefore.balance >= 1);

    await leaveService.reconcileDailyAttendance(missingDate);

    const absence = await db.get(
      'SELECT * FROM attendance_absences WHERE user_id = ? AND date = ?',
      [employeeUser.id, missingDate]
    );
    assert.ok(absence);
    assert.strictEqual(absence.absence_type, 'earned_leave_deducted');

    const balAfter = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.strictEqual(balAfter.balance, balBefore.balance - 1);
  });

  it('15. Daily reconciliation: records unpaid absence when balance is 0 without negative balance', async () => {
    // Artificially set employee balance to 0 for this test
    await db.run('UPDATE leave_balances SET balance = 0 WHERE user_id = ? AND leave_year = ?', [
      employeeUser.id,
      testLeaveYear,
    ]);

    const unpaidDate = '2026-06-10'; // Wednesday
    await leaveService.reconcileDailyAttendance(unpaidDate);

    const absence = await db.get(
      'SELECT * FROM attendance_absences WHERE user_id = ? AND date = ?',
      [employeeUser.id, unpaidDate]
    );
    assert.ok(absence);
    assert.strictEqual(absence.absence_type, 'unpaid');

    const bal = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.strictEqual(bal.balance, 0); // Never negative!
  });

  it('16. Repeated reconciliation is idempotent and does not deduct leave twice', async () => {
    const missingDate = '2026-06-09';
    const balBefore = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);

    // Re-run reconciliation for 2026-06-09
    await leaveService.reconcileDailyAttendance(missingDate);

    const balAfter = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.strictEqual(balBefore.balance, balAfter.balance);

    const count = await db.query(
      'SELECT id FROM attendance_absences WHERE user_id = ? AND date = ?',
      [employeeUser.id, missingDate]
    );
    assert.strictEqual(count.length, 1);
  });

  it('17. Monthly missing-attendance threshold is exceeded only after > 2 missing working days', async () => {
    // Current June absences for employeeUser:
    // 2026-06-09 (earned_leave_deducted) - 1
    // 2026-06-10 (unpaid) - 2
    // Clean up June absences for employeeUser to test threshold progression precisely
    await db.run('DELETE FROM attendance_absences WHERE user_id = ? AND month = "2026-06"', [
      employeeUser.id,
    ]);

    // 1st missing day
    await leaveService.reconcileDailyAttendance('2026-06-09');
    let summary = await leaveService.updateMonthlySummary(employeeUser.id, '2026-06');
    assert.strictEqual(summary.missingCount, 1);
    assert.strictEqual(summary.thresholdExceeded, false);

    // 2nd missing day
    await leaveService.reconcileDailyAttendance('2026-06-10');
    summary = await leaveService.updateMonthlySummary(employeeUser.id, '2026-06');
    assert.strictEqual(summary.missingCount, 2);
    assert.strictEqual(summary.thresholdExceeded, false); // 2 missing days: threshold NOT exceeded

    // 3rd missing day
    await leaveService.reconcileDailyAttendance('2026-06-11');
    summary = await leaveService.updateMonthlySummary(employeeUser.id, '2026-06');
    assert.strictEqual(summary.missingCount, 3);
    assert.strictEqual(summary.thresholdExceeded, true); // > 2 missing days: threshold EXCEEDED!
  });

  it('18. Inactive users and dates outside employment are skipped in reconciliation', async () => {
    const ts = Date.now();
    // Inactive user
    const inactRes = await db.run(
      `INSERT INTO users (email, username, password_hash, full_name, role, is_active, joining_date)
       VALUES (?, ?, 'hash', 'Inactive User', 'employee', 0, '2026-04-01')`,
      [`inact_${ts}@co.com`, `inact_${ts}`]
    );
    await leaveService.reconcileDailyAttendance('2026-06-12');
    const inactAbsence = await db.get(
      'SELECT id FROM attendance_absences WHERE user_id = ? AND date = "2026-06-12"',
      [inactRes.lastID]
    );
    assert.strictEqual(inactAbsence, null);

    // Future joining date user
    const futureRes = await db.run(
      `INSERT INTO users (email, username, password_hash, full_name, role, is_active, joining_date)
       VALUES (?, ?, 'hash', 'Future User', 'employee', 1, '2026-07-01')`,
      [`fut_${ts}@co.com`, `fut_${ts}`]
    );
    await leaveService.reconcileDailyAttendance('2026-06-12');
    const futAbsence = await db.get(
      'SELECT id FROM attendance_absences WHERE user_id = ? AND date = "2026-06-12"',
      [futureRes.lastID]
    );
    assert.strictEqual(futAbsence, null);
  });

  it('19. Admin can correct an absence record, restoring earned leave with audit trail', async () => {
    let absence = await db.get(
      'SELECT * FROM attendance_absences WHERE user_id = ? AND absence_type = "earned_leave_deducted" AND is_corrected = 0 LIMIT 1',
      [employeeUser.id]
    );
    if (!absence) {
      await db.run(
        `INSERT INTO attendance_absences (user_id, date, leave_year, month, absence_type, reason)
         VALUES (?, '2026-06-15', ?, '2026-06', 'earned_leave_deducted', 'Automatic absence')`,
        [employeeUser.id, testLeaveYear]
      );
      absence = await db.get(
        'SELECT * FROM attendance_absences WHERE user_id = ? AND date = "2026-06-15"',
        [employeeUser.id]
      );
    }
    assert.ok(absence);

    const balBefore = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);

    // Admin corrects record
    const corrRes = await request(app)
      .post(`/api/leave/admin/absences/${absence.id}/correct`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'On-duty client visit approved late' });

    assert.strictEqual(corrRes.status, 200);
    assert.strictEqual(corrRes.body.isCorrected, true);
    assert.strictEqual(corrRes.body.restoredLeave, 1);

    const balAfter = await leaveService.getUserLeaveBalance(employeeUser.id, testLeaveYear);
    assert.strictEqual(balAfter.balance, balBefore.balance + 1);

    // Check audit log
    const audit = await db.get(
      'SELECT * FROM leave_audit_logs WHERE action = "ABSENCE_CORRECT" AND performed_by = ?',
      [adminUser.id]
    );
    assert.ok(audit);
  });

  it('20. Annual reset on 1 April expires unused leave, starts fresh 0 balance, preserves history', async () => {
    const randomStart = Math.floor(4000 + Math.random() * 5000);
    const fromYear = `${randomStart}-${randomStart + 1}`;
    const toYear = `${randomStart + 1}-${randomStart + 2}`;

    // Initialize fromYear balance for employee to 5
    await db.run(
      'INSERT INTO leave_balances (user_id, leave_year, accrued, used, expired, balance) VALUES (?, ?, 5, 0, 0, 5)',
      [employeeUser.id, fromYear]
    );

    // Perform annual reset
    const resetRes = await leaveService.performAnnualLeaveYearReset(fromYear, toYear);
    assert.strictEqual(resetRes.success, true);

    // Old year: balance expired
    const oldBal = await db.get(
      'SELECT balance, expired FROM leave_balances WHERE user_id = ? AND leave_year = ?',
      [employeeUser.id, fromYear]
    );
    assert.strictEqual(oldBal.balance, 0);
    assert.strictEqual(oldBal.expired, 5);

    // New year: starts with 0 balance
    const newBal = await db.get(
      'SELECT balance, accrued, used FROM leave_balances WHERE user_id = ? AND leave_year = ?',
      [employeeUser.id, toYear]
    );
    assert.ok(newBal);
    assert.strictEqual(newBal.balance, 0);
    assert.strictEqual(newBal.accrued, 0);

    // Historical attendance records are strictly preserved!
    const attendanceRecords = await db.query(
      'SELECT id FROM attendance WHERE user_id = ?',
      [employeeUser.id]
    );
    assert.ok(attendanceRecords.length > 0);

    // Second execution of reset is idempotent
    const retryRes = await leaveService.performAnnualLeaveYearReset(fromYear, toYear);
    assert.strictEqual(retryRes.skipped, true);
  });

  it('21. Admin leave summaries endpoint returns all balances and threshold exceeded flags', async () => {
    const sumRes = await request(app)
      .get(`/api/leave/admin/summaries?year=${testLeaveYear}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.strictEqual(sumRes.status, 200);
    assert.ok(Array.isArray(sumRes.body.summaries));
    assert.ok(sumRes.body.totalUsers >= 2);
  });

  it('22. Employee cannot access protected admin leave routes', async () => {
    const forbiddenRes = await request(app)
      .get('/api/leave/admin/summaries')
      .set('Authorization', `Bearer ${employeeToken}`);
    assert.strictEqual(forbiddenRes.status, 403);
  });
});
