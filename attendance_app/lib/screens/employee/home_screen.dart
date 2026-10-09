import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../core/services/location_service.dart';
import '../../core/services/background_tracker.dart';
import '../../core/services/sync_service.dart';
import '../../core/services/permission_service.dart';
import 'permissions_screen.dart';
import '../../models/attendance_model.dart';
import '../../models/user_model.dart';
import 'profile_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final LocationService _locationService = LocationService();
  final ImagePicker _picker = ImagePicker();

  UserModel? _user;
  AttendanceRecord? _activeAttendance;
  bool _isLoading = true;
  bool _isActionLoading = false;
  Timer? _workTimer;
  String _workingDurationText = '00:00:00';

  @override
  void initState() {
    super.initState();
    SyncService().init();
    _loadInitialData();
    _setupGpsMonitoring();
  }

  void _setupGpsMonitoring() {
    _locationService.initGpsMonitoring(onStatusChanged: (isEnabled) {
      if (mounted) {
        setState(() {});
        if (!isEnabled && _activeAttendance != null) {
          _showGpsDisabledDialog();
        }
      }
    });
  }

  void _showGpsDisabledDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppColors.error, size: 28),
            SizedBox(width: 8),
            Text('GPS Turned Off!', style: TextStyle(color: Colors.white, fontSize: 18)),
          ],
        ),
        content: const Text(
          'Your device GPS / Location is turned OFF while on active duty. Continuous tracking is required by company policy. An alert has been recorded for the administrator.\n\nPlease turn GPS back ON immediately.',
          style: TextStyle(color: AppColors.textDim, fontSize: 14),
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () => Navigator.pop(ctx),
            child: const Text('I Understand', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  Future<void> _loadInitialData() async {
    setState(() => _isLoading = true);
    try {
      _user = ApiService().currentUser ?? await ApiService().getProfile();
      final status = await ApiService().getCurrentAttendanceStatus();
      if (status['activeAttendance'] != null) {
        _activeAttendance = AttendanceRecord.fromJson(status['activeAttendance']);
        _startWorkTimer();
        // Resume continuous and background tracking if active
        _locationService.startContinuousTracking();
        BackgroundTrackerService.startTracking();
      } else {
        _activeAttendance = null;
        _stopWorkTimer();
      }
    } catch (e) {
      debugPrint('Error loading initial data: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _startWorkTimer() {
    _workTimer?.cancel();
    if (_activeAttendance == null) return;

    _updateWorkDuration();
    _workTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) _updateWorkDuration();
    });
  }

  void _updateWorkDuration() {
    if (_activeAttendance == null) return;
    final diff = DateTime.now().difference(_activeAttendance!.checkInTime);
    final hours = diff.inHours.toString().padLeft(2, '0');
    final minutes = (diff.inMinutes % 60).toString().padLeft(2, '0');
    final seconds = (diff.inSeconds % 60).toString().padLeft(2, '0');
    setState(() {
      _workingDurationText = '$hours:$minutes:$seconds';
    });
  }

  void _stopWorkTimer() {
    _workTimer?.cancel();
    _workTimer = null;
    _workingDurationText = '00:00:00';
  }

  @override
  void dispose() {
    _workTimer?.cancel();
    super.dispose();
  }

  // --- Selfie Capture & Attendance Action ---

  Future<void> _handleAttendanceAction(bool isCheckIn) async {
    // 0. Verify required tracking permissions
    final permStatus = await PermissionService.checkAllPermissions();
    if (!permStatus.isReadyForCheckIn) {
      if (!mounted) return;
      final granted = await Navigator.push<bool>(
        context,
        MaterialPageRoute(builder: (_) => const PermissionsScreen()),
      );
      if (granted != true) {
        final recheck = await PermissionService.checkAllPermissions();
        if (!recheck.isReadyForCheckIn) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                backgroundColor: AppColors.error,
                content: Text('Location permissions and GPS are required for duty attendance.'),
              ),
            );
          }
          return;
        }
      }
    }

    // 1. Verify and request GPS location
    final position = await _locationService.getCurrentPosition();
    if (position == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppColors.error,
            content: Text('Please enable GPS / Location permissions to continue.'),
          ),
        );
      }
      return;
    }

    // 2. Open front-facing camera for Selfie capture with space-saving compression
    try {
      final XFile? photo = await _picker.pickImage(
        source: ImageSource.camera,
        preferredCameraDevice: CameraDevice.front,
        maxWidth: 600, // Compact resolution saves 95%+ space
        maxHeight: 600,
        imageQuality: 65, // Highly optimized JPEG quality
      );

      if (photo == null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              backgroundColor: AppColors.warning,
              content: Text('Selfie capture was cancelled. Attendance not recorded.'),
            ),
          );
        }
        return;
      }

      final selfieFile = File(photo.path);
      final sizeKb = (selfieFile.lengthSync() / 1024).toStringAsFixed(1);

      // 3. Confirm selfie with coordinate & compressed size preview dialog
      if (!mounted) return;
      final confirmed = await _showSelfieConfirmationDialog(
        selfieFile,
        position.latitude,
        position.longitude,
        isCheckIn,
        sizeKb,
      );
      if (!confirmed) return;

      // 4. Submit to API
      setState(() => _isActionLoading = true);

      if (isCheckIn) {
        final newRecord = await ApiService().checkIn(
          latitude: position.latitude,
          longitude: position.longitude,
          selfieFile: selfieFile,
        );

        setState(() {
          _activeAttendance = newRecord;
        });

        _startWorkTimer();
        // Start continuous GPS tracking (Requirement 8 & 10)
        _locationService.startContinuousTracking();
        await BackgroundTrackerService.startTracking();

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              backgroundColor: AppColors.success,
              content: Text('✅ Checked In successfully! GPS Tracking Active.'),
            ),
          );
        }
      } else {
        await ApiService().checkOut(
          latitude: position.latitude,
          longitude: position.longitude,
          selfieFile: selfieFile,
        );

        setState(() {
          _activeAttendance = null;
        });

        _stopWorkTimer();
        // Stop continuous tracking (Requirement 9)
        _locationService.stopContinuousTracking();
        await BackgroundTrackerService.stopTracking();

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              backgroundColor: AppColors.info,
              content: Text('🏁 Checked Out successfully! GPS Tracking Stopped.'),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.error,
            content: Text(e.toString().replaceFirst('Exception: ', '')),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isActionLoading = false);
    }
  }

  Future<bool> _showSelfieConfirmationDialog(
    File selfie,
    double lat,
    double lng,
    bool isCheckIn,
    String sizeKb,
  ) async {
    return await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (ctx) => AlertDialog(
            backgroundColor: AppColors.cardDark,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: Text(
              isCheckIn ? 'Confirm Check-In Selfie' : 'Confirm Check-Out Selfie',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: Image.file(
                    selfie,
                    width: 200,
                    height: 200,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.inputDark,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.location_on, color: AppColors.success, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'GPS: ${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)}',
                              style: const TextStyle(color: Colors.white70, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Icon(Icons.cloud_done_outlined, color: AppColors.info, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Selfie Size: $sizeKb KB (Optimized for GCP)',
                              style: const TextStyle(color: Colors.white70, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Retake', style: TextStyle(color: AppColors.textMuted)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: isCheckIn ? AppColors.success : AppColors.error,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(
                  isCheckIn ? 'Submit Check-In' : 'Submit Check-Out',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
        ) ??
        false;
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        backgroundColor: AppColors.background,
        body: Center(child: CircularProgressIndicator(color: Colors.white)),
      );
    }

    final isCheckedIn = _activeAttendance != null;
    final userName = _user?.fullName ?? 'Employee';
    final userDept = _user?.department ?? 'Operations';

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
              // Header
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 15),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: Image.asset(
                              'assets/images/logo.png',
                              fit: BoxFit.contain,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Sologix Energy',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                            Text(
                              DateFormat('EEEE, MMM d').format(DateTime.now()),
                              style: const TextStyle(
                                fontSize: 13,
                                color: AppColors.textMuted,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                    Row(
                      children: [
                        GestureDetector(
                          onTap: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const ProfileScreen()),
                            );
                          },
                          child: Container(
                            width: 46,
                            height: 46,
                            decoration: const BoxDecoration(
                              color: AppColors.inputDark,
                              shape: BoxShape.circle,
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black54,
                                  blurRadius: 8,
                                  spreadRadius: 1,
                                ),
                              ],
                            ),
                            child: const Icon(Icons.person, color: Colors.white, size: 24),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // Main Scrollable Area
              Expanded(
                child: Container(
                  margin: const EdgeInsets.only(top: 10),
                  decoration: const BoxDecoration(
                    color: AppColors.background,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(30),
                      topRight: Radius.circular(30),
                    ),
                  ),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Live GCP Cloud Sync Indicator Bar
                        ValueListenableBuilder<SyncStatus>(
                          valueListenable: SyncService().statusNotifier,
                          builder: (context, sync, child) {
                            final isSyncing = sync.isSyncing;
                            final isOnline = sync.isOnline;
                            final pending = sync.pendingLocationsCount;

                            Color statusColor = isSyncing
                                ? AppColors.info
                                : (!isOnline
                                    ? AppColors.warning
                                    : (pending > 0 ? AppColors.warning : AppColors.success));

                            String statusLabel = isSyncing
                                ? 'Synchronizing with GCP Cloud...'
                                : (!isOnline
                                    ? 'Offline (Will sync when reconnected)'
                                    : (pending > 0
                                        ? '$pending offline points waiting to sync'
                                        : 'GCP Cloud Synchronized'));

                            return GestureDetector(
                              onTap: () async {
                                final ok = await SyncService().syncNow();
                                _loadInitialData();
                                if (mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      backgroundColor: ok ? AppColors.success : AppColors.warning,
                                      content: Text(ok ? '✅ Sync complete with GCP VM' : '⚠️ Server probe failed. Check VM status.'),
                                      duration: const Duration(seconds: 2),
                                    ),
                                  );
                                }
                              },
                              child: Container(
                                margin: const EdgeInsets.only(bottom: 16),
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                decoration: BoxDecoration(
                                  color: AppColors.cardDark,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: statusColor.withValues(alpha: 0.4), width: 1),
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Row(
                                      children: [
                                        if (isSyncing)
                                          SizedBox(
                                            width: 12,
                                            height: 12,
                                            child: CircularProgressIndicator(strokeWidth: 2, color: statusColor),
                                          )
                                        else
                                          Container(
                                            width: 8,
                                            height: 8,
                                            decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle),
                                          ),
                                        const SizedBox(width: 10),
                                        Text(
                                          statusLabel,
                                          style: TextStyle(
                                            color: Colors.white.withValues(alpha: 0.9),
                                            fontSize: 12,
                                            fontWeight: FontWeight.w500,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const Row(
                                      children: [
                                        Icon(Icons.sync, color: AppColors.textMuted, size: 16),
                                        SizedBox(width: 4),
                                        Text('Sync', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),

                        // GPS Status Warning Banner if disabled (Requirement 14 & 15)
                        ValueListenableBuilder<bool>(
                          valueListenable: _locationService.isGpsEnabledNotifier,
                          builder: (context, isEnabled, child) {
                            if (isEnabled) return const SizedBox.shrink();
                            return Container(
                              margin: const EdgeInsets.only(bottom: 20),
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: AppColors.error.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: AppColors.error),
                              ),
                              child: Row(
                                children: [
                                  const Icon(Icons.location_off, color: AppColors.error, size: 28),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        const Text(
                                          'LOCATION TURNED OFF!',
                                          style: TextStyle(
                                            color: AppColors.error,
                                            fontWeight: FontWeight.bold,
                                            fontSize: 14,
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          'Turn GPS on now. Tracking is required during shift.',
                                          style: TextStyle(
                                            color: Colors.white.withOpacity(0.85),
                                            fontSize: 12,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),

                        // User Info Card
                        Container(
                          padding: const EdgeInsets.all(20),
                          decoration: BoxDecoration(
                            color: AppColors.cardDark,
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: const [
                              BoxShadow(
                                color: Colors.black45,
                                blurRadius: 10,
                                spreadRadius: 2,
                              ),
                            ],
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 55,
                                height: 55,
                                decoration: const BoxDecoration(
                                  gradient: LinearGradient(colors: AppColors.cardGradient),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(Icons.person, color: Colors.white, size: 30),
                              ),
                              const SizedBox(width: 15),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      userName,
                                      style: const TextStyle(
                                        fontSize: 17,
                                        fontWeight: FontWeight.bold,
                                        color: Colors.white,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      userDept,
                                      style: const TextStyle(
                                        fontSize: 13,
                                        color: AppColors.textMuted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                decoration: BoxDecoration(
                                  color: AppColors.inputDark,
                                  borderRadius: BorderRadius.circular(20),
                                  border: Border.all(
                                    color: isCheckedIn ? AppColors.success : AppColors.textMuted,
                                  ),
                                ),
                                child: Text(
                                  isCheckedIn ? 'Checked In' : 'Checked Out',
                                  style: TextStyle(
                                    color: isCheckedIn ? AppColors.success : AppColors.textMuted,
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(height: 22),

                        // Check In / Out Main Card
                        Container(
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: isCheckedIn ? AppColors.activeGradient : AppColors.cardGradient,
                            ),
                            borderRadius: BorderRadius.circular(22),
                            boxShadow: const [
                              BoxShadow(
                                color: Colors.black45,
                                blurRadius: 15,
                                spreadRadius: 3,
                              ),
                            ],
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        isCheckedIn ? 'Duty in Progress' : 'Ready to Start Duty?',
                                        style: const TextStyle(
                                          fontSize: 20,
                                          fontWeight: FontWeight.bold,
                                          color: Colors.white,
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        isCheckedIn
                                            ? 'Checked In: ${DateFormat('hh:mm a').format(_activeAttendance!.checkInTime)}'
                                            : 'Continuous GPS Tracking begins upon Check-In',
                                        style: const TextStyle(
                                          fontSize: 13,
                                          color: Colors.white70,
                                        ),
                                      ),
                                    ],
                                  ),
                                  Container(
                                    width: 55,
                                    height: 55,
                                    decoration: BoxDecoration(
                                      color: Colors.white.withOpacity(0.12),
                                      shape: BoxShape.circle,
                                    ),
                                    child: Icon(
                                      isCheckedIn ? Icons.timer_outlined : Icons.touch_app_outlined,
                                      color: Colors.white,
                                      size: 28,
                                    ),
                                  ),
                                ],
                              ),

                              if (isCheckedIn) ...[
                                const SizedBox(height: 20),
                                Center(
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                                    decoration: BoxDecoration(
                                      color: Colors.black26,
                                      borderRadius: BorderRadius.circular(15),
                                    ),
                                    child: Text(
                                      _workingDurationText,
                                      style: const TextStyle(
                                        fontSize: 28,
                                        fontWeight: FontWeight.bold,
                                        color: Colors.white,
                                        letterSpacing: 2,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                const Center(
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.gps_fixed, color: Colors.white70, size: 14),
                                      SizedBox(width: 6),
                                      Text(
                                        'Background tracking active (Screen on / locked)',
                                        style: TextStyle(color: Colors.white70, fontSize: 11),
                                      ),
                                    ],
                                  ),
                                ),
                              ],

                              const SizedBox(height: 24),

                              // Interactive Action Button
                              SizedBox(
                                width: double.infinity,
                                height: 52,
                                child: ElevatedButton.icon(
                                  onPressed: _isActionLoading ? null : () => _handleAttendanceAction(!isCheckedIn),
                                  icon: _isActionLoading
                                      ? const SizedBox.shrink()
                                      : Icon(
                                          isCheckedIn ? Icons.logout : Icons.login,
                                          color: isCheckedIn ? Colors.white : Colors.black,
                                        ),
                                  label: _isActionLoading
                                      ? const SizedBox(
                                          width: 22,
                                          height: 22,
                                          child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                                        )
                                      : Text(
                                          isCheckedIn ? 'Check Out & Stop Tracking' : 'Selfie Check-In & Start Tracking',
                                          style: TextStyle(
                                            fontSize: 15,
                                            fontWeight: FontWeight.bold,
                                            color: isCheckedIn ? Colors.white : Colors.black,
                                          ),
                                        ),
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: isCheckedIn ? AppColors.error : Colors.white,
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(16),
                                    ),
                                    elevation: 2,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(height: 25),

                        // System Features Info Grid
                        const Text(
                          'Attendance Protocols',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 14),

                        Row(
                          children: [
                            Expanded(
                              child: _buildInfoCard(
                                icon: Icons.camera_alt_outlined,
                                title: 'Selfie Verified',
                                subtitle: 'Front camera required on every check',
                              ),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: _buildInfoCard(
                                icon: Icons.share_location,
                                title: 'Continuous GPS',
                                subtitle: 'Runs in background while on duty',
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                              child: _buildInfoCard(
                                icon: Icons.lock_clock,
                                title: 'Screen Lock Safe',
                                subtitle: 'Logs location even when phone locked',
                              ),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: _buildInfoCard(
                                icon: Icons.security,
                                title: 'Anti-Tamper',
                                subtitle: 'Alerts manager if GPS turned off',
                              ),
                            ),
                          ],
                        ),

                        const SizedBox(height: 30),
                        Center(
                          child: Text(
                            'Designed and developed by aryan kumar verma',
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.white.withValues(alpha: 0.4),
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
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

  Widget _buildInfoCard({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Colors.white70, size: 24),
          const SizedBox(height: 10),
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}
