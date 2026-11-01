const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const db = require(path.resolve('D:/Scratch/backend/src/db'));
const salaryService = require(path.resolve('D:/Scratch/backend/src/services/salaryService'));

test('Attendance-Based Salary & Distinct Daily Attendance Suite', async (t) => {
  await db.initDatabase();

  const ts = Date.now();
  let adminUser, anilUser, raviUser, sagarUser, fixedUser;

  await t.test('Setup test employees with exact configurations', async () => {
    // 1. Create Admin
    const adminRes = await db.run(
      `INSERT INTO users (email, full_name, role, department, password_hash, is_active)
       VALUES (?, ?, 'admin', 'Management', 'hash', 1)`,
      [`admin_${ts}@test.com`, 'Admin Test']
    );
    adminUser = { id: adminRes.lastID };

    // 2. Anil Munda: Daily Wage ?781
    const anilRes = await db.run(
      `INSERT INTO users (email, full_name, role, department, password_hash, is_active)
       VALUES (?, ?, 'employee', 'Engineering', 'hash', 1)`,
      [`anil_${ts}@test.com`, 'Anil Munda']
    );
    anilUser = { id: anilRes.lastID };
    await salaryService.upsertEmployeeSalaryConfig({
      userId: anilUser.id,
      salaryType: 'daily_wage',
      dailyWageOverride: 781.0,
      dailyIncentiveRate: 0,
      effectiveDate: '2026-11-01',
      createdBy: adminUser.id,
    });

    // 3. Ravi Munda: Daily Wage ?918
    const raviRes = await db.run(
      `INSERT INTO users (email, full_name, role, department, password_hash, is_active)
       VALUES (?, ?, 'employee', 'site engineer', 'hash', 1)`,
      [`ravi_${ts}@test.com`, 'Ravi Munda']
    );
    raviUser = { id: raviRes.lastID };
    await salaryService.upsertEmployeeSalaryConfig({
      userId: raviUser.id,
      salaryType: 'daily_wage',
      dailyWageOverride: 918.0,
      dailyIncentiveRate: 0,
      effectiveDate: '2026-11-01',
      createdBy: adminUser.id,
    });

    // 4. Sagar Toppo: Daily Wage ?781
    const sagarRes = await db.run(
      `INSERT INTO users (email, full_name, role, department, password_hash, is_active)
       VALUES (?, ?, 'employee', 'Engineering', 'hash', 1)`,
      [`sagar_${ts}@test.com`, 'Sagar Toppo']
    );
    sagarUser = { id: sagarRes.lastID };
    await salaryService.upsertEmployeeSalaryConfig({
      userId: sagarUser.id,
      salaryType: 'daily_wage',
      dailyWageOverride: 781.0,
      dailyIncentiveRate: 0,
      effectiveDate: '2026-11-01',
      createdBy: adminUser.id,
    });

    // 5. Fixed Monthly: ?26,000 basic
    const fixedRes = await db.run(
      `INSERT INTO users (email, full_name, role, department, password_hash, is_active)
       VALUES (?, ?, 'employee', 'Office', 'hash', 1)`,
      [`fixed_${ts}@test.com`, 'Fixed Employee']
    );
    fixedUser = { id: fixedRes.lastID };
    await salaryService.upsertEmployeeSalaryConfig({
      userId: fixedUser.id,
      salaryType: 'fixed_monthly',
      monthlyBasicSalary: 26000.0,
      effectiveDate: '2026-11-01',
      createdBy: adminUser.id,
    });
  });

  await t.test('1. Anil Munda attendance on Sunday 2026-11-01 calculates correct non-zero salary', async () => {
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_out_time, status)
       VALUES (?, '2026-11-01', '2026-11-01T03:55:00.689Z', 23.44, 85.41, '2026-11-01T13:09:58.337Z', 'checked_out')`,
      [anilUser.id]
    );

    const calc = await salaryService.calculateSalaryForEmployee(anilUser.id, '2026-11');
    assert.strictEqual(calc.presentDays, 1, 'Present days should be 1');
    assert.strictEqual(calc.payableDays, 1, 'Payable days should be 1');
    assert.strictEqual(calc.basicSalary, 781.0, 'Basic salary should be ?781');
    assert.strictEqual(calc.employeeEpf, 93.72, 'EPF 12% should be ?93.72');
    assert.strictEqual(calc.employeeEsic, 5.86, 'ESIC 0.75% should be ?5.86');
    assert.strictEqual(calc.netSalary, 681.42, 'Net salary should be ?681.42');
  });

  await t.test('2. Ravi Munda & Sagar Toppo on Sunday 2026-11-01 calculate correct non-zero salary', async () => {
    // Ravi: ?918
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_out_time, status)
       VALUES (?, '2026-11-01', '2026-11-01T03:18:01.287Z', 23.43, 85.41, '2026-11-01T13:08:58.882Z', 'checked_out')`,
      [raviUser.id]
    );
    const raviCalc = await salaryService.calculateSalaryForEmployee(raviUser.id, '2026-11');
    assert.strictEqual(raviCalc.presentDays, 1);
    assert.strictEqual(raviCalc.payableDays, 1);
    assert.strictEqual(raviCalc.basicSalary, 918.0);
    assert.strictEqual(raviCalc.employeeEpf, 110.16);
    assert.strictEqual(raviCalc.employeeEsic, 6.89);
    assert.strictEqual(raviCalc.netSalary, 800.95);

    // Sagar: ?781
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_out_time, status)
       VALUES (?, '2026-11-01', '2026-11-01T03:18:14.582Z', 23.43, 85.41, '2026-11-01T13:41:11.236Z', 'checked_out')`,
      [sagarUser.id]
    );
    const sagarCalc = await salaryService.calculateSalaryForEmployee(sagarUser.id, '2026-11');
    assert.strictEqual(sagarCalc.presentDays, 1);
    assert.strictEqual(sagarCalc.payableDays, 1);
    assert.strictEqual(sagarCalc.basicSalary, 781.0);
    assert.strictEqual(sagarCalc.netSalary, 681.42);
  });

  await t.test('3. Multiple check-ins & check-outs in ONE day count as strictly 1 attendance day', async () => {
    const multiUserRes = await db.run(
      `INSERT INTO users (email, full_name, role, department, password_hash, is_active)
       VALUES (?, ?, 'employee', 'Engineering', 'hash', 1)`,
      [`multi_${ts}@test.com`, 'Multi Checkin User']
    );
    const multiUserId = multiUserRes.lastID;
    await salaryService.upsertEmployeeSalaryConfig({
      userId: multiUserId,
      salaryType: 'daily_wage',
      dailyWageOverride: 500.0,
      effectiveDate: '2026-11-01',
      createdBy: adminUser.id,
    });

    // Session 1: 09:00 - 11:00
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_out_time, status)
       VALUES (?, '2026-11-01', '2026-11-01T03:30:00Z', 23.43, 85.41, '2026-11-01T05:30:00Z', 'checked_out')`,
      [multiUserId]
    );
    // Session 2: 12:00 - 14:00
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_out_time, status)
       VALUES (?, '2026-11-01', '2026-11-01T06:30:00Z', 23.43, 85.41, '2026-11-01T08:30:00Z', 'checked_out')`,
      [multiUserId]
    );
    // Session 3: 15:00 - 18:00
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_out_time, status)
       VALUES (?, '2026-11-01', '2026-11-01T09:30:00Z', 23.43, 85.41, '2026-11-01T12:30:00Z', 'checked_out')`,
      [multiUserId]
    );

    const multiCalc = await salaryService.calculateSalaryForEmployee(multiUserId, '2026-11');
    assert.strictEqual(multiCalc.presentDays, 1, 'Total check-in events: 3, but present days must be strictly 1');
    assert.strictEqual(multiCalc.payableDays, 1, 'Payable days must be strictly 1');
    assert.strictEqual(multiCalc.basicSalary, 500.0, 'Must be paid for only ONE day, not three (?500 vs ?1500)');
  });

  await t.test('4. Attendance on different calendar dates increments distinct attendance days', async () => {
    // Add a second attendance day on 2026-11-02 for Anil Munda
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_out_time, status)
       VALUES (?, '2026-11-02', '2026-11-02T03:30:00Z', 23.43, 85.41, '2026-11-02T12:30:00Z', 'checked_out')`,
      [anilUser.id]
    );
    const calc2Days = await salaryService.calculateSalaryForEmployee(anilUser.id, '2026-11');
    assert.strictEqual(calc2Days.presentDays, 2, '2 distinct dates -> 2 present days');
    assert.strictEqual(calc2Days.payableDays, 2, '2 distinct dates -> 2 payable days');
    assert.strictEqual(calc2Days.basicSalary, 1562.0, '2 days * ?781 = ?1562');
  });

  await t.test('5. Missing checkout (checked_in status) counts as a valid attendance day', async () => {
    const openUserRes = await db.run(
      `INSERT INTO users (email, full_name, role, department, password_hash, is_active)
       VALUES (?, ?, 'employee', 'Engineering', 'hash', 1)`,
      [`open_${ts}@test.com`, 'Open Shift User']
    );
    const openUserId = openUserRes.lastID;
    await salaryService.upsertEmployeeSalaryConfig({
      userId: openUserId,
      salaryType: 'daily_wage',
      dailyWageOverride: 600.0,
      effectiveDate: '2026-11-01',
      createdBy: adminUser.id,
    });

    // Checked in without checkout
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, status)
       VALUES (?, '2026-11-01', '2026-11-01T04:00:00Z', 23.43, 85.41, 'checked_in')`,
      [openUserId]
    );

    const openCalc = await salaryService.calculateSalaryForEmployee(openUserId, '2026-11');
    assert.strictEqual(openCalc.presentDays, 1, 'Checked-in shift without checkout must count as 1 present day');
    assert.strictEqual(openCalc.payableDays, 1);
    assert.strictEqual(openCalc.basicSalary, 600.0);
  });

  await t.test('6. Cancelled or rejected attendance is excluded from payable days', async () => {
    const rejUserRes = await db.run(
      `INSERT INTO users (email, full_name, role, department, password_hash, is_active)
       VALUES (?, ?, 'employee', 'Engineering', 'hash', 1)`,
      [`rej_${ts}@test.com`, 'Rejected User']
    );
    const rejUserId = rejUserRes.lastID;
    await salaryService.upsertEmployeeSalaryConfig({
      userId: rejUserId,
      salaryType: 'daily_wage',
      dailyWageOverride: 600.0,
      effectiveDate: '2026-11-01',
      createdBy: adminUser.id,
    });

    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, status)
       VALUES (?, '2026-11-01', '2026-11-01T04:00:00Z', 23.43, 85.41, 'rejected')`,
      [rejUserId]
    );

    const rejCalc = await salaryService.calculateSalaryForEmployee(rejUserId, '2026-11');
    assert.strictEqual(rejCalc.presentDays, 0, 'Rejected attendance must not count');
    assert.strictEqual(rejCalc.payableDays, 0);
    assert.strictEqual(rejCalc.basicSalary, 0.0);
  });

  await t.test('7. Fixed monthly employee with valid attendance earns non-zero salary without future absence deduction', async () => {
    // Attendance on 2026-11-01 and today (2026-11-02)
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_out_time, status)
       VALUES (?, '2026-11-01', '2026-11-01T04:00:00Z', 23.43, 85.41, '2026-11-01T12:00:00Z', 'checked_out')`,
      [fixedUser.id]
    );
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_out_time, status)
       VALUES (?, '2026-11-02', '2026-11-02T04:00:00Z', 23.43, 85.41, '2026-11-02T12:00:00Z', 'checked_out')`,
      [fixedUser.id]
    );

    const fixedCalc = await salaryService.calculateSalaryForEmployee(fixedUser.id, '2026-11');
    assert.strictEqual(fixedCalc.presentDays, 2, 'Fixed monthly employee has 2 present days');
    assert.strictEqual(fixedCalc.payableDays, 2);
    assert.strictEqual(fixedCalc.absentDays, 0, 'Future days in current month (Nov 3-30) must not be counted as absent');
    assert.ok(fixedCalc.grossSalary > 0, 'Gross salary must be greater than 0');
    assert.ok(fixedCalc.netSalary > 0, 'Net salary must be greater than 0');
  });
});
