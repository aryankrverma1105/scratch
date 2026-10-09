const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { getCompanyDate, getDayRangeUtc } = require('../utils/timeUtils');

function isRootSuperAdmin(user) {
  if (!user) return false;
  const rootEmail = (config.ADMIN_DEFAULT_EMAIL || 'admin@company.com').toLowerCase();
  return (
    user.id === 1 ||
    (user.email && user.email.toLowerCase() === rootEmail) ||
    (user.email && user.email.toLowerCase() === 'admin@company.com')
  );
}

// List all users
async function listUsers(req, res) {
  try {
    const users = await db.query(
      `SELECT id, email, username, full_name, role, department, phone, is_active, created_at 
       FROM users ORDER BY created_at DESC`
    );
    return res.json({ users });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
}

// Create employee or admin
async function createUser(req, res) {
  try {
    const { email, username, password, full_name, role, department, phone } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    const assignedRole = role === 'admin' ? 'admin' : 'employee';

    // Check duplicate email or username
    const existing = await db.get(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR (username IS NOT NULL AND LOWER(username) = LOWER(?))',
      [email, username || '']
    );

    if (existing) {
      return res.status(409).json({ error: 'User with this email or username already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const result = await db.run(
      `INSERT INTO users (email, username, password_hash, full_name, role, department, phone, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [email, username || null, hash, full_name, assignedRole, department || 'General', phone || '', 1]
    );

    const newUser = await db.get(
      'SELECT id, email, username, full_name, role, department, phone, is_active, created_at FROM users WHERE id = ?',
      [result.lastID]
    );

    return res.status(201).json({
      message: `${assignedRole === 'admin' ? 'Admin' : 'Employee'} created successfully`,
      user: newUser,
    });
  } catch (error) {
    console.error('Create user error:', error);
    return res.status(500).json({ error: 'Failed to create user', details: error.message });
  }
}

// Update user details or toggle status
async function updateUser(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
    const { full_name, role, department, phone, is_active, password } = req.body;

    const targetUser = await db.get(
      'SELECT id, email, username, full_name, role, department, phone, is_active FROM users WHERE id = ?',
      [userId]
    );
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetIsRoot = isRootSuperAdmin(targetUser);
    const callerIsRoot = isRootSuperAdmin(req.user);

    // Root Admin protections:
    if (targetIsRoot) {
      // No other admin can modify, change password, or deactivate Root Admin
      if (req.user.id !== targetUser.id) {
        return res.status(403).json({
          error: 'Access denied: No other admin can modify, deactivate, or alter the Root System Administrator account.',
        });
      }
      // Root Admin cannot deactivate themselves (prevents system lockout)
      if (is_active !== undefined && (is_active === false || is_active === 0)) {
        return res.status(403).json({
          error: 'The Root System Administrator account cannot be deactivated.',
        });
      }
      // Root Admin cannot be demoted to employee
      if (role !== undefined && role !== 'admin') {
        return res.status(403).json({
          error: 'The Root System Administrator role cannot be altered.',
        });
      }
    }

    // Role-based restrictions on other administrators:
    // If target is another admin, only Root Admin can deactivate or alter their role
    if (targetUser.role === 'admin' && !callerIsRoot && req.user.id !== targetUser.id) {
      if (is_active !== undefined || role !== undefined) {
        return res.status(403).json({
          error: 'Only the Root System Administrator can deactivate or modify other administrators.',
        });
      }
    }

    // Self-deactivation prevention for any logged-in user
    if (req.user.id === targetUser.id && is_active !== undefined && (is_active === false || is_active === 0)) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    if (password) {
      // Non-root admins cannot reset another admin's password
      if (targetUser.role === 'admin' && !callerIsRoot && req.user.id !== targetUser.id) {
        return res.status(403).json({
          error: 'Only the Root System Administrator can reset passwords for administrator accounts.',
        });
      }
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      await db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [hash, userId]);
    }

    const updates = [];
    const params = [];

    if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (department !== undefined) { updates.push('department = ?'); params.push(department); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

    if (updates.length > 0) {
      params.push(userId);
      await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await db.get(
      'SELECT id, email, username, full_name, role, department, phone, is_active, created_at FROM users WHERE id = ?',
      [userId]
    );

    return res.json({ message: 'User updated successfully', user: updated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update user', details: error.message });
  }
}

// Permanently delete a user (Protected: Root Admin can delete anyone; Secondary Admins cannot delete admins; Root Admin can never be deleted)
async function deleteUser(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
    const targetUser = await db.get('SELECT id, email, username, full_name, role FROM users WHERE id = ?', [userId]);

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 1. Root Super Admin account cannot be deleted by anyone!
    if (isRootSuperAdmin(targetUser)) {
      return res.status(403).json({
        error: 'The Root System Administrator account is permanent and cannot be deleted.',
      });
    }

    // 2. Caller cannot delete their own active account
    if (req.user.id === targetUser.id) {
      return res.status(400).json({ error: 'You cannot delete your own account while logged in.' });
    }

    // 3. Only the Root System Administrator can delete other admin accounts
    const callerIsRoot = isRootSuperAdmin(req.user);
    if (targetUser.role === 'admin' && !callerIsRoot) {
      return res.status(403).json({
        error: 'Only the Root System Administrator can delete administrator accounts.',
      });
    }

    // Cascade delete all user data
    await db.run('DELETE FROM gps_alerts WHERE user_id = ?', [userId]);
    await db.run('DELETE FROM location_tracks WHERE user_id = ?', [userId]);
    await db.run('DELETE FROM attendance WHERE user_id = ?', [userId]);
    await db.run('DELETE FROM users WHERE id = ?', [userId]);

    return res.json({
      message: `User ${targetUser.full_name} (${targetUser.role}) has been permanently deleted.`,
      deletedUserId: userId,
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ error: 'Failed to delete user', details: error.message });
  }
}

// Live tracking of all employees (Requirement 12)
async function getLiveLocations(req, res) {
  try {
    // For every employee, fetch their active attendance and most recent location track
    const queryStr = `
      SELECT 
        u.id as user_id,
        u.full_name,
        u.email,
        u.department,
        u.phone,
        a.id as attendance_id,
        a.status as attendance_status,
        a.check_in_time,
        a.check_in_lat,
        a.check_in_lng,
        a.check_in_address,
        t.latitude as last_latitude,
        t.longitude as last_longitude,
        t.accuracy as last_accuracy,
        t.speed as last_speed,
        t.is_gps_off as last_is_gps_off,
        t.is_mocked as last_is_mocked,
        t.timestamp as last_location_time
      FROM users u
      LEFT JOIN attendance a ON a.user_id = u.id AND a.status = 'checked_in'
      LEFT JOIN (
        SELECT lt.*
        FROM location_tracks lt
        INNER JOIN (
          SELECT user_id, MAX(id) as max_id
          FROM location_tracks
          GROUP BY user_id
        ) latest ON lt.id = latest.max_id
      ) t ON t.user_id = u.id
      WHERE u.role = 'employee' AND u.is_active = 1
      ORDER BY u.full_name ASC
    `;

    const employees = await db.query(queryStr);
    return res.json({ employees });
  } catch (error) {
    console.error('getLiveLocations error:', error);
    return res.status(500).json({ error: 'Failed to fetch live locations', details: error.message });
  }
}

// User location history / route (Requirement 13)
async function getUserRouteHistory(req, res) {
  try {
    const userId = req.params.id;
    const date = req.query.date || getCompanyDate(); // YYYY-MM-DD

    const user = await db.get('SELECT id, full_name, email, department FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get attendance for this date
    const attendance = await db.get(
      'SELECT * FROM attendance WHERE user_id = ? AND date = ? ORDER BY id DESC LIMIT 1',
      [userId, date]
    );

    // Get all GPS coordinates logged on that date using timezone-aware UTC range query
    const [startUtc, nextDayUtc] = getDayRangeUtc(date);
    const tracks = await db.query(
      `SELECT id, latitude, longitude, accuracy, speed, altitude, battery_level, is_gps_off, is_mocked, timestamp
       FROM location_tracks
       WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
       ORDER BY timestamp ASC`,
      [userId, startUtc, nextDayUtc]
    );

    return res.json({
      user,
      date,
      attendance: attendance || null,
      routePointsCount: tracks.length,
      route: tracks,
    });
  } catch (error) {
    console.error('getUserRouteHistory error:', error);
    return res.status(500).json({ error: 'Failed to fetch route history', details: error.message });
  }
}

// Attendance overview report
async function getAllAttendance(req, res) {
  try {
    const { date, userId, limit = 100 } = req.query;
    let sql = `
      SELECT a.*, u.full_name, u.email, u.department
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      sql += ' AND a.date = ?';
      params.push(date);
    }
    if (userId) {
      sql += ' AND a.user_id = ?';
      params.push(userId);
    }

    sql += ' ORDER BY a.check_in_time DESC LIMIT ?';
    params.push(parseInt(limit, 10));

    const records = await db.query(sql, params);
    return res.json({ records });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch attendance', details: error.message });
  }
}

// GPS alerts list (Requirement 14 & 15)
async function getGpsAlerts(req, res) {
  try {
    const alerts = await db.query(
      `SELECT ga.*, u.full_name, u.email, u.department, u.phone
       FROM gps_alerts ga
       JOIN users u ON ga.user_id = u.id
       ORDER BY ga.created_at DESC LIMIT 100`
    );
    return res.json({ alerts });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch GPS alerts', details: error.message });
  }
}

// Mark alert resolved
async function resolveGpsAlert(req, res) {
  try {
    const alertId = req.params.id;
    await db.run('UPDATE gps_alerts SET resolved = 1 WHERE id = ?', [alertId]);
    return res.json({ message: 'Alert resolved' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to resolve alert', details: error.message });
  }
}

module.exports = {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getLiveLocations,
  getUserRouteHistory,
  getAllAttendance,
  getGpsAlerts,
  resolveGpsAlert,
};
