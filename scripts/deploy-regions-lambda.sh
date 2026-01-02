#!/bin/bash

# Script لنشر Lambda Functions لنظام المناطق
# Day 2: Lambda Functions Deployment

set -e

echo "🚀 بدء نشر Lambda Functions لنظام المناطق"
echo "================================================"

# المتغيرات
ENVIRONMENT="dev"
STACK_NAME="WizzCentral-Regions-Lambda-Stack-${ENVIRONMENT}"
REGION="us-east-1"
ACCOUNT_ID="031857856164"

# ARN للـ Stream
STREAM_ARN="arn:aws:dynamodb:us-east-1:031857856164:table/WizzCentral_Regions/stream/2025-11-09T05:11:17.785"

# المجلدات
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LAMBDA_DIR="$PROJECT_ROOT/lambda"
BUILD_DIR="$PROJECT_ROOT/build/lambda"

echo ""
echo "📦 تحضير Lambda Functions..."
echo "================================"

# إنشاء مجلد البناء
mkdir -p "$BUILD_DIR"

# ========================================
# Lambda #1: RegionPropagationEngine
# ========================================
echo ""
echo "🔨 بناء RegionPropagationEngine..."

LAMBDA1_NAME="RegionPropagationEngine"
LAMBDA1_DIR="$LAMBDA_DIR/$LAMBDA1_NAME"
LAMBDA1_BUILD="$BUILD_DIR/$LAMBDA1_NAME"

# نسخ الكود
mkdir -p "$LAMBDA1_BUILD"
cp "$LAMBDA1_DIR/index.js" "$LAMBDA1_BUILD/"
cp "$LAMBDA1_DIR/package.json" "$LAMBDA1_BUILD/"

# تثبيت Dependencies
cd "$LAMBDA1_BUILD"
npm install --production --no-optional
cd -

# إنشاء ZIP
cd "$LAMBDA1_BUILD"
zip -r "../${LAMBDA1_NAME}.zip" . -x "*.git*"
cd -

echo "✅ تم بناء ${LAMBDA1_NAME}.zip"

# ========================================
# Lambda #2: SpatialIndexBuilder
# ========================================
echo ""
echo "🔨 بناء SpatialIndexBuilder..."

LAMBDA2_NAME="SpatialIndexBuilder"
LAMBDA2_DIR="$LAMBDA_DIR/$LAMBDA2_NAME"
LAMBDA2_BUILD="$BUILD_DIR/$LAMBDA2_NAME"

mkdir -p "$LAMBDA2_BUILD"
cp "$LAMBDA2_DIR/index.js" "$LAMBDA2_BUILD/"
cp "$LAMBDA2_DIR/package.json" "$LAMBDA2_BUILD/"

cd "$LAMBDA2_BUILD"
npm install --production --no-optional
cd -

cd "$LAMBDA2_BUILD"
zip -r "../${LAMBDA2_NAME}.zip" . -x "*.git*"
cd -

echo "✅ تم بناء ${LAMBDA2_NAME}.zip"

# ========================================
# Lambda #3: NeighborDiscoveryEngine
# ========================================
echo ""
echo "🔨 بناء NeighborDiscoveryEngine..."

LAMBDA3_NAME="NeighborDiscoveryEngine"
LAMBDA3_DIR="$LAMBDA_DIR/$LAMBDA3_NAME"
LAMBDA3_BUILD="$BUILD_DIR/$LAMBDA3_NAME"

mkdir -p "$LAMBDA3_BUILD"
cp "$LAMBDA3_DIR/index.js" "$LAMBDA3_BUILD/"
cp "$LAMBDA3_DIR/package.json" "$LAMBDA3_BUILD/"

cd "$LAMBDA3_BUILD"
npm install --production --no-optional
cd -

cd "$LAMBDA3_BUILD"
zip -r "../${LAMBDA3_NAME}.zip" . -x "*.git*"
cd -

echo "✅ تم بناء ${LAMBDA3_NAME}.zip"

# ========================================
# نشر CloudFormation Stack
# ========================================
echo ""
echo "☁️  نشر CloudFormation Stack..."
echo "================================"

# التحقق من وجود Stack
STACK_EXISTS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" 2>&1 || echo "does-not-exist")

if [[ $STACK_EXISTS == *"does-not-exist"* ]]; then
    echo "📝 إنشاء Stack جديد..."
    
    aws cloudformation create-stack \
        --stack-name "$STACK_NAME" \
        --template-body "file://$PROJECT_ROOT/cloudformation/regions-lambda-stack.yaml" \
        --parameters \
            ParameterKey=Environment,ParameterValue="$ENVIRONMENT" \
            ParameterKey=RegionsTableStreamArn,ParameterValue="$STREAM_ARN" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$REGION"
    
    echo "⏳ انتظار إنشاء Stack..."
    aws cloudformation wait stack-create-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION"
    
    echo "✅ تم إنشاء Stack بنجاح"
