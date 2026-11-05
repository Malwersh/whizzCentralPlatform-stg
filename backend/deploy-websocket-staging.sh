#!/usr/bin/env bash
set -euo pipefail

export AWS_PAGER=""
export AWS_SDK_LOAD_CONFIG=1

REGION="us-east-1"
PROFILE="Wizz_stg_UserApp"
STAGE="staging"

# Use the same Node/Serverless generation as the reviewed package. Fail before
# exporting credentials or installing dependencies when local tooling is stale.
SERVERLESS_BIN="${SUPPORT_SERVERLESS_BIN:-serverless}"
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 or newer is required"); process.exit(1); }'
if ! command -v "$SERVERLESS_BIN" >/dev/null 2>&1; then
  echo "Serverless CLI not found: $SERVERLESS_BIN" >&2
  exit 1
fi
serverless_version=$("$SERVERLESS_BIN" --version)
if ! [[ "$serverless_version" =~ (^|[^0-9])4\.[0-9]+\.[0-9]+ ]]; then
  echo "Serverless Framework 4 is required; set SUPPORT_SERVERLESS_BIN to a compatible executable." >&2
  exit 1
fi

# App identities must be supplied from verified deployment configuration.
# Never substitute the customer pool for merchant or driver authentication.
for config_name in MERCHANTS_USER_POOL_ID MERCHANTS_CLIENT_ID DRIVERS_USER_POOL_ID DRIVERS_CLIENT_ID CUSTOMERS_USER_POOL_ID CUSTOMERS_CLIENT_ID SUPPORT_ALLOWED_ORIGIN; do
  if [[ -z "${!config_name:-}" || "${!config_name}" == "None" ]]; then
    echo "Missing required deployment configuration: $config_name" >&2
    exit 1
  fi
  export "$config_name"
done

export AWS_PROFILE="$PROFILE"
export AWS_REGION="$REGION"

# Serverless (via aws-sdk v2) may not understand SSO profiles.
# Export temp credentials to env so deployment works reliably.
echo "🔐 Exporting temporary AWS credentials from SSO profile…"
temporary_credentials=$(aws configure export-credentials --profile "$PROFILE" --format env)
eval "$temporary_credentials"
unset temporary_credentials
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

export CENTRAL_PLATFORM_USER_POOL_ID
export CENTRAL_PLATFORM_CLIENT_ID
export COGNITO_REGION="$REGION"

# Tables used by websocket handler for some routes
export ORDERS_TABLE="WizzOrders"
export DRIVERS_TABLE="WhizzDrivers_staging"

cd "$ROOT_DIR"

echo "📦 Installing locked backend dependencies…"
npm ci --omit=dev

echo "🚀 Deploying CentralPlatform WebSocket (stage=$STAGE)…"
"$SERVERLESS_BIN" deploy \
  --config serverless.websocket.yml \
  --stage "$STAGE" \
  --region "$REGION"

echo "✅ Done. Next: update frontend LIVE_CHAT_WEBSOCKET_URL to the new WebSocket URL output."
