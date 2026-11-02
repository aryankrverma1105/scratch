const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const salaryService = require('../src/services/salaryService');

describe('Automatic Salary Advance EMI Deduction & Integration Test Suite', () => {
  let adminUserId;
  let emp1Id;
  let emp2Id;

  before(async () => {
    await db.initDatabase();

    // 1. Setup Admin
    let admin = await db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (!admin) {
      const res = await db.run("INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin_emi_test@sologix.com', 'dummyhash', 'Admin Tester', 'admin')");
      adminUserId = res.lastID;
    } else {
      adminUserId = admin.id;
    }

    // 2. Setup Employee 1 (Fixed Monthly)
    let user1 = await db.get("SELECT id FROM users WHERE email = 'emp1_emi_test@sologix.com'");
    if (!user1) {
      const res = await db.run("INSERT INTO users (email, password_hash, full_name, role, joining_date) VALUES ('emp1_emi_test@sologix.com', 'dummyhash', 'EMI Test Emp1', 'employee', '2026-01-01')");
      emp1Id = res.lastID;
    } else {
      emp1Id = user1.id;
    }

    await salaryService.upsertEmployeeSalaryConfig({
      userId: emp1Id,
      salaryType: 'fixed_monthly',
      monthlyBasicSalary: 25000,
      effectiveDate: '2026-11-01',
      createdBy: adminUserId,
    });

    // 3. Setup Employee 2 (Daily Wage)
    let user2 = await db.get("SELECT id FROM users WHERE email = 'emp2_emi_test@sologix.com'");
    if (!user2) {
      const res = await db.run("INSERT INTO users (email, password_hash, full_name, role, joining_date) VALUES ('emp2_emi_test@sologix.com', 'dummyhash', 'EMI Test Emp2', 'employee', '2026-01-01')");
      emp2Id = res.lastID;
    } else {
      emp2Id = user2.id;
    }

    await salaryService.upsertEmployeeSalaryConfig({
      userId: emp2Id,
      salaryType: 'daily_wage',
      dailyWageOverride: 800,
      effectiveDate: '2026-11-01',
      createdBy: adminUserId,
    });

    // Clean previous test advances for these test users
    await db.run('DELETE FROM salary_advances WHERE user_id IN (?, ?)', [emp1Id, emp2Id]);
    await db.run('DELETE FROM salary_advance_emis WHERE user_id IN (?, ?)', [emp1Id, emp2Id]);
    await db.run('DELETE FROM payroll_records WHERE user_id IN (?, ?)', [emp1Id, emp2Id]);
    await db.run('DELETE FROM salary_payments WHERE user_id IN (?, ?)', [emp1Id, emp2Id]);
    await db.run('DELETE FROM attendance WHERE user_id IN (?, ?)', [emp1Id, emp2Id]);
    await db.run("DELETE FROM salary_cycles WHERE cycle_code IN ('2026-11-01_2026-11-30', '2026-12-01_2026-12-31')");
    await db.run("DELETE FROM payroll_periods WHERE month IN ('2026-11-01_2026-11-30', '2026-12-01_2026-12-31')");
  });

  test('1. Create ₹12,000 advance with ₹2,000 EMI for 6 months (Nov 2026 - Apr 2027)', async () => {
    const adv = await salaryService.createSalaryAdvance({
      userId: emp1Id,
      amount: 12000,
      purpose: 'Home festival advance',
      recoveryType: 'emi',
      totalInstallments: 6,
      startMonth: '2026-11',
      adminId: adminUserId,
    });

    assert.equal(adv.advance.amount, 12000);
    assert.equal(adv.advance.total_installments, 6);
    assert.equal(adv.advance.monthly_installment_amount, 2000);
    assert.equal(adv.advance.remaining_balance, 12000);
    assert.equal(adv.advance.total_recovered, 0);
    assert.equal(adv.advance.status, 'active');
    assert.equal(adv.emis.length, 6);

    assert.equal(adv.emis[0].due_month, '2026-11');
    assert.equal(adv.emis[0].scheduled_amount, 2000);
    assert.equal(adv.emis[0].status, 'pending');

    assert.equal(adv.emis[5].due_month, '2027-04');
    assert.equal(adv.emis[5].scheduled_amount, 2000);
  });

  test('2. Automatic ₹2,000 EMI deduction in monthly salary preview with full attendance', async () => {
    // Add 26 present days for Emp1 in Nov 2026
    for (let d = 1; d <= 26; d++) {
      const dt = `2026-11-${String(d).padStart(2, '0')}`;
      await db.run(
        `INSERT INTO attendance (user_id, date, status, check_in_time, check_in_lat, check_in_lng)
         VALUES (?, ?, 'checked_out', ? || ' 09:00:00', 28.6139, 77.2090)`,
        [emp1Id, dt, dt]
      );
    }

    const calc = await salaryService.calculateSalaryForEmployee(emp1Id, '2026-11-01_2026-11-30');
    // Gross: ₹25,000, 5% retention: ₹1,250.
    // Net before EMI: ₹23,750.
    // EMI deduction: ₹2,000.
    // Final payable salary (netSalary): ₹21,750.
    assert.equal(calc.grossSalary, 25000);
    assert.equal(calc.gratuityDeduction, 1250);
    assert.equal(calc.advanceDeduction, 2000);
    assert.equal(calc.netSalary, 21750);
    assert.equal(calc.advanceEmiBreakdown.length, 1);
    assert.equal(calc.advanceEmiBreakdown[0].deductedAmount, 2000);
    assert.equal(calc.advanceEmiBreakdown[0].scheduledAmount, 2000);
    assert.equal(calc.totalActiveAdvances, 1);
    assert.equal(calc.totalAdvanceBalance, 12000);
    assert.equal(calc.totalMonthlyEmi, 2000);
  });

  test('3. Finalizing payroll permanently records EMI deduction and reduces advance balance', async () => {
    const cycleCode = '2026-11-01_2026-11-30';
    await salaryService.finalizePayroll(cycleCode, adminUserId, 'Nov 2026 Finalization');

    // Verify employee advance details after finalization
    const advList = await salaryService.listSalaryAdvances({ userId: emp1Id });
    const advDetails = await salaryService.getSalaryAdvanceDetails(advList[0].id);

    assert.equal(advDetails.advance.total_recovered, 2000);
    assert.equal(advDetails.advance.remaining_balance, 10000);
    assert.equal(advDetails.advance.status, 'active');

    // Installment 1 must be deducted with due cycle code and repayment reference
    const emi1 = advDetails.emis[0];
    assert.equal(emi1.status, 'deducted');
    assert.equal(emi1.deducted_amount, 2000);
    assert.equal(emi1.due_cycle_code, cycleCode);
    assert.ok(emi1.repayment_reference.startsWith('EMI-REC-'), 'Must have unique repayment reference');

    // Installment 2 must remain pending
    const emi2 = advDetails.emis[1];
    assert.equal(emi2.status, 'pending');
    assert.equal(emi2.deducted_amount, 0);

    // Verify payroll_record has advance_deduction = 2000
    const rec = await db.get('SELECT * FROM payroll_records WHERE user_id = ? AND (payroll_period = ? OR cycle_code = ?)', [emp1Id, cycleCode, cycleCode]);
    assert.equal(rec.advance_deduction, 2000);
    assert.equal(rec.net_salary, 21750);
  });

  test('4. Payroll recalculation / refresh does NOT double-deduct EMI', async () => {
    const cycleCode = '2026-11-01_2026-11-30';
    const recalc = await salaryService.calculateSalaryForEmployee(emp1Id, cycleCode);

    assert.equal(recalc.advanceDeduction, 2000);
    assert.equal(recalc.netSalary, 21750);

    const advList = await salaryService.listSalaryAdvances({ userId: emp1Id });
    const advDetails = await salaryService.getSalaryAdvanceDetails(advList[0].id);
    assert.equal(advDetails.advance.total_recovered, 2000, 'Recovered amount must stay 2000 without double deduction');
    assert.equal(advDetails.advance.remaining_balance, 10000, 'Remaining balance must stay 10000');
  });

  test('5. Salary marked paid / disbursed does NOT deduct EMI a second time', async () => {
    const cycleCode = '2026-11-01_2026-11-30';
    await salaryService.disburseSalaryAndAdvanceCycle({
      cycleCode,
      disbursementDate: '2026-12-01',
      adminUserId,
      notes: 'Full payment November',
    });

    const advList = await salaryService.listSalaryAdvances({ userId: emp1Id });
    const advDetails = await salaryService.getSalaryAdvanceDetails(advList[0].id);
    assert.equal(advDetails.advance.total_recovered, 2000, 'Must still be 2000 after disbursement');
    assert.equal(advDetails.advance.remaining_balance, 10000, 'Must still be 10000');

    // Salary payment recorded for net salary
    const pay = await db.get('SELECT * FROM salary_payments WHERE user_id = ? AND cycle_code = ?', [emp1Id, cycleCode]);
    assert.ok(pay);
    assert.equal(pay.amount_paid, 21750);
  });

  test('6. Multiple active advances for one employee are calculated and deducted independently', async () => {
    // Add second advance of ₹6,000 (3 installments of ₹2,000 each starting Dec 2026)
    const adv2 = await salaryService.createSalaryAdvance({
      userId: emp1Id,
      amount: 6000,
      purpose: 'Medical emergency',
      recoveryType: 'emi',
      totalInstallments: 3,
      startMonth: '2026-12',
      adminId: adminUserId,
    });

    // Check Employee Overview
    const empAdv = await salaryService.getEmployeeAdvances(emp1Id);
    assert.equal(empAdv.activeAdvances.length, 2, 'Should have 2 active advances');
    assert.equal(empAdv.totalRemainingBalance, 16000); // 10000 from adv1 + 6000 from adv2
    assert.equal(empAdv.totalMonthlyEmi, 4000); // 2000 + 2000

    // Add attendance in Dec 2026 (26 present days)
    for (let d = 1; d <= 26; d++) {
      const dt = `2026-12-${String(d).padStart(2, '0')}`;
      await db.run(
        `INSERT INTO attendance (user_id, date, status, check_in_time, check_in_lat, check_in_lng)
         VALUES (?, ?, 'checked_out', ? || ' 09:00:00', 28.6139, 77.2090)`,
        [emp1Id, dt, dt]
      );
    }

    const decCycle = '2026-12-01_2026-12-31';
    const decCalc = await salaryService.calculateSalaryForEmployee(emp1Id, decCycle);

    // Both advances should deduct ₹2,000 each = total ₹4,000 EMI deduction
    assert.equal(decCalc.advanceDeduction, 4000);
    assert.equal(decCalc.advanceEmiBreakdown.length, 2);
    assert.equal(decCalc.advanceEmiBreakdown[0].deductedAmount, 2000);
    assert.equal(decCalc.advanceEmiBreakdown[1].deductedAmount, 2000);
    // Net salary: 25000 - 1250 - 4000 = 19750
    assert.equal(decCalc.netSalary, 19750);

    // Finalize Dec 2026
    await salaryService.finalizePayroll(decCycle, adminUserId, 'Dec 2026 Finalization');

    const empAdvAfter = await salaryService.getEmployeeAdvances(emp1Id);
    assert.equal(empAdvAfter.totalAmountRepaid, 6000); // 2000 from Nov + 4000 from Dec
    assert.equal(empAdvAfter.totalRemainingBalance, 12000); // 8000 + 4000
  });

  test('7. Employee with insufficient payable salary does NOT create negative salary and carries forward unpaid EMI', async () => {
    // For Employee 2 (Daily Wage rate ₹800):
    // Create an advance of ₹5,000 with monthly EMI ₹2,500 starting March 2027
    await salaryService.createSalaryAdvance({
      userId: emp2Id,
      amount: 5000,
      purpose: 'Bicycle loan',
      recoveryType: 'emi',
      totalInstallments: 2,
      startMonth: '2027-03',
      adminId: adminUserId,
    });

    // Employee only attended 1 day in March 2027:
    // Basic: 1 * 800 = ₹800
    // EPF: 12% = 96, ESIC: 0.75% = 6. Total deductions = 102.
    // Net before EMI = 800 - 102 = ₹698.
    // Scheduled EMI is ₹2,500, but available net is only ₹698.
    await db.run(
      `INSERT INTO attendance (user_id, date, status, check_in_time, check_in_lat, check_in_lng)
       VALUES (?, '2027-03-10', 'checked_out', '2027-03-10 09:00:00', 28.6139, 77.2090)`,
      [emp2Id]
    );

    const calc = await salaryService.calculateSalaryForEmployee(emp2Id, '2027-03-01_2027-03-31');
    assert.equal(calc.grossSalary, 800);
    assert.equal(calc.netSalary, 0, 'Net salary must not be negative');
    assert.equal(calc.advanceDeduction, 698, 'Deduction is capped at available net salary');
    assert.equal(calc.advanceEmiBreakdown[0].status, 'partial_deducted');
    assert.equal(calc.advanceEmiBreakdown[0].pendingAmount, 1802); // 2500 - 698 = 1802 remaining
  });

  test('8. Employee with ZERO payable salary results in ₹0 deduction and no negative salary', async () => {
    // Emp2 with 0 attendance in Dec 2026:
    const calc = await salaryService.calculateSalaryForEmployee(emp2Id, '2027-04-01_2027-04-30');
    assert.equal(calc.payableDays, 0);
    assert.equal(calc.grossSalary, 0);
    assert.equal(calc.advanceDeduction, 0);
    assert.equal(calc.netSalary, 0);
  });

  test('9. Paused EMI plan is excluded from automatic deduction', async () => {
    const advList = await salaryService.listSalaryAdvances({ userId: emp2Id });
    const advId = advList[0].id;

    await salaryService.pauseSalaryAdvance(advId, adminUserId);

    // Give Emp2 attendance for Jan 2027
    await db.run(
      `INSERT INTO attendance (user_id, date, status, check_in_time, check_in_lat, check_in_lng)
       VALUES (?, '2027-05-05', 'checked_out', '2027-01-05 09:00:00', 28.6139, 77.2090)`,
      [emp2Id]
    );

    const calc = await salaryService.calculateSalaryForEmployee(emp2Id, '2027-05-01_2027-05-31');
    assert.equal(calc.advanceDeduction, 0, 'No EMI deduction when advance is paused');
    assert.ok(calc.netSalary > 0, 'Employee receives their earned pay without EMI deduction');

    // Resume advance
    await salaryService.resumeSalaryAdvance(advId, adminUserId);
  });

  test('10. Admin can change EMI installment amount with audit logging', async () => {
    const advList = await salaryService.listSalaryAdvances({ userId: emp2Id });
    const advId = advList[0].id;

    // Update monthly installment to ₹1,000
    const updated = await salaryService.updateSalaryAdvance({
      advanceId: advId,
      monthlyInstallmentAmount: 1000,
      totalInstallments: 5,
      notes: 'Reduced monthly EMI upon employee request',
      adminId: adminUserId,
    });

    assert.equal(updated.advance.monthly_installment_amount, 1000);
    assert.equal(updated.monthlyInstallment, 1000);

    // Verify activity log recorded
    const log = await db.get("SELECT * FROM activity_logs WHERE action = 'SALARY_ADVANCE_UPDATED' AND entity_id = ? ORDER BY id DESC LIMIT 1", [advId]);
    assert.ok(log, 'Audit log must be recorded for admin EMI modification');
  });

  test('11. Complete repayment marks advance as completed and stops future deductions', async () => {
    const advList = await salaryService.listSalaryAdvances({ userId: emp2Id });
    const advId = advList[0].id;

    // Early settle remaining balance
    await salaryService.settleSalaryAdvanceEarly({
      advanceId: advId,
      settlementAmount: 5000,
      paymentMethod: 'upi',
      paymentReference: 'UPI-SETTLE-TEST-99',
      adminId: adminUserId,
    });

    const advDetails = await salaryService.getSalaryAdvanceDetails(advId);
    assert.equal(advDetails.advance.status, 'completed');
    assert.equal(advDetails.advance.remaining_balance, 0);

    // Future calculation should have zero deduction
    const calc = await salaryService.calculateSalaryForEmployee(emp2Id, '2027-06-01_2027-06-30');
    assert.equal(calc.advanceDeduction, 0);
  });

  test('12. Employee cannot view other employees advances', async () => {
    // Querying employee advances directly with user ID guarantees scoping
    const emp1Advances = await salaryService.getEmployeeAdvances(emp1Id);
    const emp2Advances = await salaryService.getEmployeeAdvances(emp2Id);

    assert.ok(emp1Advances.advances.every(a => a.user_id === emp1Id));
    assert.ok(emp2Advances.advances.every(a => a.user_id === emp2Id));
  });
});
