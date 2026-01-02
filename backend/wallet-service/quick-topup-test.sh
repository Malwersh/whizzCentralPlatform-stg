#!/bin/bash

# Quick Topup Test

set -e

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

# Get Driver Token
echo "Getting driver token..."
DRIVER_ID="64f894a8-a001-70fc-ddbd-3ff0dd55c86c"
DRIVER_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 4dkt45gole08kurh0o43rvk8q7 \
  --auth-parameters "USERNAME=$DRIVER_ID,PASSWORD=TestDriver123!" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --output json | jq -r '.AuthenticationResult.AccessToken')

echo "Creating topup request..."
TOPUP_RESPONSE=$(curl -s -X POST "$API_URL/wallet/topup/request" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 25000, "method": "CASH_AGENT", "note": "Test topup"}')

echo "Response:"
echo "$TOPUP_RESPONSE"
