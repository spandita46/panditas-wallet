import {
  RULE_CONDITION_TYPES,
  type AccountDTO,
  type Beneficiary,
  type CategoryRuleDTO,
  type RuleConditionType,
  type RuleLogic,
} from "@panditas/shared";
import { Combobox, type ComboboxItem } from "../ui/Combobox";

// Shared between the Budget page's rule builder and the Transactions page's
// inline "create rule from this transaction" form — one multi-condition
// AND/OR editing experience, not two forks of it.

// Excludes merged accounts — a merged-away account is retired, never a
// meaningful target for a new rule.
function accountOptions(accounts: AccountDTO[], placeholder: string): ComboboxItem[] {
  return [
    { value: "", label: placeholder },
    ...accounts.filter((a) => !a.mergedIntoId).map((a) => ({ value: a.id, label: a.displayName })),
  ];
}

export interface ConditionDraft {
  type: RuleConditionType;
  matchAccountId: string;
  pattern: string;
  minAmount: string;
  maxAmount: string;
}
export function emptyCondition(): ConditionDraft {
  return { type: "payee_contains", matchAccountId: "", pattern: "", minAmount: "", maxAmount: "" };
}
export function conditionValid(c: ConditionDraft): boolean {
  if (c.type === "account") return !!c.matchAccountId;
  if (c.type === "amount_range") return c.minAmount.trim() !== "" || c.maxAmount.trim() !== "";
  return c.pattern.trim().length > 0;
}
export function toConditionPayload(c: ConditionDraft) {
  return {
    type: c.type,
    matchAccountId: c.type === "account" ? c.matchAccountId : undefined,
    pattern: c.type === "payee_contains" || c.type === "description_regex" ? c.pattern.trim() : undefined,
    minAmount: c.type === "amount_range" && c.minAmount.trim() !== "" ? Number(c.minAmount) : undefined,
    maxAmount: c.type === "amount_range" && c.maxAmount.trim() !== "" ? Number(c.maxAmount) : undefined,
  };
}

export interface RuleFormState {
  categoryId: string;
  logic: RuleLogic;
  conditions: ConditionDraft[];
  linkedAccountId: string;
  beneficiary: Beneficiary | null;
  beneficiaryUserId: string;
}
export function emptyRuleForm(): RuleFormState {
  return { categoryId: "", logic: "all", conditions: [emptyCondition()], linkedAccountId: "", beneficiary: null, beneficiaryUserId: "" };
}
export function ruleFormFromDTO(r: CategoryRuleDTO): RuleFormState {
  return {
    categoryId: r.categoryId,
    logic: r.logic,
    conditions: r.conditions.map((c) => ({
      type: c.type,
      matchAccountId: c.matchAccountId ?? "",
      pattern: c.pattern ?? "",
      minAmount: c.minAmount != null ? String(c.minAmount) : "",
      maxAmount: c.maxAmount != null ? String(c.maxAmount) : "",
    })),
    linkedAccountId: r.linkedAccountId ?? "",
    beneficiary: r.beneficiary,
    beneficiaryUserId: r.beneficiaryUserId ?? "",
  };
}

export function summarizeCondition(c: CategoryRuleDTO["conditions"][number]): string {
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
export function summarizeRule(r: CategoryRuleDTO): string {
  return r.conditions.map(summarizeCondition).join(r.logic === "any" ? " OR " : " AND ");
}

const CONDITION_TYPE_LABEL: Record<RuleConditionType, string> = {
  account: "Account is",
  payee_contains: "Payee contains",
  description_regex: "Description matches",
  amount_range: "Amount is",
};

function amountRangeLabel(c: CategoryRuleDTO["conditions"][number]): string {
  if (c.minAmount != null && c.maxAmount != null) return `$${c.minAmount}–$${c.maxAmount}`;
  if (c.minAmount != null) return `≥ $${c.minAmount}`;
  if (c.maxAmount != null) return `≤ $${c.maxAmount}`;
  return "any";
}

// One rule can end up with many same-type conditions (typically after a
// merge) — grouping by type and listing values as bullets reads far better
// than one long "X OR Y OR Z OR ..." sentence.
export function RuleConditionsDisplay({ rule }: { rule: CategoryRuleDTO }) {
  const groups: { type: RuleConditionType; items: CategoryRuleDTO["conditions"] }[] = [];
  for (const c of rule.conditions) {
    const last = groups[groups.length - 1];
    if (last && last.type === c.type) last.items.push(c);
    else groups.push({ type: c.type, items: [c] });
  }
  const joiner = rule.logic === "any" ? "OR" : "AND";

  return (
    <div className="space-y-1 text-sm">
      {groups.map((g, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="text-xs font-semibold text-slate-400">{joiner}</div>}
          <div className="text-slate-700">
            {CONDITION_TYPE_LABEL[g.type]}
            {g.items.length > 1 ? ` ${rule.logic === "any" ? "any" : "all"} of the following:` : ":"}
          </div>
          <ul className="ml-3 list-disc space-y-0.5 text-slate-600">
            {g.items.map((c) => (
              <li key={c.id}>
                {g.type === "account"
                  ? (c.matchAccountName ?? "?")
                  : g.type === "amount_range"
                    ? amountRangeLabel(c)
                    : `"${c.pattern}"`}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ConditionEditor({
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
