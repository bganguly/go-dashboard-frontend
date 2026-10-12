
import { useMemo, useState } from "react";

export function cn(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export interface ComboOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  legend: string;
  options: ComboOption[];
  selected: string[];
  onToggle: (value: string) => void;
  searchTestId: string;
  optionTestId: (value: string) => string;
  placeholder: string;
  emptyText?: string;
}

export default function MultiSelectFilter({
  legend,
  options,
  selected,
  onToggle,
  searchTestId,
  optionTestId,
  placeholder,
  emptyText,
}: MultiSelectFilterProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const listboxId = `${searchTestId}-listbox`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            o.value.toLowerCase().includes(q),
        )
      : options;
    return [...matches].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );
  }, [options, query]);

  const labelFor = (v: string) =>
    options.find((o) => o.value === v)?.label ?? v;

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {legend}
      </legend>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            >
              {labelFor(v)}
              <button
                type="button"
                onClick={() => onToggle(v)}
                aria-label={`Remove ${labelFor(v)}`}
                className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          type="search"
          data-testid={searchTestId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={`Filter ${legend} options`}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
        />

        {open && (
          <div
            role="listbox"
            id={listboxId}
            className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-950"
          >
            {options.length === 0 ? (
              <p className="px-2 py-1 text-xs text-gray-400">
                {emptyText ?? "No options."}
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-1 text-xs text-gray-400">No matches.</p>
            ) : (
              filtered.map((opt) => {
                const isSelected = selected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-testid={optionTestId(opt.value)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onToggle(opt.value)}
                    className={cn(
                      "flex w-full items-center justify-between px-2 py-1 text-left text-sm",
                      isSelected
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800",
                    )}
                  >
                    <span>{opt.label}</span>
                    {isSelected && <span aria-hidden>✓</span>}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}
