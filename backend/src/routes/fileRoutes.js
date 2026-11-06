const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const config = require('../config');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

async function serveSelfie(req, res, bypassOwnerCheck = false) {
  try {
    const rawFilename = req.params.filename;
    // Strict basename sanitization against path traversal
    const safeFilename = path.basename(rawFilename);
    const filePath = path.join(config.SELFIE_DIR, safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Admin role or admin portal bypass
    if (bypassOwnerCheck || (req.user && req.user.role === 'admin')) {
      return res.sendFile(filePath);
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Employee can only access their own selfie
    const isOwner = await db.get(
      `SELECT id FROM attendance
       WHERE user_id = ? AND (check_in_selfie LIKE ? OR check_out_selfie LIKE ?)
       LIMIT 1`,
      [req.user.id, `%${safeFilename}%`, `%${safeFilename}%`]
    );

    if (!isOwner) {
      return res.status(403).json({ error: 'Access denied. You can only view your own selfies.' });
    }

    return res.sendFile(filePath);
  } catch (error) {
    console.error('File access error:', error);
    return res.status(500).json({ error: 'Failed to retrieve file' });
  }
}

router.get('/selfies/:filename', async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || (req.query && req.query.token);

  if (token) {
    return authenticateToken(req, res, () => serveSelfie(req, res));
  }

  // Allow direct image loading when requested from admin portal
  const referer = req.headers['referer'] || '';
  if (referer.includes('/admin')) {
    return serveSelfie(req, res, true);
  }

  return res.status(401).json({ error: 'Access token required' });
});

module.exports = router;
