#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$(cd "$ROOT_DIR/../go-dashboard-backend" 2>/dev/null && pwd || true)"
cd "$ROOT_DIR"

_STEP="startup"
_on_exit() { local c=$?; [[ $c -ne 0 ]] && printf '\n[deploy.sh] ABORTED (exit %d) at step: %s\n' "$c" "$_STEP" >&2; }
trap _on_exit EXIT

AWS_REGION="us-east-1"
SERVICE_NAME="go-dash-frontend"
ECR_REPO="go-dash-frontend"
CODEBUILD_PROJECT="go-dash-frontend-build"
ENV_FILE="$ROOT_DIR/.env.aws"
BACKEND_URL=""
_local_running=0

lsof -ti:5173 >/dev/null 2>&1 && _local_running=1 || true

_shasum() { shasum -a 256 "$@" 2>/dev/null || sha256sum "$@" 2>/dev/null; }

printf '\n=== go-dashboard-frontend ===\n\n'
printf '  [1] Local  — Vite dev server on localhost'
(( _local_running )) && printf ' [running]' || printf ' [not detected]'
printf '\n'
printf '  [2] AWS    — App Runner · scales to zero · ~$0/mo at idle\n'
printf '\nChoice [1/2, default 2]: '
read -r _MODE
case "${_MODE:-2}" in
  1) _TARGET="local" ;;
  *) _TARGET="remote" ;;
esac

if [[ "$_TARGET" == "local" ]]; then
  _STEP="local"
  command -v node >/dev/null 2>&1 || { printf 'Node.js not found — install Node 20+\n' >&2; exit 1; }
  npm install --prefer-offline 2>/dev/null || npm install
  lsof -ti:5173 >/dev/null 2>&1 && {
    printf 'Freeing port 5173...\n'
    kill $(lsof -ti:5173) 2>/dev/null || true
    sleep 1
  }
  _be_env="${BACKEND_DIR}/.env.aws"
  [[ -n "$BACKEND_DIR" && -f "$_be_env" ]] && \
    BACKEND_URL=$(grep -E '^BACKEND_URL=' "$_be_env" | cut -d= -f2- | tr -d '"' || true)
  BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
  printf 'Starting Vite dev server on :5173 (BACKEND_URL=%s)...\n\n' "$BACKEND_URL"
  BACKEND_URL="$BACKEND_URL" npm run dev
  exit 0
fi

_STEP="aws auth"
command -v aws >/dev/null 2>&1 || { printf 'aws CLI not found — install: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html\n' >&2; exit 1; }
aws sts get-caller-identity >/dev/null 2>&1 || { printf 'AWS credentials not configured — run: aws configure\n' >&2; exit 1; }
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
printf 'Auth: account %s  region %s\n' "$ACCOUNT_ID" "$AWS_REGION"

_STEP="backend url"
_be_env="${BACKEND_DIR}/.env.aws"
[[ -n "$BACKEND_DIR" && -f "$_be_env" ]] && \
  BACKEND_URL=$(grep -E '^BACKEND_URL=' "$_be_env" | cut -d= -f2- | tr -d '"' || true)
if [[ -n "$BACKEND_URL" ]]; then
  printf '\n  Backend URL: %s  [from backend .env.aws]\n' "$BACKEND_URL"
else
  printf '\nCould not find backend URL — run go-dashboard-backend/scripts/deploy.sh first, or enter manually:\n  > '
  read -r BACKEND_URL
  [[ -n "$BACKEND_URL" ]] || { printf 'Backend URL is required.\n' >&2; exit 1; }
fi

_STEP="ecr repo"
aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$AWS_REGION" >/dev/null 2>&1 || {
  printf '  Creating ECR repo %s...\n' "$ECR_REPO"
  aws ecr create-repository --repository-name "$ECR_REPO" --region "$AWS_REGION" >/dev/null
}

TAG=$(find "$ROOT_DIR/src" "$ROOT_DIR/index.html" "$ROOT_DIR/package.json" \
    "$ROOT_DIR/vite.config.ts" "$ROOT_DIR/Dockerfile" "$ROOT_DIR/nginx.conf.template" \
    -type f 2>/dev/null | sort | xargs cat 2>/dev/null \
  | _shasum | cut -c1-16 || true)
TAG="${TAG:-$(date +%Y%m%d%H%M%S)}"
IMAGE="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${TAG}"
IMAGE_CACHE="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:cache"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

_img_exists() {
  aws ecr describe-images --repository-name "$ECR_REPO" --image-ids "imageTag=$1" \
    --region "$AWS_REGION" >/dev/null 2>&1
}

if _img_exists "$TAG"; then
  printf '  Image %s exists — skipping build.\n' "$TAG"
