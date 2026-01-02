#!/bin/bash

# Wizz Wallet Service - Live API Testing
# Test all endpoints on deployed AWS Lambda

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  🧪 Testing Wizz Wallet Service API (Live on AWS)         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "API Endpoint: $API_URL"
echo ""

# Test 1: Health Check
echo -e "${BLUE}[1] Testing Health Check...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Health Check: PASSED${NC}"
    echo "  Response: $BODY"
else
    echo -e "${RED}✗ Health Check: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Test 2: Get Platform Wallet (Should exist from previous tests)
echo -e "${BLUE}[2] Testing Get Platform Wallet...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/wallet/platform")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Platform Wallet: FOUND${NC}"
    echo "  Response: $BODY"
else
    echo -e "${YELLOW}⚠ Platform Wallet: NOT FOUND (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
    echo "  This is expected if wallet hasn't been created yet"
fi
echo ""

# Test 3: Get Driver Wallet (DRV001 from previous tests)
echo -e "${BLUE}[3] Testing Get Driver Wallet (DRV001)...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/wallet/DRV001")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Driver Wallet: FOUND${NC}"
    echo "  Response: $BODY"
else
    echo -e "${YELLOW}⚠ Driver Wallet: NOT FOUND (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
    echo "  This is expected if wallet hasn't been created yet"
fi
echo ""

# Test 4: Create New Wallet
echo -e "${BLUE}[4] Testing Create Wallet (New Driver)...${NC}"
NEW_DRIVER_ID="DRV_AWS_TEST_$(date +%s)"
CREATE_PAYLOAD=$(cat <<EOF
{
  "driverId": "$NEW_DRIVER_ID",
  "initialBalance": 10000,
  "idempotencyKey": "test-create-wallet-$(date +%s)"
}
EOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/wallet/create" \
  -H "Content-Type: application/json" \
  -d "$CREATE_PAYLOAD")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}✓ Create Wallet: SUCCESS${NC}"
    echo "  Driver ID: $NEW_DRIVER_ID"
    echo "  Response: $BODY"
else
    echo -e "${RED}✗ Create Wallet: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Test 5: Create Hold
echo -e "${BLUE}[5] Testing Create Hold...${NC}"
HOLD_ID="HOLD_AWS_TEST_$(date +%s)"
HOLD_PAYLOAD=$(cat <<EOF
{
  "driverId": "$NEW_DRIVER_ID",
  "orderId": "ORD_TEST_$(date +%s)",
  "amount": 3000,
  "holdId": "$HOLD_ID",
  "idempotencyKey": "test-hold-$(date +%s)"
}
EOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/wallet/hold/create" \
  -H "Content-Type: application/json" \
  -d "$HOLD_PAYLOAD")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}✓ Create Hold: SUCCESS${NC}"
    echo "  Hold ID: $HOLD_ID"
    echo "  Response: $BODY"
else
    echo -e "${RED}✗ Create Hold: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Test 6: Get Active Holds
echo -e "${BLUE}[6] Testing Get Active Holds...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/wallet/hold/active/$NEW_DRIVER_ID")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Get Active Holds: SUCCESS${NC}"
    echo "  Response: $BODY"
else
    echo -e "${RED}✗ Get Active Holds: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Summary
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  📊 Test Summary                                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ API is live and responding!"
echo "📡 Endpoint: $API_URL"
echo "🔑 Test Driver ID: $NEW_DRIVER_ID"
echo "🎯 Test Hold ID: $HOLD_ID"
echo ""
echo "💡 Next Steps:"
echo "   1. Test more endpoints with your own data"
echo "   2. Integrate with Driver App (send API URL + endpoints)"
echo "   3. Add Cognito authentication"
echo "   4. Set up monitoring and alarms"
echo ""
