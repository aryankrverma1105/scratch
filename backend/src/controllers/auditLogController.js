const db = require('../db');

/**
 * Get system activity logs (Admin only)
 */
async function getActivityLogs(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = (page - 1) * limit;
    const { action, entityType } = req.query;

    let countSql = 'SELECT COUNT(*) as total FROM activity_logs WHERE 1=1';
    let dataSql = `
      SELECT a.*,
             COALESCE(a.target_user_name, tu.full_name) as target_user_name,
             COALESCE(a.user_name, au.full_name) as user_name
      FROM activity_logs a
      LEFT JOIN users tu ON a.target_user_id = tu.id
      LEFT JOIN users au ON a.user_id = au.id
      WHERE 1=1
    `;
    const params = [];

    if (action) {
      countSql += ' AND a.action = ?';
      dataSql += ' AND a.action = ?';
      params.push(action);
    }
    if (entityType) {
      countSql += ' AND a.entity_type = ?';
      dataSql += ' AND a.entity_type = ?';
      params.push(entityType);
    }

    dataSql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    const totalRow = await db.get(countSql, params);
    const total = totalRow?.total || 0;

    const logs = await db.query(dataSql, [...params, limit, offset]);

    return res.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      logs,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch activity logs', details: err.message });
  }
}

module.exports = {
  getActivityLogs,
};
