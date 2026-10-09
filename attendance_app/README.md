# Sologix Energy - Attendance & Tracking Flutter App

> **Designed and developed by Aryan Kumar Verma**  
> *Sologix Energy – Energizing Naturally*

Android client application for Sologix Energy employee attendance logging and continuous background GPS tracking.

## 🛠️ Build & Run Instructions

### Prerequisites
- Flutter SDK 3.29+ (or 3.24+)
- Android SDK (API 34/35) & Java 17

### Development
```bash
flutter pub get
flutter run
```

### Static Analysis & Tests
```bash
flutter analyze
flutter test
```

### Building APK
- **Debug Build:**
  ```bash
  flutter build apk --debug
  ```
- **Release Build (Signed):**
  ```bash
  flutter build apk --release --dart-define=API_BASE_URL=https://api.yourdomain.com
  ```

For signing configuration, consult `docs/MANUAL_STEPS.md`.
