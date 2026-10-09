const cron = require('node-cron');
const db = require('../db');
const { sendAlertPush } = require('./fcmService');

let watchdogTask = null;

// Checks active attendances for lost signal / dead heartbeats
async function runWatchdogCheck() {
  try {
    const noSignalThresholdMin = parseInt(process.env.WATCHDOG_NO_SIGNAL_MINUTES || '5', 10);
    const nowMs = Date.now();

    // Query all employees with active attendance
    const activeShifts = await db.query(`
      SELECT a.id as attendance_id, a.user_id, a.check_in_time, u.full_name, u.email
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      WHERE a.status = 'checked_in'
    `);

    for (const shift of activeShifts) {
      // Find latest location track point for this user
      const latestTrack = await db.get(`
        SELECT timestamp FROM location_tracks
        WHERE user_id = ?
        ORDER BY id DESC LIMIT 1
      `, [shift.user_id]);

      const lastActivityTimeStr = latestTrack ? latestTrack.timestamp : shift.check_in_time;
      const lastActivityMs = new Date(lastActivityTimeStr).getTime();
      const elapsedMinutes = (nowMs - lastActivityMs) / 60000;

      if (elapsedMinutes >= noSignalThresholdMin) {
        // Check if unresolved NO_SIGNAL alert already exists (server deduplication)
        const openAlert = await db.get(`
          SELECT id FROM gps_alerts
          WHERE user_id = ? AND alert_type = 'NO_SIGNAL' AND resolved = 0 LIMIT 1
        `, [shift.user_id]);

        if (!openAlert) {
          const message = `No GPS signal received from ${shift.full_name} for ${Math.round(elapsedMinutes)} minutes. Phone may be switched off, in airplane mode, or background service killed.`;

          await db.run(`
            INSERT INTO gps_alerts (user_id, alert_type, message, resolved)
            VALUES (?, 'NO_SIGNAL', ?, 0)
          `, [shift.user_id, message]);

          console.log(`⚠️ [WATCHDOG] Created NO_SIGNAL alert for user ${shift.user_id} (${shift.full_name})`);

          // Send push notification to admin
          await sendAlertPush({
            title: `GPS Signal Lost: ${shift.full_name}`,
            body: message,
            data: {
              userId: String(shift.user_id),
              alertType: 'NO_SIGNAL',
            },
          });
        }
      } else {
        // If signal has returned and there is an open NO_SIGNAL alert, resolve it
        await db.run(`
          UPDATE gps_alerts
          SET resolved = 1
          WHERE user_id = ? AND alert_type = 'NO_SIGNAL' AND resolved = 0
        `, [shift.user_id]);
      }
    }
  } catch (err) {
    console.error('[WATCHDOG] Execution error:', err.message);
  }
}

function startWatchdog() {
  if (watchdogTask) return;
  // Run every minute: * * * * *
  watchdogTask = cron.schedule('* * * * *', () => {
    runWatchdogCheck();
  });
  console.log('⏰ Server Watchdog started (every 1 min, threshold: 5 min)');
}

function stopWatchdog() {
  if (watchdogTask) {
    watchdogTask.stop();
    watchdogTask = null;
  }
}

module.exports = {
  startWatchdog,
  stopWatchdog,
  runWatchdogCheck,
};
