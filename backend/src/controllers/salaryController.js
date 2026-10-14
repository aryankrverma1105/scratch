const { z } = require('zod');
const db = require('../db');
const salaryService = require('../services/salaryService');
const { logActivity } = require('../services/activityLogger');
const { getCompanyDate } = require('../utils/timeUtils');

// Schemas
const updateSettingsSchema = z.object({
  commonDailyWage: z.number().nonnegative(),
});

const saveConfigSchema = z.object({
  userId: z.number().int().positive(),
  salaryType: z.enum(['daily_wage', 'daily_wages', 'fixed_monthly']),
  monthlyBasicSalary: z.number().nonnegative().nullable().optional(),
  dailyWageOverride: z.number().nonnegative().nullable().optional(),
  dailyIncentiveRate: z.number().nonnegative().nullable().optional(),
  effectiveDate: z.string().nullable().optional().or(z.literal('')),
  remarks: z.string().nullable().optional(),
});

const incentiveSchema = z.object({
  userId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  description: z.string().optional(),
  status: z.enum(['approved', 'pending', 'rejected']).optional(),
});

const overtimeSchema = z.object({
  userId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().nonnegative(),
  amount: z.number().nonnegative(),
  remarks: z.string().optional(),
  status: z.enum(['approved', 'pending', 'rejected']).optional(),
});

