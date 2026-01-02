// Campaign Save Debug Test
// Run this in browser console to diagnose campaign save issues

console.log('🔍 CAMPAIGN SAVE DIAGNOSTIC TEST');
console.log('================================');

// Check what services are available
function checkServices() {
    console.log('\n📋 Available Services:');
    console.log('- dataService:', !!window.dataService, typeof window.dataService);
    console.log('- legacyDataService:', !!window.legacyDataService, typeof window.legacyDataService);
    console.log('- alignedDataService:', !!window.alignedDataService, typeof window.alignedDataService);
    console.log('- campaignManager:', !!window.campaignManager, typeof window.campaignManager);
    console.log('- SimplifiedCampaignManager:', typeof SimplifiedCampaignManager);
    
    // Check if createCampaign functions exist
    if (window.dataService) {
        console.log('- dataService.createCampaign:', typeof window.dataService.createCampaign);
    }
    if (window.legacyDataService) {
        console.log('- legacyDataService.createCampaign:', typeof window.legacyDataService.createCampaign);
    }
}

// Test form data collection
function testFormCollection() {
    console.log('\n📝 Testing Form Data Collection:');
    
    const form = document.getElementById('simplifiedCampaignForm');
    if (!form) {
        console.error('❌ Form not found');
        return false;
    }
    
    console.log('✅ Form found');
    
    // Fill with test data
    const testData = {
        title: 'Debug Test Campaign',
        code: 'DEBUG123',
        type: 'marketing',
        description: 'Test campaign',
        discountType: 'percentage',
        discountValue: '25',
        minOrderValue: '50',
        usageLimit: '100',
        startDate: '2025-01-01',
        endDate: '2025-01-31'
    };
    
    let filledCount = 0;
    for (const [field, value] of Object.entries(testData)) {
        const element = form.querySelector(`[name="${field}"]`);
        if (element) {
            element.value = value;
            filledCount++;
        } else {
            console.warn(`⚠️ Field not found: ${field}`);
        }
    }
    
    console.log(`✅ Filled ${filledCount}/${Object.keys(testData).length} fields`);
    
    // Test FormData collection
    const formData = new FormData(form);
    const collectedData = {};
    for (let [key, value] of formData.entries()) {
        collectedData[key] = value;
    }
    
    console.log('📊 Collected form data:', collectedData);
    return collectedData;
}

// Test campaign creation directly
async function testCampaignCreation() {
    console.log('\n💾 Testing Campaign Creation:');
    
    try {
        // First check services
        checkServices();
        
        // Test form collection
        const formData = testFormCollection();
        if (!formData) return;
        
        // Try to create campaign
        console.log('🚀 Attempting campaign creation...');
        
        // Create FormData object
        const form = document.getElementById('simplifiedCampaignForm');
        const realFormData = new FormData(form);
        
        // Test with data service directly
        if (window.dataService && typeof window.dataService.createCampaign === 'function') {
            console.log('📝 Testing with dataService...');
            
            // Convert FormData to object for dataService
            const campaignObject = {
                title: formData.title,
                code: formData.code,
                type: formData.type,
                description: formData.description,
                discountType: formData.discountType,
                discountValue: parseFloat(formData.discountValue),
                minOrderValue: parseFloat(formData.minOrderValue) || 0,
                usageLimit: parseInt(formData.usageLimit) || 0,
                startDate: formData.startDate,
                endDate: formData.endDate,
                discountSource: 'campaign',
                isActive: true
            };
            
            console.log('📋 Campaign object:', campaignObject);
            
            const result = await window.dataService.createCampaign(campaignObject);
            console.log('✅ Campaign creation result:', result);
            
            if (result && result.success !== false) {
                console.log('🎉 SUCCESS! Campaign created successfully');
                return result;
            } else {
                console.error('❌ Campaign creation failed:', result);
            }
        } else {
            console.error('❌ No createCampaign function available');
        }
        
    } catch (error) {
        console.error('❌ Campaign creation error:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Test with campaign manager
async function testWithCampaignManager() {
    console.log('\n🎯 Testing with Campaign Manager:');
    
    try {
        if (!window.campaignManager) {
            console.log('📝 Initializing campaign manager...');
            window.campaignManager = new SimplifiedCampaignManager();
        }
        
        // Fill test data
        window.campaignManager.fillTestData();
        
        // Get form
        const form = document.getElementById('simplifiedCampaignForm');
        const formData = new FormData(form);
        
        // Test creation
        const result = await window.campaignManager.createCampaign(formData);
        console.log('✅ Campaign manager result:', result);
        
        return result;
        
    } catch (error) {
        console.error('❌ Campaign manager test failed:', error);
    }
}

// Run all tests
async function runAllTests() {
    console.log('🧪 RUNNING ALL DIAGNOSTIC TESTS');
    console.log('=================================');
    
    checkServices();
    testFormCollection();
    await testCampaignCreation();
    await testWithCampaignManager();
    
    console.log('\n🏁 DIAGNOSTIC TESTS COMPLETE');
}

// Export test functions to global scope
window.checkServices = checkServices;
window.testFormCollection = testFormCollection;
window.testCampaignCreation = testCampaignCreation;
window.testWithCampaignManager = testWithCampaignManager;
window.runAllTests = runAllTests;

console.log('✅ Campaign save diagnostic test loaded');
console.log('💡 Available functions:');
console.log('   - checkServices()');
console.log('   - testFormCollection()');
console.log('   - testCampaignCreation()');
console.log('   - testWithCampaignManager()');
console.log('   - runAllTests()');

// Auto-run basic checks
checkServices();
