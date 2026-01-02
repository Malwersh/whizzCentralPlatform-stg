#!/usr/bin/env bash
set -euo pipefail

export AWS_PAGER=""
export AWS_SDK_LOAD_CONFIG=1

REGION="us-east-1"
PROFILE="Wizz_stg_UserApp"
STAGE="staging"

export AWS_PROFILE="$PROFILE"
export AWS_REGION="$REGION"

# Serverless (via aws-sdk v2) may not understand SSO profiles.
# Export temp credentials to env so deployment works reliably.
echo "🔐 Exporting temporary AWS credentials from SSO profile…"
eval "$(aws configure export-credentials --profile "$PROFILE" --format env)"
unset AWS_PROFILE

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Pull CentralPlatform Cognito IDs from the frontend hosting stack (created earlier)
FRONTEND_STACK="whizz-centralplatform-frontend-staging"

stack_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$FRONTEND_STACK" \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
    --output text
}

CENTRAL_PLATFORM_USER_POOL_ID="$(stack_output CentralUserPoolId || true)"
CENTRAL_PLATFORM_CLIENT_ID="$(stack_output CentralUserPoolClientId || true)"

if [[ -z "${CENTRAL_PLATFORM_USER_POOL_ID:-}" || "${CENTRAL_PLATFORM_USER_POOL_ID:-}" == "None" ]]; then
  echo "❌ Missing CentralUserPoolId from stack $FRONTEND_STACK"
  exit 1
fi
if [[ -z "${CENTRAL_PLATFORM_CLIENT_ID:-}" || "${CENTRAL_PLATFORM_CLIENT_ID:-}" == "None" ]]; then
  echo "❌ Missing CentralUserPoolClientId from stack $FRONTEND_STACK"
  exit 1
fi

# Optional: reuse WizzUser Cognito for merchants/drivers if present as exports
# These exports were previously used by other services.
WIZZUSER_POOL_ID=$(aws cloudformation list-exports --region "$REGION" --profile "$PROFILE" --query "Exports[?Name=='WizzUser-backend-${STAGE}-UserPoolId'].Value" --output text 2>/dev/null || true)
WIZZUSER_CLIENT_ID=$(aws cloudformation list-exports --region "$REGION" --profile "$PROFILE" --query "Exports[?Name=='WizzUser-backend-${STAGE}-UserPoolClientId'].Value" --output text 2>/dev/null || true)

export CENTRAL_PLATFORM_USER_POOL_ID
export CENTRAL_PLATFORM_CLIENT_ID
export COGNITO_REGION="$REGION"

# If you prefer, set these explicitly later
export MERCHANTS_USER_POOL_ID="${WIZZUSER_POOL_ID:-}"
export MERCHANTS_CLIENT_ID="${WIZZUSER_CLIENT_ID:-}"
export DRIVERS_USER_POOL_ID=""
export DRIVERS_CLIENT_ID=""

# Tables used by websocket handler for some routes
export ORDERS_TABLE="WizzOrders"
export DRIVERS_TABLE="WhizzDrivers_staging"

cd "$ROOT_DIR"

if [[ ! -f package-lock.json ]]; then
  echo "📦 Installing backend dependencies (first run)…"
  npm install --omit=dev
fi

echo "🚀 Deploying CentralPlatform WebSocket (stage=$STAGE)…"
serverless deploy \
  --config serverless.websocket.yml \
  --stage "$STAGE" \
  --region "$REGION"

echo "✅ Done. Next: update frontend LIVE_CHAT_WEBSOCKET_URL to the new WebSocket URL output."