#!/bin/bash

# Test wallet creation for existing driver using service account

DRIVER_ID="64f894a8-a001-70fc-ddbd-3ff0dd55c86c"
PHONE="+9640431874668"
API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

# Service account credentials
POOL_ID="us-east-1_VTZMjCvuP"
CLIENT_ID="536kaptb4mttprbravfh9gbbq0"
CLIENT_SECRET="h3d5e14egk2mdvr98ci77h5gjl5lp21d8bits69k8dh9151cee"
USERNAME="order-service-dev"
PASSWORD="Moh@1985#OrderServiceDevSecure2025!"

echo "🧪 Testing Manual Wallet Creation"
echo "=================================="
echo "Driver ID: $DRIVER_ID"
echo "Phone: $PHONE"
echo ""

# Step 1: Calculate SECRET_HASH
echo "1️⃣ Calculating SECRET_HASH..."
SECRET_HASH=$(echo -n "${USERNAME}${CLIENT_ID}" | openssl dgst -sha256 -hmac "$CLIENT_SECRET" -binary | base64)
echo "SECRET_HASH: ${SECRET_HASH:0:20}..."
echo ""

# Step 2: Authenticate as service account
echo "2️⃣ Authenticating as service account..."
AUTH_RESPONSE=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=$USERNAME,PASSWORD=$PASSWORD,SECRET_HASH=$SECRET_HASH" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --output json 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ Authentication failed!"
    echo "$AUTH_RESPONSE"
    exit 1
fi

ACCESS_TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.AuthenticationResult.AccessToken')

if [ "$ACCESS_TOKEN" == "null" ] || [ -z "$ACCESS_TOKEN" ]; then
    echo "❌ Failed to get access token!"
    echo "$AUTH_RESPONSE"
    exit 1
fi

echo "✅ Authenticated! Token: ${ACCESS_TOKEN:0:50}..."
echo ""

# Step 3: Create wallet via API
echo "3️⃣ Creating wallet via Wallet Service API..."
WALLET_RESPONSE=$(curl -s -X POST "$API_URL/wallet/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{
    \"driverId\": \"$DRIVER_ID\",
    \"minRequiredBalance\": 25000
  }")

echo "API Response:"
echo "$WALLET_RESPONSE" | jq '.'
echo ""

# Step 4: Verify wallet in DynamoDB
echo "4️⃣ Verifying wallet in DynamoDB..."
WALLET_ID="WALLET#DRIVER#${DRIVER_ID}"
WALLET_DATA=$(aws dynamodb get-item \
  --table-name dev-Wallets \
  --key "{\"walletId\":{\"S\":\"$WALLET_ID\"},\"sk\":{\"S\":\"META\"}}" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --output json 2>&1)

if echo "$WALLET_DATA" | jq -e '.Item' > /dev/null 2>&1; then
    echo "✅ Wallet found in DynamoDB!"
    echo "$WALLET_DATA" | jq '.Item | {
      walletId: .walletId.S,
      availableBalance: .availableBalance.N,
      lockedBalance: .lockedBalance.N,
      minRequiredBalance: .minRequiredBalance.N,
      status: .status.S,
      createdAt: .createdAt.S
    }'
else
    echo "❌ Wallet not found in DynamoDB!"
    echo "$WALLET_DATA"
fi

echo ""
echo "=================================="
echo "✅ Test Complete!"
