module.exports = {
  apps: [
    {
      name: 'bharat-mock-backend',
      cwd: '/root/Bharat-Mock-Backend',
      script: 'src/server.js',
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY || '512M',
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 1000,
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        ALLOWED_FILE_TYPES: 'image/jpeg,image/png,image/webp,image/gif,application/pdf,video/mp4,video/webm,video/quicktime',
        RATE_LIMIT_MAX_REQUESTS: '2000',
        AUTH_RATE_LIMIT: '30',
        UPLOAD_RATE_LIMIT: '60'
      },
      error_file: '/var/log/pm2/bharat-mock-backend-error.log',
      out_file: '/var/log/pm2/bharat-mock-backend-out.log',
      combine_logs: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
