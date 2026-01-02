// Simplified Data Service for Aligned Campaign Architecture
// Updates data-service.js to use new aligned backend APIs
// Eliminates complex condition engine dependencies

class AlignedDataService {
    constructor() {
        this.apiBaseUrl = 'https://your-api-gateway-url.com/api'; // Update with actual API Gateway URL
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return true;
        
        try {
            console.log('🚀 Initializing Aligned Data Service...');
            
            // For now, skip API health check and go directly to legacy fallback
            // since aligned backend APIs aren't deployed yet
            console.warn('⚠️ Aligned API not deployed yet, using legacy service');
            return this.initializeLegacy();
            
        } catch (error) {
            console.warn('⚠️ Failed to initialize aligned service, falling back:', error.message);
            return this.initializeLegacy();
        }
    }

    async initializeLegacy() {
        // Fallback to existing data service
        if (window.dataService && typeof window.dataService.initialize === 'function') {
            await window.dataService.initialize();
            this.initialized = true;
            return true;
        }
        throw new Error('No data service available');
    }

    // =============================================
    // ALIGNED CAMPAIGN MANAGEMENT FUNCTIONS
    // =============================================

    async getCampaigns() {
        console.log('📊 Loading campaigns from aligned backend...');
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/campaigns`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn('⚠️ Aligned API not available, falling back to legacy');
                    return this.getLegacyCampaigns();
                }
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            console.log(`✅ Loaded ${data.campaigns?.length || 0} campaigns from aligned backend`);
            
            return this.transformCampaigns(data.campaigns || []);
            
        } catch (error) {
            console.warn('⚠️ Aligned API failed, falling back to legacy:', error.message);
            return this.getLegacyCampaigns();
        }
    }

    async createCampaign(campaignData) {
        console.log('📝 Creating campaign via aligned backend...');
        
        try {
            // Transform data for aligned backend
            const alignedData = this.transformCampaignForBackend(campaignData);
            
            const response = await fetch(`${this.apiBaseUrl}/campaigns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(alignedData)
            });

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn('⚠️ Aligned API not available, falling back to legacy');
                    return this.createLegacyCampaign(campaignData);
                }
                
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `API Error: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Campaign created via aligned backend:', result.campaignId);
            
            return { 
                success: true, 
                campaignId: result.campaignId,
                message: 'Campaign created successfully'
            };
            
        } catch (error) {
            console.warn('⚠️ Aligned API failed, falling back to legacy:', error.message);
            return this.createLegacyCampaign(campaignData);
        }
    }

    async updateCampaign(campaignId, updates) {
        console.log(`📝 Updating campaign ${campaignId} via aligned backend...`);
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/campaigns/${campaignId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn('⚠️ Aligned API not available, falling back to legacy');
                    return this.updateLegacyCampaign(campaignId, updates);
                }
                throw new Error(`API Error: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Campaign updated via aligned backend');
            return result;
            
        } catch (error) {
            console.warn('⚠️ Aligned API failed, falling back to legacy:', error.message);
            return this.updateLegacyCampaign(campaignId, updates);
        }
    }

    async deleteCampaign(campaignId) {
        console.log(`🗑️ Deleting campaign ${campaignId} via aligned backend...`);
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/campaigns/${campaignId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn('⚠️ Aligned API not available, falling back to legacy');
                    return this.deleteLegacyCampaign(campaignId);
                }
                throw new Error(`API Error: ${response.status}`);
            }

            console.log('✅ Campaign deleted via aligned backend');
            return { success: true };
            
        } catch (error) {
            console.warn('⚠️ Aligned API failed, falling back to legacy:', error.message);
            return this.deleteLegacyCampaign(campaignId);
        }
    }

    async redeemCampaign(campaignId, customerId, orderId, orderAmount) {
        console.log(`🎯 Redeeming campaign ${campaignId} via aligned backend...`);
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/campaigns/${campaignId}/redeem`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerId,
                    orderId,
                    orderAmount
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Redemption failed: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Campaign redeemed successfully:', result.discountApplied);
            return result;
            
        } catch (error) {
            console.error('❌ Campaign redemption failed:', error.message);
            throw error;
        }
    }

    // =============================================
    // DATA TRANSFORMATION HELPERS
    // =============================================

    transformCampaigns(campaigns) {
        return campaigns.map(campaign => ({
            id: campaign.campaignId,
            campaignId: campaign.campaignId,
            title: campaign.title,
            code: campaign.code,
            type: campaign.type,
            description: campaign.description,
            discountType: campaign.discountType,
            discountValue: campaign.discountValue,
            minOrderValue: campaign.minOrderValue || 0,
            usageLimit: campaign.usageLimit || 0,
            currentUsage: campaign.currentUsage || 0,
            isActive: campaign.isActive,
            status: campaign.status,
            startDate: campaign.startDate,
            endDate: campaign.endDate,
            targetingRules: campaign.targetingRules,
            createdAt: campaign.createdAt,
            updatedAt: campaign.updatedAt
        }));
    }

    transformCampaignForBackend(campaignData) {
        const transformed = {
            title: campaignData.title,
            code: campaignData.code?.toUpperCase(),
            type: campaignData.type,
            description: campaignData.description || '',
            discountType: campaignData.discountType,
            discountValue: parseFloat(campaignData.discountValue),
            minOrderValue: parseFloat(campaignData.minOrderValue) || 0,
            usageLimit: parseInt(campaignData.usageLimit) || 0,
            startDate: campaignData.startDate,
            endDate: campaignData.endDate,
            isActive: campaignData.isActive || false
        };

        // Handle simplified targeting
        if (campaignData.targetingRulesJson) {
            try {
                transformed.targetingRules = JSON.parse(campaignData.targetingRulesJson);
            } catch (error) {
                console.warn('⚠️ Invalid targeting rules JSON, using basic targeting');
            }
        }

        // Build basic targeting rules
        if (!transformed.targetingRules) {
            const rules = {};
            
            if (campaignData.customerSegment && campaignData.customerSegment !== 'all') {
                rules.customerSegment = campaignData.customerSegment;
            }
            
            if (campaignData.targetLocation) {
                rules.location = { cities: [campaignData.targetLocation] };
            }
            
            if (campaignData.targetRestaurants && campaignData.targetRestaurants.length > 0) {
                rules.restaurants = campaignData.targetRestaurants;
            }
            
            if (Object.keys(rules).length > 0) {
                transformed.targetingRules = rules;
            }
        }

        return transformed;
    }

    // =============================================
    // LEGACY FALLBACK FUNCTIONS
    // =============================================

    async getLegacyCampaigns() {
        if (window.dataService && typeof window.dataService.getCampaigns === 'function') {
            console.log('📊 Loading campaigns from legacy service...');
            return await window.dataService.getCampaigns();
        }
        return [];
    }

    async createLegacyCampaign(campaignData) {
        if (window.dataService && typeof window.dataService.createCampaign === 'function') {
            console.log('📝 Creating campaign via legacy service...');
            return await window.dataService.createCampaign(campaignData);
        }
        throw new Error('No campaign creation service available');
    }

    async updateLegacyCampaign(campaignId, updates) {
        if (window.dataService && typeof window.dataService.updateCampaign === 'function') {
            console.log('📝 Updating campaign via legacy service...');
            return await window.dataService.updateCampaign(campaignId, updates);
        }
        throw new Error('No campaign update service available');
    }

    async deleteLegacyCampaign(campaignId) {
        if (window.dataService && typeof window.dataService.deleteCampaign === 'function') {
            console.log('🗑️ Deleting campaign via legacy service...');
            return await window.dataService.deleteCampaign(campaignId);
        }
        throw new Error('No campaign deletion service available');
    }

    // =============================================
    // OTHER REQUIRED FUNCTIONS (Passthrough to legacy)
    // =============================================

    async getBusinesses() {
        if (window.dataService && typeof window.dataService.getBusinesses === 'function') {
            return await window.dataService.getBusinesses();
        }
        return [];
    }

    async getMerchantDiscounts() {
        if (window.dataService && typeof window.dataService.getMerchantDiscounts === 'function') {
            return await window.dataService.getMerchantDiscounts();
        }
        return [];
    }

    async getPlatformDiscounts() {
        if (window.dataService && typeof window.dataService.getPlatformDiscounts === 'function') {
            return await window.dataService.getPlatformDiscounts();
        }
        return [];
    }

    // Provide unified interface
    getCampaignById(campaignId) {
        if (window.dataService && typeof window.dataService.getCampaignById === 'function') {
            return window.dataService.getCampaignById(campaignId);
        }
        return null;
    }
}

// Create global instance
const alignedDataService = new AlignedDataService();

// Export aligned data service while maintaining compatibility
if (typeof window !== 'undefined') {
    // Store original data service if it exists
    if (window.dataService) {
        window.legacyDataService = window.dataService;
    }
    
    // Replace with aligned service
    window.dataService = alignedDataService;
    window.alignedDataService = alignedDataService;
}

// Export for Node.js usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlignedDataService;
}
