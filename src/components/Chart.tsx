import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar, BarChart, Brush, CartesianGrid, Legend, Rectangle,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useIsDark } from "../hooks/useIsDark";
import { appendFilterParams, type OrderFilters } from "./FilterSidebar";

export interface AggregateBucket { date: string; [series: string]: string | number; }
interface RawCategory { totalOrders?: number; totalRevenue?: number; totalItems?: number; }
export interface RawAggregate { date: string; categories: Record<string, RawCategory>; }

const DEFAULT_TOP_N = 4;
const OTHER_KEY = "Others";
const OTHER_COLOR = "#94a3b8";
const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#a855f7","#ec4899"];
const STACK_ID = "aggregates";
const DRAG_DEBOUNCE_MS = 250;

function isOther(n: string) { const v = n.trim().toLowerCase(); return v === "other" || v === "others"; }

function computeTotals(data: RawAggregate[]) {
  const map = new Map<string, { revenue: number; orders: number }>();
  for (const entry of data)
    for (const [cat, c] of Object.entries(entry.categories ?? {})) {
      const prev = map.get(cat) ?? { revenue: 0, orders: 0 };
      prev.revenue += c.totalRevenue ?? 0; prev.orders += c.totalOrders ?? 0;
      map.set(cat, prev);
    }
  return [...map.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.orders - a.orders);
}

function buildBucket(entry: RawAggregate, top: string[], withOther: boolean): AggregateBucket {
  const topSet = new Set(top);
  const bucket: AggregateBucket = { date: entry.date };
  for (const cat of top) bucket[cat] = 0;
  if (withOther) bucket[OTHER_KEY] = 0;
  for (const [cat, c] of Object.entries(entry.categories ?? {})) {
    const key = topSet.has(cat) ? cat : withOther ? OTHER_KEY : null;
    if (key) bucket[key] = (bucket[key] as number) + (c.totalOrders ?? 0);
  }
  return bucket;
}

const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
};
const full = (n: number) => n.toLocaleString();

