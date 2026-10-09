# Sologix Energy - Manual Setup & Operations Guide

This document contains step-by-step instructions for tasks that require manual action in Google Cloud Console, Domain Registrar (DNS), Firebase Console, or Android signing key generation.

---

## 1. Google Cloud VPC Firewall Rules

By default, Google Cloud VPC firewalls block custom incoming ports.

### A. Development Testing (Port 5050)
If accessing the Node.js backend directly on port `5050` without Nginx/HTTPS:
1. Open [Google Cloud Console > VPC Network > Firewall](https://console.cloud.google.com/networking/firewalls).
2. Click **Create Firewall Rule**:
   - **Name**: `allow-sologix-attendance-5050`
   - **Network**: `default`
   - **Direction**: `Ingress`
   - **Action on match**: `Allow`
   - **Targets**: `All instances in the network`
   - **Source IPv4 ranges**: `0.0.0.0/0`
   - **Protocols and ports**: Select **Specified protocols and ports**, check **TCP**, enter `5050`.
3. Click **Create**.
4. On the VM instance terminal, ensure UFW is not blocking it:
   ```bash
   sudo ufw allow 5050/tcp
   ```

### B. Production Deployment (Ports 80 & 443 Only)
In production, Node.js binds to `127.0.0.1:5050` locally, and Nginx terminates HTTPS externally on port 443.
1. In GCP Firewall, ensure `default-allow-http` (TCP 80) and `default-allow-https` (TCP 443) are enabled.
2. Delete or disable the rule for port `5050` so that the backend is never exposed directly without HTTPS encryption.

---

## 2. Using Without a Purchased Domain (Two Options)

If you do NOT own a custom domain name (e.g. `sologixenergy.com`), you have two simple options:

### Option A: Use Direct IP Over HTTP (Fastest & Simplest)
You do not need to buy any domain or set up SSL.
- **Port 5050:** The app connects directly to `http://34.180.17.0:5050` (the default in the code).
- **Port 80 (via Nginx):** Or run Nginx as a reverse proxy, and connect to `http://34.180.17.0`.
- **Android Configuration:** The mobile app's `network_security_config.xml` has been configured to explicitly permit cleartext HTTP traffic to `34.180.17.0` in both debug and release builds.
- **GCP Firewall Rule:**
  1. Open [GCP Console > VPC network > Firewall](https://console.cloud.google.com/networking/firewalls).
  2. Ensure TCP port `5050` (or `80`) is allowed from `0.0.0.0/0`.

### Option B: Free HTTPS / SSL with `sslip.io` (Zero Cost, No Registration)
`sslip.io` is a free public wildcard DNS service. Any IP automatically has a domain that resolves directly to it:
- **Your Free Domain:** `34.180.17.0.sslip.io` (already resolves worldwide to `34.180.17.0`).
- Because it is a valid domain, **Let's Encrypt (Certbot) can issue a real, free HTTPS SSL certificate for it!**

#### Steps to enable free HTTPS on your VM:
```bash
# 1. SSH into your GCP VM
ssh user@34.180.17.0

# 2. Issue free Let's Encrypt SSL certificate using certbot:
sudo certbot --nginx -d 34.180.17.0.sslip.io

# 3. Follow on-screen prompt to enter your email and agree to terms.
```

Certbot will automatically install the certificate into Nginx and redirect HTTP to HTTPS.

---

## 3. Building the Flutter App

Depending on which option you choose above:

### With Direct IP (Option A):
```bash
cd attendance_app
# Debug:
flutter run

# Release APK:
flutter build apk --release
```
*(The default `API_BASE_URL` in code is already set to `http://34.180.17.0:5050`)*

### With Free HTTPS via `sslip.io` (Option B):
```bash
cd attendance_app
# Debug:
flutter run --dart-define=API_BASE_URL=https://34.180.17.0.sslip.io

# Release APK:
flutter build apk --release --dart-define=API_BASE_URL=https://34.180.17.0.sslip.io
```

---

## 3.1 Custom Domain DNS & SSL (Optional, If You Acquire a Domain Later)

If you purchase a custom domain later:
1. Add an **A Record** in your registrar pointing to `34.180.17.0`.
2. Run `sudo certbot --nginx -d yourdomain.com` on the VM.
3. Build the app with `--dart-define=API_BASE_URL=https://yourdomain.com`.

---

## 4. Production Database: PostgreSQL & Daily GCS Backups

### A. Managed Cloud SQL or Local PostgreSQL
To connect the backend to PostgreSQL:
1. Set in `.env`:
   ```bash
   DATABASE_URL="postgres://attendance_user:STRONG_PASSWORD@localhost:5432/sologix_attendance"
   ```
2. Run database migrations / initialization.

### B. Daily Automated Database Backup to Google Cloud Storage (GCS)
1. Create a private GCS bucket in Cloud Storage: `gs://sologix-attendance-backups`.
2. Add a cron job on the VM (`crontab -e`):
   ```bash
   0 2 * * * pg_dump -U attendance_user -d sologix_attendance | gzip | gsutil cp - gs://sologix-attendance-backups/backup-$(date +\%F).sql.gz
   ```

---

## 5. Firebase Cloud Messaging (FCM) Push Notifications

For Admin alerts (e.g. employee turned off GPS / entered unauthorized state / signal lost):
1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Create project: **Sologix Energy Attendance**.
3. Add an Android App:
   - Package name: `com.sologixenergy.attendance`
4. Download `google-services.json` and place it in:
   `attendance_app/android/app/google-services.json`
5. In Firebase Project Settings > Service Accounts:
   - Generate a new private key JSON (`firebase-service-account.json`).
   - Copy to backend VM at `/var/www/attendance/backend/config/firebase-service-account.json`.
   - Set in `.env`: `FIREBASE_CREDENTIALS_PATH=/var/www/attendance/backend/config/firebase-service-account.json`.

---

## 6. Android Release Keystore & App Signing

To generate a private release keystore for building production `.aab` or signed `.apk`:

1. Run keytool on your computer:
   ```bash
   keytool -genkey -v -keystore sologix-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sologix_key
   ```
2. Move `sologix-release-key.jks` into `attendance_app/android/app/sologix-release-key.jks`.
3. Create `attendance_app/android/key.properties` with:
   ```properties
   storePassword=YOUR_STORE_PASSWORD
   keyPassword=YOUR_KEY_PASSWORD
   keyAlias=sologix_key
   storeFile=app/sologix-release-key.jks
   ```
   *(Note: `key.properties` and `.jks` are ignored by git in `.gitignore` for security).*

---

## 7. First-Run Admin Security & Password Change

1. On initial backend launch in production, the server creates the initial admin user with a randomly generated secure password printed to console log once.
2. The user has `must_change_password = true` in the database.
3. Upon first login with this temporary password, the application forces the user to choose a new strong password before granting dashboard access.
