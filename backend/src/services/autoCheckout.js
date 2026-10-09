const cron = require('node-cron');
const db = require('../db');
const config = require('../config');
const { getCompanyDate } = require('../utils/timeUtils');

/**
 * Closes all open attendance records as auto-checkout
 */
async function runAutoCheckout() {
  try {
    const openAttendances = await db.query(
      `SELECT a.id, a.user_id, a.check_in_lat, a.check_in_lng, a.date, u.full_name
       FROM attendance a
       JOIN users u ON a.user_id = u.id
       WHERE a.status = 'checked_in'`
    );

    if (!openAttendances || openAttendances.length === 0) {
      return { closedCount: 0 };
    }

    console.log(`⏰ [AUTO-CHECKOUT] Processing ${openAttendances.length} open shift(s)...`);
    const nowIso = new Date().toISOString();
    let closedCount = 0;

    for (const att of openAttendances) {
      // Find last known location for this shift
      const lastPoint = await db.get(
        `SELECT latitude, longitude, accuracy 
         FROM location_tracks 
         WHERE attendance_id = ? 
         ORDER BY id DESC LIMIT 1`,
        [att.id]
      );

      const lat = lastPoint ? lastPoint.latitude : att.check_in_lat;
      const lng = lastPoint ? lastPoint.longitude : att.check_in_lng;
      const accuracy = lastPoint ? lastPoint.accuracy : null;

      await db.run(
        `UPDATE attendance SET
           check_out_time = ?,
           check_out_lat = ?,
           check_out_lng = ?,
           check_out_accuracy = ?,
           check_out_type = 'auto',
           status = 'auto_checked_out'
         WHERE id = ?`,
        [nowIso, lat, lng, accuracy, att.id]
      );

      // Create an alert noting auto-checkout
      const autoMsg = `Auto checked-out ${att.full_name} for shift on ${att.date} at last known location.`;
      await db.run(
        `INSERT INTO gps_alerts (user_id, alert_type, message, latitude, longitude, resolved)
         VALUES (?, 'AUTO_CHECKOUT', ?, ?, ?, 1)`,
        [att.user_id, autoMsg, lat, lng]
      );

      closedCount++;
    }

    console.log(`✅ [AUTO-CHECKOUT] Completed auto-checkout for ${closedCount} employee(s).`);
    return { closedCount };
  } catch (err) {
    console.error('Error running auto checkout:', err);
    return { error: err.message };
  }
}

/**
 * Initializes the auto-checkout cron job
 */
function initAutoCheckoutCron() {
  const timeSetting = config.AUTO_CHECKOUT_TIME || '21:00';
  const [hour, minute] = timeSetting.split(':').map((s) => s.trim());
  const cronExpr = `${minute || '0'} ${hour || '21'} * * *`;

  cron.schedule(
    cronExpr,
    async () => {
      console.log(`⏰ [CRON] Triggering scheduled auto-checkout (${timeSetting} ${config.COMPANY_TZ})...`);
      await runAutoCheckout();
    },
    {
      timezone: config.COMPANY_TZ || 'Asia/Kolkata',
    }
  );

  console.log(`⏰ Auto-checkout scheduler armed: ${cronExpr} (${config.COMPANY_TZ || 'Asia/Kolkata'})`);
}

module.exports = {
  runAutoCheckout,
  initAutoCheckoutCron,
};
