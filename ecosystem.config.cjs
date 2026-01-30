/**
 * PM2 ecosystem file (production on DCISM, port 20172).
 * Standard name in guides is ecosystem.config.js; we use .cjs for CommonJS compatibility with "type": "module".
 *
 * @see PM2 guide: "Using PM2 for Production Node.js Applications"
 */
/** @type {import('pm2').StartOptions} */
module.exports = {
  apps: [
    {
      name: "cisco-finance-server",
      cwd: "./apps/server",
      script: "bun",
      args: "run dist/index.mjs",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 20172,
        BETTER_AUTH_URL: "https://finance.dcism.org",
        CORS_ORIGIN: "https://finance.dcism.org",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
    },
  ],
};
