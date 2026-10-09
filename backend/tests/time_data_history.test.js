const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { getCompanyDate, getDayRangeUtc, normalizeTimestamp } = require('../src/utils/timeUtils');
const { runAutoCheckout } = require('../src/services/autoCheckout');

test('Phase 6 - Time, Data, Migrations & History Tests', async (t) => {
  await db.initDatabase();

  await t.test('timeUtils formats date correctly in Asia/Kolkata', () => {
    // 2026-10-09 01:00:00 UTC is 2026-10-09 06:30:00 IST (+5:30)
    const d1 = new Date('2026-10-09T01:00:00.000Z');
    assert.strictEqual(getCompanyDate(d1, 'Asia/Kolkata'), '2026-10-09');

    // 2026-10-08 20:00:00 UTC is 2026-10-09 01:30:00 IST (next day in IST)
    const d2 = new Date('2026-10-08T20:00:00.000Z');
    assert.strictEqual(getCompanyDate(d2, 'Asia/Kolkata'), '2026-10-09');
  });

  await t.test('getDayRangeUtc returns correct 24-hour UTC window for company timezone', () => {
    const [startUtc, nextDayUtc] = getDayRangeUtc('2026-10-09', 'Asia/Kolkata');
    assert.strictEqual(startUtc, '2026-10-08T18:30:00.000Z');
    assert.strictEqual(nextDayUtc, '2026-10-09T18:30:00.000Z');
  });

  await t.test('normalizeTimestamp accepts past/present timestamps and rejects >5 min in future', () => {
    const now = new Date();
    assert.doesNotThrow(() => {
      normalizeTimestamp(now.toISOString());
    });

    const tenMinutesFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    assert.throws(() => {
      normalizeTimestamp(tenMinutesFuture);
    }, /cannot be more than 5 minutes in the future/);
  });

  await t.test('Versioned migrations applied successfully', async () => {
    const migrations = await db.query('SELECT * FROM schema_migrations ORDER BY version ASC');
    assert.ok(migrations.length >= 3);
    const versions = migrations.map((m) => m.version);
    assert.ok(versions.includes(1));
    assert.ok(versions.includes(2));
    assert.ok(versions.includes(3));
  });

  await t.test('runAutoCheckout closes open attendance records and sets check_out_type="auto"', async () => {
    const userRes = await db.run(
      `INSERT INTO users (email, username, password_hash, full_name, role, is_active)
       VALUES (?, ?, 'dummy_hash', 'AutoCheckout Employee', 'employee', 1)`,
      [`autocheckout_${Date.now()}@sologix.com`, `autoc_${Date.now()}`]
    );
    const userId = userRes.lastID;

    // Insert an open attendance record
    const attRes = await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, status)
       VALUES (?, '2026-10-09', ?, 28.5355, 77.3910, 'checked_in')`,
      [userId, new Date().toISOString()]
    );
    const attId = attRes.lastID;

    // Insert a track point
    await db.run(
      `INSERT INTO location_tracks (user_id, attendance_id, latitude, longitude, accuracy, timestamp)
       VALUES (?, ?, 28.5390, 77.3950, 8.5, ?)`,
      [userId, attId, new Date().toISOString()]
    );

    // Run auto checkout
    const result = await runAutoCheckout();
    assert.ok(result.closedCount >= 1);

    // Verify record is closed with check_out_type = 'auto' and status = 'auto_checked_out'
    const updatedAtt = await db.get('SELECT * FROM attendance WHERE id = ?', [attId]);
    assert.strictEqual(updatedAtt.status, 'auto_checked_out');
    assert.strictEqual(updatedAtt.check_out_type, 'auto');
    assert.strictEqual(updatedAtt.check_out_lat, 28.5390);
    assert.strictEqual(updatedAtt.check_out_lng, 77.3950);

    // Verify AUTO_CHECKOUT alert was created
    const alert = await db.get(
      `SELECT * FROM gps_alerts WHERE user_id = ? AND alert_type = 'AUTO_CHECKOUT' ORDER BY id DESC LIMIT 1`,
      [userId]
    );
    assert.ok(alert);
    assert.match(alert.message, /Auto checked-out/);
  });
});
