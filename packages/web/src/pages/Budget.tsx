import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BENEFICIARIES,
  BENEFICIARY_LABELS,
  CATEGORY_KINDS,
  CATEGORY_KIND_LABELS,
  RULE_CONDITION_TYPES,
  formatMoney,
  type AccountDTO,
  type Beneficiary,
  type BudgetLineDTO,
  type CategoryDTO,
  type CategoryKind,
  type CategoryRuleDTO,
  type FamilyMemberDTO,
  type RuleConditionType,
  type RuleLogic,
  type SpendingBreakdown,
} from "@panditas/shared";
import { api } from "../api";
import { Card } from "../components/ui/Card";
import { SectionHeader } from "../components/ui/SectionHeader";
import { Combobox, type ComboboxItem } from "../components/ui/Combobox";
import { Donut } from "../components/ui/Donut";
import { monthEndDate, monthKey, monthLabel, shiftMonth } from "../lib/month";
import { transactionsLink } from "../lib/transactionsLink";

// Categories grouped by kind, expense first (most common), for <optgroup> rendering.
const KIND_ORDER = ["expense", "income", "transfer"] as const;
function categoryOptgroups(categories: CategoryDTO[]) {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: CATEGORY_KIND_LABELS[kind],
    items: categories.filter((c) => c.kind === kind),
  })).filter((g) => g.items.length > 0);
}

function categoryPickOptions(categories: CategoryDTO[], placeholder: string): ComboboxItem[] {
  return [
    { value: "", label: placeholder },
    ...categoryOptgroups(categories).flatMap((g) =>
      g.items.map((c) => ({ value: c.id, label: c.name, group: g.label })),
    ),
  ];
}
function accountOptions(accounts: AccountDTO[], placeholder: string): ComboboxItem[] {
  return [{ value: "", label: placeholder }, ...accounts.map((a) => ({ value: a.id, label: a.displayName }))];
}

// ---- Rule condition builder --------------------------------------------

interface ConditionDraft {
  type: RuleConditionType;
  matchAccountId: string;
  pattern: string;
  minAmount: string;
  maxAmount: string;
}
function emptyCondition(): ConditionDraft {
  return { type: "payee_contains", matchAccountId: "", pattern: "", minAmount: "", maxAmount: "" };
}
function conditionValid(c: ConditionDraft): boolean {
  if (c.type === "account") return !!c.matchAccountId;
  if (c.type === "amount_range") return c.minAmount.trim() !== "" || c.maxAmount.trim() !== "";
  return c.pattern.trim().length > 0;
}
function toConditionPayload(c: ConditionDraft) {
  return {
    type: c.type,
    matchAccountId: c.type === "account" ? c.matchAccountId : undefined,
    pattern: c.type === "payee_contains" || c.type === "description_regex" ? c.pattern.trim() : undefined,
    minAmount: c.type === "amount_range" && c.minAmount.trim() !== "" ? Number(c.minAmount) : undefined,
    maxAmount: c.type === "amount_range" && c.maxAmount.trim() !== "" ? Number(c.maxAmount) : undefined,
  };
}

interface RuleFormState {
  categoryId: string;
  logic: RuleLogic;
  conditions: ConditionDraft[];
  linkedAccountId: string;
  beneficiary: Beneficiary | null;
  beneficiaryUserId: string;
}
function emptyRuleForm(): RuleFormState {
  return { categoryId: "", logic: "all", conditions: [emptyCondition()], linkedAccountId: "", beneficiary: null, beneficiaryUserId: "" };
}

function summarizeCondition(c: CategoryRuleDTO["conditions"][number]): string {
  switch (c.type) {
    case "account":
      return `Account is ${c.matchAccountName ?? "?"}`;
    case "payee_contains":
      return `Payee contains "${c.pattern}"`;
    case "description_regex":
      return `Description matches "${c.pattern}"`;
    case "amount_range":
      if (c.minAmount != null && c.maxAmount != null) return `Amount $${c.minAmount}–$${c.maxAmount}`;
      if (c.minAmount != null) return `Amount ≥ $${c.minAmount}`;
      if (c.maxAmount != null) return `Amount ≤ $${c.maxAmount}`;
      return "Amount (any)";
  }
}
function summarizeRule(r: CategoryRuleDTO): string {
  return r.conditions.map(summarizeCondition).join(r.logic === "any" ? " OR " : " AND ");
}

