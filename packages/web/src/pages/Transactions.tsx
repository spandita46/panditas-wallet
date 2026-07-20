import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BENEFICIARIES,
  BENEFICIARY_LABELS,
  CATEGORY_KIND_LABELS,
  formatMoney,
  type AccountDTO,
  type Beneficiary,
  type CategoryDTO,
  type FamilyMemberDTO,
  type TransactionDTO,
  type TransactionListResponse,
} from "@panditas/shared";
import { api } from "../api";

const PAGE_SIZE = 30;

// Categories grouped by kind, expense first (most common), for <optgroup> rendering.
const KIND_ORDER = ["expense", "income", "transfer"] as const;
function categoryOptgroups(categories: CategoryDTO[]) {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: CATEGORY_KIND_LABELS[kind],
    items: categories.filter((c) => c.kind === kind),
  })).filter((g) => g.items.length > 0);
}

export function TransactionsPage() {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(""); // "", "__uncategorized__", or a categoryId
  const [beneficiaryFilter, setBeneficiaryFilter] = useState(""); // "", "__untagged__", or a Beneficiary
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<AccountDTO[]>("/accounts") });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.get<CategoryDTO[]>("/categories") });
  const family = useQuery({ queryKey: ["family-lookup"], queryFn: () => api.get<FamilyMemberDTO[]>("/users/lookup") });

  const params = new URLSearchParams();
  if (accountId) params.set("accountId", accountId);
  if (categoryFilter === "__uncategorized__") params.set("untaggedCategory", "1");
  else if (categoryFilter) params.set("categoryId", categoryFilter);
  if (beneficiaryFilter === "__untagged__") params.set("untaggedBeneficiary", "1");
  else if (beneficiaryFilter) params.set("beneficiary", beneficiaryFilter);
  if (search.trim()) params.set("search", search.trim());
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));

  const txns = useQuery({
    queryKey: ["transactions", params.toString()],
    queryFn: () => api.get<TransactionListResponse>(`/transactions?${params.toString()}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["transactions"] });

  const tag = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.patch(`/transactions/${v.id}`, v.body),
    onSuccess: invalidate,
  });

  const recategorize = useMutation({
    mutationFn: () => api.post<{ updated: number }>("/transactions/recategorize"),
    onSuccess: invalidate,
  });

  const total = txns.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Transactions</h1>
          <p className="text-sm text-slate-600">Tag each one with a category and who it was for.</p>
        </div>
        <button
          onClick={() => recategorize.mutate()}
          disabled={recategorize.isPending}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          {recategorize.isPending ? "Applying rules…" : "Recategorize uncategorized"}
        </button>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPage(0); }} className="input max-w-[12rem]">
          <option value="">All accounts</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }} className="input max-w-[12rem]">
          <option value="">All categories</option>
          <option value="__uncategorized__">Uncategorized</option>
          {categoryOptgroups(categories.data ?? []).map((g) => (
            <optgroup key={g.kind} label={g.label}>
              {g.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select value={beneficiaryFilter} onChange={(e) => { setBeneficiaryFilter(e.target.value); setPage(0); }} className="input max-w-[12rem]">
          <option value="">Anyone / anything</option>
          <option value="__untagged__">Untagged</option>
          {BENEFICIARIES.map((b) => (
            <option key={b} value={b}>
              {BENEFICIARY_LABELS[b]}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search payee/description…"
          className="input max-w-[16rem]"
        />
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
        {txns.isLoading && <p className="bg-white p-4 text-sm text-slate-500">Loading…</p>}
        {txns.data?.items.length === 0 && (
          <p className="bg-white p-4 text-sm text-slate-500">No transactions match these filters.</p>
        )}
        {txns.data?.items.map((t) => (
          <TxnRow
            key={t.id}
            txn={t}
            categories={categories.data ?? []}
            family={family.data ?? []}
            onSave={(body) => tag.mutate({ id: t.id, body })}
          />
        ))}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TxnRow({
  txn,
  categories,
  family,
  onSave,
}: {
  txn: TransactionDTO;
  categories: CategoryDTO[];
  family: FamilyMemberDTO[];
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [note, setNote] = useState(txn.beneficiaryNote ?? "");

  return (
    <div className="border-b border-slate-100 bg-white p-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-800">{txn.payee ?? txn.description ?? "—"}</p>
          <p className="text-xs text-slate-500">
            {new Date(txn.postedAt).toLocaleDateString("en-CA")} · {txn.accountName}
            {txn.pending && <span className="ml-1 text-amber-600">· pending</span>}
          </p>
        </div>
        <span className={`shrink-0 font-medium ${txn.amount < 0 ? "text-slate-800" : "text-green-600"}`}>
          {formatMoney(txn.amount)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={txn.categoryId ?? ""}
          onChange={(e) => onSave({ categoryId: e.target.value || null })}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">Uncategorized</option>
          {categoryOptgroups(categories).map((g) => (
            <optgroup key={g.kind} label={g.label}>
              {g.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <select
          value={txn.beneficiary ?? ""}
          onChange={(e) => onSave({ beneficiary: (e.target.value || null) as Beneficiary | null })}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">Who was it for?</option>
          {BENEFICIARIES.map((b) => (
            <option key={b} value={b}>
              {BENEFICIARY_LABELS[b]}
            </option>
          ))}
        </select>

        {txn.beneficiary === "family_member" && (
          <select
            value={txn.beneficiaryUserId ?? ""}
            onChange={(e) => onSave({ beneficiary: "family_member", beneficiaryUserId: e.target.value || null })}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">Which family member?</option>
            {family.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}

        {txn.beneficiary === "external" && (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => onSave({ beneficiary: "external", beneficiaryNote: note.trim() || null })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="e.g. gift for a friend"
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
        )}
      </div>
    </div>
  );
}
