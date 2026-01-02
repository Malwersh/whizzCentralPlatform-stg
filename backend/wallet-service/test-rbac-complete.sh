#!/bin/bash

# 🧪 RBAC Authorization Complete Test
# Tests all authorization boundaries and access control

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Configuration
API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
REGION="us-east-1"
PROFILE="Wizz_dev_UserApp"

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   🔐 RBAC Authorization Complete Test               ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

run_test() {
    local test_name="$1"
    local expected_code="$2"
    local actual_code="$3"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [ "$actual_code" = "$expected_code" ]; then
        echo -e "${GREEN}  ✅ PASS${NC}: $test_name (HTTP $actual_code)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}  ❌ FAIL${NC}: $test_name (Expected $expected_code, Got $actual_code)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

# ═══════════════════════════════════════════════════════════
# PART 1: Get Tokens for All User Types
# ═══════════════════════════════════════════════════════════

echo -e "${PURPLE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║  Part 1: Token Acquisition                          ║${NC}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# 1.1 Get Service Token
echo -e "${YELLOW}1.1 Getting Service Token...${NC}"
if [ -z "$SERVICE_PASSWORD" ]; then
    echo -e "${RED}❌ SERVICE_PASSWORD not set. Set with: export SERVICE_PASSWORD='your-password'${NC}"
    exit 1
fi

SERVICE_TOKEN=$(aws cognito-idp initiate-auth \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "536kaptb4mttprbravfh9gbbq0" \
    --auth-parameters USERNAME="order-service-dev",PASSWORD="$SERVICE_PASSWORD" \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query 'AuthenticationResult.AccessToken' \
    --output text 2>&1)

if [ $? -eq 0 ] && [ -n "$SERVICE_TOKEN" ] && [ "$SERVICE_TOKEN" != "None" ]; then
    echo -e "${GREEN}✅ Service Token: ${SERVICE_TOKEN:0:30}...${NC}"
else
    echo -e "${RED}❌ Failed to get Service Token${NC}"
    exit 1
fi
echo ""

# 1.2 Get Admin Token
echo -e "${YELLOW}1.2 Getting Admin Token...${NC}"
if [ -z "$ADMIN_PASSWORD" ]; then
    echo -e "${RED}❌ ADMIN_PASSWORD not set. Set with: export ADMIN_PASSWORD='your-password'${NC}"
    exit 1
fi

ADMIN_TOKEN=$(aws cognito-idp initiate-auth \
    --auth-flow USER_PASSWORD_AUTH \
    --client-id "69j3i3k4d1g28vct6dukptg1dk" \
    --auth-parameters USERNAME="muusa.w60@gmail.com",PASSWORD="$ADMIN_PASSWORD" \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query 'AuthenticationResult.AccessToken' \
    --output text 2>&1)

if [ $? -eq 0 ] && [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "None" ]; then
    echo -e "${GREEN}✅ Admin Token: ${ADMIN_TOKEN:0:30}...${NC}"
else
    echo -e "${RED}❌ Failed to get Admin Token${NC}"
    exit 1
fi
echo ""

# 1.3 Get Driver Token (requires manual SMS code)
echo -e "${YELLOW}1.3 Getting Driver Token (SMS Authentication)...${NC}"
DRIVER_PHONE="+9647901234567"

# Initiate auth
INIT_RESPONSE=$(aws cognito-idp initiate-auth \
    --auth-flow CUSTOM_AUTH \
    --client-id "2cddg6vqd0lbmkq0d93pbqrk6d" \
    --auth-parameters USERNAME="$DRIVER_PHONE" \
    --region "$REGION" \
    --profile "$PROFILE" \
    2>&1)

if echo "$INIT_RESPONSE" | grep -q "Session"; then
    SESSION=$(echo "$INIT_RESPONSE" | grep -o '"Session": "[^"]*"' | cut -d'"' -f4)
    echo -e "${GREEN}SMS sent to $DRIVER_PHONE${NC}"
    read -p "Enter SMS code: " SMS_CODE
    
    AUTH_RESPONSE=$(aws cognito-idp respond-to-auth-challenge \
        --challenge-name CUSTOM_CHALLENGE \
        --client-id "2cddg6vqd0lbmkq0d93pbqrk6d" \
        --session "$SESSION" \
        --challenge-responses ANSWER="$SMS_CODE",USERNAME="$DRIVER_PHONE" \
        --region "$REGION" \
        --profile "$PROFILE" \
        2>&1)
    
    if echo "$AUTH_RESPONSE" | grep -q "AccessToken"; then
        DRIVER_TOKEN=$(echo "$AUTH_RESPONSE" | grep -o '"AccessToken": "[^"]*"' | cut -d'"' -f4)
        echo -e "${GREEN}✅ Driver Token: ${DRIVER_TOKEN:0:30}...${NC}"
    else
        echo -e "${RED}❌ Failed to get Driver Token${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Failed to initiate Driver auth${NC}"
    exit 1
fi
echo ""

# ═══════════════════════════════════════════════════════════
# PART 2: Test Driver Permissions
# ═══════════════════════════════════════════════════════════

echo -e "${PURPLE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║  Part 2: Driver Permission Tests                    ║${NC}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Testing Driver Access...${NC}"

# 2.1 Driver → Driver endpoints (SHOULD SUCCEED)
echo -e "${YELLOW}Driver accessing own endpoints:${NC}"

# /wallet/me
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API_URL/wallet/me" \
    -H "Authorization: Bearer $DRIVER_TOKEN")
run_test "Driver → /wallet/me" "200" "$HTTP_CODE"

# /wallet/me/transactions
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API_URL/wallet/me/transactions" \
    -H "Authorization: Bearer $DRIVER_TOKEN")
run_test "Driver → /wallet/me/transactions" "200" "$HTTP_CODE"

# /wallet/topup/request
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/topup/request" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"amount": 50000, "method": "CASH", "agentName": "Test"}')
run_test "Driver → POST /wallet/topup/request" "200" "$HTTP_CODE"

echo ""

# 2.2 Driver → Admin endpoints (SHOULD FAIL 403)
echo -e "${YELLOW}Driver accessing admin endpoints (should fail):${NC}"

# Approve topup
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/topup/fake-id/approve" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"notes": "test"}')
run_test "Driver → POST /wallet/topup/{id}/approve" "403" "$HTTP_CODE"

# Get platform wallet
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API_URL/wallet/platform" \
    -H "Authorization: Bearer $DRIVER_TOKEN")
run_test "Driver → GET /wallet/platform" "403" "$HTTP_CODE"

# View other wallet
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API_URL/wallet/driver-OTHER" \
    -H "Authorization: Bearer $DRIVER_TOKEN")
run_test "Driver → GET /wallet/{other}" "403" "$HTTP_CODE"

echo ""

# 2.3 Driver → Service endpoints (SHOULD FAIL 403)
echo -e "${YELLOW}Driver accessing service endpoints (should fail):${NC}"

# Create hold
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/hold/create" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"walletId": "driver-123", "amount": 5000, "orderId": "order-123"}')
run_test "Driver → POST /wallet/hold/create" "403" "$HTTP_CODE"

# Settlement
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/settlement/settle" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"orderId": "order-123"}')
run_test "Driver → POST /wallet/settlement/settle" "403" "$HTTP_CODE"

echo ""

# ═══════════════════════════════════════════════════════════
# PART 3: Test Admin Permissions
# ═══════════════════════════════════════════════════════════

echo -e "${PURPLE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║  Part 3: Admin Permission Tests                     ║${NC}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Testing Admin Access...${NC}"

# 3.1 Admin → Admin endpoints (SHOULD SUCCEED)
echo -e "${YELLOW}Admin accessing admin endpoints:${NC}"

# Get platform wallet
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API_URL/wallet/platform" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
run_test "Admin → GET /wallet/platform" "200" "$HTTP_CODE"

# Get topup requests
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API_URL/wallet/topup/requests" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
run_test "Admin → GET /wallet/topup/requests" "200" "$HTTP_CODE"

# View any wallet
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API_URL/wallet/driver-7901234567" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
run_test "Admin → GET /wallet/{any}" "200" "$HTTP_CODE"

echo ""

# 3.2 Admin → Service endpoints (SHOULD FAIL 403)
echo -e "${YELLOW}Admin accessing service endpoints (should fail):${NC}"

# Create hold
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/hold/create" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"walletId": "driver-123", "amount": 5000, "orderId": "order-123"}')
run_test "Admin → POST /wallet/hold/create" "403" "$HTTP_CODE"

# Settlement
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/settlement/settle" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"orderId": "order-123"}')
run_test "Admin → POST /wallet/settlement/settle" "403" "$HTTP_CODE"

echo ""

# ═══════════════════════════════════════════════════════════
# PART 4: Test Service Permissions
# ═══════════════════════════════════════════════════════════

echo -e "${PURPLE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║  Part 4: Service Permission Tests                   ║${NC}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Testing Service Access...${NC}"

# 4.1 Service → Service endpoints (SHOULD SUCCEED)
echo -e "${YELLOW}Service accessing service endpoints:${NC}"

TEST_WALLET_ID="driver-test-$(date +%s)"

# Create wallet
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/create" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "walletId": "'$TEST_WALLET_ID'",
        "ownerType": "DRIVER",
        "ownerId": "'$TEST_WALLET_ID'",
        "initialBalance": 25000
    }')
