# cisco-finance

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Router, Express, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **Express** - Fast, unopinionated web framework
- **tRPC** - End-to-end type-safe APIs
- **Bun** - Runtime environment
- **Prisma** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Biome** - Linting and formatting
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Prisma.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Apply the schema to your database:

```bash
bun run db:push
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Use the Expo Go app to run the mobile application.
The API is running at [http://localhost:3000](http://localhost:3000).

## Git Hooks and Formatting

- Format and lint fix: `bun run check`

## Project Structure

```
cisco-finance/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   ├── native/      # Mobile application (React Native, Expo)
│   └── server/      # Backend API (Express, TRPC)
├── packages/
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Role-Based Access

Who can edit vs view on each page (Dashboard, Submitted Receipts, Budgets) is controlled by user roles.

Authorized users are assigned one of these roles (managed on the **Team** page by VP Finance):

| Role | Description |
|------|-------------|
| **VP_FINANCE** | Vice President for Finance |
| **AUDITOR** | Auditor |
| **TREASURER** | Treasurer |
| **WAYS_AND_MEANS** | Ways and Means Officer |

Users who are not in the authorized list have no access to the app. Authorized users without a role, or with a role not listed above, are treated as **regular users** (view-only where restrictions apply).

### Dashboard / Cashflow

**Who can perform actions:** VP Finance, Auditor only.

**Who can only view:** Treasurer, Ways and Means, regular users.

| Action | VP Finance | Auditor | Treasurer | Ways and Means | Regular |
|--------|------------|---------|-----------|----------------|---------|
| View dashboard, stats, cashflow table | ✅ | ✅ | ✅ | ✅ | ✅ |
| Verify transaction (link account entry → cashflow) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Attach receipt to cashflow entry | ✅ | ✅ | ❌ | ❌ | ❌ |
| Unbind receipt from cashflow entry | ✅ | ✅ | ❌ | ❌ | ❌ |

- **API:** `cashflowEntries.create`, `cashflowEntries.archive` require **cashflowEditorProcedure** (VP_FINANCE or AUDITOR).
- **UI:** "Verify Transaction", "Attach", "Attach More", "Unbind This Receipt" are hidden for view-only users.

### Submitted Receipts

**Who can perform actions:** VP Finance, Auditor, Treasurer.

**Who can only view:** Ways and Means, regular users.

| Action | VP Finance | Auditor | Treasurer | Ways and Means | Regular |
|--------|------------|---------|-----------|----------------|---------|
| View receipts list and details | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bind receipt to transaction | ✅ | ✅ | ✅ | ❌ | ❌ |
| Unbind receipt | ✅ | ✅ | ✅ | ❌ | ❌ |
| Endorse for reimbursement | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mark as reimbursed | ❌ | ❌ | ✅ | ❌ | ❌ |

- **API:** `receiptSubmission.bind`, `unbind`, `submitAndBind`, `endorse`, `markAsReimbursed` require **receiptEditorProcedure** (VP_FINANCE, AUDITOR, or TREASURER). Endorse is further restricted to Auditor or VP Finance; Mark as reimbursed is Treasurer only.
- **UI:** Bind/Unbind, Endorse, and Mark as Reimbursed are hidden for view-only users.

### Budgets

**Who can perform actions:** VP Finance, Treasurer, Auditor, Ways and Means.

**Who can only view:** Regular users (authorized but no role or other role).

| Action | VP Finance | Auditor | Treasurer | Ways and Means | Regular |
|--------|------------|---------|-----------|----------------|---------|
| View budgets, projects, items | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create / edit / archive projects | ✅ | ✅ | ✅ | ✅ | ❌ |
| Add / edit / delete budget items | ✅ | ✅ | ✅ | ✅ | ❌ |
| Link / unlink expenses to budget items | ✅ | ✅ | ✅ | ✅ | ❌ |

