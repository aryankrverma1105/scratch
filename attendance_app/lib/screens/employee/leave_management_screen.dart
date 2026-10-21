import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/leave_models.dart';

class LeaveManagementScreen extends StatefulWidget {
  const LeaveManagementScreen({super.key});

  @override
  State<LeaveManagementScreen> createState() => _LeaveManagementScreenState();
}

class _LeaveManagementScreenState extends State<LeaveManagementScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  String? _errorMessage;

  LeaveBalanceModel? _balance;
  MonthlyLeaveSummaryModel? _summary;
  List<LeaveRecordModel> _leaves = [];
  List<AttendanceAbsenceModel> _absences = [];
  HolidaysResponseModel? _holidays;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadAllLeaveData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadAllLeaveData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final balFuture = ApiService().getLeaveBalance();
      final sumFuture = ApiService().getLeaveSummary();
      final histFuture = ApiService().getLeaveHistory();
      final holFuture = ApiService().getCompanyHolidays();

      final results = await Future.wait([balFuture, sumFuture, histFuture, holFuture]);

      final bal = results[0] as LeaveBalanceModel;
      final sum = results[1] as MonthlyLeaveSummaryModel;
      final hist = results[2] as Map<String, dynamic>;
      final hol = results[3] as HolidaysResponseModel;

      if (mounted) {
        setState(() {
          _balance = bal;
          _summary = sum;
          _leaves = hist['leaves'] as List<LeaveRecordModel>;
          _absences = hist['absences'] as List<AttendanceAbsenceModel>;
          _holidays = hol;
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

  void _showApplyLeaveModal() {
    DateTime? startDate;
    DateTime? endDate;
    final reasonController = TextEditingController();
    LeaveCalculationModel? preview;
    bool isCalculating = false;
    bool isSubmitting = false;
    String? modalError;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.cardDark,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          Future<void> recalculate() async {
            if (startDate == null || endDate == null) return;
            setModalState(() {
              isCalculating = true;
              modalError = null;
            });
            try {
              final sStr = startDate!.toIso8601String().substring(0, 10);
              final eStr = endDate!.toIso8601String().substring(0, 10);
              final res = await ApiService().calculateLeave(sStr, eStr);
              setModalState(() {
                preview = res;
                isCalculating = false;
              });
            } catch (e) {
              setModalState(() {
                preview = null;
                isCalculating = false;
                modalError = e.toString().replaceFirst('Exception: ', '');
              });
            }
          }

          return Padding(
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 24,
              bottom: MediaQuery.of(context).viewInsets.bottom + 24,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Apply for Leave',
                        style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, color: Colors.white70),
                        onPressed: () => Navigator.pop(ctx),
                      ),
                    ],
                  ),
                  const Text(
                    'Eligible leave is automatically confirmed without admin approval. Max 7 continuous calendar days.',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                  ),
                  const SizedBox(height: 20),

                  // Date pickers
                  Row(
                    children: [
                      Expanded(
                        child: _buildDateTile(
                          label: 'Start Date',
                          date: startDate,
                          onTap: () async {
                            final now = DateTime.now();
                            final picked = await showDatePicker(
                              context: context,
                              initialDate: startDate ?? now,
                              firstDate: now.subtract(const Duration(days: 30)),
                              lastDate: now.add(const Duration(days: 365)),
                            );
                            if (picked != null) {
                              startDate = picked;
                              if (endDate != null && endDate!.isBefore(startDate!)) {
                                endDate = startDate;
                              }
                              await recalculate();
                            }
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _buildDateTile(
                          label: 'End Date',
                          date: endDate,
                          onTap: () async {
                            final now = DateTime.now();
                            final picked = await showDatePicker(
                              context: context,
                              initialDate: endDate ?? startDate ?? now,
                              firstDate: startDate ?? now.subtract(const Duration(days: 30)),
                              lastDate: now.add(const Duration(days: 365)),
                            );
                            if (picked != null) {
                              endDate = picked;
                              if (startDate != null && startDate!.isAfter(endDate!)) {
                                startDate = endDate;
                              }
                              await recalculate();
                            }
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Reason
                  TextField(
                    controller: reasonController,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Reason (Optional)',
                      labelStyle: const TextStyle(color: AppColors.textMuted),
                      filled: true,
                      fillColor: AppColors.inputDark,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Live Preview Card
                  if (isCalculating)
                    const Center(
                      child: Padding(
                        padding: EdgeInsets.all(12),
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      ),
                    )
                  else if (preview != null) ...[
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.background,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: preview!.isEligible ? AppColors.success.withValues(alpha: 0.5) : AppColors.error.withValues(alpha: 0.5),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                '${preview!.calendarDays} Calendar Day(s)',
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: preview!.isEligible
                                      ? AppColors.success.withValues(alpha: 0.2)
                                      : AppColors.error.withValues(alpha: 0.2),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  preview!.isEligible ? 'ELIGIBLE' : 'INELIGIBLE',
                                  style: TextStyle(
                                    color: preview!.isEligible ? AppColors.success : AppColors.error,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Working Days: ${preview!.workingDays}  •  Sundays: ${preview!.sundaysCount}  •  Holidays: ${preview!.holidaysCount}',
                            style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                          ),
                          const Divider(color: Colors.white12, height: 16),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'Deduction: ${preview!.daysDeducted} day(s)',
                                style: const TextStyle(color: Colors.white70, fontSize: 12),
                              ),
                              Text(
                                'Balance After: ${preview!.balanceAfter} day(s)',
                                style: TextStyle(
                                  color: preview!.isEligible ? AppColors.success : AppColors.error,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                          if (!preview!.isEligible && preview!.ineligibleReason != null) ...[
                            const SizedBox(height: 8),
                            Text(
                              preview!.ineligibleReason!,
                              style: const TextStyle(color: AppColors.error, fontSize: 11),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],

                  if (modalError != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.error.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.error.withValues(alpha: 0.4)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline, color: AppColors.error, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(modalError!, style: const TextStyle(color: Colors.white, fontSize: 12)),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],

                  // Submit button
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: (preview?.isEligible ?? false) ? AppColors.success : Colors.white24,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      ),
                      onPressed: (isSubmitting || (preview == null) || !preview!.isEligible)
                          ? null
                          : () async {
                              setModalState(() => isSubmitting = true);
                              try {
                                final sStr = startDate!.toIso8601String().substring(0, 10);
                                final eStr = endDate!.toIso8601String().substring(0, 10);
                                await ApiService().requestLeave(
                                  sStr,
                                  eStr,
                                  reason: reasonController.text.trim(),
                                );
                                if (mounted) {
                                  Navigator.pop(ctx);
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      backgroundColor: AppColors.success,
                                      content: Text('Leave confirmed directly! No approval needed.'),
                                    ),
                                  );
                                  _loadAllLeaveData();
                                }
                              } catch (e) {
                                setModalState(() {
                                  isSubmitting = false;
                                  modalError = e.toString().replaceFirst('Exception: ', '');
                                });
                              }
                            },
                      child: isSubmitting
                          ? const CircularProgressIndicator(color: Colors.white)
                          : const Text(
                              'Confirm & Submit Leave',
                              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                            ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildDateTile({required String label, required DateTime? date, required VoidCallback onTap}) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.inputDark,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
            const SizedBox(height: 4),
            Row(
              children: [
                const Icon(Icons.calendar_today, color: Colors.white70, size: 14),
                const SizedBox(width: 6),
                Text(
                  date != null ? date.toIso8601String().substring(0, 10) : 'Select date',
                  style: TextStyle(
                    color: date != null ? Colors.white : Colors.white38,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _cancelLeaveDialog(LeaveRecordModel leave) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Cancel Confirmed Leave', style: TextStyle(color: Colors.white)),
        content: Text(
          'Cancel leave from ${leave.startDate} to ${leave.endDate}?\n\n${leave.daysDeducted} day(s) will be restored back to your earned leave balance.',
          style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Keep Leave', style: TextStyle(color: Colors.white70)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Yes, Cancel', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await ApiService().cancelLeave(leave.id);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              backgroundColor: AppColors.success,
              content: Text('Leave cancelled and balance restored successfully.'),
            ),
          );
          _loadAllLeaveData();
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: AppColors.error,
              content: Text(e.toString().replaceFirst('Exception: ', '')),
            ),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.success,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_task),
        label: const Text('Apply Leave', style: TextStyle(fontWeight: FontWeight.bold)),
        onPressed: _showApplyLeaveModal,
      ),
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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top Bar
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        IconButton(
                          icon: const Icon(Icons.arrow_back, color: Colors.white),
                          onPressed: () => Navigator.pop(context),
                        ),
                        const SizedBox(width: 6),
                        const Text(
                          'Leave Management',
                          style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                    IconButton(
                      icon: const Icon(Icons.refresh, color: Colors.white70),
                      onPressed: _loadAllLeaveData,
                    ),
                  ],
                ),
              ),

              if (_isLoading)
                const Expanded(
                  child: Center(child: CircularProgressIndicator(color: Colors.white)),
                )
              else if (_errorMessage != null)
                Expanded(
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.error_outline, color: AppColors.error, size: 40),
                          const SizedBox(height: 12),
                          Text(
                            _errorMessage!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white),
                          ),
                          const SizedBox(height: 16),
                          ElevatedButton(onPressed: _loadAllLeaveData, child: const Text('Retry')),
                        ],
                      ),
                    ),
                  ),
                )
              else ...[
                // Metrics Overview
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Column(
                    children: [
                      // Annual Leave Policy Banner
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: Colors.white12),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.event_available, color: Colors.amber, size: 20),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'Leave Year: ${_balance?.leaveYear ?? "Current"} (1 Apr – 31 Mar) • Earned Leaves & Office Holidays',
                                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),

                      // Metric Grid
                      Row(
                        children: [
                          Expanded(
                            child: _buildMetricCard(
                              title: 'Available Balance',
                              value: '${_balance?.balance ?? 0}',
                              unit: 'Days',
                              color: AppColors.success,
                              icon: Icons.check_circle_outline,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _buildMetricCard(
                              title: 'Accrued This Year',
                              value: '${_balance?.accrued ?? 0}',
                              unit: 'Days (+2/mo)',
                              color: AppColors.info,
                              icon: Icons.trending_up,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: _buildMetricCard(
                              title: 'Leaves Used',
                              value: '${_balance?.used ?? 0}',
                              unit: 'Days',
                              color: Colors.amber,
                              icon: Icons.history,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _buildMetricCard(
                              title: 'Missing Days (Mo)',
                              value: '${_summary?.missingAttendanceCount ?? 0}',
                              unit: (_summary?.thresholdExceeded ?? false) ? 'Threshold > 2!' : 'Max 2 allowed',
                              color: (_summary?.thresholdExceeded ?? false) ? AppColors.error : Colors.white70,
                              icon: Icons.warning_amber_rounded,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // Tab Bar
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 20),
                  decoration: BoxDecoration(
                    color: AppColors.cardDark,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: TabBar(
                    controller: _tabController,
                    indicatorColor: AppColors.info,
                    labelColor: Colors.white,
                    unselectedLabelColor: AppColors.textMuted,
                    tabs: [
                      Tab(text: 'Leaves (${_leaves.length})'),
                      Tab(text: 'Absences (${_absences.length})'),
                      Tab(text: 'Holidays (${_holidays?.count ?? 0}/16)'),
                    ],
                  ),
                ),
                const SizedBox(height: 10),

                // Tab Views
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildLeavesTab(),
                      _buildAbsencesTab(),
                      _buildHolidaysTab(),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricCard({
    required String title,
    required String value,
    required String unit,
    required Color color,
    required IconData icon,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title, style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
              Icon(icon, color: color, size: 16),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                value,
                style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  unit,
                  style: const TextStyle(color: Colors.white54, fontSize: 10),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLeavesTab() {
    if (_leaves.isEmpty) {
      return const Center(
        child: Text('No leave records found', style: TextStyle(color: AppColors.textMuted)),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      itemCount: _leaves.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final l = _leaves[index];
        final isConfirmed = l.isConfirmed;

        return Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: isConfirmed ? AppColors.success.withValues(alpha: 0.15) : Colors.white10,
                child: Icon(
                  isConfirmed ? Icons.event_available : Icons.event_busy,
                  color: isConfirmed ? AppColors.success : Colors.white38,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${l.startDate}  →  ${l.endDate}',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${l.calendarDays} Calendar Day(s) • ${l.workingDays} Working Day(s) Deducted',
                      style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                    ),
                    if (l.reason != null && l.reason!.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text('Reason: ${l.reason}', style: const TextStyle(color: Colors.white70, fontSize: 11)),
                    ],
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: isConfirmed ? AppColors.success.withValues(alpha: 0.15) : AppColors.error.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      l.status.toUpperCase(),
                      style: TextStyle(
                        color: isConfirmed ? AppColors.success : AppColors.error,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  if (isConfirmed) ...[
                    const SizedBox(height: 6),
                    InkWell(
                      onTap: () => _cancelLeaveDialog(l),
                      child: const Text(
                        'Cancel',
                        style: TextStyle(color: AppColors.error, fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildAbsencesTab() {
    if (_absences.isEmpty) {
      return const Center(
        child: Text('No automatic absences recorded', style: TextStyle(color: AppColors.textMuted)),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      itemCount: _absences.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final a = _absences[index];
        final isEarnedDeducted = a.isEarnedLeaveDeducted;

        return Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: isEarnedDeducted ? Colors.amber.withValues(alpha: 0.15) : AppColors.error.withValues(alpha: 0.15),
                child: Icon(
                  isEarnedDeducted ? Icons.hourglass_bottom : Icons.highlight_off,
                  color: isEarnedDeducted ? Colors.amber : AppColors.error,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      a.date,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      isEarnedDeducted ? '1 Earned Leave Deducted' : 'Unpaid Absence (0 Balance Available)',
                      style: TextStyle(
                        color: isEarnedDeducted ? Colors.amber : AppColors.error,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (a.reason != null) ...[
                      const SizedBox(height: 2),
                      Text(a.reason!, style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
                    ],
                    if (a.isCorrected) ...[
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.success.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          'Corrected by Admin: ${a.correctionNotes ?? ""}',
                          style: const TextStyle(color: AppColors.success, fontSize: 10),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHolidaysTab() {
    final holidays = _holidays?.holidays ?? [];
    if (holidays.isEmpty) {
      return const Center(
        child: Text('No company holidays configured for this year', style: TextStyle(color: AppColors.textMuted)),
      );
    }

    return Column(
      children: [
        if (_holidays?.warning != null)
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.amber.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.amber.withValues(alpha: 0.4)),
            ),
            child: Row(
              children: [
                const Icon(Icons.info_outline, color: Colors.amber, size: 16),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _holidays!.warning!,
                    style: const TextStyle(color: Colors.amber, fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            itemCount: holidays.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final h = holidays[index];
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: AppColors.cardDark,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.celebration, color: Colors.amber, size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(h.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                          if (h.description != null && h.description!.isNotEmpty)
                            Text(h.description!, style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
                        ],
                      ),
                    ),
                    Text(h.date, style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.bold, fontSize: 12)),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
