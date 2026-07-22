import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatMoney,
  isLiability,
  type AccountBalancePoint,
  type AccountDTO,
  type AccountType,
  type DashboardSummary,
} from "@panditas/shared";
import { api } from "../../api";
import { Card } from "../ui/Card";
import { SectionHeader } from "../ui/SectionHeader";
import { Donut, type DonutSlice } from "../ui/Donut";
import { ChartTooltip } from "../ui/ChartTooltip";
import { toneColor } from "../ui/chartColors";

const TYPE_LABELS: Record<AccountType, string> = {
  chequing: "Chequing",
  savings: "Savings",
  credit_card: "Credit card",
  investment: "Investment",
  loan: "Loan",
  cash: "Cash",
  piggy_bank: "Piggy bank",
};

type Tone = "asset" | "liability";

type DrillState =
  | { level: "type" }
  | { level: "accounts"; type: AccountType; typeLabel: string }
  | { level: "account"; type: AccountType; typeLabel: string; accountId: string; accountLabel: string };

/** Assets/Liabilities composition donut with an in-place drill-down: click a
 * slice (account type) to see the accounts making it up as a bar chart, then
 * click an account to see its balance history — all inside the same card, via
 * a breadcrumb + back button rather than navigating away. */
export function CompositionCard({
  title,
  tone,
  accountsByType,
}: {
  title: string;
  tone: Tone;
  accountsByType: DashboardSummary["accountsByType"] | undefined;
}) {
  const [drill, setDrill] = useState<DrillState>({ level: "type" });
  const slices = useMemo(() => buildSlices(accountsByType, tone), [accountsByType, tone]);

  const goTop = () => setDrill({ level: "type" });
  const goAccounts = (type: AccountType, typeLabel: string) => setDrill({ level: "accounts", type, typeLabel });
  const goBack = () => setDrill(drill.level === "account" ? { level: "accounts", type: drill.type, typeLabel: drill.typeLabel } : { level: "type" });

  return (
    <Card>
      <SectionHeader>{title}</SectionHeader>

      {drill.level !== "type" && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <button onClick={goBack} className="mr-1 font-medium text-accent-600 hover:underline">
            ← Back
          </button>
          <button onClick={goTop} className="text-slate-500 hover:text-accent-600 hover:underline">
            {title}
          </button>
          <span className="text-slate-300">/</span>
          {drill.level === "accounts" && <span className="font-medium text-slate-700">{drill.typeLabel}</span>}
          {drill.level === "account" && (
            <>
              <button onClick={() => goAccounts(drill.type, drill.typeLabel)} className="text-slate-500 hover:text-accent-600 hover:underline">
                {drill.typeLabel}
              </button>
              <span className="text-slate-300">/</span>
              <span className="font-medium text-slate-700">{drill.accountLabel}</span>
            </>
          )}
        </div>
      )}

      {drill.level === "type" && (
        <Donut
          data={slices}
          tone={tone}
          onSliceClick={(i) => {
            const s = slices[i];
            if (s?.key) goAccounts(s.key as AccountType, s.label);
          }}
        />
      )}

      {drill.level === "accounts" && (
        <AccountsBarChart
          accounts={accountsByType?.[drill.type] ?? []}
          tone={tone}
          onSelect={(a) => setDrill({ level: "account", type: drill.type, typeLabel: drill.typeLabel, accountId: a.id, accountLabel: a.displayName })}
        />
      )}

      {drill.level === "account" && <AccountHistoryChart accountId={drill.accountId} tone={tone} />}
    </Card>
  );
}

function buildSlices(accountsByType: DashboardSummary["accountsByType"] | undefined, tone: Tone): DonutSlice[] {
  if (!accountsByType) return [];
  const slices: DonutSlice[] = [];
  for (const [type, accounts] of Object.entries(accountsByType) as [AccountType, AccountDTO[]][]) {
    if (!accounts || accounts.length === 0 || isLiability(type) !== (tone === "liability")) continue;
    const value =
      tone === "liability"
        ? accounts.reduce((sum, a) => sum + Math.abs(a.currentBalance), 0)
        : accounts.reduce((sum, a) => sum + a.currentBalance, 0);
    if (value > 0) slices.push({ label: TYPE_LABELS[type], value, key: type });
  }
  return slices.sort((a, b) => b.value - a.value);
}

function AccountsBarChart({
  accounts,
  tone,
  onSelect,
}: {
  accounts: AccountDTO[];
  tone: Tone;
  onSelect: (account: AccountDTO) => void;
}) {
  const data = accounts
    .map((a) => ({
      accountId: a.id,
      label: a.displayName,
      value: tone === "liability" ? Math.abs(a.currentBalance) : a.currentBalance,
    }))
    .filter((d) => d.value !== 0)
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No accounts here.</p>;
  }

  const color = toneColor(tone, 0);
  const handleClick = (_: unknown, index: number) => {
    const point = data[index];
    const account = accounts.find((a) => a.id === point?.accountId);
    if (account) onSelect(account);
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} barGap={2}>
        <CartesianGrid vertical={false} stroke="#e1e0d9" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: "#898781" }}
          axisLine={false}
          tickLine={false}
          width={56}
          tickFormatter={(v: number) => formatMoney(v)}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15, 23, 42, 0.04)" }} />
        <Bar
          dataKey="value"
          name={tone === "liability" ? "Owed" : "Balance"}
          fill={color}
          radius={[4, 4, 0, 0]}
          maxBarSize={40}
          cursor="pointer"
          onClick={handleClick}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AccountHistoryChart({ accountId, tone }: { accountId: string; tone: Tone }) {
  const { data, isLoading } = useQuery({
    queryKey: ["account-balance-history", accountId],
    queryFn: () => api.get<AccountBalancePoint[]>(`/accounts/${accountId}/balance-history`),
  });

  if (isLoading) return <p className="py-8 text-center text-sm text-slate-500">Loading…</p>;
  if (!data || data.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        Not enough balance history yet — check back after a few syncs.
      </p>
    );
  }

  const color = toneColor(tone, 0);
  const gradientId = `composition-history-${tone}`;
  const chartData = data.map((p) => ({
    label: new Date(p.date).toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
    balance: tone === "liability" ? Math.abs(p.balance) : p.balance,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#e1e0d9" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: "#898781" }}
          axisLine={false}
          tickLine={false}
          width={56}
          tickFormatter={(v: number) => formatMoney(v)}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="balance"
          name={tone === "liability" ? "Owed" : "Balance"}
          stroke={color}
          fill={`url(#${gradientId})`}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
