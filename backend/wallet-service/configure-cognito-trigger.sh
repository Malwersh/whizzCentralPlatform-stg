#!/bin/bash

# Configure Cognito Post-Confirmation trigger for wallet creation
#
# Usage:
#   ./configure-cognito-trigger.sh staging us-east-1_RGTqUXF5C
#   ./configure-cognito-trigger.sh dev us-east-1_Mnrmklxro

set -e

ENVIRONMENT=${1:-staging}
POOL_ID=${2:-us-east-1_RGTqUXF5C}
REGION=${AWS_REGION:-us-east-1}

PROFILE="Wizz_${ENVIRONMENT}_UserApp"
FUNCTION_NAME="${ENVIRONMENT}-wizz-wallet-creation-trigger"

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --region "$REGION" --query 'Account' --output text)
TRIGGER_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"

echo "🔧 Configuring Post-Confirmation trigger..."
echo "Pool: $POOL_ID"
echo "Trigger: $TRIGGER_ARN"
echo "Env: $ENVIRONMENT"
echo "Profile: $PROFILE"
echo ""

aws cognito-idp update-user-pool \
  --user-pool-id "$POOL_ID" \
  --lambda-config PostConfirmation="$TRIGGER_ARN" \
  --profile "$PROFILE" \
  --region "$REGION"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Trigger configured successfully!"
    echo ""
    echo "Verifying configuration..."
    aws cognito-idp describe-user-pool \
      --user-pool-id "$POOL_ID" \
      --profile "$PROFILE" \
      --region "$REGION" \
      --query 'UserPool.LambdaConfig' \
      --output json
else
    echo ""
    echo "❌ Failed to configure trigger"
    exit 1
fi
