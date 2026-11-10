const db = require('../db');
const { normalizeTimestamp } = require('../utils/timeUtils');
const {
  normalizeLocationSource,
  normalizeLocationStatus,
  evaluateLocationStatus,
  resolveCellTowerCoordinates,
} = require('../services/cellularPositioningService');

// Continuous location ping (single point or batch of points)
async function recordLocation(req, res) {
  try {
    const userId = req.user.id;
    const body = req.body;

    if (body.app_version) {
      db.run("UPDATE users SET app_version = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?", [body.app_version, userId]).catch(() => {});
    } else {
      db.run("UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?", [userId]).catch(() => {});
    }

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
          let safeTs;
          try {
            safeTs = normalizeTimestamp(loc.timestamp || loc.captured_at);
          } catch (_) {
            continue; // Skip invalid or future timestamps
          }
          const accuracyVal = loc.accuracy != null && loc.accuracy !== '' ? parseFloat(loc.accuracy) : null;
          const locSource = normalizeLocationSource(loc.location_source, accuracyVal);
          const battVal = loc.battery_percentage !== undefined ? loc.battery_percentage : loc.battery_level;
          const netStatus = loc.network_status || null;
          const permStatus = loc.location_permission_status || 'granted';
          const servEnabled = loc.location_services_enabled !== undefined ? (loc.location_services_enabled ? 1 : 0) : (loc.is_gps_off ? 0 : 1);
          const locStatus = loc.location_status
            ? normalizeLocationStatus(loc.location_status)
            : evaluateLocationStatus({
                locationSource: locSource,
                timestamp: safeTs,
                accuracy: accuracyVal,
                isGpsOff: servEnabled === 0,
                locationServicesEnabled: servEnabled === 1,
              });
          const cellNetType = loc.cell_network_type || null;
          const provAcc = loc.provider_accuracy !== undefined && loc.provider_accuracy !== null ? parseFloat(loc.provider_accuracy) : accuracyVal;
          const uploadStat = loc.upload_status || 'ONLINE';
          const intReason = loc.interruption_reason || null;

          await db.run(
            `INSERT INTO location_tracks (
              user_id, attendance_id, latitude, longitude, accuracy, speed, altitude, battery_level, is_gps_off, is_mocked,
              location_source, battery_percentage, network_status, location_permission_status, location_services_enabled,
              location_status, cell_network_type, provider_accuracy, upload_status, interruption_reason, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              activeAttendance ? activeAttendance.id : null,
              loc.latitude,
              loc.longitude,
              accuracyVal,
              loc.speed || null,
              loc.altitude || null,
              battVal || null,
              servEnabled === 0 ? 1 : 0,
              isMock,
              locSource,
              battVal || null,
              netStatus,
              permStatus,
              servEnabled,
              locStatus,
              cellNetType,
              provAcc,
              uploadStat,
              intReason,
              safeTs,
            ]
          );
        }
      }
      return res.json({ success: true, count: body.locations.length });
    }

    // Single location point
    const {
      latitude,
      longitude,
      accuracy,
      speed,
      altitude,
      battery_level,
      battery_percentage,
      is_gps_off,
      is_mocked,
      timestamp,
      location_source = 'GPS',
      location_status,
      cell_network_type = null,
      provider_accuracy = null,
      upload_status = 'ONLINE',
      interruption_reason = null,
      network_status = null,
      location_permission_status = 'granted',
      location_services_enabled,
    } = body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    let normalizedTs;
    try {
      normalizedTs = normalizeTimestamp(timestamp);
    } catch (tsErr) {
      return res.status(400).json({ error: tsErr.message });
    }

    const isMockSingle = is_mocked === true || is_mocked === 'true' || is_mocked === 1 || is_mocked === '1' ? 1 : 0;
    const battSingle = battery_percentage !== undefined ? battery_percentage : battery_level;
    const servEnabledSingle = location_services_enabled !== undefined ? (location_services_enabled ? 1 : 0) : (is_gps_off ? 0 : 1);
    const accuracyNum = accuracy != null && accuracy !== '' ? parseFloat(accuracy) : null;
    const locSourceSingle = normalizeLocationSource(location_source, accuracyNum);
    const locStatusSingle = location_status
      ? normalizeLocationStatus(location_status)
      : evaluateLocationStatus({
          locationSource: locSourceSingle,
          timestamp: normalizedTs,
          accuracy: accuracyNum,
          isGpsOff: servEnabledSingle === 0,
          locationServicesEnabled: servEnabledSingle === 1,
        });

    await db.run(
      `INSERT INTO location_tracks (
        user_id, attendance_id, latitude, longitude, accuracy, speed, altitude, battery_level, is_gps_off, is_mocked,
        location_source, battery_percentage, network_status, location_permission_status, location_services_enabled,
        location_status, cell_network_type, provider_accuracy, upload_status, interruption_reason, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        activeAttendance ? activeAttendance.id : null,
        latitude,
        longitude,
        accuracyNum,
        speed || null,
        altitude || null,
        battSingle || null,
        servEnabledSingle === 0 ? 1 : 0,
        isMockSingle,
        locSourceSingle,
        battSingle || null,
        network_status,
        location_permission_status,
        servEnabledSingle,
        locStatusSingle,
        cell_network_type,
        provider_accuracy !== null ? parseFloat(provider_accuracy) : accuracyNum,
        upload_status,
        interruption_reason,
        normalizedTs,
      ]
    );

    return res.json({
      success: true,
      activeTracking: !!activeAttendance,
      locationSource: locSourceSingle,
      locationStatus: locStatusSingle,
      message: 'Location recorded',
    });
  } catch (error) {
    console.error('recordLocation error:', error);
    return res.status(500).json({ error: 'Failed to record location', details: error.message });
  }
}

