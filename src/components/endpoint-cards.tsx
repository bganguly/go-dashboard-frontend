
import { useRef, useState } from "react";
import {
  AggTable, Card, CustomerTable, DATE_INPUT, ErrBox, fetchTimed,
  LoadingRow, MetaBar, MonoParam, OrderTable, PARAMS, RawJson,
  ROW, RunBtn, Spinner, StatGrid, type RunResult,
} from "./explorer-utils";

export function OrdersCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null); setResult(null);
    try {
      const r = await fetchTimed("/api/orders?size=10&sort=placedAt,desc");
      setResult(r);
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }

  const json = result?.json as { data?: unknown[]; total?: number } | null;
  const rows = (json?.data ?? []) as Record<string, unknown>[];
  const total = json?.total ?? rows.length;

  return (
    <Card path="/api/orders" subtitle="Latest orders — paginated, sorted by date descending">
      <div style={ROW}>
        <div style={PARAMS}>
          <MonoParam label="size" val="10" />
          <MonoParam label="sort" val="placedAt,desc" />
        </div>
        <RunBtn onClick={run} loading={loading} />
      </div>
      {loading && <LoadingRow />}
      {err && <ErrBox msg={err} />}
      {result && !loading && (
        <>
          <MetaBar ms={result.ms} label={`${Number(total).toLocaleString()} total orders · showing first 10`} />
          {rows.length > 0 && <OrderTable rows={rows} />}
          <RawJson data={result.json} />
        </>
      )}
    </Card>
  );
}

export function SearchCard() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setLoading(true); setErr(null); setResult(null);
    try {
      const r = await fetchTimed("/api/orders?q=" + encodeURIComponent(q.trim()) + "&size=10");
      setResult(r);
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }

  const json = result?.json as { data?: unknown[]; total?: number } | null;
  const rows = (json?.data ?? []) as Record<string, unknown>[];
  const total = json?.total ?? rows.length;

  return (
    <Card path="/api/orders?q=…" subtitle="Full-text search via GIN pg_bigm index — 2-char minimum">
      <div style={ROW}>
        <div style={{ ...PARAMS, alignItems: "center" }}>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && run()}
            placeholder="e.g. gupta, sara, east…"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#e4e4e7", borderRadius: "0.5rem", padding: "0.375rem 0.75rem",
              fontSize: "0.8rem", fontFamily: "monospace", outline: "none", width: "220px" }}
          />
          <MonoParam label="size" val="10" />
        </div>
        <RunBtn onClick={run} loading={loading} />
      </div>
      {loading && <LoadingRow />}
      {err && <ErrBox msg={err} />}
      {result && !loading && (
        <>
          <MetaBar ms={result.ms} label={`${Number(total).toLocaleString()} match${Number(total) !== 1 ? "es" : ""} for "${q}"`} />
          {rows.length > 0
            ? <OrderTable rows={rows} />
            : <p style={{ fontSize: ".75rem", color: "#71717a" }}>No results.</p>}
          <RawJson data={result.json} />
        </>
      )}
    </Card>
  );
}

export function AggregatesCard() {
  const today  = new Date().toISOString().slice(0, 10);
  const ago60  = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const [from, setFrom] = useState(ago60);
  const [to,   setTo]   = useState(today);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!from || !to) return;
    setLoading(true); setErr(null); setResult(null);
    try {
      const r = await fetchTimed(`/api/aggregates?from=${from}&to=${to}&topCategories=3`);
      setResult(r);
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }

  const json = result?.json as { data?: unknown[] } | unknown[] | null;
  const raw  = Array.isArray(json) ? json : (json as { data?: unknown[] })?.data ?? [];
  type AggRow = { categories?: Record<string, { totalOrders?: number; totalRevenue?: number }> };
  const rows = raw as AggRow[];
  let orders = 0, revenue = 0;
  rows.forEach(d => Object.values(d.categories || {}).forEach(c => {
    orders  += c.totalOrders  || 0;
    revenue += c.totalRevenue || 0;
  }));

  return (
    <Card path="/api/aggregates" subtitle="Pre-aggregated daily totals by category — millisecond response">
      <div style={ROW}>
        <div style={{ ...PARAMS, alignItems: "center" }}>
          <span style={{ fontSize: "0.6875rem", fontFamily: "monospace", color: "#52525b" }}>from</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ ...DATE_INPUT, width: "150px" }} />
          <span style={{ fontSize: "0.6875rem", fontFamily: "monospace", color: "#52525b" }}>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ ...DATE_INPUT, width: "150px" }} />
          <MonoParam label="topCategories" val="3" />
        </div>
        <RunBtn onClick={run} loading={loading} />
      </div>
      {loading && <LoadingRow />}
      {err && <ErrBox msg={err} />}
      {result && !loading && (
        <>
          <MetaBar ms={result.ms} label={`${rows.length} day${rows.length !== 1 ? "s" : ""} · ${from} → ${to}`} />
          <StatGrid stats={[
            { label: "Total Orders",  value: orders.toLocaleString() },
            { label: "Est. Revenue",  value: "$" + revenue.toLocaleString(undefined, { maximumFractionDigits: 0 }), color: "#34d399" },
            { label: "Days Returned", value: String(rows.length) },
          ]} />
          <AggTable rows={rows as unknown as Record<string, unknown>[]} />
          <RawJson data={result.json} />
        </>
      )}
    </Card>
  );
}

