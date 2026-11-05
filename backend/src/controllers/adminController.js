const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { getCompanyDate, getDayRangeUtc } = require('../utils/timeUtils');
const { logActivity } = require('../services/activityLogger');
const salaryService = require('../services/salaryService');

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
    const {
      email,
      username,
      password,
      full_name,
      role,
      department,
      phone,
      salaryType,
      salary_type,
      monthlyBasicSalary,
      monthly_basic_salary,
      dailyWageOverride,
      daily_wage_override,
      dailyIncentiveRate,
      daily_incentive_rate,
    } = req.body;

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

    const sType = salaryType || salary_type;
    const mBasic = monthlyBasicSalary ?? monthly_basic_salary ?? 0;
    const dOverride = dailyWageOverride ?? daily_wage_override ?? null;
    const dIncentive = dailyIncentiveRate ?? daily_incentive_rate ?? 0;

    if (sType) {
      try {
        await salaryService.upsertEmployeeSalaryConfig({
          userId: result.lastID,
          salaryType: sType,
          monthlyBasicSalary: mBasic,
          dailyWageOverride: dOverride,
          dailyIncentiveRate: dIncentive,
          effectiveDate: getCompanyDate(),
          createdBy: req.user?.id || 1,
        });
      } catch (salErr) {
        console.warn('Salary config on user creation warning:', salErr.message);
      }
    }

    const newUser = await db.get(
      'SELECT id, email, username, full_name, role, department, phone, is_active, created_at FROM users WHERE id = ?',
      [result.lastID]
    );

    await logActivity({
      req,
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: result.lastID,
      targetUserId: result.lastID,
      targetUserName: full_name,
      details: `Created new ${assignedRole} account: ${full_name} (${email})${sType ? ` with ${sType === 'fixed_monthly' ? `Fixed Monthly (₹${mBasic})` : `Daily Wages (Override: ${dOverride ? `₹${dOverride}` : 'Common rate'}, Fixed Incentive: ₹${dIncentive}/day)`}` : ''}`,
    });

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

    await logActivity({
      req,
      action: 'USER_UPDATED',
      entityType: 'user',
      entityId: userId,
      targetUserId: userId,
      targetUserName: targetUser.full_name,
      details: `Updated user account: ${targetUser.full_name} (${targetUser.email})`,
    });

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

    await logActivity({
      req,
      action: 'USER_DELETED',
      entityType: 'user',
      entityId: userId,
      targetUserId: userId,
      targetUserName: targetUser.full_name,
      details: `Deleted user: ${targetUser.full_name} (${targetUser.email}, role: ${targetUser.role})`,
    });

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
    // For every active employee, fetch their active attendance, geofence, and most recent location track
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
        a.geofence_status,
        a.review_status,
        a.distance_from_office,
        a.office_id,
        o.office_name,
        o.radius_meters as office_radius,
        o.latitude as office_lat,
        o.longitude as office_lng,
        t.latitude as last_latitude,
        t.longitude as last_longitude,
        t.accuracy as last_accuracy,
        t.speed as last_speed,
        t.is_gps_off as last_is_gps_off,
        t.is_mocked as last_is_mocked,
        t.location_source as last_location_source,
        t.battery_percentage as last_battery_percentage,
        t.network_status as last_network_status,
        t.location_services_enabled as last_location_services_enabled,
        t.timestamp as last_location_time
      FROM users u
      LEFT JOIN attendance a ON a.user_id = u.id AND a.status = 'checked_in'
      LEFT JOIN offices o ON a.office_id = o.id
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

