/**
 * Enhanced Targeting Performance Optimization
 * 
 * This module provides performance optimizations for the enhanced targeting system
 * including caching strategies, database query optimization, and batch processing.
 */

class TargetingPerformanceOptimizer {
    constructor(config) {
        this.config = {
            cacheTimeout: 5 * 60 * 1000, // 5 minutes default
            batchSize: 100,
            maxConcurrentEvaluations: 50,
            ...config
        };
        
        this.cache = new Map();
        this.evaluationQueue = [];
        this.isProcessing = false;
        this.metrics = {
            cacheHits: 0,
            cacheMisses: 0,
            evaluationCount: 0,
            averageEvaluationTime: 0
        };
    }

    /**
     * Optimized campaign eligibility evaluation with caching
     */
    async evaluateCampaignEligibilityOptimized(campaign, customer, context) {
        const startTime = Date.now();
        
        try {
            // Check cache first
            const cacheKey = this.generateCacheKey(campaign.id, customer.customerId, context);
            const cached = this.getFromCache(cacheKey);
            
            if (cached) {
                this.metrics.cacheHits++;
                return cached;
            }
            
            this.metrics.cacheMisses++;
            
            // Evaluate eligibility
            const evaluator = new CampaignEligibilityEvaluator();
            const result = evaluator.evaluateCustomerEligibility(
                campaign.enhancedTargeting || {}, 
                customer, 
                context
            );
            
            // Cache the result
            this.setCache(cacheKey, result);
            
            // Update metrics
            this.updateMetrics(Date.now() - startTime);
            
            return result;
            
        } catch (error) {
            console.error('Error in optimized evaluation:', error);
            return { eligible: false, reason: 'Evaluation error' };
        }
    }

    /**
     * Batch process multiple eligibility evaluations
     */
    async batchEvaluateEligibility(campaigns, customers, context) {
        const results = new Map();
        const batches = [];
        
        // Create evaluation tasks
        const tasks = [];
        for (const campaign of campaigns) {
            for (const customer of customers) {
                tasks.push({ campaign, customer, context });
            }
        }
        
        // Process in batches
        for (let i = 0; i < tasks.length; i += this.config.batchSize) {
            const batch = tasks.slice(i, i + this.config.batchSize);
            batches.push(batch);
        }
        
        // Process batches with concurrency control
        const batchPromises = batches.map(batch => this.processBatch(batch));
        const batchResults = await Promise.all(batchPromises);
        
        // Combine results
        for (const batchResult of batchResults) {
            for (const [key, value] of batchResult) {
                results.set(key, value);
            }
        }
        
        return results;
    }

    /**
     * Process a batch of evaluations
     */
    async processBatch(batch) {
        const results = new Map();
        const semaphore = new Semaphore(this.config.maxConcurrentEvaluations);
        
        const promises = batch.map(async ({ campaign, customer, context }) => {
            await semaphore.acquire();
            
            try {
                const result = await this.evaluateCampaignEligibilityOptimized(
                    campaign, 
                    customer, 
                    context
                );
                
                const key = `${campaign.id}_${customer.customerId}`;
                results.set(key, { campaign, customer, result });
                
            } finally {
                semaphore.release();
            }
        });
        
        await Promise.all(promises);
        return results;
    }

    /**
     * Generate cache key for targeting evaluation
     */
    generateCacheKey(campaignId, customerId, context) {
        const contextHash = this.hashObject({
            restaurantId: context.restaurantId,
            // Only include relevant context for caching
            date: new Date(context.orderTime || Date.now()).toDateString()
        });
        
        return `campaign_${campaignId}_customer_${customerId}_context_${contextHash}`;
    }

