// WizzCentral Merchant Discounts API - Mock Data for Frontend
// This module provides mock merchant discount data for the promotions page

class WizzMerchantDiscountsAPI {
    constructor() {
        this.initialized = false;
        this.mockDiscounts = [];
    }

    // Initialize the API with mock data
    async initialize() {
        if (this.initialized) return;

        console.log('🔄 Initializing WizzMerchantDiscountsAPI with mock data...');
        
        // Create some mock merchant discounts
        this.mockDiscounts = [
            {
                id: 'MDIS001',
                discountCode: 'BURGER20',
                merchantId: 'MERCH001',
                merchantName: 'Al-Mansour Burger House',
                discountType: 'percentage',
                discountValue: 20,
                status: 'active',
                description: '20% off all burger meals',
                minimumOrderValue: 15000, // 15,000 IQD
                usage: 342,
                maxUsage: 1000,
                validUntil: '2025-12-31T23:59:59Z',
                createdAt: '2025-01-15T00:00:00Z'
            },
            {
                id: 'MDIS002',
                discountCode: 'PIZZA15',
                merchantId: 'MERCH002',
                merchantName: 'Baghdad Pizza Palace',
                discountType: 'percentage',
                discountValue: 15,
                status: 'active',
                description: 'Save 15% on pizza orders',
                minimumOrderValue: 20000, // 20,000 IQD
                usage: 567,
                maxUsage: 2000,
                validUntil: '2025-11-30T23:59:59Z',
                createdAt: '2025-02-01T00:00:00Z'
            },
            {
                id: 'MDIS003',
                discountCode: 'SHAWARMA10',
                merchantId: 'MERCH003',
                merchantName: 'Karada Shawarma Corner',
                discountType: 'percentage',
                discountValue: 10,
                status: 'active',
                description: '10% discount on shawarma',
                minimumOrderValue: 10000, // 10,000 IQD
                usage: 1245,
                maxUsage: 3000,
                validUntil: '2025-12-15T23:59:59Z',
                createdAt: '2025-01-20T00:00:00Z'
            },
            {
                id: 'MDIS004',
                discountCode: 'KEBAB25',
                merchantId: 'MERCH004',
                merchantName: 'Mansour Kebab House',
                discountType: 'percentage',
                discountValue: 25,
                status: 'active',
                description: '25% off kebab platters',
                minimumOrderValue: 25000, // 25,000 IQD
                usage: 89,
                maxUsage: 500,
                validUntil: '2025-11-15T23:59:59Z',
                createdAt: '2025-03-01T00:00:00Z'
            },
            {
                id: 'MDIS005',
                discountCode: 'CHICKEN5K',
                merchantId: 'MERCH005',
                merchantName: 'Zayouna Fried Chicken',
                discountType: 'fixed',
                discountValue: 5000, // 5,000 IQD off
                status: 'active',
                description: '5,000 IQD off chicken meals',
                minimumOrderValue: 30000, // 30,000 IQD
                usage: 234,
                maxUsage: 1000,
                validUntil: '2025-12-31T23:59:59Z',
                createdAt: '2025-02-15T00:00:00Z'
            },
            {
                id: 'MDIS006',
                discountCode: 'BIRYANI30',
                merchantId: 'MERCH006',
                merchantName: 'Karrada Biryani House',
                discountType: 'percentage',
                discountValue: 30,
                status: 'inactive',
                description: '30% off biryani (expired)',
                minimumOrderValue: 20000,
                usage: 445,
                maxUsage: 500,
                validUntil: '2025-10-31T23:59:59Z',
                createdAt: '2025-01-01T00:00:00Z'
            }
        ];

        this.initialized = true;
        console.log('✅ WizzMerchantDiscountsAPI initialized with', this.mockDiscounts.length, 'mock discounts');
    }

    // Get all merchant discounts
    async getMerchantDiscounts(limit = 50) {
        await this.initialize();

        try {
            console.log('📊 Fetching merchant discounts from API...');

            // Try to fetch from real API first
            const API_BASE_URL = window.location.origin;
            try {
                const response = await fetch(`${API_BASE_URL}/api/promotions`);
                if (response.ok) {
                    const data = await response.json();
                    console.log('✅ Received promotions data:', data);
                    
                    // Extract promotions from the response
                    const promotions = data.promotions || [];
                    
                    // Transform promotions data to match discount format
                    const discounts = promotions
                        .map(p => ({
                            id: p.promotionId || p.id,
                            discountCode: p.discountCode || p.code || 'N/A',
                            merchantId: p.merchantId || 'N/A',
                            merchantName: p.merchantName || 'Unknown Merchant',
                            discountType: p.type === 'Fixed Amount' ? 'fixed' : 'percentage',
                            discountValue: p.value || p.discountValue || 0,
                            status: (p.status || 'INACTIVE').toLowerCase(),
                            description: p.description || '',
                            minimumOrderValue: p.minValue || p.minimumOrderValue || 0,
                            usage: p.usageCount || 0,
                            maxUsage: p.usageLimit || p.maxUsage || 1000,
                            validUntil: p.validUntil || p.endDate || '',
                            createdAt: p.createdAt || new Date().toISOString()
                        }))
                        .slice(0, limit);
                    
                    if (discounts.length > 0) {
                        console.log(`✅ Loaded ${discounts.length} merchant discounts from API`);
                        return {
                            success: true,
                            discounts: discounts,
                            count: discounts.length,
                            source: 'DynamoDB-API'
                        };
                    }
                }
            } catch (apiError) {
                console.warn('⚠️ API fetch failed, using mock data:', apiError.message);
            }

            // Fallback to mock discounts if API fails or returns no data
            console.log('📊 Using mock merchant discounts as fallback...');
            const discounts = this.mockDiscounts.slice(0, limit);

            return {
                success: true,
                discounts: discounts,
                count: discounts.length,
                source: 'Mock-Data-Fallback'
            };

        } catch (error) {
            console.error('❌ Error fetching merchant discounts:', error);
            return {
                success: false,
                message: error.message,
                discounts: [],
                count: 0
            };
        }
    }

