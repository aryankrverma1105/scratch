const db = require('../db');
const fs = require('fs');
const { getCompanyDate } = require('../utils/timeUtils');
const { evaluateGeofence } = require('../utils/geofenceUtils');
const { logActivity } = require('../services/activityLogger');

// Check current attendance state for logged in user
async function getCurrentStatus(req, res) {
  try {
    const userId = req.user.id;
    const active = await db.get(
      "SELECT * FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
      [userId]
    );

    // Also get last completed attendance today if any
    const today = getCompanyDate();
    const todayLatest = await db.get(
      "SELECT * FROM attendance WHERE user_id = ? AND date = ? ORDER BY id DESC LIMIT 1",
      [userId, today]
    );

    return res.json({
      isCheckedIn: !!active,
      activeAttendance: active || null,
      latestToday: todayLatest || null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch status', details: error.message });
  }
}

// Helper to remove orphan files if request is rejected or fails
function cleanupOrphanFile(file) {
  if (file && file.path) {
    fs.unlink(file.path, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error('Failed to remove orphan selfie file:', file.path, err.message);
      }
    });
  }
}

// Check-in (Requirements 6, 7, 19, Geofencing, Multi-Office)
async function checkIn(req, res) {
  try {
    const userId = req.user.id;
    const {
      latitude,
      longitude,
      address,
      accuracy,
      is_mocked,
      location_source = 'GPS',
      battery_percentage = null,
      network_status = null,
      outside_reason = null,
      app_version = null,
    } = req.body;

    if (latitude === undefined || longitude === undefined) {
      cleanupOrphanFile(req.file);
      return res.status(400).json({ error: 'GPS coordinates (latitude, longitude) are required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Selfie photo is required for check-in' });
    }

    const today = getCompanyDate();
    const nowIso = new Date().toISOString();

    // Check if user has an active check-in
    const existingActive = await db.get(
      "SELECT * FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
      [userId]
    );

    if (existingActive) {
      if (existingActive.date !== today) {
        // Auto-close open attendance from previous day first
        console.log(`Auto-closing previous day (${existingActive.date}) shift for user ${userId}`);
        const lastPoint = await db.get(
          `SELECT latitude, longitude, accuracy FROM location_tracks WHERE attendance_id = ? ORDER BY id DESC LIMIT 1`,
          [existingActive.id]
        );
        const autoLat = lastPoint ? lastPoint.latitude : existingActive.check_in_lat;
        const autoLng = lastPoint ? lastPoint.longitude : existingActive.check_in_lng;
        await db.run(
          `UPDATE attendance SET
             check_out_time = ?,
             check_out_lat = ?,
             check_out_lng = ?,
             check_out_accuracy = ?,
             check_out_type = 'auto_previous_day',
             status = 'auto_checked_out'
           WHERE id = ?`,
          [nowIso, autoLat, autoLng, lastPoint ? lastPoint.accuracy : null, existingActive.id]
        );
        await db.run(
          `INSERT INTO gps_alerts (user_id, alert_type, message, latitude, longitude, resolved)
           VALUES (?, 'AUTO_CHECKOUT', ?, ?, ?, 1)`,
          [userId, `Auto-closed open shift from previous day (${existingActive.date}) on new check-in`, autoLat, autoLng]
        );
      } else {
        // Still checked in today
        cleanupOrphanFile(req.file);
        return res.status(400).json({
          error: 'You are already checked in. Please check out first.',
          attendanceId: existingActive.id,
        });
      }
    }

    const selfieFilename = req.file.filename;
    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    const accNum = accuracy !== undefined && accuracy !== null && accuracy !== '' ? parseFloat(accuracy) : null;
    const isMockedVal = is_mocked === true || is_mocked === 'true' || is_mocked === 1 || is_mocked === '1' ? 1 : 0;
    const batteryNum = battery_percentage !== undefined && battery_percentage !== null ? parseFloat(battery_percentage) : null;
    const locSource = ['GPS', 'NETWORK', 'CELL_NETWORK', 'CELL_TOWER', 'FUSED', 'LAST_KNOWN', 'WIFI_NETWORK'].includes(String(location_source).toUpperCase())
      ? String(location_source).toUpperCase()
      : 'GPS';

    // Update user app_version & telemetry if passed
    if (app_version) {
      db.run("UPDATE users SET app_version = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?", [app_version, userId]).catch(() => {});
    }

    // 1. Geofence evaluation against active offices
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    const activeOffices = await db.query("SELECT * FROM offices WHERE status = 'active' ORDER BY office_name ASC");

    const geofenceResult = evaluateGeofence({
      latitude: latNum,
      longitude: lngNum,
      accuracy: accNum,
      locationSource: locSource,
      user,
      activeOffices,
    });

    const isInside = geofenceResult.isInside;
    const nearestOffice = geofenceResult.nearestOffice;
    const officeId = nearestOffice ? nearestOffice.id : null;
    const distMeters = geofenceResult.distanceFromNearest;

    // Review status:
    // If inside: review_status = 'approved' (immediately approved), geofence_status = 'inside'
    // If outside: review_status = 'pending_review', geofence_status = 'outside'
    const geofenceStatus = isInside ? 'inside' : 'outside';
    const reviewStatus = isInside ? 'approved' : 'pending_review';

    let result;
    try {
      result = await db.run(
        `INSERT INTO attendance (
          user_id, date, check_in_time, check_in_lat, check_in_lng, check_in_accuracy,
          check_in_is_mocked, check_in_address, check_in_selfie, status,
          geofence_status, review_status, office_id, distance_from_office,
          location_source, battery_percentage, network_status, outside_reason, app_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          today,
          nowIso,
          latNum,
          lngNum,
          accNum,
          isMockedVal,
          address || 'Recorded location',
          selfieFilename,
          geofenceStatus,
          reviewStatus,
          officeId,
          distMeters,
          locSource,
          batteryNum,
          network_status ? String(network_status).substring(0, 50) : null,
          outside_reason ? String(outside_reason).trim() : null,
          app_version ? String(app_version).trim() : null,
        ]
      );
    } catch (insertErr) {
      if (insertErr.message && insertErr.message.includes('app_version')) {
        await db.run("ALTER TABLE attendance ADD COLUMN app_version VARCHAR(50)").catch(() => {});
        result = await db.run(
          `INSERT INTO attendance (
            user_id, date, check_in_time, check_in_lat, check_in_lng, check_in_accuracy,
            check_in_is_mocked, check_in_address, check_in_selfie, status,
            geofence_status, review_status, office_id, distance_from_office,
            location_source, battery_percentage, network_status, outside_reason, app_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            today,
            nowIso,
            latNum,
            lngNum,
            accNum,
            isMockedVal,
            address || 'Recorded location',
            selfieFilename,
            geofenceStatus,
            reviewStatus,
            officeId,
            distMeters,
            locSource,
            batteryNum,
            network_status ? String(network_status).substring(0, 50) : null,
            outside_reason ? String(outside_reason).trim() : null,
            app_version ? String(app_version).trim() : null,
          ]
        );
      } else {
        throw insertErr;
      }
    }

    const attendanceId = result.lastID;

    // 2. Insert geofence attendance evidence
    await db.run(
      `INSERT INTO geofence_attendance_evidence (
        attendance_id, employee_id, office_id, submitted_latitude, submitted_longitude,
        distance_from_office, accuracy_meters, location_source, geofence_result,
        review_status, outside_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attendanceId,
        userId,
        officeId,
        latNum,
        lngNum,
        distMeters,
        accNum,
        locSource,
        geofenceResult.geofenceResult,
        reviewStatus,
        outside_reason ? String(outside_reason).trim() : null,
        nowIso,
      ]
    );

    // 3. Insert location track point
    await db.run(
      `INSERT INTO location_tracks (
        user_id, attendance_id, latitude, longitude, accuracy, is_mocked,
        location_source, battery_percentage, network_status, location_permission_status,
        location_services_enabled, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'granted', 1, ?)`,
      [
        userId,
        attendanceId,
        latNum,
        lngNum,
        accNum || 10.0,
        isMockedVal,
        locSource,
        batteryNum,
        network_status ? String(network_status).substring(0, 50) : null,
        nowIso,
      ]
    );

    // 4. Alert admin if check-in is outside geofence
    if (!isInside) {
      const officeName = nearestOffice ? nearestOffice.office_name : 'authorized office';
      const outsideMsg = `${user ? user.full_name : `User #${userId}`} checked in outside authorized geofence (${Math.round(distMeters)}m from ${officeName}). Pending admin review.`;
      await db.run(
        `INSERT INTO gps_alerts (user_id, alert_type, message, latitude, longitude, resolved)
         VALUES (?, 'GEOFENCE_VIOLATION', ?, ?, ?, 0)`,
        [userId, outsideMsg, latNum, lngNum]
      );
    }

    const record = await db.get('SELECT * FROM attendance WHERE id = ?', [attendanceId]);

    const message = isInside
      ? 'Check-in successful! Continuous GPS tracking started.'
      : 'Your attendance has been submitted for admin approval because you are outside the authorized office location.';

    return res.status(201).json({
      message,
      isPendingReview: !isInside,
      geofenceStatus,
      reviewStatus,
      distanceFromOffice: distMeters,
      nearestOffice: nearestOffice ? { id: nearestOffice.id, name: nearestOffice.office_name } : null,
      attendance: record,
    });
  } catch (error) {
    cleanupOrphanFile(req.file);
    console.error('Check-in error:', error);
    return res.status(500).json({ error: 'Check-in failed', details: error.message });
  }
}

// Check-out (Geofencing is strictly NOT required during checkout)
async function checkOut(req, res) {
  try {
    const userId = req.user.id;
    const {
      latitude,
      longitude,
      address,
      accuracy,
      is_mocked,
      captured_at = null,
      location_source = 'GPS',
      battery_percentage = null,
      network_status = null,
    } = req.body;

    if (latitude === undefined || longitude === undefined) {
      cleanupOrphanFile(req.file);
      return res.status(400).json({ error: 'GPS coordinates (latitude, longitude) are required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Selfie photo is required for check-out' });
    }

    const today = getCompanyDate();
    const nowIso = new Date().toISOString();
    const checkOutTimestamp = captured_at ? new Date(captured_at).toISOString() : nowIso;
    const selfieFilename = req.file.filename;

    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    const accNum = accuracy !== undefined && accuracy !== null && accuracy !== '' ? parseFloat(accuracy) : null;
    const isMockedVal = is_mocked === true || is_mocked === 'true' || is_mocked === 1 || is_mocked === '1' ? 1 : 0;
    const batteryNum = battery_percentage !== undefined && battery_percentage !== null ? parseFloat(battery_percentage) : null;
    const locSource = ['GPS', 'NETWORK', 'FUSED', 'LAST_KNOWN'].includes(String(location_source).toUpperCase())
      ? String(location_source).toUpperCase()
      : 'GPS';

    // Look for active check-in session
    let targetAttendance = await db.get(
      "SELECT * FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
      [userId]
    );

    // If no active session found, check if a shift on this date was automatically closed at 9 PM
    // (Offline checkout reconciliation support)
    if (!targetAttendance) {
      targetAttendance = await db.get(
        "SELECT * FROM attendance WHERE user_id = ? AND date = ? AND status = 'auto_checked_out' ORDER BY id DESC LIMIT 1",
        [userId, today]
      );
    }

    if (!targetAttendance) {
      cleanupOrphanFile(req.file);
      return res.status(400).json({ error: 'No active check-in found to check out from.' });
    }

    await db.run(
      `UPDATE attendance SET 
        check_out_time = ?, 
        check_out_lat = ?, 
        check_out_lng = ?, 
        check_out_accuracy = ?,
        check_out_is_mocked = ?,
        check_out_address = ?, 
        check_out_selfie = ?, 
        check_out_type = 'manual',
        status = 'checked_out'
       WHERE id = ?`,
      [
        checkOutTimestamp,
        latNum,
        lngNum,
        accNum,
        isMockedVal,
        address || 'Recorded location',
        selfieFilename,
        targetAttendance.id,
      ]
    );

    // Final location track point
    await db.run(
      `INSERT INTO location_tracks (
        user_id, attendance_id, latitude, longitude, accuracy, is_mocked,
        location_source, battery_percentage, network_status, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        targetAttendance.id,
        latNum,
        lngNum,
        accNum || 10.0,
        isMockedVal,
        locSource,
        batteryNum,
        network_status ? String(network_status).substring(0, 50) : null,
        checkOutTimestamp,
      ]
    );

    const updated = await db.get('SELECT * FROM attendance WHERE id = ?', [targetAttendance.id]);

    return res.json({
      message: 'Check-out successful! GPS tracking stopped.',
      attendance: updated,
    });
  } catch (error) {
    cleanupOrphanFile(req.file);
    console.error('Check-out error:', error);
    return res.status(500).json({ error: 'Check-out failed', details: error.message });
  }
}

// User's own attendance history
async function getMyHistory(req, res) {
  try {
    const userId = req.user.id;
    const records = await db.query(
      'SELECT * FROM attendance WHERE user_id = ? ORDER BY check_in_time DESC LIMIT 60',
      [userId]
    );
    return res.json({ records });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch attendance history', details: error.message });
  }
}

module.exports = {
  getCurrentStatus,
  checkIn,
  checkOut,
  getMyHistory,
};
