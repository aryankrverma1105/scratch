const { z } = require('zod');
const db = require('../db');
const salaryService = require('../services/salaryService');
const { logActivity } = require('../services/activityLogger');
const { getCompanyDate } = require('../utils/timeUtils');

// Schemas
const updateSettingsSchema = z.object({
  commonDailyWage: z.number().nonnegative(),
  officialStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cycleStartDay: z.number().int().min(1).max(28).optional(),
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
    const updated = await salaryService.updateSalarySettings(
      {
        commonDailyWage: data.commonDailyWage,
        officialStartDate: data.officialStartDate,
        cycleStartDay: data.cycleStartDay,
      },
      req.user.id
    );

    await logActivity({
      req,
      action: 'COMMON_DAILY_WAGE_UPDATED',
      entityType: 'salary_settings',
      details: `Updated salary settings: wage ₹${data.commonDailyWage}, start date: ${data.officialStartDate || 'default'}, cycle day: ${data.cycleStartDay || 'default'}`,
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
    return res.json({ configs, commonDailyWage: settings.common_daily_wage, settings });
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
      monthlyBasicSalary: data.monthlyBasicSalary || 0,
      dailyWageOverride: data.dailyWageOverride,
      dailyIncentiveRate: data.dailyIncentiveRate || 0,
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
      entityId: config.id,
      targetUserId: data.userId,
      targetUserName: empName,
      details: `Saved salary config for ${empName}: Type: ${data.salaryType}, Basic: ₹${data.monthlyBasicSalary || 0}, Daily Override: ₹${data.dailyWageOverride ?? 'None'}, Daily Incentive: ₹${data.dailyIncentiveRate || 0}`,
    });

    return res.json({ message: 'Employee salary configuration saved', config });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// Daily Incentive CRUD
async function listIncentives(req, res) {
  try {
    const { userId, month, cycleCode } = req.query;
    let query = `
      SELECT i.*, u.full_name, u.email, u.department, c.full_name as created_by_name
      FROM daily_incentives i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN users c ON i.created_by = c.id
      WHERE 1=1
    `;
    const params = [];

    if (userId) {
      query += ` AND i.user_id = ?`;
      params.push(userId);
    }
    if (cycleCode || month) {
      const resolved = await salaryService.resolveCycleOrPeriod(cycleCode || month);
      query += ` AND i.date >= ? AND i.date <= ?`;
      params.push(resolved.startDate, resolved.endDate);
    }

    query += ` ORDER BY i.date DESC, i.id DESC`;
    const incentives = await db.query(query, params);
    return res.json({ count: incentives.length, incentives });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function createIncentive(req, res) {
  try {
    const data = incentiveSchema.parse(req.body);
    const resolved = await salaryService.resolveCycleOrPeriod();
    const payrollPeriod = resolved.cycleCode;
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
        payrollPeriod,
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
      details: `Created daily incentive of ₹${data.amount} for ${empName} on ${data.date} (${data.description || 'No description'})`,
    });

    const incentive = await db.get('SELECT * FROM daily_incentives WHERE id = ?', [result.lastID]);
    return res.status(201).json({ message: 'Incentive created', incentive });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function updateIncentive(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { amount, description, status } = req.body;
    const existing = await db.get('SELECT * FROM daily_incentives WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Incentive record not found' });

    const nowIso = new Date().toISOString();
    await db.run(
      `UPDATE daily_incentives
       SET amount = COALESCE(?, amount), description = COALESCE(?, description),
           status = COALESCE(?, status), updated_at = ?
       WHERE id = ?`,
      [amount !== undefined ? parseFloat(amount) : null, description, status, nowIso, id]
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
      details: `Updated incentive for ${empName} on ${existing.date}: ₹${amount ?? existing.amount}, status ${status ?? existing.status}`,
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
    if (!existing) return res.status(404).json({ error: 'Incentive record not found' });

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
      details: `Deleted incentive of ₹${existing.amount} for ${empName} dated ${existing.date}`,
    });

    return res.json({ message: 'Incentive record deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Overtime CRUD
async function listOvertime(req, res) {
  try {
    const { userId, month, cycleCode } = req.query;
    let query = `
      SELECT o.*, u.full_name, u.email, u.department,
             c.full_name as created_by_name, a.full_name as approved_by_name
      FROM overtime_records o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN users c ON o.created_by = c.id
      LEFT JOIN users a ON o.approved_by = a.id
      WHERE 1=1
    `;
    const params = [];

    if (userId) {
      query += ` AND o.user_id = ?`;
      params.push(userId);
    }
    if (cycleCode || month) {
      const resolved = await salaryService.resolveCycleOrPeriod(cycleCode || month);
      query += ` AND o.date >= ? AND o.date <= ?`;
      params.push(resolved.startDate, resolved.endDate);
    }

    query += ` ORDER BY o.date DESC, o.id DESC`;
    const overtime = await db.query(query, params);
    return res.json({ count: overtime.length, overtime });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function createOvertime(req, res) {
  try {
    const data = overtimeSchema.parse(req.body);
    const resolved = await salaryService.resolveCycleOrPeriod();
    const payrollPeriod = resolved.cycleCode;
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
        payrollPeriod,
        req.user.id,
        req.user.id,
        nowIso,
      ]
    );

    const emp = await db.get('SELECT full_name FROM users WHERE id = ?', [data.userId]);
    const empName = emp?.full_name || `User #${data.userId}`;

    await logActivity({
      req,
      action: 'OVERTIME_CREATED',
      entityType: 'overtime_record',
      entityId: result.lastID,
      targetUserId: data.userId,
      targetUserName: empName,
      details: `Created overtime of ${data.hours} hrs (₹${data.amount}) for ${empName} on ${data.date}`,
    });

    const record = await db.get('SELECT * FROM overtime_records WHERE id = ?', [result.lastID]);
    return res.status(201).json({ message: 'Overtime record created', overtime: record });
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
       SET hours = COALESCE(?, hours), amount = COALESCE(?, amount),
           remarks = COALESCE(?, remarks), status = COALESCE(?, status),
           approved_by = ?
       WHERE id = ?`,
      [
        hours !== undefined ? parseFloat(hours) : null,
        amount !== undefined ? parseFloat(amount) : null,
        remarks,
        status,
        req.user.id,
        id,
      ]
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
    const periodParam = req.query.cycleCode || req.query.month;
    const resolved = await salaryService.resolveCycleOrPeriod(periodParam);
    const calculations = await salaryService.previewPayrollForPeriod(resolved.cycleCode);

    const cycle = await db.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [resolved.cycleCode]);
    const period = await db.get('SELECT * FROM payroll_periods WHERE month = ?', [resolved.cycleCode]);

    const isFinalized = cycle?.status === 'finalized' || cycle?.status === 'paid' || period?.status === 'finalized';
    const finalizedAt = cycle?.finalized_at || period?.finalized_at || null;

    const totalGross = salaryService.round2(calculations.reduce((sum, c) => sum + c.grossSalary, 0));
    const totalDeductions = salaryService.round2(calculations.reduce((sum, c) => sum + c.totalDeductions, 0));
    const totalNet = salaryService.round2(calculations.reduce((sum, c) => sum + c.netSalary, 0));
    const totalDisbursed = salaryService.round2(cycle?.total_disbursed || 0);
    const remainingPayable = salaryService.round2(Math.max(0, totalNet - totalDisbursed));

    return res.json({
      month: resolved.cycleCode,
      cycleCode: resolved.cycleCode,
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      status: cycle?.status || (isFinalized ? 'finalized' : 'draft'),
      isFinalized,
      finalizedAt,
      summary: {
        totalGross,
        totalDeductions,
        totalNet,
        totalDisbursed,
        remainingPayable,
        employeeCount: calculations.length,
      },
      calculations,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function finalizePayroll(req, res) {
  try {
    const periodParam = req.body.cycleCode || req.body.month;
    if (!periodParam) {
      return res.status(400).json({ error: 'Valid cycleCode or month is required' });
    }

    const result = await salaryService.finalizePayroll(periodParam, req.user.id, req.body.notes || '');

    await logActivity({
      req,
      action: 'PAYROLL_FINALIZED',
      entityType: 'payroll_period',
      entityId: periodParam,
      details: `Finalized and locked payroll for period ${periodParam} (${result.recordsCount} employee records)`,
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function exportPayrollCsv(req, res) {
  try {
    const periodParam = req.query.cycleCode || req.query.month;
    const resolved = await salaryService.resolveCycleOrPeriod(periodParam);
    const csvData = await salaryService.generatePayrollCsv(resolved.cycleCode);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="salary_sheet_${resolved.cycleCode}.csv"`);
    return res.send(csvData);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getPayrollRecords(req, res) {
  try {
    const periodParam = req.query.cycleCode || req.query.month;
    const resolved = await salaryService.resolveCycleOrPeriod(periodParam);
    const records = await db.query(
      `SELECT pr.*, u.full_name, u.email, u.department
       FROM payroll_records pr
       JOIN users u ON pr.user_id = u.id
       WHERE pr.payroll_period = ? OR pr.cycle_code = ?
       ORDER BY pr.id ASC`,
      [resolved.cycleCode, resolved.cycleCode]
    );
    const cycle = await db.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [resolved.cycleCode]);
    return res.json({ month: resolved.cycleCode, cycleCode: resolved.cycleCode, cycle, records });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// --- NEW SALARY CYCLE & DISBURSEMENT ENDPOINTS ---

async function getActiveCycle(req, res) {
  try {
    const resolved = await salaryService.resolveCycleOrPeriod();
    const cycle = await db.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [resolved.cycleCode]);
    const calculations = await salaryService.previewPayrollForPeriod(resolved.cycleCode);

    const totalGross = salaryService.round2(calculations.reduce((sum, c) => sum + c.grossSalary, 0));
    const totalDeductions = salaryService.round2(calculations.reduce((sum, c) => sum + c.totalDeductions, 0));
    const totalNet = salaryService.round2(calculations.reduce((sum, c) => sum + c.netSalary, 0));
    const totalDisbursed = salaryService.round2(cycle?.total_disbursed || 0);
    const remainingPayable = salaryService.round2(Math.max(0, totalNet - totalDisbursed));

    const settings = await salaryService.getSalarySettings();
    const cycleStartDay = settings.cycle_start_day || 3;
    const nextCycle = salaryService.getNextSalaryCycle(resolved.startDate, cycleStartDay);

    return res.json({
      cycle: {
        id: cycle?.id || null,
        cycleCode: resolved.cycleCode,
        startDate: resolved.startDate,
        endDate: resolved.endDate,
        status: cycle?.status || 'active',
      },
      summary: {
        totalGross,
        totalDeductions,
        totalNet,
        totalDisbursed,
        remainingPayable,
        employeeCount: calculations.length,
      },
      nextCycleProposed: nextCycle,
      calculations,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function listCycles(req, res) {
  try {
    const cycles = await db.query('SELECT * FROM salary_cycles ORDER BY start_date DESC');
    return res.json({ cycles });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getCycleDetails(req, res) {
  try {
    const cycleCode = req.params.cycleCode;
    const cycle = await db.get('SELECT * FROM salary_cycles WHERE cycle_code = ?', [cycleCode]);
    if (!cycle) return res.status(404).json({ error: `Cycle ${cycleCode} not found` });

    const records = await db.query(
      `SELECT pr.*, u.full_name, u.email, u.department
       FROM payroll_records pr
       JOIN users u ON pr.user_id = u.id
       WHERE pr.cycle_code = ? OR pr.payroll_period = ?
       ORDER BY pr.id ASC`,
      [cycleCode, cycleCode]
    );

    const batches = await db.query(
      `SELECT b.*, u.full_name as disbursed_by_name
       FROM salary_disbursement_batches b
       LEFT JOIN users u ON b.disbursed_by = u.id
       WHERE b.cycle_code = ?
       ORDER BY b.id DESC`,
      [cycleCode]
    );

    const payments = await db.query(
      `SELECT p.*, u.full_name as employee_name, rec.full_name as recorded_by_name
       FROM salary_payments p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN users rec ON p.recorded_by = rec.id
       WHERE p.cycle_code = ?
       ORDER BY p.id DESC`,
      [cycleCode]
    );

    return res.json({
      cycle,
      records,
      batches,
      payments,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function disburseAndAdvance(req, res) {
  try {
    const { cycleCode, disbursementDate, amountPaid, paymentMethod, notes } = req.body;
    const result = await salaryService.disburseSalaryAndAdvanceCycle({
      cycleCode,
      disbursementDate,
      amountPaid,
      paymentMethod,
      notes,
      adminUserId: req.user.id,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function recordAdditionalPayment(req, res) {
  try {
    const cycleCode = req.params.cycleCode || req.body.cycleCode;
    const { userId, amount, paymentDate, paymentMethod, notes } = req.body;
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Valid positive payment amount is required' });
    }
    const result = await salaryService.recordRemainingPayment({
      cycleCode,
      userId: userId ? parseInt(userId, 10) : null,
      amount: parseFloat(amount),
      paymentDate,
      paymentMethod,
      notes,
      adminUserId: req.user.id,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// Employee Controllers
async function getMySalary(req, res) {
  try {
    const periodParam = req.query.cycleCode || req.query.month;
    const resolved = await salaryService.resolveCycleOrPeriod(periodParam);
    const userId = req.user.id;

    // Check if finalized record exists first
    const finalized = await db.get(
      `SELECT pr.*, pp.status as period_status, pp.finalized_at
       FROM payroll_records pr
       LEFT JOIN payroll_periods pp ON pr.payroll_period = pp.month
       WHERE pr.user_id = ? AND (pr.payroll_period = ? OR pr.cycle_code = ?) AND pr.status = 'finalized'`,
      [userId, resolved.cycleCode, resolved.cycleCode]
    );

    const payments = await db.query(
      `SELECT * FROM salary_payments WHERE user_id = ? AND cycle_code = ? ORDER BY id DESC`,
      [userId, resolved.cycleCode]
    );

    if (finalized) {
      let snapshot = null;
      try {
        snapshot = JSON.parse(finalized.attendance_snapshot);
      } catch (_) {}
      return res.json({
        isFinalized: true,
        month: resolved.cycleCode,
        cycleCode: resolved.cycleCode,
        startDate: resolved.startDate,
        endDate: resolved.endDate,
        salary: {
          ...finalized,
          attendanceSnapshot: snapshot,
        },
        payments,
        totalPaid: finalized.amount_disbursed || 0,
        remainingPayable: finalized.remaining_payable || 0,
      });
    }

    // Otherwise calculate current live draft
    const calculation = await salaryService.calculateSalaryForEmployee(userId, resolved.cycleCode);
    return res.json({
      isFinalized: false,
      month: resolved.cycleCode,
      cycleCode: resolved.cycleCode,
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      salary: calculation,
      payments,
      totalPaid: calculation.amountDisbursed || 0,
      remainingPayable: calculation.remainingPayable || calculation.netSalary,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getMyIncentives(req, res) {
  try {
    const periodParam = req.query.cycleCode || req.query.month;
    const resolved = await salaryService.resolveCycleOrPeriod(periodParam);
    const userId = req.user.id;

    const incentives = await db.query(
      `SELECT * FROM daily_incentives
       WHERE user_id = ? AND date >= ? AND date <= ?
       ORDER BY date DESC`,
      [userId, resolved.startDate, resolved.endDate]
    );
    const total = incentives
      .filter((i) => i.status === 'approved')
      .reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

    return res.json({
      month: resolved.cycleCode,
      cycleCode: resolved.cycleCode,
      incentives,
      total: salaryService.round2(total),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function getMyOvertime(req, res) {
  try {
    const periodParam = req.query.cycleCode || req.query.month;
    const resolved = await salaryService.resolveCycleOrPeriod(periodParam);
    const userId = req.user.id;

    const overtimes = await db.query(
      `SELECT * FROM overtime_records
       WHERE user_id = ? AND date >= ? AND date <= ?
       ORDER BY date DESC`,
      [userId, resolved.startDate, resolved.endDate]
    );
    const totalHours = overtimes
      .filter((o) => o.status === 'approved')
      .reduce((sum, o) => sum + (parseFloat(o.hours) || 0), 0);
    const totalAmount = overtimes
      .filter((o) => o.status === 'approved')
      .reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);

    return res.json({
      month: resolved.cycleCode,
      cycleCode: resolved.cycleCode,
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
      `SELECT pr.*, sc.start_date as cycle_start_date, sc.end_date as cycle_end_date, pp.finalized_at
       FROM payroll_records pr
       LEFT JOIN salary_cycles sc ON (pr.cycle_code = sc.cycle_code OR pr.cycle_id = sc.id)
       LEFT JOIN payroll_periods pp ON pr.payroll_period = pp.month
       WHERE pr.user_id = ? AND pr.status = 'finalized'
       ORDER BY COALESCE(sc.start_date, pr.payroll_period) DESC`,
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
  getActiveCycle,
  listCycles,
  getCycleDetails,
  disburseAndAdvance,
  recordAdditionalPayment,
  getMySalary,
  getMyIncentives,
  getMyOvertime,
  getMyPayrollHistory,
};
