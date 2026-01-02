// Emergency Fix Detection and Data Loading
(function checkEmergencyFix() {
    console.log('🔍 Checking for emergency fix...');
    
    if (sessionStorage.getItem('emergencyFixActive') === 'true') {
        console.log('🚨 EMERGENCY FIX DETECTED - Loading sample data...');
        
        // Apply emergency fix immediately when page loads
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(applyEmergencyFixToPage, 1000); // Small delay to ensure DOM is ready
        });
        
        // Also try to apply immediately if DOM is already loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(applyEmergencyFixToPage, 1000);
            });
        } else {
            setTimeout(applyEmergencyFixToPage, 500);
        }
    }
})();

function applyEmergencyFixToPage() {
    console.log('🚀 Applying emergency fix to promotions page...');
    
    try {
        // Get sample data from sessionStorage
        const sampleCampaigns = JSON.parse(sessionStorage.getItem('sampleCampaigns') || '[]');
        const sampleDiscounts = JSON.parse(sessionStorage.getItem('sampleDiscounts') || '[]');
        
        console.log('📊 Sample data loaded:', { campaigns: sampleCampaigns.length, discounts: sampleDiscounts.length });
        
        // Clear loading states
        const loadingElements = document.querySelectorAll('[id*="loading"], .loading');
        loadingElements.forEach(el => {
            if (el) el.style.display = 'none';
        });
        
        // Update campaigns table
        const campaignsTableBody = document.getElementById('campaignsTableBody');
        if (campaignsTableBody && sampleCampaigns.length > 0) {
            let campaignsHtml = '';
            sampleCampaigns.forEach((campaign, index) => {
                campaignsHtml += `
                    <tr>
                        <td>
                            <div><strong>${campaign.name}</strong></div>
                            <div style="font-size: 0.8rem; color: #666;">${campaign.campaignId}</div>
                        </td>
                        <td>${campaign.discountType}</td>
                        <td>${campaign.discountValue}${(campaign.discountType === 'percentage') ? '%' : '$'}</td>
                        <td><span class="badge badge-success">Active</span></td>
                        <td>${campaign.usage}/${campaign.usageLimit}</td>
                        <td>$${campaign.minimumOrderValue}</td>
                        <td>${new Date(campaign.startDate).toLocaleDateString()}</td>
                        <td>
                            <button class="btn btn-sm btn-primary me-1">Edit</button>
                            <button class="btn btn-sm btn-danger">Delete</button>
                        </td>
                    </tr>
                `;
            });
            campaignsTableBody.innerHTML = campaignsHtml;
            console.log('✅ Campaigns table populated');
        }
        
        // Update merchant discounts table
        const merchantDiscountsTableBody = document.getElementById('merchantDiscountsTableBody');
        if (merchantDiscountsTableBody && sampleDiscounts.length > 0) {
            let discountsHtml = '';
            sampleDiscounts.forEach((discount, index) => {
                discountsHtml += `
                    <tr>
                        <td>
                            <div><strong>${discount.title}</strong></div>
                            <div style="font-size: 0.8rem; color: #666;">${discount.discountId}</div>
                        </td>
                        <td>Merchant ${index + 1}</td>
                        <td>${discount.type}</td>
                        <td>${discount.value}${(discount.type === 'percentage') ? '%' : '$'}</td>
                        <td><span class="badge badge-success">Active</span></td>
                        <td>${discount.usage_count}/${discount.usage_limit}</td>
                        <td>${new Date(discount.valid_to).toLocaleDateString()}</td>
                        <td>
                            <button class="btn btn-sm btn-primary me-1">Edit</button>
                            <button class="btn btn-sm btn-danger">Delete</button>
                        </td>
                    </tr>
                `;
            });
            merchantDiscountsTableBody.innerHTML = discountsHtml;
            console.log('✅ Merchant discounts table populated');
        }
        
        // Update statistics
        const totalCampaigns = document.getElementById('totalCampaigns');
        if (totalCampaigns) totalCampaigns.textContent = sampleCampaigns.length;
        
        const activeCampaigns = document.getElementById('activeCampaigns');
        if (activeCampaigns) {
            const activeCount = sampleCampaigns.filter(c => c.status === 'active').length;
            activeCampaigns.textContent = activeCount;
        }
        
        const totalMerchantDiscounts = document.getElementById('totalMerchantDiscounts');
        if (totalMerchantDiscounts) totalMerchantDiscounts.textContent = sampleDiscounts.length;
        
        const activeMerchantDiscounts = document.getElementById('activeMerchantDiscounts');
        if (activeMerchantDiscounts) {
            const activeDiscountsCount = sampleDiscounts.filter(d => d.status === 'active').length;
            activeMerchantDiscounts.textContent = activeDiscountsCount;
        }
        
        // Clear any loading text
        const loadingTexts = document.querySelectorAll('*');
        loadingTexts.forEach(el => {
            if (el.textContent && el.textContent.includes('Loading')) {
                if (el.textContent.includes('merchant discounts')) {
                    el.textContent = `Merchant Discounts (${sampleDiscounts.length})`;
                } else if (el.textContent.includes('campaigns')) {
                    el.textContent = `Campaigns (${sampleCampaigns.length})`;
                }
            }
        });
        
        // Show success notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            background: linear-gradient(135deg, #10b981, #059669);
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 13px;
            max-width: 350px;
            line-height: 1.3;
        `;
        
        notification.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">
                ✅ Emergency Fix Applied
            </div>
            <div>
                Campaigns: ${sampleCampaigns.length} | Discounts: ${sampleDiscounts.length}
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
        
        console.log('🎉 Emergency fix applied successfully to promotions page!');
        
    } catch (error) {
        console.error('❌ Emergency fix application failed:', error);
    }
}

// Promotions Management JavaScript

// Use centralized AWS utilities
const PROMOTIONS_TABLE = 'WizzPromo_promos_dev'; // Assumed table name

// Load promotions data from DynamoDB - TEMPORARILY DISABLED FOR DEBUGGING
async function loadPromotionsData() {
    const tbody = document.getElementById('promotionsTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem;">Loading promotions...</td></tr>`;
    }
    try {
        const idToken = localStorage.getItem('idToken');
        console.log('DEBUG: Debug loadPromotionsData:', window.WIZZCENTRAL_CONFIG.API_BASE_URL + '/promotions', 'Authorization:', `Bearer ${idToken}`);
        const urlLoad = `${window.WIZZCENTRAL_CONFIG.API_BASE_URL}/promotions`;
        const headersLoad = { 'Authorization': `Bearer ${idToken}` };
        const response = await fetch(urlLoad, { headers: headersLoad });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error?.message || 'Failed to load promotions');
        }
        const backendPromos = result.data.promotions || [];
        promotions = backendPromos.map(p => ({
            id: p.promotionId,
            title: p.name,
            code: p.code,
            type: p.type,
            value: p.value,
            status: p.isActive ? 'active' : (new Date() < new Date(p.startDate) ? 'scheduled' : 'expired'),
            usage: p.currentUsage || 0,
            limit: p.usageLimit || 0,
            startDate: p.startDate.split('T')[0],
            endDate: p.endDate.split('T')[0],
            description: p.description,
            minOrderValue: p.minOrderAmount || 0
        }));
    } catch (error) {
        console.error('Error loading promotions from backend:', error);
        // Display error message on UI
        const tbody = document.getElementById('promotionsTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error loading promotions: ${error.message}</td></tr>`;
        }
        return;
    }
    initializePromotionsPage();
}

