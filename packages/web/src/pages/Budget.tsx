import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CATEGORY_KINDS,
  CATEGORY_KIND_LABELS,
  RULE_MATCH_TYPES,
  formatMoney,
  type AccountDTO,
  type BudgetLineDTO,
  type CategoryDTO,
  type CategoryKind,
  type CategoryRuleDTO,
  type RuleMatchType,
  type SpendingBreakdown,
} from "@panditas/shared";
import { api } from "../api";

// Categories grouped by kind, expense first (most common), for <optgroup> rendering.
const KIND_ORDER = ["expense", "income", "transfer"] as const;
function categoryOptgroups(categories: CategoryDTO[]) {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: CATEGORY_KIND_LABELS[kind],
    items: categories.filter((c) => c.kind === kind),
  })).filter((g) => g.items.length > 0);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthLabel(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
}
function shiftMonth(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  return monthKey(d);
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

      {/* Category budgets */}
      <div className="space-y-5">
        {Object.entries(grouped).map(([group, lines]) => (
          <section key={group}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{group}</h2>
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
              {lines.map((l) => (
                <BudgetRow
                  key={l.categoryId}
                  line={l}
                  onSetLimit={(limit) => setLimit.mutate({ categoryId: l.categoryId, limit })}
                  onClearOverride={() => clearOverride.mutate(l.categoryId)}
                />
              ))}
            </div>
          </section>
        ))}
        {budgets.data?.length === 0 && (
          <p className="text-sm text-slate-500">No categories yet — add one below.</p>
        )}
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BreakdownCard title="Spending by who paid" entries={insights.data?.byOwner ?? []} />
        <BreakdownCard title="Spending by who it was for" entries={insights.data?.byBeneficiary ?? []} />
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
  onSetLimit,
  onClearOverride,
}: {
  line: BudgetLineDTO;
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
  const barColor = !isExpense ? "bg-slate-400" : over ? "bg-red-500" : (pct ?? 0) >= 80 ? "bg-amber-500" : "bg-green-500";

  const commit = () => {
    const n = Number(value);
    setEditing(false);
    if (Number.isFinite(n) && n >= 0 && n !== line.limit) onSetLimit(n);
  };

  return (
    <div className="border-b border-slate-100 bg-white p-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-slate-800">{line.categoryName}</span>
        <div className="flex items-center gap-2 text-sm">
          <span className={over ? "font-semibold text-red-600" : "text-slate-700"}>{formatMoney(line.spent)}</span>
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
  const max = Math.max(1, ...entries.map((e) => e.total));
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {entries.length === 0 && <p className="text-sm text-slate-500">No spending yet this month.</p>}
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.key}>
            <div className="mb-0.5 flex justify-between text-sm">
              <span className="text-slate-700">{e.label}</span>
              <span className="font-medium text-slate-800">{formatMoney(e.total)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-slate-800" style={{ width: `${(e.total / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryListItem({
  category,
  onGroupChange,
  onToggleArchived,
}: {
  category: CategoryDTO;
  onGroupChange: (group: string | null) => void;
  onToggleArchived: () => void;
}) {
  const [group, setGroupValue] = useState(category.group ?? "");

  const commit = () => {
    const next = group.trim();
    if (next !== (category.group ?? "")) onGroupChange(next || null);
  };

  return (
    <div className={`flex items-center justify-between py-1 text-sm ${category.archived ? "opacity-50" : ""}`}>
      <span className="flex items-center gap-2">
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
  const [ruleForm, setRuleForm] = useState({
    categoryId: "",
    matchType: "account" as RuleMatchType,
    matchAccountId: "",
    pattern: "",
    linkedAccountId: "",
  });
  const createRule = useMutation({
    mutationFn: () =>
      api.post("/categories/rules", {
        categoryId: ruleForm.categoryId,
        matchType: ruleForm.matchType,
        matchAccountId: ruleForm.matchType === "account" ? ruleForm.matchAccountId : undefined,
        pattern: ruleForm.matchType !== "account" ? ruleForm.pattern : undefined,
        linkedAccountId: ruleForm.linkedAccountId || undefined,
      }),
    onSuccess: () => {
      setRuleForm({ categoryId: "", matchType: "account", matchAccountId: "", pattern: "", linkedAccountId: "" });
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

  const existingGroups = [...new Set(categories.map((c) => c.group).filter((g): g is string => !!g))].sort();

  return (
    <div className="mt-4 space-y-6">
      {/* Categories */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
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
              onGroupChange={(group) => setGroup.mutate({ id: c.id, group })}
              onToggleArchived={() => toggleArchived.mutate({ id: c.id, archived: !c.archived })}
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
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Rules */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Auto-tag rules</h3>
        <p className="mb-3 text-xs text-slate-500">
          E.g. "Walmart card → Groceries". New transactions are tagged automatically on sync.
        </p>
        <div className="space-y-1">
          {rules.data?.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
              <span>
                {r.matchType === "account" ? r.matchAccountName : `"${r.pattern}"`} → <strong>{r.categoryName}</strong>
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={r.linkedAccountId ?? ""}
                  onChange={(e) => setRuleLinkedAccount.mutate({ id: r.id, linkedAccountId: e.target.value || null })}
                  title="Auto-link a transfer counterpart account"
                  className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600"
                >
                  <option value="">No linked account</option>
                  {accounts.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      links to {a.displayName}
                    </option>
                  ))}
                </select>
                <button onClick={() => deleteRule.mutate(r.id)} className="text-xs text-slate-500 underline">
                  Remove
                </button>
              </div>
            </div>
          ))}
          {rules.data?.length === 0 && <p className="text-sm text-slate-500">No rules yet.</p>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <select value={ruleForm.categoryId} onChange={(e) => setRuleForm({ ...ruleForm, categoryId: e.target.value })} className="input max-w-[10rem]">
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
            value={ruleForm.matchType}
            onChange={(e) => setRuleForm({ ...ruleForm, matchType: e.target.value as RuleMatchType })}
            className="input max-w-[10rem]"
          >
            {RULE_MATCH_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "account" ? "Account is" : t === "payee_contains" ? "Payee contains" : "Description matches"}
              </option>
            ))}
          </select>
          {ruleForm.matchType === "account" ? (
            <select value={ruleForm.matchAccountId} onChange={(e) => setRuleForm({ ...ruleForm, matchAccountId: e.target.value })} className="input max-w-[12rem]">
              <option value="">Account…</option>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={ruleForm.pattern}
              onChange={(e) => setRuleForm({ ...ruleForm, pattern: e.target.value })}
              placeholder="Text to match"
              className="input max-w-[12rem]"
            />
          )}
          <select
            value={ruleForm.linkedAccountId}
            onChange={(e) => setRuleForm({ ...ruleForm, linkedAccountId: e.target.value })}
            title="For transfers: auto-fill which account this links to"
            className="input max-w-[12rem]"
          >
            <option value="">Links to account… (optional)</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
          <button
            onClick={() => createRule.mutate()}
            disabled={
              !ruleForm.categoryId ||
              (ruleForm.matchType === "account" ? !ruleForm.matchAccountId : !ruleForm.pattern) ||
              createRule.isPending
            }
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Add rule
          </button>
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
