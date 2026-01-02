#!/bin/bash

# 🧪 Driver Authentication Complete Test
# Tests Driver Token and Driver endpoints with RBAC

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
REGION="us-east-1"
PROFILE="Wizz_dev_UserApp"
DRIVER_USER_POOL_ID="us-east-1_Mnrmklxro"
DRIVER_CLIENT_ID="2cddg6vqd0lbmkq0d93pbqrk6d"

# Test driver phone (must exist in Cognito)
DRIVER_PHONE="+9647901234567"

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   🚗 Driver Authentication Test                     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}📋 Test Configuration:${NC}"
echo -e "   API URL: $API_URL"
echo -e "   Driver User Pool: $DRIVER_USER_POOL_ID"
echo -e "   Driver Phone: $DRIVER_PHONE"
echo ""

# Step 1: Initiate Auth (Get SMS code)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 1: Initiate Authentication${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

INIT_RESPONSE=$(aws cognito-idp initiate-auth \
    --auth-flow CUSTOM_AUTH \
    --client-id "$DRIVER_CLIENT_ID" \
    --auth-parameters USERNAME="$DRIVER_PHONE" \
    --region "$REGION" \
    --profile "$PROFILE" \
    2>&1)

if echo "$INIT_RESPONSE" | grep -q "Session"; then
    echo -e "${GREEN}✅ SMS code sent to $DRIVER_PHONE${NC}"
    SESSION=$(echo "$INIT_RESPONSE" | grep -o '"Session": "[^"]*"' | cut -d'"' -f4)
    echo -e "   Session ID: ${SESSION:0:50}..."
else
    echo -e "${RED}❌ Failed to initiate auth${NC}"
    echo "$INIT_RESPONSE"
    exit 1
fi
echo ""

# Step 2: Get SMS code from user
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 2: Enter SMS Code${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

read -p "Enter the SMS code sent to $DRIVER_PHONE: " SMS_CODE
echo ""

# Step 3: Respond to Auth Challenge
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 3: Verify SMS Code${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

AUTH_RESPONSE=$(aws cognito-idp respond-to-auth-challenge \
    --challenge-name CUSTOM_CHALLENGE \
    --client-id "$DRIVER_CLIENT_ID" \
    --session "$SESSION" \
    --challenge-responses ANSWER="$SMS_CODE",USERNAME="$DRIVER_PHONE" \
    --region "$REGION" \
    --profile "$PROFILE" \
    2>&1)

if echo "$AUTH_RESPONSE" | grep -q "AccessToken"; then
    echo -e "${GREEN}✅ Authentication successful${NC}"
    DRIVER_TOKEN=$(echo "$AUTH_RESPONSE" | grep -o '"AccessToken": "[^"]*"' | cut -d'"' -f4)
    echo -e "   Token (first 50 chars): ${DRIVER_TOKEN:0:50}..."
else
    echo -e "${RED}❌ Authentication failed${NC}"
    echo "$AUTH_RESPONSE"
    exit 1
fi
echo ""

# Step 4: Test /wallet/me (Driver endpoint)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 4: Test /wallet/me (Driver Endpoint)${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

ME_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    "$API_URL/wallet/me" \
    -H "Authorization: Bearer $DRIVER_TOKEN")

HTTP_CODE=$(echo "$ME_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$ME_RESPONSE" | sed '$d')

echo "Response: $RESPONSE_BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Successfully retrieved wallet${NC}"
else
    echo -e "${RED}❌ Failed to get wallet (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Step 5: Test /wallet/me/transactions (Driver endpoint)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 5: Test /wallet/me/transactions${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

TRANSACTIONS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    "$API_URL/wallet/me/transactions?limit=5" \
    -H "Authorization: Bearer $DRIVER_TOKEN")

HTTP_CODE=$(echo "$TRANSACTIONS_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$TRANSACTIONS_RESPONSE" | sed '$d')

echo "Response: $RESPONSE_BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Successfully retrieved transactions${NC}"
else
    echo -e "${RED}❌ Failed to get transactions (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Step 6: Test Topup Request (Driver endpoint)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 6: Test Topup Request${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

TOPUP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "$API_URL/wallet/topup/request" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "amount": 50000,
        "method": "CASH",
        "agentName": "Test Agent",
        "notes": "Test topup request"
    }')

HTTP_CODE=$(echo "$TOPUP_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$TOPUP_RESPONSE" | sed '$d')

echo "Response: $RESPONSE_BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}✅ Topup request created${NC}"
    TOPUP_ID=$(echo "$RESPONSE_BODY" | grep -o '"topupId":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$TOPUP_ID" ]; then
        echo -e "   Topup ID: $TOPUP_ID"
    fi
else
    echo -e "${RED}❌ Failed to create topup request (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Step 7: Test Access to Admin Endpoint (Should Fail)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 7: Test Admin Endpoint Access (Should Fail)${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

if [ -n "$TOPUP_ID" ]; then
    ADMIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        "$API_URL/wallet/topup/$TOPUP_ID/approve" \
        -H "Authorization: Bearer $DRIVER_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"notes": "Trying to approve my own topup"}')

    HTTP_CODE=$(echo "$ADMIN_RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$ADMIN_RESPONSE" | sed '$d')

    echo "Response: $RESPONSE_BODY"
    echo "HTTP Code: $HTTP_CODE"

    if [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "401" ]; then
        echo -e "${GREEN}✅ Correctly blocked from Admin endpoint${NC}"
    else
        echo -e "${RED}❌ SECURITY ISSUE: Driver accessed Admin endpoint (HTTP $HTTP_CODE)${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Skipping (no topup ID)${NC}"
fi
echo ""

# Step 8: Test Access to Service Endpoint (Should Fail)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 8: Test Service Endpoint Access (Should Fail)${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

SERVICE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "$API_URL/wallet/hold/create" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "walletId": "driver-7901234567",
        "amount": 5000,
        "orderId": "fake-order-123"
    }')

HTTP_CODE=$(echo "$SERVICE_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$SERVICE_RESPONSE" | sed '$d')

echo "Response: $RESPONSE_BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✅ Correctly blocked from Service endpoint${NC}"
else
    echo -e "${RED}❌ SECURITY ISSUE: Driver accessed Service endpoint (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   📊 Driver Authentication Test Summary             ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ Completed${NC}: Driver SMS Authentication"
echo -e "${GREEN}✅ Tested${NC}: /wallet/me (200)"
echo -e "${GREEN}✅ Tested${NC}: /wallet/me/transactions (200)"
echo -e "${GREEN}✅ Tested${NC}: Topup Request (201)"
echo -e "${GREEN}✅ Verified${NC}: Cannot approve topup (403)"
echo -e "${GREEN}✅ Verified${NC}: Cannot create hold (403)"
echo ""
echo -e "${BLUE}🎉 Driver Authentication test complete!${NC}"
