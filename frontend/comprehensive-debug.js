// COMPREHENSIVE DEBUG TEST - Paste this into browser console on promotions page
(function() {
    console.log('🔍 COMPREHENSIVE DEBUG TEST STARTING...');
    
    // Step 1: Enable debug mode and set minimal auth
    sessionStorage.setItem('debugMode', 'true');
    sessionStorage.setItem('isAuthenticated', 'true');
    sessionStorage.setItem('userEmail', 'debug@test.com');
    sessionStorage.setItem('userId', 'debug-123');
    
    console.log('✅ Debug mode enabled');
    
    // Step 2: Check script dependencies
    const deps = {
        'Auth': !!window.Auth,
        'AWSUtils': !!window.AWSUtils,
        'dataService': !!window.dataService,
        'WIZZCENTRAL_CONFIG': !!window.WIZZCENTRAL_CONFIG,
        'initializePromotionsPage': !!window.initializePromotionsPage
    };
    
    console.log('📋 Dependencies:', deps);
    
    const missingDeps = Object.entries(deps).filter(([k,v]) => !v).map(([k]) => k);
    if (missingDeps.length > 0) {
        console.log('❌ Missing dependencies:', missingDeps);
        return;
    }
    
    // Step 3: Check DOM elements
    const elements = {
        'openAddPromotionModalBtn': !!document.getElementById('openAddPromotionModalBtn'),
        'addPromotionModal': !!document.getElementById('addPromotionModal'),
        'addPromotionForm': !!document.getElementById('addPromotionForm'),
        'title': !!document.getElementById('title'),
        'code': !!document.getElementById('code'),
        'type': !!document.getElementById('type'),
        'value': !!document.getElementById('value'),
        'description': !!document.getElementById('description'),
        'startDate': !!document.getElementById('startDate'),
        'endDate': !!document.getElementById('endDate')
    };
    
    console.log('🎯 DOM Elements:', elements);
    
    const missingElements = Object.entries(elements).filter(([k,v]) => !v).map(([k]) => k);
    if (missingElements.length > 0) {
        console.log('❌ Missing elements:', missingElements);
        return;
    }
    
    // Step 4: Test AWS and data service initialization
    console.log('🔧 Testing AWS initialization...');
    
    AWSUtils.initialize().then(() => {
        console.log('✅ AWS initialized');
        return window.dataService.initialize();
    }).then(() => {
        console.log('✅ Data service initialized');
        
        // Step 5: Test direct API call
        console.log('🧪 Testing direct platform discount creation...');
        
        const testDiscount = {
            discountId: 'debug_test_' + Date.now(),
            title: 'Debug Test Discount',
            description: 'Created by debug script',
            type: 'percentage',
            value: 8,
            code: 'DEBUG8',
            startDate: new Date().toISOString().split('T')[0],
            endDate: new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0],
            isActive: true,
            discountSource: 'platform'
        };
        
        return window.dataService.createPlatformDiscount(testDiscount);
    }).then(apiResult => {
        console.log('🎉 Direct API test SUCCESS:', apiResult);
        
        // Step 6: Test UI workflow
        console.log('🎭 Testing UI workflow...');
        
        const btn = document.getElementById('openAddPromotionModalBtn');
        btn.click();
        
        const modal = document.getElementById('addPromotionModal');
        if (modal.style.display !== 'flex') {
            throw new Error('Modal did not open');
        }
        console.log('✅ Modal opened');
        
        // Fill form
        const testTime = Date.now();
        const formData = {
            title: 'UI Debug Test ' + testTime,
            code: 'DEBUG' + (testTime % 1000),
            type: 'percentage',
            value: '22',
            description: 'UI test via debug script',
            startDate: new Date().toISOString().slice(0, 16),
            endDate: new Date(Date.now() + 14*24*60*60*1000).toISOString().slice(0, 16)
        };
        
        for (const [fieldId, value] of Object.entries(formData)) {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = value;
            }
        }
        console.log('✅ Form filled');
        
        // Submit form
        const form = document.getElementById('addPromotionForm');
        console.log('📝 Submitting form...');
        
        // Listen for form submission events
        const originalSubmitHandler = form.onsubmit;
        form.addEventListener('submit', function(e) {
            console.log('📨 Form submit event fired');
        });
        
        // Trigger submit
        form.dispatchEvent(new Event('submit', {
            bubbles: true,
            cancelable: true
        }));
        
        // Check result after delay
        setTimeout(() => {
            const modalClosed = modal.style.display === 'none';
            console.log('🏁 FINAL RESULT:');
            console.log('  Modal closed:', modalClosed ? '✅ YES' : '❌ NO');
            console.log('  Form reset:', form.title?.value === '' ? '✅ YES' : '❌ NO');
            
            if (modalClosed) {
                console.log('🎉 FULL WORKFLOW SUCCESS!');
            } else {
                console.log('❌ UI workflow failed - check console for errors');
            }
        }, 3000);
        
    }).catch(error => {
        console.log('❌ TEST FAILED:', error);
        console.log('Error details:', error.stack);
    });
    
})();
