# Sologix Energy - Real-Device Field QA Checklist

Comprehensive quality assurance validation checklist for field testing the **Sologix Energy Employee Attendance & Continuous GPS Tracking System** on physical Android devices.

---

## 📱 Pre-requisites & Setup
- [ ] Install release or debug build: `flutter build apk --release` (or `--debug`) on physical target devices.
- [ ] Test across target OEM ecosystems:
  - [ ] **Samsung Galaxy** (One UI 5 / 6, Android 13/14)
  - [ ] **Xiaomi / Redmi / POCO** (MIUI / HyperOS)
  - [ ] **Realme / Oppo / OnePlus** (ColorOS / OxygenOS)
  - [ ] **Vivo / iQOO** (Funtouch OS)
  - [ ] **Google Pixel / Stock Android**
- [ ] Server running on GCP VM (`http://34.180.17.0:5050` or HTTPS production domain).

---

## 🔒 1. Permissions & Battery Optimization Setup
- [ ] **Notification Permission (Android 13+):** Prompted on first launch; persistent tracking notification visible when checked in.
- [ ] **Foreground Location Permission:** "While using the app" granted.
- [ ] **Background Location Permission:** Interactive explanation dialog displayed; redirects to Settings -> Location Permission -> "Allow all the time" selected.
- [ ] **Ignore Battery Optimization:** Prompt to exempt app from Android Doze mode accepted.
- [ ] **OEM Auto-Start / Background Activity Guide:**
  - [ ] **Xiaomi/Redmi:** Autostart enabled, Battery Saver set to "No restrictions".
  - [ ] **Samsung:** Battery set to "Unrestricted", not added to "Sleeping apps" or "Deep sleeping apps".
  - [ ] **Realme/Oppo:** "Allow background activity" & "Allow auto-launch" enabled.
  - [ ] **Vivo:** "High background power consumption" permitted.

---

## 📸 2. Check-In & Selfie Pipeline
- [ ] **Front Camera Capture:** Tapping Check-In opens front camera directly.
- [ ] **Preview & Retake Loop:** Image preview shown; clicking "Retake" smoothly reopens camera.
- [ ] **Image Compression Verification:** Raw camera capture (>3MB) is resized on client to max 1280px @ 85%, and server compresses to max 800px @ 78% JPEG with EXIF stripped.
- [ ] **GPS Fix Tolerance:**
  - [ ] Check-in succeeds quickly with fresh GPS fix.
  - [ ] Weak GPS fix (<50m accuracy threshold exceeded) flags low accuracy rather than blocking shift check-in.
- [ ] **Mock Location Detection:** Mock location app tested -> server receives `is_mocked=1`, admin UI highlights record with orange warning pill.
- [ ] **Orphan File Clean-Up:** If employee attempts double check-in, uploaded selfie file is immediately pruned from disk on server.

---

## 🚶‍♂️ 3. Continuous Tracking & Offline Outbox
- [ ] **30-Minute Screen-Locked Field Test:**
  - [ ] Check-in with active shift.
  - [ ] Lock device screen and walk / drive across a 1-2 km route for 30 minutes.
  - [ ] Verify ongoing foreground notification: "Tracking active in background • Shift in progress".
  - [ ] Verify Admin Live Map and Route History show continuous breadcrumb trail with points every ~20m or 60s heartbeat.
- [ ] **Airplane Mode / Network Drop Test:**
  - [ ] While walking/driving, enable Airplane Mode for 5 minutes.
  - [ ] Verify app continues collecting GPS breadcrumbs silently into local SQLite outbox table (`location_outbox`).
  - [ ] Disable Airplane Mode.
  - [ ] Verify outbox automatically flushes points in batches of up to 50 with exponential backoff.
  - [ ] Verify no points are lost or duplicated (backend `UNIQUE(user_id, client_point_id)` idempotency).
- [ ] **Offline Selfie Queue:** Check-in initiated while disconnected from cellular data queues photo and coordinates locally; replays upon reconnect.

---

## 🚨 4. GPS-Off & Signal Loss Detection
- [ ] **Hardware GPS Toggle OFF:**
  - [ ] While checked in, toggle Location OFF in Android Quick Settings.
  - [ ] Within 5-10 seconds, device triggers high-priority local notification: *"Location Services Disabled - Turn location back ON to continue logging shift"*.
  - [ ] Server receives `LOCATION_DISABLED` alert; Admin alerts badge updates with unread count.
  - [ ] Admin receives FCM push notification (when configured).
- [ ] **Hardware GPS Toggle ON:**
  - [ ] Re-enable Location in Quick Settings.
  - [ ] Alert automatically resolves (`RESTORED`); lockscreen warning notification is cancelled.
- [ ] **Location Permission Revoked:**
  - [ ] Revoke location permission from Android App Info during an active shift.
  - [ ] App reports `LOCATION_PERMISSION_REVOKED` to backend upon next tick.
- [ ] **Watchdog Dead-Mans-Switch (No Signal):**
  - [ ] Turn off phone or force-kill app with GPS off for > 5 minutes while checked in.
  - [ ] Backend server watchdog detects no breadcrumb update for > 5 min.
  - [ ] Server logs `NO_SIGNAL` alert for the employee.

---

## 🔄 5. App Lifecycle & Reboot Resilience
- [ ] **Task Manager Swipe-Away:**
  - [ ] Swipe attendance app away from Android Recent Apps screen.
  - [ ] Persistent foreground service notification remains active in Android notification shade.
  - [ ] Re-opening the app immediately shows active shift state and stopwatch.
- [ ] **Phone Reboot:**
  - [ ] Restart the device while checked in.
  - [ ] Once booted, unlock device and launch app -> app detects open attendance from SQLite / server and automatically resumes background tracking.
- [ ] **Active Shift Logout Guard:**
  - [ ] Attempting to log out while checked in prompts confirmation warning: *"You have an active shift. Logging out will stop GPS tracking."*

---

## 🕒 6. Midnight Boundary & Auto-Checkout
- [ ] **Midnight Shift Boundary (00:00 - 05:30 IST):**
  - [ ] Shift running across midnight (e.g. 23:45 to 01:15 IST) is accurately assigned to `Asia/Kolkata` company date.
  - [ ] Querying route history by calendar date displays complete shift without UTC date truncation.
- [ ] **Automated Evening Auto-Checkout:**
  - [ ] Shifts left unclosed at `AUTO_CHECKOUT_TIME` (default 21:00 IST) are closed automatically with `check_out_type='auto'`.
  - [ ] Attempting check-in next morning auto-closes any dangling shifts from previous days.

---

## 👨‍💼 7. Admin Dashboard & Portal
- [ ] **Live Map:** Shows all active employees with status indicator colors:
  - 🟢 Green: seen within 5 minutes.
  - 🟠 Orange: seen 5–15 minutes ago.
  - ⚪ Grey: seen > 15 minutes ago or offline.
- [ ] **Route History Visualizer:** Polyline accurately draws breadcrumbs; interactive time slider scrubs along timeline; total distance calculation matches real distance.
- [ ] **Selfie Inspection:** Check-in and check-out photos load securely using Authorization header; direct unauthorized HTTP access returns 401/404.
- [ ] **User Management:** Create employee/admin, edit details, toggle active/deactivated, and reset temporary passwords.
