const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let db = null;
let isPostgres = false;

// Ensure directories exist
if (!fs.existsSync(path.dirname(config.SQLITE_PATH))) {
  fs.mkdirSync(path.dirname(config.SQLITE_PATH), { recursive: true });
}
if (!fs.existsSync(config.SELFIE_DIR)) {
  fs.mkdirSync(config.SELFIE_DIR, { recursive: true });
}

if (config.DATABASE_URL && config.DATABASE_URL.startsWith('postgres')) {
  isPostgres = true;
  db = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  console.log('Connected to PostgreSQL database');
} else {
  isPostgres = false;
  db = new sqlite3.Database(config.SQLITE_PATH, (err) => {
    if (err) {
      console.error('Error opening SQLite database:', err.message);
    } else {
      console.log(`Connected to SQLite database at ${config.SQLITE_PATH}`);
    }
  });
}

// Unified query wrapper
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isPostgres) {
      // In PostgreSQL, convert ? to $1, $2, etc.
      let pIdx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
      db.query(pgSql, params, (err, res) => {
        if (err) return reject(err);
        resolve(res.rows);
      });
    } else {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    }
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isPostgres) {
      let pIdx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
      db.query(pgSql, params, (err, res) => {
        if (err) return reject(err);
        resolve(res.rows[0] || null);
      });
    } else {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    }
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isPostgres) {
      let pIdx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
      // If INSERT, append RETURNING id if not present to get inserted ID
      let finalSql = pgSql;
      if (/^\s*insert\s+/i.test(pgSql) && !/returning/i.test(pgSql)) {
        finalSql += ' RETURNING id';
      }
      db.query(finalSql, params, (err, res) => {
        if (err) return reject(err);
        const lastID = res.rows && res.rows[0] ? res.rows[0].id : null;
        resolve({ lastID, changes: res.rowCount });
      });
    } else {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    }
  });
}

async function withTransaction(callback) {
  if (isPostgres) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const txDb = {
        query: (sql, params = []) => {
          let pIdx = 1;
          const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
          return client.query(pgSql, params).then((res) => res.rows);
        },
        get: (sql, params = []) => {
          let pIdx = 1;
          const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
          return client.query(pgSql, params).then((res) => res.rows[0] || null);
        },
        run: (sql, params = []) => {
          let pIdx = 1;
          let pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
          if (/^\s*insert\s+/i.test(pgSql) && !/returning/i.test(pgSql)) {
            pgSql += ' RETURNING id';
          }
          return client.query(pgSql, params).then((res) => ({
            lastID: res.rows && res.rows[0] ? res.rows[0].id : null,
            changes: res.rowCount,
          }));
        },
      };
      const result = await callback(txDb);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    await run('BEGIN IMMEDIATE');
    try {
      const result = await callback({ query, get, run });
      await run('COMMIT');
      return result;
    } catch (err) {
      try {
        await run('ROLLBACK');
      } catch (_) {}
      throw err;
    }
  }
}

let initDbPromise = null;

