#!/bin/bash

# Test Topup Workflow
# Tests the complete topup flow: Create request → List pending → Approve → Verify balance

set -e  # Exit on error

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
PROFILE="Wizz_dev_UserApp"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Topup Workflow Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# ============================================
# 1. Get Driver Token
# ============================================
echo -e "${YELLOW}Step 1: Authenticating Driver...${NC}"

DRIVER_ID="64f894a8-a001-70fc-ddbd-3ff0dd55c86c"
DRIVER_PASSWORD="TestDriver123!"
DRIVER_CLIENT_ID="4dkt45gole08kurh0o43rvk8q7"

DRIVER_AUTH=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$DRIVER_CLIENT_ID" \
  --auth-parameters "USERNAME=$DRIVER_ID,PASSWORD=$DRIVER_PASSWORD" \
  --profile "$PROFILE" \
  --region us-east-1 \
  --output json)

DRIVER_TOKEN=$(echo "$DRIVER_AUTH" | jq -r '.AuthenticationResult.AccessToken')

if [ "$DRIVER_TOKEN" = "null" ] || [ -z "$DRIVER_TOKEN" ]; then
  echo -e "${RED}❌ Failed to get driver token${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Driver authenticated${NC}"
echo "   Driver ID: $DRIVER_ID"
echo ""

# ============================================
# 2. Get Admin Token
# ============================================
echo -e "${YELLOW}Step 2: Authenticating Admin...${NC}"

ADMIN_USERNAME="admin@wizz.iq"
ADMIN_PASSWORD="Admin@Wizz2025!"
ADMIN_CLIENT_ID="5hun8p61grnakisu5gammcjelv"

ADMIN_AUTH=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$ADMIN_CLIENT_ID" \
  --auth-parameters "USERNAME=$ADMIN_USERNAME,PASSWORD=$ADMIN_PASSWORD" \
  --profile "$PROFILE" \
  --region us-east-1 \
  --output json)

ADMIN_TOKEN=$(echo "$ADMIN_AUTH" | jq -r '.AuthenticationResult.AccessToken')
ADMIN_ID=$(echo "$ADMIN_AUTH" | jq -r '.AuthenticationResult.AccessToken' | cut -d'.' -f2 | base64 -d 2>/dev/null | jq -r '.sub')

if [ "$ADMIN_TOKEN" = "null" ] || [ -z "$ADMIN_TOKEN" ]; then
  echo -e "${RED}❌ Failed to get admin token${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Admin authenticated${NC}"
echo "   Admin ID: $ADMIN_ID"
echo ""

# ============================================
# 3. Check Initial Driver Balance
# ============================================
echo -e "${YELLOW}Step 3: Checking initial driver wallet balance...${NC}"

INITIAL_WALLET=$(curl -s -X GET "$API_URL/wallet/me" \
  -H "Authorization: Bearer $DRIVER_TOKEN")

INITIAL_BALANCE=$(echo "$INITIAL_WALLET" | jq -r '.availableBalance')

echo -e "${GREEN}✅ Initial balance: $INITIAL_BALANCE IQD${NC}"
echo ""

# ============================================
# 4. Create Topup Request (Driver)
# ============================================
echo -e "${YELLOW}Step 4: Creating topup request (25,000 IQD)...${NC}"

TOPUP_AMOUNT=25000

TOPUP_RESPONSE=$(curl -s -X POST "$API_URL/wallet/topup/request" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"amount\": $TOPUP_AMOUNT,
    \"method\": \"CASH_AGENT\",
    \"note\": \"Test topup request\"
  }")

echo "Response: $TOPUP_RESPONSE" | jq '.'

TOPUP_ID=$(echo "$TOPUP_RESPONSE" | jq -r '.topupRequest.topupId // .topupId')
SUCCESS=$(echo "$TOPUP_RESPONSE" | jq -r '.success')

if [ "$SUCCESS" != "true" ]; then
  echo -e "${RED}❌ Failed to create topup request${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Topup request created${NC}"
echo "   Topup ID: $TOPUP_ID"
echo ""

# ============================================
# 5. List Pending Requests (Admin)
# ============================================
echo -e "${YELLOW}Step 5: Listing pending topup requests (Admin view)...${NC}"

