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

// Check-in (Requirements 6, 7, 19)
async function checkIn(req, res) {
  try {
    const userId = req.user.id;
    const { latitude, longitude, address } = req.body;

    if (latitude === undefined || longitude === undefined) {
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
      return res.status(400).json({
        error: 'You are already checked in. Please check out first.',
        attendanceId: existingActive.id,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const selfieFilename = req.file.filename;

    const result = await db.run(
      `INSERT INTO attendance (
        user_id, date, check_in_time, check_in_lat, check_in_lng, check_in_address, check_in_selfie, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'checked_in')`,
      [
        userId,
        today,
        nowIso,
        parseFloat(latitude),
        parseFloat(longitude),
        address || 'Recorded location',
        selfieFilename,
      ]
    );

    const attendanceId = result.lastID;

    // Also insert first location track point
    await db.run(
      `INSERT INTO location_tracks (
        user_id, attendance_id, latitude, longitude, accuracy, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, attendanceId, parseFloat(latitude), parseFloat(longitude), 10.0, nowIso]
    );

    const record = await db.get('SELECT * FROM attendance WHERE id = ?', [attendanceId]);

    return res.status(201).json({
      message: 'Check-in successful! Continuous GPS tracking started.',
      attendance: record,
    });
  } catch (error) {
    console.error('Check-in error:', error);
    return res.status(500).json({ error: 'Check-in failed', details: error.message });
  }
}

// Check-out (Requirements 6, 7, 9, 19)
async function checkOut(req, res) {
  try {
    const userId = req.user.id;
    const { latitude, longitude, address } = req.body;

    if (latitude === undefined || longitude === undefined) {
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
      return res.status(400).json({ error: 'No active check-in found to check out from.' });
    }

    const nowIso = new Date().toISOString();
    const selfieFilename = req.file.filename;

    await db.run(
      `UPDATE attendance SET 
        check_out_time = ?, 
        check_out_lat = ?, 
        check_out_lng = ?, 
        check_out_address = ?, 
        check_out_selfie = ?, 
        status = 'checked_out'
       WHERE id = ?`,
      [
        nowIso,
        parseFloat(latitude),
        parseFloat(longitude),
        address || 'Recorded location',
        selfieFilename,
        active.id,
      ]
    );

    // Final location track point
    await db.run(
      `INSERT INTO location_tracks (
        user_id, attendance_id, latitude, longitude, accuracy, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, active.id, parseFloat(latitude), parseFloat(longitude), 10.0, nowIso]
    );

    const updated = await db.get('SELECT * FROM attendance WHERE id = ?', [active.id]);

    return res.json({
      message: 'Check-out successful! GPS tracking stopped.',
      attendance: updated,
    });
  } catch (error) {
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
