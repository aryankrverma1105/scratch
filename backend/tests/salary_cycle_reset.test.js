const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../server');
const db = require('../src/db');
const salaryService = require('../src/services/salaryService');
const { round2 } = require('../src/services/salaryService');

test('Salary Cycle, Reset, Zero-Balance Start & Monthly Cap Test Suite', async (t) => {
  await db.initDatabase();
  const timestamp = Date.now();

  // Reset test cycles for idempotent runs
  await db.run("DELETE FROM salary_cycles WHERE cycle_code IN ('2026-11-03_2026-12-02', '2026-12-03_2027-01-02')");
  await db.run("INSERT INTO salary_cycles (cycle_code, start_date, end_date, status) VALUES ('2026-11-03_2026-12-02', '2026-11-03', '2026-12-02', 'active')");
  await db.run("DELETE FROM salary_disbursement_batches");
  await db.run("DELETE FROM salary_payments");
  await db.run("DELETE FROM payroll_records WHERE cycle_code IN ('2026-11-03_2026-12-02', '2026-12-03_2027-01-02')");

  // Create test admin
  const adminRes = await db.run(
    `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active)
     VALUES (?, ?, 'dummy_hash', 'Cycle Admin', 'admin', 'Management', 1)`,
    [`cycle_admin_${timestamp}@company.com`, `cyc_adm_${timestamp}`]
  );
  const adminUser = { id: adminRes.lastID, role: 'admin' };

  // Create test fixed monthly employee (₹26,000 basic)
  const empFixedRes = await db.run(
    `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active, joining_date)
     VALUES (?, ?, 'dummy_hash', 'Fixed Cap Employee', 'employee', 'Engineering', 1, '2026-11-01')`,
    [`fixed_cap_${timestamp}@company.com`, `fixed_cap_${timestamp}`]
  );
  const empFixed = { id: empFixedRes.lastID, role: 'employee' };

  await salaryService.upsertEmployeeSalaryConfig({
    userId: empFixed.id,
    salaryType: 'fixed_monthly',
    monthlyBasicSalary: 26000.0,
    effectiveDate: '2026-11-03',
    createdBy: adminUser.id,
  });

  // Create test daily wage employee (₹650 wage)
  const empDailyRes = await db.run(
    `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active, joining_date)
     VALUES (?, ?, 'dummy_hash', 'Daily Cycle Worker', 'employee', 'Operations', 1, '2026-11-01')`,
    [`daily_cycle_${timestamp}@company.com`, `daily_cycle_${timestamp}`]
  );
  const empDaily = { id: empDailyRes.lastID, role: 'employee' };

  await salaryService.upsertEmployeeSalaryConfig({
    userId: empDaily.id,
    salaryType: 'daily_wage',
    dailyWageOverride: 650.0,
    effectiveDate: '2026-11-03',
    createdBy: adminUser.id,
  });

  // Create JWT tokens
  const jwt = require('jsonwebtoken');
  const config = require('../src/config');
  const adminToken = jwt.sign(
    { id: adminUser.id, role: 'admin', email: `cycle_admin_${timestamp}@company.com` },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const empToken = jwt.sign(
    { id: empFixed.id, role: 'employee', email: `fixed_cap_${timestamp}@company.com` },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );

  await t.test('1. Official start date is 3 November 2026 and employees start with zero earnings', async () => {
    const settings = await salaryService.getSalarySettings();
    assert.strictEqual(settings.official_start_date, '2026-11-03');
    assert.strictEqual(settings.cycle_start_day, 3);

    // Calculate salary for initial cycle before any attendance on/after 3 Nov
    const calcFixed = await salaryService.calculateSalaryForEmployee(empFixed.id, '2026-11-03_2026-12-02');
    assert.strictEqual(calcFixed.basicSalary, 0);
    assert.strictEqual(calcFixed.grossSalary, 0);
    assert.strictEqual(calcFixed.netSalary, 0);
    assert.strictEqual(calcFixed.amountDisbursed, 0);
    assert.strictEqual(calcFixed.remainingPayable, 0);

    const calcDaily = await salaryService.calculateSalaryForEmployee(empDaily.id, '2026-11-03_2026-12-02');
    assert.strictEqual(calcDaily.basicSalary, 0);
    assert.strictEqual(calcDaily.grossSalary, 0);
    assert.strictEqual(calcDaily.netSalary, 0);
  });

  await t.test('2. First cycle is 3 November to 2 December 2026, next starts 3 December 2026', () => {
    const cycle1 = salaryService.getSalaryCycleForDate('2026-11-03', 3);
    assert.strictEqual(cycle1.startDate, '2026-11-03');
    assert.strictEqual(cycle1.endDate, '2026-12-02');
    assert.strictEqual(cycle1.cycleCode, '2026-11-03_2026-12-02');

    const cycle2 = salaryService.getNextSalaryCycle('2026-11-03', 3);
    assert.strictEqual(cycle2.startDate, '2026-12-03');
    assert.strictEqual(cycle2.endDate, '2027-01-02');
    assert.strictEqual(cycle2.cycleCode, '2026-12-03_2027-01-02');

    // Payment on 5 December does not change cycle boundaries
    const cycleForPaymentDate = salaryService.getSalaryCycleForDate('2026-12-05', 3);
    assert.strictEqual(cycleForPaymentDate.startDate, '2026-12-03');
    assert.strictEqual(cycleForPaymentDate.endDate, '2027-01-02');
  });

  await t.test('3. Attendance and incentives before 3 November are excluded from salary calculations', async () => {
    // Add attendance and incentive on 2 November (prior to official start date)
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status)
       VALUES (?, '2026-11-02', '2026-11-02T09:00:00Z', '2026-11-02T17:00:00Z', 28.5, 77.3, 'checked_out')`,
      [empDaily.id]
    );
    await db.run(
      `INSERT INTO daily_incentives (user_id, date, amount, description, status, payroll_period, created_by)
       VALUES (?, '2026-11-02', 200, 'Pre-launch incentive', 'approved', '2026-11', ?)`,
      [empDaily.id, adminUser.id]
    );

    const metrics = await salaryService.getAttendanceMetricsForPeriod(empDaily.id, '2026-11-03_2026-12-02');
    assert.strictEqual(metrics.presentDays, 0);

    const calc = await salaryService.calculateSalaryForEmployee(empDaily.id, '2026-11-03_2026-12-02');
    assert.strictEqual(calc.basicSalary, 0);
    assert.strictEqual(calc.incentiveSalary, 0);
    assert.strictEqual(calc.grossSalary, 0);
  });

  await t.test('4. Attendance on 3 December belongs to next cycle and does NOT enter November cycle', async () => {
    // Add attendance on 3 December (boundary check)
    await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status)
       VALUES (?, '2026-12-03', '2026-12-03T09:00:00Z', '2026-12-03T17:00:00Z', 28.5, 77.3, 'checked_out')`,
      [empDaily.id]
    );

    // In Nov 3 - Dec 2 cycle, 3 Dec is NOT present
    const metricsNov = await salaryService.getAttendanceMetricsForPeriod(empDaily.id, '2026-11-03_2026-12-02');
    assert.ok(!metricsNov.presentDates.includes('2026-12-03'));

    // In Dec 3 - Jan 2 cycle, 3 Dec IS present
    const metricsDec = await salaryService.getAttendanceMetricsForPeriod(empDaily.id, '2026-12-03_2027-01-02');
    assert.ok(metricsDec.presentDates.includes('2026-12-03'));
  });

  await t.test('5. Fixed monthly gross salary NEVER exceeds configured monthly salary cap', async () => {
    // Populate working days attendance in Nov cycle (e.g. 26 days)
    for (let i = 3; i <= 28; i++) {
      const dt = `2026-11-${String(i).padStart(2, '0')}`;
      if (new Date(dt).getDay() !== 0) {
        await db.run(
          `INSERT OR IGNORE INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status)
           VALUES (?, ?, '2026-11-03T09:00:00Z', '2026-11-03T17:00:00Z', 28.5, 77.3, 'checked_out')`,
          [empFixed.id, dt]
        );
      }
    }

    // Add extra ₹1,500 approved incentive and ₹1,000 overtime on top
    await db.run(
      `INSERT INTO daily_incentives (user_id, date, amount, description, status, payroll_period, created_by)
       VALUES (?, '2026-11-10', 1500, 'Special project incentive', 'approved', '2026-11-03_2026-12-02', ?)`,
      [empFixed.id, adminUser.id]
    );
    await db.run(
      `INSERT INTO overtime_records (user_id, date, hours, amount, status, payroll_period, created_by, approved_by)
       VALUES (?, '2026-11-12', 10, 1000, 'approved', '2026-11-03_2026-12-02', ?, ?)`,
      [empFixed.id, adminUser.id, adminUser.id]
    );

    const calc = await salaryService.calculateSalaryForEmployee(empFixed.id, '2026-11-03_2026-12-02');

    // Configured cap is ₹26,000
    assert.strictEqual(calc.configuredMonthlyCap, 26000);
    // Calculated gross before cap would be 26,000 + 1,500 + 1,000 = 28,500
    // But grossSalary MUST be capped at ₹26,000!
    assert.strictEqual(calc.grossSalary, 26000);
    assert.ok(calc.grossSalary <= 26000, 'Gross salary must never exceed configured cap');

    // 5% company deduction on 26,000 = 1,300
    assert.strictEqual(calc.gratuityDeduction, 1300);
    // Net salary = 26,000 - 1,300 = 24,700
    assert.strictEqual(calc.netSalary, 24700);
  });

  await t.test('6. Record Salary Disbursement & Advance Cycle works transactionally and creates next cycle', async () => {
    const cycleCode = '2026-11-03_2026-12-02';

    // Call disbursement endpoint as admin
    const res = await request(app)
      .post('/api/salary/admin/cycles/disburse-and-advance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        cycleCode,
        disbursementDate: '2026-12-05',
        paymentMethod: 'bank_transfer',
        notes: 'November 2026 Salary Disbursed',
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.cycleCode, cycleCode);
    assert.strictEqual(res.body.status, 'paid');
    assert.ok(res.body.batchReference.startsWith('DISB-'));

    // Closed cycle must be marked paid
    const closedCycle = await db.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [cycleCode]);
    assert.strictEqual(closedCycle.status, 'paid');

    // Next cycle (2026-12-03 to 2027-01-02) must be created and active
    const nextCycle = await db.get("SELECT * FROM salary_cycles WHERE cycle_code = '2026-12-03_2027-01-02'");
    assert.ok(nextCycle);
    assert.strictEqual(nextCycle.status, 'active');
    assert.strictEqual(nextCycle.total_gross, 0);
    assert.strictEqual(nextCycle.total_disbursed, 0);

    // Attempting to disburse the already paid cycle again must be rejected
    const retryRes = await request(app)
      .post('/api/salary/admin/cycles/disburse-and-advance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cycleCode });
    assert.strictEqual(retryRes.status, 400);
  });

  await t.test('7. Employees cannot access admin cycle endpoints (403 Forbidden)', async () => {
    const res = await request(app)
      .post('/api/salary/admin/cycles/disburse-and-advance')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ cycleCode: '2026-11-03_2026-12-02' });
    assert.strictEqual(res.status, 403);
  });

  await t.test('8. Employee portal displays exact cycle dates, disbursement reference and payment status', async () => {
    const res = await request(app)
      .get('/api/salary/my-salary?cycleCode=2026-11-03_2026-12-02')
      .set('Authorization', `Bearer ${empToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.cycleCode, '2026-11-03_2026-12-02');
    assert.strictEqual(res.body.salary.payment_status, 'paid');
    assert.ok(res.body.salary.disbursement_reference);
    assert.strictEqual(res.body.salary.payment_date, '2026-12-05');
  });

  await t.test('9. Partial payment records remaining liability without creating duplicate earnings', async () => {
    const decCycleCode = '2026-12-03_2027-01-02';

    // Mock an attendance day for daily employee in December
    await db.run(
      `INSERT OR IGNORE INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status)
       VALUES (?, '2026-12-04', '2026-12-04T09:00:00Z', '2026-12-04T17:00:00Z', 28.5, 77.3, 'checked_out')`,
      [empDaily.id]
    );

    // Disburse partial payment of ₹300 (total liability is ~₹567)
    const partialRes = await request(app)
      .post('/api/salary/admin/cycles/disburse-and-advance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        cycleCode: decCycleCode,
        amountPaid: 300,
        disbursementDate: '2027-01-05',
        notes: 'Partial advance disbursement',
      });

    assert.strictEqual(partialRes.status, 200);
    assert.strictEqual(partialRes.body.status, 'partially_paid');
    assert.ok(partialRes.body.remainingLiability > 0);

    // Check that remaining liability can be paid later
    const payRemainingRes = await request(app)
      .post(`/api/salary/admin/cycles/${decCycleCode}/record-payment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 200,
        paymentDate: '2027-01-10',
        notes: 'Second installment',
      });

    assert.strictEqual(payRemainingRes.status, 200);
    assert.strictEqual(payRemainingRes.body.success, true);
    assert.strictEqual(payRemainingRes.body.amountPaid, 200);
  });
});
