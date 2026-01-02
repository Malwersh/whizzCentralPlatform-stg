#!/bin/bash

# ========================================
# سكريبت نشر جداول المناطق الخمسة على AWS
# ========================================

set -e  # إيقاف السكريبت عند أي خطأ

# الألوان للتنسيق
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   🚀 نشر جداول نظام المناطق المتكامل${NC}"
echo -e "${BLUE}════════════════════════════════════════════════${NC}"

# البيئة (dev, staging, prod)
ENVIRONMENT=${1:-dev}
STACK_NAME="WizzCentral-Regions-New-Tables-Stack-${ENVIRONMENT}"
TEMPLATE_FILE="cloudformation/regions-new-tables-stack.yaml"
AWS_PROFILE="Wizz_dev_UserApp"

echo -e "\n${YELLOW}📋 معلومات النشر:${NC}"
echo "   Environment: $ENVIRONMENT"
echo "   Stack Name: $STACK_NAME"
echo "   AWS Profile: $AWS_PROFILE"
echo "   Template: $TEMPLATE_FILE"

# التحقق من وجود Template
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo -e "\n${RED}❌ خطأ: لم يتم العثور على Template في $TEMPLATE_FILE${NC}"
    exit 1
fi

echo -e "\n${BLUE}🔍 التحقق من Template...${NC}"
aws cloudformation validate-template \
    --template-body file://$TEMPLATE_FILE \
    --profile $AWS_PROFILE \
    --output text > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Template صحيح${NC}"
else
    echo -e "${RED}❌ Template يحتوي على أخطاء${NC}"
    exit 1
fi

# التحقق من وجود Stack مسبقاً
echo -e "\n${BLUE}🔍 التحقق من وجود Stack مسبقاً...${NC}"
STACK_EXISTS=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --profile $AWS_PROFILE \
    --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$STACK_EXISTS" != "NOT_FOUND" ]; then
    echo -e "${YELLOW}⚠️  Stack موجود مسبقاً. سيتم التحديث (Update)${NC}"
    OPERATION="update-stack"
    OPERATION_TEXT="تحديث"
else
    echo -e "${GREEN}✨ Stack جديد. سيتم الإنشاء (Create)${NC}"
    OPERATION="create-stack"
    OPERATION_TEXT="إنشاء"
fi

# تأكيد من المستخدم
echo -e "\n${YELLOW}⚠️  هل تريد المتابعة مع ${OPERATION_TEXT} Stack؟${NC}"
echo -e "${YELLOW}   سيتم إنشاء 4 جداول DynamoDB جديدة:${NC}"
echo "   1. WizzCentral_RegionsDerived_${ENVIRONMENT}"
echo "   2. WizzCentral_RegionNeighbors_${ENVIRONMENT}"
echo "   3. WizzCentral_RegionIndex_${ENVIRONMENT}"
echo "   4. WizzCentral_RegionAudit_${ENVIRONMENT}"
echo ""
echo -e "${BLUE}   ملاحظة: WizzCentral_Regions موجود مسبقاً ولن يتم تعديله${NC}"
echo ""
read -p "اكتب 'yes' للمتابعة: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${RED}❌ تم الإلغاء${NC}"
    exit 0
fi

# نشر Stack
echo -e "\n${BLUE}🚀 ${OPERATION_TEXT} Stack...${NC}"

if [ "$OPERATION" = "create-stack" ]; then
    aws cloudformation create-stack \
        --stack-name $STACK_NAME \
        --template-body file://$TEMPLATE_FILE \
        --parameters ParameterKey=Environment,ParameterValue=$ENVIRONMENT \
        --capabilities CAPABILITY_IAM \
        --profile $AWS_PROFILE \
        --output text
    
    echo -e "\n${YELLOW}⏳ انتظار إكمال الإنشاء... (قد يستغرق 5-10 دقائق)${NC}"
    aws cloudformation wait stack-create-complete \
        --stack-name $STACK_NAME \
        --profile $AWS_PROFILE
else
    aws cloudformation update-stack \
        --stack-name $STACK_NAME \
        --template-body file://$TEMPLATE_FILE \
        --parameters ParameterKey=Environment,ParameterValue=$ENVIRONMENT \
        --capabilities CAPABILITY_IAM \
        --profile $AWS_PROFILE \
        --output text
    
    echo -e "\n${YELLOW}⏳ انتظار إكمال التحديث... (قد يستغرق 5-10 دقائق)${NC}"
    aws cloudformation wait stack-update-complete \
        --stack-name $STACK_NAME \
        --profile $AWS_PROFILE
fi

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✅ تم ${OPERATION_TEXT} Stack بنجاح!${NC}"
else
    echo -e "\n${RED}❌ فشل ${OPERATION_TEXT} Stack${NC}"
    exit 1
fi

# عرض معلومات Stack
echo -e "\n${BLUE}📊 معلومات Stack:${NC}"
aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --profile $AWS_PROFILE \
    --query 'Stacks[0].{Status:StackStatus,Created:CreationTime}' \
    --output table

# عرض Outputs
echo -e "\n${BLUE}📋 Outputs:${NC}"
aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --profile $AWS_PROFILE \
    --query 'Stacks[0].Outputs[*].{Key:OutputKey,Value:OutputValue}' \
    --output table

# عرض أسماء الجداول
echo -e "\n${GREEN}✅ تم إنشاء الجداول التالية:${NC}"
aws dynamodb list-tables \
    --profile $AWS_PROFILE \
    --query "TableNames[?contains(@, 'WizzCentral_Region')]" \
    --output table

# التحقق من Streams
echo -e "\n${BLUE}🔄 التحقق من DynamoDB Streams...${NC}"
for TABLE in "WizzCentral_Regions" "WizzCentral_RegionsDerived_${ENVIRONMENT}"; do
    STREAM_ARN=$(aws dynamodb describe-table \
        --table-name $TABLE \
        --profile $AWS_PROFILE \
        --query 'Table.LatestStreamArn' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$STREAM_ARN" != "NOT_FOUND" ] && [ "$STREAM_ARN" != "None" ]; then
        echo -e "${GREEN}   ✅ $TABLE: Stream Active${NC}"
        echo "      ARN: $STREAM_ARN"
    else
        echo -e "${YELLOW}   ⚠️  $TABLE: No Stream${NC}"
    fi
done

echo -e "\n${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   ✅ النشر اكتمل بنجاح!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"

echo -e "\n${YELLOW}📝 الخطوات التالية:${NC}"
echo "1. التحقق من الجداول: ./scripts/verify-tables.sh"
echo "2. اختبار القراءة/الكتابة: ./scripts/test-tables.sh"
echo "3. نشر Lambda Functions: ./scripts/deploy-lambdas.sh"
echo "4. ترحيل البيانات: ./scripts/migrate-data.sh"

echo ""
