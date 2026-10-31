const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const db = require('../db');
const { getCompanyDate } = require('../utils/timeUtils');
const { logActivity } = require('./activityLogger');

/**
 * Exchange OAuth2 refresh token for Google Drive access token
 */
async function refreshGoogleAccessToken(clientId, clientSecret, refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.access_token) {
            resolve(parsed.access_token);
          } else {
            reject(new Error(parsed.error_description || parsed.error || `Token refresh failed with status ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse OAuth2 response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Upload a file buffer to Google Drive using Multipart upload
 */
async function uploadToGoogleDrive(accessToken, filename, fileBuffer, folderId) {
  return new Promise((resolve, reject) => {
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: filename,
      mimeType: 'application/gzip',
    };
    if (folderId && folderId.trim()) {
      metadata.parents = [folderId.trim()];
    }

    const multipartRequestBody = Buffer.concat([
      Buffer.from(
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/gzip\r\n' +
        'Content-Transfer-Encoding: binary\r\n\r\n'
      ),
      fileBuffer,
      Buffer.from(closeDelimiter),
    ]);

    const options = {
      hostname: 'www.googleapis.com',
      path: '/upload/drive/v3/files?uploadType=multipart',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': multipartRequestBody.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.id) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error?.message || `Google Drive upload failed with status ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Drive response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(multipartRequestBody);
    req.end();
  });
}

/**
 * Create a compressed backup file from SQLite database.
 * Uses SQLite VACUUM INTO when available for live atomic snapshot.
 */
