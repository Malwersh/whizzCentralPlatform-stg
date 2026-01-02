// WizzCentral Campaign Condition Engine
// Sophisticated condition definitions for real-life campaign scenarios
// Author: WizzCentral Dev Team
// Version: 1.0

class CampaignConditionEngine {
    constructor() {
        this.conditionDefinitions = new Map();
        this.customerProfiles = new Map();
        this.orderHistory = new Map();
        this.initializeConditions();
    }

    // Initialize all condition definitions
    initializeConditions() {
        this.defineCustomerConditions();
        this.defineOrderConditions();
        this.defineLocationConditions();
        this.defineTimeConditions();
        this.defineBusinessConditions();
        this.defineBehaviorConditions();
    }

    // ============ CUSTOMER CONDITION DEFINITIONS ============

    defineCustomerConditions() {
        // New Customer Definition
        this.conditionDefinitions.set('new_customer', {
            name: 'New Customer',
            description: 'Customer with zero completed orders',
            category: 'customer',
            evaluation: (customer, orderHistory) => {
                const completedOrders = orderHistory.filter(order => 
                    order.customerId === customer.id && 
                    order.status === 'delivered'
                );
                return completedOrders.length === 0;
            },
            parameters: {}
        });

        // Recently Registered Customer
        this.conditionDefinitions.set('recently_registered', {
            name: 'Recently Registered',
            description: 'Customer registered within specified days',
            category: 'customer',
            evaluation: (customer, orderHistory, params = {}) => {
                const daysThreshold = params.days || 7;
                const registrationDate = new Date(customer.registeredAt);
                const daysDiff = (Date.now() - registrationDate.getTime()) / (1000 * 60 * 60 * 24);
                return daysDiff <= daysThreshold;
            },
            parameters: {
                days: { type: 'number', default: 7, min: 1, max: 365, description: 'Days since registration' }
            }
        });

        // First Order From Restaurant
        this.conditionDefinitions.set('restaurant_first_order', {
            name: 'First Order From Restaurant',
            description: 'Customer has never ordered from specific restaurant(s)',
            category: 'customer',
            evaluation: (customer, orderHistory, params = {}) => {
                const targetRestaurants = params.restaurantIds || [];
                const customerOrders = orderHistory.filter(order => 
                    order.customerId === customer.id && 
                    order.status === 'delivered'
                );
                
                return targetRestaurants.some(restaurantId => 
                    !customerOrders.some(order => order.restaurantId === restaurantId)
                );
            },
            parameters: {
                restaurantIds: { type: 'array', description: 'Restaurant IDs to check' }
            }
        });

        // Returning Customer
        this.conditionDefinitions.set('returning_customer', {
            name: 'Returning Customer',
            description: 'Customer with at least one completed order',
            category: 'customer',
            evaluation: (customer, orderHistory, params = {}) => {
                const minOrders = params.minOrders || 1;
                const completedOrders = orderHistory.filter(order => 
                    order.customerId === customer.id && 
                    order.status === 'delivered'
                );
                return completedOrders.length >= minOrders;
            },
            parameters: {
                minOrders: { type: 'number', default: 1, min: 1, description: 'Minimum completed orders' }
            }
        });

        // VIP Customer
        this.conditionDefinitions.set('vip_customer', {
            name: 'VIP Customer',
            description: 'High-value customer based on spending or order frequency',
            category: 'customer',
            evaluation: (customer, orderHistory, params = {}) => {
                const minSpending = params.minSpending || 500;
                const minOrders = params.minOrders || 20;
                const timeFrameDays = params.timeFrameDays || 365;
                
                const cutoffDate = new Date(Date.now() - timeFrameDays * 24 * 60 * 60 * 1000);
                const recentOrders = orderHistory.filter(order => 
                    order.customerId === customer.id && 
                    order.status === 'delivered' &&
                    new Date(order.completedAt) > cutoffDate
                );
                
                const totalSpending = recentOrders.reduce((sum, order) => sum + order.total, 0);
                return totalSpending >= minSpending || recentOrders.length >= minOrders;
            },
            parameters: {
                minSpending: { type: 'number', default: 500, description: 'Minimum spending amount' },
                minOrders: { type: 'number', default: 20, description: 'Minimum order count' },
                timeFrameDays: { type: 'number', default: 365, description: 'Time frame in days' }
            }
        });

        // Inactive Customer
        this.conditionDefinitions.set('inactive_customer', {
            name: 'Inactive Customer',
            description: 'Customer who hasn\'t ordered for specified period',
            category: 'customer',
            evaluation: (customer, orderHistory, params = {}) => {
                const inactiveDays = params.inactiveDays || 30;
                const cutoffDate = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
                
                const recentOrders = orderHistory.filter(order => 
                    order.customerId === customer.id && 
                    order.status === 'delivered' &&
                    new Date(order.completedAt) > cutoffDate
                );
                
                return recentOrders.length === 0;
            },
            parameters: {
                inactiveDays: { type: 'number', default: 30, min: 7, description: 'Days without orders' }
            }
        });
    }

