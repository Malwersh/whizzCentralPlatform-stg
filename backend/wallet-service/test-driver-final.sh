#!/bin/bash

##############################################################################
# Test Driver Authentication with Updated Authorizer
# Tests the fixed WalletAuthorizer that validates all user types
##############################################################################

DRIVER_POOL_ID="us-east-1_Mnrmklxro"
DRIVER_CLIENT_ID="4dkt45gole08kurh0o43rvk8q7"
PHONE="+9640431874668"
PASSWORD="Moh@1985"
API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

echo "========================================="
echo "🔐 Driver Authentication Test"
echo "========================================="
echo ""
echo "📱 Phone: $PHONE"
echo "🌐 API: $API_URL"
echo ""

# Authenticate with phone number
echo "Step 1: Authenticating with Cognito..."
AUTH_RESPONSE=$(aws cognito-idp initiate-auth \
    --region us-east-1 \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id $DRIVER_CLIENT_ID \
    --auth-parameters USERNAME=$PHONE,PASSWORD=$PASSWORD \
    --profile Wizz_dev_UserApp \
    2>&1)

if echo "$AUTH_RESPONSE" | grep -q "AuthenticationResult"; then
    echo "✅ Authentication successful!"
    
    ACCESS_TOKEN=$(echo $AUTH_RESPONSE | jq -r '.AuthenticationResult.AccessToken')
    echo ""
    echo "🎫 Access Token (first 50 chars): ${ACCESS_TOKEN:0:50}..."
    echo ""
else
    echo "❌ Authentication failed:"
    echo "$AUTH_RESPONSE"
    exit 1
fi

# Test driver endpoint: /wallet/me
echo "========================================="
echo "Step 2: Testing Driver Endpoint"
echo "========================================="
echo "GET /wallet/me"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -X GET "$API_URL/wallet/me" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_STATUS" == "200" ]; then
    echo "✅ Driver endpoint access successful!"
elif [ "$HTTP_STATUS" == "401" ]; then
    echo "❌ Unauthorized - Authorizer rejected the token"
    echo ""
    echo "Checking authorizer logs..."
    aws logs tail /aws/lambda/dev-wizz-wallet-authorizer --since 2m --format short --profile Wizz_dev_UserApp 2>/dev/null | tail -20
elif [ "$HTTP_STATUS" == "403" ]; then
    echo "❌ Forbidden - RBAC denied access"
else
    echo "⚠️ Unexpected status code"
fi

echo ""
echo "========================================="
echo "Step 3: Testing Transaction History"
echo "========================================="
echo "GET /wallet/me/transactions"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -X GET "$API_URL/wallet/me/transactions" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_STATUS" == "200" ]; then
    echo "✅ Transaction history access successful!"
else
    echo "❌ Failed with status $HTTP_STATUS"
fi

echo ""
echo "========================================="
echo "Step 4: Test RBAC - Try Admin Endpoint (Should Fail)"
echo "========================================="
echo "GET /wallet/platform (Admin only)"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -X GET "$API_URL/wallet/platform" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_STATUS" == "403" ]; then
    echo "✅ RBAC working correctly - Driver blocked from admin endpoint!"
elif [ "$HTTP_STATUS" == "200" ]; then
    echo "❌ RBAC FAILURE - Driver accessed admin endpoint!"
else
    echo "⚠️ Unexpected status code"
fi

echo ""
echo "========================================="
echo "📊 Test Summary"
echo "========================================="
echo "Driver authentication and authorization test completed."
echo ""
echo "Next steps:"
echo "1. Test Service account authentication"
echo "2. Test Admin authentication"
echo "3. Test cross-user-type RBAC enforcement"
