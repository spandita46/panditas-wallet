import { formatMoney, type ImportPreviewRow } from "@panditas/shared";

// Checkbox + duplicate-highlighted preview table, shared between the manual
// CSV import wizard (Import.tsx) and folder sync's review queue
// (FolderSyncPage.tsx) — the two flows differ in everything around this
// table (single-file wizard vs. multi-file queue), but the table itself is
// identical.
export function ImportRowTable({
  rows,
  selected,
  onToggle,
  currency = "CAD",
}: {
  rows: ImportPreviewRow[];
  selected: Set<number>;
  onToggle: (index: number) => void;
  currency?: string;
}) {
  return (
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
          {rows.map((r) => (
            <tr key={r.index} className={`border-t border-slate-100 ${r.duplicate ? "bg-amber-50" : ""}`}>
              <td className="p-2">
                <input type="checkbox" checked={selected.has(r.index)} onChange={() => onToggle(r.index)} />
              </td>
              <td className="p-2">{r.postedAt}</td>
              <td className="p-2">{formatMoney(r.amount, currency)}</td>
              <td className="p-2 truncate">{r.payee ?? "—"}</td>
              <td className="p-2 text-xs text-amber-700">{r.duplicate ? "possible duplicate" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
