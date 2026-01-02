/**
 * NeighborDiscoveryEngine Lambda Function
 * 
 * الغرض: اكتشاف المناطق المجاورة (neighbors)
 * 
 * Trigger: DynamoDB Stream من WizzCentral_Regions
 * Output: يكتب في WizzCentral_RegionNeighbors
 * 
 * المنطق:
 * 1. عند تحديث geometry لمنطقة
 * 2. البحث عن المناطق المجاورة (polygon intersection)
 * 3. حساب طول الحدود المشتركة
 * 4. تحديد expansion_priority بناءً على طول الحدود
 * 5. كتابة في RegionNeighbors (bidirectional)
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const turf = require('@turf/turf');

// تكوين DynamoDB - AWS_REGION متوفر تلقائياً في Lambda
const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(client);

// أسماء الجداول
const REGIONS_TABLE = process.env.REGIONS_TABLE || 'WizzCentral_Regions';
const REGIONS_DERIVED_TABLE = process.env.REGIONS_DERIVED_TABLE || 'WizzCentral_RegionsDerived_dev';
const NEIGHBORS_TABLE = process.env.NEIGHBORS_TABLE || 'WizzCentral_RegionNeighbors_dev';

// حد أدنى لطول الحدود المشتركة (km)
const MIN_SHARED_BOUNDARY_KM = 0.1;

// ✨ عتبات حساب expansion_priority
const PRIORITY_THRESHOLDS = {
    CORE_BOUNDARY_KM: 5,        // نفس القضاء + حد قوي → Priority 0
    CROSS_BOUNDARY_KM: 8        // قضاء مختلف + نفس المحافظة + حد قوي → Priority 1
};

/**
 * معالج الأحداث الرئيسي
 */
exports.handler = async (event) => {
    console.log('🔍 NeighborDiscoveryEngine بدأ التشغيل');
    console.log(`📊 عدد السجلات: ${event.Records.length}`);
    
    const results = {
        processed: 0,
        errors: 0,
        skipped: 0,
        neighborsFound: 0
    };
    
    try {
        for (const record of event.Records) {
            try {
                await processStreamRecord(record, results);
            } catch (error) {
                console.error('❌ خطأ في معالجة السجل:', error);
                results.errors++;
            }
        }
        
        console.log('✅ اكتمل التشغيل:', results);
        return {
            statusCode: 200,
            body: JSON.stringify(results)
        };
        
    } catch (error) {
        console.error('💥 خطأ كارثي:', error);
        throw error;
    }
};

/**
 * معالجة سجل واحد من Stream
 */
async function processStreamRecord(record, results) {
    const eventName = record.eventName;
    
    console.log(`\n🔄 معالجة: ${eventName}`);
    
    const newImage = record.dynamodb.NewImage ? unmarshall(record.dynamodb.NewImage) : null;
    const oldImage = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : null;
    
    // حالة الحذف: نحذف جميع علاقات الجيرة
    if (eventName === 'REMOVE' && oldImage) {
        const regionId = oldImage.regionId;
        console.log(`🗑️  حذف علاقات الجيرة لـ: ${regionId}`);
        await deleteNeighborRelations(regionId);
        results.processed++;
        return;
    }
    
    if (!newImage) {
        results.skipped++;
        return;
    }
    
    const regionId = newImage.regionId;
    console.log(`📍 المنطقة: ${newImage.name} (${regionId})`);
    
    // قراءة البيانات الكاملة من الجدول (Stream قد لا يرسل geometry)
    const { GetCommand } = require('@aws-sdk/lib-dynamodb');
    const fullRegion = await dynamodb.send(new GetCommand({
        TableName: REGIONS_TABLE,
        Key: { regionId }
    }));
    
    if (!fullRegion.Item) {
        console.log('⚠️  المنطقة غير موجودة في الجدول');
        results.skipped++;
        return;
    }
    
    // تحقق من وجود geometry
    let geometry;
    if (fullRegion.Item.geometry) {
        // ✅ Handle DynamoDB Document Client format (already converted to JS object)
        // No need to parse - DocumentClient automatically converts DynamoDB types
        geometry = fullRegion.Item.geometry;
    }
    
    if (!geometry || !geometry.coordinates) {
        console.log('⚠️  لا يوجد geometry صالح');
        results.skipped++;
        return;
    }
    
    // 1. حذف العلاقات القديمة
    await deleteNeighborRelations(regionId);
    
    // 2. اكتشاف الجيران الجدد
    const neighborsCount = await discoverNeighbors({ ...fullRegion.Item, geometry });
    
    results.processed++;
    results.neighborsFound += neighborsCount;
}

