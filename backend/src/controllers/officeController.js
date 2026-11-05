const db = require('../db');
const { logActivity } = require('../services/activityLogger');

/**
 * List all offices (Admin endpoint)
 */
async function listOffices(req, res) {
  try {
    const { status, search } = req.query;
    let sql = 'SELECT * FROM offices WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (search && search.trim()) {
      sql += ' AND (LOWER(office_name) LIKE ? OR LOWER(address) LIKE ?)';
      const term = `%${search.trim().toLowerCase()}%`;
      params.push(term, term);
    }

    sql += ' ORDER BY status ASC, office_name ASC';
    const offices = await db.query(sql, params);

    // Calculate count of employees assigned if any
    const enriched = offices.map((o) => {
      let assignedDepts = [];
      let assignedUsers = [];
      try {
        if (o.assigned_departments) assignedDepts = JSON.parse(o.assigned_departments);
      } catch (_) {}
      try {
        if (o.assigned_user_ids) assignedUsers = JSON.parse(o.assigned_user_ids);
      } catch (_) {}

      return {
        ...o,
        assigned_departments: Array.isArray(assignedDepts) ? assignedDepts : [],
        assigned_user_ids: Array.isArray(assignedUsers) ? assignedUsers : [],
      };
    });

    return res.json({ offices: enriched });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list offices', details: err.message });
  }
}

/**
 * Get active offices (For employee app & map display)
 */
async function getActiveOffices(req, res) {
  try {
    const offices = await db.query(
      `SELECT id, office_name, address, latitude, longitude, radius_meters, description,
              assigned_departments, assigned_user_ids, status
       FROM offices WHERE status = 'active' ORDER BY office_name ASC`
    );

    const parsed = offices.map((o) => {
      let assignedDepts = [];
      let assignedUsers = [];
      try {
        if (o.assigned_departments) assignedDepts = JSON.parse(o.assigned_departments);
      } catch (_) {}
      try {
        if (o.assigned_user_ids) assignedUsers = JSON.parse(o.assigned_user_ids);
      } catch (_) {}

      return {
        ...o,
        assigned_departments: Array.isArray(assignedDepts) ? assignedDepts : [],
        assigned_user_ids: Array.isArray(assignedUsers) ? assignedUsers : [],
      };
    });

    return res.json({ offices: parsed });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch active offices', details: err.message });
  }
}

/**
 * Get office by ID
 */
async function getOfficeById(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const office = await db.get('SELECT * FROM offices WHERE id = ?', [id]);
    if (!office) {
      return res.status(404).json({ error: 'Office location not found' });
    }

    try {
      office.assigned_departments = office.assigned_departments ? JSON.parse(office.assigned_departments) : [];
    } catch (_) {
      office.assigned_departments = [];
    }
    try {
      office.assigned_user_ids = office.assigned_user_ids ? JSON.parse(office.assigned_user_ids) : [];
    } catch (_) {
      office.assigned_user_ids = [];
    }

    return res.json({ office });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get office', details: err.message });
  }
}

/**
 * Create a new office location
 */
async function createOffice(req, res) {
  try {
    const {
      office_name,
      address,
      latitude,
      longitude,
      radius_meters,
      description,
      status = 'active',
      assigned_departments,
      assigned_user_ids,
    } = req.body;

    if (!office_name || !office_name.trim()) {
      return res.status(400).json({ error: 'Office/Site name is required' });
    }

    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      return res.status(400).json({ error: 'Valid latitude between -90 and 90 is required' });
    }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ error: 'Valid longitude between -180 and 180 is required' });
    }

    const radNum = parseFloat(radius_meters) || 100.0;
    if (radNum <= 0) {
      return res.status(400).json({ error: 'Geofencing radius must be greater than 0 meters' });
    }

    const deptsJson = assigned_departments
      ? (typeof assigned_departments === 'string' ? assigned_departments : JSON.stringify(assigned_departments))
      : null;
    const usersJson = assigned_user_ids
      ? (typeof assigned_user_ids === 'string' ? assigned_user_ids : JSON.stringify(assigned_user_ids))
      : null;

    const nowIso = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO offices (
         office_name, address, latitude, longitude, radius_meters, description,
         status, assigned_departments, assigned_user_ids, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        office_name.trim(),
        address ? address.trim() : null,
        latNum,
        lngNum,
        radNum,
        description ? description.trim() : null,
        status === 'inactive' ? 'inactive' : 'active',
        deptsJson,
        usersJson,
        req.user.id,
        nowIso,
        nowIso,
      ]
    );

    const newOffice = await db.get('SELECT * FROM offices WHERE id = ?', [result.lastID]);

    await logActivity({
      userId: req.user.id,
      action: 'OFFICE_CREATED',
      module: 'system',
      entityType: 'office',
      entityId: result.lastID,
      details: `Created office location "${office_name.trim()}" at (${latNum.toFixed(4)}, ${lngNum.toFixed(4)}) with radius ${radNum}m`,
    });

    return res.status(201).json({
      message: 'Office location created successfully',
      office: newOffice,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create office', details: err.message });
  }
}

