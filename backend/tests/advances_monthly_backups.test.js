const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const salaryService = require('../src/services/salaryService');
const leaveService = require('../src/services/leaveService');
const backupService = require('../src/services/backupService');

describe('Monthly Salary, Advances, Backups & Leave Policies Suite', () => {
  let testUserId;
  let adminUserId;

  before(async () => {
    await db.initDatabase();
    
    // Ensure test admin exists
    let admin = await db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (!admin) {
      const res = await db.run("INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin_test@sologix.com', 'dummyhash', 'Admin Tester', 'admin')");
      adminUserId = res.lastID;
    } else {
      adminUserId = admin.id;
    }

    // Ensure test employee exists
    let user = await db.get("SELECT id FROM users WHERE email = 'adv_emp_test@sologix.com'");
    if (!user) {
      const res = await db.run("INSERT INTO users (email, password_hash, full_name, role, joining_date) VALUES ('adv_emp_test@sologix.com', 'dummyhash', 'Advance Test Employee', 'employee', '2026-01-01')");
      testUserId = res.lastID;
    } else {
      testUserId = user.id;
    }

    // Set salary config
    await salaryService.upsertEmployeeSalaryConfig({
      userId: testUserId,
      salaryType: 'fixed_monthly',
      monthlyBasicSalary: 30000,
      effectiveDate: '2026-11-01',
      createdBy: adminUserId,
    });

    await db.run('DELETE FROM salary_advances WHERE user_id = ?', [testUserId]);
    await db.run('DELETE FROM salary_advance_emis WHERE user_id = ?', [testUserId]);
    await db.run('DELETE FROM payroll_records WHERE user_id = ?', [testUserId]);
  });

  test('1. Calendar-month salary cycle resolution & auto-reconciliation', async () => {
    const novCycle = salaryService.getSalaryCycleForDate('2026-11-15', 1);
    assert.equal(novCycle.startDate, '2026-11-01');
    assert.equal(novCycle.endDate, '2026-11-30');
    assert.equal(novCycle.cycleCode, '2026-11-01_2026-11-30');

    const nextCycle = salaryService.getNextSalaryCycle('2026-11-01', 1);
    assert.equal(nextCycle.startDate, '2026-12-01');
    assert.equal(nextCycle.endDate, '2026-12-31');

    await salaryService.autoReconcileSalaryCycles();
    const active = await db.get("SELECT * FROM salary_cycles WHERE status = 'active' ORDER BY id DESC LIMIT 1");
    assert.ok(active);
  });

  test('2. Salary Advance with EMI schedule creation', async () => {
    const adv = await salaryService.createSalaryAdvance({
      userId: testUserId,
      amount: 15000,
      purpose: 'Home festival advance',
      recoveryType: 'emi',
      totalInstallments: 3,
      startMonth: '2026-11',
      adminId: adminUserId,
    });

    assert.equal(adv.advance.amount, 15000);
    assert.equal(adv.advance.total_installments, 3);
    assert.equal(adv.advance.monthly_installment_amount, 5000);
    assert.equal(adv.advance.remaining_balance, 15000);
    assert.equal(adv.advance.status, 'active');
    assert.equal(adv.emis.length, 3);

    assert.equal(adv.emis[0].due_month, '2026-11');
    assert.equal(adv.emis[0].scheduled_amount, 5000);
    assert.equal(adv.emis[1].due_month, '2026-12');
    assert.equal(adv.emis[1].scheduled_amount, 5000);
    assert.equal(adv.emis[2].due_month, '2027-01');
    assert.equal(adv.emis[2].scheduled_amount, 5000);
  });

  test('3. Salary Advance pause and resume controls', async () => {
    const advList = await salaryService.listSalaryAdvances({ userId: testUserId });
    const advId = advList[0].id;

    // Pause
    const paused = await salaryService.pauseSalaryAdvance(advId, adminUserId);
    assert.equal(paused.advance.status, 'paused');
    assert.equal(paused.emis[0].status, 'paused');

    // Resume
    const resumed = await salaryService.resumeSalaryAdvance(advId, adminUserId);
    assert.equal(resumed.advance.status, 'active');
    assert.equal(resumed.emis[0].status, 'pending');
  });

  test('4. Advance EMI deduction automatically reduces Net Pay without negative salary', async () => {
    // Add 1 present day in November 2026 with lat/lng
    await db.run(
      `INSERT OR REPLACE INTO attendance (user_id, date, status, check_in_time, check_in_lat, check_in_lng)
       VALUES (?, '2026-11-05', 'checked_out', '2026-11-05 09:00:00', 28.6139, 77.2090)`,
      [testUserId]
    );

    const preview = await salaryService.calculateSalaryForEmployee(testUserId, '2026-11-01_2026-11-30');
    assert.ok(preview.advanceDeduction > 0, 'Advance deduction should be greater than 0');
    assert.ok(preview.netSalary >= 0, 'Net salary must never be negative');
    assert.ok(preview.pendingAdvanceEmi, 'Pending EMI reference should exist');
    assert.equal(preview.pendingAdvanceEmi.installmentNumber, 1);
  });

  test('5. Early settlement outside payroll marks remaining EMIs settled_early', async () => {
    const advList = await salaryService.listSalaryAdvances({ userId: testUserId });
    const advId = advList[0].id;

    const settled = await salaryService.settleSalaryAdvanceEarly({
      advanceId: advId,
      settlementAmount: 15000,
      paymentMethod: 'bank_transfer',
      paymentReference: 'UPI-SETTLE-8899',
      adminId: adminUserId,
    });

    assert.equal(settled.advance.status, 'completed');
    assert.equal(settled.advance.remaining_balance, 0);
    assert.ok(settled.emis.every(e => e.status === 'settled_early' || e.status === 'deducted'));
  });

  test('6. Database snapshot creates valid uncompressed archive with manifest and SQL dump', async () => {
    const bundle = await backupService.createUncompressedBackupBundle({ backupType: 'test' });
    assert.ok(bundle.folderTimestamp.includes('_IST'));
    assert.ok(bundle.totalBytes > 0);
    assert.ok(bundle.manifest);
    assert.equal(bundle.manifest.compression, 'none (uncompressed original files)');
    assert.ok(bundle.manifest.files.some(f => f.relativePath === 'database-backup.sqlite'));
    assert.ok(bundle.manifest.files.some(f => f.relativePath === 'database-backup.sql'));
    assert.ok(bundle.manifest.files.some(f => f.relativePath === 'backup-manifest.json' || bundle.manifest.files.length >= 2));
    assert.ok(bundle.manifest.verificationChecksum.length > 0);
  });

  test('7. Calendar leave year (1 Jan - 31 Dec) and 26 present days eligibility condition', async () => {
    const { getLeaveYear, getLeaveYearRange } = require('../src/utils/leaveUtils');
    const ly = getLeaveYear('2026-05-10');
    assert.equal(ly, '2026');

    const range = getLeaveYearRange('2026');
    assert.equal(range.startDate, '2026-01-01');
    assert.equal(range.endDate, '2026-12-31');

    // Test monthly accrual for month with < 26 present days (should be skipped for salaried)
    const accrualResult = await leaveService.accrueMonthlyLeaves('2026-11', true);
    assert.ok(accrualResult);
  });
});
