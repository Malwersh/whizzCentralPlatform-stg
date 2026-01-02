#!/bin/bash

# Configure Cognito Post-Confirmation trigger for wallet creation

TRIGGER_ARN="arn:aws:lambda:us-east-1:031857856164:function:dev-wizz-wallet-creation-trigger"
POOL_ID="us-east-1_Mnrmklxro"

echo "🔧 Configuring Post-Confirmation trigger..."
echo "Pool: $POOL_ID"
echo "Trigger: $TRIGGER_ARN"
echo ""

aws cognito-idp update-user-pool \
  --user-pool-id "$POOL_ID" \
  --lambda-config PostConfirmation="$TRIGGER_ARN" \
  --profile Wizz_dev_UserApp \
  --region us-east-1

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Trigger configured successfully!"
    echo ""
    echo "Verifying configuration..."
    aws cognito-idp describe-user-pool \
      --user-pool-id "$POOL_ID" \
      --profile Wizz_dev_UserApp \
      --region us-east-1 \
      --query 'UserPool.LambdaConfig' \
      --output json
else
    echo ""
    echo "❌ Failed to configure trigger"
    exit 1
fi