    // ============ ORDER CONDITION DEFINITIONS ============

    defineOrderConditions() {
        // Minimum Order Value
        this.conditionDefinitions.set('min_order_value', {
            name: 'Minimum Order Value',
            description: 'Order total meets minimum value requirement',
            category: 'order',
            evaluation: (customer, orderHistory, params = {}) => {
                const minValue = params.minValue || 0;
                return (currentOrder) => currentOrder.total >= minValue;
            },
            parameters: {
                minValue: { type: 'number', default: 0, min: 0, description: 'Minimum order value' }
            }
        });

        // Order Count in Period
        this.conditionDefinitions.set('order_count_period', {
            name: 'Order Count in Period',
            description: 'Customer order count in specified time period',
            category: 'order',
            evaluation: (customer, orderHistory, params = {}) => {
                const maxOrders = params.maxOrders || 1;
                const periodDays = params.periodDays || 30;
                const cutoffDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
                
                const periodOrders = orderHistory.filter(order => 
                    order.customerId === customer.id && 
                    order.status === 'delivered' &&
                    new Date(order.completedAt) > cutoffDate
                );
                
                return periodOrders.length <= maxOrders;
            },
            parameters: {
                maxOrders: { type: 'number', default: 1, min: 0, description: 'Maximum orders in period' },
                periodDays: { type: 'number', default: 30, min: 1, description: 'Period in days' }
            }
        });

        // First Order Today
        this.conditionDefinitions.set('first_order_today', {
            name: 'First Order Today',
            description: 'Customer\'s first order of the day',
            category: 'order',
            evaluation: (customer, orderHistory) => {
                const today = new Date().toDateString();
                const todayOrders = orderHistory.filter(order => 
                    order.customerId === customer.id && 
                    new Date(order.createdAt).toDateString() === today
                );
                return todayOrders.length === 0;
            },
            parameters: {}
        });
    }

    // ============ LOCATION CONDITION DEFINITIONS ============

    defineLocationConditions() {
        // Delivery Area
        this.conditionDefinitions.set('delivery_area', {
            name: 'Delivery Area',
            description: 'Order delivery address within specified areas',
            category: 'location',
            evaluation: (customer, orderHistory, params = {}) => {
                const allowedAreas = params.areas || [];
                return (currentOrder) => {
                    if (!currentOrder.deliveryAddress) return false;
                    return allowedAreas.some(area => 
                        currentOrder.deliveryAddress.area === area ||
                        currentOrder.deliveryAddress.district === area
                    );
                };
            },
            parameters: {
                areas: { type: 'array', description: 'Allowed delivery areas/districts' }
            }
        });

        // Restaurant Location
        this.conditionDefinitions.set('restaurant_location', {
            name: 'Restaurant Location',
            description: 'Order from restaurants in specific locations',
            category: 'location',
            evaluation: (customer, orderHistory, params = {}) => {
                const allowedRestaurants = params.restaurantIds || [];
                return (currentOrder) => {
                    return allowedRestaurants.length === 0 || 
                           allowedRestaurants.includes(currentOrder.restaurantId);
                };
            },
            parameters: {
                restaurantIds: { type: 'array', description: 'Allowed restaurant IDs' }
            }
        });
    }

