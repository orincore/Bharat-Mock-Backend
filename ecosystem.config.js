module.exports = {
  apps: [
    {
      name: 'bharat-mock-backend',
      cwd: '/root/Bharat-Mock-Backend',
      script: 'src/server.js',
      node_args: '--max-old-space-size=3072',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
        API_VERSION: 'v1'
      },
      autorestart: true,
      watch: false,
      max_restarts: 15,
      min_uptime: '10s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '1500M',
      kill_timeout: 10000,
      listen_timeout: 10000,
      error_file: '/var/log/pm2/bharat-mock-backend-error.log',
      out_file: '/var/log/pm2/bharat-mock-backend-out.log',
      combine_logs: true,
      merge_logs: true,
      time: true
    }
  ]
};
