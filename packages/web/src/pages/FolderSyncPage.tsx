import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AccountDTO,
  type FolderSyncStatus,
  type ImportCommitResponse,
  type PendingImportDetail,
  type PendingImportSummary,
} from "@panditas/shared";
import { api, ApiError } from "../api";
import { Combobox } from "../components/ui/Combobox";
import { ImportRowTable } from "../components/ui/ImportRowTable";

interface ScanSummary {
  scanned: number;
  staged: number;
  skipped: number;
  failed: number;
}

const STATUS_LABEL: Record<FolderSyncStatus, string> = {
  needs_review: "Needs review",
  needs_account: "Needs account",
  parse_failed: "Couldn't parse",
  committed: "Imported",
  rejected: "Rejected",
};

const STATUS_STYLE: Record<FolderSyncStatus, string> = {
  needs_review: "bg-amber-100 text-amber-800",
  needs_account: "bg-amber-100 text-amber-800",
  parse_failed: "bg-red-100 text-red-700",
  committed: "bg-emerald-100 text-emerald-700",
  rejected: "bg-slate-200 text-slate-600",
};

export function FolderSyncPage() {
  const queryClient = useQueryClient();
  const [includeResolved, setIncludeResolved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const pendingQuery = useQuery({
    queryKey: ["folder-sync-pending", includeResolved],
    queryFn: () => api.get<PendingImportSummary[]>(`/folder-sync/pending${includeResolved ? "?includeResolved=1" : ""}`),
  });

  const scanMutation = useMutation({
    mutationFn: () => api.post<ScanSummary>("/folder-sync/scan"),
    onSuccess: (summary) => {
      setScanSummary(summary);
      setScanError(null);
      queryClient.invalidateQueries({ queryKey: ["folder-sync-pending"] });
    },
    onError: (err) => setScanError(err instanceof ApiError ? err.message : "Scan failed"),
  });

  function resolveItem() {
    setExpandedId(null);
    queryClient.invalidateQueries({ queryKey: ["folder-sync-pending"] });
  }

  const items = pendingQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Folder sync</h1>
          <p className="text-sm text-slate-600">
            Drop a bank export (CSV, Excel, or PDF statement) into the watched folder, then scan — nothing is imported
            until you review and approve it here.
          </p>
        </div>
        <Link to="/import" className="mt-1 shrink-0 text-sm font-medium text-accent-600 hover:underline">
          ← Back to manual import
        </Link>
      </div>

      <div className="card space-y-3 p-6">
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {scanMutation.isPending ? "Scanning…" : "Scan folder"}
        </button>
        {scanError && <p className="text-sm text-red-600">{scanError}</p>}
        {scanSummary && (
          <p className="text-sm text-slate-600">
            Scanned {scanSummary.scanned} file(s): {scanSummary.staged} staged for review, {scanSummary.skipped} already
            seen, {scanSummary.failed} couldn't be parsed.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Review queue</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeResolved} onChange={(e) => setIncludeResolved(e.target.checked)} />
          Show imported / rejected
        </label>
      </div>

      {pendingQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {!pendingQuery.isLoading && items.length === 0 && (
        <p className="text-sm text-slate-500">
          Nothing here yet. Drop a file into the folder sync directory and click "Scan folder".
        </p>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="card overflow-hidden p-0">
            <button
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{item.fileName}</p>
                <p className="text-xs text-slate-500">
                  {item.fileType.toUpperCase()} · {item.rowCount} row(s)
                  {item.accountLabel ? ` · ${item.accountLabel}` : ""}
                  {item.confidence !== null ? ` · ${Math.round(item.confidence * 100)}% confidence` : ""}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[item.status]}`}>
                {STATUS_LABEL[item.status]}
              </span>
            </button>
            {expandedId === item.id && <PendingImportDetailPanel id={item.id} onResolved={resolveItem} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingImportDetailPanel({ id, onResolved }: { id: string; onResolved: () => void }) {
  const [accountId, setAccountId] = useState<string>("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<AccountDTO[]>("/accounts") });
  const accountOptions = (accounts.data ?? []).filter((a) => !a.mergedIntoId).map((a) => ({ value: a.id, label: a.displayName }));

  const detailQuery = useQuery({
    queryKey: ["folder-sync-pending-detail", id, accountId],
    queryFn: () => api.get<PendingImportDetail>(`/folder-sync/pending/${id}${accountId ? `?accountId=${accountId}` : ""}`),
  });

  const detail = detailQuery.data;
  const selectedAccount = accounts.data?.find((a) => a.id === accountId) ?? null;

  // Seed the account picker + row selection once the first load lands — not
  // on every refetch, so re-picking an account (which refetches with the new
  // override) doesn't stomp the user's own row selection.
  useEffect(() => {
    if (!detail || initialized) return;
    setAccountId(detail.accountId ?? "");
    setSelected(new Set(detail.preview.rows.filter((r) => !r.duplicate).map((r) => r.index)));
    setInitialized(true);
  }, [detail, initialized]);

  const approveMutation = useMutation({
    mutationFn: () => {
      const rows = (detail?.preview.rows ?? [])
        .filter((r) => selected.has(r.index))
        .map((r) => ({ postedAt: r.postedAt, amount: r.amount, payee: r.payee, memo: r.memo }));
      return api.post<ImportCommitResponse>(`/folder-sync/pending/${id}/approve`, { accountId, rows });
    },
    onSuccess: onResolved,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Approve failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/folder-sync/pending/${id}/reject`),
    onSuccess: onResolved,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Reject failed"),
  });

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const isResolved = detail?.status === "committed" || detail?.status === "rejected";

  return (
    <div className="space-y-4 border-t border-slate-200 p-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {detailQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {detail?.status === "parse_failed" && (
        <div className="space-y-2">
          <p className="text-sm text-red-700">{detail.errorMessage ?? "This file couldn't be parsed."}</p>
          {detail.fileType === "csv" ? (
            <p className="text-sm text-slate-600">
              You can still{" "}
              <a href={`/api/folder-sync/pending/${id}/file`} className="font-medium text-accent-600 hover:underline">
                download the original file
              </a>{" "}
              and bring it in through the <Link to="/import" className="font-medium text-accent-600 hover:underline">manual import</Link> flow instead.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              {detail.fileType.toUpperCase()} files have no manual fallback yet — you can still{" "}
              <a href={`/api/folder-sync/pending/${id}/file`} className="font-medium text-accent-600 hover:underline">
                download the original file
              </a>
              .
            </p>
          )}
          <button
            onClick={() => rejectMutation.mutate()}
            disabled={rejectMutation.isPending}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}

      {detail && !isResolved && detail.status !== "parse_failed" && (
        <>
          {detail.notes && <p className="text-sm text-slate-600">{detail.notes}</p>}
          <label className="block text-sm font-medium text-slate-700">
            Account
            <Combobox
              options={[{ value: "", label: "Choose account…" }, ...accountOptions]}
              value={accountId}
              onChange={setAccountId}
              className="mt-1 max-w-sm"
            />
          </label>

          {detail.preview.rows.length > 0 ? (
            <>
              <p className="text-sm text-slate-600">
                {detail.preview.rows.length} row(s), {detail.preview.duplicateCount} flagged as possible duplicates
                (unchecked by default). {selected.size} selected to import.
              </p>
              <ImportRowTable
                rows={detail.preview.rows}
                selected={selected}
                onToggle={toggleRow}
                currency={selectedAccount?.currency ?? "CAD"}
              />
            </>
          ) : (
            <p className="text-sm text-slate-500">No rows were transcribed from this file.</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || approveMutation.isPending}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={() => approveMutation.mutate()}
              disabled={!accountId || selected.size === 0 || approveMutation.isPending}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {approveMutation.isPending ? "Importing…" : `Import ${selected.size} transaction(s)`}
            </button>
          </div>
        </>
      )}

      {isResolved && <p className="text-sm text-slate-500">This file has already been {detail.status === "committed" ? "imported" : "rejected"}.</p>}
    </div>
  );
}
