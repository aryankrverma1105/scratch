import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/attendance_model.dart';

class ActivitiesScreen extends StatefulWidget {
  const ActivitiesScreen({super.key});

  @override
  State<ActivitiesScreen> createState() => _ActivitiesScreenState();
}

class _ActivitiesScreenState extends State<ActivitiesScreen> {
  List<AttendanceRecord> _records = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    setState(() => _isLoading = true);
    try {
      final list = await ApiService().getMyAttendanceHistory();
      setState(() {
        _records = list;
      });
    } catch (e) {
      debugPrint('Error loading history: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 15),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Attendance History',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.refresh, color: Colors.white70),
                      onPressed: _loadHistory,
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Container(
                  decoration: const BoxDecoration(
                    color: AppColors.background,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(30),
                      topRight: Radius.circular(30),
                    ),
                  ),
                  child: _isLoading
                      ? const Center(child: CircularProgressIndicator(color: Colors.white))
                      : _records.isEmpty
                          ? Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.history_toggle_off, size: 64, color: Colors.white.withOpacity(0.3)),
                                  const SizedBox(height: 16),
                                  const Text(
                                    'No attendance records found',
                                    style: TextStyle(color: AppColors.textMuted, fontSize: 16),
                                  ),
                                ],
                              ),
                            )
                          : RefreshIndicator(
                              onRefresh: _loadHistory,
                              color: Colors.white,
                              backgroundColor: AppColors.cardDark,
                              child: ListView.separated(
                                padding: const EdgeInsets.all(20),
                                itemCount: _records.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 14),
                                itemBuilder: (context, index) {
                                  final rec = _records[index];
                                  final isCompleted = rec.status == 'checked_out';
                                  final checkInStr = DateFormat('hh:mm a').format(rec.checkInTime);
                                  final checkOutStr = rec.checkOutTime != null
                                      ? DateFormat('hh:mm a').format(rec.checkOutTime!)
                                      : 'In Progress';

                                  String durationStr = '--';
                                  if (rec.duration != null) {
                                    final d = rec.duration!;
                                    durationStr = '${d.inHours}h ${d.inMinutes % 60}m';
                                  }

                                  return Container(
                                    padding: const EdgeInsets.all(18),
                                    decoration: BoxDecoration(
                                      color: AppColors.cardDark,
                                      borderRadius: BorderRadius.circular(18),
                                    ),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                          children: [
                                            Text(
                                              rec.date,
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontWeight: FontWeight.bold,
                                                fontSize: 16,
                                              ),
                                            ),
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                              decoration: BoxDecoration(
                                                color: isCompleted
                                                    ? AppColors.info.withOpacity(0.2)
                                                    : AppColors.success.withOpacity(0.2),
                                                borderRadius: BorderRadius.circular(12),
                                              ),
                                              child: Text(
                                                isCompleted ? 'Completed' : 'Active Duty',
                                                style: TextStyle(
                                                  color: isCompleted ? AppColors.info : AppColors.success,
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.bold,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 12),
                                        Row(
                                          children: [
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  const Text('Check In', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                                                  const SizedBox(height: 2),
                                                  Text(checkInStr, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                                                ],
                                              ),
                                            ),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  const Text('Check Out', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                                                  const SizedBox(height: 2),
                                                  Text(checkOutStr, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                                                ],
                                              ),
                                            ),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  const Text('Duration', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                                                  const SizedBox(height: 2),
                                                  Text(durationStr, style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.bold)),
                                                ],
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 10),
                                        Row(
                                          children: [
                                            const Icon(Icons.location_on, size: 14, color: AppColors.textMuted),
                                            const SizedBox(width: 4),
                                            Expanded(
                                              child: Text(
                                                'In: ${rec.checkInLat.toStringAsFixed(4)}, ${rec.checkInLng.toStringAsFixed(4)}',
                                                style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                            if (rec.checkInSelfie != null)
                                              Row(
                                                children: const [
                                                  Icon(Icons.face_retouching_natural, size: 14, color: AppColors.info),
                                                  SizedBox(width: 4),
                                                  Text('Selfie Logged', style: TextStyle(color: AppColors.info, fontSize: 11)),
                                                ],
                                              ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  );
                                },
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
}
