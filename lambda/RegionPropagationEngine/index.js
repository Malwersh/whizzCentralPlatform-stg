/**
 * RegionPropagationEngine Lambda Function
 * 
 * الغرض: حساب الحالة الفعلية للمناطق مع الوراثة الهرمية
 * 
 * Trigger: DynamoDB Stream من WizzCentral_Regions
 * Output: يكتب في WizzCentral_RegionsDerived
 * 
 * المنطق:
 * 1. عند تغيير منطقة (CREATE/UPDATE)
 * 2. جلب سلسلة الوراثة (parent → grandparent → root)
 * 3. حساب الحالة الفعلية (inheritance cascade)
 * 4. كتابة النتيجة في RegionsDerived
 * 5. إطلاق إعادة حساب للأبناء (recursive propagation)
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

// تكوين DynamoDB - AWS_REGION متوفر تلقائياً في Lambda
const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(client);

// أسماء الجداول
const REGIONS_TABLE = process.env.REGIONS_TABLE || 'WizzCentral_Regions';
const DERIVED_TABLE = process.env.DERIVED_TABLE || 'WizzCentral_RegionsDerived_dev';
const AUDIT_TABLE = process.env.AUDIT_TABLE || 'WizzCentral_RegionAudit_dev';

/**
 * معالج الأحداث الرئيسي
 */
