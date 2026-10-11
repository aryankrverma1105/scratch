const db = require('../db');
const { getCompanyDate } = require('../utils/timeUtils');
const {
  getLeaveYear,
  getLeaveYearRange,
  isSunday,
  generateDateRange,
  calculateLeaveBreakdown,
  validateContinuousLeave,
  isMonthCompleted,
  getMonthsInLeaveYear,
} = require('../utils/leaveUtils');

/**
 * Ensure leave year record exists in leave_years table
 */
async function ensureLeaveYearExists(leaveYearCode) {
  const code = leaveYearCode || getLeaveYear();
  const existing = await db.get('SELECT id, code, is_active FROM leave_years WHERE code = ?', [code]);
  if (!existing) {
    const range = getLeaveYearRange(code);
    await db.run(
      'INSERT INTO leave_years (code, start_date, end_date, is_active) VALUES (?, ?, ?, 1)',
      [code, range.startDate, range.endDate]
    );
  }
}

/**
 * Get or create user's leave balance record for a leave year
 */
async function getUserLeaveBalance(userId, leaveYearCode) {
  const yearCode = leaveYearCode || getLeaveYear();
  await ensureLeaveYearExists(yearCode);

  let balanceRow = await db.get(
    'SELECT * FROM leave_balances WHERE user_id = ? AND leave_year = ?',
    [userId, yearCode]
  );

  if (!balanceRow) {
    await db.run(
      'INSERT INTO leave_balances (user_id, leave_year, accrued, used, expired, balance) VALUES (?, ?, 0, 0, 0, 0)',
      [userId, yearCode]
    );
    balanceRow = await db.get(
      'SELECT * FROM leave_balances WHERE user_id = ? AND leave_year = ?',
      [userId, yearCode]
    );
  }

  return {
    userId,
    leaveYear: yearCode,
    accrued: balanceRow ? balanceRow.accrued : 0,
    used: balanceRow ? balanceRow.used : 0,
    expired: balanceRow ? balanceRow.expired : 0,
    balance: balanceRow ? balanceRow.balance : 0,
    updatedAt: balanceRow ? balanceRow.updated_at : null,
  };
}

/**
 * Accrue 2 days monthly leave for a completed month
 * Idempotent: checks leave_accruals unique (user_id, leave_year, month)
 */
