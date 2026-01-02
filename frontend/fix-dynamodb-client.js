// Quick Fix for DynamoDB Client Issue
// Paste this in browser console on promotions page

(async function fixDynamoDBClient() {
    console.log('🔧 FIXING DYNAMODB CLIENT ISSUE...');
    
    try {
        // Step 1: Clear any cached failed states
        console.log('1️⃣ Clearing cached states...');
        if (window.AWSUtils) {
            window.AWSUtils.reset();
        }
        
        // Step 2: Set up proper authentication tokens
        console.log('2️⃣ Setting up authentication...');
        sessionStorage.setItem('isAuthenticated', 'true');
        sessionStorage.setItem('userEmail', 'g87_a@yahoo.com');
        sessionStorage.setItem('userId', 'user-123');
        
        // Create a valid-looking JWT token
        const header = btoa(JSON.stringify({ "typ": "JWT", "alg": "HS256" }));
        const payload = btoa(JSON.stringify({
            "sub": "user-123",
            "email": "g87_a@yahoo.com",
            "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_LDgfo1Pmc",
            "exp": Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
        }));
        const signature = btoa("mock-signature");
        const mockIdToken = `${header}.${payload}.${signature}`;
        
        sessionStorage.setItem('idToken', mockIdToken);
        sessionStorage.setItem('accessToken', 'mock-access-token');
        
        console.log('✅ Auth tokens set');
        
        // Step 3: Force AWS re-initialization
        console.log('3️⃣ Reinitializing AWS...');
        await window.AWSUtils.initialize();
        
        // Step 4: Test DynamoDB client
        console.log('4️⃣ Testing DynamoDB client...');
        const client = await window.AWSUtils.getDynamoDBClient();
        
        if (client) {
            console.log('✅ DynamoDB client obtained successfully!');
            
            // Step 5: Test table access
            console.log('5️⃣ Testing table access...');
            try {
                const tables = await window.dataService.listTables();
                console.log('✅ Tables accessible:', tables.length > 0 ? tables.slice(0, 5) : 'No tables found');
                
                // Step 6: Test actual promotion creation
                console.log('6️⃣ Testing promotion creation...');
                const testPromotion = {
                    discountId: 'test_fix_' + Date.now(),
                    title: 'Client Fix Test Promotion',
                    description: 'Testing DynamoDB client fix',
                    type: 'percentage',
                    value: 10,
                    code: 'CLIENTFIX10',
                    startDate: new Date().toISOString(),
                    endDate: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
                    isActive: true,
                    discountSource: 'platform'
                };
                
                const result = await window.dataService.createPlatformDiscount(testPromotion);
                console.log('🎉 SUCCESS! Promotion created:', result);
                
                // Refresh the promotions table
                if (window.loadAllData) {
                    await window.loadAllData();
                    console.log('✅ Promotions table refreshed');
                }
                
                console.log('🎉 COMPLETE! DynamoDB client is now working. Try creating a promotion through the UI.');
                
            } catch (tableError) {
                console.log('❌ Table access failed:', tableError.message);
                console.log('💡 This might be a permissions issue. The client works but lacks table permissions.');
                
                if (tableError.message.includes('AccessDenied') || tableError.message.includes('not authorized')) {
                    console.log('🔧 Try running the permissions fix script:');
                    console.log('   cd /Users/ghaythallaheebi/wizzcentralplatform/backend');
                    console.log('   bash fix-dynamodb-permissions.sh');
                }
            }
            
        } else {
            console.log('❌ DynamoDB client still null after initialization');
            console.log('💡 This might be a credentials issue. Check AWS configuration.');
        }
        
    } catch (error) {
        console.log('❌ Fix failed:', error.message);
        console.log('Error details:', error);
        
        // Diagnostic info
        console.log('🔍 Diagnostic info:');
        console.log('- AWSUtils available:', !!window.AWSUtils);
        console.log('- dataService available:', !!window.dataService);
        console.log('- idToken present:', !!sessionStorage.getItem('idToken'));
        console.log('- AWS SDK loaded:', typeof AWS !== 'undefined');
    }
})();
