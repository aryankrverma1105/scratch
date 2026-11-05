const db = require('../db');
const { logActivity } = require('../services/activityLogger');
const { sendPushNotification } = require('../services/fcmService');
const { formatIstDateTime } = require('../utils/timeUtils');

/**
 * List pending attendance reviews (Admin endpoint)
 */
async function listPendingReviews(req, res) {
  try {
    const { search, office_id, department, date } = req.query;

    let sql = `
      SELECT a.id, a.user_id, a.date, a.check_in_time, a.check_in_lat, a.check_in_lng,
             a.check_in_accuracy, a.check_in_address, a.check_in_selfie, a.check_out_time,
             a.status, a.geofence_status, a.review_status, a.review_reason, a.office_id,
             a.distance_from_office, a.location_source, a.outside_reason, a.battery_percentage,
             a.network_status, a.created_at,
             u.full_name as employee_name, u.email as employee_email, u.department as employee_department,
             u.phone as employee_phone,
             o.office_name, o.address as office_address, o.radius_meters as office_radius,
             e.distance_from_office as calculated_distance, e.geofence_result
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN offices o ON a.office_id = o.id
      LEFT JOIN geofence_attendance_evidence e ON a.id = e.attendance_id
      WHERE a.review_status = 'pending_review'
    `;
    const params = [];

    if (office_id) {
      sql += ' AND a.office_id = ?';
      params.push(parseInt(office_id, 10));
    }
    if (department && department.trim()) {
      sql += ' AND LOWER(u.department) = ?';
      params.push(department.trim().toLowerCase());
    }
    if (date && date.trim()) {
      sql += ' AND a.date = ?';
      params.push(date.trim());
    }
    if (search && search.trim()) {
      sql += ' AND (LOWER(u.full_name) LIKE ? OR LOWER(u.email) LIKE ?)';
      const term = `%${search.trim().toLowerCase()}%`;
      params.push(term, term);
    }

    sql += ' ORDER BY a.id DESC';
    const reviews = await db.query(sql, params);

    return res.json({ reviews, count: reviews.length });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list pending reviews', details: err.message });
  }
}

/**
 * Approve an outside-geofence attendance request
 */
