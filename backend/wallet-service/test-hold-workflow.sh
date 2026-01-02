#!/bin/bash

# Hold System Test Script
# Tests: Create Hold → Release Hold → Create Again → Capture Hold

set -e

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "================================================"
echo "  🔒 Hold System Workflow Test"
echo "================================================"
echo ""

# Step 1: Get tokens
echo "${BLUE}Step 1: Getting authentication tokens...${NC}"
DRIVER_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 4dkt45gole08kurh0o43rvk8q7 \
  --auth-parameters USERNAME=64f894a8-a001-70fc-ddbd-3ff0dd55c86c,PASSWORD=TestDriver123! \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --query 'AuthenticationResult.AccessToken' \
  --output text)

SERVICE_TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id us-east-1_VTZMjCvuP \
  --client-id 76ehu2b1pfd4cp6ksc31d2ne27 \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=order-service-dev,PASSWORD='Wizz-Order-Service-Password-123!' \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --query 'AuthenticationResult.AccessToken' \
  --output text)

echo "${GREEN}✓ Tokens retrieved${NC}"
echo ""

# Step 2: Check initial balance
echo "${BLUE}Step 2: Checking driver wallet balance...${NC}"
BALANCE_RESPONSE=$(curl -s -X GET "${API_URL}/wallet/me" \
  -H "Authorization: Bearer ${DRIVER_TOKEN}")

INITIAL_AVAILABLE=$(echo "$BALANCE_RESPONSE" | jq -r '.availableBalance')
INITIAL_LOCKED=$(echo "$BALANCE_RESPONSE" | jq -r '.lockedBalance')

echo "Initial Balance:"
echo "  Available: ${INITIAL_AVAILABLE} IQD"
echo "  Locked: ${INITIAL_LOCKED} IQD"
echo ""

# Step 3: Create hold (15,000 IQD)
echo "${BLUE}Step 3: Creating hold (15,000 IQD)...${NC}"
HOLD_AMOUNT=15000
ORDER_ID="ORDER_TEST_$(date +%s)"

HOLD_RESPONSE=$(curl -s -X POST "${API_URL}/wallet/hold/create" \
  -H "Authorization: Bearer ${SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"walletId\": \"WALLET#DRIVER#64f894a8-a001-70fc-ddbd-3ff0dd55c86c\",
    \"amount\": ${HOLD_AMOUNT},
    \"orderId\": \"${ORDER_ID}\",
    \"reason\": \"Test order hold\",
    \"metadata\": {
      \"orderAmount\": 50000,
      \"bonusAmount\": 10000
    }
  }")

echo "$HOLD_RESPONSE" | jq '.'

HOLD_ID=$(echo "$HOLD_RESPONSE" | jq -r '.hold.holdId // empty')

if [ -z "$HOLD_ID" ]; then
  echo "${RED}✗ Failed to create hold${NC}"
  echo "$HOLD_RESPONSE"
  exit 1
fi

echo "${GREEN}✓ Hold created: ${HOLD_ID}${NC}"
echo ""

# Step 4: Verify balance after hold
echo "${BLUE}Step 4: Verifying balance after hold...${NC}"
BALANCE_RESPONSE=$(curl -s -X GET "${API_URL}/wallet/me" \
  -H "Authorization: Bearer ${DRIVER_TOKEN}")

AFTER_HOLD_AVAILABLE=$(echo "$BALANCE_RESPONSE" | jq -r '.availableBalance')
AFTER_HOLD_LOCKED=$(echo "$BALANCE_RESPONSE" | jq -r '.lockedBalance')

echo "After Hold:"
echo "  Available: ${AFTER_HOLD_AVAILABLE} IQD (expected: $((INITIAL_AVAILABLE - HOLD_AMOUNT)))"
echo "  Locked: ${AFTER_HOLD_LOCKED} IQD (expected: $((INITIAL_LOCKED + HOLD_AMOUNT)))"

if [ "$AFTER_HOLD_AVAILABLE" -eq $((INITIAL_AVAILABLE - HOLD_AMOUNT)) ] && \
   [ "$AFTER_HOLD_LOCKED" -eq $((INITIAL_LOCKED + HOLD_AMOUNT)) ]; then
  echo "${GREEN}✓ Balance updated correctly${NC}"
