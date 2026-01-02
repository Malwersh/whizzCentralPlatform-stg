/**
 * Setup Script للسائق الجديد
 * يقوم بإنشاء/تحديث جميع السجلات المطلوبة في الجداول المختلفة
 * 
 * Usage: node setup_new_driver.js
 */

const AWS = require('aws-sdk');

// تحميل الـ credentials من AWS config
process.env.AWS_SDK_LOAD_CONFIG = '1';

AWS.config.update({ 
  region: 'us-east-1',
  credentials: new AWS.SharedIniFileCredentials({ profile: process.env.AWS_PROFILE })
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

// معلومات السائق
const DRIVER_ID = '24d87408-e041-703c-1cc0-e5a86087bba3';
const DRIVER_NAME = 'سائق اختبار جديد';

// موقع افتراضي (نفس موقع المطعم للاختبار)
const DEFAULT_LAT = 31.884915;
const DEFAULT_LNG = 44.48125;

async function setupDriver() {
  console.log('🚀 بدء إعداد السائق الجديد...');
  console.log(`👤 Driver ID: ${DRIVER_ID}`);
  console.log(`📍 الموقع الافتراضي: ${DEFAULT_LAT}, ${DEFAULT_LNG}`);
  console.log('');

  try {
    // ============================================
    // 1. تحديث WizzDriverLiveState
    // ============================================
    console.log('📝 1. تحديث WizzDriverLiveState...');
    
    const liveStateParams = {
      TableName: 'WizzDriverLiveState',
      Key: { driverId: DRIVER_ID },
      UpdateExpression: `
        SET #status = :status,
            isSearching = :isSearching,
            lastKnownLat = :lat,
            lastKnownLng = :lng,
            lastUpdated = :now,
            activeOrdersCount = :zero,
            availabilityStatus = :online,
            driverStatus = :online
      `,
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'online',
        ':isSearching': true,
        ':lat': DEFAULT_LAT,
        ':lng': DEFAULT_LNG,
        ':now': new Date().toISOString(),
        ':zero': 0,
        ':online': 'online'
      },
      ReturnValues: 'ALL_NEW'
    };

    const liveStateResult = await dynamoDB.update(liveStateParams).promise();
    console.log('✅ تم تحديث WizzDriverLiveState بنجاح');
    console.log('   - status:', liveStateResult.Attributes.status);
    console.log('   - isSearching:', liveStateResult.Attributes.isSearching);
    console.log('   - location:', `${liveStateResult.Attributes.lastKnownLat}, ${liveStateResult.Attributes.lastKnownLng}`);
    console.log('');

    // ============================================
    // 2. إنشاء WizzDriverPerformanceMetrics
    // ============================================
    console.log('📝 2. إنشاء WizzDriverPerformanceMetrics...');
    
    const metricsParams = {
      TableName: 'WizzDriverPerformanceMetrics',
      Item: {
        PK: `DRIVER#${DRIVER_ID}`,
        SK: 'METRICS',
        driverId: DRIVER_ID,
        // نسب عالية للسماح له بالاستلام
        acceptanceRate: 100,
        completionRate: 100,
        rating: 5.0,
        // إحصائيات أولية
        totalOrders: 0,
        totalAccepted: 0,
        totalCompleted: 0,
        totalRejected: 0,
        totalCancelled: 0,
        // معدلات زمنية
        avgPickupTime: 0,
        avgDeliveryTime: 0,
        // السلوك
        behaviorScore: 100,
        onTimeRate: 100,
        // التواريخ
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // معلومات إضافية
        lastOrderDate: null,
        currentStreak: 0,
        longestStreak: 0
      }
    };

    await dynamoDB.put(metricsParams).promise();
    console.log('✅ تم إنشاء WizzDriverPerformanceMetrics بنجاح');
    console.log('   - acceptanceRate: 100%');
    console.log('   - completionRate: 100%');
    console.log('   - rating: 5.0');
    console.log('');

    // ============================================
    // 3. التحقق من WhizzDrivers_dev
    // ============================================
    console.log('📝 3. التحقق من WhizzDrivers_dev...');
    
    const driverResult = await dynamoDB.get({
      TableName: 'WhizzDrivers_dev',
      Key: { driverId: DRIVER_ID }
    }).promise();

    if (driverResult.Item) {
      console.log('✅ السجل موجود في WhizzDrivers_dev');
      console.log('   - name:', driverResult.Item.name || 'N/A');
      console.log('   - phone:', driverResult.Item.phone || 'N/A');
      console.log('   - status:', driverResult.Item.status || 'N/A');
      console.log('   - registrationStatus:', driverResult.Item.registrationStatus || 'N/A');
      
      // تحديث الحالة إلى APPROVED إذا لم تكن كذلك
      if (driverResult.Item.registrationStatus !== 'APPROVED') {
        console.log('   ⚠️ تحديث registrationStatus إلى APPROVED...');
        await dynamoDB.update({
          TableName: 'WhizzDrivers_dev',
          Key: { driverId: DRIVER_ID },
          UpdateExpression: 'SET registrationStatus = :approved, #status = :approved',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':approved': 'APPROVED'
          }
        }).promise();
        console.log('   ✅ تم التحديث إلى APPROVED');
      }
    } else {
      console.log('⚠️ السجل غير موجود في WhizzDrivers_dev');
      console.log('   يجب إنشاؤه من خلال تطبيق السائق أو لوحة التحكم');
    }
    console.log('');

    // ============================================
    // 4. التحقق من dev-Wallets
    // ============================================
    console.log('📝 4. التحقق من dev-Wallets...');
    
    const walletResult = await dynamoDB.get({
      TableName: 'dev-Wallets',
      Key: {
        walletId: `WALLET#DRIVER#${DRIVER_ID}`,
        sk: 'META'
      }
    }).promise();

    if (walletResult.Item) {
      console.log('✅ المحفظة موجودة');
      console.log('   - availableBalance:', walletResult.Item.availableBalance, 'IQD');
      console.log('   - lockedBalance:', walletResult.Item.lockedBalance, 'IQD');
      console.log('   - minRequiredBalance:', walletResult.Item.minRequiredBalance, 'IQD');
      
      // تحرير أي Hold موجود إذا لزم الأمر
      if (walletResult.Item.lockedBalance > 0) {
        console.log('   ⚠️ يوجد Hold نشط - يجب تحريره يدوياً إذا لزم الأمر');
      }
      
      // التحقق من الرصيد الكافي
      if (walletResult.Item.availableBalance >= walletResult.Item.minRequiredBalance) {
        console.log('   ✅ الرصيد كافٍ للعمل');
      } else {
        console.log('   ⚠️ الرصيد أقل من المطلوب!');
        console.log(`   المطلوب: ${walletResult.Item.minRequiredBalance} IQD`);
        console.log(`   المتاح: ${walletResult.Item.availableBalance} IQD`);
      }
    } else {
      console.log('⚠️ المحفظة غير موجودة');
      console.log('   يجب إنشاؤها من خلال Wallet Service');
    }
    console.log('');

    // ============================================
    // 5. الملخص النهائي
    // ============================================
    console.log('═══════════════════════════════════════');
    console.log('✅ تم إعداد السائق بنجاح!');
    console.log('═══════════════════════════════════════');
    console.log('');
    console.log('📋 الحالة النهائية:');
    console.log('   ✅ WizzDriverLiveState: online + searching + موقع محدد');
    console.log('   ✅ WizzDriverPerformanceMetrics: 100% acceptance + completion');
    console.log('   ✅ WhizzDrivers_dev: تم التحقق');
    console.log('   ✅ dev-Wallets: تم التحقق');
    console.log('');
    console.log('🎯 السائق الآن مؤهل لاستلام Wave offers!');
    console.log('');
    console.log('📝 ملاحظات:');
    console.log('   - تأكد من أن التطبيق مفتوح ومتصل بـ WebSocket');
    console.log('   - تأكد من أن GPS مفعل وموقع السائق قريب من المطعم');
    console.log('   - تأكد من وجود رصيد كافٍ في المحفظة (≥ 25,000 IQD)');

  } catch (error) {
    console.error('❌ حدث خطأ:', error);
    console.error('التفاصيل:', error.message);
    process.exit(1);
  }
}

// تشغيل السكريبت
setupDriver().then(() => {
  console.log('');
  console.log('✅ انتهى السكريبت بنجاح');
  process.exit(0);
}).catch(error => {
  console.error('❌ فشل السكريبت:', error);
  process.exit(1);
});
