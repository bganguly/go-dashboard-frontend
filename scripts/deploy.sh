#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$(cd "$ROOT_DIR/../go-dashboard-backend" 2>/dev/null && pwd || true)"
cd "$ROOT_DIR"

_STEP="startup"
_on_exit() { local c=$?; [[ $c -ne 0 ]] && printf '\n[deploy.sh] ABORTED (exit %d) at step: %s\n' "$c" "$_STEP" >&2; }
trap _on_exit EXIT

_TARGET=""
DEPLOY_MODE=""
GCP_PROJECT=""
GCP_REGION="us-central1"
IMAGE=""
BACKEND_URL=""
ACTIVE_ACCOUNT=""
SERVICE_NAME=""
_local_running=0

lsof -ti:5173 >/dev/null 2>&1 && _local_running=1 || true

_shasum() { shasum -a 256 "$@" 2>/dev/null || sha256sum "$@" 2>/dev/null; }

printf '\n=== go-dashboard-frontend ===\n\n'
printf '  [1] Local  — Vite dev server on localhost (no GCP cost)'
(( _local_running )) && printf ' [running]' || printf ' [not detected]'
printf '\n'
printf '  [2] Lite   — GCP: Cloud Run · 4M rows · scales to zero · minimal cost\n'
printf '  [3] Full   — GCP: Cloud Run · 4M rows · always warm · considerable cost\n'
printf '\nChoice [1/2/3, default 2]: '
read -r _MODE
case "${_MODE:-2}" in
  3) _TARGET="remote"; DEPLOY_MODE="full"  ;;
  2) _TARGET="remote"; DEPLOY_MODE="lite"  ;;
  *) _TARGET="local";  DEPLOY_MODE=""      ;;
esac

if [[ "$_TARGET" == "remote" ]]; then
  SERVICE_NAME="go-dash-${DEPLOY_MODE}-frontend"
  BACKEND_ENV_FILE="${BACKEND_DIR}/.env.gcp.${DEPLOY_MODE}"
  FRONTEND_ENV_FILE="$ROOT_DIR/.env.gcp.${DEPLOY_MODE}"
  [[ -f "$BACKEND_ENV_FILE" ]] && source "$BACKEND_ENV_FILE"
fi

if [[ "$_TARGET" == "local" ]]; then
  _STEP="local"
  command -v node >/dev/null 2>&1 || { printf 'Node.js not found — install Node 20+\n' >&2; exit 1; }
  printf '\nInstalling deps...\n'
  npm install --prefer-offline 2>/dev/null || npm install
  lsof -ti:5173 >/dev/null 2>&1 && {
    printf 'Freeing port 5173...\n'
    kill $(lsof -ti:5173) 2>/dev/null || true; sleep 1
  }
  BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
  printf 'Starting Vite dev server on :5173 (BACKEND_URL=%s)...\n\n' "$BACKEND_URL"
  BACKEND_URL="$BACKEND_URL" npm run dev
  exit 0
fi

_STEP="gcloud auth"
if ! command -v gcloud >/dev/null 2>&1; then
  printf '\ngcloud CLI not found.\n'
  command -v brew >/dev/null 2>&1 && {
    brew install --cask google-cloud-sdk
    source "$(brew --prefix)/share/google-cloud-sdk/path.bash.inc" 2>/dev/null || true
  } || { printf 'Install: https://cloud.google.com/sdk/docs/install\n'; exit 1; }
fi

ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 || true)
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  printf '\nNot authenticated — logging in...\n'
  gcloud auth login
  ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 || true)
  [[ -n "$ACTIVE_ACCOUNT" ]] || { printf 'Login failed.\n' >&2; exit 1; }
fi

_CONFIG_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
GCP_PROJECT="${_CONFIG_PROJECT:-${GCP_PROJECT:-}}"
[[ -n "$GCP_PROJECT" ]] || {
  printf '\nNo GCP project detected. Run: gcloud config set project <id>\n' >&2
  exit 1
}
_CONFIG_REGION=$(gcloud config get-value compute/region 2>/dev/null || true)
GCP_REGION="${_CONFIG_REGION:-${GCP_REGION:-us-central1}}"
printf 'Auth: %s  Project: %s  Region: %s\n' "$ACTIVE_ACCOUNT" "$GCP_PROJECT" "$GCP_REGION"

if [[ -z "${BACKEND_URL:-}" ]]; then
  printf '\nCould not resolve backend URL from %s\n' "$BACKEND_ENV_FILE"
  printf 'Run go-dashboard-backend/scripts/deploy.sh first, or enter URL manually.\n'
  printf 'Backend URL: '
  read -r BACKEND_URL
  [[ -n "$BACKEND_URL" ]] || { printf 'Backend URL is required.\n'; exit 1; }
fi
printf '  Backend URL: %s\n' "$BACKEND_URL"

_STEP="image build"
ar_state=$(gcloud services list --project="$GCP_PROJECT" \
  --filter="name:artifactregistry.googleapis.com" --format="value(state)" 2>/dev/null || true)
[[ "$ar_state" != "ENABLED" ]] && gcloud services enable artifactregistry.googleapis.com --project="$GCP_PROJECT"