function ConditionEditor({
  condition,
  accounts,
  onChange,
  onRemove,
}: {
  condition: ConditionDraft;
  accounts: AccountDTO[];
  onChange: (c: ConditionDraft) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
      <select
        value={condition.type}
        onChange={(e) => onChange({ ...condition, type: e.target.value as RuleConditionType })}
        className="input max-w-[10rem]"
      >
        {RULE_CONDITION_TYPES.map((t) => (
          <option key={t} value={t}>
            {t === "account"
              ? "Account is"
              : t === "payee_contains"
                ? "Payee contains"
                : t === "description_regex"
                  ? "Description matches"
                  : "Amount between"}
          </option>
        ))}
      </select>
      {condition.type === "account" ? (
        <Combobox
          options={accountOptions(accounts, "Account…")}
          value={condition.matchAccountId}
          onChange={(v) => onChange({ ...condition, matchAccountId: v })}
          className="max-w-[12rem]"
        />
      ) : condition.type === "amount_range" ? (
        <>
          <input
            type="number"
            value={condition.minAmount}
            onChange={(e) => onChange({ ...condition, minAmount: e.target.value })}
            placeholder="Min $"
            className="input w-24"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="number"
            value={condition.maxAmount}
            onChange={(e) => onChange({ ...condition, maxAmount: e.target.value })}
            placeholder="Max $ (optional)"
            className="input w-28"
          />
        </>
      ) : (
        <input
          value={condition.pattern}
          onChange={(e) => onChange({ ...condition, pattern: e.target.value })}
          placeholder="Text to match"
          className="input max-w-[12rem]"
        />
      )}
      {onRemove && (
        <button onClick={onRemove} className="text-xs text-slate-400 hover:text-slate-600" title="Remove condition">
          ✕
        </button>
      )}
    </div>
  );
}

export function BudgetPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [showManage, setShowManage] = useState(true);

  const budgets = useQuery({
    queryKey: ["budgets", month],
    queryFn: () => api.get<BudgetLineDTO[]>(`/budgets?month=${month}`),
  });
  const insights = useQuery({
    queryKey: ["insights", month],
    queryFn: () => api.get<SpendingBreakdown>(`/insights/spending?month=${month}`),
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.get<CategoryDTO[]>("/categories") });

  const invalidateBudgets = () => queryClient.invalidateQueries({ queryKey: ["budgets"] });

  const setLimit = useMutation({
    mutationFn: (v: { categoryId: string; limit: number }) =>
      api.put("/budgets", { categoryId: v.categoryId, month, limit: v.limit }),
    onSuccess: invalidateBudgets,
  });
  const clearOverride = useMutation({
    mutationFn: (categoryId: string) => api.del(`/budgets?categoryId=${categoryId}&month=${month}`),
    onSuccess: invalidateBudgets,
  });

  const grouped = groupBy(budgets.data ?? [], (l) => l.group ?? "Other");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Budget</h1>
          <p className="text-sm text-slate-600">Limits vs. actual spend, and who's spending on what.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="px-2 text-slate-500 hover:text-slate-900">
            ‹
          </button>
          <span className="min-w-[9rem] text-center text-sm font-medium text-slate-800">{monthLabel(month)}</span>
          <button onClick={() => setMonth((m) => shiftMonth(m, 1))} className="px-2 text-slate-500 hover:text-slate-900">
            ›
          </button>
        </div>
      </header>

      {/* Breakdowns — who paid, who it was for */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BreakdownCard title="Spending by who paid" entries={insights.data?.byOwner ?? []} />
        <BreakdownCard title="Spending by who it was for" entries={insights.data?.byBeneficiary ?? []} />
      </div>

      {/* Category budgets */}
      <div className="space-y-5">
        {Object.entries(grouped).map(([group, lines]) => {
          const spentTotal = lines.reduce((sum, l) => sum + l.spent, 0);
          const linesWithLimit = lines.filter((l) => l.limit !== null);
          const limitTotal = linesWithLimit.reduce((sum, l) => sum + (l.limit ?? 0), 0);
          return (
            <section key={group}>
              <div className="mb-2 flex items-baseline justify-between">
                <Link
                  to={transactionsLink({
                    categoryIds: lines.map((l) => l.categoryId).join(","),
                    groupLabel: group,
                    from: month,
                    to: monthEndDate(month),
                  })}
                  className="text-sm font-semibold uppercase tracking-wide text-slate-500 hover:text-accent-700 hover:underline"
                >
                  {group}
                </Link>
                <span className="text-xs font-medium text-slate-500">
                  {formatMoney(spentTotal)}
                  {linesWithLimit.length > 0 && <> of {formatMoney(limitTotal)} budgeted</>}
                </span>
              </div>
              <div className="card">
                {lines.map((l) => (
                  <BudgetRow
                    key={l.categoryId}
                    line={l}
                    month={month}
                    onSetLimit={(limit) => setLimit.mutate({ categoryId: l.categoryId, limit })}
                    onClearOverride={() => clearOverride.mutate(l.categoryId)}
                  />
                ))}
              </div>
            </section>
          );
        })}
        {budgets.data?.length === 0 && (
          <p className="text-sm text-slate-500">No categories yet — add one below.</p>
        )}
      </div>

      {/* Manage categories & rules */}
      <div>
        <button onClick={() => setShowManage((s) => !s)} className="text-sm font-medium text-slate-600 underline">
          {showManage ? "Hide" : "Manage categories & auto-tag rules"}
        </button>
        {showManage && <ManageCategories categories={categories.data ?? []} />}
      </div>
    </div>
  );
}

