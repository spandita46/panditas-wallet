# Ideas

My running backlog of ideas for Panditas Wallet, refined into scoped specs as I work through
them. I keep this updated as I go. It's my source of truth for what I've actually built versus
what's still just an idea in my head.

Statuses I use: `Done`, `In progress`, `Planned (not started)`, `Idea (not scoped)`, `Needs input`.

---

### 1. Periodic family finance summary email

**Status:** Done, disabled by default until I turn it on

**Idea:** send myself a periodic email summarizing household finances: assets/liabilities and
their change, income, expenses, per-owner breakdown, grocery spend.

**Decision:** one cron job parameterized by period (week/quarter/half/year), not four separate
features. Runs daily; a given day can close more than one period (e.g. Dec 31 closes all four),
each gets its own email. Recipients: all active admin/adult users with an email set. Disabled by
default (`SUMMARY_CRON` unset). I need to set it in `.env` to turn it on.

---

### 2. Credit card bill due dates

**Status:** Done

**Idea:** track statement/due dates for my credit cards so I stop missing bills.

**Decision:** nullable `statementDay`/`dueDay` (1 to 31) on `Account`, editable in Settings, with
a computed "Next due" badge. I deliberately scoped this to date tracking only: no reminders, no
calendar. Those became separate items below.

---

### 3. Dashboard bill visibility + payment tracking

**Status:** Done

**Idea:** surface upcoming bill due dates somewhere prominent, without missing multiple bills
landing in the same week.

**Decision:** a compact "Bills due in the next 14 days" card on the Dashboard, not a full
calendar: a horizontal row of small per-card tiles, each linking to that account's transactions,
showing a naive 3-statement-cycle spend estimate.

**Extension, payment tracking:** each card also shows whether I've paid it, since SimpleFIN
already surfaces a payment as a transaction linked back to the source account, so no new sync
logic was needed. A payment posted before the next statement generates still ties to the *last*
closed statement, which matches how I actually pay things: sometimes early, sometimes just to pay
down mid-cycle. Manual "Mark as paid" entries are self-reported full/partial (I can't know the
real statement total from data alone) and get flagged for review, not silently merged, if a later
sync turns out to have picked up the same payment for real.

---

### 4. Weekly bill reminders in the summary email

**Status:** Done

**Decision:** folded into the weekly (not quarter/half/year) summary email as a "Bills due in the
next 7 days" section, using the same due-date/estimate logic as the Dashboard card, kept in one
shared place so the two can't drift apart on me.

---

### 5. Reported vs. Estimated balance

**Status:** Done

**Idea:** my institutions differ on whether a pending transaction is already reflected in the
reported balance. I want both shown so it's never ambiguous.

**Decision:** compute `pendingTotal`/`estimatedBalance` from existing pending-transaction data;
show "Reported $X · Estimated $Y" only when an account actually has pending activity, flagged as
an estimate rather than authoritative.

---

### 6. Manual account creation

**Status:** Done

**Idea:** support accounts SimpleFIN doesn't cover (cash, accounts at institutions it doesn't
support).

**Decision:** the backend endpoint already existed but had no UI, so I added a simple inline form
in Settings (name, type, currency, starting balance, owner).

---

### 7. Manual transactions

**Status:** Done

**7.1 Single-entry:** add one transaction on any account (synced or manual), for cash spend, a
reporting gap, or backfilling before I had SimpleFIN connected.

**7.2 Bulk import:** backfill history beyond SimpleFIN's 90-day window.

**Decision, 7.2:** my original idea, a blank template to fill in, turned out to be a bad one: it
would've meant hand-retyping bank exports to match my own columns, which defeats the point of
"bulk." Final design: upload the bank's own CSV export unmodified, with a fixable column-mapping
step (date format, signed amount vs. separate debit/credit) and a duplicate-flagged preview
before committing. CSV only, not Excel. I can just "Save As CSV" from any spreadsheet app.

---

### 8. Configurable household/app name

**Status:** Done

**Decision:** the display name ("Panditas Wallet" today) reads from `VITE_APP_NAME` (web) /
`APP_NAME` (api, email subjects), defaulting to the current name so nothing changes unless I set
it.

---

### 9. Unified in-app notification system

**Status:** Done

**Why:** I once merged an account in the wrong direction and it left a tracked balance silently
frozen. That's when I realized the Dashboard's alert banners (stale connection, new
account/institution, orphaned account, net-worth swing) had no way to dismiss or manage. They
just recomputed fresh on every page load with no memory.

**Decision:** one `Notification` model for all five alert types, not four separate mechanisms.
Two lifecycles: live conditions (stale connection, orphaned account, net-worth swing) get
re-checked at the end of every sync, upserted while true and deleted the moment they're not, so a
resolved issue just disappears but a dismissed-and-still-true one won't resurface until I dismiss
it again. One-time events (new account/institution discovered) fire exactly once at creation and
never regenerate, even after I clear them. On the UI side, the Dashboard keeps its banner strip
with a per-item dismiss, which moves the item into a new bell-icon drawer in the nav (full
history, "Clear all"). I left the Settings page's separate per-row "New" pill as-is. It's a list
badge, not an alert, so there was no need to fold it in.

---

## Backlog, not yet built

Picking these up next, after I've run the app in real-world use for a while.

### 10. PWA apps for Android/iOS

**Status:** Planned (not started), direction decided, lowest priority in this backlog

I keep coming back to this one, so here's where I've landed. It's going to be a PWA, not a
native app: reusing my existing React web app entirely means no new codebase and no new
language, and it's the fastest path to opening this from my phone's home screen. I'm accepting
the trade-off of no iOS push notifications and no native home-screen widgets for now. If I ever
need those, React Native is the next-best option, since it shares TypeScript types via
`@panditas/shared`, so it stays on the table.