const { sendAlertPush } = require('../services/fcmService');

// Notify GPS / Location status changed with detailed interruption taxonomy
async function reportGpsStatus(req, res) {
  try {
    const userId = req.user.id;
    let { status, alert_type, message, latitude, longitude, interruption_reason } = req.body;

    const rawStatus = (status || alert_type || 'GPS_DISABLED').toString().trim().toUpperCase();

    // Map into canonical alert types
    let mappedAlertType = 'GPS_DISABLED';
    let defaultMsg = `${req.user.full_name} turned device Location / GPS OFF`;

    if (rawStatus === 'RESTORED' || rawStatus === 'GPS_RESTORED') {
      mappedAlertType = 'GPS_RESTORED';
      defaultMsg = `${req.user.full_name} turned Location / GPS back ON`;
    } else if (rawStatus === 'LOCATION_PERMISSION_REVOKED') {
      mappedAlertType = 'LOCATION_PERMISSION_REVOKED';
      defaultMsg = `${req.user.full_name} revoked Location permissions`;
    } else if (rawStatus === 'BACKGROUND_PERMISSION_RESTRICTED') {
      mappedAlertType = 'BACKGROUND_PERMISSION_RESTRICTED';
      defaultMsg = `${req.user.full_name} restricted background location access`;
    } else if (rawStatus === 'GPS_UNAVAILABLE') {
      mappedAlertType = 'GPS_UNAVAILABLE';
      defaultMsg = `Satellite GPS reception unavailable for ${req.user.full_name}. Network positioning active.`;
    } else if (rawStatus === 'NO_NETWORK_CONNECTIVITY' || rawStatus === 'DEVICE_OFFLINE') {
      mappedAlertType = 'NO_SIGNAL';
      defaultMsg = `No network connectivity from ${req.user.full_name}`;
    } else if (rawStatus === 'LOCATION_SERVICES_DISABLED' || rawStatus === 'DISABLED' || rawStatus === 'GPS_DISABLED') {
      mappedAlertType = 'GPS_DISABLED';
      defaultMsg = `${req.user.full_name} turned off system Location Services`;
    } else if (rawStatus === 'LOCATION_UNAVAILABLE') {
      mappedAlertType = 'LOCATION_UNAVAILABLE';
      defaultMsg = `Location unavailable for ${req.user.full_name}`;
    }

    const finalInterruptionReason = interruption_reason || rawStatus;

    if (mappedAlertType === 'GPS_RESTORED') {
      // 1. Resolve previous open alerts for this user
      await db.run(
        `UPDATE gps_alerts SET resolved = 1 WHERE user_id = ? AND resolved = 0`,
        [userId]
      );

      // Record RESTORED entry
      await db.run(
        `INSERT INTO gps_alerts (user_id, alert_type, message, latitude, longitude, resolved)
         VALUES (?, 'GPS_RESTORED', ?, ?, ?, 1)`,
        [userId, message || defaultMsg, latitude || null, longitude || null]
      );

      return res.status(200).json({
        success: true,
        resolved: true,
        message: 'GPS / Location status restored',
        alertType: mappedAlertType,
      });
    } else {
      // 2. Server deduplication for open alerts
      const openAlert = await db.get(
        `SELECT id FROM gps_alerts WHERE user_id = ? AND alert_type = ? AND resolved = 0 LIMIT 1`,
        [userId, mappedAlertType]
      );

      if (!openAlert) {
        const parsedLat = latitude !== undefined && latitude !== null ? parseFloat(latitude) : NaN;
        const parsedLng = longitude !== undefined && longitude !== null ? parseFloat(longitude) : NaN;
        const safeLat = isNaN(parsedLat) ? null : parsedLat;
        const safeLng = isNaN(parsedLng) ? null : parsedLng;

        await db.run(
          `INSERT INTO gps_alerts (user_id, alert_type, message, latitude, longitude, resolved)
           VALUES (?, ?, ?, ?, ?, 0)`,
          [userId, mappedAlertType, message || defaultMsg, safeLat, safeLng]
        );

        // Push alert to admin
        await sendAlertPush({
          title: `Location Alert: ${req.user.full_name}`,
          body: message || defaultMsg,
          data: {
            userId: String(userId),
            alertType: mappedAlertType,
          },
        });
      }
    }

    // Insert track marker preserving last known coordinate with UNAVAILABLE status
    const parsedTrackLat = latitude !== undefined && latitude !== null ? parseFloat(latitude) : NaN;
    const parsedTrackLng = longitude !== undefined && longitude !== null ? parseFloat(longitude) : NaN;
    if (!isNaN(parsedTrackLat) && !isNaN(parsedTrackLng)) {
      const activeAttendance = await db.get(
        "SELECT id FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
        [userId]
      );
      await db.run(
        `INSERT INTO location_tracks (
          user_id, attendance_id, latitude, longitude, is_gps_off, location_source, location_status, interruption_reason, timestamp
        ) VALUES (?, ?, ?, ?, ?, 'LAST_KNOWN', 'UNAVAILABLE', ?, ?)`,
        [
          userId,
          activeAttendance ? activeAttendance.id : null,
          parsedTrackLat,
          parsedTrackLng,
          1,
          finalInterruptionReason,
          new Date().toISOString(),
        ]
      );
    }

    return res.status(201).json({
      success: true,
      status: 'OPEN',
      message: 'Location interruption alert registered',
      alertType: mappedAlertType,
      interruptionReason: finalInterruptionReason,
    });
  } catch (error) {
    console.error('reportGpsStatus error:', error);
    return res.status(500).json({ error: 'Failed to record location alert', details: error.message });
  }
}

