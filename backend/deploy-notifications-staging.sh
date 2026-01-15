#!/usr/bin/env bash
set -euo pipefail

export AWS_PAGER=""
export AWS_SDK_LOAD_CONFIG=1

REGION="us-east-1"
PROFILE="Wizz_stg_UserApp"
STAGE="staging"

export AWS_PROFILE="$PROFILE"
export AWS_REGION="$REGION"

echo "🔐 Exporting temporary AWS credentials from SSO profile…"
eval "$(aws configure export-credentials --profile "$PROFILE" --format env)"
unset AWS_PROFILE

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

FRONTEND_STACK="whizz-centralplatform-frontend-staging"
WIZZUSER_BACKEND_STACK="WizzUser-backend-staging"
MERCHANTS_BACKEND_STACK="Wizz-Merchants-staging"

stack_output() {
  local stack="$1"
  local key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack" \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
    --output text
}

# CentralPlatform Cognito
export CENTRAL_PLATFORM_USER_POOL_ID="$(stack_output "$FRONTEND_STACK" CentralUserPoolId || true)"
export CENTRAL_PLATFORM_CLIENT_ID="$(stack_output "$FRONTEND_STACK" CentralUserPoolClientId || true)"
export COGNITO_REGION="$REGION"

# WizzUser Cognito (from SAM stack outputs)
export USERS_USER_POOL_ID="$(stack_output "$WIZZUSER_BACKEND_STACK" UserPoolId || true)"
export USERS_CLIENT_ID="$(stack_output "$WIZZUSER_BACKEND_STACK" UserPoolClientId || true)"

# Fallback (keeps push token register working even if stack output keys differ)
if [[ -z "$USERS_USER_POOL_ID" ]]; then
  export USERS_USER_POOL_ID="us-east-1_TpyyrVkEE"
fi
if [[ -z "$USERS_CLIENT_ID" ]]; then
  export USERS_CLIENT_ID="4a9e8o3em311eq2rgckp0pd2s9"
fi

echo "🔎 WizzUser Cognito: USERS_USER_POOL_ID=$USERS_USER_POOL_ID USERS_CLIENT_ID=$USERS_CLIENT_ID"

# Drivers/Merchants pools: keep defaults in serverless yml unless you export them here.
# If you have exports for these stacks, set them below.
export MERCHANTS_USER_POOL_ID="${MERCHANTS_USER_POOL_ID:-$(stack_output "$MERCHANTS_BACKEND_STACK" MerchantsUserPoolId || true)}"
export MERCHANTS_CLIENT_ID="${MERCHANTS_CLIENT_ID:-$(stack_output "$MERCHANTS_BACKEND_STACK" MerchantsUserPoolClientId || true)}"

if [[ -z "$MERCHANTS_USER_POOL_ID" || "$MERCHANTS_USER_POOL_ID" == "None" ]]; then
  export MERCHANTS_USER_POOL_ID=""
fi
if [[ -z "$MERCHANTS_CLIENT_ID" || "$MERCHANTS_CLIENT_ID" == "None" ]]; then
  export MERCHANTS_CLIENT_ID=""
fi

echo "🔎 Merchants Cognito: MERCHANTS_USER_POOL_ID=$MERCHANTS_USER_POOL_ID MERCHANTS_CLIENT_ID=$MERCHANTS_CLIENT_ID"

# IMPORTANT:
# If these variables are exported as empty strings, Serverless will treat them as "set"
# and override the defaults in serverless.notifications.yml with empty values, breaking
# JWT verification (push token register will return 401).
#
# These defaults must match the staging Drivers app Cognito pool.
export DRIVERS_USER_POOL_ID="${DRIVERS_USER_POOL_ID:-us-east-1_RGTqUXF5C}"
export DRIVERS_CLIENT_ID="${DRIVERS_CLIENT_ID:-2d26d3muq0vvcuf42lkpgmkgsr}"

# Firebase Admin service account secret id (Secrets Manager)
# Example: wizz/staging/firebase/admin-service-account
export FIREBASE_ADMIN_SA_SECRET_ID="${FIREBASE_ADMIN_SA_SECRET_ID:-wizz/${STAGE}/firebase/admin-service-account}"

# Internal service-to-service auth key (WaveSystem -> Notifications)
# IMPORTANT: Keep this stable across deploys and set the SAME value in WaveSystem SAM params.
export NOTIFICATIONS_INTERNAL_KEY="${NOTIFICATIONS_INTERNAL_KEY:-}"

# Optional: load NOTIFICATIONS_INTERNAL_KEY from Secrets Manager to avoid manual copy/paste.
# Default secret name matches the existing naming convention used for Firebase.
export NOTIFICATIONS_INTERNAL_KEY_SECRET_ID="${NOTIFICATIONS_INTERNAL_KEY_SECRET_ID:-wizz/${STAGE}/notifications/internal-key}"

get_secret_string() {
  local secret_id="$1"
  aws secretsmanager get-secret-value \
    --secret-id "$secret_id" \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query 'SecretString' \
    --output text 2>/dev/null || true
}

if [[ -z "$NOTIFICATIONS_INTERNAL_KEY" ]]; then
  candidate="$(get_secret_string "$NOTIFICATIONS_INTERNAL_KEY_SECRET_ID")"
  if [[ -n "$candidate" && "$candidate" != "None" && "$candidate" != "null" ]]; then
    export NOTIFICATIONS_INTERNAL_KEY="$candidate"
  fi
fi

if [[ -z "$NOTIFICATIONS_INTERNAL_KEY" ]]; then
  if [[ "${ALLOW_EMPTY_NOTIFICATIONS_INTERNAL_KEY:-}" == "1" ]]; then
    echo "⚠️  NOTIFICATIONS_INTERNAL_KEY is empty (ALLOW_EMPTY_NOTIFICATIONS_INTERNAL_KEY=1). Internal push endpoints will return 500 and guest token registration will be disabled."
  else
    echo "🔐 NOTIFICATIONS_INTERNAL_KEY is required for internal push endpoints."
    echo "   Tried Secrets Manager: $NOTIFICATIONS_INTERNAL_KEY_SECRET_ID"
    echo "   Paste it now (input hidden). Press Enter to confirm."
    read -r -s -p "NOTIFICATIONS_INTERNAL_KEY: " NOTIFICATIONS_INTERNAL_KEY
    echo ""
    export NOTIFICATIONS_INTERNAL_KEY
    if [[ -z "$NOTIFICATIONS_INTERNAL_KEY" ]]; then
      echo "❌ NOTIFICATIONS_INTERNAL_KEY is still empty. Aborting."
      echo "   Tip: you can also run: export NOTIFICATIONS_INTERNAL_KEY='...'"
      exit 1
    fi
  fi
fi

if [[ ! -f package-lock.json ]]; then
  echo "📦 Installing backend dependencies (first run)…"
  npm install --omit=dev
fi

echo "🚀 Deploying CentralPlatform Notifications (stage=$STAGE)…"
serverless deploy \
  --config serverless.notifications.yml \
  --stage "$STAGE" \
  --region "$REGION"

echo "✅ Done. Outputs are in the Serverless deploy output."
