import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BENEFICIARIES,
  BENEFICIARY_LABELS,
  CATEGORY_KIND_LABELS,
  RULE_MATCH_TYPES,
  formatMoney,
  type AccountDTO,
  type Beneficiary,
  type CategoryDTO,
  type CreateCategoryRuleInput,
  type FamilyMemberDTO,
  type RuleMatchType,
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

type DatePreset = "all" | "this_month" | "last_month" | "custom";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function thisMonthKey(): string {
  return monthKey(new Date());
}
function lastMonthKey(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return monthKey(d);
}

export function TransactionsPage() {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(""); // "", "__uncategorized__", or a categoryId
  const [beneficiaryFilter, setBeneficiaryFilter] = useState(""); // "", "__untagged__", or a Beneficiary
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);

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
  if (datePreset === "this_month") params.set("month", thisMonthKey());
  else if (datePreset === "last_month") params.set("month", lastMonthKey());
  else if (datePreset === "custom") {
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
  }
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

  // Create a rule, apply it to the transaction it was created from, then sweep
  // any other uncategorized transactions it now matches.
  const createRule = useMutation({
    mutationFn: async (v: { rule: CreateCategoryRuleInput; txnId: string; txnPatch: Record<string, unknown> }) => {
      await api.post("/categories/rules", v.rule);
      await api.patch(`/transactions/${v.txnId}`, v.txnPatch);
      return api.post<{ updated: number }>("/transactions/recategorize");
    },
    onSuccess: (res) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["category-rules"] });
      setRuleMessage(`Rule created.${res.updated > 0 ? ` ${res.updated} other transaction(s) tagged.` : ""}`);
      setTimeout(() => setRuleMessage(null), 5000);
    },
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

      {ruleMessage && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{ruleMessage}</div>
      )}

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
        <select
          value={datePreset}
          onChange={(e) => { setDatePreset(e.target.value as DatePreset); setPage(0); }}
          className="input max-w-[10rem]"
        >
          <option value="all">All dates</option>
          <option value="this_month">This month</option>
          <option value="last_month">Last month</option>
          <option value="custom">Custom range…</option>
        </select>
        {datePreset === "custom" && (
          <>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(0); }}
              className="input max-w-[9rem]"
            />
            <span className="self-center text-sm text-slate-500">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(0); }}
              className="input max-w-[9rem]"
            />
          </>
        )}
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
            accounts={accounts.data ?? []}
            onSave={(body) => tag.mutate({ id: t.id, body })}
            onCreateRule={(rule, txnPatch) => createRule.mutate({ rule, txnId: t.id, txnPatch })}
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
  accounts,
  onSave,
  onCreateRule,
}: {
  txn: TransactionDTO;
  categories: CategoryDTO[];
  family: FamilyMemberDTO[];
  accounts: AccountDTO[];
  onSave: (body: Record<string, unknown>) => void;
  onCreateRule: (rule: CreateCategoryRuleInput, txnPatch: Record<string, unknown>) => void;
}) {
  const [note, setNote] = useState(txn.beneficiaryNote ?? "");
  const [showRuleForm, setShowRuleForm] = useState(false);
  const category = categories.find((c) => c.id === txn.categoryId);
  const isTransferKind = category?.kind === "transfer";

  return (
    <div className="border-b border-slate-100 bg-white p-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-800">{txn.payee ?? txn.description ?? "—"}</p>
          <p className="text-xs text-slate-500">
            {new Date(txn.postedAt).toLocaleDateString("en-CA")} · {txn.accountName}
            {txn.pending && <span className="ml-1 text-amber-600">· pending</span>}
            {txn.transferAccountName && (
              <span className="ml-1 font-medium text-slate-600">
                {txn.amount < 0 ? " → " : " ← "}
                {txn.transferAccountName}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowRuleForm((s) => !s)}
          title="Create an auto-tag rule from this transaction"
          className={`shrink-0 rounded p-1 hover:bg-slate-100 ${showRuleForm ? "text-slate-900" : "text-slate-400"}`}
        >
          <RuleIcon />
        </button>
        <span className={`shrink-0 font-medium ${txn.amount < 0 ? "text-slate-800" : "text-green-600"}`}>
          {formatMoney(txn.amount)}
        </span>
      </div>

      {showRuleForm && (
        <CreateRuleForm
          txn={txn}
          categories={categories}
          accounts={accounts}
          onCancel={() => setShowRuleForm(false)}
          onCreate={(rule, txnPatch) => {
            onCreateRule(rule, txnPatch);
            setShowRuleForm(false);
          }}
        />
      )}

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

        {isTransferKind && (
          <select
            value={txn.transferAccountId ?? ""}
            onChange={(e) => onSave({ transferAccountId: e.target.value || null })}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">{txn.amount < 0 ? "To which account?" : "From which account?"}</option>
            {accounts
              .filter((a) => a.id !== txn.accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
          </select>
        )}

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

function RuleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 2.5H14.5L9.5 8.3V13L6.5 11.5V8.3L1.5 2.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CreateRuleForm({
  txn,
  categories,
  accounts,
  onCancel,
  onCreate,
}: {
  txn: TransactionDTO;
  categories: CategoryDTO[];
  accounts: AccountDTO[];
  onCancel: () => void;
  onCreate: (rule: CreateCategoryRuleInput, txnPatch: Record<string, unknown>) => void;
}) {
  const [matchType, setMatchType] = useState<RuleMatchType>(txn.payee ? "payee_contains" : "account");
  const [pattern, setPattern] = useState(txn.payee ?? "");
  const [categoryId, setCategoryId] = useState(txn.categoryId ?? "");
  const [linkedAccountId, setLinkedAccountId] = useState(txn.transferAccountId ?? "");

  const canCreate = !!categoryId && (matchType === "account" || pattern.trim().length > 0);

  const submit = () => {
    if (!canCreate) return;
    const rule: CreateCategoryRuleInput = {
      categoryId,
      matchType,
      matchAccountId: matchType === "account" ? txn.accountId : undefined,
      pattern: matchType !== "account" ? pattern.trim() : undefined,
      linkedAccountId: linkedAccountId || undefined,
      priority: 10,
    };
    const txnPatch: Record<string, unknown> = { categoryId, transferAccountId: linkedAccountId || null };
    onCreate(rule, txnPatch);
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-600">Create an auto-tag rule from this transaction</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={matchType}
          onChange={(e) => setMatchType(e.target.value as RuleMatchType)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
        >
          {RULE_MATCH_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "account" ? `This account (${txn.accountName})` : t === "payee_contains" ? "Payee contains…" : "Description matches…"}
            </option>
          ))}
        </select>
        {matchType !== "account" && (
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Text to match"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
          />
        )}
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
        >
          <option value="">Category…</option>
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
          value={linkedAccountId}
          onChange={(e) => setLinkedAccountId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
        >
          <option value="">Links to account… (optional)</option>
          {accounts
            .filter((a) => a.id !== txn.accountId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
        </select>
      </div>
      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="text-xs text-slate-500 underline">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canCreate}
          className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Create rule
        </button>
      </div>
    </div>
  );
}
