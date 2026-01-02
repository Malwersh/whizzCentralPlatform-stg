#!/bin/bash

# =====================================
# Deploy WaveSystem_UpdateDriverMetrics Lambda
# =====================================
# Purpose: تحديث WizzDriverPerformanceMetrics تلقائياً من DynamoDB Streams
# Triggered by: WaveOffers + WizzOrders Streams
# =====================================

set -e

echo "=========================================="
echo "🚀 Deploying WaveSystem_UpdateDriverMetrics"
echo "=========================================="

# Environment variables
FUNCTION_NAME="WaveSystem_UpdateDriverMetrics"
LAMBDA_DIR="../lambda/${FUNCTION_NAME}"
ROLE_NAME="lambda-execution-role"
AWS_REGION="us-east-1"
PROFILE="Wizz_dev_UserApp"

# Tables
PERFORMANCE_METRICS_TABLE="WizzDriverPerformanceMetrics"
WAVE_OFFERS_TABLE="WaveOffers"
DRIVER_LIVE_STATE_TABLE="WizzDriverLiveState"
ORDERS_TABLE="WizzOrders"
WINDOW_SIZE="100"

echo ""
echo "📦 Step 1: Preparing Lambda package..."
cd "${LAMBDA_DIR}"
zip -r function.zip index.js
echo "✅ Package created"

echo ""
echo "🔑 Step 2: Getting IAM role ARN..."
ROLE_ARN=$(aws iam get-role \
  --role-name "${ROLE_NAME}" \
  --query 'Role.Arn' \
  --output text \
  --profile "${PROFILE}")

if [ -z "$ROLE_ARN" ]; then
  echo "❌ Error: Role ${ROLE_NAME} not found"
  exit 1
fi
echo "✅ Role ARN: ${ROLE_ARN}"

echo ""
echo "🚀 Step 3: Creating/Updating Lambda function..."

# Check if function exists
FUNCTION_EXISTS=$(aws lambda get-function \
  --function-name "${FUNCTION_NAME}" \
  --profile "${PROFILE}" \
  --region "${AWS_REGION}" \
  2>&1 || echo "NOT_FOUND")

if [[ "$FUNCTION_EXISTS" == *"NOT_FOUND"* ]]; then
  
  echo "📝 Function does not exist. Creating new..."
  
  aws lambda create-function \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs18.x \
    --role "${ROLE_ARN}" \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --timeout 30 \
    --memory-size 512 \
    --environment "Variables={
      PERFORMANCE_METRICS_TABLE=${PERFORMANCE_METRICS_TABLE},
      WAVE_OFFERS_TABLE=${WAVE_OFFERS_TABLE},
      DRIVER_LIVE_STATE_TABLE=${DRIVER_LIVE_STATE_TABLE},
      ORDERS_TABLE=${ORDERS_TABLE},
      WINDOW_SIZE=${WINDOW_SIZE}
    }" \
    --profile "${PROFILE}" \
    --region "${AWS_REGION}"
  
  echo "✅ Lambda function created"
  
else
  
  echo "🔄 Function exists. Updating code..."
  
  aws lambda update-function-code \
    --function-name "${FUNCTION_NAME}" \
    --zip-file fileb://function.zip \
    --profile "${PROFILE}" \
    --region "${AWS_REGION}"
  
  echo "⏳ Waiting for update to complete..."
  sleep 3
  
  echo "🔄 Updating configuration..."
  
  aws lambda update-function-configuration \
    --function-name "${FUNCTION_NAME}" \
    --timeout 30 \
    --memory-size 512 \
    --environment "Variables={
      PERFORMANCE_METRICS_TABLE=${PERFORMANCE_METRICS_TABLE},
      WAVE_OFFERS_TABLE=${WAVE_OFFERS_TABLE},
      DRIVER_LIVE_STATE_TABLE=${DRIVER_LIVE_STATE_TABLE},
      ORDERS_TABLE=${ORDERS_TABLE},
      WINDOW_SIZE=${WINDOW_SIZE}
    }" \
    --profile "${PROFILE}" \
    --region "${AWS_REGION}"
  
  echo "✅ Lambda function updated"
fi

# Get Lambda ARN
LAMBDA_ARN=$(aws lambda get-function \
  --function-name "${FUNCTION_NAME}" \
  --query 'Configuration.FunctionArn' \
  --output text \
  --profile "${PROFILE}" \
  --region "${AWS_REGION}")

echo "✅ Lambda ARN: ${LAMBDA_ARN}"

echo ""
echo "🔗 Step 4: Setting up DynamoDB Stream triggers..."

# ==================================
# Configure Stream for WaveOffers
# ==================================
echo ""
echo "📊 Configuring Stream for WaveOffers..."

WAVE_OFFERS_STREAM_ARN=$(aws dynamodb describe-table \
  --table-name "${WAVE_OFFERS_TABLE}" \
  --query 'Table.LatestStreamArn' \
  --output text \
  --profile "${PROFILE}" \
  --region "${AWS_REGION}")