/**
 * اكتشاف المناطق المجاورة
 */
async function discoverNeighbors(region) {
    console.log(`   🔍 البحث عن الجيران...`);
    
    const regionId = region.regionId;
    let regionGeometry = region.geometry;
    const regionLevel = region.level || 0;
    
    // ✨ جلب بيانات التسلسل الهرمي من RegionsDerived
    const { GetCommand } = require('@aws-sdk/lib-dynamodb');
    let regionDerivedData = null;
    try {
        const derivedResult = await dynamodb.send(new GetCommand({
            TableName: REGIONS_DERIVED_TABLE,
            Key: { regionId }
        }));
        regionDerivedData = derivedResult.Item || null;
        console.log(`   📊 بيانات المنطقة:`, {
            regionId,
            level: regionDerivedData?.level,
            parent_id: regionDerivedData?.parent_id,
            governorate_id: regionDerivedData?.governorate_id
        });
    } catch (error) {
        console.warn(`   ⚠️  لم يتم العثور على بيانات في RegionsDerived: ${error.message}`);
    }
    
    // ✅ Convert coordinates to numbers (in case DynamoDB returns strings)
    const convertCoords = (coords) => {
        if (Array.isArray(coords)) {
            return coords.map(c => convertCoords(c));
        }
        return typeof coords === 'string' ? parseFloat(coords) : coords;
    };
    
    if (regionGeometry?.coordinates) {
        regionGeometry = {
            type: regionGeometry.type,
            coordinates: convertCoords(regionGeometry.coordinates)
        };
    }
    
    try {
        // 1. جلب جميع المناطق الأخرى في نفس المستوى أو أعلى/أقل بدرجة واحدة
        const candidateRegions = await getCandidateRegions(regionId, regionLevel);
        
        if (candidateRegions.length === 0) {
            console.log('   ℹ️  لا توجد مناطق للمقارنة');
            return 0;
        }
        
        console.log(`   📊 فحص ${candidateRegions.length} مناطق...`);
        
        // 2. تحويل geometries إلى Turf features
        const regionFeature = turf.feature(regionGeometry);
        
        const neighbors = [];
        
        // 3. فحص كل منطقة
        for (const candidate of candidateRegions) {
            if (!candidate.geometry) continue;
            
            // ✅ Skip regions at different levels (parent/child relationships)
            if (candidate.level !== regionLevel) {
                console.log(`   ⏭️  Skipping ${candidate.regionId} (different level: ${candidate.level} vs ${regionLevel})`);
                continue;
            }
            
            try {
                // ✅ Debug: Log coordinate sample
                const sampleCoord = candidate.geometry?.coordinates?.[0]?.[0]?.[0];
                console.log(`   🔍 Checking ${candidate.regionId}:`, {
                    type: candidate.geometry?.type,
                    coordSample: sampleCoord,
                    coordType: typeof sampleCoord,
                    isNumber: typeof sampleCoord === 'number'
                });
                
                // Ensure geometry is proper GeoJSON object (not DynamoDB format)
                let candidateGeom = candidate.geometry;
                
                // Convert coordinates if needed (from DynamoDB nested array format)
                if (candidateGeom && candidateGeom.type && candidateGeom.coordinates) {
                    // ✅ Recursively convert string coordinates to numbers
                    const convertCoords = (coords) => {
                        if (Array.isArray(coords)) {
                            return coords.map(c => convertCoords(c));
                        }
                        return typeof coords === 'string' ? parseFloat(coords) : coords;
                    };
                    
                    candidateGeom = {
                        type: candidateGeom.type,
                        coordinates: convertCoords(candidateGeom.coordinates)
                    };
                } else {
                    console.error(`   ⚠️  خطأ في فحص ${candidate.regionId}: Invalid geometry format`);
                    continue;
                }
                
                const candidateFeature = turf.feature(candidateGeom);
                
                console.log(`   🔍 Checking ${candidate.regionId}`);
                
                // 4. التحقق من التقاطع أو التجاور
                // First check for overlap/intersection
                const featureCollection = turf.featureCollection([regionFeature, candidateFeature]);
                let intersection = turf.intersect(featureCollection);
                let isAdjacent = false;
                
                console.log(`   📍 Intersection result:`, {
                    hasIntersection: !!intersection,
                    intersectionType: intersection?.type || 'none'
                });
                
                // If no intersection, check if they are adjacent (very close boundaries)
                if (!intersection) {
                    // Check if any vertex of one polygon is very close to the other polygon
                    const regionCoords = regionFeature.geometry.coordinates[0];
                    const candidateCoords = candidateFeature.geometry.coordinates[0];
                    
                    let minDistance = Infinity;
                    for (const rCoord of regionCoords) {
                        for (const cCoord of candidateCoords) {
                            const dist = turf.distance(turf.point(rCoord), turf.point(cCoord), { units: 'meters' });
                            if (dist < minDistance) minDistance = dist;
                        }
                    }
                    
                    // If any vertices are within 100 meters, consider them adjacent
                    if (minDistance < 100) {
                        console.log(`   ✅ Adjacent! Min distance: ${minDistance.toFixed(2)}m`);
                        isAdjacent = true;
                        // Create a line representing the shared boundary
                        intersection = turf.lineString([regionCoords[0], candidateCoords[0]]);
                    } else {
                        console.log(`   ℹ️  Not adjacent. Min distance: ${minDistance.toFixed(2)}m`);
                    }
                }
                
                if (!intersection && !isAdjacent) continue;
                
                // 5. حساب نوع العلاقة
                const relationship = analyzeRelationship(
                    regionFeature, 
                    candidateFeature, 
                    intersection
                );
                
                console.log(`   📊 Relationship:`, {
                    type: relationship.type,
                    shared_boundary_km: relationship.shared_boundary_km,
                    intersection_area_m2: relationship.intersection_area_m2,
                    min_required: MIN_SHARED_BOUNDARY_KM,
                    passes: relationship.shared_boundary_km >= MIN_SHARED_BOUNDARY_KM
                });
                
                // Accept any relationship type if shared boundary is sufficient
                // (adjacent, partially_overlapping, or overlapping - all indicate proximity)
                if (relationship.shared_boundary_km >= MIN_SHARED_BOUNDARY_KM) {
                    
                    // ✨ جلب بيانات التسلسل الهرمي للجار
                    let candidateDerivedData = null;
                    try {
                        const candidateDerivedResult = await dynamodb.send(new GetCommand({
                            TableName: REGIONS_DERIVED_TABLE,
                            Key: { regionId: candidate.regionId }
                        }));
                        candidateDerivedData = candidateDerivedResult.Item || null;
                    } catch (error) {
                        console.warn(`   ⚠️  لم يتم العثور على بيانات الجار ${candidate.regionId} في RegionsDerived`);
                    }
                    
                    // ✨ إعادة حساب expansion_priority بالمنطق المحسّن
                    const enhancedPriority = calculateEnhancedExpansionPriority(
                        relationship,
                        regionDerivedData,
                        candidateDerivedData
                    );
                    
                    neighbors.push({
                        neighbor_id: candidate.regionId,
                        neighbor_name: candidate.name,
                        neighbor_level: candidate.level || 0,
                        relationship: {
                            ...relationship,
                            expansion_priority: enhancedPriority  // ✅ استخدام الأولوية المحسّنة
                        },
                        // ✨ إضافة بيانات هرمية للتخزين
                        neighbor_parent_id: candidateDerivedData?.parent_id,
                        neighbor_governorate_id: candidateDerivedData?.governorate_id
                    });
                    
                    console.log(`   ✅ وجد جار: ${candidate.name} (${relationship.shared_boundary_km.toFixed(2)} km, priority: ${enhancedPriority})`);
                }
                
            } catch (error) {
                console.error(`   ⚠️  خطأ في فحص ${candidate.regionId}:`, error.message);
            }
        }
        
        // 6. كتابة في RegionNeighbors
        if (neighbors.length > 0) {
            await writeNeighborRelations(regionId, region.name, regionLevel, neighbors, regionDerivedData);
        }
        
        return neighbors.length;
        
    } catch (error) {
        console.error(`   ❌ خطأ في اكتشاف الجيران:`, error);
        throw error;
    }
}

