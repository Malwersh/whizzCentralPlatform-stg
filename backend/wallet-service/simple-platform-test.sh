#!/bin/bash

# Simple test for platform wallet GET only

USERNAME="order-service-dev"
PASSWORD="Moh@1985#OrderServiceDevSecure2025!"
CLIENT_ID="536kaptb4mttprbravfh9gbbq0"
CLIENT_SECRET="h3d5e14egk2mdvr98ci77h5gjl5lp21d8bits69k8dh9151cee"

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

echo "Getting platform wallet..."

# Calculate SECRET_HASH
SECRET_HASH=$(echo -n "${USERNAME}${CLIENT_ID}" | openssl dgst -sha256 -hmac "$CLIENT_SECRET" -binary | base64)

# Authenticate
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=$USERNAME,PASSWORD=$PASSWORD,SECRET_HASH=$SECRET_HASH" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --output json > /tmp/service_auth.json

TOKEN=$(cat /tmp/service_auth.json | jq -r '.AuthenticationResult.AccessToken')

echo "Token obtained"
echo ""

# Call API
curl -s -X GET \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "$API_URL/wallet/platform" | jq '.'
