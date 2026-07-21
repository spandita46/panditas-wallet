import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ACCOUNT_TYPES, formatMoney, type AccountDTO, type AccountType } from "@panditas/shared";
import { api, ApiError } from "../api";
import { Combobox } from "../components/ui/Combobox";

interface SimplefinStatus {
  connections: { id: string; label: string | null; status: string; statusMessage: string | null; lastSyncedAt: string | null }[];
  institutions: { id: string; name: string; status: string; accountCount: number; lastSyncedAt: string | null }[];
  lastRun: { status: string; message: string | null; accountsUpdated: number; transactionsAdded: number; finishedAt: string | null } | null;
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
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {sync.isPending ? "Syncing…" : "Sync now"}
          </button>
        </div>
        <div className="card">
          {status.data?.institutions.length === 0 && (
            <p className="bg-white p-4 text-sm text-slate-500">No institutions yet. Connect SimpleFIN above.</p>
          )}
          {status.data?.institutions.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b border-slate-100 bg-white p-3 text-sm last:border-0">
              <div>
                <p className="font-medium text-slate-800">{i.name}</p>
                <p className="text-xs text-slate-500">
                  {i.accountCount} account(s) ·{" "}
                  {i.lastSyncedAt ? `synced ${new Date(i.lastSyncedAt).toLocaleString("en-CA")}` : "never synced"}
                </p>
              </div>
              <StatusBadge status={i.status} />
            </div>
          ))}
        </div>
        {status.data?.connections.some((c) => c.statusMessage) && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {status.data.connections.filter((c) => c.statusMessage).map((c) => c.statusMessage).join(" · ")}
          </div>
        )}
      </section>

      {/* Account type editor */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Accounts</h2>
        <p className="mb-3 text-sm text-slate-600">
          Sync guesses each account's type — correct any that are wrong (it affects net-worth math).
          Untick <strong>Track</strong> to exclude an account (e.g. a duplicate or unused one) from
          net worth and all lists.
        </p>
        <div className="card">
          {accounts.data?.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              users={users.data ?? []}
              onLabel={(label) => setLabel.mutate({ id: a.id, label })}
              onType={(type) => setType.mutate({ id: a.id, type })}
              onTracked={(isTracked) => setTracked.mutate({ id: a.id, isTracked })}
              onOwner={(ownerUserId) => setOwner.mutate({ id: a.id, ownerUserId })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function AccountRow({
  account,
  users,
  onLabel,
  onType,
  onTracked,
  onOwner,
}: {
  account: AccountDTO;
  users: { id: string; name: string; role: string }[];
  onLabel: (label: string | null) => void;
  onType: (type: AccountType) => void;
  onTracked: (isTracked: boolean) => void;
  onOwner: (ownerUserId: string | null) => void;
}) {
  const [label, setLabelValue] = useState(account.label ?? "");

  const commitLabel = () => {
    const next = label.trim() || null;
    if (next !== account.label) onLabel(next);
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white p-3 text-sm last:border-0 ${
        account.isTracked ? "" : "opacity-60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <input
          value={label}
          onChange={(e) => setLabelValue(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder={account.name}
          className="w-full max-w-xs rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium text-slate-900"
        />
        <p className="mt-1 truncate text-xs text-slate-500">
          {account.institutionName ?? "Manual"} · {account.name} ·{" "}
          {formatMoney(account.currentBalance, account.currency)}
          {!account.isTracked && (
            <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">Not tracked</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={account.isTracked}
            onChange={(e) => onTracked(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Track
        </label>
        <Combobox
          options={[{ value: "", label: "Shared" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          value={account.ownerUserId ?? ""}
          onChange={(v) => onOwner(v || null)}
          title="Account owner (for individual spending)"
          className="w-36"
          inputClassName="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
        <select
          value={account.type}
          onChange={(e) => onType(e.target.value as AccountType)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
    </div>
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
