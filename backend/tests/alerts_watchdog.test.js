const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { reportGpsStatus } = require('../src/controllers/locationController');
const { runWatchdogCheck } = require('../src/services/watchdog');

test('Phase 5 - GPS Alerts & Watchdog Tests', async (t) => {
  await db.initDatabase();

  const userRes = await db.run(
    `INSERT INTO users (email, username, password_hash, full_name, role, is_active)
     VALUES (?, ?, 'dummy_hash', 'Alert Test User', 'employee', 1)`,
    [`alert_${Date.now()}@sologix.com`, `alert_user_${Date.now()}`]
  );
  const userId = userRes.lastID;

  await t.test('reportGpsStatus creates an open alert when GPS is off', async () => {
    let responseData = null;
    let statusCode = 200;
    const req = {
      user: { id: userId, full_name: 'Alert Test User' },
      body: {
        alert_type: 'GPS_DISABLED',
        message: 'GPS disabled during shift',
      },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await reportGpsStatus(req, res);
    assert.strictEqual(statusCode, 201);
    assert.strictEqual(responseData.status, 'OPEN');

    const openAlerts = await db.query(
      'SELECT * FROM gps_alerts WHERE user_id = ? AND alert_type = ? AND resolved = 0',
      [userId, 'GPS_DISABLED']
    );
    assert.strictEqual(openAlerts.length, 1);
  });

  await t.test('reportGpsStatus dedupes and does not create multiple open alerts', async () => {
    let responseData = null;
    let statusCode = 200;
    const req = {
      user: { id: userId, full_name: 'Alert Test User' },
      body: {
        alert_type: 'GPS_DISABLED',
        message: 'GPS still disabled',
      },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await reportGpsStatus(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.deduped, true);

    const openAlerts = await db.query(
      'SELECT * FROM gps_alerts WHERE user_id = ? AND alert_type = ? AND resolved = 0',
      [userId, 'GPS_DISABLED']
    );
    assert.strictEqual(openAlerts.length, 1);
  });

  await t.test('reportGpsStatus with RESTORED resolves open alerts', async () => {
    let responseData = null;
    let statusCode = 200;
    const req = {
      user: { id: userId, full_name: 'Alert Test User' },
      body: {
        alert_type: 'GPS_DISABLED',
        status: 'RESTORED',
        message: 'Location service restored',
      },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await reportGpsStatus(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.resolved, true);

    const openAlerts = await db.query(
      'SELECT * FROM gps_alerts WHERE user_id = ? AND alert_type = ? AND resolved = 0',
      [userId, 'GPS_DISABLED']
    );
    assert.strictEqual(openAlerts.length, 0);
  });

  await t.test('Watchdog creates NO_SIGNAL alert when user is checked in without points for > 5 min', async () => {
    // Create an open attendance record checked in 10 minutes ago
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await db.run(
      `INSERT INTO attendance (user_id, check_in_time, check_in_lat, check_in_lng, status, date)
       VALUES (?, ?, 28.5355, 77.3910, 'checked_in', '2026-10-09')`,
      [userId, tenMinutesAgo]
    );

    // Run watchdog check
    await runWatchdogCheck();

    // Verify a NO_SIGNAL alert was created
    const noSignalAlerts = await db.query(
      'SELECT * FROM gps_alerts WHERE user_id = ? AND alert_type = ? AND resolved = 0',
      [userId, 'NO_SIGNAL']
    );
    assert.strictEqual(noSignalAlerts.length, 1);
    assert.match(noSignalAlerts[0].message, /No GPS signal received/);

    // Running watchdog again should dedupe and not add another NO_SIGNAL
    await runWatchdogCheck();
    const noSignalAlertsAfter = await db.query(
      'SELECT * FROM gps_alerts WHERE user_id = ? AND alert_type = ? AND resolved = 0',
      [userId, 'NO_SIGNAL']
    );
    assert.strictEqual(noSignalAlertsAfter.length, 1);
  });
});
