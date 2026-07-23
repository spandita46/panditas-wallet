import { formatMoney } from "@panditas/shared";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { sendMail } from "./mailer.js";
import { appLink } from "./notifications.js";

export type SummaryPeriod = "week" | "quarter" | "half" | "year";

const PERIOD_LABEL: Record<SummaryPeriod, string> = {
  week: "Weekly",
  quarter: "Quarterly",
  half: "Half-yearly",
  year: "Yearly",
};

const PERIOD_COMPARISON_LABEL: Record<SummaryPeriod, string> = {
  week: "last week",
  quarter: "last quarter",
  half: "last half-year",
  year: "last year",
};

const isLastDayOfMonth = (d: Date): boolean =>
  new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();

/**
 * Which periods just closed on `refDate` (a whole calendar day, local time —
 * this runs on the household's own machine, so there's only one timezone to
 * reason about). A single day can close more than one period at once (e.g.
 * Dec 31 on a Sunday closes week+quarter+half+year) — each gets its own email.
 */
export function periodsEndingOn(refDate: Date): { period: SummaryPeriod; start: Date; end: Date }[] {
  const end = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const results: { period: SummaryPeriod; start: Date; end: Date }[] = [];

  if (end.getDay() === 0) {
    results.push({ period: "week", start: new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6), end });
  }
  if (isLastDayOfMonth(end)) {
    const month = end.getMonth();
    if ([2, 5, 8, 11].includes(month)) {
      results.push({ period: "quarter", start: new Date(end.getFullYear(), month - 2, 1), end });
    }
    if ([5, 11].includes(month)) {
      results.push({ period: "half", start: new Date(end.getFullYear(), month - 5, 1), end });
    }
    if (month === 11) {
      results.push({ period: "year", start: new Date(end.getFullYear(), 0, 1), end });
    }
  }
  return results;
}

// Mirrors the "Next due" badge math in Settings.tsx (formatNextDue) — kept as
// a separate small copy here rather than shared, since one is local-calendar
// display logic for the browser and this is a server-side query input.
export function nextDueDate(dueDay: number, asOf: Date): Date {
  const clamp = (year: number, month: number) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(dueDay, lastDay));
  };
  let next = clamp(asOf.getFullYear(), asOf.getMonth());
  if (next < new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())) {
    next = clamp(asOf.getFullYear(), asOf.getMonth() + 1);
  }
  return next;
}

// The `count` most recent statement-cycle windows at/before `asOf`, oldest
// first. Cycles run statementDay-to-statementDay; falls back to calendar
// months (1st-to-1st) when statementDay isn't set — still a reasonable
// window for a "naive" estimate.
function statementCycleWindows(statementDay: number | null, asOf: Date, count: number): { start: Date; end: Date }[] {
  const day = statementDay ?? 1;
  const boundary = (monthsBack: number): Date => {
    const total = asOf.getFullYear() * 12 + asOf.getMonth() - monthsBack;
    const year = Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, lastDay));
  };
  const recentOffset = boundary(0) > asOf ? 1 : 0;
  const windows: { start: Date; end: Date }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    windows.push({ start: boundary(recentOffset + i + 1), end: boundary(recentOffset + i) });
  }
  return windows;
}

/** Naive estimate: average of the account's total charges (debits) over its
 * last 3 statement cycles. Returns null when there's no charge history yet
 * in any of them, rather than guessing from zero data. */
async function estimateNextBillAmount(accountId: string, statementDay: number | null, asOf: Date): Promise<number | null> {
  const windows = statementCycleWindows(statementDay, asOf, 3);
  const totals: number[] = [];
  for (const { start, end } of windows) {
    const agg = await prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { accountId, postedAt: { gte: start, lt: end }, amount: { lt: 0 } },
    });
    const total = -Number(agg._sum.amount ?? 0);
    if (total > 0) totals.push(total);
  }
  if (totals.length === 0) return null;
  return totals.reduce((a, b) => a + b, 0) / totals.length;
}

export interface UpcomingBill {
  accountId: string;
  name: string;
  dueDate: Date;
  estimate: number | null;
  currency: string;
}

/** Tracked credit cards with a due date inside the next `horizonDays`,
 * soonest first — shared by the weekly email's "bills due" section and the
 * Dashboard's upcoming-bills card. */
export async function getUpcomingBills(asOf: Date, horizonDays: number): Promise<UpcomingBill[]> {
  const cards = await prisma.account.findMany({
    where: { type: "credit_card", isTracked: true, isClosed: false, dueDay: { not: null } },
    select: { id: true, name: true, label: true, dueDay: true, statementDay: true, currency: true },
  });
  const horizonEnd = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() + horizonDays);
  const upcoming: UpcomingBill[] = [];
  for (const c of cards) {
    const dueDate = nextDueDate(c.dueDay!, asOf);
    if (dueDate > horizonEnd) continue;
    const estimate = await estimateNextBillAmount(c.id, c.statementDay, asOf);
    upcoming.push({ accountId: c.id, name: c.label ?? c.name, dueDate, estimate, currency: c.currency });
  }
  upcoming.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return upcoming;
}

async function resolveRecipients(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: ["admin", "adult"] }, isActive: true, email: { not: null } },
    select: { email: true },
  });
  return users.map((u) => u.email!).filter(Boolean);
}

export interface PeriodicSummaryEmail {
  recipients: string[];
  subject: string;
  text: string;
}

