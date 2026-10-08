import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/location_model.dart';

class AdminAlertsScreen extends StatefulWidget {
  const AdminAlertsScreen({super.key});

  @override
  State<AdminAlertsScreen> createState() => _AdminAlertsScreenState();
}

class _AdminAlertsScreenState extends State<AdminAlertsScreen> {
  List<GpsAlert> _alerts = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadAlerts();
  }

  Future<void> _loadAlerts() async {
    setState(() => _isLoading = true);
    try {
      final list = await ApiService().adminGetAlerts();
      setState(() => _alerts = list);
    } catch (e) {
      debugPrint('Error loading alerts: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _resolveAlert(int id) async {
    try {
      await ApiService().adminResolveAlert(id);
      _loadAlerts();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.success,
            content: Text('Alert marked as resolved'),
          ),
        );
      }
    } catch (e) {
      debugPrint('Error resolving alert: $e');
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
                      'GPS Security Alerts',
                      style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                    IconButton(
                      icon: const Icon(Icons.refresh, color: Colors.white70),
                      onPressed: _loadAlerts,
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Container(
                  decoration: const BoxDecoration(
                    color: AppColors.background,
                    borderRadius: BorderRadius.only(topLeft: Radius.circular(30), topRight: Radius.circular(30)),
                  ),
                  child: _isLoading
                      ? const Center(child: CircularProgressIndicator(color: Colors.white))
                      : _alerts.isEmpty
                          ? Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.check_circle_outline, size: 64, color: AppColors.success.withOpacity(0.5)),
                                  const SizedBox(height: 16),
                                  const Text('No active GPS alerts', style: TextStyle(color: AppColors.textMuted, fontSize: 16)),
                                  const SizedBox(height: 6),
                                  const Text('All field employees are reporting GPS normally', style: TextStyle(color: Colors.white38, fontSize: 13)),
                                ],
                              ),
                            )
                          : RefreshIndicator(
                              onRefresh: _loadAlerts,
                              color: Colors.white,
                              backgroundColor: AppColors.cardDark,
                              child: ListView.separated(
                                padding: const EdgeInsets.all(20),
                                itemCount: _alerts.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 12),
                                itemBuilder: (context, index) {
                                  final alert = _alerts[index];
                                  final isResolved = alert.resolved;

                                  return Container(
                                    padding: const EdgeInsets.all(16),
                                    decoration: BoxDecoration(
                                      color: AppColors.cardDark,
                                      borderRadius: BorderRadius.circular(18),
                                      border: Border.all(
                                        color: isResolved ? Colors.transparent : AppColors.error.withOpacity(0.5),
                                        width: 1,
                                      ),
                                    ),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Container(
                                              padding: const EdgeInsets.all(8),
                                              decoration: BoxDecoration(
                                                color: isResolved
                                                    ? Colors.grey.withOpacity(0.2)
                                                    : AppColors.error.withOpacity(0.2),
                                                shape: BoxShape.circle,
                                              ),
                                              child: Icon(
                                                Icons.location_off,
                                                color: isResolved ? Colors.grey : AppColors.error,
                                                size: 20,
                                              ),
                                            ),
                                            const SizedBox(width: 12),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Text(
                                                    alert.fullName,
                                                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                                                  ),
                                                  Text(
                                                    alert.department ?? 'Field Employee',
                                                    style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                                                  ),
                                                ],
                                              ),
                                            ),
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                              decoration: BoxDecoration(
                                                color: isResolved ? Colors.white10 : AppColors.error.withOpacity(0.15),
                                                borderRadius: BorderRadius.circular(10),
                                              ),
                                              child: Text(
                                                isResolved ? 'Resolved' : 'ATTENTION',
                                                style: TextStyle(
                                                  color: isResolved ? AppColors.textMuted : AppColors.error,
                                                  fontSize: 10,
                                                  fontWeight: FontWeight.bold,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 10),
                                        Text(
                                          alert.message,
                                          style: const TextStyle(color: Colors.white70, fontSize: 13),
                                        ),
                                        const SizedBox(height: 8),
                                        Row(
                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                          children: [
                                            Text(
                                              DateFormat('MMM d, hh:mm a').format(alert.createdAt),
                                              style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                                            ),
                                            if (!isResolved)
                                              TextButton(
                                                onPressed: () => _resolveAlert(alert.id),
                                                child: const Text('Mark Resolved', style: TextStyle(color: AppColors.info, fontSize: 12)),
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
