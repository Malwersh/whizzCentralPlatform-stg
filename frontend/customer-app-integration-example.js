/**
 * Customer App Integration Example for Enhanced Targeting
 * 
 * This file demonstrates how customer-facing applications (mobile apps, web apps)
 * can consume and evaluate the enhanced targeting criteria created in WizzCentral.
 * 
 * The targeting data is stored in DynamoDB and can be retrieved through APIs
 * to determine campaign eligibility for customers in real-time.
 */

class CustomerCampaignEvaluator {
    constructor(apiConfig) {
        this.apiBaseUrl = apiConfig.baseUrl;
        this.apiKey = apiConfig.apiKey;
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Get all active campaigns for a customer
     * @param {Object} customerData - Customer information
     * @param {Object} contextData - Additional context (location, time, etc.)
     * @returns {Promise<Array>} List of eligible campaigns
     */
    async getEligibleCampaigns(customerData, contextData = {}) {
        try {
            // Get all active campaigns
            const activeCampaigns = await this.fetchActiveCampaigns();
            
            // Filter campaigns based on targeting criteria
            const eligibleCampaigns = [];
            
            for (const campaign of activeCampaigns) {
                const isEligible = await this.evaluateCampaignEligibility(
                    campaign, 
                    customerData, 
                    contextData
                );
                
                if (isEligible.eligible) {
                    eligibleCampaigns.push({
                        ...campaign,
                        eligibilityReason: isEligible.reason
                    });
                }
            }
            
            return eligibleCampaigns;
        } catch (error) {
            console.error('Error getting eligible campaigns:', error);
            return [];
        }
    }

    /**
     * Evaluate if a customer is eligible for a specific campaign
     * @param {Object} campaign - Campaign data with targeting criteria
     * @param {Object} customerData - Customer information
     * @param {Object} contextData - Additional context
     * @returns {Promise<Object>} Eligibility result
     */
    async evaluateCampaignEligibility(campaign, customerData, contextData) {
        try {
            // Check if campaign has enhanced targeting
            if (!campaign.enhancedTargeting) {
                return this.evaluateLegacyTargeting(campaign, customerData, contextData);
            }

            const targeting = campaign.enhancedTargeting;
            const results = [];

            // Evaluate customer segments
            if (targeting.customerSegments && targeting.customerSegments.enabled) {
                const segmentResult = await this.evaluateCustomerSegments(
                    targeting.customerSegments, 
                    customerData
                );
                results.push(segmentResult);
            }

            // Evaluate restaurant targeting
            if (targeting.restaurantTargeting && targeting.restaurantTargeting.enabled) {
                const restaurantResult = await this.evaluateRestaurantTargeting(
                    targeting.restaurantTargeting, 
                    contextData
                );
                results.push(restaurantResult);
            }

            // Evaluate occasions
            if (targeting.occasions && targeting.occasions.enabled) {
                const occasionResult = await this.evaluateOccasions(
                    targeting.occasions, 
                    contextData
                );
                results.push(occasionResult);
            }

            // Apply targeting logic (AND/OR)
            const logic = targeting.logic || 'AND';
            const isEligible = logic === 'AND' 
                ? results.every(r => r.eligible)
                : results.some(r => r.eligible);

            return {
                eligible: isEligible,
                reason: isEligible 
                    ? 'Customer meets targeting criteria'
                    : 'Customer does not meet targeting criteria',
                details: results
            };

        } catch (error) {
            return {
                eligible: false,
                reason: `Error evaluating campaign: ${error.message}`
            };
        }
    }

    /**
     * Evaluate customer segment targeting
     */
    async evaluateCustomerSegments(segmentTargeting, customerData) {
        try {
            const results = [];

            // Check predefined segments
            if (segmentTargeting.predefinedSegments && segmentTargeting.predefinedSegments.length > 0) {
                const customerSegment = await this.getCustomerSegment(customerData.customerId);
                const isInSegment = segmentTargeting.predefinedSegments.includes(customerSegment);
                results.push({ eligible: isInSegment, type: 'predefined' });
            }

            // Check custom criteria
            if (segmentTargeting.customCriteria && segmentTargeting.customCriteria.length > 0) {
                for (const criteria of segmentTargeting.customCriteria) {
                    const criteriaResult = this.evaluateCustomCriteria(criteria, customerData);
                    results.push({ eligible: criteriaResult, type: 'custom', criteria });
                }
            }

            // Apply segment logic
            const logic = segmentTargeting.logic || 'AND';
            const isEligible = logic === 'AND' 
                ? results.every(r => r.eligible)
                : results.some(r => r.eligible);

            return {
                eligible: isEligible,
                type: 'customerSegments',
                details: results
            };

        } catch (error) {
            return {
                eligible: false,
                type: 'customerSegments',
                error: error.message
            };
        }
    }

    /**
     * Evaluate custom criteria for customer targeting
     */
    evaluateCustomCriteria(criteria, customerData) {
        switch (criteria.field) {
            case 'orderCount':
                return this.compareNumeric(customerData.orderCount || 0, criteria.operator, criteria.value);
                
            case 'totalSpent':
                return this.compareNumeric(customerData.totalSpent || 0, criteria.operator, criteria.value);
                
            case 'loyaltyLevel':
                return this.compareString(customerData.loyaltyLevel || '', criteria.operator, criteria.value);
                
            case 'joinDate':
                return this.compareDate(customerData.joinDate, criteria.operator, criteria.value);
                
            case 'lastOrderDate':
                return this.compareDate(customerData.lastOrderDate, criteria.operator, criteria.value);
                
            case 'averageOrderValue':
                return this.compareNumeric(customerData.averageOrderValue || 0, criteria.operator, criteria.value);
                
            default:
                return false;
        }
    }

    /**
     * Evaluate restaurant targeting
     */
    async evaluateRestaurantTargeting(restaurantTargeting, contextData) {
        try {
            const currentRestaurantId = contextData.restaurantId;
            if (!currentRestaurantId) {
                return { eligible: false, type: 'restaurantTargeting', reason: 'No restaurant context' };
            }

            switch (restaurantTargeting.mode) {
                case 'specific':
                    const isSpecificMatch = restaurantTargeting.specificRestaurants.includes(currentRestaurantId);
                    return { eligible: isSpecificMatch, type: 'restaurantTargeting' };

                case 'category':
                    const restaurant = await this.getRestaurantData(currentRestaurantId);
                    const isCategoryMatch = restaurantTargeting.categories.includes(restaurant.category);
                    return { eligible: isCategoryMatch, type: 'restaurantTargeting' };

                case 'location':
                    const restaurantLocation = await this.getRestaurantLocation(currentRestaurantId);
                    const isLocationMatch = this.isLocationInTargetAreas(
                        restaurantLocation, 
                        restaurantTargeting.locations
                    );
                    return { eligible: isLocationMatch, type: 'restaurantTargeting' };

                case 'rating':
                    const restaurantRating = await this.getRestaurantRating(currentRestaurantId);
                    const isRatingMatch = this.compareNumeric(
                        restaurantRating, 
                        restaurantTargeting.ratingOperator, 
                        restaurantTargeting.ratingValue
                    );
                    return { eligible: isRatingMatch, type: 'restaurantTargeting' };

                default:
                    return { eligible: false, type: 'restaurantTargeting', reason: 'Unknown targeting mode' };
            }
        } catch (error) {
            return {
                eligible: false,
                type: 'restaurantTargeting',
                error: error.message
            };
        }
    }

    /**
     * Evaluate occasion-based targeting
     */
    async evaluateOccasions(occasionTargeting, contextData) {
        try {
            const currentTime = new Date();
            const results = [];

            // Check special events
            if (occasionTargeting.specialEvents && occasionTargeting.specialEvents.length > 0) {
                for (const event of occasionTargeting.specialEvents) {
                    const isEventActive = this.isEventActive(event, currentTime);
                    results.push({ eligible: isEventActive, type: 'specialEvent', event });
                }
            }

            // Check recurring schedules
            if (occasionTargeting.recurringSchedules && occasionTargeting.recurringSchedules.length > 0) {
                for (const schedule of occasionTargeting.recurringSchedules) {
                    const isScheduleActive = this.isRecurringScheduleActive(schedule, currentTime);
                    results.push({ eligible: isScheduleActive, type: 'recurringSchedule', schedule });
                }
            }

            // Check religious occasions
            if (occasionTargeting.religiousOccasions && occasionTargeting.religiousOccasions.length > 0) {
                for (const occasion of occasionTargeting.religiousOccasions) {
                    const isOccasionActive = await this.isReligiousOccasionActive(occasion, currentTime);
                    results.push({ eligible: isOccasionActive, type: 'religiousOccasion', occasion });
                }
            }

            // Apply occasion logic
            const logic = occasionTargeting.logic || 'OR';
            const isEligible = logic === 'AND' 
                ? results.every(r => r.eligible)
                : results.some(r => r.eligible);

            return {
                eligible: isEligible,
                type: 'occasions',
                details: results
            };

        } catch (error) {
            return {
                eligible: false,
                type: 'occasions',
                error: error.message
            };
        }
    }

    /**
     * Helper methods for comparisons
     */
    compareNumeric(value, operator, targetValue) {
        const numValue = parseFloat(value);
        const numTarget = parseFloat(targetValue);
        
        switch (operator) {
            case 'equals': return numValue === numTarget;
            case 'greater_than': return numValue > numTarget;
            case 'less_than': return numValue < numTarget;
            case 'greater_equal': return numValue >= numTarget;
            case 'less_equal': return numValue <= numTarget;
            default: return false;
        }
    }

    compareString(value, operator, targetValue) {
        switch (operator) {
            case 'equals': return value === targetValue;
            case 'contains': return value.includes(targetValue);
            case 'starts_with': return value.startsWith(targetValue);
            case 'ends_with': return value.endsWith(targetValue);
            default: return false;
        }
    }

    compareDate(value, operator, targetValue) {
        const date = new Date(value);
        const targetDate = new Date(targetValue);
        
        switch (operator) {
            case 'equals': return date.getTime() === targetDate.getTime();
            case 'after': return date > targetDate;
            case 'before': return date < targetDate;
            case 'on_or_after': return date >= targetDate;
            case 'on_or_before': return date <= targetDate;
            default: return false;
        }
    }

    /**
     * Data fetching methods (these would typically call your backend APIs)
     */
    async fetchActiveCampaigns() {
        const cacheKey = 'active_campaigns';
        const cached = this.getCachedData(cacheKey);
        if (cached) return cached;

        // In a real implementation, this would call your backend API
        const response = await fetch(`${this.apiBaseUrl}/campaigns/active`, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        const campaigns = await response.json();
        this.setCachedData(cacheKey, campaigns);
        return campaigns;
    }

    async getCustomerSegment(customerId) {
        const cacheKey = `customer_segment_${customerId}`;
        const cached = this.getCachedData(cacheKey);
        if (cached) return cached;

        // API call to get customer segment
        const response = await fetch(`${this.apiBaseUrl}/customers/${customerId}/segment`, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        const segment = await response.text();
        this.setCachedData(cacheKey, segment);
        return segment;
    }

    async getRestaurantData(restaurantId) {
        const cacheKey = `restaurant_${restaurantId}`;
        const cached = this.getCachedData(cacheKey);
        if (cached) return cached;

        // API call to get restaurant data
        const response = await fetch(`${this.apiBaseUrl}/restaurants/${restaurantId}`, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        const restaurant = await response.json();
        this.setCachedData(cacheKey, restaurant);
        return restaurant;
    }

    /**
     * Cache management
     */
    getCachedData(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    setCachedData(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    /**
     * Time and schedule helpers
     */
    isEventActive(event, currentTime) {
        const startTime = new Date(event.startDate);
        const endTime = new Date(event.endDate);
        return currentTime >= startTime && currentTime <= endTime;
    }

    isRecurringScheduleActive(schedule, currentTime) {
        // Check if current time matches the recurring schedule
        const currentDay = currentTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const currentHour = currentTime.getHours();
        const currentMinute = currentTime.getMinutes();
        
        if (schedule.daysOfWeek && !schedule.daysOfWeek.includes(currentDay)) {
            return false;
        }
        
        if (schedule.timeRange) {
            const [startHour, startMinute] = schedule.timeRange.start.split(':').map(Number);
            const [endHour, endMinute] = schedule.timeRange.end.split(':').map(Number);
            
            const currentMinutes = currentHour * 60 + currentMinute;
            const startMinutes = startHour * 60 + startMinute;
            const endMinutes = endHour * 60 + endMinute;
            
            return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        }
        
        return true;
    }

    async isReligiousOccasionActive(occasion, currentTime) {
        // This would typically involve checking against a religious calendar API
        // For example, checking if it's currently Ramadan, Christmas, etc.
        
        // Simplified implementation - you'd want to integrate with a proper calendar service
        const currentDate = currentTime.toISOString().split('T')[0];
        return occasion.dates && occasion.dates.includes(currentDate);
    }

    isLocationInTargetAreas(location, targetAreas) {
        // Check if restaurant location is within any of the target areas
        for (const area of targetAreas) {
            if (this.isLocationInArea(location, area)) {
                return true;
            }
        }
        return false;
    }

    isLocationInArea(location, area) {
        // Simple radius-based check
        if (area.type === 'radius') {
            const distance = this.calculateDistance(
                location.latitude, location.longitude,
                area.center.latitude, area.center.longitude
            );
            return distance <= area.radius;
        }
        
        // Polygon-based check would be more complex
        return false;
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        // Haversine formula for calculating distance between two points
        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
}

/**
 * React Native / Mobile App Integration Example
 */
class MobileCampaignManager {
    constructor(apiConfig) {
        this.evaluator = new CustomerCampaignEvaluator(apiConfig);
    }

    async checkCampaignsForUser(userId) {
        try {
            // Get customer data from local storage or API
            const customerData = await this.getCustomerData(userId);
            
            // Get current context (location, time, etc.)
            const contextData = await this.getCurrentContext();
            
            // Get eligible campaigns
            const eligibleCampaigns = await this.evaluator.getEligibleCampaigns(
                customerData, 
                contextData
            );
            
            // Show campaigns in the app UI
            this.displayCampaigns(eligibleCampaigns);
            
            return eligibleCampaigns;
        } catch (error) {
            console.error('Error checking campaigns:', error);
            return [];
        }
    }

    async getCustomerData(userId) {
        // This would fetch from your user profile service
        return {
            customerId: userId,
            orderCount: 15,
            totalSpent: 450.75,
            loyaltyLevel: 'gold',
            joinDate: '2023-01-15',
            lastOrderDate: '2024-01-10',
            averageOrderValue: 30.05
        };
    }

    async getCurrentContext() {
        // Get location, current restaurant, time, etc.
        return {
            restaurantId: 'rest_123',
            location: {
                latitude: 40.7128,
                longitude: -74.0060
            },
            timestamp: new Date().toISOString()
        };
    }

    displayCampaigns(campaigns) {
        // Implementation would depend on your mobile app framework
        console.log('Eligible campaigns:', campaigns);
    }
}

/**
 * React/Web App Integration Example
 */
class WebCampaignComponent {
    constructor(containerId, apiConfig) {
        this.container = document.getElementById(containerId);
        this.evaluator = new CustomerCampaignEvaluator(apiConfig);
    }

    async loadCampaigns(userId, restaurantId) {
        try {
            const customerData = await this.fetchCustomerProfile(userId);
            const contextData = { restaurantId, timestamp: new Date().toISOString() };
            
            const campaigns = await this.evaluator.getEligibleCampaigns(customerData, contextData);
            this.renderCampaigns(campaigns);
        } catch (error) {
            this.renderError(error);
        }
    }

    renderCampaigns(campaigns) {
        if (!this.container) return;

        this.container.innerHTML = campaigns.length > 0 
            ? campaigns.map(campaign => `
                <div class="campaign-card">
                    <h3>${campaign.title}</h3>
                    <p>${campaign.description}</p>
                    <div class="discount">
                        ${campaign.discountType === 'percentage' ? `${campaign.discountValue}% OFF` : `$${campaign.discountValue} OFF`}
                    </div>
                    <button onclick="applyCampaign('${campaign.id}')">Apply Offer</button>
                </div>
            `).join('')
            : '<p>No special offers available at this time.</p>';
    }

    renderError(error) {
        if (this.container) {
            this.container.innerHTML = `<p class="error">Error loading offers: ${error.message}</p>`;
        }
    }

    async fetchCustomerProfile(userId) {
        // Fetch customer profile from your API
        const response = await fetch(`/api/customers/${userId}/profile`);
        return response.json();
    }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CustomerCampaignEvaluator,
        MobileCampaignManager,
        WebCampaignComponent
    };
} else if (typeof window !== 'undefined') {
    window.CustomerCampaignEvaluator = CustomerCampaignEvaluator;
    window.MobileCampaignManager = MobileCampaignManager;
    window.WebCampaignComponent = WebCampaignComponent;
}
