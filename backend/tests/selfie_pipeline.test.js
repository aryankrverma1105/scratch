const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { compressSelfie } = require('../src/middleware/upload');
const db = require('../src/db');

test('Phase 3 - Selfie Pipeline & GPS Tests', async (t) => {
  await db.initDatabase();

  await t.test('compressSelfie rejects non-image / fake image buffers with 400', async () => {
    const fakeBuffer = Buffer.from('This is a fake text file disguised as an image');
    const req = {
      file: {
        buffer: fakeBuffer,
        originalname: 'fake.jpg',
        mimetype: 'image/jpeg',
      },
    };
    let statusCode = null;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
    };
    let nextCalled = false;

    await compressSelfie(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'Should not proceed to next() on invalid image');
    assert.equal(statusCode, 400, 'Should return HTTP 400');
    assert.ok(responseBody.error, 'Should provide helpful error message');
  });

  await t.test('compressSelfie successfully processes genuine image to max 800px and quality 78', async () => {
    // Generate a valid 1200x900 test image in memory
    const validImageBuffer = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: { r: 10, g: 150, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    const req = {
      file: {
        buffer: validImageBuffer,
        originalname: 'camera_test.jpg',
        mimetype: 'image/jpeg',
      },
    };
    const res = {};
    let nextCalled = false;

    await compressSelfie(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, 'Next() should be called for valid image');
    assert.ok(req.file.path, 'Processed file path should be present');
    assert.ok(fs.existsSync(req.file.path), 'Output file should exist on disk');

    // Inspect processed image dimensions and format
    const outputMetadata = await sharp(req.file.path).metadata();
    assert.ok(outputMetadata.width <= 800, `Width should be <= 800, got ${outputMetadata.width}`);
    assert.ok(outputMetadata.height <= 800, `Height should be <= 800, got ${outputMetadata.height}`);
    assert.equal(outputMetadata.format, 'jpeg', 'Format should be JPEG');

    // Clean up temporary test file
    fs.unlinkSync(req.file.path);
  });

  await t.test('Database correctly stores is_mocked and accuracy in attendance and location_tracks', async () => {
    const testEmail = `mocktest_${Date.now()}@sologix.com`;
    const userResult = await db.run(
      `INSERT INTO users (email, username, password_hash, full_name, role, is_active)
       VALUES (?, ?, 'dummy_hash', 'Mock Test User', 'employee', 1)`,
      [testEmail, `user_${Date.now()}`]
    );
    const userId = userResult.lastID;

    // Check-in with mock location detected
    const checkInResult = await db.run(
      `INSERT INTO attendance (
        user_id, date, check_in_time, check_in_lat, check_in_lng, check_in_accuracy, check_in_is_mocked, check_in_address, check_in_selfie, status
      ) VALUES (?, '2026-10-09', ?, 28.6139, 77.2090, 15.5, 1, 'Delhi', 'test_selfie.jpg', 'checked_in')`,
      [userId, new Date().toISOString()]
    );
    const attendanceId = checkInResult.lastID;

    const savedAttendance = await db.get('SELECT * FROM attendance WHERE id = ?', [attendanceId]);
    assert.equal(savedAttendance.check_in_is_mocked, 1, 'check_in_is_mocked should be 1');
    assert.equal(savedAttendance.check_in_accuracy, 15.5, 'check_in_accuracy should be 15.5');

    // Check-out
    await db.run(
      `UPDATE attendance SET 
        check_out_time = ?, check_out_lat = 28.6140, check_out_lng = 77.2091,
        check_out_accuracy = 8.2, check_out_is_mocked = 1, status = 'checked_out'
       WHERE id = ?`,
      [new Date().toISOString(), attendanceId]
    );

    const updatedAttendance = await db.get('SELECT * FROM attendance WHERE id = ?', [attendanceId]);
    assert.equal(updatedAttendance.check_out_is_mocked, 1, 'check_out_is_mocked should be 1');
    assert.equal(updatedAttendance.check_out_accuracy, 8.2, 'check_out_accuracy should be 8.2');
  });
});
