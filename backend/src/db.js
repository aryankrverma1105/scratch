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
