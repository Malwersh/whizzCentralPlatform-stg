#!/bin/bash

# Test driver registration with automatic wallet creation

set -euo pipefail

# Disable AWS CLI pager to avoid getting stuck at "(END)".
export AWS_PAGER=""

ENVIRONMENT=${1:-staging}

if [[ ! "$ENVIRONMENT" =~ ^(dev|staging)$ ]]; then
    echo "❌ Invalid environment: $ENVIRONMENT (expected dev|staging)"
    exit 1
fi

POOL_ID=""
AWS_PROFILE=""
WALLETS_TABLE=""
TRIGGER_FUNCTION_NAME="${ENVIRONMENT}-wizz-wallet-creation-trigger"

case "$ENVIRONMENT" in
  dev)
    POOL_ID="us-east-1_Mnrmklxro"
    AWS_PROFILE="Wizz_dev_UserApp"
    WALLETS_TABLE="dev-Wallets"
    ;;
  staging)
    POOL_ID="us-east-1_RGTqUXF5C"
    AWS_PROFILE="Wizz_stg_UserApp"
    WALLETS_TABLE="staging-Wallets"
    ;;
esac

# Use unique values by default to avoid collisions if the script is run multiple times.
RAND_SUFFIX=$(date +%s%N | tr -dc '0-9' | tail -c 8)

PHONE=${PHONE:-"+96479${RAND_SUFFIX}"}  # Test phone number
PASSWORD=${PASSWORD:-"TestDriver@2025"}
EMAIL=${EMAIL:-"test.driver.wallet+${ENVIRONMENT}.${RAND_SUFFIX}@wizz.iq"}

echo "🧪 Creating test driver..."
echo "Pool: $POOL_ID"
echo "Environment: $ENVIRONMENT"
echo "Phone: $PHONE"
echo "Email: $EMAIL"
echo ""

# Determine app client id (needed for sign-up)
COGNITO_CLIENT_ID=""
case "$ENVIRONMENT" in
  dev)
    # From whizzDrivers/dev app config
    COGNITO_CLIENT_ID="4dkt45gole08kurh0o43rvk8q7"
    ;;
  staging)
    # From whizzDrivers-stg app config
    COGNITO_CLIENT_ID="2d26d3muq0vvcuf42lkpgmkgsr"
    ;;
esac

# Step 1: Sign up user (creates UNCONFIRMED user)
echo "1️⃣ Signing up user in Cognito (UNCONFIRMED)..."
SIGNUP_RESPONSE=$(aws cognito-idp sign-up \
  --client-id "$COGNITO_CLIENT_ID" \
  --username "$PHONE" \
  --password "$PASSWORD" \
  --user-attributes Name=email,Value="$EMAIL" Name=phone_number,Value="$PHONE" \
  --no-cli-pager \
  --profile "$AWS_PROFILE" \
  --region us-east-1 \
  --output json)

echo "$SIGNUP_RESPONSE" | cat

DRIVER_ID=$(echo "$SIGNUP_RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.UserSub||"");});')

if [[ -z "$DRIVER_ID" ]]; then
    echo "❌ Failed to extract UserSub from sign-up response"
    exit 1
fi

echo ""
echo "✅ User signed up!"
echo "Driver ID (sub/UserSub): $DRIVER_ID"

# Step 2: Admin confirm user (triggers PostConfirmation)
echo ""
echo "2️⃣ Admin confirming user (triggers wallet creation)..."
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id "$POOL_ID" \
  --username "$PHONE" \
  --no-cli-pager \
  --profile "$AWS_PROFILE" \
  --region us-east-1

echo "✅ User confirmed!"

echo ""
echo "⏳ Waiting 5 seconds for trigger to execute..."
sleep 5

echo ""
echo "4️⃣ Checking trigger logs..."
aws logs tail "/aws/lambda/${TRIGGER_FUNCTION_NAME}" \
  --since 1m \
  --format short \
  --no-cli-pager \
  --profile "$AWS_PROFILE" \
  --region us-east-1 2>&1 | tail -30

echo ""
echo "5️⃣ Checking if wallet was created..."
WALLET_ID="WALLET#DRIVER#${DRIVER_ID}"
aws dynamodb get-item \
  --table-name "$WALLETS_TABLE" \
  --key "{\"walletId\":{\"S\":\"$WALLET_ID\"},\"sk\":{\"S\":\"META\"}}" \
  --no-cli-pager \
  --profile "$AWS_PROFILE" \
  --region us-east-1 \
  --query 'Item.{walletId:walletId.S,available:availableBalance.N,locked:lockedBalance.N,status:status.S}' \
  --output json

echo ""
echo "========================================="
echo "✅ Test Complete!"
echo "Driver ID: $DRIVER_ID"
echo "Phone: $PHONE"
echo "Password: $PASSWORD"
echo "========================================="
