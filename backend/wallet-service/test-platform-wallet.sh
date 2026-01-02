#!/bin/bash
# Test platform wallet creation and access

echo "🏦 Testing Platform Wallet"
echo "========================="

# Service account credentials
USERNAME="order-service-dev"
PASSWORD="Moh@1985#OrderServiceDevSecure2025!"
CLIENT_ID="536kaptb4mttprbravfh9gbbq0"
CLIENT_SECRET="h3d5e14egk2mdvr98ci77h5gjl5lp21d8bits69k8dh9151cee"
USER_POOL_ID="us-east-1_VTZMjCvuP"

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

echo ""
echo "1️⃣ Authenticating as service account..."

# Calculate SECRET_HASH
SECRET_HASH=$(echo -n "${USERNAME}${CLIENT_ID}" | openssl dgst -sha256 -hmac "$CLIENT_SECRET" -binary | base64)

# Authenticate
AUTH_RESPONSE=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters USERNAME="$USERNAME",PASSWORD="$PASSWORD",SECRET_HASH="$SECRET_HASH" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  2>&1)

TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.AuthenticationResult.AccessToken')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Authentication failed!"
  echo "$AUTH_RESPONSE"
  exit 1
fi

echo "✅ Authenticated!"
echo ""

echo "2️⃣ Creating platform wallet (POST /wallet/platform/create)..."
CREATE_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "$API_URL/wallet/platform/create")

HTTP_STATUS=$(echo "$CREATE_RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$CREATE_RESPONSE" | sed '/HTTP_STATUS:/d')

echo "Status: $HTTP_STATUS"
echo "Response:"
echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
echo ""

echo "3️⃣ Getting platform wallet (GET /wallet/platform)..."
WALLET_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X GET \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "$API_URL/wallet/platform")

HTTP_STATUS=$(echo "$WALLET_RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$WALLET_RESPONSE" | sed '/HTTP_STATUS:/d')

echo "Status: $HTTP_STATUS"
echo "Response:"
echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"
echo ""

echo "4️⃣ Verifying in DynamoDB..."
aws dynamodb get-item \
  --table-name dev-Wallets \
  --key '{"walletId":{"S":"WALLET#PLATFORM"},"sk":{"S":"META"}}' \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  | jq '.Item | {
      walletId: .walletId.S,
      availableBalance: .availableBalance.N,
      lockedBalance: .lockedBalance.N,
      status: .status.S,
      createdAt: .createdAt.S
    }' 2>/dev/null || echo "Not found in DynamoDB"

echo ""
echo "========================="
echo "✅ Test Complete!"