async function approveReview(req, res) {
  try {
    const attendanceId = parseInt(req.params.id, 10);
    const adminId = req.user.id;
    const { note } = req.body;

    const attendance = await db.get(
      'SELECT a.*, u.full_name, u.email FROM attendance a JOIN users u ON a.user_id = u.id WHERE a.id = ?',
      [attendanceId]
    );

    if (!attendance) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    // Security check: Employee cannot approve their own attendance
    if (attendance.user_id === adminId) {
      return res.status(403).json({ error: 'Security violation: You cannot approve your own attendance' });
    }

    if (attendance.review_status !== 'pending_review') {
      return res.status(400).json({
        error: `Cannot approve attendance; current review status is "${attendance.review_status}"`,
      });
    }

    const nowIso = new Date().toISOString();
    const approvalNote = note && note.trim() ? note.trim() : 'Approved by administrator';

    // 1. Update attendance table
    await db.run(
      `UPDATE attendance SET
         review_status = 'approved',
         review_reason = ?,
         reviewed_by = ?,
         reviewed_at = ?,
         geofence_status = 'approved'
       WHERE id = ?`,
      [approvalNote, adminId, nowIso, attendanceId]
    );

    // 2. Update geofence_attendance_evidence if exists
    await db.run(
      `UPDATE geofence_attendance_evidence SET
         review_status = 'approved',
         review_reason = ?,
         reviewed_by = ?,
         reviewed_at = ?
       WHERE attendance_id = ?`,
      [approvalNote, adminId, nowIso, attendanceId]
    );

    // 3. Insert review history audit
    await db.run(
      `INSERT INTO attendance_review_history (
         attendance_id, employee_id, admin_id, previous_status, new_status, reason, created_at
       ) VALUES (?, ?, ?, 'pending_review', 'approved', ?, ?)`,
      [attendanceId, attendance.user_id, adminId, approvalNote, nowIso]
    );

    // 4. Resolve associated GPS alert if present
    await db.run(
      `UPDATE gps_alerts SET resolved = 1 WHERE user_id = ? AND alert_type = 'GEOFENCE_VIOLATION' AND resolved = 0`,
      [attendance.user_id]
    );

    // 5. Audit log
    await logActivity({
      userId: adminId,
      action: 'ATTENDANCE_APPROVED',
      module: 'attendance',
      entityType: 'attendance',
      entityId: attendanceId,
      targetUserId: attendance.user_id,
      targetUserName: attendance.full_name,
      details: `Approved outside-geofence attendance for ${attendance.full_name} on ${attendance.date} (${approvalNote})`,
    });

    // 6. Push notification to employee
    try {
      await sendPushNotification(
        attendance.user_id,
        'Attendance Approved',
        `Your check-in on ${attendance.date} has been approved by admin.`
      );
    } catch (_) {}

    const updated = await db.get('SELECT * FROM attendance WHERE id = ?', [attendanceId]);
    return res.json({
      message: 'Attendance approved successfully. It will now count towards valid payable days.',
      attendance: updated,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to approve attendance', details: err.message });
  }
}

/**
 * Reject an outside-geofence attendance request
 */
async function rejectReview(req, res) {
  try {
    const attendanceId = parseInt(req.params.id, 10);
    const adminId = req.user.id;
    const { rejection_reason } = req.body;

    if (!rejection_reason || !rejection_reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is mandatory when rejecting attendance' });
    }

    const attendance = await db.get(
      'SELECT a.*, u.full_name, u.email FROM attendance a JOIN users u ON a.user_id = u.id WHERE a.id = ?',
      [attendanceId]
    );

    if (!attendance) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    // Security check: Employee cannot reject their own attendance
    if (attendance.user_id === adminId) {
      return res.status(403).json({ error: 'Security violation: Unauthorized review action on own account' });
    }

    if (attendance.review_status !== 'pending_review') {
      return res.status(400).json({
        error: `Cannot reject attendance; current review status is "${attendance.review_status}"`,
      });
    }

    const nowIso = new Date().toISOString();
    const reasonClean = rejection_reason.trim();

    // 1. Update attendance table
    await db.run(
      `UPDATE attendance SET
         review_status = 'rejected',
         status = 'rejected',
         review_reason = ?,
         reviewed_by = ?,
         reviewed_at = ?,
         geofence_status = 'rejected'
       WHERE id = ?`,
      [reasonClean, adminId, nowIso, attendanceId]
    );

    // 2. Update geofence_attendance_evidence
    await db.run(
      `UPDATE geofence_attendance_evidence SET
         review_status = 'rejected',
         review_reason = ?,
         reviewed_by = ?,
         reviewed_at = ?
       WHERE attendance_id = ?`,
      [reasonClean, adminId, nowIso, attendanceId]
    );

    // 3. Insert review history audit
    await db.run(
      `INSERT INTO attendance_review_history (
         attendance_id, employee_id, admin_id, previous_status, new_status, reason, created_at
       ) VALUES (?, ?, ?, 'pending_review', 'rejected', ?, ?)`,
      [attendanceId, attendance.user_id, adminId, reasonClean, nowIso]
    );

    // 4. Audit log
    await logActivity({
      userId: adminId,
      action: 'ATTENDANCE_REJECTED',
      module: 'attendance',
      entityType: 'attendance',
      entityId: attendanceId,
      targetUserId: attendance.user_id,
      targetUserName: attendance.full_name,
      details: `Rejected outside-geofence attendance for ${attendance.full_name} on ${attendance.date}. Reason: ${reasonClean}`,
    });

    // 5. Push notification to employee
    try {
      await sendPushNotification(
        attendance.user_id,
        'Attendance Rejected',
        `Your check-in on ${attendance.date} was rejected: ${reasonClean}`
      );
    } catch (_) {}

    const updated = await db.get('SELECT * FROM attendance WHERE id = ?', [attendanceId]);
    return res.json({
      message: 'Attendance rejected successfully.',
      attendance: updated,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reject attendance', details: err.message });
  }
}

/**
 * Get review audit history
 */
async function getReviewHistory(req, res) {
  try {
    const { attendance_id, employee_id, limit = 50 } = req.query;
    let sql = `
      SELECT h.*, u.full_name as employee_name, a.full_name as admin_name
      FROM attendance_review_history h
      JOIN users u ON h.employee_id = u.id
      JOIN users a ON h.admin_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (attendance_id) {
      sql += ' AND h.attendance_id = ?';
      params.push(parseInt(attendance_id, 10));
    }
    if (employee_id) {
      sql += ' AND h.employee_id = ?';
      params.push(parseInt(employee_id, 10));
    }

    sql += ' ORDER BY h.id DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    const history = await db.query(sql, params);
    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch review history', details: err.message });
  }
}

/**
 * Employee endpoint: get own pending/reviewed submissions
 */
async function getMyReviews(req, res) {
  try {
    const userId = req.user.id;
    const sql = `
      SELECT a.id, a.date, a.check_in_time, a.check_out_time, a.status,
             a.geofence_status, a.review_status, a.review_reason,
             a.distance_from_office, a.location_source, a.outside_reason,
             a.reviewed_at, o.office_name,
             u.full_name as reviewer_name
      FROM attendance a
      LEFT JOIN offices o ON a.office_id = o.id
      LEFT JOIN users u ON a.reviewed_by = u.id
      WHERE a.user_id = ? AND a.geofence_status IN ('outside', 'approved', 'rejected')
      ORDER BY a.id DESC LIMIT 30
    `;
    const reviews = await db.query(sql, [userId]);
    return res.json({ reviews });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch your reviews', details: err.message });
  }
}

module.exports = {
  listPendingReviews,
  approveReview,
  rejectReview,
  getReviewHistory,
  getMyReviews,
};

