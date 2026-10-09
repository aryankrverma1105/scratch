import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/permission_service.dart';

class PermissionsScreen extends StatefulWidget {
  final VoidCallback? onCompleted;

  const PermissionsScreen({super.key, this.onCompleted});

  @override
  State<PermissionsScreen> createState() => _PermissionsScreenState();
}

class _PermissionsScreenState extends State<PermissionsScreen> with WidgetsBindingObserver {
  PermissionStatusResult? _status;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refreshPermissions();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshPermissions();
    }
  }

  Future<void> _refreshPermissions() async {
    setState(() => _isLoading = true);
    final res = await PermissionService.checkAllPermissions();
    if (!mounted) return;
    setState(() {
      _status = res;
      _isLoading = false;
    });
  }

  Future<void> _requestNotification() async {
    await PermissionService.requestNotificationPermission();
    await _refreshPermissions();
  }

  Future<void> _requestLocation() async {
    await PermissionService.requestForegroundLocation();
    await _refreshPermissions();
  }

  Future<void> _requestBackgroundLocation() async {
    final granted = await PermissionService.requestBackgroundLocation();
    await _refreshPermissions();
    if (!mounted) return;

    if (!granted) {
      _showBackgroundLocationGuidance();
    }
  }

  void _showBackgroundLocationGuidance() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.cardDark,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(25)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.location_on, color: AppColors.info, size: 28),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Set "Allow all the time"',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: AppColors.textMuted),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Text(
              'Android 11+ and brands like Realme, Xiaomi, Vivo, Oppo & Samsung require background location to be set in device settings to prevent tracking stoppage when the phone is locked:',
              style: TextStyle(color: AppColors.textDim, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.surfaceDark,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.white12),
              ),
              child: Column(
                children: [
                  _buildStepRow(
                    stepNumber: '1',
                    text: 'Tap "Open App Settings" below',
                  ),
                  const SizedBox(height: 12),
                  _buildStepRow(
                    stepNumber: '2',
                    text: 'Tap "Permissions" > "Location"',
                  ),
                  const SizedBox(height: 12),
                  _buildStepRow(
                    stepNumber: '3',
                    text: 'Select "Allow all the time"',
                    highlight: true,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton.icon(
                icon: const Icon(Icons.settings, color: Colors.white),
                label: const Text(
                  'Open App Settings',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.info,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () {
                  Navigator.pop(ctx);
                  PermissionService.openAppSettings();
                },
              ),
            ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }

  Widget _buildStepRow({required String stepNumber, required String text, bool highlight = false}) {
    return Row(
      children: [
        Container(
          width: 24,
          height: 24,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: highlight ? AppColors.success : AppColors.info.withValues(alpha: 0.2),
            shape: BoxShape.circle,
          ),
          child: Text(
            stepNumber,
            style: TextStyle(
              color: highlight ? Colors.black : AppColors.info,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              color: highlight ? AppColors.success : Colors.white,
              fontSize: 13,
              fontWeight: highlight ? FontWeight.bold : FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }

  void _showBatteryHelpDialog() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.cardDark,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(25)),
      ),
      builder: (ctx) => SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.battery_alert, color: AppColors.warning, size: 28),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Device Battery & Auto-Start Setup',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: AppColors.textMuted),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Text(
              'To prevent your phone from killing shift tracking when screen is locked or app is minimized, follow instructions for your brand:',
              style: TextStyle(color: AppColors.textDim, fontSize: 13),
            ),
            const SizedBox(height: 20),

            _buildOemTile(
              'Xiaomi / Redmi / POCO (MIUI / HyperOS)',
              '1. Settings > Apps > Manage Apps > Sologix Energy.\n'
              '2. Enable "Autostart".\n'
              '3. Under Battery Saver, select "No restrictions".\n'
              '4. In Recent Apps screen, lock Sologix Energy with the padlock icon.',
            ),
            _buildOemTile(
              'Realme / Oppo / OnePlus (ColorOS / OxygenOS)',
              '1. Long press app icon > App info > Battery.\n'
              '2. Turn ON "Allow background activity" & "Allow auto-launch".\n'
              '3. Set Battery optimization to "Don\'t optimize".',
            ),
            _buildOemTile(
              'Vivo / iQOO (FuntouchOS / OriginOS)',
              '1. Settings > Battery > High background power consumption > Enable Sologix Energy.\n'
              '2. Settings > Applications > Autostart > Enable Sologix Energy.',
            ),
            _buildOemTile(
              'Samsung (One UI)',
              '1. Settings > Apps > Sologix Energy > Battery > Select "Unrestricted".\n'
              '2. Device care > Battery > Background usage limits > Never sleeping apps > Add Sologix Energy.',
            ),
            _buildOemTile(
              'Stock Android / Pixel / Motorola',
              '1. Settings > Apps > Sologix Energy > App battery usage > Select "Unrestricted".',
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton.icon(
                icon: const Icon(Icons.settings, color: Colors.black),
                label: const Text(
                  'Open System Settings',
                  style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () {
                  PermissionService.openAppSettings();
                  Navigator.pop(ctx);
                },
              ),
            ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }

  Widget _buildOemTile(String title, String instructions) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            instructions,
            style: const TextStyle(
              color: AppColors.textDim,
              fontSize: 12.5,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    final isReady = status?.isReadyForCheckIn ?? false;
    final isFullyCompliant = status?.isFullyCompliant ?? false;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Tracking Permissions'),
        elevation: 0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Colors.white))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.cardDark,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.info.withValues(alpha: 0.3)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.shield_outlined, color: AppColors.info, size: 36),
                        const SizedBox(width: 14),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Continuous Duty Tracking',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                'Sologix Energy requires background location and notifications to track field attendance while phone is locked.',
                                style: TextStyle(color: AppColors.textMuted, fontSize: 12.5),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 24),
                  const Text(
                    'PERMISSION CHECKLIST',
                    style: TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 12),

                  // 1. Notification Permission
                  _buildPermissionCard(
                    title: 'System Notifications',
                    subtitle: 'Required to show shift status and GPS disconnect alerts.',
                    isGranted: status?.hasNotification ?? false,
                    actionLabel: 'Allow Notifications',
                    onAction: _requestNotification,
                  ),

                  // 2. Foreground Location
                  _buildPermissionCard(
                    title: 'GPS Location (In Use)',
                    subtitle: 'Required to capture coordinates during check-in/out.',
                    isGranted: status?.hasForegroundLocation ?? false,
                    actionLabel: 'Allow Location',
                    onAction: _requestLocation,
                  ),

                  // 3. Background Location (Allow all the time)
                  _buildPermissionCard(
                    title: 'Background Location ("Allow all the time")',
                    subtitle: 'Allows continuous GPS breadcrumbs while phone is minimized or locked.',
                    isGranted: status?.hasBackgroundLocation ?? false,
                    actionLabel: 'Set "Allow all the time"',
                    onAction: _requestBackgroundLocation,
                  ),

                  // 4. GPS Hardware Switch
                  _buildPermissionCard(
                    title: 'Device GPS Hardware',
                    subtitle: 'Phone location must be turned ON in quick settings.',
                    isGranted: status?.isGpsEnabled ?? false,
                    actionLabel: 'Turn ON GPS',
                    onAction: () async {
                      await PermissionService.openLocationSettings();
                    },
                  ),

                  const SizedBox(height: 16),

                  // Battery Optimization Helper
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceDark,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.white12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.battery_charging_full, color: AppColors.warning, size: 22),
                            SizedBox(width: 8),
                            Text(
                              'Battery Optimization',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 15,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'Xiaomi, Realme, Vivo, Oppo & Samsung phones close background apps by default. Configure auto-start to keep tracking active.',
                          style: TextStyle(color: AppColors.textDim, fontSize: 12.5),
                        ),
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                          icon: const Icon(Icons.info_outline, size: 16),
                          label: const Text('View Brand-Specific Setup Guide'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.white,
                            side: const BorderSide(color: Colors.white24),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                          onPressed: _showBatteryHelpDialog,
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 30),

                  // Continue / Finish Button
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: isReady ? Colors.white : Colors.white24,
                        foregroundColor: Colors.black,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
                      ),
                      onPressed: isReady
                          ? () {
                              if (widget.onCompleted != null) {
                                widget.onCompleted!();
                              } else {
                                Navigator.pop(context, true);
                              }
                            }
                          : () {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  backgroundColor: AppColors.warning,
                                  content: Text(
                                    'Please enable at least Location permissions and GPS to continue.',
                                  ),
                                ),
                              );
                            },
                      child: Text(
                        isFullyCompliant ? 'All Permissions Configured - Done' : 'Continue to Attendance',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: isReady ? Colors.black : Colors.white60,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildPermissionCard({
    required String title,
    required String subtitle,
    required bool isGranted,
    required String actionLabel,
    required VoidCallback onAction,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isGranted ? AppColors.success.withValues(alpha: 0.3) : Colors.white12,
        ),
      ),
      child: Row(
        children: [
          Icon(
            isGranted ? Icons.check_circle : Icons.radio_button_unchecked,
            color: isGranted ? AppColors.success : AppColors.textMuted,
            size: 24,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: AppColors.textDim,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          if (!isGranted)
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.info,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
              ),
              onPressed: onAction,
              child: Text(actionLabel),
            ),
        ],
      ),
    );
  }
}
