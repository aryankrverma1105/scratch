const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { recordLocationBatch } = require('../src/controllers/locationController');

test('Phase 4 - Reliable Tracking & Batch Endpoint Tests', async (t) => {
  await db.initDatabase();

  const testEmail = `batchtest_${Date.now()}@sologix.com`;
  const userResult = await db.run(
    `INSERT INTO users (email, username, password_hash, full_name, role, is_active)
     VALUES (?, ?, 'dummy_hash', 'Batch Test Employee', 'employee', 1)`,
    [testEmail, `batch_user_${Date.now()}`]
  );
  const userId = userResult.lastID;

  await t.test('POST /api/location/track-batch inserts points and handles activeTracking=false when not checked in', async () => {
    const pointId1 = `point_${Date.now()}_1`;
    const pointId2 = `point_${Date.now()}_2`;

    const req = {
      user: { id: userId },
      body: {
        points: [
          {
            client_point_id: pointId1,
            captured_at: new Date().toISOString(),
            latitude: 28.5355,
            longitude: 77.3910,
            accuracy: 12.0,
            speed: 1.2,
            battery_level: 85.0,
            is_mocked: false,
          },
          {
            client_point_id: pointId2,
            captured_at: new Date().toISOString(),
            latitude: 28.5360,
            longitude: 77.3915,
            accuracy: 10.0,
            speed: 1.5,
            battery_level: 84.0,
            is_mocked: false,
          },
        ],
      },
    };

    let responseData = null;
    const res = {
      json(data) {
        responseData = data;
        return this;
      },
      status(code) {
        return this;
      },
    };

    await recordLocationBatch(req, res);

    assert.ok(responseData, 'Response data should be returned');
    assert.equal(responseData.success, true);
    assert.equal(responseData.count, 2);
    assert.equal(responseData.activeTracking, false, 'activeTracking should be false without open attendance');

    // Verify rows exist in DB
    const row1 = await db.get('SELECT * FROM location_tracks WHERE client_point_id = ?', [pointId1]);
    assert.ok(row1, 'Point 1 should exist');
    assert.equal(row1.latitude, 28.5355);
  });

  await t.test('POST /api/location/track-batch is idempotent via client_point_id', async () => {
    const pointId = `idempotent_${Date.now()}`;
    const req = {
      user: { id: userId },
      body: {
        points: [
          {
            client_point_id: pointId,
            captured_at: new Date().toISOString(),
            latitude: 28.6000,
            longitude: 77.4000,
            accuracy: 5.0,
            speed: 0.0,
          },
        ],
      },
    };

    const res = {
      json(d) { return this; },
      status() { return this; },
    };

    // First call
    await recordLocationBatch(req, res);

    // Second call with same client_point_id
    await recordLocationBatch(req, res);

    // Check count in database for this pointId
    const rows = await db.query('SELECT id FROM location_tracks WHERE client_point_id = ?', [pointId]);
    assert.equal(rows.length, 1, 'Only one record should exist for idempotent client_point_id');
  });
});
