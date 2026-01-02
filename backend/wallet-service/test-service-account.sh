#!/bin/bash

# Test Service Account Authentication
# Tests order-service-dev account

set -e

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
CLIENT_ID="536kaptb4mttprbravfh9gbbq0"
USER_POOL_ID="us-east-1_VTZMjCvuP"

echo "========================================="
echo "🔧 Service Account Authentication Test"
echo "========================================="
echo ""
echo "Service: order-service-dev"
echo "API: $API_URL"
echo ""

# Get credentials from Secrets Manager
echo "Step 1: Retrieving credentials from Secrets Manager..."
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id dev/wallet-service/order-service \
  --profile Wizz_dev_UserApp \
  --query SecretString \
  --output text)

# Extract credentials more carefully, handling special characters
USERNAME=$(echo "$SECRET" | grep "^USERNAME=" | cut -d= -f2-)
PASSWORD=$(echo "$SECRET" | grep "^PASSWORD=" | cut -d= -f2-)

echo "✅ Credentials retrieved"
echo "   Username: $USERNAME"
echo ""

# Authenticate
echo "Step 2: Calculating SECRET_HASH..."
CLIENT_SECRET="h3d5e14egk2mdvr98ci77h5gjl5lp21d8bits69k8dh9151cee"
SECRET_HASH=$(echo -n "${USERNAME}${CLIENT_ID}" | openssl dgst -sha256 -hmac "$CLIENT_SECRET" -binary | base64)

echo "✅ SECRET_HASH calculated"
echo ""

echo "Step 3: Authenticating with Service Cognito Pool..."

# Create JSON file with proper escaping using jq to avoid special character issues
jq -n \
  --arg user "$USERNAME" \
  --arg pass "$PASSWORD" \
  --arg hash "$SECRET_HASH" \
  '{USERNAME: $user, PASSWORD: $pass, SECRET_HASH: $hash}' \
  > /tmp/auth-params.json

AUTH_RESPONSE=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id $CLIENT_ID \
  --auth-parameters file:///tmp/auth-params.json \
  --profile Wizz_dev_UserApp \
  2>&1 || true)

rm -f /tmp/auth-params.json

# Debug: Show raw response
echo "Auth response:"
echo "$AUTH_RESPONSE"
echo ""

if echo "$AUTH_RESPONSE" | grep -q "AuthenticationResult"; then
  TOKEN=$(echo "$AUTH_RESPONSE" | jq -r .AuthenticationResult.AccessToken)
  echo "✅ Authentication successful!"
  echo ""
  echo "🎫 Access Token (first 50 chars): ${TOKEN:0:50}..."
else
  echo "❌ Authentication failed!"
  exit 1
fi

echo ""
echo "========================================="
echo "Step 4: Testing Service Endpoint"
echo "========================================="
echo "POST /wallet/hold/create (Service only)"
echo ""

# Test create hold with PLATFORM wallet
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "$API_URL/wallet/hold/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "WALLET#PLATFORM",
    "amount": 5000,
    "orderId": "ORDER#test-order-123",
    "reason": "Test order hold"
  }')

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
  echo ""
  echo "✅ Service endpoint access successful!"
elif [ "$HTTP_STATUS" = "404" ]; then
  echo ""
  echo "⚠️ Wallet not found (normal - need to create wallet first)"
else
  echo ""
  echo "❌ Unexpected status code"
fi

echo ""
echo "========================================="
echo "Step 5: Test RBAC - Try Driver Endpoint (Should Fail)"
echo "========================================="
echo "GET /wallet/me (Driver only)"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$API_URL/wallet/me")

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

if [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "403" ]; then
  echo ""
  echo "✅ RBAC working correctly - Service blocked from driver endpoint!"
else
  echo ""
  echo "❌ RBAC FAILURE - Service accessed driver endpoint!"
fi

echo ""
echo "========================================="
echo "📊 Test Summary"
echo "========================================="
echo "Service account authentication and authorization test completed."
echo ""