function BudgetRow({
  line,
  month,
  onSetLimit,
  onClearOverride,
}: {
  line: BudgetLineDTO;
  month: string;
  onSetLimit: (limit: number) => void;
  onClearOverride: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(line.limit !== null ? String(line.limit) : "");

  // Over/under-limit alarm styling only makes sense for expense categories —
  // income and transfers don't have a "budget" in the overspending sense.
  const isExpense = line.kind === "expense";
  const pct = line.limit && line.limit > 0 ? Math.min(100, (line.spent / line.limit) * 100) : null;
  const over = isExpense && line.limit !== null && line.spent > line.limit;
  const barColor = !isExpense ? "bg-slate-400" : over ? "bg-liability-500" : (pct ?? 0) >= 80 ? "bg-amber-500" : "bg-asset-500";

  const commit = () => {
    const n = Number(value);
    setEditing(false);
    if (Number.isFinite(n) && n >= 0 && n !== line.limit) onSetLimit(n);
  };

  return (
    <div className="border-b border-slate-100 bg-white p-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <Link
          to={transactionsLink({ categoryId: line.categoryId, from: month, to: monthEndDate(month) })}
          className="font-medium text-slate-800 hover:text-accent-700 hover:underline"
        >
          {line.categoryName}
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <span className={over ? "font-semibold text-liability-600" : "text-slate-700"}>{formatMoney(line.spent)}</span>
          <span className="text-slate-400">/</span>
          {editing ? (
            <input
              autoFocus
              type="number"
              min="0"
              step="1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right"
            />
          ) : (
            <button onClick={() => setEditing(true)} className="text-slate-500 underline decoration-dotted">
              {line.limit !== null ? formatMoney(line.limit) : "set limit"}
            </button>
          )}
          {!line.isDefaultLimit && (
            <button onClick={onClearOverride} title="Reset to default limit" className="text-xs text-slate-400 hover:text-slate-600">
              ↺
            </button>
          )}
        </div>
      </div>
      {line.limit !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct ?? 100}%` }} />
        </div>
      )}
    </div>
  );
}

function BreakdownCard({ title, entries }: { title: string; entries: { key: string; label: string; total: number }[] }) {
  return (
    <Card>
      <SectionHeader>{title}</SectionHeader>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">No spending yet this month.</p>
      ) : (
        <Donut data={entries.map((e) => ({ label: e.label, value: e.total }))} />
      )}
    </Card>
  );
}

// Encodes {beneficiary, beneficiaryUserId} as a single <select> value: "" (no
// default), "self"/"household"/"external", or "family_member:<userId>".
function encodeBeneficiary(beneficiary: Beneficiary | null, beneficiaryUserId: string | null): string {
  if (!beneficiary) return "";
  if (beneficiary === "family_member") return beneficiaryUserId ? `family_member:${beneficiaryUserId}` : "";
  return beneficiary;
}
function decodeBeneficiary(value: string): { beneficiary: Beneficiary | null; beneficiaryUserId: string | null } {
  if (!value) return { beneficiary: null, beneficiaryUserId: null };
  if (value.startsWith("family_member:")) {
    return { beneficiary: "family_member", beneficiaryUserId: value.slice("family_member:".length) };
  }
  return { beneficiary: value as Beneficiary, beneficiaryUserId: null };
}

function BeneficiarySelect({
  value,
  onChange,
  family,
  className,
}: {
  value: string;
  onChange: (beneficiary: Beneficiary | null, beneficiaryUserId: string | null) => void;
  family: FamilyMemberDTO[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        const { beneficiary, beneficiaryUserId } = decodeBeneficiary(e.target.value);
        onChange(beneficiary, beneficiaryUserId);
      }}
      className={className}
    >
      <option value="">No default</option>
      {BENEFICIARIES.filter((b) => b !== "family_member").map((b) => (
        <option key={b} value={b}>
          {BENEFICIARY_LABELS[b]}
        </option>
      ))}
      {family.map((f) => (
        <option key={f.id} value={`family_member:${f.id}`}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

function CategoryListItem({
  category,
  family,
  onGroupChange,
  onToggleArchived,
  onDefaultBeneficiary,
}: {
  category: CategoryDTO;
  family: FamilyMemberDTO[];
  onGroupChange: (group: string | null) => void;
  onToggleArchived: () => void;
  onDefaultBeneficiary: (beneficiary: Beneficiary | null, beneficiaryUserId: string | null) => void;
}) {
  const [group, setGroupValue] = useState(category.group ?? "");

  const commit = () => {
    const next = group.trim();
    if (next !== (category.group ?? "")) onGroupChange(next || null);
  };

  return (
    <div className={`flex flex-wrap items-center justify-between gap-y-1 py-1 text-sm ${category.archived ? "opacity-50" : ""}`}>
      <span className="flex flex-wrap items-center gap-2">
        {category.name}
        <input
          value={group}
          onChange={(e) => setGroupValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          list="category-groups"
          placeholder="No group"
          className="w-24 rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600"
        />
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${
            category.kind === "income"
              ? "bg-green-100 text-green-700"
              : category.kind === "transfer"
                ? "bg-slate-200 text-slate-600"
                : "bg-blue-50 text-blue-700"
          }`}
        >
          {CATEGORY_KIND_LABELS[category.kind]}
        </span>
        <BeneficiarySelect
          value={encodeBeneficiary(category.defaultBeneficiary, category.defaultBeneficiaryUserId)}
          onChange={onDefaultBeneficiary}
          family={family}
          className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600"
        />
      </span>
      <button onClick={onToggleArchived} className="text-xs text-slate-500 underline">
        {category.archived ? "Unarchive" : "Archive"}
      </button>
    </div>
  );
}

