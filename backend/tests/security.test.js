const { describe, it } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');
const config = require('../src/config');

describe('Security & Validation Tests (Phase 2)', () => {
  it('Production security check rejects weak JWT_SECRET', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.JWT_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'short';
      assert.throws(() => {
        config.validateProductionSecurity();
      }, /SECURITY VIOLATION/);
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.JWT_SECRET = prevSecret;
    }
  });

  it('Production security check accepts 32+ char strong JWT_SECRET', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.JWT_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a_very_strong_secure_production_secret_key_12345';
      assert.doesNotThrow(() => {
        config.validateProductionSecurity();
      });
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.JWT_SECRET = prevSecret;
    }
  });

  it('GET /api/files/selfies/:filename rejects unauthenticated access with 401', async () => {
    const res = await request(app).get('/api/files/selfies/test.jpg');
    assert.strictEqual(res.statusCode, 401);
  });

  it('POST /api/auth/login validates input parameters using zod', async () => {
    const res = await request(app).post('/api/auth/login').send({
      identifier: 'a', // Too short (< 2)
      password: '',
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, 'Validation failed');
  });

  it('Public static /uploads endpoint is disabled (returns 404)', async () => {
    const res = await request(app).get('/uploads/selfies/test.jpg');
    assert.strictEqual(res.statusCode, 404);
  });
});
