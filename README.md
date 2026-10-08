# Sologix Energy – Enterprise Attendance & Continuous GPS Tracking System

> **Designed and developed by Aryan Kumar Verma**  
> *Sologix Energy – Energizing Naturally*

A full-stack, enterprise-grade Employee Attendance Android Mobile Application (Flutter) and REST API Backend (Node.js/Express) built with dark UI styling matching [tilakpatel22/employee-attendance-app-flutter](https://github.com/tilakpatel22/employee-attendance-app-flutter.git).

---

## 🌟 Feature Checklist & Requirements Verification

| # | Requirement | Implementation Details |
|---|-------------|------------------------|
| 1 | **Android app – Flutter** | Built in `attendance_app/` using Flutter 3.47+ / Dart 3.13+. |
| 2 | **Login – username/email + password** | Sleek glassmorphism login with dual identifier support in `login_screen.dart` & `authController.js`. |
| 3 | **JWT authentication** | Secure JWT tokens signed on login, auto-injected via Dio interceptor in `api_service.dart`. |
| 4 | **Two roles – Admin & Employee** | Role-based middleware (`requireAdmin`), role-adaptive bottom navigation bar in `main_navigation.dart`. |
| 5 | **Admin can create employees & admins** | Interactive modal form in `admin_users_screen.dart` with role selection chip (`employee` / `admin`). |
| 6 | **Check-In & Check-Out buttons** | One-touch attendance action card in `home_screen.dart` with real-time shift duration stopwatch. |
| 7 | **GPS location captured during attendance** | High-accuracy GPS coordinates (`latitude`, `longitude`) captured and verified before every check-in/out. |
| 8 | **Continuous GPS tracking after Check-In** | `LocationService.startContinuousTracking()` streams active breadcrumb points to `/api/location/track`. |
| 9 | **GPS tracking stops after Check-Out** | Automatically stops tracking streams and terminates background services upon check-out. |
| 10 | **Background tracking (minimized / locked)** | `flutter_background_service` Android foreground service with persistent status notification. |
| 11 | **Location data saved in database** | `location_tracks` table stores timestamps, coordinates, speed, accuracy, and altitude. |
| 12 | **Admin live employee map** | OpenStreetMap via `flutter_map` displaying live markers, duty status, and GPS health for all staff. |
| 13 | **Admin location history / routes** | Interactive polyline route visualizer (`admin_route_history_screen.dart`) with calendar date filter. |
| 14 | **Detect when employee turns GPS OFF** | `Geolocator.getServiceStatusStream()` continuously listens to hardware location state changes. |
| 15 | **Notify employee/admin when location OFF** | Triggers popup alert in mobile app and posts immediate security alert to `/api/location/gps-status`. |
| 16 | **Backend + DB runs on GCP VM** | Self-contained Node.js + Express backend (SQLite default with PostgreSQL support) ready for GCP VM. |
| 17 | **REST API between app and server** | Modular Express REST API with endpoints under `/api/auth`, `/api/attendance`, `/api/admin`, `/api/location`. |
| 18 | **Secure HTTPS connection** | Configurable base URL in mobile app settings + automated Certbot/Let's Encrypt Nginx setup script for GCP. |
| 19 | **Selfie during Check-In & Check-Out** | Front-facing camera capture (`image_picker`) with image preview dialog and multipart upload to server. |

---

## 📁 Repository Structure

```
d:/Scratch/
├── backend/
│   ├── data/                   # SQLite database directory (attendance.db)
│   ├── uploads/selfies/        # Uploaded check-in/out selfie photos
│   ├── src/
│   │   ├── controllers/        # auth, admin, attendance, location controllers
│   │   ├── middleware/         # JWT auth & Multer selfie upload middleware
│   │   ├── routes/             # Express API routes
│   │   ├── config.js           # Server configuration & environment defaults
│   │   └── db.js               # SQLite & PostgreSQL database layer & seeders
│   ├── server.js               # Express entry point
│   ├── deploy-gcp.sh           # Automated setup script for GCP Compute Engine VM
│   ├── nginx-attendance.conf   # Production Nginx reverse proxy configuration
│   ├── ecosystem.config.js     # PM2 cluster configuration
│   ├── Dockerfile & compose    # Containerized deployment files
│   └── package.json
│
└── attendance_app/
    ├── android/                # Configured with location & foreground service permissions
    ├── lib/
    │   ├── core/
    │   │   ├── constants/      # AppColors matching reference design
    │   │   └── services/       # ApiService, LocationService, BackgroundTrackerService
    │   ├── models/             # UserModel, AttendanceRecord, LocationModel
    │   ├── screens/
    │   │   ├── auth/           # SplashScreen, LoginScreen (with GCP server config)
    │   │   ├── employee/       # HomeScreen (Selfie & GPS), ActivitiesScreen, ProfileScreen
    │   │   ├── admin/          # AdminLiveMapScreen, AdminRouteHistoryScreen, AdminUsersScreen, AdminAlertsScreen
    │   │   └── main_navigation.dart # Adaptive bottom bar based on user role
    │   └── main.dart
    ├── pubspec.yaml
    └── analysis_options.yaml
```

---

## 🚀 Quick Start Guide

### 1. Start the Backend API

```powershell
cd backend
npm install
npm start
```
- Health Check: `http://localhost:5000/api/health`
- Default Administrator Credentials:
  - **Email:** `admin@company.com`
  - **Password:** `admin123`

---

### 2. Run the Flutter Mobile App

```powershell
cd attendance_app
flutter pub get
flutter run -d <your-android-device-or-emulator>
```
> **Tip for Android Emulator:** The app defaults to `http://10.0.2.2:5000`. You can tap the ⚙️ icon on the Login screen or in the Profile screen to point directly to your GCP VM IP (`http://<YOUR_VM_IP>:5000` or `https://<YOUR_DOMAIN>`).

---

## ☁️ GCP Compute Engine VM Deployment (Ubuntu 22.04 / 24.04)

1. **Create VM Instance:**
   - In Google Cloud Console -> Compute Engine -> VM instances -> Create.
   - OS: Ubuntu 22.04 LTS or 24.04 LTS.
   - Firewall: Allow HTTP traffic & Allow HTTPS traffic.

2. **Copy Backend to VM:**
   ```bash
   scp -r backend/* user@<YOUR_GCP_VM_IP>:/var/www/attendance/backend/
   ```

3. **Run Automated Setup Script:**
   ```bash
   ssh user@<YOUR_GCP_VM_IP>
   cd /var/www/attendance/backend
   chmod +x deploy-gcp.sh
   ./deploy-gcp.sh
   ```

4. **Enable Free HTTPS SSL (Requirement 18):**
   ```bash
   sudo certbot --nginx -d your-company-domain.com
   ```