function ManageCategories({ categories }: { categories: CategoryDTO[] }) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["budgets"] });
  };
  const family = useQuery({ queryKey: ["family-lookup"], queryFn: () => api.get<FamilyMemberDTO[]>("/users/lookup") });
  const setDefaultBeneficiary = useMutation({
    mutationFn: (v: { id: string; beneficiary: Beneficiary | null; beneficiaryUserId: string | null }) =>
      api.patch(`/categories/${v.id}`, { defaultBeneficiary: v.beneficiary, defaultBeneficiaryUserId: v.beneficiaryUserId }),
    onSuccess: invalidate,
  });

  const [form, setForm] = useState({ name: "", group: "", kind: "expense" as CategoryKind, monthlyLimit: "" });
  const createCategory = useMutation({
    mutationFn: () =>
      api.post("/categories", {
        name: form.name,
        group: form.group || undefined,
        kind: form.kind,
        monthlyLimit: form.monthlyLimit ? Number(form.monthlyLimit) : undefined,
      }),
    onSuccess: () => {
      setForm({ name: "", group: "", kind: "expense", monthlyLimit: "" });
      invalidate();
    },
  });
  const toggleArchived = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => api.patch(`/categories/${v.id}`, { archived: v.archived }),
    onSuccess: invalidate,
  });
  const setGroup = useMutation({
    mutationFn: (v: { id: string; group: string | null }) => api.patch(`/categories/${v.id}`, { group: v.group }),
    onSuccess: invalidate,
  });

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<AccountDTO[]>("/accounts") });
  const rules = useQuery({ queryKey: ["category-rules"], queryFn: () => api.get<CategoryRuleDTO[]>("/categories/rules") });
  const [ruleForm, setRuleForm] = useState<RuleFormState>(emptyRuleForm());
  const createRule = useMutation({
    mutationFn: () =>
      api.post("/categories/rules", {
        categoryId: ruleForm.categoryId,
        logic: ruleForm.logic,
        conditions: ruleForm.conditions.map(toConditionPayload),
        linkedAccountId: ruleForm.linkedAccountId || undefined,
        beneficiary: ruleForm.beneficiary || undefined,
        beneficiaryUserId: ruleForm.beneficiary === "family_member" ? (ruleForm.beneficiaryUserId || undefined) : undefined,
      }),
    onSuccess: () => {
      setRuleForm(emptyRuleForm());
      queryClient.invalidateQueries({ queryKey: ["category-rules"] });
    },
  });
  const deleteRule = useMutation({
    mutationFn: (id: string) => api.del(`/categories/rules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["category-rules"] }),
  });
  const setRuleLinkedAccount = useMutation({
    mutationFn: (v: { id: string; linkedAccountId: string | null }) =>
      api.patch(`/categories/rules/${v.id}`, { linkedAccountId: v.linkedAccountId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["category-rules"] }),
  });
  const setRuleBeneficiary = useMutation({
    mutationFn: (v: { id: string; beneficiary: Beneficiary | null; beneficiaryUserId: string | null }) =>
      api.patch(`/categories/rules/${v.id}`, { beneficiary: v.beneficiary, beneficiaryUserId: v.beneficiaryUserId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["category-rules"] }),
  });

  const existingGroups = [...new Set(categories.map((c) => c.group).filter((g): g is string => !!g))].sort();

  return (
    <div className="mt-4 space-y-6">
      {/* Categories */}
      <div className="card card-pad">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Categories</h3>
        <p className="mb-2 text-xs text-slate-500">
          Click a category's group to change which section it appears under (e.g. "Essentials").
        </p>
        <datalist id="category-groups">
          {existingGroups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <div className="space-y-1">
          {categories.map((c) => (
            <CategoryListItem
              key={c.id}
              category={c}
              family={family.data ?? []}
              onGroupChange={(group) => setGroup.mutate({ id: c.id, group })}
              onToggleArchived={() => toggleArchived.mutate({ id: c.id, archived: !c.archived })}
              onDefaultBeneficiary={(beneficiary, beneficiaryUserId) =>
                setDefaultBeneficiary.mutate({ id: c.id, beneficiary, beneficiaryUserId })
              }
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="New category name" className="input max-w-[10rem]" />
          <input
            value={form.group}
            onChange={(e) => setForm({ ...form, group: e.target.value })}
            placeholder="Group (optional)"
            list="category-groups"
            className="input max-w-[8rem]"
          />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CategoryKind })} className="input max-w-[8rem]">
            {CATEGORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            value={form.monthlyLimit}
            onChange={(e) => setForm({ ...form, monthlyLimit: e.target.value })}
            placeholder="Default limit"
            type="number"
            className="input max-w-[8rem]"
          />
          <button
            onClick={() => createCategory.mutate()}
            disabled={!form.name.trim() || createCategory.isPending}
            className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Rules */}
      <div className="card card-pad">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Auto-tag rules</h3>
        <p className="mb-3 text-xs text-slate-500">
          E.g. "Walmart card → Groceries". New transactions are tagged automatically on sync. A rule can combine
          several conditions (all must match, or any one of them) and include an amount range.
        </p>
        <div className="space-y-4">
          {Object.entries(groupBy(rules.data ?? [], (r) => r.categoryName)).map(([categoryName, categoryRules]) => (
            <div key={categoryName}>
              <p className="mb-1 text-xs font-semibold text-slate-500">{categoryName}</p>
              <div className="space-y-1">
                {categoryRules.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                    <span>{summarizeRule(r)}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <BeneficiarySelect
                        value={encodeBeneficiary(r.beneficiary, r.beneficiaryUserId)}
                        onChange={(beneficiary, beneficiaryUserId) => setRuleBeneficiary.mutate({ id: r.id, beneficiary, beneficiaryUserId })}
                        family={family.data ?? []}
                        className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600"
                      />
                      <Combobox
                        options={accountOptions(accounts.data ?? [], "No linked account")}
                        value={r.linkedAccountId ?? ""}
                        onChange={(v) => setRuleLinkedAccount.mutate({ id: r.id, linkedAccountId: v || null })}
                        title="Auto-link a transfer counterpart account"
                        className="w-40"
                        inputClassName="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600"
                      />
                      <button onClick={() => deleteRule.mutate(r.id)} className="text-xs text-slate-500 underline">
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {rules.data?.length === 0 && <p className="text-sm text-slate-500">No rules yet.</p>}
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              options={categoryPickOptions(categories, "Category…")}
              value={ruleForm.categoryId}
              onChange={(v) => setRuleForm({ ...ruleForm, categoryId: v })}
              className="max-w-[10rem]"
            />
            {ruleForm.conditions.length > 1 && (
              <select
                value={ruleForm.logic}
                onChange={(e) => setRuleForm({ ...ruleForm, logic: e.target.value as RuleLogic })}
                className="input max-w-[10.5rem]"
                title="How the conditions below combine"
              >
                <option value="all">All conditions match</option>
                <option value="any">Any condition matches</option>
              </select>
            )}
            <BeneficiarySelect
              value={encodeBeneficiary(ruleForm.beneficiary, ruleForm.beneficiaryUserId)}
              onChange={(beneficiary, beneficiaryUserId) =>
                setRuleForm({ ...ruleForm, beneficiary, beneficiaryUserId: beneficiaryUserId ?? "" })
              }
              family={family.data ?? []}
              className="input max-w-[10rem]"
            />
            <Combobox
              options={accountOptions(accounts.data ?? [], "Links to account… (optional)")}
              value={ruleForm.linkedAccountId}
              onChange={(v) => setRuleForm({ ...ruleForm, linkedAccountId: v })}
              title="For transfers: auto-fill which account this links to"
              className="max-w-[12rem]"
            />
          </div>

          {ruleForm.conditions.map((condition, i) => (
            <ConditionEditor
              key={i}
              condition={condition}
              accounts={accounts.data ?? []}
              onChange={(next) =>
                setRuleForm({ ...ruleForm, conditions: ruleForm.conditions.map((c, ci) => (ci === i ? next : c)) })
              }
              onRemove={
                ruleForm.conditions.length > 1
                  ? () => setRuleForm({ ...ruleForm, conditions: ruleForm.conditions.filter((_, ci) => ci !== i) })
                  : undefined
              }
            />
          ))}

          <div className="flex items-center gap-3">
            <button
              onClick={() => setRuleForm({ ...ruleForm, conditions: [...ruleForm.conditions, emptyCondition()] })}
              className="text-xs text-accent-600 hover:underline"
            >
              + Add condition
            </button>
            <button
              onClick={() => createRule.mutate()}
              disabled={!ruleForm.categoryId || !ruleForm.conditions.every(conditionValid) || createRule.isPending}
              className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Add rule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}