    // Get discount by ID
    async getDiscountById(discountId) {
        await this.initialize();

        try {
            const discount = this.mockDiscounts.find(d => d.id === discountId);
            
            if (!discount) {
                throw new Error('Discount not found');
            }

            return {
                success: true,
                discount: discount
            };

        } catch (error) {
            console.error('❌ Error fetching discount:', error);
            return {
                success: false,
                message: error.message,
                discount: null
            };
        }
    }

    // Get discounts by merchant
    async getDiscountsByMerchant(merchantId) {
        await this.initialize();

        try {
            const discounts = this.mockDiscounts.filter(d => d.merchantId === merchantId);

            return {
                success: true,
                discounts: discounts,
                count: discounts.length
            };

        } catch (error) {
            console.error('❌ Error fetching merchant discounts:', error);
            return {
                success: false,
                message: error.message,
                discounts: [],
                count: 0
            };
        }
    }

    // Create a new merchant discount
    async createDiscount(discountData) {
        await this.initialize();

        try {
            console.log('📝 Creating merchant discount:', discountData);

            // Generate a new ID
            const newId = `MDIS${String(this.mockDiscounts.length + 1).padStart(3, '0')}`;

            // Create new discount
            const newDiscount = {
                id: newId,
                discountCode: discountData.discountCode || `CODE${Date.now()}`,
                merchantId: discountData.merchantId || 'UNKNOWN',
                merchantName: discountData.merchantName || 'Unknown Merchant',
                discountType: discountData.discountType || 'percentage',
                discountValue: parseFloat(discountData.discountValue) || 0,
                status: discountData.status || 'active',
                description: discountData.description || '',
                minimumOrderValue: parseFloat(discountData.minimumOrderValue) || 0,
                usage: 0,
                maxUsage: parseInt(discountData.maxUsage) || null,
                validUntil: discountData.validUntil || '2025-12-31T23:59:59Z',
                createdAt: new Date().toISOString()
            };

            // Add to mock data
            this.mockDiscounts.push(newDiscount);

            console.log('✅ Merchant discount created:', newDiscount);

            return {
                success: true,
                discount: newDiscount,
                message: 'Merchant discount created successfully'
            };

        } catch (error) {
            console.error('❌ Error creating merchant discount:', error);
            return {
                success: false,
                message: error.message,
                discount: null
            };
        }
    }

    // Update a merchant discount
    async updateDiscount(discountId, updates) {
        await this.initialize();

        try {
            const index = this.mockDiscounts.findIndex(d => d.id === discountId);
            
            if (index === -1) {
                throw new Error('Discount not found');
            }

            // Update discount
            this.mockDiscounts[index] = {
                ...this.mockDiscounts[index],
                ...updates
            };

            console.log('✅ Merchant discount updated:', this.mockDiscounts[index]);

            return {
                success: true,
                discount: this.mockDiscounts[index],
                message: 'Merchant discount updated successfully'
            };

        } catch (error) {
            console.error('❌ Error updating merchant discount:', error);
            return {
                success: false,
                message: error.message,
                discount: null
            };
        }
    }

    // Delete a merchant discount
    async deleteDiscount(discountId) {
        await this.initialize();

        try {
            const index = this.mockDiscounts.findIndex(d => d.id === discountId);
            
            if (index === -1) {
                throw new Error('Discount not found');
            }

            // Remove discount
            const deleted = this.mockDiscounts.splice(index, 1)[0];

            console.log('✅ Merchant discount deleted:', deleted);

            return {
                success: true,
                message: 'Merchant discount deleted successfully'
            };

        } catch (error) {
            console.error('❌ Error deleting merchant discount:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // Format date for display
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (error) {
            return 'Invalid Date';
        }
    }

    // Format currency
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-IQ', {
            style: 'currency',
            currency: 'IQD',
            minimumFractionDigits: 0
        }).format(amount);
    }
}

// Create global instance
window.WizzMerchantDiscountsAPI = new WizzMerchantDiscountsAPI();
console.log('✅ WizzMerchantDiscountsAPI loaded and available globally');
