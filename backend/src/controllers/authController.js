const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { getCompanyDate } = require('../utils/timeUtils');

async function login(req, res) {
  try {
    const { identifier, password, app_version, app_build_number, device_model, device_os } = req.body; // username or email

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/Username and password are required' });
    }

    const user = await db.get(
      'SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)',
      [identifier, identifier]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Save app version and device telemetry if provided
    try {
      if (app_version || device_model) {
        await db.run(
          `UPDATE users SET 
             app_version = COALESCE(?, app_version),
             app_build_number = COALESCE(?, app_build_number),
             device_model = COALESCE(?, device_model),
             device_os = COALESCE(?, device_os),
             last_active_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [app_version || null, app_build_number || null, device_model || null, device_os || null, user.id]
        );
      } else {
        await db.run('UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      }
    } catch (_) {}

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
      },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    // Generate cryptographically secure refresh token for persistent sessions
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days rolling session
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;

    try {
      await db.run(
        `INSERT INTO user_sessions (user_id, refresh_token_hash, device_info, device_model, device_os, app_version, ip_address, is_revoked, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          user.id,
          refreshTokenHash,
          device_model ? `${device_model} (${device_os || 'Android'})` : 'Client Session',
          device_model || null,
          device_os || null,
          app_version || null,
          ipAddress,
          expiresAt,
        ]
      );
    } catch (sessionErr) {
      console.error('Failed to persist user session:', sessionErr);
    }

    // Also fetch today's active attendance status
    const today = getCompanyDate();
    const activeAttendance = await db.get(
      "SELECT * FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
      [user.id]
    );

    return res.json({
      message: 'Login successful',
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        department: user.department,
        phone: user.phone,
        must_change_password: !!user.must_change_password,
      },
      activeAttendance: activeAttendance || null,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server error during login', details: error.message });
  }
}

async function getProfile(req, res) {
  try {
    const user = await db.get(
      'SELECT id, email, username, full_name, role, department, phone, must_change_password, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    const activeAttendance = await db.get(
      "SELECT * FROM attendance WHERE user_id = ? AND status = 'checked_in' ORDER BY id DESC LIMIT 1",
      [req.user.id]
    );

    return res.json({
      user: user
        ? {
            ...user,
            must_change_password: !!user.must_change_password,
          }
        : null,
      activeAttendance: activeAttendance || null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch profile', details: error.message });
  }
}

async function changePassword(req, res) {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old and new passwords are required' });
    }

    const user = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect old password' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    await db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, req.user.id]);

    // Invalidate prior sessions on password change
    await db.run('UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ?', [req.user.id]);

    return res.json({ message: 'Password changed successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update password', details: error.message });
  }
}

/**
 * Silent Refresh Token handler with Token Rotation & Reuse Detection
 */
async function refreshToken(req, res) {
  try {
    const { refreshToken: clientRefreshToken } = req.body;
    if (!clientRefreshToken) {
      return res.status(400).json({ error: 'Refresh token is required', code: 'REFRESH_TOKEN_REQUIRED' });
    }

    const tokenHash = crypto.createHash('sha256').update(clientRefreshToken).digest('hex');
    const session = await db.get(
      'SELECT * FROM user_sessions WHERE refresh_token_hash = ?',
      [tokenHash]
    );

    if (!session) {
      return res.status(401).json({ error: 'Invalid session or refresh token. Please login again.', code: 'SESSION_NOT_FOUND' });
    }

    // Verify user exists and is active before checking session revocation
    const user = await db.get(
      'SELECT id, email, username, full_name, role, department, is_active FROM users WHERE id = ?',
      [session.user_id]
    );

    if (!user) {
      await db.run('UPDATE user_sessions SET is_revoked = 1 WHERE id = ?', [session.id]);
      return res.status(401).json({ error: 'User account no longer exists', code: 'USER_NOT_FOUND' });
    }

    if (!user.is_active) {
      await db.run('UPDATE user_sessions SET is_revoked = 1 WHERE id = ?', [session.id]);
      return res.status(403).json({ error: 'User account has been deactivated. Please contact administrator.', code: 'ACCOUNT_DEACTIVATED' });
    }

    if (session.is_revoked) {
      // Possible token reuse or revoked session: reject immediately
      return res.status(401).json({ error: 'Session has been revoked. Please login again.', code: 'SESSION_REVOKED' });
    }

    // Check expiration
    if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
      await db.run('UPDATE user_sessions SET is_revoked = 1 WHERE id = ?', [session.id]);
      return res.status(401).json({ error: 'Session has expired. Please login again.', code: 'SESSION_EXPIRED' });
    }

    // Refresh Token Rotation: issue a new cryptographically secure refresh token
    const newRefreshToken = crypto.randomBytes(40).toString('hex');
    const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    const newExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      'UPDATE user_sessions SET refresh_token_hash = ?, last_used_at = CURRENT_TIMESTAMP, expires_at = ? WHERE id = ?',
      [newRefreshTokenHash, newExpiresAt, session.id]
    );

    // Issue fresh access token
    const newAccessToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
      },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    return res.json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        department: user.department,
      },
    });
  } catch (error) {
    console.error('refreshToken error:', error);
    return res.status(500).json({ error: 'Failed to refresh token', details: error.message });
  }
}

/**
 * Explicit manual logout: revokes server-side session
 */
async function logout(req, res) {
  try {
    const { refreshToken: clientRefreshToken } = req.body || {};
    let userId = req.user ? req.user.id : null;

    if (clientRefreshToken) {
      const tokenHash = crypto.createHash('sha256').update(clientRefreshToken).digest('hex');
      const session = await db.get('SELECT id, user_id FROM user_sessions WHERE refresh_token_hash = ?', [tokenHash]);
      if (session) {
        userId = session.user_id;
        await db.run('UPDATE user_sessions SET is_revoked = 1 WHERE id = ?', [session.id]);
      }
    } else if (userId) {
      // Revoke all sessions for this authenticated user
      await db.run('UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ?', [userId]);
    }

    return res.json({ success: true, message: 'Logged out successfully. Server session revoked.' });
  } catch (error) {
    console.error('logout error:', error);
    return res.status(500).json({ error: 'Failed to log out', details: error.message });
  }
}

module.exports = {
  login,
  getProfile,
  changePassword,
  refreshToken,
  logout,
};
