#!/bin/bash

echo "🧪 Testing Driver Wallet Access (GET /wallet/me)"
echo "=================================================="

# Driver credentials
USERNAME="64f894a8-a001-70fc-ddbd-3ff0dd55c86c"
PHONE="+9640431874668"
PASSWORD="TestDriver@2025!"
DRIVER_ID="64f894a8-a001-70fc-ddbd-3ff0dd55c86c"

# Cognito config
USER_POOL_ID="us-east-1_Mnrmklxro"
CLIENT_ID="4dkt45gole08kurh0o43rvk8q7"
REGION="us-east-1"
PROFILE="Wizz_dev_UserApp"

# API endpoint
API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

echo ""
echo "Driver: $PHONE"
echo "Driver ID: $DRIVER_ID"
echo ""

# Step 1: Authenticate driver
echo "1️⃣ Authenticating driver..."
AUTH_RESPONSE=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters USERNAME="$USERNAME",PASSWORD="$PASSWORD" \
  --profile "$PROFILE" \
  --region "$REGION" \
  2>&1)

if echo "$AUTH_RESPONSE" | grep -q "NotAuthorizedException\|UserNotFoundException"; then
  echo "❌ Authentication failed!"
  echo "$AUTH_RESPONSE"
  exit 1
fi

# Extract token
ID_TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.AuthenticationResult.IdToken')

if [ "$ID_TOKEN" == "null" ] || [ -z "$ID_TOKEN" ]; then
  echo "❌ Failed to extract ID token!"
  echo "$AUTH_RESPONSE"
  exit 1
fi

echo "✅ Authenticated! Token: ${ID_TOKEN:0:50}..."
echo ""

# Step 2: Get driver's wallet
echo "2️⃣ Getting driver's wallet (GET /wallet/me)..."
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

# Step 3: Get driver's transactions
echo "3️⃣ Getting driver's transactions (GET /wallet/me/transactions)..."
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

echo "=================================================="
echo "✅ Test Complete!"
