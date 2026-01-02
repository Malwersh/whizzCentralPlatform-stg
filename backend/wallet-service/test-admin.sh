#!/bin/bash

# Test Admin Authentication
# Tests admin@wizz.iq account

set -e

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
CLIENT_ID="5hun8p61grnakisu5gammcjelv"
USER_POOL_ID="us-east-1_Cp9YnOQWi"
USERNAME="admin@wizz.iq"
TEMP_PASSWORD="TempPass123!"
NEW_PASSWORD="Admin@Wizz2025!"

echo "========================================="
echo "👨‍💼 Admin Authentication Test"
echo "========================================="
echo ""
echo "Admin: $USERNAME"
echo "API: $API_URL"
echo ""

# Step 1: Initial authentication with temporary password
echo "Step 1: Authenticating with temporary password..."

jq -n \
  --arg user "$USERNAME" \
  --arg pass "$TEMP_PASSWORD" \
  '{USERNAME: $user, PASSWORD: $pass}' \
  > /tmp/admin-auth-params.json

INITIAL_AUTH=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id $CLIENT_ID \
  --auth-parameters file:///tmp/admin-auth-params.json \
  --profile Wizz_dev_UserApp \
  2>&1 || true)

rm -f /tmp/admin-auth-params.json

# Check if password change is required
if echo "$INITIAL_AUTH" | grep -q "NEW_PASSWORD_REQUIRED"; then
  echo "⚠️ Password change required"
  echo ""
  
  # Extract session
  SESSION=$(echo "$INITIAL_AUTH" | jq -r .Session)
  
  echo "Step 2: Setting new permanent password..."
  
  # Respond to auth challenge with proper format
  AUTH_RESPONSE=$(aws cognito-idp admin-respond-to-auth-challenge \
    --user-pool-id $USER_POOL_ID \
    --client-id $CLIENT_ID \
    --challenge-name NEW_PASSWORD_REQUIRED \
    --challenge-responses "NEW_PASSWORD=$NEW_PASSWORD,USERNAME=$USERNAME" \
    --session "$SESSION" \
    --profile Wizz_dev_UserApp \
    2>&1 || true)
  
  if echo "$AUTH_RESPONSE" | grep -q "AuthenticationResult"; then
    TOKEN=$(echo "$AUTH_RESPONSE" | jq -r .AuthenticationResult.AccessToken)
    echo "✅ Password changed and authenticated!"
  else
    echo "❌ Password change failed!"
    echo "$AUTH_RESPONSE"
    exit 1
  fi
elif echo "$INITIAL_AUTH" | grep -q "AuthenticationResult"; then
  # Already authenticated (password was changed before)
  TOKEN=$(echo "$INITIAL_AUTH" | jq -r .AuthenticationResult.AccessToken)
  echo "✅ Authentication successful (using existing password)!"
else
  # Try with new password
  echo "⚠️ Trying with new password..."
  
  jq -n \
    --arg user "$USERNAME" \
    --arg pass "$NEW_PASSWORD" \
    '{USERNAME: $user, PASSWORD: $pass}' \
    > /tmp/admin-auth-params2.json
  
  AUTH_RESPONSE=$(aws cognito-idp initiate-auth \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id $CLIENT_ID \
    --auth-parameters file:///tmp/admin-auth-params2.json \
    --profile Wizz_dev_UserApp \
    2>&1 || true)
  
  rm -f /tmp/admin-auth-params2.json
  
  if echo "$AUTH_RESPONSE" | grep -q "AuthenticationResult"; then
    TOKEN=$(echo "$AUTH_RESPONSE" | jq -r .AuthenticationResult.AccessToken)
    echo "✅ Authentication successful!"
  else
    echo "❌ Authentication failed!"
    echo "$AUTH_RESPONSE"
    exit 1
  fi
fi

echo ""
echo "🎫 Access Token (first 50 chars): ${TOKEN:0:50}..."

echo ""
echo "========================================="
echo "Step 3: Testing Admin Endpoint"
echo "========================================="
echo "GET /wallet/platform (Admin only)"
echo ""

# Test platform wallet endpoint (admin only)
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$API_URL/wallet/platform")

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

if [ "$HTTP_STATUS" = "200" ]; then
  echo ""
  echo "✅ Admin endpoint access successful!"
else
  echo ""
  echo "❌ Unexpected status code"
fi

echo ""
echo "========================================="
echo "Step 4: Test RBAC - Try Driver Endpoint (Should Fail)"
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
  echo "✅ RBAC working correctly - Admin blocked from driver endpoint!"
else
  echo ""
  echo "❌ RBAC FAILURE - Admin accessed driver endpoint!"
fi

echo ""
echo "========================================="
echo "Step 5: Test RBAC - Try Service Endpoint (Should Fail)"
echo "========================================="
echo "POST /wallet/hold/create (Service only)"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "$API_URL/wallet/hold/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "WALLET#PLATFORM",
    "amount": 1000,
    "orderId": "ORDER#admin-test",
    "reason": "Admin test"
  }')

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

if [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "403" ]; then
  echo ""
  echo "✅ RBAC working correctly - Admin blocked from service endpoint!"
else
  echo ""
  echo "❌ RBAC FAILURE - Admin accessed service endpoint!"
fi

echo ""
echo "========================================="
echo "📊 Test Summary"
echo "========================================="
echo "Admin authentication and authorization test completed."
