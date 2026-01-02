#!/bin/bash
API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
DRIVER_EMAIL="zaidoon.m.alwarash@gmail.com"
DRIVER_PASSWORD="Moh@1985"
USER_POOL_ID="us-east-1_Mnrmklxro"
CLIENT_ID="4dkt45gole08kurh0o43rvk8q7"

echo "🔑 Getting Token..."
aws cognito-idp admin-initiate-auth --user-pool-id $USER_POOL_ID --client-id $CLIENT_ID --auth-flow ADMIN_NO_SRP_AUTH --auth-parameters USERNAME=$DRIVER_EMAIL,PASSWORD=$DRIVER_PASSWORD --profile Wizz_dev_UserApp --region us-east-1 > /tmp/auth.json

ACCESS_TOKEN=$(cat /tmp/auth.json | jq -r '.AuthenticationResult.AccessToken')
echo "Token obtained: ${ACCESS_TOKEN:0:50}..."
echo ""

echo "Testing GET /wallet/me..."
curl -X GET "$API_URL/wallet/me" -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.'
