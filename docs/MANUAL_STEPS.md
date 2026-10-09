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

## 2. Static External IP & Domain (DNS) Setup

### A. Reserve a Static External IP in GCP
1. Go to **VPC Network > IP Addresses**.
2. Find the external IP of your VM instance (`34.180.17.0`).
3. Click the three dots icon next to it and select **Promote to static IP address**.
4. Name it `sologix-attendance-ip` and save.

### B. Configure DNS A Record
1. In your domain registrar (GoDaddy, Cloudflare, Namecheap, Google Domains):
2. Add an **A Record**:
   - **Type**: `A`
   - **Host/Name**: `api` (for `api.sologixenergy.com`) or `@`
   - **Value/Points to**: `34.180.17.0`
   - **TTL**: `300` (5 minutes)
3. Wait 5-10 minutes for DNS propagation, verify using:
   ```bash
   nslookup api.sologixenergy.com
   ```

---

## 3. SSL / HTTPS Certificate with Let's Encrypt (Certbot)

Run the following commands on your GCP VM after pointing your domain to the VM:
```bash
# 1. Install certbot and Nginx plugin
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx

# 2. Issue and install certificate automatically into Nginx
sudo certbot --nginx -d api.sologixenergy.com

# 3. Test automatic certificate renewal
sudo certbot renew --dry-run
```
Certbot will configure HTTPS redirects (HTTP 80 -> HTTPS 443) and manage TLS certificates automatically.

### B. Point Flutter Mobile App to Production HTTPS Domain
Once SSL is activated, build the mobile app pointing to your HTTPS domain using `--dart-define`:
```bash
cd attendance_app
flutter build apk --release --dart-define=API_BASE_URL=https://api.sologixenergy.com
```
Or for debug testing:
```bash
flutter run --dart-define=API_BASE_URL=https://api.sologixenergy.com
```

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