    // ============ TIME CONDITION DEFINITIONS ============

    defineTimeConditions() {
        // Time of Day
        this.conditionDefinitions.set('time_of_day', {
            name: 'Time of Day',
            description: 'Order placed within specific hours',
            category: 'time',
            evaluation: (customer, orderHistory, params = {}) => {
                const startHour = params.startHour || 0;
                const endHour = params.endHour || 23;
                return (currentOrder) => {
                    const orderHour = new Date(currentOrder.createdAt).getHours();
                    return orderHour >= startHour && orderHour <= endHour;
                };
            },
            parameters: {
                startHour: { type: 'number', default: 0, min: 0, max: 23, description: 'Start hour (24h format)' },
                endHour: { type: 'number', default: 23, min: 0, max: 23, description: 'End hour (24h format)' }
            }
        });

        // Day of Week
        this.conditionDefinitions.set('day_of_week', {
            name: 'Day of Week',
            description: 'Order placed on specific days',
            category: 'time',
            evaluation: (customer, orderHistory, params = {}) => {
                const allowedDays = params.days || [0, 1, 2, 3, 4, 5, 6]; // 0 = Sunday
                return (currentOrder) => {
                    const orderDay = new Date(currentOrder.createdAt).getDay();
                    return allowedDays.includes(orderDay);
                };
            },
            parameters: {
                days: { type: 'array', description: 'Allowed days (0=Sunday, 1=Monday, etc.)' }
            }
        });

        // Special Occasions
        this.conditionDefinitions.set('special_occasion', {
            name: 'Special Occasion',
            description: 'Order during special occasions or holidays',
            category: 'time',
            evaluation: (customer, orderHistory, params = {}) => {
                const occasions = params.occasions || [];
                return (currentOrder) => {
                    const orderDate = new Date(currentOrder.createdAt);
                    return this.isSpecialOccasion(orderDate, occasions);
                };
            },
            parameters: {
                occasions: { type: 'array', description: 'Special occasions (holiday names or date patterns)' }
            }
        });
    }

    // ============ BUSINESS CONDITION DEFINITIONS ============

    defineBusinessConditions() {
        // Restaurant Category
        this.conditionDefinitions.set('restaurant_category', {
            name: 'Restaurant Category',
            description: 'Order from restaurants of specific categories',
            category: 'business',
            evaluation: (customer, orderHistory, params = {}) => {
                const allowedCategories = params.categories || [];
                return (currentOrder, restaurantData) => {
                    if (!restaurantData || allowedCategories.length === 0) return true;
                    return allowedCategories.includes(restaurantData.category);
                };
            },
            parameters: {
                categories: { type: 'array', description: 'Allowed restaurant categories' }
            }
        });

        // Payment Method
        this.conditionDefinitions.set('payment_method', {
            name: 'Payment Method',
            description: 'Order using specific payment methods',
            category: 'business',
            evaluation: (customer, orderHistory, params = {}) => {
                const allowedMethods = params.methods || [];
                return (currentOrder) => {
                    if (allowedMethods.length === 0) return true;
                    return allowedMethods.includes(currentOrder.paymentMethod);
                };
            },
            parameters: {
                methods: { type: 'array', description: 'Allowed payment methods' }
            }
        });
    }

    // ============ BEHAVIOR CONDITION DEFINITIONS ============

