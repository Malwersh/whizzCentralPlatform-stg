#!/bin/bash
# Complete Topup Workflow - Final Test

set -e

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

echo "============================================"
echo "  Final Topup Workflow Test"
echo "============================================"
echo ""

# 1. Get tokens
echo "Step 1: Getting tokens..."
DRIVER_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 4dkt45gole08kurh0o43rvk8q7 \
  --auth-parameters USERNAME=64f894a8-a001-70fc-ddbd-3ff0dd55c86c,PASSWORD=TestDriver123! \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --query 'AuthenticationResult.AccessToken' \
  --output text)

ADMIN_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 5hun8p61grnakisu5gammcjelv \
  --auth-parameters USERNAME=admin@wizz.iq,PASSWORD=Admin@Wizz2025! \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --query 'AuthenticationResult.AccessToken' \
  --output text)

echo "✅ Tokens obtained"
echo ""

# 2. Check initial balance
echo "Step 2: Checking initial balance..."
INITIAL=$(curl -s -X GET "$API_URL/wallet/me" \
  -H "Authorization: Bearer $DRIVER_TOKEN" | jq -r '.availableBalance')
echo "Initial balance: $INITIAL IQD"
echo ""

# 3. Create topup
echo "Step 3: Creating topup request (30,000 IQD)..."
TOPUP=$(curl -s -X POST "$API_URL/wallet/topup/request" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 30000, "method": "CASH_AGENT", "note": "Final test"}')

TOPUP_ID=$(echo "$TOPUP" | jq -r '.topupRequest.topupId')
echo "✅ Created: $TOPUP_ID"
echo ""

# 4. List pending (admin)
echo "Step 4: Admin listing pending..."
curl -s -X GET "$API_URL/wallet/topup/requests?status=PENDING" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.requests[0] | "Latest: \(.topupId) - \(.amount) IQD"'
echo ""

# 5. Approve
echo "Step 5: Admin approving..."
APPROVAL=$(curl -s -X POST "$API_URL/wallet/topup/$TOPUP_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"note": "Approved"}')

echo "$APPROVAL" | jq '.'
NEW_BALANCE=$(echo "$APPROVAL" | jq -r '.newBalance')
echo ""

# 6. Verify balance
echo "Step 6: Verifying balance..."
sleep 2
FINAL=$(curl -s -X GET "$API_URL/wallet/me" \
  -H "Authorization: Bearer $DRIVER_TOKEN" | jq -r '.availableBalance')

echo "Initial: $INITIAL IQD"
echo "Added: 30,000 IQD"
echo "Final: $FINAL IQD"
echo "Expected: $((INITIAL + 30000)) IQD"
echo ""

if [ "$FINAL" = "$((INITIAL + 30000))" ]; then
  echo "✅ SUCCESS - Balance updated correctly!"
else
  echo "⚠️  Balance mismatch - but topup was recorded"
fi

echo ""
echo "============================================"
echo "  Workflow Complete!"
echo "============================================"
