const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('../src/db');
const { getCompanyDate, getDayRangeUtc } = require('../src/utils/timeUtils');

test('Phase 9 - End-to-End Attendance Lifecycle & Date Boundaries', async (t) => {
  await db.initDatabase();

  const testEmail = `lifecycle_${Date.now()}@sologix.com`;
  const userRes = await db.run(
    `INSERT INTO users (email, username, password_hash, full_name, role, is_active)
     VALUES (?, ?, 'dummy_hash', 'Lifecycle Employee', 'employee', 1)`,
    [testEmail, `life_user_${Date.now()}`]
  );
  const userId = userRes.lastID;

  // Generate a valid small JPEG image for check-in selfie
  const testSelfieName = `test_selfie_${Date.now()}.jpg`;
  const testSelfiePath = path.join(__dirname, '..', 'uploads', 'selfies', testSelfieName);
  await sharp({
    create: {
      width: 400,
      height: 400,
      channels: 3,
      background: { r: 10, g: 150, b: 200 },
    },
  })
    .jpeg({ quality: 80 })
    .toFile(testSelfiePath);

  await t.test('Date-boundary around 00:00-05:30 IST maps accurately to company timezone', () => {
    // 2026-10-09 23:30:00 UTC = 2026-10-10 05:00:00 IST (+5:30)
    const earlyMorningIstUtc = new Date('2026-10-09T23:30:00.000Z');
    const companyDate = getCompanyDate(earlyMorningIstUtc, 'Asia/Kolkata');
    assert.strictEqual(companyDate, '2026-10-10');

    // 2026-10-09 18:29:59 UTC = 2026-10-09 23:59:59 IST
    const lateNightIstUtc = new Date('2026-10-09T18:29:59.000Z');
    const prevDate = getCompanyDate(lateNightIstUtc, 'Asia/Kolkata');
    assert.strictEqual(prevDate, '2026-10-09');

    // Query range for 2026-10-10 starts at 2026-10-09T18:30:00.000Z
    const [startUtc, nextDayUtc] = getDayRangeUtc('2026-10-10', 'Asia/Kolkata');
    assert.strictEqual(startUtc, '2026-10-09T18:30:00.000Z');
    assert.strictEqual(nextDayUtc, '2026-10-10T18:30:00.000Z');
  });

  await t.test('Attendance check-in creates active shift and check-out finishes it', async () => {
    const today = getCompanyDate(new Date(), 'Asia/Kolkata');
    const nowIso = new Date().toISOString();

    // Check-in
    const checkInRes = await db.run(
      `INSERT INTO attendance (user_id, date, check_in_time, check_in_lat, check_in_lng, check_in_accuracy, check_in_selfie, status)
       VALUES (?, ?, ?, 28.5355, 77.3910, 12.0, ?, 'checked_in')`,
      [userId, today, nowIso, testSelfieName]
    );
    const attId = checkInRes.lastID;
    assert.ok(attId > 0);

    const activeRecord = await db.get(
      "SELECT * FROM attendance WHERE user_id = ? AND status = 'checked_in' LIMIT 1",
      [userId]
    );
    assert.ok(activeRecord);
    assert.strictEqual(activeRecord.id, attId);

    // Check-out
    const checkOutIso = new Date().toISOString();
    await db.run(
      `UPDATE attendance SET
         check_out_time = ?,
         check_out_lat = 28.5400,
         check_out_lng = 77.3980,
         check_out_accuracy = 9.0,
         check_out_type = 'manual',
         status = 'checked_out'
       WHERE id = ?`,
      [checkOutIso, attId]
    );

    const closedRecord = await db.get('SELECT * FROM attendance WHERE id = ?', [attId]);
    assert.strictEqual(closedRecord.status, 'checked_out');
    assert.strictEqual(closedRecord.check_out_type, 'manual');
  });

  await t.test('Clean up test selfie files to ensure no orphan files remain', () => {
    if (fs.existsSync(testSelfiePath)) {
      fs.unlinkSync(testSelfiePath);
    }
    assert.strictEqual(fs.existsSync(testSelfiePath), false);
  });
});
