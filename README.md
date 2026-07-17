# Panditas Wallet

A self-hosted, family-tailored personal finance app — an "Actual Budget lite" tuned for one household. **LAN-only** (never exposed to the internet). Web app first; mobile dashboard views come later.

## Stack

- **Monorepo:** pnpm workspaces — `packages/shared`, `packages/api`, `packages/web`
- **Frontend:** React + Vite + TypeScript, Tailwind, TanStack Query, Recharts
- **Backend:** Node.js + Fastify + zod, REST API
- **Database:** PostgreSQL + Prisma (in Docker)
- **Auth:** cookie sessions, argon2, roles `admin | adult | kid`
- **Security:** AES-256-GCM field encryption for SimpleFIN tokens; login-gated
- **Data source:** [SimpleFIN Bridge](https://beta-bridge.simplefin.org/) + manual accounts

## Roles

| Role | Who | Access |
|------|-----|--------|
| `admin` | Account owner | Everything + user management (create users, assign roles, associate accounts) |
| `adult` | The two adults | Shared access to all family finances |
| `kid` | Children | Isolated friendly view of only their own piggy bank |

## Getting started

```bash
# 1. Prereqs: Node 20+, pnpm 9+, Docker
corepack enable

# 2. Install deps
pnpm install

# 3. Configure env
cp .env.example .env
# then edit .env — generate secrets with: openssl rand -hex 32

# 4. Start Postgres
pnpm db:up

# 5. Create the schema
pnpm prisma:migrate

# 6. (optional) Seed the admin user + your accounts
pnpm db:seed

# 7. Run web + api
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:4000

## Build roadmap

- **Phase 0 — Foundation** *(in progress)*: monorepo, Docker Postgres, Prisma schema, auth, app shell.
- **Phase 1 — Net-worth + liabilities dashboard**: SimpleFIN sync, accounts/transactions, connection health, manual accounts, dashboard.
- **Phase 2 — Categories & budgeting**: categories, card→category rules, monthly limits vs actuals.
- **Phase 3 — Investments & contributions**: contribution modeling, growth vs contributed.
- **Phase 4 — Kids' piggy bank**: kid login, friendly view, savings goals.
- **Phase 5 — Mobile + polish**: responsive → PWA / React Native, backups.
