# Ideas

Backlog of exploratory ideas, refined into scoped specs. Status is updated as work happens —
this file is the source of truth for what's actually done vs. still just an idea.

Statuses used: `Done`, `In progress`, `Planned (not started)`, `Needs your input`.

---

### 1 & 2. Periodic family finance summary email (weekly / quarterly / bi-annual / annual)

**Status:** Done — disabled by default, needs your review before you turn it on

**What shipped:** one cron job (`SUMMARY_CRON`, unset/disabled by default), one email template, parameterized by period — not four separate features, per your call. Runs once a day; each run checks which period(s) closed *yesterday* (`periodsEndingOn()` in `packages/api/src/periodicSummary.ts`) and sends one email per closed period (week closes every Sunday; quarter/half/year close on the last day of Mar/Jun/Sep/Dec as applicable — a single day like Dec 31 can close more than one, each gets its own email).

Content per email:
1. Current assets & liabilities (from `NetWorthCheckpoint`), plus the $ change vs. the checkpoint right before the period started. When there's no comparison data that far back, the email says so explicitly (`"(no last quarter data yet)"` etc.) instead of silently dropping the delta.
2. Total income for the period.
3. Total expenses for the period.
4. Per-owner expense breakdown ($ and %), attributed by `Account.ownerUserId` — unowned/shared accounts bucket under "Shared".
5. Grocery spend for the period (matched against the `Groceries` category).

Recipients: all active `admin`+`adult` users with an email set (not the single `NOTIFY_EMAIL_TO` fallback the SimpleFIN alerts use).

**Delta history fix (2026-07-22, after your report the sample emails had no deltas):** the checkpoint feature only started writing rows the day it shipped, so there was nothing to compare against yet. Backfilled `NetWorthCheckpoint` from your existing `BalanceSnapshot` history (Jul 17–21) — but only for days where at least ~90% of currently-tracked accounts had snapshot coverage; a stray 2025-06-22 snapshot covering just 1 of 24 accounts was deliberately excluded (and the one bad checkpoint it produced was deleted) since using it would've shown a fake "+1660% year-over-year" swing that was really just missing data, not real growth. Weekly deltas now show real numbers (verified: `-$725.01` assets, `-$977.41` liabilities vs. last week, from your actual data). Quarter/half/year still can't show a real delta — there's genuinely no data before Jul 17, 2026 for any currently-tracked account (that's when this household's accounts were all created) — and now say so explicitly rather than looking broken. They'll start populating for real as checkpoints keep accumulating (every sync, automatically) once enough time has passed.

**Verified without sending real mail:** period-boundary detection tested against known dates (including the Dec-31-closes-four-periods edge case), and the email content tested via a dry-run helper (`buildPeriodicSummaryEmail`, pure computation, no `sendMail` call) against your real data. 4 real sample emails were sent to you on request (labeled `[Sample]`); no other test email has been sent. `SUMMARY_CRON` stays unset until you opt in.

**Before you turn it on:** set `SUMMARY_CRON` in `.env` (suggested: `0 8 * * *`, daily 8am — cheap to run since it no-ops on days nothing closed) and read through one real output first. Once it's run a few weeks, item 5 (bill reminders folded into this email) becomes easy to add.

---

### 3. Credit card bill/due dates (MVP)

**Status:** Done

**What shipped:** nullable `statementDay`/`dueDay` (1–31) added to `Account` via migration. Settings shows small numeric inputs for both on credit-card account rows, plus a computed "Next due: <date>" badge (rolls to next month once the day has passed, clamped for short months) — approximation only, as you scoped it. No reminders, no calendar — that's items 4 and 5, deliberately separated (see below).

---

### 4. Dashboard calendar highlighting bill due dates

**Status:** Done

