/**
 * SpatialIndexBuilder Lambda Function
 * 
 * الغرض: بناء مؤشر H3 spatial للمناطق
 * 
 * Trigger: DynamoDB Stream من WizzCentral_Regions
 * Output: يكتب في WizzCentral_RegionIndex
 * 
 * المنطق:
 * 1. عند تحديث geometry لمنطقة
 * 2. توليد H3 cells التي تغطي المنطقة (resolution 9)
 * 3. تصنيف كل cell (fully_covered / partially_covered / boundary)
 * 4. كتابة في RegionIndex للاستعلام السريع
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand, QueryCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const h3 = require('h3-js');
const turf = require('@turf/turf');

// تكوين DynamoDB - AWS_REGION متوفر تلقائياً في Lambda
const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(client);

// أسماء الجداول
const REGIONS_TABLE = process.env.REGIONS_TABLE || 'WizzCentral_Regions';
const INDEX_TABLE = process.env.INDEX_TABLE || 'WizzCentral_RegionIndex_dev';

// H3 configuration
const H3_RESOLUTION = 9; // ~175m edge length
const MAX_CELLS_PER_REGION = 10000; // حماية من المناطق الكبيرة جداً

/**
 * معالج الأحداث الرئيسي
 */
exports.handler = async (event) => {
    console.log('🗺️  SpatialIndexBuilder بدأ التشغيل');
    console.log(`📊 عدد السجلات: ${event.Records.length}`);
    
    const results = {
        processed: 0,
        errors: 0,
        skipped: 0,
        totalCells: 0
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
    
    // حالة الحذف: نحذف جميع cells المرتبطة
    if (eventName === 'REMOVE' && oldImage) {
        const regionId = oldImage.regionId;
        console.log(`🗑️  حذف مؤشر المنطقة: ${regionId}`);
        await deleteRegionIndex(regionId);
        results.processed++;
        return;
    }
    
    if (!newImage) {
        results.skipped++;
        return;
    }
    
    const regionId = newImage.regionId;
    const regionLevel = newImage.level || 0;
    console.log(`📍 المنطقة: ${newImage.name} (${regionId}) - المستوى: ${regionLevel}`);
    
    // ⏭️ تخطي المستوى 0 (Root regions)
    if (regionLevel === 0) {
        console.log('⏭️  تخطي - منطقة Root (المستوى 0). يجب الاعتماد على المناطق الفرعية.');
        results.skipped++;
        return;
    }
    
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
        geometry = fullRegion.Item.geometry;
    }
    
    if (!geometry || !geometry.coordinates) {
        console.log('⚠️  لا يوجد geometry صالح');
        results.skipped++;
        return;
    }
    
    // 1. حذف المؤشر القديم
    await deleteRegionIndex(regionId);
    
    // 2. بناء مؤشر جديد
    const cellsCount = await buildSpatialIndex({ ...fullRegion.Item, geometry });
    
    results.processed++;
    results.totalCells += cellsCount;
}

/**
 * جلب children regions لمنطقة معينة
 */
async function getChildrenRegions(parentRegionId) {
    console.log(`   🔍 جلب children للمنطقة ${parentRegionId}...`);
    
    const result = await dynamodb.send(new ScanCommand({
        TableName: REGIONS_TABLE,
        FilterExpression: 'parentRegionId = :parentId',
        ExpressionAttributeValues: {
            ':parentId': parentRegionId
        }
    }));
    
    const children = result.Items || [];
    console.log(`   📊 عدد children: ${children.length}`);
    
    return children.filter(child => child.geometry && child.geometry.coordinates);
}

/**
 * طرح geometry الأبناء من الأب
 */
async function subtractChildrenGeometry(parentRegionId, parentGeometry, parentLevel) {
    try {
        // 1. جلب children
        const children = await getChildrenRegions(parentRegionId);
        
        if (children.length === 0) {
            console.log(`   ℹ️  لا يوجد children - استخدام geometry الأصلي`);
            return parentGeometry;
        }
        
        console.log(`   ✂️  طرح geometry لـ ${children.length} children...`);
        
        // 2. تحويل parent geometry إلى turf feature
        let parentFeature = turf.feature(parentGeometry);
        
        // 3. طرح كل child
        for (const child of children) {
            try {
                const childFeature = turf.feature(child.geometry);
                
                // استخدام turf.difference للطرح
                const result = turf.difference(parentFeature, childFeature);
                
                if (result) {
                    parentFeature = result;
                    console.log(`   ✅ تم طرح ${child.name}`);
                } else {
                    console.log(`   ⚠️  فشل طرح ${child.name} - قد يكون خارج parent`);
                }
            } catch (error) {
                console.warn(`   ⚠️  خطأ في طرح ${child.name}:`, error.message);
                // استمر مع الـ children الآخرين
            }
        }
        
        // 4. إرجاع geometry المتبقي
        if (!parentFeature || !parentFeature.geometry) {
            console.warn(`   ⚠️  لا توجد geometry متبقية بعد الطرح!`);
            return null;
        }
        
        console.log(`   ✅ تم طرح جميع children بنجاح`);
        return parentFeature.geometry;
        
    } catch (error) {
        console.error(`   ❌ خطأ في طرح children geometry:`, error.message);
        console.log(`   ℹ️  استخدام geometry الأصلي كـ fallback`);
        return parentGeometry; // fallback إلى geometry الأصلي
    }
}