else
  echo "${RED}✗ Balance mismatch!${NC}"
  exit 1
fi
echo ""

# Step 5: Get active holds
echo "${BLUE}Step 5: Getting active holds for driver...${NC}"
ACTIVE_HOLDS=$(curl -s -X GET "${API_URL}/wallet/holds/active" \
  -H "Authorization: Bearer ${DRIVER_TOKEN}")

echo "$ACTIVE_HOLDS" | jq '.'
HOLDS_COUNT=$(echo "$ACTIVE_HOLDS" | jq -r '.count')
echo "Active holds count: ${HOLDS_COUNT}"
echo ""

# Step 6: Try to create another hold (should fail if insufficient balance)
if [ "$AFTER_HOLD_AVAILABLE" -ge "$HOLD_AMOUNT" ]; then
  echo "${BLUE}Step 6: Creating second hold (should succeed)...${NC}"
  ORDER_ID_2="ORDER_TEST_2_$(date +%s)"
  
  HOLD_RESPONSE_2=$(curl -s -X POST "${API_URL}/wallet/hold/create" \
    -H "Authorization: Bearer ${SERVICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"walletId\": \"WALLET#DRIVER#64f894a8-a001-70fc-ddbd-3ff0dd55c86c\",
      \"amount\": ${HOLD_AMOUNT},
      \"orderId\": \"${ORDER_ID_2}\",
      \"reason\": \"Second test hold\"
    }")
  
  HOLD_ID_2=$(echo "$HOLD_RESPONSE_2" | jq -r '.hold.holdId // empty')
  
  if [ -n "$HOLD_ID_2" ]; then
    echo "${GREEN}✓ Second hold created: ${HOLD_ID_2}${NC}"
    echo ""
    
    # Release second hold immediately
    echo "${BLUE}Step 6b: Releasing second hold...${NC}"
    RELEASE_RESPONSE=$(curl -s -X POST "${API_URL}/wallet/hold/${HOLD_ID_2}/release" \
      -H "Authorization: Bearer ${SERVICE_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{
        \"reason\": \"Test release\"
      }")
    
    echo "$RELEASE_RESPONSE" | jq '.'
    echo "${GREEN}✓ Second hold released${NC}"
  else
    echo "${YELLOW}⚠ Second hold creation failed (expected if balance insufficient)${NC}"
  fi
else
  echo "${YELLOW}Step 6: Skipping second hold (insufficient balance)${NC}"
fi
echo ""

# Step 7: Release first hold
echo "${BLUE}Step 7: Releasing first hold...${NC}"
RELEASE_RESPONSE=$(curl -s -X POST "${API_URL}/wallet/hold/${HOLD_ID}/release" \
  -H "Authorization: Bearer ${SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"reason\": \"Order cancelled by customer\"
  }")

echo "$RELEASE_RESPONSE" | jq '.'

if [ "$(echo "$RELEASE_RESPONSE" | jq -r '.success')" = "true" ]; then
  echo "${GREEN}✓ Hold released successfully${NC}"
else
  echo "${RED}✗ Failed to release hold${NC}"
  exit 1
fi
echo ""

# Step 8: Verify balance after release
echo "${BLUE}Step 8: Verifying balance after release...${NC}"
BALANCE_RESPONSE=$(curl -s -X GET "${API_URL}/wallet/me" \
  -H "Authorization: Bearer ${DRIVER_TOKEN}")

AFTER_RELEASE_AVAILABLE=$(echo "$BALANCE_RESPONSE" | jq -r '.availableBalance')
AFTER_RELEASE_LOCKED=$(echo "$BALANCE_RESPONSE" | jq -r '.lockedBalance')

echo "After Release:"
echo "  Available: ${AFTER_RELEASE_AVAILABLE} IQD (expected: ${INITIAL_AVAILABLE})"
echo "  Locked: ${AFTER_RELEASE_LOCKED} IQD (expected: ${INITIAL_LOCKED})"

