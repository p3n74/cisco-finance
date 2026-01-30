# Using PM2 for Production (DCISM)

This project is set up for production on the DCISM server using PM2.

- **Domain:** https://finance.dcism.org  
- **Port:** 20172 (behind your reverse proxy / load balancer)

The ecosystem file preconfigures **BETTER_AUTH_URL** and **CORS_ORIGIN** to `https://finance.dcism.org` when you start with `--env production`.

## 1. Preparing Your Application for Production

Build the optimized, compiled version of the app:

```bash
bun run build
```

(or `npm run build` if using npm)

## 2. Starting Your Application with PM2

### Using the ecosystem file (recommended)

From the **repo root** (`cisco-finance/`):

```bash
pm2 start ecosystem.config.cjs --env production
```

This uses the config in `ecosystem.config.cjs`, which sets:

- **App name:** `cisco-finance-server`
- **Port:** 20172 (via `PORT` in `env_production`)
- **Domain:** BETTER_AUTH_URL and CORS_ORIGIN set to `https://finance.dcism.org`
- **Script:** `bun run dist/index.mjs` from `apps/server`

### Alternative: basic start with port

```bash
pm2 start bun --name "cisco-finance-server" -- run dist/index.mjs -- -p 20172
```

Run this from `apps/server` (or set `cwd` accordingly). Our server reads `PORT` from the environment, so the ecosystem file is the preferred way.

## 3. Ecosystem file (optional details)

`ecosystem.config.cjs` provides:

- **Environment variables:** `env` (default) and `env_production` (production, port 20172)
- **Watch & restart:** `watch: false` in production; set `watch: true` for dev if needed
- **Autorestart:** enabled so the app restarts if it crashes

## 4. Managing and Monitoring PM2

| Action            | Command                                      |
|------------------|-----------------------------------------------|
| View status      | `pm2 list`                                   |
| Stream logs      | `pm2 logs cisco-finance-server`              |
| Stop             | `pm2 stop cisco-finance-server`              |
| Start (all)      | `pm2 start all`                              |
| Restart          | `pm2 restart cisco-finance-server --env production` |
| Delete from PM2  | `pm2 delete cisco-finance-server`            |

## 5. Persistence on System Startup

After starting your app and confirming it runs correctly:

```bash
pm2 save
```

This saves the current process list so PM2 can restore it after a reboot (e.g. server update or power outage).

---

**Web build:** The frontend needs `VITE_SERVER_URL` at build time (for tRPC, auth, WebSocket). You can use your existing `.env`: in `apps/web/.env` set `VITE_SERVER_URL=https://finance.dcism.org` when building for production, or pass it when running the build (e.g. `VITE_SERVER_URL=https://finance.dcism.org bun run build`). No extra env file is required.