/**
 * جلب المناطق المرشحة للمقارنة
 */
async function getCandidateRegions(excludeRegionId, regionLevel) {
    // للأداء: نجلب فقط المناطق في نفس المستوى أو قريبة منه
    const targetLevels = [
        regionLevel - 1,
        regionLevel,
        regionLevel + 1
    ].filter(l => l >= 0);
    
    const allCandidates = [];
    
    for (const level of targetLevels) {
        try {
            const result = await dynamodb.send(new QueryCommand({
                TableName: REGIONS_TABLE,
                IndexName: 'LevelIndex',
                KeyConditionExpression: '#level = :level',
                ExpressionAttributeNames: {
                    '#level': 'level'
                },
                ExpressionAttributeValues: {
                    ':level': level
                }
            }));
            
            if (result.Items) {
                allCandidates.push(...result.Items);
            }
        } catch (error) {
            console.error(`   ⚠️  خطأ في جلب level ${level}:`, error.message);
        }
    }
    
    // استبعاد المنطقة نفسها
    return allCandidates.filter(r => r.regionId !== excludeRegionId);
}

/**
 * تحليل العلاقة بين منطقتين
 */
function analyzeRelationship(feature1, feature2, intersection) {
    // 1. حساب المساحات
    const area1 = turf.area(feature1);
    const area2 = turf.area(feature2);
    const intersectionArea = turf.area(intersection);
    
    // 2. تحديد نوع العلاقة
    let type = 'unknown';
    
    if (intersectionArea < 100) {
        // تقاطع صغير جداً → متجاورة (adjacent)
        type = 'adjacent';
    } else if (intersectionArea / area1 > 0.9 || intersectionArea / area2 > 0.9) {
        // تقاطع كبير → متداخلة (overlapping)
        type = 'overlapping';
    } else {
        // تقاطع متوسط → متداخلة جزئياً
        type = 'partially_overlapping';
    }
    
    // 3. حساب طول الحدود المشتركة
    let sharedBoundaryKm = 0;
    
    // Calculate shared boundary for all types (not just adjacent)
    try {
        // استخراج الحدود المشتركة
        const boundary = turf.boundary(intersection);
        if (boundary) {
            sharedBoundaryKm = turf.length(boundary, { units: 'kilometers' });
        }
    } catch (error) {
        // Fallback: استخدام محيط التقاطع
        try {
            const perimeter = turf.length(turf.polygonToLine(intersection), { units: 'kilometers' });
            sharedBoundaryKm = perimeter / 4; // تقدير تقريبي
        } catch (e) {
            console.error('Failed to calculate boundary:', e.message);
        }
    }
    
    // 4. حساب expansion_priority
    const priority = calculateExpansionPriority(sharedBoundaryKm, type);
    
    return {
        type,
        shared_boundary_km: sharedBoundaryKm,
        intersection_area_m2: intersectionArea,
        expansion_priority: priority
    };
}

