#!/bin/bash

# ========================================
# سكريبت التحقق من جداول المناطق
# ========================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ENVIRONMENT=${1:-dev}
AWS_PROFILE="Wizz_dev_UserApp"

echo -e "${BLUE}════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   🔍 التحقق من جداول المناطق${NC}"
echo -e "${BLUE}════════════════════════════════════════════════${NC}"

# الجداول المتوقعة
TABLES=(
    "WizzCentral_Regions"
    "WizzCentral_RegionsDerived_${ENVIRONMENT}"
    "WizzCentral_RegionNeighbors_${ENVIRONMENT}"
    "WizzCentral_RegionIndex_${ENVIRONMENT}"
    "WizzCentral_RegionAudit_${ENVIRONMENT}"
)

echo -e "\n${YELLOW}📋 فحص وجود الجداول...${NC}\n"

ALL_OK=true

for TABLE in "${TABLES[@]}"; do
    echo -e "${BLUE}🔍 فحص: $TABLE${NC}"
    
    # التحقق من وجود الجدول
    TABLE_STATUS=$(aws dynamodb describe-table \
        --table-name "$TABLE" \
        --profile $AWS_PROFILE \
        --query 'Table.TableStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$TABLE_STATUS" = "ACTIVE" ]; then
        echo -e "${GREEN}   ✅ الحالة: ACTIVE${NC}"
        
        # عرض معلومات الجدول
        INFO=$(aws dynamodb describe-table \
            --table-name "$TABLE" \
            --profile $AWS_PROFILE \
            --query 'Table.{ItemCount:ItemCount,SizeBytes:TableSizeBytes,GSIs:length(GlobalSecondaryIndexes),Stream:StreamSpecification.StreamEnabled}' \
            --output json)
        
        ITEM_COUNT=$(echo $INFO | jq -r '.ItemCount')
        SIZE_BYTES=$(echo $INFO | jq -r '.SizeBytes')
        GSI_COUNT=$(echo $INFO | jq -r '.GSIs // 0')
        STREAM_ENABLED=$(echo $INFO | jq -r '.Stream // false')
        
        echo "   📊 عدد السجلات: $ITEM_COUNT"
        echo "   💾 الحجم: $(numfmt --to=iec-i --suffix=B $SIZE_BYTES 2>/dev/null || echo "${SIZE_BYTES} bytes")"
        echo "   🔍 عدد GSIs: $GSI_COUNT"
        echo "   🔄 Stream: $STREAM_ENABLED"
        
        # فحص GSIs
        if [ "$GSI_COUNT" -gt 0 ]; then
            echo -e "\n   ${BLUE}GSIs:${NC}"
            aws dynamodb describe-table \
                --table-name "$TABLE" \
                --profile $AWS_PROFILE \
                --query 'Table.GlobalSecondaryIndexes[*].{Name:IndexName,Status:IndexStatus}' \
                --output table | sed 's/^/   /'
        fi
        
        # فحص Stream ARN
        if [ "$STREAM_ENABLED" = "true" ]; then
            STREAM_ARN=$(aws dynamodb describe-table \
                --table-name "$TABLE" \
                --profile $AWS_PROFILE \
                --query 'Table.LatestStreamArn' \
                --output text)
            echo "   📡 Stream ARN: ${STREAM_ARN}"
        fi
        
    elif [ "$TABLE_STATUS" = "NOT_FOUND" ]; then
        echo -e "${RED}   ❌ الجدول غير موجود${NC}"
        ALL_OK=false
    else
        echo -e "${YELLOW}   ⚠️  الحالة: $TABLE_STATUS${NC}"
        ALL_OK=false
    fi
    
    echo ""
done

# فحص خاص لـ WizzCentral_Regions (يجب أن يحتوي على البيانات الحالية)
echo -e "${BLUE}🔍 فحص خاص: WizzCentral_Regions (البيانات الحالية)${NC}"
CURRENT_REGIONS=$(aws dynamodb scan \
    --table-name "WizzCentral_Regions" \
    --profile $AWS_PROFILE \
    --select "COUNT" \
    --output text 2>/dev/null | awk '{print $2}')

if [ "$CURRENT_REGIONS" -ge 5 ]; then
    echo -e "${GREEN}   ✅ يحتوي على $CURRENT_REGIONS مناطق (متوقع: 5+)${NC}"
    
    # عرض عينة
    echo -e "\n   ${BLUE}عينة من المناطق:${NC}"
    aws dynamodb scan \
        --table-name "WizzCentral_Regions" \
        --profile $AWS_PROFILE \
        --max-items 3 \
        --query 'Items[*].{RegionID:regionId.S,Name:name.S,Level:level.N}' \
        --output table | sed 's/^/   /'
else
    echo -e "${YELLOW}   ⚠️  يحتوي على $CURRENT_REGIONS مناطق فقط${NC}"
    echo -e "${YELLOW}   قد تحتاج لتشغيل سكريبت الترحيل${NC}"
fi

echo ""

# النتيجة النهائية
if [ "$ALL_OK" = true ]; then
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}   ✅ جميع الجداول جاهزة!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    exit 0
else
    echo -e "${RED}════════════════════════════════════════════════${NC}"
    echo -e "${RED}   ❌ بعض الجداول بها مشاكل${NC}"
    echo -e "${RED}════════════════════════════════════════════════${NC}"
    exit 1
fi
