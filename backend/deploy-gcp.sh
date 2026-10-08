#!/bin/bash
# ==============================================================================
# Attendance App Backend GCP VM Automated Setup Script (Ubuntu/Debian)
# ==============================================================================

set -e

echo "==> 1. Updating system packages..."
sudo apt update && sudo apt upgrade -y

echo "==> 2. Installing Node.js 22 LTS, Git, and build tools..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git ufw

echo "==> 3. Installing PM2 Process Manager globally..."
sudo npm install -g pm2

echo "==> 4. Setting up Project Directory..."
APP_DIR="/var/www/attendance/backend"
sudo mkdir -p /var/www/attendance
sudo chown -R $USER:$USER /var/www/attendance

echo "==> 5. Installing Backend Dependencies..."
cd $APP_DIR
npm install --production

echo "==> 6. Starting Service with PM2..."
pm2 start ecosystem.config.js
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER

echo "==> 7. Configuring Nginx..."
sudo cp nginx-attendance.conf /etc/nginx/sites-available/attendance
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/attendance
sudo nginx -t
sudo systemctl restart nginx

echo "==> 8. Configuring Firewall..."
sudo ufw allow 'Nginx Full'
sudo ufw allow 22/tcp
sudo ufw --force enable

echo "=============================================================================="
echo "✅ Backend successfully deployed and running on GCP VM!"
echo "   To secure with FREE SSL HTTPS (Requirement 18):"
echo "   sudo certbot --nginx -d your-vm-domain.com"
echo "=============================================================================="