exports.handler = async (event) => {
    console.log('🚀 RegionPropagationEngine بدأ التشغيل');
    console.log(`📊 عدد السجلات: ${event.Records.length}`);
    
    const results = {
        processed: 0,
        errors: 0,
        skipped: 0
    };
    
    try {
        // معالجة كل سجل من Stream
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
    const eventName = record.eventName; // INSERT, MODIFY, REMOVE
    
    console.log(`\n🔄 معالجة: ${eventName}`);
    
    // تجاهل عمليات الحذف (سنتعامل معها لاحقاً)
    if (eventName === 'REMOVE') {
        console.log('⏭️  تجاهل REMOVE');
        results.skipped++;
        return;
    }
    
    // استخراج البيانات
    const newImage = record.dynamodb.NewImage ? unmarshall(record.dynamodb.NewImage) : null;
    const oldImage = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : null;
    
    if (!newImage) {
        console.log('⚠️  لا توجد بيانات جديدة');
        results.skipped++;
        return;
    }
    
    const regionId = newImage.regionId;
    console.log(`📍 المنطقة: ${newImage.name} (${regionId})`);
    
    // 1. حساب الحالة الفعلية للمنطقة الحالية
    const effectiveState = await computeEffectiveState(newImage);
    
    // 2. كتابة في RegionsDerived
    await writeToDerivedException(regionId, effectiveState);
    
    // 3. تسجيل في Audit
    await writeAuditLog(regionId, eventName, oldImage, newImage, effectiveState);
    
    // 4. إطلاق إعادة حساب للأبناء
    await propagateToChildren(regionId, effectiveState);
    
    results.processed++;
}

/**
 * حساب الحالة الفعلية مع الوراثة
 */
async function computeEffectiveState(region) {
    console.log(`   🧮 حساب الحالة الفعلية لـ ${region.regionId}...`);
    
    // 1. جلب سلسلة الأهل (inheritance chain)
    const inheritanceChain = await getInheritanceChain(region);
    console.log(`   📜 سلسلة الوراثة: ${inheritanceChain.map(r => r.regionId).join(' → ')}`);
    
    // 2. بناء الحالة الفعلية
    const effectiveState = {
        regionId: region.regionId,
        parent_id: region.parent_id || "ROOT", // استخدام "ROOT" بدلاً من null للـ GSI
        level: region.level || 0,
        
        // ✨ الأسماء (name fields) - جديد
        name: region.name || null,
        name_ar: region.name_ar || null,
        
        // الحالة الفعلية (is_active)
        effective_is_active: computeEffectiveActive(region, inheritanceChain),
        
        // الأسعار الفعلية (pricing)
        effective_pricing: computeEffectivePricing(region, inheritanceChain),
        
        // الحدود الفعلية (limits)
        effective_limits: computeEffectiveLimits(region, inheritanceChain),
        
        // التكوين الفعلي (config)
        effective_config: computeEffectiveConfig(region, inheritanceChain),
        
        // معلومات الوراثة
        inheritance_chain: inheritanceChain.map(r => r.regionId),
        inheritance_source: {
            is_active: findInheritanceSource(region, inheritanceChain, 'is_active'),
            pricing: findInheritanceSource(region, inheritanceChain, 'self_pricing'),
            limits: findInheritanceSource(region, inheritanceChain, 'self_limits')
        },
        
        // Metadata
        computed_at: new Date().toISOString(),
        version: region.version || 1
    };
    
    return effectiveState;
}

/**
 * جلب سلسلة الأهل (من الأهل للجد للجد الأكبر...)
 */
async function getInheritanceChain(region) {
    const chain = [region];
    let currentRegion = region;
    
    // نصعد في الشجرة حتى نصل للجذر (root)
    while (currentRegion.parent_id) {
        try {
            const parent = await getRegion(currentRegion.parent_id);
            if (!parent) break;
            
            chain.push(parent);
            currentRegion = parent;
            
            // حماية من الحلقات اللانهائية
            if (chain.length > 10) {
                console.warn('⚠️  تحذير: سلسلة وراثة طويلة جداً');
                break;
            }
        } catch (error) {
            console.error(`⚠️  فشل جلب الأهل ${currentRegion.parent_id}:`, error.message);
            break;
        }
    }
    
    return chain;
}

/**
 * جلب منطقة من الجدول
 */
async function getRegion(regionId) {
    const result = await dynamodb.send(new GetCommand({
        TableName: REGIONS_TABLE,
        Key: { regionId }
    }));
    
    return result.Item || null;
}

/**
 * حساب is_active الفعلي
 */
function computeEffectiveActive(region, chain) {
    // 1. إذا المنطقة عندها override، نستخدمه
    if (region.override_parent_active !== undefined) {
        return region.override_parent_active;
    }
    
    // 2. نستخدم قيمة المنطقة نفسها
    if (region.is_active !== undefined) {
        return region.is_active;
    }
    
    // 3. نبحث في السلسلة
    for (const ancestor of chain.slice(1)) { // نبدأ من الأهل
        if (ancestor.is_active !== undefined) {
            return ancestor.is_active;
        }
    }
    
    // 4. القيمة الافتراضية
    return true;
}

/**
 * حساب pricing الفعلي
 */
function computeEffectivePricing(region, chain) {
    // 1. إذا المنطقة عندها self_pricing، نستخدمه
    if (region.self_pricing && Object.keys(region.self_pricing).length > 0) {
        return region.self_pricing;
    }
    
    // 2. نبحث في السلسلة
    for (const ancestor of chain.slice(1)) {
        if (ancestor.self_pricing && Object.keys(ancestor.self_pricing).length > 0) {
            return ancestor.self_pricing;
        }
    }
    
    // 3. القيمة الافتراضية
    return {
        base_fee: 2.0,
        per_km: 0.5,
        minimum_order: 5.0,
        service_fee_percent: 10
    };
}

/**
 * حساب limits الفعلي
 */
function computeEffectiveLimits(region, chain) {
    // منطق مشابه للـ pricing
    if (region.self_limits && Object.keys(region.self_limits).length > 0) {
        return region.self_limits;
    }
    
    for (const ancestor of chain.slice(1)) {
        if (ancestor.self_limits && Object.keys(ancestor.self_limits).length > 0) {
            return ancestor.self_limits;
        }
    }
    
    return {
        max_delivery_distance_km: 10,
        max_active_orders_per_driver: 3,
        min_driver_rating: 4.0
    };
}

/**
 * حساب config الفعلي
 */
function computeEffectiveConfig(region, chain) {
    // دمج التكوينات من كل المستويات
    let config = {};
    
    // نبدأ من الجذر ونتقدم للأسفل (لتطبيق overrides)
    for (let i = chain.length - 1; i >= 0; i--) {
        const r = chain[i];
        
        // أولاً: دمج service_config
        if (r.service_config) {
            Object.keys(r.service_config).forEach(key => {
                const value = r.service_config[key];
                
                // إذا كانت القيمة false، نضعها كـ false
                if (value === false) {
                    config[key] = false;
                }
                // إذا كانت القيمة true، نضعها كـ true (وليس object)
                else if (value === true) {
                    config[key] = true;
                }
                // إذا كانت القيمة object، ندمجها
                else if (typeof value === 'object' && value !== null) {
                    if (!config[key] || typeof config[key] !== 'object') {
                        config[key] = {};
                    }
                    Object.assign(config[key], value);
                }
            });
        }
        
        // ثانياً: دمج delivery_config إذا كانت delivery مفعلة
        if (r.delivery_config && config.delivery === true) {
            config.delivery = { ...r.delivery_config };
        }
    }
    
    return config;
}

/**
 * إيجاد مصدر الوراثة لحقل معين
 */
function findInheritanceSource(region, chain, fieldName) {
    if (region[fieldName] !== undefined) {
        return region.regionId;
    }
    
    for (const ancestor of chain.slice(1)) {
        if (ancestor[fieldName] !== undefined) {
            return ancestor.regionId;
        }
    }
    
    return 'default';
}

/**
 * كتابة في RegionsDerived
 */
async function writeToDerivedException(regionId, effectiveState) {
    console.log(`   💾 كتابة في RegionsDerived...`);
    
    await dynamodb.send(new PutCommand({
        TableName: DERIVED_TABLE,
        Item: {
            ...effectiveState,
            effective_is_active: effectiveState.effective_is_active ? 1 : 0 // للـ GSI
        }
    }));
    
    console.log(`   ✅ تمت الكتابة بنجاح`);
}

/**
 * كتابة سجل Audit
 */
async function writeAuditLog(regionId, action, oldImage, newImage, effectiveState) {
    const auditId = `${regionId}#${Date.now()}`;
    
    const auditRecord = {
        audit_id: auditId,
        regionId,
        timestamp: Date.now(),
        action,
        changed_by: 'system:PropagationEngine',
        before: oldImage ? {
            is_active: oldImage.is_active,
            self_pricing: oldImage.self_pricing,
            self_limits: oldImage.self_limits
        } : null,
        after: {
            effective_is_active: effectiveState.effective_is_active,
            effective_pricing: effectiveState.effective_pricing,
            effective_limits: effectiveState.effective_limits
        }
    };
    
    try {
        await dynamodb.send(new PutCommand({
            TableName: AUDIT_TABLE,
            Item: auditRecord
        }));
        console.log(`   📝 تم تسجيل Audit`);
    } catch (error) {
        console.error(`   ⚠️  فشل تسجيل Audit:`, error.message);
        // لا نوقف التنفيذ إذا فشل Audit
    }
}

/**
 * نشر التغييرات للأبناء
 */
async function propagateToChildren(regionId, effectiveState) {
    console.log(`   👶 البحث عن الأبناء...`);
    
    try {
        // جلب جميع الأبناء المباشرين
        const children = await getChildren(regionId);
        
        if (children.length === 0) {
            console.log(`   ℹ️  لا توجد مناطق أبناء`);
            return;
        }
        
        console.log(`   📊 وجد ${children.length} أبناء`);
        
        // إعادة حساب كل ابن
        for (const child of children) {
            try {
                console.log(`   🔄 إعادة حساب: ${child.name} (${child.regionId})`);
                const childEffectiveState = await computeEffectiveState(child);
                await writeToDerivedException(child.regionId, childEffectiveState);
                
                // استمرار العملية للأحفاد (recursive)
                await propagateToChildren(child.regionId, childEffectiveState);
            } catch (error) {
                console.error(`   ⚠️  فشل معالجة ${child.regionId}:`, error.message);
            }
        }
        
    } catch (error) {
        console.error(`   ⚠️  فشل جلب الأبناء:`, error.message);
    }
}

/**
 * جلب جميع الأبناء المباشرين لمنطقة
 */
async function getChildren(parentId) {
    const result = await dynamodb.send(new QueryCommand({
        TableName: REGIONS_TABLE,
        IndexName: 'ParentIndex',
        KeyConditionExpression: 'parentRegionId = :parentId',
        ExpressionAttributeValues: {
            ':parentId': parentId
        }
    }));
    
    return result.Items || [];
}
