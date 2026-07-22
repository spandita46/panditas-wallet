import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ACCOUNT_TYPES, formatMoney, SIMPLEFIN_BRIDGE_URL, type AccountDTO, type AccountType } from "@panditas/shared";
import { api, ApiError } from "../api";
import { Combobox } from "../components/ui/Combobox";
import { SegmentedControl } from "../components/ui/SegmentedControl";

type AccountTab = "active" | "untracked" | "merged";

interface SimplefinStatus {
  connections: { id: string; label: string | null; status: string; statusMessage: string | null; lastSyncedAt: string | null }[];
  institutions: {
    id: string;
    name: string;
    status: string;
    statusMessage: string | null;
    isNew: boolean;
    accountCount: number;
    lastSyncedAt: string | null;
  }[];
  lastRun: { status: string; message: string | null; accountsUpdated: number; transactionsAdded: number; finishedAt: string | null } | null;
}

// Next occurrence of `dueDay` (1-31) on/after today, clamped to the shorter
// month when the day doesn't exist there (e.g. day 31 in February).
// Approximate by design — real bill cycles can shift a little.
function formatNextDue(dueDay: number): string {
  const today = new Date();
  const clamp = (year: number, month: number) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(dueDay, lastDay));
  };
  let next = clamp(today.getFullYear(), today.getMonth());
  if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    next = clamp(today.getFullYear(), today.getMonth() + 1);
  }
  return next.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const TYPE_LABELS: Record<AccountType, string> = {
  chequing: "Chequing",
  savings: "Savings",
  credit_card: "Credit card",
  investment: "Investment",
  loan: "Loan",
  cash: "Cash",
  piggy_bank: "Piggy bank",
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [accountTab, setAccountTab] = useState<AccountTab>("active");
  const [showAddAccount, setShowAddAccount] = useState(false);

  const status = useQuery({
    queryKey: ["simplefin-status"],
    queryFn: () => api.get<SimplefinStatus>("/simplefin/status"),
  });
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<AccountDTO[]>("/accounts"),
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ id: string; name: string; role: string }[]>("/users"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["simplefin-status"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const claim = useMutation({
    mutationFn: () => api.post<{ summary: { accountsUpdated: number; transactionsAdded: number; errors: string[] } }>("/simplefin/claim", { setupToken: token.trim() }),
    onSuccess: (res) => {
      setToken("");
      setMessage(
        `Connected. Imported ${res.summary.accountsUpdated} account(s), ${res.summary.transactionsAdded} transaction(s).` +
          (res.summary.errors.length ? ` Warnings: ${res.summary.errors.join("; ")}` : ""),
      );
      invalidate();
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : "Claim failed"),
  });

  const sync = useMutation({
    mutationFn: () => api.post<{ accountsUpdated: number; transactionsAdded: number }>("/simplefin/sync"),
    onSuccess: (res) => {
      setMessage(`Synced. ${res.accountsUpdated} account(s), ${res.transactionsAdded} new transaction(s).`);
      invalidate();
    },
  });

  const setType = useMutation({
    mutationFn: (v: { id: string; type: AccountType }) => api.patch(`/accounts/${v.id}`, { type: v.type }),
    onSuccess: invalidate,
  });

  const setTracked = useMutation({
    mutationFn: (v: { id: string; isTracked: boolean }) =>
      api.patch(`/accounts/${v.id}`, { isTracked: v.isTracked }),
    onSuccess: invalidate,
  });

  const setLabel = useMutation({
    mutationFn: (v: { id: string; label: string | null }) =>
      api.patch(`/accounts/${v.id}`, { label: v.label }),
    onSuccess: invalidate,
  });

  const setOwner = useMutation({
    mutationFn: (v: { id: string; ownerUserId: string | null }) =>
      api.patch(`/accounts/${v.id}`, { ownerUserId: v.ownerUserId }),
    onSuccess: invalidate,
  });

  const setBillDates = useMutation({
    mutationFn: (v: { id: string; statementDay: number | null; dueDay: number | null }) =>
      api.patch(`/accounts/${v.id}`, { statementDay: v.statementDay, dueDay: v.dueDay }),
    onSuccess: invalidate,
  });

  const setSuppressTransactionSync = useMutation({
    mutationFn: (v: { id: string; suppressTransactionSync: boolean }) =>
      api.patch(`/accounts/${v.id}`, { suppressTransactionSync: v.suppressTransactionSync }),
    onSuccess: invalidate,
  });

  const acknowledgeAccount = useMutation({
    mutationFn: (id: string) => api.patch(`/accounts/${id}`, { acknowledgeNew: true }),
    onSuccess: invalidate,
  });

  const acknowledgeInstitution = useMutation({
    mutationFn: (id: string) => api.patch(`/simplefin/institutions/${id}`, { acknowledgeNew: true }),
    onSuccess: invalidate,
  });

  const mergeAccount = useMutation({
    mutationFn: (v: { id: string; intoAccountId: string }) =>
      api.post(`/accounts/${v.id}/merge`, { intoAccountId: v.intoAccountId }),
    onSuccess: invalidate,
    onError: (err) => setMessage(err instanceof ApiError ? err.message : "Merge failed"),
  });

  const unmergeAccount = useMutation({
    mutationFn: (id: string) => api.post(`/accounts/${id}/unmerge`),
    onSuccess: invalidate,
  });

  const createManualAccount = useMutation({
    mutationFn: (v: { name: string; type: AccountType; currency: string; currentBalance: number; ownerUserId: string | null }) =>
      // Backend schema uses `.optional()` (no `.nullable()`) for ownerUserId —
      // omit the key entirely for "Shared" rather than sending null.
      api.post("/accounts/manual", {
        name: v.name,
        type: v.type,
        currency: v.currency,
        currentBalance: v.currentBalance,
        ...(v.ownerUserId ? { ownerUserId: v.ownerUserId } : {}),
      }),
    onSuccess: () => {
      setShowAddAccount(false);
      invalidate();
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : "Couldn't create account"),
  });

  const activeAccounts = accounts.data?.filter((a) => a.isTracked && !a.mergedIntoId) ?? [];
  const untrackedAccounts = accounts.data?.filter((a) => !a.isTracked && !a.mergedIntoId) ?? [];
  const mergedAccounts = accounts.data?.filter((a) => a.mergedIntoId) ?? [];
  const visibleAccounts =
    accountTab === "active" ? activeAccounts : accountTab === "untracked" ? untrackedAccounts : mergedAccounts;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Connect SimpleFIN and manage your accounts.</p>
      </div>

      {message && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{message}</div>
      )}

      {/* Categories & budgeting */}
      <section className="card card-pad">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Categories & Budgeting</h2>
        <p className="mt-1 text-sm text-slate-500">
          Add income/expense/transfer categories, set monthly limits, and manage auto-tag rules from
          the Budget page.
        </p>
        <Link
          to="/budget"
          className="mt-3 inline-block rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
        >
          Go to Budget →
        </Link>
      </section>

      {/* Connect SimpleFIN */}
      <section className="card card-pad">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Connect SimpleFIN</h2>
        <p className="mt-1 text-sm text-slate-500">
          Paste the one-time <strong>setup token</strong> from SimpleFIN Bridge. It's claimed once and
          stored encrypted.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Setup token (base64)…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
          <button
            onClick={() => claim.mutate()}
            disabled={!token.trim() || claim.isPending}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
          >
            {claim.isPending ? "Claiming…" : "Connect"}
          </button>
        </div>
      </section>

      {/* Connection health */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Connections</h2>
          <div className="text-right">
            <button
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              {sync.isPending ? "Syncing…" : "Sync now"}
            </button>
            {status.data?.lastRun?.finishedAt && (
              <p className="mt-1 text-xs text-slate-500">
                Last synced {new Date(status.data.lastRun.finishedAt).toLocaleString("en-CA")}
              </p>
            )}
          </div>
        </div>
        <div className="card">
          {status.data?.institutions.length === 0 && (
            <p className="bg-white p-4 text-sm text-slate-500">No institutions yet. Connect SimpleFIN above.</p>
          )}
          {status.data?.institutions.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b border-slate-100 bg-white p-3 text-sm last:border-0">
              <div>
                <p className="font-medium text-slate-800">
                  {i.name}
                  {i.isNew && <span className="ml-2 rounded bg-accent-100 px-1.5 py-0.5 text-xs text-accent-700">New</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {i.accountCount} account(s) ·{" "}
                  {i.lastSyncedAt ? `synced ${new Date(i.lastSyncedAt).toLocaleString("en-CA")}` : "never synced"}
                </p>
                {i.status !== "ok" && i.statusMessage && (
                  <p className="mt-0.5 text-xs text-liability-700">{i.statusMessage}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {i.isNew && (
                  <button
                    onClick={() => acknowledgeInstitution.mutate(i.id)}
                    className="text-xs text-accent-600 hover:underline"
                  >
                    Got it
                  </button>
                )}
                {i.status !== "ok" && (
                  <a
                    href={SIMPLEFIN_BRIDGE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent-600 hover:underline"
                  >
                    Reconnect ↗
                  </a>
                )}
                <StatusBadge status={i.status} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Account type editor */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Accounts</h2>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              value={accountTab}
              onChange={setAccountTab}
              options={[
                { value: "active", label: `Active (${activeAccounts.length})` },
                { value: "untracked", label: `Untracked (${untrackedAccounts.length})` },
                { value: "merged", label: `Merged (${mergedAccounts.length})` },
              ]}
            />
            <button
              onClick={() => setShowAddAccount((v) => !v)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              {showAddAccount ? "Cancel" : "+ Add manual account"}
            </button>
          </div>
        </div>
        <p className="mb-3 text-sm text-slate-600">
          Sync guesses each account's type — correct any that are wrong (it affects net-worth math).
          If a SimpleFIN reconnect ever creates a duplicate account (same real bank account, new id),
          <strong> Merge</strong> it into the live one — history is kept and net worth stops double-counting.
          Untick <strong>Track</strong> for the general case of an unwanted duplicate or unused account.
        </p>
        {showAddAccount && (
          <AddManualAccountForm
            users={users.data ?? []}
            busy={createManualAccount.isPending}
            onSubmit={(v) => createManualAccount.mutate(v)}
          />
        )}
        <div className="card">
          {visibleAccounts.length === 0 && (
            <p className="p-4 text-sm text-slate-500">No accounts here.</p>
          )}
          {visibleAccounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              allAccounts={accounts.data ?? []}
              users={users.data ?? []}
              onLabel={(label) => setLabel.mutate({ id: a.id, label })}
              onType={(type) => setType.mutate({ id: a.id, type })}
              onTracked={(isTracked) => setTracked.mutate({ id: a.id, isTracked })}
              onOwner={(ownerUserId) => setOwner.mutate({ id: a.id, ownerUserId })}
              onAcknowledgeNew={() => acknowledgeAccount.mutate(a.id)}
              onMerge={(intoAccountId) => mergeAccount.mutate({ id: a.id, intoAccountId })}
              onUnmerge={() => unmergeAccount.mutate(a.id)}
              onBillDates={(v) => setBillDates.mutate({ id: a.id, ...v })}
              onSuppressTransactionSync={(v) => setSuppressTransactionSync.mutate({ id: a.id, suppressTransactionSync: v })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function AccountRow({
  account,
  allAccounts,
  users,
  onLabel,
  onType,
  onTracked,
  onOwner,
  onAcknowledgeNew,
  onMerge,
  onUnmerge,
  onBillDates,
  onSuppressTransactionSync,
}: {
  account: AccountDTO;
  allAccounts: AccountDTO[];
  users: { id: string; name: string; role: string }[];
  onLabel: (label: string | null) => void;
  onType: (type: AccountType) => void;
  onTracked: (isTracked: boolean) => void;
  onOwner: (ownerUserId: string | null) => void;
  onAcknowledgeNew: () => void;
  onMerge: (intoAccountId: string) => void;
  onUnmerge: () => void;
  onBillDates: (v: { statementDay: number | null; dueDay: number | null }) => void;
  onSuppressTransactionSync: (v: boolean) => void;
}) {
  const [label, setLabelValue] = useState(account.label ?? "");
  const [mergeTarget, setMergeTarget] = useState("");
  const [statementDay, setStatementDay] = useState(account.statementDay?.toString() ?? "");
  const [dueDay, setDueDay] = useState(account.dueDay?.toString() ?? "");

  const commitBillDay = (field: "statementDay" | "dueDay", raw: string) => {
    const n = raw.trim() === "" ? null : Math.min(31, Math.max(1, Number(raw)));
    if (n !== null && Number.isNaN(n)) return;
    if (n === account[field]) return;
    onBillDates({
      statementDay: field === "statementDay" ? n : account.statementDay,
      dueDay: field === "dueDay" ? n : account.dueDay,
    });
  };

  const commitLabel = () => {
    const next = label.trim() || null;
    if (next !== account.label) onLabel(next);
  };

  const mergeCandidates = allAccounts.filter(
    (a) => a.id !== account.id && a.institutionId && a.institutionId === account.institutionId && !a.mergedIntoId,
  );

  const merged = Boolean(account.mergedIntoId);

  return (
    <div className={`border-b border-slate-100 bg-white p-4 text-sm last:border-0 ${account.isTracked ? "" : "opacity-60"}`}>
      <div className="flex items-center justify-between gap-4">
        <input
          value={label}
          onChange={(e) => setLabelValue(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder={account.name}
          className="w-full max-w-sm rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-900"
        />
        {!merged && (
          <button
            onClick={() => onTracked(!account.isTracked)}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            {account.isTracked ? "Untrack" : "Track"}
          </button>
        )}
      </div>

      <p className="mt-2 truncate text-xs text-slate-500">
        {account.institutionName ?? "Manual"} · {account.name} ·{" "}
        {account.pendingTotal !== 0 ? (
          <span title="Reported balance vs. estimated balance including pending transactions not yet posted">
            Reported {formatMoney(account.currentBalance, account.currency)} · Estimated{" "}
            {formatMoney(account.estimatedBalance, account.currency)}
          </span>
        ) : (
          formatMoney(account.currentBalance, account.currency)
        )}
        {account.type === "credit_card" && account.dueDay && !merged && (
          <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">
            Next due {formatNextDue(account.dueDay)}
          </span>
        )}
        {account.isNew && (
          <span className="ml-2 rounded bg-accent-100 px-1.5 py-0.5 text-accent-700">New</span>
        )}
        {!account.isTracked && !merged && (
          <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">Not tracked</span>
        )}
        {merged && (
          <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">
            Merged into {account.mergedIntoName}
          </span>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {account.isNew && (
          <button onClick={onAcknowledgeNew} className="text-xs text-accent-600 hover:underline">
            Got it
          </button>
        )}
        {merged ? (
          <button
            onClick={onUnmerge}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            Unmerge
          </button>
        ) : (
          <>
            <Combobox
              options={[{ value: "", label: "Shared" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
              value={account.ownerUserId ?? ""}
              onChange={(v) => onOwner(v || null)}
              title="Account owner (for individual spending)"
              className="w-36"
              inputClassName="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />
            <select
              value={account.type}
              onChange={(e) => onType(e.target.value as AccountType)}
              className="w-32 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {account.type === "credit_card" && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-slate-500" title="Approximate statement-generation day of month">
                  Statement day
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={statementDay}
                    onChange={(e) => setStatementDay(e.target.value)}
                    onBlur={(e) => commitBillDay("statementDay", e.target.value)}
                    placeholder="—"
                    className="w-14 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-500" title="Approximate payment-due day of month">
                  Due day
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    onBlur={(e) => commitBillDay("dueDay", e.target.value)}
                    placeholder="—"
                    className="w-14 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </>
            )}
            {mergeCandidates.length > 0 && (
              <>
                <Combobox
                  options={mergeCandidates.map((a) => ({ value: a.id, label: a.displayName }))}
                  value={mergeTarget}
                  onChange={setMergeTarget}
                  placeholder="Merge into…"
                  title="Merge this account into another (same institution) — e.g. after a SimpleFIN reconnect"
                  className="w-40"
                  inputClassName="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                />
                <button
                  onClick={() => mergeTarget && onMerge(mergeTarget)}
                  disabled={!mergeTarget}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  Merge
                </button>
              </>
            )}
            <label
              className="flex items-center gap-1.5 text-xs text-slate-500"
              title="Keep syncing this account's balance, but stop pulling in its transactions — for a feed that keeps sending duplicate/wrong transactions here"
            >
              <input
                type="checkbox"
                checked={account.suppressTransactionSync}
                onChange={(e) => onSuppressTransactionSync(e.target.checked)}
              />
              Don't sync transactions
            </label>
          </>
        )}
      </div>
    </div>
  );
}

function AddManualAccountForm({
  users,
  busy,
  onSubmit,
}: {
  users: { id: string; name: string; role: string }[];
  busy: boolean;
  onSubmit: (v: { name: string; type: AccountType; currency: string; currentBalance: number; ownerUserId: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [type, setAccType] = useState<AccountType>("cash");
  const [currency, setCurrency] = useState("CAD");
  const [balance, setBalance] = useState("0");
  const [ownerUserId, setOwnerUserId] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({
      name: trimmed,
      type,
      currency: currency.trim() || "CAD",
      currentBalance: Number(balance) || 0,
      ownerUserId: ownerUserId || null,
    });
    setName("");
    setBalance("0");
    setOwnerUserId("");
  };

  return (
    <form onSubmit={submit} className="card mb-3 flex flex-wrap items-end gap-3 p-4">
      <label className="text-xs font-medium text-slate-600">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Coinbase, Cash"
          required
          className="mt-1 block w-44 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Type
        <select
          value={type}
          onChange={(e) => setAccType(e.target.value as AccountType)}
          className="mt-1 block w-32 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-600">
        Currency
        <input
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          className="mt-1 block w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Starting balance
        <input
          type="number"
          step="0.01"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          className="mt-1 block w-32 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Owner
        <select
          value={ownerUserId}
          onChange={(e) => setOwnerUserId(e.target.value)}
          className="mt-1 block w-36 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          <option value="">Shared</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-700 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add account"}
      </button>
    </form>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ok = status === "ok";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {status}
    </span>
  );
}