    defineBehaviorConditions() {
        // Average Order Value
        this.conditionDefinitions.set('avg_order_value', {
            name: 'Average Order Value',
            description: 'Customer\'s average order value in range',
            category: 'behavior',
            evaluation: (customer, orderHistory, params = {}) => {
                const minAvg = params.minAverage || 0;
                const maxAvg = params.maxAverage || Infinity;
                const periodDays = params.periodDays || 90;
                
                const cutoffDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
                const recentOrders = orderHistory.filter(order => 
                    order.customerId === customer.id && 
                    order.status === 'delivered' &&
                    new Date(order.completedAt) > cutoffDate
                );
                
                if (recentOrders.length === 0) return false;
                
                const avgValue = recentOrders.reduce((sum, order) => sum + order.total, 0) / recentOrders.length;
                return avgValue >= minAvg && avgValue <= maxAvg;
            },
            parameters: {
                minAverage: { type: 'number', default: 0, description: 'Minimum average order value' },
                maxAverage: { type: 'number', default: Infinity, description: 'Maximum average order value' },
                periodDays: { type: 'number', default: 90, description: 'Period for calculation' }
            }
        });

        // Order Frequency
        this.conditionDefinitions.set('order_frequency', {
            name: 'Order Frequency',
            description: 'Customer order frequency pattern',
            category: 'behavior',
            evaluation: (customer, orderHistory, params = {}) => {
                const minFrequency = params.minOrdersPerMonth || 1;
                const maxFrequency = params.maxOrdersPerMonth || Infinity;
                const monthsBack = params.monthsBack || 3;
                
                const cutoffDate = new Date(Date.now() - monthsBack * 30 * 24 * 60 * 60 * 1000);
                const recentOrders = orderHistory.filter(order => 
                    order.customerId === customer.id && 
                    order.status === 'delivered' &&
                    new Date(order.completedAt) > cutoffDate
                );
                
                const ordersPerMonth = recentOrders.length / monthsBack;
                return ordersPerMonth >= minFrequency && ordersPerMonth <= maxFrequency;
            },
            parameters: {
                minOrdersPerMonth: { type: 'number', default: 1, description: 'Minimum orders per month' },
                maxOrdersPerMonth: { type: 'number', default: Infinity, description: 'Maximum orders per month' },
                monthsBack: { type: 'number', default: 3, description: 'Months to analyze' }
            }
        });
    }

    // ============ CONDITION EVALUATION METHODS ============

    // Evaluate a single condition
    evaluateCondition(conditionId, customer, orderHistory, currentOrder = null, params = {}) {
        const condition = this.conditionDefinitions.get(conditionId);
        if (!condition) {
            throw new Error(`Condition '${conditionId}' not found`);
        }

        try {
            const result = condition.evaluation(customer, orderHistory, params);
            
            // If result is a function, it's an order-specific condition
            if (typeof result === 'function' && currentOrder) {
                return result(currentOrder);
            }
            
            // Otherwise it's a customer-specific condition
            return Boolean(result);
        } catch (error) {
            console.error(`Error evaluating condition '${conditionId}':`, error);
            return false;
        }
    }

    // Evaluate multiple conditions (AND logic)
    evaluateConditions(conditionRules, customer, orderHistory, currentOrder = null) {
        if (!Array.isArray(conditionRules) || conditionRules.length === 0) {
            return true; // No conditions means always eligible
        }

        return conditionRules.every(rule => {
            const { conditionId, params = {}, operator = 'AND' } = rule;
            
            if (operator === 'NOT') {
                return !this.evaluateCondition(conditionId, customer, orderHistory, currentOrder, params);
            }
            
            return this.evaluateCondition(conditionId, customer, orderHistory, currentOrder, params);
        });
    }

    // ============ CAMPAIGN ELIGIBILITY CHECKING ============

    // Check if customer is eligible for a campaign
    isEligibleForCampaign(campaign, customer, orderHistory, currentOrder = null) {
        try {
            // Check campaign conditions
            if (campaign.conditions && campaign.conditions.length > 0) {
                return this.evaluateConditions(campaign.conditions, customer, orderHistory, currentOrder);
            }

            // Fallback to legacy campaign type checking
            return this.checkLegacyCampaignEligibility(campaign, customer, orderHistory, currentOrder);
        } catch (error) {
            console.error(`Error checking campaign eligibility:`, error);
            return false;
        }
    }

    // Legacy campaign type checking (for backward compatibility)
    checkLegacyCampaignEligibility(campaign, customer, orderHistory, currentOrder) {
        switch (campaign.type) {
            case 'first-order':
                return this.evaluateCondition('new_customer', customer, orderHistory);
            
            case 'restaurant-first':
                return this.evaluateCondition('restaurant_first_order', customer, orderHistory, null, {
                    restaurantIds: campaign.targetRestaurants || []
                });
            
            case 'new-customer':
                return this.evaluateCondition('recently_registered', customer, orderHistory, null, {
                    days: campaign.newCustomerDays || 7
                });
            
            case 'special-occasion':
                return this.evaluateCondition('special_occasion', customer, orderHistory, currentOrder, {
                    occasions: campaign.occasions || []
                });
            
            default:
                return true; // Default to eligible for unknown types
        }
    }

