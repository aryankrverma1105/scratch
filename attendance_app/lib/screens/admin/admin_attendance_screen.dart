import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/attendance_model.dart';
import 'admin_employee_attendance_screen.dart';

class AdminAttendanceScreen extends StatefulWidget {
  const AdminAttendanceScreen({super.key});

  @override
  State<AdminAttendanceScreen> createState() => _AdminAttendanceScreenState();
}

class _AdminAttendanceScreenState extends State<AdminAttendanceScreen> {
  DateTime _selectedDate = DateTime.now();
  List<AttendanceRecord> _records = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadAttendance();
  }

  Future<void> _loadAttendance() async {
    setState(() => _isLoading = true);
    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate);
      final list = await ApiService().adminGetAttendance(date: dateStr);
      if (mounted) {
        setState(() => _records = list);
      }
    } catch (e) {
      debugPrint('Error loading attendance: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _selectDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
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

    if (picked != null && picked != _selectedDate) {
      setState(() => _selectedDate = picked);
      _loadAttendance();
    }
  }

  void _showSelfieDialog(String title, String? selfieUrl) {
    if (selfieUrl == null || selfieUrl.isEmpty) return;

    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.transparent,
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(20),
          ),
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white70),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Image.network(
                  selfieUrl,
                  headers: ApiService().authHeaders,
                  fit: BoxFit.contain,
                  loadingBuilder: (_, child, progress) {
                    if (progress == null) return child;
                    return Container(
                      height: 250,
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
                        Text('Selfie preview unavailable', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSelfieThumbnail(String label, String? selfieFilename) {
    if (selfieFilename == null || selfieFilename.isEmpty) {
      return Container(
        width: 64,
        height: 64,
        decoration: BoxDecoration(
          color: AppColors.inputDark,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Center(
          child: Icon(Icons.no_photography, color: Colors.white24, size: 24),
        ),
      );
    }

    final fullUrl = ApiService().getSelfieUrl(selfieFilename);

    return InkWell(
      onTap: () => _showSelfieDialog(label, fullUrl),
      borderRadius: BorderRadius.circular(12),
      child: Column(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 64,
              height: 64,
              child: Image.network(
                fullUrl,
                headers: ApiService().authHeaders,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(
                  color: AppColors.inputDark,
                  child: const Icon(Icons.broken_image, color: Colors.white38, size: 20),
                ),
              ),
            ),
          ),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 10)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: const Text('Attendance Records', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: Colors.white, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.person_search, color: AppColors.info),
            tooltip: 'View by Employee & Selfies',
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => const AdminEmployeeAttendanceScreen(),
                ),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _loadAttendance,
          ),
        ],
      ),
      body: Column(
        children: [
          // Date Filter Bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            color: AppColors.cardDark,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.event, color: AppColors.info, size: 20),
                    const SizedBox(width: 8),
                    Text(
                      DateFormat('EEEE, MMM d, yyyy').format(_selectedDate),
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                  ],
                ),
                TextButton.icon(
                  icon: const Icon(Icons.calendar_month, color: AppColors.info, size: 16),
                  label: const Text('Change Date', style: TextStyle(color: AppColors.info, fontSize: 13)),
                  onPressed: _selectDate,
                ),
              ],
            ),
          ),

          // Shortcut to Individual Employee Attendance & Selfies
          Container(
            margin: const EdgeInsets.fromLTRB(16, 12, 16, 6),
            decoration: BoxDecoration(
              color: AppColors.cardDark,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.info.withValues(alpha: 0.3)),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const AdminEmployeeAttendanceScreen(),
                  ),
                );
              },
              child: const Padding(
                padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Row(
                  children: [
                    Icon(Icons.photo_library_outlined, color: AppColors.info, size: 22),
                    SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Individual Employee Attendance & Selfies',
                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'View full past attendance history and photo records for any staff member',
                            style: TextStyle(color: AppColors.textDim, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward_ios, color: AppColors.info, size: 14),
                  ],
                ),
              ),
            ),
          ),

          // Attendance Records List
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: Colors.white))
                : _records.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.event_busy, color: Colors.white.withOpacity(0.3), size: 64),
                            const SizedBox(height: 16),
                            const Text(
                              'No attendance logged for this date',
                              style: TextStyle(color: AppColors.textMuted, fontSize: 15),
                            ),
                          ],
                        ),
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _records.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          final rec = _records[index];
                          final isCheckedIn = rec.status == 'checked_in';
                          final isAuto = rec.status == 'auto_checked_out';

                          return InkWell(
                            borderRadius: BorderRadius.circular(18),
                            onTap: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => AdminEmployeeAttendanceScreen(
                                    employeeId: rec.userId,
                                    employeeName: rec.employeeName,
                                    employeeDepartment: rec.employeeDepartment,
                                  ),
                                ),
                              );
                            },
                            child: Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: AppColors.cardDark,
                              borderRadius: BorderRadius.circular(18),
                              border: Border.all(
                                color: isCheckedIn
                                    ? AppColors.success.withOpacity(0.3)
                                    : isAuto
                                        ? Colors.amber.withOpacity(0.3)
                                        : Colors.white10,
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Header: Name + Status Badge
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          rec.employeeName ?? 'Employee #${rec.userId}',
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontWeight: FontWeight.bold,
                                            fontSize: 16,
                                          ),
                                        ),
                                        Text(
                                          rec.employeeDepartment ?? 'Field Staff',
                                          style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                                        ),
                                      ],
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: isCheckedIn
                                            ? AppColors.success.withOpacity(0.2)
                                            : isAuto
                                                ? Colors.amber.withOpacity(0.2)
                                                : Colors.white10,
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                      child: Text(
                                        isCheckedIn
                                            ? 'ON DUTY'
                                            : isAuto
                                                ? 'AUTO CLOSED'
                                                : 'COMPLETED',
                                        style: TextStyle(
                                          color: isCheckedIn
                                              ? AppColors.success
                                              : isAuto
                                                  ? Colors.amber
                                                  : Colors.white70,
                                          fontSize: 11,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const Divider(color: Colors.white10, height: 20),

                                // Details: Times + Selfies
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    // Left: Check-in / out timestamps
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              const Icon(Icons.login, color: AppColors.success, size: 16),
                                              const SizedBox(width: 6),
                                              Text(
                                                'In: ${DateFormat('hh:mm a').format(rec.checkInTime.toLocal())}',
                                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13),
                                              ),
                                            ],
                                          ),
                                          if (rec.checkInAddress != null)
                                            Padding(
                                              padding: const EdgeInsets.only(left: 22, top: 2),
                                              child: Text(
                                                rec.checkInAddress!,
                                                style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                          const SizedBox(height: 10),
                                          Row(
                                            children: [
                                              const Icon(Icons.logout, color: AppColors.error, size: 16),
                                              const SizedBox(width: 6),
                                              Text(
                                                rec.checkOutTime != null
                                                    ? 'Out: ${DateFormat('hh:mm a').format(rec.checkOutTime!.toLocal())}'
                                                    : 'Out: Active shift',
                                                style: TextStyle(
                                                  color: rec.checkOutTime != null ? Colors.white : AppColors.textMuted,
                                                  fontWeight: FontWeight.w600,
                                                  fontSize: 13,
                                                ),
                                              ),
                                            ],
                                          ),
                                          if (rec.checkOutAddress != null)
                                            Padding(
                                              padding: const EdgeInsets.only(left: 22, top: 2),
                                              child: Text(
                                                rec.checkOutAddress!,
                                                style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                        ],
                                      ),
                                    ),

                                    // Right: Selfies Thumbnails
                                    Row(
                                      children: [
                                        _buildSelfieThumbnail('Check-In', rec.checkInSelfie),
                                        const SizedBox(width: 10),
                                        _buildSelfieThumbnail('Check-Out', rec.checkOutSelfie),
                                      ],
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                const Divider(color: Colors.white10, height: 1),
                                const SizedBox(height: 8),
                                const Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      'View Complete History & Selfies',
                                      style: TextStyle(color: AppColors.info, fontSize: 11.5, fontWeight: FontWeight.bold),
                                    ),
                                    Icon(Icons.arrow_forward, size: 14, color: AppColors.info),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                      ),
          ),
        ],
      ),
    );
  }
}
