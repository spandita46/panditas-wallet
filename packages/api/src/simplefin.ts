// SimpleFIN client. Handles the claim flow and the /accounts fetch, normalizing
// both the legacy SimpleFIN Bridge shape (org per account, `errors` string[],
// payee/memo fields) and the newer structured shape (`connections` + `errlist`).

export interface NormalizedTxn {
  id: string;
  posted: Date;
  amount: string; // numeric string, sign: negative = outflow
  payee: string | null;
  description: string | null;
  memo: string | null;
  pending: boolean;
}

export interface NormalizedAccount {
  externalId: string;
  name: string;
  orgKey: string; // stable institution key (domain/org id/conn id)
  orgName: string;
  connId: string | null;
  currency: string;
  balance: string;
  availableBalance: string | null;
  balanceDate: Date | null;
  transactions: NormalizedTxn[];
}

// A per-institution error from SimpleFIN's `errlist`, with the conn_id/account_id
// attribution the flattened `errors: string[]` throws away.
export interface NormalizedError {
  code?: string;
  msg: string;
  connId?: string;
  accountId?: string;
}

// An entry from SimpleFIN's `connections` array — present even for a
// connection that returned zero accounts this sync (unlike NormalizedAccount,
// which only exists for orgs with at least one account in the response).
export interface NormalizedConnection {
  connId: string;
  name?: string;
  orgId?: string;
}

export interface AccountsResult {
  accounts: NormalizedAccount[];
  errors: string[];
  errlist: NormalizedError[];
  connections: NormalizedConnection[];
}

// SimpleFIN's benign date-range advisories share the same `errors`/`errlist`
// array as real per-institution problems (auth required, etc.) — filter these
// out wherever institution/connection health is being judged.
export function isAdvisoryError(msg: string): boolean {
  return /recommended range|exceeds limit|was capped|date range/i.test(msg);
}

/** Best-effort classification of a SimpleFIN error into a broad institution
 * status. SimpleFIN's `code` taxonomy isn't documented anywhere we have access
 * to — this is a message-text heuristic, tightened against real observed
 * messages ("...Auth required", "...Broken. Please click \"Adjust.\""). */
export function classifySimplefinError(e: { code?: string; msg: string }): "auth_required" | "error" {
  if (
    /reconnect|re-?auth|expired|credential|login|log in|password|mfa|2fa|verify|challenge|\bauth\b|broken|adjust/i.test(
      e.msg,
    )
  ) {
    return "auth_required";
  }
  return "error";
}

// The real, currently-observed SimpleFIN Bridge shape has no `errlist`/
// `connections` at all — every per-institution problem instead arrives as a
// plain string in `errors`, of the form "Connection to {name} may need
// attention. {reason}". This is the PRIMARY attribution path in practice, not
// a fallback — the structured errlist/connId path above may simply never
// fire against this Bridge instance.
const LEGACY_INSTITUTION_ERROR = /^connection to (.+?) may need attention\.?\s*(.*)$/i;

export function parseLegacyInstitutionError(msg: string): { name: string; reason: string } | null {
  const m = LEGACY_INSTITUTION_ERROR.exec(msg.trim());
  if (!m) return null;
  const name = m[1]!.trim();
  const reason = (m[2] || "").trim() || msg.trim();
  return { name, reason };
}

const toDate = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000); // SimpleFIN uses epoch seconds
};

/** Decode a base64 setup token to its claim URL and POST to obtain the access URL. */
export async function claimAccessUrl(setupToken: string): Promise<string> {
  const claimUrl = Buffer.from(setupToken.trim(), "base64").toString("utf8").trim();
  if (!/^https?:\/\//.test(claimUrl)) {
    throw new Error("Setup token did not decode to a valid claim URL");
  }
  const res = await fetch(claimUrl, { method: "POST" });
  if (res.status === 403) {
    throw new Error("Setup token is invalid or was already claimed");
  }
  if (!res.ok) {
    throw new Error(`Claim failed (HTTP ${res.status})`);
  }
  const accessUrl = (await res.text()).trim();
  if (!/^https?:\/\//.test(accessUrl)) {
    throw new Error("Claim did not return a valid access URL");
  }
  return accessUrl;
}

