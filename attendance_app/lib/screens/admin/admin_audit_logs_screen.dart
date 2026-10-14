import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/salary_models.dart';

class AdminAuditLogsScreen extends StatefulWidget {
  const AdminAuditLogsScreen({super.key});

  @override
  State<AdminAuditLogsScreen> createState() => _AdminAuditLogsScreenState();
}

class _AdminAuditLogsScreenState extends State<AdminAuditLogsScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  List<ActivityLogModel> _logs = [];
  int _page = 1;
  int _totalPages = 1;
  int _total = 0;
  String? _selectedFilter;

  final List<String> _filters = [
    'ALL',
    'USER_CREATED',
    'USER_UPDATED',
    'USER_DELETED',
    'SALARY_CONFIG_SAVED',
    'COMMON_DAILY_WAGE_UPDATED',
    'INCENTIVE_CREATED',
    'OVERTIME_RECORDED',
    'PAYROLL_FINALIZED',
  ];

  @override
  void initState() {
    super.initState();
    _loadLogs();
  }

  Future<void> _loadLogs({int page = 1}) async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final res = await ApiService().getActivityLogs(
        page: page,
        limit: 50,
        action: _selectedFilter == 'ALL' ? null : _selectedFilter,
      );

      if (mounted) {
        setState(() {
          _logs = (res['logs'] as List).cast<ActivityLogModel>();
          _page = res['page'] ?? 1;
          _totalPages = res['totalPages'] ?? 1;
          _total = res['total'] ?? 0;
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

  Color _getActionColor(String action) {
    if (action.contains('CREATED') || action.contains('ADDED')) {
      return AppColors.success;
    }
    if (action.contains('DELETED')) {
      return AppColors.error;
    }
    if (action.contains('UPDATED') || action.contains('SAVED')) {
      return AppColors.info;
    }
    if (action.contains('FINALIZED') || action.contains('LOCKED')) {
      return Colors.amber;
    }
    return Colors.white70;
  }

  IconData _getActionIcon(String action) {
    if (action.contains('USER')) return Icons.person_outline;
    if (action.contains('SALARY') || action.contains('WAGE')) return Icons.payments_outlined;
    if (action.contains('INCENTIVE')) return Icons.stars_outlined;
    if (action.contains('OVERTIME')) return Icons.more_time_outlined;
    if (action.contains('PAYROLL')) return Icons.receipt_long_outlined;
    return Icons.history;
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
              _buildFilterChips(),
              Expanded(
                child: _isLoading
                    ? const Center(child: CircularProgressIndicator(color: Colors.white))
                    : _errorMessage != null
                        ? _buildErrorView()
                        : _buildLogsList(),
              ),
              if (_totalPages > 1) _buildPagination(),
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
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'System Activity Logs',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                Text(
                  'Audit trail of all administrative events ($_total records)',
                  style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: () => _loadLogs(page: _page),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChips() {
    return Container(
      height: 40,
      margin: const EdgeInsets.only(bottom: 8),
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        scrollDirection: Axis.horizontal,
        itemCount: _filters.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final filter = _filters[index];
          final isSelected = (_selectedFilter == null && filter == 'ALL') || _selectedFilter == filter;
          return ChoiceChip(
            label: Text(
              filter.replaceAll('_', ' '),
              style: TextStyle(
                color: isSelected ? Colors.black : Colors.white70,
                fontSize: 11,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
            selected: isSelected,
            selectedColor: AppColors.info,
            backgroundColor: AppColors.cardDark,
            onSelected: (val) {
              setState(() {
                _selectedFilter = filter == 'ALL' ? null : filter;
              });
              _loadLogs(page: 1);
            },
          );
        },
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
            ElevatedButton(onPressed: () => _loadLogs(page: 1), child: const Text('Retry')),
          ],
        ),
      ),
    );
  }

  Widget _buildLogsList() {
    if (_logs.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.history_toggle_off, size: 54, color: Colors.white.withOpacity(0.3)),
            const SizedBox(height: 14),
            const Text('No activity records found', style: TextStyle(color: AppColors.textMuted)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => _loadLogs(page: _page),
      child: ListView.separated(
        padding: const EdgeInsets.all(20),
        itemCount: _logs.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          final log = _logs[index];
          final actionColor = _getActionColor(log.action);
          final actionIcon = _getActionIcon(log.action);
          final timeStr = DateFormat('MMM d, yyyy • hh:mm:ss a').format(log.createdAt);

          return Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.cardDark,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: actionColor.withOpacity(0.3), width: 1.2),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.2),
                  blurRadius: 8,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header: Action badge & Timestamp
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: actionColor.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: actionColor.withOpacity(0.4)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(actionIcon, color: actionColor, size: 14),
                          const SizedBox(width: 6),
                          Text(
                            log.action.replaceAll('_', ' '),
                            style: TextStyle(
                              color: actionColor,
                              fontWeight: FontWeight.bold,
                              fontSize: 11.5,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Spacer(),
                    Text(
                      timeStr,
                      style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                // WHO & OF WHOM Section
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.background.withOpacity(0.5),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.person_pin_outlined, size: 16, color: AppColors.info),
                          const SizedBox(width: 8),
                          const Text('By (Actor): ', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                          Expanded(
                            child: Text(
                              '${log.userName} (${log.role.toUpperCase()})',
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12.5),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                      if (log.targetUserName != null && log.targetUserName!.isNotEmpty) ...[
                        const Divider(color: Colors.white10, height: 12),
                        Row(
                          children: [
                            const Icon(Icons.arrow_forward, size: 14, color: AppColors.warning),
                            const SizedBox(width: 8),
                            const Text('For (Target): ', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                            Expanded(
                              child: Text(
                                log.targetUserName!,
                                style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 12.5),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 10),

                // Activity Details
                Text(
                  log.details ?? 'No details recorded',
                  style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.35),
                ),
                if (log.ipAddress != null && log.ipAddress != 'system') ...[
                  const SizedBox(height: 8),
                  Text(
                    'IP: ${log.ipAddress}',
                    style: TextStyle(color: Colors.white.withOpacity(0.35), fontSize: 10.5),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildPagination() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      color: AppColors.cardDark,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            onPressed: _page > 1 ? () => _loadLogs(page: _page - 1) : null,
          ),
          Text(
            'Page $_page of $_totalPages',
            style: const TextStyle(color: Colors.white, fontSize: 12),
          ),
          IconButton(
            icon: const Icon(Icons.arrow_forward, color: Colors.white),
            onPressed: _page < _totalPages ? () => _loadLogs(page: _page + 1) : null,
          ),
        ],
      ),
    );
  }
}
