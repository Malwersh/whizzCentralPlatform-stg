#!/bin/bash
# Simple test for driver wallet access

DRIVER_ID="64f894a8-a001-70fc-ddbd-3ff0dd55c86c"
PASSWORD="TestDriver123!"

echo "Testing wallet access for driver: $DRIVER_ID"

# Get token
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 4dkt45gole08kurh0o43rvk8q7 \
  --auth-parameters "USERNAME=$DRIVER_ID,PASSWORD=$PASSWORD" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --output json > /tmp/auth_response.json

TOKEN=$(cat /tmp/auth_response.json | jq -r '.AuthenticationResult.AccessToken')

echo "Got token: ${TOKEN:0:50}..."
echo ""
echo "Calling GET /wallet/me..."

# Call API
curl -s -X GET \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev/wallet/me" \
  | jq '.'
