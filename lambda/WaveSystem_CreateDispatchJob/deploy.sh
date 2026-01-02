#!/bin/bash

# ============================================
# CreateDispatchJob Lambda Deployment Script
# ============================================

FUNCTION_NAME="WaveSystem_CreateDispatchJob"
REGION="us-east-1"
ROLE_NAME="lambda-execution-role"
AWS_PROFILE="${AWS_PROFILE:-}"

: "${DISPATCH_JOBS_TABLE:?Set DISPATCH_JOBS_TABLE}"

ORDERS_TABLE="${ORDERS_TABLE:-WizzOrders}"
BUSINESSES_TABLE="${BUSINESSES_TABLE:-Businesses}"
START_WAVE_LAMBDA="${START_WAVE_LAMBDA:-WaveSystem_StartWave}"

PROFILE_ARGS=()
if [ -n "$AWS_PROFILE" ]; then
  PROFILE_ARGS+=(--profile "$AWS_PROFILE")
fi

echo "📦 Preparing deployment package for ${FUNCTION_NAME}..."

# إنشاء مجلد مؤقت
rm -rf package
mkdir -p package

# نسخ الملفات
cp index.js package/
cp package.json package/

# تثبيت dependencies
cd package
npm install --production
cd ..

# إنشاء ZIP
rm -f function.zip
cd package
zip -r ../function.zip .
cd ..

echo "✅ Deployment package created: function.zip"

# ============================================
# التحقق من وجود IAM Role
# ============================================

echo "🔍 Checking IAM Role..."

ROLE_ARN=$(aws iam get-role --role-name ${ROLE_NAME} --query 'Role.Arn' --output text "${PROFILE_ARGS[@]}" 2>/dev/null)

if [ -z "$ROLE_ARN" ]; then
  echo "❌ IAM Role ${ROLE_NAME} not found!"
  echo "📝 Please create the role with the following permissions:"
  echo "   - AWSLambdaBasicExecutionRole (for CloudWatch Logs)"
  echo "   - DynamoDB permissions (PutItem, UpdateItem, GetItem on DISPATCH_JOBS_TABLE, ORDERS_TABLE, BUSINESSES_TABLE)"
  echo "   - Lambda invoke permission (for StartWave Lambda)"
  echo "   - DynamoDB Streams permission (for reading from WizzOrders stream)"
  exit 1
fi

echo "✅ IAM Role found: ${ROLE_ARN}"

# ============================================
# التحقق من وجود Lambda Function
# ============================================

echo "🔍 Checking if Lambda function exists..."

FUNCTION_EXISTS=$(aws lambda get-function --function-name ${FUNCTION_NAME} --region ${REGION} "${PROFILE_ARGS[@]}" 2>/dev/null)

if [ -z "$FUNCTION_EXISTS" ]; then
  # إنشاء Lambda function جديدة
  echo "📝 Creating new Lambda function..."
  
  aws lambda create-function \
    --function-name ${FUNCTION_NAME} \
    --runtime nodejs18.x \
    --role ${ROLE_ARN} \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --timeout 30 \
    --memory-size 256 \
    --region ${REGION} \
    --environment Variables="{DISPATCH_JOBS_TABLE=${DISPATCH_JOBS_TABLE},ORDERS_TABLE=${ORDERS_TABLE},BUSINESSES_TABLE=${BUSINESSES_TABLE},START_WAVE_LAMBDA=${START_WAVE_LAMBDA}}" \
    --description "Creates DispatchJob when order status changes to ready_for_pickup" \
    "${PROFILE_ARGS[@]}"
  
  echo "✅ Lambda function created successfully"
  
else
  # تحديث Lambda function موجودة
  echo "🔄 Updating existing Lambda function..."
  
  aws lambda update-function-code \
    --function-name ${FUNCTION_NAME} \
    --zip-file fileb://function.zip \
    --region ${REGION} \
    "${PROFILE_ARGS[@]}"
  
  echo "✅ Lambda function code updated"
  
  # تحديث configuration
  aws lambda update-function-configuration \
    --function-name ${FUNCTION_NAME} \
    --timeout 30 \
    --memory-size 256 \
    --region ${REGION} \
    --environment Variables="{DISPATCH_JOBS_TABLE=${DISPATCH_JOBS_TABLE},ORDERS_TABLE=${ORDERS_TABLE},BUSINESSES_TABLE=${BUSINESSES_TABLE},START_WAVE_LAMBDA=${START_WAVE_LAMBDA}}" \
    "${PROFILE_ARGS[@]}"
  
  echo "✅ Lambda function configuration updated"
fi

# ============================================
# تنظيف
# ============================================

rm -rf package
# rm function.zip  # نبقيها للمراجعة

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Create dispatch jobs table (DISPATCH_JOBS_TABLE) if not exists"
echo "   2. Enable DynamoDB Stream on WizzOrders table"
echo "   3. Add Lambda trigger: WizzOrders Stream → ${FUNCTION_NAME}"
echo "   4. Deploy StartWave Lambda function"
echo "   5. Test with a ready_for_pickup order"
echo ""
echo "📄 For detailed instructions, see: WAVE_SYSTEM_PLAN_PART_4_ORDER_FLOW.md"
