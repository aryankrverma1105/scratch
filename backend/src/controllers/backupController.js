const db = require('../db');
const backupService = require('../services/backupService');
const { logActivity } = require('../services/activityLogger');

function isRootSuperAdmin(user) {
  if (!user) return false;
  const rootEmail = (process.env.ADMIN_DEFAULT_EMAIL || 'admin@company.com').toLowerCase();
  return (
    user.id === 1 ||
    (user.email && user.email.toLowerCase() === rootEmail) ||
    (user.email && user.email.toLowerCase() === 'admin@company.com') ||
    user.role === 'super_admin'
  );
}


/**
 * List all backup destinations
 */
async function listDestinations(req, res) {
  if (!isRootSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Access denied: Super Admin privileges required for backups' });
  }

  try {
    // Query credentials from company drive or env to share
    const credSource = await db.get(
      `SELECT client_id, client_secret FROM backup_destinations 
       WHERE client_id IS NOT NULL AND client_secret IS NOT NULL 
         AND client_id != '' AND client_secret != '' 
       ORDER BY id ASC LIMIT 1`
    );
    const defaultClientId = process.env.BACKUP_PERSONAL_CLIENT_ID || (credSource ? credSource.client_id : null);
    const defaultClientSecret = process.env.BACKUP_PERSONAL_CLIENT_SECRET || (credSource ? credSource.client_secret : null);
    const defaultRefreshToken = process.env.BACKUP_PERSONAL_REFRESH_TOKEN || null;

    // Ensure Personal Gmail destination is present
    const personalDest = await db.get(
      `SELECT id, client_id, client_secret, refresh_token FROM backup_destinations WHERE LOWER(account_email) = ? OR LOWER(name) LIKE '%aryan%'`,
      ['gameraryan2005@gmail.com']
    );
    const nowIso = new Date().toISOString();

    if (!personalDest) {
      await db.run(
        `INSERT INTO backup_destinations (name, drive_type, folder_id, client_id, client_secret, refresh_token, account_email, is_enabled, created_at, updated_at)
         VALUES (?, 'google_drive', ?, ?, ?, ?, 'gameraryan2005@gmail.com', 1, ?, ?)`,
        [
          'Personal Drive (gameraryan2005@gmail.com)',
          process.env.BACKUP_PERSONAL_FOLDER_ID || null,
          defaultClientId,
          defaultClientSecret,
          defaultRefreshToken,
          nowIso,
          nowIso,
        ]
      );
    } else {
      // Auto-sync missing credentials or refresh token
      await db.run(
        `UPDATE backup_destinations
         SET client_id = COALESCE(NULLIF(client_id, ''), ?),
             client_secret = COALESCE(NULLIF(client_secret, ''), ?),
             refresh_token = COALESCE(NULLIF(refresh_token, ''), ?),
             updated_at = ?
         WHERE id = ?`,
        [defaultClientId, defaultClientSecret, defaultRefreshToken, nowIso, personalDest.id]
      );
    }

    // Auto-fill client_id and client_secret on any other destinations that lack them
    if (defaultClientId && defaultClientSecret) {
      await db.run(
        `UPDATE backup_destinations
         SET client_id = COALESCE(NULLIF(client_id, ''), ?),
             client_secret = COALESCE(NULLIF(client_secret, ''), ?)
         WHERE (client_id IS NULL OR client_id = '') OR (client_secret IS NULL OR client_secret = '')`,
        [defaultClientId, defaultClientSecret]
      );
    }

    const destinations = await db.query(
      `SELECT id, name, drive_type, folder_id, account_email, is_enabled,
              last_test_status, last_test_message, last_test_at, created_at, updated_at
       FROM backup_destinations
       ORDER BY id ASC`
    );
    return res.json({ destinations });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list backup destinations', details: err.message });
  }
}

/**
 * Save or update a backup destination
 */