// Load platform discounts data from DynamoDB
async function loadPlatformDiscountsData() {
    console.log('INFO: Loading platform discounts from DynamoDB...');
    
    try {
        // Ensure data service is available
        if (!window.dataService) {
            console.warn('WARNING: Data service not available for platform discounts');
            return;
        }
        
        // Initialize data service
        await window.dataService.initialize();
        
        // Load platform discounts
        const platformDiscounts = await window.dataService.getPlatformDiscounts();
        console.log(`SUCCESS: Loaded ${platformDiscounts.length} platform discounts`);
        
        // Convert DynamoDB format to local format
        const convertedDiscounts = platformDiscounts.map(discount => {
            // Helper function to extract value from DynamoDB format
            const extractValue = (dbValue) => {
                if (!dbValue) return null;
                if (dbValue.S) return dbValue.S;
                if (dbValue.N) return parseFloat(dbValue.N);
                if (dbValue.BOOL !== undefined) return dbValue.BOOL;
                if (dbValue.SS) return dbValue.SS;
                return dbValue;
            };

            const startDate = extractValue(discount.startDate);
            const endDate = extractValue(discount.endDate);
            const isActive = extractValue(discount.isActive);
            const now = new Date();
            const start = new Date(startDate);
            const end = new Date(endDate);

            let status = 'expired';
            if (isActive) {
                if (now < start) {
                    status = 'scheduled';
                } else if (now >= start && now <= end) {
                    status = 'active';
                } else {
                    status = 'expired';
                }
            } else {
                status = 'inactive';
            }

            return {
                id: extractValue(discount.discountId),
                title: extractValue(discount.name) || extractValue(discount.title),
                code: extractValue(discount.code),
                type: extractValue(discount.type),
                value: extractValue(discount.value),
                status: status,
                usage: extractValue(discount.currentUsage) || 0,
                limit: extractValue(discount.usageLimit) || 0,
                startDate: startDate ? startDate.split('T')[0] : '',
                endDate: endDate ? endDate.split('T')[0] : '',
                description: extractValue(discount.description),
                minOrderValue: extractValue(discount.minOrderAmount) || 0,
                source: 'platform', // Mark as platform discount
                createdAt: extractValue(discount.createdAt),
                updatedAt: extractValue(discount.updatedAt)
            };
        });

        // Update the global promotions array with platform discounts
        // Filter out any existing platform discounts and add the new ones
        promotions = promotions.filter(p => p.source !== 'platform');
        promotions = [...promotions, ...convertedDiscounts];

        console.log(`SUCCESS: Platform discounts integrated. Total promotions: ${promotions.length}`);
        
        // Render the updated promotions table
        renderPromotionsTable();
        
    } catch (error) {
        console.error('ERROR: Error loading platform discounts:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack
        });
    }
}

// Enhanced promotions loading that includes both backend and platform discounts
async function loadAllPromotionsData() {
    console.log('INFO: Loading all promotions data...');
    
    const tbody = document.getElementById('promotionsTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem;">Loading promotions...</td></tr>`;
    }

    try {
        // Load backend promotions (existing logic)
        await loadPromotionsData();
        
        // Load platform discounts from DynamoDB
        await loadPlatformDiscountsData();
        
    } catch (error) {
        console.error('ERROR: Error loading all promotions:', error);
        const tbody = document.getElementById('promotionsTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error loading promotions: ${error.message}</td></tr>`;
        }
    }
}

// Sample promotion data
let promotions = [];

// Initialize promotions page - single DOMContentLoaded listener
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Promotions page DOM loaded');
    
    const tbody = document.getElementById('promotionsTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem;">Loading promotions...</td></tr>`;
    }
    
    // Check authentication using centralized utility
    if (!Auth.requireAuthentication()) {
        return;
    }
    
    // Initialize dashboard functionality (sidebar, etc.)
    if (typeof initializeDashboard === 'function') {
        initializeDashboard();
    }
    
    try {
        // Initialize AWS using centralized utility
        await AWSUtils.initialize();
        await loadAllPromotionsData();
        setupEventListeners();
    } catch (error) {
        console.error('Failed to initialize promotions page:', error);
    }
    
    // Load merchant discounts with better error handling and retry logic
    await loadMerchantDiscountsWithRetry();
    
    // Auto-run debug after initial load attempt (for troubleshooting)
    setTimeout(() => {
        if (merchantDiscounts.length === 0) {
            console.log('DEBUG: Auto-running debug since no discounts loaded...');
            window.debugMerchantDiscounts();
        }
    }, 2000);
});

