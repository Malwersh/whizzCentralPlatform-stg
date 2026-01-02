// Enhanced Targeting System for WizzCentral Campaign Creation
// This file enhances the existing campaign creation system with sophisticated targeting capabilities

(function() {
    'use strict';

    // Enhanced Targeting Manager
    window.EnhancedTargetingManager = class {
        constructor() {
            this.targetingData = {
                customerSegments: {
                    enabled: false,
                    criteria: [],
                    logic: 'OR'
                },
                restaurantTargeting: {
                    enabled: false,
                    mode: 'specific', // 'specific', 'category', 'location', 'rating'
                    restaurants: [],
                    categories: [],
                    locationCriteria: null,
                    ratingCriteria: null
                },
                occasionTargeting: {
                    enabled: false,
                    occasions: [],
                    timeConstraints: [],
                    recurringSchedules: []
                }
            };
            this.validationRules = new TargetingValidationRules();
            this.initializeUI();
        }

        initializeUI() {
            this.createEnhancedTargetingUI();
            this.attachEventListeners();
        }

        createEnhancedTargetingUI() {
            const targetingContainer = document.getElementById('campaignTargeting');
            if (!targetingContainer) {
                console.warn('Campaign targeting container not found');
                return;
            }

            targetingContainer.innerHTML = this.generateEnhancedTargetingHTML();
            this.populateDropdowns();
        }

        generateEnhancedTargetingHTML() {
            return `
                <div class="enhanced-targeting-container">
                    <h4 style="margin: 1rem 0 0.5rem 0; color: #2c3e50;">
                        <i class="fas fa-bullseye"></i> Advanced Targeting Configuration
                    </h4>
                    
                    <!-- Customer Segments Targeting -->
                    <div class="targeting-section">
                        <div class="targeting-header">
                            <label class="targeting-toggle">
                                <input type="checkbox" id="enableCustomerSegments" onchange="toggleCustomerSegments()">
                                <span class="toggle-label">Customer Segments Targeting</span>
                            </label>
                        </div>
                        <div id="customerSegmentsPanel" class="targeting-panel" style="display: none;">
                            <div class="form-group">
                                <label>Segment Logic</label>
                                <select id="customerSegmentLogic">
                                    <option value="OR">Match ANY criteria (OR)</option>
                                    <option value="AND">Match ALL criteria (AND)</option>
                                </select>
                            </div>
                            <div id="customerCriteriaContainer">
                                <div class="criteria-item">
                                    <button type="button" onclick="addCustomerCriteria()" class="btn-add-criteria">
                                        <i class="fas fa-plus"></i> Add Customer Criteria
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Restaurant Targeting -->
                    <div class="targeting-section">
                        <div class="targeting-header">
                            <label class="targeting-toggle">
                                <input type="checkbox" id="enableRestaurantTargeting" onchange="toggleRestaurantTargeting()">
                                <span class="toggle-label">Restaurant Targeting</span>
                            </label>
                        </div>
                        <div id="restaurantTargetingPanel" class="targeting-panel" style="display: none;">
                            <div class="form-group">
                                <label>Targeting Mode</label>
                                <select id="restaurantTargetingMode" onchange="updateRestaurantMode()">
                                    <option value="specific">Specific Restaurants</option>
                                    <option value="category">Restaurant Categories</option>
                                    <option value="location">Location-Based</option>
                                    <option value="rating">Rating-Based</option>
                                </select>
                            </div>
                            <div id="restaurantTargetingContent">
                                <!-- Dynamic content based on mode -->
                            </div>
                        </div>
                    </div>

                    <!-- Occasion Targeting -->
                    <div class="targeting-section">
                        <div class="targeting-header">
                            <label class="targeting-toggle">
                                <input type="checkbox" id="enableOccasionTargeting" onchange="toggleOccasionTargeting()">
                                <span class="toggle-label">Occasion-Based Targeting</span>
                            </label>
                        </div>
                        <div id="occasionTargetingPanel" class="targeting-panel" style="display: none;">
                            <div class="form-row">
                                <div class="form-group">
                                    <label>Occasion Types</label>
                                    <select id="occasionTypes" multiple size="4">
                                        <option value="ramadan">Ramadan</option>
                                        <option value="eid">Eid Celebrations</option>
                                        <option value="weekend">Weekend Special</option>
                                        <option value="national_holiday">National Holidays</option>
                                        <option value="sports_events">Sports Events</option>
                                        <option value="custom">Custom Events</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Time Constraints</label>
                                    <div id="timeConstraintsContainer">
                                        <button type="button" onclick="addTimeConstraint()" class="btn-add-criteria">
                                            <i class="fas fa-clock"></i> Add Time Constraint
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Recurring Schedules</label>
                                <div id="recurringSchedulesContainer">
                                    <button type="button" onclick="addRecurringSchedule()" class="btn-add-criteria">
                                        <i class="fas fa-calendar-alt"></i> Add Recurring Schedule
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Targeting Summary -->
                    <div class="targeting-summary" id="targetingSummary" style="display: none;">
                        <h5><i class="fas fa-chart-pie"></i> Targeting Summary</h5>
                        <div id="targetingSummaryContent"></div>
                    </div>
                </div>

                <style>
                .enhanced-targeting-container {
                    background: #f8f9fa;
                    border: 1px solid #e9ecef;
                    border-radius: 8px;
                    padding: 1rem;
                    margin: 1rem 0;
                }

                .targeting-section {
                    margin-bottom: 1.5rem;
                    border: 1px solid #dee2e6;
                    border-radius: 6px;
                    overflow: hidden;
                }

                .targeting-header {
                    background: #e9ecef;
                    padding: 0.75rem 1rem;
                    border-bottom: 1px solid #dee2e6;
                }

                .targeting-toggle {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-weight: 600;
                    cursor: pointer;
                    margin: 0;
                }

                .targeting-toggle input[type="checkbox"] {
                    margin: 0;
                    width: auto;
                }

                .targeting-panel {
                    padding: 1rem;
                    background: white;
                }

                .criteria-item {
                    background: #f8f9fa;
                    border: 1px solid #e9ecef;
                    border-radius: 4px;
                    padding: 0.75rem;
                    margin-bottom: 0.5rem;
                    position: relative;
                }

                .btn-add-criteria {
                    background: #28a745;
                    color: white;
                    border: none;
                    padding: 0.5rem 1rem;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.9rem;
                }

                .btn-add-criteria:hover {
                    background: #218838;
                }

                .btn-remove-criteria {
                    background: #dc3545;
                    color: white;
                    border: none;
                    padding: 0.25rem 0.5rem;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 0.8rem;
                    position: absolute;
                    top: 0.5rem;
                    right: 0.5rem;
                }

                .btn-remove-criteria:hover {
                    background: #c82333;
                }

                .targeting-summary {
                    background: #e3f2fd;
                    border: 1px solid #bbdefb;
                    border-radius: 6px;
                    padding: 1rem;
                    margin-top: 1rem;
                }

                .targeting-summary h5 {
                    margin: 0 0 0.5rem 0;
                    color: #1976d2;
                }
                </style>
            `;
        }

        populateDropdowns() {
            // Populate restaurant dropdown
            this.populateRestaurants();
            
            // Set default dates
            this.setDefaultDates();
        }

        populateRestaurants() {
            // Mock restaurant data - in real implementation, fetch from API
            const restaurants = [
                { id: 'rest_001', name: 'Al-Baghdadia Restaurant', category: 'Traditional Iraqi' },
                { id: 'rest_002', name: 'Pizza Palace', category: 'Italian' },
                { id: 'rest_003', name: 'Shawarma King', category: 'Fast Food' },
                { id: 'rest_004', name: 'Sushi Tokyo', category: 'Japanese' },
                { id: 'rest_005', name: 'Burger House', category: 'American' }
            ];

            // This will be populated when restaurant mode is selected
            this.availableRestaurants = restaurants;
        }

        setDefaultDates() {
            const today = new Date();
            const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
            
            const startDateInput = document.getElementById('campaignStartDate');
            const endDateInput = document.getElementById('campaignEndDate');
            
            if (startDateInput && !startDateInput.value) {
                startDateInput.value = today.toISOString().split('T')[0];
            }
            
            if (endDateInput && !endDateInput.value) {
                endDateInput.value = nextWeek.toISOString().split('T')[0];
            }
        }

        // Validation and data collection methods
        validateTargeting() {
            return this.validationRules.validate(this.targetingData);
        }

        collectTargetingData() {
            const data = {
                customerSegments: this.collectCustomerSegments(),
                restaurantTargeting: this.collectRestaurantTargeting(),
                occasionTargeting: this.collectOccasionTargeting()
            };

            this.targetingData = data;
            return data;
        }

        collectCustomerSegments() {
            const enabled = document.getElementById('enableCustomerSegments')?.checked || false;
            if (!enabled) return { enabled: false };

            const logic = document.getElementById('customerSegmentLogic')?.value || 'OR';
            const criteria = this.collectCustomerCriteria();

            return {
                enabled: true,
                logic,
                criteria
            };
        }

        collectCustomerCriteria() {
            const criteria = [];
            const criteriaElements = document.querySelectorAll('.customer-criteria-item');
            
            criteriaElements.forEach(element => {
                const type = element.querySelector('.criteria-type')?.value;
                const operator = element.querySelector('.criteria-operator')?.value;
                const value = element.querySelector('.criteria-value')?.value;
                
                if (type && operator && value) {
                    criteria.push({ type, operator, value });
                }
            });

            return criteria;
        }

        collectRestaurantTargeting() {
            const enabled = document.getElementById('enableRestaurantTargeting')?.checked || false;
            if (!enabled) return { enabled: false };

            const mode = document.getElementById('restaurantTargetingMode')?.value || 'specific';
            
            return {
                enabled: true,
                mode,
                ...this.collectRestaurantModeData(mode)
            };
        }

        collectRestaurantModeData(mode) {
            switch (mode) {
                case 'specific':
                    return {
                        restaurants: Array.from(document.getElementById('specificRestaurants')?.selectedOptions || [])
                            .map(option => option.value)
                    };
                case 'category':
                    return {
                        categories: Array.from(document.getElementById('restaurantCategories')?.selectedOptions || [])
                            .map(option => option.value)
                    };
                case 'location':
                    return {
                        locationCriteria: this.collectLocationCriteria()
                    };
                case 'rating':
                    return {
                        ratingCriteria: this.collectRatingCriteria()
                    };
                default:
                    return {};
            }
        }

        collectLocationCriteria() {
            return {
                areas: Array.from(document.getElementById('locationAreas')?.selectedOptions || [])
                    .map(option => option.value),
                radius: document.getElementById('locationRadius')?.value || 5
            };
        }

        collectRatingCriteria() {
            return {
                minRating: document.getElementById('minRating')?.value || 3.0,
                minReviews: document.getElementById('minReviews')?.value || 10
            };
        }

        collectOccasionTargeting() {
            const enabled = document.getElementById('enableOccasionTargeting')?.checked || false;
            if (!enabled) return { enabled: false };

            return {
                enabled: true,
                occasions: Array.from(document.getElementById('occasionTypes')?.selectedOptions || [])
                    .map(option => option.value),
                timeConstraints: this.collectTimeConstraints(),
                recurringSchedules: this.collectRecurringSchedules()
            };
        }

        collectTimeConstraints() {
            const constraints = [];
            const timeElements = document.querySelectorAll('.time-constraint-item');
            
            timeElements.forEach(element => {
                const startTime = element.querySelector('.start-time')?.value;
                const endTime = element.querySelector('.end-time')?.value;
                const days = Array.from(element.querySelectorAll('.day-checkbox:checked'))
                    .map(cb => cb.value);
                
                if (startTime && endTime && days.length > 0) {
                    constraints.push({ startTime, endTime, days });
                }
            });

            return constraints;
        }

        collectRecurringSchedules() {
            const schedules = [];
            const scheduleElements = document.querySelectorAll('.recurring-schedule-item');
            
            scheduleElements.forEach(element => {
                const frequency = element.querySelector('.schedule-frequency')?.value;
                const startDate = element.querySelector('.schedule-start-date')?.value;
                const endDate = element.querySelector('.schedule-end-date')?.value;
                
                if (frequency && startDate && endDate) {
                    schedules.push({ frequency, startDate, endDate });
                }
            });

            return schedules;
        }

        updateTargetingSummary() {
            const summaryContainer = document.getElementById('targetingSummary');
            const summaryContent = document.getElementById('targetingSummaryContent');
            
            if (!summaryContainer || !summaryContent) return;

            const data = this.collectTargetingData();
            const hasTargeting = data.customerSegments.enabled || 
                                data.restaurantTargeting.enabled || 
                                data.occasionTargeting.enabled;

            if (!hasTargeting) {
                summaryContainer.style.display = 'none';
                return;
            }

            summaryContainer.style.display = 'block';
            summaryContent.innerHTML = this.generateSummaryHTML(data);
        }

        generateSummaryHTML(data) {
            let html = '<ul>';
            
            if (data.customerSegments.enabled) {
                html += `<li><strong>Customer Segments:</strong> ${data.customerSegments.criteria.length} criteria with ${data.customerSegments.logic} logic</li>`;
            }
            
            if (data.restaurantTargeting.enabled) {
                html += `<li><strong>Restaurant Targeting:</strong> ${data.restaurantTargeting.mode} mode`;
                switch (data.restaurantTargeting.mode) {
                    case 'specific':
                        html += ` (${data.restaurantTargeting.restaurants?.length || 0} restaurants)`;
                        break;
                    case 'category':
                        html += ` (${data.restaurantTargeting.categories?.length || 0} categories)`;
                        break;
                    case 'location':
                        html += ` (${data.restaurantTargeting.locationCriteria?.areas?.length || 0} areas)`;
                        break;
                    case 'rating':
                        html += ` (min rating: ${data.restaurantTargeting.ratingCriteria?.minRating || 'N/A'})`;
                        break;
                }
                html += '</li>';
            }
            
            if (data.occasionTargeting.enabled) {
                html += `<li><strong>Occasion Targeting:</strong> ${data.occasionTargeting.occasions.length} occasions, ${data.occasionTargeting.timeConstraints.length} time constraints</li>`;
            }
            
            html += '</ul>';
            return html;
        }

        generateRestaurantModeHTML(mode) {
            switch (mode) {
                case 'specific':
                    return this.generateSpecificRestaurantsHTML();
                case 'category':
                    return this.generateCategoriesHTML();
                case 'location':
                    return this.generateLocationHTML();
                case 'rating':
                    return this.generateRatingHTML();
                default:
                    return '';
            }
        }

        generateSpecificRestaurantsHTML() {
            const restaurants = this.availableRestaurants || [];
            return `
                <div class="form-group">
                    <label>Select Restaurants</label>
                    <select id="specificRestaurants" multiple size="6" style="width: 100%;">
                        ${restaurants.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                    </select>
                    <small class="form-text">Hold Ctrl/Cmd to select multiple restaurants</small>
                </div>
            `;
        }

        generateCategoriesHTML() {
            const categories = [
                'Traditional Iraqi', 'Fast Food', 'Italian', 'Japanese', 'American',
                'Chinese', 'Indian', 'Mediterranean', 'Healthy', 'Desserts'
            ];
            return `
                <div class="form-group">
                    <label>Select Categories</label>
                    <select id="restaurantCategories" multiple size="6" style="width: 100%;">
                        ${categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
                    </select>
                    <small class="form-text">Hold Ctrl/Cmd to select multiple categories</small>
                </div>
            `;
        }

        generateLocationHTML() {
            const areas = [
                'Al-Mansour', 'Karrada', 'Jadiriya', 'Hay Al-Jamia', 'Sadr City',
                'Kadhimiya', 'Adhamiya', 'Dora', 'New Baghdad', 'Zayouna'
            ];
            return `
                <div class="form-row">
                    <div class="form-group">
                        <label>Target Areas</label>
                        <select id="locationAreas" multiple size="5" style="width: 100%;">
                            ${areas.map(area => `<option value="${area}">${area}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Radius (km)</label>
                        <input type="number" id="locationRadius" value="5" min="1" max="50" step="0.5">
                        <small class="form-text">Search radius from selected areas</small>
                    </div>
                </div>
            `;
        }

        generateRatingHTML() {
            return `
                <div class="form-row">
                    <div class="form-group">
                        <label>Minimum Rating</label>
                        <select id="minRating">
                            <option value="3.0">3.0 stars and above</option>
                            <option value="3.5">3.5 stars and above</option>
                            <option value="4.0">4.0 stars and above</option>
                            <option value="4.5">4.5 stars and above</option>
                            <option value="5.0">5.0 stars only</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Minimum Reviews</label>
                        <input type="number" id="minReviews" value="10" min="1" max="1000">
                        <small class="form-text">Minimum number of customer reviews</small>
                    </div>
                </div>
            `;
        }
    };

    // Validation Rules Class
    class TargetingValidationRules {
        validate(data) {
            const errors = [];

            // Validate customer segments
            if (data.customerSegments.enabled) {
                if (data.customerSegments.criteria.length === 0) {
                    errors.push('Customer segments targeting is enabled but no criteria defined');
                }
                
                data.customerSegments.criteria.forEach((criteria, index) => {
                    if (!this.validateCustomerCriteria(criteria)) {
                        errors.push(`Customer criteria ${index + 1} is invalid`);
                    }
                });
            }

            // Validate restaurant targeting
            if (data.restaurantTargeting.enabled) {
                if (!this.validateRestaurantTargeting(data.restaurantTargeting)) {
                    errors.push('Restaurant targeting configuration is invalid');
                }
            }

            // Validate occasion targeting
            if (data.occasionTargeting.enabled) {
                if (data.occasionTargeting.occasions.length === 0) {
                    errors.push('Occasion targeting is enabled but no occasions selected');
                }
            }

            return {
                isValid: errors.length === 0,
                errors
            };
        }

        validateCustomerCriteria(criteria) {
            const validTypes = ['minOrderCount', 'minSpentAmount', 'loyaltyLevel', 'joinDateAfter', 'joinDateBefore'];
            const validOperators = ['>=', '<=', '=', '>', '<'];
            
            return validTypes.includes(criteria.type) && 
                   validOperators.includes(criteria.operator) && 
                   criteria.value !== null && 
                   criteria.value !== undefined && 
                   criteria.value !== '';
        }

        validateRestaurantTargeting(targeting) {
            switch (targeting.mode) {
                case 'specific':
                    return targeting.restaurants && targeting.restaurants.length > 0;
                case 'category':
                    return targeting.categories && targeting.categories.length > 0;
                case 'location':
                    return targeting.locationCriteria && 
                           targeting.locationCriteria.areas && 
                           targeting.locationCriteria.areas.length > 0;
                case 'rating':
                    return targeting.ratingCriteria && 
                           targeting.ratingCriteria.minRating >= 1 && 
                           targeting.ratingCriteria.minRating <= 5;
                default:
                    return false;
            }
        }
    }

    // Global functions for UI interaction
    window.toggleCustomerSegments = function() {
        const checkbox = document.getElementById('enableCustomerSegments');
        const panel = document.getElementById('customerSegmentsPanel');
        
        if (checkbox && panel) {
            panel.style.display = checkbox.checked ? 'block' : 'none';
            window.enhancedTargeting?.updateTargetingSummary();
        }
    };

    window.toggleRestaurantTargeting = function() {
        const checkbox = document.getElementById('enableRestaurantTargeting');
        const panel = document.getElementById('restaurantTargetingPanel');
        
        if (checkbox && panel) {
            panel.style.display = checkbox.checked ? 'block' : 'none';
            if (checkbox.checked) {
                window.updateRestaurantMode();
            }
            window.enhancedTargeting?.updateTargetingSummary();
        }
    };

    window.toggleOccasionTargeting = function() {
        const checkbox = document.getElementById('enableOccasionTargeting');
        const panel = document.getElementById('occasionTargetingPanel');
        
        if (checkbox && panel) {
            panel.style.display = checkbox.checked ? 'block' : 'none';
            window.enhancedTargeting?.updateTargetingSummary();
        }
    };

    window.updateRestaurantMode = function() {
        const mode = document.getElementById('restaurantTargetingMode')?.value;
        const content = document.getElementById('restaurantTargetingContent');
        
        if (!content) return;

        content.innerHTML = window.enhancedTargeting?.generateRestaurantModeHTML(mode) || '';
        window.enhancedTargeting?.updateTargetingSummary();
    };

    // Global functions for customer criteria management
    window.addCustomerCriteria = function() {
        const container = document.getElementById('customerCriteriaContainer');
        if (!container) return;

        const criteriaId = 'criteria_' + Date.now();
        const criteriaHTML = `
            <div class="criteria-item customer-criteria-item" id="${criteriaId}">
                <button type="button" class="btn-remove-criteria" onclick="removeCriteria('${criteriaId}')">×</button>
                <div class="form-row">
                    <div class="form-group">
                        <label>Criteria Type</label>
                        <select class="criteria-type" onchange="updateCriteriaOperators('${criteriaId}')">
                            <option value="">Select criteria</option>
                            <option value="minOrderCount">Minimum Orders</option>
                            <option value="minSpentAmount">Minimum Spent Amount</option>
                            <option value="loyaltyLevel">Loyalty Level</option>
                            <option value="joinDateAfter">Joined After Date</option>
                            <option value="joinDateBefore">Joined Before Date</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Operator</label>
                        <select class="criteria-operator">
                            <option value=">=">&gt;= (greater than or equal)</option>
                            <option value="<=">&lt;= (less than or equal)</option>
                            <option value="=">=  (equal to)</option>
                            <option value=">">&gt; (greater than)</option>
                            <option value="<">&lt; (less than)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Value</label>
                        <input type="text" class="criteria-value" placeholder="Enter value">
                    </div>
                </div>
            </div>
        `;

        // Insert before the add button
        const addButton = container.querySelector('.criteria-item');
        addButton.insertAdjacentHTML('beforebegin', criteriaHTML);
        window.enhancedTargeting?.updateTargetingSummary();
    };

    window.addTimeConstraint = function() {
        const container = document.getElementById('timeConstraintsContainer');
        if (!container) return;

        const constraintId = 'time_' + Date.now();
        const constraintHTML = `
            <div class="criteria-item time-constraint-item" id="${constraintId}">
                <button type="button" class="btn-remove-criteria" onclick="removeCriteria('${constraintId}')">×</button>
                <div class="form-row">
                    <div class="form-group">
                        <label>Start Time</label>
                        <input type="time" class="start-time">
                    </div>
                    <div class="form-group">
                        <label>End Time</label>
                        <input type="time" class="end-time">
                    </div>
                </div>
                <div class="form-group">
                    <label>Days of Week</label>
                    <div class="checkbox-group">
                        <label><input type="checkbox" class="day-checkbox" value="monday"> Monday</label>
                        <label><input type="checkbox" class="day-checkbox" value="tuesday"> Tuesday</label>
                        <label><input type="checkbox" class="day-checkbox" value="wednesday"> Wednesday</label>
                        <label><input type="checkbox" class="day-checkbox" value="thursday"> Thursday</label>
                        <label><input type="checkbox" class="day-checkbox" value="friday"> Friday</label>
                        <label><input type="checkbox" class="day-checkbox" value="saturday"> Saturday</label>
                        <label><input type="checkbox" class="day-checkbox" value="sunday"> Sunday</label>
                    </div>
                </div>
            </div>
        `;

        // Insert before the add button
        const addButton = container.querySelector('.btn-add-criteria');
        addButton.insertAdjacentHTML('beforebegin', constraintHTML);
        window.enhancedTargeting?.updateTargetingSummary();
    };

    window.addRecurringSchedule = function() {
        const container = document.getElementById('recurringSchedulesContainer');
        if (!container) return;

        const scheduleId = 'schedule_' + Date.now();
        const scheduleHTML = `
            <div class="criteria-item recurring-schedule-item" id="${scheduleId}">
                <button type="button" class="btn-remove-criteria" onclick="removeCriteria('${scheduleId}')">×</button>
                <div class="form-row">
                    <div class="form-group">
                        <label>Frequency</label>
                        <select class="schedule-frequency">
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="yearly">Yearly</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Start Date</label>
                        <input type="date" class="schedule-start-date">
                    </div>
                    <div class="form-group">
                        <label>End Date</label>
                        <input type="date" class="schedule-end-date">
                    </div>
                </div>
            </div>
        `;

        // Insert before the add button
        const addButton = container.querySelector('.btn-add-criteria');
        addButton.insertAdjacentHTML('beforebegin', scheduleHTML);
        window.enhancedTargeting?.updateTargetingSummary();
    };

    window.removeCriteria = function(criteriaId) {
        const element = document.getElementById(criteriaId);
        if (element) {
            element.remove();
            window.enhancedTargeting?.updateTargetingSummary();
        }
    };

    window.updateCriteriaOperators = function(criteriaId) {
        const criteriaElement = document.getElementById(criteriaId);
        if (!criteriaElement) return;

        const typeSelect = criteriaElement.querySelector('.criteria-type');
        const operatorSelect = criteriaElement.querySelector('.criteria-operator');
        const valueInput = criteriaElement.querySelector('.criteria-value');

        if (!typeSelect || !operatorSelect || !valueInput) return;

        const criteriaType = typeSelect.value;
        
        // Update placeholder and input type based on criteria type
        switch (criteriaType) {
            case 'minOrderCount':
                valueInput.type = 'number';
                valueInput.placeholder = 'e.g., 5';
                valueInput.min = '0';
                break;
            case 'minSpentAmount':
                valueInput.type = 'number';
                valueInput.placeholder = 'e.g., 100.00';
                valueInput.min = '0';
                valueInput.step = '0.01';
                break;
            case 'loyaltyLevel':
                valueInput.type = 'text';
                valueInput.placeholder = 'e.g., gold, silver, bronze';
                break;
            case 'joinDateAfter':
            case 'joinDateBefore':
                valueInput.type = 'date';
                valueInput.placeholder = '';
                break;
            default:
                valueInput.type = 'text';
                valueInput.placeholder = 'Enter value';
        }

        window.enhancedTargeting?.updateTargetingSummary();
    };

    // Add CSS for checkbox groups
    const additionalStyles = `
        <style>
        .checkbox-group {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
        }

        .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 0.25rem;
            font-size: 0.9rem;
            white-space: nowrap;
        }

        .checkbox-group input[type="checkbox"] {
            width: auto;
            margin: 0;
        }
        </style>
    `;

    // Inject additional styles
    document.head.insertAdjacentHTML('beforeend', additionalStyles);

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        // Initialize enhanced targeting if campaign targeting container exists
        if (document.getElementById('campaignTargeting')) {
            window.enhancedTargeting = new window.EnhancedTargetingManager();
        }
    });

})();
