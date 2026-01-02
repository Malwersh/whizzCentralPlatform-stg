// Debug script for drivers page data loading
console.log('🔍 Debug script for drivers page loading...');

// Function to check drivers page status
async function debugDriversPage() {
    console.log('=== DRIVERS PAGE DEBUG ===');
    
    // Check if required dependencies are loaded
    console.log('1. Checking dependencies:');
    console.log('   - AWS SDK:', typeof AWS !== 'undefined' ? '✅' : '❌');
    console.log('   - AuthService:', typeof window.AuthService !== 'undefined' ? '✅' : '❌');
    console.log('   - AWSUtils:', typeof window.AWSUtils !== 'undefined' ? '✅' : '❌');
    console.log('   - Cognito Identity:', typeof AmazonCognitoIdentity !== 'undefined' ? '✅' : '❌');
    
    // Check authentication status
    console.log('2. Checking authentication:');
    const idToken = sessionStorage.getItem('idToken');
    const accessToken = sessionStorage.getItem('accessToken');
    const userEmail = sessionStorage.getItem('userEmail');
    const isAuthenticated = sessionStorage.getItem('isAuthenticated');
    
    console.log('   - ID Token:', idToken ? '✅ Present' : '❌ Missing');
    console.log('   - Access Token:', accessToken ? '✅ Present' : '❌ Missing');
    console.log('   - User Email:', userEmail || 'Not set');
    console.log('   - Is Authenticated:', isAuthenticated || 'Not set');
    
    // Check AWS configuration
    console.log('3. Checking AWS configuration:');
    const config = window.WIZZCENTRAL_CONFIG || {};
    console.log('   - Cognito Region:', config.COGNITO_REGION || 'us-east-1');
    console.log('   - User Pool ID:', config.COGNITO_USER_POOL_ID || 'us-east-1_Cp9YnOQWi');
    console.log('   - Client ID:', config.COGNITO_CLIENT_ID || '5hun8p61grnakisu5gammcjelv');
    console.log('   - Identity Pool ID:', config.COGNITO_IDENTITY_POOL_ID || 'us-east-1:864073dc-423f-42ae-9b1a-67c1c913b38a');
    
    // Check if AWSUtils is initialized
    if (window.AWSUtils) {
        console.log('4. Checking AWSUtils status:');
        console.log('   - Is Initialized:', window.AWSUtils.isInitialized ? '✅' : '❌');
        console.log('   - Has DynamoDB Client:', window.AWSUtils.dynamodbClient ? '✅' : '❌');
    }
    
    // Try to get DynamoDB client
    if (window.AWSUtils && typeof window.AWSUtils.getDynamoDBClient === 'function') {
        console.log('5. Testing DynamoDB connection:');
        try {
            const dynamoDB = await window.AWSUtils.getDynamoDBClient();
            console.log('   - DynamoDB Client:', dynamoDB ? '✅ Available' : '❌ Not available');
            
            if (dynamoDB) {
                // Try to scan the drivers table
                console.log('6. Testing drivers table scan:');
                const params = {
                    TableName: 'WhizzDrivers_dev',
                    Limit: 5
                };
                
                try {
                    const result = await dynamoDB.scan(params).promise();
                    console.log('   - Scan Result:', '✅ Success');
                    console.log('   - Items Found:', result.Items ? result.Items.length : 0);
                    console.log('   - Sample Items:', result.Items ? result.Items.slice(0, 2) : 'None');
                } catch (scanError) {
                    console.log('   - Scan Error:', '❌', scanError.message);
                    console.log('   - Error Details:', scanError);
                }
            }
        } catch (clientError) {
            console.log('   - Client Error:', '❌', clientError.message);
            console.log('   - Error Details:', clientError);
        }
    }
    
    // Check current page state
    console.log('7. Checking page state:');
    const tbody = document.getElementById('driversTableBody');
    if (tbody) {
        console.log('   - Table Body Element:', '✅ Found');
        console.log('   - Table Content:', tbody.innerHTML.length > 0 ? `${tbody.innerHTML.length} characters` : 'Empty');
    } else {
        console.log('   - Table Body Element:', '❌ Not found');
    }
    
    console.log('=== DEBUG COMPLETE ===');
}

// Run debug after page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(debugDriversPage, 2000); // Wait 2 seconds for scripts to load
    });
} else {
    setTimeout(debugDriversPage, 2000);
}

// Make it available globally
window.debugDriversPage = debugDriversPage;
console.log('Debug script loaded. You can run debugDriversPage() in console to check status.');