// Batch location tracks (Phase 4 SQLite Outbox flush)
// Uses one transaction, idempotent via UNIQUE(user_id, client_point_id)
async function recordLocationBatch(req, res) {
  try {
    const userId = req.user.id;
    const body = req.body;

    if (body.app_version) {
      db.run("UPDATE users SET app_version = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?", [body.app_version, userId]).catch(() => {});
    } else {
      db.run("UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?", [userId]).catch(() => {});
    }
    const points = Array.isArray(body.points) ? body.points : body.locations;

    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ error: 'Array of points required in body.points' });
    }

    const activeAttendance = await db.get(
      "SELECT id FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
      [userId]
    );

    let insertedCount = 0;
    for (const pt of points) {
      if (pt.latitude === undefined || pt.longitude === undefined) continue;

      const clientPointId = pt.client_point_id || null;
      let capturedAt;
      try {
        capturedAt = normalizeTimestamp(pt.captured_at || pt.timestamp);
      } catch (_) {
        continue; // Skip points with future/invalid timestamps
      }
      const isMock = pt.is_mocked === true || pt.is_mocked === 'true' || pt.is_mocked === 1 || pt.is_mocked === '1' ? 1 : 0;
      const isGpsOff = pt.is_gps_off ? 1 : 0;
      const lat = parseFloat(pt.latitude);
      const lng = parseFloat(pt.longitude);
      const accuracy = pt.accuracy != null && pt.accuracy !== '' ? parseFloat(pt.accuracy) : null;
      const speed = pt.speed != null && pt.speed !== '' ? parseFloat(pt.speed) : null;
      const batteryLevel = pt.battery_level != null && pt.battery_level !== '' ? parseFloat(pt.battery_level) : null;
      const locSource = normalizeLocationSource(pt.location_source, accuracy);
      const locStatus = pt.location_status
        ? normalizeLocationStatus(pt.location_status)
        : evaluateLocationStatus({
            locationSource: locSource,
            timestamp: capturedAt,
            accuracy,
            isGpsOff: isGpsOff === 1,
            locationServicesEnabled: isGpsOff === 0,
          });
      const cellNetType = pt.cell_network_type || null;
      const provAcc = pt.provider_accuracy !== undefined && pt.provider_accuracy !== null ? parseFloat(pt.provider_accuracy) : accuracy;
      const uploadStat = pt.upload_status || 'ONLINE';
      const intReason = pt.interruption_reason || null;
      const netStatus = pt.network_status || null;

      try {
        if (clientPointId) {
          // Idempotent insertion
          await db.run(
            `INSERT OR IGNORE INTO location_tracks (
              user_id, attendance_id, client_point_id, latitude, longitude, accuracy, speed, battery_level, is_gps_off, is_mocked,
              location_source, location_status, cell_network_type, provider_accuracy, upload_status, interruption_reason,
              battery_percentage, network_status, location_services_enabled, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              activeAttendance ? activeAttendance.id : null,
              clientPointId,
              lat,
              lng,
              accuracy,
              speed,
              batteryLevel,
              isGpsOff,
              isMock,
              locSource,
              locStatus,
              cellNetType,
              provAcc,
              uploadStat,
              intReason,
              batteryLevel,
              netStatus,
              isGpsOff === 1 ? 0 : 1,
              capturedAt,
            ]
          );
        } else {
          await db.run(
            `INSERT INTO location_tracks (
              user_id, attendance_id, latitude, longitude, accuracy, speed, battery_level, is_gps_off, is_mocked,
              location_source, location_status, cell_network_type, provider_accuracy, upload_status, interruption_reason,
              battery_percentage, network_status, location_services_enabled, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              activeAttendance ? activeAttendance.id : null,
              lat,
              lng,
              accuracy,
              speed,
              batteryLevel,
              isGpsOff,
              isMock,
              locSource,
              locStatus,
              cellNetType,
              provAcc,
              uploadStat,
              intReason,
              batteryLevel,
              netStatus,
              isGpsOff === 1 ? 0 : 1,
              capturedAt,
            ]
          );
        }
        insertedCount++;
      } catch (insertErr) {
        // Ignore duplicate client_point_id collisions safely
        console.warn('Track point collision/insert note:', insertErr.message);
      }
    }

    return res.json({
      success: true,
      count: insertedCount,
      activeTracking: !!activeAttendance,
      message: `${insertedCount} location points recorded`,
    });
  } catch (error) {
    console.error('recordLocationBatch error:', error);
    return res.status(500).json({ error: 'Failed to record batch locations', details: error.message });
  }
}

module.exports = {
  recordLocation,
  recordLocationBatch,
  reportGpsStatus,
};
