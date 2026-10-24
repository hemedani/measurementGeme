/**
 * PM2 process file.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *
 * Scale to every CPU core with:  WEB_INSTANCES=max pm2 start ecosystem.config.js
 * The server keeps only an in-memory compression cache, so cluster mode is safe.
 */

const instances = process.env.WEB_INSTANCES === 'max' ? 'max' : Number(process.env.WEB_INSTANCES) || 1;

module.exports = {
  apps: [
    {
      name: 'sareh-games',
      script: 'server.js',
      cwd: __dirname,

      exec_mode: instances === 1 ? 'fork' : 'cluster',
      instances,

      env: {
        NODE_ENV: 'production',
        PORT: 8080,
        HOST: '0.0.0.0'
      },

      // Restart policy
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      max_restarts: 10,
      restart_delay: 2000,
      // Must stay above the server's own 5s graceful-shutdown window.
      kill_timeout: 6000,
      listen_timeout: 10000,

      // Logging
      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log'
    }
  ]
};
