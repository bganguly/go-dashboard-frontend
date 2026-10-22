import { useEffect, useRef, useState } from "react";
import { Spinner, type WakeStatus } from "./explorer-utils";
import {
  AggregatesCard, BrushCard, CustomersCard,
  OrdersCard, RegionsCard, SearchCard,
} from "./endpoint-cards";

const SLOW_WAKING_MS = 800;

export default function ApiExplorer() {
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>(null);
  const [wakeMs, setWakeMs] = useState(0);
  const wakeStart   = useRef(0);
  const wakeInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const slowTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    wakeStart.current = performance.now();
    slowTimer.current = setTimeout(() => {
      setWakeStatus("waking");
      setWakeMs(0);
      wakeInterval.current = setInterval(() => setWakeMs(Math.round(performance.now() - wakeStart.current)), 100);
    }, SLOW_WAKING_MS);

    const markReady = () => {
      if (slowTimer.current)   { clearTimeout(slowTimer.current);   slowTimer.current = null; }
      if (wakeInterval.current){ clearInterval(wakeInterval.current); wakeInterval.current = null; }
      setWakeStatus(s => (s === "waking" ? "ready" : null));
      readyTimer.current = setTimeout(() => setWakeStatus(s => (s === "ready" ? null : s)), 1200);
    };

    fetch("/api/orders?pageSize=10&sort=placedAt&dir=desc").then(r => r.ok ? r.json() : Promise.reject()).then(markReady).catch(markReady);

    return () => {
      if (slowTimer.current)    clearTimeout(slowTimer.current);
      if (wakeInterval.current) clearInterval(wakeInterval.current);
      if (readyTimer.current)   clearTimeout(readyTimer.current);
    };
  }, []);

  return (
    <div style={{ background: "#0f0f13", color: "#f4f4f5", minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "14px", WebkitFontSmoothing: "antialiased" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Nav */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 40,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(15,15,19,0.9)", backdropFilter: "blur(16px)" }}>
        <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "0 1.5rem",
          height: "3.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="https://bganguly.github.io/#go_dashboard"
            onClick={e => {
              e.preventDefault();
              const url = 'https://bganguly.github.io/#go_dashboard';
              try { if (window.opener && !window.opener.closed) { window.opener.location.href = url; window.close(); return; } } catch (_) {}
              window.location.href = url;
            }}
            style={{ display: "flex", alignItems: "center", gap: "0.5rem",
              color: "#71717a", textDecoration: "none", fontSize: "0.875rem" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M5 12l7-7M5 12l7 7"/>
            </svg>
            Portfolio
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {wakeStatus === "waking" && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem",
                background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.30)",
                color: "#fbbf24", borderRadius: "0.5rem", padding: "0.375rem 0.75rem", fontSize: "0.75rem" }}>
                <Spinner />
                Probing GET /api/orders —
                <span style={{ fontFamily: "monospace", marginLeft: "4px" }}>{(wakeMs / 1000).toFixed(1)}s</span>
              </div>
            )}
            {wakeStatus === "ready" && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem",
                background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.30)",
                color: "#4ade80", borderRadius: "0.5rem", padding: "0.375rem 0.75rem", fontSize: "0.75rem" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Backend ready
              </div>
            )}
            <span style={{ fontSize: "0.6875rem", padding: "0.125rem 0.5rem", borderRadius: "9999px",
              background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc" }}>
              Go 1.23 · Gin · pgx v5 · AWS · App Runner
            </span>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div style={{ padding: "7rem 1.5rem 2.5rem", maxWidth: "64rem", margin: "0 auto" }}>
        <p style={{ fontSize: "0.75rem", fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase",
          color: "#818cf8", marginBottom: "0.75rem" }}>API Explorer</p>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#f4f4f5", marginBottom: "0.5rem" }}>
          Live API — Orders Dashboard (AWS · Go 1.23)
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#71717a", maxWidth: "36rem" }}>
          Run real requests against the Go REST API backed by Neon Postgres with pg_bigm full-text search.
        </p>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem",
          padding: "0.375rem 0.75rem", borderRadius: "0.5rem", marginTop: "1rem",
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          color: "#52525b", fontSize: "0.75rem", fontFamily: "monospace" }}>
          <span style={{ width: "0.375rem", height: "0.375rem", borderRadius: "50%",
            background: "#818cf8", flexShrink: 0, display: "inline-block" }} />
          {window.location.origin}/api
        </div>
      </div>

      {/* Cards */}
      <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "0 1.5rem 6rem",
        display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <OrdersCard />
        <SearchCard />
        <AggregatesCard />
        <CustomersCard />
        <RegionsCard />
        <BrushCard />
      </div>
    </div>
  );
}
