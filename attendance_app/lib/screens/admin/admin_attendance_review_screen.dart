import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/office_models.dart';

class AdminAttendanceReviewScreen extends StatefulWidget {
  const AdminAttendanceReviewScreen({super.key});

  @override
  State<AdminAttendanceReviewScreen> createState() => _AdminAttendanceReviewScreenState();
}

class _AdminAttendanceReviewScreenState extends State<AdminAttendanceReviewScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  List<AttendanceReviewModel> _reviews = [];

  @override
  void initState() {
    super.initState();
    _loadReviews();
  }

  Future<void> _loadReviews() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final list = await ApiService().getPendingAttendanceReviews();
      if (mounted) {
        setState(() {
          _reviews = list;
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

  Future<void> _approveReview(AttendanceReviewModel review) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Approve Attendance?', style: TextStyle(color: Colors.white)),
        content: Text(
          'Approve outside-geofence check-in for ${review.employeeName ?? 'Employee'}?\n\nThis attendance will be marked approved and counted as a payable day in salary calculations.',
          style: const TextStyle(color: Colors.white70, fontSize: 13, height: 1.4),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.success),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Approve'),
          ),
        ],
      ),
    );

    if (confirm == true) {
      try {
        await ApiService().approveAttendanceReview(review.id);
        _loadReviews();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: AppColors.success, content: Text('Attendance approved for ${review.employeeName}')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: AppColors.error, content: Text('Approval failed: ${e.toString()}')),
          );
        }
      }
    }
  }

  Future<void> _rejectReview(AttendanceReviewModel review) async {
    final reasonCtrl = TextEditingController();

    final confirmedReason = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Reject Outside Attendance', style: TextStyle(color: Colors.white)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'A non-empty rejection reason is mandatory. The employee will see this explanation and the attendance will not be counted.',
              style: TextStyle(color: Colors.white70, fontSize: 12),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonCtrl,
              maxLines: 2,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: InputDecoration(
                labelText: 'Rejection Reason *',
                hintText: 'e.g. Unverified location, no client meeting scheduled',
                labelStyle: const TextStyle(color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.cardDarker,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, null), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () {
              final reason = reasonCtrl.text.trim();
              if (reason.isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Please enter a rejection reason')),
                );
                return;
              }
              Navigator.pop(ctx, reason);
            },
            child: const Text('Reject'),
          ),
        ],
      ),
    );

    if (confirmedReason != null) {
      try {
        await ApiService().rejectAttendanceReview(review.id, confirmedReason);
        _loadReviews();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: AppColors.success, content: Text('Attendance rejected for ${review.employeeName}')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: AppColors.error, content: Text('Rejection failed: ${e.toString()}')),
          );
        }
      }
    }
  }

  void _showSelfieDialog(String selfiePath, String employeeName) {
    final cleanPath = selfiePath.split('/').last.split('\\').last;
    final selfieUrl = ApiService().getSelfieUrl(cleanPath);

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('$employeeName - Check-In Selfie', style: const TextStyle(color: Colors.white, fontSize: 15)),
        content: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Image.network(
            selfieUrl,
            headers: {
              if (ApiService().token != null) 'Authorization': 'Bearer ${ApiService().token}',
            },
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => Container(
              height: 180,
              color: Colors.white12,
              child: const Center(child: Text('Unable to load selfie image', style: TextStyle(color: Colors.white70))),
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.backgroundDark,
      appBar: AppBar(
        backgroundColor: AppColors.cardDark,
        title: const Text('Attendance Review Requests', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _loadReviews,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _errorMessage != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, size: 48, color: AppColors.error),
                      const SizedBox(height: 12),
                      Text(_errorMessage!, style: const TextStyle(color: Colors.white70)),
                      const SizedBox(height: 16),
                      ElevatedButton(onPressed: _loadReviews, child: const Text('Retry')),
                    ],
                  ),
                )
              : _reviews.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.verified_user_outlined, size: 64, color: AppColors.success.withOpacity(0.5)),
                          const SizedBox(height: 16),
                          const Text('All Attendance Verified!', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold)),
                          const SizedBox(height: 6),
                          const Text('No pending outside-geofence check-ins requiring review.', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                        ],
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _reviews.length,
                      itemBuilder: (ctx, i) {
                        final r = _reviews[i];
                        final distance = r.distanceFromOffice != null ? '${r.distanceFromOffice!.toInt()}m' : 'Unknown';
                        final radius = r.officeRadius != null ? '${r.officeRadius!.toInt()}m' : '100m';

                        return Card(
                          color: AppColors.cardDark,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          margin: const EdgeInsets.only(bottom: 14),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    if (r.selfiePath != null && r.selfiePath!.isNotEmpty)
                                      GestureDetector(
                                        onTap: () => _showSelfieDialog(r.selfiePath!, r.employeeName ?? 'Employee'),
                                        child: Container(
                                          width: 54,
                                          height: 54,
                                          margin: const EdgeInsets.only(right: 12),
                                          decoration: BoxDecoration(
                                            borderRadius: BorderRadius.circular(10),
                                            border: Border.all(color: Colors.white24),
                                            image: DecorationImage(
                                              image: NetworkImage(
                                                ApiService().getSelfieUrl(r.selfiePath!.split('/').last.split('\\').last),
                                                headers: {
                                                  if (ApiService().token != null) 'Authorization': 'Bearer ${ApiService().token}',
                                                },
                                              ),
                                              fit: BoxFit.cover,
                                            ),
                                          ),
                                        ),
                                      ),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            r.employeeName ?? 'Employee #${r.employeeId}',
                                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            'ID: #${r.employeeId > 0 ? r.employeeId : 'N/A'} • ${r.department ?? 'General'}',
                                            style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            'Check-in: ${r.checkInTimeIst ?? r.checkInTime ?? 'N/A'}',
                                            style: const TextStyle(color: Colors.white70, fontSize: 12),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: AppColors.warning.withOpacity(0.18),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: const Text(
                                        'OUTSIDE GEOFENCE',
                                        style: TextStyle(color: AppColors.warning, fontSize: 9.5, fontWeight: FontWeight.bold),
                                      ),
                                    ),
                                  ],
                                ),
                                const Divider(color: Colors.white10, height: 20),
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: AppColors.cardDarker,
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Column(
                                    children: [
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          const Text('Nearest Office:', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                                          Text(r.officeName ?? 'None assigned', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12)),
                                        ],
                                      ),
                                      const SizedBox(height: 4),
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          const Text('Distance From Office:', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                                          Text('$distance (Radius: $radius)', style: const TextStyle(color: AppColors.warning, fontWeight: FontWeight.bold, fontSize: 12)),
                                        ],
                                      ),
                                      const SizedBox(height: 4),
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          const Text('Location Telemetry:', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                                          Text(
                                            '${r.locationSource == 'CELL_NETWORK' || r.locationSource == 'CELL_TOWER' ? 'Cell Tower' : (r.locationSource ?? 'GPS')} • Acc: ${r.accuracyMeters != null ? '${r.accuracyMeters!.toInt()}m' : 'N/A'}${r.batteryPercentage != null ? ' • Bat: ${r.batteryPercentage}%' : ''}${r.appVersion != null ? ' • APK: v${r.appVersion}' : ''}',
                                            style: const TextStyle(color: Colors.white70, fontSize: 11),
                                          ),
                                        ],
                                      ),
                                      if (r.outsideReason != null && r.outsideReason!.isNotEmpty) ...[
                                        const SizedBox(height: 6),
                                        Row(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                          children: [
                                            const Text('Employee Reason:', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                                            Expanded(
                                              child: Text(
                                                r.outsideReason!,
                                                textAlign: TextAlign.end,
                                                style: const TextStyle(color: Colors.white70, fontSize: 11.5, fontStyle: FontStyle.italic),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                                const SizedBox(height: 14),
                                Row(
                                  children: [
                                    Expanded(
                                      child: OutlinedButton.icon(
                                        style: OutlinedButton.styleFrom(
                                          foregroundColor: AppColors.error,
                                          side: const BorderSide(color: AppColors.error),
                                          padding: const EdgeInsets.symmetric(vertical: 10),
                                        ),
                                        onPressed: () => _rejectReview(r),
                                        icon: const Icon(Icons.close, size: 18),
                                        label: const Text('Reject', style: TextStyle(fontWeight: FontWeight.bold)),
                                      ),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: ElevatedButton.icon(
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: AppColors.success,
                                          padding: const EdgeInsets.symmetric(vertical: 10),
                                        ),
                                        onPressed: () => _approveReview(r),
                                        icon: const Icon(Icons.check, size: 18),
                                        label: const Text('Approve', style: TextStyle(fontWeight: FontWeight.bold)),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
    );
  }
}

