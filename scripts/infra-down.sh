#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

_MODE=""
_GCP_PROJECT=""
_GCP_REGION=""

# ── Helpers ───────────────────────────────────────────────────────────────────

_delete_service() {
  local svc="$1"
  printf '\nDeleting Cloud Run service: %s\n' "$svc"
  gcloud run services delete "$svc" \
    --region "$_GCP_REGION" --project "$_GCP_PROJECT" --quiet 2>/dev/null \
    && printf '  Deleted.\n' || printf '  Not found or already deleted.\n'
}

# ── Preflight ─────────────────────────────────────────────────────────────────

_run_preflight() {
  printf '\n=== go-dashboard-frontend teardown ===\n\n'
  printf '  [1] Lite  — delete Cloud Run service go-dash-lite-frontend\n'
  printf '  [2] Full  — delete Cloud Run service go-dash-full-frontend\n'
  printf '  [3] Both\n'
  printf '\nChoice [1/2/3]: '
  read -r _MODE

  _GCP_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
  [[ -n "$_GCP_PROJECT" ]] || { printf 'No GCP project set.\n' >&2; exit 1; }
  _GCP_REGION=$(gcloud config get-value compute/region 2>/dev/null || true)
  _GCP_REGION="${_GCP_REGION:-us-central1}"
}

# ── Teardown ──────────────────────────────────────────────────────────────────

_teardown() {
  case "${_MODE:-}" in
    1) _delete_service "go-dash-lite-frontend" ;;
    2) _delete_service "go-dash-full-frontend" ;;
    3) _delete_service "go-dash-lite-frontend"; _delete_service "go-dash-full-frontend" ;;
    *) printf 'Invalid choice.\n'; exit 1 ;;
  esac
  printf '\nTeardown complete.\n'
}

# ── Main ──────────────────────────────────────────────────────────────────────

_run_preflight
_teardown
