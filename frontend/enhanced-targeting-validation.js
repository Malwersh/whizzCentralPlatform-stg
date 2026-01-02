// Enhanced Targeting Validation and Processing for WizzCentral Backend
// This module provides server-side validation and processing for advanced targeting criteria

(function() {
    'use strict';

    // Campaign Targeting Validator
    window.CampaignTargetingValidator = class {
        constructor() {
            this.validationSchema = this.initializeValidationSchema();
        }

        initializeValidationSchema() {
            return {
                customerSegments: {
                    enabled: { type: 'boolean', required: true },
                    logic: { type: 'string', enum: ['AND', 'OR'], required: false },
                    criteria: { type: 'array', required: false, items: {
                        type: { type: 'string', enum: ['minOrderCount', 'minSpentAmount', 'loyaltyLevel', 'joinDateAfter', 'joinDateBefore'] },
                        operator: { type: 'string', enum: ['>=', '<=', '=', '>', '<'] },
                        value: { type: 'any', required: true }
                    }}
                },
                restaurantTargeting: {
                    enabled: { type: 'boolean', required: true },
                    mode: { type: 'string', enum: ['specific', 'category', 'location', 'rating'], required: false },
                    restaurants: { type: 'array', required: false },
                    categories: { type: 'array', required: false },
                    locationCriteria: { type: 'object', required: false },
                    ratingCriteria: { type: 'object', required: false }
                },
                occasionTargeting: {
                    enabled: { type: 'boolean', required: true },
                    occasions: { type: 'array', required: false },
                    timeConstraints: { type: 'array', required: false },
                    recurringSchedules: { type: 'array', required: false }
                }
            };
        }

        /**
         * Validate complete targeting configuration
         * @param {Object} targetingData - The targeting configuration object
         * @returns {Object} - Validation result with isValid flag and errors array
         */
        validateTargetingConfiguration(targetingData) {
            const errors = [];

            try {
                // Validate customer segments
                if (targetingData.customerSegments?.enabled) {
                    const customerSegmentErrors = this.validateCustomerSegments(targetingData.customerSegments);
                    errors.push(...customerSegmentErrors);
                }

                // Validate restaurant targeting
                if (targetingData.restaurantTargeting?.enabled) {
                    const restaurantErrors = this.validateRestaurantTargeting(targetingData.restaurantTargeting);
                    errors.push(...restaurantErrors);
                }

                // Validate occasion targeting
                if (targetingData.occasionTargeting?.enabled) {
                    const occasionErrors = this.validateOccasionTargeting(targetingData.occasionTargeting);
                    errors.push(...occasionErrors);
                }

                // Validate logical consistency
                const consistencyErrors = this.validateLogicalConsistency(targetingData);
                errors.push(...consistencyErrors);

            } catch (error) {
                errors.push('Targeting validation failed: ' + error.message);
            }

            return {
                isValid: errors.length === 0,
                errors: errors,
                warnings: this.generateWarnings(targetingData)
            };
        }

        validateCustomerSegments(customerSegments) {
            const errors = [];

            if (!customerSegments.criteria || customerSegments.criteria.length === 0) {
                errors.push('Customer segments targeting is enabled but no criteria defined');
                return errors;
            }

            if (!['AND', 'OR'].includes(customerSegments.logic)) {
                errors.push('Invalid customer segment logic operator');
            }

            customerSegments.criteria.forEach((criteria, index) => {
                const criteriaErrors = this.validateCustomerCriteria(criteria, index);
                errors.push(...criteriaErrors);
            });

            return errors;
        }

        validateCustomerCriteria(criteria, index) {
            const errors = [];
            const position = `criteria ${index + 1}`;

            if (!criteria.type) {
                errors.push(`Customer ${position}: Missing criteria type`);
                return errors;
            }

            if (!criteria.operator) {
                errors.push(`Customer ${position}: Missing operator`);
            }

            if (criteria.value === null || criteria.value === undefined || criteria.value === '') {
                errors.push(`Customer ${position}: Missing value`);
            }

            // Type-specific validation
            switch (criteria.type) {
                case 'minOrderCount':
                    if (!this.isPositiveInteger(criteria.value)) {
                        errors.push(`Customer ${position}: Order count must be a positive integer`);
                    }
                    break;

                case 'minSpentAmount':
                    if (!this.isPositiveNumber(criteria.value)) {
                        errors.push(`Customer ${position}: Spent amount must be a positive number`);
                    }
                    break;

                case 'loyaltyLevel':
                    if (!this.isValidLoyaltyLevel(criteria.value)) {
                        errors.push(`Customer ${position}: Invalid loyalty level`);
                    }
                    break;

                case 'joinDateAfter':
                case 'joinDateBefore':
                    if (!this.isValidDate(criteria.value)) {
                        errors.push(`Customer ${position}: Invalid date format`);
                    }
                    break;

                default:
                    errors.push(`Customer ${position}: Unknown criteria type`);
            }

            return errors;
        }

        validateRestaurantTargeting(restaurantTargeting) {
            const errors = [];

            if (!restaurantTargeting.mode) {
                errors.push('Restaurant targeting mode is required');
                return errors;
            }

            switch (restaurantTargeting.mode) {
                case 'specific':
                    if (!restaurantTargeting.restaurants || restaurantTargeting.restaurants.length === 0) {
                        errors.push('Specific restaurant targeting requires at least one restaurant');
                    } else {
                        // Validate restaurant IDs format
                        restaurantTargeting.restaurants.forEach((restaurantId, index) => {
                            if (!this.isValidRestaurantId(restaurantId)) {
                                errors.push(`Invalid restaurant ID at position ${index + 1}`);
                            }
                        });
                    }
                    break;

                case 'category':
                    if (!restaurantTargeting.categories || restaurantTargeting.categories.length === 0) {
                        errors.push('Category targeting requires at least one category');
                    }
                    break;

                case 'location':
                    errors.push(...this.validateLocationCriteria(restaurantTargeting.locationCriteria));
                    break;

                case 'rating':
                    errors.push(...this.validateRatingCriteria(restaurantTargeting.ratingCriteria));
                    break;

                default:
                    errors.push('Invalid restaurant targeting mode');
            }

            return errors;
        }

        validateLocationCriteria(locationCriteria) {
            const errors = [];

            if (!locationCriteria) {
                errors.push('Location criteria is required for location-based targeting');
                return errors;
            }

            if (!locationCriteria.areas || locationCriteria.areas.length === 0) {
                errors.push('At least one area must be specified for location targeting');
            }

            if (locationCriteria.radius !== undefined) {
                if (!this.isPositiveNumber(locationCriteria.radius) || locationCriteria.radius > 50) {
                    errors.push('Location radius must be a positive number not exceeding 50km');
                }
            }

            return errors;
        }

        validateRatingCriteria(ratingCriteria) {
            const errors = [];

            if (!ratingCriteria) {
                errors.push('Rating criteria is required for rating-based targeting');
                return errors;
            }

            if (ratingCriteria.minRating !== undefined) {
                const rating = parseFloat(ratingCriteria.minRating);
                if (isNaN(rating) || rating < 1 || rating > 5) {
                    errors.push('Minimum rating must be between 1.0 and 5.0');
                }
            }

            if (ratingCriteria.minReviews !== undefined) {
                if (!this.isPositiveInteger(ratingCriteria.minReviews)) {
                    errors.push('Minimum reviews must be a positive integer');
                }
            }

            return errors;
        }

        validateOccasionTargeting(occasionTargeting) {
            const errors = [];

            if (!occasionTargeting.occasions || occasionTargeting.occasions.length === 0) {
                errors.push('Occasion targeting requires at least one occasion type');
                return errors;
            }

            // Validate occasion types
            const validOccasions = ['ramadan', 'eid', 'weekend', 'national_holiday', 'sports_events', 'custom'];
            occasionTargeting.occasions.forEach(occasion => {
                if (!validOccasions.includes(occasion)) {
                    errors.push(`Invalid occasion type: ${occasion}`);
                }
            });

            // Validate time constraints
            if (occasionTargeting.timeConstraints) {
                occasionTargeting.timeConstraints.forEach((constraint, index) => {
                    errors.push(...this.validateTimeConstraint(constraint, index));
                });
            }

            // Validate recurring schedules
            if (occasionTargeting.recurringSchedules) {
                occasionTargeting.recurringSchedules.forEach((schedule, index) => {
                    errors.push(...this.validateRecurringSchedule(schedule, index));
                });
            }

            return errors;
        }

        validateTimeConstraint(constraint, index) {
            const errors = [];
            const position = `time constraint ${index + 1}`;

            if (!constraint.startTime || !constraint.endTime) {
                errors.push(`${position}: Start and end times are required`);
            }

            if (!this.isValidTime(constraint.startTime)) {
                errors.push(`${position}: Invalid start time format`);
            }

            if (!this.isValidTime(constraint.endTime)) {
                errors.push(`${position}: Invalid end time format`);
            }

            if (!constraint.days || constraint.days.length === 0) {
                errors.push(`${position}: At least one day must be selected`);
            }

            return errors;
        }

        validateRecurringSchedule(schedule, index) {
            const errors = [];
            const position = `recurring schedule ${index + 1}`;

            if (!schedule.frequency) {
                errors.push(`${position}: Frequency is required`);
            }

            if (!['daily', 'weekly', 'monthly', 'yearly'].includes(schedule.frequency)) {
                errors.push(`${position}: Invalid frequency`);
            }

            if (!this.isValidDate(schedule.startDate)) {
                errors.push(`${position}: Invalid start date`);
            }

            if (!this.isValidDate(schedule.endDate)) {
                errors.push(`${position}: Invalid end date`);
            }

            if (schedule.startDate && schedule.endDate && new Date(schedule.startDate) >= new Date(schedule.endDate)) {
                errors.push(`${position}: Start date must be before end date`);
            }

            return errors;
        }

        validateLogicalConsistency(targetingData) {
            const errors = [];

            // Check if at least one targeting method is enabled
            const hasCustomerTargeting = targetingData.customerSegments?.enabled;
            const hasRestaurantTargeting = targetingData.restaurantTargeting?.enabled;
            const hasOccasionTargeting = targetingData.occasionTargeting?.enabled;

            if (!hasCustomerTargeting && !hasRestaurantTargeting && !hasOccasionTargeting) {
                errors.push('At least one targeting method must be enabled');
            }

            // Validate date consistency across all targeting methods
            const dates = this.extractAllDates(targetingData);
            errors.push(...this.validateDateConsistency(dates));

            return errors;
        }

        generateWarnings(targetingData) {
            const warnings = [];

            // Check for overly restrictive targeting
            if (this.isTargetingTooRestrictive(targetingData)) {
                warnings.push('Targeting criteria may be too restrictive and could limit campaign reach');
            }

            // Check for potentially conflicting criteria
            if (this.hasConflictingCriteria(targetingData)) {
                warnings.push('Some targeting criteria may conflict and reduce effectiveness');
            }

            return warnings;
        }

        // Helper validation methods
        isPositiveInteger(value) {
            const num = parseInt(value);
            return !isNaN(num) && num > 0 && num.toString() === value.toString();
        }

        isPositiveNumber(value) {
            const num = parseFloat(value);
            return !isNaN(num) && num > 0;
        }

        isValidDate(dateString) {
            if (!dateString) return false;
            const date = new Date(dateString);
            return date instanceof Date && !isNaN(date.getTime());
        }

        isValidTime(timeString) {
            if (!timeString) return false;
            return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeString);
        }

        isValidLoyaltyLevel(level) {
            const validLevels = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
            return typeof level === 'string' && validLevels.includes(level.toLowerCase());
        }

        isValidRestaurantId(id) {
            return typeof id === 'string' && id.length > 0 && /^[a-zA-Z0-9_-]+$/.test(id);
        }

        extractAllDates(targetingData) {
            const dates = [];

            // Extract dates from customer segments
            if (targetingData.customerSegments?.criteria) {
                targetingData.customerSegments.criteria.forEach(criteria => {
                    if (['joinDateAfter', 'joinDateBefore'].includes(criteria.type)) {
                        dates.push(criteria.value);
                    }
                });
            }

            // Extract dates from recurring schedules
            if (targetingData.occasionTargeting?.recurringSchedules) {
                targetingData.occasionTargeting.recurringSchedules.forEach(schedule => {
                    if (schedule.startDate) dates.push(schedule.startDate);
                    if (schedule.endDate) dates.push(schedule.endDate);
                });
            }

            return dates;
        }

        validateDateConsistency(dates) {
            const errors = [];
            const sortedDates = dates.filter(date => this.isValidDate(date)).sort();

            // Check for logical date ordering issues
            for (let i = 0; i < sortedDates.length - 1; i++) {
                const current = new Date(sortedDates[i]);
                const next = new Date(sortedDates[i + 1]);
                
                if (current > next) {
                    errors.push('Date ordering inconsistency detected in targeting criteria');
                    break;
                }
            }

            return errors;
        }

        isTargetingTooRestrictive(targetingData) {
            let restrictionCount = 0;

            if (targetingData.customerSegments?.enabled && targetingData.customerSegments.criteria?.length > 2) {
                restrictionCount++;
            }

            if (targetingData.restaurantTargeting?.enabled) {
                restrictionCount++;
            }

            if (targetingData.occasionTargeting?.enabled && targetingData.occasionTargeting.occasions?.length < 2) {
                restrictionCount++;
            }

            return restrictionCount >= 3;
        }

        hasConflictingCriteria(targetingData) {
            // Check for conflicting customer criteria
            if (targetingData.customerSegments?.criteria) {
                const criteria = targetingData.customerSegments.criteria;
                
                // Check for conflicting date criteria
                const dateAfter = criteria.find(c => c.type === 'joinDateAfter');
                const dateBefore = criteria.find(c => c.type === 'joinDateBefore');
                
                if (dateAfter && dateBefore && new Date(dateAfter.value) >= new Date(dateBefore.value)) {
                    return true;
                }
            }

            return false;
        }
    };

    // Campaign Eligibility Evaluator
    window.CampaignEligibilityEvaluator = class {
        constructor() {
            this.validator = new window.CampaignTargetingValidator();
        }

        /**
         * Evaluate if a customer/order is eligible for a campaign based on targeting criteria
         * @param {Object} campaign - Campaign with targeting configuration
         * @param {Object} context - Order/customer context
         * @returns {Object} - Eligibility result
         */
        evaluateEligibility(campaign, context) {
            try {
                const targetingData = campaign.targetingData || {};
                
                const results = {
                    customerSegments: this.evaluateCustomerSegments(targetingData.customerSegments, context.customer),
                    restaurantTargeting: this.evaluateRestaurantTargeting(targetingData.restaurantTargeting, context.restaurant),
                    occasionTargeting: this.evaluateOccasionTargeting(targetingData.occasionTargeting, context.order)
                };

                const isEligible = this.calculateOverallEligibility(results, targetingData);

                return {
                    isEligible,
                    results,
                    reason: this.generateEligibilityReason(results, isEligible)
                };

            } catch (error) {
                return {
                    isEligible: false,
                    error: 'Eligibility evaluation failed: ' + error.message
                };
            }
        }

        evaluateCustomerSegments(segmentConfig, customer) {
            if (!segmentConfig?.enabled || !segmentConfig.criteria?.length) {
                return { applicable: false, eligible: true };
            }

            const results = segmentConfig.criteria.map(criteria => 
                this.evaluateCustomerCriteria(criteria, customer)
            );

            const eligible = segmentConfig.logic === 'OR' 
                ? results.some(r => r.eligible)
                : results.every(r => r.eligible);

            return {
                applicable: true,
                eligible,
                logic: segmentConfig.logic,
                criteriaResults: results
            };
        }

        evaluateCustomerCriteria(criteria, customer) {
            const { type, operator, value } = criteria;

            let customerValue;
            switch (type) {
                case 'minOrderCount':
                    customerValue = customer.orderCount || 0;
                    break;
                case 'minSpentAmount':
                    customerValue = customer.totalSpent || 0;
                    break;
                case 'loyaltyLevel':
                    customerValue = customer.loyaltyLevel || 'bronze';
                    break;
                case 'joinDateAfter':
                case 'joinDateBefore':
                    customerValue = customer.joinDate;
                    break;
                default:
                    return { eligible: false, reason: 'Unknown criteria type' };
            }

            const eligible = this.compareValues(customerValue, operator, value, type);
            
            return {
                eligible,
                type,
                customerValue,
                requiredValue: value,
                operator
            };
        }

        compareValues(customerValue, operator, requiredValue, type) {
            if (type === 'loyaltyLevel') {
                const levels = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
                const customerLevel = levels.indexOf(customerValue.toLowerCase());
                const requiredLevel = levels.indexOf(requiredValue.toLowerCase());
                
                switch (operator) {
                    case '>=': return customerLevel >= requiredLevel;
                    case '<=': return customerLevel <= requiredLevel;
                    case '=': return customerLevel === requiredLevel;
                    case '>': return customerLevel > requiredLevel;
                    case '<': return customerLevel < requiredLevel;
                    default: return false;
                }
            }

            if (type === 'joinDateAfter' || type === 'joinDateBefore') {
                const customerDate = new Date(customerValue);
                const requiredDate = new Date(requiredValue);
                
                switch (operator) {
                    case '>=': return customerDate >= requiredDate;
                    case '<=': return customerDate <= requiredDate;
                    case '=': return customerDate.toDateString() === requiredDate.toDateString();
                    case '>': return customerDate > requiredDate;
                    case '<': return customerDate < requiredDate;
                    default: return false;
                }
            }

            // Numeric comparison
            const numCustomer = parseFloat(customerValue);
            const numRequired = parseFloat(requiredValue);
            
            switch (operator) {
                case '>=': return numCustomer >= numRequired;
                case '<=': return numCustomer <= numRequired;
                case '=': return numCustomer === numRequired;
                case '>': return numCustomer > numRequired;
                case '<': return numCustomer < numRequired;
                default: return false;
            }
        }

        evaluateRestaurantTargeting(restaurantConfig, restaurant) {
            if (!restaurantConfig?.enabled) {
                return { applicable: false, eligible: true };
            }

            let eligible = false;

            switch (restaurantConfig.mode) {
                case 'specific':
                    eligible = restaurantConfig.restaurants?.includes(restaurant.id);
                    break;
                case 'category':
                    eligible = restaurantConfig.categories?.includes(restaurant.category);
                    break;
                case 'location':
                    eligible = this.evaluateLocationCriteria(restaurantConfig.locationCriteria, restaurant);
                    break;
                case 'rating':
                    eligible = this.evaluateRatingCriteria(restaurantConfig.ratingCriteria, restaurant);
                    break;
                default:
                    eligible = false;
            }

            return {
                applicable: true,
                eligible,
                mode: restaurantConfig.mode
            };
        }

        evaluateLocationCriteria(locationCriteria, restaurant) {
            if (!locationCriteria?.areas?.length) return false;
            
            // Simple area-based matching - in real implementation, use geospatial calculations
            return locationCriteria.areas.includes(restaurant.area);
        }

        evaluateRatingCriteria(ratingCriteria, restaurant) {
            if (!ratingCriteria) return false;

            const meetsRating = !ratingCriteria.minRating || restaurant.rating >= ratingCriteria.minRating;
            const meetsReviews = !ratingCriteria.minReviews || restaurant.reviewCount >= ratingCriteria.minReviews;

            return meetsRating && meetsReviews;
        }

        evaluateOccasionTargeting(occasionConfig, order) {
            if (!occasionConfig?.enabled || !occasionConfig.occasions?.length) {
                return { applicable: false, eligible: true };
            }

            const currentDate = new Date(order.timestamp || Date.now());
            const eligible = this.isCurrentOccasionActive(occasionConfig, currentDate);

            return {
                applicable: true,
                eligible,
                occasions: occasionConfig.occasions
            };
        }

        isCurrentOccasionActive(occasionConfig, currentDate) {
            // Check if any of the specified occasions are currently active
            return occasionConfig.occasions.some(occasion => {
                return this.isOccasionActive(occasion, currentDate, occasionConfig);
            });
        }

        isOccasionActive(occasion, currentDate, config) {
            // Simplified occasion checking - in real implementation, 
            // this would integrate with a comprehensive calendar system
            switch (occasion) {
                case 'weekend':
                    const dayOfWeek = currentDate.getDay();
                    return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
                case 'ramadan':
                    // Would check against Islamic calendar
                    return this.isRamadanPeriod(currentDate);
                default:
                    return true; // Default to active for other occasions
            }
        }

        isRamadanPeriod(date) {
            // Placeholder - in real implementation, calculate based on Islamic calendar
            return false;
        }

        calculateOverallEligibility(results, targetingData) {
            // Customer must be eligible for all enabled targeting methods
            const checks = [];

            if (results.customerSegments.applicable) {
                checks.push(results.customerSegments.eligible);
            }

            if (results.restaurantTargeting.applicable) {
                checks.push(results.restaurantTargeting.eligible);
            }

            if (results.occasionTargeting.applicable) {
                checks.push(results.occasionTargeting.eligible);
            }

            // If no targeting is configured, campaign is eligible for all
            if (checks.length === 0) return true;

            // All applicable targeting methods must pass
            return checks.every(check => check === true);
        }

        generateEligibilityReason(results, isEligible) {
            if (isEligible) {
                return 'Customer meets all targeting criteria';
            }

            const failedChecks = [];

            if (results.customerSegments.applicable && !results.customerSegments.eligible) {
                failedChecks.push('customer segment criteria');
            }

            if (results.restaurantTargeting.applicable && !results.restaurantTargeting.eligible) {
                failedChecks.push('restaurant targeting criteria');
            }

            if (results.occasionTargeting.applicable && !results.occasionTargeting.eligible) {
                failedChecks.push('occasion targeting criteria');
            }

            return `Customer does not meet: ${failedChecks.join(', ')}`;
        }
    };

    console.log('Enhanced Campaign Targeting Validator loaded');

})();
