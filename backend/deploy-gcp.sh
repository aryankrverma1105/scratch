#!/bin/bash
# ==============================================================================
# Sologix Energy - Production GCP VM Deployment Script (Idempotent)
# Designed and developed by Aryan Kumar Verma
# ==============================================================================

set -euo pipefail

APP_DIR="/var/www/attendance/backend"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
USER_NAME="$(whoami)"

echo "=============================================================================="
echo "🚀 SOLOGIX ENERGY ATTENDANCE & GPS TRACKING - GCP VM DEPLOYMENT"
echo "=============================================================================="

# ------------------------------------------------------------------------------
# 1. Update Packages & Install Prerequisites
# ------------------------------------------------------------------------------
echo "==> 1. Updating packages and installing prerequisites..."
sudo apt-get update -y
sudo apt-get install -y curl gnupg ufw rsync openssl nginx certbot python3-certbot-nginx postgresql-client

# ------------------------------------------------------------------------------
# 2. Install Node.js 22 LTS (Idempotent)
# ------------------------------------------------------------------------------
NODE_MAJOR=22
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  echo "==> 2. Installing Node.js ${NODE_MAJOR}.x LTS..."
  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
  sudo apt-get update -y
  sudo apt-get install -y nodejs
else
  echo "==> 2. Node.js $(node -v) is already installed."
fi

# ------------------------------------------------------------------------------
# 3. Synchronize Application Files (Avoid self-copy if running in target dir)
# ------------------------------------------------------------------------------
echo "==> 3. Setting up application directory at $APP_DIR..."
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER_NAME":"$USER_NAME" /var/www/attendance

if [ "$SCRIPT_DIR" != "$APP_DIR" ]; then
  echo "==> Syncing files from $SCRIPT_DIR to $APP_DIR (excluding node_modules)..."
  rsync -av --delete \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'data/*.db' \
    "$SCRIPT_DIR/" "$APP_DIR/"
else
  echo "==> Script is already executing inside target $APP_DIR. Skipping self-copy."
fi

cd "$APP_DIR"
mkdir -p "$APP_DIR/uploads/selfies" "$APP_DIR/data" "$APP_DIR/logs"

# ------------------------------------------------------------------------------
# 4. Generate Production .env With Strong Random Secrets on First Run
# ------------------------------------------------------------------------------
if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> 4. Generating production .env with cryptographically random secrets..."
  RANDOM_JWT_SECRET=$(openssl rand -hex 32)
  RANDOM_ADMIN_PW=$(openssl rand -hex 8)

  cat <<EOF > "$APP_DIR/.env"
NODE_ENV=production
PORT=5050
HOST=127.0.0.1
JWT_SECRET=${RANDOM_JWT_SECRET}
JWT_EXPIRES_IN=12h
COMPANY_TZ=Asia/Kolkata
AUTO_CHECKOUT_TIME=21:00
ADMIN_DEFAULT_EMAIL=admin@sologixenergy.com
ADMIN_DEFAULT_NAME=System Administrator
ADMIN_INITIAL_PASSWORD=${RANDOM_ADMIN_PW}
CORS_ORIGIN=*
EOF
  echo "✅ New .env generated with 64-char JWT_SECRET and initial admin password."
else
  echo "==> 4. Existing .env found, preserving configuration."
fi

# ------------------------------------------------------------------------------
# 5. Install Dependencies & PM2
# ------------------------------------------------------------------------------
echo "==> 5. Installing npm production dependencies in $APP_DIR..."
npm install --omit=dev

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing PM2 process manager globally..."
  sudo npm install -g pm2
fi

# Install pm2-logrotate for automated log rotation
pm2 install pm2-logrotate 2>/dev/null || true
pm2 set pm2-logrotate:max_size 10M 2>/dev/null || true
pm2 set pm2-logrotate:retain 10 2>/dev/null || true

# ------------------------------------------------------------------------------
# 6. Configure Firewall (UFW)
# ------------------------------------------------------------------------------
echo "==> 6. Configuring UFW firewall (Ports 22, 80, 443 open; 5050 closed externally)..."
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'
# Close 5050 externally so requests must be routed via Nginx reverse proxy
sudo ufw delete allow 5050/tcp 2>/dev/null || true
sudo ufw deny 5050/tcp comment 'Block direct backend port'
sudo ufw --force enable

# ------------------------------------------------------------------------------
# 7. Start / Reload Backend Service via PM2
# ------------------------------------------------------------------------------
echo "==> 7. Starting Sologix Attendance service with PM2..."
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
sudo env PATH="$PATH":/usr/bin pm2 startup systemd -u "$USER_NAME" --hp "/home/$USER_NAME" --force 2>/dev/null || true

# ------------------------------------------------------------------------------
# 8. Configure Nginx Reverse Proxy
# ------------------------------------------------------------------------------
echo "==> 8. Configuring Nginx reverse proxy..."
if [ -f "$APP_DIR/nginx-attendance.conf" ]; then
  sudo cp "$APP_DIR/nginx-attendance.conf" /etc/nginx/sites-available/sologix-attendance.conf
  sudo ln -sf /etc/nginx/sites-available/sologix-attendance.conf /etc/nginx/sites-enabled/sologix-attendance.conf
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx
fi

echo "=============================================================================="
echo "✅ DEPLOYMENT COMPLETED SUCCESSFULLY!"
echo "   Node backend:  Bound to 127.0.0.1:5050"
echo "   Nginx proxy:   Listening on port 80 (HTTP) -> 5050"
echo "   Health check:  curl http://127.0.0.1:5050/api/health"
echo "   Public test:   curl http://$(curl -s https://api.ipify.org)/api/health"
echo "   PM2 Status:    pm2 status"
echo ""
echo "👉 NEXT STEP FOR HTTPS:"
echo "   sudo certbot --nginx -d YOUR_DOMAIN.com"
echo "=============================================================================="
