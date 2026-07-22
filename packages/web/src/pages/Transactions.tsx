import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BENEFICIARIES,
  BENEFICIARY_LABELS,
  CATEGORY_KIND_LABELS,
  formatMoney,
  type AccountDTO,
  type Beneficiary,
  type CategoryDTO,
  type CreateCategoryRuleInput,
  type FamilyMemberDTO,
  type RuleConditionType,
  type TransactionDTO,
  type TransactionListResponse,
  type TransactionRowDTO,
} from "@panditas/shared";
import { api } from "../api";
import { Combobox, type ComboboxItem } from "../components/ui/Combobox";
import { SegmentedControl } from "../components/ui/SegmentedControl";

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

// Combobox option builders — accounts/family are flat lists, categories stay
// grouped by kind (in the same expense/income/transfer order as above).
function accountOptions(accounts: AccountDTO[], placeholder: string, excludeId?: string): ComboboxItem[] {
  return [
    { value: "", label: placeholder },
    ...accounts.filter((a) => a.id !== excludeId).map((a) => ({ value: a.id, label: a.displayName })),
  ];
}
function categoryPickOptions(categories: CategoryDTO[], placeholder: string, extra: ComboboxItem[] = []): ComboboxItem[] {
  return [
    { value: "", label: placeholder },
    ...extra,
    ...categoryOptgroups(categories).flatMap((g) =>
      g.items.map((c) => ({ value: c.id, label: c.name, group: g.label })),
    ),
  ];
}
function familyOptions(family: FamilyMemberDTO[], placeholder: string): ComboboxItem[] {
  return [{ value: "", label: placeholder }, ...family.map((f) => ({ value: f.id, label: f.name }))];
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
  // Seeded once from the URL — lets Dashboard/Budget deep-link into a
  // pre-filtered view (e.g. a calendar day, a credit card, a budget category).
  const [searchParams] = useSearchParams();
  const initialGroupIds = (searchParams.get("categoryIds") ?? "").split(",").filter(Boolean);

  const [accountId, setAccountId] = useState(() => searchParams.get("accountId") ?? "");
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get("categoryId") ?? ""); // "", "__uncategorized__", or a categoryId
  const [categoryGroup, setCategoryGroup] = useState<{ ids: string[]; label: string } | null>(() =>
    initialGroupIds.length > 0
      ? { ids: initialGroupIds, label: searchParams.get("groupLabel") ?? "Selected categories" }
      : null,
  );
  const [beneficiaryFilter, setBeneficiaryFilter] = useState(""); // "", "__untagged__", or a Beneficiary
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>(() =>
    searchParams.get("from") || searchParams.get("to") ? "custom" : "all",
  );
  const [fromDate, setFromDate] = useState(() => searchParams.get("from") ?? "");
  const [toDate, setToDate] = useState(() => searchParams.get("to") ?? "");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [page, setPage] = useState(0);
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);
  const [showAddTxn, setShowAddTxn] = useState(false);

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<AccountDTO[]>("/accounts"),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<CategoryDTO[]>("/categories"),
  });
  const family = useQuery({
    queryKey: ["family-lookup"],
    queryFn: () => api.get<FamilyMemberDTO[]>("/users/lookup"),
  });

  const params = new URLSearchParams();
  if (accountId) params.set("accountId", accountId);
  if (categoryGroup) params.set("categoryIds", categoryGroup.ids.join(","));
  else if (categoryFilter === "__uncategorized__") params.set("untaggedCategory", "1");
  else if (categoryFilter) params.set("categoryId", categoryFilter);
  if (beneficiaryFilter === "__untagged__")
    params.set("untaggedBeneficiary", "1");
  else if (beneficiaryFilter) params.set("beneficiary", beneficiaryFilter);
  if (search.trim()) params.set("search", search.trim());
  if (datePreset === "this_month") params.set("month", thisMonthKey());
  else if (datePreset === "last_month") params.set("month", lastMonthKey());
  else if (datePreset === "custom") {
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
  }
  if (minAmount.trim()) params.set("minAmount", minAmount.trim());
  if (maxAmount.trim()) params.set("maxAmount", maxAmount.trim());
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));

  const txns = useQuery({
    queryKey: ["transactions", params.toString()],
    queryFn: () =>
      api.get<TransactionListResponse>(`/transactions?${params.toString()}`),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["transactions"] });

  const tag = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/transactions/${v.id}`, v.body),
    onSuccess: invalidate,
  });

  const recategorize = useMutation({
    mutationFn: () =>
      api.post<{ updated: number }>("/transactions/recategorize"),
    onSuccess: invalidate,
  });

  const linkTransfer = useMutation({
    mutationFn: (v: { id: string; counterpartTransactionId: string }) =>
      api.post(`/transactions/${v.id}/link-transfer`, {
        counterpartTransactionId: v.counterpartTransactionId,
      }),
    onSuccess: invalidate,
  });

  // Create a rule, apply it to the transaction it was created from, then sweep
  // any other uncategorized transactions it now matches.
  const createRule = useMutation({
    mutationFn: async (v: {
      rule: CreateCategoryRuleInput;
      txnId: string;
      txnPatch: Record<string, unknown>;
    }) => {
      await api.post("/categories/rules", v.rule);
      await api.patch(`/transactions/${v.txnId}`, v.txnPatch);
      return api.post<{ updated: number }>("/transactions/recategorize");
    },
    onSuccess: (res) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["category-rules"] });
      setRuleMessage(
        `Rule created.${res.updated > 0 ? ` ${res.updated} other transaction(s) tagged.` : ""}`,
      );
      setTimeout(() => setRuleMessage(null), 5000);
    },
  });

  const createManualTxn = useMutation({
    mutationFn: (v: { accountId: string; postedAt: string; amount: number; payee?: string; description?: string; categoryId?: string }) =>
      api.post("/transactions/manual", v),
    onSuccess: () => {
      setShowAddTxn(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const total = txns.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Transactions
          </h1>
          <p className="text-sm text-slate-600">
            Tag each one with a category and who it was for.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddTxn((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            {showAddTxn ? "Cancel" : "+ Add transaction"}
          </button>
          <button
            onClick={() => recategorize.mutate()}
            disabled={recategorize.isPending}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {recategorize.isPending
              ? "Applying rules…"
              : "Recategorize uncategorized"}
          </button>
        </div>
      </header>

      {ruleMessage && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {ruleMessage}
        </div>
      )}

      {showAddTxn && (
        <AddTransactionForm
          accounts={accounts.data ?? []}
          categories={categories.data ?? []}
          busy={createManualTxn.isPending}
          onSubmit={(v) => createManualTxn.mutate(v)}
        />
      )}

      {/* Filters */}
      <div className="card flex flex-wrap gap-2 p-3">
        <Combobox
          options={accountOptions(accounts.data ?? [], "All accounts")}
          value={accountId}
          onChange={(v) => {
            setAccountId(v);
            setPage(0);
          }}
          className="max-w-[12rem]"
        />
        {categoryGroup ? (
          <span className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800 ring-1 ring-accent-200">
            Group: <strong className="truncate">{categoryGroup.label}</strong>
            <button
              onClick={() => {
                setCategoryGroup(null);
                setPage(0);
              }}
              className="shrink-0 text-accent-600 hover:text-accent-900"
              title="Clear group filter"
            >
              ✕
            </button>
          </span>
        ) : (
          <Combobox
            options={categoryPickOptions(categories.data ?? [], "All categories", [
              { value: "__uncategorized__", label: "Uncategorized" },
            ])}
            value={categoryFilter}
            onChange={(v) => {
              setCategoryFilter(v);
              setPage(0);
            }}
            className="max-w-[12rem]"
          />
        )}
        <select
          value={beneficiaryFilter}
          onChange={(e) => {
            setBeneficiaryFilter(e.target.value);
            setPage(0);
          }}
          className="input max-w-[12rem]"
        >
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
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search payee/description…"
          className="input max-w-[16rem]"
        />
        <SegmentedControl
          value={datePreset}
          onChange={(v) => {
            setDatePreset(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "this_month", label: "This month" },
            { value: "last_month", label: "Last month" },
            { value: "custom", label: "Custom…" },
          ]}
        />
        {datePreset === "custom" && (
          <>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(0);
              }}
              className="input max-w-[9rem]"
            />
            <span className="self-center text-sm text-slate-500">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(0);
              }}
              className="input max-w-[9rem]"
            />
          </>
        )}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={minAmount}
          onChange={(e) => {
            setMinAmount(e.target.value);
            setPage(0);
          }}
          placeholder="Min $"
          className="input max-w-[6.5rem]"
        />
        <span className="self-center text-sm text-slate-500">–</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={maxAmount}
          onChange={(e) => {
            setMaxAmount(e.target.value);
            setPage(0);
          }}
          placeholder="Max $"
          className="input max-w-[6.5rem]"
        />
      </div>

      {/* List */}
      <div className="card">
        {txns.isLoading && (
          <p className="bg-white p-4 text-sm text-slate-500">Loading…</p>
        )}
        {txns.data?.items.length === 0 && (
          <p className="bg-white p-4 text-sm text-slate-500">
            No transactions match these filters.
          </p>
        )}
        {txns.data?.items.map((t) => (
          <TxnRow
            key={t.id}
            txn={t}
            categories={categories.data ?? []}
            family={family.data ?? []}
            accounts={accounts.data ?? []}
            onSave={(body) => tag.mutate({ id: t.id, body })}
            onCreateRule={(rule, txnPatch) =>
              createRule.mutate({ rule, txnId: t.id, txnPatch })
            }
            onLinkTransfer={(counterpartTransactionId) =>
              linkTransfer.mutate({ id: t.id, counterpartTransactionId })
            }
          />
        ))}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{" "}
            {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => 0)}
              disabled={page === 0}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              First
            </button>
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
            <button
              onClick={() => setPage((p) => pageCount - 1)}
              disabled={page >= pageCount - 1}
              className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
            >
              Last
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
  onLinkTransfer,
}: {
  txn: TransactionRowDTO;
  categories: CategoryDTO[];
  family: FamilyMemberDTO[];
  accounts: AccountDTO[];
  onSave: (body: Record<string, unknown>) => void;
  onCreateRule: (
    rule: CreateCategoryRuleInput,
    txnPatch: Record<string, unknown>,
  ) => void;
  onLinkTransfer: (counterpartTransactionId: string) => void;
}) {
  const [note, setNote] = useState(txn.beneficiaryNote ?? "");
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const category = categories.find((c) => c.id === txn.categoryId);
  const isTransferKind = category?.kind === "transfer";
  const showSuggestion = txn.transferSuggestion && !txn.transferAccountId && !suggestionDismissed;

  return (
    <div className="border-b border-slate-100 bg-white p-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-800">
            {txn.payee ?? txn.description ?? "—"}
          </p>
          <p className="text-xs text-slate-500">
            {new Date(txn.postedAt).toLocaleDateString("en-CA")} ·{" "}
            {txn.accountName}
            {txn.pending && (
              <span className="ml-1 text-amber-600">· pending</span>
            )}
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
        <span
          className={`shrink-0 font-medium ${txn.amount < 0 ? "text-slate-800" : "text-green-600"}`}
        >
          {formatMoney(txn.amount)}
        </span>
      </div>

      {showSuggestion && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <span>
            Looks like a transfer with <strong>{txn.transferSuggestion!.accountName}</strong> (
            {txn.transferSuggestion!.confidence}% match)
          </span>
          <div className="flex shrink-0 gap-3">
            <button onClick={() => setSuggestionDismissed(true)} className="text-blue-700 underline">
              Dismiss
            </button>
            <button
              onClick={() => onLinkTransfer(txn.transferSuggestion!.candidateTransactionId)}
              className="rounded-lg bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700"
            >
              Link
            </button>
          </div>
        </div>
      )}

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
        <Combobox
          options={categoryPickOptions(categories, "Uncategorized")}
          value={txn.categoryId ?? ""}
          onChange={(v) => onSave({ categoryId: v || null })}
          className="w-40"
          inputClassName="rounded-lg border border-slate-300 px-2 py-1 text-xs"
        />

        <select
          value={txn.beneficiary ?? ""}
          onChange={(e) =>
            onSave({
              beneficiary: (e.target.value || null) as Beneficiary | null,
            })
          }
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
          <Combobox
            options={accountOptions(
              accounts,
              txn.amount < 0 ? "To which account?" : "From which account?",
              txn.accountId,
            )}
            value={txn.transferAccountId ?? ""}
            onChange={(v) => onSave({ transferAccountId: v || null })}
            className="w-40"
            inputClassName="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
        )}

        {txn.beneficiary === "family_member" && (
          <Combobox
            options={familyOptions(family, "Which family member?")}
            value={txn.beneficiaryUserId ?? ""}
            onChange={(v) =>
              onSave({
                beneficiary: "family_member",
                beneficiaryUserId: v || null,
              })
            }
            className="w-40"
            inputClassName="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
        )}

        {txn.beneficiary === "external" && (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() =>
              onSave({
                beneficiary: "external",
                beneficiaryNote: note.trim() || null,
              })
            }
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
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
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
  onCreate: (
    rule: CreateCategoryRuleInput,
    txnPatch: Record<string, unknown>,
  ) => void;
}) {
  const [matchType, setMatchType] = useState<Exclude<RuleConditionType, "amount_range">>(
    txn.payee ? "payee_contains" : "account",
  );
  const [pattern, setPattern] = useState(txn.payee ?? "");
  const [categoryId, setCategoryId] = useState(txn.categoryId ?? "");
  const [linkedAccountId, setLinkedAccountId] = useState(
    txn.transferAccountId ?? "",
  );

  const canCreate =
    !!categoryId && (matchType === "account" || pattern.trim().length > 0);

  const submit = () => {
    if (!canCreate) return;
    const rule: CreateCategoryRuleInput = {
      categoryId,
      logic: "all",
      conditions: [
        {
          type: matchType,
          matchAccountId: matchType === "account" ? txn.accountId : undefined,
          pattern: matchType !== "account" ? pattern.trim() : undefined,
        },
      ],
      linkedAccountId: linkedAccountId || undefined,
      priority: 10,
    };
    const txnPatch: Record<string, unknown> = {
      categoryId,
      transferAccountId: linkedAccountId || null,
    };
    onCreate(rule, txnPatch);
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-600">
        Create an auto-tag rule from this transaction
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={matchType}
          onChange={(e) => setMatchType(e.target.value as Exclude<RuleConditionType, "amount_range">)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
        >
          <option value="account">This account ({txn.accountName})</option>
          <option value="payee_contains">Payee contains…</option>
          <option value="description_regex">Description matches…</option>
        </select>
        {matchType !== "account" && (
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Text to match"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
          />
        )}
        <Combobox
          options={categoryPickOptions(categories, "Category…")}
          value={categoryId}
          onChange={setCategoryId}
          className="w-40"
          inputClassName="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
        />
        <Combobox
          options={accountOptions(accounts, "Links to account… (optional)", txn.accountId)}
          value={linkedAccountId}
          onChange={setLinkedAccountId}
          className="w-48"
          inputClassName="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
        />
      </div>
      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="text-xs text-slate-500 underline">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canCreate}
          className="rounded-lg bg-accent-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Create rule
        </button>
      </div>
    </div>
  );
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddTransactionForm({
  accounts,
  categories,
  busy,
  onSubmit,
}: {
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  busy: boolean;
  onSubmit: (v: { accountId: string; postedAt: string; amount: number; payee?: string; description?: string; categoryId?: string }) => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [postedAt, setPostedAt] = useState(todayDate());
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const canSubmit = accountId && postedAt && Number(amount) > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const magnitude = Math.abs(Number(amount));
    if (!accountId || !magnitude) return;
    onSubmit({
      accountId,
      postedAt,
      amount: direction === "in" ? magnitude : -magnitude,
      ...(payee.trim() ? { payee: payee.trim() } : {}),
      ...(categoryId ? { categoryId } : {}),
    });
    setAmount("");
    setPayee("");
    setCategoryId("");
  };

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-4">
      <label className="text-xs font-medium text-slate-600">
        Account
        <Combobox
          options={accountOptions(accounts, "Choose account…")}
          value={accountId}
          onChange={setAccountId}
          className="mt-1 w-44"
          inputClassName="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Date
        <input
          type="date"
          value={postedAt}
          onChange={(e) => setPostedAt(e.target.value)}
          required
          className="mt-1 block w-36 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Direction
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as "in" | "out")}
          className="mt-1 block w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          <option value="out">Money out</option>
          <option value="in">Money in</option>
        </select>
      </label>
      <label className="text-xs font-medium text-slate-600">
        Amount
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className="mt-1 block w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Payee
        <input
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
          placeholder="Optional"
          className="mt-1 block w-40 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Category
        <Combobox
          options={categoryPickOptions(categories, "Optional")}
          value={categoryId}
          onChange={setCategoryId}
          className="mt-1 w-40"
          inputClassName="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={!canSubmit || busy}
        className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-700 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add transaction"}
      </button>
    </form>
  );
}
