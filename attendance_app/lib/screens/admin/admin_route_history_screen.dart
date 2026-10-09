import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/location_model.dart';
import '../../models/user_model.dart';

class AdminRouteHistoryScreen extends StatefulWidget {
  final int? initialUserId;
  final String? initialUserName;

  const AdminRouteHistoryScreen({
    super.key,
    this.initialUserId,
    this.initialUserName,
  });

  @override
  State<AdminRouteHistoryScreen> createState() => _AdminRouteHistoryScreenState();
}

class _AdminRouteHistoryScreenState extends State<AdminRouteHistoryScreen> {
  final MapController _mapController = MapController();
  List<UserModel> _allUsers = [];
  int? _selectedUserId;
  DateTime _selectedDate = DateTime.now();
  List<RoutePoint> _routePoints = [];
  bool _isLoading = false;
  int _sliderIndex = 0;

  @override
  void initState() {
    super.initState();
    _selectedUserId = widget.initialUserId;
    _loadUsersAndRoute();
  }

  Future<void> _loadUsersAndRoute() async {
    setState(() => _isLoading = true);
    try {
      final users = await ApiService().adminGetUsers();
      final employees = users.where((u) => u.role == 'employee').toList();
      setState(() {
        _allUsers = employees;
        if (_selectedUserId == null && employees.isNotEmpty) {
          _selectedUserId = employees.first.id;
        }
      });

      if (_selectedUserId != null) {
        await _fetchRoute();
      }
    } catch (e) {
      debugPrint('Error loading route history: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _fetchRoute() async {
    if (_selectedUserId == null) return;
    setState(() => _isLoading = true);

    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate);
      final data = await ApiService().adminGetUserRoute(_selectedUserId!, dateStr);
      final points = data['route'] as List<RoutePoint>;

      setState(() {
        _routePoints = points;
      });

      if (points.isNotEmpty) {
        _mapController.move(
          LatLng(points.first.latitude, points.first.longitude),
          14.0,
        );
      }
    } catch (e) {
      debugPrint('Error fetching route points: $e');
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
      _fetchRoute();
    }
  }

  double _calculateTotalDistanceKm() {
    if (_routePoints.length < 2) return 0.0;
    const Distance distance = Distance();
    double totalMeters = 0.0;
    for (int i = 0; i < _routePoints.length - 1; i++) {
      totalMeters += distance.as(
        LengthUnit.Meter,
        LatLng(_routePoints[i].latitude, _routePoints[i].longitude),
        LatLng(_routePoints[i + 1].latitude, _routePoints[i + 1].longitude),
      );
    }
    return totalMeters / 1000.0;
  }