// Improved merchant discounts loading with retry logic
async function loadMerchantDiscountsWithRetry(maxRetries = 3, retryDelay = 1000) {
    console.log('INFO: Starting merchant discounts loading with retry logic...');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`INFO: Attempt ${attempt}/${maxRetries} to load merchant discounts`);
            
            // Wait for data service to be available
            if (!window.dataService) {
                console.log('⏳ Waiting for data service to be available...');
                
                // Wait up to 5 seconds for data service to load
                let waitTime = 0;
                const maxWaitTime = 5000;
                const checkInterval = 100;
                
                while (!window.dataService && waitTime < maxWaitTime) {
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    waitTime += checkInterval;
                }
                
                if (!window.dataService) {
                    throw new Error('Data service not available after waiting');
                }
            }
            
            console.log('SUCCESS: Data service is available, attempting to load merchant discounts...');
            await loadMerchantDiscounts();
            
            console.log('SUCCESS: Merchant discounts loaded successfully!');
            return; // Success, exit retry loop
            
        } catch (error) {
            console.error(`ERROR: Attempt ${attempt} failed:`, error);
            
            if (attempt === maxRetries) {
                console.error('💥 All retry attempts failed');
                showMerchantDiscountError(error);
                return;
            }
            
            console.log(`⏳ Waiting ${retryDelay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            retryDelay *= 1.5; // Exponential backoff
        }
    }
}

function initializePromotionsPage() {
    renderPromotionsTable();
    updatePromotionStats();
}

function setupEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', filterPromotions);
    }

    // Filter functionality
    const statusFilter = document.getElementById('statusFilter');
    const typeFilter = document.getElementById('typeFilter');
    
    if (statusFilter) {
        statusFilter.addEventListener('change', filterPromotions);
    }
    
    if (typeFilter) {
        typeFilter.addEventListener('change', filterPromotions);
    }

    // Add promotion form
    const addPromotionForm = document.getElementById('addPromotionForm');
    if (addPromotionForm) {
        addPromotionForm.addEventListener('submit', handleAddPromotion);
    }

    // Set default dates for new promotion
    setDefaultDates();

    // Modal close handler for Create Promotion
    document.getElementById('closeAddPromotionModalBtn').addEventListener('click', () => {
        document.getElementById('addPromotionModal').style.display = 'none';
        closeAddPromotionModal();
    });
}

function setDefaultDates() {
    const now = new Date();
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    if (startDate) {
        startDate.value = now.toISOString().slice(0, 16);
    }
    
    if (endDate) {
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        endDate.value = nextWeek.toISOString().slice(0, 16);
    }
}

function renderPromotionsTable(promotionsList = promotions) {
    const tbody = document.getElementById('promotionsTableBody');
    if (!tbody) return;

    tbody.innerHTML = promotionsList.map(promotion => `
        <tr>
            <td>
                <div class="promotion-info">
                    <div class="promotion-icon">
                        ${getPromotionIcon(promotion.type)}
                    </div>
                    <div>
                        <div class="promotion-title">${promotion.title}</div>
                        <div class="promotion-code">${promotion.code}</div>
                    </div>
                </div>
            </td>
            <td>${capitalizeFirst(promotion.type.replace('_', ' '))}</td>
            <td><span class="discount-badge">${getDiscountDisplay(promotion)}</span></td>
            <td><span class="promotion-status ${promotion.status}">${capitalizeFirst(promotion.status)}</span></td>
            <td>${promotion.usage} / ${promotion.limit}</td>
            <td>${formatDate(promotion.startDate)}</td>
            <td>${formatDate(promotion.endDate)}</td>
            <td>
                <div class="actions">
                    <button class="btn-action" onclick="viewPromotion('${promotion.id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${getActionButtons(promotion)}
                </div>
            </td>
        </tr>
    `).join('');
}

function getPromotionIcon(type) {
    const icons = {
        percentage: '<i class="fas fa-percentage"></i>',
        fixed: '<i class="fas fa-dollar-sign"></i>',
        fixed_amount: '<i class="fas fa-dollar-sign"></i>', // Handle both formats
        free_delivery: '<i class="fas fa-truck"></i>',
        bogo: '<i class="fas fa-gift"></i>'
    };
    return icons[type] || '<i class="fas fa-tags"></i>';
}

function getDiscountDisplay(promotion) {
    switch (promotion.type) {
        case 'percentage':
            return `${promotion.value}% OFF`;
        case 'fixed':
        case 'fixed_amount': // Handle both formats
            return `$${promotion.value} OFF`;
        case 'free_delivery':
            return 'Free Shipping';
        case 'bogo':
            return 'Buy 1 Get 1';
        default:
            return 'Discount';
    }
}

function getActionButtons(promotion) {
    if (promotion.status === 'expired') {
        return `
            <button class="btn-action" onclick="clonePromotion('${promotion.id}')" title="Clone">
                <i class="fas fa-copy"></i>
            </button>
            <button class="btn-action danger" onclick="deletePromotion('${promotion.id}')" title="Delete">
                <i class="fas fa-trash"></i>
            </button>
        `;
    } else if (promotion.status === 'scheduled') {
        return `
            <button class="btn-action" onclick="editPromotion('${promotion.id}')" title="Edit">
                <i class="fas fa-edit"></i>
            </button>
            <button class="btn-action" onclick="activatePromotion('${promotion.id}')" title="Activate Now">
                <i class="fas fa-play"></i>
            </button>
        `;
    } else {
        return `
            <button class="btn-action" onclick="editPromotion('${promotion.id}')" title="Edit">
                <i class="fas fa-edit"></i>
            </button>
            <button class="btn-action danger" onclick="deactivatePromotion('${promotion.id}')" title="Deactivate">
                <i class="fas fa-pause"></i>
            </button>
        `;
    }
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function filterPromotions() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const typeFilter = document.getElementById('typeFilter').value;

    let filteredPromotions = promotions.filter(promotion => {
        const matchesSearch = promotion.title.toLowerCase().includes(searchTerm) ||
                            promotion.code.toLowerCase().includes(searchTerm) ||
                            promotion.id.toLowerCase().includes(searchTerm);
        
        const matchesStatus = !statusFilter || promotion.status === statusFilter;
        const matchesType = !typeFilter || promotion.type === typeFilter;

        return matchesSearch && matchesStatus && matchesType;
    });

    renderPromotionsTable(filteredPromotions);
}

async function updatePromotionStats() {
    const activePromotions = promotions.filter(p => p.status === 'active').length;
    const totalUsage = promotions.reduce((sum, p) => sum + p.usage, 0);
    
    // Get real statistics from promotions data
    const totalPromotions = promotions.length;
    const scheduledPromotions = promotions.filter(p => p.status === 'scheduled').length;
    const expiredPromotions = promotions.filter(p => p.status === 'expired').length;
    
    // Calculate promotion usage statistics
    const promotionsWithUsage = promotions.filter(p => p.usage > 0);
    const totalUsageCount = promotions.reduce((sum, p) => sum + (p.usage || 0), 0);
    
    // Calculate discount value - estimate based on promotion data
    let totalDiscountValue = 0;
    const today = new Date().toISOString().split('T')[0];
    
    promotions.forEach(promo => {
        if (promo.status === 'active' && promo.usage > 0) {
            // Estimate daily discount value based on promotion type and usage
            let estimatedValue = 0;
            if (promo.type === 'percentage') {
                // Estimate average order value as $35 and calculate discount
                estimatedValue = (35 * (promo.value / 100)) * (promo.usage / 7); // spread usage over week
            } else if (promo.type === 'fixed_amount') {
                estimatedValue = promo.value * (promo.usage / 7);
            } else if (promo.type === 'free_delivery') {
                // Assume $8 delivery fee
                estimatedValue = 8 * (promo.usage / 7);
            }
            totalDiscountValue += Math.max(0, estimatedValue);
        }
    });
    
    // Calculate conversion rate based on active promotions vs total promotions
    const conversionRate = totalPromotions > 0 ? 
        Math.round((activePromotions / totalPromotions) * 100) : 0;
    
    // Try to get real order data to improve accuracy
    let ordersWithPromos = 0;
    try {
        // Check if orders data is available from the orders page
        if (window.ordersData && Array.isArray(window.ordersData)) {
            ordersWithPromos = window.ordersData.filter(order => 
                order.fullData && order.fullData.promoCode
            ).length;
        }
        // If no orders data, try to load some
        else {
            const API_BASE_URL = window.WIZZCENTRAL_CONFIG?.API_BASE_URL;
            if (API_BASE_URL) {
                try {
                    const response = await fetch(`${API_BASE_URL}/orders`, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (response.ok) {
                        const result = await response.json();
                        const orders = result.orders || result.data?.orders || result.Items || [];
                        ordersWithPromos = orders.filter(order => 
                            order.promoCode && order.promoCode.length > 0
                        ).length;
                    }
                } catch (error) {
                    console.log('Could not fetch orders for promotion stats:', error.message);
                }
            }
        }
    } catch (error) {
        console.log('Error calculating promotion order stats:', error.message);
    }
    
    // Update stat cards with real data (only if they exist)
    const statCards = document.querySelectorAll('.stat-card');
    if (statCards.length >= 4) {
        // Active Promotions (real data)
        const activeCount = statCards[0].querySelector('h3');
        const activeChange = statCards[0].querySelector('.stat-change');
        if (activeCount) activeCount.textContent = activePromotions.toString();
        if (activeChange) {
            const previousActive = parseInt(activeChange.dataset.previous || '0');
            const change = activePromotions - previousActive;
            activeChange.textContent = change >= 0 ? `+${change} this week` : `${change} this week`;
            activeChange.className = `stat-change ${change >= 0 ? 'positive' : 'negative'}`;
            activeChange.dataset.previous = activePromotions.toString();
        }
        
        // Orders with Promotions (real/estimated data)
        const ordersCount = statCards[1].querySelector('h3');
        const ordersChange = statCards[1].querySelector('.stat-change');
        if (ordersCount) {
            const displayCount = ordersWithPromos > 0 ? ordersWithPromos : 
                Math.max(totalUsageCount, Math.floor(activePromotions * 15)); // estimate
            ordersCount.textContent = displayCount.toLocaleString();
        }
        if (ordersChange) {
            ordersChange.textContent = ordersWithPromos > 0 ? 'Live data' : 'Estimated';
            ordersChange.className = 'stat-change positive';
        }
        
        // Discount Value Today (calculated from real data)
        const discountValue = statCards[2].querySelector('h3');
        const discountChange = statCards[2].querySelector('.stat-change');
        if (discountValue) {
            discountValue.textContent = `$${Math.round(totalDiscountValue).toLocaleString()}`;
        }
        if (discountChange) {
            discountChange.textContent = activePromotions > 0 ? 'Based on active promos' : 'No active promotions';
            discountChange.className = `stat-change ${activePromotions > 0 ? 'positive' : 'neutral'}`;
        }
        
        // Conversion Rate (real calculation)
        const conversionElement = statCards[3].querySelector('h3');
        const conversionChange = statCards[3].querySelector('.stat-change');
        if (conversionElement) {
            conversionElement.textContent = `${conversionRate}%`;
        }
        if (conversionChange) {
            conversionChange.textContent = `${scheduledPromotions} scheduled, ${expiredPromotions} expired`;
            conversionChange.className = 'stat-change neutral';
        }
    } else {
        console.log('📊 Stat cards not found on page - stats not updated in UI but available in console');
    }
    
    console.log('📊 Updated promotion stats:', {
        activePromotions,
        totalPromotions,
        ordersWithPromos,
        totalDiscountValue: Math.round(totalDiscountValue),
        conversionRate
    });
}

// Modal functions
function openAddPromotionModal() {
    const modal = document.getElementById('addPromotionModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        setDefaultDates(); // Reset dates when opening modal
    }
}

function closeAddPromotionModal() {
    // Inline form reset for Create New Promotion section
    const form = document.getElementById('addPromotionForm');
    if (form) {
        form.reset();
    }
}

async function handleAddPromotion(e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    console.log('INFO: Creating platform discount...');

    // --- Form Data Extraction and Validation ---
    const title = formData.get('title');
    const code = formData.get('code').toUpperCase();
    const type = formData.get('type');
    const description = formData.get('description');
    const startDateValue = formData.get('startDate');
    const endDateValue = formData.get('endDate');
    const valueStr = formData.get('value');
    const limitStr = formData.get('limit');
    const minOrderStr = formData.get('minOrder');

    // --- Client-Side Validation ---
    if (!title || !code || !type || !description || !startDateValue || !endDateValue || !valueStr) {
        window.dashboardFunctions?.showNotification('Please fill out all required fields.', 'error');
        return;
    }

    if (new Date(endDateValue) <= new Date(startDateValue)) {
        window.dashboardFunctions?.showNotification('End Date must be after Start Date.', 'error');
        return;
    }

    // Validate and parse numeric fields
    const value = parseFloat(valueStr);
    if (isNaN(value) || value <= 0) {
        window.dashboardFunctions?.showNotification('Discount Value must be a positive number.', 'error');
        return;
    }

    let minOrderAmount = null;
    if (minOrderStr) {
        minOrderAmount = parseFloat(minOrderStr);
        if (isNaN(minOrderAmount) || minOrderAmount < 0) {
            window.dashboardFunctions?.showNotification('Min Order Value must be a valid, non-negative number.', 'error');
            return;
        }
    }

    let usageLimit = null;
    if (limitStr) {
        usageLimit = parseInt(limitStr, 10);
        if (isNaN(usageLimit) || usageLimit <= 0) {
            window.dashboardFunctions?.showNotification('Usage Limit must be a valid, positive whole number.', 'error');
            return;
        }
    }

    const discountData = {
        name: title,
        title: title, // For backward compatibility
        description: description,
        type: type,
        code: code,
        startDate: new Date(startDateValue).toISOString(),
        endDate: new Date(endDateValue).toISOString(),
        value: value,
        isActive: true,
        customerSegments: ['all'],
        usageLimit: usageLimit,
        minOrderAmount: minOrderAmount
    };

    // --- Direct DynamoDB Save ---
    try {
        console.log('INFO: Saving platform discount to DynamoDB:', discountData);

        // Ensure data service is available
        if (!window.dataService) {
            throw new Error('Data service is not available. Please refresh the page and try again.');
        }

        // Initialize data service
        await window.dataService.initialize();

        // Create platform discount directly in DynamoDB
        const result = await window.dataService.createPlatformDiscount(discountData);

        if (result.success) {
            console.log('SUCCESS: Platform discount created successfully:', result.discountId);
            
            // Show success notification
            window.dashboardFunctions?.showNotification(`Platform discount "${title}" created successfully!`, 'success');
            
            // Close modal
            document.getElementById('addPromotionModal').style.display = 'none';
            
            // Reset form
            const form = document.getElementById('addPromotionForm');
            if (form) {
                form.reset();
            }
            
            // Refresh the promotions list to include the new platform discount
            await loadPlatformDiscountsData();
            
        } else {
            throw new Error('Failed to create platform discount');
        }

    } catch (error) {
        console.error('ERROR: Error creating platform discount:', error);
        window.dashboardFunctions?.showNotification(`Error creating discount: ${error.message}`, 'error');
    }
}

// Promotion action functions
function viewPromotion(promotionId) {
    const promotion = promotions.find(p => p.id === promotionId);
    if (promotion) {
        alert(`Promotion Details:\n\nTitle: ${promotion.title}\nCode: ${promotion.code}\nType: ${promotion.type}\nValue: ${promotion.value}\nStatus: ${promotion.status}\nUsage: ${promotion.usage}/${promotion.limit}\nStart: ${promotion.startDate}\nEnd: ${promotion.endDate}\nMin Order: $${promotion.minOrderValue}\nDescription: ${promotion.description}`);
    }
}

function editPromotion(promotionId) {
    const promotion = promotions.find(p => p.id === promotionId);
    if (promotion) {
        alert(`Edit functionality for ${promotion.title} would open here.`);
    }
}

function deactivatePromotion(promotionId) {
    const promotion = promotions.find(p => p.id === promotionId);
    if (promotion && confirm(`Deactivate promotion "${promotion.title}"?`)) {
        promotion.status = 'draft';
        renderPromotionsTable();
        updatePromotionStats();
        
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification(`${promotion.title} has been deactivated.`, 'success');
        }
    }
}

function activatePromotion(promotionId) {
    const promotion = promotions.find(p => p.id === promotionId);
    if (promotion && confirm(`Activate promotion "${promotion.title}" now?`)) {
        promotion.status = 'active';
        renderPromotionsTable();
        updatePromotionStats();
        
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification(`${promotion.title} is now active!`, 'success');
        }
    }
}

function clonePromotion(promotionId) {
    const promotion = promotions.find(p => p.id === promotionId);
    if (promotion && confirm(`Clone promotion "${promotion.title}"?`)) {
        const clonedPromotion = {
            ...promotion,
            id: 'PROMO' + String(promotions.length + 1).padStart(3, '0'),
            title: promotion.title + ' (Copy)',
            code: promotion.code + '_COPY',
            status: 'draft',
            usage: 0
        };
        
        promotions.push(clonedPromotion);
        renderPromotionsTable();
        updatePromotionStats();
        
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification(`${promotion.title} has been cloned.`, 'success');
        }
    }
}

function deletePromotion(promotionId) {
    const promotion = promotions.find(p => p.id === promotionId);
    if (promotion && confirm(`Delete promotion "${promotion.title}"? This action cannot be undone.`)) {
        const index = promotions.findIndex(p => p.id === promotionId);
        promotions.splice(index, 1);
        renderPromotionsTable();
        updatePromotionStats();
        
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification(`${promotion.title} has been deleted.`, 'error');
        }
    }
}

// Merchant Discounts Management
let merchantDiscounts = [];
let businessesData = {};

// Load merchant discounts from data service
async function loadMerchantDiscounts() {
    try {
        console.log('INFO: Starting loadMerchantDiscounts...');
        
        if (!window.dataService) {
            console.warn('ERROR: Data service not available for merchant discounts');
            throw new Error('Data service is not available. Please check if data-service.js is loaded properly.');
        }
        
        console.log('SUCCESS: Data service available, initializing...');
        await window.dataService.initialize();
        console.log('SUCCESS: Data service initialized successfully');
        
        // Load both discounts and businesses data with individual error handling
        console.log('INFO: Loading discounts and businesses data...');
        
        let discounts = [];
        let businesses = [];
        
        try {
            console.log('INFO: Loading merchant discounts from table: WhizzMerchants_Discounts');
            discounts = await window.dataService.getMerchantDiscounts(false); // Force fresh data
            console.log(`SUCCESS: Raw discounts loaded: ${discounts.length} items`);
            
            if (discounts.length > 0) {
                console.log('INFO: Sample discount:', discounts[0]);
                console.log('INFO: All discount keys:', Object.keys(discounts[0]));
            } else {
                console.warn('WARNING: No discounts found in table - this might be normal if no merchants have created discounts yet');
                // Let's also test direct table access
                console.log('DEBUG: Testing direct table access...');
                const directResult = await window.dataService.scan('WhizzMerchants_Discounts', { Limit: 5 });
                console.log('INFO: Direct scan result:', directResult);
                console.log(`INFO: Direct scan found ${directResult.Items?.length || 0} items`);
            }
        } catch (discountError) {
            console.error('ERROR: Failed to load discounts:', discountError);
            console.error('Discount error details:', {
                message: discountError.message,
                code: discountError.code,
                stack: discountError.stack
            });
            
            // Check if it's a credentials or AWS error
            if (discountError.message.includes('credentials') || discountError.message.includes('AWS')) {
                throw new Error(`AWS credentials error: ${discountError.message}. Please ensure you are properly authenticated.`);
            }
            
            // Check if it's a table not found error
            if (discountError.message.includes('ResourceNotFoundException') || discountError.message.includes('does not exist')) {
                console.warn('WARNING: Discounts table not found - continuing with empty discounts array');
            }
            
            // Continue with empty discounts array for other errors
            discounts = [];
        }
        
        try {
            console.log('INFO: Loading businesses data...');
            businesses = await window.dataService.getBusinesses(false); // Force fresh data
            console.log(`SUCCESS: Raw businesses loaded: ${businesses.length} items`);
        } catch (businessError) {
            console.error('ERROR: Failed to load businesses:', businessError);
            console.error('Business error details:', {
                message: businessError.message,
                code: businessError.code,
                stack: businessError.stack
            });
            
            // Check if it's a credentials or AWS error
            if (businessError.message.includes('credentials') || businessError.message.includes('AWS')) {
                throw new Error(`AWS credentials error: ${businessError.message}. Please ensure you are properly authenticated.`);
            }
            
            // Continue with empty businesses array for other errors
            businesses = [];
        }
        
        merchantDiscounts = discounts.map(discount => {
            // Handle DynamoDB structure - normalize the discount data
            console.log('INFO: Processing discount:', discount);
            
            // Check if this is already processed data or raw DynamoDB data
            const processedDiscount = {
                id: discount.discountId || discount.id || 'unknown-id',
                businessId: discount.businessId || 'unknown-business',
                title: discount.title || 'Untitled Discount',
                description: discount.description || '',
                type: discount.type || 'percentage',
                value: Number(discount.value) || 0,
                status: discount.status || 'active',
                usageCount: Number(discount.usage_count) || 0,
                usageLimit: discount.usage_limit ? Number(discount.usage_limit) : null,
                validFrom: discount.valid_from,
                validTo: discount.valid_to,
                createdAt: discount.created_at,
                updatedAt: discount.updated_at,
                minimumOrderAmount: Number(discount.minimum_order_amount) || 0,
                applicability: discount.applicability,
                conditionalRule: discount.conditional_rule,
                conditionalParameters: discount.conditional_parameters
            };
            
            console.log('SUCCESS: Processed discount:', processedDiscount);
            return processedDiscount;
        });
        
        // Create a lookup map for business names
        businessesData = {};
        businesses.forEach(business => {
            const id = business.businessId || business.id;
            if (id) {
                businessesData[id] = {
                    id: id,
                    name: business.businessName || business.name || `Business ${id.substring(0, 8)}`,
                    businessName: business.businessName || business.name,
                    email: business.email || business.businessEmail,
                    phone: business.phoneNumber || business.phone,
                    status: business.status || business.isActive
                };
            }
        });
        
        console.log('INFO: Final processing results:');
        console.log(`- Merchant discounts: ${merchantDiscounts.length}`);
        console.log(`- Businesses data: ${Object.keys(businessesData).length}`);
        console.log('- Sample businessesData keys:', Object.keys(businessesData).slice(0, 5));
        
        // Update stats
        updateMerchantDiscountStats();
        
        // Render table
        renderMerchantDiscountsTable();
        
        console.log('SUCCESS: loadMerchantDiscounts completed successfully');
        
    } catch (error) {
        console.error('ERROR: Critical error in loadMerchantDiscounts:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            dataServiceAvailable: !!window.dataService,
            discountsLength: merchantDiscounts.length,
            businessesDataKeys: Object.keys(businessesData)
        });
        
        // Re-throw the error so it can be caught by the retry logic
        throw error;
    }
}

// Refresh merchant discounts manually
async function refreshMerchantDiscounts() {
    console.log('Manual refresh of merchant discounts triggered');
    
    // Reset variables
    merchantDiscounts = [];
    businessesData = {};
    
    // Update table to show loading state
    const tbody = document.getElementById('merchantDiscountsTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 2rem; color: #666;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 3rem; margin-bottom: 1rem; color: #00c2e8;"></i>
                    <div>Refreshing merchant discounts...</div>
                </td>
            </tr>
        `;
    }
    
    // Reset stats
    const totalEl = document.getElementById('totalMerchantDiscounts');
    const activeEl = document.getElementById('activeMerchantDiscounts');
    if (totalEl) totalEl.textContent = '0';
    if (activeEl) activeEl.textContent = '0';
    
    // Load fresh data with retry logic
    await loadMerchantDiscountsWithRetry();
}

