module.exports = {
  apps: [
    {
      name: 'bharat-mock-backend',
      cwd: '/root/Bharat-Mock-Backend',
      script: 'npm',
      args: 'run start',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production'
      },
      max_restarts: 5,
      restart_delay: 4000,
      error_file: '/var/log/pm2/bharat-mock-backend-error.log',
      out_file: '/var/log/pm2/bharat-mock-backend-out.log',
      combine_logs: true
    }
  ]
};
