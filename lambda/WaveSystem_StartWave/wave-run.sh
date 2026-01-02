#!/bin/bash

# Wave System Simulator - Quick Run Script

PROFILE_ARGS=()
if [ -n "${AWS_PROFILE:-}" ]; then
  PROFILE_ARGS+=(--profile "$AWS_PROFILE")
fi

case "$1" in
  simulate|sim)
    echo "🌊 تشغيل المحاكاة المحلية..."
    node wave-simulator.js simulate
    ;;
  
  add)
    echo "➕ إضافة السائقين التجريبيين للنظام..."
    node wave-simulator.js add
    ;;
  
  remove|clean)
    echo "🗑️  حذف السائقين التجريبيين من النظام..."
    node wave-simulator.js remove
    ;;
  
  test)
    echo "🧪 عرض إرشادات الاختبار..."
    node wave-simulator.js test
    ;;
  
  logs)
    echo "📊 مراقبة سجلات StartWave..."
    aws logs tail /aws/lambda/WaveSystem_StartWave \
      "${PROFILE_ARGS[@]}" \
      --follow \
      --format short
    ;;
  
  check)
    echo "🔍 التحقق من السائقين التجريبيين في النظام..."
    aws dynamodb scan \
      --table-name WizzDriverLiveState \
      --filter-expression "begins_with(driverId, :prefix)" \
      --expression-attribute-values '{":prefix":{"S":"TEST_DRIVER_"}}' \
      --projection-expression "driverId,#name,#status" \
      --expression-attribute-names '{"#name":"name","#status":"status"}' \
      "${PROFILE_ARGS[@]}"
    ;;
  
  full-test)
    echo "🚀 اختبار كامل (إضافة → انتظار → حذف)..."
    echo ""
    echo "الخطوة 1: إضافة السائقين..."
    node wave-simulator.js add
    echo ""
    echo "الخطوة 2: الآن أنشئ طلب جديد وغيّر حالته إلى ready_for_pickup"
    echo "الخطوة 3: راقب السجلات في نافذة أخرى: ./wave-run.sh logs"
    echo "الخطوة 4: عند الانتهاء، احذف السائقين: ./wave-run.sh remove"
    echo ""
    read -p "اضغط Enter للمتابعة بعد اختبار الطلب..."
    echo ""
    echo "حذف السائقين..."
    node wave-simulator.js remove
    ;;
  
  *)
    echo ""
    echo "📖 Wave System Simulator - الأوامر المتاحة:"
    echo ""
    echo "   ./wave-run.sh simulate    - تشغيل المحاكاة المحلية (آمن)"
    echo "   ./wave-run.sh add         - إضافة السائقين التجريبيين للنظام"
    echo "   ./wave-run.sh remove      - حذف السائقين التجريبيين من النظام"
    echo "   ./wave-run.sh check       - التحقق من السائقين في النظام"
    echo "   ./wave-run.sh test        - عرض إرشادات الاختبار"
    echo "   ./wave-run.sh logs        - مراقبة سجلات Lambda"
    echo "   ./wave-run.sh full-test   - اختبار كامل موجّه"
    echo ""
    echo "أمثلة:"
    echo "   ./wave-run.sh simulate    # اختبار محلي بدون تأثير على النظام"
    echo "   ./wave-run.sh add         # إضافة 8 سائقين تجريبيين"
    echo "   ./wave-run.sh check       # التحقق من السائقين المضافين"
    echo "   ./wave-run.sh remove      # حذف السائقين التجريبيين"
    echo ""
    ;;
esac
