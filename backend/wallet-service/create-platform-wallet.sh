#!/bin/bash

# Create Platform Wallet
# This script initializes the platform's main wallet

set -e

REGION="${1:-me-south-1}"
ENVIRONMENT="${2:-dev}"
WALLETS_TABLE="${ENVIRONMENT}-Wallets"

echo "🏦 Creating Platform Wallet"
echo "==========================="
echo "Region: $REGION"
echo "Environment: $ENVIRONMENT"
echo "Table: $WALLETS_TABLE"
echo ""

# Check if platform wallet already exists
echo "📋 Checking if platform wallet exists..."
EXISTING=$(aws dynamodb get-item \
  --table-name "$WALLETS_TABLE" \
  --key '{"walletId": {"S": "WALLET#PLATFORM"}, "sk": {"S": "META"}}' \
  --region "$REGION" \
  --output json 2>/dev/null || echo "{}")

if echo "$EXISTING" | grep -q "walletId"; then
  echo "✅ Platform wallet already exists!"
  echo ""
  echo "Current state:"
  echo "$EXISTING" | jq '.Item'
  exit 0
fi

# Create platform wallet
echo ""
echo "🔨 Creating new platform wallet..."

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

aws dynamodb put-item \
  --table-name "$WALLETS_TABLE" \
  --item "{
    \"walletId\": {\"S\": \"WALLET#PLATFORM\"},
    \"sk\": {\"S\": \"META\"},
    \"ownerType\": {\"S\": \"PLATFORM\"},
    \"ownerId\": {\"S\": \"PLATFORM\"},
    \"currency\": {\"S\": \"IQD\"},
    \"status\": {\"S\": \"ACTIVE\"},
    \"availableBalance\": {\"N\": \"0\"},
    \"lockedBalance\": {\"N\": \"0\"},
    \"minRequiredBalance\": {\"N\": \"0\"},
    \"version\": {\"N\": \"0\"},
    \"createdAt\": {\"S\": \"$TIMESTAMP\"},
    \"updatedAt\": {\"S\": \"$TIMESTAMP\"}
  }" \
  --condition-expression "attribute_not_exists(walletId)" \
  --region "$REGION"

echo ""
echo "✅ Platform wallet created successfully!"
echo ""
echo "📊 Wallet Details:"
aws dynamodb get-item \
  --table-name "$WALLETS_TABLE" \
  --key '{"walletId": {"S": "WALLET#PLATFORM"}, "sk": {"S": "META"}}' \
  --region "$REGION" \
  --output json | jq '.Item'

echo ""
echo "🎉 Platform wallet is ready!"
echo ""
echo "Next steps:"
echo "1. Test creating a driver wallet"
echo "2. Test topup workflow"
echo "3. Deploy wallet service Lambda"
