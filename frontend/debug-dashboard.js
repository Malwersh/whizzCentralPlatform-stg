// Dashboard Debug Script
// Copy and paste this into the browser console to debug data loading

console.log('🔍 DASHBOARD DEBUG SCRIPT - Starting...');
console.log('═══════════════════════════════════════════════════════════');

// Step 1: Check if key objects exist
console.log('\n📦 Step 1: Checking required objects...');
console.log('   window.dataService:', typeof window.dataService);
console.log('   window.AWSUtils:', typeof window.AWSUtils);
console.log('   window.AWS:', typeof window.AWS);

// Step 2: Check if AWS is initialized
console.log('\n🔧 Step 2: Checking AWS initialization...');
if (window.AWSUtils) {
    console.log('   AWSUtils.isInitialized:', window.AWSUtils.isInitialized);
    console.log('   AWSUtils.dynamodbClient:', !!window.AWSUtils.dynamodbClient);
}

// Step 3: Check AWS credentials
console.log('\n🔑 Step 3: Checking AWS credentials...');
if (window.AWS && window.AWS.config && window.AWS.config.credentials) {
    console.log('   Credentials exist:', !!window.AWS.config.credentials);
    console.log('   Access Key:', window.AWS.config.credentials.accessKeyId ? 'Set' : 'Not set');
    console.log('   Region:', window.AWS.config.region);
} else {
    console.log('   ❌ AWS credentials NOT configured!');
}

// Step 4: Try to manually load data
console.log('\n📊 Step 4: Manually testing data loading...');

async function testDataLoading() {
    try {
        // Test dataService initialization
        console.log('   Testing dataService.initialize()...');
        if (!window.dataService) {
            console.error('   ❌ window.dataService is not available!');
            return;
        }
        
        await window.dataService.initialize();
        console.log('   ✅ dataService initialized');
        
        // Test merchants scan
        console.log('\n   Testing merchants scan...');
        const merchantsResult = await window.dataService.scan('WhizzMerchants_Businesses', { Select: 'COUNT' });
        console.log('   Merchants result:', merchantsResult);
        console.log('   Merchants count:', merchantsResult?.Count);
        
        // Test drivers scan
        console.log('\n   Testing drivers scan...');
        const driversResult = await window.dataService.scan('WhizzDrivers_dev', { Select: 'COUNT' });
        console.log('   Drivers result:', driversResult);
        console.log('   Drivers count:', driversResult?.Count);
        
        // Test discounts scan
        console.log('\n   Testing discounts scan...');
        const discountsResult = await window.dataService.scan('WhizzMerchants_Discounts', { Select: 'COUNT' });
        console.log('   Discounts result:', discountsResult);
        console.log('   Discounts count:', discountsResult?.Count);
        
        console.log('\n✅ Manual data loading test COMPLETE!');
        
    } catch (error) {
        console.error('❌ Manual data loading test FAILED:', error);
        console.error('Error details:', error.message, error.stack);
    }
}

// Run the test
testDataLoading();

console.log('\n═══════════════════════════════════════════════════════════');
console.log('🔍 DEBUG SCRIPT COMPLETE - Check results above');
console.log('═══════════════════════════════════════════════════════════');
