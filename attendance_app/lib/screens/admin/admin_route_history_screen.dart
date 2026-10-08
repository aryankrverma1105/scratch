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

  @override
  Widget build(BuildContext context) {
    final polylineCoords = _routePoints.map((p) => LatLng(p.latitude, p.longitude)).toList();
    final markers = <Marker>[];

    if (_routePoints.isNotEmpty) {
      // Start Marker (Green)
      markers.add(
        Marker(
          point: LatLng(_routePoints.first.latitude, _routePoints.first.longitude),
          width: 40,
          height: 40,
          child: Container(
            decoration: const BoxDecoration(color: AppColors.success, shape: BoxShape.circle),
            child: const Icon(Icons.play_arrow, color: Colors.white, size: 24),
          ),
        ),
      );

      // End Marker (Red)
      if (_routePoints.length > 1) {
        markers.add(
          Marker(
            point: LatLng(_routePoints.last.latitude, _routePoints.last.longitude),
            width: 40,
            height: 40,
            child: Container(
              decoration: const BoxDecoration(color: AppColors.error, shape: BoxShape.circle),
              child: const Icon(Icons.stop, color: Colors.white, size: 24),
            ),
          ),
        );
      }
    }

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
                            setState(() => _selectedUserId = val);
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

          // Map View with Polyline
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
                      userAgentPackageName: 'com.company.attendance.attendance_app',
                    ),
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
                  const Center(child: CircularProgressIndicator(color: Colors.white)),

                // Route summary badge
                Positioned(
                  bottom: 20,
                  left: 20,
                  right: 20,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                    decoration: BoxDecoration(
                      color: AppColors.cardDark.withOpacity(0.95),
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: const [
                        BoxShadow(color: Colors.black45, blurRadius: 10, spreadRadius: 2),
                      ],
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.timeline, color: AppColors.info, size: 22),
                            const SizedBox(width: 10),
                            Text(
                              '${_routePoints.length} GPS Trail Points Logged',
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                            ),
                          ],
                        ),
                        if (_routePoints.isEmpty)
                          const Text('No movement', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
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
