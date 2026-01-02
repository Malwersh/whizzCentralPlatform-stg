/**
 * Script للتحقق من حالة السائق في جميع الجداول
 * 
 * Usage: node check_driver_status.js
 */

const AWS = require('aws-sdk');

// تحميل الـ credentials من AWS config
process.env.AWS_SDK_LOAD_CONFIG = '1';

AWS.config.update({ 
  region: 'us-east-1',
  credentials: new AWS.SharedIniFileCredentials({ profile: process.env.AWS_PROFILE })
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const DRIVER_ID = '24d87408-e041-703c-1cc0-e5a86087bba3';

async function checkDriverStatus() {
  console.log('🔍 التحقق من حالة السائق...');
  console.log(`👤 Driver ID: ${DRIVER_ID}`);
  console.log('');

  let isQualified = true;
  const issues = [];

  try {
    // ============================================
    // 1. WhizzDrivers_dev
    // ============================================
    console.log('📋 1. WhizzDrivers_dev:');
    const driverResult = await dynamoDB.get({
      TableName: 'WhizzDrivers_dev',
      Key: { driverId: DRIVER_ID }
    }).promise();

    if (driverResult.Item) {
      const driver = driverResult.Item;
      console.log('   ✅ السجل موجود');
      console.log(`   - name: ${driver.name || 'N/A'}`);
      console.log(`   - phone: ${driver.phone || 'N/A'}`);
      console.log(`   - status: ${driver.status || 'N/A'}`);
      console.log(`   - registrationStatus: ${driver.registrationStatus || 'N/A'}`);
      console.log(`   - vehicleType: ${driver.vehicleType || 'N/A'}`);
      console.log(`   - vehiclePlate: ${driver.vehiclePlate || 'N/A'}`);
      
      if (driver.registrationStatus !== 'APPROVED' && driver.status !== 'APPROVED') {
        issues.push('❌ registrationStatus ليس APPROVED');
        isQualified = false;
      }
    } else {
      console.log('   ❌ السجل غير موجود');
      issues.push('❌ السجل غير موجود في WhizzDrivers_dev');
      isQualified = false;
    }
    console.log('');

    // ============================================
    // 2. WizzDriverLiveState
    // ============================================
    console.log('📋 2. WizzDriverLiveState:');
    const liveStateResult = await dynamoDB.get({
      TableName: 'WizzDriverLiveState',
      Key: { driverId: DRIVER_ID }
    }).promise();

    if (liveStateResult.Item) {
      const state = liveStateResult.Item;
      console.log('   ✅ السجل موجود');
      console.log(`   - status: ${state.status || 'N/A'}`);
      console.log(`   - isSearching: ${state.isSearching}`);
      console.log(`   - lastKnownLat: ${state.lastKnownLat || 'N/A'}`);
      console.log(`   - lastKnownLng: ${state.lastKnownLng || 'N/A'}`);
      console.log(`   - activeOrdersCount: ${state.activeOrdersCount || 0}`);
      console.log(`   - lastUpdated: ${state.lastUpdated || 'N/A'}`);
      
      // التحقق من المؤهلات
      if (state.status !== 'online') {
        issues.push(`❌ status = ${state.status} (يجب أن يكون online)`);
        isQualified = false;
      }
      
      if (!state.isSearching) {
        issues.push('❌ isSearching = false (يجب أن يكون true)');
        isQualified = false;
      }
      
      if (!state.lastKnownLat || !state.lastKnownLng) {
        issues.push('❌ لا يوجد موقع محدد (lastKnownLat/Lng)');
        isQualified = false;
      }
      
      if (state.activeOrdersCount >= 3) {
        issues.push(`❌ activeOrdersCount = ${state.activeOrdersCount} (يجب أن يكون أقل من 3)`);
        isQualified = false;
      }
    } else {
      console.log('   ❌ السجل غير موجود');
      issues.push('❌ السجل غير موجود في WizzDriverLiveState');
      isQualified = false;
    }
    console.log('');

    // ============================================
    // 3. WizzDriverPerformanceMetrics
    // ============================================
    console.log('📋 3. WizzDriverPerformanceMetrics:');
    const metricsResult = await dynamoDB.query({
      TableName: 'WizzDriverPerformanceMetrics',
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `DRIVER#${DRIVER_ID}`
      }
    }).promise();

    if (metricsResult.Items && metricsResult.Items.length > 0) {
      const metrics = metricsResult.Items[0];
      console.log('   ✅ السجل موجود');
      console.log(`   - acceptanceRate: ${metrics.acceptanceRate}%`);
      console.log(`   - completionRate: ${metrics.completionRate}%`);
      console.log(`   - rating: ${metrics.rating}`);
      console.log(`   - totalOrders: ${metrics.totalOrders || 0}`);
      
      // التحقق من المؤهلات (Wave System thresholds)
      if (metrics.acceptanceRate < 60) {
        issues.push(`❌ acceptanceRate = ${metrics.acceptanceRate}% (يجب ≥ 60%)`);
        isQualified = false;
      }
      
      if (metrics.completionRate < 80) {
        issues.push(`❌ completionRate = ${metrics.completionRate}% (يجب ≥ 80%)`);
        isQualified = false;
      }
    } else {
      console.log('   ❌ السجل غير موجود');
      issues.push('❌ السجل غير موجود في WizzDriverPerformanceMetrics');
      isQualified = false;
    }
    console.log('');

    // ============================================
    // 4. dev-Wallets
    // ============================================
    console.log('📋 4. dev-Wallets:');
    const walletResult = await dynamoDB.get({
      TableName: 'dev-Wallets',
      Key: {
        walletId: `WALLET#DRIVER#${DRIVER_ID}`,
        sk: 'META'
      }
    }).promise();

    if (walletResult.Item) {
      const wallet = walletResult.Item;
      console.log('   ✅ المحفظة موجودة');
      console.log(`   - availableBalance: ${wallet.availableBalance} IQD`);
      console.log(`   - lockedBalance: ${wallet.lockedBalance} IQD`);
      console.log(`   - minRequiredBalance: ${wallet.minRequiredBalance} IQD`);
      console.log(`   - status: ${wallet.status}`);
      console.log(`   - updatedAt: ${wallet.updatedAt}`);
      
      // التحقق من الرصيد
      if (wallet.availableBalance < wallet.minRequiredBalance) {
        issues.push(`⚠️ availableBalance (${wallet.availableBalance}) < minRequiredBalance (${wallet.minRequiredBalance})`);
        console.log(`   ⚠️ الرصيد أقل من المطلوب!`);
      }
      
      if (wallet.lockedBalance > 0) {
        console.log(`   ⚠️ يوجد Hold نشط: ${wallet.lockedBalance} IQD`);
      }
    } else {
      console.log('   ❌ المحفظة غير موجودة');
      issues.push('❌ المحفظة غير موجودة في dev-Wallets');
      isQualified = false;
    }
    console.log('');

    // ============================================
    // 5. الملخص النهائي
    // ============================================
    console.log('═══════════════════════════════════════');
    if (isQualified && issues.length === 0) {
      console.log('✅ السائق مؤهل بالكامل لاستلام Wave offers!');
    } else {
      console.log('❌ السائق غير مؤهل - يوجد مشاكل:');
      console.log('');
      issues.forEach(issue => console.log(`   ${issue}`));
      console.log('');
      console.log('💡 الحل: قم بتشغيل setup_new_driver.js لإصلاح المشاكل');
    }
    console.log('═══════════════════════════════════════');

  } catch (error) {
    console.error('❌ حدث خطأ:', error);
    console.error('التفاصيل:', error.message);
    process.exit(1);
  }
}

// تشغيل السكريبت
checkDriverStatus().then(() => {
  console.log('');
  console.log('✅ انتهى الفحص');
  process.exit(0);
}).catch(error => {
  console.error('❌ فشل الفحص:', error);
  process.exit(1);
});