// Admin Controllers
async function getSettings(req, res) {
  try {
    const settings = await salaryService.getSalarySettings();
    return res.json({ settings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function updateSettings(req, res) {
  try {
    const data = updateSettingsSchema.parse(req.body);
    const updated = await salaryService.updateSalarySettings(data.commonDailyWage, req.user.id);

    await logActivity({
      req,
      action: 'COMMON_DAILY_WAGE_UPDATED',
      entityType: 'salary_settings',
      details: `Updated common daily wage rate to ₹${data.commonDailyWage}`,
    });

    return res.json({ message: 'Salary settings updated', settings: updated });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listEmployeeConfigs(req, res) {
  try {
    const configs = await db.query(
      `SELECT u.id as user_id, u.full_name, u.email, u.role, u.department, u.is_active,
              sc.id as config_id, sc.salary_type, sc.monthly_basic_salary, sc.daily_wage_override,
              sc.daily_incentive_rate, sc.effective_date, sc.remarks
       FROM users u
       LEFT JOIN employee_salary_configs sc ON u.id = sc.user_id
       ORDER BY u.id ASC`
    );
    const settings = await salaryService.getSalarySettings();
    return res.json({ configs, commonDailyWage: settings.common_daily_wage });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getEmployeeConfig(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10);
    const config = await salaryService.getEmployeeSalaryConfig(userId);
    return res.json({ config });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function saveEmployeeConfig(req, res) {
  try {
    const data = saveConfigSchema.parse(req.body);
    const effDate = data.effectiveDate || getCompanyDate();
    const config = await salaryService.upsertEmployeeSalaryConfig({
      userId: data.userId,
      salaryType: data.salaryType,
      monthlyBasicSalary: data.monthlyBasicSalary,
      dailyWageOverride: data.dailyWageOverride,
      dailyIncentiveRate: data.dailyIncentiveRate,
      effectiveDate: effDate,
      remarks: data.remarks,
      createdBy: req.user.id,
    });

    const emp = await db.get('SELECT full_name FROM users WHERE id = ?', [data.userId]);
    const empName = emp?.full_name || `User #${data.userId}`;

    await logActivity({
      req,
      action: 'SALARY_CONFIG_SAVED',
      entityType: 'employee_salary_config',
      entityId: data.userId,
      targetUserId: data.userId,
      targetUserName: empName,
      details: `Configured salary for ${empName}: ${data.salaryType === 'fixed_monthly' ? `Fixed Monthly (₹${data.monthlyBasicSalary || 0})` : `Daily Wages (Override: ${data.dailyWageOverride ? `₹${data.dailyWageOverride}` : 'Common rate'}, Fixed Daily Incentive: ₹${data.dailyIncentiveRate || 0}/day)`}`,
    });

    return res.json({ message: 'Employee salary configuration saved', config });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// Daily Incentives
async function listIncentives(req, res) {
  try {
    const { month, userId } = req.query;
    let sql = `SELECT di.*, u.full_name, u.department, cb.full_name as created_by_name
               FROM daily_incentives di
               JOIN users u ON di.user_id = u.id
               LEFT JOIN users cb ON di.created_by = cb.id
               WHERE 1=1`;
    const params = [];
    if (month) {
      sql += ' AND di.date LIKE ?';
      params.push(`${month}%`);
    }
    if (userId) {
      sql += ' AND di.user_id = ?';
      params.push(userId);
    }
    sql += ' ORDER BY di.date DESC, di.id DESC';
    const incentives = await db.query(sql, params);
    return res.json({ incentives });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function createIncentive(req, res) {
  try {
    const data = incentiveSchema.parse(req.body);
    const month = data.date.substring(0, 7);
    const nowIso = new Date().toISOString();

    const result = await db.run(
      `INSERT INTO daily_incentives (user_id, date, amount, description, status, payroll_period, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.userId,
        data.date,
        data.amount,
        data.description || null,
        data.status || 'approved',
        month,
        req.user.id,
        nowIso,
        nowIso,
      ]
    );

    const emp = await db.get('SELECT full_name FROM users WHERE id = ?', [data.userId]);
    const empName = emp?.full_name || `User #${data.userId}`;

    await logActivity({
      req,
      action: 'INCENTIVE_CREATED',
      entityType: 'daily_incentive',
      entityId: result.lastID,
      targetUserId: data.userId,
      targetUserName: empName,
      details: `Added daily incentive of ₹${data.amount} for ${empName} on ${data.date} (${data.description || 'No description'})`,
    });

    const item = await db.get('SELECT * FROM daily_incentives WHERE id = ?', [result.lastID]);
    return res.status(201).json({ message: 'Daily incentive created', incentive: item });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function updateIncentive(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { amount, description, status } = req.body;
    const nowIso = new Date().toISOString();

    const existing = await db.get('SELECT * FROM daily_incentives WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Incentive not found' });

    await db.run(
      `UPDATE daily_incentives
       SET amount = COALESCE(?, amount),
           description = COALESCE(?, description),
           status = COALESCE(?, status),
           updated_at = ?
       WHERE id = ?`,
      [amount !== undefined ? amount : null, description !== undefined ? description : null, status || null, nowIso, id]
    );

    const emp = await db.get('SELECT full_name FROM users WHERE id = ?', [existing.user_id]);
    const empName = emp?.full_name || `User #${existing.user_id}`;

    await logActivity({
      req,
      action: 'INCENTIVE_UPDATED',
      entityType: 'daily_incentive',
      entityId: id,
      targetUserId: existing.user_id,
      targetUserName: empName,
      details: `Updated incentive for ${empName} on ${existing.date}: amount ₹${amount ?? existing.amount}, status ${status ?? existing.status}`,
    });

    const updated = await db.get('SELECT * FROM daily_incentives WHERE id = ?', [id]);
    return res.json({ message: 'Incentive updated', incentive: updated });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function deleteIncentive(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db.get('SELECT * FROM daily_incentives WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Incentive not found' });

    await db.run('DELETE FROM daily_incentives WHERE id = ?', [id]);

    const emp = await db.get('SELECT full_name FROM users WHERE id = ?', [existing.user_id]);
    const empName = emp?.full_name || `User #${existing.user_id}`;

    await logActivity({
      req,
      action: 'INCENTIVE_DELETED',
      entityType: 'daily_incentive',
      entityId: id,
      targetUserId: existing.user_id,
      targetUserName: empName,
      details: `Deleted daily incentive of ₹${existing.amount} for ${empName} dated ${existing.date}`,
    });

    return res.json({ message: 'Incentive deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Overtime
async function listOvertime(req, res) {
  try {
    const { month, userId } = req.query;
    let sql = `SELECT ot.*, u.full_name, u.department, cb.full_name as created_by_name
               FROM overtime_records ot
               JOIN users u ON ot.user_id = u.id
               LEFT JOIN users cb ON ot.created_by = cb.id
               WHERE 1=1`;
    const params = [];
    if (month) {
      sql += ' AND ot.date LIKE ?';
      params.push(`${month}%`);
    }
    if (userId) {
      sql += ' AND ot.user_id = ?';
      params.push(userId);
    }
    sql += ' ORDER BY ot.date DESC, ot.id DESC';
    const overtimes = await db.query(sql, params);
    return res.json({ overtimes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function createOvertime(req, res) {
  try {
    const data = overtimeSchema.parse(req.body);
    const month = data.date.substring(0, 7);
    const nowIso = new Date().toISOString();

    const result = await db.run(
      `INSERT INTO overtime_records (user_id, date, hours, amount, remarks, status, payroll_period, created_by, approved_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.userId,
        data.date,
        data.hours,
        data.amount,
        data.remarks || null,
        data.status || 'approved',
        month,
        req.user.id,
        req.user.id,
        nowIso,
      ]
    );

    const emp = await db.get('SELECT full_name FROM users WHERE id = ?', [data.userId]);
    const empName = emp?.full_name || `User #${data.userId}`;

    await logActivity({
      req,
      action: 'OVERTIME_RECORDED',
      entityType: 'overtime_record',
      entityId: result.lastID,
      targetUserId: data.userId,
      targetUserName: empName,
      details: `Recorded overtime of ${data.hours} hrs (₹${data.amount}) for ${empName} on ${data.date}`,
    });

    const item = await db.get('SELECT * FROM overtime_records WHERE id = ?', [result.lastID]);
    return res.status(201).json({ message: 'Overtime record created', overtime: item });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function updateOvertime(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { hours, amount, remarks, status } = req.body;

    const existing = await db.get('SELECT * FROM overtime_records WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Overtime record not found' });

    await db.run(
      `UPDATE overtime_records
       SET hours = COALESCE(?, hours),
           amount = COALESCE(?, amount),
           remarks = COALESCE(?, remarks),
           status = COALESCE(?, status),
           approved_by = ?
       WHERE id = ?`,
      [hours !== undefined ? hours : null, amount !== undefined ? amount : null, remarks !== undefined ? remarks : null, status || null, req.user.id, id]
    );

    const emp = await db.get('SELECT full_name FROM users WHERE id = ?', [existing.user_id]);
    const empName = emp?.full_name || `User #${existing.user_id}`;

    await logActivity({
      req,
      action: 'OVERTIME_UPDATED',
      entityType: 'overtime_record',
      entityId: id,
      targetUserId: existing.user_id,
      targetUserName: empName,
      details: `Updated overtime for ${empName} on ${existing.date}: ${hours ?? existing.hours} hrs, ₹${amount ?? existing.amount}, status ${status ?? existing.status}`,
    });

    const updated = await db.get('SELECT * FROM overtime_records WHERE id = ?', [id]);
    return res.json({ message: 'Overtime record updated', overtime: updated });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function deleteOvertime(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db.get('SELECT * FROM overtime_records WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Overtime record not found' });

    await db.run('DELETE FROM overtime_records WHERE id = ?', [id]);

    const emp = await db.get('SELECT full_name FROM users WHERE id = ?', [existing.user_id]);
    const empName = emp?.full_name || `User #${existing.user_id}`;

    await logActivity({
      req,
      action: 'OVERTIME_DELETED',
      entityType: 'overtime_record',
      entityId: id,
      targetUserId: existing.user_id,
      targetUserName: empName,
      details: `Deleted overtime of ${existing.hours} hrs (₹${existing.amount}) for ${empName} dated ${existing.date}`,
    });

    return res.json({ message: 'Overtime record deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Payroll preview and finalization
async function previewPayroll(req, res) {
  try {
    const month = req.query.month || getCompanyDate().substring(0, 7);
    const period = await db.get('SELECT * FROM payroll_periods WHERE month = ?', [month]);
    const calculations = await salaryService.previewPayrollForMonth(month);

    return res.json({
      month,
      isFinalized: period?.status === 'finalized',
      finalizedAt: period?.finalized_at || null,
      calculations,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function finalizePayroll(req, res) {
  try {
    const { month, notes } = req.body;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Valid month (YYYY-MM) is required' });
    }

    const result = await salaryService.finalizePayroll(month, req.user.id, notes);

    await logActivity({
      req,
      action: 'PAYROLL_FINALIZED',
      entityType: 'payroll_period',
      entityId: month,
      details: `Finalized and locked payroll for period ${month} (${result.recordsCount} employee records)`,
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function exportPayrollCsv(req, res) {
  try {
    const month = req.query.month || getCompanyDate().substring(0, 7);
    const csvData = await salaryService.generatePayrollCsv(month);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="salary_sheet_${month}.csv"`);
    return res.send(csvData);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getPayrollRecords(req, res) {
  try {
    const month = req.query.month || getCompanyDate().substring(0, 7);
    const records = await db.query(
      `SELECT pr.*, u.full_name, u.email, u.department
       FROM payroll_records pr
       JOIN users u ON pr.user_id = u.id
       WHERE pr.payroll_period = ?
       ORDER BY pr.id ASC`,
      [month]
    );
    const period = await db.get('SELECT * FROM payroll_periods WHERE month = ?', [month]);
    return res.json({ month, period, records });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Employee Controllers
async function getMySalary(req, res) {
  try {
    const month = req.query.month || getCompanyDate().substring(0, 7);
    const userId = req.user.id;

    // Check if finalized record exists first
    const finalized = await db.get(
      `SELECT pr.*, pp.status as period_status, pp.finalized_at
       FROM payroll_records pr
       LEFT JOIN payroll_periods pp ON pr.payroll_period = pp.month
       WHERE pr.user_id = ? AND pr.payroll_period = ? AND pr.status = 'finalized'`,
      [userId, month]
    );

    if (finalized) {
      let snapshot = null;
      try {
        snapshot = JSON.parse(finalized.attendance_snapshot);
      } catch (_) {}
      return res.json({
        isFinalized: true,
        month,
        salary: {
          ...finalized,
          attendanceSnapshot: snapshot,
        },
      });
    }

    // Otherwise calculate current live draft
    const calculation = await salaryService.calculateSalaryForEmployee(userId, month);
    return res.json({
      isFinalized: false,
      month,
      salary: calculation,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getMyIncentives(req, res) {
  try {
    const month = req.query.month || getCompanyDate().substring(0, 7);
    const userId = req.user.id;

    const incentives = await db.query(
      `SELECT * FROM daily_incentives
       WHERE user_id = ? AND date LIKE ?
       ORDER BY date DESC`,
      [userId, `${month}%`]
    );
    const total = incentives
      .filter((i) => i.status === 'approved')
      .reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

    return res.json({ month, incentives, total: salaryService.round2(total) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getMyOvertime(req, res) {
  try {
    const month = req.query.month || getCompanyDate().substring(0, 7);
    const userId = req.user.id;

    const overtimes = await db.query(
      `SELECT * FROM overtime_records
       WHERE user_id = ? AND date LIKE ?
       ORDER BY date DESC`,
      [userId, `${month}%`]
    );
    const totalHours = overtimes
      .filter((o) => o.status === 'approved')
      .reduce((sum, o) => sum + (parseFloat(o.hours) || 0), 0);
    const totalAmount = overtimes
      .filter((o) => o.status === 'approved')
      .reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);

    return res.json({
      month,
      overtimes,
      totalHours: salaryService.round2(totalHours),
      totalAmount: salaryService.round2(totalAmount),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getMyPayrollHistory(req, res) {
  try {
    const userId = req.user.id;
    const history = await db.query(
      `SELECT pr.*, pp.finalized_at
       FROM payroll_records pr
       LEFT JOIN payroll_periods pp ON pr.payroll_period = pp.month
       WHERE pr.user_id = ? AND pr.status = 'finalized'
       ORDER BY pr.payroll_period DESC`,
      [userId]
    );
    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getSettings,
  updateSettings,
  listEmployeeConfigs,
  getEmployeeConfig,
  saveEmployeeConfig,
  listIncentives,
  createIncentive,
  updateIncentive,
  deleteIncentive,
  listOvertime,
  createOvertime,
  updateOvertime,
  deleteOvertime,
  previewPayroll,
  finalizePayroll,
  exportPayrollCsv,
  getPayrollRecords,
  getMySalary,
  getMyIncentives,
  getMyOvertime,
  getMyPayrollHistory,
};
