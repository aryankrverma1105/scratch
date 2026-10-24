import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/salary_models.dart';

class AdminSalaryScreen extends StatefulWidget {
  const AdminSalaryScreen({super.key});

  @override
  State<AdminSalaryScreen> createState() => _AdminSalaryScreenState();
}

class _AdminSalaryScreenState extends State<AdminSalaryScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  String? _errorMessage;

  DateTime _selectedMonth = DateTime.now();
  SalarySettingsModel? _settings;
  List<EmployeeSalaryConfigModel> _configs = [];
  List<SalaryCalculationModel> _calculations = [];
  bool _isFinalized = false;
  String? _finalizedAt;

  SalaryCycleModel? _activeCycle;
  List<SalaryCycleModel> _cycles = [];
  SalaryCycleModel? _selectedCycle;

  List<DailyIncentiveModel> _incentives = [];
  List<OvertimeRecordModel> _overtimes = [];

  final TextEditingController _commonWageController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadAllData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _commonWageController.dispose();
    super.dispose();
  }

  String get _monthStr => DateFormat('yyyy-MM').format(_selectedMonth);

  Future<void> _loadAllData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final settings = await ApiService().getSalarySettings();
      final configs = await ApiService().getEmployeeSalaryConfigs();
      final cycles = await ApiService().listSalaryCycles();
      final activeCycle = await ApiService().getActiveSalaryCycle();
      
      SalaryCycleModel? currentCycle = _selectedCycle;
      if (currentCycle != null) {
        // verify it still exists in the fetched cycles
        final found = cycles.where((c) => c.cycleCode == currentCycle!.cycleCode).toList();
        if (found.isNotEmpty) {
          currentCycle = found.first;
        } else {
          currentCycle = activeCycle ?? (cycles.isNotEmpty ? cycles.first : null);
        }
      } else {
        currentCycle = activeCycle ?? (cycles.isNotEmpty ? cycles.first : null);
      }

      final preview = await ApiService().previewPayroll(
        cycleCode: currentCycle?.cycleCode,
        month: currentCycle == null ? _monthStr : null,
      );
      final incentives = await ApiService().getAdminIncentives(month: _monthStr);
      final overtimes = await ApiService().getAdminOvertime(month: _monthStr);

      if (mounted) {
        setState(() {
          _settings = settings;
          _commonWageController.text = settings.commonDailyWage.toStringAsFixed(0);
          _configs = configs;
          _cycles = cycles;
          _activeCycle = activeCycle;
          _selectedCycle = currentCycle;
          _calculations = (preview['calculations'] as List? ?? []).cast<SalaryCalculationModel>();
          _isFinalized = preview['isFinalized'] ?? false;
          _finalizedAt = preview['finalizedAt']?.toString();
          _incentives = incentives;
          _overtimes = overtimes;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceFirst('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  void _onCycleChanged(SalaryCycleModel? cycle) {
    if (cycle == null || cycle.cycleCode == _selectedCycle?.cycleCode) return;
    setState(() {
      _selectedCycle = cycle;
    });
    _loadAllData();
  }

  void _changeMonth(int offset) {
    setState(() {
      _selectedMonth = DateTime(_selectedMonth.year, _selectedMonth.month + offset, 1);
      _selectedCycle = null;
    });
    _loadAllData();
  }

  Future<void> _saveCommonDailyWage() async {
    final wage = double.tryParse(_commonWageController.text.trim());
    if (wage == null || wage < 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(backgroundColor: AppColors.error, content: Text('Please enter a valid wage amount')),
      );
      return;
    }
    try {
      final updated = await ApiService().updateSalarySettings(wage);
      setState(() {
        _settings = updated;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(backgroundColor: AppColors.success, content: Text('Common daily wage updated successfully')),
        );
      }
      _loadAllData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(backgroundColor: AppColors.error, content: Text(e.toString())),
        );
      }
    }
  }

  Future<void> _finalizePayrollDialog() async {
    final notesController = TextEditingController();
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.lock_outline, color: AppColors.warning, size: 24),
            SizedBox(width: 8),
            Text('Finalize & Lock Payroll', style: TextStyle(color: Colors.white, fontSize: 18)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Are you sure you want to finalize payroll for ${_selectedCycle?.cycleCode ?? _monthStr}? Once locked, calculations become immutable and serve as official payslips.',
              style: const TextStyle(color: AppColors.textDim, fontSize: 13),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: notesController,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Optional payroll notes...',
                hintStyle: const TextStyle(color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.inputDark,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.warning),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Finalize & Lock', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      try {
        await ApiService().finalizePayroll(
          cycleCode: _selectedCycle?.cycleCode,
          month: _selectedCycle == null ? _monthStr : null,
          notes: notesController.text.trim(),
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(backgroundColor: AppColors.success, content: Text('Payroll finalized and locked successfully')),
          );
        }
        _loadAllData();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: AppColors.error, content: Text(e.toString())),
          );
        }
      }
    }
  }

  Future<void> _showDisburseAndAdvanceDialog() async {
    final cycle = _selectedCycle ?? _activeCycle;
    if (cycle == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(backgroundColor: AppColors.error, content: Text('No active salary cycle found.')),
      );
      return;
    }

    final totalGross = _calculations.fold<double>(0.0, (sum, c) => sum + c.grossSalary);
    final totalNet = _calculations.fold<double>(0.0, (sum, c) => sum + c.netSalary);
    final totalDeductions = totalGross - totalNet;
    final totalDisbursedSoFar = _calculations.fold<double>(0.0, (sum, c) => sum + c.amountDisbursed);
    final remainingPayable = (totalNet - totalDisbursedSoFar) > 0 ? (totalNet - totalDisbursedSoFar) : 0.0;
    final employeeCount = _calculations.length;

    // Propose next cycle start date (day after current cycle end date)
    String proposedNextStartDate = 'Next 3rd';
    try {
      final endDt = DateTime.parse(cycle.endDate);
      final nextDt = endDt.add(const Duration(days: 1));
      proposedNextStartDate = DateFormat('yyyy-MM-dd').format(nextDt);
    } catch (_) {}

    DateTime paymentDate = DateTime.now();
    final amountController = TextEditingController(text: remainingPayable > 0 ? remainingPayable.toStringAsFixed(2) : '0.00');
    final notesController = TextEditingController();
    String disbursementMethod = 'bank_transfer';

    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          return AlertDialog(
            backgroundColor: AppColors.cardDark,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: const Row(
              children: [
                Icon(Icons.payments_outlined, color: AppColors.success, size: 24),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Record Disbursement & Start Next Cycle',
                    style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            content: SizedBox(
              width: double.maxFinite,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Cycle details
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.06),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        children: [
                          _buildDetailRow('Current Cycle', cycle.cycleCode),
                          _buildDetailRow('Cycle Period', '${cycle.startDate} to ${cycle.endDate}'),
                          _buildDetailRow('Employees Included', '$employeeCount staff'),
                          _buildDetailRow('Proposed Next Cycle', proposedNextStartDate, color: Colors.cyanAccent),
                          const Divider(color: Colors.white12, height: 16),
                          _buildDetailRow('Eligible Gross Salary', '₹${NumberFormat('#,##,##0.00').format(totalGross)}'),
                          _buildDetailRow('Total Employee Deductions', '₹${NumberFormat('#,##,##0.00').format(totalDeductions)}', color: AppColors.error),
                          _buildDetailRow('Total Net Payable', '₹${NumberFormat('#,##,##0.00').format(totalNet)}', isBold: true, color: Colors.white),
                          _buildDetailRow('Already Disbursed', '₹${NumberFormat('#,##,##0.00').format(totalDisbursedSoFar)}'),
                          _buildDetailRow('Remaining Net Payable', '₹${NumberFormat('#,##,##0.00').format(remainingPayable)}', isBold: true, color: AppColors.success),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Warning notice
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.warning.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.warning.withOpacity(0.4)),
                      ),
                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.warning_amber_rounded, color: AppColors.warning, size: 20),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Warning: Finalized payroll cannot be silently overwritten. Confirming this action creates a permanent snapshot, records disbursement, and starts the next cycle with ₹0 starting earnings.',
                              style: TextStyle(color: AppColors.warning, fontSize: 11.5),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Payment Date picker
                    const Text('Actual Payment Date', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 6),
                    InkWell(
                      onTap: () async {
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: paymentDate,
                          firstDate: DateTime(2020),
                          lastDate: DateTime(2035),
                        );
                        if (picked != null) {
                          setModalState(() => paymentDate = picked);
                        }
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: AppColors.inputDark,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(DateFormat('yyyy-MM-dd').format(paymentDate), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                            const Icon(Icons.calendar_today, color: AppColors.info, size: 18),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Amount controller
                    const Text('Disbursement Amount (₹)', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 6),
                    TextField(
                      controller: amountController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                      decoration: InputDecoration(
                        hintText: 'Enter amount disbursed',
                        hintStyle: const TextStyle(color: AppColors.textMuted),
                        filled: true,
                        fillColor: AppColors.inputDark,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Disbursement Method
                    const Text('Disbursement Method', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      decoration: BoxDecoration(
                        color: AppColors.inputDark,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: disbursementMethod,
                          dropdownColor: AppColors.cardDark,
                          isExpanded: true,
                          items: const [
                            DropdownMenuItem(value: 'bank_transfer', child: Text('Bank Transfer (NEFT/RTGS/IMPS)', style: TextStyle(color: Colors.white, fontSize: 13))),
                            DropdownMenuItem(value: 'upi', child: Text('UPI Payment', style: TextStyle(color: Colors.white, fontSize: 13))),
                            DropdownMenuItem(value: 'cheque', child: Text('Cheque', style: TextStyle(color: Colors.white, fontSize: 13))),
                            DropdownMenuItem(value: 'cash', child: Text('Cash', style: TextStyle(color: Colors.white, fontSize: 13))),
                          ],
                          onChanged: (val) {
                            if (val != null) setModalState(() => disbursementMethod = val);
                          },
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Notes
                    const Text('Disbursement Notes / Reference', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 6),
                    TextField(
                      controller: notesController,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        hintText: 'e.g. Bank Batch Ref / Transaction ID...',
                        hintStyle: const TextStyle(color: AppColors.textMuted),
                        filled: true,
                        fillColor: AppColors.inputDark,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted)),
              ),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.success,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () => Navigator.pop(ctx, true),
                icon: const Icon(Icons.check_circle_outline, size: 18),
                label: const Text('Confirm & Start Next Cycle', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          );
        },
      ),
    );

    if (confirmed == true) {
      final amt = double.tryParse(amountController.text.trim()) ?? remainingPayable;
      final dateStr = DateFormat('yyyy-MM-dd').format(paymentDate);

      try {
        final res = await ApiService().disburseAndAdvanceCycle(
          cycleCode: cycle.cycleCode,
          paymentDate: dateStr,
          totalDisbursed: amt,
          disbursementMethod: disbursementMethod,
          notes: notesController.text.trim(),
        );

        if (mounted) {
          final batchRef = res['batch']?['batchReference'] ?? 'REF';
          final nextCode = res['nextCycle']?['cycleCode'] ?? 'Next';
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: AppColors.success,
              content: Text('Disbursement recorded (Ref: $batchRef). Next cycle $nextCode started with ₹0 opening balance.'),
              duration: const Duration(seconds: 5),
            ),
          );
        }
        _selectedCycle = null;
        _loadAllData();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: AppColors.error, content: Text(e.toString())),
          );
        }
      }
    }
  }

  Future<void> _recordEmployeePaymentDialog(SalaryCalculationModel c) async {
    final cycle = _selectedCycle ?? _activeCycle;
    if (cycle == null) return;

    final amountController = TextEditingController(text: c.remainingPayable.toStringAsFixed(2));
    final remarksController = TextEditingController();
    DateTime paymentDate = DateTime.now();
    String paymentMethod = 'bank_transfer';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          backgroundColor: AppColors.cardDark,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: Text('Record Payment: ${c.fullName}', style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildDetailRow('Cycle', cycle.cycleCode),
                _buildDetailRow('Net Payable', '₹${NumberFormat('#,##,##0.00').format(c.netSalary)}'),
                _buildDetailRow('Already Paid', '₹${NumberFormat('#,##,##0.00').format(c.amountDisbursed)}'),
                _buildDetailRow('Remaining Balance', '₹${NumberFormat('#,##,##0.00').format(c.remainingPayable)}', isBold: true, color: AppColors.warning),
                const Divider(color: Colors.white12, height: 20),
                const Text('Payment Date', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                InkWell(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: paymentDate,
                      firstDate: DateTime(2020),
                      lastDate: DateTime(2035),
                    );
                    if (picked != null) {
                      setModalState(() => paymentDate = picked);
                    }
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(color: AppColors.inputDark, borderRadius: BorderRadius.circular(12)),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(DateFormat('yyyy-MM-dd').format(paymentDate), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                        const Icon(Icons.calendar_today, color: AppColors.info, size: 18),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                const Text('Amount to Pay (₹)', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                TextField(
                  controller: amountController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 14),
                const Text('Payment Method', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(color: AppColors.inputDark, borderRadius: BorderRadius.circular(12)),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: paymentMethod,
                      dropdownColor: AppColors.cardDark,
                      isExpanded: true,
                      items: const [
                        DropdownMenuItem(value: 'bank_transfer', child: Text('Bank Transfer', style: TextStyle(color: Colors.white, fontSize: 13))),
                        DropdownMenuItem(value: 'upi', child: Text('UPI', style: TextStyle(color: Colors.white, fontSize: 13))),
                        DropdownMenuItem(value: 'cheque', child: Text('Cheque', style: TextStyle(color: Colors.white, fontSize: 13))),
                        DropdownMenuItem(value: 'cash', child: Text('Cash', style: TextStyle(color: Colors.white, fontSize: 13))),
                      ],
                      onChanged: (val) {
                        if (val != null) setModalState(() => paymentMethod = val);
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                const Text('Remarks / Transaction Ref', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                TextField(
                  controller: remarksController,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'e.g. UTR / Receipt No.',
                    hintStyle: const TextStyle(color: AppColors.textMuted),
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted))),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.success),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Record Payment', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );

    if (confirmed == true) {
      final amt = double.tryParse(amountController.text.trim()) ?? 0.0;
      if (amt <= 0) return;
      try {
        final dateStr = DateFormat('yyyy-MM-dd').format(paymentDate);
        await ApiService().recordAdditionalPayment(
          cycleCode: cycle.cycleCode,
          userId: c.userId,
          amount: amt,
          paymentDate: dateStr,
          paymentMethod: paymentMethod,
          remarks: remarksController.text.trim(),
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(backgroundColor: AppColors.success, content: Text('Employee payment recorded successfully')),
          );
        }
        _loadAllData();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: AppColors.error, content: Text(e.toString())),
          );
        }
      }
    }
  }

  Future<void> _exportCsvDialog() async {
    try {
      final csv = await ApiService().exportPayrollCsv(
        cycleCode: _selectedCycle?.cycleCode,
        month: _selectedCycle == null ? _monthStr : null,
      );
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppColors.cardDark,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: Row(
            children: [
              const Icon(Icons.table_chart, color: AppColors.success, size: 24),
              const SizedBox(width: 8),
              Text('Google Sheet CSV ($_monthStr)', style: const TextStyle(color: Colors.white, fontSize: 16)),
            ],
          ),
          content: SizedBox(
            width: double.maxFinite,
            height: 300,
            child: SingleChildScrollView(
              child: SelectableText(
                csv,
                style: const TextStyle(color: Colors.white70, fontFamily: 'monospace', fontSize: 11),
              ),
            ),
          ),
          actions: [
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(backgroundColor: AppColors.error, content: Text(e.toString())),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: AppColors.mainGradient,
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              _buildMonthNavigator(),
              Expanded(
                child: _isLoading
                    ? const Center(child: CircularProgressIndicator(color: Colors.white))
                    : _errorMessage != null
                        ? _buildErrorView()
                        : _buildMainContent(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back_ios, color: Colors.white, size: 20),
            onPressed: () => Navigator.pop(context),
          ),
          const SizedBox(width: 4),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Salary & Payroll Management',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                Text(
                  'Daily wages, fixed monthly, incentives & overtime',
                  style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _loadAllData,
          ),
        ],
      ),
    );
  }

  Widget _buildMonthNavigator() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left, color: Colors.white),
            onPressed: () => _changeMonth(-1),
          ),
          Row(
            children: [
              const Icon(Icons.calendar_month, color: AppColors.info, size: 18),
              const SizedBox(width: 8),
              Text(
                DateFormat('MMMM yyyy').format(_selectedMonth),
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
              ),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right, color: Colors.white),
            onPressed: () => _changeMonth(1),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppColors.error, size: 40),
            const SizedBox(height: 12),
            Text(_errorMessage!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _loadAllData, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }

  Widget _buildMainContent() {
    return Column(
      children: [
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(14),
          ),
          child: TabBar(
            controller: _tabController,
            indicatorColor: AppColors.info,
            labelColor: Colors.white,
            unselectedLabelColor: AppColors.textMuted,
            indicatorSize: TabBarIndicatorSize.tab,
            tabs: const [
              Tab(text: 'Payroll'),
              Tab(text: 'Settings'),
              Tab(text: 'Incentives'),
              Tab(text: 'Overtime'),
            ],
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _buildPayrollTab(),
              _buildSettingsTab(),
              _buildIncentivesTab(),
              _buildOvertimeTab(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildPayrollTab() {
    final totalNet = _calculations.fold<double>(0.0, (sum, c) => sum + c.netSalary);
    final totalGross = _calculations.fold<double>(0.0, (sum, c) => sum + c.grossSalary);
    final totalDisbursedSoFar = _calculations.fold<double>(0.0, (sum, c) => sum + c.amountDisbursed);
    final remainingLiability = (totalNet - totalDisbursedSoFar) > 0 ? (totalNet - totalDisbursedSoFar) : 0.0;
    final currentCycle = _selectedCycle ?? _activeCycle;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // Cycle Selection & Information Banner
        Container(
          margin: const EdgeInsets.only(bottom: 16),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.info.withOpacity(0.3)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.sync_alt, color: AppColors.info, size: 20),
                      const SizedBox(width: 8),
                      Text(
                        currentCycle != null ? 'Cycle: ${currentCycle.cycleCode}' : 'Monthly Cycle',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                      ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: (currentCycle?.status == 'paid'
                              ? AppColors.success
                              : currentCycle?.status == 'partially_paid'
                                  ? Colors.orange
                                  : currentCycle?.status == 'closed_unpaid'
                                      ? AppColors.error
                                      : AppColors.info)
                          .withOpacity(0.18),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      (currentCycle?.status ?? 'active').toUpperCase(),
                      style: TextStyle(
                        color: currentCycle?.status == 'paid'
                            ? AppColors.success
                            : currentCycle?.status == 'partially_paid'
                                ? Colors.orange
                                : currentCycle?.status == 'closed_unpaid'
                                    ? AppColors.error
                                    : AppColors.info,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                currentCycle != null
                    ? 'Period: ${currentCycle.startDate} to ${currentCycle.endDate} (Monthly boundary on 3rd at 00:00 IST)'
                    : 'Salary Cycle Period (Monthly boundary on 3rd at 00:00 IST)',
                style: const TextStyle(color: AppColors.textDim, fontSize: 12),
              ),
              if (_cycles.length > 1) ...[
                const SizedBox(height: 10),
                DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: currentCycle?.cycleCode,
                    dropdownColor: AppColors.cardDark,
                    isDense: true,
                    isExpanded: true,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    items: _cycles.map((cy) {
                      return DropdownMenuItem<String>(
                        value: cy.cycleCode,
                        child: Text(
                          '${cy.cycleCode} (${cy.startDate} ~ ${cy.endDate}) [${cy.status.toUpperCase()}]',
                          style: TextStyle(
                            color: cy.cycleCode == _activeCycle?.cycleCode ? Colors.cyanAccent : Colors.white70,
                            fontWeight: cy.cycleCode == _activeCycle?.cycleCode ? FontWeight.bold : FontWeight.normal,
                          ),
                        ),
                      );
                    }).toList(),
                    onChanged: (selectedCode) {
                      if (selectedCode != null) {
                        final found = _cycles.where((c) => c.cycleCode == selectedCode).toList();
                        if (found.isNotEmpty) _onCycleChanged(found.first);
                      }
                    },
                  ),
                ),
              ],
            ],
          ),
        ),

        // Summary & Status Card
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF0F172A), Color(0xFF1E3A8A)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFF3B82F6).withOpacity(0.35)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: _isFinalized ? AppColors.success.withOpacity(0.2) : Colors.orange.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      _isFinalized
                          ? (_finalizedAt != null
                              ? 'LOCKED & FINALIZED (${_finalizedAt!.length >= 10 ? _finalizedAt!.substring(0, 10) : _finalizedAt})'
                              : 'LOCKED & FINALIZED')
                          : 'DRAFT PREVIEW',
                      style: TextStyle(color: _isFinalized ? AppColors.success : Colors.orange, fontWeight: FontWeight.bold, fontSize: 11),
                    ),
                  ),
                  Row(
                    children: [
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          side: const BorderSide(color: Colors.white38),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        ),
                        onPressed: _exportCsvDialog,
                        icon: const Icon(Icons.table_view, size: 15),
                        label: const Text('Export CSV', style: TextStyle(fontSize: 11)),
                      ),
                      if (!_isFinalized) ...[
                        const SizedBox(width: 8),
                        ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.warning,
                            foregroundColor: Colors.black,
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          ),
                          onPressed: _finalizePayrollDialog,
                          icon: const Icon(Icons.lock, size: 15),
                          label: const Text('Finalize', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const Text('Total Net Payout', style: TextStyle(color: Colors.white70, fontSize: 12)),
              const SizedBox(height: 2),
              Text(
                '₹${NumberFormat('#,##,##0.00').format(totalNet)}',
                style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),
              Divider(color: Colors.white.withOpacity(0.15)),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Total Gross', style: TextStyle(color: Colors.white60, fontSize: 11)),
                      Text('₹${NumberFormat('#,##,##0').format(totalGross)}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Total Disbursed', style: TextStyle(color: Colors.white60, fontSize: 11)),
                      Text('₹${NumberFormat('#,##,##0').format(totalDisbursedSoFar)}', style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      const Text('Remaining Payable', style: TextStyle(color: Colors.white60, fontSize: 11)),
                      Text('₹${NumberFormat('#,##,##0').format(remainingLiability)}', style: const TextStyle(color: Colors.amberAccent, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // Record Salary Disbursement & Reset Cycle Action Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF064E3B).withOpacity(0.4),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFF10B981).withOpacity(0.4)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.account_balance_wallet, color: AppColors.success, size: 20),
                  SizedBox(width: 8),
                  Text(
                    'Salary Disbursement & Cycle Management',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'Record payments, snapshot current payroll immutably, and advance to the next salary cycle with ₹0 opening earnings.',
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.success,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 13),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    elevation: 3,
                  ),
                  onPressed: _showDisburseAndAdvanceDialog,
                  icon: const Icon(Icons.playlist_add_check_circle_outlined, size: 20),
                  label: const Text(
                    'Record Salary Disbursement & Start Next Cycle',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 20),
        const Text('Employee Payroll Records', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),

        ..._calculations.map((c) {
          final isDaily = c.salaryType == 'daily_wage';
          final paymentStatus = c.paymentStatus.isNotEmpty ? c.paymentStatus : (c.isFinalized ? 'finalized' : 'draft');
          final isPaid = paymentStatus == 'paid';
          final isPartiallyPaid = paymentStatus == 'partially_paid';

          return Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.cardDark,
              borderRadius: BorderRadius.circular(16),
            ),
            child: InkWell(
              onTap: () => _showEmployeePayrollDetail(c),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          c.fullName,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                        ),
                      ),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: isDaily ? Colors.amber.withOpacity(0.15) : Colors.cyan.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: isDaily ? Colors.amber : Colors.cyan),
                            ),
                            child: Text(
                              isDaily ? 'DAILY WAGE' : 'FIXED MONTHLY',
                              style: TextStyle(color: isDaily ? Colors.amber : Colors.cyan, fontSize: 9.5, fontWeight: FontWeight.bold),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                            decoration: BoxDecoration(
                              color: (isPaid
                                      ? AppColors.success
                                      : isPartiallyPaid
                                          ? Colors.orange
                                          : c.isFinalized
                                              ? Colors.blue
                                              : Colors.grey)
                                  .withOpacity(0.2),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              paymentStatus.replaceAll('_', ' ').toUpperCase(),
                              style: TextStyle(
                                color: isPaid
                                    ? AppColors.success
                                    : isPartiallyPaid
                                        ? Colors.orange
                                        : c.isFinalized
                                            ? Colors.lightBlueAccent
                                            : Colors.grey,
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${c.department ?? 'General'} • Days Present: ${c.presentDays} • Absences: ${c.absentDays}',
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                  ),
                  const Divider(color: Colors.white12, height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Gross', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                          Text('₹${NumberFormat('#,##,##0').format(c.grossSalary)}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Deductions', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                          Text('₹${NumberFormat('#,##,##0').format(c.totalDeductions)}', style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          const Text('Net Salary', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                          Text('₹${NumberFormat('#,##,##0').format(c.netSalary)}', style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.bold, fontSize: 16)),
                        ],
                      ),
                    ],
                  ),
                  if (c.amountDisbursed > 0 || c.remainingPayable > 0) ...[
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Paid: ₹${c.amountDisbursed.toStringAsFixed(0)}', style: const TextStyle(color: AppColors.textDim, fontSize: 11)),
                        Text(
                          'Remaining: ₹${c.remainingPayable.toStringAsFixed(0)}',
                          style: TextStyle(color: c.remainingPayable > 0 ? Colors.amberAccent : AppColors.textDim, fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          );
        }),
      ],
    );
  }

  void _showEmployeePayrollDetail(SalaryCalculationModel c) {
    final isDaily = c.salaryType == 'daily_wage';
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.cardDark,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(c.fullName, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                IconButton(icon: const Icon(Icons.close, color: Colors.white), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            Text('${c.salaryType == 'daily_wage' ? 'Daily Wage Worker' : 'Fixed Monthly'} • ${c.payrollPeriod}', style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
            const Divider(color: Colors.white24, height: 24),
            _buildDetailRow('Present Days', '${c.presentDays} days'),
            _buildDetailRow('Paid Leaves', '${c.paidLeaveDays} days'),
            _buildDetailRow('Payable Days', '${c.payableDays} days'),
            _buildDetailRow('Absent Days', '${c.absentDays} days'),
            const Divider(color: Colors.white12, height: 16),
            _buildDetailRow(
              isDaily ? 'Basic Wage (₹${c.baseRate} × ${c.payableDays})' : 'Monthly Basic Salary (Cap: ₹${c.monthlySalaryCap ?? c.baseRate})',
              '₹${NumberFormat('#,##,##0.00').format(c.basicSalary)}',
            ),
            if (c.incentiveSalary > 0) _buildDetailRow('Daily Incentives', '+ ₹${NumberFormat('#,##,##0.00').format(c.incentiveSalary)}', color: AppColors.success),
            if (c.overtimeAmount > 0) _buildDetailRow('Approved Overtime', '+ ₹${NumberFormat('#,##,##0.00').format(c.overtimeAmount)}', color: AppColors.success),
            _buildDetailRow('Gross Salary', '₹${NumberFormat('#,##,##0.00').format(c.grossSalary)}', isBold: true),
            const Divider(color: Colors.white12, height: 16),
            if (isDaily) ...[
              _buildDetailRow('Employee EPF (12%)', '- ₹${NumberFormat('#,##,##0.00').format(c.employeeEpf)}', color: AppColors.error),
              _buildDetailRow('Employee ESIC (0.75%)', '- ₹${NumberFormat('#,##,##0.00').format(c.employeeEsic)}', color: AppColors.error),
            ] else ...[
              _buildDetailRow('Company 5% Deduction', '- ₹${NumberFormat('#,##,##0.00').format(c.gratuityDeduction)}', color: AppColors.error),
            ],
            const Divider(color: Colors.white24, height: 20),
            _buildDetailRow('Net Payable Salary', '₹${NumberFormat('#,##,##0.00').format(c.netSalary)}', isBold: true, color: AppColors.success),
            const Divider(color: Colors.white12, height: 16),
            _buildDetailRow('Payment Status', c.paymentStatus.replaceAll('_', ' ').toUpperCase(), color: c.paymentStatus == 'paid' ? AppColors.success : (c.paymentStatus == 'partially_paid' ? Colors.orange : Colors.white70)),
            _buildDetailRow('Amount Disbursed', '₹${NumberFormat('#,##,##0.00').format(c.amountDisbursed)}'),
            _buildDetailRow('Remaining Balance', '₹${NumberFormat('#,##,##0.00').format(c.remainingPayable)}', isBold: true, color: c.remainingPayable > 0 ? AppColors.warning : AppColors.success),
            if (c.paymentDate != null) _buildDetailRow('Payment Date', c.paymentDate!),
            if (c.disbursementReference != null) _buildDetailRow('Disbursement Ref', c.disbursementReference!),
            if (isDaily) ...[
              const Divider(color: Colors.white12, height: 16),
              _buildDetailRow('Employer EPF (12%)', '₹${NumberFormat('#,##,##0.00').format(c.employerEpf)}'),
              _buildDetailRow('Employer ESIC (3.25%)', '₹${NumberFormat('#,##,##0.00').format(c.employerEsic)}'),
              _buildDetailRow('Total CTC', '₹${NumberFormat('#,##,##0.00').format(c.ctc)}', isBold: true, color: Colors.cyanAccent),
            ],
            if (c.remainingPayable > 0) ...[
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.success,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    _recordEmployeePaymentDialog(c);
                  },
                  icon: const Icon(Icons.payment, size: 18),
                  label: const Text('Record Individual / Partial Payment', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ),
            ],
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, {bool isBold = false, Color? color}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: isBold ? FontWeight.bold : FontWeight.normal)),
          Text(value, style: TextStyle(color: color ?? Colors.white, fontSize: 13, fontWeight: isBold ? FontWeight.bold : FontWeight.normal)),
        ],
      ),
    );
  }

  Widget _buildSettingsTab() {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // System Start Date & Cycle Policy Banner
        Container(
          margin: const EdgeInsets.only(bottom: 18),
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.cyan.withOpacity(0.4)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.verified_outlined, color: Colors.cyanAccent, size: 22),
                  SizedBox(width: 8),
                  Text('Official Salary System Rules', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                ],
              ),
              const SizedBox(height: 10),
              _buildDetailRow('Official Start Date', _settings?.officialStartDate ?? '2026-11-03', color: Colors.cyanAccent, isBold: true),
              _buildDetailRow('Cycle Boundary', '3rd of every month at 00:00 IST', color: Colors.white70),
              _buildDetailRow('Zero-Balance Fresh Start', 'Strict zero opening accrued balance', color: AppColors.success),
              _buildDetailRow('Fixed Monthly Salary Cap', 'Gross never exceeds configured basic salary', color: Colors.amberAccent),
              const SizedBox(height: 6),
              const Text(
                'Attendance and earnings prior to 3 November 2026 are excluded from payroll calculations. Historical records, leaves, selfies and audit logs remain fully preserved.',
                style: TextStyle(color: AppColors.textDim, fontSize: 11),
              ),
            ],
          ),
        ),

        // Common Daily Wage Card
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.amber.withOpacity(0.3)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.payments_outlined, color: Colors.amber, size: 22),
                  SizedBox(width: 8),
                  Text('Common Daily Basic Wage Rate', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'Applicable to all daily-wage employees across the company unless explicitly overridden.',
                style: TextStyle(color: AppColors.textDim, fontSize: 12),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _commonWageController,
                      keyboardType: TextInputType.number,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                      decoration: InputDecoration(
                        prefixText: '₹ ',
                        prefixStyle: const TextStyle(color: Colors.white70),
                        filled: true,
                        fillColor: AppColors.inputDark,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.amber,
                      foregroundColor: Colors.black,
                      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: _saveCommonDailyWage,
                    child: const Text('Update Rate', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
            ],
          ),
        ),

        const SizedBox(height: 24),
        const Text('Employee Salary Configurations', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),

        ..._configs.map((c) {
          final isDaily = c.salaryType == 'daily_wage';
          return Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.cardDark,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.fullName, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                      const SizedBox(height: 2),
                      Text(c.email, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                      const SizedBox(height: 6),
                      Text(
                        isDaily
                            ? '${c.dailyWageOverride != null ? 'Daily Wage (Override: ₹${c.dailyWageOverride})' : 'Daily Wage (Common: ₹${_settings?.commonDailyWage ?? 650})'}${c.dailyIncentiveRate > 0 ? ' • Inc: ₹${c.dailyIncentiveRate.toStringAsFixed(0)}/day' : ''}'
                            : 'Fixed Monthly: ₹${NumberFormat('#,##,##0').format(c.monthlyBasicSalary)}',
                        style: TextStyle(
                          color: isDaily ? Colors.amber : Colors.cyan,
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.edit, color: AppColors.info, size: 20),
                  onPressed: () => _editEmployeeConfigDialog(c),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  void _editEmployeeConfigDialog(EmployeeSalaryConfigModel c) {
    String selectedType = c.salaryType;
    final monthlyController = TextEditingController(text: c.monthlyBasicSalary > 0 ? c.monthlyBasicSalary.toStringAsFixed(0) : '');
    final overrideController = TextEditingController(text: c.dailyWageOverride != null ? c.dailyWageOverride!.toStringAsFixed(0) : '');
    final incentiveController = TextEditingController(text: c.dailyIncentiveRate > 0 ? c.dailyIncentiveRate.toStringAsFixed(0) : '');
    final remarksController = TextEditingController(text: c.remarks ?? '');

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          backgroundColor: AppColors.cardDark,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: Text('Edit Salary: ${c.fullName}', style: const TextStyle(color: Colors.white, fontSize: 17)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Salary Type', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: ChoiceChip(
                        label: const Text('Daily Wage'),
                        selected: selectedType == 'daily_wage',
                        onSelected: (val) {
                          if (val) setModalState(() => selectedType = 'daily_wage');
                        },
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: ChoiceChip(
                        label: const Text('Fixed Monthly'),
                        selected: selectedType == 'fixed_monthly',
                        onSelected: (val) {
                          if (val) setModalState(() => selectedType = 'fixed_monthly');
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                if (selectedType == 'fixed_monthly') ...[
                  const Text('Monthly Basic Salary (₹)', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  const SizedBox(height: 6),
                  TextField(
                    controller: monthlyController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      hintText: 'e.g. 26000',
                      hintStyle: const TextStyle(color: AppColors.textMuted),
                      filled: true,
                      fillColor: AppColors.inputDark,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                    ),
                  ),
                ] else ...[
                  const Text('Daily Wage Override (Optional ₹)', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  const SizedBox(height: 6),
                  TextField(
                    controller: overrideController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      hintText: 'Leave empty to use common rate',
                      hintStyle: const TextStyle(color: AppColors.textMuted),
                      filled: true,
                      fillColor: AppColors.inputDark,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text('Fixed Daily Incentive (₹/day)', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  const SizedBox(height: 6),
                  TextField(
                    controller: incentiveController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      hintText: 'e.g. 100/day for present days',
                      hintStyle: const TextStyle(color: AppColors.textMuted),
                      filled: true,
                      fillColor: AppColors.inputDark,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                const Text('Remarks', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: remarksController,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'Optional remarks...',
                    hintStyle: const TextStyle(color: AppColors.textMuted),
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted))),
            ElevatedButton(
              onPressed: () async {
                Navigator.pop(ctx);
                try {
                  await ApiService().saveEmployeeSalaryConfig(
                    userId: c.userId,
                    salaryType: selectedType,
                    monthlyBasicSalary: double.tryParse(monthlyController.text.trim()) ?? 0.0,
                    dailyWageOverride: overrideController.text.trim().isNotEmpty ? double.tryParse(overrideController.text.trim()) : null,
                    dailyIncentiveRate: incentiveController.text.trim().isNotEmpty ? double.tryParse(incentiveController.text.trim()) : 0.0,
                    effectiveDate: DateTime.now().toIso8601String().substring(0, 10),
                    remarks: remarksController.text.trim(),
                  );
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(backgroundColor: AppColors.success, content: Text('Employee salary updated successfully')),
                    );
                  }
                  _loadAllData();
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(backgroundColor: AppColors.error, content: Text(e.toString())));
                  }
                }
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildIncentivesTab() {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.info,
        icon: const Icon(Icons.add, color: Colors.white),
        label: const Text('Add Daily Incentive', style: TextStyle(color: Colors.white)),
        onPressed: _addIncentiveDialog,
      ),
      body: _incentives.isEmpty
          ? const Center(child: Text('No daily incentives recorded for this month', style: TextStyle(color: AppColors.textMuted)))
          : ListView.builder(
              padding: const EdgeInsets.all(20),
              itemCount: _incentives.length,
              itemBuilder: (context, index) {
                final inc = _incentives[index];
                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.cardDark,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(inc.fullName ?? 'Employee #${inc.userId}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                          const SizedBox(height: 2),
                          Text('${inc.date} • ${inc.description ?? 'Daily incentive'}', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                        ],
                      ),
                      Row(
                        children: [
                          Text(
                            '₹${NumberFormat('#,##,##0').format(inc.amount)}',
                            style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.bold, fontSize: 15),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete_outline, color: AppColors.error, size: 20),
                            onPressed: () async {
                              await ApiService().deleteIncentive(inc.id);
                              _loadAllData();
                            },
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }

  void _addIncentiveDialog() {
    int? selectedUserId = _configs.isNotEmpty ? _configs.first.userId : null;
    final dateController = TextEditingController(text: DateFormat('yyyy-MM-dd').format(DateTime.now()));
    final amountController = TextEditingController();
    final descController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          backgroundColor: AppColors.cardDark,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Text('Add Daily Incentive', style: TextStyle(color: Colors.white, fontSize: 18)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Select Employee', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                DropdownButtonFormField<int>(
                  value: selectedUserId,
                  dropdownColor: AppColors.inputDark,
                  style: const TextStyle(color: Colors.white),
                  items: _configs
                      .map((c) => DropdownMenuItem<int>(
                            value: c.userId,
                            child: Text(c.fullName, style: const TextStyle(color: Colors.white, fontSize: 13)),
                          ))
                      .toList(),
                  onChanged: (val) => setModalState(() => selectedUserId = val),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),
                const Text('Date (YYYY-MM-DD)', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: dateController,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),
                const Text('Incentive Amount (₹)', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: amountController,
                  keyboardType: TextInputType.number,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'e.g. 200',
                    hintStyle: const TextStyle(color: AppColors.textMuted),
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),
                const Text('Reason / Description', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: descController,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'Daily performance incentive',
                    hintStyle: const TextStyle(color: AppColors.textMuted),
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted))),
            ElevatedButton(
              onPressed: () async {
                final amt = double.tryParse(amountController.text.trim());
                if (selectedUserId == null || amt == null || amt <= 0) {
                  return;
                }
                Navigator.pop(ctx);
                try {
                  await ApiService().createIncentive(
                    userId: selectedUserId!,
                    date: dateController.text.trim(),
                    amount: amt,
                    description: descController.text.trim(),
                  );
                  _loadAllData();
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(backgroundColor: AppColors.error, content: Text(e.toString())));
                  }
                }
              },
              child: const Text('Submit'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOvertimeTab() {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.info,
        icon: const Icon(Icons.add, color: Colors.white),
        label: const Text('Record Overtime', style: TextStyle(color: Colors.white)),
        onPressed: _addOvertimeDialog,
      ),
      body: _overtimes.isEmpty
          ? const Center(child: Text('No overtime recorded for this month', style: TextStyle(color: AppColors.textMuted)))
          : ListView.builder(
              padding: const EdgeInsets.all(20),
              itemCount: _overtimes.length,
              itemBuilder: (context, index) {
                final ot = _overtimes[index];
                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.cardDark,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(ot.fullName ?? 'Employee #${ot.userId}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                          const SizedBox(height: 2),
                          Text('${ot.date} • ${ot.hours} hrs${ot.remarks != null ? ' • ${ot.remarks}' : ''}', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                        ],
                      ),
                      Row(
                        children: [
                          Text(
                            '₹${NumberFormat('#,##,##0').format(ot.amount)}',
                            style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.bold, fontSize: 15),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete_outline, color: AppColors.error, size: 20),
                            onPressed: () async {
                              await ApiService().deleteOvertime(ot.id);
                              _loadAllData();
                            },
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }

  void _addOvertimeDialog() {
    int? selectedUserId = _configs.isNotEmpty ? _configs.first.userId : null;
    final dateController = TextEditingController(text: DateFormat('yyyy-MM-dd').format(DateTime.now()));
    final hoursController = TextEditingController();
    final amountController = TextEditingController();
    final remarksController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          backgroundColor: AppColors.cardDark,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Text('Record Overtime', style: TextStyle(color: Colors.white, fontSize: 18)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Select Employee', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                DropdownButtonFormField<int>(
                  value: selectedUserId,
                  dropdownColor: AppColors.inputDark,
                  style: const TextStyle(color: Colors.white),
                  items: _configs
                      .map((c) => DropdownMenuItem<int>(
                            value: c.userId,
                            child: Text(c.fullName, style: const TextStyle(color: Colors.white, fontSize: 13)),
                          ))
                      .toList(),
                  onChanged: (val) => setModalState(() => selectedUserId = val),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),
                const Text('Date (YYYY-MM-DD)', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: dateController,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Hours', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: hoursController,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            decoration: InputDecoration(
                              hintText: 'e.g. 4',
                              hintStyle: const TextStyle(color: AppColors.textMuted),
                              filled: true,
                              fillColor: AppColors.inputDark,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Approved ₹', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: amountController,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            decoration: InputDecoration(
                              hintText: 'e.g. 400',
                              hintStyle: const TextStyle(color: AppColors.textMuted),
                              filled: true,
                              fillColor: AppColors.inputDark,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Text('Remarks', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: remarksController,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'Site work / night shift',
                    hintStyle: const TextStyle(color: AppColors.textMuted),
                    filled: true,
                    fillColor: AppColors.inputDark,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted))),
            ElevatedButton(
              onPressed: () async {
                final hrs = double.tryParse(hoursController.text.trim()) ?? 0;
                final amt = double.tryParse(amountController.text.trim());
                if (selectedUserId == null || amt == null || amt < 0) {
                  return;
                }
                Navigator.pop(ctx);
                try {
                  await ApiService().createOvertime(
                    userId: selectedUserId!,
                    date: dateController.text.trim(),
                    hours: hrs,
                    amount: amt,
                    remarks: remarksController.text.trim(),
                  );
                  _loadAllData();
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(backgroundColor: AppColors.error, content: Text(e.toString())));
                  }
                }
              },
              child: const Text('Submit'),
            ),
          ],
        ),
      ),
    );
  }
}