// "2026-06-05" -> "Jun 5" — the Brush centers each tick label on its data
// point, so the first/last ticks always have half their text overflowing the
// plot edge. A short label keeps that overflow small enough to stay inside
// the chart's margin instead of being clipped by the card.
function compactBrushDate(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function isoDay(d: Date) { return d.toISOString().slice(0, 10); }
function defaultRange() { return { from: "2020-01-01", to: isoDay(new Date()) }; }

interface ChartProps { endpoint?: string; topN?: number; filters?: OrderFilters; searchQuery?: string; onRangeChange?: (from: string, to: string) => void; onTotalChange?: (n: number) => void; overrideTotal?: number | null; backendReady?: boolean; onLoadingChange?: (loading: boolean) => void; }

export default function Chart({ endpoint = "/api/aggregates", topN = DEFAULT_TOP_N, filters, searchQuery, onRangeChange, onTotalChange, overrideTotal, backendReady = true, onLoadingChange }: ChartProps) {
  const [rawData, setRawData] = useState<RawAggregate[]>([]);
  const [range, setRange] = useState(defaultRange);
  const onTotalChangeRef = useRef(onTotalChange);
  const [loading, setLoading] = useState(false);
  const [warmingUp, setWarmingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const dragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [apiTotal, setApiTotal] = useState<number | null>(null);
  // A brush drag calls fetchAggregates directly, then (via onRangeChange)
  // updates the parent's filters — which changes filters?.from/to and
  // re-fires the effect below with the exact same resulting request. Track
  // the last request's querystring so that echo is a no-op instead of a
  // second full round trip to the backend.
  const lastRequestKeyRef = useRef<string | null>(null);

  const fetchAggregates = useCallback(async (from: string, to: string) => {
    const params = new URLSearchParams({ from: filters?.from || from, to: filters?.to || to });
    params.set("topCategories", String(topN));
    appendFilterParams(params, filters);
    if (searchQuery) params.set("q", searchQuery);
    const requestKey = params.toString();
    if (requestKey === lastRequestKeyRef.current) return;
    lastRequestKeyRef.current = requestKey;

    abortRef.current?.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    setLoading(true); setError(null); setApiTotal(null);
    try {
      const res = await fetch(`${endpoint}?${params}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRawData(Array.isArray(json.data) ? json.data : []);
      setApiTotal(typeof json.totalOrders === "number" ? json.totalOrders : null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      lastRequestKeyRef.current = null; // allow a retry of the same params after a real failure
      setError((err as Error).message);
    } finally { setLoading(false); }
  }, [endpoint, topN, filters, searchQuery]);

  // from/to are recomputed from filters (not read from `range` state) so that
  // clearing a sidebar date field takes effect immediately: `range` is only
  // ever written by a brush drag, and once a brush drag also syncs into
  // filters (onRangeChange), a stale range.to left behind after the filter
  // was cleared would otherwise keep silently narrowing every refetch via
  // fetchAggregates' `filters?.to || to` fallback forever.
  const onLoadingChangeRef = useRef(onLoadingChange);
  useEffect(() => { onLoadingChangeRef.current = onLoadingChange; }, [onLoadingChange]);
  useEffect(() => { onLoadingChangeRef.current?.(loading); }, [loading]);

  useEffect(() => {
    const from = filters?.from || defaultRange().from;
    const to = filters?.to || defaultRange().to;
    setRange({ from, to });
    if (!backendReady) return;
    // Reset dedup key so a new closure (searchQuery/filters changed) always
    // fires a fresh request even if the resulting URL matches a prior one.
    lastRequestKeyRef.current = null;
    fetchAggregates(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAggregates, filters?.from, filters?.to, backendReady]);

  useEffect(() => () => { abortRef.current?.abort(); lastRequestKeyRef.current = null; if (dragTimer.current) clearTimeout(dragTimer.current); }, []);

  useEffect(() => {
    if (!loading) { setWarmingUp(false); return; }
    const t = setTimeout(() => setWarmingUp(true), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  // Keep ref in sync so the effect below doesn't need onTotalChange as a dep.
  useEffect(() => { onTotalChangeRef.current = onTotalChange; });

  const isDark = useIsDark();
  const gridStroke = isDark ? "#374151" : "#e5e7eb";
  const axisColor  = isDark ? "#9ca3af" : "#6b7280";
  const tooltipStyle = { backgroundColor: isDark ? "#1f2937" : "#fff", border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`, borderRadius: 8, color: isDark ? "#f3f4f6" : "#111827" };

  // Sum of per-category order counts across the visible date range. One order
  // whose items span N categories is counted N times (once per category), so
  // this is always >= the distinct-order count, but it's instantly available
  // from the same data the bars use and is always consistent with what's shown.
  const summedCategoryOrders = useMemo(
    () => rawData.reduce((sum, day) => sum + Object.values(day.categories ?? {}).reduce((s, c) => s + (c.totalOrders ?? 0), 0), 0),
    [rawData],
  );
  const matchedOrders = apiTotal ?? summedCategoryOrders;

  useEffect(() => {
    if (apiTotal != null) onTotalChangeRef.current?.(apiTotal);
  }, [apiTotal]);

  const categoryTotals = useMemo(() => computeTotals(rawData), [rawData]);
  const topCategories  = useMemo(() => categoryTotals.filter(c => !isOther(c.category)).slice(0, topN).map(c => c.category), [categoryTotals, topN]);
  const withOther = categoryTotals.length > topCategories.length;
  const buckets   = useMemo(() => rawData.map(e => buildBucket(e, topCategories, withOther)), [rawData, topCategories, withOther]);

  const seriesRanked = useMemo(() => {
    const topSet = new Set(topCategories);
    const entries = topCategories.map(cat => ({ key: cat, orders: categoryTotals.find(c => c.category === cat)?.orders ?? 0 }));
    if (withOther) {
      const othersOrders = categoryTotals.filter(c => !topSet.has(c.category)).reduce((s, c) => s + c.orders, 0);
      entries.push({ key: OTHER_KEY, orders: othersOrders });
    }
    return entries.sort((a, b) => b.orders - a.orders);
  }, [categoryTotals, topCategories, withOther]);

  const seriesKeys = useMemo(() => seriesRanked.filter(s => showOthers || s.key !== OTHER_KEY).map(s => s.key), [seriesRanked, showOthers]);
  const colorMap   = useMemo(() => { const m = new Map<string,string>(); topCategories.forEach((c,i) => m.set(c, COLORS[i % COLORS.length])); return m; }, [topCategories]);
  const colorFor   = (k: string) => k === OTHER_KEY ? OTHER_COLOR : (colorMap.get(k) ?? OTHER_COLOR);

  const displayTotals = useMemo(() => {
    const tops = seriesRanked.filter(s => s.key !== OTHER_KEY).map(s => ({ category: s.key, orders: s.orders }));
    const others = seriesRanked.find(s => s.key === OTHER_KEY);
    if (others) tops.push({ category: others.key, orders: others.orders });
    return tops;
  }, [seriesRanked]);

  const handleBrushChange = useCallback(({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) => {
    if (startIndex == null || endIndex == null || !buckets.length || startIndex < 0 || endIndex >= buckets.length) return;
    const from = String(buckets[startIndex].date); const to = String(buckets[endIndex].date);
    if (from === range.from && to === range.to) return;
    setRange({ from, to });
    if (dragTimer.current) clearTimeout(dragTimer.current);
    dragTimer.current = setTimeout(() => {
      fetchAggregates(from, to);
      onRangeChange?.(from, to);
    }, DRAG_DEBOUNCE_MS);
  }, [buckets, range.from, range.to, fetchAggregates]);

  return (
    <section data-testid="chart" data-loading={loading ? "true" : undefined}
      className="relative rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Aggregates</h2>
          <p className="text-xs text-gray-500">{range.from} → {range.to}<span className="ml-2 text-gray-400">drag slider to rescan</span></p>
        </div>
        {loading && <span className="text-xs text-indigo-500" aria-live="polite">updating…</span>}
      </header>
      {error ? (
        <div className="flex h-72 items-center justify-center text-sm text-red-500">Failed: {error}</div>
      ) : buckets.length === 0 ? (
        <div className="flex h-72 flex-col items-center justify-center gap-2 text-sm text-gray-400">
          {loading ? (
            <>
              <span aria-hidden className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500 dark:border-gray-700 dark:border-t-indigo-400" />
              {warmingUp ? (
                <span className="text-center">
                  <span className="block">Backend waking up…</span>
                  <span className="block text-xs text-gray-300 dark:text-gray-600">Cloud Run scales to zero when idle — first request takes ~30s</span>
                </span>
              ) : "Loading…"}
            </>
          ) : "No data."}
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={320}>
            {/* The Y-axis (width={56} below) sits inside the left margin, so a
                numerically equal left/right margin still leaves far less real
                buffer on the right — right is padded by the Y-axis width too
                so both sides give the Brush's edge labels the same clearance. */}
            <BarChart data={buckets} margin={{ top: 8, right: 8 + 56, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="date" fontSize={12} tickMargin={8} stroke={axisColor} tick={{ fill: axisColor }} />
              <YAxis fontSize={12} width={56} stroke={axisColor} tick={{ fill: axisColor }} tickFormatter={compact} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: tooltipStyle.color }} itemStyle={{ color: tooltipStyle.color }} cursor={{ fill: isDark ? "#ffffff10" : "#00000008" }} formatter={(v) => Number(v).toLocaleString()} />
              <Legend wrapperStyle={{ fontSize: 12 }} content={() => (
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 text-xs">
                  {displayTotals.filter(ct => ct.category !== OTHER_KEY).map(ct => (
                    <span key={ct.category} data-testid="aggregate-tile" data-category={ct.category} className="inline-flex items-center gap-1.5 whitespace-nowrap" style={{ color: axisColor }}>
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(ct.category) }} />
                      {ct.category}
                      <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{full(ct.orders)}</span>
                    </span>
                  ))}
                  {withOther && (() => {
                    const othersTotal = displayTotals.find(ct => ct.category === OTHER_KEY);
                    return (
                      <label className="inline-flex cursor-pointer items-center gap-1.5" style={{ color: axisColor }}>
                        <input type="checkbox" checked={showOthers} onChange={e => setShowOthers(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                        Others
                        {othersTotal && <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{full(othersTotal.orders)}</span>}
                      </label>
                    );
                  })()}
                  <span data-testid="aggregate-tile-total" data-total={apiTotal ?? summedCategoryOrders} className="inline-flex items-center gap-1.5 whitespace-nowrap border-l border-gray-200 pl-4 font-medium dark:border-gray-700" style={{ color: axisColor }}>
                    Total
                    <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">
                      {loading
                        ? <span className="inline-block h-3 w-10 animate-pulse rounded bg-gray-200 align-middle dark:bg-gray-700" />
                        : (apiTotal ?? summedCategoryOrders).toLocaleString()}
                    </span>
                  </span>
                </div>
              )} />
              {seriesKeys.map((key, i) => (
                <Bar key={key} dataKey={key} stackId={STACK_ID} fill={colorFor(key)}
                  radius={i === seriesKeys.length - 1 ? [4,4,0,0] : [0,0,0,0]}
                  shape={(props: object) => <g data-testid="chart-bar" data-category={key}><Rectangle {...props} /></g>} />
              ))}
              <Brush dataKey="date" height={28} stroke="#6366f1" fill={isDark ? "#111827" : "#fff"} travellerWidth={10} tickFormatter={compactBrushDate} onChange={handleBrushChange} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </section>
  );
}
