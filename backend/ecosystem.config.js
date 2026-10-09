const isPostgres = process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres');

module.exports = {
  apps: [
    {
      name: 'sologix-attendance',
      script: './server.js',
      // Run single instance for SQLite to prevent file lock race conditions; cluster mode only with Postgres
      instances: isPostgres ? 'max' : 1,
      exec_mode: isPostgres ? 'cluster' : 'fork',
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/pm2-err.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
        PORT: 5050,
        HOST: '127.0.0.1',
      },
    },
  ],
};
