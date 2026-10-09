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
import '../../core/services/outbox_service.dart';
import '../../core/services/permission_service.dart';
import 'permissions_screen.dart';
import '../../models/attendance_model.dart';
import '../../models/user_model.dart';
import 'profile_screen.dart';
import '../admin/admin_employee_attendance_screen.dart';

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

  File? _lostSelfieFile;

  @override
  void initState() {
    super.initState();
    SyncService().init();
    _loadInitialData();
    _setupGpsMonitoring();
    _checkLostImageData();
  }

  Future<void> _checkLostImageData() async {
    try {
      final LostDataResponse response = await _picker.retrieveLostData();
      if (response.isEmpty) return;
      if (response.file != null) {
        _lostSelfieFile = File(response.file!.path);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              backgroundColor: AppColors.info,
              content: Text('Restored previously captured selfie from camera.'),
            ),
          );
        }
      }
    } catch (e) {
      debugPrint('retrieveLostData error: $e');
    }
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
    final diff = DateTime.now().difference(_activeAttendance!.checkInTime.toLocal());
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

    // 1. Acquire GPS position with time limit, fresh last-known check, and specific errors
    AttendanceGpsResult gpsResult;
    try {
      gpsResult = await _locationService.getAttendancePosition(isCheckOut: !isCheckIn);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.error,
            content: Text(e.toString()),
          ),
        );
      }
      return;
    }

    // 2. Open front-facing camera for Selfie capture with retry loop ("Retake" reopens camera)
    File? confirmedSelfieFile;
    File? candidateFile = _lostSelfieFile;
    _lostSelfieFile = null;

    try {
      while (confirmedSelfieFile == null) {
        if (candidateFile == null) {
          final XFile? photo = await _picker.pickImage(
            source: ImageSource.camera,
            preferredCameraDevice: CameraDevice.front,
            maxWidth: 1280, // Client sends max 1280px at quality 85 (no double heavy compression)
            maxHeight: 1280,
            imageQuality: 85,
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
          candidateFile = File(photo.path);
        }

        final sizeKb = (candidateFile.lengthSync() / 1024).toStringAsFixed(1);

        // 3. Confirm selfie with coordinate & compressed size preview dialog
        if (!mounted) return;
        final dialogChoice = await _showSelfieConfirmationDialog(
          selfie: candidateFile,
          lat: gpsResult.position.latitude,
          lng: gpsResult.position.longitude,
          accuracy: gpsResult.position.accuracy,
          isCheckIn: isCheckIn,
          sizeKb: sizeKb,
          isLowAccuracy: gpsResult.isLowAccuracy,
          isMocked: gpsResult.isMocked,
        );

        if (dialogChoice == 'confirm') {
          confirmedSelfieFile = candidateFile;
        } else if (dialogChoice == 'retake') {
          // Re-trigger camera capture immediately
          candidateFile = null;
          continue;
        } else {
          // User dismissed or cancelled
          return;
        }
      }

      // 4. Submit to API with is_mocked and accuracy
      setState(() => _isActionLoading = true);

      if (isCheckIn) {
        try {
          final newRecord = await ApiService().checkIn(
            latitude: gpsResult.position.latitude,
            longitude: gpsResult.position.longitude,
            accuracy: gpsResult.position.accuracy,
            isMocked: gpsResult.isMocked,
            selfieFile: confirmedSelfieFile,
          );

          setState(() {
            _activeAttendance = newRecord;
          });

          _startWorkTimer();
          _locationService.startContinuousTracking();
          await BackgroundTrackerService.startTracking();

          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                backgroundColor: gpsResult.isMocked ? AppColors.warning : AppColors.success,
                content: Text(
                  gpsResult.isMocked
                      ? '⚠️ Checked in (Flagged: Mock Location detected). Continuous tracking active.'
                      : '✅ Checked In successfully! GPS Tracking Active.',
                ),
              ),
            );
          }
        } catch (apiErr) {
          final errStr = apiErr.toString();
          if (errStr.contains("reach the server") || errStr.contains("timed out") || errStr.contains("SocketException")) {
            await OutboxService().enqueueSelfieAction(
              actionType: 'check_in',
              selfiePath: confirmedSelfieFile.path,
              latitude: gpsResult.position.latitude,
              longitude: gpsResult.position.longitude,
              accuracy: gpsResult.position.accuracy,
              isMocked: gpsResult.isMocked,
            );
            _locationService.startContinuousTracking();
            await BackgroundTrackerService.startTracking();
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  backgroundColor: AppColors.warning,
                  content: Text('Offline: Check-in selfie queued locally. Tracking active; will sync on reconnect.'),
                ),
              );
            }
          } else {
            rethrow;
          }
        }
      } else {
        try {
          await ApiService().checkOut(
            latitude: gpsResult.position.latitude,
            longitude: gpsResult.position.longitude,
            accuracy: gpsResult.position.accuracy,
            isMocked: gpsResult.isMocked,
            selfieFile: confirmedSelfieFile,
          );

          setState(() {
            _activeAttendance = null;
          });

          _stopWorkTimer();
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
        } catch (apiErr) {
          final errStr = apiErr.toString();
          if (errStr.contains("reach the server") || errStr.contains("timed out") || errStr.contains("SocketException")) {
            await OutboxService().enqueueSelfieAction(
              actionType: 'check_out',
              selfiePath: confirmedSelfieFile.path,
              latitude: gpsResult.position.latitude,
              longitude: gpsResult.position.longitude,
              accuracy: gpsResult.position.accuracy,
              isMocked: gpsResult.isMocked,
            );
            setState(() {
              _activeAttendance = null;
            });
            _stopWorkTimer();
            _locationService.stopContinuousTracking();
            await BackgroundTrackerService.stopTracking();
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  backgroundColor: AppColors.warning,
                  content: Text('Offline: Check-out queued locally. Will sync automatically upon reconnect.'),
                ),
              );
            }
          } else {
            rethrow;
          }
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

  Future<String?> _showSelfieConfirmationDialog({
    required File selfie,
    required double lat,
    required double lng,
    required double accuracy,
    required bool isCheckIn,
    required String sizeKb,
    required bool isLowAccuracy,
    required bool isMocked,
  }) async {
    return await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text(
          isCheckIn ? 'Confirm Check-In Selfie' : 'Confirm Check-Out Selfie',
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18),
        ),
        content: SingleChildScrollView(
          child: Column(
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
                            'GPS: ${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)} (±${accuracy.toStringAsFixed(0)}m)',
                            style: const TextStyle(color: Colors.white70, fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                    if (isLowAccuracy) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Icon(Icons.info_outline, color: AppColors.warning, size: 16),
                          const SizedBox(width: 6),
                          const Expanded(
                            child: Text(
                              'Low accuracy fix (flagged on server)',
                              style: TextStyle(color: AppColors.warning, fontSize: 11),
                            ),
                          ),
                        ],
                      ),
                    ],
                    if (isMocked) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Icon(Icons.warning, color: AppColors.error, size: 16),
                          const SizedBox(width: 6),
                          const Expanded(
                            child: Text(
                              'Mock / Fake GPS detected (flagged for admin)',
                              style: TextStyle(color: AppColors.error, fontSize: 11, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(Icons.photo_camera_outlined, color: AppColors.info, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Client Photo: $sizeKb KB (Compressed on GCP)',
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
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, 'retake'),
            child: const Text('Retake', style: TextStyle(color: AppColors.textMuted)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: isCheckIn ? AppColors.success : AppColors.error,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () => Navigator.pop(ctx, 'confirm'),
            child: Text(
              isCheckIn ? 'Submit Check-In' : 'Submit Check-Out',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
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
                                            ? 'Checked In: ${DateFormat('hh:mm a').format(_activeAttendance!.checkInTime.toLocal())}'
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

                        if (ApiService().currentUser?.isAdmin ?? false) ...[
                          const SizedBox(height: 25),
                          const Text(
                            'Admin Management Console',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 14),
                          Container(
                            decoration: BoxDecoration(
                              color: AppColors.cardDark,
                              borderRadius: BorderRadius.circular(18),
                              border: Border.all(color: AppColors.info.withValues(alpha: 0.35)),
                            ),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(18),
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => const AdminEmployeeAttendanceScreen(),
                                  ),
                                );
                              },
                              child: const Padding(
                                padding: EdgeInsets.all(16),
                                child: Row(
                                  children: [
                                    CircleAvatar(
                                      radius: 22,
                                      backgroundColor: Color(0x332196F3),
                                      child: Icon(Icons.photo_library_outlined, color: AppColors.info, size: 24),
                                    ),
                                    SizedBox(width: 14),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            'Employee Attendance & Selfies Archive',
                                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                                          ),
                                          SizedBox(height: 3),
                                          Text(
                                            'View past attendance records, check-in/out selfies & verification details for any employee',
                                            style: TextStyle(color: AppColors.textDim, fontSize: 11.5),
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
                        ],

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

                        const SizedBox(height: 15),
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
