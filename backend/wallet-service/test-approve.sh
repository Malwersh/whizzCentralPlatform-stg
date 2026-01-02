#!/bin/bash
# Test approve manually

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
TOPUP_ID="TOPUP#1766192702319#dfec31a8"

# Get admin token
ADMIN_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 5hun8p61grnakisu5gammcjelv \
  --auth-parameters "USERNAME=admin@wizz.iq,PASSWORD=Admin@Wizz2025!" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --output json | jq -r '.AuthenticationResult.AccessToken')

echo "Approving $TOPUP_ID..."
curl -X POST "$API_URL/wallet/topup/$TOPUP_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"note": "Test approval"}' | jq '.'