/** Fetch accounts + transactions from a SimpleFIN access URL. */
export async function fetchAccounts(
  accessUrl: string,
  opts: { startDate?: Date } = {},
): Promise<AccountsResult> {
  const base = accessUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/accounts`);

  // Extract embedded basic-auth credentials into a header.
  const headers: Record<string, string> = {};
  if (url.username || url.password) {
    const creds = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.Authorization = `Basic ${Buffer.from(creds).toString("base64")}`;
    url.username = "";
    url.password = "";
  }

  // SimpleFIN Bridge caps a single request at 90 days of history; stay just under it.
  const startDate = opts.startDate ?? new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
  url.searchParams.set("start-date", String(Math.floor(startDate.getTime() / 1000)));
  url.searchParams.set("pending", "1");

  const res = await fetch(url, { headers });
  if (res.status === 403) throw new Error("Access URL rejected (403) — reconnect required");
  if (!res.ok) throw new Error(`SimpleFIN /accounts failed (HTTP ${res.status})`);

  const data = (await res.json()) as SimplefinRaw;

  // Build a conn_id -> name map for the newer shape.
  const connById = new Map<string, { name?: string; org_id?: string }>();
  for (const c of data.connections ?? []) connById.set(c.conn_id, c);

  const accounts: NormalizedAccount[] = (data.accounts ?? []).map((a) => {
    const conn = a.conn_id ? connById.get(a.conn_id) : undefined;
    const orgName = a.org?.name ?? conn?.name ?? "Unknown institution";
    const orgKey =
      a.org?.domain ?? a.org?.url ?? conn?.org_id ?? a.conn_id ?? orgName;
    return {
      externalId: a.id,
      name: a.name ?? "Account",
      orgKey,
      orgName,
      connId: a.conn_id ?? null,
      currency: normalizeCurrency(a.currency),
      balance: a.balance ?? "0",
      availableBalance: a["available-balance"] ?? null,
      balanceDate: toDate(a["balance-date"]),
      transactions: (a.transactions ?? []).map((t) => ({
        id: t.id,
        posted: toDate(t.posted) ?? new Date(),
        amount: t.amount ?? "0",
        payee: t.payee ?? null,
        description: t.description ?? null,
        memo: t.memo ?? null,
        pending: Boolean(t.pending),
      })),
    };
  });

  const errors: string[] = [];
  for (const e of data.errors ?? []) if (typeof e === "string") errors.push(e);
  for (const e of data.errlist ?? []) if (e?.msg) errors.push(e.msg);

  const errlist: NormalizedError[] = (data.errlist ?? [])
    .filter((e): e is { code?: string; msg: string; conn_id?: string; account_id?: string } => Boolean(e?.msg))
    .map((e) => ({ code: e.code, msg: e.msg, connId: e.conn_id, accountId: e.account_id }));

  const connections: NormalizedConnection[] = (data.connections ?? []).map((c) => ({
    connId: c.conn_id,
    name: c.name,
    orgId: c.org_id,
  }));

  return { accounts, errors, errlist, connections };
}

function normalizeCurrency(c: string | undefined): string {
  if (!c) return "CAD";
  // Non-ISO currencies come through as URLs; fall back to CAD for display.
  return /^[A-Z]{3}$/.test(c) ? c : "CAD";
}

// Raw wire types (loose — fields are optional across variants).
interface SimplefinRaw {
  errors?: unknown[];
  errlist?: { code?: string; msg?: string; conn_id?: string; account_id?: string }[];
  connections?: { conn_id: string; name?: string; org_id?: string }[];
  accounts?: SimplefinRawAccount[];
}

interface SimplefinRawAccount {
  id: string;
  name?: string;
  conn_id?: string;
  org?: { domain?: string; name?: string; url?: string; "sfin-url"?: string };
  currency?: string;
  balance?: string;
  "available-balance"?: string;
  "balance-date"?: number | string;
  transactions?: {
    id: string;
    posted?: number | string;
    amount?: string;
    description?: string;
    payee?: string;
    memo?: string;
    pending?: boolean;
  }[];
}
