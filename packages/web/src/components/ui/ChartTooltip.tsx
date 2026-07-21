import { formatMoney } from "@panditas/shared";

interface TooltipPayloadItem {
  value?: number;
  name?: string;
  color?: string;
  fill?: string;
}

/** Shared Recharts tooltip content — dark card, value leads (bold, prominent),
 * series name follows, a short color key instead of a filled swatch box. */
export function ChartTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg">
      {label && <p className="mb-1 font-medium text-slate-300">{label}</p>}
      <div className="space-y-0.5">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? p.fill }} />
            <span className="font-semibold">{formatMoney(p.value ?? 0)}</span>
            {p.name && <span className="text-slate-300">{p.name}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
