import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  TXN_SOURCE_LABELS,
  formatMoney,
  type AnomalyStatus,
  type TransactionAnomalyDTO,
} from "@panditas/shared";
import { api } from "../api";
import { SegmentedControl } from "../components/ui/SegmentedControl";

const STATUS_OPTIONS: { value: AnomalyStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "dismissed", label: "Dismissed" },
  { value: "resolved", label: "Resolved" },
];

export function TransactionReviewPage() {
  const [status, setStatus] = useState<AnomalyStatus>("open");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["transaction-anomalies", status],
    queryFn: () => api.get<TransactionAnomalyDTO[]>(`/review/anomalies?status=${status}`),
    refetchInterval: 60_000,
  });
  const anomalies = data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["transaction-anomalies"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/review/anomalies/${id}/dismiss`),
    onSuccess: invalidate,
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/review/anomalies/${id}/resolve`),
    onSuccess: invalidate,
  });
  const deleteTxn = useMutation({
    mutationFn: (id: string) => api.del(`/transactions/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Transaction Review</h1>
          <p className="text-sm text-slate-500">
            Possible duplicates and other data-quality issues found after sync/import — admin only.
          </p>
        </div>
        <SegmentedControl
          value={status}
          onChange={(v) => setStatus(v as AnomalyStatus)}
          options={STATUS_OPTIONS}
        />
      </div>

      <div className="card">
        {isLoading && <p className="bg-white p-4 text-sm text-slate-500">Loading…</p>}
        {!isLoading && anomalies.length === 0 && (
          <p className="bg-white p-4 text-sm text-slate-500">
            {status === "open" ? "Nothing flagged right now." : `No ${status} items.`}
          </p>
        )}
        {anomalies.map((a) => (
          <div key={a.id} className="border-b border-slate-100 bg-white p-3 last:border-0">
            <p className="text-sm text-slate-700">{a.detail}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              Flagged {new Date(a.detectedAt).toLocaleString("en-CA")}
              {a.reviewedByName && (
                <>
                  {" "}
                  · {status === "dismissed" ? "Dismissed" : "Resolved"} by {a.reviewedByName}
                  {a.resolutionNote ? ` — ${a.resolutionNote}` : ""}
                </>
              )}
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              {a.transactions.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs ${t.deletedAt ? "opacity-50 line-through" : ""}`}
                >
                  <span className="font-medium text-slate-700">{t.accountName}</span>
                  <span className="text-slate-500">{new Date(t.postedAt).toLocaleDateString("en-CA")}</span>
                  <span className="font-medium">{formatMoney(t.amount)}</span>
                  <span className="text-slate-500">{t.payee ?? "—"}</span>
                  <span className="rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">
                    {TXN_SOURCE_LABELS[t.source]}
                  </span>
                  {status === "open" && !t.deletedAt && (
                    <button
                      onClick={() => deleteTxn.mutate(t.id)}
                      disabled={deleteTxn.isPending}
                      title="Removes this transaction permanently and won't reappear on the next sync/import"
                      className="text-red-600 underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>

            {status === "open" && (
              <div className="mt-2 flex gap-3 text-xs">
                <button
                  onClick={() => dismiss.mutate(a.id)}
                  disabled={dismiss.isPending}
                  title="Won't be flagged again — the transactions stay exactly as-is"
                  className="font-medium text-slate-600 underline disabled:opacity-50"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => resolve.mutate(a.id)}
                  disabled={resolve.isPending}
                  title="Marks this reviewed without deleting anything — use this if you handled it another way"
                  className="font-medium text-slate-600 underline disabled:opacity-50"
                >
                  Resolve
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