async function saveDestination(req, res) {
  if (!isRootSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Access denied: Super Admin privileges required for backups' });
  }

  try {
    const { id, name, folderId, clientId, clientSecret, refreshToken, accountEmail, isEnabled } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Destination name is required' });
    }

    const nowIso = new Date().toISOString();
    let destId = id;

    let cleanClientId = clientId && clientId.trim() ? clientId.trim() : null;
    let cleanClientSecret = clientSecret && clientSecret.trim() ? clientSecret.trim() : null;
    let cleanRefreshToken = refreshToken && refreshToken.trim() ? refreshToken.trim() : null;

    // Check sibling fallback credentials if not provided
    if (!cleanClientId || !cleanClientSecret) {
      const credSource = await db.get(
        `SELECT client_id, client_secret FROM backup_destinations 
         WHERE client_id IS NOT NULL AND client_secret IS NOT NULL 
           AND client_id != '' AND client_secret != '' AND id != ? 
         ORDER BY id ASC LIMIT 1`,
        [id || 0]
      );
      if (credSource) {
        if (!cleanClientId) cleanClientId = credSource.client_id;
        if (!cleanClientSecret) cleanClientSecret = credSource.client_secret;
      }
    }

    if (id) {
      // Update
      const existing = await db.get('SELECT * FROM backup_destinations WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: 'Destination not found' });

      await db.run(
        `UPDATE backup_destinations
         SET name = ?, folder_id = ?,
             client_id = COALESCE(?, NULLIF(client_id, ''), ?),
             client_secret = COALESCE(?, NULLIF(client_secret, ''), ?),
             refresh_token = COALESCE(?, refresh_token),
             account_email = ?, is_enabled = ?, updated_at = ?
         WHERE id = ?`,
        [
          name.trim(),
          folderId ? folderId.trim() : null,
          cleanClientId,
          cleanClientId,
          cleanClientSecret,
          cleanClientSecret,
          cleanRefreshToken,
          accountEmail ? accountEmail.trim() : null,
          isEnabled !== undefined ? (isEnabled ? 1 : 0) : 1,
          nowIso,
          id,
        ]
      );
    } else {
      // Insert
      if (!cleanRefreshToken) {
        return res.status(400).json({ error: 'OAuth Refresh Token is required for new Google Drive destinations' });
      }
      if (!cleanClientId || !cleanClientSecret) {
        return res.status(400).json({ error: 'Client ID and Client Secret are required' });
      }

      const result = await db.run(
        `INSERT INTO backup_destinations (name, folder_id, client_id, client_secret, refresh_token, account_email, is_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name.trim(),
          folderId ? folderId.trim() : null,
          cleanClientId,
          cleanClientSecret,
          cleanRefreshToken,
          accountEmail ? accountEmail.trim() : null,
          isEnabled !== undefined ? (isEnabled ? 1 : 0) : 1,
          nowIso,
          nowIso,
        ]
      );
      destId = result.lastID;
    }

    await logActivity({
      userId: req.user.id,
      action: id ? 'BACKUP_DESTINATION_UPDATED' : 'BACKUP_DESTINATION_CREATED',
      module: 'backup',
      entityType: 'backup_destination',
      entityId: destId,
      details: `Configured Google Drive backup destination: ${name}`,
    });

    const destination = await db.get(
      `SELECT id, name, drive_type, folder_id, account_email, is_enabled,
              last_test_status, last_test_message, last_test_at, created_at, updated_at
       FROM backup_destinations WHERE id = ?`,
      [destId]
    );

    return res.json({ destination });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save backup destination', details: err.message });
  }
}

/**
 * Test a destination connection
 */
async function testDestination(req, res) {
  if (!isRootSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Access denied: Super Admin privileges required for backups' });
  }

  try {
    const destinationId = parseInt(req.params.id, 10);
    const result = await backupService.testDestinationConnection(destinationId);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

/**
 * Delete a destination
 */
async function deleteDestination(req, res) {
  if (!isRootSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Access denied: Super Admin privileges required for backups' });
  }

  try {
    const destinationId = parseInt(req.params.id, 10);
    const existing = await db.get('SELECT * FROM backup_destinations WHERE id = ?', [destinationId]);
    if (!existing) return res.status(404).json({ error: 'Destination not found' });

    await db.run('DELETE FROM backup_destinations WHERE id = ?', [destinationId]);
    await logActivity({
      userId: req.user.id,
      action: 'BACKUP_DESTINATION_DELETED',
      module: 'backup',
      entityType: 'backup_destination',
      entityId: destinationId,
      details: `Deleted backup destination: ${existing.name}`,
    });

    return res.json({ message: 'Destination deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete destination', details: err.message });
  }
}

/**
 * Trigger an immediate manual backup
 */
async function triggerBackup(req, res) {
  if (!isRootSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Access denied: Super Admin privileges required for backups' });
  }

  try {
    const { destinationId } = req.body;
    const result = await backupService.performBackup({
      backupType: 'manual',
      specificDestinationId: destinationId ? parseInt(destinationId, 10) : null,
      userId: req.user.id,
    });
    return res.json({
      message: 'Backup processed successfully',
      ...result,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to trigger backup', details: err.message });
  }
}

/**
 * Get backup history / records
 */
async function getBackupHistory(req, res) {
  if (!isRootSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Access denied: Super Admin privileges required for backups' });
  }

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const records = await db.query(
      `SELECT * FROM backup_records ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return res.json({ records });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get backup history', details: err.message });
  }
}

/**
 * Retry a failed backup upload
 */
async function retryBackup(req, res) {
  if (!isRootSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Access denied: Super Admin privileges required for backups' });
  }

  try {
    const recordId = parseInt(req.params.id, 10);
    const result = await backupService.retryBackupRecord(recordId);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

/**
 * Verify backup integrity and manifest
 */
async function verifyBackup(req, res) {
  if (!isRootSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Access denied: Super Admin privileges required for backups' });
  }

  try {
    const recordId = parseInt(req.params.id, 10);
    const result = await backupService.verifyBackupRecord(recordId);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

/**
 * Safely restore from a backup record
 */
async function restoreBackup(req, res) {
  if (!isRootSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Access denied: Super Admin privileges required for backups' });
  }

  try {
    const recordId = parseInt(req.params.id, 10);
    const result = await backupService.restoreBackupRecord(recordId, { userId: req.user.id });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to restore backup', details: err.message });
  }
}

module.exports = {
  listDestinations,
  saveDestination,
  testDestination,
  deleteDestination,
  triggerBackup,
  getBackupHistory,
  retryBackup,
  verifyBackup,
  restoreBackup,
};