export function CustomersCard() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null); setResult(null);
    try {
      const url = "/api/customers?limit=10" + (q.trim() ? "&q=" + encodeURIComponent(q.trim()) : "");
      const r = await fetchTimed(url);
      setResult(r);
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }

  const json = result?.json;
  const rows = (Array.isArray(json) ? json : (json as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[];

  return (
    <Card path="/api/customers" subtitle="Customer list — cursor-paginated">
      <div style={ROW}>
        <div style={{ ...PARAMS, alignItems: "center" }}>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && run()}
            placeholder="e.g. gupta, sara…"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#e4e4e7", borderRadius: "0.5rem", padding: "0.375rem 0.75rem",
              fontSize: "0.8rem", fontFamily: "monospace", outline: "none", width: "200px" }}
          />
          <MonoParam label="limit" val="10" />
        </div>
        <RunBtn onClick={run} loading={loading} />
      </div>
      {loading && <LoadingRow />}
      {err && <ErrBox msg={err} />}
      {result && !loading && (
        <>
          <MetaBar ms={result.ms} label={`${rows.length} customer${rows.length !== 1 ? "s" : ""} returned`} />
          {rows.length > 0
            ? <CustomerTable rows={rows} />
            : <p style={{ fontSize: ".75rem", color: "#71717a" }}>No results.</p>}
          <RawJson data={result.json} />
        </>
      )}
    </Card>
  );
}

export function RegionsCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null); setResult(null);
    try { setResult(await fetchTimed("/api/regions")); }
    catch (e) { setErr(String(e)); }
    setLoading(false);
  }

  const rows = Array.isArray(result?.json) ? result!.json as unknown[] : [];

  return (
    <Card path="/api/regions" subtitle="All regions — no parameters">
      <div style={ROW}>
        <p style={{ fontSize: ".6875rem", color: "#52525b" }}>Returns the full list of regions used for filtering.</p>
        <RunBtn onClick={run} loading={loading} />
      </div>
      {loading && <LoadingRow />}
      {err && <ErrBox msg={err} />}
      {result && !loading && (
        <>
          <MetaBar ms={result.ms} label={`${rows.length} region${rows.length !== 1 ? "s" : ""} returned`} />
          {rows.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "0.75rem" }}>
              {(rows as Record<string, unknown>[]).map((r, i) => {
                const name  = String(r.name  || r.code || r.id || "—");
                const code  = r.code && r.code !== r.name ? String(r.code) : null;
                return (
                  <span key={i} style={{ fontSize: "0.6875rem", padding: "0.2rem 0.6rem",
                    borderRadius: "9999px", background: "rgba(129,140,248,0.10)",
                    border: "1px solid rgba(129,140,248,0.25)", color: "#a5b4fc" }}>
                    {code ? `${code} · ${name}` : name}
                  </span>
                );
              })}
            </div>
          )}
          <RawJson data={result.json} />
        </>
      )}
    </Card>
  );
}

interface DayRow { date: string; categories: Record<string, { totalOrders?: number; totalRevenue?: number }> }

