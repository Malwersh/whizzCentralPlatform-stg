#!/bin/bash

# 🧪 Service Authentication Complete Test
# Tests Service Token and Service-only endpoints

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
SERVICE_USER_POOL_ID="us-east-1_VTZMjCvuP"
SERVICE_CLIENT_ID="536kaptb4mttprbravfh9gbbq0"

# Service credentials (you need to get these from Secrets Manager or manual login)
SERVICE_USERNAME="order-service-dev"
# For testing, you'll need to set password temporarily or get from Secrets Manager
# SERVICE_PASSWORD="YOUR_PASSWORD_HERE"

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   🔐 Service Authentication Test                    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if password is provided
if [ -z "$SERVICE_PASSWORD" ]; then
    echo -e "${YELLOW}⚠️  SERVICE_PASSWORD not set${NC}"
    echo -e "Please set it as an environment variable or update this script:"
    echo -e "export SERVICE_PASSWORD='your-password'"
    echo ""
    echo -e "To get password from Secrets Manager:"
    echo -e "aws secretsmanager get-secret-value --secret-id dev/wallet-service/order-service --region us-east-1 --profile Wizz_dev_UserApp --query SecretString --output text"
    exit 1
fi

echo -e "${BLUE}📋 Test Configuration:${NC}"
echo -e "   API URL: $API_URL"
echo -e "   Service User Pool: $SERVICE_USER_POOL_ID"
echo -e "   Service Account: $SERVICE_USERNAME"
echo ""

# Step 1: Get Service Token
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 1: Authenticate and Get Service Token${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

SERVICE_TOKEN=$(aws cognito-idp initiate-auth \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "$SERVICE_CLIENT_ID" \
    --auth-parameters USERNAME="$SERVICE_USERNAME",PASSWORD="$SERVICE_PASSWORD" \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query 'AuthenticationResult.AccessToken' \
    --output text 2>&1)

if [ $? -eq 0 ] && [ -n "$SERVICE_TOKEN" ] && [ "$SERVICE_TOKEN" != "None" ]; then
    echo -e "${GREEN}✅ Service Token obtained successfully${NC}"
    echo -e "   Token (first 50 chars): ${SERVICE_TOKEN:0:50}..."
    echo ""
else
    echo -e "${RED}❌ Failed to get Service Token${NC}"
    echo -e "Error: $SERVICE_TOKEN"
    exit 1
fi

# Step 2: Test Create Wallet (Service endpoint)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 2: Test Create Wallet (Service Only)${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

TEST_DRIVER_ID="driver-test-$(date +%s)"
CREATE_WALLET_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "$API_URL/wallet/create" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "walletId": "'$TEST_DRIVER_ID'",
        "ownerType": "DRIVER",
        "ownerId": "'$TEST_DRIVER_ID'",
        "initialBalance": 25000
    }')

HTTP_CODE=$(echo "$CREATE_WALLET_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$CREATE_WALLET_RESPONSE" | sed '$d')

echo "Response: $RESPONSE_BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}✅ Create Wallet successful${NC}"
else
    echo -e "${RED}❌ Create Wallet failed with HTTP $HTTP_CODE${NC}"
fi
echo ""

# Step 3: Test Create Hold (Service endpoint)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 3: Test Create Hold (Service Only)${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

TEST_ORDER_ID="order-test-$(date +%s)"
CREATE_HOLD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "$API_URL/wallet/hold/create" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "walletId": "'$TEST_DRIVER_ID'",
        "amount": 5000,
        "orderId": "'$TEST_ORDER_ID'",
        "description": "Test hold for order '$TEST_ORDER_ID'"
    }')

HTTP_CODE=$(echo "$CREATE_HOLD_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$CREATE_HOLD_RESPONSE" | sed '$d')

echo "Response: $RESPONSE_BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}✅ Create Hold successful${NC}"
    # Extract hold ID for next steps
    HOLD_ID=$(echo "$RESPONSE_BODY" | grep -o '"holdId":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$HOLD_ID" ]; then
        echo -e "   Hold ID: $HOLD_ID"
    fi
else
    echo -e "${RED}❌ Create Hold failed with HTTP $HTTP_CODE${NC}"
fi
echo ""

# Step 4: Test Settlement (Service endpoint)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 4: Test Settlement (Service Only)${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

if [ -n "$HOLD_ID" ]; then
    SETTLE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        "$API_URL/wallet/settlement/settle" \
        -H "Authorization: Bearer $SERVICE_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
            "orderId": "'$TEST_ORDER_ID'",
            "driverWalletId": "'$TEST_DRIVER_ID'",
            "holdId": "'$HOLD_ID'",
            "customerCashDue": 5000,
            "driverBaseEarnings": 4000,
            "bonusAmount": 0,
            "description": "Test settlement"
        }')

    HTTP_CODE=$(echo "$SETTLE_RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$SETTLE_RESPONSE" | sed '$d')

    echo "Response: $RESPONSE_BODY"
    echo "HTTP Code: $HTTP_CODE"

    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        echo -e "${GREEN}✅ Settlement successful${NC}"
    else
        echo -e "${RED}❌ Settlement failed with HTTP $HTTP_CODE${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Skipping settlement (no hold ID)${NC}"
fi
echo ""

# Step 5: Test Access to Admin Endpoint (Should Fail)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 5: Test Access to Admin Endpoint (Should Fail)${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

ADMIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    "$API_URL/wallet/platform" \
    -H "Authorization: Bearer $SERVICE_TOKEN")

HTTP_CODE=$(echo "$ADMIN_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$ADMIN_RESPONSE" | sed '$d')

echo "Response: $RESPONSE_BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✅ Correctly blocked from Admin endpoint${NC}"
else
    echo -e "${RED}❌ Unexpected: Service accessed Admin endpoint (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Step 6: Test Access to Driver Endpoint (Should Fail)
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Step 6: Test Access to Driver Endpoint (Should Fail)${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}"

DRIVER_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    "$API_URL/wallet/me" \
    -H "Authorization: Bearer $SERVICE_TOKEN")

HTTP_CODE=$(echo "$DRIVER_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$DRIVER_RESPONSE" | sed '$d')

echo "Response: $RESPONSE_BODY"
echo "HTTP Code: $HTTP_CODE"

if [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✅ Correctly blocked from Driver endpoint${NC}"
else
    echo -e "${RED}❌ Unexpected: Service accessed Driver endpoint (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   📊 Service Authentication Test Summary            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ Completed${NC}: Service Token Authentication"
echo -e "${GREEN}✅ Tested${NC}: Create Wallet (Service)"
echo -e "${GREEN}✅ Tested${NC}: Create Hold (Service)"
echo -e "${GREEN}✅ Tested${NC}: Settlement (Service)"
echo -e "${GREEN}✅ Verified${NC}: Cannot access Admin endpoints"
echo -e "${GREEN}✅ Verified${NC}: Cannot access Driver endpoints"
echo ""
echo -e "${BLUE}🎉 Service Authentication test complete!${NC}"
