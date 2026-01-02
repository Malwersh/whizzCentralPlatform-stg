/**
 * إضافة Iraq (Level 0) يدوياً إلى RegionsDerived
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(client);

const REGIONS_TABLE = 'WizzCentral_Regions';
const DERIVED_TABLE = 'WizzCentral_RegionsDerived_dev';

async function addIraqToDerived() {
    console.log('🇮🇶 إضافة العراق إلى RegionsDerived...\n');
    
    try {
        // 1. جلب بيانات Iraq من WizzCentral_Regions
        const iraqId = 'Rmhv8jq5w2bm3q';
        console.log(`📍 جلب بيانات ${iraqId}...`);
        
        const result = await dynamodb.send(new GetCommand({
            TableName: REGIONS_TABLE,
            Key: { regionId: iraqId }
        }));
        
        if (!result.Item) {
            console.error('❌ Iraq غير موجود في WizzCentral_Regions');
            return;
        }
        
        const iraq = result.Item;
        console.log(`✅ تم جلب: ${iraq.name} (${iraq.name_ar})`);
        console.log(`   Level: ${iraq.level}`);
        console.log(`   parent_id: ${iraq.parent_id || 'null (root)'}`);
        
        // 2. إنشاء effectiveState
        const effectiveState = {
            regionId: iraq.regionId,
            parent_id: "ROOT", // Iraq هو root (لا يمكن استخدام null في GSI)
            level: 0,
            name: iraq.name,
            name_ar: iraq.name_ar,
            effective_is_active: iraq.is_active ? 1 : 0,
            effective_pricing: {
                base_fee: 2.0,
                per_km: 0.5,
                minimum_order: 5.0,
                service_fee_percent: 10
            },
            effective_limits: {
                max_delivery_distance_km: 10,
                max_active_orders_per_driver: 3,
                min_driver_rating: 4
            },
            effective_config: iraq.service_config || {},
            inheritance_chain: [iraq.regionId],
            inheritance_source: {
                is_active: iraq.regionId,
                pricing: 'default',
                limits: 'default'
            },
            computed_at: new Date().toISOString(),
            version: iraq.version || 1
        };
        
        // 3. كتابة في RegionsDerived
        console.log('\n💾 كتابة في RegionsDerived...');
        await dynamodb.send(new PutCommand({
            TableName: DERIVED_TABLE,
            Item: effectiveState
        }));
        
        console.log('✅ تمت الإضافة بنجاح!');
        
        // 4. التحقق
        console.log('\n🔍 التحقق...');
        const verifyResult = await dynamodb.send(new GetCommand({
            TableName: DERIVED_TABLE,
            Key: { regionId: iraqId }
        }));
        
        if (verifyResult.Item) {
            console.log('✅ Iraq موجود الآن في RegionsDerived:');
            console.log(JSON.stringify({
                regionId: verifyResult.Item.regionId,
                name: verifyResult.Item.name,
                name_ar: verifyResult.Item.name_ar,
                level: verifyResult.Item.level,
                parent_id: verifyResult.Item.parent_id
            }, null, 2));
        } else {
            console.error('❌ فشل التحقق!');
        }
        
    } catch (error) {
        console.error('❌ خطأ:', error.message);
        throw error;
    }
}

addIraqToDerived()
    .then(() => {
        console.log('\n✅ انتهى');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ فشل:', error);
        process.exit(1);
    });
