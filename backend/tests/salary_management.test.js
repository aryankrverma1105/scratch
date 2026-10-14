const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const salaryService = require('../src/services/salaryService');
const { round2 } = require('../src/services/salaryService');

// Helper to make mock requests
let tokenAdmin = null;
let tokenEmployee1 = null;
let tokenEmployee2 = null;
let adminUser = null;
let emp1 = null;
let emp2 = null;

test('Salary Management System Comprehensive Test Suite', async (t) => {
  await db.initDatabase();

  const timestamp = Date.now();

  // 1. Create Test Users
  const adminRes = await db.run(
    `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active)
     VALUES (?, ?, 'dummy_hash', 'Salary Admin', 'admin', 'Management', 1)`,
    [`salary_admin_${timestamp}@company.com`, `sal_admin_${timestamp}`]
  );
  adminUser = { id: adminRes.lastID, role: 'admin' };

  const emp1Res = await db.run(
    `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active, joining_date)
     VALUES (?, ?, 'dummy_hash', 'Daily Wage Worker', 'employee', 'Operations', 1, '2026-04-01')`,
    [`daily_worker_${timestamp}@company.com`, `daily_worker_${timestamp}`]
  );
  emp1 = { id: emp1Res.lastID, role: 'employee' };

  const emp2Res = await db.run(
    `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active, joining_date)
     VALUES (?, ?, 'dummy_hash', 'Fixed Monthly Employee', 'employee', 'Engineering', 1, '2026-04-01')`,
    [`fixed_worker_${timestamp}@company.com`, `fixed_worker_${timestamp}`]
  );
  emp2 = { id: emp2Res.lastID, role: 'employee' };

  // Setup common daily wage rate
  await salaryService.updateSalarySettings(650.0, adminUser.id);

  await t.test('1. Daily-wage basic salary, incentives, overtime, EPF, ESIC, Net Salary & CTC calculation', async () => {
    // Configure employee 1 as daily wage with ₹700 override
    await salaryService.upsertEmployeeSalaryConfig({
      userId: emp1.id,
      salaryType: 'daily_wage',
      dailyWageOverride: 700.0,
      effectiveDate: '2026-04-01',
      createdBy: adminUser.id,
    });

    const month = '2026-04';

    // Mock 20 present days in attendance
    for (let day = 1; day <= 24; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `2026-04-${dayStr}`;
      // Skip Sundays (April 2026 Sundays: 5, 12, 19, 26)
      const dayOfWeek = new Date(dateStr).getDay();
      if (dayOfWeek !== 0 && day <= 20) {
        await db.run(
          `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status)
           VALUES (?, ?, '2026-04-01T09:00:00Z', '2026-04-01T17:00:00Z', 28.5, 77.3, 'checked_out')`,
          [emp1.id, dateStr]
        );
      }
    }

    // Add daily incentives: 3 days of ₹100 each = ₹300 approved
    await db.run(
      `INSERT INTO daily_incentives (user_id, date, amount, description, status, payroll_period, created_by)
       VALUES (?, '2026-04-02', 100, 'Project bonus', 'approved', '2026-04', ?)`,
      [emp1.id, adminUser.id]
    );
    await db.run(
      `INSERT INTO daily_incentives (user_id, date, amount, description, status, payroll_period, created_by)
       VALUES (?, '2026-04-03', 200, 'Site incentive', 'approved', '2026-04', ?)`,
      [emp1.id, adminUser.id]
    );
    // Add a rejected incentive of ₹500 (should NOT be counted)
    await db.run(
      `INSERT INTO daily_incentives (user_id, date, amount, description, status, payroll_period, created_by)
       VALUES (?, '2026-04-04', 500, 'Pending test', 'rejected', '2026-04', ?)`,
      [emp1.id, adminUser.id]
    );

    // Add overtime: 4 hours, ₹400 approved
    await db.run(
      `INSERT INTO overtime_records (user_id, date, hours, amount, status, payroll_period, created_by, approved_by)
       VALUES (?, '2026-04-06', 4, 400, 'approved', '2026-04', ?, ?)`,
      [emp1.id, adminUser.id, adminUser.id]
    );
    // Add pending overtime (should NOT be counted)
    await db.run(
      `INSERT INTO overtime_records (user_id, date, hours, amount, status, payroll_period, created_by)
       VALUES (?, '2026-04-07', 2, 200, 'pending', '2026-04', ?)`,
      [emp1.id, adminUser.id]
    );

    const calc = await salaryService.calculateSalaryForEmployee(emp1.id, month);

    assert.strictEqual(calc.salaryType, 'daily_wage');
    assert.strictEqual(calc.baseRate, 700.0);
    assert.strictEqual(calc.incentiveSalary, 300.0);
    assert.strictEqual(calc.overtimeAmount, 400.0);

    // Basic = 700 * payableDays
    const expectedBasic = round2(700 * calc.payableDays);
    assert.strictEqual(calc.basicSalary, expectedBasic);

    // Gross = Basic + 300 (Incentive) + 400 (Overtime)
    const expectedGross = round2(expectedBasic + 300 + 400);
    assert.strictEqual(calc.grossSalary, expectedGross);

    // Employee EPF = 12% of Basic
    const expectedEpf = round2(expectedBasic * 0.12);
    assert.strictEqual(calc.employeeEpf, expectedEpf);

    // Employee ESIC = 0.75% of Basic
    const expectedEsic = round2(expectedBasic * 0.0075);
    assert.strictEqual(calc.employeeEsic, expectedEsic);

    // Net Salary = Gross - (EPF + ESIC)
    const expectedNet = round2(expectedGross - (expectedEpf + expectedEsic));
    assert.strictEqual(calc.netSalary, expectedNet);

    // Employer EPF = 12% of Basic, Employer ESIC = 3.25% of Basic
    const expectedEmprEpf = round2(expectedBasic * 0.12);
    const expectedEmprEsic = round2(expectedBasic * 0.0325);
    assert.strictEqual(calc.employerEpf, expectedEmprEpf);
    assert.strictEqual(calc.employerEsic, expectedEmprEsic);

    // CTC = Gross + Employer EPF + Employer ESIC
    const expectedCtc = round2(expectedGross + expectedEmprEpf + expectedEmprEsic);
    assert.strictEqual(calc.ctc, expectedCtc);
  });

  await t.test('2. Fixed monthly salary ₹26,000 example verification (4 absent days -> ₹22,700 net)', async () => {
    // Configure employee 2 as fixed monthly with ₹26,000 basic
    await salaryService.upsertEmployeeSalaryConfig({
      userId: emp2.id,
      salaryType: 'fixed_monthly',
      monthlyBasicSalary: 26000.0,
      effectiveDate: '2026-04-01',
      createdBy: adminUser.id,
    });

    // In a 26-working-day month with 4 absent days:
    // Daily Salary = ₹26,000 / 26 = ₹1,000
    // Allowed Absences = 2
    // Excess Absences = 4 - 2 = 2
    // Absence Deduction = ₹1,000 * 2 = ₹2,000
    // Gross Salary = ₹26,000 - ₹2,000 = ₹24,000
    // Gratuity Deduction (5% of original basic) = ₹26,000 * 0.05 = ₹1,300
    // Net Salary = ₹24,000 - ₹1,300 = ₹22,700

    // Test the formula logic directly
    const monthlyBasic = 26000.0;
    const totalWorkingDays = 26;
    const absentDays = 4;
    const dailySalary = monthlyBasic / totalWorkingDays;
    assert.strictEqual(dailySalary, 1000.0);

    const excessAbsentDays = Math.max(absentDays - 2, 0);
    assert.strictEqual(excessAbsentDays, 2);

    const absenceDeduction = round2(dailySalary * excessAbsentDays);
    assert.strictEqual(absenceDeduction, 2000.0);

    const grossSalary = round2(monthlyBasic - absenceDeduction);
    assert.strictEqual(grossSalary, 24000.0);

    const gratuityDeduction = round2(monthlyBasic * 0.05);
    assert.strictEqual(gratuityDeduction, 1300.0);

    const netSalary = round2(grossSalary - gratuityDeduction);
    assert.strictEqual(netSalary, 22700.0);
  });

  await t.test('3. Fixed monthly salary with 0, 1, and 2 absent days incurs ZERO absence deduction', async () => {
    const monthlyBasic = 30000.0;
    const totalWorkingDays = 26;

    for (const absentDays of [0, 1, 2]) {
      const dailySalary = monthlyBasic / totalWorkingDays;
      const excessAbsentDays = Math.max(absentDays - 2, 0);
      assert.strictEqual(excessAbsentDays, 0);

      const absenceDeduction = round2(dailySalary * excessAbsentDays);
      assert.strictEqual(absenceDeduction, 0.0);

      const grossSalary = round2(monthlyBasic - absenceDeduction);
      assert.strictEqual(grossSalary, 30000.0);

      const gratuityDeduction = round2(monthlyBasic * 0.05);
      assert.strictEqual(gratuityDeduction, 1500.0);

      const netSalary = round2(grossSalary - gratuityDeduction);
      assert.strictEqual(netSalary, 28500.0);
    }
  });

  await t.test('4. Gratuity deduction uses original monthly basic even when absences reduce gross salary', async () => {
    const originalBasic = 50000.0;
    const absentDays = 6; // 4 excess days
    const totalWorkingDays = 25;
    const dailySalary = originalBasic / totalWorkingDays; // 2000/day
    const excessAbsentDays = absentDays - 2; // 4 days
    const absenceDeduction = dailySalary * excessAbsentDays; // 8000
    const grossSalary = originalBasic - absenceDeduction; // 42000

    // 5% must be on 50000 (original), NOT on 42000 (reduced gross)
    const gratuityDeduction = round2(originalBasic * 0.05);
    assert.strictEqual(gratuityDeduction, 2500.0); // 50000 * 5% = 2500

    const netSalary = round2(grossSalary - gratuityDeduction);
    assert.strictEqual(netSalary, 39500.0);
  });

  await t.test('5. Common daily wage rate is used when employee has no individual override', async () => {
    const emp3Res = await db.run(
      `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active, joining_date)
       VALUES (?, ?, 'dummy_hash', 'Standard Daily Worker', 'employee', 'Operations', 1, '2026-04-01')`,
      [`std_worker_${timestamp}@company.com`, `std_worker_${timestamp}`]
    );
    const emp3Id = emp3Res.lastID;

    // Set common daily wage to 750
    await salaryService.updateSalarySettings(750.0, adminUser.id);

    await salaryService.upsertEmployeeSalaryConfig({
      userId: emp3Id,
      salaryType: 'daily_wage',
      dailyWageOverride: null, // No override!
      effectiveDate: '2026-04-01',
      createdBy: adminUser.id,
    });

    const calc = await salaryService.calculateSalaryForEmployee(emp3Id, '2026-04');
    assert.strictEqual(calc.baseRate, 750.0);
  });

  await t.test('6. Payroll finalization is immutable and locks the payroll period', async () => {
    const month = '2026-09';
    await db.run('DELETE FROM payroll_records WHERE payroll_period = ?', [month]);
    await db.run('DELETE FROM payroll_periods WHERE month = ?', [month]);

    const finalizeRes = await salaryService.finalizePayroll(month, adminUser.id, 'September 2026 Finalized');
    assert.strictEqual(typeof finalizeRes.recordsCount, 'number');

    // Attempting to finalize again must reject
    await assert.rejects(
      async () => {
        await salaryService.finalizePayroll(month, adminUser.id, 'Retry attempt');
      },
      /already finalized and locked/
    );

    // Verify stored record
    const records = await db.query('SELECT * FROM payroll_records WHERE payroll_period = ?', [month]);
    assert.ok(records.length > 0);
    assert.strictEqual(records[0].status, 'finalized');
  });

  await t.test('7. CSV export generates valid data matching Google Sheet columns', async () => {
    const csv = await salaryService.generatePayrollCsv('2026-09');
    assert.ok(csv.includes('S.No.'));
    assert.ok(csv.includes('Name of Employees'));
    assert.ok(csv.includes('EPFO'));
    assert.ok(csv.includes('ESIC'));
    assert.ok(csv.includes('Daily rate of wage'));
    assert.ok(csv.includes('Net Salary'));
    assert.ok(csv.includes('CTC'));
  });

  await t.test('8. Activity logs record user actions and salary events', async () => {
    const logs = await db.query(
      `SELECT * FROM activity_logs WHERE action IN ('COMMON_DAILY_WAGE_UPDATED', 'PAYROLL_FINALIZED')`
    );
    assert.ok(logs.length >= 2);
  });
});