else
  _STEP="codebuild iam role"
  CB_ROLE="go-dash-codebuild-role"
  CB_ROLE_ARN=$(aws iam get-role --role-name "$CB_ROLE" --query 'Role.Arn' --output text 2>/dev/null || true)
  if [[ -z "$CB_ROLE_ARN" || "$CB_ROLE_ARN" == "None" ]]; then
    printf '  Creating CodeBuild IAM role...\n'
    CB_ROLE_ARN=$(aws iam create-role --role-name "$CB_ROLE" \
      --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
      --query 'Role.Arn' --output text)
    aws iam attach-role-policy --role-name "$CB_ROLE" \
      --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser
    aws iam attach-role-policy --role-name "$CB_ROLE" \
      --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
    printf '  Waiting for IAM propagation...\n'
    sleep 10
  fi
  aws iam put-role-policy --role-name "$CB_ROLE" \
    --policy-name CodeBuildLogs \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"logs:CreateLogGroup\",\"logs:CreateLogStream\",\"logs:PutLogEvents\"],\"Resource\":\"arn:aws:logs:${AWS_REGION}:${ACCOUNT_ID}:log-group:/aws/codebuild/*\"}]}"
  aws iam put-role-policy --role-name "$CB_ROLE" \
    --policy-name CodeBuildECRPublic \
    --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ecr-public:GetAuthorizationToken","sts:GetServiceBearerToken"],"Resource":"*"}]}'

  _STEP="s3 source bucket"
  SRC_BUCKET="go-dash-codebuild-src-${ACCOUNT_ID}"
  aws s3api head-bucket --bucket "$SRC_BUCKET" 2>/dev/null || {
    printf '  Creating S3 source bucket %s...\n' "$SRC_BUCKET"
    if [[ "$AWS_REGION" == "us-east-1" ]]; then
      aws s3api create-bucket --bucket "$SRC_BUCKET" --region "$AWS_REGION" >/dev/null
    else
      aws s3api create-bucket --bucket "$SRC_BUCKET" --region "$AWS_REGION" \
        --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null
    fi
  }

  _STEP="codebuild project"
  _CB_EXISTS=$(aws codebuild batch-get-projects --names "$CODEBUILD_PROJECT" \
    --query 'projects[0].name' --output text 2>/dev/null || true)
  _cb_source="{\"type\":\"S3\",\"location\":\"${SRC_BUCKET}/go-dash-frontend-source.zip\"}"
  _cb_env="{\"type\":\"LINUX_CONTAINER\",\"image\":\"aws/codebuild/standard:7.0\",\"computeType\":\"BUILD_GENERAL1_SMALL\",\"privilegedMode\":true,\"environmentVariables\":[]}"
  if [[ "$_CB_EXISTS" == "None" || -z "$_CB_EXISTS" ]]; then
    printf '  Creating CodeBuild project %s...\n' "$CODEBUILD_PROJECT"
    aws codebuild create-project \
      --name "$CODEBUILD_PROJECT" \
      --source "$_cb_source" \
      --artifacts '{"type":"NO_ARTIFACTS"}' \
      --environment "$_cb_env" \
      --service-role "$CB_ROLE_ARN" \
      --region "$AWS_REGION" >/dev/null
  else
    aws codebuild update-project --name "$CODEBUILD_PROJECT" --source "$_cb_source" --region "$AWS_REGION" >/dev/null
  fi

  _STEP="image build"
  _tmpzip="${TMPDIR:-/tmp}/go-dash-fe-src-$$.zip"
  printf 'Packaging source...\n'
  (cd "$ROOT_DIR" && zip -qr "$_tmpzip" . -x '.git/*' -x '.env*' -x 'node_modules/*' -x '*.zip')
  printf 'Uploading source to S3...\n'
  aws s3 cp "$_tmpzip" "s3://${SRC_BUCKET}/go-dash-frontend-source.zip" >/dev/null
  rm -f "$_tmpzip"

  _tmpbspec="${TMPDIR:-/tmp}/go-dash-fe-buildspec-$$.yml"
  cat > "$_tmpbspec" <<'BSPEC'
version: 0.2
phases:
  pre_build:
    commands:
      - aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_URI
      - docker pull $IMAGE_CACHE || true
  build:
    commands:
      - docker build --cache-from $IMAGE_CACHE -t $IMAGE -t $IMAGE_CACHE .
  post_build:
    commands:
      - docker push $IMAGE
      - docker push $IMAGE_CACHE
BSPEC

  printf 'Starting CodeBuild build...\n'
  BUILD_ID=$(aws codebuild start-build \
    --project-name "$CODEBUILD_PROJECT" \
    --buildspec-override "file://${_tmpbspec}" \
    --environment-variables-override \
      "[{\"name\":\"ECR_URI\",\"value\":\"${ECR_URI}\"},{\"name\":\"IMAGE\",\"value\":\"${IMAGE}\"},{\"name\":\"IMAGE_CACHE\",\"value\":\"${IMAGE_CACHE}\"}]" \
    --region "$AWS_REGION" \
    --query 'build.id' --output text)
  rm -f "$_tmpbspec"
  printf '  Build ID: %s\n' "$BUILD_ID"

  _cb_elapsed=0
  while true; do
    _STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" \
      --query 'builds[0].buildStatus' --output text --region "$AWS_REGION")
    case "$_STATUS" in
      SUCCEEDED) printf '  Build complete.\n'; break ;;
      FAILED|FAULT|STOPPED|TIMED_OUT) printf 'Build %s.\n' "$_STATUS" >&2; exit 1 ;;
    esac
    (( _cb_elapsed += 15 ))
    (( _cb_elapsed > 900 )) && { printf 'Build timed out after 15 min.\n' >&2; exit 1; }
    printf '  ...%ds (%s)\n' "$_cb_elapsed" "$_STATUS"
    sleep 15
  done
