# Sologix Energy – Enterprise Attendance & Continuous GPS Tracking System

> **Designed and developed by Aryan Kumar Verma**  
> *Sologix Energy – Energizing Naturally*

A production-grade, enterprise Employee Attendance Android Mobile Application (Flutter) and REST API Backend (Node.js/Express) built with dark UI styling matching [tilakpatel22/employee-attendance-app-flutter](https://github.com/tilakpatel22/employee-attendance-app-flutter.git).

---

## 🌟 Core Requirements & Architecture Overview

| # | Requirement | Implementation Summary |
|---|-------------|------------------------|
| 1 | **Android App (Flutter)** | Flutter 3.29+ / Dart 3.7+ with package ID `com.sologixenergy.attendance`. |
| 2 | **Login (Username/Email + Password)** | Sleek dark-mode interface with rate limiting and friendly network error mapping. |
| 3 | **JWT Authentication** | 12-hour signed tokens stored in `FlutterSecureStorage` and validated per request. |
| 4 | **Two Roles (Admin & Employee)** | Role-based navigation and protected API endpoints. |
| 5 | **Admin User Management** | Create, edit, deactivate, and reset passwords for employees and admins. |
| 6 | **Check-In & Check-Out Actions** | Shift cards with live stopwatch duration counter. |
| 7 | **GPS Fix on Check-In/Out** | High-accuracy GPS coordinates validated before recording shift events. |
| 8 | **Continuous Background Tracking** | `flutter_background_service` Android foreground service logging breadcrumbs (~20m / 60s). |
| 9 | **Stop Tracking on Check-Out** | Background service cleanly stops tracking on checkout, logout, or session termination. |
| 10 | **Persistent Background Execution** | Survives screen locks, app swipe-away, and device reboots via SQLite outbox persistence. |
| 11 | **Location Storage in Database** | `location_tracks` table storing coordinates, speed, battery level, accuracy, and mock flags. |
| 12 | **Admin Live Employee Map** | Interactive OpenStreetMap displaying real-time employee locations with status colors. |
| 13 | **Admin Route History** | Polyline visualization with timeline slider, start/end pins, and distance calculator. |
| 14 | **GPS-Off Detection** | Background hardware stream detects location service toggles and permission revocations. |
| 15 | **Alerts & Push Notifications** | High-priority lockscreen notifications, watchdog dead-man alerts, and FCM push notifications. |
| 16 | **GCP VM Hosting** | Ubuntu 22.04/24.04 automated idempotent setup script (`backend/deploy-gcp.sh`). |
| 17 | **Modular REST API** | Express REST API structured across `/api/auth`, `/api/attendance`, `/api/location`, `/api/admin`. |
| 18 | **Secure HTTPS** | Nginx reverse proxy with HSTS, TLS encryption, and automated Let's Encrypt renewal. |
| 19 | **Selfie Capture on Check-In/Out** | Front-camera capture with preview/retake, Sharp image validation, and storage compression. |

---

## 📁 Repository Structure

```
.
├── .github/workflows/          # GitHub Actions CI workflow (Node tests + Flutter build)
├── backend/                    # Express.js REST API
│   ├── data/                   # SQLite database directory (attendance.db)
│   ├── src/
│   │   ├── controllers/        # auth, attendance, location, admin controllers
│   │   ├── middleware/         # auth (JWT), rate limiting, selfie upload (Multer)
│   │   ├── routes/             # Express API route modules
│   │   ├── services/           # fcmService, watchdog
│   │   ├── utils/              # timeUtils, imageUtils, validation
│   │   └── db.js               # Database abstraction & versioned migrations
│   ├── tests/                  # Node.js test runner unit & integration tests
│   ├── deploy-gcp.sh           # Idempotent GCP deployment script
│   ├── nginx-attendance.conf   # Production Nginx reverse proxy configuration
│   ├── ecosystem.config.js     # PM2 process manager configuration
│   └── Dockerfile & compose    # Containerized deployment files
├── attendance_app/             # Flutter Android application
│   ├── android/                # Native Android config (applicationId, permissions, Proguard)
│   ├── lib/
│   │   ├── core/               # Constants, themes, ApiService, LocationService
│   │   ├── models/             # UserModel, AttendanceRecord, LocationModel
│   │   └── screens/            # Auth, Employee, Admin, Navigation
│   └── test/                   # Unit & Widget test suite
├── docs/
│   ├── MANUAL_STEPS.md         # Manual setup guide (DNS, GCP Firewall, Firebase, Keystore)
│   └── QA_CHECKLIST.md         # Physical Android device field QA validation checklist
└── CHANGELOG.md                # Comprehensive changelog covering all development phases
```

---

## 🚀 Getting Started

### 1. Backend Server Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and supply a secure JWT_SECRET (min 32 characters)
npm start
```

Run tests:
```bash
npm test
```

### 2. Flutter Mobile Application

#### A. Run in Debug Mode
```bash
cd attendance_app
flutter pub get
flutter run -d <device_id>
```

#### B. Build Debug APK
```bash
flutter build apk --debug
```

#### C. Build Signed Release APK
Refer to [docs/MANUAL_STEPS.md](docs/MANUAL_STEPS.md) to generate `key.properties` and keystore:
```bash
flutter build apk --release --dart-define=API_BASE_URL=https://api.yourdomain.com
```

---

## ☁️ Deployment & Operations
For detailed instructions on configuring GCP VM firewall rules, DNS records, SSL/HTTPS certificates, PostgreSQL, Firebase Cloud Messaging, and Android release keystores, see:
👉 [docs/MANUAL_STEPS.md](docs/MANUAL_STEPS.md)
