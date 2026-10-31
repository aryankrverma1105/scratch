const db = require('../db');

/**
 * Build where clause & params for activity logs queries
 */
function buildLogsQuery(query) {
  const { action, entityType, module: mod, search, startDate, endDate } = query;
  let where = ' WHERE 1=1';
  const params = [];

  if (mod) {
    where += ' AND (a.module = ? OR a.entity_type = ?)';
    params.push(mod, mod);
  }
  if (action) {
    where += ' AND a.action = ?';
    params.push(action);
  }
  if (entityType) {
    where += ' AND a.entity_type = ?';
    params.push(entityType);
  }
  if (startDate) {
    where += ' AND a.created_at >= ?';
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    where += ' AND a.created_at <= ?';
    params.push(`${endDate} 23:59:59`);
  }
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    where += ' AND (a.details LIKE ? OR a.action LIKE ? OR a.user_name LIKE ? OR a.target_user_name LIKE ?)';
    params.push(term, term, term, term);
  }

  return { where, params };
}

/**
 * Get system activity logs (Admin only)
 */
async function getActivityLogs(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = (page - 1) * limit;

    const { where, params } = buildLogsQuery(req.query);

    const countSql = `SELECT COUNT(*) as total FROM activity_logs a ${where}`;
    const dataSql = `
      SELECT a.*,
             COALESCE(a.target_user_name, tu.full_name) as target_user_name,
             COALESCE(a.user_name, au.full_name) as user_name
      FROM activity_logs a
      LEFT JOIN users tu ON a.target_user_id = tu.id
      LEFT JOIN users au ON a.user_id = au.id
      ${where}
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `;

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

/**
 * Export activity logs to CSV format (Admin only)
 */
async function exportActivityLogsCsv(req, res) {
  try {
    const { where, params } = buildLogsQuery(req.query);
    const sql = `
      SELECT a.*,
             COALESCE(a.target_user_name, tu.full_name) as target_user_name,
             COALESCE(a.user_name, au.full_name) as user_name
      FROM activity_logs a
      LEFT JOIN users tu ON a.target_user_id = tu.id
      LEFT JOIN users au ON a.user_id = au.id
      ${where}
      ORDER BY a.created_at DESC LIMIT 2000
    `;
    const logs = await db.query(sql, params);

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      'ID',
      'Date & Time (IST)',
      'Module',
      'Action',
      'Performed By',
      'Role',
      'Target Employee',
      'Details',
      'Before Values',
      'After Values',
      'Status',
      'IP Address',
    ];

    const rows = logs.map((l) => [
      l.id,
      escapeCsv(l.created_at),
      escapeCsv(l.module || l.entity_type || 'System'),
      escapeCsv(l.action),
      escapeCsv(l.user_name || 'System'),
      escapeCsv(l.role || ''),
      escapeCsv(l.target_user_name || ''),
      escapeCsv(l.details || ''),
      escapeCsv(l.before_values || ''),
      escapeCsv(l.after_values || ''),
      escapeCsv(l.status || 'success'),
      escapeCsv(l.ip_address || ''),
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    const nowStr = new Date().toISOString().substring(0, 10);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sologix_audit_logs_${nowStr}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to export activity logs CSV', details: err.message });
  }
}

module.exports = {
  getActivityLogs,
  exportActivityLogsCsv,
};