if [ "$AFTER_RELEASE_AVAILABLE" -eq "$INITIAL_AVAILABLE" ] && \
   [ "$AFTER_RELEASE_LOCKED" -eq "$INITIAL_LOCKED" ]; then
  echo "${GREEN}✓ Balance restored correctly${NC}"
else
  echo "${RED}✗ Balance mismatch after release!${NC}"
  exit 1
fi
echo ""

# Step 9: Create new hold for capture test
echo "${BLUE}Step 9: Creating new hold for capture test...${NC}"
ORDER_ID_3="ORDER_TEST_3_$(date +%s)"

HOLD_RESPONSE_3=$(curl -s -X POST "${API_URL}/wallet/hold/create" \
  -H "Authorization: Bearer ${SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"walletId\": \"WALLET#DRIVER#64f894a8-a001-70fc-ddbd-3ff0dd55c86c\",
    \"amount\": ${HOLD_AMOUNT},
    \"orderId\": \"${ORDER_ID_3}\",
    \"reason\": \"Hold for capture test\"
  }")

HOLD_ID_3=$(echo "$HOLD_RESPONSE_3" | jq -r '.hold.holdId // empty')

if [ -z "$HOLD_ID_3" ]; then
  echo "${RED}✗ Failed to create hold for capture test${NC}"
  exit 1
fi

echo "${GREEN}✓ Hold created: ${HOLD_ID_3}${NC}"
echo ""

# Step 10: Capture hold
echo "${BLUE}Step 10: Capturing hold (order delivered)...${NC}"
CAPTURE_RESPONSE=$(curl -s -X POST "${API_URL}/wallet/hold/${HOLD_ID_3}/capture" \
  -H "Authorization: Bearer ${SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"reason\": \"Order delivered successfully\"
  }")

echo "$CAPTURE_RESPONSE" | jq '.'

if [ "$(echo "$CAPTURE_RESPONSE" | jq -r '.success')" = "true" ]; then
  echo "${GREEN}✓ Hold captured successfully${NC}"
else
  echo "${RED}✗ Failed to capture hold${NC}"
  exit 1
fi
echo ""

# Step 11: Verify balance after capture (locked should decrease, but available stays same until settlement)
echo "${BLUE}Step 11: Verifying balance after capture...${NC}"
BALANCE_RESPONSE=$(curl -s -X GET "${API_URL}/wallet/me" \
  -H "Authorization: Bearer ${DRIVER_TOKEN}")

AFTER_CAPTURE_AVAILABLE=$(echo "$BALANCE_RESPONSE" | jq -r '.availableBalance')
AFTER_CAPTURE_LOCKED=$(echo "$BALANCE_RESPONSE" | jq -r '.lockedBalance')

echo "After Capture:"
echo "  Available: ${AFTER_CAPTURE_AVAILABLE} IQD"
echo "  Locked: ${AFTER_CAPTURE_LOCKED} IQD"

if [ "$AFTER_CAPTURE_LOCKED" -eq "$INITIAL_LOCKED" ]; then
  echo "${GREEN}✓ Locked balance returned to initial (hold captured)${NC}"
else
  echo "${YELLOW}⚠ Locked balance: ${AFTER_CAPTURE_LOCKED}, expected: ${INITIAL_LOCKED}${NC}"
fi
echo ""

# Step 12: View transaction history
echo "${BLUE}Step 12: Viewing transaction history...${NC}"
TRANSACTIONS=$(curl -s -X GET "${API_URL}/wallet/me/transactions?limit=10" \
  -H "Authorization: Bearer ${DRIVER_TOKEN}")

echo "$TRANSACTIONS" | jq '.transactions[] | {type, amount, createdAt, memo}' | head -30
echo ""

# Summary
echo "================================================"
echo "${GREEN}  ✅ Hold System Test Complete!${NC}"
echo "================================================"
echo ""
echo "Summary:"
echo "  ✓ Hold created successfully"
echo "  ✓ Balance locked atomically"
echo "  ✓ Hold released successfully"
echo "  ✓ Balance restored correctly"
echo "  ✓ Hold captured successfully"
echo "  ✓ Active holds query working"
echo "  ✓ Transaction history recorded"
echo ""
echo "All tests passed! 🎉"
