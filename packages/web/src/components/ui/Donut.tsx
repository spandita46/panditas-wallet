import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { toneColor, type DonutTone } from "./chartColors";

export interface DonutSlice {
  label: string;
  value: number;
  // Optional caller-defined key (e.g. an AccountType), ignored by the chart
  // itself but handy for `onSliceClick` to know what was clicked.
  key?: string;
}

/** Part-to-whole donut. Default `categorical` tone gives each slice a fixed,
 * CVD-safe hue for arbitrary identity data (who/what). Pass `asset`/`liability`
 * for a single-hue-family (green/red) tone when the slices are all members of
 * that semantic group, e.g. an assets- or liabilities-composition breakdown.
 * Pass `onSliceClick` to make slices clickable (e.g. drill-down). */
export function Donut({
  data,
  height = 220,
  tone = "categorical",
  onSliceClick,
}: {
  data: DonutSlice[];
  height?: number;
  tone?: DonutTone;
  onSliceClick?: (index: number) => void;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No data yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          stroke="none"
          onClick={onSliceClick ? (_, index) => onSliceClick(index) : undefined}
          style={onSliceClick ? { cursor: "pointer" } : undefined}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={toneColor(tone, i)} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
