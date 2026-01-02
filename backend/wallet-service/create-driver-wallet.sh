#!/bin/bash

# Create wallet for test driver

API_URL="https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev"
DRIVER_ID="64f894a8-a001-70fc-ddbd-3ff0dd55c86c"

echo "========================================="
echo "Creating Wallet for Driver"
echo "========================================="
echo ""
echo "Driver ID: $DRIVER_ID"
echo ""

# Create wallet
response=$(curl -s -X POST "$API_URL/wallet/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$DRIVER_ID\",
    \"userType\": \"driver\",
    \"initialBalance\": 10000,
    \"currency\": \"IQD\"
  }")

echo "Response:"
echo "$response" | jq .

echo ""
echo "Done!"