/**
 * حساب أولوية التوسع (الطريقة القديمة - للاحتفاظ بالتوافقية)
 */
function calculateExpansionPriority(sharedBoundaryKm, type) {
    if (type !== 'adjacent') {
        return 0; // لا أولوية للمناطق المتداخلة
    }
    
    // كلما كانت الحدود المشتركة أطول، كلما كانت الأولوية أعلى
    if (sharedBoundaryKm > 5) return 10;
    if (sharedBoundaryKm > 2) return 8;
    if (sharedBoundaryKm > 1) return 6;
    if (sharedBoundaryKm > 0.5) return 4;
    return 2;
}

/**
 * ✨ حساب أولوية التوسع - المنطق المحسّن
 * 
 * القواعد:
 * - Priority 0 (Core): نفس القضاء + حد قوي (≥5km)
 * - Priority 1 (Extended): نفس القضاء OR (قضاء مختلف + نفس المحافظة + حد قوي ≥8km)
 * - Priority 2 (Fallback): قضاء مختلف + حد ضعيف OR محافظة مختلفة
 * 
 * @param {Object} relationship - العلاقة الجغرافية (type, shared_boundary_km)
 * @param {Object} sourceData - بيانات المنطقة المصدر من RegionsDerived
 * @param {Object} targetData - بيانات المنطقة المستهدفة من RegionsDerived
 * @returns {Number} 0, 1, or 2
 */
