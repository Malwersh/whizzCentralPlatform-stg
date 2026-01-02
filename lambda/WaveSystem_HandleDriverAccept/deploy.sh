#!/bin/bash

# ========================================
# Deploy WaveSystem_HandleDriverAccept Lambda
# ========================================

FUNCTION_NAME="WaveSystem_HandleDriverAccept"
LAMBDA_ROLE="lambda-execution-role"
REGION="us-east-1"
AWS_PROFILE="${AWS_PROFILE:-}"

: "${DISPATCH_JOBS_TABLE:?Set DISPATCH_JOBS_TABLE}"
: "${WAVE_OFFERS_TABLE:?Set WAVE_OFFERS_TABLE}"
: "${DRIVER_LIVE_STATE_TABLE:?Set DRIVER_LIVE_STATE_TABLE}"
: "${WEBSOCKET_API_ENDPOINT:?Set WEBSOCKET_API_ENDPOINT (wss://... or https://...)}"

ORDERS_TABLE="${ORDERS_TABLE:-WizzOrders}"

echo "🚀 Deploying ${FUNCTION_NAME}..."

# Package Lambda
echo "📦 Creating deployment package..."
cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📥 Installing dependencies..."
  npm install
fi

# Create zip with code and dependencies
zip -r function.zip index.js node_modules/

# Check if function exists
PROFILE_ARGS=()
if [ -n "$AWS_PROFILE" ]; then
  PROFILE_ARGS+=(--profile "$AWS_PROFILE")
fi

if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" "${PROFILE_ARGS[@]}" > /dev/null 2>&1; then
  echo "🔄 Updating existing function..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://function.zip \
    --region "$REGION" \
    "${PROFILE_ARGS[@]}"
  
  echo "⚙️ Updating configuration..."
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --handler index.handler \
    --runtime nodejs18.x \
    --timeout 30 \
    --memory-size 256 \
    --environment Variables="{DISPATCH_JOBS_TABLE=${DISPATCH_JOBS_TABLE},ORDERS_TABLE=${ORDERS_TABLE},WAVE_OFFERS_TABLE=${WAVE_OFFERS_TABLE},DRIVER_LIVE_STATE_TABLE=${DRIVER_LIVE_STATE_TABLE},WEBSOCKET_API_ENDPOINT=${WEBSOCKET_API_ENDPOINT}}" \
    --region "$REGION" \
    "${PROFILE_ARGS[@]}"
else
  echo "✨ Creating new function..."
  
  # Get IAM role ARN
  ROLE_ARN=$(aws iam get-role --role-name "$LAMBDA_ROLE" --query 'Role.Arn' --output text "${PROFILE_ARGS[@]}")
  
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs18.x \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --timeout 30 \
    --memory-size 256 \
    --environment Variables="{DISPATCH_JOBS_TABLE=${DISPATCH_JOBS_TABLE},ORDERS_TABLE=${ORDERS_TABLE},WAVE_OFFERS_TABLE=${WAVE_OFFERS_TABLE},DRIVER_LIVE_STATE_TABLE=${DRIVER_LIVE_STATE_TABLE},WEBSOCKET_API_ENDPOINT=${WEBSOCKET_API_ENDPOINT}}" \
    --region "$REGION" \
    "${PROFILE_ARGS[@]}"
fi

# Cleanup
rm function.zip

echo "✅ ${FUNCTION_NAME} deployment complete!"

# Print function ARN
FUNCTION_ARN=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" "${PROFILE_ARGS[@]}" --query 'Configuration.FunctionArn' --output text)
echo "📋 Function ARN: $FUNCTION_ARN"

echo ""
echo "📝 Next Steps:"
echo "1. Configure API Gateway POST /driver/accept-wave-offer → WaveSystem_HandleDriverAccept"
echo "2. Test with driver acceptance request"
echo "3. Monitor CloudWatch logs"
