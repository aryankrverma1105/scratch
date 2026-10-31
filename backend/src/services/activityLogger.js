const db = require('../db');

/**
 * Log an activity to activity_logs table for comprehensive audit trail.
 */
async function logActivity({
  userId,
  userName,
  role,
  action,
  module,
  entityType,
  entityId,
  details,
  beforeValues,
  afterValues,
  deviceInfo,
  status = 'success',
  targetUserId,
  targetUserName,
  req,
}) {
  try {
    let actUserId = userId;
    let actUserName = userName;
    let actRole = role;

    if (req && req.user) {
      actUserId = actUserId || req.user.id;
      actUserName = actUserName || req.user.full_name || req.user.email;
      actRole = actRole || req.user.role;
    }

    let tgtId = targetUserId || null;
    let tgtName = targetUserName || null;

    if (tgtId && !tgtName) {
      try {
        const u = await db.get('SELECT full_name FROM users WHERE id = ?', [tgtId]);
        if (u) tgtName = u.full_name;
      } catch (_) {}
    }

    // Determine module if omitted
    let mod = module;
    if (!mod) {
      const act = String(action).toUpperCase();
      if (act.includes('SALARY') || act.includes('PAYROLL') || act.includes('INCENTIVE') || act.includes('OVERTIME') || act.includes('ADVANCE') || act.includes('EMI')) {
        mod = 'salary';
      } else if (act.includes('ATTENDANCE') || act.includes('CHECK_IN') || act.includes('CHECK_OUT')) {
        mod = 'attendance';
      } else if (act.includes('USER') || act.includes('ROLE') || act.includes('ADMIN')) {
        mod = 'users';
      } else if (act.includes('LEAVE') || act.includes('HOLIDAY')) {
        mod = 'leave';
      } else if (act.includes('BACKUP') || act.includes('DRIVE')) {
        mod = 'backup';
      } else {
        mod = 'system';
      }
    }

    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1') : 'system';
    const devInfo = deviceInfo || (req ? req.headers['user-agent'] : null);
    const detailStr = typeof details === 'object' ? JSON.stringify(details) : (details || '');
    const beforeStr = typeof beforeValues === 'object' ? JSON.stringify(beforeValues) : (beforeValues || null);
    const afterStr = typeof afterValues === 'object' ? JSON.stringify(afterValues) : (afterValues || null);
    const nowIso = new Date().toISOString();

    await db.run(
      `INSERT INTO activity_logs (
        user_id, user_name, role, action, module, entity_type, entity_id,
        details, before_values, after_values, device_info, status,
        ip_address, target_user_id, target_user_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actUserId || null,
        actUserName || 'System',
        actRole || 'system',
        action,
        mod,
        entityType || null,
        entityId ? String(entityId) : null,
        detailStr,
        beforeStr,
        afterStr,
        devInfo,
        status,
        String(ip).substring(0, 50),
        tgtId,
        tgtName,
        nowIso,
      ]
    );
  } catch (err) {
    // Graceful fallback for older schemas
    try {
      await db.run(
        `INSERT INTO activity_logs (user_id, user_name, role, action, entity_type, entity_id, details, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId || (req?.user ? req.user.id : null),
          userName || (req?.user ? (req.user.full_name || req.user.email) : 'System'),
          role || (req?.user ? req.user.role : 'system'),
          action,
          entityType || null,
          entityId ? String(entityId) : null,
          typeof details === 'object' ? JSON.stringify(details) : (details || ''),
          '127.0.0.1',
          new Date().toISOString(),
        ]
      );
    } catch (fallbackErr) {
      console.error('Failed to record activity log:', fallbackErr.message);
    }
  }
}

module.exports = {
  logActivity,
};
