const packageJson = require('./package.json');
const appName = process.env.BOT_NAME || packageJson.name || 'qualification-bot';

module.exports = {
  apps: [
    {
      name: appName,
      script: 'index.js',
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
