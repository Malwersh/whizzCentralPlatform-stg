#!/bin/bash

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-Wizz_stg_UserApp}"
STAGE="${STAGE:-staging}"
STACK_NAME="${STACK_NAME:-whizz-centralplatform-frontend-staging}"

# Existing Amplify app we created for staging manual deploy
AMPLIFY_APP_ID="${AMPLIFY_APP_ID:-d2vmebm1e1n95m}"
BRANCH_NAME="${BRANCH_NAME:-staging}"

# Company GitHub repo (dedicated staging repo)
REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/whizzgo/whizzCentralPlatform-stg}"

# REQUIRED: GitHub token (keep it out of chat). Export it in your terminal:
# export GITHUB_TOKEN='...'
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

export AWS_PAGER=""

cd "$(dirname "$0")"

if ! command -v aws >/dev/null 2>&1; then
  echo "❌ Missing aws cli"
  exit 1
fi

get_stack_output() {
  local key="$1"
  aws --profile "$PROFILE" --region "$REGION" cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text
}

ensure_stack_exists() {
  aws --profile "$PROFILE" --region "$REGION" cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].StackStatus" \
    --output text >/dev/null
}

connect_app_to_repo() {
  if [[ -z "$GITHUB_TOKEN" ]]; then
    echo "❌ Missing GITHUB_TOKEN env var. Do NOT paste it in chat."
    echo "   In your terminal run: export GITHUB_TOKEN='...'"
    exit 1
  fi

  echo "🔗 Connecting Amplify app ${AMPLIFY_APP_ID} to GitHub repo: ${REPOSITORY_URL}"
  aws --profile "$PROFILE" --region "$REGION" amplify update-app \
    --app-id "$AMPLIFY_APP_ID" \
    --repository "$REPOSITORY_URL" \
    --access-token "$GITHUB_TOKEN" \
    --enable-branch-auto-build >/dev/null
}

ensure_branch() {
  local exists
  exists="$(aws --profile "$PROFILE" --region "$REGION" amplify list-branches \
    --app-id "$AMPLIFY_APP_ID" \
    --query "branches[?branchName=='${BRANCH_NAME}'].branchName | [0]" \
    --output text)"

  if [[ -z "${exists}" || "${exists}" == "None" ]]; then
    echo "🆕 Creating Amplify branch mapping: ${BRANCH_NAME}"
    aws --profile "$PROFILE" --region "$REGION" amplify create-branch \
      --app-id "$AMPLIFY_APP_ID" \
      --branch-name "$BRANCH_NAME" \
      --stage BETA \
      --enable-auto-build >/dev/null
  else
    echo "✅ Amplify branch exists: ${BRANCH_NAME}"
  fi
}

set_branch_env() {
  local user_pool_id client_id identity_pool_id api_base_url

  user_pool_id="$(get_stack_output CentralUserPoolId)"
  client_id="$(get_stack_output CentralUserPoolClientId)"
  identity_pool_id="$(get_stack_output CentralIdentityPoolId)"
  api_base_url="$(get_stack_output ConfigApiBaseUrl)"

  local wizzuser_ws_url central_ws_url live_chat_ws_url ai_endpoint
  wizzuser_ws_url="$(aws --profile "$PROFILE" --region "$REGION" cloudformation list-exports --query "Exports[?Name=='WizzUser-backend-${STAGE}-WebSocketUrl'].Value | [0]" --output text 2>/dev/null || true)"

  central_ws_url="$(aws --profile "$PROFILE" --region "$REGION" cloudformation describe-stacks \
    --stack-name "wizzcentral-websocket-${STAGE}" \
    --query "Stacks[0].Outputs[?OutputKey=='ServiceEndpointWebsocket'].OutputValue | [0]" \
    --output text 2>/dev/null || true)"

  if [[ -z "${central_ws_url:-}" || "${central_ws_url:-}" == "None" ]]; then
    central_ws_url=""
  fi
  if [[ -z "${wizzuser_ws_url:-}" || "${wizzuser_ws_url:-}" == "None" ]]; then
    wizzuser_ws_url=""
  fi

  live_chat_ws_url="${LIVE_CHAT_WEBSOCKET_URL:-${central_ws_url:-$wizzuser_ws_url}}"
  ai_endpoint="${AI_API_ENDPOINT:-$api_base_url}"

  echo "⚙️ Setting Amplify branch environment variables (${BRANCH_NAME})"

  # NOTE: Values are embedded here as JSON string for AWS CLI.
  aws --profile "$PROFILE" --region "$REGION" amplify update-branch \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --environment-variables "{\"STAGE\":\"${STAGE}\",\"API_BASE_URL\":\"${api_base_url}\",\"AI_API_ENDPOINT\":\"${ai_endpoint}\",\"LIVE_CHAT_WEBSOCKET_URL\":\"${live_chat_ws_url}\",\"COGNITO_REGION\":\"${REGION}\",\"COGNITO_USER_POOL_ID\":\"${user_pool_id}\",\"COGNITO_CLIENT_ID\":\"${client_id}\",\"COGNITO_IDENTITY_POOL_ID\":\"${identity_pool_id}\"}" >/dev/null
}

trigger_build() {
  echo "🚀 Triggering Amplify build for ${BRANCH_NAME}"
  aws --profile "$PROFILE" --region "$REGION" amplify start-job \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --job-type RELEASE >/dev/null

  local domain
  domain="$(aws --profile "$PROFILE" --region "$REGION" amplify get-app --app-id "$AMPLIFY_APP_ID" --query 'app.defaultDomain' --output text)"

  echo "✅ Build triggered"
  echo "- Watch: https://console.aws.amazon.com/amplify/home?region=${REGION}#${AMPLIFY_APP_ID}"
  echo "- URL: https://${BRANCH_NAME}.${domain}/"
}

main() {
  ensure_stack_exists
  connect_app_to_repo
  ensure_branch
  set_branch_env
  trigger_build

  echo
  echo "IMPORTANT: GitHub must contain a '${BRANCH_NAME}' branch in ${REPOSITORY_URL}."
  echo "If it doesn't exist yet, create it and push the CentralPlatform code there."
}

main "$@"
