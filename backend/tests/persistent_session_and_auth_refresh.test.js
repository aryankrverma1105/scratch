const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');
const db = require('../src/db');
const bcrypt = require('bcryptjs');

describe('Persistent Session, Token Refresh Rotation & Revocation Tests', () => {
  let adminToken = '';
  let employeeId = 0;
  let adminId = 0;
  let adminEmail = 'test.admin.session@company.com';
  let employeeEmail = 'persistent.user@company.com';
  let password = 'TestPassword123!';

  before(async () => {
    await db.initDatabase();

    const hash = await bcrypt.hash(password, 10);

    // 1. Create or reset test admin
    let existingAdmin = await db.get('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (existingAdmin) {
      adminId = existingAdmin.id;
      await db.run('UPDATE users SET password_hash = ?, is_active = 1, role = ? WHERE id = ?', [hash, 'super_admin', adminId]);
    } else {
      const res = await db.run(
        `INSERT INTO users (email, password_hash, full_name, role, department, is_active, created_at)
         VALUES (?, ?, 'Test Admin', 'super_admin', 'Management', 1, CURRENT_TIMESTAMP)`,
        [adminEmail, hash]
      );
      adminId = res.lastID;
    }

    // Log in as admin
    const adminRes = await request(app).post('/api/auth/login').send({
      identifier: adminEmail,
      password: password,
    });
    assert.strictEqual(adminRes.statusCode, 200);
    assert.ok(adminRes.body.token);
    assert.ok(adminRes.body.refreshToken);
    adminToken = adminRes.body.token;

    // 2. Create or reset test employee
    const existingEmp = await db.get('SELECT id FROM users WHERE email = ?', [employeeEmail]);
    if (existingEmp) {
      employeeId = existingEmp.id;
      await db.run('UPDATE users SET password_hash = ?, is_active = 1, role = ? WHERE id = ?', [hash, 'employee', employeeId]);
      await db.run('DELETE FROM user_sessions WHERE user_id = ?', [employeeId]);
    } else {
      const res = await db.run(
        `INSERT INTO users (email, password_hash, full_name, role, department, is_active, created_at)
         VALUES (?, ?, 'Persistent Test User', 'employee', 'Engineering', 1, CURRENT_TIMESTAMP)`,
        [employeeEmail, hash]
      );
      employeeId = res.lastID;
    }
  });

  it('1. Login returns short/medium access token AND cryptographic refreshToken', async () => {
    const res = await request(app).post('/api/auth/login').send({
      identifier: employeeEmail,
      password: password,
      device_info: 'Flutter Android Device',
      device_model: 'Pixel 8',
      device_os: 'Android 14',
      app_version: '1.2.0',
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.token, 'Must return JWT access token');
    assert.ok(res.body.refreshToken, 'Must return refresh token');
    assert.strictEqual(typeof res.body.refreshToken, 'string');
    assert.ok(res.body.refreshToken.length >= 40, 'Refresh token must be secure cryptographically random hex');
    assert.strictEqual(res.body.user.email, employeeEmail);

    // Verify session stored in database
    const sessions = await db.query('SELECT * FROM user_sessions WHERE user_id = ? AND is_revoked = 0', [employeeId]);
    assert.ok(sessions.length >= 1, 'Active session must be recorded in user_sessions table');
  });

  it('2. POST /api/auth/refresh successfully rotates refresh token and issues fresh access token', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      identifier: employeeEmail,
      password: password,
    });
    const firstRefreshToken = loginRes.body.refreshToken;

    const refreshRes = await request(app).post('/api/auth/refresh').send({
      refreshToken: firstRefreshToken,
    });

    assert.strictEqual(refreshRes.statusCode, 200);
    assert.ok(refreshRes.body.token, 'Must issue fresh access token');
    assert.ok(refreshRes.body.refreshToken, 'Must issue new rotated refresh token');
    assert.notStrictEqual(refreshRes.body.refreshToken, firstRefreshToken, 'Refresh token must be rotated');

    // 3. Replay prevention: reusing the old firstRefreshToken must fail
    const replayRes = await request(app).post('/api/auth/refresh').send({
      refreshToken: firstRefreshToken,
    });
    assert.strictEqual(replayRes.statusCode, 401, 'Reused refresh token must be rejected');
    assert.ok(replayRes.body.error);
  });

  it('4. POST /api/auth/refresh rejects invalid or malformed tokens with 401', async () => {
    const res = await request(app).post('/api/auth/refresh').send({
      refreshToken: 'invalid_non_existent_token_string_1234567890',
    });
    assert.strictEqual(res.statusCode, 401);
  });

  it('5. Explicit manual logout revokes the session on server', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      identifier: employeeEmail,
      password: password,
    });
    const { token, refreshToken } = loginRes.body;

    // Logout
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({ refreshToken });

    assert.strictEqual(logoutRes.statusCode, 200);
    assert.ok(logoutRes.body.message.includes('Logged out successfully'));

    // Calling refresh with that logged-out token must now fail with 401
    const postLogoutRefresh = await request(app).post('/api/auth/refresh').send({
      refreshToken,
    });
    assert.strictEqual(postLogoutRefresh.statusCode, 401);
    assert.strictEqual(postLogoutRefresh.body.code, 'SESSION_REVOKED');
  });

  it('6. Admin can revoke all active sessions for a target user', async () => {
    // Employee logs in
    const loginRes = await request(app).post('/api/auth/login').send({
      identifier: employeeEmail,
      password: password,
    });
    const empRefreshToken = loginRes.body.refreshToken;

    // Super Admin explicitly revokes sessions
    const revokeRes = await request(app)
      .post(`/api/admin/users/${employeeId}/revoke-sessions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    assert.strictEqual(revokeRes.statusCode, 200);
    assert.strictEqual(revokeRes.body.success, true);

    // Refresh token should now be rejected as revoked
    const refreshRes = await request(app).post('/api/auth/refresh').send({
      refreshToken: empRefreshToken,
    });
    assert.strictEqual(refreshRes.statusCode, 401);
    assert.strictEqual(refreshRes.body.code, 'SESSION_REVOKED');
  });

  it('7. Deactivating an employee account immediately revokes sessions and returns 403 ACCOUNT_DEACTIVATED', async () => {
    // 1. Employee logs in while active
    await db.run('UPDATE users SET is_active = 1 WHERE id = ?', [employeeId]);
    const loginRes = await request(app).post('/api/auth/login').send({
      identifier: employeeEmail,
      password: password,
    });
    const empRefreshToken = loginRes.body.refreshToken;

    // 2. Admin deactivates employee
    const deactRes = await request(app)
      .put(`/api/admin/users/${employeeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: 0 });

    assert.strictEqual(deactRes.statusCode, 200);

    // 3. Employee attempts refresh token
    const refreshRes = await request(app).post('/api/auth/refresh').send({
      refreshToken: empRefreshToken,
    });
    assert.strictEqual(refreshRes.statusCode, 403);
    assert.strictEqual(refreshRes.body.code, 'ACCOUNT_DEACTIVATED');

    // Restore user status
    await db.run('UPDATE users SET is_active = 1 WHERE id = ?', [employeeId]);
  });
});