**What shipped:** you picked option (a) — a compact "Bills due in the next 14 days" list card on the Dashboard, not a full calendar grid or a banner. Shows each tracked credit card with a `dueDay` set, soonest-first, with the same naive 3-statement-cycle estimate used by the weekly email (dash shown instead of a guess when there's no charge history yet). Each row deep-links to that account's filtered Transactions view. The due-date/estimate logic was factored out of the weekly email into a shared `getUpcomingBills()` helper (`packages/api/src/periodicSummary.ts`) so both features stay in sync instead of drifting.

**Verified:** typechecked clean across all three packages; live-tested by temporarily setting a near-term `dueDay` on a real card, confirming the card rendered correctly (both a real dollar estimate and the no-data dash case, sorted correctly), then reverting the test value.

---

### 5. Weekly reminders including credit card bills due + estimated amount

**Status:** Done

**What shipped:** the weekly email (only the weekly one — quarter/half/year don't get this section) now includes a "Bills due in the next 7 days" list for any tracked credit-card account with `dueDay` set. Each line shows the computed due date and a naive estimate — average of the account's last 3 statement-cycle charge totals (cycles run `statementDay`-to-`statementDay`, or calendar month-to-month when `statementDay` isn't set), omitted rather than guessed when there's no charge history yet.

**Verified without sending real mail:** temporarily set a near-term `dueDay` on a real credit-card account, dry-ran `buildPeriodicSummaryEmail` (no `sendMail` call), confirmed the due date and a real estimate (pulled from actual transaction history) rendered correctly, then reverted the account back to its original `dueDay`/`statementDay` (confirmed via a follow-up read).

---

### 6. Reported vs. Estimated balance (pending transactions)

**Status:** Done

**What shipped:** `Transaction.pending` already existed and was already populated by SimpleFIN sync but nothing read it. Added `pendingTotal`/`estimatedBalance` to `AccountDTO` (computed server-side from a groupBy over pending transactions). Settings account rows now show "Reported $X · Estimated $Y" only when an account actually has pending activity (no redundant second number otherwise). Estimate assumes `currentBalance` doesn't yet reflect pending activity — flagged as an estimate via tooltip, not treated as authoritative, since institutions differ on this (as you noted).

---

### 7. Manual account creation (for institutions SimpleFIN doesn't cover)

**Status:** Done

**What shipped:** `POST /accounts/manual` already existed server-side but had no UI calling it. Added a "+ Add manual account" toggle in Settings → Accounts opening an inline form (name, type, currency, starting balance, owner) wired to the existing endpoint. Typechecked clean.

---

### 8. Manual transactions

#### 8.1 Single-entry manual transaction on any account

**Status:** Done

**What shipped:** "+ Add transaction" on the Transactions page opens an inline form (account, date, direction in/out, amount, payee, category) posting to a new `POST /transactions/manual` endpoint (`source: manual`). Works on any account, synced or manual. Also nudges `currentBalance` and writes a `BalanceSnapshot`, same as the existing manual-balance-edit endpoint — for a SimpleFIN-synced account this is only ever a stopgap until the next sync overwrites the balance wholesale; for a manual-only account it's the actual source of truth.

#### 8.2 Bulk upload (past-90-days backfill via CSV)

**Status:** Done

**Design changed from the original sketch, and for the better:** the original idea was a downloadable template the user fills in — but you correctly caught that this means hand-retyping hundreds of transactions to match our columns, which defeats the point of "bulk." Shipped design instead: upload the bank's own CSV export unmodified, one account per import, and let the app adapt to whatever columns the bank used.

**What shipped** (new "Import" page/nav link, admin-only):
1. Pick the target account, upload a CSV (client-side parsing via `papaparse` — no file ever hits the server, only normalized JSON does).
2. Fixable column mapping: date column + format (`YYYY-MM-DD`/`MM/DD/YYYY`/`DD/MM/YYYY`), payee, optional memo, and amount — either a single signed column (with a sign-convention toggle, since exports vary on what negative means) or separate debit/credit columns. A live 3-row preview updates as you adjust the mapping.
3. Preview step: every row checked against existing transactions on that account (same date + same amount) and flagged as a likely duplicate — unchecked by default, but visible and overridable, not silently blocked.
4. Commit: only the checked rows get created (`source: manual`), then the existing auto-tag rule engine (`recategorizeAll`) runs automatically — so backfilled history inherits your current categorization rules instead of arriving untagged. Deliberately does **not** touch `currentBalance`/`BalanceSnapshot` — a historical backfill shouldn't perturb the current balance, which is already correct from sync.

**Verified:** date/amount parsing tested against 12 edge cases (both date orderings, invalid month rejection, `$1,200.00`, parenthesized negatives, empty/garbage input) — all passed. Backend endpoints verified against a throwaway account with a seeded existing transaction: duplicate correctly flagged and excluded from commit, the other two rows created correctly, one picked up a category from an existing rule, and the account balance was confirmed unchanged after commit. All test data cleaned up. UI wiring (account picker, column-mapping selects) reuses the same `Combobox`/`select` patterns already proven elsewhere in the app tonight; the full click-through wasn't independently re-verified due to the same browser-tooling click quirk noted earlier in this doc — worth a quick manual run-through with a real export when you get a chance.

**Scoping note:** CSV only, not `.xlsx` — added `papaparse` for CSV rather than a spreadsheet-parsing library, since CSV covers the vast majority of bank exports and any spreadsheet app can "Save As CSV" in seconds. Say the word if an institution genuinely only offers Excel and this becomes a blocker.

---

### 9. Configurable household/app name

**Status:** Planned (not started)

**Refined spec:** the display name "Panditas Wallet" (nav header, page `<title>`, email subject lines) reads from a single `VITE_APP_NAME` (web) / `APP_NAME` (api, for email subjects) env var, defaulting to "Panditas Wallet" so nothing changes unless the var is set. Renaming for a different household becomes a config change, not a code change.

---

### 10. Mobile apps (at least read-only views)

**Status:** Planned (not started) — direction chosen, and explicitly deprioritized (lowest priority in this backlog, confirmed 2026-07-22: "not priority")

**Decision (yours, tonight):** PWA-first. Reuses the existing React web app entirely — no new codebase, no new language, fastest path to "open it on your phone home screen." Trade-off accepted: no iOS push notifications, no native home-screen widgets; if that's ever needed, React Native was the next-best option (shares TypeScript types via `@panditas/shared`) and stays on the table later.

**Refined scope for a future session:**
1. Add a web app manifest + service worker (installable, works offline for already-fetched data) to `packages/web`.
2. Responsive audit of Dashboard/Settings for phone-width screens.
3. Decide read-only vs. read-write for phase 1 — recommend read-only first (Dashboard + account balances + recent transactions), matching your own "at least read only" framing, before tackling touch-friendly editing flows.
4. No native app-store distribution in phase 1 — installed via browser "Add to Home Screen," avoiding Apple/Google developer account and review-process overhead entirely for a family-only app.

---

## Tonight's session log

**Shipped and verified (typecheck clean, all test data cleaned up afterward):**
- Item 9 — configurable app name (`VITE_APP_NAME`/`APP_NAME`, defaults unchanged).
- Item 7 — "+ Add manual account" form in Settings (backend already existed, was unreachable).
- Item 6 — Reported vs. Estimated balance on account rows (from existing `Transaction.pending`).
- Item 3 — credit-card statement/due-day fields + "Next due" badge (new migration, applied to the dev DB).
- Item 8.1 — "+ Add transaction" on the Transactions page, works on any account.
- Items 1, 2 & 5 — periodic finance summary email, one cron job parameterized by period, plus a "bills due in the next 7 days" section on the weekly one. **Disabled by default** (`SUMMARY_CRON` unset) — read the item 1/2 section above before turning it on. 4 real sample emails (one per period, clearly labeled `[Sample]`) were sent to you on request after this shipped. Fixed a follow-up report from you: net-worth deltas were missing in the samples because checkpoint history had just started — backfilled real history from `BalanceSnapshot` (excluding a bad low-coverage data point that would've shown a fake swing), and made the "not enough history yet" case explicit in the email text for quarter/half/year, which genuinely have no comparison data yet.
- Item 8.2 — bulk transaction CSV import (new "Import" page, admin-only). Redesigned from the original template-based sketch after you caught that it would've required hand-retyping bank exports — now uploads the bank's own CSV as-is with fixable column mapping and duplicate-flagged preview. See item 8.2 above for full verification notes.

Verification note: UI click events were unreliable in tonight's browser tooling session (a
known quirk, not an app bug — same thing happened in an earlier session with the login button).
Where clicking didn't register, I verified via direct authenticated `fetch()` calls against the
same endpoints the UI calls, confirming request/response and the resulting balance/snapshot
changes — same code path, just invoked without the flaky click. Items 1/2 were verified with a
dry-run helper that computes email content without calling `sendMail` — no test email was sent
beyond the 4 you explicitly asked for. Worth a quick manual click-through of Settings/Transactions/Import
next time you're at the keyboard, though nothing tonight suggests an actual bug.

**Not built** (specced above, ready to pick up):
- Item 10 — mobile app. Direction decided (PWA-first); explicitly confirmed lowest priority — last in this backlog. Everything else in this backlog is now Done.
