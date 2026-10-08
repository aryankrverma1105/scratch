const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = await db.get('SELECT id, email, username, full_name, role, department, is_active FROM users WHERE id = ?', [payload.id]);

    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'User account has been deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token', details: err.message });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
};
