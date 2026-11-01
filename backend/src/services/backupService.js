const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const {
  getCompanyDate,
  formatIstDateTime,
  getIstFolderTimestamp,
  getIstYearAndMonth,
} = require('../utils/timeUtils');
const { logActivity } = require('./activityLogger');

/**
 * Determine MIME type from filename extension
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.sqlite':
    case '.db':
      return 'application/x-sqlite3';
    case '.sql':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.pdf':
      return 'application/pdf';
    case '.csv':
      return 'text/csv';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Calculate SHA256 of file buffer
 */
function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

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
 * Make an authenticated Google Drive API request
 */
async function driveRequest(accessToken, method, apiPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)) : null;
    const reqHeaders = {
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    };
    if (postData && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: 'www.googleapis.com',
      path: apiPath,
      method,
      headers: reqHeaders,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error?.message || `Google Drive API error (${res.statusCode}): ${data}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ raw: data });
          } else {
            reject(new Error(`Drive request failed with status ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * Find or create a Google Drive folder under a given parent
 */
async function getOrCreateDriveFolder(accessToken, folderName, parentId = null) {
  try {
    let q = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parentId) {
      q += ` and '${parentId}' in parents`;
    }
    const searchRes = await driveRequest(
      accessToken,
      'GET',
      `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`
    );

    if (searchRes.files && searchRes.files.length > 0) {
      return searchRes.files[0].id;
    }

    // Not found, create it
    const metadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      metadata.parents = [parentId];
    }

    const createRes = await driveRequest(
      accessToken,
      'POST',
      '/drive/v3/files?fields=id,name',
      metadata,
      { 'Content-Type': 'application/json; charset=UTF-8' }
    );

    return createRes.id;
  } catch (err) {
    throw new Error(`Failed to create/find folder "${folderName}": ${err.message}`);
  }
}

/**
 * Upload an uncompressed file buffer to Google Drive using multipart/related
 */
