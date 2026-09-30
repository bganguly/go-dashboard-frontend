# go-dashboard-frontend — React 19 + TypeScript + GCP Cloud Run

Production-grade **React 19 / TypeScript** SPA for the orders dashboard, delivering sub-second
search and chart responses across 4 M+ orders. Served via multi-stage Docker build (Vite → Nginx),
deployed as a GCP Cloud Run service. Nginx acts as a BFF proxy — routing `/api/*` to the Go backend.

---

## Live Service

| Endpoint | URL |
|---|---|
| **App** | available on demand via `deploy.sh` |
| **Portfolio demo** | https://bganguly.github.io/#go_dashboard |

> Cloud Run scales to zero when idle; run `deploy.sh` to provision GCP infrastructure and start the service.

---

## Using the App

1. **Search** — type in the search bar to query orders across all columns (name, notes, total, order ID, status, region, date) via the backend's `search_text` GIN trigram index; sub-second on 4 M+ rows.
2. **Filter** — use the sidebar to narrow by status, region, date range, or total amount; filters compose with search.
3. **Aggregates chart** — stacked bar chart of daily orders by product category; drag the brush to zoom into any date window.
4. **Dark mode** — system-preference detection via `useIsDark` hook; persisted to `localStorage`.

---

## Architecture

### Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              GCP Project                                │
│                                                                         │
│   Artifact Registry                                                     │
│   ┌──────────────────┐    ◄── gcloud builds submit (deploy.sh)         │
│   │  frontend image  │         Vite → Nginx multi-stage                │
│   │  backend image   │                                                  │
│   └──────────────────┘                                                  │
│           │ image pull                                                  │
│           ▼                                                             │
│   Cloud Run: go-dash-{lite|full}-frontend                               │
│   ┌─────────────────────────┐                                           │
│   │ Nginx (port 8080)       │       Cloud Run: go-dash-{lite|full}-backend │
│   │ • serves Vite dist      │       ┌──────────────────────┐           │
│   │ • proxies /api/* ───────┼──────►│ Go 1.25 / Gin (8080) │           │
│   │                         │ HTTPS │ • REST /api/*        │           │
│   │ • 0–1/1–3 instances     │       │ • pgx migrations     │           │
│   └─────────────────────────┘       │ • 0–1/0–5 instances  │           │
│           ▲                         └──────────┬───────────┘           │
│           │ HTTPS                              │                        │
│       Browser                    ┌─────────────▼──────────┐            │
│                                  │  Neon serverless PG     │            │
│                                  │  4 M+ orders            │            │
│                                  │  GIN trigram index      │            │
│                                  │  pre-agg summary tables │            │
│                                  └────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────┘

Deploy flow
───────────
local machine
  └─ deploy.sh
       ├─ [1] local   → Vite dev server on :5173
       ├─ [2] lite    → gcloud builds submit → Artifact Registry
       │                → gcloud run deploy (min=0 Cloud Run)
       └─ [3] full    → gcloud builds submit → Artifact Registry
                        → gcloud run deploy (min=1 Cloud Run)
```

### Key design decisions

| Concern | Approach |
|---|---|
| **BFF proxy** | Nginx forwards `/api/*` to Go backend via `${BACKEND_URL}` env var substituted at container start via `nginx.conf.template`; browser sees a single origin, no CORS. |
| **Image build** | `gcloud builds submit` — no local Docker required. Content-hash tag skips rebuilds when source is unchanged. |
| **Search** | GIN trigram index on denormalized `search_text` column; sub-second on 4 M+ rows. |
| **Aggregates** | Pre-aggregated summary tables — chart queries never hit the raw `orders` table. |
| **Pagination** | Keyset cursor `(placedAt, orderId)` — O(1) deep-page navigation, no OFFSET scans. |
| **IaC** | `gcloud run deploy` direct from `deploy.sh` — no Pulumi or Terraform required. |

---

## Stack

| Component | Implementation |
|---|---|
| **React / TypeScript front-end** | React 19, TypeScript, Vite, Tailwind CSS v4, Recharts |
| **BFF layer** | Nginx reverse proxy — `/api/*` → Go backend via `${BACKEND_URL}` env var |
| **Serverless / cloud-native** | Cloud Run — scales to zero (lite) or min-1 (full), no node management |
| **Image build** | `gcloud builds submit` — remote Cloud Build, no local Docker |
| **Performance** | Sub-second chart from pre-aggregated tables; sub-second search via GIN trigram index on `search_text` |

---

## Deployment / Running

```bash
./scripts/deploy.sh      # [1] local dev · [2] lite (scale-to-zero) · [3] full (min 1 instance)
./scripts/infra-down.sh  # [1] lite teardown · [2] full teardown · [3] both
```

| Action | Script | Prompt |
|---|---|---|
| Start local dev server (port 5173) | `./scripts/deploy.sh` | `[1]` |
| Deploy lite to GCP (scale-to-zero) | `./scripts/deploy.sh` | `[2]` |
| Deploy full to GCP (always warm) | `./scripts/deploy.sh` | `[3]` |
| Teardown GCP lite stack | `./scripts/infra-down.sh` | `[1]` |
| Teardown GCP full stack | `./scripts/infra-down.sh` | `[2]` |
| Teardown both GCP stacks | `./scripts/infra-down.sh` | `[3]` |

Deploy backend first (`go-dashboard-backend`) before deploying this service — `deploy.sh` reads the backend's `.env.gcp.{mode}` file for `BACKEND_URL`.

Override the backend target for local dev:

```bash
BACKEND_URL=http://other-host:8080 ./scripts/deploy.sh
```

### Cost

| Resource | Cost |
|---|---|
| **Cloud Run (lite)** | Scale-to-zero — ~$0 when idle |
| **Cloud Run (full)** | Min 1 instance — ~$5–10/mo |
| **Neon Postgres** | Free tier — auto-suspends when idle |
| **Artifact Registry** | Negligible at demo image count |

---

## Scale & Performance

> **4 M+ orders** served with sub-second search and chart responses. Full-text search hits a single GIN trigram index on `search_text`; chart aggregates hit pre-aggregated summary tables — neither touches the raw `orders` table on the hot path.

```
Browser ──HTTPS──► Nginx / Cloud Run ──proxy /api/*──► Go 1.25 / Cloud Run ──► Neon PG
                   go-dash-{mode}-frontend              go-dash-{mode}-backend    4 M+ rows
                   0–1/1–3 instances                    0–1/0–5 instances         GIN trigram index
```

---

## Features

- **Orders table** — paginated (keyset cursor), sortable (ID / customer / total / date), filter sidebar (status, region, date range, total range)
- **Full-text search** — multi-token AND search across all visible columns via backend `search_text` GIN trigram index; sub-second on 4 M+ rows
- **Aggregates chart** — stacked bar chart of daily orders by product category; sub-second from pre-aggregated tables, never queries raw orders
- **Date brush** — Recharts brush on the aggregates chart; drag to zoom into any date window
- **Dark mode** — system-preference detection via `useIsDark` hook; light / dark / system toggle
- **BFF proxy** — Nginx forwards `/api/*` to Go backend via `${BACKEND_URL}`; browser sees a single origin, no CORS
