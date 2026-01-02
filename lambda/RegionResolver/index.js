/**
 * RegionResolver Lambda Function
 * 
 * الغرض: تحويل إحداثيات GPS إلى معلومات المنطقة + التسعير
 * 
 * Input: { lat, lng }
 * Output: { regionId, name, level, isActive, pricing, limits }
 * 
 * الخطوات:
 * 1. تحويل (lat, lng) إلى H3 cell
 * 2. البحث في RegionIndex عن المناطق المحتملة
 * 3. التحقق من Point-in-Polygon (دقة عالية)
 * 4. جلب البيانات الفعالة من RegionsDerived
 * 5. إرجاع النتيجة الكاملة
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const turf = require('@turf/turf');
const h3 = require('h3-js');

// تكوين DynamoDB
const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(client);

// أسماء الجداول
const REGIONS_TABLE = process.env.REGIONS_TABLE || 'WizzCentral_Regions';
const DERIVED_TABLE = process.env.DERIVED_TABLE || 'WizzCentral_RegionsDerived_dev';
const INDEX_TABLE = process.env.INDEX_TABLE || 'WizzCentral_RegionIndex_dev';

// H3 Resolution (يجب أن يطابق SpatialIndexBuilder)
const H3_RESOLUTION = 9;

/**
 * معالج الأحداث الرئيسي
 */
exports.handler = async (event) => {
    console.log('🗺️  RegionResolver بدأ التشغيل');
    console.log('📊 Event:', JSON.stringify(event, null, 2));
    
    try {
        // تحليل الـ body
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        const { lat, lng } = body;
        
        // التحقق من المدخلات
        if (!lat || !lng) {
            return errorResponse(400, 'Missing required fields: lat, lng');
        }
        
        // التحقق من صحة الإحداثيات
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return errorResponse(400, 'Invalid coordinates');
        }
        
        console.log(`📍 البحث عن: lat=${lat}, lng=${lng}`);
        
        // 1. تحويل إلى H3 cell
        const h3Cell = h3.latLngToCell(lat, lng, H3_RESOLUTION);
        console.log(`🔷 H3 Cell: ${h3Cell}`);
        
        // 2. البحث في RegionIndex
        const candidates = await getCandidateRegions(h3Cell);
        console.log(`📋 عدد المناطق المحتملة: ${candidates.length}`);
        
        if (candidates.length === 0) {
            return errorResponse(404, 'No region found for this location', {
                lat,
                lng,
                h3Cell,
                message: 'الموقع خارج مناطق الخدمة المتاحة'
            });
        }
        
        // 3. التحقق من Point-in-Polygon (دقة عالية)
        const matchedRegion = await findMatchingRegion(lat, lng, candidates);
        
        if (!matchedRegion) {
            return errorResponse(404, 'Location is outside service areas', {
                lat,
                lng,
                nearbyRegions: candidates.map(c => ({
                    id: c.regionId,
                    name: c.region_name,
                    level: c.level
                }))
            });
        }
        
        console.log(`✅ المنطقة المطابقة: ${matchedRegion.name} (${matchedRegion.regionId})`);
        
        // 4. جلب البيانات الفعالة
        const effectiveState = await getEffectiveState(matchedRegion.regionId);
        
        // 5. تجهيز الاستجابة
        const response = {
            success: true,
            location: { lat, lng },
            region: {
                id: matchedRegion.regionId,
                name: matchedRegion.name,
                name_ar: matchedRegion.name_ar,
                level: matchedRegion.level,
                level_name: matchedRegion.level_name,
                parent_id: matchedRegion.parent_id
            },
            effective: effectiveState,
            resolvedAt: new Date().toISOString()
        };
        
        console.log('✅ تم حل الموقع بنجاح');
        return successResponse(response);
        
    } catch (error) {
        console.error('❌ خطأ:', error);
        return errorResponse(500, 'Internal server error', {
            message: error.message
        });
    }
};

/**
 * جلب المناطق المحتملة من RegionIndex
 */
