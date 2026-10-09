const db = require('../db');

// Continuous location ping (single point or batch of points)
async function recordLocation(req, res) {
  try {
    const userId = req.user.id;
    const body = req.body;

    // Check if user currently has an active check-in
    const activeAttendance = await db.get(
      "SELECT id FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
      [userId]
    );

    // If batch of locations (e.g. offline queue flushed)
    if (Array.isArray(body.locations)) {
      for (const loc of body.locations) {
        if (loc.latitude !== undefined && loc.longitude !== undefined) {
          const isMock = loc.is_mocked === true || loc.is_mocked === 'true' || loc.is_mocked === 1 || loc.is_mocked === '1' ? 1 : 0;
          await db.run(
            `INSERT INTO location_tracks (
              user_id, attendance_id, latitude, longitude, accuracy, speed, altitude, battery_level, is_gps_off, is_mocked, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              activeAttendance ? activeAttendance.id : null,
              loc.latitude,
              loc.longitude,
              loc.accuracy || null,
              loc.speed || null,
              loc.altitude || null,
              loc.battery_level || null,
              loc.is_gps_off ? 1 : 0,
              isMock,
              loc.timestamp || new Date().toISOString(),
            ]
          );
        }
      }
      return res.json({ success: true, count: body.locations.length });
    }

    // Single location point
    const { latitude, longitude, accuracy, speed, altitude, battery_level, is_gps_off, is_mocked, timestamp } = body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const isMockSingle = is_mocked === true || is_mocked === 'true' || is_mocked === 1 || is_mocked === '1' ? 1 : 0;

    await db.run(
      `INSERT INTO location_tracks (
        user_id, attendance_id, latitude, longitude, accuracy, speed, altitude, battery_level, is_gps_off, is_mocked, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        activeAttendance ? activeAttendance.id : null,
        latitude,
        longitude,
        accuracy || null,
        speed || null,
        altitude || null,
        battery_level || null,
        is_gps_off ? 1 : 0,
        isMockSingle,
        timestamp || new Date().toISOString(),
      ]
    );

    return res.json({
      success: true,
      activeTracking: !!activeAttendance,
      message: 'Location recorded',
    });
  } catch (error) {
    console.error('recordLocation error:', error);
    return res.status(500).json({ error: 'Failed to record location', details: error.message });
  }
}

// Notify GPS status changed (e.g. employee turned off GPS or permission revoked) (Requirement 14, 15)
async function reportGpsStatus(req, res) {
  try {
    const userId = req.user.id;
    const { status, message, latitude, longitude } = req.body; // status: 'DISABLED' | 'RESTORED' | 'PERMISSION_DENIED'

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const alertType = status === 'DISABLED'
      ? 'GPS_DISABLED'
      : status === 'RESTORED'
      ? 'GPS_RESTORED'
      : 'LOCATION_PERMISSION_REVOKED';

    const defaultMsg = status === 'DISABLED'
      ? `${req.user.full_name} turned GPS/Location OFF during duty hours`
      : status === 'RESTORED'
      ? `${req.user.full_name} turned GPS/Location back ON`
      : `${req.user.full_name} revoked location permission`;

    await db.run(
      `INSERT INTO gps_alerts (user_id, alert_type, message, latitude, longitude, resolved)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        alertType,
        message || defaultMsg,
        latitude || null,
        longitude || null,
        status === 'RESTORED' ? 1 : 0,
      ]
    );

    // Also insert a track marker noting GPS turned off/on
    if (latitude !== undefined && longitude !== undefined) {
      const activeAttendance = await db.get(
        "SELECT id FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
        [userId]
      );
      await db.run(
        `INSERT INTO location_tracks (
          user_id, attendance_id, latitude, longitude, is_gps_off, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          activeAttendance ? activeAttendance.id : null,
          latitude,
          longitude,
          status === 'DISABLED' ? 1 : 0,
          new Date().toISOString(),
        ]
      );
    }

    return res.json({
      success: true,
      message: 'GPS status alert registered',
      alertType,
    });
  } catch (error) {
    console.error('reportGpsStatus error:', error);
    return res.status(500).json({ error: 'Failed to record GPS alert', details: error.message });
  }
}

module.exports = {
  recordLocation,
  reportGpsStatus,
};
