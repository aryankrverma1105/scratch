#!/bin/bash
# ==============================================================================
# Sologix Energy Backend GCP VM Automated Setup Script (Ubuntu/Debian)
# ==============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
APP_DIR="/var/www/attendance/backend"

echo "==> 1. Setting up Project Directory in $APP_DIR..."
sudo mkdir -p "$APP_DIR"
sudo cp -r "$SCRIPT_DIR"/* "$APP_DIR"/
if [ -f "$SCRIPT_DIR/.env" ]; then
  sudo cp "$SCRIPT_DIR/.env" "$APP_DIR"/.env
elif [ -f "$SCRIPT_DIR/.env.example" ]; then
  sudo cp "$SCRIPT_DIR/.env.example" "$APP_DIR"/.env
fi
sudo chown -R $USER:$USER /var/www/attendance

echo "==> 2. Installing PM2 Process Manager globally..."
sudo npm install -g pm2

echo "==> 3. Installing Backend Dependencies in $APP_DIR..."
cd "$APP_DIR"
npm install --production

echo "==> 4. Starting Sologix Energy API Service with PM2..."
pm2 delete sologix-attendance-backend 2>/dev/null || true
pm2 start server.js --name "sologix-attendance-backend"
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER --force 2>/dev/null || true

echo "==> 5. Configuring Nginx Reverse Proxy..."
if [ -f "nginx-attendance.conf" ]; then
  sudo cp nginx-attendance.conf /etc/nginx/sites-available/sologix-attendance.conf
  sudo ln -sf /etc/nginx/sites-available/sologix-attendance.conf /etc/nginx/sites-enabled/sologix-attendance.conf
  sudo nginx -t && sudo systemctl reload nginx || echo "Nginx notice: Backend running directly on port 5050"
fi

echo "=============================================================================="
echo "✅ Sologix Energy Backend successfully deployed and running on GCP VM!"
echo "   Health Check: curl http://localhost:5050/api/health"
echo "   External URL: http://34.180.17.0:5050/api/health"
echo "=============================================================================="