  @override
  Widget build(BuildContext context) {
    final polylineCoords = _routePoints.map((p) => LatLng(p.latitude, p.longitude)).toList();
    final markers = <Marker>[];

    if (_routePoints.isNotEmpty) {
      // Start Marker (Green)
      markers.add(
        Marker(
          point: LatLng(_routePoints.first.latitude, _routePoints.first.longitude),
          width: 44,
          height: 44,
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(4),
                decoration: const BoxDecoration(color: AppColors.success, shape: BoxShape.circle),
                child: const Icon(Icons.play_arrow, color: Colors.white, size: 20),
              ),
              const Text('START', style: TextStyle(color: AppColors.success, fontSize: 9, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
      );

      // End Marker (Red)
      if (_routePoints.length > 1) {
        markers.add(
          Marker(
            point: LatLng(_routePoints.last.latitude, _routePoints.last.longitude),
            width: 44,
            height: 44,
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(4),
                  decoration: const BoxDecoration(color: AppColors.error, shape: BoxShape.circle),
                  child: const Icon(Icons.stop, color: Colors.white, size: 20),
                ),
                const Text('END', style: TextStyle(color: AppColors.error, fontSize: 9, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
        );
      }

      // Scrubber Position Marker (Cyan)
      if (_sliderIndex < _routePoints.length) {
        final currentPoint = _routePoints[_sliderIndex];
        markers.add(
          Marker(
            point: LatLng(currentPoint.latitude, currentPoint.longitude),
            width: 60,
            height: 60,
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: Colors.cyanAccent.shade700,
                    shape: BoxShape.circle,
                    boxShadow: const [
                      BoxShadow(color: Colors.cyan, blurRadius: 10, spreadRadius: 2),
                    ],
                  ),
                  child: const Icon(Icons.navigation, color: Colors.black, size: 18),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                  decoration: BoxDecoration(
                    color: Colors.black87,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    DateFormat('hh:mm a').format(currentPoint.timestamp),
                    style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
        );
      }
    }

    final totalDistance = _calculateTotalDistanceKm();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: const Text('Route Trail History', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: Colors.white, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: Column(
        children: [
          // Filter Bar (Employee Dropdown + Date Picker)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: AppColors.cardDark,
            child: Row(
              children: [
                // Employee Dropdown
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: AppColors.inputDark,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<int>(
                        value: _selectedUserId,
                        isExpanded: true,
                        dropdownColor: AppColors.cardDark,
                        icon: const Icon(Icons.arrow_drop_down, color: Colors.white),
                        items: _allUsers.map((u) {
                          return DropdownMenuItem<int>(
                            value: u.id,
                            child: Text(
                              u.fullName,
                              style: const TextStyle(color: Colors.white, fontSize: 14),
                              overflow: TextOverflow.ellipsis,
                            ),
                          );
                        }).toList(),
                        onChanged: (val) {
                          if (val != null) {
                            setState(() {
                              _selectedUserId = val;
                              _sliderIndex = 0;
                            });
                            _fetchRoute();
                          }
                        },
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),

                // Date Picker Button
                InkWell(
                  onTap: _selectDate,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    decoration: BoxDecoration(
                      color: AppColors.inputDark,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.calendar_month, color: AppColors.info, size: 18),
                        const SizedBox(width: 6),
                        Text(
                          DateFormat('MMM d').format(_selectedDate),
                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Map View with Polyline and Slider
          Expanded(
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: const LatLng(28.6139, 77.2090),
                    initialZoom: 13.0,
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.sologixenergy.attendance',
                    ),
                    if (polylineCoords.length >= 2)
                      PolylineLayer(
                        polylines: [
                          Polyline(
                            points: polylineCoords,
                            strokeWidth: 4.5,
                            color: AppColors.info,
                          ),
                        ],
                      ),
                    MarkerLayer(markers: markers),
                  ],
                ),

                if (_isLoading)
                  const Center(child: CircularProgressIndicator(color: Colors.white))
                else if (_routePoints.isEmpty)
                  Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      decoration: BoxDecoration(
                        color: AppColors.cardDark.withValues(alpha: 0.92),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: Colors.white12),
                        boxShadow: const [
                          BoxShadow(color: Colors.black54, blurRadius: 10, spreadRadius: 2),
                        ],
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.route_outlined, color: AppColors.textMuted, size: 20),
                          SizedBox(width: 8),
                          Text(
                            'No route points logged for this date',
                            style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
                          ),
                        ],
                      ),
                    ),
                  ),

                // Bottom Panel: Time Slider + Route Summary
                Positioned(
                  bottom: 16,
                  left: 16,
                  right: 16,
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.cardDark.withOpacity(0.96),
                      borderRadius: BorderRadius.circular(18),
                      boxShadow: const [
                        BoxShadow(color: Colors.black54, blurRadius: 12, spreadRadius: 3),
                      ],
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Time Slider Controls
                        if (_routePoints.length > 1) ...[
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'Time: ${DateFormat('hh:mm:ss a').format(_routePoints[_sliderIndex].timestamp)}',
                                style: const TextStyle(color: Colors.cyanAccent, fontWeight: FontWeight.bold, fontSize: 12),
                              ),
                              Text(
                                'Point ${_sliderIndex + 1}/${_routePoints.length}',
                                style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                              ),
                            ],
                          ),
                          SliderTheme(
                            data: SliderTheme.of(context).copyWith(
                              activeTrackColor: Colors.cyanAccent,
                              thumbColor: Colors.cyanAccent,
                              inactiveTrackColor: Colors.white24,
                              trackHeight: 3.5,
                            ),
                            child: Slider(
                              value: _sliderIndex.toDouble(),
                              min: 0,
                              max: (_routePoints.length - 1).toDouble(),
                              divisions: _routePoints.length > 1 ? _routePoints.length - 1 : 1,
                              onChanged: (val) {
                                final newIdx = val.toInt();
                                setState(() => _sliderIndex = newIdx);
                                final pt = _routePoints[newIdx];
                                _mapController.move(LatLng(pt.latitude, pt.longitude), 15.0);
                              },
                            ),
                          ),
                        ],

                        // Distance and Points Summary Row
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.route, color: AppColors.info, size: 20),
                                const SizedBox(width: 8),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '${totalDistance.toStringAsFixed(2)} km Traveled',
                                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                                    ),
                                    Text(
                                      '${_routePoints.length} Points Logged',
                                      style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            if (_routePoints.any((p) => p.isMocked))
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.deepOrange.withOpacity(0.2),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  '⚠️ ${_routePoints.where((p) => p.isMocked).length} Mock',
                                  style: const TextStyle(color: Colors.deepOrange, fontWeight: FontWeight.bold, fontSize: 11),
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
          ),
        ],
      ),
    );
  }
}
