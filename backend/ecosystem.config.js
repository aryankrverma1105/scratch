module.exports = {
  apps: [
    {
      name: 'attendance-backend',
      script: './server.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5050,
      },
    },
  ],
};