REGISTRY="go-dash-${DEPLOY_MODE}-fe-repo"
if ! gcloud artifacts repositories describe "$REGISTRY" \
    --project="$GCP_PROJECT" --location="$GCP_REGION" >/dev/null 2>&1; then
  printf '  Creating Artifact Registry repo "%s"...\n' "$REGISTRY"
  gcloud artifacts repositories create "$REGISTRY" \
    --repository-format=docker --location="$GCP_REGION" --project="$GCP_PROJECT"
fi

TAG=$(find "$ROOT_DIR/src" "$ROOT_DIR/index.html" "$ROOT_DIR/package.json" \
    "$ROOT_DIR/vite.config.ts" "$ROOT_DIR/Dockerfile" \
    -type f 2>/dev/null | sort | xargs cat 2>/dev/null \
  | _shasum | cut -c1-16 || true)
TAG="${TAG:-$(date +%Y%m%d%H%M%S)}"
IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REGISTRY}/frontend:${TAG}"

_IMG_EXISTS=$(gcloud artifacts docker tags list \
  "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REGISTRY}/frontend" \
  --filter="tag=${TAG}" --format="value(tag)" \
  --project "$GCP_PROJECT" 2>/dev/null | head -1 || true)

if [[ -n "$_IMG_EXISTS" ]]; then
  printf '  Image %s exists — skipping build.\n' "$TAG"
else
  printf 'Building via Cloud Build: %s\n' "$IMAGE"
  gcloud services enable cloudbuild.googleapis.com --project "$GCP_PROJECT"

  _CB_ROLE=$(gcloud projects get-iam-policy "$GCP_PROJECT" \
    --flatten="bindings[].members" \
    --filter="bindings.members:user:${ACTIVE_ACCOUNT} AND (bindings.role:roles/cloudbuild OR bindings.role:roles/owner OR bindings.role:roles/editor)" \
    --format="value(bindings.role)" 2>/dev/null | head -1 || true)
  if [[ -z "$_CB_ROLE" ]]; then
    gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
      --member="user:${ACTIVE_ACCOUNT}" --role="roles/cloudbuild.builds.editor" --quiet
  fi

  _cache_tag="${IMAGE%:*}:cache"
  _tmpyaml=$(mktemp /private/tmp/cloudbuild.XXXXXX)
  cat > "$_tmpyaml" <<YAML
steps:
- name: 'gcr.io/cloud-builders/docker'
  entrypoint: bash
  args:
  - -c
  - |
    docker pull '${_cache_tag}' 2>/dev/null || true
    docker build --cache-from '${_cache_tag}' -t '${IMAGE}' -t '${_cache_tag}' .
- name: 'gcr.io/cloud-builders/docker'
  args: [push, '${IMAGE}']
- name: 'gcr.io/cloud-builders/docker'
  args: [push, '${_cache_tag}']
images:
- '${IMAGE}'
- '${_cache_tag}'
YAML

  _attempt=0 _rc=0
  while (( _attempt < 3 )); do
    _attempt=$(( _attempt + 1 ))
    set +e; gcloud builds submit --config "$_tmpyaml" --project "$GCP_PROJECT" "$ROOT_DIR"; _rc=$?; set -e
    [[ "$_rc" == "0" ]] && { rm -f "$_tmpyaml"; break; }
    [[ "$_rc" == "130" ]] && { printf '\nBuild cancelled.\n'; rm -f "$_tmpyaml"; exit 130; }
    (( _attempt < 3 )) && { printf '  Cloud Build failed (attempt %d/3) — waiting 20s...\n' "$_attempt"; sleep 20; }
  done
  rm -f "$_tmpyaml"
  [[ "$_rc" != "0" ]] && { printf 'Cloud Build failed after 3 attempts.\n' >&2; exit 1; }
fi

_STEP="cloud run deploy"
gcloud services enable run.googleapis.com --project "$GCP_PROJECT"

if [[ "$DEPLOY_MODE" == "lite" ]]; then
  _MIN_INST=0; _MAX_INST=1; _MEM="256Mi"; _CPU=1
else
  _MIN_INST=1; _MAX_INST=3; _MEM="512Mi"; _CPU=1
fi

printf '\n=== deploying Cloud Run service: %s ===\n' "$SERVICE_NAME"
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$GCP_REGION" \
  --project "$GCP_PROJECT" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances "$_MIN_INST" \
  --max-instances "$_MAX_INST" \
  --memory "$_MEM" \
  --cpu "$_CPU" \
  --port 8080 \
  --set-env-vars "BACKEND_URL=${BACKEND_URL}"

FRONTEND_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$GCP_REGION" --project "$GCP_PROJECT" \
  --format="value(status.url)" 2>/dev/null || true)

printf '\nWriting %s...\n' "$FRONTEND_ENV_FILE"
printf 'GCP_PROJECT=%s\nGCP_REGION=%s\nFRONTEND_URL=%s\nBACKEND_URL=%s\n' \
  "$GCP_PROJECT" "$GCP_REGION" "${FRONTEND_URL:-}" "$BACKEND_URL" > "$FRONTEND_ENV_FILE"

printf '\nDone. Frontend URL:\n  %s\n' "${FRONTEND_URL:-<check Cloud Run console>}"
