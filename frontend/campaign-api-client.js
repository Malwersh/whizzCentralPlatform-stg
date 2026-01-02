/**
 * WizzCentral Campaign API Client
 * Frontend integration with the new campaign backend APIs
 * Author: WizzCentral Dev Team
 */

class CampaignAPIClient {
    constructor(config = {}) {
        this.baseURL = config.baseURL || this.detectAPIEndpoint();
        this.apiKey = config.apiKey || 'wizzcentral_mobile_app_v1';
        this.authToken = config.authToken || null;
        this.timeout = config.timeout || 30000;
        
        // Event listeners for API responses
        this.listeners = {
            success: [],
            error: [],
            loading: []
        };
        
        console.log('🔗 Campaign API Client initialized:', this.baseURL);
    }

    // ============================================
    // CONFIGURATION & SETUP
    // ============================================

    detectAPIEndpoint() {
        // Try to detect API endpoint from various sources
        const injected =
            window.WIZZCENTRAL_CONFIG?.CAMPAIGNS_API_BASE_URL ||
            window.WIZZCENTRAL_CONFIG?.campaignApiUrl ||
            window.__CAMPAIGNS_API_BASE_URL__ ||
            '';

        if (injected) {
            if (String(injected).includes('/dev')) {
                throw new Error(`Refusing to use dev Campaign API endpoint in staging: ${injected}`);
            }
            return injected;
        }
        
        const stored = localStorage.getItem('wizzcentral_api_endpoint');
        if (stored) {
            if (String(stored).includes('/dev')) {
                throw new Error(`Refusing to use dev Campaign API endpoint in staging: ${stored}`);
            }
            return stored;
        }

        throw new Error(
            'Missing Campaign API endpoint. Set window.__CAMPAIGNS_API_BASE_URL__ (or window.WIZZCENTRAL_CONFIG.CAMPAIGNS_API_BASE_URL).'
        );
    }

    setAuthToken(token) {
        this.authToken = token;
        console.log('🔐 Auth token updated');
    }

    setAPIKey(apiKey) {
        this.apiKey = apiKey;
        console.log('🔑 API key updated');
    }

