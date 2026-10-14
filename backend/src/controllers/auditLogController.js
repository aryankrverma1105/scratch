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
    let dataSql = 'SELECT * FROM activity_logs WHERE 1=1';
    const params = [];

    if (action) {
      countSql += ' AND action = ?';
      dataSql += ' AND action = ?';
      params.push(action);
    }
    if (entityType) {
      countSql += ' AND entity_type = ?';
      dataSql += ' AND entity_type = ?';
      params.push(entityType);
    }

    dataSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
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