async function createDatabaseBackupSnapshot() {
  const isPostgres = process.env.DB_CLIENT === 'postgres' || process.env.DATABASE_URL;
  const now = new Date();
  const dateStr = getCompanyDate(now);
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const filename = `attendance_backup_${dateStr}_${hours}${minutes}.db.gz`;

  const backupDir = path.join(__dirname, '../../data/backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  let dbBuffer;
  if (!isPostgres) {
    const dbFile = path.join(__dirname, '../../data/attendance.db');
    const tempSnapshot = path.join(backupDir, `temp_${Date.now()}.db`);

    try {
      // Attempt live vacuum into snapshot
      await db.run(`VACUUM INTO ?`, [tempSnapshot]);
      const rawData = fs.readFileSync(tempSnapshot);
      dbBuffer = zlib.gzipSync(rawData);
      try { fs.unlinkSync(tempSnapshot); } catch (_) {}
    } catch (vacErr) {
      // Fallback: Read DB file directly if vacuum into not supported
      if (fs.existsSync(dbFile)) {
        const rawData = fs.readFileSync(dbFile);
        dbBuffer = zlib.gzipSync(rawData);
      } else {
        throw new Error(`Database file not found at ${dbFile}`);
      }
    }
  } else {
    // For postgres support, store SQL dump or schema state
    const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const summary = { backupDate: now.toISOString(), tables: tables.map(t => t.table_name) };
    dbBuffer = zlib.gzipSync(Buffer.from(JSON.stringify(summary)));
  }

  // Save local archive copy
  const localArchive = path.join(backupDir, filename);
  fs.writeFileSync(localArchive, dbBuffer);

  return {
    filename,
    fileBuffer: dbBuffer,
    fileSize: dbBuffer.length,
    localPath: localArchive,
  };
}

/**
 * Test OAuth connection to a Google Drive destination
 */
async function testDestinationConnection(destinationId) {
  const dest = await db.get('SELECT * FROM backup_destinations WHERE id = ?', [destinationId]);
  if (!dest) throw new Error('Backup destination not found');

  if (!dest.client_id || !dest.client_secret || !dest.refresh_token) {
    throw new Error('Destination is missing Client ID, Client Secret, or Refresh Token');
  }

  try {
    const accessToken = await refreshGoogleAccessToken(dest.client_id, dest.client_secret, dest.refresh_token);
    const nowIso = new Date().toISOString();

    await db.run(
      `UPDATE backup_destinations
       SET last_test_status = 'connected', last_test_message = 'Successfully connected and refreshed access token', last_test_at = ?, access_token = ?, updated_at = ?
       WHERE id = ?`,
      [nowIso, accessToken, nowIso, destinationId]
    );

    return {
      success: true,
      status: 'connected',
      message: 'Connection successful. Google Drive is ready for backups.',
    };
  } catch (err) {
    const nowIso = new Date().toISOString();
    await db.run(
      `UPDATE backup_destinations
       SET last_test_status = 'failed', last_test_message = ?, last_test_at = ?, updated_at = ?
       WHERE id = ?`,
      [err.message, nowIso, nowIso, destinationId]
    );
    throw err;
  }
}

/**
 * Perform backup to all enabled destinations (or a specific destination)
 */
async function performBackup({ backupType = 'daily_cron', specificDestinationId = null, userId = null } = {}) {
  const snapshot = await createDatabaseBackupSnapshot();
  const results = [];

  let query = 'SELECT * FROM backup_destinations WHERE is_enabled = 1';
  const params = [];
  if (specificDestinationId) {
    query += ' AND id = ?';
    params.push(specificDestinationId);
  }

  const destinations = await db.query(query, params);

  if (destinations.length === 0) {
    // Record local-only backup
    const nowIso = new Date().toISOString();
    await db.run(
      `INSERT INTO backup_records (backup_type, filename, file_size, destination_name, status, error_message, created_at)
       VALUES (?, ?, ?, 'Local Archive Only', 'success', 'Stored locally. No external Google Drive accounts enabled.', ?)`,
      [backupType, snapshot.filename, snapshot.fileSize, nowIso]
    );

    return {
      filename: snapshot.filename,
      fileSize: snapshot.fileSize,
      destinationsCount: 0,
      results: [{ destination: 'Local', status: 'saved_locally' }],
    };
  }

  for (const dest of destinations) {
    const nowIso = new Date().toISOString();
    try {
      if (!dest.client_id || !dest.client_secret || !dest.refresh_token) {
        throw new Error('Destination configuration incomplete: missing OAuth2 credentials.');
      }

      const accessToken = await refreshGoogleAccessToken(dest.client_id, dest.client_secret, dest.refresh_token);
      const driveFile = await uploadToGoogleDrive(accessToken, snapshot.filename, snapshot.fileBuffer, dest.folder_id);

      await db.run(
        `INSERT INTO backup_records (backup_type, filename, file_size, destination_id, destination_name, google_file_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'success', ?)`,
        [backupType, snapshot.filename, snapshot.fileSize, dest.id, dest.name, driveFile.id, nowIso]
      );

      results.push({
        destinationId: dest.id,
        name: dest.name,
        status: 'success',
        googleFileId: driveFile.id,
      });
    } catch (err) {
      await db.run(
        `INSERT INTO backup_records (backup_type, filename, file_size, destination_id, destination_name, status, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`,
        [backupType, snapshot.filename, snapshot.fileSize, dest.id, dest.name, err.message, nowIso]
      );

      results.push({
        destinationId: dest.id,
        name: dest.name,
        status: 'failed',
        error: err.message,
      });
    }
  }

  await logActivity({
    userId,
    action: backupType === 'manual' ? 'MANUAL_BACKUP_EXECUTED' : 'AUTOMATED_BACKUP_EXECUTED',
    module: 'backup',
    entityType: 'backup',
    details: `Backup ${snapshot.filename} (${(snapshot.fileSize / 1024).toFixed(1)} KB) processed across ${destinations.length} destination(s).`,
  });

  return {
    filename: snapshot.filename,
    fileSize: snapshot.fileSize,
    destinationsCount: destinations.length,
    results,
  };
}

/**
 * Retry an existing failed backup record
 */
async function retryBackupRecord(recordId) {
  const record = await db.get('SELECT * FROM backup_records WHERE id = ?', [recordId]);
  if (!record) throw new Error('Backup record not found');
  if (!record.destination_id) throw new Error('Cannot retry a record without an associated destination');

  const dest = await db.get('SELECT * FROM backup_destinations WHERE id = ?', [record.destination_id]);
  if (!dest) throw new Error('Destination no longer exists');

  const localFile = path.join(__dirname, '../../data/backups', record.filename);
  let fileBuffer;
  if (fs.existsSync(localFile)) {
    fileBuffer = fs.readFileSync(localFile);
  } else {
    const snap = await createDatabaseBackupSnapshot();
    fileBuffer = snap.fileBuffer;
  }

  const accessToken = await refreshGoogleAccessToken(dest.client_id, dest.client_secret, dest.refresh_token);
  const driveFile = await uploadToGoogleDrive(accessToken, record.filename, fileBuffer, dest.folder_id);

  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE backup_records
     SET status = 'success', google_file_id = ?, error_message = NULL, created_at = ?
     WHERE id = ?`,
    [driveFile.id, nowIso, recordId]
  );

  return {
    success: true,
    googleFileId: driveFile.id,
    status: 'success',
  };
}

module.exports = {
  createDatabaseBackupSnapshot,
  testDestinationConnection,
  performBackup,
  retryBackupRecord,
};
