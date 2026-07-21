import { formatMoney } from "@panditas/shared";

export type StatTone = "asset" | "liability" | "neutral";

const CARD_TONE: Record<StatTone, string> = {
  asset: "bg-asset-50 ring-asset-200",
  liability: "bg-liability-50 ring-liability-200",
  neutral: "bg-white ring-slate-200",
};

const LABEL_TONE: Record<StatTone, string> = {
  asset: "text-asset-700",
  liability: "text-liability-700",
  neutral: "text-slate-500",
};

const VALUE_TONE: Record<StatTone, string> = {
  asset: "text-asset-900",
  liability: "text-liability-900",
  neutral: "text-slate-900",
};

export function StatCard({
  label,
  value,
  tone = "neutral",
  currency,
}: {
  label: string;
  value: number;
  tone?: StatTone;
  currency?: string;
}) {
  return (
    <div className={`rounded-xl p-5 shadow-sm ring-1 ${CARD_TONE[tone]}`}>
      <p className={`text-xs font-medium uppercase tracking-wide ${LABEL_TONE[tone]}`}>{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${VALUE_TONE[tone]}`}>{formatMoney(value, currency)}</p>
    </div>
  );
}
