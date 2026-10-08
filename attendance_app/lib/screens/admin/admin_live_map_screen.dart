import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/location_model.dart';
import 'admin_route_history_screen.dart';

class AdminLiveMapScreen extends StatefulWidget {
  const AdminLiveMapScreen({super.key});

  @override
  State<AdminLiveMapScreen> createState() => _AdminLiveMapScreenState();
}

class _AdminLiveMapScreenState extends State<AdminLiveMapScreen> {
  final MapController _mapController = MapController();
  List<LiveEmployeeLocation> _employees = [];
  bool _isLoading = true;
  Timer? _refreshTimer;
  LiveEmployeeLocation? _selectedEmployee;

  @override
  void initState() {
    super.initState();
    _fetchLiveLocations();
    // Auto-refresh every 15 seconds for live field monitoring
    _refreshTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      _fetchLiveLocations(isBackground: true);
    });
  }

  Future<void> _fetchLiveLocations({bool isBackground = false}) async {
    if (!isBackground) setState(() => _isLoading = true);
    try {
      final list = await ApiService().adminGetLiveLocations();
      if (mounted) {
        setState(() {
          _employees = list;
        });

        // If we have employees with valid locations and none selected, center on first active
        final activeWithLoc = list.where((e) => e.hasValidLocation).toList();
        if (activeWithLoc.isNotEmpty && !isBackground) {
          final first = activeWithLoc.first;
          _mapController.move(
            LatLng(first.lastLatitude!, first.lastLongitude!),
            14.0,
          );
        }
      }
    } catch (e) {
      debugPrint('Error fetching live locations: $e');
    } finally {
      if (mounted && !isBackground) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  void _showEmployeeDetails(LiveEmployeeLocation emp) {
    setState(() => _selectedEmployee = emp);
    if (emp.hasValidLocation) {
      _mapController.move(
        LatLng(emp.lastLatitude!, emp.lastLongitude!),
        15.5,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final activeEmployees = _employees.where((e) => e.isWorking).toList();
    final gpsOffCount = _employees.where((e) => e.isGpsOff).length;

    // Build map markers
    final markers = <Marker>[];
    for (final emp in _employees) {
      if (!emp.hasValidLocation) continue;

      final isGpsOff = emp.isGpsOff;
      final isWorking = emp.isWorking;

      Color markerColor = isGpsOff
          ? AppColors.error
          : isWorking
              ? AppColors.success
              : Colors.grey;

      markers.add(
        Marker(
          point: LatLng(emp.lastLatitude!, emp.lastLongitude!),
          width: 55,
          height: 55,
          child: GestureDetector(
            onTap: () => _showEmployeeDetails(emp),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: markerColor,
                    shape: BoxShape.circle,
                    boxShadow: const [
                      BoxShadow(color: Colors.black45, blurRadius: 6, spreadRadius: 1),
                    ],
                  ),
                  child: Icon(
                    isGpsOff ? Icons.location_off : Icons.person_pin,
                    color: Colors.white,
                    size: 24,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.black87,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    emp.fullName.split(' ').first,
                    style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          // OpenStreetMap Layer
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: const LatLng(28.6139, 77.2090), // Default center
              initialZoom: 12.0,
              interactionOptions: const InteractionOptions(flags: InteractiveFlag.all),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.company.attendance.attendance_app',
              ),
              MarkerLayer(markers: markers),
            ],
          ),

          if (_isLoading)
            const Center(child: CircularProgressIndicator(color: Colors.white)),

          // Header Overlay
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      decoration: BoxDecoration(
                        color: AppColors.cardDark.withOpacity(0.92),
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: const [
                          BoxShadow(color: Colors.black38, blurRadius: 10, spreadRadius: 2),
                        ],
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Text(
                                'Live Field Radar',
                                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                              ),
                              Text(
                                '${activeEmployees.length} on duty • ${gpsOffCount > 0 ? '$gpsOffCount GPS OFF' : 'All GPS Normal'}',
                                style: TextStyle(
                                  color: gpsOffCount > 0 ? AppColors.error : AppColors.success,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                          IconButton(
                            icon: const Icon(Icons.refresh, color: Colors.white70),
                            onPressed: () => _fetchLiveLocations(),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Selected Employee Card (Bottom)
          if (_selectedEmployee != null)
            Positioned(
              left: 16,
              right: 16,
              bottom: 24,
              child: Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: AppColors.cardDark,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: const [
                    BoxShadow(color: Colors.black54, blurRadius: 15, spreadRadius: 3),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 44,
                              height: 44,
                              decoration: const BoxDecoration(
                                gradient: LinearGradient(colors: AppColors.cardGradient),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.person, color: Colors.white, size: 24),
                            ),
                            const SizedBox(width: 12),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _selectedEmployee!.fullName,
                                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                                ),
                                Text(
                                  _selectedEmployee!.department ?? 'General',
                                  style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                                ),
                              ],
                            ),
                          ],
                        ),
                        IconButton(
                          icon: const Icon(Icons.close, color: Colors.white70, size: 20),
                          onPressed: () => setState(() => _selectedEmployee = null),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: _selectedEmployee!.isGpsOff
                                ? AppColors.error.withOpacity(0.2)
                                : _selectedEmployee!.isWorking
                                    ? AppColors.success.withOpacity(0.2)
                                    : Colors.white10,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            _selectedEmployee!.isGpsOff
                                ? '⚠️ GPS OFF'
                                : _selectedEmployee!.isWorking
                                    ? '🟢 On Duty Tracking'
                                    : '⚪ Checked Out',
                            style: TextStyle(
                              color: _selectedEmployee!.isGpsOff
                                  ? AppColors.error
                                  : _selectedEmployee!.isWorking
                                      ? AppColors.success
                                      : AppColors.textMuted,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        if (_selectedEmployee!.lastLocationTime != null)
                          Text(
                            'Last Ping: ${DateFormat('hh:mm:ss a').format(_selectedEmployee!.lastLocationTime!)}',
                            style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                          ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      width: double.infinity,
                      height: 44,
                      child: ElevatedButton.icon(
                        icon: const Icon(Icons.route, color: Colors.white, size: 18),
                        label: const Text('View Historical Route & Path', style: TextStyle(color: Colors.white)),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.info,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => AdminRouteHistoryScreen(
                                initialUserId: _selectedEmployee!.userId,
                                initialUserName: _selectedEmployee!.fullName,
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
