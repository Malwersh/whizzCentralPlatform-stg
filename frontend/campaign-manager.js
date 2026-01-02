// Campaign Management Functions for WizzCentral Promotions
// Enhanced with sophisticated condition engine
// This file contains all campaign-related functionality

let campaigns = [];
let conditionEngine = null;
let conditionUI = null;

// Initialize condition engine and UI
function initializeConditionEngine() {
    try {
        if (window.CampaignConditionEngine) {
            conditionEngine = new window.CampaignConditionEngine();
            console.log('✅ Campaign Condition Engine initialized');
            
            // Initialize condition UI if container exists
            const conditionContainer = document.getElementById('campaignConditions');
            if (conditionContainer && window.ConditionConfigUI) {
                conditionUI = new window.ConditionConfigUI('campaignConditions', conditionEngine);
                console.log('✅ Condition Configuration UI initialized');
            }
        } else {
            console.warn('⚠️ CampaignConditionEngine not available');
        }
    } catch (error) {
        console.error('❌ Failed to initialize condition engine:', error);
    }
}

// Load campaigns data
async function loadCampaignsData() {
    console.log('Loading campaigns...');
    const tbody = document.getElementById('campaignsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">Loading campaigns...</td></tr>';
    }

    try {
        if (!window.dataService) {
            throw new Error('Data service not available');
        }
        
        await dataService.initialize();
        campaigns = await dataService.getCampaigns();
        console.log('Campaign data loaded: ' + campaigns.length + ' campaigns');
        renderCampaignsTable();
        updateCampaignStats();
    } catch (error) {
        console.error('Error loading campaigns:', error);
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: red;">Error: ' + error.message + '</td></tr>';
        }
    }
}

