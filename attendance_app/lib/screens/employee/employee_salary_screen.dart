import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/salary_models.dart';

class EmployeeSalaryScreen extends StatefulWidget {
  const EmployeeSalaryScreen({super.key});

  @override
  State<EmployeeSalaryScreen> createState() => _EmployeeSalaryScreenState();
}

class _EmployeeSalaryScreenState extends State<EmployeeSalaryScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  String? _errorMessage;

  DateTime _selectedMonth = DateTime.now();
  SalaryCalculationModel? _salary;
  List<DailyIncentiveModel> _incentives = [];
  double _incentivesTotal = 0;
  List<OvertimeRecordModel> _overtimes = [];
  double _overtimeTotalAmount = 0;
  List<SalaryCalculationModel> _history = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadAllSalaryData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  String get _monthStr => DateFormat('yyyy-MM').format(_selectedMonth);

  Future<void> _loadAllSalaryData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final salary = await ApiService().getMySalary(month: _monthStr);
      final incRes = await ApiService().getMyIncentives(month: _monthStr);
      final otRes = await ApiService().getMyOvertime(month: _monthStr);
      final hist = await ApiService().getMyPayrollHistory();

      if (mounted) {
        setState(() {
          _salary = salary;
          _incentives = incRes;
          _incentivesTotal = incRes.fold<double>(0.0, (sum, i) => sum + (i.status == 'approved' ? i.amount : 0.0));
          _overtimes = otRes;
          _overtimeTotalAmount = otRes.fold<double>(0.0, (sum, o) => sum + (o.status == 'approved' ? o.amount : 0.0));
          _history = hist;
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

  void _changeMonth(int offset) {
    setState(() {
      _selectedMonth = DateTime(_selectedMonth.year, _selectedMonth.month + offset, 1);
    });
    _loadAllSalaryData();
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
                  'My Salary & Payslip',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                Text(
                  'Server-verified earnings and deductions',
                  style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _loadAllSalaryData,
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
            ElevatedButton(onPressed: _loadAllSalaryData, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }

  Widget _buildMainContent() {
    return Column(
      children: [
        // Tabs
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
              Tab(text: 'Summary'),
              Tab(text: 'Incentives'),
              Tab(text: 'Overtime'),
              Tab(text: 'History'),
            ],
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _buildSummaryTab(),
              _buildIncentivesTab(),
              _buildOvertimeTab(),
              _buildHistoryTab(),
            ],
          ),
        ),
      ],
    );
  }

  String _getStatusText(SalaryCalculationModel s) {
    if (s.paymentStatus == 'paid') return 'PAID';
    if (s.paymentStatus == 'partially_paid') return 'PARTIALLY PAID';
    if (s.paymentStatus == 'closed_unpaid') return 'CLOSED — UNPAID';
    if (s.isFinalized) return 'FINALIZED';
    if (!s.hasConfig || (s.payableDays == 0 && s.absentDays > 0)) return 'REVIEW REQUIRED';
    return 'DRAFT';
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'PAID':
        return AppColors.success;
      case 'PARTIALLY PAID':
        return Colors.orange;
      case 'CLOSED — UNPAID':
        return AppColors.error;
      case 'FINALIZED':
        return Colors.lightBlueAccent;
      case 'REVIEW REQUIRED':
        return Colors.amber;
      default:
        return Colors.cyan;
    }
  }

  Widget _buildSummaryTab() {
    if (_salary == null) {
      return const Center(child: Text('No salary record available', style: TextStyle(color: AppColors.textMuted)));
    }

    final s = _salary!;
    final isDaily = s.salaryType == 'daily_wage';
    final statusText = _getStatusText(s);
    final statusColor = _getStatusColor(statusText);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Configuration Warning Banner if config missing
          if (!s.hasConfig) ...[
            Container(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.warning.withOpacity(0.15),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.warning.withOpacity(0.4)),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.warning_amber_rounded, color: AppColors.warning, size: 22),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Configuration Setup Required: Your profile does not have an assigned salary rate or wage configuration. Please contact your company administrator to configure your daily wage or monthly salary.',
                      style: TextStyle(color: AppColors.warning, fontSize: 12.5),
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Cycle Information Banner
          Container(
            margin: const EdgeInsets.only(bottom: 16),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.cardDark,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.info.withOpacity(0.25)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.calendar_today, color: AppColors.info, size: 16),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Salary Cycle Period', style: TextStyle(color: AppColors.textDim, fontSize: 10.5)),
                        Text(
                          s.cycleStartDate.isNotEmpty
                              ? '${s.cycleStartDate} to ${s.cycleEndDate} (3rd boundary)'
                              : '${s.payrollPeriod} Cycle (3rd boundary)',
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                      ],
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.18),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: statusColor.withOpacity(0.6)),
                  ),
                  child: Text(
                    statusText,
                    style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 10),
                  ),
                ),
              ],
            ),
          ),

          // Net Salary Hero Card
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF0F172A), Color(0xFF1E3A8A)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: const Color(0xFF3B82F6).withOpacity(0.4)),
              boxShadow: const [
                BoxShadow(color: Colors.black45, blurRadius: 15, spreadRadius: 2),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: isDaily ? Colors.amber.withOpacity(0.2) : Colors.cyan.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: isDaily ? Colors.amber : Colors.cyan),
                          ),
                          child: Text(
                            isDaily ? 'DAILY WAGES' : 'FIXED MONTHLY',
                            style: TextStyle(
                              color: isDaily ? Colors.amber : Colors.cyan,
                              fontWeight: FontWeight.bold,
                              fontSize: 11,
                            ),
                          ),
                        ),
                      ],
                    ),
                    Text(
                      isDaily
                          ? 'Rate: ₹${s.baseRate.toStringAsFixed(0)}/day'
                          : 'Basic: ₹${NumberFormat('#,##,##0').format(s.baseRate)} (Cap)',
                      style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                const Text('Net Payable Take-Home Salary', style: TextStyle(color: Colors.white70, fontSize: 13)),
                const SizedBox(height: 4),
                Text(
                  '₹${NumberFormat('#,##,##0.00').format(s.netSalary)}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 32,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 14),
                Divider(color: Colors.white.withOpacity(0.15)),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _buildStatItem('Gross Salary', '₹${NumberFormat('#,##,##0').format(s.grossSalary)}'),
                    _buildStatItem('Already Paid', '₹${NumberFormat('#,##,##0').format(s.amountDisbursed)}'),
                    _buildStatItem(
                      'Remaining Payable',
                      '₹${NumberFormat('#,##,##0').format(s.remainingPayable)}',
                    ),
                  ],
                ),
                if (s.paymentDate != null || s.disbursementReference != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        if (s.paymentDate != null)
                          Text('Paid: ${s.paymentDate}', style: const TextStyle(color: AppColors.textDim, fontSize: 11)),
                        if (s.disbursementReference != null)
                          Text('Ref: ${s.disbursementReference}', style: const TextStyle(color: AppColors.textDim, fontSize: 11)),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(height: 22),

          // Attendance Inputs Card
          const Text('Attendance & Payable Days', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: AppColors.cardDark,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              children: [
                _buildRow('Present Days (Duty Checked-in)', '${s.presentDays} days', color: AppColors.success),
                const Divider(color: Colors.white12),
                _buildRow('Paid Leaves Covered', '${s.paidLeaveDays} days', color: AppColors.info),
                const Divider(color: Colors.white12),
                _buildRow('Payable Days Counted', '${s.payableDays} days', isBold: true),
                const Divider(color: Colors.white12),
                _buildRow('Absent Days', '${s.absentDays} days', color: s.absentDays > 2 ? AppColors.error : AppColors.textDim),
                if (!isDaily) ...[
                  const Divider(color: Colors.white12),
                  _buildRow('Allowed Absences', '2 days (No deduction)', color: AppColors.success),
                  const Divider(color: Colors.white12),
                  _buildRow('Excess Absences Deducted', '${s.excessAbsentDays} days', color: AppColors.error),
                ],
              ],
            ),
          ),

          const SizedBox(height: 22),

          // Earnings & Deductions Breakdown
          const Text('Earnings & Deductions Breakdown', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: AppColors.cardDark,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              children: [
                _buildRow(
                  isDaily
                      ? 'Basic Wage (₹${s.baseRate} × ${s.payableDays} days)'
                      : 'Monthly Basic Salary (Cap: ₹${s.monthlySalaryCap ?? s.baseRate})',
                  '₹${NumberFormat('#,##,##0.00').format(s.basicSalary)}',
                ),
                if (s.incentiveSalary > 0) ...[
                  const Divider(color: Colors.white12),
                  _buildRow('Daily Incentives Total', '+ ₹${NumberFormat('#,##,##0.00').format(s.incentiveSalary)}', color: AppColors.success),
                ],
                if (s.overtimeAmount > 0) ...[
                  const Divider(color: Colors.white12),
                  _buildRow('Approved Overtime (${s.overtimeHours} hrs)', '+ ₹${NumberFormat('#,##,##0.00').format(s.overtimeAmount)}', color: AppColors.success),
                ],
                const Divider(color: Colors.white24),
                _buildRow('Gross Salary (Capped)', '₹${NumberFormat('#,##,##0.00').format(s.grossSalary)}', isBold: true),
                const Divider(color: Colors.white24),
                if (isDaily) ...[
                  _buildRow('Employee EPF (12%)', '- ₹${NumberFormat('#,##,##0.00').format(s.employeeEpf)}', color: AppColors.error),
                  const Divider(color: Colors.white12),
                  _buildRow('Employee ESIC (0.75%)', '- ₹${NumberFormat('#,##,##0.00').format(s.employeeEsic)}', color: AppColors.error),
                ] else ...[
                  _buildRow('Company 5% Deduction', '- ₹${NumberFormat('#,##,##0.00').format(s.gratuityDeduction)}', color: AppColors.error),
                ],
                const Divider(color: Colors.white24),
                _buildRow('Net Payable Salary', '₹${NumberFormat('#,##,##0.00').format(s.netSalary)}', isBold: true, color: AppColors.success),
              ],
            ),
          ),

          if (!isDaily) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.amber.withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.amber.withOpacity(0.4)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.info_outline, color: Colors.amber, size: 20),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '5% deduction is configured by company policy pending confirmation of its legal and accounting classification.',
                      style: TextStyle(color: Colors.amber, fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
          ],

          if (isDaily) ...[
            const SizedBox(height: 22),
            const Text('Employer Contributions (Company Cost)', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: AppColors.cardDark,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                children: [
                  _buildRow('Employer EPF (12%)', '₹${NumberFormat('#,##,##0.00').format(s.employerEpf)}'),
                  const Divider(color: Colors.white12),
                  _buildRow('Employer ESIC (3.25%)', '₹${NumberFormat('#,##,##0.00').format(s.employerEsic)}'),
                  const Divider(color: Colors.white24),
                  _buildRow('Total Cost to Company (CTC)', '₹${NumberFormat('#,##,##0.00').format(s.ctc)}', isBold: true, color: Colors.cyanAccent),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildIncentivesTab() {
    if (_incentives.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.stars_outlined, size: 54, color: Colors.white.withOpacity(0.3)),
            const SizedBox(height: 14),
            const Text('No daily incentives recorded for this month', style: TextStyle(color: AppColors.textMuted)),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.success.withOpacity(0.15),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.success.withOpacity(0.3)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Approved Incentives Total', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              Text(
                '₹${NumberFormat('#,##,##0.00').format(_incentivesTotal)}',
                style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.bold, fontSize: 18),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        ..._incentives.map((i) {
          final isApp = i.status == 'approved';
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
                    Text(i.date, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                    const SizedBox(height: 3),
                    Text(i.description ?? 'Daily incentive', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '₹${NumberFormat('#,##,##0.00').format(i.amount)}',
                      style: TextStyle(
                        color: isApp ? AppColors.success : AppColors.error,
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      i.status.toUpperCase(),
                      style: TextStyle(color: isApp ? AppColors.success : AppColors.error, fontSize: 10, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  Widget _buildOvertimeTab() {
    if (_overtimes.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.more_time_outlined, size: 54, color: Colors.white.withOpacity(0.3)),
            const SizedBox(height: 14),
            const Text('No overtime records for this month', style: TextStyle(color: AppColors.textMuted)),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.info.withOpacity(0.15),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.info.withOpacity(0.3)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Approved Overtime Total', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              Text(
                '₹${NumberFormat('#,##,##0.00').format(_overtimeTotalAmount)}',
                style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.bold, fontSize: 18),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        ..._overtimes.map((o) {
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
                    Text(o.date, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                    const SizedBox(height: 3),
                    Text('${o.hours} hrs${o.remarks != null ? ' • ${o.remarks}' : ''}', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  ],
                ),
                Text(
                  '₹${NumberFormat('#,##,##0.00').format(o.amount)}',
                  style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.bold, fontSize: 15),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  Widget _buildHistoryTab() {
    if (_history.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.history_edu_outlined, size: 54, color: Colors.white.withOpacity(0.3)),
            const SizedBox(height: 14),
            const Text('No finalized payslips available yet', style: TextStyle(color: AppColors.textMuted)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(20),
      itemCount: _history.length,
      itemBuilder: (context, index) {
        final item = _history[index];
        return Container(
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.white12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.cycleCode.isNotEmpty ? item.cycleCode : item.payrollPeriod,
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                      ),
                      if (item.cycleStartDate.isNotEmpty && item.cycleEndDate.isNotEmpty)
                        Text(
                          '${item.cycleStartDate} ~ ${item.cycleEndDate}',
                          style: const TextStyle(color: AppColors.textDim, fontSize: 11),
                        ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color: _getStatusColor(_getStatusText(item)).withOpacity(0.18),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: _getStatusColor(_getStatusText(item)).withOpacity(0.5)),
                    ),
                    child: Text(
                      _getStatusText(item),
                      style: TextStyle(
                        color: _getStatusColor(_getStatusText(item)),
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Gross Salary', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                      Text('₹${NumberFormat('#,##,##0').format(item.grossSalary)}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Deductions', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                      Text('₹${NumberFormat('#,##,##0').format(item.totalDeductions)}', style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      const Text('Net Pay', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                      Text('₹${NumberFormat('#,##,##0').format(item.netSalary)}', style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.bold, fontSize: 15)),
                    ],
                  ),
                ],
              ),
              if (item.amountDisbursed > 0 || item.remainingPayable > 0 || item.disbursementReference != null) ...[
                const Divider(color: Colors.white12, height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Paid: ₹${item.amountDisbursed.toStringAsFixed(0)}', style: const TextStyle(color: AppColors.textDim, fontSize: 11)),
                    Text(
                      'Remaining: ₹${item.remainingPayable.toStringAsFixed(0)}',
                      style: TextStyle(color: item.remainingPayable > 0 ? Colors.amberAccent : AppColors.textDim, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                if (item.disbursementReference != null) ...[
                  const SizedBox(height: 4),
                  Text('Disbursement Ref: ${item.disbursementReference}', style: const TextStyle(color: AppColors.textDim, fontSize: 10)),
                ],
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _buildStatItem(String title, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: const TextStyle(color: Colors.white60, fontSize: 11)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
      ],
    );
  }

  Widget _buildRow(String label, String value, {bool isBold = false, Color? color}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              color: Colors.white70,
              fontSize: 13,
              fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: color ?? Colors.white,
              fontSize: 13,
              fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ],
      ),
    );
  }
}
