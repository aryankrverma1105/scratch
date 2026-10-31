const cron = require('node-cron');
const { performBackup } = require('./backupService');

function initBackupCron() {
  // Run daily at 02:00 AM IST (20:30 UTC previous day, or 02:00 in local timezone)
  // node-cron supports timezone: 'Asia/Kolkata'
  cron.schedule(
    '0 2 * * *',
    async () => {
      console.log('⏰ [Backup Cron] Starting daily database backup at 02:00 AM IST...');
      try {
        const result = await performBackup({ backupType: 'daily_cron' });
        console.log(`✅ [Backup Cron] Daily backup completed: ${result.filename} (${result.destinationsCount} destinations)`);
      } catch (err) {
        console.error('❌ [Backup Cron] Error running daily backup:', err.message);
      }
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );
  console.log('🕒 Automated daily database backup cron registered (02:00 AM Asia/Kolkata)');
}

module.exports = {
  initBackupCron,
};

