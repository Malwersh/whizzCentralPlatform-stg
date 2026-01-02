#!/bin/bash

# ========================================
# Deploy WaveSystem_HandleWaveTimeout Lambda
# ========================================

FUNCTION_NAME="WaveSystem_HandleWaveTimeout"
LAMBDA_ROLE="lambda-execution-role"
REGION="us-east-1"
AWS_PROFILE="${AWS_PROFILE:-}"

: "${DISPATCH_JOBS_TABLE:?Set DISPATCH_JOBS_TABLE}"
: "${WAVE_OFFERS_TABLE:?Set WAVE_OFFERS_TABLE}"
: "${DRIVER_LIVE_STATE_TABLE:?Set DRIVER_LIVE_STATE_TABLE}"
: "${WEBSOCKET_API_ENDPOINT:?Set WEBSOCKET_API_ENDPOINT (wss://... or https://...)}"

ORDERS_TABLE="${ORDERS_TABLE:-WizzOrders}"
START_WAVE_LAMBDA="${START_WAVE_LAMBDA:-WaveSystem_StartWave}"
MAX_WAVES="${MAX_WAVES:-3}"

PROFILE_ARGS=()
if [ -n "$AWS_PROFILE" ]; then
  PROFILE_ARGS+=(--profile "$AWS_PROFILE")
fi

echo "🚀 Deploying ${FUNCTION_NAME}..."

# Package Lambda
echo "📦 Creating deployment package..."
cd "$(dirname "$0")"
zip -r function.zip index.js

# Check if function exists
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
    --timeout 60 \
    --memory-size 512 \
    --environment Variables="{DISPATCH_JOBS_TABLE=${DISPATCH_JOBS_TABLE},WAVE_OFFERS_TABLE=${WAVE_OFFERS_TABLE},DRIVER_LIVE_STATE_TABLE=${DRIVER_LIVE_STATE_TABLE},ORDERS_TABLE=${ORDERS_TABLE},START_WAVE_LAMBDA=${START_WAVE_LAMBDA},WEBSOCKET_API_ENDPOINT=${WEBSOCKET_API_ENDPOINT},MAX_WAVES=${MAX_WAVES}}" \
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
    --timeout 60 \
    --memory-size 512 \
    --environment Variables="{DISPATCH_JOBS_TABLE=${DISPATCH_JOBS_TABLE},WAVE_OFFERS_TABLE=${WAVE_OFFERS_TABLE},DRIVER_LIVE_STATE_TABLE=${DRIVER_LIVE_STATE_TABLE},ORDERS_TABLE=${ORDERS_TABLE},START_WAVE_LAMBDA=${START_WAVE_LAMBDA},WEBSOCKET_API_ENDPOINT=${WEBSOCKET_API_ENDPOINT},MAX_WAVES=${MAX_WAVES}}" \
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
echo "1. Grant Lambda invoke permission to StartWave:"
echo "   aws lambda add-permission \\"
echo "     --function-name WaveSystem_StartWave \\"
echo "     --statement-id AllowInvokeFromHandleWaveTimeout \\"
echo "     --action lambda:InvokeFunction \\"
echo "     --principal lambda.amazonaws.com \\"
echo "     --source-arn $FUNCTION_ARN \\"
echo "     --region $REGION \\"
echo "     --profile $AWS_PROFILE"
echo ""
echo "2. Setup EventBridge rule to run every 30 seconds (optional)"
echo "3. Test with expired offers"