/**
 * Update an office location
 */
async function updateOffice(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db.get('SELECT * FROM offices WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Office location not found' });
    }

    const {
      office_name,
      address,
      latitude,
      longitude,
      radius_meters,
      description,
      status,
      assigned_departments,
      assigned_user_ids,
    } = req.body;

    const nameVal = office_name !== undefined ? office_name.trim() : existing.office_name;
    if (!nameVal) {
      return res.status(400).json({ error: 'Office name cannot be empty' });
    }

    let latNum = existing.latitude;
    if (latitude !== undefined) {
      latNum = parseFloat(latitude);
      if (isNaN(latNum) || latNum < -90 || latNum > 90) {
        return res.status(400).json({ error: 'Valid latitude between -90 and 90 is required' });
      }
    }

    let lngNum = existing.longitude;
    if (longitude !== undefined) {
      lngNum = parseFloat(longitude);
      if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
        return res.status(400).json({ error: 'Valid longitude between -180 and 180 is required' });
      }
    }

    let radNum = existing.radius_meters;
    if (radius_meters !== undefined) {
      radNum = parseFloat(radius_meters);
      if (isNaN(radNum) || radNum <= 0) {
        return res.status(400).json({ error: 'Geofencing radius must be greater than 0 meters' });
      }
    }

    const addrVal = address !== undefined ? (address ? address.trim() : null) : existing.address;
    const descVal = description !== undefined ? (description ? description.trim() : null) : existing.description;
    const statusVal = status !== undefined ? (status === 'inactive' ? 'inactive' : 'active') : existing.status;

    let deptsJson = existing.assigned_departments;
    if (assigned_departments !== undefined) {
      deptsJson = assigned_departments
        ? (typeof assigned_departments === 'string' ? assigned_departments : JSON.stringify(assigned_departments))
        : null;
    }

    let usersJson = existing.assigned_user_ids;
    if (assigned_user_ids !== undefined) {
      usersJson = assigned_user_ids
        ? (typeof assigned_user_ids === 'string' ? assigned_user_ids : JSON.stringify(assigned_user_ids))
        : null;
    }

    const nowIso = new Date().toISOString();
    await db.run(
      `UPDATE offices SET
         office_name = ?, address = ?, latitude = ?, longitude = ?, radius_meters = ?,
         description = ?, status = ?, assigned_departments = ?, assigned_user_ids = ?, updated_at = ?
       WHERE id = ?`,
      [
        nameVal,
        addrVal,
        latNum,
        lngNum,
        radNum,
        descVal,
        statusVal,
        deptsJson,
        usersJson,
        nowIso,
        id,
      ]
    );

    const updated = await db.get('SELECT * FROM offices WHERE id = ?', [id]);

    await logActivity({
      userId: req.user.id,
      action: 'OFFICE_UPDATED',
      module: 'system',
      entityType: 'office',
      entityId: id,
      details: `Updated office "${nameVal}" (Radius: ${radNum}m, Status: ${statusVal})`,
    });

    return res.json({
      message: 'Office location updated successfully',
      office: updated,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update office', details: err.message });
  }
}

/**
 * Delete or deactivate office
 */
async function deleteOffice(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db.get('SELECT * FROM offices WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Office location not found' });
    }

    // Check if referenced in attendance or evidence
    const refCount = await db.get(
      'SELECT COUNT(*) as c FROM geofence_attendance_evidence WHERE office_id = ?',
      [id]
    );

    if (refCount && refCount.c > 0) {
      // Soft-delete / deactivate to preserve historical integrity
      const nowIso = new Date().toISOString();
      await db.run("UPDATE offices SET status = 'inactive', updated_at = ? WHERE id = ?", [nowIso, id]);

      await logActivity({
        userId: req.user.id,
        action: 'OFFICE_DEACTIVATED',
        module: 'system',
        entityType: 'office',
        entityId: id,
        details: `Deactivated office "${existing.office_name}" as it has ${refCount.c} historical attendance record(s)`,
      });

      return res.json({
        message: 'Office has historical attendance records; marked as inactive instead of permanent deletion.',
        status: 'inactive',
      });
    }

    // Hard delete if never referenced
    await db.run('DELETE FROM offices WHERE id = ?', [id]);

    await logActivity({
      userId: req.user.id,
      action: 'OFFICE_DELETED',
      module: 'system',
      entityType: 'office',
      entityId: id,
      details: `Deleted office location "${existing.office_name}"`,
    });

    return res.json({ message: 'Office deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete office', details: err.message });
  }
}

module.exports = {
  listOffices,
  getActiveOffices,
  getOfficeById,
  createOffice,
  updateOffice,
  deleteOffice,
};

