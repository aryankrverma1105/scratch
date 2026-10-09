const { describe, it } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');

describe('Health Check API', () => {
  it('GET /api/health should return ok status', async () => {
    const res = await request(app).get('/api/health');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.ok(res.body.service.includes('Sologix Energy'));
  });
});