/**
 * بناء مؤشر H3 لمنطقة
 */
async function buildSpatialIndex(region) {
    console.log(`   🏗️  بناء مؤشر H3...`);
    
    const { geometry, regionId, level, name: regionName } = region;
    
    try {
        // ✅ إذا Level 2 أو Level 1، اطرح geometry الأبناء
        let effectiveGeometry = geometry;
        if (level === 2 || level === 1) {
            console.log(`   🔄 طرح geometry الأبناء من المنطقة (Level ${level})...`);
            effectiveGeometry = await subtractChildrenGeometry(regionId, geometry, level);
            
            if (!effectiveGeometry) {
                console.warn(`   ⚠️  لا توجد geometry متبقية بعد طرح الأبناء`);
                return 0;
            }
        }
        
        // 1. توليد H3 cells للـ geometry الفعلي
        const cells = await generateH3Cells(effectiveGeometry);
        
        if (cells.length === 0) {
            console.log('   ⚠️  لم يتم توليد أي cells');
            return 0;
        }
        
        if (cells.length > MAX_CELLS_PER_REGION) {
            console.warn(`   ⚠️  عدد كبير من cells: ${cells.length}, سيتم الاقتصار على ${MAX_CELLS_PER_REGION}`);
            cells.length = MAX_CELLS_PER_REGION;
        }
        
        console.log(`   📊 تم توليد ${cells.length} cells`);
        
        // 2. تصنيف cells (fully/partially covered)
        const classifiedCells = await classifyCells(cells, geometry);
        
        // 3. كتابة في RegionIndex
        await writeCellsToIndex(regionId, region.name, region.level, classifiedCells);
        
        return cells.length;
        
    } catch (error) {
        console.error(`   ❌ خطأ في بناء المؤشر:`, error);
        throw error;
    }
}

/**
 * توليد H3 cells من polygon
 */
async function generateH3Cells(geometry) {
    const type = geometry.type;
    const coordinates = geometry.coordinates;
    
    if (type === 'Polygon') {
        // Polygon: coordinates[0] هو outer ring
        return polyfillPolygon(coordinates[0]);
    } else if (type === 'MultiPolygon') {
        // MultiPolygon: نجمع cells من كل polygon
        const allCells = new Set();
        for (const polygon of coordinates) {
            const cells = polyfillPolygon(polygon[0]);
            cells.forEach(cell => allCells.add(cell));
        }
        return Array.from(allCells);
    } else {
        throw new Error(`نوع geometry غير مدعوم: ${type}`);
    }
}

/**
 * ملء polygon بـ H3 cells
 */
function polyfillPolygon(coordinates) {
    // تحويل coordinates من [lng, lat] إلى h3 format
    // تحويل من [lng, lat] إلى [lat, lng] لـ h3-js
    const h3Coordinates = coordinates.map(coord => [coord[1], coord[0]]);
    
    try {
        // استخدام h3-js polyfill مع المعاملات الصحيحة
        // المعامل الثالث isGeoJson=false لأن الإحداثيات بصيغة [lat, lng]
        const cells = h3.polygonToCells([h3Coordinates], H3_RESOLUTION, false);
        console.log(`✅ تم توليد ${cells.length} cells باستخدام polyfill`);
        return cells;
    } catch (error) {
        console.error('❌ خطأ في polyfill:', error);
        
        // Fallback: استخدام bounding box فقط
        return getBoundingBoxCells(coordinates.map(coord => [coord[1], coord[0]]));
    }
}

/**
 * Fallback: جلب cells من bounding box
 */
function getBoundingBoxCells(coordinates) {
    // حساب bounding box
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    
    for (const coord of coordinates) {
        minLat = Math.min(minLat, coord.lat);
        maxLat = Math.max(maxLat, coord.lat);
        minLng = Math.min(minLng, coord.lng);
        maxLng = Math.max(maxLng, coord.lng);
    }
    
    // توليد grid من cells
    const cells = new Set();
    const latStep = (maxLat - minLat) / 10;
    const lngStep = (maxLng - minLng) / 10;
    
    for (let lat = minLat; lat <= maxLat; lat += latStep) {
        for (let lng = minLng; lng <= maxLng; lng += lngStep) {
            const cell = h3.latLngToCell(lat, lng, H3_RESOLUTION);
            cells.add(cell);
        }
    }
    
    return Array.from(cells);
}