    /**
     * Get item from cache if not expired
     */
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.config.cacheTimeout) {
            return cached.data;
        }
        
        if (cached) {
            this.cache.delete(key);
        }
        
        return null;
    }

    /**
     * Set item in cache with timestamp
     */
    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        
        // Cleanup old cache entries periodically
        if (this.cache.size > 10000) {
            this.cleanupCache();
        }
    }

    /**
     * Clean up expired cache entries
     */
    cleanupCache() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, value] of this.cache) {
            if (now - value.timestamp >= this.config.cacheTimeout) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.cache.delete(key));
    }

    /**
     * Update performance metrics
     */
    updateMetrics(evaluationTime) {
        this.metrics.evaluationCount++;
        this.metrics.averageEvaluationTime = 
            (this.metrics.averageEvaluationTime * (this.metrics.evaluationCount - 1) + evaluationTime) / 
            this.metrics.evaluationCount;
    }

    /**
     * Get performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses),
            cacheSize: this.cache.size
        };
    }

    /**
     * Hash object for cache key generation
     */
    hashObject(obj) {
        const str = JSON.stringify(obj, Object.keys(obj).sort());
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }
}

/**
 * Semaphore for concurrency control
 */
class Semaphore {
    constructor(max) {
        this.max = max;
        this.current = 0;
        this.queue = [];
    }