// Render campaigns table
function renderCampaignsTable() {
    const tbody = document.getElementById('campaignsTableBody');
    if (!tbody) return;
    
    if (campaigns.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No campaigns found. Create your first campaign!</td></tr>';
        return;
    }
    
    tbody.innerHTML = campaigns.map(campaign => {
        const discountDisplay = campaign.discountType === 'percentage' 
            ? campaign.discountValue + '%'
            : '$' + campaign.discountValue;
        
        const usageDisplay = campaign.usageLimit > 0 
            ? campaign.usage + '/' + campaign.usageLimit
            : campaign.usage.toString();
        
        return '<tr>' +
            '<td><div>' + campaign.title + '</div><div style="font-size: 0.8rem; color: #666;">' + campaign.code + '</div></td>' +
            '<td>' + formatCampaignType(campaign.type) + '</td>' +
            '<td>' + formatCampaignTargetEnhanced(campaign) + '</td>' +
            '<td>' + discountDisplay + '</td>' +
            '<td><span class="status-badge">' + (campaign.isActive ? 'Active' : campaign.status) + '</span></td>' +
            '<td>' + usageDisplay + '</td>' +
            '<td>' + formatDate(campaign.startDate) + ' - ' + formatDate(campaign.endDate) + '</td>' +
            '<td>' +
                '<button onclick="editCampaign(\'' + campaign.id + '\')" class="btn-secondary btn-sm"><i class="fas fa-edit"></i></button> ' +
                '<button onclick="toggleCampaign(\'' + campaign.id + '\')" class="btn-' + (campaign.isActive ? 'warning' : 'success') + ' btn-sm"><i class="fas fa-' + (campaign.isActive ? 'pause' : 'play') + '"></i></button> ' +
                '<button onclick="deleteCampaignConfirm(\'' + campaign.id + '\')" class="btn-danger btn-sm"><i class="fas fa-trash"></i></button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

// Update campaign statistics
function updateCampaignStats() {
    const active = campaigns.filter(c => c.isActive).length;
    const total = campaigns.length;
    
    const activeEl = document.getElementById('activeCampaigns');
    const totalEl = document.getElementById('totalCampaigns');
    
    if (activeEl) activeEl.textContent = active;
    if (totalEl) totalEl.textContent = total;
}

// Format campaign type for display
function formatCampaignType(type) {
    const typeMap = {
        // Business Campaign Types
        'marketing': 'Marketing Campaign',
        'loyalty': 'Loyalty Campaign',
        'retention': 'Customer Retention',
        'seasonal': 'Seasonal Campaign',
        'acquisition': 'Customer Acquisition',
        'flash': 'Flash Sale',
        // Customer Journey Types
        'first-order': 'First Order',
        'restaurant-first': 'Restaurant First',
        'new-customer': 'New Customer',
        'special-occasion': 'Special Occasion'
    };
    return typeMap[type] || type;
}

// Format campaign target for display
function formatCampaignTarget(campaign) {
    switch (campaign.type) {
        // Business Campaign Types
        case 'marketing':
            return campaign.targetSegments && campaign.targetSegments.length > 0 
                ? campaign.targetSegments.join(', ') 
                : 'All customers';
        case 'loyalty':
            return campaign.targetSegments && campaign.targetSegments.length > 0 
                ? campaign.targetSegments.join(', ') 
                : 'Loyalty members';
        case 'retention':
            return campaign.targetSegments && campaign.targetSegments.length > 0 
                ? campaign.targetSegments.join(', ') 
                : 'At-risk customers';
        case 'seasonal':
            return campaign.occasions && campaign.occasions.length > 0 
                ? campaign.occasions.join(', ') 
                : 'Seasonal shoppers';
        case 'acquisition':
            return campaign.targetSegments && campaign.targetSegments.length > 0 
                ? campaign.targetSegments.join(', ') 
                : 'New prospects';
        case 'flash':
            return campaign.occasions && campaign.occasions.length > 0 
                ? campaign.occasions.join(', ') 
                : 'All customers';
        // Customer Journey Types
        case 'restaurant-first':
            return campaign.targetRestaurants && campaign.targetRestaurants.length > 0 
                ? campaign.targetRestaurants.length + ' restaurant(s)' 
                : 'All restaurants';
        case 'new-customer':
            return campaign.targetSegments && campaign.targetSegments.length > 0 
                ? campaign.targetSegments.join(', ') 
                : 'All new customers';
        case 'special-occasion':
            return campaign.occasions && campaign.occasions.length > 0 
                ? campaign.occasions.join(', ') 
                : 'All occasions';
        default:
            return 'All customers';
    }
}

// Format date for display
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
}

// Open campaign creation modal
function openCreateCampaignModal() {
    const modal = document.getElementById('createCampaignModal');
    if (modal) {
        resetCampaignForm();
        modal.style.display = 'flex';
        loadRestaurantsForSelection();
        initializeCampaignDates();
    }
}

// Create campaign with specific type
function createCampaignType(type) {
    openCreateCampaignModal();
    const select = document.getElementById('campaignType');
    if (select) {
        select.value = type;
        updateCampaignFormFields();
    }
}

// Close campaign creation modal
function closeCampaignModal() {
    const modal = document.getElementById('createCampaignModal');
    if (modal) modal.style.display = 'none';
}

// Reset campaign form
function resetCampaignForm() {
    const form = document.getElementById('createCampaignForm');
    if (form) {
        form.reset();
        updateCampaignFormFields();
        initializeCampaignDates();
    }
}

// Initialize campaign form dates
function initializeCampaignDates() {
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const startDateInput = document.getElementById('campaignStartDate');
    const endDateInput = document.getElementById('campaignEndDate');
    
    if (startDateInput && endDateInput) {
        startDateInput.value = today.toISOString().split('T')[0];
        endDateInput.value = nextWeek.toISOString().split('T')[0];
        
        // Ensure date picker functionality
        startDateInput.addEventListener('focus', function() {
            this.showPicker && this.showPicker();
        });
        
        endDateInput.addEventListener('focus', function() {
            this.showPicker && this.showPicker();
        });
        
        console.log('📅 Campaign date inputs initialized with calendar functionality');
    }
}

// Update form fields based on campaign type
function updateCampaignFormFields() {
    const campaignType = document.getElementById('campaignType');
    if (!campaignType) return;
    
    const type = campaignType.value;
    
    // Hide all targeting sections first
    const restaurantSection = document.getElementById('restaurantTargeting');
    const segmentSection = document.getElementById('customerSegments');
    const occasionSection = document.getElementById('specialOccasions');
    
    if (restaurantSection) restaurantSection.style.display = 'none';
    if (segmentSection) segmentSection.style.display = 'none';
    if (occasionSection) occasionSection.style.display = 'none';
    
    // Show relevant sections based on campaign type
    switch (type) {
        // Business Campaign Types - Show segment targeting for most business campaigns
        case 'marketing':
        case 'loyalty':
        case 'retention':
        case 'acquisition':
            if (segmentSection) segmentSection.style.display = 'block';
            break;
        case 'seasonal':
        case 'flash':
            if (occasionSection) occasionSection.style.display = 'block';
            break;
        // Customer Journey Types - Original logic
        case 'restaurant-first':
            if (restaurantSection) restaurantSection.style.display = 'block';
            break;
        case 'new-customer':
            if (segmentSection) segmentSection.style.display = 'block';
            break;
        case 'special-occasion':
            if (occasionSection) occasionSection.style.display = 'block';
            break;
    }
}

// Update form fields based on campaign type (called from HTML)
function updateCampaignFields() {
    updateCampaignFormFields();
}

// Load restaurants for selection
async function loadRestaurantsForSelection() {
    try {
        console.log('Loading restaurants for campaign targeting...');
        
        // Initialize data service if needed
        if (!window.dataService) {
            console.warn('Data service not available');
            return;
        }
        
        await window.dataService.initialize();
        const businesses = await window.dataService.getBusinesses();
        console.log('Found ' + businesses.length + ' total businesses from WhizzMerchants_Businesses table');
        
        // Log first business for debugging
        if (businesses.length > 0) {
            console.log('Sample business data:', businesses[0]);
        }
        
        // Filter for restaurants - be more inclusive with business types
        const restaurants = businesses.filter(b => {
            const businessType = (b.businessType || '').toLowerCase();
            const category = (b.category || '').toLowerCase();
            
            // Include restaurants, cafes, and food-related businesses
            return businessType.includes('restaurant') || 
                   businessType.includes('cafe') || 
                   businessType.includes('food') ||
                   category.includes('restaurant') ||
                   category.includes('cafe') ||
                   category.includes('food') ||
                   businessType === 'restaurant' ||
                   category === 'restaurant';
        });
        
        console.log('Filtered ' + restaurants.length + ' restaurants/food businesses');
        
        const select = document.getElementById('targetRestaurants');
        if (select) {
            if (restaurants.length > 0) {
                // Use the correct field names from the real data structure
                select.innerHTML = restaurants.map(restaurant => {
                    const id = restaurant.businessId || restaurant.id;
                    const name = restaurant.businessName || restaurant.name || 'Unknown Business';
                    const type = restaurant.businessType || restaurant.category || '';
                    const displayName = name + (type ? ' (' + type + ')' : '');
                    
                    console.log('Adding restaurant option: ' + displayName + ' (ID: ' + id + ')');
                    return '<option value="' + id + '">' + displayName + '</option>';
                }).join('');
                
                console.log('Successfully populated restaurant dropdown with ' + restaurants.length + ' options');
            } else {
                // Show all businesses if no restaurants found (fallback)
                console.log('No restaurants found, showing all businesses as fallback');
                select.innerHTML = businesses.map(business => {
                    const id = business.businessId || business.id;
                    const name = business.businessName || business.name || 'Unknown Business';
                    const type = business.businessType || business.category || 'Business';
                    return '<option value="' + id + '">' + name + ' (' + type + ')</option>';
                }).join('');
                
                console.log('Populated with ' + businesses.length + ' total businesses as fallback');
            }
        } else {
            console.error('Could not find targetRestaurants select element');
        }
    } catch (error) {
        console.error('Error loading restaurants:', error);
    }
}

// Handle campaign form submission
async function handleCampaignSubmit(event) {
    event.preventDefault();
    
    console.log('🔍 Campaign form submission attempt detected');
    console.log('📊 Submitter element:', event.submitter?.tagName, event.submitter?.id, event.submitter?.type);
    
    // Additional checks to prevent unwanted form submissions
    if (event.submitter && event.submitter.id === 'useAdvancedConditions') {
        console.log('🛑 Form submission prevented - triggered by advanced conditions checkbox');
        return;
    }
    
    // Check if any protected element is currently focused
    const focusedElement = document.querySelector('[data-currently-focused="true"]');
    if (focusedElement) {
        console.log('🛑 Form submission prevented - protected element is focused:', focusedElement);
        return;
    }
    
    // Check if the advanced conditions checkbox was recently interacted with
    const advancedCheckbox = document.getElementById('useAdvancedConditions');
    if (advancedCheckbox && advancedCheckbox.hasAttribute('data-recently-changed')) {
        console.log('🛑 Form submission prevented - advanced conditions recently changed');
        advancedCheckbox.removeAttribute('data-recently-changed');
        return;
    }
    
    // Check if condition UI was recently interacted with
    const conditionContainer = document.getElementById('campaignConditions');
    if (conditionContainer && conditionContainer.hasAttribute('data-recent-interaction')) {
        console.log('🛑 Form submission prevented - recent condition UI interaction detected');
        return;
    }
    
    // Check if the submitter is a button without explicit type or a condition UI button
    if (event.submitter) {
        const isInConditionUI = event.submitter.closest('.condition-builder') || 
                              event.submitter.closest('.condition-modal') ||
                              event.submitter.closest('#campaignConditions');
        
        if (isInConditionUI) {
            console.log('🛑 Form submission prevented - submitter is within condition UI');
            return;
        }
        
        // Ensure it's an actual submit button
        if (event.submitter.type !== 'submit' && !event.submitter.hasAttribute('data-submit')) {
            console.log('🛑 Form submission prevented - submitter is not a submit button');
            return;
        }
    }
    
    console.log('✅ Form submission allowed - proceeding with campaign creation');
    console.log('📝 Processing campaign form submission...');
    
    const form = document.getElementById('createCampaignForm');
    const formData = new FormData(form);
    
    const campaignData = buildCampaignData(formData);

    // Validate campaign data
    const validationErrors = validateCampaignData(campaignData);
    if (validationErrors.length > 0) {
        showCampaignNotification('Validation errors: ' + validationErrors.join(', '), 'error');
        return;
    }

    try {
        const result = await dataService.createCampaign(campaignData);
        if (result) {
            console.log('Campaign created successfully');
            closeCampaignModal();
            await loadCampaignsData(); // Reload campaigns
            showCampaignNotification('Campaign created successfully!', 'success');
        }
    } catch (error) {
        console.error('Error creating campaign:', error);
        showCampaignNotification('Error creating campaign: ' + error.message, 'error');
    }
}

// Toggle campaign active status
async function toggleCampaign(campaignId) {
    try {
        const campaign = campaigns.find(c => c.id === campaignId);
        if (!campaign) return;

        const newStatus = !campaign.isActive;
        await dataService.updateCampaign(campaignId, { 
            isActive: newStatus,
            status: newStatus ? 'active' : 'inactive'
        });
        
        console.log('Campaign ' + (newStatus ? 'activated' : 'deactivated'));
        await loadCampaignsData(); // Reload campaigns
        showCampaignNotification('Campaign ' + (newStatus ? 'activated' : 'deactivated') + ' successfully!', 'success');
    } catch (error) {
        console.error('Error toggling campaign:', error);
        showCampaignNotification('Error updating campaign: ' + error.message, 'error');
    }
}

// Delete campaign with confirmation
function deleteCampaignConfirm(campaignId) {
    if (confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) {
        deleteCampaign(campaignId);
    }
}

// Delete campaign
async function deleteCampaign(campaignId) {
    try {
        await dataService.deleteCampaign(campaignId);
        console.log('Campaign deleted successfully');
        await loadCampaignsData(); // Reload campaigns
        showCampaignNotification('Campaign deleted successfully!', 'success');
    } catch (error) {
        console.error('Error deleting campaign:', error);
        showCampaignNotification('Error deleting campaign: ' + error.message, 'error');
    }
}

// Edit campaign (placeholder for future implementation)
function editCampaign(campaignId) {
    console.log('Edit campaign:', campaignId);
    showCampaignNotification('Campaign editing feature coming soon!', 'info');
}

// Show notification for campaigns
function showCampaignNotification(message, type) {
    // Try to use existing notification system first
    if (window.dashboardFunctions && window.dashboardFunctions.showNotification) {
        window.dashboardFunctions.showNotification(message, type);
        return;
    }
    
    // Fallback to simple alert
    alert(message);
}

// Enhanced campaign eligibility checking
function checkCampaignEligibility(campaign, customer, orderHistory, currentOrder = null) {
    if (!conditionEngine) {
        console.warn('Condition engine not available, using legacy check');
        return checkLegacyCampaignEligibility(campaign, customer, orderHistory, currentOrder);
    }
    
    return conditionEngine.isEligibleForCampaign(campaign, customer, orderHistory, currentOrder);
}

// Legacy eligibility check for backward compatibility
function checkLegacyCampaignEligibility(campaign, customer, orderHistory, currentOrder) {
    switch (campaign.type) {
        case 'first-order':
            return orderHistory.filter(o => o.customerId === customer.id && o.status === 'delivered').length === 0;
        case 'new-customer':
            const registrationDate = new Date(customer.registeredAt);
            const daysSinceRegistration = (Date.now() - registrationDate.getTime()) / (1000 * 60 * 60 * 24);
            return daysSinceRegistration <= (campaign.newCustomerDays || 7);
        case 'restaurant-first':
            const targetRestaurants = campaign.targetRestaurants || [];
            const customerOrders = orderHistory.filter(o => o.customerId === customer.id && o.status === 'delivered');
            return targetRestaurants.some(restaurantId => 
                !customerOrders.some(order => order.restaurantId === restaurantId)
            );
        default:
            return true;
    }
}

// Enhanced campaign data processing
function buildCampaignData(formData) {
    const baseData = {
        title: formData.get('campaignTitle'),
        code: formData.get('campaignCode'),
        type: formData.get('campaignType'),
        description: formData.get('campaignDescription'),
        discountType: formData.get('campaignDiscountType'),
        discountValue: Number(formData.get('campaignDiscountValue')),
        minOrderValue: Number(formData.get('campaignMinOrder')) || 0,
        usageLimit: Number(formData.get('campaignUsageLimit')) || 0,
        startDate: formData.get('campaignStartDate'),
        endDate: formData.get('campaignEndDate'),
        autoActivate: formData.has('campaignAutoActivate'),
        singleUse: formData.has('campaignSingleUse'),
        stackable: formData.has('campaignStackable'),
        targetRestaurants: Array.from(formData.getAll('targetRestaurants')),
        targetSegments: Array.from(formData.getAll('customerSegment')),
        occasions: Array.from(formData.getAll('occasionType')),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: formData.has('campaignAutoActivate'),
        status: formData.has('campaignAutoActivate') ? 'active' : 'draft',
        usage: 0
    };

    // Enhanced Targeting Data Collection
    if (window.enhancedTargeting) {
        const targetingData = window.enhancedTargeting.collectTargetingData();
        
        // Add enhanced targeting data to campaign
        baseData.targetingData = targetingData;
        
        // Update legacy fields for backward compatibility
        if (targetingData.restaurantTargeting?.enabled) {
            switch (targetingData.restaurantTargeting.mode) {
                case 'specific':
                    baseData.targetRestaurants = targetingData.restaurantTargeting.restaurants || [];
                    break;
                case 'category':
                    baseData.targetCategories = targetingData.restaurantTargeting.categories || [];
                    break;
            }
        }
        
        if (targetingData.customerSegments?.enabled) {
            baseData.customerSegmentCriteria = targetingData.customerSegments.criteria || [];
            baseData.customerSegmentLogic = targetingData.customerSegments.logic || 'OR';
        }
        
        if (targetingData.occasionTargeting?.enabled) {
            baseData.occasions = targetingData.occasionTargeting.occasions || [];
            baseData.timeConstraints = targetingData.occasionTargeting.timeConstraints || [];
            baseData.recurringSchedules = targetingData.occasionTargeting.recurringSchedules || [];
        }
    }

    // Add sophisticated conditions if condition UI is available
    if (conditionUI) {
        const conditionData = conditionUI.getConditions();
        if (conditionData && conditionData.conditions.length > 0) {
            baseData.conditions = conditionData.conditions;
            baseData.conditionLogic = conditionData.logic;
            baseData.usesAdvancedConditions = true;
        }
    }

    return baseData;
}

// Enhanced campaign data validation
function validateCampaignData(campaignData) {
    const errors = [];
    
    if (!campaignData.title || campaignData.title.trim().length === 0) {
        errors.push('Campaign title is required');
    }
    
    if (!campaignData.code || campaignData.code.trim().length === 0) {
        errors.push('Campaign code is required');
    }
    
    if (!campaignData.type || campaignData.type.trim().length === 0) {
        errors.push('Campaign type is required');
    }
    
    if (!campaignData.discountType || campaignData.discountType.trim().length === 0) {
        errors.push('Discount type is required');
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

    // Enhanced Targeting Validation
    if (campaignData.targetingData && window.CampaignTargetingValidator) {
        try {
            const validator = new window.CampaignTargetingValidator();
            const targetingValidation = validator.validateTargetingConfiguration(campaignData.targetingData);
            
            if (!targetingValidation.isValid) {
                errors.push(...targetingValidation.errors);
            }
            
            // Log warnings if any
            if (targetingValidation.warnings && targetingValidation.warnings.length > 0) {
                console.warn('Campaign targeting warnings:', targetingValidation.warnings);
            }
        } catch (validationError) {
            errors.push('Targeting validation failed: ' + validationError.message);
        }
    }
    
    // Validate condition parameters if using advanced conditions
    if (campaignData.conditions && conditionEngine) {
        campaignData.conditions.forEach((rule, index) => {
            try {
                const validationErrors = conditionEngine.validateConditionParameters(
                    rule.conditionId, 
                    rule.params || {}
                );
                validationErrors.forEach(error => 
                    errors.push(`Condition ${index + 1}: ${error}`)
                );
            } catch (error) {
                errors.push(`Condition ${index + 1}: Invalid condition ID '${rule.conditionId}'`);
            }
        });
    }
    
    return errors;
}

// Get available campaign condition definitions for UI
function getAvailableConditions() {
    if (!conditionEngine) {
        return [];
    }
    return conditionEngine.getAvailableConditions();
}

// Test campaign conditions with sample data
function testCampaignConditions(campaignData, sampleCustomer, sampleOrderHistory) {
    if (!conditionEngine || !campaignData.conditions) {
        return { eligible: true, reason: 'No conditions to test' };
    }
    
    try {
        const isEligible = conditionEngine.isEligibleForCampaign(
            campaignData, 
            sampleCustomer, 
            sampleOrderHistory
        );
        
        return {
            eligible: isEligible,
            reason: isEligible ? 'Customer meets all conditions' : 'Customer does not meet campaign conditions'
        };
    } catch (error) {
        return {
            eligible: false,
            reason: `Error testing conditions: ${error.message}`
        };
    }
}

// Enhanced campaign target formatting with condition awareness
function formatCampaignTargetEnhanced(campaign) {
    if (campaign.usesAdvancedConditions && campaign.conditions && campaign.conditions.length > 0) {
        const conditionCount = campaign.conditions.length;
        const logic = campaign.conditionLogic || 'AND';
        return `${conditionCount} condition${conditionCount > 1 ? 's' : ''} (${logic})`;
    }
    
    // Check for enhanced targeting data
    if (campaign.enhancedTargeting) {
        const targeting = campaign.enhancedTargeting;
        const targetingParts = [];
        
        // Customer segments
        if (targeting.customerSegments && targeting.customerSegments.enabled) {
            const segments = targeting.customerSegments;
            if (segments.predefinedSegments && segments.predefinedSegments.length > 0) {
                targetingParts.push(`${segments.predefinedSegments.length} segment(s)`);
            }
            if (segments.customCriteria && segments.customCriteria.length > 0) {
                targetingParts.push(`${segments.customCriteria.length} custom criteria`);
            }
        }
        
        // Restaurant targeting
        if (targeting.restaurantTargeting && targeting.restaurantTargeting.enabled) {
            const restaurants = targeting.restaurantTargeting;
            switch (restaurants.mode) {
                case 'specific':
                    if (restaurants.specificRestaurants && restaurants.specificRestaurants.length > 0) {
                        targetingParts.push(`${restaurants.specificRestaurants.length} restaurant(s)`);
                    }
                    break;
                case 'category':
                    if (restaurants.categories && restaurants.categories.length > 0) {
                        targetingParts.push(`${restaurants.categories.length} category/ies`);
                    }
                    break;
                case 'location':
                    if (restaurants.locations && restaurants.locations.length > 0) {
                        targetingParts.push(`${restaurants.locations.length} location(s)`);
                    }
                    break;
                case 'rating':
                    targetingParts.push('Rating-based');
                    break;
            }
        }
        
        // Occasions
        if (targeting.occasions && targeting.occasions.enabled) {
            const occasions = targeting.occasions;
            const occasionCount = (occasions.specialEvents || []).length + 
                                (occasions.recurringSchedules || []).length + 
                                (occasions.religiousOccasions || []).length;
            if (occasionCount > 0) {
                targetingParts.push(`${occasionCount} occasion(s)`);
            }
        }
        
        return targetingParts.length > 0 ? targetingParts.join(', ') : 'Enhanced targeting';
    }
    
    // Fallback to legacy formatting
    return formatCampaignTarget(campaign);
}

// Export campaign conditions for external use
function exportCampaignConditions(campaignId) {
    const campaign = campaigns.find(c => c.id === campaignId);
    if (!campaign || !campaign.conditions) {
        return null;
    }
    
    return {
        campaignId: campaignId,
        campaignTitle: campaign.title,
        conditions: campaign.conditions,
        logic: campaign.conditionLogic || 'AND',
        exportedAt: new Date().toISOString()
    };
}

// Import campaign conditions from external source
function importCampaignConditions(conditionData) {
    if (!conditionEngine || !conditionUI) {
        throw new Error('Condition engine or UI not available');
    }
    
    // Validate imported data
    if (!conditionData.conditions || !Array.isArray(conditionData.conditions)) {
        throw new Error('Invalid condition data format');
    }
    
    // Set conditions in UI
    conditionUI.setConditions({
        logic: conditionData.logic || 'AND',
        conditions: conditionData.conditions
    });
    
    return true;
}

// Generate campaign condition summary for display
function generateConditionSummary(campaign) {
    if (!campaign.conditions || campaign.conditions.length === 0) {
        return 'No specific targeting conditions';
    }
    
    const conditionNames = campaign.conditions.map(rule => {
        if (!conditionEngine) return rule.conditionId;
        
        const condition = conditionEngine.getAvailableConditions()
            .find(c => c.id === rule.conditionId);
        return condition ? condition.name : rule.conditionId;
    });
    
    const logic = campaign.conditionLogic || 'AND';
    const connector = logic === 'AND' ? ' and ' : ' or ';
    
    return conditionNames.join(connector);
}

// Initialize campaign functionality when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Add event listeners for campaign form
    const campaignForm = document.getElementById('createCampaignForm');
    if (campaignForm) {
        campaignForm.addEventListener('submit', handleCampaignSubmit);
        
        // Add additional protection against unwanted form submissions
        campaignForm.addEventListener('submit', function(e) {
            // Check if any checkbox with data-no-submit attribute is being interacted with
            const activeElement = document.activeElement;
            if (activeElement && activeElement.hasAttribute('data-no-submit')) {
                console.log('🛑 Form submission blocked - interaction with protected element');
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }, true); // Use capture phase to catch it early
        
        console.log('✅ Campaign form submit handler attached to createCampaignForm');
    } else {
        console.warn('⚠️ Campaign form (createCampaignForm) not found');
    }

    const campaignTypeSelect = document.getElementById('campaignType');
    if (campaignTypeSelect) {
        campaignTypeSelect.addEventListener('change', updateCampaignFormFields);
        console.log('✅ Campaign type change handler attached');
    }

    // Add close modal button listener
    const closeCampaignBtn = document.getElementById('closeCampaignModalBtn');
    if (closeCampaignBtn) {
        closeCampaignBtn.addEventListener('click', closeCampaignModal);
        console.log('✅ Campaign modal close handler attached');
    }

    // Load campaigns data if data service is available
    if (window.dataService) {
        loadCampaignsData();
    } else {
        // Wait for data service to load
        const checkDataService = setInterval(() => {
            if (window.dataService) {
                clearInterval(checkDataService);
                loadCampaignsData();
            }
        }, 500);
    }

    // Initialize condition engine
    initializeConditionEngine();
});
