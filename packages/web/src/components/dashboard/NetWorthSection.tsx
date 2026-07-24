import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  formatMoney,
  NET_WORTH_HISTORY_RANGES,
  type NetWorthHistoryPoint,
  type NetWorthHistoryRange,
  type NetWorthSummary,
} from "@panditas/shared";
import { api } from "../../api";
import { Card } from "../ui/Card";
import { SectionHeader } from "../ui/SectionHeader";
import { SegmentedControl } from "../ui/SegmentedControl";
import { StatCard } from "../ui/StatCard";
import { ChartTooltip } from "../ui/ChartTooltip";
import { toneColor } from "../ui/chartColors";

const RANGE_LABELS: Record<NetWorthHistoryRange, string> = {
  "30d": "30d",
  "90d": "90d",
  "1y": "1y",
  all: "All",
};

type Metric = "netWorth" | "assets" | "liabilities";

const NET_WORTH_LINE_COLOR = "#1e293b"; // slate-800 — fixed regardless of sign; the sign-based
// asset/liability tone lives on the StatCard itself (see Dashboard.tsx's existing convention),
// not on the line, so the line reads consistently even if net worth ever dips negative.

function formatDelta(current: number, previous: number, rangeLabel: string): string {
  const diff = current - previous;
  const sign = diff >= 0 ? "+" : "-";
  return `${sign}${formatMoney(Math.abs(diff))} vs ${rangeLabel}`;
}

const tickDateFormat = (d: string) => new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

/** Landing section of the Dashboard: a diverging area chart (assets above the
 * zero line, liabilities mirrored below it, net worth as a line through the
 * assets band) with the three summary cards acting as a clickable legend —
 * clicking one highlights its series and dims the other two. */
export function NetWorthSection({ netWorth }: { netWorth: NetWorthSummary }) {
  const [range, setRange] = useState<NetWorthHistoryRange>("90d");
  const [activeMetric, setActiveMetric] = useState<Metric>("netWorth");

  // Kept as its own query (not folded into ["dashboard"]) so flipping the
  // range toggle only refetches this section, not notifications/bills/etc.
  const history = useQuery({
    queryKey: ["net-worth-history", range],
    queryFn: () => api.get<NetWorthHistoryPoint[]>(`/dashboard/net-worth-history?range=${range}`),
  });

  const points = history.data ?? [];
  const first = points[0];
  const last = points[points.length - 1];
  const rangeLabel = RANGE_LABELS[range];
  const chartData = points.map((p) => ({ ...p, negLiabilities: -p.liabilities }));

  const assetColor = toneColor("asset", 0);
  const liabilityColor = toneColor("liability", 0);
  const strokeOpacity = (metric: Metric) => (activeMetric === metric ? 1 : 0.35);
  const fillOpacity = (metric: Metric) => (activeMetric === metric ? 0.35 : 0.12);

  return (
    <section>
      <SectionHeader
        right={
          <SegmentedControl
            options={NET_WORTH_HISTORY_RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }))}
            value={range}
            onChange={setRange}
          />
        }
      >
        Family net worth
      </SectionHeader>
      <Card>
        {history.isLoading && <p className="py-8 text-center text-sm text-slate-500">Loading…</p>}
        {!history.isLoading && points.length < 2 && (
          <p className="py-8 text-center text-sm text-slate-500">
            Not enough sync history yet for this range — check back after a few more syncs.
          </p>
        )}
        {points.length >= 2 && (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tickFormatter={tickDateFormat}
                tick={{ fontSize: 11, fill: "#898781" }}
                axisLine={{ stroke: "#c3c2b7" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => formatMoney(v)}
                tick={{ fontSize: 11, fill: "#898781" }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
              <Tooltip content={<ChartTooltip />} labelFormatter={tickDateFormat} />
              <Area
                dataKey="assets"
                name="Assets"
                stroke={assetColor}
                fill={assetColor}
                strokeWidth={activeMetric === "assets" ? 2.5 : 1.5}
                strokeOpacity={strokeOpacity("assets")}
                fillOpacity={fillOpacity("assets")}
                isAnimationActive={false}
              />
              <Area
                dataKey="negLiabilities"
                name="Liabilities"
                stroke={liabilityColor}
                fill={liabilityColor}
                strokeWidth={activeMetric === "liabilities" ? 2.5 : 1.5}
                strokeOpacity={strokeOpacity("liabilities")}
                fillOpacity={fillOpacity("liabilities")}
                isAnimationActive={false}
              />
              <Line
                dataKey="netWorth"
                name="Net worth"
                stroke={NET_WORTH_LINE_COLOR}
                strokeWidth={activeMetric === "netWorth" ? 3 : 1.5}
                strokeOpacity={strokeOpacity("netWorth")}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Net worth"
            value={netWorth.netWorth}
            tone={netWorth.netWorth >= 0 ? "asset" : "liability"}
            active={activeMetric === "netWorth"}
            onClick={() => setActiveMetric("netWorth")}
            delta={first && last ? formatDelta(last.netWorth, first.netWorth, rangeLabel) : undefined}
          />
          <StatCard
            label="Assets"
            value={netWorth.assets}
            tone="asset"
            active={activeMetric === "assets"}
            onClick={() => setActiveMetric("assets")}
            delta={first && last ? formatDelta(last.assets, first.assets, rangeLabel) : undefined}
          />
          <StatCard
            label="Liabilities"
            value={-netWorth.liabilities}
            tone="liability"
            active={activeMetric === "liabilities"}
            onClick={() => setActiveMetric("liabilities")}
            delta={first && last ? formatDelta(-last.liabilities, -first.liabilities, rangeLabel) : undefined}
          />
        </div>
      </Card>
    </section>
  );
}
