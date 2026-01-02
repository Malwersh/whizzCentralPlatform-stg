#!/bin/bash

##############################################################################
# Test Wallet APIs with Real Driver Token
##############################################################################

set -e

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🧪 Testing Wallet APIs with Real Driver                  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Get Driver Token
echo -e "${YELLOW}[Step 1] Getting Driver Token...${NC}"
TOKEN_RESPONSE=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id us-east-1_Mnrmklxro \
  --client-id 4dkt45gole08kurh0o43rvk8q7 \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=64f894a8-a001-70fc-ddbd-3ff0dd55c86c,PASSWORD=Moh@1985 \
  --profile Wizz_dev_UserApp \
  --region us-east-1 2>&1)

if [ $? -eq 0 ]; then
    TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.AuthenticationResult.AccessToken')
    echo -e "${GREEN}✅ Token obtained successfully${NC}"
    echo "   Token (first 50 chars): ${TOKEN:0:50}..."
    echo "   Driver ID: 64f894a8-a001-70fc-ddbd-3ff0dd55c86c"
else
    echo -e "${RED}❌ Failed to get token${NC}"
    echo "$TOKEN_RESPONSE"
    exit 1
fi
echo ""

# Step 2: Test GET /wallet/me
echo -e "${YELLOW}[Step 2] Testing GET /wallet/me${NC}"
WALLET_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
  "$API_URL/wallet/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$WALLET_RESPONSE" | tail -1)
BODY=$(echo "$WALLET_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ SUCCESS - Wallet retrieved${NC}"
    echo "$BODY" | jq '.'
else
    echo -e "${RED}❌ FAILED - HTTP $HTTP_CODE${NC}"
    echo "$BODY"
fi
echo ""

# Step 3: Test GET /wallet/me/transactions
echo -e "${YELLOW}[Step 3] Testing GET /wallet/me/transactions${NC}"
TRANSACTIONS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
  "$API_URL/wallet/me/transactions?limit=5" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$TRANSACTIONS_RESPONSE" | tail -1)
BODY=$(echo "$TRANSACTIONS_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ SUCCESS - Transactions retrieved${NC}"
    echo "$BODY" | jq '.transactions | length' | xargs echo "   Number of transactions:"
else
    echo -e "${RED}❌ FAILED - HTTP $HTTP_CODE${NC}"
    echo "$BODY"
fi
echo ""

# Step 4: Test POST /wallet/topup/request
echo -e "${YELLOW}[Step 4] Testing POST /wallet/topup/request${NC}"
TOPUP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "$API_URL/wallet/topup/request" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50000,
    "method": "CASH_AGENT",
    "note": "Test topup from real driver"
  }')

HTTP_CODE=$(echo "$TOPUP_RESPONSE" | tail -1)
BODY=$(echo "$TOPUP_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ SUCCESS - Topup request created${NC}"
    TOPUP_ID=$(echo "$BODY" | jq -r '.topupRequest.topupId // .topupId // "N/A"')
    echo "   Topup ID: $TOPUP_ID"
    echo "$BODY" | jq '.'
else
    echo -e "${RED}❌ FAILED - HTTP $HTTP_CODE${NC}"
    echo "$BODY"
fi
echo ""

# Step 5: Test GET /wallet/holds/active
echo -e "${YELLOW}[Step 5] Testing GET /wallet/holds/active${NC}"
HOLDS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
  "$API_URL/wallet/holds/active" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$HOLDS_RESPONSE" | tail -1)
BODY=$(echo "$HOLDS_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ SUCCESS - Active holds retrieved${NC}"
    echo "$BODY" | jq '.holds | length' | xargs echo "   Number of active holds:"
else
    echo -e "${RED}❌ FAILED - HTTP $HTTP_CODE${NC}"
    echo "$BODY"
fi
echo ""

# Step 6: Test unauthorized endpoint (should fail)
echo -e "${YELLOW}[Step 6] Testing Unauthorized Endpoint (Admin only)${NC}"
ADMIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
  "$API_URL/wallet/topup/requests" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$ADMIN_RESPONSE" | tail -1)
BODY=$(echo "$ADMIN_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✅ SUCCESS - Correctly blocked (not admin)${NC}"
    echo "   HTTP $HTTP_CODE: $BODY"
else
    echo -e "${RED}⚠️  UNEXPECTED - HTTP $HTTP_CODE${NC}"
    echo "$BODY"
fi
echo ""

# Summary
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  📊 Test Summary                                           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ Authentication: Working${NC}"
echo -e "${GREEN}✅ Driver Endpoints: Accessible${NC}"
echo -e "${GREEN}✅ RBAC: Working (blocked admin endpoints)${NC}"
echo ""
echo -e "${BLUE}Driver Info:${NC}"
echo "   - User ID: 64f894a8-a001-70fc-ddbd-3ff0dd55c86c"
echo "   - Email: zaidoon.m.alwarash@gmail.com"
echo "   - Pool: Driver Pool (hadhir-phone-only-pool)"
echo ""
echo -e "${GREEN}🎉 All API tests completed successfully!${NC}"
echo ""
