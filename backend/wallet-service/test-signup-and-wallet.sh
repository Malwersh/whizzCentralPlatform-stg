#!/bin/bash

echo "🧪 Creating Test Driver and Testing Wallet Access"
echo "=================================================="

# Test driver details
PHONE="+9647901234567"
EMAIL="test.driver.wallet@wizz.test"
PASSWORD="TestWallet@2025#Secure"

# Cognito config
USER_POOL_ID="us-east-1_Mnrmklxro"
CLIENT_ID="4dkt45gole08kurh0o43rvk8q7"
REGION="us-east-1"
PROFILE="Wizz_dev_UserApp"

# API endpoint
API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

echo "Creating test driver: $PHONE"
echo ""

# Step 1: Create driver via SignUp (triggers wallet creation)
echo "1️⃣ Signing up new driver..."
SIGNUP_RESPONSE=$(aws cognito-idp sign-up \
  --client-id "$CLIENT_ID" \
  --username "$PHONE" \
  --password "$PASSWORD" \
  --user-attributes Name=email,Value="$EMAIL" Name=phone_number,Value="$PHONE" \
  --profile "$PROFILE" \
  --region "$REGION" \
  2>&1)

if echo "$SIGNUP_RESPONSE" | grep -q "UsernameExistsException"; then
  echo "⚠️  Driver already exists, using existing driver"
  DRIVER_ID=$(aws cognito-idp admin-get-user --user-pool-id "$USER_POOL_ID" --username "$PHONE" --profile "$PROFILE" --region "$REGION" | jq -r '.Username')
else
  DRIVER_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.UserSub')
  echo "✅ Driver created! ID: $DRIVER_ID"
  
  # Step 2: Admin confirm (triggers PostConfirmation → wallet creation)
  echo ""
  echo "2️⃣ Confirming driver (triggers wallet creation)..."
  aws cognito-idp admin-confirm-sign-up \
    --user-pool-id "$USER_POOL_ID" \
    --username "$PHONE" \
    --profile "$PROFILE" \
    --region "$REGION" > /dev/null 2>&1
  
  echo "✅ Driver confirmed!"
  
  # Wait for trigger to execute
  echo "⏳ Waiting 3 seconds for wallet creation trigger..."
  sleep 3
fi

echo "Driver ID: $DRIVER_ID"
echo ""

# Step 3: Authenticate driver
echo "3️⃣ Authenticating driver..."
AUTH_RESPONSE=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME="$PHONE",PASSWORD="$PASSWORD" \
  --profile "$PROFILE" \
  --region "$REGION" \
  2>&1)

ID_TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.AuthenticationResult.IdToken')

if [ "$ID_TOKEN" == "null" ] || [ -z "$ID_TOKEN" ]; then
  echo "❌ Authentication failed!"
  echo "$AUTH_RESPONSE"
  exit 1
fi

echo "✅ Authenticated! Token: ${ID_TOKEN:0:50}..."
echo ""

# Step 4: Get driver's wallet
echo "4️⃣ Getting driver's wallet (GET /wallet/me)..."
WALLET_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X GET \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  "$API_URL/wallet/me")

HTTP_STATUS=$(echo "$WALLET_RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$WALLET_RESPONSE" | sed '/HTTP_STATUS:/d')

echo "Status: $HTTP_STATUS"
echo "Response:"
echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
echo ""

# Step 5: Get driver's transactions
echo "5️⃣ Getting driver's transactions (GET /wallet/me/transactions)..."
TRANSACTIONS_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X GET \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  "$API_URL/wallet/me/transactions?limit=10")

HTTP_STATUS=$(echo "$TRANSACTIONS_RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$TRANSACTIONS_RESPONSE" | sed '/HTTP_STATUS:/d')

echo "Status: $HTTP_STATUS"
echo "Response:"
echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
echo ""

# Step 6: Verify wallet in DynamoDB
echo "6️⃣ Verifying wallet in DynamoDB..."
WALLET_ID="WALLET#DRIVER#$DRIVER_ID"
aws dynamodb get-item \
  --table-name dev-Wallets \
  --key "{\"walletId\":{\"S\":\"$WALLET_ID\"},\"sk\":{\"S\":\"META\"}}" \
  --profile "$PROFILE" \
  --region "$REGION" \
  | jq '.Item | {
      walletId: .walletId.S,
      availableBalance: .availableBalance.N,
      lockedBalance: .lockedBalance.N,
      minRequiredBalance: .minRequiredBalance.N,
      status: .status.S,
      createdAt: .createdAt.S
    }' || echo "❌ Wallet not found in DynamoDB"

echo ""
echo "=================================================="
echo "✅ Test Complete!"
echo ""
echo "To clean up:"
echo "aws cognito-idp admin-delete-user --user-pool-id $USER_POOL_ID --username $PHONE --profile $PROFILE --region $REGION"
