import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, type DashboardSummary } from "@panditas/shared";
import { api } from "../api";

interface SyncSummary {
  accountsUpdated: number;
  transactionsAdded: number;
  errors: string[];
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
  });

  const sync = useMutation({
    mutationFn: () => api.post<SyncSummary>("/simplefin/sync"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["simplefin-status"] });
    },
  });

  return (
    <div>
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Family dashboard</h1>
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {sync.isPending ? "Syncing…" : "Sync now"}
        </button>
      </header>

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">Could not load the dashboard.</p>}

      {data && (
        <div className="space-y-8">
          {data.staleInstitutions.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <strong>{data.staleInstitutions.length}</strong> connection(s) need attention in
              SimpleFIN:{" "}
              {data.staleInstitutions.map((i) => i.name).join(", ")}. Balances shown may be stale.
            </div>
          )}

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Net worth" value={data.netWorth.netWorth} emphasis />
            <StatCard label="Assets" value={data.netWorth.assets} />
            <StatCard label="Liabilities" value={-data.netWorth.liabilities} />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Credit cards
            </h2>
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
              {data.creditCards.length === 0 && (
                <p className="bg-white p-4 text-sm text-slate-500">No credit cards yet.</p>
              )}
              {data.creditCards.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between border-b border-slate-100 bg-white p-4 last:border-0"
                >
                  <div>
                    <p className="font-medium text-slate-800">{c.displayName}</p>
                    <p className="text-xs text-slate-500">{c.institutionName ?? "Manual"}</p>
                  </div>
                  <span className="font-medium text-red-600">
                    {formatMoney(-Math.abs(c.currentBalance), c.currency)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Recent transactions
            </h2>
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
              {data.recentTransactions.length === 0 && (
                <p className="bg-white p-4 text-sm text-slate-500">
                  No transactions yet — connect SimpleFIN or add one manually.
                </p>
              )}
              {data.recentTransactions.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between border-b border-slate-100 bg-white p-3 text-sm last:border-0"
                >
                  <div>
                    <p className="font-medium text-slate-800">{t.payee ?? t.description ?? "—"}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(t.postedAt).toLocaleDateString("en-CA")} · {t.accountName}
                    </p>
                  </div>
                  <span className={t.amount < 0 ? "text-slate-800" : "text-green-600"}>
                    {formatMoney(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div
      className={`rounded-xl p-5 ring-1 ring-slate-200 ${emphasis ? "bg-slate-900 text-white" : "bg-white"}`}
    >
      <p className={`text-xs uppercase tracking-wide ${emphasis ? "text-slate-300" : "text-slate-500"}`}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{formatMoney(value)}</p>
    </div>
  );
}
