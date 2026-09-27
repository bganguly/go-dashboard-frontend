import { useCallback, useEffect, useRef, useState } from "react";
import Chart from "./components/Chart";
import SearchTable, { type SearchRow } from "./components/SearchTable";
import ThemeToggle from "./components/ThemeToggle";
import FilterSidebar, {
  EMPTY_FILTERS,
  type OrderFilters,
  type RegionOption,
} from "./components/FilterSidebar";

const SLOW_WAKING_MS = 800;

function mergeRegions(prev: RegionOption[], incoming: RegionOption[]): RegionOption[] {
  const map = new Map(prev.map((r) => [r.code, r]));
  let changed = false;
  for (const r of incoming) {
    if (!r?.code) continue;
    const existing = map.get(r.code);
    const name = r.name || existing?.name || r.code;
    if (!existing || existing.name !== name) { map.set(r.code, { code: r.code, name }); changed = true; }
  }
  if (!changed) return prev;
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export default function App() {
  const [filters, setFilters] = useState<OrderFilters>(EMPTY_FILTERS);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [backendRuntime, setBackendRuntime] = useState<string | null>(null);
  // Total from the chart's /api/aggregates response — null while (re)loading.
  const [chartTotal, setChartTotal] = useState<number | null>(null);
  // Exact count from SearchTable's background /count refine — null until settled.
  const [exactCount, setExactCount] = useState<number | null>(null);

  const [backendReady, setBackendReady] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [wakeStatus, setWakeStatus] = useState<"waking" | "ready" | "resolving" | null>(null);
  const [wakeMs, setWakeMs] = useState(0);
  const wakeStart = useRef<number>(0);
  const wakeInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset both on every new search/filter so consumers show a skeleton.
  useEffect(() => { setChartTotal(null); setExactCount(null); }, [filters, searchQuery]);

  useEffect(() => {
    wakeStart.current = performance.now();
    slowTimer.current = setTimeout(() => {
      setWakeStatus("waking");
      setWakeMs(0);
      wakeInterval.current = setInterval(() => {
        setWakeMs(Math.round(performance.now() - wakeStart.current));
      }, 100);
    }, SLOW_WAKING_MS);

    const markReady = () => {
      if (slowTimer.current) { clearTimeout(slowTimer.current); slowTimer.current = null; }
      if (wakeInterval.current) { clearInterval(wakeInterval.current); wakeInterval.current = null; }
      setBackendReady(true);
      setWakeStatus((s) => (s === "waking" ? "ready" : null));
      // transition to resolving after a brief "ready" flash, then children take over dismissal
      readyTimer.current = setTimeout(() => setWakeStatus((s) => (s === "ready" ? "resolving" : s)), 600);
    };

    fetch("/api/runtime")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { runtime: string }) => { setBackendRuntime(d.runtime); markReady(); })
      .catch(() => { markReady(); });

    return () => {
      if (slowTimer.current) clearTimeout(slowTimer.current);
      if (wakeInterval.current) clearInterval(wakeInterval.current);
      if (readyTimer.current) clearTimeout(readyTimer.current);
    };
  }, []);

  // Dismiss the banner once backend is ready and both children have finished loading.
  useEffect(() => {
    if (backendReady && !chartLoading && !tableLoading) {
      setWakeStatus((s) => (s === "resolving" ? null : s));
    }
  }, [backendReady, chartLoading, tableLoading]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/regions")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: RegionOption[]) => {
        if (cancelled || !Array.isArray(data)) return;
        setRegionOptions((prev) => mergeRegions(prev, data));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleRows = useCallback((rows: SearchRow[]) => {
    const incoming: RegionOption[] = [];
    for (const row of rows) {
      const region = row.region as { code?: string; name?: string } | undefined;
      if (region?.code) incoming.push({ code: region.code, name: region.name ?? region.code });
    }
    if (incoming.length === 0) return;
    setRegionOptions((prev) => mergeRegions(prev, incoming));
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full px-5 py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-gray-500">Aggregates, search, and order history.</p>
            <div className="flex items-center gap-2 mt-1">
              {import.meta.env.VITE_DEMO_SCALE && (
                <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background:"rgba(99,102,241,0.10)", border:"1px solid rgba(99,102,241,0.25)", color:"#818cf8" }}>
                  demo · {import.meta.env.VITE_DEMO_SCALE}
                </span>
              )}
              {backendRuntime && (
                <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium"
                  style={backendRuntime === "gke"
                    ? { background:"rgba(16,185,129,0.10)", border:"1px solid rgba(16,185,129,0.25)", color:"#34d399" }
                    : { background:"rgba(251,146,60,0.10)", border:"1px solid rgba(251,146,60,0.25)", color:"#fb923c" }}>
                  backend · {backendRuntime}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-1 justify-center px-4">
            {wakeStatus && (
              <div
                className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm"
                style={wakeStatus === "ready"
                  ? { background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.30)", color: "#4ade80" }
                  : { background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.30)", color: "#fbbf24" }}
              >
                {wakeStatus === "waking" ? (
                  <>
                    <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeDashoffset="20" />
                    </svg>
                    Backend waking up from idle —
                    <span className="ml-1 font-mono tabular-nums opacity-70">{(wakeMs / 1000).toFixed(1)}s</span>
                  </>
                ) : wakeStatus === "ready" ? (
                  <>
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Backend ready
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeDashoffset="20" />
                    </svg>
                    Backend resolving request…
                  </>
                )}
              </div>
            )}
          </div>
          <ThemeToggle />
        </header>
        <div className="flex flex-col gap-6 lg:flex-row">
          <FilterSidebar value={filters} onChange={setFilters} regionOptions={regionOptions} />
          <div className="min-w-0 flex-1 grid grid-cols-1 gap-6">
            <Chart filters={filters} searchQuery={searchQuery} onRangeChange={(from, to) => setFilters(f => ({ ...f, from, to }))} onTotalChange={setChartTotal} overrideTotal={exactCount} backendReady={backendReady} onLoadingChange={setChartLoading} />
            <SearchTable filters={filters} onRows={handleRows} onQueryChange={setSearchQuery} externalTotal={chartTotal} onRefinedCount={setExactCount} backendReady={backendReady} onLoadingChange={setTableLoading} />
          </div>
        </div>
      </main>
    </div>
  );
}
