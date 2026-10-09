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

async function initDatabase() {
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
  ];

  for (const m of migrations) {
    const applied = await get('SELECT version FROM schema_migrations WHERE version = ?', [m.version]);
    if (!applied) {
      await m.up();
      await run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
      console.log(` Migration v${m.version} applied: ${m.name}`);
    }
  }

  // Seed Admin on first run with random password if no admin exists
  const existingAdmin = await get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (!existingAdmin) {
    const crypto = require('crypto');
    const randomPassword = process.env.ADMIN_INITIAL_PASSWORD || crypto.randomBytes(8).toString('hex');
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(randomPassword, salt);
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
  }
}

module.exports = {
  db,
  query,
  get,
  run,
  initDatabase,
};
