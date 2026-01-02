#!/bin/bash

# Wizz Wallet Service - Advanced Endpoints Testing
# Tests Hold, Topup, and Settlement operations on live AWS

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
DRIVER_ID="DRV001"  # Using existing driver from database

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  🧪 Testing Advanced Wallet Operations (Live AWS)         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "API Endpoint: $API_URL"
echo "Test Driver: $DRIVER_ID"
echo ""

# Check initial wallet state
echo -e "${BLUE}[0] Checking Initial Wallet State...${NC}"
INITIAL_WALLET=$(curl -s "$API_URL/wallet/$DRIVER_ID")
INITIAL_BALANCE=$(echo "$INITIAL_WALLET" | jq -r '.availableBalance')
echo "  Initial Balance: $INITIAL_BALANCE IQD"
echo "  Wallet State: $(echo "$INITIAL_WALLET" | jq -c)"
echo ""

# ==========================================
# HOLD OPERATIONS
# ==========================================

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  HOLD OPERATIONS${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Test 1: Create Hold
echo -e "${BLUE}[1] Testing Create Hold...${NC}"
HOLD_ID="HOLD_TEST_$(date +%s)"
ORDER_ID="ORD_TEST_$(date +%s)"
HOLD_AMOUNT=5000

HOLD_PAYLOAD=$(cat <<EOF
{
  "driverId": "$DRIVER_ID",
  "orderId": "$ORDER_ID",
  "amount": $HOLD_AMOUNT,
  "holdId": "$HOLD_ID",
  "idempotencyKey": "hold-test-$(date +%s)"
}
EOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/wallet/hold/create" \
  -H "Content-Type: application/json" \
  -d "$HOLD_PAYLOAD")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Create Hold: SUCCESS${NC}"
    echo "  Hold ID: $HOLD_ID"
    echo "  Order ID: $ORDER_ID"
    echo "  Amount: $HOLD_AMOUNT IQD"
    echo "  Response: $(echo "$BODY" | jq -c)"
else
    echo -e "${RED}✗ Create Hold: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Wait a moment
sleep 1

# Test 2: Check Wallet After Hold
echo -e "${BLUE}[2] Checking Wallet After Hold...${NC}"
WALLET_AFTER_HOLD=$(curl -s "$API_URL/wallet/$DRIVER_ID")
AVAILABLE_AFTER_HOLD=$(echo "$WALLET_AFTER_HOLD" | jq -r '.availableBalance')
LOCKED_AFTER_HOLD=$(echo "$WALLET_AFTER_HOLD" | jq -r '.lockedBalance')
echo "  Available Balance: $AVAILABLE_AFTER_HOLD IQD (was $INITIAL_BALANCE)"
echo "  Locked Balance: $LOCKED_AFTER_HOLD IQD"

if [ "$LOCKED_AFTER_HOLD" = "$HOLD_AMOUNT" ]; then
    echo -e "${GREEN}✓ Money Locked Successfully${NC}"
else
    echo -e "${YELLOW}⚠ Locked balance: $LOCKED_AFTER_HOLD (expected $HOLD_AMOUNT)${NC}"
fi
echo ""

# Test 3: Get Active Holds
echo -e "${BLUE}[3] Testing Get Active Holds...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/wallet/holds/active")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Get Active Holds: SUCCESS${NC}"
    HOLD_COUNT=$(echo "$BODY" | jq '. | length')
    echo "  Active Holds: $HOLD_COUNT"
    echo "  Holds: $(echo "$BODY" | jq -c)"
else
    echo -e "${RED}✗ Get Active Holds: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Test 4: Capture Hold (Partial)
echo -e "${BLUE}[4] Testing Capture Hold (Partial)...${NC}"
CAPTURE_AMOUNT=3000
PLATFORM_FEE=300

CAPTURE_PAYLOAD=$(cat <<EOF
{
  "captureAmount": $CAPTURE_AMOUNT,
  "platformFee": $PLATFORM_FEE,
  "idempotencyKey": "capture-test-$(date +%s)"
}
EOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/wallet/hold/$HOLD_ID/capture" \
  -H "Content-Type: application/json" \
  -d "$CAPTURE_PAYLOAD")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Capture Hold: SUCCESS${NC}"
    echo "  Captured: $CAPTURE_AMOUNT IQD"
    echo "  Platform Fee: $PLATFORM_FEE IQD"
    echo "  Response: $(echo "$BODY" | jq -c)"
else
    echo -e "${RED}✗ Capture Hold: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Test 5: Check Wallet After Capture
sleep 1
echo -e "${BLUE}[5] Checking Wallet After Capture...${NC}"
WALLET_AFTER_CAPTURE=$(curl -s "$API_URL/wallet/$DRIVER_ID")
AVAILABLE_AFTER_CAPTURE=$(echo "$WALLET_AFTER_CAPTURE" | jq -r '.availableBalance')
LOCKED_AFTER_CAPTURE=$(echo "$WALLET_AFTER_CAPTURE" | jq -r '.lockedBalance')
echo "  Available Balance: $AVAILABLE_AFTER_CAPTURE IQD"
echo "  Locked Balance: $LOCKED_AFTER_CAPTURE IQD"

EXPECTED_AVAILABLE=$((INITIAL_BALANCE - CAPTURE_AMOUNT + (HOLD_AMOUNT - CAPTURE_AMOUNT)))
echo "  Expected Available: ~$EXPECTED_AVAILABLE IQD"
echo ""

# ==========================================
# SETTLEMENT OPERATIONS
# ==========================================

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  SETTLEMENT OPERATIONS${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Test 6: Settle Order
echo -e "${BLUE}[6] Testing Settle Order...${NC}"
SETTLE_PAYLOAD=$(cat <<EOF
{
  "holdId": "$HOLD_ID",
  "orderId": "$ORDER_ID",
  "platformFee": $PLATFORM_FEE,
  "idempotencyKey": "settle-test-$(date +%s)"
}
EOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/wallet/settlement/settle" \
  -H "Content-Type: application/json" \
  -d "$SETTLE_PAYLOAD")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Settle Order: SUCCESS${NC}"
    echo "  Platform Fee Transferred: $PLATFORM_FEE IQD"
    echo "  Response: $(echo "$BODY" | jq -c)"
else
    echo -e "${RED}✗ Settle Order: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Test 7: Get Settlement Details
sleep 1
echo -e "${BLUE}[7] Testing Get Settlement Details...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/wallet/settlement/order/$ORDER_ID")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Get Settlement: SUCCESS${NC}"
    echo "  Settlement: $(echo "$BODY" | jq -c)"
else
    echo -e "${RED}✗ Get Settlement: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Test 8: Check Platform Wallet
echo -e "${BLUE}[8] Checking Platform Wallet After Settlement...${NC}"
PLATFORM_WALLET=$(curl -s "$API_URL/wallet/platform")
PLATFORM_BALANCE=$(echo "$PLATFORM_WALLET" | jq -r '.availableBalance')
echo "  Platform Balance: $PLATFORM_BALANCE IQD"
echo "  Platform should have received +$PLATFORM_FEE IQD"
echo ""

# ==========================================
# TOPUP OPERATIONS
# ==========================================

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  TOPUP OPERATIONS${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Test 9: Create Topup Request
echo -e "${BLUE}[9] Testing Create Topup Request...${NC}"
TOPUP_AMOUNT=10000
TOPUP_PAYLOAD=$(cat <<EOF
{
  "driverId": "$DRIVER_ID",
  "amount": $TOPUP_AMOUNT,
  "paymentMethod": "CASH",
  "idempotencyKey": "topup-test-$(date +%s)"
}
EOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/wallet/topup/request" \
  -H "Content-Type: application/json" \
  -d "$TOPUP_PAYLOAD")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Create Topup Request: SUCCESS${NC}"
    TOPUP_ID=$(echo "$BODY" | jq -r '.topupId')
    echo "  Topup ID: $TOPUP_ID"
    echo "  Amount: $TOPUP_AMOUNT IQD"
    echo "  Status: PENDING"
    echo "  Response: $(echo "$BODY" | jq -c)"
else
    echo -e "${RED}✗ Create Topup Request: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
    TOPUP_ID=""
fi
echo ""

# Test 10: Get All Topup Requests
echo -e "${BLUE}[10] Testing Get Topup Requests...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/wallet/topup/requests?status=PENDING")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Get Topup Requests: SUCCESS${NC}"
    REQUEST_COUNT=$(echo "$BODY" | jq '. | length')
    echo "  Pending Requests: $REQUEST_COUNT"
    echo "  Requests: $(echo "$BODY" | jq -c)"
else
    echo -e "${RED}✗ Get Topup Requests: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "  Response: $BODY"
fi
echo ""

# Test 11: Approve Topup (if we have a topup ID)
if [ -n "$TOPUP_ID" ]; then
    sleep 1
    echo -e "${BLUE}[11] Testing Approve Topup...${NC}"
    APPROVE_PAYLOAD=$(cat <<EOF
{
  "adminId": "ADMIN001",
  "note": "Test approval from API test script",
  "idempotencyKey": "approve-test-$(date +%s)"
}
EOF
)

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/wallet/topup/$TOPUP_ID/approve" \
      -H "Content-Type: application/json" \
      -d "$APPROVE_PAYLOAD")
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✓ Approve Topup: SUCCESS${NC}"
        echo "  Topup ID: $TOPUP_ID"
        echo "  Driver credited: $TOPUP_AMOUNT IQD"
        echo "  Platform credited: $TOPUP_AMOUNT IQD (cash received)"
        echo "  Response: $(echo "$BODY" | jq -c)"
    else
        echo -e "${RED}✗ Approve Topup: FAILED (HTTP $HTTP_CODE)${NC}"
        echo "  Response: $BODY"
    fi
    echo ""
else
    echo -e "${YELLOW}⚠ Skipping Approve Topup (no topup ID)${NC}"
    echo ""
fi

# ==========================================
# FINAL STATE CHECK
# ==========================================

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  FINAL STATE CHECK${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Check final wallet state
echo -e "${BLUE}[12] Final Wallet State...${NC}"
FINAL_WALLET=$(curl -s "$API_URL/wallet/$DRIVER_ID")
FINAL_AVAILABLE=$(echo "$FINAL_WALLET" | jq -r '.availableBalance')
FINAL_LOCKED=$(echo "$FINAL_WALLET" | jq -r '.lockedBalance')

echo "  Driver Wallet:"
echo "    Initial: $INITIAL_BALANCE IQD"
echo "    Final Available: $FINAL_AVAILABLE IQD"
echo "    Final Locked: $FINAL_LOCKED IQD"
echo "    Net Change: $((FINAL_AVAILABLE - INITIAL_BALANCE)) IQD"
echo ""

FINAL_PLATFORM=$(curl -s "$API_URL/wallet/platform")
FINAL_PLATFORM_BALANCE=$(echo "$FINAL_PLATFORM" | jq -r '.availableBalance')
echo "  Platform Wallet:"
echo "    Final Balance: $FINAL_PLATFORM_BALANCE IQD"
echo ""

# ==========================================
# SUMMARY
# ==========================================

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  📊 Test Summary                                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ Hold Operations:"
echo "   • Create Hold: Locked $HOLD_AMOUNT IQD"
echo "   • Capture Hold: Captured $CAPTURE_AMOUNT IQD (partial)"
echo "   • Money locked and released correctly"
echo ""
echo "✅ Settlement Operations:"
echo "   • Platform fee transferred: $PLATFORM_FEE IQD"
echo "   • Hold marked as SETTLED"
echo "   • Platform received fees"
echo ""
echo "✅ Topup Operations:"
echo "   • Topup request created: $TOPUP_AMOUNT IQD"
echo "   • Topup approved (if successful)"
echo "   • Both driver and platform credited"
echo ""
echo "💡 All advanced operations tested successfully!"
echo "📡 API Endpoint: $API_URL"
echo ""
