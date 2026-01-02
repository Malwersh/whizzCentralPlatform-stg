// Enhanced Data Service for Campaign Condition Engine
// Integrates sophisticated campaign conditions with DynamoDB and backend services
// Author: WizzCentral Dev Team

class EnhancedCampaignDataService {
    constructor() {
        this.dynamoDB = null;
        this.initialized = false;
        this.conditionEngine = null;
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            // Initialize DynamoDB
            this.dynamoDB = await AWSUtils.getDynamoDBClient();
            
            // Initialize condition engine
            if (window.CampaignConditionEngine) {
                this.conditionEngine = new window.CampaignConditionEngine();
                console.log('✅ Campaign condition engine initialized');
            }
            
            this.initialized = true;
            console.log('✅ Enhanced Campaign Data Service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize Enhanced Campaign Data Service:', error);
            throw error;
        }
    }

    // ============================================
    // CAMPAIGN CRUD OPERATIONS
    // ============================================

    async createCampaign(campaignData) {
        await this.initialize();
        
        try {
            // Generate campaign ID
            const campaignId = `camp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Prepare campaign item for DynamoDB
            const campaignItem = {
                campaignId: campaignId,
                title: campaignData.title,
                code: campaignData.code.toUpperCase(),
                type: campaignData.type,
                description: campaignData.description || '',
                
                // Discount configuration
                discountType: campaignData.discountType,
                discountValue: Number(campaignData.discountValue),
                minOrderValue: Number(campaignData.minOrderValue) || 0,
                
                // Usage limits
                usageLimit: Number(campaignData.usageLimit) || 0,
                currentUsage: 0,
                singleUse: campaignData.singleUse || false,
                stackable: campaignData.stackable || false,
                
                // Validity
                startDate: campaignData.startDate,
                endDate: campaignData.endDate,
                
                // Status
                isActive: campaignData.autoActivate || false,
                status: campaignData.autoActivate ? 'active' : 'draft',
                
                // Advanced conditions
                usesAdvancedConditions: campaignData.usesAdvancedConditions || false,
                conditionLogic: campaignData.conditionLogic || 'AND',
                conditions: campaignData.conditions || [],
                
                // Legacy targeting
                targetRestaurants: campaignData.targetRestaurants || [],
                targetSegments: campaignData.targetSegments || [],
                occasions: campaignData.occasions || [],
                
                // Metadata
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: 'wizzcentral-admin'
            };

            // Validate campaign data
            const validation = this.validateCampaignData(campaignItem);
            if (!validation.isValid) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
            }

            // Save to DynamoDB
            const params = {
                TableName: 'WizzCentral_Campaigns',
                Item: campaignItem,
                ConditionExpression: 'attribute_not_exists(campaignId) AND attribute_not_exists(code)'
            };

            await this.dynamoDB.put(params).promise();
            
            // Save conditions separately if using advanced conditions
            if (campaignItem.usesAdvancedConditions && campaignItem.conditions.length > 0) {
                await this.saveCampaignConditions(campaignId, campaignItem.conditions);
            }

            // Clear cache
            this.clearCache();
            
            console.log(`✅ Campaign created: ${campaignId}`);
            return { success: true, campaignId: campaignId, campaign: campaignItem };
            
        } catch (error) {
            console.error('❌ Error creating campaign:', error);
            if (error.code === 'ConditionalCheckFailedException') {
                throw new Error('Campaign code already exists');
            }
            throw error;
        }
    }

    async getCampaigns() {
        await this.initialize();
        
        const cacheKey = 'all_campaigns';
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const params = {
                TableName: 'WizzCentral_Campaigns'
            };

            const result = await this.dynamoDB.scan(params).promise();
            const campaigns = result.Items || [];

            // Enrich campaigns with condition details
            for (const campaign of campaigns) {
                if (campaign.usesAdvancedConditions) {
                    campaign.conditionDetails = await this.getCampaignConditionDetails(campaign.campaignId);
                }
            }

            this.setCache(cacheKey, campaigns);
            return campaigns;
            
        } catch (error) {
            console.error('❌ Error fetching campaigns:', error);
            throw error;
        }
    }

    async getCampaign(campaignId) {
        await this.initialize();

        try {
            const params = {
                TableName: 'WizzCentral_Campaigns',
                Key: { campaignId: campaignId }
            };

            const result = await this.dynamoDB.get(params).promise();
            if (!result.Item) {
                throw new Error(`Campaign not found: ${campaignId}`);
            }

            const campaign = result.Item;
            
            // Enrich with condition details if using advanced conditions
            if (campaign.usesAdvancedConditions) {
                campaign.conditionDetails = await this.getCampaignConditionDetails(campaignId);
            }

            return campaign;
            
        } catch (error) {
            console.error('❌ Error fetching campaign:', error);
            throw error;
        }
    }

    async updateCampaign(campaignId, updates) {
        await this.initialize();

        try {
            // Prepare update expression
            const updateExpressions = [];
            const expressionAttributeNames = {};
            const expressionAttributeValues = {};

            Object.entries(updates).forEach(([key, value]) => {
                const attrName = `#${key}`;
                const attrValue = `:${key}`;
                
                updateExpressions.push(`${attrName} = ${attrValue}`);
                expressionAttributeNames[attrName] = key;
                expressionAttributeValues[attrValue] = value;
            });

            // Always update the updatedAt timestamp
            updateExpressions.push('#updatedAt = :updatedAt');
            expressionAttributeNames['#updatedAt'] = 'updatedAt';
            expressionAttributeValues[':updatedAt'] = new Date().toISOString();

            const params = {
                TableName: 'WizzCentral_Campaigns',
                Key: { campaignId: campaignId },
                UpdateExpression: `SET ${updateExpressions.join(', ')}`,
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: 'ALL_NEW'
            };

            const result = await this.dynamoDB.update(params).promise();
            
            // Update conditions if provided
            if (updates.conditions) {
                await this.saveCampaignConditions(campaignId, updates.conditions);
            }

            this.clearCache();
            return { success: true, campaign: result.Attributes };
            
        } catch (error) {
            console.error('❌ Error updating campaign:', error);
            throw error;
        }
    }

    async deleteCampaign(campaignId) {
        await this.initialize();

        try {
            // Delete campaign conditions first
            await this.deleteCampaignConditions(campaignId);
            
            // Delete campaign
            const params = {
                TableName: 'WizzCentral_Campaigns',
                Key: { campaignId: campaignId }
            };

            await this.dynamoDB.delete(params).promise();
            this.clearCache();
            
            return { success: true };
            
        } catch (error) {
            console.error('❌ Error deleting campaign:', error);
            throw error;
        }
    }

    // ============================================
    // CAMPAIGN CONDITIONS MANAGEMENT
    // ============================================

    async saveCampaignConditions(campaignId, conditions) {
        try {
            // Delete existing conditions
            await this.deleteCampaignConditions(campaignId);
            
            // Save new conditions
            for (let i = 0; i < conditions.length; i++) {
                const condition = conditions[i];
                const conditionItem = {
                    conditionRuleId: `rule_${campaignId}_${i + 1}`,
                    campaignId: campaignId,
                    conditionId: condition.conditionId,
                    conditionOrder: i + 1,
                    parameters: condition.params || {},
                    operator: condition.operator || 'AND',
                    createdAt: new Date().toISOString()
                };

                const params = {
                    TableName: 'WizzCentral_Campaign_Conditions',
                    Item: conditionItem
                };

                await this.dynamoDB.put(params).promise();
            }
            
        } catch (error) {
            console.error('❌ Error saving campaign conditions:', error);
            throw error;
        }
    }

    async getCampaignConditions(campaignId) {
        try {
            const params = {
                TableName: 'WizzCentral_Campaign_Conditions',
                FilterExpression: 'campaignId = :campaignId',
                ExpressionAttributeValues: {
                    ':campaignId': campaignId
                }
            };

            const result = await this.dynamoDB.scan(params).promise();
            return result.Items || [];
            
        } catch (error) {
            console.error('❌ Error fetching campaign conditions:', error);
            return [];
        }
    }

    async getCampaignConditionDetails(campaignId) {
        const conditions = await this.getCampaignConditions(campaignId);
        
        return conditions.map(condition => {
            // Get condition definition details
            const conditionDef = this.conditionEngine ? 
                this.conditionEngine.getAvailableConditions().find(c => c.id === condition.conditionId) :
                null;
                
            return {
                ...condition,
                name: conditionDef?.name || condition.conditionId,
                description: conditionDef?.description || '',
                category: conditionDef?.category || 'unknown'
            };
        });
    }

    async deleteCampaignConditions(campaignId) {
        try {
            const conditions = await this.getCampaignConditions(campaignId);
            
            for (const condition of conditions) {
                const params = {
                    TableName: 'WizzCentral_Campaign_Conditions',
                    Key: { conditionRuleId: condition.conditionRuleId }
                };
                
                await this.dynamoDB.delete(params).promise();
            }
            
        } catch (error) {
            console.error('❌ Error deleting campaign conditions:', error);
            throw error;
        }
    }

    // ============================================
    // CAMPAIGN ELIGIBILITY AND EVALUATION
    // ============================================

    async checkCampaignEligibility(campaignId, customer, orderHistory, currentOrder = null) {
        await this.initialize();

        try {
            const campaign = await this.getCampaign(campaignId);
            
            // Check basic eligibility first
            if (!campaign.isActive || campaign.status !== 'active') {
                return { eligible: false, reason: 'Campaign not active' };
            }

            // Check date validity
            const now = new Date();
            const startDate = new Date(campaign.startDate);
            const endDate = new Date(campaign.endDate);
            
            if (now < startDate || now > endDate) {
                return { eligible: false, reason: 'Campaign not in valid date range' };
            }

            // Check usage limit
            if (campaign.usageLimit > 0 && campaign.currentUsage >= campaign.usageLimit) {
                return { eligible: false, reason: 'Campaign usage limit reached' };
            }

            // Check customer single-use restriction
            if (campaign.singleUse) {
                const hasUsed = await this.hasCustomerUsedCampaign(campaignId, customer.id);
                if (hasUsed) {
                    return { eligible: false, reason: 'Customer has already used this campaign' };
                }
            }

            // Use condition engine for sophisticated evaluation
            if (campaign.usesAdvancedConditions && this.conditionEngine) {
                const isEligible = this.conditionEngine.isEligibleForCampaign(
                    campaign, 
                    customer, 
                    orderHistory, 
                    currentOrder
                );
                
                return { 
                    eligible: isEligible, 
                    reason: isEligible ? 'Meets all conditions' : 'Does not meet campaign conditions',
                    evaluationMethod: 'advanced_conditions'
                };
            }

            // Fallback to legacy evaluation
            const legacyResult = this.evaluateLegacyCampaign(campaign, customer, orderHistory, currentOrder);
            return { 
                ...legacyResult, 
                evaluationMethod: 'legacy'
            };
            
        } catch (error) {
            console.error('❌ Error checking campaign eligibility:', error);
            return { eligible: false, reason: `Error: ${error.message}` };
        }
    }

    async getEligibleCampaigns(customer, orderHistory, currentOrder = null) {
        await this.initialize();

        try {
            const campaigns = await this.getCampaigns();
            const eligibleCampaigns = [];

            for (const campaign of campaigns) {
                const eligibility = await this.checkCampaignEligibility(
                    campaign.campaignId, 
                    customer, 
                    orderHistory, 
                    currentOrder
                );
                
                if (eligibility.eligible) {
                    eligibleCampaigns.push({
                        ...campaign,
                        eligibilityReason: eligibility.reason
                    });
                }
            }

            return eligibleCampaigns;
            
        } catch (error) {
            console.error('❌ Error getting eligible campaigns:', error);
            throw error;
        }
    }

    // ============================================
    // CAMPAIGN USAGE TRACKING
    // ============================================

    async recordCampaignUsage(campaignId, customerId, orderId, discountApplied, originalAmount) {
        await this.initialize();

        try {
            const usageId = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const usageItem = {
                usageId: usageId,
                campaignId: campaignId,
                customerId: customerId,
                orderId: orderId,
                discountApplied: Number(discountApplied),
                originalAmount: Number(originalAmount),
                finalAmount: Number(originalAmount) - Number(discountApplied),
                usedAt: new Date().toISOString(),
                contextData: {
                    userAgent: navigator.userAgent,
                    timestamp: Date.now()
                }
            };

            // Save usage record
            const params = {
                TableName: 'WizzCentral_Campaign_Usage',
                Item: usageItem
            };

            await this.dynamoDB.put(params).promise();

            // Update campaign current usage
            await this.updateCampaign(campaignId, {
                currentUsage: (await this.getCampaignUsageCount(campaignId))
            });

            return { success: true, usageId: usageId };
            
        } catch (error) {
            console.error('❌ Error recording campaign usage:', error);
            throw error;
        }
    }

    async getCampaignUsageCount(campaignId) {
        try {
            const params = {
                TableName: 'WizzCentral_Campaign_Usage',
                FilterExpression: 'campaignId = :campaignId',
                ExpressionAttributeValues: {
                    ':campaignId': campaignId
                },
                Select: 'COUNT'
            };

            const result = await this.dynamoDB.scan(params).promise();
            return result.Count || 0;
            
        } catch (error) {
            console.error('❌ Error getting campaign usage count:', error);
            return 0;
        }
    }

    async hasCustomerUsedCampaign(campaignId, customerId) {
        try {
            const params = {
                TableName: 'WizzCentral_Campaign_Usage',
                FilterExpression: 'campaignId = :campaignId AND customerId = :customerId',
                ExpressionAttributeValues: {
                    ':campaignId': campaignId,
                    ':customerId': customerId
                },
                Limit: 1
            };

            const result = await this.dynamoDB.scan(params).promise();
            return result.Items && result.Items.length > 0;
            
        } catch (error) {
            console.error('❌ Error checking customer campaign usage:', error);
            return false;
        }
    }

    // ============================================
    // ANALYTICS AND REPORTING
    // ============================================

    async getCampaignAnalytics(campaignId, dateRange = null) {
        await this.initialize();

        try {
            const campaign = await this.getCampaign(campaignId);
            const usageData = await this.getCampaignUsageData(campaignId, dateRange);

            const analytics = {
                campaign: {
                    id: campaignId,
                    title: campaign.title,
                    code: campaign.code,
                    type: campaign.type,
                    status: campaign.status
                },
                performance: {
                    totalUsage: usageData.length,
                    uniqueCustomers: new Set(usageData.map(u => u.customerId)).size,
                    totalDiscountGiven: usageData.reduce((sum, u) => sum + u.discountApplied, 0),
                    totalOrderValue: usageData.reduce((sum, u) => sum + u.originalAmount, 0),
                    averageOrderValue: usageData.length > 0 ? 
                        usageData.reduce((sum, u) => sum + u.originalAmount, 0) / usageData.length : 0,
                    averageDiscount: usageData.length > 0 ? 
                        usageData.reduce((sum, u) => sum + u.discountApplied, 0) / usageData.length : 0
                },
                usage: {
                    limit: campaign.usageLimit,
                    current: campaign.currentUsage,
                    remaining: campaign.usageLimit > 0 ? campaign.usageLimit - campaign.currentUsage : 'unlimited',
                    percentage: campaign.usageLimit > 0 ? 
                        Math.round((campaign.currentUsage / campaign.usageLimit) * 100) : null
                },
                timeline: this.generateUsageTimeline(usageData),
                topCustomers: this.getTopCustomers(usageData)
            };

            return analytics;
            
        } catch (error) {
            console.error('❌ Error generating campaign analytics:', error);
            throw error;
        }
    }

    async getCampaignUsageData(campaignId, dateRange = null) {
        try {
            let filterExpression = 'campaignId = :campaignId';
            const expressionAttributeValues = {
                ':campaignId': campaignId
            };

            if (dateRange && dateRange.start && dateRange.end) {
                filterExpression += ' AND usedAt BETWEEN :startDate AND :endDate';
                expressionAttributeValues[':startDate'] = dateRange.start;
                expressionAttributeValues[':endDate'] = dateRange.end;
            }

            const params = {
                TableName: 'WizzCentral_Campaign_Usage',
                FilterExpression: filterExpression,
                ExpressionAttributeValues: expressionAttributeValues
            };

            const result = await this.dynamoDB.scan(params).promise();
            return result.Items || [];
            
        } catch (error) {
            console.error('❌ Error fetching campaign usage data:', error);
            return [];
        }
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    validateCampaignData(campaignData) {
        const errors = [];

        if (!campaignData.title || campaignData.title.trim().length === 0) {
            errors.push('Campaign title is required');
        }

        if (!campaignData.code || campaignData.code.trim().length === 0) {
            errors.push('Campaign code is required');
        }

        if (!campaignData.discountType || !['percentage', 'fixed_amount', 'free_delivery', 'bogo'].includes(campaignData.discountType)) {
            errors.push('Valid discount type is required');
        }

        if (!campaignData.discountValue || campaignData.discountValue <= 0) {
            errors.push('Discount value must be greater than 0');
        }

        if (campaignData.discountType === 'percentage' && campaignData.discountValue > 100) {
            errors.push('Percentage discount cannot exceed 100%');
        }

        if (!campaignData.startDate || !campaignData.endDate) {
            errors.push('Start and end dates are required');
        }

        if (campaignData.startDate && campaignData.endDate && 
            new Date(campaignData.startDate) >= new Date(campaignData.endDate)) {
            errors.push('End date must be after start date');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    evaluateLegacyCampaign(campaign, customer, orderHistory, currentOrder) {
        switch (campaign.type) {
            case 'first-order':
                const completedOrders = orderHistory.filter(o => 
                    o.customerId === customer.id && o.status === 'delivered'
                ).length;
                return {
                    eligible: completedOrders === 0,
                    reason: completedOrders === 0 ? 'Customer has no completed orders' : 'Customer has completed orders'
                };

            case 'new-customer':
                const registrationDate = new Date(customer.registeredAt);
                const daysSinceRegistration = (Date.now() - registrationDate.getTime()) / (1000 * 60 * 60 * 24);
                const newCustomerThreshold = 7; // days
                return {
                    eligible: daysSinceRegistration <= newCustomerThreshold,
                    reason: `Customer registered ${Math.round(daysSinceRegistration)} days ago`
                };

            case 'restaurant-first':
                if (!currentOrder || !campaign.targetRestaurants || campaign.targetRestaurants.length === 0) {
                    return { eligible: true, reason: 'No restaurant restrictions' };
                }
                
                const hasOrderedFromRestaurant = orderHistory.some(order => 
                    order.customerId === customer.id && 
                    order.status === 'delivered' &&
                    campaign.targetRestaurants.includes(order.restaurantId)
                );
                
                const isTargetRestaurant = campaign.targetRestaurants.includes(currentOrder.restaurantId);
                
                return {
                    eligible: isTargetRestaurant && !hasOrderedFromRestaurant,
                    reason: isTargetRestaurant ? 
                        (hasOrderedFromRestaurant ? 'Customer has ordered from this restaurant before' : 'First order from this restaurant') :
                        'Order not from target restaurant'
                };

            default:
                return { eligible: true, reason: 'Default eligibility for unknown campaign type' };
        }
    }

    generateUsageTimeline(usageData) {
        const timeline = {};
        
        usageData.forEach(usage => {
            const date = new Date(usage.usedAt).toDateString();
            if (!timeline[date]) {
                timeline[date] = {
                    date: date,
                    count: 0,
                    totalDiscount: 0,
                    totalOrderValue: 0
                };
            }
            
            timeline[date].count++;
            timeline[date].totalDiscount += usage.discountApplied;
            timeline[date].totalOrderValue += usage.originalAmount;
        });

        return Object.values(timeline).sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    getTopCustomers(usageData) {
        const customerStats = {};
        
        usageData.forEach(usage => {
            if (!customerStats[usage.customerId]) {
                customerStats[usage.customerId] = {
                    customerId: usage.customerId,
                    usageCount: 0,
                    totalDiscount: 0,
                    totalOrderValue: 0
                };
            }
            
            customerStats[usage.customerId].usageCount++;
            customerStats[usage.customerId].totalDiscount += usage.discountApplied;
            customerStats[usage.customerId].totalOrderValue += usage.originalAmount;
        });

        return Object.values(customerStats)
            .sort((a, b) => b.totalOrderValue - a.totalOrderValue)
            .slice(0, 10);
    }

    // Cache management
    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        if (Date.now() - cached.timestamp > this.cacheTimeout) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    clearCache() {
        this.cache.clear();
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.enhancedCampaignDataService = new EnhancedCampaignDataService();
}

// Export for Node.js usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedCampaignDataService;
}
