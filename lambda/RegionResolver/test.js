/**
 * Local Test for RegionResolver Lambda
 * 
 * اختبار محلي قبل النشر على AWS
 */

const handler = require('./index').handler;

// Test cases
const testCases = [
    {
        name: 'Test 1: مركز النجف',
        event: {
            body: JSON.stringify({
                lat: 32.0167,
                lng: 44.3333
            })
        }
    },
    {
        name: 'Test 2: الحيرة',
        event: {
            body: JSON.stringify({
                lat: 31.9923,
                lng: 44.4223
            })
        }
    },
    {
        name: 'Test 3: موقع خارج الخدمة',
        event: {
            body: JSON.stringify({
                lat: 33.0,
                lng: 45.0
            })
        }
    },
    {
        name: 'Test 4: إحداثيات غير صالحة',
        event: {
            body: JSON.stringify({
                lat: 200,
                lng: 200
            })
        }
    }
];

// Run tests
async function runTests() {
    console.log('🧪 بدء الاختبارات المحلية...\n');
    
    for (const test of testCases) {
        console.log('━'.repeat(60));
        console.log(`📋 ${test.name}`);
        console.log('━'.repeat(60));
        
        try {
            const result = await handler(test.event);
            console.log('\n📤 الاستجابة:');
            console.log(JSON.stringify(JSON.parse(result.body), null, 2));
            console.log(`\n✅ Status: ${result.statusCode}\n`);
        } catch (error) {
            console.error(`\n❌ خطأ: ${error.message}\n`);
        }
    }
    
    console.log('━'.repeat(60));
    console.log('✅ انتهت الاختبارات');
}

// تشغيل
runTests().catch(console.error);
