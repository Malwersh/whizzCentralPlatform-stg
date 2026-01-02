#!/bin/bash

# WaveSystem_StartWave Lambda Deployment Script
# This script packages and deploys the StartWave Lambda function

set -e

LAMBDA_NAME="WaveSystem_StartWave"
LAMBDA_ROLE="lambda-execution-role"
REGION="us-east-1"
RUNTIME="nodejs18.x"
HANDLER="index.handler"
TIMEOUT=60
MEMORY=512
AWS_PROFILE="${AWS_PROFILE:-}"

: "${DISPATCH_JOBS_TABLE:?Set DISPATCH_JOBS_TABLE}"
: "${DRIVER_LIVE_STATE_TABLE:?Set DRIVER_LIVE_STATE_TABLE}"
: "${WAVE_OFFERS_TABLE:?Set WAVE_OFFERS_TABLE}"
: "${WEBSOCKET_API_ENDPOINT:?Set WEBSOCKET_API_ENDPOINT (wss://... or https://...)}"
: "${GOOGLE_MAPS_API_KEY:?Set GOOGLE_MAPS_API_KEY}"
: "${WAVE_TIMEOUT_LAMBDA_ARN:?Set WAVE_TIMEOUT_LAMBDA_ARN}"

PROFILE_ARGS=()
if [ -n "$AWS_PROFILE" ]; then
  PROFILE_ARGS+=(--profile "$AWS_PROFILE")
fi

echo "📦 Starting deployment for $LAMBDA_NAME..."

# Step 1: Install dependencies
echo "📥 Installing dependencies..."
npm install --production

# Step 2: Create deployment package
echo "🗜️  Creating deployment package..."
zip -r function.zip index.js node_modules/ package.json

# Step 3: Check if IAM role exists
echo "🔍 Checking IAM role: $LAMBDA_ROLE..."
ROLE_ARN=$(aws iam get-role --role-name $LAMBDA_ROLE --query 'Role.Arn' --output text "${PROFILE_ARGS[@]}" 2>/dev/null || echo "")

if [ -z "$ROLE_ARN" ]; then
  echo "❌ Error: IAM role '$LAMBDA_ROLE' not found"
  echo "Please create the role first with the following permissions:"
  echo "  - AWSLambdaBasicExecutionRole"
  echo "  - DynamoDB: GetItem, Query, PutItem, UpdateItem, BatchWriteItem"
  echo "  - API Gateway: ManageConnections (for WebSocket)"
  echo "  - EventBridge: PutRule, PutTargets"
  echo "  - Lambda: InvokeFunction (for timeout lambda)"
  exit 1
fi

echo "✅ Found IAM role: $ROLE_ARN"

# Step 4: Check if Lambda function exists
echo "🔍 Checking if Lambda function exists..."
FUNCTION_EXISTS=$(aws lambda get-function --function-name $LAMBDA_NAME --region $REGION "${PROFILE_ARGS[@]}" 2>/dev/null || echo "")

if [ -z "$FUNCTION_EXISTS" ]; then
  # Create new function
  echo "🆕 Creating new Lambda function..."
  aws lambda create-function \
    --function-name $LAMBDA_NAME \
    --runtime $RUNTIME \
    --role $ROLE_ARN \
    --handler $HANDLER \
    --zip-file fileb://function.zip \
    --timeout $TIMEOUT \
    --memory-size $MEMORY \
    --region $REGION \
    --environment Variables="{DISPATCH_JOBS_TABLE=${DISPATCH_JOBS_TABLE},DRIVER_LIVE_STATE_TABLE=${DRIVER_LIVE_STATE_TABLE},WAVE_OFFERS_TABLE=${WAVE_OFFERS_TABLE},WEBSOCKET_API_ENDPOINT=${WEBSOCKET_API_ENDPOINT},GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY},WAVE_TIMEOUT_LAMBDA_ARN=${WAVE_TIMEOUT_LAMBDA_ARN}}" \
    --description "Wave dispatch system - starts wave and sends offers to drivers"
    "${PROFILE_ARGS[@]}"

  echo "✅ Lambda function created successfully"
else
  # Update existing function
  echo "🔄 Updating existing Lambda function..."
  aws lambda update-function-code \
    --function-name $LAMBDA_NAME \
    --zip-file fileb://function.zip \
    --region $REGION \
    "${PROFILE_ARGS[@]}"

  echo "⏳ Waiting for update to complete..."
  aws lambda wait function-updated --function-name $LAMBDA_NAME --region $REGION "${PROFILE_ARGS[@]}"

  echo "🔧 Updating function configuration..."
  aws lambda update-function-configuration \
    --function-name $LAMBDA_NAME \
    --runtime $RUNTIME \
    --handler $HANDLER \
    --timeout $TIMEOUT \
    --memory-size $MEMORY \
    --region $REGION \
    --environment Variables="{DISPATCH_JOBS_TABLE=${DISPATCH_JOBS_TABLE},DRIVER_LIVE_STATE_TABLE=${DRIVER_LIVE_STATE_TABLE},WAVE_OFFERS_TABLE=${WAVE_OFFERS_TABLE},WEBSOCKET_API_ENDPOINT=${WEBSOCKET_API_ENDPOINT},GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY},WAVE_TIMEOUT_LAMBDA_ARN=${WAVE_TIMEOUT_LAMBDA_ARN}}" \
    "${PROFILE_ARGS[@]}"

  echo "✅ Lambda function updated successfully"
fi

# Step 5: Cleanup
echo "🧹 Cleaning up..."
rm function.zip

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Update WEBSOCKET_API_ENDPOINT if different"
echo "2. Update WAVE_TIMEOUT_LAMBDA_ARN with actual ARN"
echo "3. Grant CreateDispatchJob Lambda permission to invoke this function"
echo "4. Create WaveOffers table if not exists"
echo "5. Test with: aws lambda invoke --function-name $LAMBDA_NAME --payload '{\"dispatchJobId\":\"DISPATCH_TEST_123\",\"waveNumber\":1}' response.json"
echo ""
echo "🔐 Required IAM Permissions for $LAMBDA_ROLE:"
echo "  Tables: DISPATCH_JOBS_TABLE (Read/Write)"
echo "  Tables: DRIVER_LIVE_STATE_TABLE (Read)"
echo "  Tables: WAVE_OFFERS_TABLE (Write)"
echo "  API Gateway: execute-api:ManageConnections"
echo "  EventBridge: events:PutRule, events:PutTargets"
echo ""
