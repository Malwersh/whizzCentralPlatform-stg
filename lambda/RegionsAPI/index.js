/**
 * RegionsAPI Lambda
 * يوفر APIs لجلب المحافظات والمناطق للتطبيقات
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(client);

const DERIVED_TABLE = process.env.DERIVED_TABLE || 'WizzCentral_RegionsDerived_dev';

/**
 * معالج الطلبات الرئيسي
 */
exports.handler = async (event) => {
    console.log('📥 Request:', JSON.stringify(event, null, 2));
    
    try {
        const path = event.path || event.rawPath || '';
        const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
        
        // التوجيه حسب المسار
        if (path.includes('/countries') && method === 'GET') {
            return await getCountries(event);
        }
        
        if (path.includes('/governorates') && method === 'GET') {
            return await getGovernorates(event);
        }
        
        if (path.includes('/districts') && method === 'GET') {
            return await getDistricts(event);
        }
        
        if (path.includes('/residential-areas') && method === 'GET') {
            return await getResidentialAreas(event);
        }
        
        return createResponse(404, { error: 'Not Found' });
        
    } catch (error) {
        console.error('❌ Error:', error);
        return createResponse(500, { 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
};

/**
 * GET /regions/countries
 * جلب جميع البلدان (Level 0)
 */
async function getCountries(event) {
    console.log('🌍 جلب البلدان...');
    
    try {
        const result = await dynamodb.send(new ScanCommand({
            TableName: DERIVED_TABLE,
            FilterExpression: '#level = :level',
            ExpressionAttributeNames: {
                '#level': 'level'
            },
            ExpressionAttributeValues: {
                ':level': 0
            }
        }));
        
        const countries = (result.Items || []).map(item => ({
            regionId: item.regionId,
            name: item.name,
            name_ar: item.name_ar,
            level: item.level
        }));
        
        console.log(`✅ تم جلب ${countries.length} بلد`);
        
        return createResponse(200, {
            success: true,
            count: countries.length,
            countries: countries
        });
        
    } catch (error) {
        console.error('❌ خطأ في جلب البلدان:', error);
        throw error;
    }
}

/**
 * GET /regions/governorates?countryId=xxx
 * جلب جميع المحافظات (Level 1) المفتوحة للبلد
 */
async function getGovernorates(event) {
    console.log('🏛️ جلب المحافظات...');
    
    try {
        const queryParams = event.queryStringParameters || {};
        const countryId = queryParams.countryId;
        
        if (!countryId) {
            return createResponse(400, { 
                error: 'Bad Request',
                message: 'countryId parameter is required'
            });
        }
        
        const result = await dynamodb.send(new QueryCommand({
            TableName: DERIVED_TABLE,
            IndexName: 'parent-index',
            KeyConditionExpression: 'parent_id = :parentId',
            FilterExpression: '#active = :active',
            ExpressionAttributeNames: {
                '#active': 'effective_is_active'
            },
            ExpressionAttributeValues: {
                ':parentId': countryId,
                ':active': 1
            }
        }));
        
        // تصفية Level 1 فقط من النتائج
        const governorates = (result.Items || [])
            .filter(item => item.level === 1)
            .map(item => ({
                regionId: item.regionId,
                name: item.name,
                name_ar: item.name_ar,
                level: item.level,
                parent_id: item.parent_id
            }));
        
        console.log(`✅ تم جلب ${governorates.length} محافظة`);
        
        return createResponse(200, {
            success: true,
            countryId: countryId,
            count: governorates.length,
            governorates: governorates
        });
        
    } catch (error) {
        console.error('❌ خطأ في جلب المحافظات:', error);
        throw error;
    }
}

/**
 * GET /regions/districts?governorateId=xxx
 * جلب الأقضية (Level 2) المفتوحة حسب المحافظة
 */
async function getDistricts(event) {
    console.log('🏘️ جلب الأقضية...');
    
    try {
        const queryParams = event.queryStringParameters || {};
        const governorateId = queryParams.governorateId;
        
        if (!governorateId) {
            return createResponse(400, { 
                error: 'Bad Request',
                message: 'governorateId parameter is required'
            });
        }
        
        console.log(`   للمحافظة: ${governorateId}`);
        
        const result = await dynamodb.send(new QueryCommand({
            TableName: DERIVED_TABLE,
            IndexName: 'parent-index',
            KeyConditionExpression: 'parent_id = :parentId',
            FilterExpression: '#active = :active',
            ExpressionAttributeNames: {
                '#active': 'effective_is_active'
            },
            ExpressionAttributeValues: {
                ':parentId': governorateId,
                ':active': 1
            }
        }));
        
        // تصفية Level 2 فقط من النتائج
        const districts = (result.Items || [])
            .filter(item => item.level === 2)
            .map(item => ({
                regionId: item.regionId,
                name: item.name,
                name_ar: item.name_ar,
                level: item.level,
                parent_id: item.parent_id
            }));
        
        console.log(`✅ تم جلب ${districts.length} قضاء`);
        
        return createResponse(200, {
            success: true,
            governorateId: governorateId,
            count: districts.length,
            districts: districts
        });
        
    } catch (error) {
        console.error('❌ خطأ في جلب الأقضية:', error);
        throw error;
    }
}

/**
 * GET /regions/residential-areas?governorateId=xxx
 * جلب مناطق السكن النشطة (Level 3 أو Level 2 إذا لم يوجد 3)
 * - أولاً: جلب Level 3 الفعال والذي فيه خدمة توصيل
 * - إذا لم يوجد: جلب Level 2 الفعال والذي فيه خدمة
 */
async function getResidentialAreas(event) {
    console.log('🏡 جلب مناطق السكن...');
    
    try {
        const queryParams = event.queryStringParameters || {};
        const governorateId = queryParams.governorateId;
        
        if (!governorateId) {
            return createResponse(400, { 
                error: 'Bad Request',
                message: 'governorateId parameter is required'
            });
        }
        
        console.log(`   للمحافظة: ${governorateId}`);
        
        // Step 1: جلب Level 2 (الأقضية) المفتوحة للمحافظة
        const level2Result = await dynamodb.send(new QueryCommand({
            TableName: DERIVED_TABLE,
            IndexName: 'parent-index',
            KeyConditionExpression: 'parent_id = :parentId',
            FilterExpression: '#active = :active',
            ExpressionAttributeNames: {
                '#active': 'effective_is_active'
            },
            ExpressionAttributeValues: {
                ':parentId': governorateId,
                ':active': 1
            }
        }));
        
        // تصفية Level 2 فقط
        const districts = (level2Result.Items || []).filter(item => item.level === 2);
        console.log(`   وجدنا ${districts.length} قضاء مفتوح`);
        
        const residentialAreas = [];
        
        // Step 2: لكل قضاء، جلب Level 3 (النواحي) الفعالة والتي فيها خدمة
        for (const district of districts) {
            const level3Result = await dynamodb.send(new QueryCommand({
                TableName: DERIVED_TABLE,
                IndexName: 'parent-index',
                KeyConditionExpression: 'parent_id = :parentId',
                FilterExpression: '#active = :active',
                ExpressionAttributeNames: {
                    '#active': 'effective_is_active'
                },
                ExpressionAttributeValues: {
                    ':parentId': district.regionId,
                    ':active': 1
                }
            }));
            
            // تصفية Level 3 فقط والتي فيها خدمة توصيل
            const activeSubDistricts = (level3Result.Items || [])
                .filter(item => item.level === 3)
                .filter(item => {
                    const delivery = item.effective_config?.delivery;
                    // delivery يكون true أو MAP (فيه إعدادات) = فيها خدمة
                    // delivery يكون false = لا توجد خدمة
                    if (!delivery) return false;
                    if (delivery === true) return true;
                    if (typeof delivery === 'object' && Object.keys(delivery).length > 0) return true;
                    return false;
                });
            
            if (activeSubDistricts.length > 0) {
                // يوجد نواحي (Level 3) فعّالة - أضفها
                console.log(`   ✓ ${district.name_ar} لديه ${activeSubDistricts.length} ناحية فعالة`);
                residentialAreas.push(...activeSubDistricts.map(item => ({
                    regionId: item.regionId,
                    name: item.name,
                    name_ar: item.name_ar,
                    level: item.level,
                    parent_id: item.parent_id,
                    parentDistrictName: district.name_ar
                })));
            } else {
                // لا يوجد نواحي فعّالة - تحقق إذا القضاء نفسه فيه خدمة
                const districtDelivery = district.effective_config?.delivery;
                const hasDelivery = districtDelivery === true || 
                                  (typeof districtDelivery === 'object' && Object.keys(districtDelivery).length > 0);
                
                if (hasDelivery) {
                    console.log(`   ○ ${district.name_ar} ليس لديه نواحي - سنضيف القضاء نفسه (فيه خدمة)`);
                    residentialAreas.push({
                        regionId: district.regionId,
                        name: district.name,
                        name_ar: district.name_ar,
                        level: district.level,
                        parent_id: district.parent_id,
                        parentDistrictName: null
                    });
                } else {
                    console.log(`   ✗ ${district.name_ar} لا يوجد به خدمة توصيل - تم تجاهله`);
                }
            }
        }
        
        console.log(`✅ تم جلب ${residentialAreas.length} منطقة سكنية`);
        
        return createResponse(200, {
            success: true,
            governorateId: governorateId,
            count: residentialAreas.length,
            residentialAreas: residentialAreas
        });
        
    } catch (error) {
        console.error('❌ خطأ في جلب مناطق السكن:', error);
        throw error;
    }
}

/**
 * إنشاء Response
 */
function createResponse(statusCode, body) {
    return {
        statusCode: statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: JSON.stringify(body)
    };
}
