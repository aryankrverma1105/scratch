const db = require('../db');

/**
 * Log an activity to activity_logs table for admin audit.
 * @param {Object} params
 * @param {number} [params.userId] - The user performing the action
 * @param {string} [params.userName] - Name of user
 * @param {string} [params.role] - Role of user
 * @param {string} params.action - e.g. 'USER_CREATED', 'SALARY_ASSIGNED', 'INCENTIVE_ADDED'
 * @param {string} [params.entityType] - e.g. 'user', 'salary', 'payroll', 'incentive'
 * @param {string|number} [params.entityId] - Target ID
 * @param {string|Object} [params.details] - Description or JSON
 * @param {Object} [params.req] - Express request to extract IP & user
 */
async function logActivity({ userId, userName, role, action, entityType, entityId, details, targetUserId, targetUserName, req }) {
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

    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1') : 'system';
    const detailStr = typeof details === 'object' ? JSON.stringify(details) : (details || '');
    const nowIso = new Date().toISOString();

    await db.run(
      `INSERT INTO activity_logs (user_id, user_name, role, action, entity_type, entity_id, details, ip_address, target_user_id, target_user_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actUserId || null,
        actUserName || 'System',
        actRole || 'system',
        action,
        entityType || null,
        entityId ? String(entityId) : null,
        detailStr,
        String(ip).substring(0, 50),
        tgtId,
        tgtName,
        nowIso,
      ]
    );
  } catch (err) {
    // Fallback if target columns aren't yet created
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