/** Pure computation, no side effects — safe to call for a dry run/preview.
 * Handles thin history gracefully (e.g. no prior checkpoint yet): those
 * sections are just omitted rather than showing a misleading $0 delta.
 * Returns null when there's nobody to send to. */
export async function buildPeriodicSummaryEmail(
  period: SummaryPeriod,
  start: Date,
  end: Date,
): Promise<PeriodicSummaryEmail | null> {
  const recipients = await resolveRecipients();
  if (recipients.length === 0) return null;

  const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);

  const [currentCheckpoint, previousCheckpoint, incomeAgg, groceryAgg, expenseTxns] = await Promise.all([
    prisma.netWorthCheckpoint.findFirst({ where: { computedAt: { lt: endExclusive } }, orderBy: { computedAt: "desc" } }),
    prisma.netWorthCheckpoint.findFirst({ where: { computedAt: { lt: start } }, orderBy: { computedAt: "desc" } }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { postedAt: { gte: start, lt: endExclusive }, category: { kind: "income" }, account: { isTracked: true, isClosed: false } },
    }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { postedAt: { gte: start, lt: endExclusive }, category: { name: "Groceries" }, account: { isTracked: true, isClosed: false } },
    }),
    prisma.transaction.findMany({
      where: { postedAt: { gte: start, lt: endExclusive }, category: { kind: "expense" }, account: { isTracked: true, isClosed: false } },
      select: { amount: true, account: { select: { ownerUserId: true, owner: { select: { name: true } } } } },
    }),
  ]);

  const income = Number(incomeAgg._sum.amount ?? 0);
  const grocery = -Number(groceryAgg._sum.amount ?? 0);

  const byOwner = new Map<string, { name: string; amount: number }>();
  let expense = 0;
  for (const t of expenseTxns) {
    const amt = -Number(t.amount);
    expense += amt;
    const key = t.account.ownerUserId ?? "shared";
    const name = t.account.owner?.name ?? "Shared";
    const entry = byOwner.get(key) ?? { name, amount: 0 };
    entry.amount += amt;
    byOwner.set(key, entry);
  }
  const perOwner = [...byOwner.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((o) => ({ ...o, pct: expense > 0 ? (o.amount / expense) * 100 : 0 }));

  const lines: string[] = [`${PERIOD_LABEL[period]} finance summary — ${start.toLocaleDateString()} to ${end.toLocaleDateString()}`, ""];

  if (currentCheckpoint) {
    const assets = Number(currentCheckpoint.assetsTotal);
    const liabilities = Number(currentCheckpoint.liabilitiesTotal);
    const comparisonLabel = PERIOD_COMPARISON_LABEL[period];
    const deltaSuffix = (delta: number | null): string => {
      if (delta === null) return ` (no ${comparisonLabel} data yet)`;
      return ` (${delta >= 0 ? "+" : ""}${formatMoney(delta)} vs ${comparisonLabel})`;
    };
    const assetsDelta = previousCheckpoint ? assets - Number(previousCheckpoint.assetsTotal) : null;
    const liabilitiesDelta = previousCheckpoint ? liabilities - Number(previousCheckpoint.liabilitiesTotal) : null;
    lines.push(
      `Assets: ${formatMoney(assets)}${deltaSuffix(assetsDelta)}`,
      `Liabilities: ${formatMoney(liabilities)}${deltaSuffix(liabilitiesDelta)}`,
      "",
    );
  }

  lines.push(`Income: ${formatMoney(income)}`, `Expenses: ${formatMoney(expense)}`, "");

  if (perOwner.length > 0) {
    lines.push("By who spent it:");
    for (const o of perOwner) lines.push(`  ${o.name}: ${formatMoney(o.amount)} (${o.pct.toFixed(0)}%)`);
    lines.push("");
  }

  lines.push(`Groceries: ${formatMoney(grocery)}`, "");

  if (period === "week") {
    const upcoming = await getUpcomingBills(end, 7);

    if (upcoming.length > 0) {
      lines.push("Bills due in the next 7 days:");
      for (const u of upcoming) {
        lines.push(
          `  ${u.name}: due ${u.dueDate.toLocaleDateString()}${u.estimate !== null ? ` (est. ${formatMoney(u.estimate, u.currency)}, based on recent statements)` : ""}`,
        );
      }
      lines.push("");
    }
  }

  const dashboardUrl = appLink("/");
  lines.push(dashboardUrl ? `Open ${env.APP_NAME}: ${dashboardUrl}` : `Open ${env.APP_NAME} for the full picture.`);

  return {
    recipients,
    subject: `${env.APP_NAME}: ${PERIOD_LABEL[period]} finance summary`,
    text: lines.join("\n"),
  };
}

async function sendPeriodicSummary(period: SummaryPeriod, start: Date, end: Date): Promise<void> {
  const email = await buildPeriodicSummaryEmail(period, start, end);
  if (!email) return;
  await sendMail({ to: email.recipients.join(", "), subject: email.subject, text: email.text });
}

/** Called once a day by the scheduler. Sends a summary for every period that
 * closed yesterday (there's usually zero or one; rarely more than one on a
 * calendar boundary like Dec 31). */
export async function runPeriodicSummaries(refDate: Date = new Date()): Promise<void> {
  const yesterday = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() - 1);
  const periods = periodsEndingOn(yesterday);
  for (const { period, start, end } of periods) {
    await sendPeriodicSummary(period, start, end);
  }
}
