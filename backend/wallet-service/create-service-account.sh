#!/bin/bash

# Create wallet-trigger-service account in Service Cognito Pool

POOL_ID="us-east-1_VTZMjCvuP"
USERNAME="wallet-trigger-service"
PASSWORD="WalletTriggerService@2025#Secure"

echo "🔧 Creating service account..."
echo "Pool: $POOL_ID"
echo "Username: $USERNAME"
echo ""

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username "$USERNAME" \
  --temporary-password "$PASSWORD" \
  --message-action SUPPRESS \
  --profile Wizz_dev_UserApp \
  --region us-east-1

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Service account created!"
    echo ""
    echo "Setting permanent password..."
    
    aws cognito-idp admin-set-user-password \
      --user-pool-id "$POOL_ID" \
      --username "$USERNAME" \
      --password "$PASSWORD" \
      --permanent \
      --profile Wizz_dev_UserApp \
      --region us-east-1
    
    echo "✅ Password set as permanent!"
else
    echo ""
    echo "❌ Failed to create service account"
    exit 1
fi