export function BrushCard() {
  const [phase, setPhase]     = useState<"idle" | "loading" | "ready">("idle");
  const [brushData, setBD]    = useState<DayRow[]>([]);
  const [brushL, setBL]       = useState(0);
  const [brushR, setBR]       = useState(1);
  const [brushRes, setBRes]   = useState<(RunResult & { from: string; to: string }) | null>(null);
  const [fetching, setFetch]  = useState(false);

  const trackRef  = useRef<HTMLDivElement>(null);
  const brushLRef = useRef(0);
  const brushRRef = useRef(1);
  const brushDRef = useRef<DayRow[]>([]);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  brushLRef.current = brushL;
  brushRRef.current = brushR;
  brushDRef.current = brushData;

  async function doFetch(l: number, r: number) {
    const data = brushDRef.current;
    if (!data.length) return;
    const li = Math.round(l * (data.length - 1)), ri = Math.round(r * (data.length - 1));
    const from = data[li]?.date, to = data[ri]?.date;
    if (!from || !to) return;
    setFetch(true);
    try {
      const r2 = await fetchTimed(`/api/aggregates?from=${from}&to=${to}&topCategories=1`);
      setBRes({ ...r2, from, to });
    } catch {} finally { setFetch(false); }
  }

  async function initBrush() {
    setPhase("loading");
    const today = new Date().toISOString().slice(0, 10);
    const ago   = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    try {
      const { json, ms } = await fetchTimed(`/api/aggregates?from=${ago}&to=${today}&topCategories=1`);
      const raw  = (json as { data?: DayRow[] })?.data ?? (json as DayRow[]);
      const data = Array.isArray(raw) ? raw as DayRow[] : [];
      if (!data.length) throw new Error("no data");
      setBD(data); setBL(0); setBR(1); setPhase("ready");
      setBRes({ json, ms, from: data[0].date, to: data[data.length - 1].date });
    } catch { setPhase("idle"); }
  }

  function makeDrag(side: "l" | "r") {
    return {
      onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (!brushDRef.current.length || !trackRef.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (!e.currentTarget.hasPointerCapture(e.pointerId) || !trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const pos  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const min  = 1 / Math.max(brushDRef.current.length, 1);
        if (side === "l") { const v = Math.min(pos, brushRRef.current - min); brushLRef.current = v; setBL(v); }
        else              { const v = Math.max(pos, brushLRef.current + min); brushRRef.current = v; setBR(v); }
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => doFetch(brushLRef.current, brushRRef.current), 180);
      },
      onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      },
    };
  }

  const totals = brushData.map(d => Object.values(d.categories || {}).reduce((s, c) => s + (c.totalOrders || 0), 0));
  const mx     = Math.max(...totals, 1);
  const n      = brushData.length;
  const [li, ri] = n ? [Math.round(brushL * (n - 1)), Math.round(brushR * (n - 1))] : [0, 0];

  const bRaw  = brushRes ? ((brushRes.json as { data?: DayRow[] })?.data ?? brushRes.json) : null;
  const bRows = Array.isArray(bRaw) ? bRaw as DayRow[] : [];
  let bOrders = 0, bRevenue = 0;
  bRows.forEach(d => Object.values(d.categories || {}).forEach(c => { bOrders += c.totalOrders || 0; bRevenue += c.totalRevenue || 0; }));

  return (
    <Card path="/api/aggregates?from=…&to=…" subtitle="Drag brush handles · sub-second re-fetch">
      {phase === "idle" && (
        <div style={ROW}>
          <p style={{ fontSize: ".6875rem", color: "#52525b" }}>Loads a year of aggregate data, then drag the handles to re-query any sub-range live.</p>
          <RunBtn onClick={initBrush} loading={false} />
        </div>
      )}
      {phase === "loading" && (
        <div style={ROW}>
          <p style={{ fontSize: ".6875rem", color: "#52525b" }}>Loading…</p>
          <RunBtn onClick={() => {}} loading={true} />
        </div>
      )}
      {phase === "ready" && (
        <div style={{ marginTop: "1rem" }}>
          <svg viewBox="0 0 600 80" width="100%" height="80" preserveAspectRatio="none"
            style={{ display: "block", borderRadius: "6px", marginBottom: "0.5rem" }}>
            {totals.map((v, i) => {
              const x = (i / n) * 600, bw = 600 / n, h = Math.max(2, (v / mx) * 76);
              return <rect key={i} x={x.toFixed(2)} y={(80 - h).toFixed(2)}
                width={(bw - 0.4).toFixed(2)} height={h.toFixed(2)}
                fill={i >= li && i <= ri ? "#818cf8" : "#1e293b"} rx="1" />;
            })}
          </svg>
          <div ref={trackRef} style={{ position: "relative", height: "20px", marginTop: "8px",
            background: "rgba(255,255,255,0.04)", borderRadius: "10px",
            cursor: "crosshair", userSelect: "none" }}>
            <div style={{ position: "absolute", top: 0, height: "100%",
              left: `${brushL * 100}%`, width: `${(brushR - brushL) * 100}%`,
              background: "rgba(129,140,248,0.18)", border: "1px solid rgba(129,140,248,0.45)",
              borderRadius: "10px", pointerEvents: "none" }} />
            {(["l", "r"] as const).map(side => (
              <div key={side} {...makeDrag(side)} style={{
                position: "absolute", top: "50%",
                left: `${(side === "l" ? brushL : brushR) * 100}%`,
                transform: "translate(-50%,-50%)", width: "10px", height: "22px",
                background: "#818cf8", borderRadius: "3px", cursor: "ew-resize",
                touchAction: "none", zIndex: 2,
              }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
            <span style={{ fontSize: "0.625rem", fontFamily: "monospace", color: "#52525b" }}>{brushData[li]?.date}</span>
            <span style={{ fontSize: "0.625rem", fontFamily: "monospace", color: "#52525b" }}>{brushData[ri]?.date}</span>
          </div>
          <div style={{ marginTop: "1rem" }}>
            {fetching
              ? <LoadingRow />
              : brushRes && (
                <>
                  <MetaBar ms={brushRes.ms} label={`${bRows.length} day${bRows.length !== 1 ? "s" : ""} · ${brushRes.from} → ${brushRes.to}`} />
                  <StatGrid stats={[
                    { label: "Orders",        value: bOrders.toLocaleString() },
                    { label: "Est. Revenue",  value: "$" + bRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 }), color: "#34d399" },
                    { label: "Days in range", value: String(bRows.length) },
                  ]} />
                </>
              )
            }
          </div>
        </div>
      )}
    </Card>
  );
}
