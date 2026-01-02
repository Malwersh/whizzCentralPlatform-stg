#!/bin/bash

# Generate random test phone
TEST_PHONE="+96477$(printf '%08d' $((RANDOM * RANDOM % 100000000)))"
TEST_EMAIL="test.driver.$(date +%s)@wizz.test"

echo "📝 Creating new driver account..."
echo "Phone: $TEST_PHONE"
echo "Email: $TEST_EMAIL"

# Sign up new driver with phone as username
SIGNUP_RESULT=$(aws cognito-idp sign-up \
  --client-id 4dkt45gole08kurh0o43rvk8q7 \
  --username "$TEST_PHONE" \
  --password "TestPass123!" \
  --user-attributes \
    Name=email,Value="$TEST_EMAIL" \
    Name=phone_number,Value="$TEST_PHONE" \
    Name=custom:role,Value="driver" \
  --region us-east-1 \
  --profile Wizz_dev_UserApp 2>&1)

if echo "$SIGNUP_RESULT" | grep -q "UserSub"; then
    USER_SUB=$(echo "$SIGNUP_RESULT" | grep -o '"UserSub": "[^"]*"' | cut -d'"' -f4)
    echo "✅ Driver signed up successfully"
    echo "UserSub: $USER_SUB"
    
    # Get verification code from email (simulated - in real test check email)
    echo ""
    echo "⏳ Waiting 5 seconds for verification email..."
    sleep 5
    
    # Admin confirm user (for testing)
    echo "🔐 Admin confirming user..."
    aws cognito-idp admin-confirm-sign-up \
      --user-pool-id us-east-1_Mnrmklxro \
      --username "$TEST_PHONE" \
      --region us-east-1 \
      --profile Wizz_dev_UserApp
    
    echo ""
    echo "⏳ Waiting 5 seconds for PostConfirmation trigger to execute..."
    sleep 5
    
    # Check if wallet was created
    echo ""
    echo "🔍 Checking if wallet was created automatically..."
    WALLET_ID="WALLET#DRIVER#${USER_SUB}"
    
    aws dynamodb get-item \
      --table-name dev-Wallets \
      --key "{\"walletId\": {\"S\": \"$WALLET_ID\"}, \"sk\": {\"S\": \"META\"}}" \
      --region us-east-1 \
      --profile Wizz_dev_UserApp \
      --query 'Item.{WalletId:walletId.S,Balance:balance.N,Currency:currency.S,CreatedAt:createdAt.S}' \
      --output table
      
    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ SUCCESS: Wallet created automatically!"
    else
        echo ""
        echo "❌ FAILED: Wallet was not created"
    fi
    
    # Check Lambda logs
    echo ""
    echo "📋 Recent Lambda trigger logs:"
    aws logs tail /aws/lambda/dev-wizz-wallet-creation-trigger \
      --since 2m \
      --format short \
      --region us-east-1 \
      --profile Wizz_dev_UserApp | tail -20
else
    echo "❌ Failed to sign up driver"
    echo "$SIGNUP_RESULT"
fi