fi

_STEP="app runner ecr role"
AR_ECR_ROLE="go-dash-apprunner-ecr-role"
AR_ECR_ROLE_ARN=$(aws iam get-role --role-name "$AR_ECR_ROLE" --query 'Role.Arn' --output text 2>/dev/null || true)
if [[ -z "$AR_ECR_ROLE_ARN" || "$AR_ECR_ROLE_ARN" == "None" ]]; then
  printf '  Creating App Runner ECR access role...\n'
  AR_ECR_ROLE_ARN=$(aws iam create-role --role-name "$AR_ECR_ROLE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --query 'Role.Arn' --output text)
  aws iam attach-role-policy --role-name "$AR_ECR_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
  sleep 10
fi

_STEP="auto scaling config"
_ASC_ARN=$(aws apprunner list-auto-scaling-configurations \
  --auto-scaling-configuration-name "go-dash-scale-to-zero" \
  --region "$AWS_REGION" \
  --query 'AutoScalingConfigurationSummaryList[?Status==`active`].AutoScalingConfigurationArn' \
  --output text 2>/dev/null | awk 'NF{print $1;exit}' || true)
if [[ -z "$_ASC_ARN" ]]; then
  printf '  Creating auto-scaling config (min=1, max=2)...\n'
  _ASC_ARN=$(aws apprunner create-auto-scaling-configuration \
    --auto-scaling-configuration-name "go-dash-scale-to-zero" \
    --min-size 1 --max-size 2 --max-concurrency 100 \
    --region "$AWS_REGION" \
    --query 'AutoScalingConfiguration.AutoScalingConfigurationArn' --output text)
fi

_STEP="app runner deploy"
_SVC_ARN=$(aws apprunner list-services --region "$AWS_REGION" \
  --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn" \
  --output text 2>/dev/null | awk 'NF{print $1;exit}' || true)

_env_vars="{\"BACKEND_URL\":\"${BACKEND_URL}\"}"
_source_config="{\"ImageRepository\":{\"ImageIdentifier\":\"${IMAGE}\",\"ImageConfiguration\":{\"Port\":\"8080\",\"RuntimeEnvironmentVariables\":${_env_vars}},\"ImageRepositoryType\":\"ECR\"},\"AuthenticationConfiguration\":{\"AccessRoleArn\":\"${AR_ECR_ROLE_ARN}\"},\"AutoDeploymentsEnabled\":false}"
_instance_config="{\"Cpu\":\"512\",\"Memory\":\"1024\"}"

if [[ -z "$_SVC_ARN" ]]; then
  printf '\n=== creating App Runner service: %s ===\n' "$SERVICE_NAME"
  _SVC_ARN=$(aws apprunner create-service \
    --service-name "$SERVICE_NAME" \
    --source-configuration "$_source_config" \
    --instance-configuration "$_instance_config" \
    --auto-scaling-configuration-arn "$_ASC_ARN" \
    --region "$AWS_REGION" \
    --query 'Service.ServiceArn' --output text)
else
  printf '\n=== updating App Runner service: %s ===\n' "$SERVICE_NAME"
  aws apprunner update-service \
    --service-arn "$_SVC_ARN" \
    --source-configuration "$_source_config" \
    --instance-configuration "$_instance_config" \
    --auto-scaling-configuration-arn "$_ASC_ARN" \
    --region "$AWS_REGION" >/dev/null
fi

printf '  Waiting for service to reach RUNNING state...\n'
_ar_elapsed=0
while true; do
  _SVC_STATUS=$(aws apprunner describe-service --service-arn "$_SVC_ARN" \
    --region "$AWS_REGION" --query 'Service.Status' --output text)
  case "$_SVC_STATUS" in
    RUNNING) printf '  Service is RUNNING.\n'; break ;;
    CREATE_FAILED|UPDATE_FAILED|DELETE_FAILED) printf 'Service %s — check App Runner console.\n' "$_SVC_STATUS" >&2; exit 1 ;;
  esac
  (( _ar_elapsed += 15 ))
  (( _ar_elapsed > 600 )) && { printf 'Timed out waiting for App Runner (10 min).\n' >&2; exit 1; }
  printf '  ...%ds (%s)\n' "$_ar_elapsed" "$_SVC_STATUS"
  sleep 15
done

FRONTEND_URL="https://$(aws apprunner describe-service --service-arn "$_SVC_ARN" \
  --region "$AWS_REGION" --query 'Service.ServiceUrl' --output text)"

printf '\nWriting %s...\n' "$ENV_FILE"
printf 'AWS_REGION=%s\nFRONTEND_URL=%s\nBACKEND_URL=%s\n' \
  "$AWS_REGION" "$FRONTEND_URL" "$BACKEND_URL" > "$ENV_FILE"

printf '\nDone. Frontend URL:\n  %s\n' "$FRONTEND_URL"
