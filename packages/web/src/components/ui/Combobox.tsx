import { useState } from "react";
import {
  Combobox as HCombobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";

export interface ComboboxItem {
  value: string;
  label: string;
  group?: string;
}

interface ComboboxProps {
  options: ComboboxItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Override the input's own classes (default: the shared `.input` look). Use a
   * tighter class set for compact inline contexts (e.g. a transaction row). */
  inputClassName?: string;
  title?: string;
}

/**
 * Searchable, sortable dropdown — drop-in replacement for a native <select>
 * when the option list is long or grows over time (accounts, categories,
 * family members). Callers include an explicit `{ value: "", label: "…" }`
 * placeholder item when a "clear/all" choice is wanted, same as the native
 * <select>'s first <option value="">.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  className = "",
  inputClassName = "input",
  title,
}: ComboboxProps) {
  const [query, setQuery] = useState("");

  const filtered =
    query === "" ? options : options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  // Group in first-seen order (callers already order groups deliberately,
  // e.g. expense/income/transfer); sort alphabetically within each group.
  const groupOrder: string[] = [];
  const groups = new Map<string, ComboboxItem[]>();
  for (const o of filtered) {
    const g = o.group ?? "";
    if (!groups.has(g)) {
      groups.set(g, []);
      groupOrder.push(g);
    }
    groups.get(g)!.push(o);
  }
  for (const items of groups.values()) items.sort((a, b) => a.label.localeCompare(b.label));

  return (
    <HCombobox value={value} onChange={(v) => onChange(v ?? "")} onClose={() => setQuery("")}>
      <div className={`relative ${className}`}>
        <ComboboxInput
          className={`${inputClassName} w-full pr-7`}
          displayValue={(v: string) => options.find((o) => o.value === v)?.label ?? ""}
          placeholder={placeholder}
          title={title}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <ComboboxButton className="absolute inset-y-0 right-2 flex items-center text-slate-400">
          ▾
        </ComboboxButton>
        {/* `anchor` forces Headless UI to render options in a portal (via
            floating-ui), so the panel escapes any `overflow-hidden` ancestor
            (e.g. the `.card` wrapper) instead of getting clipped. */}
        <ComboboxOptions
          anchor="bottom start"
          className="z-50 w-[var(--input-width)] overflow-auto rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200 [--anchor-gap:4px] [--anchor-max-height:16rem]"
        >
          {filtered.length === 0 && <div className="px-3 py-1.5 text-slate-400">No matches</div>}
          {groupOrder.map((group) => (
            <div key={group || "__default__"}>
              {group && (
                <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {group}
                </div>
              )}
              {groups.get(group)!.map((o) => (
                <ComboboxOption
                  key={o.value}
                  value={o.value}
                  className="cursor-pointer select-none px-3 py-1.5 data-[focus]:bg-accent-50 data-[focus]:text-accent-900"
                >
                  {o.label}
                </ComboboxOption>
              ))}
            </div>
          ))}
        </ComboboxOptions>
      </div>
    </HCombobox>
  );
}
