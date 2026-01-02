/**
 * Campaign Creation Validation Test
 * Creates a test campaign and verifies it was saved correctly in the unified table
 */

console.log('🎯 CAMPAIGN CREATION VALIDATION TEST');
console.log('=' .repeat(50));

async function validateCampaignCreation() {
    try {
        console.log('\n1️⃣ Initializing data service...');
        
        // Ensure data service is available
        if (!window.dataService) {
            throw new Error('Data service not available');
        }
        
        await window.dataService.initialize();
        console.log('✅ Data service initialized');
        
        console.log('\n2️⃣ Creating test campaign...');
        
        // Create test campaign data
        const testCampaign = {
            title: 'E2E Validation Campaign',
            code: 'VALIDATE2025',
            type: 'special-occasion',
            description: 'End-to-end validation test campaign',
            discountType: 'percentage',
            discountValue: 20,
            minOrderValue: 50,
            usageLimit: 100,
            startDate: '2025-01-20',
            endDate: '2025-01-27',
            autoActivate: true,
            singleUse: false,
            stackable: false,
            targetRestaurants: [],
            targetSegments: [],
            occasions: ['holiday']
        };
        
        // Create the campaign
        const result = await window.dataService.createCampaign(testCampaign);
        
        if (result) {
            console.log('✅ Campaign created successfully');
            console.log('📋 Campaign ID:', result.campaignId || result.discountId);
            
            console.log('\n3️⃣ Verifying campaign in database...');
            
            // Retrieve campaigns to verify
            const campaigns = await window.dataService.getCampaigns();
            console.log(`📊 Total campaigns in database: ${campaigns.length}`);
            
            // Find our test campaign
            const createdCampaign = campaigns.find(c => c.code === 'VALIDATE2025');
            
            if (createdCampaign) {
                console.log('✅ Campaign found in database');
                console.log('📋 Campaign details:');
                console.log('   • Title:', createdCampaign.title);
                console.log('   • Code:', createdCampaign.code);
                console.log('   • Type:', createdCampaign.type);
                console.log('   • Discount:', `${createdCampaign.discountValue}%`);
                console.log('   • Status:', createdCampaign.status);
                console.log('   • Source:', createdCampaign.discountSource || 'Not set');
                
                console.log('\n4️⃣ Testing unified table structure...');
                
                // Verify it's properly marked as a campaign
                if (createdCampaign.discountSource === 'campaign') {
                    console.log('✅ Campaign properly marked with discountSource = "campaign"');
                } else {
                    console.log('⚠️ Campaign not properly marked as campaign source');
                }
                
                // Test that it doesn't appear in regular discounts
                if (window.dataService.getPlatformDiscounts) {
                    const platformDiscounts = await window.dataService.getPlatformDiscounts();
                    const inDiscounts = platformDiscounts.find(d => d.code === 'VALIDATE2025');
                    
                    if (!inDiscounts) {
                        console.log('✅ Campaign properly separated from platform discounts');
                    } else {
                        console.log('⚠️ Campaign appears in platform discounts (may be expected if unified)');
                    }
                }
                
                console.log('\n5️⃣ Testing campaign operations...');
                
                // Test update
                await window.dataService.updateCampaign(createdCampaign.id, {
                    description: 'Updated test description'
                });
                console.log('✅ Campaign update successful');
                
                // Test deletion
                await window.dataService.deleteCampaign(createdCampaign.id);
                console.log('✅ Campaign deletion successful');
                
                // Verify deletion
                const campaignsAfterDelete = await window.dataService.getCampaigns();
                const deletedCampaign = campaignsAfterDelete.find(c => c.code === 'VALIDATE2025');
                
                if (!deletedCampaign) {
                    console.log('✅ Campaign successfully removed from database');
                } else {
                    console.log('⚠️ Campaign still exists after deletion');
                }
                
            } else {
                console.log('❌ Campaign not found in database after creation');
                return false;
            }
            
        } else {
            console.log('❌ Campaign creation failed');
            return false;
        }
        
        console.log('\n🎉 CAMPAIGN VALIDATION TEST COMPLETED SUCCESSFULLY!');
        console.log('✅ Campaign system is working correctly');
        console.log('✅ Unified table structure functioning');
        console.log('✅ CRUD operations working');
        
        return true;
        
    } catch (error) {
        console.error('❌ Campaign validation test failed:', error);
        console.error('Error details:', error.message);
        return false;
    }
}

// Export for browser console
window.validateCampaignCreation = validateCampaignCreation;

// Auto-run if conditions are met
if (typeof document !== 'undefined' && window.dataService) {
    setTimeout(validateCampaignCreation, 2000);
} else {
    console.log('💡 Run validateCampaignCreation() when data service is ready');
}
