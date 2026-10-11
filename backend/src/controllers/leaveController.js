const leaveService = require('../services/leaveService');
const { getLeaveYear } = require('../utils/leaveUtils');
const { getCompanyDate } = require('../utils/timeUtils');
const db = require('../db');

// Employee: Get current leave balance
async function getMyLeaveBalance(req, res) {
  try {
    const userId = req.user.id;
    const leaveYear = req.query.year || getLeaveYear();
    const balance = await leaveService.getUserLeaveBalance(userId, leaveYear);

    // Also get list of accruals for transparency
    const accruals = await db.query(
      'SELECT month, days_accrued, accrued_at FROM leave_accruals WHERE user_id = ? AND leave_year = ? ORDER BY month ASC',
      [userId, leaveYear]
    );

    return res.json({
      success: true,
      ...balance,
      accruals,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Employee: Get monthly missing attendance and leave summary
async function getMyLeaveSummary(req, res) {
  try {
    const userId = req.user.id;
    const todayStr = getCompanyDate();
    const month = req.query.month || todayStr.substring(0, 7);
    const leaveYear = req.query.year || getLeaveYear();

    await leaveService.updateMonthlySummary(userId, month);

    const summary = await db.get(
      'SELECT * FROM monthly_attendance_summaries WHERE user_id = ? AND month = ?',
      [userId, month]
    );

    const balance = await leaveService.getUserLeaveBalance(userId, leaveYear);

    return res.json({
      success: true,
      month,
      leaveYear,
      balance: balance.balance,
      summary: summary || {
        missing_attendance_count: 0,
        earned_leaves_accrued: 0,
        earned_leaves_used: 0,
        automatic_absence_count: 0,
        unpaid_absence_count: 0,
        remaining_earned_balance: balance.balance,
        threshold_exceeded: 0,
      },
      thresholdExceeded: summary ? Boolean(summary.threshold_exceeded) : false,
      thresholdMessage:
        summary && summary.threshold_exceeded
          ? 'Notice: Missing attendance threshold (>2 days) exceeded for this calendar month.'
          : 'Attendance threshold compliant (maximum 2 missing days allowed per month).',
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Employee: Get leave history & absences
async function getMyLeaveHistory(req, res) {
  try {
    const userId = req.user.id;
    const leaveYear = req.query.year || getLeaveYear();

    const leaves = await db.query(
      'SELECT * FROM leave_records WHERE user_id = ? AND leave_year = ? ORDER BY start_date DESC',
      [userId, leaveYear]
    );

    const absences = await db.query(
      'SELECT * FROM attendance_absences WHERE user_id = ? AND leave_year = ? ORDER BY date DESC',
      [userId, leaveYear]
    );

    return res.json({
      success: true,
      leaveYear,
      leaves,
      absences,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Employee/Admin: Calculate leave request preview
async function calculateLeave(req, res) {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const preview = await leaveService.calculateLeaveRequest(userId, startDate, endDate);
    return res.json(preview);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

// Employee: Submit eligible leave request (Auto-Confirmed without admin approval)
async function requestLeave(req, res) {
  try {
    const userId = req.user.id;
    const { startDate, endDate, reason } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const result = await leaveService.submitLeaveRequest(userId, { startDate, endDate, reason });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

// Employee: Cancel an eligible future leave request
async function cancelLeave(req, res) {
  try {
    const userId = req.user.id;
    const leaveId = parseInt(req.params.id, 10);
    const { reason } = req.body || {};

    const result = await leaveService.cancelLeaveRequest(userId, leaveId, reason, req.user.role === 'admin');
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

// Public/Employee: Get company holidays
async function getHolidays(req, res) {
  try {
    const leaveYear = req.query.year || getLeaveYear();
    const result = await leaveService.getCompanyHolidays(leaveYear);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// --- ADMIN ENDPOINTS ---

// Admin: Team leave summaries, balances & threshold exceeded overview
async function adminGetSummaries(req, res) {
  try {
    const leaveYear = req.query.year || getLeaveYear();
    const todayStr = getCompanyDate();
    const month = req.query.month || todayStr.substring(0, 7);

    // Sync completed month accruals
    await leaveService.syncLeaveAccrualsForYear(leaveYear);

    const queryStr = `
      SELECT 
        u.id as user_id,
        u.full_name,
        u.email,
        u.role,
        u.department,
        u.is_active,
        COALESCE(b.accrued, 0) as earned_accrued,
        COALESCE(b.used, 0) as earned_used,
        COALESCE(b.balance, 0) as earned_balance,
        COALESCE(s.missing_attendance_count, 0) as monthly_missing_count,
        COALESCE(s.automatic_absence_count, 0) as monthly_auto_absences,
        COALESCE(s.unpaid_absence_count, 0) as monthly_unpaid_absences,
        COALESCE(s.threshold_exceeded, 0) as threshold_exceeded
      FROM users u
      LEFT JOIN leave_balances b ON b.user_id = u.id AND b.leave_year = ?
      LEFT JOIN monthly_attendance_summaries s ON s.user_id = u.id AND s.month = ?
      WHERE u.is_active = 1
      ORDER BY u.full_name ASC
    `;

    const summaries = await db.query(queryStr, [leaveYear, month]);

    const thresholdExceededUsers = summaries.filter((s) => s.threshold_exceeded === 1 || s.threshold_exceeded === true);

    return res.json({
      success: true,
      leaveYear,
      month,
      totalUsers: summaries.length,
      thresholdExceededCount: thresholdExceededUsers.length,
      summaries,
      thresholdExceededUsers,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Admin: Get all confirmed / cancelled leave records
async function adminGetRecords(req, res) {
  try {
    const leaveYear = req.query.year || getLeaveYear();
    const { userId, status, limit = 200 } = req.query;

    let sql = `
      SELECT l.*, u.full_name, u.email, u.department, u.role
      FROM leave_records l
      JOIN users u ON l.user_id = u.id
      WHERE l.leave_year = ?
    `;
    const params = [leaveYear];

    if (userId) {
      sql += ' AND l.user_id = ?';
      params.push(userId);
    }
    if (status) {
      sql += ' AND l.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY l.start_date DESC LIMIT ?';
    params.push(parseInt(limit, 10));

    const records = await db.query(sql, params);
    return res.json({ success: true, count: records.length, records });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Admin: Get all attendance absences
async function adminGetAbsences(req, res) {
  try {
    const leaveYear = req.query.year || getLeaveYear();
    const { userId, month, isCorrected, limit = 200 } = req.query;

    let sql = `
      SELECT a.*, u.full_name, u.email, u.department, c.full_name as corrected_by_name
      FROM attendance_absences a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN users c ON a.corrected_by = c.id
      WHERE a.leave_year = ?
    `;
    const params = [leaveYear];

    if (userId) {
      sql += ' AND a.user_id = ?';
      params.push(userId);
    }
    if (month) {
      sql += ' AND a.month = ?';
      params.push(month);
    }
    if (isCorrected !== undefined) {
      sql += ' AND a.is_corrected = ?';
      params.push(isCorrected === 'true' || isCorrected === '1' ? 1 : 0);
    }

    sql += ' ORDER BY a.date DESC LIMIT ?';
    params.push(parseInt(limit, 10));

    const absences = await db.query(sql, params);
    return res.json({ success: true, count: absences.length, absences });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Admin: Correct an absence record
async function adminCorrectAbsence(req, res) {
  try {
    const absenceId = parseInt(req.params.id, 10);
    const { notes } = req.body;
    const adminId = req.user.id;

    const result = await leaveService.correctAbsenceRecord(adminId, absenceId, notes);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

// Admin: Create holiday
async function adminCreateHoliday(req, res) {
  try {
    const adminId = req.user.id;
    const { leaveYear, name, date, description } = req.body;
    const holiday = await leaveService.createCompanyHoliday(adminId, { leaveYear, name, date, description });
    return res.status(201).json({ success: true, holiday });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

// Admin: Update holiday
async function adminUpdateHoliday(req, res) {
  try {
    const adminId = req.user.id;
    const holidayId = parseInt(req.params.id, 10);
    const { name, date, description, isActive } = req.body;
    const holiday = await leaveService.updateCompanyHoliday(adminId, holidayId, { name, date, description, isActive });
    return res.json({ success: true, holiday });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

// Admin: Delete holiday
async function adminDeleteHoliday(req, res) {
  try {
    const adminId = req.user.id;
    const holidayId = parseInt(req.params.id, 10);
    const result = await leaveService.deleteCompanyHoliday(adminId, holidayId);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

// Admin / Test: Trigger reconciliation
async function adminTriggerReconciliation(req, res) {
  try {
    const { date } = req.body;
    const result = await leaveService.reconcileDailyAttendance(date);
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Admin / Test: Trigger monthly accrual
async function adminTriggerAccrual(req, res) {
  try {
    const { month, force } = req.body;
    if (!month) {
      return res.status(400).json({ error: 'Month (YYYY-MM) is required' });
    }
    const result = await leaveService.accrueMonthlyLeaves(month, Boolean(force));
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getMyLeaveBalance,
  getMyLeaveSummary,
  getMyLeaveHistory,
  calculateLeave,
  requestLeave,
  cancelLeave,
  getHolidays,
  adminGetSummaries,
  adminGetRecords,
  adminGetAbsences,
  adminCorrectAbsence,
  adminCreateHoliday,
  adminUpdateHoliday,
  adminDeleteHoliday,
  adminTriggerReconciliation,
  adminTriggerAccrual,
};
