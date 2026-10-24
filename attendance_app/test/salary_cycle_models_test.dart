import 'package:flutter_test/flutter_test.dart';
import 'package:attendance_app/models/salary_models.dart';

void main() {
  group('Salary Cycle & Disbursement Model Unit Tests', () {
    test('SalaryCycleModel fromJson parses all attributes accurately', () {
      final json = {
        'id': 1,
        'cycle_code': '2026-11-03_2026-12-02',
        'start_date': '2026-11-03',
        'end_date': '2026-12-02',
        'status': 'active',
        'total_gross': 26000.0,
        'total_net': 24700.0,
        'total_disbursed': 24700.0,
        'remaining_payable': 0.0,
        'employee_count': 5,
        'finalized_at': '2026-12-02T18:30:00Z',
        'closed_at': null,
        'notes': 'Initial launch cycle',
      };

      final cycle = SalaryCycleModel.fromJson(json);

      expect(cycle.id, 1);
      expect(cycle.cycleCode, '2026-11-03_2026-12-02');
      expect(cycle.startDate, '2026-11-03');
      expect(cycle.endDate, '2026-12-02');
      expect(cycle.status, 'active');
      expect(cycle.totalGross, 26000.0);
      expect(cycle.totalNet, 24700.0);
      expect(cycle.totalDisbursed, 24700.0);
      expect(cycle.remainingPayable, 0.0);
      expect(cycle.employeeCount, 5);
      expect(cycle.notes, 'Initial launch cycle');
    });

    test('SalaryDisbursementBatchModel fromJson parses batch references', () {
      final json = {
        'id': 10,
        'batch_reference': 'DISB-202611-BATCH001',
        'cycle_id': 1,
        'cycle_code': '2026-11-03_2026-12-02',
        'disbursement_date': '2026-12-05',
        'total_amount': 75000.0,
        'employee_count': 3,
        'payment_method': 'bank_transfer',
        'disbursed_by_name': 'Super Admin',
        'notes': 'Full monthly payout',
        'created_at': '2026-12-05T10:00:00Z',
      };

      final batch = SalaryDisbursementBatchModel.fromJson(json);

      expect(batch.id, 10);
      expect(batch.batchReference, 'DISB-202611-BATCH001');
      expect(batch.cycleCode, '2026-11-03_2026-12-02');
      expect(batch.disbursementDate, '2026-12-05');
      expect(batch.totalAmount, 75000.0);
      expect(batch.employeeCount, 3);
      expect(batch.paymentMethod, 'bank_transfer');
    });

    test('SalaryPaymentModel fromJson handles partial payment and remaining liability', () {
      final json = {
        'id': 101,
        'payment_reference': 'PAY-2026-001',
        'cycle_id': 1,
        'cycle_code': '2026-11-03_2026-12-02',
        'user_id': 2,
        'employee_name': 'Ramesh Kumar',
        'amount_paid': 15000.0,
        'net_payable': 24700.0,
        'remaining_balance': 9700.0,
        'payment_date': '2026-12-05',
        'status': 'partial',
        'recorded_by_name': 'Admin User',
        'created_at': '2026-12-05T11:00:00Z',
      };

      final payment = SalaryPaymentModel.fromJson(json);

      expect(payment.id, 101);
      expect(payment.paymentReference, 'PAY-2026-001');
      expect(payment.amountPaid, 15000.0);
      expect(payment.netPayable, 24700.0);
      expect(payment.remainingBalance, 9700.0);
      expect(payment.status, 'partial');
    });

    test('SalaryCalculationModel getters for cycle dates and cap enforcement', () {
      final json = {
        'userId': 2,
        'fullName': 'Suresh Patel',
        'email': 'suresh@sologix.in',
        'payrollPeriod': '2026-11-03_2026-12-02',
        'cycleCode': '2026-11-03_2026-12-02',
        'startDate': '2026-11-03',
        'endDate': '2026-12-02',
        'salaryType': 'fixed_monthly',
        'baseRate': 26000.0,
        'configuredMonthlyCap': 26000.0,
        'hasConfig': true,
        'totalWorkingDays': 26.0,
        'presentDays': 24.0,
        'paidLeaveDays': 0.0,
        'payableDays': 24.0,
        'absentDays': 2.0,
        'excessAbsentDays': 0.0,
        'basicSalary': 26000.0,
        'incentiveSalary': 0.0,
        'overtimeHours': 0.0,
        'overtimeAmount': 0.0,
        'grossSalary': 26000.0,
        'employeeEpf': 0.0,
        'employeeEsic': 0.0,
        'totalDeductions': 1300.0,
        'gratuityDeduction': 1300.0,
        'netSalary': 24700.0,
        'employerEpf': 0.0,
        'employerEsic': 0.0,
        'ctc': 26000.0,
        'amountDisbursed': 0.0,
        'remainingPayable': 24700.0,
        'paymentStatus': 'draft',
        'isFinalized': false,
      };

      final calc = SalaryCalculationModel.fromJson(json);

      expect(calc.cycleStartDate, '2026-11-03');
      expect(calc.cycleEndDate, '2026-12-02');
      expect(calc.monthlySalaryCap, 26000.0);
      expect(calc.grossSalary, 26000.0);
      expect(calc.netSalary, 24700.0);
      expect(calc.remainingPayable, 24700.0);
      expect(calc.paymentStatus, 'draft');
    });
  });
}
