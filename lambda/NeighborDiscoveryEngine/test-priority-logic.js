/**
 * اختبار منطق calculateEnhancedExpansionPriority
 * 
 * يختبر جميع الحالات الممكنة للتأكد من صحة المنطق
 */

// محاكاة الثوابت
const PRIORITY_THRESHOLDS = {
    CORE_BOUNDARY_KM: 5,
    CROSS_BOUNDARY_KM: 8
};

// نسخة من الدالة للاختبار
function calculateEnhancedExpansionPriority(relationship, sourceData, targetData) {
    if (!sourceData || !targetData) {
        console.log(`   ⚠️  بيانات غير كاملة، استخدام المنطق القديم`);
        return -1; // للاختبار فقط
    }
    
    const sharedBoundaryKm = relationship.shared_boundary_km;
    const type = relationship.type;
    
    if (type !== 'adjacent') {
        return 2;
    }
    
    const sourceLevel = sourceData.level;
    const targetLevel = targetData.level;
    const sourceParent = sourceData.parent_id;
    const targetParent = targetData.parent_id;
    
    let sourceQadaa, targetQadaa;
    let sourceGovernorate, targetGovernorate;
    
    if (sourceLevel === 3 && targetLevel === 3) {
        sourceQadaa = sourceParent;
        targetQadaa = targetParent;
        sourceGovernorate = sourceData.governorate_id;
        targetGovernorate = targetData.governorate_id;
    } else if (sourceLevel === 2 && targetLevel === 2) {
        sourceQadaa = sourceData.regionId;
        targetQadaa = targetData.regionId;
        sourceGovernorate = sourceParent;
        targetGovernorate = targetParent;
    } else {
        return 2;
    }
    
    // القاعدة 1: نفس القضاء
    if (sourceQadaa === targetQadaa) {
        if (sharedBoundaryKm >= PRIORITY_THRESHOLDS.CORE_BOUNDARY_KM) {
            console.log(`   ✅ Priority 0: نفس القضاء + حد قوي`);
            return 0;
        }
        console.log(`   ✅ Priority 1: نفس القضاء + حد ضعيف`);
        return 1;
    }
    
    // القاعدة 2: قضاء مختلف + نفس المحافظة
    if (sourceGovernorate === targetGovernorate) {
        if (sharedBoundaryKm >= PRIORITY_THRESHOLDS.CROSS_BOUNDARY_KM) {
            console.log(`   ✅ Priority 1: قضاء مختلف + نفس المحافظة + حد قوي`);
            return 1;
        }
        console.log(`   ✅ Priority 2: قضاء مختلف + نفس المحافظة + حد ضعيف`);
        return 2;
    }
    
    // القاعدة 3: محافظة مختلفة
    console.log(`   ✅ Priority 2: محافظة مختلفة`);
    return 2;
}