function calculateEnhancedExpansionPriority(relationship, sourceData, targetData) {
    // لو البيانات غير متوفرة، استخدم الطريقة القديمة
    if (!sourceData || !targetData) {
        console.log(`   ⚠️  بيانات غير كاملة، استخدام المنطق القديم`);
        return calculateExpansionPriority(relationship.shared_boundary_km, relationship.type);
    }
    
    const sharedBoundaryKm = relationship.shared_boundary_km;
    const type = relationship.type;
    
    // المناطق المتداخلة بشكل كامل (overlapping) → لا أولوية
    // نقبل adjacent و partially_overlapping
    if (type !== 'adjacent' && type !== 'partially_overlapping') {
        console.log(`   ⚠️  النوع غير مدعوم: ${type}`);
        return 2;
    }
    
    // استخراج البيانات الهرمية
    const sourceLevel = sourceData.level;
    const targetLevel = targetData.level;
    const sourceParent = sourceData.parent_id;
    const targetParent = targetData.parent_id;
    
    // Level 3: نستخدم parent_id مباشرة (القضاء)
    // Level 2: نستخدم parent_id (المحافظة)
    // Level 1: نستخدم parent_id (الدولة)
    
    let sourceQadaa, targetQadaa, sourceGovernorate, targetGovernorate;
    
    if (sourceLevel === 3 && targetLevel === 3) {
        // كلاهما نواحي (Level 3)
        sourceQadaa = sourceParent;  // القضاء
        targetQadaa = targetParent;
        
        // المحافظة: نحتاج للصعود مستوى آخر
        sourceGovernorate = sourceData.governorate_id;
        targetGovernorate = targetData.governorate_id;
        
    } else if (sourceLevel === 2 && targetLevel === 2) {
        // كلاهما أقضية (Level 2)
        sourceQadaa = sourceData.regionId;
        targetQadaa = targetData.regionId;
        
        sourceGovernorate = sourceParent;  // المحافظة
        targetGovernorate = targetParent;
        
    } else {
        // مستويات مختلفة → أولوية منخفضة
        return 2;
    }
    
    // ✅ القاعدة 1: نفس القضاء
    if (sourceQadaa === targetQadaa) {
        // نفس القضاء + حد قوي → Priority 0 (Core)
        if (sharedBoundaryKm >= PRIORITY_THRESHOLDS.CORE_BOUNDARY_KM) {
            console.log(`   ✅ Priority 0: نفس القضاء (${sourceQadaa}) + حد قوي (${sharedBoundaryKm.toFixed(2)} km)`);
            return 0;
        }
        // نفس القضاء + حد ضعيف → Priority 1 (Extended)
        console.log(`   ✅ Priority 1: نفس القضاء (${sourceQadaa}) + حد ضعيف (${sharedBoundaryKm.toFixed(2)} km)`);
        return 1;
    }
    
    // ✅ القاعدة 2: قضاء مختلف + نفس المحافظة
    if (sourceGovernorate && targetGovernorate && sourceGovernorate === targetGovernorate) {
        // قضاء مختلف + نفس المحافظة + حد قوي → Priority 1 (Extended)
        if (sharedBoundaryKm >= PRIORITY_THRESHOLDS.CROSS_BOUNDARY_KM) {
            console.log(`   ✅ Priority 1: قضاء مختلف + نفس المحافظة (${sourceGovernorate}) + حد قوي (${sharedBoundaryKm.toFixed(2)} km)`);
            return 1;
        }
        // قضاء مختلف + نفس المحافظة + حد ضعيف → Priority 2 (Fallback)
        console.log(`   ✅ Priority 2: قضاء مختلف + نفس المحافظة (${sourceGovernorate}) + حد ضعيف (${sharedBoundaryKm.toFixed(2)} km)`);
        return 2;
    }
    
    // ✅ القاعدة 3: محافظة مختلفة أو بيانات غير مكتملة → Priority 2 (Fallback)
    if (!sourceGovernorate || !targetGovernorate) {
        console.log(`   ⚠️  Priority 2: بيانات المحافظة غير مكتملة`);
    } else {
        console.log(`   ✅ Priority 2: محافظة مختلفة (${sourceGovernorate} ≠ ${targetGovernorate})`);
    }
    return 2;
}

/**
 * كتابة علاقات الجيرة
 */
