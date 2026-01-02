// Inject Promotions Fix Script
// Run this in browser console on the promotions page

javascript:(function(){
    console.log('🔧 INJECTING PROMOTIONS DATA LOADING FIX...');
    
    // Enable debug mode
    sessionStorage.setItem('debugMode', 'true');
    sessionStorage.setItem('debugForceUnauth', 'true');
    sessionStorage.setItem('isAuthenticated', 'true');
    sessionStorage.setItem('userEmail', 'debug@wizzcentralplatform.com');
    
    // Clear AWS states
    if (window.AWSUtils) {
        window.AWSUtils.isInitialized = false;
        window.AWSUtils.dynamodbClient = null;
    }
    
    // Function to fix the data loading
    async function fixDataLoading() {
        try {
            console.log('🔄 Initializing AWS...');
            await window.AWSUtils.initialize();
            
            console.log('🔄 Initializing data service...');
            await window.dataService.initialize();
            
            console.log('🔄 Testing table access...');
            const campaignsResult = await window.dataService.scan('WizzCentral_Campaigns', { Limit: 5 });
            console.log(`✅ Found ${campaignsResult.Items?.length || 0} campaigns`);
            
            const discountsResult = await window.dataService.scan('WhizzMerchants_Discounts', { Limit: 5 });
            console.log(`✅ Found ${discountsResult.Items?.length || 0} merchant discounts`);
            
            // Force reload data
            console.log('🔄 Reloading page data...');
            
            if (window.loadAllData) {
                await window.loadAllData();
            } else {
                // Try individual loading functions
                if (window.loadPlatformDiscountsData) await window.loadPlatformDiscountsData();
                if (window.loadMerchantDiscountsData) await window.loadMerchantDiscountsData();
                if (window.loadCampaignsData) await window.loadCampaignsData();
            }
            
            console.log('🎉 Fix applied successfully!');
            
            // Show success message
            const banner = document.createElement('div');
            banner.style.cssText = `
                position: fixed; top: 20px; right: 20px; z-index: 10000;
                background: #10b981; color: white; padding: 15px 20px;
                border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 14px; max-width: 300px;
            `;
            banner.innerHTML = '<strong>✅ Data Loading Fixed!</strong><br>The promotions page should now display data.';
            document.body.appendChild(banner);
            
            setTimeout(() => banner.remove(), 5000);
            
        } catch (error) {
            console.error('❌ Fix failed:', error);
            alert('Fix failed: ' + error.message);
        }
    }
    
    // Wait for scripts to load then apply fix
    if (window.AWSUtils && window.dataService) {
        fixDataLoading();
    } else {
        console.log('⏳ Waiting for scripts to load...');
        let retries = 20;
        const checkInterval = setInterval(() => {
            if (window.AWSUtils && window.dataService) {
                clearInterval(checkInterval);
                fixDataLoading();
            } else if (--retries <= 0) {
                clearInterval(checkInterval);
                console.error('❌ Required scripts did not load in time');
                alert('Required scripts did not load. Please refresh and try again.');
            }
        }, 500);
    }
})();
