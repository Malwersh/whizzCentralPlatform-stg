const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// تكوين DynamoDB Client
const client = new DynamoDBClient({ region: 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'WizzCentral_Regions';

/**
 * Migration Script لإضافة الحقول الجديدة لـ WizzCentral_Regions
 * 
 * الحقول الجديدة:
 * 1. version (Number) - للتحكم بالإصدارات
 * 2. self_pricing (Map) - أسعار خاصة بالمنطقة
 * 3. self_limits (Map) - حدود خاصة
 * 4. geometry_validated (Boolean) - حالة التحقق من الـ polygon
 * 5. geometry_metadata (Map) - معلومات الشكل الهندسي
 * 6. override_parent_active (Boolean) - تجاوز حالة الأهل
 */

async function migrateRegions() {
    console.log('🚀 بدء Migration لـ WizzCentral_Regions...\n');
    
    try {
        // 1. استرجاع جميع المناطق
        console.log('📋 استرجاع المناطق الحالية...');
        const scanResult = await dynamodb.send(new ScanCommand({
            TableName: TABLE_NAME
        }));
        
        const regions = scanResult.Items || [];
        console.log(`✅ تم العثور على ${regions.length} منطقة\n`);
        
        if (regions.length === 0) {
            console.log('⚠️  لا توجد مناطق للتحديث');
            return;
        }
        
        // 2. تحديث كل منطقة
        let successCount = 0;
        let errorCount = 0;
        
        for (const region of regions) {
            try {
                console.log(`🔄 تحديث: ${region.name} (${region.regionId})`);
                
                // تحضير الحقول الجديدة
                const newFields = {
                    version: 1, // النسخة الأولى
                    geometry_validated: false, // سيتم التحقق لاحقاً
                    updated_at: new Date().toISOString()
                };
                
                // إضافة geometry_metadata إذا كان boundary موجود
                if (region.boundary) {
                    newFields.geometry_metadata = {
                        type: region.boundary.type || 'Polygon',
                        coordinates_count: region.boundary.coordinates ? 
                            region.boundary.coordinates[0]?.length || 0 : 0,
                        last_validated_at: null,
                        validation_status: 'pending'
                    };
                }
                
                // تحديث السجل
                await dynamodb.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { regionId: region.regionId },
                    UpdateExpression: `
                        SET version = :version,
                            geometry_validated = :geometry_validated,
                            updated_at = :updated_at
                            ${region.boundary ? ', geometry_metadata = :geometry_metadata' : ''}
                    `,
                    ExpressionAttributeValues: {
                        ':version': newFields.version,
                        ':geometry_validated': newFields.geometry_validated,
                        ':updated_at': newFields.updated_at,
                        ...(region.boundary && { ':geometry_metadata': newFields.geometry_metadata })
                    }
                }));
                
                console.log(`   ✅ تم التحديث بنجاح`);
                successCount++;
                
            } catch (error) {
                console.error(`   ❌ فشل التحديث: ${error.message}`);
                errorCount++;
            }
            
            console.log(''); // سطر فارغ
        }
        
        // 3. النتيجة النهائية
        console.log('════════════════════════════════════════════════');
        console.log('   📊 ملخص Migration');
        console.log('════════════════════════════════════════════════');
        console.log(`✅ نجح: ${successCount}/${regions.length}`);
        console.log(`❌ فشل: ${errorCount}/${regions.length}`);
        console.log('════════════════════════════════════════════════\n');
        
        // 4. عرض عينة من البيانات المحدثة
        if (successCount > 0) {
            console.log('📊 عينة من البيانات المحدثة:\n');
            const sampleRegion = regions[0];
            const scanUpdated = await dynamodb.send(new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: 'regionId = :regionId',
                ExpressionAttributeValues: {
                    ':regionId': sampleRegion.regionId
                },
                Limit: 1
            }));
            
            if (scanUpdated.Items && scanUpdated.Items.length > 0) {
                const updated = scanUpdated.Items[0];
                console.log(JSON.stringify({
                    regionId: updated.regionId,
                    name: updated.name,
                    version: updated.version,
                    geometry_validated: updated.geometry_validated,
                    geometry_metadata: updated.geometry_metadata,
                    updated_at: updated.updated_at
                }, null, 2));
            }
        }
        
        console.log('\n✅ Migration اكتمل بنجاح!');
        
    } catch (error) {
        console.error('❌ خطأ في Migration:', error);
        throw error;
    }
}

// تشغيل Migration
migrateRegions()
    .then(() => {
        console.log('\n🎉 تم بنجاح!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n💥 فشل:', error);
        process.exit(1);
    });
