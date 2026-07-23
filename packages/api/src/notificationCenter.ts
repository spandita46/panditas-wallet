import type { NotificationType } from "@panditas/shared";
import type { Notification } from "@prisma/client";
import { prisma } from "./db.js";

const STALE_MS = 1000 * 60 * 60 * 24 * 2; // 2 days
// How long a tracked account may lag its institution's lastSyncedAt before
// it's flagged orphaned — comfortably wider than one missed sync cycle
// (SYNC_CRON defaults to every 6h) so a single blip isn't a false positive,
// but still catches "stopped appearing in the feed" within about a day.
const ORPHAN_TOLERANCE_MS = 1000 * 60 * 60 * 25; // 25 hours
const SWING_THRESHOLD_PCT = 10;
// net_worth_swing has no natural per-row subject — it's a single household-
// wide condition, so it gets one fixed slot rather than a real id.
const SWING_SUBJECT = "global";

function toNotificationDTO(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    subjectId: n.subjectId,
    title: n.title,
    detail: n.detail,
    createdAt: n.createdAt.toISOString(),
    dismissedAt: n.dismissedAt?.toISOString() ?? null,
  };
}

/** Upsert a "live condition" notification — creates it the first time the
 * condition is observed true, refreshes title/detail on every subsequent
 * check, but never touches dismissedAt (a dismissal shouldn't get silently
 * undone just because the condition is still true on the next sync). */
async function upsertLiveNotification(type: NotificationType, subjectId: string, title: string, detail: string | null): Promise<void> {
  await prisma.notification.upsert({
    where: { type_subjectId: { type, subjectId } },
    create: { type, subjectId, title, detail },
    update: { title, detail },
  });
}

/** The condition is no longer true — remove the notification entirely
 * (banner and drawer both), rather than leaving a stale entry around. */
async function resolveLiveNotification(type: NotificationType, subjectId: string): Promise<void> {
  await prisma.notification.deleteMany({ where: { type, subjectId } });
}

/** A genuine one-time event (a new account/institution was just discovered).
 * Called exactly once, at creation time — never re-checked, never
 * regenerated even if the resulting notification is later cleared. */
export async function createOneTimeNotification(type: NotificationType, subjectId: string, title: string, detail: string | null): Promise<void> {
  await prisma.notification.create({ data: { type, subjectId, title, detail } });
}

async function syncStaleInstitutionNotifications(): Promise<void> {
  const institutions = await prisma.institution.findMany({ where: { provider: "simplefin" } });
  const now = Date.now();
  for (const i of institutions) {
    const isStale = i.status !== "ok" || !i.lastSyncedAt || now - i.lastSyncedAt.getTime() > STALE_MS;
    if (isStale) {
      await upsertLiveNotification("stale_institution", i.id, i.name, i.statusMessage);
    } else {
      await resolveLiveNotification("stale_institution", i.id);
    }
  }
}

async function syncOrphanedAccountNotifications(): Promise<void> {
  const institutions = await prisma.institution.findMany({ where: { provider: "simplefin" } });
  const instById = new Map(institutions.map((i) => [i.id, i]));
  // Merged-away accounts are deliberately isTracked:false and excluded — a
  // merge already resolves the "duplicate" concern this alert is about.
  const candidates = await prisma.account.findMany({
    where: { isTracked: true, isClosed: false, institutionId: { not: null }, mergedIntoId: null },
    select: { id: true, name: true, label: true, institutionId: true, lastSyncedAt: true },
  });
  for (const a of candidates) {
    const inst = a.institutionId ? instById.get(a.institutionId) : undefined;
    const isOrphaned =
      !!inst && inst.status === "ok" && !!inst.lastSyncedAt &&
      (!a.lastSyncedAt || inst.lastSyncedAt.getTime() - a.lastSyncedAt.getTime() > ORPHAN_TOLERANCE_MS);
    if (isOrphaned) {
      await upsertLiveNotification("orphaned_account", a.id, a.label ?? a.name, null);
    } else {
      await resolveLiveNotification("orphaned_account", a.id);
    }
  }
}

async function syncNetWorthSwingNotification(): Promise<void> {
  const [latest, prev] = await prisma.netWorthCheckpoint.findMany({ orderBy: { computedAt: "desc" }, take: 2 });
  if (!latest || !prev) {
    await resolveLiveNotification("net_worth_swing", SWING_SUBJECT);
    return;
  }
  const pctChange = (before: number, after: number) => (before !== 0 ? ((after - before) / before) * 100 : null);
  const assetsPctChange = pctChange(Number(prev.assetsTotal), Number(latest.assetsTotal));
  const liabilitiesPctChange = pctChange(Number(prev.liabilitiesTotal), Number(latest.liabilitiesTotal));

  const lines: string[] = [];
  if (assetsPctChange !== null && Math.abs(assetsPctChange) > SWING_THRESHOLD_PCT) {
    lines.push(`Assets changed by ${assetsPctChange.toFixed(1)}% since the last sync.`);
  }
  if (liabilitiesPctChange !== null && Math.abs(liabilitiesPctChange) > SWING_THRESHOLD_PCT) {
    lines.push(`Liabilities changed by ${liabilitiesPctChange.toFixed(1)}% since the last sync.`);
  }

  if (lines.length > 0) {
    await upsertLiveNotification("net_worth_swing", SWING_SUBJECT, "Net worth swing", lines.join(" "));
  } else {
    await resolveLiveNotification("net_worth_swing", SWING_SUBJECT);
  }
}

/** Re-check every live-condition alert type against current reality — called
 * once at the end of every syncAll() run (cron or manual "Sync now"), so
 * notifications are dated to when the condition was actually detected rather
 * than whenever someone next happens to open the Dashboard. */
export async function syncLiveConditionNotifications(): Promise<void> {
  await syncStaleInstitutionNotifications();
  await syncOrphanedAccountNotifications();
  await syncNetWorthSwingNotification();
}

export async function listNotifications() {
  const rows = await prisma.notification.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(toNotificationDTO);
}

export async function listActiveNotifications() {
  const rows = await prisma.notification.findMany({ where: { dismissedAt: null }, orderBy: { createdAt: "desc" } });
  return rows.map(toNotificationDTO);
}