async function writeNeighborRelations(regionId, regionName, regionLevel, neighbors, regionDerivedData) {
    console.log(`   💾 كتابة ${neighbors.length} علاقات جيرة...`);
    
    const timestamp = new Date().toISOString();
    
    // كتابة بشكل bidirectional (A→B و B→A)
    for (const neighbor of neighbors) {
        // علاقة: regionId → neighbor
        const pairId1 = `${regionId}#${neighbor.neighbor_id}`;
        const relation1 = {
            neighbor_pair_id: pairId1,
            source_region_id: regionId,
            target_region_id: neighbor.neighbor_id,
            source_region_name: regionName,
            target_region_name: neighbor.neighbor_name,
            source_level: regionLevel,
            target_level: neighbor.neighbor_level,
            relationship_type: neighbor.relationship.type,
            shared_boundary_km: neighbor.relationship.shared_boundary_km,
            expansion_priority: neighbor.relationship.expansion_priority,
            // ✨ إضافة البيانات الهرمية
            source_parent_id: regionDerivedData?.parent_id,
            target_parent_id: neighbor.neighbor_parent_id,
            source_governorate_id: regionDerivedData?.governorate_id,
            target_governorate_id: neighbor.neighbor_governorate_id,
            discovered_at: timestamp
        };
        
        // علاقة: neighbor → regionId
        const pairId2 = `${neighbor.neighbor_id}#${regionId}`;
        const relation2 = {
            neighbor_pair_id: pairId2,
            source_region_id: neighbor.neighbor_id,
            target_region_id: regionId,
            source_region_name: neighbor.neighbor_name,
            target_region_name: regionName,
            source_level: neighbor.neighbor_level,
            target_level: regionLevel,
            relationship_type: neighbor.relationship.type,
            shared_boundary_km: neighbor.relationship.shared_boundary_km,
            expansion_priority: neighbor.relationship.expansion_priority,
            // ✨ إضافة البيانات الهرمية (معكوسة)
            source_parent_id: neighbor.neighbor_parent_id,
            target_parent_id: regionDerivedData?.parent_id,
            source_governorate_id: neighbor.neighbor_governorate_id,
            target_governorate_id: regionDerivedData?.governorate_id,
            discovered_at: timestamp
        };
        
        try {
            await dynamodb.send(new PutCommand({
                TableName: NEIGHBORS_TABLE,
                Item: relation1
            }));
            
            await dynamodb.send(new PutCommand({
                TableName: NEIGHBORS_TABLE,
                Item: relation2
            }));
            
        } catch (error) {
            console.error(`   ⚠️  فشل كتابة علاقة:`, error.message);
        }
    }
    
    console.log(`   ✅ تمت كتابة جميع العلاقات`);
}

/**
 * حذف جميع علاقات الجيرة لمنطقة
 */
async function deleteNeighborRelations(regionId) {
    console.log(`   🗑️  حذف علاقات الجيرة القديمة...`);
    
    try {
        // جلب جميع العلاقات (كـ source)
        const result1 = await dynamodb.send(new QueryCommand({
            TableName: NEIGHBORS_TABLE,
            IndexName: 'source-region-index',
            KeyConditionExpression: 'source_region_id = :regionId',
            ExpressionAttributeValues: {
                ':regionId': regionId
            }
        }));
        
        // جلب جميع العلاقات (كـ target)
        const result2 = await dynamodb.send(new QueryCommand({
            TableName: NEIGHBORS_TABLE,
            IndexName: 'target-region-index',
            KeyConditionExpression: 'target_region_id = :regionId',
            ExpressionAttributeValues: {
                ':regionId': regionId
            }
        }));
        
        const allRelations = [
            ...(result1.Items || []),
            ...(result2.Items || [])
        ];
        
        if (allRelations.length === 0) {
            console.log(`   ℹ️  لا توجد علاقات للحذف`);
            return;
        }
        
        console.log(`   📊 حذف ${allRelations.length} علاقات...`);
        
        // حذف بشكل Batch
        const BATCH_SIZE = 25;
        
        for (let i = 0; i < allRelations.length; i += BATCH_SIZE) {
            const batch = allRelations.slice(i, i + BATCH_SIZE);
            
            const deleteRequests = batch.map(rel => ({
                DeleteRequest: {
                    Key: {
                        neighbor_pair_id: rel.neighbor_pair_id
                    }
                }
            }));
            
            await dynamodb.send(new BatchWriteCommand({
                RequestItems: {
                    [NEIGHBORS_TABLE]: deleteRequests
                }
            }));
        }
        
        console.log(`   ✅ تم حذف جميع العلاقات`);
        
    } catch (error) {
        console.error(`   ⚠️  فشل حذف العلاقات:`, error.message);
    }
}
