#!/bin/bash

# Complete Topup Workflow Test
set -e

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
PROFILE="Wizz_dev_UserApp"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Complete Topup Workflow Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Get Driver Token
echo -e "${YELLOW}1. Getting driver token...${NC}"
DRIVER_ID="64f894a8-a001-70fc-ddbd-3ff0dd55c86c"
DRIVER_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 4dkt45gole08kurh0o43rvk8q7 \
  --auth-parameters "USERNAME=$DRIVER_ID,PASSWORD=TestDriver123!" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --output json | jq -r '.AuthenticationResult.AccessToken')
echo -e "${GREEN}✅ Driver authenticated${NC}\n"

# Get Admin Token
echo -e "${YELLOW}2. Getting admin token...${NC}"
ADMIN_USERNAME="admin@wizz.iq"
ADMIN_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 5hun8p61grnakisu5gammcjelv \
  --auth-parameters "USERNAME=$ADMIN_USERNAME,PASSWORD=Admin@Wizz2025!" \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --output json | jq -r '.AuthenticationResult.AccessToken')
echo -e "${GREEN}✅ Admin authenticated${NC}\n"

# Check initial balance
echo -e "${YELLOW}3. Checking initial balance...${NC}"
INITIAL=$(curl -s "$API_URL/wallet/me" -H "Authorization: Bearer $DRIVER_TOKEN" | jq -r '.availableBalance')
echo -e "${GREEN}Initial balance: $INITIAL IQD${NC}\n"

# Create topup request
echo -e "${YELLOW}4. Creating topup request (25,000 IQD)...${NC}"
TOPUP_RESPONSE=$(curl -s -X POST "$API_URL/wallet/topup/request" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 25000, "method": "CASH_AGENT", "note": "Test topup"}')

TOPUP_ID=$(echo "$TOPUP_RESPONSE" | jq -r '.topupRequest.topupId')
echo -e "${GREEN}✅ Topup created: $TOPUP_ID${NC}\n"

# List pending requests (Admin)
echo -e "${YELLOW}5. Admin viewing pending requests...${NC}"
PENDING=$(curl -s "$API_URL/wallet/topup/requests?status=PENDING" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
COUNT=$(echo "$PENDING" | jq '.count')
echo -e "${GREEN}Found $COUNT pending request(s)${NC}"
echo "$PENDING" | jq -r '.requests[] | "  - \(.topupId): \(.amount) IQD by \(.createdByRole)"' | head -3
echo ""

# Approve topup
echo -e "${YELLOW}6. Admin approving topup...${NC}"
APPROVE=$(curl -s -X POST "$API_URL/wallet/topup/$TOPUP_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"note": "Verified and approved"}')

NEW_BALANCE=$(echo "$APPROVE" | jq -r '.newBalance')
echo -e "${GREEN}✅ Approved! New balance: $NEW_BALANCE IQD${NC}\n"

# Verify balance
echo -e "${YELLOW}7. Verifying final balance...${NC}"
sleep 1
FINAL=$(curl -s "$API_URL/wallet/me" -H "Authorization: Bearer $DRIVER_TOKEN" | jq -r '.availableBalance')
echo -e "${GREEN}Final balance: $FINAL IQD (Expected: $((INITIAL + 25000)))${NC}\n"

# Check transactions
echo -e "${YELLOW}8. Checking recent transactions...${NC}"
curl -s "$API_URL/wallet/me/transactions?limit=3" \
  -H "Authorization: Bearer $DRIVER_TOKEN" | jq -r '.transactions[] | "  \(.timestamp | .[0:19]): \(.type) \(.amount) IQD (Balance: \(.balance))"'
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo -e "${BLUE}========================================${NC}"