    async acquire() {
        return new Promise((resolve) => {
            if (this.current < this.max) {
                this.current++;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    }

    release() {
        this.current--;
        if (this.queue.length > 0) {
            this.current++;
            const resolve = this.queue.shift();
            resolve();
        }
    }
}

/**
 * DynamoDB Query Optimizer for Enhanced Targeting
 */
class DynamoDBTargetingOptimizer {
    constructor(dynamoClient) {
        this.dynamo = dynamoClient;
        this.indexNames = {
            campaignsByStatus: 'status-startDate-index',
            customersBySegment: 'segment-joinDate-index',
            restaurantsByCategory: 'category-rating-index'
        };
    }

    /**
     * Optimized query for active campaigns
     */
    async getActiveCampaignsOptimized() {
        const now = new Date().toISOString();
        
        const params = {
            TableName: 'WizzCentral_Platform_Discounts',
            IndexName: this.indexNames.campaignsByStatus,
            KeyConditionExpression: '#status = :status AND #startDate <= :now',
            FilterExpression: '#endDate >= :now AND #isActive = :active',
            ExpressionAttributeNames: {
                '#status': 'status',
                '#startDate': 'startDate',
                '#endDate': 'endDate',
                '#isActive': 'isActive'
            },
            ExpressionAttributeValues: {
                ':status': 'active',
                ':now': now,
                ':active': true
            }
        };

        try {
            const result = await this.dynamo.query(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error('Error querying active campaigns:', error);
            return [];
        }
    }

    /**
     * Optimized customer segment query
     */
    async getCustomersBySegmentOptimized(segment, limit = 1000) {
        const params = {
            TableName: 'WizzCentral_Platform_Customers',
            IndexName: this.indexNames.customersBySegment,
            KeyConditionExpression: '#segment = :segment',
            ExpressionAttributeNames: {
                '#segment': 'segment'
            },
            ExpressionAttributeValues: {
                ':segment': segment
            },
            Limit: limit
        };

        try {
            const result = await this.dynamo.query(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error('Error querying customers by segment:', error);
            return [];
        }
    }

    /**
     * Optimized restaurant query by category
     */
    async getRestaurantsByCategoryOptimized(category, minRating = 0) {
        const params = {
            TableName: 'WizzCentral_Platform_Restaurants',
            IndexName: this.indexNames.restaurantsByCategory,
            KeyConditionExpression: '#category = :category AND #rating >= :minRating',
            ExpressionAttributeNames: {
                '#category': 'category',
                '#rating': 'rating'
            },
            ExpressionAttributeValues: {
                ':category': category,
                ':minRating': minRating
            }
        };

        try {
            const result = await this.dynamo.query(params).promise();
            return result.Items || [];
        } catch (error) {
            console.error('Error querying restaurants by category:', error);
            return [];
        }
    }

    /**
     * Batch get customer data
     */
    async batchGetCustomers(customerIds) {
        const batches = [];
        
        // DynamoDB batch operations are limited to 100 items
        for (let i = 0; i < customerIds.length; i += 100) {
            const batch = customerIds.slice(i, i + 100);
            batches.push(batch);
        }

        const allCustomers = [];

        for (const batch of batches) {
            const params = {
                RequestItems: {
                    'WizzCentral_Platform_Customers': {
                        Keys: batch.map(id => ({ customerId: id }))
                    }
                }
            };

            try {
                const result = await this.dynamo.batchGet(params).promise();
                const customers = result.Responses?.WizzCentral_Platform_Customers || [];
                allCustomers.push(...customers);
            } catch (error) {
                console.error('Error batch getting customers:', error);
            }
        }

        return allCustomers;
    }

    /**
     * Create optimal indexes for targeting queries
     */
    async createTargetingIndexes() {
        const indexes = [
            {
                tableName: 'WizzCentral_Platform_Discounts',
                indexName: 'status-startDate-index',
                keySchema: [
                    { AttributeName: 'status', KeyType: 'HASH' },
                    { AttributeName: 'startDate', KeyType: 'RANGE' }
                ],
                attributeDefinitions: [
                    { AttributeName: 'status', AttributeType: 'S' },
                    { AttributeName: 'startDate', AttributeType: 'S' }
                ]
            },
            {
                tableName: 'WizzCentral_Platform_Customers',
                indexName: 'segment-joinDate-index',
                keySchema: [
                    { AttributeName: 'segment', KeyType: 'HASH' },
                    { AttributeName: 'joinDate', KeyType: 'RANGE' }
                ],
                attributeDefinitions: [
                    { AttributeName: 'segment', AttributeType: 'S' },
                    { AttributeName: 'joinDate', AttributeType: 'S' }
                ]
            },
            {
                tableName: 'WizzCentral_Platform_Restaurants',
                indexName: 'category-rating-index',
                keySchema: [
                    { AttributeName: 'category', KeyType: 'HASH' },
                    { AttributeName: 'rating', KeyType: 'RANGE' }
                ],
                attributeDefinitions: [
                    { AttributeName: 'category', AttributeType: 'S' },
                    { AttributeName: 'rating', AttributeType: 'N' }
                ]
            }
        ];

        const createPromises = indexes.map(index => this.createGSI(index));
        return await Promise.allSettled(createPromises);
    }

    /**
     * Create Global Secondary Index
     */
    async createGSI(indexConfig) {
        const params = {
            TableName: indexConfig.tableName,
            AttributeDefinitions: indexConfig.attributeDefinitions,
            GlobalSecondaryIndexUpdates: [
                {
                    Create: {
                        IndexName: indexConfig.indexName,
                        KeySchema: indexConfig.keySchema,
                        Projection: { ProjectionType: 'ALL' },
                        ProvisionedThroughput: {
                            ReadCapacityUnits: 5,
                            WriteCapacityUnits: 5
                        }
                    }
                }
            ]
        };

        try {
            await this.dynamo.updateTable(params).promise();
            console.log(`Created index ${indexConfig.indexName} on table ${indexConfig.tableName}`);
        } catch (error) {
            if (error.code === 'ResourceInUseException') {
                console.log(`Index ${indexConfig.indexName} already exists`);
            } else {
                console.error(`Error creating index ${indexConfig.indexName}:`, error);
                throw error;
            }
        }
    }
}

/**
 * Real-time Campaign Targeting Engine
 */
class RealTimeTargetingEngine {
    constructor(config) {
        this.performanceOptimizer = new TargetingPerformanceOptimizer(config.performance);
        this.dbOptimizer = new DynamoDBTargetingOptimizer(config.dynamoClient);
        this.eventListeners = new Map();
    }

    /**
     * Get eligible campaigns for a customer in real-time
     */
    async getEligibleCampaignsRealTime(customerId, context) {
        try {
            // Get customer data
            const customer = await this.getCustomerData(customerId);
            if (!customer) {
                return [];
            }

            // Get active campaigns (cached query)
            const campaigns = await this.dbOptimizer.getActiveCampaignsOptimized();

            // Evaluate eligibility for each campaign
            const eligibilityPromises = campaigns.map(campaign =>
                this.performanceOptimizer.evaluateCampaignEligibilityOptimized(
                    campaign, 
                    customer, 
                    context
                ).then(result => ({ campaign, result }))
            );

            const evaluations = await Promise.all(eligibilityPromises);
            
            // Filter eligible campaigns
            const eligibleCampaigns = evaluations
                .filter(({ result }) => result.eligible)
                .map(({ campaign }) => campaign);

            // Emit event for analytics
            this.emitEvent('campaigns_evaluated', {
                customerId,
                totalCampaigns: campaigns.length,
                eligibleCampaigns: eligibleCampaigns.length,
                context
            });

            return eligibleCampaigns;

        } catch (error) {
            console.error('Error in real-time targeting:', error);
            return [];
        }
    }

    /**
     * Precompute campaign eligibility for high-value customers
     */
    async precomputeEligibility(customerSegment = 'vip') {
        try {
            // Get customers in the segment
            const customers = await this.dbOptimizer.getCustomersBySegmentOptimized(customerSegment);
            
            // Get active campaigns
            const campaigns = await this.dbOptimizer.getActiveCampaignsOptimized();

            // Batch evaluate eligibility
            const context = { precomputed: true, timestamp: new Date().toISOString() };
            const results = await this.performanceOptimizer.batchEvaluateEligibility(
                campaigns, 
                customers, 
                context
            );

            // Store precomputed results
            await this.storePrecomputedResults(results);

            console.log(`Precomputed eligibility for ${customers.length} customers and ${campaigns.length} campaigns`);
            
            return results;

        } catch (error) {
            console.error('Error in precomputation:', error);
            return new Map();
        }
    }

    /**
     * Get customer data with caching
     */
    async getCustomerData(customerId) {
        const cacheKey = `customer_${customerId}`;
        const cached = this.performanceOptimizer.getFromCache(cacheKey);
        
        if (cached) {
            return cached;
        }

        try {
            // In a real implementation, this would fetch from your customer service
            const customer = await this.fetchCustomerFromDB(customerId);
            this.performanceOptimizer.setCache(cacheKey, customer);
            return customer;
        } catch (error) {
            console.error('Error fetching customer data:', error);
            return null;
        }
    }

    /**
     * Store precomputed results in cache or database
     */
    async storePrecomputedResults(results) {
        // Store in cache for quick access
        for (const [key, value] of results) {
            const cacheKey = `precomputed_${key}`;
            this.performanceOptimizer.setCache(cacheKey, value);
        }

        // Optionally store in database for persistence
        // Implementation depends on your storage strategy
    }

    /**
     * Event emission for analytics and monitoring
     */
    emitEvent(eventType, data) {
        const listeners = this.eventListeners.get(eventType) || [];
        listeners.forEach(listener => {
            try {
                listener(data);
            } catch (error) {
                console.error('Error in event listener:', error);
            }
        });
    }

    /**
     * Add event listener
     */
    addEventListener(eventType, listener) {
        if (!this.eventListeners.has(eventType)) {
            this.eventListeners.set(eventType, []);
        }
        this.eventListeners.get(eventType).push(listener);
    }

    /**
     * Mock customer fetch for demonstration
     */
    async fetchCustomerFromDB(customerId) {
        // This would be replaced with actual database query
        return {
            customerId,
            orderCount: 15,
            totalSpent: 450.75,
            loyaltyLevel: 'gold',
            joinDate: '2023-01-15',
            lastOrderDate: '2024-01-10',
            averageOrderValue: 30.05,
            segment: 'vip'
        };
    }

    /**
     * Get performance metrics
     */
    getPerformanceMetrics() {
        return this.performanceOptimizer.getMetrics();
    }
}

// Export classes
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TargetingPerformanceOptimizer,
        DynamoDBTargetingOptimizer,
        RealTimeTargetingEngine,
        Semaphore
    };
} else if (typeof window !== 'undefined') {
    window.TargetingPerformanceOptimizer = TargetingPerformanceOptimizer;
    window.DynamoDBTargetingOptimizer = DynamoDBTargetingOptimizer;
    window.RealTimeTargetingEngine = RealTimeTargetingEngine;
    window.Semaphore = Semaphore;
}
