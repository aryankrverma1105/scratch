# Changelog - Sologix Energy Attendance & GPS Tracking

All notable changes to this project are documented below, organized by development phase.

---

## [Phase 9] - Automated Verification, CI, Documentation & Field QA
- **Backend Tests:** Added end-to-end integration test suite (`attendance_lifecycle.test.js`) verifying:
  - Complete check-in and check-out attendance lifecycle.
  - Indian Standard Time (IST) midnight boundary logic around `00:00 - 05:30 IST`.
  - Automatic orphan selfie cleanup upon rejection or failed check-in attempts.
- **Flutter Widget Tests:** Added `login_error_widget_test.dart` verifying:
  - Login UI form rendering and input controls.
  - Friendly validation alerts when submitting empty credentials.
  - Accurate conversion of raw Dio network exceptions into friendly user alerts.
- **GitHub Actions CI:** Created `.github/workflows/ci.yml` running Node.js 22 tests and Flutter analyze, test, and debug APK build on every commit.
- **Field QA Checklist:** Added `docs/QA_CHECKLIST.md` detailing real-device tests for:
  - 30-minute locked-screen continuous GPS tracking.
  - Airplane mode toggling & SQLite outbox offline buffering.
  - Hardware GPS off/on transitions & auto-alert resolution.
  - OEM battery optimization (Xiaomi, Samsung, Oppo, Realme, Vivo).
- **Configuration Security:** Cleaned `.env.example` and `README.md` to remove all credentials and defaults.

---

## [Phase 8] - Android Release Hardening & Proguard Optimization
- **Application ID:** Configured canonical production `applicationId = "com.sologixenergy.attendance"` and `namespace = "com.sologixenergy.attendance"`.
- **Package Hierarchy:** Migrated `MainActivity.kt` to `com/sologixenergy/attendance`.
- **Release Signing:** Implemented secure release signing via `android/key.properties` with fallback to debug keystore for CI pipelines.
- **Shrinking & Obfuscation:** Enabled `isMinifyEnabled = true` and `isShrinkResources = true` with comprehensive keep rules in `proguard-rules.pro` for Flutter engine, sqflite, geolocator, and flutter_background_service.
- **Exported Service Security:** Explicitly set `android:exported="false"` on foreground tracking services.
- **Clean Repository:** Removed unused desktop and mobile target directories (`web`, `windows`, `macos`, `linux`, `ios`) keeping pure Android native support.

---

## [Phase 7] - GCP VM Deployment, Nginx & Production Infrastructure
- **Idempotent Deployment:** Rewrote `backend/deploy-gcp.sh` to install Node 22, Nginx, Certbot, UFW, and PostgreSQL clients. Handled running directly inside `/var/www/attendance/backend` using safe `rsync --exclude node_modules`.
- **Localhost Binding:** Bound Node.js Express server to `127.0.0.1:5050` only (isolated behind Nginx).
- **Nginx Reverse Proxy:** Configured production Nginx reverse proxy with HSTS, client body size up to 10MB, and automated Let's Encrypt TLS renewal via Certbot.
- **Process Management:** Configured `ecosystem.config.js` with single fork mode for SQLite and cluster mode for PostgreSQL, integrated with `pm2-logrotate`.
- **Docker Compose:** Added production `docker-compose.yml` with PostgreSQL service and JSON log rotation.
- **Manual Ops Guide:** Documented static IP reservation, DNS A record, UFW firewall, and Certbot commands in `docs/MANUAL_STEPS.md`.

---

## [Phase 6] - Timezone Normalization, Migrations, History & Auto-Checkout
- **Timezone Standardization:** Standardized all backend timestamps to UTC ISO-8601; calculated business day in `COMPANY_TZ` (`Asia/Kolkata`).
- **Database Range Queries:** Replaced `timestamp LIKE 'date%'` with timezone-aware `[startOfDay, nextDay)` UTC range queries compatible with both SQLite and PostgreSQL.
- **PostgreSQL Schemas & Migrations:** Used `DOUBLE PRECISION` for coordinates, added compound indexes on `(user_id, timestamp)` and `(attendance_id)`, and established versioned migrations in `schema_migrations`.
- **Evening Auto-Checkout:** Scheduled `node-cron` job running at `AUTO_CHECKOUT_TIME` (21:00 IST) to auto-close dangling shifts with `check_out_type='auto'`.
- **Admin Visualizers:**
  - Live employee map with "last seen X min ago" color indicators (Green <5m, Orange 5-15m, Grey >15m).
  - Route history viewer with start/finish markers, interactive time slider, and Haversine total distance calculation.
  - Authenticated attendance record viewer with check-in/out selfies.
  - User management (editing, deactivating, and resetting passwords).

---

