#!/bin/bash

# Test Driver Authentication
echo "🧪 Testing Driver Authentication"
echo "================================"
echo ""

# Driver credentials
DRIVER_EMAIL="zaidoon.m.alwarash@gmail.com"
DRIVER_PASSWORD="Moh@1985"
DRIVER_CLIENT_ID="67m1ot7r74lndohrdl6m22g51f"
API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

echo "📧 Driver Email: $DRIVER_EMAIL"
echo ""

# Step 1: Get Driver Token
echo "🔑 Step 1: Getting Driver Token from Cognito..."
DRIVER_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$DRIVER_CLIENT_ID" \
  --auth-parameters USERNAME="$DRIVER_EMAIL",PASSWORD="$DRIVER_PASSWORD" \
  --region us-east-1 \
  --profile Wizz_dev_UserApp \
  --query 'AuthenticationResult.AccessToken' \
  --output text 2>&1)

# Check if token was obtained
if [[ "$DRIVER_TOKEN" =~ ^eyJ ]]; then
    echo "✅ Token obtained successfully!"
    echo "Token: ${DRIVER_TOKEN:0:60}..."
    echo ""
    
    # Step 2: Test /wallet/me endpoint
    echo "📡 Step 2: Testing /wallet/me endpoint..."
    echo ""
    
    RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
      "$API_URL/wallet/me" \
      -H "Authorization: Bearer $DRIVER_TOKEN" \
      -H "Content-Type: application/json")
    
    HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS:/d')
    
    if [ "$HTTP_STATUS" = "200" ]; then
        echo "✅ SUCCESS! Driver can access their wallet"
        echo "HTTP Status: $HTTP_STATUS"
        echo ""
        echo "Response:"
        echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    else
        echo "❌ FAILED with HTTP $HTTP_STATUS"
        echo "Response: $BODY"
    fi
    
else
    echo "❌ Authentication failed!"
    echo "Error: $DRIVER_TOKEN"
fi

echo ""
echo "================================"
echo "✅ Test Complete"
