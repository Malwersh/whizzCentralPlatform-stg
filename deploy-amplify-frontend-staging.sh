#!/bin/bash

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-Wizz_stg_UserApp}"
STAGE="${STAGE:-staging}"
STACK_NAME="${STACK_NAME:-whizz-centralplatform-frontend-staging}"
APP_NAME="${APP_NAME:-whizz-centralplatform-frontend-staging}"
BRANCH_NAME="${BRANCH_NAME:-staging}"

export AWS_PAGER=""

cd "$(dirname "$0")"

if ! command -v aws >/dev/null 2>&1; then
  echo "❌ Missing aws cli"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "❌ Missing curl"
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "❌ Missing zip (install via brew install zip)"
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

find_or_create_amplify_app() {
  local app_id
  app_id="$(aws --profile "$PROFILE" --region "$REGION" amplify list-apps \
    --query "apps[?name=='${APP_NAME}'].appId | [0]" \
    --output text)"

  if [[ -z "${app_id}" || "${app_id}" == "None" ]]; then
    >&2 echo "🆕 Creating Amplify app: ${APP_NAME}"
    app_id="$(aws --profile "$PROFILE" --region "$REGION" amplify create-app \
      --name "$APP_NAME" \
      --platform WEB \
      --query 'app.appId' \
      --output text)"
  else
    >&2 echo "✅ Amplify app exists: ${APP_NAME} (${app_id})"
  fi

  echo "$app_id"
}

ensure_branch() {
  local app_id="$1"

  local exists
  exists="$(aws --profile "$PROFILE" --region "$REGION" amplify list-branches \
    --app-id "$app_id" \
    --query "branches[?branchName=='${BRANCH_NAME}'].branchName | [0]" \
    --output text)"

  if [[ -z "${exists}" || "${exists}" == "None" ]]; then
    echo "🆕 Creating Amplify branch: ${BRANCH_NAME}"
    aws --profile "$PROFILE" --region "$REGION" amplify create-branch \
      --app-id "$app_id" \
      --branch-name "$BRANCH_NAME" \
      --stage BETA >/dev/null
  else
    echo "✅ Amplify branch exists: ${BRANCH_NAME}"
  fi
}

update_rewrite_rules() {
  local app_id="$1"

  # Minimal rewrite: make root load index.html.
  # Note: manual/GitHub-hosted content is published at the site root.
  local rules_json
  rules_json='[{"source":"/","target":"/index.html","status":"200"}]'

  echo "🔀 Updating Amplify custom rules (rewrite / → /index.html)"
  aws --profile "$PROFILE" --region "$REGION" amplify update-app \
    --app-id "$app_id" \
    --custom-rules "$rules_json" >/dev/null
}

write_frontend_env_js() {
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

  echo "🧩 Writing frontend/env.js for Amplify manual deploy (${STAGE})..."
  cat > frontend/env.js <<EOF
// Auto-generated for staging deploy. Do not commit.
(function(){
  "use strict";
  window.__STAGE__ = "${STAGE}";
  window.__API_BASE_URL__ = "${api_base_url}";
  window.__PUSH_NOTIFICATION_API_URL__ = "";
  window.__AI_API_ENDPOINT__ = "${ai_endpoint}";
  window.__AMAZON_CONNECT_API_BASE_URL__ = "";
  window.__AMAZON_CONNECT_WS_URL__ = "";
  window.__LIVE_CHAT_WEBSOCKET_URL__ = "${live_chat_ws_url}";
  window.__COGNITO_REGION__ = "${REGION}";
  window.__COGNITO_USER_POOL_ID__ = "${user_pool_id}";
  window.__COGNITO_CLIENT_ID__ = "${client_id}";
  window.__COGNITO_IDENTITY_POOL_ID__ = "${identity_pool_id}";
  window.__CAMPAIGNS_API_BASE_URL__ = "";
})();
EOF
}

create_zip_artifact() {
  local out_zip="$1"

  rm -f "$out_zip"

  echo "📦 Creating deployment zip: ${out_zip}"
  (
    cd frontend
    zip -qr "$out_zip" . -x "*.UNSAFE_BACKUP" >/dev/null
  )
}

manual_deploy_zip() {
  local app_id="$1"
  local zip_path="$2"

  echo "🚀 Creating Amplify manual deployment..."
  local create_json job_id zip_url
  create_json="$(aws --profile "$PROFILE" --region "$REGION" amplify create-deployment \
    --app-id "$app_id" \
    --branch-name "$BRANCH_NAME")"

  job_id="$(echo "$create_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["jobId"])')"
  zip_url="$(echo "$create_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["zipUploadUrl"])')"

  if [[ -z "${job_id}" || -z "${zip_url}" ]]; then
    echo "❌ Failed to create Amplify deployment"
    exit 1
  fi

  echo "☁️ Uploading zip to Amplify..."
  curl -sS -H "Content-Type: application/zip" --upload-file "$zip_path" "$zip_url" >/dev/null

  echo "▶️ Starting deployment job ${job_id}..."
  aws --profile "$PROFILE" --region "$REGION" amplify start-deployment \
    --app-id "$app_id" \
    --branch-name "$BRANCH_NAME" \
    --job-id "$job_id" >/dev/null

  echo "⏳ Waiting for deployment to finish..."
  local status
  while true; do
    status="$(aws --profile "$PROFILE" --region "$REGION" amplify get-job \
      --app-id "$app_id" \
      --branch-name "$BRANCH_NAME" \
      --job-id "$job_id" \
      --query 'job.summary.status' \
      --output text)"

    case "$status" in
      SUCCEED)
        echo "✅ Amplify deployment succeeded"
        break
        ;;
      FAILED|CANCELLED)
        echo "❌ Amplify deployment ${status}"
        aws --profile "$PROFILE" --region "$REGION" amplify get-job \
          --app-id "$app_id" \
          --branch-name "$BRANCH_NAME" \
          --job-id "$job_id" \
          --query 'job' \
          --output json | cat
        exit 1
        ;;
      *)
        sleep 5
        ;;
    esac
  done
}

main() {
  echo "🔎 Checking CloudFormation stack exists: ${STACK_NAME}"
  ensure_stack_exists

  local app_id default_domain
  app_id="$(find_or_create_amplify_app)"

  ensure_branch "$app_id"
  update_rewrite_rules "$app_id"

  write_frontend_env_js

  local zip_path
  zip_path="/tmp/${APP_NAME}-${BRANCH_NAME}-$(date +%s).zip"
  create_zip_artifact "$zip_path"

  manual_deploy_zip "$app_id" "$zip_path"

  default_domain="$(aws --profile "$PROFILE" --region "$REGION" amplify get-app --app-id "$app_id" --query 'app.defaultDomain' --output text)"

  echo "✅ Amplify Hosting ready"
  echo "- Amplify AppId: ${app_id}"
  echo "- Default domain: ${default_domain}"
  echo "- Open: https://${BRANCH_NAME}.${default_domain}/"
  echo "- Login: https://${BRANCH_NAME}.${default_domain}/index.html"
  echo "- Root (rewrite): https://${BRANCH_NAME}.${default_domain}/"
}

main "$@"
