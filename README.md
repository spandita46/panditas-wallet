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

`pnpm dev` runs the two dev servers. For **family access on the home network**, use the
single-port server below instead.

## Run on your home network (family access)

The API can also serve the built web app on a single port, so anyone on your Wi-Fi can use it.
No renaming the Mac needed — family connects via its **LAN IP address** (reliable on both
iOS and Android, unlike `.local` names, which Android doesn't resolve well).

**One-time setup:** make sure Docker Desktop is installed and `.env` is configured.

**Each time you want the family to use it**
- Double-click `scripts/start-panditas.command`. It starts Postgres, builds the web app,
  and serves everything on port 80, then prints the address to open — something like
  `http://192.168.1.186`. Enter your Mac password when asked, click **Allow** on the
  firewall prompt, and leave the window open.

**How family connects** (same Wi-Fi):
1. Open the IP address the script printed, in any browser (iPhone, iPad, or Android).
2. Use the browser's **"Add to Home Screen"** (Safari: Share → Add to Home Screen;
   Chrome: ⋮ menu → Add to Home Screen) — gives a tap-to-open icon, no retyping.

Your router assigns that IP via DHCP, so it can change if the Mac reconnects to Wi-Fi.
If the family's shortcut ever stops working, re-run the script and check the new IP —
or set a **DHCP reservation** for this Mac in your router's admin page (look for
"DHCP reservation" / "static lease" — pins the IP to this Mac's Wi-Fi MAC address
permanently, most home routers support it).

Prefer no password prompt? Run `SERVE_WEB=true API_PORT=4000 pnpm --filter @panditas/api serve`
and connect to `http://<ip>:4000` instead (unprivileged port, IP won't change).

> Same architecture (single container serving web + API) moves straight to your NAS later.

## Build roadmap

- **Phase 0 — Foundation** *(in progress)*: monorepo, Docker Postgres, Prisma schema, auth, app shell.
- **Phase 1 — Net-worth + liabilities dashboard**: SimpleFIN sync, accounts/transactions, connection health, manual accounts, dashboard.
- **Phase 2 — Categories & budgeting**: categories, card→category rules, monthly limits vs actuals.
- **Phase 3 — Investments & contributions**: contribution modeling, growth vs contributed.
- **Phase 4 — Kids' piggy bank**: kid login, friendly view, savings goals.
- **Phase 5 — Mobile + polish**: responsive → PWA / React Native, backups.
