#!/bin/bash

echo "🧪 Testing Driver Authentication"
echo "================================"
echo ""
echo "📧 Driver Email: zaidoon.m.alwarash@gmail.com"
echo ""

# Correct Driver Client ID
DRIVER_CLIENT_ID="4dkt45gole08kurh0o43rvk8q7"
DRIVER_EMAIL="zaidoon.m.alwarash@gmail.com"
DRIVER_PASSWORD="Moh@1985"

echo "🔑 Step 1: Getting Driver Token from Cognito..."
DRIVER_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$DRIVER_CLIENT_ID" \
  --auth-parameters "USERNAME=$DRIVER_EMAIL,PASSWORD=$DRIVER_PASSWORD" \
  --region us-east-1 \
  --profile Wizz_dev_UserApp \
  --query 'AuthenticationResult.AccessToken' \
  --output text 2>&1)

if [[ "$DRIVER_TOKEN" =~ ^eyJ ]]; then
  echo "✅ Driver Token obtained successfully!"
  echo "Token: ${DRIVER_TOKEN:0:60}..."
  echo ""
  
  echo "📡 Step 2: Testing /wallet/me endpoint..."
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev/wallet/me \
    -H "Authorization: Bearer $DRIVER_TOKEN")
  
  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')
  
  echo "HTTP Status: $HTTP_CODE"
  echo "Response:"
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
  
else
  echo "❌ Authentication failed!"
  echo "Error: $DRIVER_TOKEN"
fi

echo ""
echo "================================"
echo "✅ Test Complete"
