
import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WakeStatus = "waking" | "ready" | "resolving" | null;

export interface RunResult {
  json: unknown;
  ms: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function fetchTimed(path: string): Promise<RunResult> {
  const t0 = performance.now();
  const res = await fetch(path);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();
  return { json, ms: Math.round(performance.now() - t0) };
}

export function timingClass(ms: number) {
  if (ms < 500) return { bg: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" };
  if (ms < 1000) return { bg: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" };
  return { bg: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" };
}

export function statusStyle(s: string) {
  const k = (s || "").toLowerCase();
  if (k.includes("complet")) return { bg: "rgba(16,185,129,0.15)", color: "#6ee7b7" };
  if (k.includes("pend")) return { bg: "rgba(245,158,11,0.15)", color: "#fcd34d" };
  if (k.includes("cancel")) return { bg: "rgba(239,68,68,0.15)", color: "#fca5a5" };
  if (k.includes("process")) return { bg: "rgba(99,102,241,0.15)", color: "#a5b4fc" };
  return { bg: "rgba(100,116,139,0.15)", color: "#94a3b8" };
}

// ── Sub-components ────────────────────────────────────────────────────────────

export function MetaBar({ ms, label }: { ms: number; label: string }) {
  const t = timingClass(ms);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
      <span style={{ fontSize: "0.6875rem", padding: "0.25rem 0.5rem", borderRadius: "9999px",
        fontFamily: "monospace", display: "inline-flex", alignItems: "center", gap: "0.25rem",
        background: t.bg, color: t.color, border: t.border }}>
        ⚡ {ms}ms
      </span>
      <span style={{ fontSize: "0.75rem", color: "#71717a" }}>{label}</span>
    </div>
  );
}

export function RawJson({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", background: "none",
          border: "none", cursor: "pointer", fontSize: "0.6875rem", color: "#52525b", padding: 0 }}>
        <span style={{ fontSize: "0.55rem", transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
        View raw JSON
      </button>
      {open && (
        <pre style={{ marginTop: "0.5rem", borderRadius: "0.5rem", padding: "0.75rem",
          fontSize: "0.6875rem", overflow: "auto", maxHeight: "12rem",
          background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)",
          color: "#71717a", fontFamily: "monospace", whiteSpace: "pre" }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export const TD: React.CSSProperties = { padding: "0.5rem 0.75rem", color: "#d4d4d8", borderBottom: "1px solid rgba(255,255,255,0.04)" };

export function OrderTable({ rows }: { data?: unknown; rows: Record<string, unknown>[] }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: "0.75rem", overflow: "hidden", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
        <thead>
          <tr>{["#","ID","Status","Total","Customer","Region","Placed"].map(h => (
            <th key={h} style={{ textAlign: "left", padding: "0.5rem 0.75rem", fontWeight: 500,
              color: "#71717a", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((o, i) => {
            const c = (o.customer as Record<string,string>) || {};
            const r = (o.region as Record<string,string>) || {};
            const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "—";
            const ss = statusStyle(String(o.status || ""));
            return (
              <tr key={i}>
                <td style={TD}><span style={{ color: "#71717a" }}>{i+1}</span></td>
                <td style={{ ...TD, fontFamily: "monospace" }}>{String(o.id ?? "—")}</td>
                <td style={TD}>
                  <span style={{ fontSize: "0.6875rem", fontWeight: 600, padding: "0.125rem 0.5rem",
                    borderRadius: "9999px", background: ss.bg, color: ss.color }}>
                    {String(o.status || "—")}
                  </span>
                </td>
                <td style={{ ...TD, fontFamily: "monospace", color: "#34d399" }}>
                  {String(o.currency || "$")}{Number(o.total || 0).toFixed(2)}
                </td>
                <td style={TD}>{name}</td>
                <td style={{ ...TD, color: "#71717a" }}>{r.name || r.code || "—"}</td>
                <td style={{ ...TD, fontFamily: "monospace", color: "#71717a" }}>{String(o.placedAt || "—").slice(0,10)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CustomerTable({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: "0.75rem", overflow: "hidden", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
        <thead>
          <tr>{["#","Name","Email","Region"].map(h => (
            <th key={h} style={{ textAlign: "left", padding: "0.5rem 0.75rem", fontWeight: 500,
              color: "#71717a", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const r = (c.region as Record<string,string>) || {};
            const name = (c.name as string) || [(c as Record<string,string>).firstName, (c as Record<string,string>).lastName].filter(Boolean).join(" ") || "—";
            return (
              <tr key={i}>
                <td style={{ ...TD, color: "#71717a" }}>{i+1}</td>
                <td style={TD}>{name}</td>
                <td style={{ ...TD, fontFamily: "monospace", color: "#a1a1aa", fontSize: "0.7rem" }}>{String(c.email || "—")}</td>
                <td style={{ ...TD, color: "#71717a" }}>{r.name || r.code || String(c.regionCode || "—")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StatGrid({ stats }: { stats: { label: string; value: string; color?: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
      {stats.map(s => (
        <div key={s.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "0.625rem", padding: "0.75rem 1rem" }}>
          <div style={{ fontSize: "0.625rem", fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase",
            color: "#52525b", marginBottom: "0.25rem" }}>{s.label}</div>
          <div style={{ fontSize: "1.125rem", fontWeight: 700, color: s.color || "#f4f4f5" }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

export function AggTable({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: "0.75rem", overflow: "hidden", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
        <thead>
          <tr>{["Date","Orders","Revenue","Categories"].map(h => (
            <th key={h} style={{ textAlign: "left", padding: "0.5rem 0.75rem", fontWeight: 500,
              color: "#71717a", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.slice(0,10).map((day, i) => {
            const cats = Object.values((day.categories as Record<string, { totalOrders?: number; totalRevenue?: number }>) || {});
            const dOrders  = cats.reduce((s, c) => s + (c.totalOrders  || 0), 0);
            const dRevenue = cats.reduce((s, c) => s + (c.totalRevenue || 0), 0);
            const catNames = Object.keys((day.categories as object) || {}).slice(0,3).join(", ");
            return (
              <tr key={i}>
                <td style={{ ...TD, fontFamily: "monospace", color: "#a1a1aa" }}>{String(day.date || "—")}</td>
                <td style={TD}>{dOrders.toLocaleString()}</td>
                <td style={{ ...TD, fontFamily: "monospace", color: "#34d399" }}>
                  ${dRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td style={{ ...TD, color: "#52525b", fontSize: "0.7rem" }}>{catNames}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Card({ method = "GET", path, subtitle, children }: {
  method?: "GET" | "POST";
  path: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const isPost = method === "POST";
  return (
    <div style={{ borderRadius: "1rem", overflow: "hidden",
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "1rem", padding: "1rem 1.5rem", background: "none", border: "none", cursor: "pointer",
          textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
          <span style={{ flexShrink: 0, fontSize: "0.6875rem", padding: "0.125rem 0.5rem",
            borderRadius: "9999px", fontWeight: 600,
            background: isPost ? "rgba(99,102,241,0.12)" : "rgba(16,185,129,0.12)",
            border: isPost ? "1px solid rgba(99,102,241,0.3)" : "1px solid rgba(16,185,129,0.3)",
            color: isPost ? "#a5b4fc" : "#34d399" }}>
            {method}
          </span>
          <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#a1a1aa", flexShrink: 0 }}>{path}</span>
          <span style={{ fontSize: "0.75rem", color: "#52525b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</span>
        </div>
        <svg style={{ width: "1rem", height: "1rem", color: "#52525b", flexShrink: 0,
          transition: "transform .2s", transform: open ? "rotate(180deg)" : "none" }}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      {open && (
        <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function RunBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem",
        fontSize: "0.75rem", fontWeight: 600, borderRadius: "0.5rem", padding: "0.375rem 1rem",
        border: "1px solid rgba(139,92,246,0.4)", cursor: loading ? "default" : "pointer",
        background: "rgba(139,92,246,0.15)", color: "#c4b5fd", opacity: loading ? 0.4 : 1, flexShrink: 0 }}>
      {loading ? <Spinner /> : <PlayIcon />}
      {loading ? "Running…" : "Run"}
    </button>
  );
}

export function Spinner() {
  return (
    <span style={{ display: "inline-block", width: "0.875rem", height: "0.875rem",
      border: "2px solid rgba(139,92,246,0.3)", borderTopColor: "#a78bfa",
      borderRadius: "50%", animation: "spin .6s linear infinite" }} />
  );
}

export function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 3l14 9-14 9V3z"/>
    </svg>
  );
}

export function MonoParam({ label, val }: { label: string; val: string }) {
  return (
    <span style={{ fontSize: "0.6875rem", fontFamily: "monospace", color: "#52525b" }}>
      {label}=<span style={{ color: "#a78bfa" }}>{val}</span>
    </span>
  );
}

export function ErrBox({ msg }: { msg: string }) {
  return (
    <div style={{ borderRadius: "0.5rem", padding: "0.75rem", fontSize: "0.75rem", color: "#f87171",
      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
      {msg}
    </div>
  );
}

export function LoadingRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "#52525b" }}>
      <Spinner /> Sending request…
    </div>
  );
}

// ── Shared card styles ────────────────────────────────────────────────────────

export const ROW: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  flexWrap: "wrap", gap: "0.75rem", paddingTop: "1rem", marginBottom: "1rem",
};
export const PARAMS: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" };
export const DATE_INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  color: "#e4e4e7", borderRadius: "0.5rem", padding: "0.375rem 0.75rem",
  fontSize: "0.8rem", fontFamily: "monospace", outline: "none",
};
