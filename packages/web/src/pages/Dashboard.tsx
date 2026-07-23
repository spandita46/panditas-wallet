import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatMoney,
  type DailyFlowPoint,
  type DashboardSummary,
} from "@panditas/shared";
import { api } from "../api";
import { Card } from "../components/ui/Card";
import { SectionHeader } from "../components/ui/SectionHeader";
import { StatCard } from "../components/ui/StatCard";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { ChartTooltip } from "../components/ui/ChartTooltip";
import { flowIntensity } from "../components/ui/chartColors";
import { CompositionCard } from "../components/dashboard/CompositionCard";
import { UpcomingBillsCard } from "../components/dashboard/UpcomingBillsCard";
import { NotificationBanners } from "../components/dashboard/NotificationBanners";
import { monthEndDate, monthKey, monthLabel, shiftMonth } from "../lib/month";
import { transactionsLink } from "../lib/transactionsLink";

interface SyncSummary {
  accountsUpdated: number;
  transactionsAdded: number;
  errors: string[];
}

type Granularity = "day" | "week" | "month";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [heatmapMonth, setHeatmapMonth] = useState(() => monthKey(new Date()));
  const [granularity, setGranularity] = useState<Granularity>("week");

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
  });
  const timeseries = useQuery({
    queryKey: ["insights-timeseries"],
    queryFn: () => api.get<DailyFlowPoint[]>("/insights/timeseries?months=3"),
  });

  const sync = useMutation({
    mutationFn: () => api.post<SyncSummary>("/simplefin/sync"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["simplefin-status"] });
    },
  });

  const trend = useMemo(() => bucketFlow(timeseries.data ?? [], granularity), [timeseries.data, granularity]);

  return (
    <div>
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Family dashboard</h1>
        <div className="text-right">
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
          >
            {sync.isPending ? "Syncing…" : "Sync now"}
          </button>
          {data?.lastSyncFinishedAt && (
            <p className="mt-1 text-xs text-slate-500">
              Last synced {new Date(data.lastSyncFinishedAt).toLocaleString("en-CA")}
            </p>
          )}
        </div>
      </header>

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-liability-600">Could not load the dashboard.</p>}

      {data && (
        <div className="space-y-8">
          <NotificationBanners notifications={data.notifications} />

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Net worth"
              value={data.netWorth.netWorth}
              tone={data.netWorth.netWorth >= 0 ? "asset" : "liability"}
            />
            <StatCard label="Assets" value={data.netWorth.assets} tone="asset" />
            <StatCard label="Liabilities" value={-data.netWorth.liabilities} tone="liability" />
          </section>

          <UpcomingBillsCard bills={data.upcomingBills} />

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CompositionCard title="Assets breakdown" tone="asset" accountsByType={data.accountsByType} />
            <CompositionCard title="Liabilities breakdown" tone="liability" accountsByType={data.accountsByType} />
          </section>

          <section>
            <SectionHeader
              right={
                <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1">
                  <button
                    onClick={() => setHeatmapMonth((m) => shiftMonth(m, -1))}
                    className="px-2 text-slate-500 hover:text-slate-900"
                  >
                    ‹
                  </button>
                  <span className="min-w-[8rem] text-center text-sm font-medium text-slate-800">
                    {monthLabel(heatmapMonth)}
                  </span>
                  <button
                    onClick={() => setHeatmapMonth((m) => shiftMonth(m, 1))}
                    className="px-2 text-slate-500 hover:text-slate-900"
                  >
                    ›
                  </button>
                </div>
              }
            >
              Spending vs income — by day
            </SectionHeader>
            <Card className="overflow-visible">
              <CalendarHeatmap month={heatmapMonth} points={timeseries.data ?? []} />
            </Card>
          </section>

          <section>
            <SectionHeader
              right={
                <SegmentedControl
                  value={granularity}
                  onChange={setGranularity}
                  options={[
                    { value: "day", label: "Day" },
                    { value: "week", label: "Week" },
                    { value: "month", label: "Month" },
                  ]}
                />
              }
            >
              Spending vs income — trend
            </SectionHeader>
            <Card>
              <TrendChart
                data={trend}
                onSelectRange={(from, to) => navigate(transactionsLink({ from, to }))}
              />
            </Card>
          </section>

          <section>
            <SectionHeader>Credit cards</SectionHeader>
            <Card padded={false}>
              {data.creditCards.length === 0 && (
                <p className="p-4 text-sm text-slate-500">No credit cards yet.</p>
              )}
              {data.creditCards.map((c) => (
                <Link
                  key={c.id}
                  to={transactionsLink({ accountId: c.id })}
                  className="flex items-center justify-between border-b border-slate-100 p-4 last:border-0 hover:bg-slate-50"
                >
                  <div>
                    <p className="font-medium text-slate-800">{c.displayName}</p>
                    <p className="text-xs text-slate-500">{c.institutionName ?? "Manual"}</p>
                  </div>
                  <span className="font-medium text-liability-700">
                    {formatMoney(-Math.abs(c.currentBalance), c.currency)}
                  </span>
                </Link>
              ))}
            </Card>
          </section>

          <section>
            <SectionHeader>Recent transactions</SectionHeader>
            <Card padded={false}>
              {data.recentTransactions.length === 0 && (
                <p className="p-4 text-sm text-slate-500">
                  No transactions yet — connect SimpleFIN or add one manually.
                </p>
              )}
              {data.recentTransactions.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between border-b border-slate-100 p-3 text-sm last:border-0"
                >
                  <div>
                    <p className="font-medium text-slate-800">{t.payee ?? t.description ?? "—"}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(t.postedAt).toLocaleDateString("en-CA")} · {t.accountName}
                    </p>
                  </div>
                  <span className={t.amount < 0 ? "text-liability-700" : "text-asset-700"}>
                    {formatMoney(t.amount)}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}

function CalendarHeatmap({ month, points }: { month: string; points: DailyFlowPoint[] }) {
  const byDate = new Map(points.map((p) => [p.date, p]));
  const start = new Date(`${month}T00:00:00`);
  const year = start.getFullYear();
  const monthIdx = start.getMonth();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const firstWeekday = start.getDay(); // 0 = Sunday

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    const p = byDate.get(date);
    const income = p?.income ?? 0;
    const expense = p?.expense ?? 0;
    return { date, day: i + 1, income, expense, net: income - expense };
  });
  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.net)));

  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No transactions in this period yet.</p>;
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase text-slate-400">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map((d) => {
          const { bg, text } = flowIntensity(d.net, maxAbs);
          return (
            <div key={d.date} className="group relative">
              <Link
                to={transactionsLink({ from: d.date, to: d.date })}
                className={`flex aspect-square items-center justify-center rounded text-xs hover:ring-2 hover:ring-accent-400 ${bg} ${text}`}
              >
                {d.day}
              </Link>
              <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg group-hover:block">
                <p className="mb-1 font-medium text-slate-300">
                  {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}
                </p>
                <p className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-asset-500" />
                  <span className="font-semibold">{formatMoney(d.income)}</span>
                  <span className="text-slate-300">income</span>
                </p>
                <p className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-liability-500" />
                  <span className="font-semibold">{formatMoney(d.expense)}</span>
                  <span className="text-slate-300">expense</span>
                </p>
                <p className="mt-0.5 font-semibold">Net {formatMoney(d.net)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TrendPoint {
  label: string;
  income: number;
  expense: number;
  sortKey: string;
  rangeFrom: string;
  rangeTo: string;
}

function shortDayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}
function shortMonthLabel(key: string): string {
  return new Date(`${key}-01T00:00:00`).toLocaleDateString("en-CA", { month: "short", year: "2-digit" });
}
function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function bucketFlow(points: DailyFlowPoint[], granularity: Granularity): TrendPoint[] {
  if (granularity === "day") {
    return points.slice(-30).map((p) => ({
      label: shortDayLabel(p.date),
      income: p.income,
      expense: p.expense,
      sortKey: p.date,
      rangeFrom: p.date,
      rangeTo: p.date,
    }));
  }

  const buckets = new Map<string, TrendPoint>();
  for (const p of points) {
    if (granularity === "week") {
      const weekStart = startOfWeek(new Date(`${p.date}T00:00:00`));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const key = toDateKey(weekStart);
      const entry =
        buckets.get(key) ??
        { label: shortDayLabel(key), income: 0, expense: 0, sortKey: key, rangeFrom: key, rangeTo: toDateKey(weekEnd) };
      entry.income += p.income;
      entry.expense += p.expense;
      buckets.set(key, entry);
    } else {
      const key = p.date.slice(0, 7);
      const entry =
        buckets.get(key) ??
        { label: shortMonthLabel(key), income: 0, expense: 0, sortKey: key, rangeFrom: `${key}-01`, rangeTo: monthEndDate(`${key}-01`) };
      entry.income += p.income;
      entry.expense += p.expense;
      buckets.set(key, entry);
    }
  }
  return [...buckets.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function TrendChart({
  data,
  onSelectRange,
}: {
  data: TrendPoint[];
  onSelectRange: (from: string, to: string) => void;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No transactions in this period yet.</p>;
  }
  const handleClick = (_: unknown, index: number) => {
    const point = data[index];
    if (point) onSelectRange(point.rangeFrom, point.rangeTo);
  };
  return (
    <ResponsiveContainer width="100%" height={260}>
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
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="income"
          name="Income"
          fill="#059669"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          cursor="pointer"
          onClick={handleClick}
        />
        <Bar
          dataKey="expense"
          name="Expense"
          fill="#e11d48"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          cursor="pointer"
          onClick={handleClick}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