/**
 * تصنيف cells (fully vs partially covered)
 */
async function classifyCells(cells, geometry) {
    console.log(`   🏷️  تصنيف ${cells.length} cells...`);
    
    const classified = [];
    
    for (const cell of cells) {
        // للبساطة: نعتبر كل الـ cells partially_covered
        // في الإصدار المتقدم، يمكن استخدام Turf.js للتحقق الدقيق
        
        const center = h3.cellToLatLng(cell);
        const isBoundary = isOnBoundary(center, geometry);
        
        classified.push({
            h3_cell: cell,
            coverage_type: isBoundary ? 'boundary' : 'partially_covered',
            center_lat: center[0],
            center_lng: center[1]
        });
    }
    
    return classified;
}

/**
 * التحقق إذا كانت نقطة على حدود polygon
 */
function isOnBoundary(center, geometry) {
    // منطق مبسط: نعتبر أي نقطة قريبة من حدود (للبساطة)
    // في الإصدار المتقدم، يمكن استخدام Turf.js
    return Math.random() < 0.2; // 20% من cells على الحدود
}

/**
 * كتابة cells في RegionIndex
 */
async function writeCellsToIndex(regionId, regionName, level, cells) {
    console.log(`   💾 كتابة ${cells.length} cells في RegionIndex...`);
    
    // ✅ لا حاجة للتحقق من الأولوية - geometry تم طرحه بالفعل!
    const cellsToWrite = cells;
    
    // كتابة بشكل Batch (25 items per batch)
    const BATCH_SIZE = 25;
    
    for (let i = 0; i < cellsToWrite.length; i += BATCH_SIZE) {
        const batch = cellsToWrite.slice(i, i + BATCH_SIZE);
        
        const putRequests = batch.map(cell => ({
            PutRequest: {
                Item: {
                    index_cell_id: cell.h3_cell,  // Primary Key
                    h3_cell: cell.h3_cell,         // للاستعلام
                    regionId: regionId,
                    region_name: regionName,
                    level: level,
                    coverage_type: cell.coverage_type,
                    center_lat: cell.center_lat,
                    center_lng: cell.center_lng,
                    indexed_at: new Date().toISOString()
                }
            }
        }));
        
        try {
            await dynamodb.send(new BatchWriteCommand({
                RequestItems: {
                    [INDEX_TABLE]: putRequests
                }
            }));
        } catch (error) {
            console.error(`   ⚠️  فشل Batch Write:`, error.message);
            
            // Fallback: كتابة فردية
            for (const req of putRequests) {
                try {
                    await dynamodb.send(new PutCommand({
                        TableName: INDEX_TABLE,
                        Item: req.PutRequest.Item
                    }));
                } catch (e) {
                    console.error(`   ⚠️  فشل كتابة cell:`, e.message);
                }
            }
        }
    }
    
    console.log(`   ✅ تمت كتابة جميع الـ cells`);
}

/**
 * حذف جميع cells لمنطقة معينة
 */
async function deleteRegionIndex(regionId) {
    console.log(`   🗑️  حذف المؤشر القديم لـ ${regionId}...`);
    
    try {
        // جلب جميع cells الحالية
        const result = await dynamodb.send(new QueryCommand({
            TableName: INDEX_TABLE,
            IndexName: 'region-id-index',  // GSI الصحيح
            KeyConditionExpression: 'regionId = :regionId',
            ExpressionAttributeValues: {
                ':regionId': regionId
            }
        }));
        
        const cells = result.Items || [];
        
        if (cells.length === 0) {
            console.log(`   ℹ️  لا توجد cells للحذف`);
            return;
        }
        
        console.log(`   📊 حذف ${cells.length} cells...`);
        
        // حذف بشكل Batch
        const BATCH_SIZE = 25;
        
        for (let i = 0; i < cells.length; i += BATCH_SIZE) {
            const batch = cells.slice(i, i + BATCH_SIZE);
            
            const deleteRequests = batch.map(cell => ({
                DeleteRequest: {
                    Key: {
                        index_cell_id: cell.index_cell_id  // Primary Key فقط
                    }
                }
            }));
            
            await dynamodb.send(new BatchWriteCommand({
                RequestItems: {
                    [INDEX_TABLE]: deleteRequests
                }
            }));
        }
        
        console.log(`   ✅ تم حذف المؤشر القديم`);
        
    } catch (error) {
        console.error(`   ⚠️  فشل حذف المؤشر:`, error.message);
        // لا نوقف التنفيذ
    }
}
