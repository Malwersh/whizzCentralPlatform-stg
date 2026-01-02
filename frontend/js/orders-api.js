// WizzCentral Orders API - Direct DynamoDB Access for Frontend
// This module provides direct access to WizzOrders table for the frontend

class WizzOrdersAPI {
    constructor() {
        this.dynamoDB = null;
        this.initialized = false;
    }

    // Initialize AWS DynamoDB client
    async initialize() {
        if (this.initialized) return;

        try {
            // Use the centralized AWS utilities
            if (!window.AWSUtils) {
                throw new Error('AWSUtils not available. Please ensure aws-utils.js is loaded.');
            }

            console.log('🔄 Initializing AWSUtils...');
            await AWSUtils.initialize();
            
            console.log('🔄 Getting DynamoDB client...');
            this.dynamoDB = await AWSUtils.getDynamoDBClient();
            
            if (!this.dynamoDB) {
                throw new Error('Failed to get DynamoDB client from AWSUtils');
            }
            
            this.initialized = true;
            console.log('✅ WizzOrdersAPI initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize WizzOrdersAPI:', error);
            console.error('Error details:', error.message, error.stack);
            throw error;
        }
    }

    // Get all orders from WizzOrders table
    async getOrders(limit = 50) {
        await this.initialize();

        try {
            console.log('📊 Fetching orders from WizzOrders table...');

            const params = {
                TableName: 'WizzOrders',
                Limit: limit,
                FilterExpression: 'begins_with(PK, :prefix)',
                ExpressionAttributeValues: {
                    ':prefix': 'ORDER#'
                }
            };

            console.log('📋 Scan parameters:', params);

            const result = await this.dynamoDB.scan(params).promise();
            console.log(`✅ Found ${result.Items ? result.Items.length : 0} orders in WizzOrders table`);
            console.log('📋 Raw DynamoDB result:', result);

            if (!result.Items || result.Items.length === 0) {
                console.log('📭 No orders found, returning empty result');
                return { success: true, orders: [], count: 0 };
            }

            // Transform DynamoDB items to frontend format
            const orders = result.Items.map(item => this.transformOrder(item));

            return {
                success: true,
                orders: orders,
                count: orders.length,
                source: 'WizzOrders-DynamoDB'
            };

        } catch (error) {
            console.error('❌ Error fetching orders from WizzOrders:', error);
            
            // Try a simpler scan without filter as fallback
            try {
                console.log('🔄 Trying fallback scan without filter...');
                const fallbackParams = {
                    TableName: 'WizzOrders',
                    Limit: limit
                };
                
                const fallbackResult = await this.dynamoDB.scan(fallbackParams).promise();
                console.log(`✅ Fallback scan found ${fallbackResult.Items ? fallbackResult.Items.length : 0} items`);
                
                if (fallbackResult.Items && fallbackResult.Items.length > 0) {
                    // Filter for orders in code
                    const orders = fallbackResult.Items
                        .filter(item => item.PK && item.PK.startsWith && item.PK.startsWith('ORDER#'))
                        .map(item => this.transformOrder(item));
                    
                    return {
                        success: true,
                        orders: orders,
                        count: orders.length,
                        source: 'WizzOrders-DynamoDB-Fallback'
                    };
                }
            } catch (fallbackError) {
                console.error('❌ Fallback scan also failed:', fallbackError);
            }
            
            throw error;
        }
    }

    // Transform DynamoDB order item to frontend format
    transformOrder(item) {
        return {
            orderId: item.PK ? item.PK.replace('ORDER#', '') : item.orderId || 'unknown',
            customerName: item.customerName || 'Unknown Customer',
            customerPhone: item.customerPhone || 'N/A',
            storeName: item.storeName || item.businessName || 'Unknown Store',
            status: this.mapOrderStatus(item.status),
            total: this.formatAmount(item.total || item.totalAmount),
            currency: item.currency || 'IQD',
            createdAt: item.createdAt || 'N/A',
            confirmedAt: item.confirmedAt || null,
            deliveryAddress: this.formatDeliveryAddress(item.deliveryAddress),
            paymentMethod: item.paymentMethod || 'N/A',
            driverId: item.driverId || null,
            assignedAt: item.assignedAt || null,
            items: item.items || [],
            // Keep full data for detailed view
            fullData: item
        };
    }

    // Map order status to consistent format
    mapOrderStatus(status) {
        if (!status) return 'unknown';
        
        const statusMap = {
            'pending': 'pending',
            'confirmed': 'confirmed',
            'ready_for_pickup': 'ready_for_pickup',
            'preparing': 'preparing',
            'out_for_delivery': 'out_for_delivery',
            'delivered': 'delivered',
            'cancelled': 'cancelled'
        };

        return statusMap[status.toLowerCase()] || status.toLowerCase();
    }

    // Format amount for display
    formatAmount(amount) {
        if (!amount) return 'N/A';
        
        if (typeof amount === 'string') {
            // If already formatted, return as is
            if (amount.includes('IQD') || amount.includes('$')) return amount;
            amount = parseFloat(amount);
        }

        if (typeof amount === 'number') {
            // Format as IQD
            return `${amount.toLocaleString()} IQD`;
        }

        return 'N/A';
    }

    // Format delivery address
    formatDeliveryAddress(address) {
        if (!address) return 'N/A';

        if (typeof address === 'string') return address;

        if (typeof address === 'object') {
            // Handle DynamoDB nested structure
            if (address.S) return address.S;
            
            // Handle regular object
            const parts = [];
            if (address.city) parts.push(address.city);
            if (address.district) parts.push(address.district);
            if (address.area) parts.push(address.area);
            if (address.province) parts.push(address.province);
            
            return parts.length > 0 ? parts.join(', ') : 'Address Available';
        }

        return 'N/A';
    }

    // Get single order by ID
    async getOrder(orderId) {
        await this.initialize();

        try {
            const fullOrderId = orderId.startsWith('ORDER#') ? orderId : `ORDER#${orderId}`;
            
            const params = {
                TableName: 'WizzOrders',
                Key: {
                    PK: fullOrderId,
                    SK: 'META'
                }
            };

            const result = await this.dynamoDB.get(params).promise();
            
            if (!result.Item) {
                return { success: false, message: 'Order not found' };
            }

            return {
                success: true,
                order: this.transformOrder(result.Item)
            };

        } catch (error) {
            console.error('❌ Error fetching order:', error);
            throw error;
        }
    }
}

// Create global instance
window.WizzOrdersAPI = new WizzOrdersAPI();
