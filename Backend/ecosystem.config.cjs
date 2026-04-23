module.exports = {
  apps: [{
    name:           'Backend',
    script:         'server.js',
    instances:      'max',       // One worker per CPU core
    exec_mode:      'cluster',
    watch:          false,
    max_memory_restart: '1G',    // Restart if memory exceeds 1GB

    env: {
      NODE_ENV: 'development',
      PORT:     5000,
    },

    env_production: {
      NODE_ENV: 'production',
      PORT:     5000,
    },

    // Logging
    log_date_format:  'YYYY-MM-DD HH:mm:ss',
    error_file:       'logs/pm2-error.log',
    out_file:         'logs/pm2-out.log',
    merge_logs:       true,

    // Graceful shutdown
    kill_timeout:     5000,     // 5s to finish in-flight requests
    wait_ready:       true,
    listen_timeout:   10000,

    // Auto-restart settings
    autorestart:      true,
    restart_delay:    4000,
    max_restarts:     10,
    min_uptime:       '10s',

    // Node.js flags
    node_args: [
      '--max-old-space-size=1024',  // Limit heap to 1GB
    ],
  }],
};