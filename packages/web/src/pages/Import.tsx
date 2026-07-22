import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  formatMoney,
  type AccountDTO,
  type ImportCommitResponse,
  type ImportPreviewResponse,
} from "@panditas/shared";
import { api, ApiError } from "../api";
import { Combobox } from "../components/ui/Combobox";

type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY";
type AmountMode = "single" | "debit_credit";
type Step = "upload" | "map" | "preview" | "done";

interface NormalizedRow {
  postedAt: string;
  amount: number;
  payee: string | null;
  memo: string | null;
}

function parseDateValue(raw: string, format: DateFormat): string | null {
  const s = raw.trim();
  if (!s) return null;
  const parts = format === "YYYY-MM-DD" ? s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/) : s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!parts) return null;
  const a = Number(parts[1]!);
  const b = Number(parts[2]!);
  const c = Number(parts[3]!);
  let y: number, m: number, d: number;
  if (format === "YYYY-MM-DD") {
    y = a;
    m = b;
    d = c;
  } else if (format === "MM/DD/YYYY") {
    m = a;
    d = b;
    y = c;
  } else {
    d = a;
    m = b;
    y = c;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseAmountValue(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function ImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);

  const [dateCol, setDateCol] = useState<number | null>(null);
  const [dateFormat, setDateFormat] = useState<DateFormat>("YYYY-MM-DD");
  const [payeeCol, setPayeeCol] = useState<number | null>(null);
  const [memoCol, setMemoCol] = useState<number | null>(null);
  const [amountMode, setAmountMode] = useState<AmountMode>("single");
  const [amountCol, setAmountCol] = useState<number | null>(null);
  const [flipSign, setFlipSign] = useState(false);
  const [debitCol, setDebitCol] = useState<number | null>(null);
  const [creditCol, setCreditCol] = useState<number | null>(null);

  const [skippedCount, setSkippedCount] = useState(0);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<AccountDTO[]>("/accounts") });
  const accountOptions = (accounts.data ?? [])
    .filter((a) => !a.mergedIntoId)
    .map((a) => ({ value: a.id, label: a.displayName }));
  const selectedAccount = accounts.data?.find((a) => a.id === accountId) ?? null;

  const normalizedRows = useMemo((): { rows: NormalizedRow[]; skipped: number } => {
    const rows: NormalizedRow[] = [];
    let skipped = 0;
    for (const row of rawRows) {
      const postedAt = dateCol !== null ? parseDateValue(row[dateCol] ?? "", dateFormat) : null;
      let amount: number | null = null;
      if (amountMode === "single") {
        const raw = amountCol !== null ? parseAmountValue(row[amountCol] ?? "") : null;
        amount = raw === null ? null : flipSign ? -raw : raw;
      } else {
        const debit = debitCol !== null ? parseAmountValue(row[debitCol] ?? "") : null;
        const credit = creditCol !== null ? parseAmountValue(row[creditCol] ?? "") : null;
        if (debit !== null || credit !== null) amount = (credit ?? 0) - Math.abs(debit ?? 0);
      }
      if (!postedAt || amount === null || amount === 0) {
        skipped++;
        continue;
      }
      rows.push({
        postedAt,
        amount,
        payee: payeeCol !== null ? (row[payeeCol]?.trim() || null) : null,
        memo: memoCol !== null ? (row[memoCol]?.trim() || null) : null,
      });
    }
    return { rows, skipped };
  }, [rawRows, dateCol, dateFormat, amountMode, amountCol, flipSign, debitCol, creditCol, payeeCol, memoCol]);

  const previewMutation = useMutation({
    mutationFn: (rows: NormalizedRow[]) => api.post<ImportPreviewResponse>("/transactions/import/preview", { accountId, rows }),
    onSuccess: (res) => {
      setPreview(res);
      setSkippedCount(normalizedRows.skipped);
      setSelected(new Set(res.rows.filter((r) => !r.duplicate).map((r) => r.index)));
      setStep("preview");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't preview import"),
  });

  const commitMutation = useMutation({
    mutationFn: (rows: NormalizedRow[]) => api.post<ImportCommitResponse>("/transactions/import/commit", { accountId, rows }),
    onSuccess: (res) => {
      setResult(res);
      setStep("done");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Import failed"),
  });

  function onFileSelected(file: File) {
    setFileError(null);
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const all = results.data;
        const firstRow = all[0];
        if (!firstRow) {
          setFileError("That file looks empty.");
          return;
        }
        if (hasHeaderRow) {
          setHeaders(firstRow.map((h, i) => h.trim() || `Column ${i + 1}`));
          setRawRows(all.slice(1));
        } else {
          setHeaders(firstRow.map((_, i) => `Column ${i + 1}`));
          setRawRows(all);
        }
      },
      error: (err) => setFileError(err.message),
    });
  }

  function goToMap() {
    if (rawRows.length > 0) setStep("map");
  }

  function goToPreview() {
    setError(null);
    if (normalizedRows.rows.length === 0) {
      setError("No rows could be parsed with this mapping — check the date/amount columns.");
      return;
    }
    previewMutation.mutate(normalizedRows.rows);
  }

  function commit() {
    if (!preview) return;
    const rows = preview.rows.filter((r) => selected.has(r.index)).map((r) => ({ postedAt: r.postedAt, amount: r.amount, payee: r.payee, memo: r.memo }));
    if (rows.length === 0) {
      setError("Nothing selected to import.");
      return;
    }
    commitMutation.mutate(rows);
  }

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function startOver() {
    setStep("upload");
    setHeaders([]);
    setRawRows([]);
    setDateCol(null);
    setPayeeCol(null);
    setMemoCol(null);
    setAmountCol(null);
    setDebitCol(null);
    setCreditCol(null);
    setPreview(null);
    setSelected(new Set());
    setResult(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Import transactions</h1>
        <p className="text-sm text-slate-600">
          Bring in history beyond SimpleFIN's 90-day window from a bank's own CSV export — one account per import.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {step === "upload" && (
        <div className="card space-y-4 p-6">
          <label className="block text-sm font-medium text-slate-700">
            Account
            <Combobox
              options={[{ value: "", label: "Choose account…" }, ...accountOptions]}
              value={accountId}
              onChange={setAccountId}
              className="mt-1 max-w-sm"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && onFileSelected(e.target.files[0])}
              className="mt-1 block text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={hasHeaderRow} onChange={(e) => setHasHeaderRow(e.target.checked)} />
            First row is a header row
          </label>
          {fileError && <p className="text-sm text-red-600">{fileError}</p>}
          {rawRows.length > 0 && (
            <p className="text-sm text-slate-600">
              Parsed {rawRows.length} row(s), {headers.length} column(s).
            </p>
          )}
          <button
            onClick={goToMap}
            disabled={!accountId || rawRows.length === 0}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Next: map columns
          </button>
        </div>
      )}

      {step === "map" && (
        <div className="card space-y-5 p-6">
          <p className="text-sm text-slate-600">Importing into <strong>{selectedAccount?.displayName}</strong>. Match each field to a column from your file.</p>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <ColumnSelect label="Date" headers={headers} value={dateCol} onChange={setDateCol} />
            <label className="text-sm font-medium text-slate-700">
              Date format
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)} className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              </select>
            </label>
            <ColumnSelect label="Payee / description" headers={headers} value={payeeCol} onChange={setPayeeCol} />
            <ColumnSelect label="Memo (optional)" headers={headers} value={memoCol} onChange={setMemoCol} optional />
          </div>

          <div className="border-t border-slate-200 pt-4">
            <label className="text-sm font-medium text-slate-700">Amount</label>
            <div className="mt-2 flex gap-4 text-sm text-slate-600">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={amountMode === "single"} onChange={() => setAmountMode("single")} />
                Single column
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={amountMode === "debit_credit"} onChange={() => setAmountMode("debit_credit")} />
                Separate debit / credit columns
              </label>
            </div>
            {amountMode === "single" ? (
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <ColumnSelect label="Amount" headers={headers} value={amountCol} onChange={setAmountCol} />
                <label className="text-sm font-medium text-slate-700">
                  Sign convention
                  <select
                    value={flipSign ? "flip" : "as_is"}
                    onChange={(e) => setFlipSign(e.target.value === "flip")}
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                  >
                    <option value="as_is">Negative = money out (most common)</option>
                    <option value="flip">Negative = money in</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <ColumnSelect label="Debit (money out)" headers={headers} value={debitCol} onChange={setDebitCol} />
                <ColumnSelect label="Credit (money in)" headers={headers} value={creditCol} onChange={setCreditCol} />
              </div>
            )}
          </div>

          {rawRows.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview (first 3 rows)</p>
              <div className="space-y-1 text-sm text-slate-700">
                {normalizedRows.rows.slice(0, 3).map((r, i) => (
                  <p key={i}>
                    {r.postedAt} · {formatMoney(r.amount, selectedAccount?.currency ?? "CAD")} · {r.payee ?? "(no payee)"}
                  </p>
                ))}
                {normalizedRows.rows.length === 0 && <p className="text-slate-400">No valid rows yet — check your mapping.</p>}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep("upload")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Back
            </button>
            <button
              onClick={goToPreview}
              disabled={previewMutation.isPending}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {previewMutation.isPending ? "Checking…" : "Preview import"}
            </button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="card space-y-4 p-6">
          <p className="text-sm text-slate-600">
            {preview.rows.length} row(s) parsed, {preview.duplicateCount} flagged as possible duplicates (unchecked by default), {skippedCount} skipped (couldn't parse).
            {" "}{selected.size} selected to import.
          </p>
          <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-2"></th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Amount</th>
                  <th className="p-2">Payee</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.index} className={`border-t border-slate-100 ${r.duplicate ? "bg-amber-50" : ""}`}>
                    <td className="p-2">
                      <input type="checkbox" checked={selected.has(r.index)} onChange={() => toggleRow(r.index)} />
                    </td>
                    <td className="p-2">{r.postedAt}</td>
                    <td className="p-2">{formatMoney(r.amount, selectedAccount?.currency ?? "CAD")}</td>
                    <td className="p-2 truncate">{r.payee ?? "—"}</td>
                    <td className="p-2 text-xs text-amber-700">{r.duplicate ? "possible duplicate" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep("map")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Back
            </button>
            <button
              onClick={commit}
              disabled={commitMutation.isPending || selected.size === 0}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {commitMutation.isPending ? "Importing…" : `Import ${selected.size} transaction(s)`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="card space-y-3 p-6">
          <p className="text-sm text-slate-700">
            Imported {result.imported} transaction(s). {result.recategorized} transaction(s) auto-tagged by your existing rules.
          </p>
          <div className="flex gap-3">
            <Link to={`/transactions?accountId=${accountId}`} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white">
              View in Transactions
            </Link>
            <button onClick={startOver} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ColumnSelect({
  label,
  headers,
  value,
  onChange,
  optional,
}: {
  label: string;
  headers: string[];
  value: number | null;
  onChange: (v: number | null) => void;
  optional?: boolean;
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
      >
        <option value="">{optional ? "None" : "Choose column…"}</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}