if [ "$WAVE_OFFERS_STREAM_ARN" == "None" ] || [ -z "$WAVE_OFFERS_STREAM_ARN" ]; then
  echo "⚠️  WaveOffers Stream not enabled. Enabling..."
  
  aws dynamodb update-table \
    --table-name "${WAVE_OFFERS_TABLE}" \
    --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES \
    --profile "${PROFILE}" \
    --region "${AWS_REGION}"
  
  echo "⏳ Waiting for Stream to be enabled..."
  sleep 10
  
  WAVE_OFFERS_STREAM_ARN=$(aws dynamodb describe-table \
    --table-name "${WAVE_OFFERS_TABLE}" \
    --query 'Table.LatestStreamArn' \
    --output text \
    --profile "${PROFILE}" \
    --region "${AWS_REGION}")
fi

echo "✅ WaveOffers Stream ARN: ${WAVE_OFFERS_STREAM_ARN}"

# Check if event source mapping already exists
WAVE_OFFERS_MAPPING=$(aws lambda list-event-source-mappings \
  --function-name "${FUNCTION_NAME}" \
  --event-source-arn "${WAVE_OFFERS_STREAM_ARN}" \
  --query 'EventSourceMappings[0].UUID' \
  --output text \
  --profile "${PROFILE}" \
  --region "${AWS_REGION}" \
  2>&1 || echo "None")

if [ "$WAVE_OFFERS_MAPPING" == "None" ]; then
  
  echo "🔗 Creating event source mapping for WaveOffers..."
  
  aws lambda create-event-source-mapping \
    --function-name "${FUNCTION_NAME}" \
    --event-source-arn "${WAVE_OFFERS_STREAM_ARN}" \
    --starting-position LATEST \
    --batch-size 10 \
    --maximum-batching-window-in-seconds 5 \
    --profile "${PROFILE}" \
    --region "${AWS_REGION}"
  
  echo "✅ Event source mapping created for WaveOffers"
else
  echo "✅ Event source mapping already exists for WaveOffers (UUID: ${WAVE_OFFERS_MAPPING})"
fi

# ==================================
# Configure Stream for WizzOrders
# ==================================
echo ""
echo "📊 Configuring Stream for WizzOrders..."

ORDERS_STREAM_ARN=$(aws dynamodb describe-table \
  --table-name "${ORDERS_TABLE}" \
  --query 'Table.LatestStreamArn' \
  --output text \
  --profile "${PROFILE}" \
  --region "${AWS_REGION}")

if [ "$ORDERS_STREAM_ARN" == "None" ] || [ -z "$ORDERS_STREAM_ARN" ]; then
  echo "⚠️  WizzOrders Stream not enabled. Enabling..."
  
  aws dynamodb update-table \
    --table-name "${ORDERS_TABLE}" \
    --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES \
    --profile "${PROFILE}" \
    --region "${AWS_REGION}"
  
  echo "⏳ Waiting for Stream to be enabled..."
  sleep 10
  
  ORDERS_STREAM_ARN=$(aws dynamodb describe-table \
    --table-name "${ORDERS_TABLE}" \
    --query 'Table.LatestStreamArn' \
    --output text \
    --profile "${PROFILE}" \
    --region "${AWS_REGION}")
fi

echo "✅ WizzOrders Stream ARN: ${ORDERS_STREAM_ARN}"

# Check if event source mapping already exists
ORDERS_MAPPING=$(aws lambda list-event-source-mappings \
  --function-name "${FUNCTION_NAME}" \
  --event-source-arn "${ORDERS_STREAM_ARN}" \
  --query 'EventSourceMappings[0].UUID' \
  --output text \
  --profile "${PROFILE}" \
  --region "${AWS_REGION}" \
  2>&1 || echo "None")

if [ "$ORDERS_MAPPING" == "None" ]; then
  
  echo "🔗 Creating event source mapping for WizzOrders..."
  
  aws lambda create-event-source-mapping \
    --function-name "${FUNCTION_NAME}" \
    --event-source-arn "${ORDERS_STREAM_ARN}" \
    --starting-position LATEST \
    --batch-size 10 \
    --maximum-batching-window-in-seconds 5 \
    --profile "${PROFILE}" \
    --region "${AWS_REGION}"
  
  echo "✅ Event source mapping created for WizzOrders"
else
  echo "✅ Event source mapping already exists for WizzOrders (UUID: ${ORDERS_MAPPING})"
fi

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "📊 Lambda Function: ${FUNCTION_NAME}"
echo "   ARN: ${LAMBDA_ARN}"
echo ""
echo "🔗 DynamoDB Streams Configured:"
echo "   - WaveOffers → UpdateDriverMetrics"
echo "   - WizzOrders → UpdateDriverMetrics"
echo ""
echo "📈 Metrics Tracking:"
echo "   - Acceptance Rate (last ${WINDOW_SIZE} offers)"
echo "   - Completion Rate (last ${WINDOW_SIZE} offers)"
echo "   - Consecutive Rejections"
echo "   - Lifetime counters"
echo ""
echo "🔄 Automatic sync to WizzDriverLiveState enabled"
echo ""
echo "=========================================="
