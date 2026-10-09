import 'dart:async';
import 'package:flutter/material.dart';
import '../core/constants/app_colors.dart';
import '../core/services/api_service.dart';
import 'employee/home_screen.dart';
import 'employee/activities_screen.dart';
import 'employee/profile_screen.dart';
import 'admin/admin_live_map_screen.dart';
import 'admin/admin_users_screen.dart';
import 'admin/admin_alerts_screen.dart';

class MainNavigation extends StatefulWidget {
  const MainNavigation({super.key});

  @override
  State<MainNavigation> createState() => _MainNavigationState();
}

class _MainNavigationState extends State<MainNavigation> {
  int _currentIndex = 0;
  int _unreadAlertsCount = 0;
  Timer? _alertBadgeTimer;

  @override
  void initState() {
    super.initState();
    _checkAlertsBadge();
    _alertBadgeTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      _checkAlertsBadge();
    });
  }

  @override
  void dispose() {
    _alertBadgeTimer?.cancel();
    super.dispose();
  }

  Future<void> _checkAlertsBadge() async {
    final user = ApiService().currentUser;
    if (user == null || !user.isAdmin) return;
    try {
      final alerts = await ApiService().adminGetAlerts();
      final openCount = alerts.where((a) => !a.resolved).length;
      if (mounted && openCount != _unreadAlertsCount) {
        setState(() => _unreadAlertsCount = openCount);
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final user = ApiService().currentUser;
    final isAdmin = user?.isAdmin ?? false;

    final List<Widget> screens = isAdmin
        ? [
            const HomeScreen(),
            const AdminLiveMapScreen(),
            const AdminUsersScreen(),
            const AdminAlertsScreen(),
            const ProfileScreen(),
          ]
        : [
            const HomeScreen(),
            const ActivitiesScreen(),
            const ProfileScreen(),
          ];

    final List<BottomNavigationBarItem> navItems = isAdmin
        ? [
            const BottomNavigationBarItem(
              icon: Icon(Icons.home_outlined),
              activeIcon: Icon(Icons.home),
              label: 'Home',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.map_outlined),
              activeIcon: Icon(Icons.map),
              label: 'Live Map',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.group_outlined),
              activeIcon: Icon(Icons.group),
              label: 'Team',
            ),
            BottomNavigationBarItem(
              icon: _unreadAlertsCount > 0
                  ? Badge.count(
                      count: _unreadAlertsCount,
                      backgroundColor: AppColors.error,
                      child: const Icon(Icons.warning_amber_outlined),
                    )
                  : const Icon(Icons.warning_amber_outlined),
              activeIcon: _unreadAlertsCount > 0
                  ? Badge.count(
                      count: _unreadAlertsCount,
                      backgroundColor: AppColors.error,
                      child: const Icon(Icons.warning_amber_rounded),
                    )
                  : const Icon(Icons.warning_amber_rounded),
              label: 'Alerts',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.person_outline),
              activeIcon: Icon(Icons.person),
              label: 'Profile',
            ),
          ]
        : const [
            BottomNavigationBarItem(
              icon: Icon(Icons.home_outlined),
              activeIcon: Icon(Icons.home),
              label: 'Home',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.calendar_today_outlined),
              activeIcon: Icon(Icons.calendar_today),
              label: 'Activities',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.person_outline),
              activeIcon: Icon(Icons.person),
              label: 'Profile',
            ),
          ];

    return Scaffold(
      backgroundColor: AppColors.background,
      body: IndexedStack(
        index: _currentIndex,
        children: screens,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppColors.cardDark,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.3),
              blurRadius: 10,
              offset: const Offset(0, -3),
            ),
          ],
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: (index) => setState(() => _currentIndex = index),
          backgroundColor: AppColors.cardDark,
          selectedItemColor: Colors.white,
          unselectedItemColor: AppColors.textMuted,
          selectedFontSize: 12,
          unselectedFontSize: 11,
          type: BottomNavigationBarType.fixed,
          elevation: 0,
          items: navItems,
        ),
      ),
    );
  }
}