// Attendance overview report with search and Total Employees Present count
async function getAllAttendance(req, res) {
  try {
    const { date, userId, search, limit = 100 } = req.query;
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
    if (req.query.geofence_status) {
      sql += ' AND a.geofence_status = ?';
      params.push(req.query.geofence_status);
    }
    if (req.query.review_status) {
      sql += ' AND a.review_status = ?';
      params.push(req.query.review_status);
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      sql += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR CAST(u.id AS TEXT) LIKE ?)';
      params.push(term, term, term);
    }

    sql += ' ORDER BY a.check_in_time DESC LIMIT ?';
    params.push(parseInt(limit, 10));

    const records = await db.query(sql, params);

    // Compute distinct total present employees for the selected date
    let totalPresent = 0;
    const targetDate = date || getCompanyDate();
    const presentRow = await db.get(
      `SELECT COUNT(DISTINCT user_id) as count
       FROM attendance
       WHERE date = ? 
         AND (status IS NULL OR status NOT IN ('cancelled', 'rejected'))
         AND (review_status IS NULL OR review_status NOT IN ('pending_review', 'rejected'))`,
      [targetDate]
    );
    totalPresent = presentRow?.count || 0;

    return res.json({ records, totalPresent });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch attendance', details: error.message });
  }
}

