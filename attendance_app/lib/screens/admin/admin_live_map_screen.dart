import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../core/services/reverse_geocoding_service.dart';
import '../../models/location_model.dart';
import 'admin_route_history_screen.dart';
import 'admin_attendance_screen.dart';
import 'admin_employee_attendance_screen.dart';

class AdminLiveMapScreen extends StatefulWidget {
  const AdminLiveMapScreen({super.key});

  @override
  State<AdminLiveMapScreen> createState() => _AdminLiveMapScreenState();
}

class _AdminLiveMapScreenState extends State<AdminLiveMapScreen> {
  final MapController _mapController = MapController();
  final ReverseGeocodingService _geocodingService = ReverseGeocodingService();
  final Map<int, String> _resolvedAddresses = {};

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

        // Resolve exact place names in background for active tracked employees
        for (final emp in list) {
          if (emp.hasValidLocation && !_resolvedAddresses.containsKey(emp.userId)) {
            if (emp.checkInAddress != null &&
                emp.checkInAddress!.isNotEmpty &&
                !emp.checkInAddress!.startsWith('GPS:') &&
                !emp.checkInAddress!.startsWith('Lat:')) {
              _resolvedAddresses[emp.userId] = emp.checkInAddress!;
            }
            _geocodingService.getPlaceName(emp.lastLatitude!, emp.lastLongitude!).then((place) {
              if (mounted) {
                setState(() {
                  _resolvedAddresses[emp.userId] = place;
                });
              }
            });
          }
        }

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

      // Ensure exact place name is fetched for the selected employee
      if (!_resolvedAddresses.containsKey(emp.userId) || _resolvedAddresses[emp.userId]!.startsWith('GPS:')) {
        _geocodingService.getPlaceName(emp.lastLatitude!, emp.lastLongitude!).then((place) {
          if (mounted) {
            setState(() {
              _resolvedAddresses[emp.userId] = place;
            });
          }
        });
      }
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
      final isMocked = emp.isMocked;

      final int minutesAgo = emp.lastLocationTime != null
          ? DateTime.now().toUtc().difference(emp.lastLocationTime!.toUtc()).inMinutes
          : 999;

      final String lastSeenText = minutesAgo == 0
          ? 'Active now'
          : minutesAgo < 60
              ? '${minutesAgo}m ago'
              : '${minutesAgo ~/ 60}h ago';

      Color markerColor;
      if (isMocked) {
        markerColor = Colors.deepOrange;
      } else if (isGpsOff) {
        markerColor = AppColors.error;
      } else if (!isWorking) {
        markerColor = Colors.grey;
      } else if (minutesAgo < 5) {
        markerColor = AppColors.success; // Green (< 5m)
      } else if (minutesAgo < 15) {
        markerColor = Colors.amber.shade700; // Orange (5-15m)
      } else {
        markerColor = Colors.grey; // Grey (> 15m)
      }

      final place = _resolvedAddresses[emp.userId];
      final shortPlace = place?.split(',').first.trim();

