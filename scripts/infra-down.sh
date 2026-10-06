#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.aws"
AWS_REGION="us-east-1"
SERVICE_NAME="go-dash-frontend"
ECR_REPO="go-dash-frontend"

_CHOICE=""

# ── Preflight ─────────────────────────────────────────────────────────────────

_run_preflight() {
  printf '\n=== go-dashboard-frontend teardown ===\n\n'
  printf '  [1] Delete App Runner service only (keep ECR)\n'
  printf '  [2] Delete App Runner + ECR repo (full teardown)\n'
  printf '\nChoice [1/2, default 1]: '
  read -r _CHOICE

  command -v aws >/dev/null 2>&1 || { printf 'aws CLI not found.\n' >&2; exit 1; }
  aws sts get-caller-identity >/dev/null 2>&1 || { printf 'AWS credentials not configured.\n' >&2; exit 1; }
}

# ── Teardown ──────────────────────────────────────────────────────────────────

_teardown() {
  local _SVC_ARN=""
  [[ -f "$ENV_FILE" ]] && _SVC_ARN=$(grep -E '^SERVICE_ARN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)
  if [[ -z "$_SVC_ARN" ]]; then
    _SVC_ARN=$(aws apprunner list-services --region "$AWS_REGION" \
      --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn" \
      --output text 2>/dev/null | awk 'NF{print $1;exit}' || true)
  fi

  if [[ -n "$_SVC_ARN" ]]; then
    printf 'Deleting App Runner service %s...\n' "$SERVICE_NAME"
    aws apprunner delete-service --service-arn "$_SVC_ARN" --region "$AWS_REGION" >/dev/null
    printf '  Delete initiated.\n'
  else
    printf '  App Runner service not found — skipping.\n'
  fi

  case "${_CHOICE:-1}" in
    2)
      printf 'Deleting ECR repo %s...\n' "$ECR_REPO"
      aws ecr delete-repository --repository-name "$ECR_REPO" --region "$AWS_REGION" --force >/dev/null 2>&1 \
        || printf '  ECR repo not found — skipping.\n'
      printf '  ECR repo deleted.\n'
      ;;
  esac

  [[ -f "$ENV_FILE" ]] && rm -f "$ENV_FILE" && printf 'Removed %s\n' "$ENV_FILE"
  printf '\nTeardown complete.\n'
}

# ── Main ──────────────────────────────────────────────────────────────────────

_run_preflight
_teardown
