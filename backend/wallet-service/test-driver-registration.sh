#!/bin/bash

# Test driver registration with automatic wallet creation

POOL_ID="us-east-1_Mnrmklxro"
PHONE="+9647901111111"  # Test phone number
PASSWORD="TestDriver@2025"
EMAIL="test.driver.wallet@wizz.iq"

echo "🧪 Creating test driver..."
echo "Pool: $POOL_ID"
echo "Phone: $PHONE"
echo "Email: $EMAIL"
echo ""

# Step 1: Create user
echo "1️⃣ Creating user in Cognito..."
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username "$PHONE" \
  --temporary-password "$PASSWORD" \
  --user-attributes Name=email,Value="$EMAIL" Name=phone_number,Value="$PHONE" \
  --message-action SUPPRESS \
  --profile Wizz_dev_UserApp \
  --region us-east-1

if [ $? -ne 0 ]; then
    echo "❌ Failed to create user"
    exit 1
fi

echo ""
echo "✅ User created!"

# Step 2: Set permanent password
echo ""
echo "2️⃣ Setting permanent password..."
aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username "$PHONE" \
  --password "$PASSWORD" \
  --permanent \
  --profile Wizz_dev_UserApp \
  --region us-east-1

echo "✅ Password set!"

# Step 3: Get user details
echo ""
echo "3️⃣ Getting driver ID..."
DRIVER_ID=$(aws cognito-idp admin-get-user \
  --user-pool-id "$POOL_ID" \
  --username "$PHONE" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --query 'UserAttributes[?Name==`sub`].Value' \
  --output text)

echo "Driver ID (sub): $DRIVER_ID"

# Step 4: Confirm user (this triggers PostConfirmation)
echo ""
echo "4️⃣ Confirming user (triggers wallet creation)..."
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id "$POOL_ID" \
  --username "$PHONE" \
  --profile Wizz_dev_UserApp \
  --region us-east-1

echo "✅ User confirmed!"

echo ""
echo "⏳ Waiting 5 seconds for trigger to execute..."
sleep 5

echo ""
echo "5️⃣ Checking trigger logs..."
aws logs tail /aws/lambda/dev-wizz-wallet-creation-trigger \
  --since 1m \
  --format short \
  --profile Wizz_dev_UserApp \
  --region us-east-1 2>&1 | tail -30

echo ""
echo "6️⃣ Checking if wallet was created..."
WALLET_ID="WALLET#DRIVER#${DRIVER_ID}"
aws dynamodb get-item \
  --table-name dev-Wallets \
  --key "{\"walletId\":{\"S\":\"$WALLET_ID\"},\"sk\":{\"S\":\"META\"}}" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --query 'Item.{walletId:walletId.S,available:availableBalance.N,locked:lockedBalance.N,status:status.S}' \
  --output json

echo ""
echo "========================================="
echo "✅ Test Complete!"
echo "Driver ID: $DRIVER_ID"
echo "Phone: $PHONE"
echo "Password: $PASSWORD"
echo "========================================="
