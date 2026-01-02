#!/bin/bash

# ========================================
# Setup API Gateway for Wave System
# ========================================
# 
# Creates HTTP API routes for driver wave acceptance

set -e

AWS_PROFILE="Wizz_dev_UserApp"
REGION="us-east-1"
API_NAME="WhizzDriverAPI"

echo "🔧 Setting up API Gateway for Wave System"
echo "=========================================="
echo ""

# Step 1: Check if API exists
echo "📋 Step 1: Looking for existing API Gateway..."

API_ID=$(aws apigatewayv2 get-apis \
  --region "$REGION" \
  --profile "$AWS_PROFILE" \
  --query "Items[?Name=='$API_NAME'].ApiId | [0]" \
  --output text)

if [ "$API_ID" = "None" ] || [ -z "$API_ID" ]; then
  echo "⚠️  API Gateway '$API_NAME' not found"
  echo "   Creating new HTTP API..."
  
  API_ID=$(aws apigatewayv2 create-api \
    --name "$API_NAME" \
    --protocol-type HTTP \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --query 'ApiId' \
    --output text)
  
  echo "✅ Created API: $API_ID"
else
  echo "✅ Found existing API: $API_ID"
fi

API_ENDPOINT="https://${API_ID}.execute-api.${REGION}.amazonaws.com"
echo "   Endpoint: $API_ENDPOINT"
echo ""

# Step 2: Create integration for HandleDriverAccept
echo "📋 Step 2: Creating integration for HandleDriverAccept..."

LAMBDA_ARN="arn:aws:lambda:${REGION}:031857856164:function:WaveSystem_HandleDriverAccept"

INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type AWS_PROXY \
  --integration-uri "$LAMBDA_ARN" \
  --payload-format-version 2.0 \
  --region "$REGION" \
  --profile "$AWS_PROFILE" \
  --query 'IntegrationId' \
  --output text)

echo "✅ Integration created: $INTEGRATION_ID"
echo ""

# Step 3: Create route POST /driver/accept-wave-offer
echo "📋 Step 3: Creating route POST /driver/accept-wave-offer..."

ROUTE_ID=$(aws apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key "POST /driver/accept-wave-offer" \
  --target "integrations/$INTEGRATION_ID" \
  --region "$REGION" \
  --profile "$AWS_PROFILE" \
  --query 'RouteId' \
  --output text)

echo "✅ Route created: $ROUTE_ID"
echo ""

# Step 4: Grant API Gateway permission to invoke Lambda
echo "📋 Step 4: Granting API Gateway permission..."

aws lambda add-permission \
  --function-name WaveSystem_HandleDriverAccept \
  --statement-id AllowAPIGatewayInvoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:031857856164:${API_ID}/*/*/driver/accept-wave-offer" \
  --region "$REGION" \
  --profile "$AWS_PROFILE" 2>&1 || echo "   (Permission may already exist)"

echo "✅ Permission granted"
echo ""

# Step 5: Create/update default stage
echo "📋 Step 5: Setting up default stage..."

aws apigatewayv2 create-stage \
  --api-id "$API_ID" \
  --stage-name '$default' \
  --auto-deploy \
  --region "$REGION" \
  --profile "$AWS_PROFILE" 2>&1 || echo "   (Stage may already exist)"

echo "✅ Stage configured"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ API Gateway Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Summary:"
echo "  API ID: $API_ID"
echo "  Endpoint: $API_ENDPOINT"
echo ""
echo "🔗 Driver Accept URL:"
echo "  POST $API_ENDPOINT/driver/accept-wave-offer"
echo ""
echo "📝 Test with curl:"
echo "  curl -X POST $API_ENDPOINT/driver/accept-wave-offer \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"driverId\": \"DRV_123\", \"orderId\": \"ORD_456\"}'"
echo ""
echo "📱 Update Flutter app with this endpoint!"
