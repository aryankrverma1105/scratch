import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/leave_models.dart';

class AdminLeaveScreen extends StatefulWidget {
  const AdminLeaveScreen({super.key});

  @override
  State<AdminLeaveScreen> createState() => _AdminLeaveScreenState();
}

class _AdminLeaveScreenState extends State<AdminLeaveScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  String? _errorMessage;

  String _selectedYear = '2026-2027';
  List<AdminUserLeaveSummaryModel> _teamSummaries = [];
  List<LeaveRecordModel> _teamLeaves = [];
  List<AttendanceAbsenceModel> _teamAbsences = [];
  HolidaysResponseModel? _holidays;
  int _thresholdExceededCount = 0;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadAllAdminData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadAllAdminData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final summariesFuture = ApiService().adminGetLeaveSummaries(year: _selectedYear);
      final leavesFuture = ApiService().adminGetLeaveRecords(year: _selectedYear);
      final absencesFuture = ApiService().adminGetAbsences(year: _selectedYear);
      final holidaysFuture = ApiService().getCompanyHolidays(year: _selectedYear);

      final results = await Future.wait([summariesFuture, leavesFuture, absencesFuture, holidaysFuture]);

      final sumData = results[0] as Map<String, dynamic>;
      final leavesData = results[1] as List<LeaveRecordModel>;
      final absencesData = results[2] as List<AttendanceAbsenceModel>;
      final holData = results[3] as HolidaysResponseModel;

      if (mounted) {
        setState(() {
          _selectedYear = sumData['leaveYear'] ?? _selectedYear;
          _teamSummaries = sumData['summaries'] as List<AdminUserLeaveSummaryModel>;
          _thresholdExceededCount = sumData['thresholdExceededCount'] ?? 0;
          _teamLeaves = leavesData;
          _teamAbsences = absencesData;
          _holidays = holData;
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

  void _showAddEditHolidayDialog({CompanyHolidayModel? existing}) {
    final nameController = TextEditingController(text: existing?.name ?? '');
    final dateController = TextEditingController(text: existing?.date ?? '');
    final descController = TextEditingController(text: existing?.description ?? '');
    bool isSubmitting = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: AppColors.cardDark,
          title: Text(
            existing == null ? 'Add Company Holiday' : 'Edit Company Holiday',
            style: const TextStyle(color: Colors.white, fontSize: 18),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Holiday Name *',
                  labelStyle: TextStyle(color: AppColors.textMuted),
                  filled: true,
                  fillColor: AppColors.inputDark,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: dateController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Date (YYYY-MM-DD) *',
                  hintText: 'e.g. 2026-10-20',
                  hintStyle: TextStyle(color: Colors.white30),
                  labelStyle: TextStyle(color: AppColors.textMuted),
                  filled: true,
                  fillColor: AppColors.inputDark,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: descController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Description (Optional)',
                  labelStyle: TextStyle(color: AppColors.textMuted),
                  filled: true,
                  fillColor: AppColors.inputDark,
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel', style: TextStyle(color: Colors.white70)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.info),
              onPressed: isSubmitting
                  ? null
                  : () async {
                      final name = nameController.text.trim();
                      final date = dateController.text.trim();
                      if (name.isEmpty || date.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Name and date are required')),
                        );
                        return;
                      }
                      setDialogState(() => isSubmitting = true);
                      try {
                        if (existing == null) {
                          await ApiService().adminCreateHoliday(
                            leaveYear: _selectedYear,
                            name: name,
                            date: date,
                            description: descController.text.trim(),
                          );
                        } else {
                          await ApiService().adminUpdateHoliday(
                            existing.id,
                            name: name,
                            date: date,
                            description: descController.text.trim(),
                          );
                        }
                        if (mounted) {
                          Navigator.pop(ctx);
                          _loadAllAdminData();
                        }
                      } catch (e) {
                        setDialogState(() => isSubmitting = false);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(backgroundColor: AppColors.error, content: Text('Error: $e')),
                          );
                        }
                      }
                    },
              child: isSubmitting
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : Text(existing == null ? 'Add Holiday' : 'Save Changes', style: const TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );
  }

  void _showCorrectAbsenceDialog(AttendanceAbsenceModel absence) {
    final notesController = TextEditingController();
    bool isSubmitting = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: AppColors.cardDark,
          title: Text(
            'Correct Absence: ${absence.userName ?? "User"}',
            style: const TextStyle(color: Colors.white, fontSize: 18),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Absence on ${absence.date} (${absence.isEarnedLeaveDeducted ? "1 Earned Leave Deducted" : "Unpaid"}).',
                style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
              ),
              const SizedBox(height: 8),
              if (absence.isEarnedLeaveDeducted)
                const Text(
                  '✓ Correcting this record will automatically restore 1 day back to the employee\'s earned leave balance.',
                  style: TextStyle(color: AppColors.success, fontSize: 12),
                ),
              const SizedBox(height: 14),
              TextField(
                controller: notesController,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Correction Reason / Audit Notes *',
                  labelStyle: TextStyle(color: AppColors.textMuted),
                  filled: true,
                  fillColor: AppColors.inputDark,
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel', style: TextStyle(color: Colors.white70)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.success),
              onPressed: isSubmitting
                  ? null
                  : () async {
                      final notes = notesController.text.trim();
                      if (notes.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Audit note is required')),
                        );
                        return;
                      }
                      setDialogState(() => isSubmitting = true);
                      try {
                        await ApiService().adminCorrectAbsence(absence.id, notes);
                        if (mounted) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              backgroundColor: AppColors.success,
                              content: Text('Absence corrected and balance restored.'),
                            ),
                          );
                          _loadAllAdminData();
                        }
                      } catch (e) {
                        setDialogState(() => isSubmitting = false);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(backgroundColor: AppColors.error, content: Text('Error: $e')),
                          );
                        }
                      }
                    },
              child: isSubmitting
                  ? const CircularProgressIndicator(color: Colors.white)
                  : const Text('Confirm Correction', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filteredSummaries = _teamSummaries.where((u) {
      final q = _searchQuery.toLowerCase();
      return u.fullName.toLowerCase().contains(q) ||
          u.email.toLowerCase().contains(q) ||
          (u.department?.toLowerCase().contains(q) ?? false);
    }).toList();

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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
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
                          'Admin Leave Console',
                          style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                    IconButton(
                      icon: const Icon(Icons.refresh, color: Colors.white70),
                      onPressed: _loadAllAdminData,
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
                    child: Text(_errorMessage!, style: const TextStyle(color: Colors.white)),
                  ),
                )
              else ...[
                // Top Metrics Bar
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Row(
                    children: [
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.cardDark,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Total Active Staff', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                              const SizedBox(height: 4),
                              Text('${_teamSummaries.length}', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.cardDark,
                            borderRadius: BorderRadius.circular(14),
                            border: _thresholdExceededCount > 0 ? Border.all(color: AppColors.error) : null,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Threshold Exceeded (>2)', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                              const SizedBox(height: 4),
                              Text(
                                '$_thresholdExceededCount',
                                style: TextStyle(
                                  color: _thresholdExceededCount > 0 ? AppColors.error : AppColors.success,
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                // Tab Bar
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 20),
                  decoration: BoxDecoration(
                    color: AppColors.cardDark,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: TabBar(
                    controller: _tabController,
                    isScrollable: true,
                    indicatorColor: AppColors.info,
                    labelColor: Colors.white,
                    unselectedLabelColor: AppColors.textMuted,
                    tabs: [
                      Tab(text: 'Team Balances (${_teamSummaries.length})'),
                      Tab(text: 'Confirmed Leaves (${_teamLeaves.length})'),
                      Tab(text: 'Absences (${_teamAbsences.length})'),
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
                      _buildTeamBalancesTab(filteredSummaries),
                      _buildTeamLeavesTab(),
                      _buildTeamAbsencesTab(),
                      _buildHolidayManagerTab(),
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

  Widget _buildTeamBalancesTab(List<AdminUserLeaveSummaryModel> list) {
    return Column(
      children: [
        // Search Box
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
          child: TextField(
            style: const TextStyle(color: Colors.white, fontSize: 13),
            onChanged: (val) => setState(() => _searchQuery = val),
            decoration: InputDecoration(
              hintText: 'Search employee by name, department...',
              hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 12),
              prefixIcon: const Icon(Icons.search, color: Colors.white70, size: 18),
              filled: true,
              fillColor: AppColors.cardDark,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
              contentPadding: const EdgeInsets.symmetric(vertical: 10),
            ),
          ),
        ),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            itemCount: list.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, index) {
              final u = list[index];
              return Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.cardDark,
                  borderRadius: BorderRadius.circular(16),
                  border: u.thresholdExceeded ? Border.all(color: AppColors.error.withValues(alpha: 0.6)) : null,
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 20,
                      backgroundColor: AppColors.info.withValues(alpha: 0.2),
                      child: Text(
                        u.fullName.isNotEmpty ? u.fullName[0].toUpperCase() : 'U',
                        style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.bold),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  u.fullName,
                                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (u.thresholdExceeded) ...[
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppColors.error.withValues(alpha: 0.2),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: const Text('> 2 MISSING', style: TextStyle(color: AppColors.error, fontSize: 9, fontWeight: FontWeight.bold)),
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(u.department ?? 'General', style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
                          const SizedBox(height: 4),
                          Text(
                            'Missing This Month: ${u.monthlyMissingCount}  •  Unpaid: ${u.monthlyUnpaidAbsences}',
                            style: TextStyle(
                              color: u.thresholdExceeded ? AppColors.error : Colors.white60,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          '${u.earnedBalance} Days',
                          style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.bold, fontSize: 15),
                        ),
                        Text(
                          'Used: ${u.earnedUsed}',
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                        ),
                      ],
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildTeamLeavesTab() {
    if (_teamLeaves.isEmpty) {
      return const Center(child: Text('No leave records found', style: TextStyle(color: AppColors.textMuted)));
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      itemCount: _teamLeaves.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final l = _teamLeaves[index];
        final isConfirmed = l.isConfirmed;

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
                  Text(
                    l.userName ?? 'User #${l.userId}',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: isConfirmed ? AppColors.success.withValues(alpha: 0.2) : AppColors.error.withValues(alpha: 0.2),
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
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '${l.startDate}  →  ${l.endDate} (${l.workingDays} working days deducted)',
                style: const TextStyle(color: AppColors.info, fontSize: 12, fontWeight: FontWeight.w600),
              ),
              if (l.reason != null && l.reason!.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text('Reason: ${l.reason}', style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _buildTeamAbsencesTab() {
    if (_teamAbsences.isEmpty) {
      return const Center(child: Text('No absences recorded', style: TextStyle(color: AppColors.textMuted)));
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      itemCount: _teamAbsences.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final a = _teamAbsences[index];
        final isEarned = a.isEarnedLeaveDeducted;

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
                radius: 18,
                backgroundColor: isEarned ? Colors.amber.withValues(alpha: 0.15) : AppColors.error.withValues(alpha: 0.15),
                child: Icon(
                  isEarned ? Icons.hourglass_bottom : Icons.highlight_off,
                  color: isEarned ? Colors.amber : AppColors.error,
                  size: 18,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${a.userName ?? "User"} • ${a.date}',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      isEarned ? '1 Earned Leave Deducted' : 'Unpaid Absence',
                      style: TextStyle(
                        color: isEarned ? Colors.amber : AppColors.error,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (a.isCorrected) ...[
                      const SizedBox(height: 4),
                      Text(
                        '✓ Corrected: ${a.correctionNotes ?? ""}',
                        style: const TextStyle(color: AppColors.success, fontSize: 10),
                      ),
                    ],
                  ],
                ),
              ),
              if (!a.isCorrected)
                TextButton(
                  onPressed: () => _showCorrectAbsenceDialog(a),
                  child: const Text('Correct', style: TextStyle(color: AppColors.info, fontSize: 12)),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHolidayManagerTab() {
    final holidays = _holidays?.holidays ?? [];
    final count = _holidays?.count ?? 0;
    final isComplete = count == 16;

    return Column(
      children: [
        // Progress & Incomplete Warning
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Company Holidays: $count / 16',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                  ),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.info,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    ),
                    icon: const Icon(Icons.add, size: 16, color: Colors.white),
                    label: const Text('Add Holiday', style: TextStyle(color: Colors.white, fontSize: 12)),
                    onPressed: () => _showAddEditHolidayDialog(),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              LinearProgressIndicator(
                value: (count / 16).clamp(0.0, 1.0),
                backgroundColor: Colors.white12,
                color: isComplete ? AppColors.success : Colors.amber,
                minHeight: 6,
                borderRadius: BorderRadius.circular(4),
              ),
              if (!isComplete) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.amber.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.warning_amber_rounded, color: Colors.amber, size: 16),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'Company policy requires exactly 16 holiday days per year. Currently ${count < 16 ? "${16 - count} missing" : "${count - 16} excess"}.',
                          style: const TextStyle(color: Colors.amber, fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),

        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            itemCount: holidays.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final h = holidays[index];
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
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
                          Text(h.date, style: const TextStyle(color: AppColors.info, fontSize: 11)),
                          if (h.description != null && h.description!.isNotEmpty)
                            Text(h.description!, style: const TextStyle(color: AppColors.textMuted, fontSize: 10)),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.edit, color: Colors.white70, size: 18),
                      onPressed: () => _showAddEditHolidayDialog(existing: h),
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete_outline, color: AppColors.error, size: 18),
                      onPressed: () async {
                        try {
                          await ApiService().adminDeleteHoliday(h.id);
                          _loadAllAdminData();
                        } catch (e) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed: $e')));
                        }
                      },
                    ),
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