    // ============================================
    // EVENT HANDLING
    // ============================================

    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }

    // ============================================
    // HTTP CLIENT
    // ============================================

    async makeRequest(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        
        const defaultHeaders = {
            'Content-Type': 'application/json'
        };

        // Add authentication for protected endpoints
        if (this.authToken && !endpoint.startsWith('/public')) {
            defaultHeaders['Authorization'] = `Bearer ${this.authToken}`;
        }

        // Add API key for public endpoints
        if (endpoint.startsWith('/public')) {
            if (options.body) {
                const bodyData = JSON.parse(options.body);
                bodyData.apiKey = this.apiKey;
                options.body = JSON.stringify(bodyData);
            }
        }

        const config = {
            method: 'GET',
            headers: { ...defaultHeaders, ...options.headers },
            ...options
        };

        this.emit('loading', { endpoint, loading: true });

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            const response = await fetch(url, {
                ...config,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            this.emit('success', { endpoint, data });
            return data;

        } catch (error) {
            console.error(`❌ API Request failed (${endpoint}):`, error);
            this.emit('error', { endpoint, error });
            throw error;
        } finally {
            this.emit('loading', { endpoint, loading: false });
        }
    }

    // ============================================
    // PUBLIC API METHODS (No Auth Required)
    // ============================================

    async validateCampaign(campaignCode, userId, orderData) {
        try {
            const response = await this.makeRequest('/public/campaigns/validate', {
                method: 'POST',
                body: JSON.stringify({
                    campaignCode,
                    userId,
                    orderData
                })
            });

            console.log('✅ Campaign validation:', response);
            return response;

        } catch (error) {
            console.error('❌ Campaign validation failed:', error);
            throw error;
        }
    }

    async applyCampaign(campaignCode, userId, orderId, orderValue) {
        try {
            const response = await this.makeRequest('/public/campaigns/apply', {
                method: 'POST',
                body: JSON.stringify({
                    campaignCode,
                    userId,
                    orderId,
                    orderValue
                })
            });

            console.log('✅ Campaign applied:', response);
            return response;

        } catch (error) {
            console.error('❌ Campaign application failed:', error);
            throw error;
        }
    }

    async getEligibleCampaigns(userId, orderData, businessId = null) {
        try {
            const requestData = {
                userId,
                orderData
            };

            if (businessId) {
                requestData.businessId = businessId;
            }

            const response = await this.makeRequest('/public/campaigns/eligible', {
                method: 'POST',
                body: JSON.stringify(requestData)
            });

            console.log('✅ Eligible campaigns retrieved:', response);
            return response;

        } catch (error) {
            console.error('❌ Failed to get eligible campaigns:', error);
            throw error;
        }
    }

    // ============================================
    // AUTHENTICATED API METHODS
    // ============================================

    async getCampaigns(filters = {}) {
        try {
            const queryParams = new URLSearchParams(filters).toString();
            const endpoint = `/campaigns${queryParams ? '?' + queryParams : ''}`;
            
            const response = await this.makeRequest(endpoint);
            console.log('✅ Campaigns retrieved:', response);
            return response;

        } catch (error) {
            console.error('❌ Failed to get campaigns:', error);
            throw error;
        }
    }

    async createCampaign(campaignData) {
        try {
            const response = await this.makeRequest('/campaigns', {
                method: 'POST',
                body: JSON.stringify(campaignData)
            });

            console.log('✅ Campaign created:', response);
            return response;

        } catch (error) {
            console.error('❌ Campaign creation failed:', error);
            throw error;
        }
    }

    async getCampaign(campaignId) {
        try {
            const response = await this.makeRequest(`/campaigns/${campaignId}`);
            console.log('✅ Campaign retrieved:', response);
            return response;

        } catch (error) {
            console.error('❌ Failed to get campaign:', error);
            throw error;
        }
    }

    async updateCampaign(campaignId, updateData) {
        try {
            const response = await this.makeRequest(`/campaigns/${campaignId}`, {
                method: 'PUT',
                body: JSON.stringify(updateData)
            });

            console.log('✅ Campaign updated:', response);
            return response;

        } catch (error) {
            console.error('❌ Campaign update failed:', error);
            throw error;
        }
    }

    async deleteCampaign(campaignId) {
        try {
            const response = await this.makeRequest(`/campaigns/${campaignId}`, {
                method: 'DELETE'
            });

            console.log('✅ Campaign deleted:', response);
            return response;

        } catch (error) {
            console.error('❌ Campaign deletion failed:', error);
            throw error;
        }
    }

    // ============================================
    // CONDITION ENGINE METHODS
    // ============================================

    async evaluateConditions(campaignId, userId, orderData, conditions = null) {
        try {
            const response = await this.makeRequest('/conditions/evaluate', {
                method: 'POST',
                body: JSON.stringify({
                    campaignId,
                    userId,
                    orderData,
                    conditions
                })
            });

            console.log('✅ Conditions evaluated:', response);
            return response;

        } catch (error) {
            console.error('❌ Condition evaluation failed:', error);
            throw error;
        }
    }

    async validateConditions(conditions) {
        try {
            const response = await this.makeRequest('/conditions/validate', {
                method: 'POST',
                body: JSON.stringify({ conditions })
            });

            console.log('✅ Conditions validated:', response);
            return response;

        } catch (error) {
            console.error('❌ Condition validation failed:', error);
            throw error;
        }
    }

    async testConditions(conditions, testData) {
        try {
            const response = await this.makeRequest('/conditions/test', {
                method: 'POST',
                body: JSON.stringify({
                    conditions,
                    testData
                })
            });

            console.log('✅ Conditions tested:', response);
            return response;

        } catch (error) {
            console.error('❌ Condition testing failed:', error);
            throw error;
        }
    }

    // ============================================
    // ANALYTICS METHODS
    // ============================================

    async getDashboardAnalytics(period = '30days') {
        try {
            const response = await this.makeRequest(`/analytics/dashboard?period=${period}`);
            console.log('✅ Dashboard analytics retrieved:', response);
            return response;

        } catch (error) {
            console.error('❌ Failed to get dashboard analytics:', error);
            throw error;
        }
    }

    async getCampaignAnalytics(campaignId, options = {}) {
        try {
            const queryParams = new URLSearchParams(options).toString();
            const endpoint = `/analytics/campaigns/${campaignId}${queryParams ? '?' + queryParams : ''}`;
            
            const response = await this.makeRequest(endpoint);
            console.log('✅ Campaign analytics retrieved:', response);
            return response;

        } catch (error) {
            console.error('❌ Failed to get campaign analytics:', error);
            throw error;
        }
    }

    async getPerformanceMetrics(options = {}) {
        try {
            const queryParams = new URLSearchParams(options).toString();
            const endpoint = `/analytics/performance${queryParams ? '?' + queryParams : ''}`;
            
            const response = await this.makeRequest(endpoint);
            console.log('✅ Performance metrics retrieved:', response);
            return response;

        } catch (error) {
            console.error('❌ Failed to get performance metrics:', error);
            throw error;
        }
    }

    // ============================================
    // CONVENIENCE METHODS
    // ============================================

    async getActiveCampaigns() {
        return this.getCampaigns({ status: 'active' });
    }

    async getCampaignsByType(type) {
        return this.getCampaigns({ type });
    }

    async searchCampaigns(query) {
        return this.getCampaigns({ search: query });
    }

    // ============================================
    // INTEGRATION HELPERS
    // ============================================

    async integrateWithExistingDataService() {
        try {
            // Integrate with existing EnhancedCampaignDataService
            if (window.EnhancedCampaignDataService) {
                const existingService = new window.EnhancedCampaignDataService();
                
                // Override methods to use new API
                existingService.createCampaign = this.createCampaign.bind(this);
                existingService.getCampaigns = this.getCampaigns.bind(this);
                existingService.updateCampaign = this.updateCampaign.bind(this);
                existingService.deleteCampaign = this.deleteCampaign.bind(this);
                
                console.log('✅ Integrated with existing data service');
                return existingService;
            }

            console.warn('⚠️ EnhancedCampaignDataService not found');
            return null;

        } catch (error) {
            console.error('❌ Integration failed:', error);
            return null;
        }
    }

    // ============================================
    // TESTING & DEBUGGING
    // ============================================

    async testConnection() {
        try {
            console.log('🧪 Testing API connection...');
            
            // Test public endpoint
            const testResponse = await this.getEligibleCampaigns('test_user', { value: 100 });
            
            console.log('✅ API connection test successful');
            return {
                success: true,
                endpoint: this.baseURL,
                response: testResponse
            };

        } catch (error) {
            console.error('❌ API connection test failed:', error);
            return {
                success: false,
                endpoint: this.baseURL,
                error: error.message
            };
        }
    }

    getHealthStatus() {
        return {
            baseURL: this.baseURL,
            apiKey: this.apiKey ? 'Set' : 'Not set',
            authToken: this.authToken ? 'Set' : 'Not set',
            listeners: Object.keys(this.listeners).reduce((acc, key) => {
                acc[key] = this.listeners[key].length;
                return acc;
            }, {})
        };
    }
}

// ============================================
// INTEGRATION WITH EXISTING SYSTEM
// ============================================

// Auto-initialize if in browser environment
if (typeof window !== 'undefined') {
    // Initialize the API client
    window.CampaignAPIClient = CampaignAPIClient;
    
    // Create global instance
    window.campaignAPI = new CampaignAPIClient();
    
    // Auto-integrate with existing services
    document.addEventListener('DOMContentLoaded', async () => {
        console.log('🔗 Auto-integrating Campaign API Client...');
        
        // Test connection
        const connectionTest = await window.campaignAPI.testConnection();
        if (connectionTest.success) {
            console.log('✅ Campaign API Client ready');
        } else {
            console.warn('⚠️ Campaign API connection test failed:', connectionTest.error);
        }
        
        // Integrate with existing services
        const integration = await window.campaignAPI.integrateWithExistingDataService();
        if (integration) {
            console.log('✅ Campaign API integrated with existing services');
        }
        
        // Emit ready event
        window.dispatchEvent(new CustomEvent('campaignAPIReady', {
            detail: { 
                client: window.campaignAPI,
                status: connectionTest
            }
        }));
    });
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CampaignAPIClient;
}

console.log('📦 Campaign API Client loaded successfully');
