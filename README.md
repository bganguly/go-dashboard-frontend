# dashboard-frontend — React 19 + TypeScript + GCP Cloud Run

Production-grade **React 19 / TypeScript** SPA for the orders dashboard, delivering sub-second
search and chart responses across 4 M+ orders. Served via multi-stage Docker build (Vite → Nginx),
deployed as a GCP Cloud Run service managed by **Pulumi TypeScript IaC**. Nginx acts as a BFF proxy —
routing `/api/*` to the Spring Boot backend with TLS SNI passthrough.

---

## Live Service

| Endpoint | URL |
|---|---|
| **App** | available on demand via `deploy.sh` |
| **Portfolio demo** | https://bganguly.github.io/#orders_dashboard |

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
│   ┌───────────────────────────────────────────────────────────────┐     │
│   │                       dash-vpc (private)                      │     │
│   │                                                               │     │
│   │  Cloud Run: dash-frontend          Cloud Run: dash-backend    │     │
│   │  ┌─────────────────────────┐       ┌──────────────────────┐   │     │
│   │  │ Nginx (port 80)         │       │ Spring Boot (8080)   │   │     │
│   │  │ • serves Vite dist      │ HTTPS │ • REST /api/*        │   │     │
│   │  │ • proxies /api/* ───────┼──────►│ • Flyway migrations  │   │     │
│   │  │   proxy_ssl_server_name │  SNI  │ • 1–5 instances      │   │     │
│   │  │ • 0–3 instances         │       └──────────┬───────────┘   │     │
│   │  └─────────────────────────┘                  │               │     │
│   │           ▲                          Direct VPC Egress        │     │
│   └───────────┼──────────────────────────────────┼───────────────┘     │
│               │ HTTPS                             │ private IP           │
│           Browser                    ┌────────────▼───────────┐        │
│                                      │  Cloud SQL PG 16       │        │
│                                      │  4 M+ orders           │        │
│                                      │  GIN trigram index     │        │
│                                      │  pre-agg summary tables│        │
│                                      └────────────────────────┘        │
│                                                                         │
│   Pulumi TypeScript (infra/index.ts) manages all resources above        │
│   Secret Manager: dash-database-url (injected into backend at runtime)  │
└─────────────────────────────────────────────────────────────────────────┘

Deploy flow
───────────
local machine
  └─ deploy.sh
       ├─ [1] local   → Vite dev server on :3006
       ├─ [2] lite    → gcloud builds submit → Artifact Registry
       │                → pulumi up (min=0 Cloud Run)
       └─ [3] full    → gcloud builds submit → Artifact Registry
                        → pulumi up (min=1 Cloud Run)
```

### Key design decisions

| Concern | Approach |
|---|---|
| **BFF proxy** | Nginx forwards `/api/*` to Spring Boot with `proxy_ssl_server_name on` for Cloud Run SNI; browser sees a single origin, no CORS. |
| **Image build** | `gcloud builds submit` — no local Docker required. Content-hash tag skips rebuilds when source is unchanged. |
| **Search** | GIN trigram index on denormalized `search_text` column in Cloud SQL; sub-second on 4 M+ rows without touching raw `orders`. |
| **Aggregates** | Pre-aggregated summary tables in Cloud SQL — chart queries never hit the raw `orders` table. |
| **Pagination** | Keyset cursor `(placedAt, orderId)` — O(1) deep-page navigation, no OFFSET scans. |
| **IaC** | Pulumi TypeScript (`infra/index.ts`) — Cloud Run service, IAM, VPC connector, `BACKEND_URL` env all declared as code. |

---

## Stack

| Component | Implementation |
|---|---|
| **React / TypeScript front-end** | React 19, TypeScript, Vite, Tailwind CSS, Recharts |
| **BFF layer** | Nginx reverse proxy — `/api/*` → Spring Boot (TLS + `proxy_ssl_server_name on` for Cloud Run SNI) |
| **Serverless / cloud-native** | Cloud Run — 0–3 instances, scales to zero, no node management |
| **IaC** | Pulumi TypeScript (`infra/index.ts`) — frontend Cloud Run service, IAM, and `BACKEND_URL` env declared as code |
| **Image build** | `gcloud builds submit` — remote Cloud Build, no local Docker |
| **Performance** | Sub-second chart from pre-aggregated Cloud SQL tables; sub-second search via GIN trigram index on `search_text` |

---

## Deployment / Running

```bash
./scripts/deploy.sh      # [1] local dev · [2] lite (scale-to-zero) · [3] full (min 1 instance)
./scripts/infra-down.sh  # [1] stop local · [2] destroy lite · [3] destroy full
```

| Action | Script | Prompt |
|---|---|---|
| Start local dev server (port 3006) | `./scripts/deploy.sh` | `[1]` |
| Deploy lite to GCP (scale-to-zero) | `./scripts/deploy.sh` | `[2]` |
| Deploy full to GCP (always warm) | `./scripts/deploy.sh` | `[3]` |
| Stop local dev server | `./scripts/infra-down.sh` | `[1]` |
| Teardown GCP lite stack | `./scripts/infra-down.sh` | `[2]` |
| Teardown GCP full stack | `./scripts/infra-down.sh` | `[3]` |

Deploy backend first (`springboot-dashboard-backend`) before deploying this service — `deploy.sh` reads the backend's Pulumi output for `BACKEND_URL`.

Override the backend target for local dev:

```bash
BACKEND_URL=http://other-host:8080 ./scripts/deploy.sh
```

### Cost

| Resource | Cost |
|---|---|
| **Cloud Run (lite)** | Scale-to-zero — ~$0 when idle |
| **Cloud Run (full)** | Min 1 instance — ~$5–10/mo |
| **Cloud SQL** | Billed continuously — run `infra-down.sh` in the backend repo when not demoing |
| **Artifact Registry** | Negligible at demo image count |

---

## Scale & Performance

> **4 M+ orders** served with sub-second search and chart responses. Full-text search hits a single GIN trigram index on `search_text`; chart aggregates hit pre-aggregated summary tables — neither touches the raw `orders` table on the hot path.

```
Browser ──HTTPS──► Nginx / Cloud Run ──proxy /api/* (SNI)──► Spring Boot / Cloud Run ──VPC──► Cloud SQL PG 16
                   dash-frontend (this repo)                 dash-backend                      4 M+ rows
                   0–3 instances                             1–5 instances                     GIN trigram index
```

---

## Features

- **Orders table** — paginated (keyset cursor), sortable (ID / customer / total / date), filter sidebar (status, region, date range, total range)
- **Full-text search** — multi-token AND search across all visible columns via backend `search_text` GIN trigram index; sub-second on 4 M+ rows
- **Aggregates chart** — stacked bar chart of daily orders by product category; sub-second from pre-aggregated tables, never queries raw orders
- **Date brush** — Recharts brush on the aggregates chart; drag to zoom into any date window
- **Dark mode** — system-preference detection via `useIsDark` hook; light / dark / system toggle
- **BFF proxy** — Nginx forwards `/api/*` to Spring Boot with `proxy_ssl_server_name on`; browser sees a single origin, no CORS
