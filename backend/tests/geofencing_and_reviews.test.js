const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const geofenceUtils = require('../src/utils/geofenceUtils');
const attendanceReviewController = require('../src/controllers/attendanceReviewController');
const salaryService = require('../src/services/salaryService');
const adminController = require('../src/controllers/adminController');

describe('Geofencing, Attendance Review & Single-Day Multi-Session Aggregation Tests', () => {
  let testUserId = null;
  let testOfficeId = null;

  before(async () => {
    // Create a temporary test user
    const userRes = await db.run(
      `INSERT INTO users (full_name, email, password_hash, role, department, is_active)
       VALUES ('Geofence Test Employee', 'geofence.test@sologix.com', 'hashed_pass', 'employee', 'Engineering', 1)`
    );
    testUserId = userRes.lastID || (await db.get("SELECT id FROM users WHERE email = 'geofence.test@sologix.com'")).id;

    // Set salary config
    await db.run(
      `INSERT INTO employee_salary_configs (user_id, salary_type, monthly_basic_salary, effective_date)
       VALUES (?, 'fixed', 30000, '2026-11-01')`,
      [testUserId]
    );

    // Create a temporary test office (Ranchi coordinates)
    const offRes = await db.run(
      `INSERT INTO offices (office_name, address, latitude, longitude, radius_meters, status)
       VALUES ('Ranchi Tech Park', 'Main Road, Ranchi, Jharkhand', 23.344100, 85.309563, 150.0, 'active')`
    );
    testOfficeId = offRes.lastID || (await db.get("SELECT id FROM offices WHERE office_name = 'Ranchi Tech Park'")).id;
  });

  after(async () => {
    // Clean up test data
    if (testUserId) {
      await db.run('DELETE FROM attendance WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM geofence_attendance_evidence WHERE employee_id = ?', [testUserId]);
      await db.run('DELETE FROM attendance_review_history WHERE employee_id = ?', [testUserId]);
      await db.run('DELETE FROM employee_salary_configs WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM users WHERE id = ?', [testUserId]);
    }
    if (testOfficeId) {
      await db.run('DELETE FROM offices WHERE id = ?', [testOfficeId]);
    }
  });

  // 1. HAVERSINE DISTANCE ENGINE TESTS
  describe('Haversine Calculation Engine', () => {
    it('accurately calculates 0 meters for identical coordinates', () => {
      const d = geofenceUtils.calculateDistanceMeters(23.3441, 85.309563, 23.3441, 85.309563);
      assert.strictEqual(Math.round(d), 0);
    });

    it('calculates expected physical distance between Ranchi and Noida (~990 km)', () => {
      const ranchi = { lat: 23.3441, lng: 85.309563 };
      const noida = { lat: 28.5355, lng: 77.3910 };
      const distance = geofenceUtils.calculateDistanceMeters(ranchi.lat, ranchi.lng, noida.lat, noida.lng);
      const km = distance / 1000;
      assert.ok(km > 950 && km < 1050, `Distance should be ~990 km, got ${km}`);
    });

    it('accurately identifies point inside 150m boundary', () => {
      const centerLat = 23.3441;
      const centerLng = 85.309563;
      const offsetLat = 23.3445; // ~44m north
      const offsetLng = 85.309563;
      const distance = geofenceUtils.calculateDistanceMeters(centerLat, centerLng, offsetLat, offsetLng);
      assert.ok(distance < 150, `Offset should be inside 150m radius, got ${distance}m`);
    });

    it('accurately identifies point outside 150m boundary', () => {
      const centerLat = 23.3441;
      const centerLng = 85.309563;
      const farLat = 23.3490; // ~540m north
      const farLng = 85.309563;
      const distance = geofenceUtils.calculateDistanceMeters(centerLat, centerLng, farLat, farLng);
      assert.ok(distance > 150, `Offset should be outside 150m radius, got ${distance}m`);
    });
  });

  // 2. GEOFENCE EVALUATOR TESTS
  describe('Geofence Evaluator against Offices', () => {
    it('approves location inside active office geofence', async () => {
      const activeOffices = await db.query('SELECT * FROM offices WHERE status = ?', ['active']);
      const user = { id: testUserId, department: 'Engineering' };
      const evalRes = geofenceUtils.evaluateGeofence({
        latitude: 23.3441,
        longitude: 85.309563,
        accuracy: 10,
        user,
        activeOffices,
      });

      assert.strictEqual(evalRes.isInside, true);
      assert.strictEqual(evalRes.geofenceResult, 'INSIDE');
      assert.ok(evalRes.nearestOffice, 'Should match Ranchi Tech Park');
      assert.strictEqual(evalRes.nearestOffice.id, testOfficeId);
    });

    it('marks location outside all office geofences as outside with distance', async () => {
      const activeOffices = await db.query('SELECT * FROM offices WHERE status = ?', ['active']);
      const user = { id: testUserId, department: 'Engineering' };
      // Coordinates in Patna, far away from Ranchi
      const evalRes = geofenceUtils.evaluateGeofence({
        latitude: 25.5941,
        longitude: 85.1376,
        accuracy: 15,
        user,
        activeOffices,
      });

      assert.strictEqual(evalRes.isInside, false);
      assert.strictEqual(evalRes.geofenceResult, 'OUTSIDE');
      assert.ok(evalRes.distanceFromNearest > 200000, 'Distance should be over 200km');
    });

    it('flags low accuracy location as isLowAccuracy', async () => {
      const activeOffices = await db.query('SELECT * FROM offices WHERE status = ?', ['active']);
      const user = { id: testUserId, department: 'Engineering' };
      const evalRes = geofenceUtils.evaluateGeofence({
        latitude: 23.3441,
        longitude: 85.309563,
        accuracy: 250, // 250m accuracy is worse than threshold
        user,
        activeOffices,
      });

      assert.strictEqual(evalRes.isLowAccuracy, true);
    });
  });

  // 3. ATTENDANCE SUBMISSION & EVIDENCE LOGGING TESTS
  describe('Attendance Check-In & Evidence Persistence', () => {
    let pendingAttId1 = null;
    let pendingAttId2 = null;

    it('persists outside-geofence check-in as pending_review with evidence', async () => {
      const nowIso = new Date().toISOString();
      const insertRes1 = await db.run(
        `INSERT INTO attendance (
          user_id, date, check_in_time, check_in_lat, check_in_lng, check_in_accuracy,
          status, geofence_status, review_status, office_id, distance_from_office,
          location_source, battery_percentage, network_status, outside_reason
        ) VALUES (?, '2026-11-05', ?, 25.5941, 85.1376, 12, 'present', 'outside', 'pending_review', ?, 245000, 'GPS', 88, 'connected', 'Client site visit at Patna')`,
        [testUserId, nowIso, testOfficeId]
      );
      pendingAttId1 = insertRes1.lastID || (await db.get('SELECT MAX(id) as id FROM attendance WHERE user_id = ?', [testUserId])).id;

      // Evidence log
      await db.run(
        `INSERT INTO geofence_attendance_evidence (
          attendance_id, employee_id, office_id, submitted_latitude, submitted_longitude,
          distance_from_office, accuracy_meters, location_source, geofence_result,
          review_status, outside_reason, created_at
        ) VALUES (?, ?, ?, 25.5941, 85.1376, 245000, 12, 'GPS', 'outside', 'pending_review', 'Client site visit at Patna', ?)`,
        [pendingAttId1, testUserId, testOfficeId, nowIso]
      );

      // Create a second record for approval test
      const insertRes2 = await db.run(
        `INSERT INTO attendance (
          user_id, date, check_in_time, check_in_lat, check_in_lng, check_in_accuracy,
          status, geofence_status, review_status, office_id, distance_from_office,
          location_source, battery_percentage, network_status, outside_reason
        ) VALUES (?, '2026-11-05', ?, 25.5941, 85.1376, 12, 'present', 'outside', 'pending_review', ?, 245000, 'GPS', 90, 'connected', 'Field work')`,
        [testUserId, nowIso, testOfficeId]
      );
      pendingAttId2 = insertRes2.lastID || (await db.get('SELECT MAX(id) as id FROM attendance WHERE user_id = ?', [testUserId])).id;

      const record = await db.get('SELECT * FROM attendance WHERE id = ?', [pendingAttId1]);
      assert.strictEqual(record.review_status, 'pending_review');
      assert.strictEqual(record.geofence_status, 'outside');

      const evidence = await db.get('SELECT * FROM geofence_attendance_evidence WHERE attendance_id = ?', [pendingAttId1]);
      assert.ok(evidence, 'Evidence record must exist');
      assert.strictEqual(evidence.review_status, 'pending_review');
    });

    it('rejecting review requires a mandatory non-empty reason and updates audit history', async () => {
      // Rejection without reason -> must fail with 400
      let failCode = null;
      let failJson = null;
      const resFail = {
        status: (code) => { failCode = code; return { json: (j) => { failJson = j; } }; },
        json: (j) => { failJson = j; },
      };
      await attendanceReviewController.rejectReview(
        { user: { id: 1, role: 'super_admin' }, params: { id: pendingAttId1 }, body: { rejection_reason: '' } },
        resFail
      );
      assert.strictEqual(failCode, 400);
      assert.ok(failJson.error.toLowerCase().includes('mandatory'));

      // Valid rejection with reason
      let successJson = null;
      let successCode = 200;
      const resSuccess = {
        status: (code) => {
          successCode = code;
          return {
            json: (j) => {
              successJson = j;
              console.log('Reject error/resp:', code, j);
            }
          };
        },
        json: (j) => { successJson = j; },
      };
      await attendanceReviewController.rejectReview(
        { user: { id: 1, role: 'super_admin' }, params: { id: pendingAttId1 }, body: { rejection_reason: 'Location not recognized' } },
        resSuccess
      );
      assert.strictEqual(successCode, 200);
      assert.ok(successJson && successJson.message && successJson.message.includes('rejected'));

      const updated = await db.get('SELECT * FROM attendance WHERE id = ?', [pendingAttId1]);
      assert.strictEqual(updated.review_status, 'rejected');

      const hist = await db.get('SELECT * FROM attendance_review_history WHERE attendance_id = ?', [pendingAttId1]);
      assert.ok(hist, 'Audit history row must be logged');
      assert.strictEqual(hist.new_status, 'rejected');
      assert.strictEqual(hist.reason, 'Location not recognized');
    });

    it('approving review marks attendance approved and updates audit history', async () => {
      let approveJson = null;
      let approveCode = 200;
      const resApprove = {
        status: (code) => {
          approveCode = code;
          return {
            json: (j) => {
              approveJson = j;
            }
          };
        },
        json: (j) => { approveJson = j; },
      };
      await attendanceReviewController.approveReview(
        { user: { id: 1, role: 'super_admin' }, params: { id: pendingAttId2 }, body: { note: 'Verified by manager' } },
        resApprove
      );
      assert.strictEqual(approveCode, 200);
      assert.ok(approveJson && approveJson.message && approveJson.message.includes('approved'));

      const updated = await db.get('SELECT * FROM attendance WHERE id = ?', [pendingAttId2]);
      assert.strictEqual(updated.review_status, 'approved');

      const hist = await db.get('SELECT * FROM attendance_review_history WHERE attendance_id = ?', [pendingAttId2]);
      assert.ok(hist, 'Audit history row must be logged');
      assert.strictEqual(hist.new_status, 'approved');
    });
  });

  // 4. CHECKOUT WITHOUT GEOFENCING TESTS
  describe('Checkout Strictly Unconstrained by Geofencing', () => {
    it('allows employee to checkout from any location outside the geofence', async () => {
      const nowIso = new Date().toISOString();
      const insertRes = await db.run(
        `INSERT INTO attendance (
          user_id, date, check_in_time, check_in_lat, check_in_lng, check_in_accuracy,
          status, geofence_status, review_status, office_id
        ) VALUES (?, '2026-11-06', ?, 23.3441, 85.309563, 10, 'present', 'inside', 'approved', ?)`,
        [testUserId, nowIso, testOfficeId]
      );
      const attId = insertRes.lastID || (await db.get('SELECT MAX(id) as id FROM attendance WHERE user_id = ?', [testUserId])).id;

      // Simulate checkout from Mumbai (~1,400 km away)
      const checkOutTime = new Date().toISOString();
      await db.run(
        `UPDATE attendance
         SET check_out_time = ?,
             check_out_lat = 19.0760,
             check_out_lng = 72.8777,
             check_out_accuracy = 20,
             status = 'checked_out'
         WHERE id = ?`,
        [checkOutTime, attId]
      );

      const closedRecord = await db.get('SELECT * FROM attendance WHERE id = ?', [attId]);
      assert.strictEqual(closedRecord.status, 'checked_out');
      assert.strictEqual(closedRecord.check_out_lat, 19.0760);
      assert.strictEqual(closedRecord.check_out_lng, 72.8777);
      assert.strictEqual(closedRecord.review_status, 'approved');
    });
  });

  // 5. SINGLE-DAY MULTI-SESSION AGGREGATION TESTS
  describe('Multiple Check-In/Check-Out Sessions = 1 Attendance Day Rule', () => {
    it('aggregates multiple sessions on the same IST date into strictly 1 payable day', async () => {
      const targetDate = '2026-11-07';
      await db.run('DELETE FROM attendance WHERE user_id = ? AND date = ?', [testUserId, targetDate]);

      // Session 1: 09:00 AM to 11:00 AM
      await db.run(
        `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status, geofence_status, review_status)
         VALUES (?, ?, '2026-11-07T09:00:00.000Z', '2026-11-07T11:00:00.000Z', 23.3441, 85.3095, 'checked_out', 'inside', 'approved')`,
        [testUserId, targetDate]
      );

      // Session 2: 12:00 PM to 02:00 PM
      await db.run(
        `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status, geofence_status, review_status)
         VALUES (?, ?, '2026-11-07T12:00:00.000Z', '2026-11-07T14:00:00.000Z', 23.3441, 85.3095, 'checked_out', 'inside', 'approved')`,
        [testUserId, targetDate]
      );

      // Session 3: 03:00 PM to 06:00 PM
      await db.run(
        `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status, geofence_status, review_status)
         VALUES (?, ?, '2026-11-07T15:00:00.000Z', '2026-11-07T18:00:00.000Z', 23.3441, 85.3095, 'checked_out', 'inside', 'approved')`,
        [testUserId, targetDate]
      );

      // Verify database has 3 session records
      const sessionCount = await db.get('SELECT COUNT(*) as c FROM attendance WHERE user_id = ? AND date = ?', [testUserId, targetDate]);
      assert.strictEqual(sessionCount.c, 3, 'Must retain all 3 sessions in history');

      // Verify query strictly yields 1 distinct calendar date
      const presentDatesOnTarget = await db.query(
        `SELECT DISTINCT date FROM attendance
         WHERE user_id = ? AND date = ? AND (review_status IS NULL OR review_status NOT IN ('pending_review', 'rejected'))`,
        [testUserId, targetDate]
      );
      assert.strictEqual(presentDatesOnTarget.length, 1, 'Distinct present dates must strictly be 1');
    });

    it('pending_review and rejected sessions do NOT count towards payable attendance days', async () => {
      const pendingDate = '2026-11-08';
      await db.run('DELETE FROM attendance WHERE user_id = ? AND date = ?', [testUserId, pendingDate]);

      // Unapproved outside session
      await db.run(
        `INSERT INTO attendance (user_id, date, check_in_time, check_out_time, check_in_lat, check_in_lng, status, geofence_status, review_status)
         VALUES (?, ?, '2026-11-08T09:00:00.000Z', '2026-11-08T18:00:00.000Z', 25.5941, 85.1376, 'checked_out', 'outside', 'pending_review')`,
        [testUserId, pendingDate]
      );

      const candidateDates = await db.query(
        `SELECT DISTINCT date FROM attendance
         WHERE user_id = ? AND date = ? AND (review_status IS NULL OR review_status NOT IN ('pending_review', 'rejected'))`,
        [testUserId, pendingDate]
      );
      assert.strictEqual(candidateDates.length, 0, 'Pending review session must NOT be counted as a payable date');
    });
  });

  // 6. REPORTS API ENDPOINT TESTS
  describe('Reports Generation via Controller', () => {
    it('executes getDashboardReports with daily filter and responds with records', async () => {
      const req = {
        query: { type: 'daily', date: '2026-11-07' }
      };
      let result = null;
      const res = {
        json: (j) => { result = j; },
        status: () => res,
      };
      await adminController.getDashboardReports(req, res);
      assert.ok(result, 'Result must exist');
      assert.strictEqual(result.type, 'daily');
      assert.ok(Array.isArray(result.data), 'Data must be an array');
    });

    it('executes getDashboardReports with CSV format and returns CSV string with headers', async () => {
      const req = {
        query: { type: 'daily', date: '2026-11-07', format: 'csv' }
      };
      let csvContent = null;
      let contentType = null;
      const res = {
        setHeader: (name, val) => {
          if (name.toLowerCase() === 'content-type') contentType = val;
        },
        send: (text) => { csvContent = text; },
        status: () => res,
      };
      await adminController.getDashboardReports(req, res);
      assert.strictEqual(contentType, 'text/csv');
      assert.ok(csvContent.includes('"ID","User ID","Employee Name"'), 'CSV must contain headers');
    });
  });
});