// حالات الاختبار
const testCases = [
    {
        name: "نواحي في نفس القضاء - حد قوي",
        relationship: { type: 'adjacent', shared_boundary_km: 7.2 },
        source: {
            regionId: 'najaf_manathira_center',
            level: 3,
            parent_id: 'najaf_manathira',
            governorate_id: 'najaf'
        },
        target: {
            regionId: 'najaf_manathira_hira',
            level: 3,
            parent_id: 'najaf_manathira',
            governorate_id: 'najaf'
        },
        expected: 0
    },
    {
        name: "نواحي في نفس القضاء - حد ضعيف",
        relationship: { type: 'adjacent', shared_boundary_km: 3.5 },
        source: {
            regionId: 'najaf_manathira_center',
            level: 3,
            parent_id: 'najaf_manathira',
            governorate_id: 'najaf'
        },
        target: {
            regionId: 'najaf_manathira_qadisiya',
            level: 3,
            parent_id: 'najaf_manathira',
            governorate_id: 'najaf'
        },
        expected: 1
    },
    {
        name: "نواحي في قضاءين مختلفين - نفس المحافظة - حد قوي",
        relationship: { type: 'adjacent', shared_boundary_km: 10.5 },
        source: {
            regionId: 'najaf_manathira_center',
            level: 3,
            parent_id: 'najaf_manathira',
            governorate_id: 'najaf'
        },
        target: {
            regionId: 'najaf_center_rudhawiya',
            level: 3,
            parent_id: 'najaf_center',
            governorate_id: 'najaf'
        },
        expected: 1
    },
    {
        name: "نواحي في قضاءين مختلفين - نفس المحافظة - حد ضعيف",
        relationship: { type: 'adjacent', shared_boundary_km: 4.0 },
        source: {
            regionId: 'najaf_manathira_center',
            level: 3,
            parent_id: 'najaf_manathira',
            governorate_id: 'najaf'
        },
        target: {
            regionId: 'najaf_kufa_1',
            level: 3,
            parent_id: 'najaf_kufa',
            governorate_id: 'najaf'
        },
        expected: 2
    },
    {
        name: "محافظات مختلفة",
        relationship: { type: 'adjacent', shared_boundary_km: 15.0 },
        source: {
            regionId: 'najaf_center_1',
            level: 3,
            parent_id: 'najaf_center',
            governorate_id: 'najaf'
        },
        target: {
            regionId: 'diwaniya_south_1',
            level: 3,
            parent_id: 'diwaniya_south',
            governorate_id: 'diwaniya'
        },
        expected: 2
    },
    {
        name: "أقضية في نفس المحافظة",
        relationship: { type: 'adjacent', shared_boundary_km: 12.0 },
        source: {
            regionId: 'najaf_manathira',
            level: 2,
            parent_id: 'najaf',
            governorate_id: 'najaf'
        },
        target: {
            regionId: 'najaf_center',
            level: 2,
            parent_id: 'najaf',
            governorate_id: 'najaf'
        },
        expected: 1
    },
    {
        name: "مناطق متداخلة (overlapping)",
        relationship: { type: 'overlapping', shared_boundary_km: 10.0 },
        source: {
            regionId: 'najaf_center_1',
            level: 3,
            parent_id: 'najaf_center',
            governorate_id: 'najaf'
        },
        target: {
            regionId: 'najaf_center_2',
            level: 3,
            parent_id: 'najaf_center',
            governorate_id: 'najaf'
        },
        expected: 2
    },
    {
        name: "مستويات مختلفة",
        relationship: { type: 'adjacent', shared_boundary_km: 10.0 },
        source: {
            regionId: 'najaf_center',
            level: 2,
            parent_id: 'najaf',
            governorate_id: 'najaf'
        },
        target: {
            regionId: 'najaf_center_1',
            level: 3,
            parent_id: 'najaf_center',
            governorate_id: 'najaf'
        },
        expected: 2
    }
];

// تشغيل الاختبارات
console.log('🧪 بدء اختبار calculateEnhancedExpansionPriority\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Test ${index + 1}: ${test.name}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`المدخلات:`);
    console.log(`  - Type: ${test.relationship.type}`);
    console.log(`  - Shared Boundary: ${test.relationship.shared_boundary_km} km`);
    console.log(`  - Source: ${test.source.regionId} (Level ${test.source.level})`);
    console.log(`  - Target: ${test.target.regionId} (Level ${test.target.level})`);
    console.log(`  - Source Parent: ${test.source.parent_id}`);
    console.log(`  - Target Parent: ${test.target.parent_id}`);
    console.log(`  - Source Governorate: ${test.source.governorate_id}`);
    console.log(`  - Target Governorate: ${test.target.governorate_id}`);
    
    const result = calculateEnhancedExpansionPriority(
        test.relationship,
        test.source,
        test.target
    );
    
    const success = result === test.expected;
    
    if (success) {
        console.log(`\n✅ النتيجة: ${result} (متوقع: ${test.expected}) - نجح`);
        passed++;
    } else {
        console.log(`\n❌ النتيجة: ${result} (متوقع: ${test.expected}) - فشل`);
        failed++;
    }
});

console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`📊 النتيجة النهائية`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ نجح: ${passed}/${testCases.length}`);
console.log(`❌ فشل: ${failed}/${testCases.length}`);

if (failed === 0) {
    console.log(`\n🎉 جميع الاختبارات نجحت!`);
    process.exit(0);
} else {
    console.log(`\n⚠️  بعض الاختبارات فشلت`);
    process.exit(1);
}
