const db = require('../db');

// Check current attendance state for logged in user
async function getCurrentStatus(req, res) {
  try {
    const userId = req.user.id;
    const active = await db.get(
      "SELECT * FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
      [userId]
    );

    // Also get last completed attendance today if any
    const today = new Date().toISOString().slice(0, 10);
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

const fs = require('fs');

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

// Check-in (Requirements 6, 7, 19)
async function checkIn(req, res) {
  try {
    const userId = req.user.id;
    const { latitude, longitude, address, accuracy, is_mocked } = req.body;

    if (latitude === undefined || longitude === undefined) {
      cleanupOrphanFile(req.file);
      return res.status(400).json({ error: 'GPS coordinates (latitude, longitude) are required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Selfie photo is required for check-in' });
    }

    // Check if already checked in
    const existingActive = await db.get(
      "SELECT id FROM attendance WHERE user_id = ? AND status = 'checked_in' LIMIT 1",
      [userId]
    );

    if (existingActive) {
      // Delete saved file when controller rejects request to prevent orphan files
      cleanupOrphanFile(req.file);
      return res.status(400).json({
        error: 'You are already checked in. Please check out first.',
        attendanceId: existingActive.id,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const selfieFilename = req.file.filename;

    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    const accNum = accuracy !== undefined && accuracy !== null && accuracy !== '' ? parseFloat(accuracy) : null;
    const isMockedVal = is_mocked === true || is_mocked === 'true' || is_mocked === 1 || is_mocked === '1' ? 1 : 0;

    const result = await db.run(
      `INSERT INTO attendance (
        user_id, date, check_in_time, check_in_lat, check_in_lng, check_in_accuracy, check_in_is_mocked, check_in_address, check_in_selfie, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked_in')`,
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
      ]
    );

    const attendanceId = result.lastID;

    // Also insert first location track point
    await db.run(
      `INSERT INTO location_tracks (
        user_id, attendance_id, latitude, longitude, accuracy, is_mocked, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, attendanceId, latNum, lngNum, accNum || 10.0, isMockedVal, nowIso]
    );

    const record = await db.get('SELECT * FROM attendance WHERE id = ?', [attendanceId]);

    return res.status(201).json({
      message: 'Check-in successful! Continuous GPS tracking started.',
      attendance: record,
    });
  } catch (error) {
    cleanupOrphanFile(req.file);
    console.error('Check-in error:', error);
    return res.status(500).json({ error: 'Check-in failed', details: error.message });
  }
}

// Check-out (Requirements 6, 7, 9, 19)
async function checkOut(req, res) {
  try {
    const userId = req.user.id;
    const { latitude, longitude, address, accuracy, is_mocked } = req.body;

    if (latitude === undefined || longitude === undefined) {
      cleanupOrphanFile(req.file);
      return res.status(400).json({ error: 'GPS coordinates (latitude, longitude) are required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Selfie photo is required for check-out' });
    }

    const active = await db.get(
      "SELECT * FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
      [userId]
    );

    if (!active) {
      // Delete saved file when controller rejects request to prevent orphan files
      cleanupOrphanFile(req.file);
      return res.status(400).json({ error: 'No active check-in found to check out from.' });
    }

    const nowIso = new Date().toISOString();
    const selfieFilename = req.file.filename;

    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    const accNum = accuracy !== undefined && accuracy !== null && accuracy !== '' ? parseFloat(accuracy) : null;
    const isMockedVal = is_mocked === true || is_mocked === 'true' || is_mocked === 1 || is_mocked === '1' ? 1 : 0;

    await db.run(
      `UPDATE attendance SET 
        check_out_time = ?, 
        check_out_lat = ?, 
        check_out_lng = ?, 
        check_out_accuracy = ?,
        check_out_is_mocked = ?,
        check_out_address = ?, 
        check_out_selfie = ?, 
        status = 'checked_out'
       WHERE id = ?`,
      [
        nowIso,
        latNum,
        lngNum,
        accNum,
        isMockedVal,
        address || 'Recorded location',
        selfieFilename,
        active.id,
      ]
    );

    // Final location track point
    await db.run(
      `INSERT INTO location_tracks (
        user_id, attendance_id, latitude, longitude, accuracy, is_mocked, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, active.id, latNum, lngNum, accNum || 10.0, isMockedVal, nowIso]
    );

    const updated = await db.get('SELECT * FROM attendance WHERE id = ?', [active.id]);

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