// Full profile inspection for any user or admin (without exposing passwords)
async function getUserProfile(req, res) {
  try {
    const userId = parseInt(req.params.id, 10);
    const user = await db.get(
      `SELECT id, full_name, email, role, department, phone, is_active,
              joining_date, exit_date, created_at
       FROM users WHERE id = ?`,
      [userId]
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Attendance stats
    const todayStr = getCompanyDate();
    const todayAttendance = await db.get(
      'SELECT * FROM attendance WHERE user_id = ? AND date = ? ORDER BY id DESC LIMIT 1',
      [userId, todayStr]
    );

    const monthStart = todayStr.substring(0, 7) + '-01';
    const presentMonth = await db.get(
      `SELECT COUNT(DISTINCT date) as count
       FROM attendance
       WHERE user_id = ? AND date >= ? AND date <= ? AND (status IS NULL OR status NOT IN ('cancelled', 'rejected'))`,
      [userId, monthStart, todayStr]
    );

    // Leave balance
    const currentYear = todayStr.substring(0, 4);
    const leaveBalance = await db.get(
      'SELECT * FROM leave_balances WHERE user_id = ? AND (leave_year = ? OR leave_year LIKE ?) ORDER BY id DESC LIMIT 1',
      [userId, currentYear, `${currentYear}%`]
    );

    // Salary Config
    const salaryConfig = await db.get(
      'SELECT * FROM employee_salary_configs WHERE user_id = ?',
      [userId]
    );

    // Advances
    const activeAdvances = await db.query(
      "SELECT * FROM salary_advances WHERE user_id = ? AND status IN ('active', 'paused') ORDER BY id DESC",
      [userId]
    );

    return res.json({
      user,
      todayAttendance: todayAttendance || null,
      monthlyPresentDays: presentMonth?.count || 0,
      leaveBalance: leaveBalance || null,
      salaryConfig: salaryConfig || null,
      activeAdvances: activeAdvances || [],
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user profile', details: error.message });
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
    const formattedAlerts = alerts.map((a) => {
      let createdIso = a.created_at;
      if (typeof createdIso === 'string') {
        if (!createdIso.endsWith('Z') && !createdIso.includes('+')) {
          createdIso = createdIso.replace(' ', 'T') + 'Z';
        }
      } else if (createdIso instanceof Date) {
        createdIso = createdIso.toISOString();
      }
      return { ...a, created_at: createdIso };
    });
    return res.json({ alerts: formattedAlerts });
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

/**
 * Comprehensive Admin Dashboard Stats (Web & Mobile Admin)
 */
async function getDashboardStats(req, res) {
  try {
    const todayStr = getCompanyDate();

    // 1. Employee counts
    const totalEmployeesRow = await db.get(
      "SELECT COUNT(*) as c FROM users WHERE role = 'employee' AND is_active = 1"
    );
    const totalEmployees = totalEmployeesRow?.c || 0;

    // 2. Present today (distinct approved/valid users)
    const presentRow = await db.get(
      `SELECT COUNT(DISTINCT user_id) as c FROM attendance
       WHERE date = ? 
         AND (status IS NULL OR status NOT IN ('cancelled', 'rejected'))
         AND (review_status IS NULL OR review_status NOT IN ('pending_review', 'rejected'))`,
      [todayStr]
    );
    const presentToday = presentRow?.c || 0;
    const absentToday = Math.max(totalEmployees - presentToday, 0);

    // 3. Currently on duty (checked_in)
    const onDutyRow = await db.get(
      "SELECT COUNT(DISTINCT user_id) as c FROM attendance WHERE status = 'checked_in'"
    );
    const onDutyToday = onDutyRow?.c || 0;

    // 4. Pending attendance approvals
    const pendingReviewsRow = await db.get(
      "SELECT COUNT(*) as c FROM attendance WHERE review_status = 'pending_review'"
    );
    const pendingApprovals = pendingReviewsRow?.c || 0;

    // 5. Employees with GPS unavailable / disabled
    const gpsUnavailableRow = await db.get(
      "SELECT COUNT(DISTINCT user_id) as c FROM gps_alerts WHERE alert_type IN ('GPS_DISABLED', 'NO_SIGNAL') AND resolved = 0"
    );
    const gpsUnavailable = gpsUnavailableRow?.c || 0;

    // 6. Employees outside geofence today
    const outsideGeofenceRow = await db.get(
      "SELECT COUNT(*) as c FROM attendance WHERE date = ? AND geofence_status = 'outside'",
      [todayStr]
    );
    const outsideGeofence = outsideGeofenceRow?.c || 0;

    // 7. Active offices
    const activeOfficesRow = await db.get(
      "SELECT COUNT(*) as c FROM offices WHERE status = 'active'"
    );
    const activeOffices = activeOfficesRow?.c || 0;

    // 8. Recent alerts (latest 5)
    const recentAlerts = await db.query(
      `SELECT ga.*, u.full_name, u.email, u.department
       FROM gps_alerts ga
       JOIN users u ON ga.user_id = u.id
       ORDER BY ga.id DESC LIMIT 5`
    );

    // 9. Department breakdown for today
    const deptAttendance = await db.query(
      `SELECT u.department, COUNT(DISTINCT a.user_id) as present_count
       FROM attendance a
       JOIN users u ON a.user_id = u.id
       WHERE a.date = ? 
         AND (a.status IS NULL OR a.status NOT IN ('cancelled', 'rejected'))
         AND (a.review_status IS NULL OR a.review_status NOT IN ('pending_review', 'rejected'))
       GROUP BY u.department`,
      [todayStr]
    );

    return res.json({
      todayDate: todayStr,
      totalEmployees,
      presentToday,
      absentToday,
      onDutyToday,
      pendingApprovals,
      gpsUnavailable,
      outsideGeofence,
      activeOffices,
      recentAlerts,
      departmentBreakdown: deptAttendance,
    });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return res.status(500).json({ error: 'Failed to fetch dashboard stats', details: err.message });
  }
}

/**
 * Filterable reports generation for admin portal with CSV export
 */
async function getDashboardReports(req, res) {
  try {
    const { type = 'daily', date, month, office_id, format } = req.query;
    const todayStr = getCompanyDate();

    let data = [];
    let headers = [];

    if (type === 'daily') {
      const targetDate = date || todayStr;
      let sql = `
        SELECT a.id, a.user_id, u.full_name, u.department, a.date, a.check_in_time, a.check_out_time,
               a.status, a.geofence_status, a.review_status, a.distance_from_office, o.office_name,
               a.location_source, a.battery_percentage, a.outside_reason
        FROM attendance a
        JOIN users u ON a.user_id = u.id
        LEFT JOIN offices o ON a.office_id = o.id
        WHERE a.date = ?
      `;
      const params = [targetDate];
      if (office_id) {
        sql += ' AND a.office_id = ?';
        params.push(parseInt(office_id, 10));
      }
      sql += ' ORDER BY a.check_in_time ASC';
      data = await db.query(sql, params);
      headers = [
        'ID', 'User ID', 'Employee Name', 'Department', 'Date', 'Check In', 'Check Out',
        'Status', 'Geofence Status', 'Review Status', 'Distance (m)', 'Office', 'Source', 'Battery %', 'Reason'
      ];
    } else if (type === 'monthly') {
      const targetMonth = month || todayStr.substring(0, 7);
      const startDay = `${targetMonth}-01`;
      const endDay = `${targetMonth}-31`;

      const sql = `
        SELECT u.id as user_id, u.full_name, u.department,
               COUNT(DISTINCT CASE WHEN (a.status IS NULL OR a.status NOT IN ('cancelled', 'rejected')) AND (a.review_status IS NULL OR a.review_status NOT IN ('pending_review', 'rejected')) THEN a.date END) as present_days,
               COUNT(CASE WHEN a.geofence_status = 'outside' THEN 1 END) as outside_geofence_count,
               COUNT(CASE WHEN a.review_status = 'pending_review' THEN 1 END) as pending_review_count
        FROM users u
        LEFT JOIN attendance a ON a.user_id = u.id AND a.date >= ? AND a.date <= ?
        WHERE u.role = 'employee' AND u.is_active = 1
        GROUP BY u.id, u.full_name, u.department
        ORDER BY u.full_name ASC
      `;
      data = await db.query(sql, [startDay, endDay]);
      headers = ['User ID', 'Employee Name', 'Department', 'Present Days', 'Outside Geofence Count', 'Pending Reviews'];
    } else if (type === 'geofence_violations') {
      const sql = `
        SELECT a.id, a.user_id, u.full_name, u.department, a.date, a.check_in_time,
               a.distance_from_office, o.office_name, a.review_status, a.review_reason,
               a.outside_reason, a.check_in_lat, a.check_in_lng
        FROM attendance a
        JOIN users u ON a.user_id = u.id
        LEFT JOIN offices o ON a.office_id = o.id
        WHERE a.geofence_status = 'outside'
        ORDER BY a.id DESC LIMIT 200
      `;
      data = await db.query(sql);
      headers = [
        'ID', 'User ID', 'Employee Name', 'Department', 'Date', 'Check In',
        'Distance (m)', 'Assigned Office', 'Review Status', 'Admin Reason', 'Employee Reason', 'Latitude', 'Longitude'
      ];
    } else if (type === 'gps_availability') {
      const sql = `
        SELECT ga.id, ga.user_id, u.full_name, u.department, ga.alert_type, ga.message,
               ga.resolved, ga.created_at, ga.latitude, ga.longitude
        FROM gps_alerts ga
        JOIN users u ON ga.user_id = u.id
        WHERE ga.alert_type IN ('GPS_DISABLED', 'GPS_RESTORED', 'NO_SIGNAL', 'LOCATION_PERMISSION_REVOKED')
        ORDER BY ga.id DESC LIMIT 200
      `;
      data = await db.query(sql);
      headers = ['Alert ID', 'User ID', 'Employee Name', 'Department', 'Alert Type', 'Message', 'Resolved', 'Timestamp', 'Latitude', 'Longitude'];
    }

    if (format === 'csv') {
      let csvContent = headers.map((h) => `"${h}"`).join(',') + '\n';
      for (const row of data) {
        const line = Object.values(row)
          .map((v) => {
            if (v === null || v === undefined) return '""';
            return `"${String(v).replace(/"/g, '""')}"`;
          })
          .join(',');
        csvContent += line + '\n';
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="report_${type}_${Date.now()}.csv"`);
      return res.send(csvContent);
    }

    return res.json({ type, count: data.length, data });
  } catch (err) {
    console.error('getDashboardReports error:', err);
    return res.status(500).json({ error: 'Failed to generate report', details: err.message });
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
  getUserProfile,
  getGpsAlerts,
  resolveGpsAlert,
  getDashboardStats,
  getDashboardReports,
  isRootSuperAdmin,
};
