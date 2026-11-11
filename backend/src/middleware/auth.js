const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Also accept token from query string for browser media elements (<img>, downloads)
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required', code: 'TOKEN_REQUIRED' });
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = await db.get('SELECT id, email, username, full_name, role, department, is_active FROM users WHERE id = ?', [payload.id]);

    if (!user) {
      return res.status(401).json({ error: 'User no longer exists', code: 'USER_NOT_FOUND' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'User account has been deactivated', code: 'ACCOUNT_DEACTIVATED' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN', details: err.message });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'super_admin')) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: `${role} privileges required` });
    }
    next();
  };
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireRole,
};