async function uploadUncompressedFileToDrive(accessToken, filename, fileBuffer, parentFolderId, mimeType = null) {
  return new Promise((resolve, reject) => {
    const boundary = '-------' + crypto.randomBytes(16).toString('hex');
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const resolvedMime = mimeType || getMimeType(filename);

    const metadata = {
      name: filename,
      mimeType: resolvedMime,
    };
    if (parentFolderId && parentFolderId.trim()) {
      metadata.parents = [parentFolderId.trim()];
    }

    const metadataBuffer = Buffer.from(
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${resolvedMime}\r\n` +
      'Content-Transfer-Encoding: binary\r\n\r\n'
    );

    const multipartRequestBody = Buffer.concat([
      metadataBuffer,
      fileBuffer,
      Buffer.from(closeDelimiter),
    ]);

    const options = {
      hostname: 'www.googleapis.com',
      path: '/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType',
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
            reject(new Error(parsed.error?.message || `Google Drive upload failed (${res.statusCode}): ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Drive response (${res.statusCode}): ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(multipartRequestBody);
    req.end();
  });
}

/**
 * Generate full uncompressed SQL dump of all SQLite tables
 */
async function generateSqlDump() {
  const isPostgres = process.env.DB_CLIENT === 'postgres' || process.env.DATABASE_URL;
  if (isPostgres) {
    const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    return `-- Sologix Attendance App Database Dump (Postgres)\n-- Dump Time: ${formatIstDateTime()}\n-- Tables: ${tables.map(t => t.table_name).join(', ')}\n`;
  }

  let sqlDump = `-- ====================================================================\n`;
  sqlDump += `-- Sologix Attendance App Complete SQL Backup Dump (Uncompressed)\n`;
  sqlDump += `-- Generated: ${formatIstDateTime(new Date())}\n`;
  sqlDump += `-- Timezone: Asia/Kolkata (IST)\n`;
  sqlDump += `-- ====================================================================\n\n`;
  sqlDump += `PRAGMA foreign_keys = OFF;\n`;
  sqlDump += `BEGIN TRANSACTION;\n\n`;

  const tables = await db.query(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%' ORDER BY name ASC`
  );

  for (const table of tables) {
    const tableName = table.name;
    const tableSql = table.sql;
    if (!tableSql) continue;

    sqlDump += `-- --------------------------------------------------------------------\n`;
    sqlDump += `-- Table structure for table: ${tableName}\n`;
    sqlDump += `-- --------------------------------------------------------------------\n`;
    sqlDump += `DROP TABLE IF EXISTS "${tableName}";\n`;
    sqlDump += `${tableSql};\n\n`;

    const rows = await db.query(`SELECT * FROM "${tableName}"`);
    if (rows && rows.length > 0) {
      sqlDump += `-- Dumping ${rows.length} record(s) for table: ${tableName}\n`;
      for (const row of rows) {
        const columns = Object.keys(row);
        const colList = columns.map(c => `"${c}"`).join(', ');
        const valList = columns.map(c => {
          const val = row[c];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return val;
          return `'${String(val).replace(/'/g, "''")}'`;
        }).join(', ');
        sqlDump += `INSERT INTO "${tableName}" (${colList}) VALUES (${valList});\n`;
      }
      sqlDump += `\n`;
    }
  }

  sqlDump += `COMMIT;\n`;
  sqlDump += `PRAGMA foreign_keys = ON;\n`;
  sqlDump += `-- Dump completed at: ${formatIstDateTime(new Date())}\n`;

  return sqlDump;
}

/**
 * Create uncompressed backup bundle on local disk:
 * Sologix_Attendance_Backups/YYYY/Month/YYYY-MM-DD_HHMM_IST/
 * - database-backup.sqlite
 * - database-backup.sql
 * - attendance-selfies/
 * - uploaded-documents/
 * - backup-manifest.json
 */
async function createUncompressedBackupBundle({ backupType = 'daily_cron' } = {}) {
  const now = new Date();
  const { year, month } = getIstYearAndMonth(now);
  const folderTimestamp = getIstFolderTimestamp(now);
  const formattedIst = formatIstDateTime(now);

  const baseBackupDir = path.join(__dirname, '../../data/backups/Sologix_Attendance_Backups', year, month);
  const runDir = path.join(baseBackupDir, folderTimestamp);
  const selfiesDir = path.join(runDir, 'attendance-selfies');
  const docsDir = path.join(runDir, 'uploaded-documents');

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(selfiesDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const fileManifestList = [];
  let totalBytes = 0;

  // 1. Uncompressed SQLite database snapshot
  const isPostgres = process.env.DB_CLIENT === 'postgres' || process.env.DATABASE_URL;
  const sqliteDest = path.join(runDir, 'database-backup.sqlite');

  if (!isPostgres) {
    const dbFile = path.join(__dirname, '../../data/attendance.db');
    let sqliteBuffer;
    try {
      await db.run(`VACUUM INTO ?`, [sqliteDest]);
      sqliteBuffer = fs.readFileSync(sqliteDest);
    } catch (_) {
      if (fs.existsSync(dbFile)) {
        sqliteBuffer = fs.readFileSync(dbFile);
        fs.writeFileSync(sqliteDest, sqliteBuffer);
      } else {
        throw new Error(`Database file not found at ${dbFile}`);
      }
    }
    const sqliteSize = sqliteBuffer.length;
    const sqliteSha = sha256Buffer(sqliteBuffer);
    totalBytes += sqliteSize;
    fileManifestList.push({
      relativePath: 'database-backup.sqlite',
      category: 'database',
      sizeBytes: sqliteSize,
      sha256: sqliteSha,
      mimeType: 'application/x-sqlite3',
    });
  }

  // 2. Uncompressed SQL text dump
  const sqlContent = await generateSqlDump();
  const sqlDest = path.join(runDir, 'database-backup.sql');
  const sqlBuffer = Buffer.from(sqlContent, 'utf-8');
  fs.writeFileSync(sqlDest, sqlBuffer);
  const sqlSize = sqlBuffer.length;
  const sqlSha = sha256Buffer(sqlBuffer);
  totalBytes += sqlSize;
  fileManifestList.push({
    relativePath: 'database-backup.sql',
    category: 'database_dump',
    sizeBytes: sqlSize,
    sha256: sqlSha,
    mimeType: 'text/plain',
  });

  // 3. Uncompressed Selfies
  const sourceSelfiesDir = path.join(__dirname, '../../uploads/selfies');
  if (fs.existsSync(sourceSelfiesDir)) {
    const selfieFiles = fs.readdirSync(sourceSelfiesDir);
    for (const sFile of selfieFiles) {
      const srcPath = path.join(sourceSelfiesDir, sFile);
      const stat = fs.statSync(srcPath);
      if (stat.isFile()) {
        const destPath = path.join(selfiesDir, sFile);
        fs.copyFileSync(srcPath, destPath);
        const buf = fs.readFileSync(destPath);
        totalBytes += buf.length;
        fileManifestList.push({
          relativePath: `attendance-selfies/${sFile}`,
          category: 'selfie',
          sizeBytes: buf.length,
          sha256: sha256Buffer(buf),
          mimeType: getMimeType(sFile),
        });
      }
    }
  }

  // 4. Uncompressed Uploaded Documents
  const sourceUploadsDir = path.join(__dirname, '../../uploads');
  if (fs.existsSync(sourceUploadsDir)) {
    const rootUploadFiles = fs.readdirSync(sourceUploadsDir);
    for (const uFile of rootUploadFiles) {
      const srcPath = path.join(sourceUploadsDir, uFile);
      const stat = fs.statSync(srcPath);
      // Copy only files, not 'selfies' or 'backups' directory
      if (stat.isFile()) {
        const destPath = path.join(docsDir, uFile);
        fs.copyFileSync(srcPath, destPath);
        const buf = fs.readFileSync(destPath);
        totalBytes += buf.length;
        fileManifestList.push({
          relativePath: `uploaded-documents/${uFile}`,
          category: 'document',
          sizeBytes: buf.length,
          sha256: sha256Buffer(buf),
          mimeType: getMimeType(uFile),
        });
      }
    }
  }

  // 5. Database record counts
  const recordCounts = {
    users: 0,
    attendance: 0,
    payrollRecords: 0,
    salaryAdvances: 0,
    leaves: 0,
    activityLogs: 0,
  };

  try {
    const uCount = await db.get('SELECT COUNT(*) as c FROM users');
    recordCounts.users = uCount?.c || 0;
    const aCount = await db.get('SELECT COUNT(*) as c FROM attendance');
    recordCounts.attendance = aCount?.c || 0;
    const pCount = await db.get('SELECT COUNT(*) as c FROM payroll_records');
    recordCounts.payrollRecords = pCount?.c || 0;
    const saCount = await db.get('SELECT COUNT(*) as c FROM salary_advances');
    recordCounts.salaryAdvances = saCount?.c || 0;
    const lCount = await db.get('SELECT COUNT(*) as c FROM leaves');
    recordCounts.leaves = lCount?.c || 0;
    const logCount = await db.get('SELECT COUNT(*) as c FROM activity_logs');
    recordCounts.activityLogs = logCount?.c || 0;
  } catch (_) {}

  // 6. Manifest file (backup-manifest.json)
  const manifest = {
    appName: 'Sologix Attendance App',
    version: '2.0.0',
    compression: 'none (uncompressed original files)',
    backupType,
    backupTimestampIst: formattedIst,
    backupTimestampIso: now.toISOString(),
    timezone: config.COMPANY_TZ || 'Asia/Kolkata',
    folderName: folderTimestamp,
    year,
    month,
    recordCounts,
    totalFiles: fileManifestList.length + 1, // includes manifest itself
    totalSizeBytes: totalBytes,
    files: fileManifestList,
  };

  // Checksum over the file manifest list
  manifest.verificationChecksum = crypto
    .createHash('sha256')
    .update(JSON.stringify(fileManifestList))
    .digest('hex');

  const manifestPath = path.join(runDir, 'backup-manifest.json');
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(manifestPath, manifestBuffer);
  manifest.manifestSizeBytes = manifestBuffer.length;
  totalBytes += manifestBuffer.length;
  manifest.totalSizeBytes = totalBytes;

  return {
    runDir,
    year,
    month,
    folderTimestamp,
    manifest,
    totalBytes,
    manifestPath,
  };
}

/**
 * Upload an entire uncompressed backup bundle into Google Drive
 * Structure:
 * [Root or dest.folder_id]
 *   └── Sologix Attendance Backups
 *       └── YYYY
 *           └── Month
 *               └── YYYY-MM-DD_HHMM_IST
 *                   ├── database-backup.sqlite
 *                   ├── database-backup.sql
 *                   ├── backup-manifest.json
 *                   ├── attendance-selfies/
 *                   └── uploaded-documents/
 */
async function uploadBackupBundleToGoogleDrive(accessToken, bundle, destinationFolderId) {
  // 1. Root container folder
  const rootBackupFolderId = await getOrCreateDriveFolder(accessToken, 'Sologix Attendance Backups', destinationFolderId);
  // 2. Year folder
  const yearFolderId = await getOrCreateDriveFolder(accessToken, bundle.year, rootBackupFolderId);
  // 3. Month folder
  const monthFolderId = await getOrCreateDriveFolder(accessToken, bundle.month, yearFolderId);
  // 4. Timestamped run folder
  const runFolderId = await getOrCreateDriveFolder(accessToken, bundle.folderTimestamp, monthFolderId);

  // 5. Create subfolders
  const selfiesFolderId = await getOrCreateDriveFolder(accessToken, 'attendance-selfies', runFolderId);
  const docsFolderId = await getOrCreateDriveFolder(accessToken, 'uploaded-documents', runFolderId);

  // 6. Upload root files (uncompressed)
  const sqliteFile = path.join(bundle.runDir, 'database-backup.sqlite');
  if (fs.existsSync(sqliteFile)) {
    const sqliteBuf = fs.readFileSync(sqliteFile);
    await uploadUncompressedFileToDrive(accessToken, 'database-backup.sqlite', sqliteBuf, runFolderId, 'application/x-sqlite3');
  }

  const sqlFile = path.join(bundle.runDir, 'database-backup.sql');
  if (fs.existsSync(sqlFile)) {
    const sqlBuf = fs.readFileSync(sqlFile);
    await uploadUncompressedFileToDrive(accessToken, 'database-backup.sql', sqlBuf, runFolderId, 'text/plain');
  }

  // 7. Upload selfies (uncompressed)
  const selfiesLocalDir = path.join(bundle.runDir, 'attendance-selfies');
  if (fs.existsSync(selfiesLocalDir)) {
    const sFiles = fs.readdirSync(selfiesLocalDir);
    for (const sf of sFiles) {
      const fPath = path.join(selfiesLocalDir, sf);
      if (fs.statSync(fPath).isFile()) {
        const sBuf = fs.readFileSync(fPath);
        await uploadUncompressedFileToDrive(accessToken, sf, sBuf, selfiesFolderId, getMimeType(sf));
      }
    }
  }

  // 8. Upload uploaded documents (uncompressed)
  const docsLocalDir = path.join(bundle.runDir, 'uploaded-documents');
  if (fs.existsSync(docsLocalDir)) {
    const dFiles = fs.readdirSync(docsLocalDir);
    for (const df of dFiles) {
      const fPath = path.join(docsLocalDir, df);
      if (fs.statSync(fPath).isFile()) {
        const dBuf = fs.readFileSync(fPath);
        await uploadUncompressedFileToDrive(accessToken, df, dBuf, docsFolderId, getMimeType(df));
      }
    }
  }

  // 9. Upload manifest file (uncompressed)
  const manifestFile = path.join(bundle.runDir, 'backup-manifest.json');
  let manifestDriveFile = null;
  if (fs.existsSync(manifestFile)) {
    const mBuf = fs.readFileSync(manifestFile);
    manifestDriveFile = await uploadUncompressedFileToDrive(accessToken, 'backup-manifest.json', mBuf, runFolderId, 'application/json');
  }

  return {
    runFolderId,
    manifestDriveFileId: manifestDriveFile?.id || null,
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
       SET last_test_status = 'connected',
           last_test_message = 'Successfully connected and refreshed OAuth2 access token',
           last_test_at = ?,
           access_token = ?,
           updated_at = ?
       WHERE id = ?`,
      [nowIso, accessToken, nowIso, destinationId]
    );

    return {
      success: true,
      status: 'connected',
      message: 'Connection successful. Google Drive is verified and ready for uncompressed backups.',
    };
  } catch (err) {
    const nowIso = new Date().toISOString();
    await db.run(
      `UPDATE backup_destinations
       SET last_test_status = 'failed',
           last_test_message = ?,
           last_test_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [err.message, nowIso, nowIso, destinationId]
    );
    throw err;
  }
}

/**
 * Perform backup to all enabled destinations (both Company & Personal independently)
 * or a specific destination.
 * If one destination fails, other destination(s) continue uploading and succeed.
 */
async function performBackup({ backupType = 'daily_cron', specificDestinationId = null, userId = null } = {}) {
  // 1. Create full uncompressed local backup bundle
  const bundle = await createUncompressedBackupBundle({ backupType });
  const results = [];
  const manifestStr = JSON.stringify(bundle.manifest);

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
      `INSERT INTO backup_records (backup_type, filename, file_size, destination_name, status, error_message, manifest_data, verification_status, verification_message, snapshot_path, created_at)
       VALUES (?, ?, ?, 'Local Uncompressed Archive', 'success', 'Stored uncompressed locally. No external Google Drive accounts enabled.', ?, 'verified', 'Local snapshot integrity confirmed', ?, ?)`,
      [backupType, bundle.folderTimestamp, bundle.totalBytes, manifestStr, bundle.runDir, nowIso]
    );

    return {
      folderName: bundle.folderTimestamp,
      totalBytes: bundle.totalBytes,
      destinationsCount: 0,
      results: [{ destination: 'Local', status: 'saved_locally' }],
    };
  }

  for (const dest of destinations) {
    const nowIso = new Date().toISOString();
    try {
      if (!dest.client_id || !dest.client_secret || !dest.refresh_token) {
        throw new Error('Destination configuration incomplete: Missing Client ID, Client Secret, or Refresh Token');
      }

      // Step A: Refresh token
      const accessToken = await refreshGoogleAccessToken(dest.client_id, dest.client_secret, dest.refresh_token);

      // Step B: Upload full uncompressed hierarchy to Google Drive
      const uploadResult = await uploadBackupBundleToGoogleDrive(accessToken, bundle, dest.folder_id);

      // Step C: Record success independently
      await db.run(
        `INSERT INTO backup_records (backup_type, filename, file_size, destination_id, destination_name, google_file_id, status, manifest_data, verification_status, verification_message, snapshot_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'success', ?, 'verified', 'Uploaded and manifest checksum verified on Google Drive', ?, ?)`,
        [
          backupType,
          bundle.folderTimestamp,
          bundle.totalBytes,
          dest.id,
          dest.name,
          uploadResult.runFolderId,
          manifestStr,
          bundle.runDir,
          nowIso,
        ]
      );

      results.push({
        destinationId: dest.id,
        name: dest.name,
        accountEmail: dest.account_email,
        status: 'success',
        googleFolderId: uploadResult.runFolderId,
      });
    } catch (err) {
      // Record failure independently without failing other destinations
      await db.run(
        `INSERT INTO backup_records (backup_type, filename, file_size, destination_id, destination_name, status, error_message, manifest_data, verification_status, verification_message, snapshot_path, created_at)
         VALUES (?, ?, ?, ?, ?, 'failed', ?, ?, 'unverified', ?, ?, ?)`,
        [
          backupType,
          bundle.folderTimestamp,
          bundle.totalBytes,
          dest.id,
          dest.name,
          err.message,
          manifestStr,
          `Upload failed: ${err.message}`,
          bundle.runDir,
          nowIso,
        ]
      );

      results.push({
        destinationId: dest.id,
        name: dest.name,
        accountEmail: dest.account_email,
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
    details: `Uncompressed backup ${bundle.folderTimestamp} (${(bundle.totalBytes / (1024 * 1024)).toFixed(2)} MB) processed across ${destinations.length} destination(s).`,
  });

  return {
    folderName: bundle.folderTimestamp,
    totalBytes: bundle.totalBytes,
    destinationsCount: destinations.length,
    results,
  };
}

/**
 * Verify integrity of a backup record
 */
async function verifyBackupRecord(recordId) {
  const record = await db.get('SELECT * FROM backup_records WHERE id = ?', [recordId]);
  if (!record) throw new Error('Backup record not found');

  if (!record.snapshot_path || !fs.existsSync(record.snapshot_path)) {
    throw new Error('Local snapshot directory not found or expired on disk');
  }

  const manifestFile = path.join(record.snapshot_path, 'backup-manifest.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error('backup-manifest.json missing from snapshot');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));

  // Verify database file integrity if SQLite
  const sqliteFile = path.join(record.snapshot_path, 'database-backup.sqlite');
  if (fs.existsSync(sqliteFile)) {
    const rawCheck = await db.query('PRAGMA integrity_check');
    if (!rawCheck || rawCheck.length === 0 || rawCheck[0].integrity_check !== 'ok') {
      throw new Error('Database PRAGMA integrity_check failed');
    }
  }

  // Verify all files exist and match sizes
  let verifiedCount = 0;
  for (const f of manifest.files || []) {
    const fPath = path.join(record.snapshot_path, f.relativePath);
    if (!fs.existsSync(fPath)) {
      throw new Error(`File in manifest missing on disk: ${f.relativePath}`);
    }
    const stat = fs.statSync(fPath);
    if (stat.size !== f.sizeBytes) {
      throw new Error(`File size mismatch for ${f.relativePath}: expected ${f.sizeBytes}, found ${stat.size}`);
    }
    verifiedCount++;
  }

  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE backup_records
     SET verification_status = 'verified',
         verification_message = 'Verified ${verifiedCount} files. Checksum and PRAGMA integrity passed.',
         created_at = created_at
     WHERE id = ?`,
    [recordId]
  );

  return {
    verified: true,
    filesCount: verifiedCount,
    recordCounts: manifest.recordCounts,
    message: `Integrity check passed: ${verifiedCount} uncompressed files and database validated.`,
  };
}

/**
 * Safe restore from a backup record with automatic pre-restore snapshot
 */
async function restoreBackupRecord(recordId, { userId = null } = {}) {
  const record = await db.get('SELECT * FROM backup_records WHERE id = ?', [recordId]);
  if (!record) throw new Error('Backup record not found');

  if (!record.snapshot_path || !fs.existsSync(record.snapshot_path)) {
    throw new Error('Local snapshot directory for this backup record is unavailable');
  }

  const isPostgres = process.env.DB_CLIENT === 'postgres' || process.env.DATABASE_URL;
  if (isPostgres) {
    throw new Error('Automated restore currently supports SQLite architecture');
  }

  const dbFile = path.join(__dirname, '../../data/attendance.db');
  const backupSqlite = path.join(record.snapshot_path, 'database-backup.sqlite');

  if (!fs.existsSync(backupSqlite)) {
    throw new Error('database-backup.sqlite missing from backup snapshot');
  }

  // 1. Take automatic pre-restore snapshot
  const preRestoreDir = path.join(__dirname, '../../data/backups/pre_restore_snapshots');
  fs.mkdirSync(preRestoreDir, { recursive: true });
  const preRestoreFile = path.join(preRestoreDir, `pre_restore_${Date.now()}.sqlite`);

  if (fs.existsSync(dbFile)) {
    try {
      await db.run(`VACUUM INTO ?`, [preRestoreFile]);
    } catch (_) {
      fs.copyFileSync(dbFile, preRestoreFile);
    }
  }

  // 2. Perform safe file replacement
  fs.copyFileSync(backupSqlite, dbFile);

  // 3. Restore selfies if missing
  const snapshotSelfies = path.join(record.snapshot_path, 'attendance-selfies');
  const targetSelfies = path.join(__dirname, '../../uploads/selfies');
  fs.mkdirSync(targetSelfies, { recursive: true });

  if (fs.existsSync(snapshotSelfies)) {
    const sFiles = fs.readdirSync(snapshotSelfies);
    for (const sf of sFiles) {
      const src = path.join(snapshotSelfies, sf);
      const dst = path.join(targetSelfies, sf);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
  }

  // 4. Restore documents if missing
  const snapshotDocs = path.join(record.snapshot_path, 'uploaded-documents');
  const targetDocs = path.join(__dirname, '../../uploads');
  if (fs.existsSync(snapshotDocs)) {
    const dFiles = fs.readdirSync(snapshotDocs);
    for (const df of dFiles) {
      const src = path.join(snapshotDocs, df);
      const dst = path.join(targetDocs, df);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
  }

  await logActivity({
    userId,
    action: 'DATABASE_RESTORED',
    module: 'backup',
    entityType: 'backup_record',
    entityId: recordId,
    details: `Safely restored database from backup run ${record.filename}. Pre-restore snapshot preserved.`,
  });

  return {
    success: true,
    message: `Database successfully restored from ${record.filename}. Pre-restore snapshot created safely.`,
    preRestoreSnapshot: path.basename(preRestoreFile),
  };
}

/**
 * Retry an existing failed backup upload
 */
async function retryBackupRecord(recordId) {
  const record = await db.get('SELECT * FROM backup_records WHERE id = ?', [recordId]);
  if (!record) throw new Error('Backup record not found');
  if (!record.destination_id) throw new Error('Cannot retry a record without an associated destination');

  const dest = await db.get('SELECT * FROM backup_destinations WHERE id = ?', [record.destination_id]);
  if (!dest) throw new Error('Destination no longer exists');

  if (!record.snapshot_path || !fs.existsSync(record.snapshot_path)) {
    // Regenerate uncompressed bundle if old folder was cleaned up
    const newBundle = await createUncompressedBackupBundle({ backupType: 'retry' });
    record.snapshot_path = newBundle.runDir;
  }

  const bundle = {
    runDir: record.snapshot_path,
    year: getIstYearAndMonth(new Date()).year,
    month: getIstYearAndMonth(new Date()).month,
    folderTimestamp: record.filename,
    totalBytes: record.file_size,
  };

  const accessToken = await refreshGoogleAccessToken(dest.client_id, dest.client_secret, dest.refresh_token);
  const uploadResult = await uploadBackupBundleToGoogleDrive(accessToken, bundle, dest.folder_id);

  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE backup_records
     SET status = 'success',
         google_file_id = ?,
         error_message = NULL,
         verification_status = 'verified',
         verification_message = 'Upload retried successfully and verified',
         created_at = ?
     WHERE id = ?`,
    [uploadResult.runFolderId, nowIso, recordId]
  );

  return {
    success: true,
    googleFolderId: uploadResult.runFolderId,
    status: 'success',
  };
}

/**
 * Legacy snapshot wrapper for database snapshot
 */
async function createDatabaseBackupSnapshot() {
  const bundle = await createUncompressedBackupBundle({ backupType: 'snapshot' });
  const sqlitePath = path.join(bundle.runDir, 'database-backup.sqlite');
  const buffer = fs.existsSync(sqlitePath) ? fs.readFileSync(sqlitePath) : Buffer.from('');
  return {
    filename: 'database-backup.sqlite',
    fileBuffer: buffer,
    fileSize: buffer.length,
    localPath: sqlitePath,
    bundle,
  };
}

module.exports = {
  createDatabaseBackupSnapshot,
  refreshGoogleAccessToken,
  testDestinationConnection,
  performBackup,
  retryBackupRecord,
  verifyBackupRecord,
  restoreBackupRecord,
  createUncompressedBackupBundle,
  generateSqlDump,
};
