import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/attendance_model.dart';
import '../../models/user_model.dart';
import 'admin_route_history_screen.dart';

class AdminEmployeeAttendanceScreen extends StatefulWidget {
  final UserModel? employee;
  final int? employeeId;
  final String? employeeName;
  final String? employeeDepartment;

  const AdminEmployeeAttendanceScreen({
    super.key,
    this.employee,
    this.employeeId,
    this.employeeName,
    this.employeeDepartment,
  });

  @override
  State<AdminEmployeeAttendanceScreen> createState() =>
      _AdminEmployeeAttendanceScreenState();
}

class _AdminEmployeeAttendanceScreenState
    extends State<AdminEmployeeAttendanceScreen> {
  List<UserModel> _allEmployees = [];
  UserModel? _currentEmployee;
  List<AttendanceRecord> _records = [];
  bool _isLoading = true;
  String _statusFilter = 'ALL'; // 'ALL', 'COMPLETED', 'ACTIVE', 'AUTO'
  DateTime? _filterDate;

  @override
  void initState() {
    super.initState();
    _currentEmployee = widget.employee;
    _initData();
  }

  Future<void> _initData() async {
    setState(() => _isLoading = true);
    try {
      final users = await ApiService().adminGetUsers();
      final employeesOnly =
          users.where((u) => u.role == 'employee').toList();
      _allEmployees = employeesOnly;

      if (_currentEmployee == null) {
        final targetId = widget.employeeId;
        if (targetId != null) {
          final found = employeesOnly.where((u) => u.id == targetId);
          if (found.isNotEmpty) {
            _currentEmployee = found.first;
          }
        }
        if (_currentEmployee == null && employeesOnly.isNotEmpty) {
          _currentEmployee = employeesOnly.first;
        }
      }

      await _loadRecords();
    } catch (e) {
      debugPrint('Error loading employee attendance: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadRecords() async {
    final empId = _currentEmployee?.id ?? widget.employeeId;
    if (empId == null) {
      setState(() => _records = []);
      return;
    }

    try {
      final list = await ApiService().adminGetAttendance(
        userId: empId,
        limit: 500,
      );
      if (mounted) {
        setState(() {
          _records = list;
        });
      }
    } catch (e) {
      debugPrint('Error loading records: $e');
    }
  }

  void _switchEmployee(UserModel user) {
    setState(() {
      _currentEmployee = user;
      _isLoading = true;
    });
    _loadRecords().then((_) {
      if (mounted) setState(() => _isLoading = false);
    });
  }

  void _showEmployeePicker() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.cardDark,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(25)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) {
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Select Employee',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: AppColors.textMuted),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.of(context).size.height * 0.5,
                  ),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: _allEmployees.length,
                    separatorBuilder: (_, __) => const Divider(color: Colors.white10),
                    itemBuilder: (context, idx) {
                      final u = _allEmployees[idx];
                      final isSelected = u.id == _currentEmployee?.id;
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(
                          backgroundColor: isSelected
                              ? AppColors.info
                              : AppColors.inputDark,
                          child: Text(
                            u.fullName.isNotEmpty
                                ? u.fullName[0].toUpperCase()
                                : 'E',
                            style: TextStyle(
                              color: isSelected ? Colors.black : Colors.white,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        title: Text(
                          u.fullName,
                          style: TextStyle(
                            color: isSelected ? AppColors.info : Colors.white,
                            fontWeight: isSelected
                                ? FontWeight.bold
                                : FontWeight.w500,
                          ),
                        ),
                        subtitle: Text(
                          u.department ?? 'Field Employee',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        trailing: isSelected
                            ? const Icon(Icons.check_circle, color: AppColors.info)
                            : null,
                        onTap: () {
                          Navigator.pop(ctx);
                          _switchEmployee(u);
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showSelfieDetailModal({
    required String title,
    required String? selfieFilename,
    required DateTime time,
    required String? address,
    required double? lat,
    required double? lng,
    required double? accuracy,
    required bool isMocked,
  }) {
    if (selfieFilename == null || selfieFilename.isEmpty) return;

    final fullUrl = ApiService().getSelfieUrl(selfieFilename);

    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.transparent,
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: Colors.white12),
          ),
          padding: const EdgeInsets.all(18),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.verified, color: AppColors.info, size: 20),
                        const SizedBox(width: 8),
                        Text(
                          title,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        ),
                      ],
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white70),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                // High Res Image
                ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: Image.network(
                    fullUrl,
                    headers: ApiService().authHeaders,
                    fit: BoxFit.contain,
                    loadingBuilder: (_, child, progress) {
                      if (progress == null) return child;
                      return Container(
                        height: 280,
                        alignment: Alignment.center,
                        child: const CircularProgressIndicator(color: Colors.white),
                      );
                    },
                    errorBuilder: (_, __, ___) => Container(
                      height: 180,
                      color: Colors.black26,
                      alignment: Alignment.center,
                      child: const Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.broken_image, color: Colors.white54, size: 40),
                          SizedBox(height: 8),
                          Text('Selfie preview unavailable',
                              style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // Audit Metadata
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceDark,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: Colors.white10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.access_time, color: AppColors.info, size: 16),
                          const SizedBox(width: 6),
                          Text(
                            DateFormat('EEEE, MMM d, yyyy • hh:mm:ss a').format(time.toLocal()),
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                              fontSize: 12.5,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.location_on, color: AppColors.success, size: 16),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              address ?? 'Lat: $lat, Lng: $lng',
                              style: const TextStyle(color: Colors.white70, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                      if (lat != null && lng != null) ...[
                        const SizedBox(height: 6),
                        Text(
                          'Coordinates: ${lat.toStringAsFixed(6)}, ${lng.toStringAsFixed(6)} (Accuracy: ±${accuracy?.toStringAsFixed(1) ?? 'N/A'}m)',
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                        ),
                      ],
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: isMocked
                              ? AppColors.error.withValues(alpha: 0.2)
                              : AppColors.success.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: isMocked ? AppColors.error : AppColors.success,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              isMocked ? Icons.warning_amber : Icons.security,
                              size: 14,
                              color: isMocked ? AppColors.error : AppColors.success,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              isMocked ? 'WARNING: Mock GPS Detected' : 'Verified Hardware GPS (Authentic)',
                              style: TextStyle(
                                color: isMocked ? AppColors.error : AppColors.success,
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSelfieCard({
    required String label,
    required String? selfieFilename,
    required DateTime? time,
    required String? address,
    required double? lat,
    required double? lng,
    required double? accuracy,
    required bool isMocked,
    required bool isPending,
  }) {
    if (isPending || selfieFilename == null || selfieFilename.isEmpty) {
      return Container(
        height: 130,
        decoration: BoxDecoration(
          color: AppColors.surfaceDark,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white12, style: BorderStyle.solid),
        ),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                isPending ? Icons.hourglass_top : Icons.no_photography,
                color: Colors.white30,
                size: 28,
              ),
              const SizedBox(height: 6),
              Text(
                isPending ? 'Shift In Progress\nPhoto Pending' : 'No Photo\nRecorded',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
              ),
            ],
          ),
        ),
      );
    }

    final fullUrl = ApiService().getSelfieUrl(selfieFilename);

    return InkWell(
      onTap: () {
        if (time != null) {
          _showSelfieDetailModal(
            title: label,
            selfieFilename: selfieFilename,
            time: time,
            address: address,
            lat: lat,
            lng: lng,
            accuracy: accuracy,
            isMocked: isMocked,
          );
        }
      },
      borderRadius: BorderRadius.circular(14),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surfaceDark,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white12),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Stack(
              children: [
                SizedBox(
                  height: 95,
                  width: double.infinity,
                  child: Image.network(
                    fullUrl,
                    headers: ApiService().authHeaders,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      color: AppColors.inputDark,
                      child: const Center(
                        child: Icon(Icons.broken_image, color: Colors.white38, size: 24),
                      ),
                    ),
                  ),
                ),
                Positioned(
                  top: 6,
                  right: 6,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                    decoration: BoxDecoration(
                      color: Colors.black54,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.zoom_in, color: Colors.white, size: 12),
                        SizedBox(width: 3),
                        Text('Zoom', style: TextStyle(color: Colors.white, fontSize: 9.5)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(7),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  if (time != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      DateFormat('hh:mm a').format(time.toLocal()),
                      style: const TextStyle(color: AppColors.info, fontSize: 10.5, fontWeight: FontWeight.w600),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final employeeName = _currentEmployee?.fullName ?? widget.employeeName ?? 'Employee';
    final employeeDept = _currentEmployee?.department ?? widget.employeeDepartment ?? 'Department';

    // Apply filters
    var filteredRecords = _records;
    if (_filterDate != null) {
      final targetDateStr = DateFormat('yyyy-MM-dd').format(_filterDate!);
      filteredRecords = filteredRecords.where((r) => r.date == targetDateStr).toList();
    }
    if (_statusFilter == 'COMPLETED') {
      filteredRecords = filteredRecords.where((r) => r.status == 'checked_out').toList();
    } else if (_statusFilter == 'ACTIVE') {
      filteredRecords = filteredRecords.where((r) => r.status == 'checked_in').toList();
    } else if (_statusFilter == 'AUTO') {
      filteredRecords = filteredRecords.where((r) => r.status == 'auto_checked_out').toList();
    }

    // Compute Metrics
    final totalShifts = _records.length;
    final totalHoursMinutes = _records.fold<int>(0, (acc, r) {
      if (r.duration != null) {
        return acc + r.duration!.inMinutes;
      }
      return acc;
    });
    final totalHoursStr = '${(totalHoursMinutes ~/ 60)}h ${(totalHoursMinutes % 60)}m';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: const Text(
          'Employee Attendance History',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 17),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: Colors.white, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.person_search, color: AppColors.info),
            tooltip: 'Switch Employee',
            onPressed: _showEmployeePicker,
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: () {
              setState(() => _isLoading = true);
              _loadRecords().then((_) {
                if (mounted) setState(() => _isLoading = false);
              });
            },
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Colors.white))
          : Column(
              children: [
                // Top Employee Profile & Overview Card
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.cardDark,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.white12),
                  ),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          CircleAvatar(
                            radius: 26,
                            backgroundColor: AppColors.info.withValues(alpha: 0.25),
                            child: Text(
                              employeeName.isNotEmpty ? employeeName[0].toUpperCase() : 'E',
                              style: const TextStyle(color: AppColors.info, fontSize: 22, fontWeight: FontWeight.bold),
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        employeeName,
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 17,
                                        ),
                                      ),
                                    ),
                                    InkWell(
                                      onTap: _showEmployeePicker,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: AppColors.inputDark,
                                          borderRadius: BorderRadius.circular(8),
                                        ),
                                        child: const Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Text('Change', style: TextStyle(color: AppColors.info, fontSize: 11, fontWeight: FontWeight.bold)),
                                            Icon(Icons.arrow_drop_down, color: AppColors.info, size: 16),
                                          ],
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  employeeDept,
                                  style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      const Divider(color: Colors.white10, height: 1),
                      const SizedBox(height: 12),

                      // Metrics Row
                      Row(
                        children: [
                          Expanded(
                            child: _buildMetricTile(
                              icon: Icons.calendar_today,
                              label: 'Total Shifts',
                              value: '$totalShifts',
                              color: AppColors.info,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _buildMetricTile(
                              icon: Icons.timelapse,
                              label: 'Total Hours',
                              value: totalHoursStr,
                              color: AppColors.success,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _buildMetricTile(
                              icon: Icons.photo_camera_front,
                              label: 'Selfies Verified',
                              value: '${_records.where((r) => r.checkInSelfie != null).length}',
                              color: Colors.amber,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                // Filters Toolbar (Date Picker + Status Chips)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      // Date Selector
                      InkWell(
                        onTap: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: _filterDate ?? DateTime.now(),
                            firstDate: DateTime(2025),
                            lastDate: DateTime.now(),
                            builder: (context, child) {
                              return Theme(
                                data: Theme.of(context).copyWith(
                                  colorScheme: const ColorScheme.dark(
                                    primary: AppColors.info,
                                    surface: AppColors.cardDark,
                                  ),
                                ),
                                child: child!,
                              );
                            },
                          );
                          if (picked != null) {
                            setState(() => _filterDate = picked);
                          }
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: _filterDate != null ? AppColors.info.withValues(alpha: 0.25) : AppColors.cardDark,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: _filterDate != null ? AppColors.info : Colors.white12,
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.calendar_month,
                                size: 16,
                                color: _filterDate != null ? AppColors.info : Colors.white70,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                _filterDate != null
                                    ? DateFormat('MMM d, yyyy').format(_filterDate!)
                                    : 'All Dates',
                                style: TextStyle(
                                  color: _filterDate != null ? AppColors.info : Colors.white70,
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              if (_filterDate != null) ...[
                                const SizedBox(width: 6),
                                GestureDetector(
                                  onTap: () => setState(() => _filterDate = null),
                                  child: const Icon(Icons.close, size: 14, color: AppColors.info),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),

                      // Status Chips horizontal scroll
                      Expanded(
                        child: SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: [
                              _buildStatusChip('ALL', 'All'),
                              const SizedBox(width: 6),
                              _buildStatusChip('COMPLETED', 'Completed'),
                              const SizedBox(width: 6),
                              _buildStatusChip('ACTIVE', 'Active Duty'),
                              const SizedBox(width: 6),
                              _buildStatusChip('AUTO', '9 PM Auto-Closed'),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 6),

                // Attendance Cards List
                Expanded(
                  child: filteredRecords.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.history_toggle_off, size: 54, color: Colors.white.withValues(alpha: 0.25)),
                              const SizedBox(height: 14),
                              Text(
                                _records.isEmpty
                                    ? 'No attendance records logged for $employeeName'
                                    : 'No records match the selected filter',
                                style: const TextStyle(color: AppColors.textMuted, fontSize: 14),
                              ),
                            ],
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          itemCount: filteredRecords.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 14),
                          itemBuilder: (context, index) {
                            final rec = filteredRecords[index];
                            final isCheckedIn = rec.status == 'checked_in';
                            final isAuto = rec.status == 'auto_checked_out';
                            final duration = rec.duration;
                            final durationStr = duration != null
                                ? '${duration.inHours}h ${duration.inMinutes % 60}m'
                                : '--';

                            return Container(
                              decoration: BoxDecoration(
                                color: AppColors.cardDark,
                                borderRadius: BorderRadius.circular(18),
                                border: Border.all(
                                  color: isCheckedIn
                                      ? AppColors.info.withValues(alpha: 0.4)
                                      : Colors.white12,
                                ),
                              ),
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  // Shift Header
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Row(
                                        children: [
                                          const Icon(Icons.event_note, color: AppColors.info, size: 18),
                                          const SizedBox(width: 8),
                                          Text(
                                            rec.date,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 15,
                                            ),
                                          ),
                                        ],
                                      ),
                                      Row(
                                        children: [
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: isCheckedIn
                                                  ? AppColors.info.withValues(alpha: 0.2)
                                                  : isAuto
                                                      ? Colors.amber.withValues(alpha: 0.2)
                                                      : AppColors.success.withValues(alpha: 0.2),
                                              borderRadius: BorderRadius.circular(8),
                                            ),
                                            child: Text(
                                              isCheckedIn
                                                  ? 'ACTIVE DUTY'
                                                  : isAuto
                                                      ? '9 PM AUTO CLOSE'
                                                      : 'CHECKED OUT',
                                              style: TextStyle(
                                                color: isCheckedIn
                                                    ? AppColors.info
                                                    : isAuto
                                                        ? Colors.amber
                                                        : AppColors.success,
                                                fontSize: 10,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: AppColors.inputDark,
                                              borderRadius: BorderRadius.circular(8),
                                            ),
                                            child: Text(
                                              '⏱️ $durationStr',
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 10.5,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),

                                  const SizedBox(height: 14),

                                  // Selfies Row (Check In & Check Out Photos)
                                  Row(
                                    children: [
                                      Expanded(
                                        child: _buildSelfieCard(
                                          label: 'Check-In Selfie',
                                          selfieFilename: rec.checkInSelfie,
                                          time: rec.checkInTime,
                                          address: rec.checkInAddress,
                                          lat: rec.checkInLat,
                                          lng: rec.checkInLng,
                                          accuracy: rec.checkInAccuracy,
                                          isMocked: rec.checkInIsMocked,
                                          isPending: false,
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: _buildSelfieCard(
                                          label: 'Check-Out Selfie',
                                          selfieFilename: rec.checkOutSelfie,
                                          time: rec.checkOutTime,
                                          address: rec.checkOutAddress,
                                          lat: rec.checkOutLat,
                                          lng: rec.checkOutLng,
                                          accuracy: rec.checkOutAccuracy,
                                          isMocked: rec.checkOutIsMocked,
                                          isPending: isCheckedIn,
                                        ),
                                      ),
                                    ],
                                  ),

                                  const SizedBox(height: 14),

                                  // Check In Verification Details
                                  _buildEventDetailRow(
                                    icon: Icons.login,
                                    iconColor: AppColors.success,
                                    title: 'Check-In: ${DateFormat('hh:mm a').format(rec.checkInTime.toLocal())}',
                                    address: rec.checkInAddress ?? 'Lat: ${rec.checkInLat}, Lng: ${rec.checkInLng}',
                                    accuracy: rec.checkInAccuracy,
                                    isMocked: rec.checkInIsMocked,
                                  ),

                                  if (rec.checkOutTime != null) ...[
                                    const SizedBox(height: 10),
                                    _buildEventDetailRow(
                                      icon: Icons.logout,
                                      iconColor: isAuto ? Colors.amber : AppColors.error,
                                      title: 'Check-Out: ${DateFormat('hh:mm a').format(rec.checkOutTime!.toLocal())}'
                                          '${isAuto ? ' (Auto 9 PM Close)' : ''}',
                                      address: rec.checkOutAddress ?? 'Lat: ${rec.checkOutLat}, Lng: ${rec.checkOutLng}',
                                      accuracy: rec.checkOutAccuracy,
                                      isMocked: rec.checkOutIsMocked,
                                    ),
                                  ],

                                  const SizedBox(height: 14),

                                  // Bottom Action: View Route Trail on Map
                                  SizedBox(
                                    width: double.infinity,
                                    child: OutlinedButton.icon(
                                      icon: const Icon(Icons.route, size: 16, color: AppColors.info),
                                      label: const Text(
                                        'View GPS Route Trail on Map',
                                        style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                                      ),
                                      style: OutlinedButton.styleFrom(
                                        side: const BorderSide(color: Colors.white24),
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                        padding: const EdgeInsets.symmetric(vertical: 10),
                                      ),
                                      onPressed: () {
                                        DateTime? parsedDate;
                                        try {
                                          parsedDate = DateTime.parse(rec.date);
                                        } catch (_) {}
                                        Navigator.push(
                                          context,
                                          MaterialPageRoute(
                                            builder: (_) => AdminRouteHistoryScreen(
                                              initialUserId: rec.userId,
                                              initialUserName: employeeName,
                                              initialDate: parsedDate,
                                            ),
                                          ),
                                        );
                                      },
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }

  Widget _buildMetricTile({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 10),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusChip(String key, String label) {
    final isSelected = _statusFilter == key;
    return InkWell(
      onTap: () => setState(() => _statusFilter = key),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          color: isSelected ? Colors.white : AppColors.cardDark,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: isSelected ? Colors.white : Colors.white12),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.black : Colors.white70,
            fontSize: 11,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildEventDetailRow({
    required IconData icon,
    required Color iconColor,
    required String title,
    required String address,
    required double? accuracy,
    required bool isMocked,
  }) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: iconColor, size: 16),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 12.5,
                  ),
                ),
              ),
              if (isMocked)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.error.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    '⚠️ MOCK GPS',
                    style: TextStyle(color: AppColors.error, fontSize: 9.5, fontWeight: FontWeight.bold),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 22),
            child: Text(
              address,
              style: const TextStyle(color: AppColors.textDim, fontSize: 11),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (accuracy != null)
            Padding(
              padding: const EdgeInsets.only(left: 22, top: 2),
              child: Text(
                'GPS Accuracy: ±${accuracy.toStringAsFixed(1)}m',
                style: const TextStyle(color: AppColors.textMuted, fontSize: 10),
              ),
            ),
        ],
      ),
    );
  }
}
