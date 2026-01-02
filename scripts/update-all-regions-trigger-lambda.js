/**
 * تحديث جميع المناطق لتشغيل Lambda وملء حقول name و name_ar
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(client);

const REGIONS_TABLE = 'WizzCentral_Regions';

async function updateAllRegions() {
    console.log('🔄 تحديث جميع المناطق لتشغيل Lambda...\n');
    
    let updatedCount = 0;
    let errorCount = 0;
    let lastEvaluatedKey = undefined;
    
    try {
        do {
            // Scan المناطق بشكل paginated
            const scanResult = await dynamodb.send(new ScanCommand({
                TableName: REGIONS_TABLE,
                Limit: 25,
                ExclusiveStartKey: lastEvaluatedKey
            }));
            
            const regions = scanResult.Items || [];
            console.log(`📦 معالجة ${regions.length} منطقة...`);
            
            // تحديث كل منطقة
            for (const region of regions) {
                try {
                    await dynamodb.send(new UpdateCommand({
                        TableName: REGIONS_TABLE,
                        Key: { regionId: region.regionId },
                        UpdateExpression: 'SET #v = if_not_exists(#v, :zero) + :inc',
                        ExpressionAttributeNames: {
                            '#v': 'version'
                        },
                        ExpressionAttributeValues: {
                            ':inc': 1,
                            ':zero': 0
                        }
                    }));
                    
                    updatedCount++;
                    process.stdout.write(`\r✅ تم: ${updatedCount} | ❌ فشل: ${errorCount}`);
                    
                    // انتظار بسيط لتجنب throttling
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    errorCount++;
                    console.error(`\n⚠️  فشل تحديث ${region.regionId}:`, error.message);
                }
            }
            
            lastEvaluatedKey = scanResult.LastEvaluatedKey;
            
        } while (lastEvaluatedKey);
        
        console.log('\n\n📊 ملخص التحديث:');
        console.log(`   ✅ نجح: ${updatedCount}`);
        console.log(`   ❌ فشل: ${errorCount}`);
        console.log(`   📈 الإجمالي: ${updatedCount + errorCount}`);
        
        console.log('\n⏳ انتظر 5-10 دقائق لمعالجة Lambda جميع التحديثات');
        console.log('   يمكنك التحقق من CloudWatch Logs:');
        console.log('   /aws/lambda/WizzCentral-RegionPropagationEngine-dev');
        
    } catch (error) {
        console.error('\n❌ خطأ:', error.message);
        throw error;
    }
}

// Run update
updateAllRegions()
    .then(() => {
        console.log('\n✅ انتهى التحديث');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ فشل:', error);
        process.exit(1);
    });
