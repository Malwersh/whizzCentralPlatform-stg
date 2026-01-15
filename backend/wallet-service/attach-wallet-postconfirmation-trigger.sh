#!/bin/bash

# Attach (or update) Cognito PostConfirmation trigger to the wallet creation trigger Lambda.
#
# Why this exists:
# - The wallet-service SAM stack creates the trigger Lambda + invoke permission,
#   but Cognito triggers must be attached on the Cognito User Pool itself.
# - Cognito User Pool is owned by a different stack, so CloudFormation here can't safely manage it.
#
# Usage:
#   ./attach-wallet-postconfirmation-trigger.sh [environment]
#
# Examples:
#   ./attach-wallet-postconfirmation-trigger.sh staging
#
# Notes:
# - This script PRESERVES existing LambdaConfig fields and only sets PostConfirmation.

set -euo pipefail

ENVIRONMENT=${1:-staging}

if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|production)$ ]]; then
  echo "❌ Invalid environment: $ENVIRONMENT (expected dev|staging|production)"
  exit 1
fi

AWS_REGION="us-east-1"
AWS_PROFILE=""
case "$ENVIRONMENT" in
  dev)
    AWS_PROFILE="Wizz_dev_UserApp"
    ;;
  staging)
    AWS_PROFILE="Wizz_stg_UserApp"
    ;;
  production)
    AWS_PROFILE="Wizz_prod_UserApp"
    ;;
esac

# These should match samconfig.toml overrides.
USER_POOL_ID=""
case "$ENVIRONMENT" in
  dev)
    USER_POOL_ID="us-east-1_Mnrmklxro"
    ;;
  staging)
    USER_POOL_ID="us-east-1_RGTqUXF5C"
    ;;
  production)
    # If/when production is configured, set the real pool ID here.
    echo "❌ Production User Pool ID is not configured in this script."
    echo "   Set USER_POOL_ID in attach-wallet-postconfirmation-trigger.sh before using production."
    exit 1
    ;;
esac

TRIGGER_FUNCTION_NAME="${ENVIRONMENT}-wizz-wallet-creation-trigger"

echo "🔧 Attaching PostConfirmation trigger"
echo "Environment: $ENVIRONMENT"
echo "AWS Profile: $AWS_PROFILE"
echo "Region: $AWS_REGION"
echo "UserPoolId: $USER_POOL_ID"
echo "Trigger Lambda: $TRIGGER_FUNCTION_NAME"
echo ""

# 1) Resolve trigger Lambda ARN
TRIGGER_FUNCTION_ARN=$(aws lambda get-function \
  --function-name "$TRIGGER_FUNCTION_NAME" \
  --query 'Configuration.FunctionArn' \
  --output text \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION")

if [[ -z "$TRIGGER_FUNCTION_ARN" || "$TRIGGER_FUNCTION_ARN" == "None" ]]; then
  echo "❌ Could not resolve Lambda ARN for $TRIGGER_FUNCTION_NAME"
  exit 1
fi

echo "✅ Trigger ARN: $TRIGGER_FUNCTION_ARN"

# 2) Fetch existing LambdaConfig (may be null)
EXISTING_LAMBDA_CONFIG_JSON=$(aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --query 'UserPool.LambdaConfig' \
  --output json \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION")

# 2b) Fetch existing AutoVerifiedAttributes (some update-user-pool calls can reset this if omitted)
EXISTING_AUTO_VERIFIED_TEXT=$(aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --query 'UserPool.AutoVerifiedAttributes' \
  --output text \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION")

AUTO_VERIFIED_ARGS=()
if [[ -n "$EXISTING_AUTO_VERIFIED_TEXT" && "$EXISTING_AUTO_VERIFIED_TEXT" != "None" ]]; then
  # shellcheck disable=SC2206
  AUTO_VERIFIED_ARGS=(--auto-verified-attributes $EXISTING_AUTO_VERIFIED_TEXT)
fi

# 3) Merge PostConfirmation into LambdaConfig (preserve other fields)
MERGED_LAMBDA_CONFIG_JSON=$(echo "$EXISTING_LAMBDA_CONFIG_JSON" | TRIGGER_ARN="$TRIGGER_FUNCTION_ARN" node - <<'NODE'
const fs = require('fs');

const existingRaw = fs.readFileSync(0, 'utf8').trim();
const triggerArn = process.env.TRIGGER_ARN;

let existing;
try {
  existing = existingRaw ? JSON.parse(existingRaw) : {};
} catch (e) {
  existing = {};
}

if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
  existing = {};
}

existing.PostConfirmation = triggerArn;

for (const key of Object.keys(existing)) {
  if (existing[key] === null || typeof existing[key] === 'undefined') {
    delete existing[key];
  }
}

process.stdout.write(JSON.stringify(existing));
NODE
)

TMP_FILE=$(mktemp)
echo "$MERGED_LAMBDA_CONFIG_JSON" > "$TMP_FILE"

echo "🧩 Existing LambdaConfig: $EXISTING_LAMBDA_CONFIG_JSON"
echo "🧩 Merged LambdaConfig:   $MERGED_LAMBDA_CONFIG_JSON"

# 4) Update User Pool LambdaConfig (preserving other config)
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --lambda-config "file://$TMP_FILE" \
  "${AUTO_VERIFIED_ARGS[@]}" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  >/dev/null

rm -f "$TMP_FILE"

echo "✅ Attached PostConfirmation trigger successfully."
echo "   UserPoolId: $USER_POOL_ID"
echo "   PostConfirmation: $TRIGGER_FUNCTION_ARN"
