#!/bin/bash

# ========================================
# Setup EventBridge Rule for Wave Timeouts
# ========================================
# 
# This script creates an EventBridge rule that triggers
# WaveSystem_HandleWaveTimeout every 30 seconds

set -e

AWS_PROFILE="Wizz_dev_UserApp"
REGION="us-east-1"
RULE_NAME="WaveSystem_TimeoutChecker"
LAMBDA_FUNCTION="WaveSystem_HandleWaveTimeout"

echo "⏰ Setting up EventBridge Rule for Wave Timeouts"
echo "================================================"
echo ""

# Step 1: Create EventBridge rule (runs every 30 seconds)
echo "📋 Step 1: Creating EventBridge rule..."
aws events put-rule \
  --name "$RULE_NAME" \
  --schedule-expression "rate(1 minute)" \
  --state ENABLED \
  --description "Triggers WaveSystem_HandleWaveTimeout to check for expired wave offers" \
  --region "$REGION" \
  --profile "$AWS_PROFILE"

echo "✅ EventBridge rule created: $RULE_NAME"
echo "   Schedule: Every 1 minute"
echo ""

# Step 2: Get Lambda function ARN
echo "📋 Step 2: Getting Lambda function ARN..."
LAMBDA_ARN=$(aws lambda get-function \
  --function-name "$LAMBDA_FUNCTION" \
  --region "$REGION" \
  --profile "$AWS_PROFILE" \
  --query 'Configuration.FunctionArn' \
  --output text)

echo "✅ Lambda ARN: $LAMBDA_ARN"
echo ""

# Step 3: Add Lambda as target
echo "📋 Step 3: Adding Lambda as target..."
aws events put-targets \
  --rule "$RULE_NAME" \
  --targets "Id"="1","Arn"="$LAMBDA_ARN" \
  --region "$REGION" \
  --profile "$AWS_PROFILE"

echo "✅ Target added to rule"
echo ""

# Step 4: Grant EventBridge permission to invoke Lambda
echo "📋 Step 4: Granting EventBridge permission..."
RULE_ARN="arn:aws:events:${REGION}:031857856164:rule/${RULE_NAME}"

aws lambda add-permission \
  --function-name "$LAMBDA_FUNCTION" \
  --statement-id AllowEventBridgeInvoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "$RULE_ARN" \
  --region "$REGION" \
  --profile "$AWS_PROFILE" 2>&1 || echo "   (Permission may already exist)"

echo "✅ Permission granted"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ EventBridge Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Summary:"
echo "  Rule Name: $RULE_NAME"
echo "  Schedule: Every 1 minute"
echo "  Target: $LAMBDA_FUNCTION"
echo "  Status: ENABLED"
echo ""
echo "🔍 Monitor executions:"
echo "  CloudWatch Logs: /aws/lambda/WaveSystem_HandleWaveTimeout"
echo ""
echo "⚙️ To disable the rule:"
echo "  aws events disable-rule --name $RULE_NAME --region $REGION --profile $AWS_PROFILE"
echo ""
echo "🗑️ To delete the rule:"
echo "  aws events remove-targets --rule $RULE_NAME --ids 1 --region $REGION --profile $AWS_PROFILE"
echo "  aws events delete-rule --name $RULE_NAME --region $REGION --profile $AWS_PROFILE"