async function accrueMonthlyLeaves(yearMonth, force = false) {
  const [y, m] = yearMonth.split('-').map(Number);
  const targetDateStr = `${yearMonth}-15`;
  const leaveYearCode = getLeaveYear(targetDateStr);
  const todayStr = getCompanyDate();

  if (!force && !isMonthCompleted(yearMonth, todayStr)) {
    return {
      success: false,
      message: `Month ${yearMonth} is not yet completed. Accrual occurs at month-end.`,
      accruedCount: 0,
    };
  }

  await ensureLeaveYearExists(leaveYearCode);
  const activeUsers = await db.query('SELECT id, full_name, joining_date, exit_date FROM users WHERE is_active = 1');
  let accruedCount = 0;

  for (const user of activeUsers) {
    // Check if user joined after this month
    if (user.joining_date) {
      const monthEndStr = `${yearMonth}-31`;
      if (user.joining_date > monthEndStr) continue;
    }
    // Check if user exited before this month
    if (user.exit_date && user.exit_date < `${yearMonth}-01`) {
      continue;
    }

    // Check if already accrued
    const existing = await db.get(
      'SELECT id FROM leave_accruals WHERE user_id = ? AND leave_year = ? AND month = ?',
      [user.id, leaveYearCode, yearMonth]
    );

    if (existing) continue;

    await db.withTransaction(async (tx) => {
      // 1. Insert accrual
      await tx.run(
        'INSERT INTO leave_accruals (user_id, leave_year, month, days_accrued) VALUES (?, ?, ?, 2)',
        [user.id, leaveYearCode, yearMonth]
      );

      // 2. Ensure balance row exists & increment
      const bRow = await tx.get(
        'SELECT id, accrued, balance FROM leave_balances WHERE user_id = ? AND leave_year = ?',
        [user.id, leaveYearCode]
      );

      if (!bRow) {
        await tx.run(
          'INSERT INTO leave_balances (user_id, leave_year, accrued, used, expired, balance) VALUES (?, ?, 2, 0, 0, 2)',
          [user.id, leaveYearCode]
        );
      } else {
        await tx.run(
          `UPDATE leave_balances 
           SET accrued = accrued + 2, balance = balance + 2, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [bRow.id]
        );
      }

      // 3. Audit log
      await tx.run(
        `INSERT INTO leave_audit_logs (user_id, action, details, performed_by)
         VALUES (?, 'ACCRUAL', ?, NULL)`,
        [user.id, JSON.stringify({ month: yearMonth, days: 2, leaveYear: leaveYearCode })]
      );
    });

    accruedCount++;
  }

  return {
    success: true,
    month: yearMonth,
    leaveYear: leaveYearCode,
    accruedUsers: accruedCount,
  };
}

/**
 * Catch up all completed months in the current leave year that haven't been accrued yet
 */
async function syncLeaveAccrualsForYear(leaveYearCode = getLeaveYear()) {
  const allMonths = getMonthsInLeaveYear(leaveYearCode);
  const todayStr = getCompanyDate();
  let totalAccrued = 0;

  for (const m of allMonths) {
    if (isMonthCompleted(m, todayStr)) {
      const res = await accrueMonthlyLeaves(m, false);
      if (res.accruedUsers) totalAccrued += res.accruedUsers;
    }
  }

  return totalAccrued;
}

/**
 * Company Holidays CRUD & Validation
 */
async function getCompanyHolidays(leaveYearCode) {
  const yearCode = leaveYearCode || getLeaveYear();
  const holidays = await db.query(
    'SELECT * FROM company_holidays WHERE leave_year = ? ORDER BY date ASC',
    [yearCode]
  );

  const activeCount = holidays.filter((h) => h.is_active === 1 || h.is_active === true).length;
  const isComplete = activeCount === 16;
  const warning = !isComplete
    ? `Warning: Exactly 16 fixed company holidays are required per annual policy. Currently ${activeCount} configured.`
    : null;

  return {
    leaveYear: yearCode,
    count: activeCount,
    target: 16,
    isComplete,
    warning,
    holidays,
  };
}

async function createCompanyHoliday(adminId, { leaveYear, name, date, description }) {
  if (!name || !date) {
    throw new Error('Holiday name and date are required');
  }

  const yearCode = leaveYear || getLeaveYear(date);
  const range = getLeaveYearRange(yearCode);

  if (date < range.startDate || date > range.endDate) {
    throw new Error(
      `Holiday date ${date} is outside the leave year ${yearCode} (${range.startDate} to ${range.endDate}).`
    );
  }

  const existing = await db.get(
    'SELECT id, name FROM company_holidays WHERE leave_year = ? AND date = ?',
    [yearCode, date]
  );
  if (existing) {
    throw new Error(`A company holiday is already configured on ${date} ("${existing.name}").`);
  }

  const res = await db.run(
    `INSERT INTO company_holidays (leave_year, name, date, description, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [yearCode, name.trim(), date, description || null]
  );

  await db.run(
    `INSERT INTO leave_audit_logs (user_id, action, details, performed_by)
     VALUES (NULL, 'HOLIDAY_CREATE', ?, ?)`,
    [JSON.stringify({ id: res.lastID, leaveYear: yearCode, name, date }), adminId]
  );

  return {
    id: res.lastID,
    leaveYear: yearCode,
    name,
    date,
    description,
    isActive: true,
  };
}

async function updateCompanyHoliday(adminId, holidayId, { name, date, description, isActive }) {
  const holiday = await db.get('SELECT * FROM company_holidays WHERE id = ?', [holidayId]);
  if (!holiday) throw new Error('Holiday not found');

  const newYear = holiday.leave_year;
  const newDate = date !== undefined ? date : holiday.date;
  const newName = name !== undefined ? name.trim() : holiday.name;
  const newDesc = description !== undefined ? description : holiday.description;
  const newActive = isActive !== undefined ? (isActive ? 1 : 0) : holiday.is_active;

  if (date !== undefined && date !== holiday.date) {
    const range = getLeaveYearRange(newYear);
    if (newDate < range.startDate || newDate > range.endDate) {
      throw new Error(`Holiday date ${newDate} is outside leave year ${newYear}.`);
    }
    const dup = await db.get(
      'SELECT id FROM company_holidays WHERE leave_year = ? AND date = ? AND id != ?',
      [newYear, newDate, holidayId]
    );
    if (dup) throw new Error(`Another holiday already exists on ${newDate}.`);
  }

  await db.run(
    `UPDATE company_holidays 
     SET name = ?, date = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [newName, newDate, newDesc, newActive, holidayId]
  );

  await db.run(
    `INSERT INTO leave_audit_logs (user_id, action, details, performed_by)
     VALUES (NULL, 'HOLIDAY_UPDATE', ?, ?)`,
    [JSON.stringify({ id: holidayId, before: holiday, after: { newName, newDate, newDesc, newActive } }), adminId]
  );

  return {
    id: holidayId,
    leaveYear: newYear,
    name: newName,
    date: newDate,
    description: newDesc,
    isActive: Boolean(newActive),
  };
}

async function deleteCompanyHoliday(adminId, holidayId) {
  const holiday = await db.get('SELECT * FROM company_holidays WHERE id = ?', [holidayId]);
  if (!holiday) throw new Error('Holiday not found');

  await db.run('DELETE FROM company_holidays WHERE id = ?', [holidayId]);

  await db.run(
    `INSERT INTO leave_audit_logs (user_id, action, details, performed_by)
     VALUES (NULL, 'HOLIDAY_DELETE', ?, ?)`,
    [JSON.stringify(holiday), adminId]
  );

  return { success: true, deletedId: holidayId };
}

/**
 * Preview / Calculate leave request parameters
 */
async function calculateLeaveRequest(userId, startDate, endDate) {
  if (!startDate || !endDate) {
    throw new Error('Start date and end date are required');
  }

  const leaveYearCode = getLeaveYear(startDate);
  const endLeaveYear = getLeaveYear(endDate);
  if (leaveYearCode !== endLeaveYear) {
    throw new Error('Leave period cannot span across multiple leave years. Please submit separate requests for each leave year.');
  }

  // Fetch holidays for this leave year
  const holidays = await db.query(
    'SELECT date FROM company_holidays WHERE leave_year = ? AND is_active = 1',
    [leaveYearCode]
  );
  const holidaySet = new Set(holidays.map((h) => h.date));

  // Compute breakdown
  const breakdown = calculateLeaveBreakdown(startDate, endDate, holidaySet);

  // Fetch existing leaves for user
  const existingLeaves = await db.query(
    'SELECT start_date, end_date, status FROM leave_records WHERE user_id = ? AND status = "confirmed"',
    [userId]
  );

  // Validate 7-day continuous limit & overlap
  validateContinuousLeave(startDate, endDate, existingLeaves);

  // Current balance
  const balanceInfo = await getUserLeaveBalance(userId, leaveYearCode);
  const balanceAfter = balanceInfo.balance - breakdown.daysDeducted;
  const isEligible = balanceAfter >= 0;

  return {
    startDate,
    endDate,
    leaveYear: leaveYearCode,
    calendarDays: breakdown.calendarDays,
    workingDays: breakdown.workingDays,
    sundaysCount: breakdown.sundaysCount,
    holidaysCount: breakdown.holidaysCount,
    daysDeducted: breakdown.daysDeducted,
    currentBalance: balanceInfo.balance,
    balanceAfter: isEligible ? balanceAfter : balanceInfo.balance,
    isEligible,
    ineligibleReason: isEligible
      ? null
      : `Insufficient leave balance. You have ${balanceInfo.balance} day(s) available, but this request requires ${breakdown.daysDeducted} day(s).`,
  };
}

/**
 * Submit Eligible Leave (Automatically Confirmed, Transactional)
 */
async function submitLeaveRequest(userId, { startDate, endDate, reason }) {
  const calc = await calculateLeaveRequest(userId, startDate, endDate);

  if (!calc.isEligible) {
    throw new Error(calc.ineligibleReason);
  }

  return await db.withTransaction(async (tx) => {
    // Re-verify balance inside transaction
    const balanceRow = await tx.get(
      'SELECT id, balance, used FROM leave_balances WHERE user_id = ? AND leave_year = ?',
      [userId, calc.leaveYear]
    );

    if (!balanceRow || balanceRow.balance < calc.daysDeducted) {
      throw new Error(`Insufficient leave balance inside transaction. Available: ${balanceRow ? balanceRow.balance : 0}`);
    }

    // Double check overlap inside transaction
    const existingOverlaps = await tx.query(
      `SELECT id, start_date, end_date FROM leave_records 
       WHERE user_id = ? AND status = 'confirmed' 
         AND NOT (end_date < ? OR start_date > ?)`,
      [userId, startDate, endDate]
    );
    if (existingOverlaps.length > 0) {
      throw new Error(`Conflict detected: Another confirmed leave already exists for these dates.`);
    }

    // 1. Insert confirmed leave record
    const leaveRes = await tx.run(
      `INSERT INTO leave_records (
        user_id, leave_year, start_date, end_date, calendar_days, working_days, days_deducted, reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      [
        userId,
        calc.leaveYear,
        startDate,
        endDate,
        calc.calendarDays,
        calc.workingDays,
        calc.daysDeducted,
        reason ? reason.trim() : null,
      ]
    );

    // 2. Deduct from balance
    await tx.run(
      `UPDATE leave_balances 
       SET used = used + ?, balance = balance - ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [calc.daysDeducted, calc.daysDeducted, balanceRow.id]
    );

    // 3. Log audit
    await tx.run(
      `INSERT INTO leave_audit_logs (user_id, action, details, performed_by)
       VALUES (?, 'LEAVE_SUBMIT', ?, ?)`,
      [
        userId,
        JSON.stringify({
          recordId: leaveRes.lastID,
          startDate,
          endDate,
          calendarDays: calc.calendarDays,
          daysDeducted: calc.daysDeducted,
        }),
        userId,
      ]
    );

    const updatedBalance = await tx.get(
      'SELECT balance, accrued, used FROM leave_balances WHERE id = ?',
      [balanceRow.id]
    );

    return {
      success: true,
      leaveId: leaveRes.lastID,
      status: 'confirmed',
      startDate,
      endDate,
      calendarDays: calc.calendarDays,
      workingDays: calc.workingDays,
      daysDeducted: calc.daysDeducted,
      reason: reason || '',
      remainingBalance: updatedBalance.balance,
      message: 'Leave confirmed successfully without approval required.',
    };
  });
}

/**
 * Cancel a future eligible leave request
 */
async function cancelLeaveRequest(userId, leaveRecordId, cancelReason, isAdmin = false) {
  const leave = await db.get('SELECT * FROM leave_records WHERE id = ?', [leaveRecordId]);
  if (!leave) throw new Error('Leave record not found');

  if (!isAdmin && leave.user_id !== userId) {
    throw new Error('Unauthorized to cancel this leave record');
  }

  if (leave.status === 'cancelled') {
    throw new Error('This leave record is already cancelled');
  }

  const todayStr = getCompanyDate();
  if (!isAdmin && leave.start_date < todayStr) {
    throw new Error('Past leaves cannot be cancelled by employees. Please contact your administrator.');
  }

  return await db.withTransaction(async (tx) => {
    // 1. Mark leave as cancelled
    await tx.run(
      `UPDATE leave_records 
       SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_reason = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [cancelReason || 'Cancelled by user', leaveRecordId]
    );

    // 2. Restore balance
    const bRow = await tx.get(
      'SELECT id, balance, used FROM leave_balances WHERE user_id = ? AND leave_year = ?',
      [leave.user_id, leave.leave_year]
    );

    if (bRow) {
      await tx.run(
        `UPDATE leave_balances 
         SET used = used - ?, balance = balance + ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [leave.days_deducted, leave.days_deducted, bRow.id]
      );
    }

    // 3. Log audit
    await tx.run(
      `INSERT INTO leave_audit_logs (user_id, action, details, performed_by)
       VALUES (?, 'LEAVE_CANCEL', ?, ?)`,
      [
        leave.user_id,
        JSON.stringify({
          recordId: leaveRecordId,
          daysRestored: leave.days_deducted,
          cancelReason,
        }),
        userId,
      ]
    );

    const updatedBalance = await tx.get(
      'SELECT balance, accrued, used FROM leave_balances WHERE id = ?',
      [bRow ? bRow.id : 0]
    );

    return {
      success: true,
      leaveId: leaveRecordId,
      status: 'cancelled',
      daysRestored: leave.days_deducted,
      restoredBalance: updatedBalance ? updatedBalance.balance : 0,
      message: 'Leave cancelled and balance restored.',
    };
  });
}

/**
 * Reconcile Daily Attendance for a completed working day
 * Idempotent: checks attendance_absences unique (user_id, date)
 */
async function reconcileDailyAttendance(targetDate) {
  const targetDateStr = targetDate || getCompanyDate();
  const leaveYearCode = getLeaveYear(targetDateStr);
  const yearMonthStr = targetDateStr.substring(0, 7);

  // 1. Check if Sunday
  if (isSunday(targetDateStr)) {
    return {
      processed: 0,
      date: targetDateStr,
      reason: 'Sunday is a company non-working day. No absence recorded.',
    };
  }

  // 2. Check if Company Holiday
  const holiday = await db.get(
    'SELECT name FROM company_holidays WHERE leave_year = ? AND date = ? AND is_active = 1',
    [leaveYearCode, targetDateStr]
  );
  if (holiday) {
    return {
      processed: 0,
      date: targetDateStr,
      reason: `Company holiday (${holiday.name}) is a non-working day. No absence recorded.`,
    };
  }

  // 3. Query all active users
  const activeUsers = await db.query(
    'SELECT id, full_name, joining_date, exit_date FROM users WHERE is_active = 1'
  );

  let recordedAbsences = 0;

  for (const user of activeUsers) {
    // Respect employment bounds
    if (user.joining_date && user.joining_date > targetDateStr) continue;
    if (user.exit_date && user.exit_date < targetDateStr) continue;

    // Check if valid attendance exists for this day
    const validAtt = await db.get(
      `SELECT id, status FROM attendance 
       WHERE user_id = ? AND date = ? 
         AND status IN ('checked_in', 'checked_out', 'auto_checked_out')`,
      [user.id, targetDateStr]
    );
    if (validAtt) continue;

    // Check if covered by confirmed leave
    const confirmedLeave = await db.get(
      `SELECT id FROM leave_records 
       WHERE user_id = ? AND status = 'confirmed' 
         AND start_date <= ? AND end_date >= ?`,
      [user.id, targetDateStr, targetDateStr]
    );
    if (confirmedLeave) continue;

    // Check if absence already recorded
    const existingAbsence = await db.get(
      'SELECT id FROM attendance_absences WHERE user_id = ? AND date = ?',
      [user.id, targetDateStr]
    );
    if (existingAbsence) continue;

    // USER WAS MISSING: Reconcile in transaction
    await db.withTransaction(async (tx) => {
      const bRow = await tx.get(
        'SELECT id, balance, used FROM leave_balances WHERE user_id = ? AND leave_year = ?',
        [user.id, leaveYearCode]
      );

      const currentBal = bRow ? bRow.balance : 0;
      let absenceType = 'unpaid';

      if (currentBal >= 1) {
        absenceType = 'earned_leave_deducted';
        // Deduct 1 day
        await tx.run(
          `UPDATE leave_balances 
           SET used = used + 1, balance = balance - 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [bRow.id]
        );
      }

      await tx.run(
        `INSERT INTO attendance_absences (
          user_id, date, leave_year, month, absence_type, reason
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          targetDateStr,
          leaveYearCode,
          yearMonthStr,
          absenceType,
          absenceType === 'earned_leave_deducted'
            ? 'Missing attendance: 1 earned leave automatically deducted.'
            : 'Missing attendance: Unpaid absence recorded (0 earned leave available).',
        ]
      );

      await tx.run(
        `INSERT INTO leave_audit_logs (user_id, action, details, performed_by)
         VALUES (?, 'AUTO_ABSENCE', ?, NULL)`,
        [user.id, JSON.stringify({ date: targetDateStr, absenceType })]
      );
    });

    // Update monthly summary for this user
    await updateMonthlySummary(user.id, yearMonthStr);
    recordedAbsences++;
  }

  return {
    date: targetDateStr,
    processed: activeUsers.length,
    recordedAbsences,
  };
}

/**
 * Update monthly attendance summary and missing days threshold status
 */
async function updateMonthlySummary(userId, yearMonthStr) {
  const targetDateStr = `${yearMonthStr}-15`;
  const leaveYearCode = getLeaveYear(targetDateStr);

  const absences = await db.query(
    'SELECT absence_type, is_corrected FROM attendance_absences WHERE user_id = ? AND month = ?',
    [userId, yearMonthStr]
  );

  const uncorrected = absences.filter((a) => !a.is_corrected);
  const missingCount = uncorrected.length;
  const autoAbsenceCount = uncorrected.filter((a) => a.absence_type === 'earned_leave_deducted').length;
  const unpaidCount = uncorrected.filter((a) => a.absence_type === 'unpaid').length;

  // Threshold is > 2 missing days per month
  const thresholdExceeded = missingCount > 2 ? 1 : 0;

  // Accruals for this month
  const accrual = await db.get(
    'SELECT days_accrued FROM leave_accruals WHERE user_id = ? AND month = ?',
    [userId, yearMonthStr]
  );
  const daysAccrued = accrual ? accrual.days_accrued : 0;

  // Balance
  const bRow = await db.get(
    'SELECT balance, used FROM leave_balances WHERE user_id = ? AND leave_year = ?',
    [userId, leaveYearCode]
  );
  const remainingBal = bRow ? bRow.balance : 0;
  const leavesUsed = bRow ? bRow.used : 0;

  const existing = await db.get(
    'SELECT id FROM monthly_attendance_summaries WHERE user_id = ? AND month = ?',
    [userId, yearMonthStr]
  );

  if (existing) {
    await db.run(
      `UPDATE monthly_attendance_summaries 
       SET missing_attendance_count = ?,
           earned_leaves_accrued = ?,
           earned_leaves_used = ?,
           automatic_absence_count = ?,
           unpaid_absence_count = ?,
           remaining_earned_balance = ?,
           threshold_exceeded = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        missingCount,
        daysAccrued,
        leavesUsed,
        autoAbsenceCount,
        unpaidCount,
        remainingBal,
        thresholdExceeded,
        existing.id,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO monthly_attendance_summaries (
        user_id, leave_year, month, missing_attendance_count, earned_leaves_accrued,
        earned_leaves_used, automatic_absence_count, unpaid_absence_count,
        remaining_earned_balance, threshold_exceeded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        leaveYearCode,
        yearMonthStr,
        missingCount,
        daysAccrued,
        leavesUsed,
        autoAbsenceCount,
        unpaidCount,
        remainingBal,
        thresholdExceeded,
      ]
    );
  }

  return {
    userId,
    month: yearMonthStr,
    missingCount,
    autoAbsenceCount,
    unpaidCount,
    thresholdExceeded: Boolean(thresholdExceeded),
  };
}

/**
 * Admin Correction of an Absence Record
 */
async function correctAbsenceRecord(adminId, absenceId, correctionNotes) {
  const absence = await db.get('SELECT * FROM attendance_absences WHERE id = ?', [absenceId]);
  if (!absence) throw new Error('Absence record not found');
  if (absence.is_corrected) throw new Error('This absence record has already been corrected');

  return await db.withTransaction(async (tx) => {
    // 1. Mark corrected
    await tx.run(
      `UPDATE attendance_absences 
       SET is_corrected = 1, corrected_by = ?, correction_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [adminId, correctionNotes || 'Corrected by administrator', absenceId]
    );

    // 2. If it was earned_leave_deducted, restore 1 earned leave
    if (absence.absence_type === 'earned_leave_deducted') {
      const bRow = await tx.get(
        'SELECT id FROM leave_balances WHERE user_id = ? AND leave_year = ?',
        [absence.user_id, absence.leave_year]
      );
      if (bRow) {
        await tx.run(
          `UPDATE leave_balances 
           SET used = used - 1, balance = balance + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [bRow.id]
        );
      }
    }

    // 3. Audit log
    await tx.run(
      `INSERT INTO leave_audit_logs (user_id, action, details, performed_by)
       VALUES (?, 'ABSENCE_CORRECT', ?, ?)`,
      [
        absence.user_id,
        JSON.stringify({
          absenceId,
          date: absence.date,
          absenceType: absence.absence_type,
          notes: correctionNotes,
        }),
        adminId,
      ]
    );
  }).then(async () => {
    // Update summary
    await updateMonthlySummary(absence.user_id, absence.month);
    return {
      success: true,
      absenceId,
      isCorrected: true,
      restoredLeave: absence.absence_type === 'earned_leave_deducted' ? 1 : 0,
      message: 'Absence corrected successfully and leave balance restored if applicable.',
    };
  });
}

/**
 * Annual Leave Year Transition (1 April Reset)
 * Unused leaves from previous year are expired.
 * New leave year starts with 0 balance.
 * Attendance and historical records are NEVER deleted!
 */
async function performAnnualLeaveYearReset(fromYear, toYear) {
  await ensureLeaveYearExists(toYear);

  // Check if transition already recorded
  const alreadyDone = await db.get(
    `SELECT id FROM leave_audit_logs 
     WHERE action = 'YEAR_RESET' AND details LIKE ? LIMIT 1`,
    [`%"toYear":"${toYear}"%`]
  );
  if (alreadyDone) {
    return { success: true, message: `Annual reset for ${toYear} has already been completed.`, skipped: true };
  }

  const previousBalances = await db.query(
    'SELECT id, user_id, balance, accrued, used, expired FROM leave_balances WHERE leave_year = ?',
    [fromYear]
  );

  let resetCount = 0;

  for (const prev of previousBalances) {
    await db.withTransaction(async (tx) => {
      // 1. Expire remaining balance in old year
      if (prev.balance > 0) {
        await tx.run(
          `UPDATE leave_balances 
           SET expired = expired + balance, balance = 0, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [prev.id]
        );
      }

      // 2. Initialize new year balance with 0
      const existingNew = await tx.get(
        'SELECT id FROM leave_balances WHERE user_id = ? AND leave_year = ?',
        [prev.user_id, toYear]
      );
      if (!existingNew) {
        await tx.run(
          'INSERT INTO leave_balances (user_id, leave_year, accrued, used, expired, balance) VALUES (?, ?, 0, 0, 0, 0)',
          [prev.user_id, toYear]
        );
      }

      // 3. Audit log
      await tx.run(
        `INSERT INTO leave_audit_logs (user_id, action, details, performed_by)
         VALUES (?, 'YEAR_RESET', ?, NULL)`,
        [
          prev.user_id,
          JSON.stringify({
            fromYear,
            toYear,
            expiredDays: prev.balance,
          }),
        ]
      );
    });
    resetCount++;
  }

  // Deactivate old leave year, activate new
  await db.run('UPDATE leave_years SET is_active = 0 WHERE code = ?', [fromYear]);
  await db.run('UPDATE leave_years SET is_active = 1 WHERE code = ?', [toYear]);

  return {
    success: true,
    fromYear,
    toYear,
    usersReset: resetCount,
    message: `Annual leave year reset complete. Unused balance expired; fresh leave year ${toYear} initialized.`,
  };
}

module.exports = {
  ensureLeaveYearExists,
  getUserLeaveBalance,
  accrueMonthlyLeaves,
  syncLeaveAccrualsForYear,
  getCompanyHolidays,
  createCompanyHoliday,
  updateCompanyHoliday,
  deleteCompanyHoliday,
  calculateLeaveRequest,
  submitLeaveRequest,
  cancelLeaveRequest,
  reconcileDailyAttendance,
  updateMonthlySummary,
  correctAbsenceRecord,
  performAnnualLeaveYearReset,
};