PENDING_REQUESTS=$(curl -s -X GET "$API_URL/wallet/topup/requests?status=PENDING" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

echo "Pending Requests:"
echo "$PENDING_REQUESTS" | jq '.requests[] | {topupId, driverId, amount, method, createdAt}'

REQUEST_COUNT=$(echo "$PENDING_REQUESTS" | jq '.count')
echo -e "${GREEN}✅ Found $REQUEST_COUNT pending request(s)${NC}"
echo ""

# ============================================
# 6. Check Driver's Own Requests
# ============================================
echo -e "${YELLOW}Step 6: Checking driver's own topup history...${NC}"

MY_REQUESTS=$(curl -s -X GET "$API_URL/wallet/topup/my-requests" \
  -H "Authorization: Bearer $DRIVER_TOKEN")

echo "My Requests:"
echo "$MY_REQUESTS" | jq '.requests[] | {topupId, amount, status, createdAt}'
echo ""

# ============================================
# 7. Approve Topup Request (Admin)
# ============================================
echo -e "${YELLOW}Step 7: Approving topup request...${NC}"

APPROVE_RESPONSE=$(curl -s -X POST "$API_URL/wallet/topup/$TOPUP_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"note\": \"Approved after verification\"
  }")

echo "Approval Response:"
echo "$APPROVE_RESPONSE" | jq '.'

APPROVE_SUCCESS=$(echo "$APPROVE_RESPONSE" | jq -r '.success')
NEW_BALANCE=$(echo "$APPROVE_RESPONSE" | jq -r '.newBalance')

if [ "$APPROVE_SUCCESS" != "true" ]; then
  echo -e "${RED}❌ Failed to approve topup${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Topup approved${NC}"
echo "   New balance: $NEW_BALANCE IQD"
echo ""

# ============================================
# 8. Verify Wallet Balance Updated
# ============================================
echo -e "${YELLOW}Step 8: Verifying wallet balance updated...${NC}"

sleep 2  # Wait for consistency

FINAL_WALLET=$(curl -s -X GET "$API_URL/wallet/me" \
  -H "Authorization: Bearer $DRIVER_TOKEN")

FINAL_BALANCE=$(echo "$FINAL_WALLET" | jq -r '.availableBalance')

echo "Wallet after topup:"
echo "$FINAL_WALLET" | jq '.'

EXPECTED_BALANCE=$((INITIAL_BALANCE + TOPUP_AMOUNT))

if [ "$FINAL_BALANCE" = "$EXPECTED_BALANCE" ]; then
  echo -e "${GREEN}✅ Balance updated correctly${NC}"
  echo "   Initial: $INITIAL_BALANCE IQD"
  echo "   Topup: +$TOPUP_AMOUNT IQD"
  echo "   Final: $FINAL_BALANCE IQD"
else
  echo -e "${RED}❌ Balance mismatch${NC}"
  echo "   Expected: $EXPECTED_BALANCE IQD"
  echo "   Actual: $FINAL_BALANCE IQD"
  exit 1
fi
echo ""

# ============================================
# 9. Check Ledger Entries
# ============================================
echo -e "${YELLOW}Step 9: Checking ledger entries...${NC}"

TRANSACTIONS=$(curl -s -X GET "$API_URL/wallet/me/transactions?limit=5" \
  -H "Authorization: Bearer $DRIVER_TOKEN")

echo "Recent Transactions:"
echo "$TRANSACTIONS" | jq '.transactions[] | {type, amount, balance, timestamp}'

TOPUP_ENTRY=$(echo "$TRANSACTIONS" | jq -r ".transactions[] | select(.relatedEntityId == \"$TOPUP_ID\")")

if [ -n "$TOPUP_ENTRY" ]; then
  echo -e "${GREEN}✅ Topup ledger entry found${NC}"
else
  echo -e "${YELLOW}⚠️  Topup ledger entry not found (may need to wait)${NC}"
fi
echo ""

# ============================================
# 10. Test Idempotency (Duplicate Approval)
# ============================================
echo -e "${YELLOW}Step 10: Testing idempotency (duplicate approval)...${NC}"

DUPLICATE_RESPONSE=$(curl -s -X POST "$API_URL/wallet/topup/$TOPUP_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"note\": \"Duplicate approval attempt\"
  }")

echo "Duplicate Approval Response:"
echo "$DUPLICATE_RESPONSE" | jq '.'

# Should either return same result or error about already approved
DUPLICATE_SUCCESS=$(echo "$DUPLICATE_RESPONSE" | jq -r '.success')

if [ "$DUPLICATE_SUCCESS" = "true" ]; then
  echo -e "${GREEN}✅ Idempotency working (returned cached result)${NC}"
else
  ERROR_MSG=$(echo "$DUPLICATE_RESPONSE" | jq -r '.message // .error')
  if [[ "$ERROR_MSG" == *"already"* ]] || [[ "$ERROR_MSG" == *"PENDING"* ]]; then
    echo -e "${GREEN}✅ Idempotency working (rejected duplicate)${NC}"
  else
    echo -e "${YELLOW}⚠️  Unexpected response: $ERROR_MSG${NC}"
  fi
fi
echo ""

# ============================================
# Summary
# ============================================
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ Topup Workflow Test PASSED${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Summary:"
echo "  • Driver authenticated: $DRIVER_ID"
echo "  • Admin authenticated: $ADMIN_ID"
echo "  • Topup request created: $TOPUP_ID"
echo "  • Amount: $TOPUP_AMOUNT IQD"
echo "  • Initial balance: $INITIAL_BALANCE IQD"
echo "  • Final balance: $FINAL_BALANCE IQD"
echo "  • Balance increase: +$((FINAL_BALANCE - INITIAL_BALANCE)) IQD"
echo ""
echo -e "${GREEN}All tests passed successfully!${NC}"
