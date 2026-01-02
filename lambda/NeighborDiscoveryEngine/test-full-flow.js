/**
 * اختبار كامل لتدفق NeighborDiscoveryEngine
 * يقوم بتحديث منطقة في Regions لتشغيل Lambda ثم فحص النتائج
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const REGIONS_TABLE = 'WizzCentral_Regions';
const NEIGHBORS_TABLE = 'WizzCentral_RegionNeighbors_dev';
const DERIVED_TABLE = 'WizzCentral_RegionsDerived_dev';

// منطقة للاختبار (Rmi9vcnz48e9ij من السجلات)
const TEST_REGION_ID = 'Rmi9vcnz48e9ij';

async function testFullFlow() {
    console.log('🧪 بدء الاختبار الكامل...\n');

    // 1. الحصول على معلومات المنطقة
    console.log('1️⃣ جلب معلومات المنطقة الأساسية...');
    const regionResult = await docClient.send(new GetCommand({
        TableName: REGIONS_TABLE,
        Key: { regionId: TEST_REGION_ID }
    }));
    
    if (!regionResult.Item) {
        console.log('❌ المنطقة غير موجودة');
        return;
    }
    
    console.log(`   ✅ المنطقة: ${regionResult.Item.name_ar || regionResult.Item.name}`);

    // 2. الحصول على البيانات الهرمية
    console.log('\n2️⃣ جلب البيانات الهرمية...');
    const derivedResult = await docClient.send(new GetCommand({
        TableName: DERIVED_TABLE,
        Key: { regionId: TEST_REGION_ID }
    }));
    
    if (derivedResult.Item) {
        console.log(`   ✅ parent_id: ${derivedResult.Item.parent_id || 'N/A'}`);
        console.log(`   ✅ governorate_id: ${derivedResult.Item.governorate_id || 'N/A'}`);
    } else {
        console.log('   ⚠️  لا توجد بيانات هرمية');
    }

    // 3. تحديث المنطقة لتشغيل Lambda
    console.log('\n3️⃣ تحديث المنطقة لتشغيل Lambda...');
    await docClient.send(new UpdateCommand({
        TableName: REGIONS_TABLE,
        Key: { regionId: TEST_REGION_ID },
        UpdateExpression: 'SET last_test = :now',
        ExpressionAttributeValues: {
            ':now': Date.now()
        }
    }));
    console.log('   ✅ تم التحديث');

    // 4. الانتظار لمعالجة Lambda
    console.log('\n4️⃣ الانتظار 5 ثوانٍ لمعالجة Lambda...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 5. فحص النتائج في RegionNeighbors
    console.log('\n5️⃣ فحص الجيران المكتشفة...');
    const neighborsResult = await docClient.send(new QueryCommand({
        TableName: NEIGHBORS_TABLE,
        KeyConditionExpression: 'source_region_id = :rid',
        ExpressionAttributeValues: {
            ':rid': TEST_REGION_ID
        }
    }));

    if (neighborsResult.Items && neighborsResult.Items.length > 0) {
        console.log(`   ✅ وجد ${neighborsResult.Items.length} جار(ان)\n`);
        
        neighborsResult.Items.forEach((neighbor, i) => {
            console.log(`   🔹 الجار ${i + 1}:`);
            console.log(`      target_region_id: ${neighbor.target_region_id}`);
            console.log(`      expansion_priority: ${neighbor.expansion_priority} ⭐`);
            console.log(`      source_parent_id: ${neighbor.source_parent_id || 'N/A'}`);
            console.log(`      target_parent_id: ${neighbor.target_parent_id || 'N/A'}`);
            console.log(`      source_governorate_id: ${neighbor.source_governorate_id || 'N/A'}`);
            console.log(`      target_governorate_id: ${neighbor.target_governorate_id || 'N/A'}`);
            console.log(`      shared_boundary_km: ${neighbor.shared_boundary_km}`);
            console.log('');
        });

        // التحقق من أن الحقول الجديدة موجودة
        const hasNewFields = neighborsResult.Items.some(n => 
            n.hasOwnProperty('source_parent_id') || 
            n.hasOwnProperty('source_governorate_id')
        );

        if (hasNewFields) {
            console.log('✅ التحسينات الجديدة تعمل! الحقول الهرمية موجودة');
        } else {
            console.log('⚠️  التحسينات لم تطبق بعد على هذه السجلات');
        }

        // التحقق من قيم expansion_priority
        const priorities = neighborsResult.Items.map(n => parseInt(n.expansion_priority));
        const hasVariedPriorities = new Set(priorities).size > 1;
        
        if (hasVariedPriorities) {
            console.log('✅ توجد أولويات متنوعة (0, 1, 2)');
        } else {
            console.log(`ℹ️  جميع الأولويات: ${priorities[0]}`);
        }

    } else {
        console.log('   ⚠️  لا توجد جيران مسجلة');
    }

    console.log('\n🎉 انتهى الاختبار');
}

testFullFlow().catch(error => {
    console.error('❌ خطأ:', error);
    process.exit(1);
});