- **API:** `budgetProjects.create`, `update`, `archive` and `budgetItems.create`, `update`, `delete`, `linkExpense`, `unlinkExpense` require **budgetEditorProcedure** (VP_FINANCE, TREASURER, AUDITOR, or WAYS_AND_MEANS).
- **UI:** "New Project", "Add Item", "Edit", "Archive", "Link", "Unlink", "Delete" are hidden for view-only users.

### Team Page

- **List authorized users:** Any authenticated, authorized user.
- **Add/remove users and assign roles:** VP Finance only.

### Implementation Notes

- Procedures are defined in `packages/api/src/index.ts`: `budgetEditorProcedure`, `receiptEditorProcedure`, `cashflowEditorProcedure`.
- Routers in `packages/api/src/routers/index.ts` use these procedures for mutations; read operations use `protectedProcedure` so any logged-in authorized user can view where applicable.
- Frontend pages (`apps/web/src/routes/*.tsx`) use `trpc.team.getMyRole` and derive flags like `canEditBudgets`, `canEditReceipts`, `canEditDashboard` to show or hide actions.

## Production (PM2 on DCISM)

This project is set up for production on the DCISM server using PM2.

- **Domain:** https://finance.dcism.org
- **Port:** 20172 (behind your reverse proxy / load balancer)

The ecosystem file preconfigures **BETTER_AUTH_URL** and **CORS_ORIGIN** to `https://finance.dcism.org` when you start with `--env production`.

### 1. Preparing Your Application for Production

Build the optimized, compiled version of the app:

```bash
bun run build
```

(or `npm run build` if using npm)

### 2. Starting Your Application with PM2

**Using the ecosystem file (recommended)**

From the **repo root** (`cisco-finance/`):

```bash
pm2 start ecosystem.config.cjs --env production
```

This uses the config in `ecosystem.config.cjs`, which sets:

- **App name:** `cisco-finance-server`
- **Port:** 20172 (via `PORT` in `env_production`)
- **Domain:** BETTER_AUTH_URL and CORS_ORIGIN set to `https://finance.dcism.org`
- **Script:** `bun run dist/index.mjs` from `apps/server`

**Alternative: basic start with port**

```bash
pm2 start bun --name "cisco-finance-server" -- run dist/index.mjs -- -p 20172
```

Run this from `apps/server` (or set `cwd` accordingly). The server reads `PORT` from the environment, so the ecosystem file is the preferred way.

### 3. Ecosystem file (optional details)

`ecosystem.config.cjs` provides:

- **Environment variables:** `env` (default) and `env_production` (production, port 20172)
- **Watch & restart:** `watch: false` in production; set `watch: true` for dev if needed
- **Autorestart:** enabled so the app restarts if it crashes

### 4. Managing and Monitoring PM2

| Action            | Command                                      |
|------------------|-----------------------------------------------|
| View status      | `pm2 list`                                   |
| Stream logs      | `pm2 logs cisco-finance-server`              |
| Stop             | `pm2 stop cisco-finance-server`              |
| Start (all)      | `pm2 start all`                              |
| Restart          | `pm2 restart cisco-finance-server --env production` |
| Delete from PM2  | `pm2 delete cisco-finance-server`            |

### 5. Persistence on System Startup

After starting your app and confirming it runs correctly:

```bash
pm2 save
```

This saves the current process list so PM2 can restore it after a reboot (e.g. server update or power outage).

**Web build:** The frontend needs `VITE_SERVER_URL` at build time (for tRPC, auth, WebSocket). In `apps/web/.env` set `VITE_SERVER_URL=https://finance.dcism.org` when building for production, or pass it when running the build (e.g. `VITE_SERVER_URL=https://finance.dcism.org bun run build`).

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run dev:native`: Start the React Native/Expo development server
- `bun run db:push`: Push schema changes to database
- `bun run db:studio`: Open database studio UI
- `bun run check`: Run Biome formatting and linting
- `bun run start:prod`: Start server with PM2 (production, port 20172)
- `bun run restart:prod`: Restart PM2 app with production env
- `bun run pm2:save`: Save PM2 process list for startup persistence