      markers.add(
        Marker(
          point: LatLng(emp.lastLatitude!, emp.lastLongitude!),
          width: 120,
          height: 75,
          child: GestureDetector(
            onTap: () => _showEmployeeDetails(emp),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(
                    color: markerColor,
                    shape: BoxShape.circle,
                    boxShadow: const [
                      BoxShadow(color: Colors.black45, blurRadius: 6, spreadRadius: 1),
                    ],
                  ),
                  child: Icon(
                    isMocked
                        ? Icons.warning_rounded
                        : isGpsOff
                            ? Icons.location_off
                            : Icons.person_pin,
                    color: Colors.white,
                    size: 20,
                  ),
                ),
                const SizedBox(height: 2),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: markerColor.withValues(alpha: 0.92),
                    borderRadius: BorderRadius.circular(8),
                    boxShadow: const [
                      BoxShadow(color: Colors.black26, blurRadius: 3),
                    ],
                  ),
                  child: Text(
                    isMocked
                        ? '⚠️ MOCK'
                        : shortPlace != null
                            ? '${emp.fullName.split(' ').first} • $shortPlace'
                            : '${emp.fullName.split(' ').first} • $lastSeenText',
                    style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
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
              initialCenter: const LatLng(23.3441, 85.3832), // STPI RIADA, Namkum, Ranchi
              initialZoom: 13.5,
              interactionOptions: const InteractionOptions(flags: InteractiveFlag.all),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.sologixenergy.attendance',
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
                          Row(
                            children: [
                              IconButton(
                                icon: const Icon(Icons.assignment_outlined, color: Colors.white70),
                                tooltip: 'Attendance Log',
                                onPressed: () {
                                  Navigator.push(
                                    context,
                                    MaterialPageRoute(builder: (_) => const AdminAttendanceScreen()),
                                  );
                                },
                              ),
                              IconButton(
                                icon: const Icon(Icons.refresh, color: Colors.white70),
                                onPressed: () => _fetchLiveLocations(),
                              ),
                            ],
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
                            color: _selectedEmployee!.isMocked
                                ? Colors.deepOrange.withOpacity(0.2)
                                : _selectedEmployee!.isGpsOff
                                    ? AppColors.error.withOpacity(0.2)
                                    : _selectedEmployee!.isWorking
                                        ? AppColors.success.withOpacity(0.2)
                                        : Colors.white10,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            _selectedEmployee!.isMocked
                                ? '⚠️ FAKE / MOCK GPS'
                                : _selectedEmployee!.isGpsOff
                                    ? '⚠️ GPS OFF'
                                    : _selectedEmployee!.isWorking
                                        ? '🟢 On Duty Tracking'
                                        : '⚪ Checked Out',
                            style: TextStyle(
                              color: _selectedEmployee!.isMocked
                                  ? Colors.deepOrange
                                  : _selectedEmployee!.isGpsOff
                                      ? AppColors.error
                                      : _selectedEmployee!.isWorking
                                          ? AppColors.success
                                          : AppColors.textMuted,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        if (_selectedEmployee!.lastLocationTime != null)
                          Expanded(
                            child: Text(
                              'Last Seen: ${DateTime.now().toUtc().difference(_selectedEmployee!.lastLocationTime!.toUtc()).inMinutes == 0 ? "Just now" : "${DateTime.now().toUtc().difference(_selectedEmployee!.lastLocationTime!.toUtc()).inMinutes}m ago"} (${DateFormat('hh:mm a').format(_selectedEmployee!.lastLocationTime!)})',
                              style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Exact Location / Place Name Container
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.05),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: Colors.white12),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(top: 2),
                            child: Icon(Icons.place, color: Colors.amberAccent, size: 20),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'CURRENT PLACE / ADDRESS',
                                  style: TextStyle(
                                    color: Colors.amberAccent,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  _resolvedAddresses[_selectedEmployee!.userId] ??
                                      _selectedEmployee!.checkInAddress ??
                                      (_selectedEmployee!.hasValidLocation
                                          ? 'Resolving exact place name...'
                                          : 'No GPS coordinates available'),
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    height: 1.3,
                                  ),
                                ),
                                if (_selectedEmployee!.hasValidLocation) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    'Coordinates: ${_selectedEmployee!.lastLatitude!.toStringAsFixed(5)}, ${_selectedEmployee!.lastLongitude!.toStringAsFixed(5)}${_selectedEmployee!.lastAccuracy != null ? " (±${_selectedEmployee!.lastAccuracy!.toStringAsFixed(1)}m)" : ""}',
                                    style: const TextStyle(color: AppColors.textMuted, fontSize: 10),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(
                          child: ElevatedButton.icon(
                            icon: const Icon(Icons.route, color: Colors.white, size: 16),
                            label: const Text('Route Trail', style: TextStyle(color: Colors.white, fontSize: 12.5)),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.info,
                              padding: const EdgeInsets.symmetric(vertical: 12),
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
                        const SizedBox(width: 10),
                        Expanded(
                          child: OutlinedButton.icon(
                            icon: const Icon(Icons.photo_library_outlined, color: AppColors.success, size: 16),
                            label: const Text('All Selfies', style: TextStyle(color: Colors.white, fontSize: 12.5)),
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: Colors.white24),
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                            onPressed: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => AdminEmployeeAttendanceScreen(
                                    employeeId: _selectedEmployee!.userId,
                                    employeeName: _selectedEmployee!.fullName,
                                    employeeDepartment: _selectedEmployee!.department,
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ],
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