## [Phase 5] - Background GPS Detection, Watchdog & Alerts
- **State Transition Alerts:** Background isolate continuously monitors `Geolocator.getServiceStatusStream()`, reporting `LOCATION_DISABLED` and `LOCATION_PERMISSION_REVOKED` alerts only during active shifts.
- **Local Warning Notification:** Triggered high-priority lockscreen notification (`gps_alert_channel`) urging employee to turn location back on; auto-cancelled when `RESTORED`.
- **Backend Watchdog:** Scheduled 1-minute `node-cron` watchdog creating `NO_SIGNAL` alerts when an active shift receives no breadcrumbs for >5 minutes.
- **Alert Deduplication:** Server deduplicates alerts so only one active alert per type is open at a time.
- **Admin Alerts Center:** Admin interface receives auto-refreshing (15s) alerts tab with unread count badges and Firebase Cloud Messaging (FCM) scaffolding.

---

## [Phase 4] - Reliable Offline Outbox & Tracking Engine
- **Single Source of Truth:** Background service isolate exclusively manages breadcrumb acquisition and transmission; eliminated duplicate UI isolate postings.
- **Local SQLite Outbox:** Created `location_outbox` table in Flutter storing `client_point_id` (UUID), UTC timestamps with trailing `Z`, coordinates, speed, battery level (`battery_plus`), and mock status.
- **Batched Flushes:** Outbox flushes in batches of up to 50 records with exponential backoff up to 120s.
- **Backend Idempotency:** Implemented `POST /api/location/track-batch` in a single transaction with `UNIQUE(user_id, client_point_id)`.
- **Service Lifecycle:** Automatically terminates tracking on checkout, logout, 401/403 deactivation, or server response `activeTracking=false`.
- **Shift Continuity:** Resumes background tracking upon app launch and phone reboot if an active shift exists.
- **Logout Safety:** Prompts confirmation dialog warning that active shifts will stop GPS tracking if logged out.

---

## [Phase 3] - Robust Selfie Pipeline & GPS Fix
- **Image Validation:** Implemented Sharp metadata validation rejecting corrupted or non-image files with HTTP 400; eliminated raw storage fallback.
- **Orphan File Prevention:** Automatically unlinks uploaded selfie files if attendance controller rejects the request.
- **Single Compression Pipeline:** Client resizes capture to max 1280px @ 85%; server compresses to max 800px @ 78% JPEG with EXIF and GPS stripped.
- **Android Activity Recovery:** Integrated `ImagePicker.retrieveLostData()` to recover selfie capture after OEM camera process death.
- **GPS Fix Resilience:** Uses fresh last-known position (<2 min, <50m) or high-accuracy query with timeout; flags low accuracy rather than blocking checkout.
- **Mock Location Flagging:** Captures `position.isMocked`, persists to database, and highlights warnings in Admin UI.

---

## [Phase 2] - Production Security & Hardening
- **JWT Protection:** Backend validates `JWT_SECRET` length (>= 32 chars) on startup in production.
- **Credential Hygiene:** Eliminated default hardcoded admin passwords; generated cryptographically random password on first run with mandatory change on first login.
- **Rate Limiting & Input Validation:** Applied `express-rate-limit` on authentication endpoints and strict Zod schema validation across all request payloads.
- **Authenticated File Storage:** Removed public static exposure of `/uploads`; implemented authenticated endpoint `GET /api/files/selfies/:name` accessible only to the owner or admins.
- **Secure Storage:** Flutter mobile app stores JWT tokens securely using `FlutterSecureStorage`.
- **Cleartext HTTP Prevention:** Enforced `network_security_config.xml` to block unencrypted cleartext HTTP traffic in production release builds.

---

## [Phase 1] - Service Crash Fixes & Modern Permissions Flow
- **Foreground Notification Channel:** Explicitly created `attendance_tracking_channel` with low importance prior to service configuration, resolving Android 8+ startup crashes.
- **Permission Flow:** Implemented multi-step interactive permission workflow requesting `POST_NOTIFICATIONS` (Android 13+), foreground location, and background location ("Allow all the time").
- **Battery Optimization Exemption:** Added prompt for Android battery optimization exemptions along with device-specific guidance for Xiaomi, Samsung, Realme, Vivo, and Oppo.
- **Complete Rebranding:** Rebranded all application assets, UI labels, notifications, and metadata from "WorkFlow Pro" to "Sologix Energy".

---

## [Phase 0] - Friendly Error Handling & Connection Testing
- **Dio Error Mapping:** Mapped raw Dio network exceptions into friendly, actionable messages.
- **Connection Testing:** Added interactive server latency testing pill to the login screen.
- **Dynamic Server URL:** Removed hardcoded IP `34.180.17.0` from source; added `--dart-define=API_BASE_URL` with VM IP as default debug fallback.
- **Credential Box Removal:** Removed hardcoded default admin credentials from the login screen.
- **Automatic Retry:** Implemented exponential backoff retry for login and current-status API calls.
