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
  type AccountBalancePoint,
  type AccountDTO,
  type DashboardSummary,
} from "@panditas/shared";
import { api } from "../../api";
import { Card } from "../ui/Card";
import { SectionHeader } from "../ui/SectionHeader";
import { Treemap, type TreemapCell } from "../ui/Treemap";
import { ChartTooltip } from "../ui/ChartTooltip";
import { toneColor } from "../ui/chartColors";

type Tone = "asset" | "liability";

// Cells beyond this rank collapse into one "Other" rollup — keeps every
// visible treemap cell big enough to hold a legible label (see Treemap.tsx).
const TOP_N = 4;

type DrillState =
  | { level: "top" }
  | { level: "other" }
  | { level: "account"; accountId: string; accountLabel: string; from: "top" | "other" };

/** Assets/Liabilities composition treemap with an in-place drill-down: click
 * one of the top accounts to see its balance history directly, or click
 * "Other" to see the smaller accounts as a bar chart first — all inside the
 * same card, via a breadcrumb + back button rather than navigating away.
 * Individual account-level cells (not grouped by account type) so similarly
 * colored accounts, e.g. two credit cards, are told apart by their own label
 * instead of a shade of red in a legend. */
export function CompositionCard({
  title,
  tone,
  accountsByType,
}: {
  title: string;
  tone: Tone;
  accountsByType: DashboardSummary["accountsByType"] | undefined;
}) {
  const [drill, setDrill] = useState<DrillState>({ level: "top" });
  const { cells, otherAccounts } = useMemo(() => buildTreemapCells(accountsByType, tone), [accountsByType, tone]);

  const goTop = () => setDrill({ level: "top" });
  const goOther = () => setDrill({ level: "other" });
  const goAccount = (accountId: string, accountLabel: string, from: "top" | "other") =>
    setDrill({ level: "account", accountId, accountLabel, from });
  const goBack = () =>
    setDrill(drill.level === "account" && drill.from === "other" ? { level: "other" } : { level: "top" });

  return (
    <Card>
      <SectionHeader>{title}</SectionHeader>

      {drill.level !== "top" && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <button onClick={goBack} className="mr-1 font-medium text-accent-600 hover:underline">
            ← Back
          </button>
          <button onClick={goTop} className="text-slate-500 hover:text-accent-600 hover:underline">
            {title}
          </button>
          <span className="text-slate-300">/</span>
          {drill.level === "other" && <span className="font-medium text-slate-700">Other</span>}
          {drill.level === "account" && drill.from === "other" && (
            <>
              <button onClick={goOther} className="text-slate-500 hover:text-accent-600 hover:underline">
                Other
              </button>
              <span className="text-slate-300">/</span>
              <span className="font-medium text-slate-700">{drill.accountLabel}</span>
            </>
          )}
          {drill.level === "account" && drill.from === "top" && (
            <span className="font-medium text-slate-700">{drill.accountLabel}</span>
          )}
        </div>
      )}

      {drill.level === "top" && (
        <Treemap
          data={cells}
          tone={tone}
          onCellClick={(cell) => {
            if (cell.isOther) goOther();
            else if (cell.key) goAccount(cell.key, cell.label, "top");
          }}
        />
      )}

      {drill.level === "other" && (
        <AccountsBarChart accounts={otherAccounts} tone={tone} onSelect={(a) => goAccount(a.id, a.displayName, "other")} />
      )}

      {drill.level === "account" && <AccountHistoryChart accountId={drill.accountId} tone={tone} />}
    </Card>
  );
}

function buildTreemapCells(
  accountsByType: DashboardSummary["accountsByType"] | undefined,
  tone: Tone,
): { cells: TreemapCell[]; otherAccounts: AccountDTO[] } {
  if (!accountsByType) return { cells: [], otherAccounts: [] };

  const withValue = Object.values(accountsByType)
    .flat()
    .filter((a) => a.isLiability === (tone === "liability"))
    .map((account) => ({
      account,
      value: tone === "liability" ? Math.abs(account.currentBalance) : account.currentBalance,
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  // A single-account "Other" rollup is pointless indirection — only split
  // once there's an actual tail worth collapsing.
  if (withValue.length <= TOP_N + 1) {
    return {
      cells: withValue.map((x) => ({ label: x.account.displayName, value: x.value, key: x.account.id })),
      otherAccounts: [],
    };
  }

  const top = withValue.slice(0, TOP_N);
  const rest = withValue.slice(TOP_N);
  const cells: TreemapCell[] = top.map((x) => ({ label: x.account.displayName, value: x.value, key: x.account.id }));
  cells.push({
    label: `Other (${rest.length})`,
    value: rest.reduce((sum, x) => sum + x.value, 0),
    isOther: true,
  });
  return { cells, otherAccounts: rest.map((x) => x.account) };
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