    // ============ HELPER METHODS ============

    // Check if date is a special occasion
    isSpecialOccasion(date, occasions) {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const dayOfWeek = date.getDay();
        
        return occasions.some(occasion => {
            switch (occasion) {
                case 'weekend':
                    return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
                case 'new_year':
                    return month === 1 && day === 1;
                case 'valentine':
                    return month === 2 && day === 14;
                case 'ramadan':
                    return this.isRamadan(date);
                case 'christmas':
                    return month === 12 && day === 25;
                case 'eid':
                    return this.isEid(date);
                default:
                    return false;
            }
        });
    }

    // Ramadan check (simplified - would need Islamic calendar integration)
    isRamadan(date) {
        // This is a simplified implementation
        // In production, you'd integrate with Islamic calendar APIs
        const year = date.getFullYear();
        const ramadanMonths = {
            2024: { start: new Date(2024, 2, 11), end: new Date(2024, 3, 9) },
            2025: { start: new Date(2025, 1, 28), end: new Date(2025, 2, 29) }
        };
        
        const ramadan = ramadanMonths[year];
        return ramadan && date >= ramadan.start && date <= ramadan.end;
    }

    // Eid check (simplified)
    isEid(date) {
        // This is a simplified implementation
        const year = date.getFullYear();
        const eidDates = {
            2024: [new Date(2024, 3, 10), new Date(2024, 5, 16)],
            2025: [new Date(2025, 2, 30), new Date(2025, 5, 6)]
        };
        
        const eids = eidDates[year] || [];
        return eids.some(eid => 
            date.getMonth() === eid.getMonth() && 
            date.getDate() === eid.getDate()
        );
    }

    // ============ CONDITION MANAGEMENT ============

    // Get all available conditions
    getAvailableConditions() {
        const conditions = [];
        this.conditionDefinitions.forEach((condition, id) => {
            conditions.push({
                id,
                name: condition.name,
                description: condition.description,
                category: condition.category,
                parameters: condition.parameters
            });
        });
        return conditions;
    }

    // Get conditions by category
    getConditionsByCategory(category) {
        return this.getAvailableConditions().filter(condition => 
            condition.category === category
        );
    }

    // Add custom condition
    addCustomCondition(id, definition) {
        if (this.conditionDefinitions.has(id)) {
            throw new Error(`Condition '${id}' already exists`);
        }
        this.conditionDefinitions.set(id, definition);
    }

    // Validate condition parameters
    validateConditionParameters(conditionId, params) {
        const condition = this.conditionDefinitions.get(conditionId);
        if (!condition) {
            throw new Error(`Condition '${conditionId}' not found`);
        }

        const errors = [];
        const conditionParams = condition.parameters || {};

        Object.entries(conditionParams).forEach(([paramName, paramDef]) => {
            const value = params[paramName];
            
            if (paramDef.required && (value === undefined || value === null)) {
                errors.push(`Parameter '${paramName}' is required`);
                return;
            }

            if (value !== undefined && value !== null) {
                // Type validation
                if (paramDef.type === 'number' && typeof value !== 'number') {
                    errors.push(`Parameter '${paramName}' must be a number`);
                }
                if (paramDef.type === 'array' && !Array.isArray(value)) {
                    errors.push(`Parameter '${paramName}' must be an array`);
                }

                // Range validation
                if (paramDef.type === 'number') {
                    if (paramDef.min !== undefined && value < paramDef.min) {
                        errors.push(`Parameter '${paramName}' must be at least ${paramDef.min}`);
                    }
                    if (paramDef.max !== undefined && value > paramDef.max) {
                        errors.push(`Parameter '${paramName}' must be at most ${paramDef.max}`);
                    }
                }
            }
        });

        return errors;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CampaignConditionEngine;
}

// Make available globally for browser usage
if (typeof window !== 'undefined') {
    window.CampaignConditionEngine = CampaignConditionEngine;
}
