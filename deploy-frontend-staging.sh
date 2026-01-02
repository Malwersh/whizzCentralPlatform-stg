#!/bin/bash

set -euo pipefail

REGION="us-east-1"
PROFILE="Wizz_stg_UserApp"
STAGE="staging"
STACK_NAME="whizz-centralplatform-frontend-staging"

export AWS_PAGER=""

cd "$(dirname "$0")"

if ! command -v aws >/dev/null 2>&1; then
  echo "❌ Missing aws cli"
  exit 1
fi

echo "🚀 Deploying CentralPlatform frontend hosting stack..."
aws --profile "$PROFILE" --region "$REGION" cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file cloudformation/centralplatform-frontend-hosting.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides Stage="$STAGE" ProjectName="whizz-centralplatform"

get_output() {
  local key="$1"
  aws --profile "$PROFILE" --region "$REGION" cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text
}

BUCKET="$(get_output HostingBucketName)"
CF_DOMAIN="$(get_output CloudFrontDomainName)"
CF_DIST_ID="$(get_output CloudFrontDistributionId)"
USER_POOL_ID="$(get_output CentralUserPoolId)"
CLIENT_ID="$(get_output CentralUserPoolClientId)"
IDENTITY_POOL_ID="$(get_output CentralIdentityPoolId)"
API_BASE_URL="$(get_output ConfigApiBaseUrl)"

# Pull existing ecosystem endpoints as sensible defaults
WIZZUSER_API_URL="$(aws --profile "$PROFILE" --region "$REGION" cloudformation list-exports --query "Exports[?Name=='WizzUser-backend-staging-ApiUrl'].Value | [0]" --output text)"
WIZZUSER_WS_URL="$(aws --profile "$PROFILE" --region "$REGION" cloudformation list-exports --query "Exports[?Name=='WizzUser-backend-staging-WebSocketUrl'].Value | [0]" --output text)"

# Prefer CentralPlatform's own WebSocket if deployed
CENTRAL_WS_URL="$(aws --profile "$PROFILE" --region "$REGION" cloudformation describe-stacks \
  --stack-name wizzcentral-websocket-${STAGE} \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceEndpointWebsocket'].OutputValue | [0]" \
  --output text 2>/dev/null || true)"

if [[ -z "${CENTRAL_WS_URL:-}" || "${CENTRAL_WS_URL:-}" == "None" ]]; then
  CENTRAL_WS_URL=""
fi

LIVE_CHAT_WS_URL="${LIVE_CHAT_WEBSOCKET_URL:-${CENTRAL_WS_URL:-$WIZZUSER_WS_URL}}"
AI_ENDPOINT="${AI_API_ENDPOINT:-$API_BASE_URL}"

echo "🧩 Writing frontend/env.js for staging..."
cat > frontend/env.js <<EOF
// Auto-generated for staging deploy. Do not commit.
(function(){
  "use strict";
  window.__STAGE__ = "${STAGE}";
  window.__API_BASE_URL__ = "${API_BASE_URL}";
  window.__PUSH_NOTIFICATION_API_URL__ = "";
  window.__AI_API_ENDPOINT__ = "${AI_ENDPOINT}";
  window.__AMAZON_CONNECT_API_BASE_URL__ = "";
  window.__AMAZON_CONNECT_WS_URL__ = "";
  window.__LIVE_CHAT_WEBSOCKET_URL__ = "${LIVE_CHAT_WS_URL}";
  window.__COGNITO_REGION__ = "${REGION}";
  window.__COGNITO_USER_POOL_ID__ = "${USER_POOL_ID}";
  window.__COGNITO_CLIENT_ID__ = "${CLIENT_ID}";
  window.__COGNITO_IDENTITY_POOL_ID__ = "${IDENTITY_POOL_ID}";
  window.__CAMPAIGNS_API_BASE_URL__ = "";
})();
EOF

if [[ -z "$BUCKET" || "$BUCKET" == "None" ]]; then
  echo "❌ Could not resolve hosting bucket output"
  exit 1
fi

echo "☁️ Syncing frontend/ to s3://${BUCKET}/ (root)"
aws --profile "$PROFILE" --region "$REGION" s3 sync frontend "s3://${BUCKET}/" \
  --delete \
  --exclude "*.UNSAFE_BACKUP"

echo "☁️ Syncing frontend/ to s3://${BUCKET}/frontend/ (prefix for /frontend/* URLs)"
aws --profile "$PROFILE" --region "$REGION" s3 sync frontend "s3://${BUCKET}/frontend/" \
  --delete \
  --exclude "*.UNSAFE_BACKUP"

echo "🧹 Creating CloudFront invalidation..."
aws --profile "$PROFILE" --region "$REGION" cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "/index.html" "/env.js" "/*" >/dev/null

echo "✅ CentralPlatform web frontend deployed"
echo "- CloudFront: https://${CF_DOMAIN}/frontend/index.html"
echo "- Bucket: s3://${BUCKET}/"

echo "ℹ️ NOTE: API_BASE_URL points to a minimal placeholder API (${API_BASE_URL})."
echo "ℹ️ WizzUser API (for reference): ${WIZZUSER_API_URL}"