async function getCandidateRegions(h3Cell) {
    try {
        // استعلام على h3-index
        const result = await dynamodb.send(new QueryCommand({
            TableName: INDEX_TABLE,
            IndexName: 'h3-index',
            KeyConditionExpression: 'h3_cell = :cell',
            ExpressionAttributeValues: {
                ':cell': h3Cell
            }
        }));
        
        if (!result.Items || result.Items.length === 0) {
            console.log('⚠️  لا توجد مناطق في هذه الخلية');
            return [];
        }
        
        // استخراج regionIds الفريدة
        const regionIds = [...new Set(result.Items.map(item => item.regionId))];
        console.log(`📍 المناطق المحتملة: ${regionIds.join(', ')}`);
        
        // جلب تفاصيل المناطق
        const regions = [];
        for (const regionId of regionIds) {
            try {
                const region = await dynamodb.send(new GetCommand({
                    TableName: REGIONS_TABLE,
                    Key: { regionId }
                }));
                
                if (region.Item) {
                    regions.push(region.Item);
                }
            } catch (error) {
                console.warn(`⚠️  خطأ في جلب المنطقة ${regionId}:`, error.message);
            }
        }
        
        return regions;
        
    } catch (error) {
        console.error('❌ خطأ في getCandidateRegions:', error);
        throw error;
    }
}

/**
 * إيجاد المنطقة المطابقة باستخدام Point-in-Polygon
 */
async function findMatchingRegion(lat, lng, candidates) {
    const point = turf.point([lng, lat]);
    
    // ترتيب المناطق حسب المستوى (من الأصغر إلى الأكبر)
    // نبحث في المناطق الأصغر أولاً (أكثر دقة)
    const sorted = candidates.sort((a, b) => (b.level || 0) - (a.level || 0));
    
    for (const region of sorted) {
        try {
            // تحقق من وجود geometry
            if (!region.geometry || !region.geometry.coordinates) {
                console.warn(`⚠️  المنطقة ${region.name} لا تحتوي على geometry`);
                continue;
            }
            
            // إنشاء polygon من geometry
            let polygon;
            if (region.geometry.type === 'Polygon') {
                polygon = turf.polygon(region.geometry.coordinates);
            } else if (region.geometry.type === 'MultiPolygon') {
                polygon = turf.multiPolygon(region.geometry.coordinates);
            } else {
                console.warn(`⚠️  نوع geometry غير مدعوم: ${region.geometry.type}`);
                continue;
            }
            
            // التحقق من Point-in-Polygon
            if (turf.booleanPointInPolygon(point, polygon)) {
                console.log(`✅ تطابق! النقطة داخل: ${region.name}`);
                return region;
            }
            
        } catch (error) {
            console.warn(`⚠️  خطأ في فحص المنطقة ${region.name}:`, error.message);
            continue;
        }
    }
    
    console.log('❌ لم يتم العثور على منطقة مطابقة');
    return null;
}

/**
 * جلب الحالة الفعالة من RegionsDerived
 */
async function getEffectiveState(regionId) {
    try {
        const result = await dynamodb.send(new GetCommand({
            TableName: DERIVED_TABLE,
            Key: { regionId }
        }));
        
        if (!result.Item) {
            console.warn(`⚠️  لا توجد بيانات مشتقة للمنطقة ${regionId}`);
            return {
                isActive: false,
                message: 'Region data not yet computed'
            };
        }
        
        const derived = result.Item;
        
        return {
            isActive: derived.effective_is_active || false,
            pricing: derived.effective_pricing || null,
            limits: derived.effective_limits || null,
            service: derived.effective_config || null,
            inheritanceSource: derived.inheritance_source || 'self',
            computedAt: derived.computed_at || null
        };
        
    } catch (error) {
        console.error('❌ خطأ في getEffectiveState:', error);
        throw error;
    }
}

/**
 * استجابة ناجحة
 */
function successResponse(data) {
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify(data)
    };
}

/**
 * استجابة خطأ
 */
function errorResponse(statusCode, message, details = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
            success: false,
            error: message,
            details,
            timestamp: new Date().toISOString()
        })
    };
}
