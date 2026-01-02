/**
 * فحص جميع المناطق في RegionsDerived للتأكد من وجود name و name_ar
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(client);

const DERIVED_TABLE = 'WizzCentral_RegionsDerived_dev';

async function verifyAllRegions() {
    console.log('🔍 فحص جميع المناطق في RegionsDerived...\n');
    
    let totalCount = 0;
    let hasNameCount = 0;
    let missingNameCount = 0;
    const missingRegions = [];
    
    try {
        let lastEvaluatedKey = undefined;
        
        do {
            const scanResult = await dynamodb.send(new ScanCommand({
                TableName: DERIVED_TABLE,
                ExclusiveStartKey: lastEvaluatedKey
            }));
            
            const regions = scanResult.Items || [];
            
            for (const region of regions) {
                totalCount++;
                
                if (region.name && region.name_ar) {
                    hasNameCount++;
                } else {
                    missingNameCount++;
                    missingRegions.push({
                        regionId: region.regionId,
                        name: region.name || 'missing',
                        name_ar: region.name_ar || 'missing'
                    });
                }
            }
            
            lastEvaluatedKey = scanResult.LastEvaluatedKey;
            
        } while (lastEvaluatedKey);
        
        console.log('📊 النتائج:');
        console.log(`   📈 الإجمالي: ${totalCount}`);
        console.log(`   ✅ لديه name & name_ar: ${hasNameCount}`);
        console.log(`   ❌ ناقص name أو name_ar: ${missingNameCount}`);
        
        if (missingRegions.length > 0) {
            console.log('\n⚠️  المناطق الناقصة:');
            missingRegions.forEach(r => {
                console.log(`   - ${r.regionId}: name=${r.name}, name_ar=${r.name_ar}`);
            });
        } else {
            console.log('\n🎉 جميع المناطق لديها name و name_ar!');
        }
        
    } catch (error) {
        console.error('❌ خطأ:', error.message);
        throw error;
    }
}

verifyAllRegions()
    .then(() => {
        console.log('\n✅ انتهى الفحص');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ فشل:', error);
        process.exit(1);
    });