run_test "Service → POST /wallet/create" "200" "$HTTP_CODE"

# Create hold
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/hold/create" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "walletId": "'$TEST_WALLET_ID'",
        "amount": 5000,
        "orderId": "test-order-'$(date +%s)'"
    }')
run_test "Service → POST /wallet/hold/create" "200" "$HTTP_CODE"

echo ""

# 4.2 Service → Admin endpoints (SHOULD FAIL 403)
echo -e "${YELLOW}Service accessing admin endpoints (should fail):${NC}"

# Approve topup
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/topup/fake-id/approve" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"notes": "test"}')
run_test "Service → POST /wallet/topup/{id}/approve" "403" "$HTTP_CODE"

# Get platform wallet
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API_URL/wallet/platform" \
    -H "Authorization: Bearer $SERVICE_TOKEN")
run_test "Service → GET /wallet/platform" "403" "$HTTP_CODE"

echo ""

# 4.3 Service → Driver endpoints (SHOULD FAIL 403)
echo -e "${YELLOW}Service accessing driver endpoints (should fail):${NC}"

# /wallet/me
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API_URL/wallet/me" \
    -H "Authorization: Bearer $SERVICE_TOKEN")
run_test "Service → GET /wallet/me" "403" "$HTTP_CODE"

# Request topup
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$API_URL/wallet/topup/request" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"amount": 50000}')
run_test "Service → POST /wallet/topup/request" "403" "$HTTP_CODE"

echo ""

# ═══════════════════════════════════════════════════════════
# Final Summary
# ═══════════════════════════════════════════════════════════

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   📊 RBAC Authorization Test Summary                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Total Tests:${NC} $TOTAL_TESTS"
echo -e "${GREEN}Passed:${NC} $PASSED_TESTS"
echo -e "${RED}Failed:${NC} $FAILED_TESTS"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  🎉 ALL RBAC TESTS PASSED! Security Verified ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${RED}╔═════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ⚠️  SECURITY ISSUES FOUND! Review Failed  ║${NC}"
    echo -e "${RED}╚═════════════════════════════════════════════╝${NC}"
    exit 1
fi