// Update merchant discount statistics
function updateMerchantDiscountStats() {
    const totalDiscounts = merchantDiscounts.length;
    const activeDiscounts = merchantDiscounts.filter(d => d.status === 'active').length;
    
    const totalEl = document.getElementById('totalMerchantDiscounts');
    const activeEl = document.getElementById('activeMerchantDiscounts');
    
    if (totalEl) totalEl.textContent = totalDiscounts;
    if (activeEl) activeEl.textContent = activeDiscounts;
}

// Render merchant discounts table
function renderMerchantDiscountsTable() {
    const tbody = document.getElementById('merchantDiscountsTableBody');
    if (!tbody) return;
    
    if (merchantDiscounts.length === 0) {
        // Check if we have no discounts due to an error or truly empty
        const hasError = merchantDiscounts._error || false;
        const errorMessage = hasError ? 
            'Failed to load merchant discounts. Check console for details.' :
            'No merchant discounts found. Merchants haven\'t created any discounts yet.';
        const iconClass = hasError ? 'fas fa-exclamation-triangle' : 'fas fa-tags';
        const iconColor = hasError ? '#e74c3c' : '#ccc';
        
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 2rem; color: ${hasError ? '#e74c3c' : '#666'};">
                    <i class="${iconClass}" style="font-size: 3rem; margin-bottom: 1rem; color: ${iconColor};"></i>
                    <div>${errorMessage}</div>
                    ${hasError ? `
                        <div style="font-size: 0.9rem; margin-top: 0.5rem;">
                            <button onclick="refreshMerchantDiscounts()" style="padding: 0.5rem 1rem; background: #00c2e8; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 1rem;">
                                <i class="fas fa-sync-alt"></i> Retry Loading
                            </button>
                            <button onclick="window.debugMerchantDiscounts()" style="padding: 0.5rem 1rem; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 1rem; margin-left: 0.5rem;">
                                <i class="fas fa-bug"></i> Debug in Console
                            </button>
                        </div>
                    ` : `<div style="font-size: 0.9rem; margin-top: 0.5rem;">Discounts created by merchants will appear here</div>`}
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = merchantDiscounts.map(discount => {
        console.log('🎨 Rendering discount:', discount);
        
        const merchantName = getMerchantName(discount.businessId);
        const discountValue = formatDiscountValue(discount);
        const validUntil = discount.validTo ? new Date(discount.validTo).toLocaleDateString() : 'No expiry';
        const usage = discount.usageLimit ? `${discount.usageCount} / ${discount.usageLimit}` : (discount.usageCount || 0).toString();
        
        console.log(`🎨 Rendering: ${discount.title} for ${merchantName} (${discountValue})`);
        
        return `
            <tr>
                <td>
                    <div class="promotion-info">
                        <div class="promotion-icon">
                            <i class="fas fa-tag"></i>
    alert('Contact merchant functionality would be implemented here');
}

// Debug function for merchant discounts - can be called from browser console
window.debugMerchantDiscounts = async function() {
    console.log('DEBUG: === MERCHANT DISCOUNTS DEBUG START ===');
    
    // Clear debug panel
    const debugContent = document.getElementById('debugContent');
    if (debugContent) {
        debugContent.innerHTML = '';
    }
    showDebugInfo('DEBUG: === MERCHANT DISCOUNTS DEBUG START ===');
    
    try {
        // Test 1: Check if data service exists
        console.log('STEP Checking data service availability...');
        showDebugInfo('STEP Checking data service availability...');
        if (!window.dataService) {
            console.error('ERROR: window.dataService is not available');
            showDebugInfo('ERROR: window.dataService is not available');
            return;
        }
        console.log('SUCCESS: Data service is available');
        showDebugInfo('SUCCESS: Data service is available');
        
        // Test 2: Initialize data service
        console.log('STEP Initializing data service...');
        showDebugInfo('STEP Initializing data service...');
        await window.dataService.initialize();
        console.log('SUCCESS: Data service initialized');
        showDebugInfo('SUCCESS: Data service initialized');
        
        // Test 3: Test direct scan of discounts table
        console.log('STEP Testing direct scan of discounts table...');
        showDebugInfo('STEP Testing direct scan of discounts table...');
        const scanResult = await window.dataService.scan('WhizzMerchants_Discounts', { Limit: 5 });
        console.log('SUCCESS: Direct scan result:', scanResult);
        showDebugInfo(`SUCCESS: Direct scan found ${scanResult.Items?.length || 0} raw items`);
        console.log(`Found ${scanResult.Items?.length || 0} raw items`);
        if (scanResult.Items && scanResult.Items.length > 0) {
            console.log('First raw item:', JSON.stringify(scanResult.Items[0], null, 2));
            showDebugInfo(`INFO: First item keys: ${Object.keys(scanResult.Items[0]).join(', ')}`);
            showDebugInfo(`INFO: First item businessId: ${scanResult.Items[0].businessId}`);
            showDebugInfo(`INFO: First item title: ${scanResult.Items[0].title}`);
        }
        
        // Test 4: Test getMerchantDiscounts method
        console.log('STEP Testing getMerchantDiscounts method...');
        showDebugInfo('STEP Testing getMerchantDiscounts method...');
        const discounts = await window.dataService.getMerchantDiscounts(false);
        console.log('SUCCESS: getMerchantDiscounts result:', discounts);
        showDebugInfo(`SUCCESS: getMerchantDiscounts returned ${discounts.length} items`);
        console.log(`Mapped ${discounts.length} discount items`);
        if (discounts.length > 0) {
            console.log('First mapped discount:', JSON.stringify(discounts[0], null, 2));
            showDebugInfo(`INFO: First mapped discount: ${JSON.stringify(discounts[0], null, 2)}`);
        }
        
        // Test 5: Test businesses loading
        console.log('STEP Testing businesses loading...');
        showDebugInfo('STEP Testing businesses loading...');
        const businesses = await window.dataService.getBusinesses(false);
        console.log('SUCCESS: Businesses result:', businesses);
        showDebugInfo(`SUCCESS: Found ${businesses.length} businesses`);
        console.log(`Found ${businesses.length} businesses`);
        if (businesses.length > 0) {
            console.log('First business:', JSON.stringify(businesses[0], null, 2));
            showDebugInfo(`INFO: First business: ${businesses[0].businessName || businesses[0].name || 'No name'}`);
        }
        
        // Test 6: Force reload merchant discounts
        console.log('STEP Force reloading merchant discounts...');
        showDebugInfo('STEP Force reloading merchant discounts...');
        await loadMerchantDiscounts();
        console.log('SUCCESS: Force reload completed');
        showDebugInfo(`SUCCESS: Force reload completed - Final count: ${merchantDiscounts.length}`);
        
        console.log('DEBUG: === MERCHANT DISCOUNTS DEBUG END ===');
        showDebugInfo('DEBUG: === MERCHANT DISCOUNTS DEBUG END ===');
        
    } catch (error) {
        console.error('ERROR: Debug function error:', error);
        showDebugInfo(`ERROR: Debug function error: ${error.message}`);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack
        });
    }
};

// Manual refresh function for testing
window.testMerchantDiscounts = async function() {
    console.log('🧪 Manual test of merchant discounts loading...');
    try {
        await refreshMerchantDiscounts();
        console.log('SUCCESS: Manual test completed successfully');
    } catch (error) {
        console.error('ERROR: Manual test failed:', error);
    }
};

// Show debug info in UI
function showDebugInfo(message) {
    const debugPanel = document.getElementById('debugInfo');
    const debugContent = document.getElementById('debugContent');
    if (debugPanel && debugContent) {
        debugContent.innerHTML += message + '<br>';
        debugPanel.style.display = 'block';
    }
}

// Simple AWS credentials test
window.testAWSConnection = async function() {
    console.log('DEBUG: Testing AWS connection and credentials...');
    showDebugInfo('DEBUG: Testing AWS connection and credentials...');
    try {
        if (!window.AWSUtils) {
            console.error('ERROR: AWSUtils not available');
            showDebugInfo('ERROR: AWSUtils not available');
            return;
        }
        
        console.log('🔐 Initializing AWS...');
        showDebugInfo('🔐 Initializing AWS...');
        await AWSUtils.initialize();
        console.log('SUCCESS: AWS initialized successfully');
        showDebugInfo('SUCCESS: AWS initialized successfully');
        
        const dynamoDB = await AWSUtils.getDynamoDBClient();
        console.log('SUCCESS: DynamoDB client obtained:', !!dynamoDB);
        showDebugInfo(`SUCCESS: DynamoDB client obtained: ${!!dynamoDB}`);
        
        // Try to list tables to test permissions
        console.log('INFO: Testing table access...');
        showDebugInfo('INFO: Testing table access...');
        const params = { TableName: 'WhizzMerchants_Discounts', Limit: 1 };
        const result = await dynamoDB.scan(params).promise();
        console.log('SUCCESS: Table scan successful:', result);
        showDebugInfo(`SUCCESS: Table scan successful: Found ${result.Items?.length || 0} items`);
        console.log(`Found ${result.Items?.length || 0} items in first scan`);
        
        return result;
    } catch (error) {
        console.error('ERROR: AWS connection test failed:', error);
        showDebugInfo(`ERROR: AWS connection test failed: ${error.message}`);
        return null;
    }
};

// Campaign Management Functions
let campaigns = [];
let restaurantsList = [];

// Load campaigns data
async function loadCampaignsData() {
    console.log('INFO: Loading campaigns from DynamoDB...');
    const tbody = document.getElementById('campaignsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 2rem;">Loading campaigns...</td></tr>';
    }

    try {
        campaigns = await dataService.getCampaigns();
        console.log('Campaign data loaded successfully: ' + campaigns.length + ' campaigns');
        renderCampaignsTable();
        updateCampaignStats();
    } catch (error) {
        console.error('Error loading campaigns:', error);
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Error loading campaigns: ' + error.message + '</td></tr>';
        }
    }
}

// Render campaigns table
function renderCampaignsTable() {
    const tbody = document.getElementById('campaignsTableBody');
    if (!tbody) return;

    if (campaigns.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 2rem; color: #666;">
                    <i class="fas fa-rocket" style="font-size: 3rem; margin-bottom: 1rem; color: #ccc;"></i>
                    <div>No campaigns found. Create your first campaign!</div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = campaigns.map(campaign => {
        const statusClass = campaign.isActive ? 'status-active' : 
                           campaign.status === 'scheduled' ? 'status-scheduled' : 'status-inactive';
        
        const discountDisplay = campaign.discountType === 'percentage' 
            ? campaign.discountValue + '%'
            : '$' + campaign.discountValue;

        const usageDisplay = campaign.usageLimit > 0 
            ? campaign.usage + '/' + campaign.usageLimit
            : campaign.usage.toString();

        return `
            <tr>
                <td>
                    <div style="font-weight: 500;">${campaign.title}</div>
                    <div style="font-size: 0.8rem; color: #666;">${campaign.code}</div>
                </td>
                <td>
                    <span class="campaign-type-badge campaign-type-${campaign.type}">
                        ${formatCampaignType(campaign.type)}
                    </span>
                </td>
                <td>${formatCampaignTarget(campaign)}</td>
                <td>${discountDisplay}</td>
                <td>
                    <span class="status-badge ${statusClass}">
                        ${campaign.isActive ? 'Active' : campaign.status}
                    </span>
                </td>
                <td>${usageDisplay}</td>
                <td>
                    <div style="font-size: 0.85rem;">
                        ${formatDate(campaign.startDate)} - ${formatDate(campaign.endDate)}
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button onclick="editCampaign('${campaign.id}')" class="btn-secondary btn-sm">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="toggleCampaign('${campaign.id}')" class="btn-${campaign.isActive ? 'warning' : 'success'} btn-sm">
                            <i class="fas fa-${campaign.isActive ? 'pause' : 'play'}"></i>
                        </button>
                        <button onclick="deleteCampaign('${campaign.id}')" class="btn-danger btn-sm">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Update campaign statistics
function updateCampaignStats() {
    const activeCampaigns = campaigns.filter(c => c.isActive).length;
    const totalCampaigns = campaigns.length;
    
    const activeElement = document.getElementById('activeCampaigns');
    const totalElement = document.getElementById('totalCampaigns');
    
    if (activeElement) activeElement.textContent = activeCampaigns;
    if (totalElement) totalElement.textContent = totalCampaigns;
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
                ? `${campaign.targetRestaurants.length} restaurant(s)` 
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

// Open campaign creation modal
function openCreateCampaignModal() {
    const modal = document.getElementById('createCampaignModal');
    if (modal) {
        resetCampaignForm();
        modal.style.display = 'flex';
        loadRestaurantsForSelection();
    }
}

// Create campaign with specific type
function createCampaignType(type) {
    openCreateCampaignModal();
    const typeSelect = document.getElementById('campaignType');
    if (typeSelect) {
        typeSelect.value = type;
        updateCampaignFormFields();
    }
}

// Close campaign creation modal
function closeCampaignModal() {
    const modal = document.getElementById('createCampaignModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Reset campaign form
function resetCampaignForm() {
    const form = document.getElementById('campaignForm');
    if (form) {
        form.reset();
        updateCampaignFormFields();
    }
}

// Update form fields based on campaign type
function updateCampaignFormFields() {
    const campaignType = document.getElementById('campaignType')?.value;
    
    // Hide all targeting sections first
    const restaurantSection = document.getElementById('restaurantTargeting');
    const segmentSection = document.getElementById('customerSegments');
    const occasionSection = document.getElementById('specialOccasions');
    
    if (restaurantSection) restaurantSection.style.display = 'none';
    if (segmentSection) segmentSection.style.display = 'none';
    if (occasionSection) occasionSection.style.display = 'none';
    
    // Show relevant sections based on campaign type
    switch (campaignType) {
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
        restaurantsList = businesses.filter(b => {
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
        
        console.log('Filtered ' + restaurantsList.length + ' restaurants/food businesses');
        
        const select = document.getElementById('targetRestaurants');
        if (select) {
            if (restaurantsList.length > 0) {
                // Use the correct field names from the real data structure
                select.innerHTML = restaurantsList.map(restaurant => {
                    const id = restaurant.businessId || restaurant.id;
                    const name = restaurant.businessName || restaurant.name || 'Unknown Business';
                    const type = restaurant.businessType || restaurant.category || '';
                    const displayName = name + (type ? ' (' + type + ')' : '');
                    
                    console.log('Adding restaurant option: ' + displayName + ' (ID: ' + id + ')');
                    return '<option value="' + id + '">' + displayName + '</option>';
                }).join('');
                
                console.log('Successfully populated restaurant dropdown with ' + restaurantsList.length + ' options');
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
    
    const form = document.getElementById('campaignForm');
    const formData = new FormData(form);
    
    const campaignData = {
        title: formData.get('title'),
        code: formData.get('code'),
        type: formData.get('type'),
        description: formData.get('description'),
        discountType: formData.get('discountType'),
        discountValue: formData.get('discountValue'),
        minOrderValue: formData.get('minOrderValue') || 0,
        usageLimit: formData.get('usageLimit') || 0,
        startDate: formData.get('startDate'),
        endDate: formData.get('endDate'),
        validFrom: formData.get('validFrom'),
        validTo: formData.get('validTo'),
        autoActivate: formData.has('autoActivate'),
        singleUse: formData.has('singleUse'),
        stackable: formData.has('stackable'),
        targetRestaurants: Array.from(formData.getAll('targetRestaurants')),
        targetSegments: Array.from(formData.getAll('targetSegments')),
        occasions: Array.from(formData.getAll('occasions'))
    };

    try {
        const result = await dataService.createCampaign(campaignData);
        if (result) {
            console.log('✅ Campaign created successfully');
            closeCampaignModal();
            await loadCampaignsData(); // Reload campaigns
            showNotification('Campaign created successfully!', 'success');
        }
    } catch (error) {
        console.error('Error creating campaign:', error);
        showNotification('Error creating campaign: ' + error.message, 'error');
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
        
        console.log(`✅ Campaign ${newStatus ? 'activated' : 'deactivated'}`);
        await loadCampaignsData(); // Reload campaigns
        showNotification(`Campaign ${newStatus ? 'activated' : 'deactivated'} successfully!`, 'success');
    } catch (error) {
        console.error('Error toggling campaign:', error);
        showNotification('Error updating campaign: ' + error.message, 'error');
    }
}

// Delete campaign
async function deleteCampaign(campaignId) {
    if (!confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) {
        return;
    }

    try {
        await dataService.deleteCampaign(campaignId);
        console.log('✅ Campaign deleted successfully');
        await loadCampaignsData(); // Reload campaigns
        showNotification('Campaign deleted successfully!', 'success');
    } catch (error) {
        console.error('Error deleting campaign:', error);
        showNotification('Error deleting campaign: ' + error.message, 'error');
    }
}

// Edit campaign (placeholder for future implementation)
function editCampaign(campaignId) {
    // TODO: Implement campaign editing functionality
    console.log('Edit campaign:', campaignId);
    showNotification('Campaign editing feature coming soon!', 'info');
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(notification);
    }

    // Set notification style based on type
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8'
    };
    notification.style.backgroundColor = colors[type] || colors.info;
    notification.textContent = message;
    notification.style.opacity = '1';

    // Hide notification after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
    }, 3000);
}

// Format date for display
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
}

// Initialize campaigns when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Add campaign form submit handler
    const campaignForm = document.getElementById('campaignForm');
    if (campaignForm) {
        campaignForm.addEventListener('submit', handleCampaignSubmit);
    }

    // Add campaign type change handler
    const campaignTypeSelect = document.getElementById('campaignType');
    if (campaignTypeSelect) {
        campaignTypeSelect.addEventListener('change', updateCampaignFormFields);
    }

    // Load campaigns data
    loadCampaignsData();
});