For phase 1 that means a web app manifest and service worker so it's installable and works
offline for data I've already fetched, a responsive audit of Dashboard and Settings for phone
widths, and read-only first (Dashboard, balances, recent transactions) before I touch anything
that needs touch-friendly editing. Distribution is just "Add to Home Screen" in the browser. No
app-store account, no review process, since it's only my family using it anyway.

---

### 11. NAS migration

**Status:** Planned (not started), deployment groundwork already in place

I've also circled back to this one a lot. What's already true: the API can serve the built web
app itself from one port (`SERVE_WEB` env var, see `packages/api/src/app.ts`). I set that up
specifically so a single-port deploy would work on a NAS without needing a separate web server or
reverse proxy. What's still open is picking my actual NAS target and container runtime, a data
volume/backup strategy for the Postgres database, and how I provision secrets
(`SESSION_SECRET`, `ENCRYPTION_KEY`, SimpleFIN credentials) on that box instead of my current
dev-machine `.env`.

---

### 12. First-run configurability / setup experience

**Status:** Idea (not scoped)

The app name is configurable via env var (item 8), but that's only one piece of "what if someone
else runs this for the first time." I still haven't worked out how a new user would actually get
from a fresh checkout to a working household instance: claiming a SimpleFIN setup token, knowing
what else needs configuring (`.env` values, the initial admin user, starting categories/rules).
This needs a real first-run/setup pass, maybe a setup wizard, or at minimum a proper README,
before this is usable by anyone other than me.

---

### 13. Dark vs. light theme

**Status:** Idea (not scoped)

Haven't decided anything yet: manual toggle, follow OS preference, or both.

---

### 14. Performance evaluation

**Status:** Idea (not scoped)

Haven't decided what to measure yet, page load, query latency, sync duration, or what target
makes sense given how small my household's data actually is.

---

### 15. Accessibility audit

**Status:** Idea (not scoped)

Haven't decided anything here either: whether to target a specific WCAG level, and which
surfaces matter most to me (the kids on the piggy-bank views, screen reader support generally).

---

### 16. Upstream data source alternative to SimpleFIN

**Status:** Idea (not scoped), real pain point, no decision yet

**The problem:** my SimpleFIN connections drop constantly. I've had to re-authenticate multiple
institutions on consecutive days, even ones I'd just reconnected the day before. This is a real
reliability risk for the whole project, not a one-off annoyance.

**Ruled out:** daily/weekly manual entry as my regular workflow. That's not something I'm willing
to do long-term as a substitute for automated sync.

**To evaluate next:** alternative account-aggregation providers, Plaid, GoCardless (Nordigen),
Lunch Money's own aggregation, maybe others. I'd want to compare them on reliability, Canadian
institution coverage (a hard requirement given my banks), pricing at my household's scale, and
how much work migrating off SimpleFIN's data model would actually be. I haven't researched any of
this yet. It needs its own dedicated pass.

**Research so far (2026-07-23):** SimpleFIN's flakiness isn't just me. It's a documented,
ecosystem-wide problem: Actual Budget, another self-hosted finance app, has open GitHub issues
for the same invalid-token errors and connections stuck "upgrading" for weeks. Their Bridge isn't
open-source either, so self-hosting my way out isn't an option.

Plaid is ruled out. Confirmed by an open GitHub issue on another self-hosted finance project:
Plaid Link hardcodes region=us and fails at final verification for Canadian Wealthsimple accounts.
Flinks and Salt Edge are both B2B, sales-gated, with monthly minimums and annual contracts, not
viable for a household project.

Wealthica looks like the strongest option: Canada's investment-account specialist, 150+
institutions including Sun Life, Wealthsimple, and Questrade. Real pricing turned out cheaper than
I'd assumed: Free (3 institutions), Connect $50/yr, Unlimited Connect $75/yr (unlimited accounts,
family member groups, manual asset tracking, reports), Premium $150/yr, Prestige $250/yr.
Unlimited Connect at $75/yr is the tier that actually matters for me, not the ~$100 I'd been
assuming. One real unknown before spending anything: it's not clear from their public pages
whether that $75/yr personal tier includes actual API/token access I could pull into my own app,
or whether that requires a separate business API agreement. Needs a direct question to their
support before I commit to anything.

**One option under consideration: don't switch, split the accounts instead.** Rather than
replacing SimpleFIN outright, keep credit cards and WealthSimple Cash (high transaction volume,
manual entry there is genuinely unacceptable) on SimpleFIN as-is, and treat the investment and
brokerage accounts (Sun Life, Wealthsimple FHSA/TFSA/RESP/Crypto, Questrade) differently, since
they're low-volume and it's specifically those accounts where SimpleFIN has caused real data bugs
so far (the Sun Life misrouting mess, and a new one below). Either a monthly manual balance
sanity-check against each institution's real portal for that subset, or eventually a Wealthica
connection just for those accounts, since that's exactly their specialty. Nothing decided, just
the shape of a plan.

**New evidence this needs solving, not just patching (2026-07-23):** found and fixed a real bug
that's a symptom of exactly this reliability problem. Questrade's SimpleFIN connector was
replaying a frozen balance from 2025-06-22 on most syncs (87 identical snapshot rows on file), and
one such replay silently reverted a genuine $1,300 deposit, understating my net worth without any
transaction to explain it. Added a `balanceAsOf` field on `Account` and a guard in `sync.ts` so a
sync can never regress a balance backward in time again, but it's another data point for how much
SimpleFIN's flakiness actually costs beyond just having to click reconnect.