else
    echo "🔄 تحديث Stack موجود..."
    
    aws cloudformation update-stack \
        --stack-name "$STACK_NAME" \
        --template-body "file://$PROJECT_ROOT/cloudformation/regions-lambda-stack.yaml" \
        --parameters \
            ParameterKey=Environment,ParameterValue="$ENVIRONMENT" \
            ParameterKey=RegionsTableStreamArn,ParameterValue="$STREAM_ARN" \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$REGION" || echo "⚠️  لا توجد تغييرات للتحديث"
    
    echo "⏳ انتظار تحديث Stack..."
    aws cloudformation wait stack-update-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION" || echo "⚠️  لم يتم التحديث"
fi

# ========================================
# رفع Lambda Code
# ========================================
echo ""
echo "📤 رفع Lambda Functions Code..."
echo "================================"

# Lambda #1
echo ""
echo "📤 رفع RegionPropagationEngine..."
aws lambda update-function-code \
    --function-name "WizzCentral-RegionPropagationEngine-${ENVIRONMENT}" \
    --zip-file "fileb://$BUILD_DIR/${LAMBDA1_NAME}.zip" \
    --region "$REGION"
echo "✅ تم رفع RegionPropagationEngine"

# Lambda #2
echo ""
echo "📤 رفع SpatialIndexBuilder..."
aws lambda update-function-code \
    --function-name "WizzCentral-SpatialIndexBuilder-${ENVIRONMENT}" \
    --zip-file "fileb://$BUILD_DIR/${LAMBDA2_NAME}.zip" \
    --region "$REGION"
echo "✅ تم رفع SpatialIndexBuilder"

# Lambda #3
echo ""
echo "📤 رفع NeighborDiscoveryEngine..."
aws lambda update-function-code \
    --function-name "WizzCentral-NeighborDiscoveryEngine-${ENVIRONMENT}" \
    --zip-file "fileb://$BUILD_DIR/${LAMBDA3_NAME}.zip" \
    --region "$REGION"
echo "✅ تم رفع NeighborDiscoveryEngine"

# ========================================
# التحقق من النشر
# ========================================
echo ""
echo "🔍 التحقق من Lambda Functions..."
echo "================================"

for FUNC_NAME in \
    "WizzCentral-RegionPropagationEngine-${ENVIRONMENT}" \
    "WizzCentral-SpatialIndexBuilder-${ENVIRONMENT}" \
    "WizzCentral-NeighborDiscoveryEngine-${ENVIRONMENT}"
do
    echo ""
    echo "📊 Function: $FUNC_NAME"
    
    # جلب معلومات الـ function
    FUNC_INFO=$(aws lambda get-function \
        --function-name "$FUNC_NAME" \
        --region "$REGION")
    
    STATE=$(echo "$FUNC_INFO" | jq -r '.Configuration.State')
    LAST_UPDATE=$(echo "$FUNC_INFO" | jq -r '.Configuration.LastUpdateStatus')
    
    echo "   State: $STATE"
    echo "   Last Update: $LAST_UPDATE"
    
    # جلب Event Source Mappings
    MAPPINGS=$(aws lambda list-event-source-mappings \
        --function-name "$FUNC_NAME" \
        --region "$REGION")
    
    MAPPING_COUNT=$(echo "$MAPPINGS" | jq -r '.EventSourceMappings | length')
    echo "   Event Source Mappings: $MAPPING_COUNT"
    
    if [ "$MAPPING_COUNT" -gt 0 ]; then
        echo "$MAPPINGS" | jq -r '.EventSourceMappings[] | "   - State: \(.State), Batch Size: \(.BatchSize)"'
    fi
done

# ========================================
# النتيجة النهائية
# ========================================
echo ""
echo "============================================"
echo "✅ اكتمل نشر Lambda Functions بنجاح!"
echo "============================================"
echo ""
echo "📊 ملخص:"
echo "   - Stack: $STACK_NAME"
echo "   - Region: $REGION"
echo "   - Environment: $ENVIRONMENT"
echo ""
echo "🔗 Lambda Functions:"
echo "   1. WizzCentral-RegionPropagationEngine-${ENVIRONMENT}"
echo "   2. WizzCentral-SpatialIndexBuilder-${ENVIRONMENT}"
echo "   3. WizzCentral-NeighborDiscoveryEngine-${ENVIRONMENT}"
echo ""
echo "📝 للمتابعة: راجع CloudWatch Logs"
echo "   aws logs tail /aws/lambda/WizzCentral-RegionPropagationEngine-${ENVIRONMENT} --follow"
echo ""