function initDatabase() {
  if (initDbPromise) return initDbPromise;
  initDbPromise = (async () => {
  const usersTable = isPostgres
    ? `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(100) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'employee',
        department VARCHAR(100),
        phone VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        must_change_password BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    : `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee',
        department TEXT,
        phone TEXT,
        is_active INTEGER DEFAULT 1,
        must_change_password INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`;

  const attendanceTable = isPostgres
    ? `CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        date VARCHAR(20) NOT NULL,
        check_in_time TIMESTAMP NOT NULL,
        check_in_lat DOUBLE PRECISION NOT NULL,
        check_in_lng DOUBLE PRECISION NOT NULL,
        check_in_accuracy REAL,
        check_in_is_mocked BOOLEAN DEFAULT FALSE,
        check_in_address TEXT,
        check_in_selfie VARCHAR(255),
        check_out_time TIMESTAMP,
        check_out_lat DOUBLE PRECISION,
        check_out_lng DOUBLE PRECISION,
        check_out_accuracy REAL,
        check_out_is_mocked BOOLEAN DEFAULT FALSE,
        check_out_address TEXT,
        check_out_selfie VARCHAR(255),
        check_out_type VARCHAR(50) DEFAULT 'manual',
        status VARCHAR(50) DEFAULT 'checked_in',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    : `CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        date TEXT NOT NULL,
        check_in_time DATETIME NOT NULL,
        check_in_lat REAL NOT NULL,
        check_in_lng REAL NOT NULL,
        check_in_accuracy REAL,
        check_in_is_mocked INTEGER DEFAULT 0,
        check_in_address TEXT,
        check_in_selfie TEXT,
        check_out_time DATETIME,
        check_out_lat REAL,
        check_out_lng REAL,
        check_out_accuracy REAL,
        check_out_is_mocked INTEGER DEFAULT 0,
        check_out_address TEXT,
        check_out_selfie TEXT,
        check_out_type TEXT DEFAULT 'manual',
        status TEXT DEFAULT 'checked_in',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`;

  const locationTracksTable = isPostgres
    ? `CREATE TABLE IF NOT EXISTS location_tracks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        attendance_id INTEGER REFERENCES attendance(id),
        client_point_id VARCHAR(100),
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        accuracy REAL,
        speed REAL,
        altitude REAL,
        battery_level REAL,
        is_gps_off BOOLEAN DEFAULT FALSE,
        is_mocked BOOLEAN DEFAULT FALSE,
        timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    : `CREATE TABLE IF NOT EXISTS location_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        attendance_id INTEGER REFERENCES attendance(id),
        client_point_id TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        speed REAL,
        altitude REAL,
        battery_level REAL,
        is_gps_off INTEGER DEFAULT 0,
        is_mocked INTEGER DEFAULT 0,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`;

  const gpsAlertsTable = isPostgres
    ? `CREATE TABLE IF NOT EXISTS gps_alerts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        alert_type VARCHAR(100) NOT NULL,
        message TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        resolved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    : `CREATE TABLE IF NOT EXISTS gps_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        alert_type TEXT NOT NULL,
        message TEXT,
        latitude REAL,
        longitude REAL,
        resolved INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`;

  const migrationsTable = isPostgres
    ? `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    : `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`;

  await run(usersTable);
  await run(attendanceTable);
  await run(locationTracksTable);
  await run(gpsAlertsTable);
  await run(migrationsTable);

  // Simple Versioned Migrations Runner
  const migrations = [
    {
      version: 1,
      name: 'add_user_must_change_password',
      up: async () => {
        try { await run(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`); } catch (_) {}
      },
    },
    {
      version: 2,
      name: 'add_attendance_and_tracking_accuracy_mock_columns',
      up: async () => {
        try { await run(`ALTER TABLE attendance ADD COLUMN check_in_accuracy REAL`); } catch (_) {}
        try { await run(`ALTER TABLE attendance ADD COLUMN check_in_is_mocked INTEGER DEFAULT 0`); } catch (_) {}
        try { await run(`ALTER TABLE attendance ADD COLUMN check_out_accuracy REAL`); } catch (_) {}
        try { await run(`ALTER TABLE attendance ADD COLUMN check_out_is_mocked INTEGER DEFAULT 0`); } catch (_) {}
        try { await run(`ALTER TABLE attendance ADD COLUMN check_out_type TEXT DEFAULT 'manual'`); } catch (_) {}
        try { await run(`ALTER TABLE location_tracks ADD COLUMN is_mocked INTEGER DEFAULT 0`); } catch (_) {}
        try { await run(`ALTER TABLE location_tracks ADD COLUMN client_point_id TEXT`); } catch (_) {}
      },
    },
    {
      version: 3,
      name: 'add_performance_and_idempotency_indexes',
      up: async () => {
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_client_pt ON location_tracks(user_id, client_point_id) WHERE client_point_id IS NOT NULL`);
        } catch (_) {}
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_tracks_user_ts ON location_tracks(user_id, timestamp)`);
        } catch (_) {}
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_tracks_att_id ON location_tracks(attendance_id)`);
        } catch (_) {}
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance(user_id, date)`);
        } catch (_) {}
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_att_status ON attendance(status)`);
        } catch (_) {}
      },
    },
    {
      version: 4,
      name: 'create_leave_management_system',
      up: async () => {
        // 1. Add employee joining and exit dates to users
        try { await run(`ALTER TABLE users ADD COLUMN joining_date TEXT`); } catch (_) {}
        try { await run(`ALTER TABLE users ADD COLUMN exit_date TEXT`); } catch (_) {}

        const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPostgres ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP';

        // 2. Leave Years
        await run(`
          CREATE TABLE IF NOT EXISTS leave_years (
            id ${pkDef},
            code VARCHAR(20) UNIQUE NOT NULL,
            start_date VARCHAR(20) NOT NULL,
            end_date VARCHAR(20) NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at ${tsDef}
          )
        `);

        // 3. Company Holidays (16 days annual policy)
        await run(`
          CREATE TABLE IF NOT EXISTS company_holidays (
            id ${pkDef},
            leave_year VARCHAR(20) NOT NULL,
            name VARCHAR(150) NOT NULL,
            date VARCHAR(20) NOT NULL,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            created_at ${tsDef},
            updated_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_yr_date ON company_holidays(leave_year, date)`);
        } catch (_) {}

        // 4. Leave Balances
        await run(`
          CREATE TABLE IF NOT EXISTS leave_balances (
            id ${pkDef},
            user_id INTEGER NOT NULL REFERENCES users(id),
            leave_year VARCHAR(20) NOT NULL,
            accrued REAL DEFAULT 0,
            used REAL DEFAULT 0,
            expired REAL DEFAULT 0,
            balance REAL DEFAULT 0,
            updated_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_balances_user_yr ON leave_balances(user_id, leave_year)`);
        } catch (_) {}

        // 5. Leave Accruals (Idempotent 2 days/month)
        await run(`
          CREATE TABLE IF NOT EXISTS leave_accruals (
            id ${pkDef},
            user_id INTEGER NOT NULL REFERENCES users(id),
            leave_year VARCHAR(20) NOT NULL,
            month VARCHAR(10) NOT NULL,
            days_accrued REAL NOT NULL DEFAULT 2,
            accrued_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accruals_user_mo ON leave_accruals(user_id, leave_year, month)`);
        } catch (_) {}

        // 6. Confirmed Leave Records
        await run(`
          CREATE TABLE IF NOT EXISTS leave_records (
            id ${pkDef},
            user_id INTEGER NOT NULL REFERENCES users(id),
            leave_year VARCHAR(20) NOT NULL,
            start_date VARCHAR(20) NOT NULL,
            end_date VARCHAR(20) NOT NULL,
            calendar_days INTEGER NOT NULL,
            working_days INTEGER NOT NULL,
            days_deducted REAL NOT NULL,
            reason TEXT,
            status VARCHAR(50) NOT NULL DEFAULT 'confirmed',
            cancelled_at ${isPostgres ? 'TIMESTAMP' : 'DATETIME'},
            cancelled_reason TEXT,
            created_at ${tsDef},
            updated_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_leave_user_dates ON leave_records(user_id, start_date, end_date)`);
        } catch (_) {}

        // 7. Attendance Absences (Daily Reconciliation)
        await run(`
          CREATE TABLE IF NOT EXISTS attendance_absences (
            id ${pkDef},
            user_id INTEGER NOT NULL REFERENCES users(id),
            date VARCHAR(20) NOT NULL,
            leave_year VARCHAR(20) NOT NULL,
            month VARCHAR(10) NOT NULL,
            absence_type VARCHAR(50) NOT NULL,
            reason TEXT,
            is_corrected INTEGER DEFAULT 0,
            corrected_by INTEGER REFERENCES users(id),
            correction_notes TEXT,
            created_at ${tsDef},
            updated_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_absences_user_date ON attendance_absences(user_id, date)`);
        } catch (_) {}

        // 8. Monthly Attendance Summaries (Threshold > 2 missing days)
        await run(`
          CREATE TABLE IF NOT EXISTS monthly_attendance_summaries (
            id ${pkDef},
            user_id INTEGER NOT NULL REFERENCES users(id),
            leave_year VARCHAR(20) NOT NULL,
            month VARCHAR(10) NOT NULL,
            missing_attendance_count INTEGER DEFAULT 0,
            earned_leaves_accrued REAL DEFAULT 0,
            earned_leaves_used REAL DEFAULT 0,
            automatic_absence_count INTEGER DEFAULT 0,
            unpaid_absence_count INTEGER DEFAULT 0,
            remaining_earned_balance REAL DEFAULT 0,
            threshold_exceeded INTEGER DEFAULT 0,
            updated_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_summaries_user_mo ON monthly_attendance_summaries(user_id, month)`);
        } catch (_) {}

        // 9. Leave Audit Logs
        await run(`
          CREATE TABLE IF NOT EXISTS leave_audit_logs (
            id ${pkDef},
            user_id INTEGER REFERENCES users(id),
            action VARCHAR(50) NOT NULL,
            details TEXT,
            performed_by INTEGER REFERENCES users(id),
            created_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_audit_user_act ON leave_audit_logs(user_id, action)`);
        } catch (_) {}
      },
    },
    {
      version: 5,
      name: 'create_salary_and_activity_management_system',
      up: async () => {
        const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPostgres ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP';

        // 1. Common Salary Settings (Global Daily Wage Rate)
        await run(`
          CREATE TABLE IF NOT EXISTS salary_settings (
            id ${pkDef},
            common_daily_wage REAL DEFAULT 0,
            updated_by INTEGER REFERENCES users(id),
            updated_at ${tsDef}
          )
        `);
        // Seed default record if not exists
        const existingSettings = await get('SELECT id FROM salary_settings LIMIT 1');
        if (!existingSettings) {
          await run('INSERT INTO salary_settings (common_daily_wage) VALUES (650.0)');
        }

        // 2. Employee Salary Configurations
        await run(`
          CREATE TABLE IF NOT EXISTS employee_salary_configs (
            id ${pkDef},
            user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
            salary_type VARCHAR(30) NOT NULL DEFAULT 'daily_wage',
            monthly_basic_salary REAL DEFAULT 0,
            daily_wage_override REAL,
            effective_date VARCHAR(20) NOT NULL,
            remarks TEXT,
            created_by INTEGER REFERENCES users(id),
            updated_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_sal_user ON employee_salary_configs(user_id)`);
        } catch (_) {}

        // 3. Daily Incentives
        await run(`
          CREATE TABLE IF NOT EXISTS daily_incentives (
            id ${pkDef},
            user_id INTEGER NOT NULL REFERENCES users(id),
            date VARCHAR(20) NOT NULL,
            amount REAL NOT NULL,
            description TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'approved',
            payroll_period VARCHAR(10),
            created_by INTEGER REFERENCES users(id),
            created_at ${tsDef},
            updated_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_incentives_user_dt ON daily_incentives(user_id, date)`);
          await run(`CREATE INDEX IF NOT EXISTS idx_incentives_period ON daily_incentives(payroll_period)`);
        } catch (_) {}

        // 4. Overtime Records
        await run(`
          CREATE TABLE IF NOT EXISTS overtime_records (
            id ${pkDef},
            user_id INTEGER NOT NULL REFERENCES users(id),
            date VARCHAR(20) NOT NULL,
            hours REAL DEFAULT 0,
            amount REAL DEFAULT 0,
            remarks TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'approved',
            payroll_period VARCHAR(10),
            created_by INTEGER REFERENCES users(id),
            approved_by INTEGER REFERENCES users(id),
            created_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_overtime_user_dt ON overtime_records(user_id, date)`);
          await run(`CREATE INDEX IF NOT EXISTS idx_overtime_period ON overtime_records(payroll_period)`);
        } catch (_) {}

        // 5. Payroll Periods
        await run(`
          CREATE TABLE IF NOT EXISTS payroll_periods (
            id ${pkDef},
            month VARCHAR(10) UNIQUE NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            finalized_by INTEGER REFERENCES users(id),
            finalized_at ${tsDef},
            notes TEXT,
            created_at ${tsDef}
          )
        `);

        // 6. Payroll Records
        await run(`
          CREATE TABLE IF NOT EXISTS payroll_records (
            id ${pkDef},
            payroll_period VARCHAR(10) NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id),
            salary_type VARCHAR(30) NOT NULL,
            base_rate REAL NOT NULL,
            total_working_days REAL DEFAULT 0,
            present_days REAL DEFAULT 0,
            paid_leave_days REAL DEFAULT 0,
            payable_days REAL DEFAULT 0,
            absent_days REAL DEFAULT 0,
            excess_absent_days REAL DEFAULT 0,
            basic_salary REAL NOT NULL,
            incentive_salary REAL DEFAULT 0,
            overtime_hours REAL DEFAULT 0,
            overtime_amount REAL DEFAULT 0,
            gross_salary REAL NOT NULL,
            employee_epf REAL DEFAULT 0,
            employee_esic REAL DEFAULT 0,
            total_employee_deductions REAL DEFAULT 0,
            gratuity_deduction REAL DEFAULT 0,
            net_salary REAL NOT NULL,
            employer_epf REAL DEFAULT 0,
            employer_esic REAL DEFAULT 0,
            ctc REAL NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            attendance_snapshot TEXT,
            notes TEXT,
            created_at ${tsDef},
            updated_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_period_user ON payroll_records(payroll_period, user_id)`);
        } catch (_) {}

        // 7. Activity Logs (System-wide Admin Activity Trail)
        await run(`
          CREATE TABLE IF NOT EXISTS activity_logs (
            id ${pkDef},
            user_id INTEGER REFERENCES users(id),
            user_name VARCHAR(255),
            role VARCHAR(50),
            action VARCHAR(100) NOT NULL,
            entity_type VARCHAR(50),
            entity_id VARCHAR(50),
            details TEXT,
            ip_address VARCHAR(50),
            created_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC)`);
          await run(`CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_logs(action)`);
        } catch (_) {}
      },
    },
    {
      version: 6,
      name: 'create_salary_enhancements_and_reset_leave_balances',
      up: async () => {
        // 1. Add daily_incentive_rate to employee_salary_configs
        try {
          await run(`ALTER TABLE employee_salary_configs ADD COLUMN daily_incentive_rate REAL DEFAULT 0`);
        } catch (_) {}

        // 2. Add target_user_id and target_user_name to activity_logs
        try {
          await run(`ALTER TABLE activity_logs ADD COLUMN target_user_id INTEGER`);
        } catch (_) {}
        try {
          await run(`ALTER TABLE activity_logs ADD COLUMN target_user_name VARCHAR(255)`);
        } catch (_) {}

        // 3. Reset leave balances & records for production launch starting November
        try {
          await run(`DELETE FROM leave_balances`);
          await run(`DELETE FROM leave_records`);
          await run(`DELETE FROM leave_accruals`);
          await run(`DELETE FROM attendance_absences`);
          await run(`DELETE FROM monthly_attendance_summaries`);

          // Ensure active leave year 2026-2027 (runs 1 April 2026 to 31 March 2027)
          await run(
            `INSERT OR IGNORE INTO leave_years (code, start_date, end_date, is_active)
             VALUES ('2026-2027', '2026-04-01', '2027-03-31', 1)`
          );

          // Initialize fresh 0 balance for all existing users
          const users = await query(`SELECT id FROM users`);
          for (const u of users) {
            await run(
              `INSERT INTO leave_balances (user_id, leave_year, accrued, used, expired, balance)
               VALUES (?, '2026-2027', 0, 0, 0, 0)`,
              [u.id]
            );
          }
        } catch (resetErr) {
          console.warn('Leave balance reset warning:', resetErr.message);
        }
      },
    },
    {
      version: 7,
      name: 'cleanup_pre_november_2026_leave_accruals',
      up: async () => {
        try {
          // Remove pre-November 2026 accruals for 2026-2027
          await run(`DELETE FROM leave_accruals WHERE leave_year = '2026-2027' AND month < '2026-11'`);
          // Reset leave_balances for 2026-2027 to 0
          await run(`UPDATE leave_balances SET accrued = 0, balance = 0 WHERE leave_year = '2026-2027'`);
        } catch (err) {
          console.warn('Migration v7 warning:', err.message);
        }
      },
    },
    {
      version: 8,
      name: 'create_salary_cycles_and_disbursements_system',
      up: async () => {
        const pkDef = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        const tsDef = isPostgres ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP';

        // 1. Add official_start_date and cycle_start_day to salary_settings
        try {
          await run(`ALTER TABLE salary_settings ADD COLUMN official_start_date VARCHAR(20) DEFAULT '2026-11-03'`);
        } catch (_) {}
        try {
          await run(`ALTER TABLE salary_settings ADD COLUMN cycle_start_day INTEGER DEFAULT 3`);
        } catch (_) {}

        // Ensure default record has official_start_date set to '2026-11-03' and cycle_start_day to 3
        try {
          await run(`UPDATE salary_settings SET official_start_date = '2026-11-03', cycle_start_day = 3 WHERE official_start_date IS NULL`);
        } catch (_) {}

        // 2. Salary Cycles Table
        await run(`
          CREATE TABLE IF NOT EXISTS salary_cycles (
            id ${pkDef},
            cycle_code VARCHAR(50) UNIQUE NOT NULL,
            start_date VARCHAR(20) NOT NULL,
            end_date VARCHAR(20) NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'active',
            total_gross REAL DEFAULT 0,
            total_deductions REAL DEFAULT 0,
            total_net REAL DEFAULT 0,
            total_disbursed REAL DEFAULT 0,
            remaining_payable REAL DEFAULT 0,
            employee_count INTEGER DEFAULT 0,
            finalized_by INTEGER REFERENCES users(id),
            finalized_at ${tsDef},
            closed_at ${tsDef},
            notes TEXT,
            created_at ${tsDef},
            updated_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_cycles_code ON salary_cycles(cycle_code)`);
        } catch (_) {}
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_salary_cycles_dates ON salary_cycles(start_date, end_date)`);
        } catch (_) {}
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_salary_cycles_status ON salary_cycles(status)`);
        } catch (_) {}

        // 3. Disbursement Batches Table
        await run(`
          CREATE TABLE IF NOT EXISTS salary_disbursement_batches (
            id ${pkDef},
            batch_reference VARCHAR(100) UNIQUE NOT NULL,
            cycle_id INTEGER NOT NULL REFERENCES salary_cycles(id),
            cycle_code VARCHAR(50) NOT NULL,
            disbursement_date VARCHAR(20) NOT NULL,
            total_amount REAL NOT NULL,
            employee_count INTEGER NOT NULL,
            disbursed_by INTEGER NOT NULL REFERENCES users(id),
            payment_method VARCHAR(50) DEFAULT 'bank_transfer',
            notes TEXT,
            created_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_disb_batch_ref ON salary_disbursement_batches(batch_reference)`);
        } catch (_) {}
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_disb_cycle ON salary_disbursement_batches(cycle_id)`);
        } catch (_) {}

        // 4. Individual Salary Payments Table
        await run(`
          CREATE TABLE IF NOT EXISTS salary_payments (
            id ${pkDef},
            payment_reference VARCHAR(100) UNIQUE NOT NULL,
            batch_id INTEGER REFERENCES salary_disbursement_batches(id),
            cycle_id INTEGER NOT NULL REFERENCES salary_cycles(id),
            cycle_code VARCHAR(50) NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id),
            amount_paid REAL NOT NULL,
            net_payable REAL NOT NULL,
            remaining_balance REAL NOT NULL,
            payment_date VARCHAR(20) NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'completed',
            recorded_by INTEGER NOT NULL REFERENCES users(id),
            notes TEXT,
            created_at ${tsDef}
          )
        `);
        try {
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_pay_ref ON salary_payments(payment_reference)`);
        } catch (_) {}
        try {
          await run(`CREATE INDEX IF NOT EXISTS idx_salary_pay_user ON salary_payments(user_id, cycle_id)`);
        } catch (_) {}

        // 5. Enhance payroll_records with cycle references and disbursement columns
        try { await run(`ALTER TABLE payroll_records ADD COLUMN cycle_id INTEGER`); } catch (_) {}
        try { await run(`ALTER TABLE payroll_records ADD COLUMN cycle_code VARCHAR(50)`); } catch (_) {}
        try { await run(`ALTER TABLE payroll_records ADD COLUMN amount_disbursed REAL DEFAULT 0`); } catch (_) {}
        try { await run(`ALTER TABLE payroll_records ADD COLUMN remaining_payable REAL DEFAULT 0`); } catch (_) {}
        try { await run(`ALTER TABLE payroll_records ADD COLUMN payment_status VARCHAR(30) DEFAULT 'draft'`); } catch (_) {}
        try { await run(`ALTER TABLE payroll_records ADD COLUMN payment_date VARCHAR(20)`); } catch (_) {}
        try { await run(`ALTER TABLE payroll_records ADD COLUMN disbursement_reference VARCHAR(100)`); } catch (_) {}

        // 6. Seed official first cycle starting 3 November 2026 (if not exists)
        try {
          const initialCycle = await get(`SELECT id FROM salary_cycles WHERE cycle_code = '2026-11-03_2026-12-02'`);
          if (!initialCycle) {
            if (isPostgres) {
              await run(
                `INSERT INTO salary_cycles (cycle_code, start_date, end_date, status)
                 VALUES ('2026-11-03_2026-12-02', '2026-11-03', '2026-12-02', 'active')
                 ON CONFLICT (cycle_code) DO NOTHING`
              );
            } else {
              await run(
                `INSERT OR IGNORE INTO salary_cycles (cycle_code, start_date, end_date, status)
                 VALUES ('2026-11-03_2026-12-02', '2026-11-03', '2026-12-02', 'active')`
              );
            }
          }
        } catch (seedErr) {
          console.warn('Initial salary cycle seed warning:', seedErr.message);
        }
      },
    },
  ];

  for (const m of migrations) {
    const applied = await get('SELECT version FROM schema_migrations WHERE version = ?', [m.version]);
    if (!applied) {
      await m.up();
      try {
        if (isPostgres) {
          await run('INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [m.version, m.name]);
        } else {
          await run('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
        }
        console.log(` Migration v${m.version} applied: ${m.name}`);
      } catch (insertErr) {
        if (!insertErr.message?.includes('UNIQUE') && !insertErr.message?.includes('duplicate key')) {
          throw insertErr;
        }
      }
    }
  }

  // Seed Admin on first run with random password if no admin exists
  const existingAdmin = await get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (!existingAdmin) {
    const crypto = require('crypto');
    const randomPassword = process.env.ADMIN_INITIAL_PASSWORD || crypto.randomBytes(8).toString('hex');
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(randomPassword, salt);
    try {
      await run(
        `INSERT INTO users (email, username, password_hash, full_name, role, department, is_active, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          config.ADMIN_DEFAULT_EMAIL,
          'admin',
          hash,
          config.ADMIN_DEFAULT_NAME,
          'admin',
          'Management',
          1,
          1,
        ]
      );
      console.log(`=======================================================`);
      console.log(`🔐 FIRST-RUN ADMIN CREATED:`);
      console.log(`   Email:    ${config.ADMIN_DEFAULT_EMAIL}`);
      console.log(`   Password: ${randomPassword}`);
      console.log(`   (Password change required on first login)`);
      console.log(`=======================================================`);
    } catch (adminErr) {
      if (!adminErr.message?.includes('UNIQUE') && !adminErr.message?.includes('duplicate key')) {
        throw adminErr;
      }
    }
  }
  })();

  return initDbPromise.catch((err) => {
    initDbPromise = null;
    throw err;
  });
}

module.exports = {
  db,
  query,
  get,
  run,
  withTransaction,
  initDatabase,
};
