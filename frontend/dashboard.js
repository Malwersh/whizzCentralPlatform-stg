// dashboard.js - Dashboard JavaScript functionality

// Global variables for charts and real-time updates
let lastUpdateTime = new Date();

// Authentication check function
function checkDashboardAuthentication() {
    console.log('🔐 Checking authentication for dashboard access...');

    if (window.Auth && window.Auth.requireAuthentication) {
        // Check authentication before initializing dashboard
        try {
            const authResult = window.Auth.requireAuthentication();
            console.log('🔍 Authentication result:', authResult);

            if (!authResult) {
                console.warn('❌ Authentication check failed, redirecting to login');
                // The Auth.requireAuthentication() function will handle the redirect
                // No need to do anything else here
                return;
            } else {
                console.log('✅ Authentication check passed, initializing dashboard');
                initializeDashboard();
            }
        } catch (error) {
            console.error('❌ Authentication check error:', error);
            console.log('🔄 Attempting to continue with limited functionality...');
            initializeDashboard();
        }
    } else {
        console.warn('⚠️ Auth utilities not loaded, continuing with limited security');
        initializeDashboard();
    }
}

// Wait for auth utilities to load, then check authentication
if (window.Auth) {
    checkDashboardAuthentication();
} else {
    // Wait a bit for auth-utils.js to load
    setTimeout(checkDashboardAuthentication, 200);
}

// DOM Elements (will be populated after navigation is ready)
let sidebar, mainContent, menuToggle, sidebarToggle;

// Wait for navigation to be ready
document.addEventListener('navigation:ready', (event) => {
    console.log('🧭 Dashboard: Navigation ready, initializing dashboard features...');
    initializeDashboardFeatures();
});

// Fallback initialization if navigation event doesn't fire
setTimeout(() => {
    if (!window.navigationManager?.isReady()) {
        console.log('⏰ Dashboard: Navigation timeout, initializing anyway...');
        initializeDashboardFeatures();
    }
}, 1000);

function initializeDashboardFeatures() {
    // Get DOM references
    sidebar = document.getElementById('sidebar');
    mainContent = document.getElementById('mainContent');
    menuToggle = document.getElementById('menuToggle');
    sidebarToggle = document.getElementById('sidebarToggle');

    // Initialize dashboard-specific functionality
    initializeDashboard();

    // Load dashboard data
    loadDashboardStats();
}

async function loadDashboardStats() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔢 loadDashboardStats() FUNCTION CALLED');
    console.log('🔢 Timestamp:', new Date().toISOString());
    console.log('🔢 window.dataService exists:', !!window.dataService);
    console.log('🔢 AWS object exists:', !!window.AWS);
    console.log('═══════════════════════════════════════════════════');

    try {
        // Initialize AWS data service first
        if (!window.dataService) {
            console.error('❌ CRITICAL: window.dataService is NOT available!');
            throw new Error('dataService not available');
        }
        
        console.log('✅ dataService found, calling initialize()...');

        await window.dataService.initialize();
        console.log('✅ AWS dataService initialized');

        const stats = {
            customersCount: 0,
            merchantsCount: 0,
            driversCount: 0,
            ordersCount: 0,
            revenueCount: 0,
            ticketsCount: 0,
            promotionsCount: 0
        };

        // Define the real DynamoDB tables we'll scan
        const tables = {
            customers: 'WizzUser_users_dev',
            merchants: 'WhizzMerchants_Businesses',
            drivers: 'WhizzDrivers_dev',
            orders: 'WizzOrders',
            transactions: 'WizzUser_transactions_dev',
            promotions: 'WhizzMerchants_Discounts'
        };

        console.log('📊 Scanning DynamoDB tables for real data...');

        // 1. Get REAL customers count
        try {
            const customersResult = await window.dataService.scan(tables.customers, { Select: 'COUNT' });
            stats.customersCount = customersResult?.Count || 0;
            console.log(`✅ Customers: ${stats.customersCount} (from ${tables.customers})`);
        } catch (error) {
            console.warn(`⚠️ Failed to get customers:`, error.message);
        }

        // 2. Get REAL merchants count
        try {
            const merchantsResult = await window.dataService.scan(tables.merchants, { Select: 'COUNT' });
            stats.merchantsCount = merchantsResult?.Count || 0;
            console.log(`✅ Merchants: ${stats.merchantsCount} (from ${tables.merchants})`);
        } catch (error) {
            console.warn(`⚠️ Failed to get merchants:`, error.message);
        }

        // 3. Get REAL drivers count
        try {
            const driversResult = await window.dataService.scan(tables.drivers, { Select: 'COUNT' });
            stats.driversCount = driversResult?.Count || 0;
            console.log(`✅ Drivers: ${stats.driversCount} (from ${tables.drivers})`);
        } catch (error) {
            console.warn(`⚠️ Failed to get drivers:`, error.message);
        }

        // 4. Get REAL orders from WizzOrders table
        try {
            const ordersResult = await window.dataService.scan(tables.orders, { 
                Limit: 100,
                FilterExpression: 'begins_with(PK, :prefix)',
                ExpressionAttributeValues: { ':prefix': 'ORDER#' }
            });
            
            const orders = ordersResult?.Items || [];
            console.log(`✅ Found ${orders.length} orders in WizzOrders table`);

            // Filter orders from today
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const ordersToday = orders.filter(order => {
                if (!order.orderDate && !order.createdAt && !order.timestamp) return false;
                
                const dateStr = order.orderDate || order.createdAt || order.timestamp;
                const orderDate = new Date(dateStr);
                return orderDate >= today;
            });

            stats.ordersCount = ordersToday.length;
            console.log(`✅ Orders Today: ${stats.ordersCount}`);

            // Calculate revenue from today's orders
            ordersToday.forEach(order => {
                const totalField = order.total || order.totalAmount || order.amount || '0';
                const numericValue = parseFloat(totalField.toString().replace(/[^0-9.]/g, ''));
                if (!isNaN(numericValue)) {
                    stats.revenueCount += numericValue;
                }
            });
            console.log(`✅ Revenue Today: $${stats.revenueCount.toFixed(2)}`);

        } catch (error) {
            console.warn(`⚠️ Failed to get orders:`, error.message);
        }

        // 5. Get REAL promotions count
        try {
            const promotionsResult = await window.dataService.scan(tables.promotions, { 
                FilterExpression: 'attribute_exists(isActive) AND isActive = :active',
                ExpressionAttributeValues: { ':active': true }
            });
            stats.promotionsCount = promotionsResult?.Items?.length || 0;
            console.log(`✅ Active Promotions: ${stats.promotionsCount} (from ${tables.promotions})`);
        } catch (error) {
            console.warn(`⚠️ Failed to get promotions:`, error.message);
        }

        // 6. Support tickets - would need a real tickets table
        stats.ticketsCount = 0;

        // Update UI with real data
        updateDashboardUI(stats);
        showDashboardDataSourceIndicator('real');
        console.log('✅ Dashboard stats loaded from REAL AWS data:', stats);
        
        return;

    } catch (error) {
        console.error('❌ Failed to load real AWS data:', error.message);
        console.log('📋 Setting all stats to 0 as fallback');
        
        // Set all values to 0 as fallback
        const stats = {
            customersCount: 0,
            merchantsCount: 0,
            driversCount: 0,
            ordersCount: 0,
            revenueCount: 0,
            ticketsCount: 0,
            promotionsCount: 0
        };
        
        updateDashboardUI(stats);
        showDashboardDataSourceIndicator('failed');
        console.error('❌ All data sources failed, showing zeros');
    }
}

// Calculate dashboard statistics from API data
function calculateDashboardStatistics(ordersData, campaignsData, merchantDiscountsData) {
    const stats = {
        customersCount: 0,
        merchantsCount: 0,
        driversCount: 0,
        ordersCount: 0,
        revenueCount: 0,
        ticketsCount: 0,
        promotionsCount: 0
    };

    // Calculate from orders data
    if (ordersData && Array.isArray(ordersData)) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Count orders today
        const ordersToday = ordersData.filter(order => {
            if (!order.orderDate) return false;
            const orderDate = new Date(order.orderDate);
            return orderDate >= today;
        });

        stats.ordersCount = ordersToday.length;

        // Calculate revenue today from orders
        ordersToday.forEach(order => {
            // Extract numeric value from total (e.g., "$20,010.00" or "20,010.00 IQD")
            if (order.total) {
                const numericValue = parseFloat(order.total.replace(/[^0-9.]/g, ''));
                if (!isNaN(numericValue)) {
                    stats.revenueCount += numericValue;
                }
            }
        });

        // Extract unique customers and merchants from all orders
        const uniqueCustomers = new Set();
        const uniqueMerchants = new Set();
        const uniqueDrivers = new Set();

        ordersData.forEach(order => {
            if (order.customerId) uniqueCustomers.add(order.customerId);
            if (order.merchantId) uniqueMerchants.add(order.merchantId);
            if (order.driverId) uniqueDrivers.add(order.driverId);
        });

        stats.customersCount = uniqueCustomers.size;
        stats.merchantsCount = uniqueMerchants.size;
        stats.driversCount = uniqueDrivers.size;
    }

    // Calculate active promotions from campaigns and merchant discounts
    let activePromotions = 0;

    if (campaignsData && Array.isArray(campaignsData)) {
        const activeCampaigns = campaignsData.filter(campaign => {
            if (campaign.status === 'active') {
                const now = new Date();
                const startDate = campaign.startDate ? new Date(campaign.startDate) : null;
                const endDate = campaign.endDate ? new Date(campaign.endDate) : null;
                const withinDateRange = (!startDate || now >= startDate) && (!endDate || now <= endDate);
                return withinDateRange;
            }
            return false;
        });
        activePromotions += activeCampaigns.length;
    }

    if (merchantDiscountsData && Array.isArray(merchantDiscountsData)) {
        const activeDiscounts = merchantDiscountsData.filter(discount => {
            if (discount.status === 'active') {
                const now = new Date();
                const validUntil = discount.validUntil ? new Date(discount.validUntil) : null;
                return !validUntil || now <= validUntil;
            }
            return false;
        });
        activePromotions += activeDiscounts.length;
    }

    stats.promotionsCount = activePromotions;

    // Support tickets would need a separate API - set to 0 for now
    stats.ticketsCount = 0;

    return stats;
}

// Update dashboard UI with calculated statistics
function updateDashboardUI(stats) {
    console.log('🎨 Updating dashboard UI with stats:', stats);

    // Update customers count
    const customersEl = document.getElementById('customersCount');
    if (customersEl) {
        customersEl.textContent = stats.customersCount.toLocaleString();
    }

    // Update merchants count
    const merchantsEl = document.getElementById('merchantsCount');
    if (merchantsEl) {
        merchantsEl.textContent = stats.merchantsCount.toLocaleString();
    }

    // Update drivers count
    const driversEl = document.getElementById('driversCount');
    if (driversEl) {
        driversEl.textContent = stats.driversCount.toLocaleString();
    }

    // Update orders count
    const ordersEl = document.getElementById('ordersCount');
    if (ordersEl) {
        ordersEl.textContent = stats.ordersCount.toLocaleString();
    }

    // Update revenue count
    const revenueEl = document.getElementById('revenueCount');
    if (revenueEl) {
        revenueEl.textContent = `$${stats.revenueCount.toLocaleString('en-US', { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
        })}`;
    }

    // Update tickets count
    const ticketsEl = document.getElementById('ticketsCount');
    if (ticketsEl) {
        ticketsEl.textContent = stats.ticketsCount.toLocaleString();
    }

    // Update promotions count
    const promotionsEl = document.getElementById('promotionsCount');
    if (promotionsEl) {
        promotionsEl.textContent = stats.promotionsCount.toLocaleString();
    }

    console.log('✅ Dashboard UI updated successfully');
}

// Show data source indicator to inform users about the data source
function showDashboardDataSourceIndicator(sourceType) {
    const indicator = document.getElementById('dataSourceIndicator');
    const icon = document.getElementById('dataSourceIcon');
    const text = document.getElementById('dataSourceText');
    const details = document.getElementById('dataSourceDetails');
    
    if (!indicator || !icon || !text || !details) {
        console.warn('Data source indicator elements not found');
        return;
    }
    
    // Remove all existing classes
    indicator.className = 'data-source-indicator';
    
    switch (sourceType) {
        case 'real':
            indicator.classList.add('real');
            icon.className = 'indicator-icon fas fa-check-circle';
            text.textContent = 'Live Data';
            details.textContent = 'Displaying real-time data from AWS DynamoDB';
            break;
            
        case 'demo':
            indicator.classList.add('demo');
            icon.className = 'indicator-icon fas fa-exclamation-triangle';
            text.textContent = 'Demo Data';
            details.textContent = 'AWS credentials unavailable. Showing realistic demo data including 3 customers.';
            break;
            
        case 'failed':
            indicator.classList.add('failed');
            icon.className = 'indicator-icon fas fa-times-circle';
            text.textContent = 'Data Unavailable';
            details.textContent = 'Both AWS and demo endpoints failed. Showing zero values.';
            break;
            
        default:
            indicator.style.display = 'none';
            return;
    }
    
    indicator.style.display = 'flex';
    console.log(`📊 Data source indicator updated: ${sourceType}`);
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    console.log('📄 DOM Content Loaded - Starting dashboard initialization...');

    // Get DOM elements
    sidebar = document.getElementById('sidebar');
    mainContent = document.getElementById('mainContent');
    menuToggle = document.getElementById('menuToggle');
    sidebarToggle = document.getElementById('sidebarToggle');

    // Verify essential elements exist
    if (!sidebar || !mainContent) {
        console.error('Essential dashboard elements not found:', {
            sidebar: !!sidebar,
            mainContent: !!mainContent
        });
        return;
    }

    initializeDashboard();
    updateTime();
    setInterval(updateTime, 60000); // Update every minute

    // Show success message
    showWelcomeMessage();

    // Load statistics using data service
    if (window.dataService) {
        // Initialize data service first
        window.dataService.initialize()
            .then(() => {
                return loadDashboardStats();
            })
            .catch(error => {
                console.error('Data service initialization failed:', error);
                // Show fallback data
                showFallbackStats();
            });
    } else {
        console.warn('Data service not available, loading fallback stats');
        showFallbackStats();
    }

    // Initialize dashboard-specific functionality
    initializeDashboard();

    // Load dashboard data
    loadDashboardStats();
});

// Show welcome message
function showWelcomeMessage() {
    const userEmail = localStorage.getItem('userEmail');
}

// Show fallback statistics when data service is unavailable
function showFallbackStats() {
    const customersCountEl = document.getElementById('customersCount');
    const merchantsCountEl = document.getElementById('merchantsCount');

    // Show zero values when unable to connect
    if (customersCountEl) customersCountEl.textContent = '0';
    if (merchantsCountEl) merchantsCountEl.textContent = '0';
}

// Initialize dashboard functionality
function initializeDashboard() {
    console.log('🔧 initializeDashboard() called');
    
    // Load dashboard statistics FIRST (most important!)
    loadDashboardStats();
    
    // Handle window resize
    window.addEventListener('resize', handleResize);

    // Initialize tooltips and other interactive elements
    initializeInteractiveElements();

    // Basic periodic refresh (every 5 minutes) without charts or activity feed
    if (!window.__dashboardRefreshInterval) {
        window.__dashboardRefreshInterval = setInterval(() => {
            console.log('⏱ Periodic stats refresh');
            loadDashboardStats();
        }, 300000); // 5 min
    }
}

// Handle window resize for dashboard-specific responsive behavior
function handleResize() {
    // Dashboard-specific resize handling
    updateChartsOnResize();
}

// Update charts on resize (placeholder for future chart implementations)
function updateChartsOnResize() {
    // Charts removed; keeping placeholder for future extension
    // console.log('Dashboard: resize event');
}

// Update time display
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        hour12: true,
        hour: 'numeric',
        minute: '2-digit'
    });

    // Update any time displays if they exist
    const timeElements = document.querySelectorAll('.current-time');
    timeElements.forEach(element => {
        element.textContent = timeString;
    });
}

// Initialize interactive elements
function initializeInteractiveElements() {
    // Add hover effects to cards
    const cards = document.querySelectorAll('.stat-card, .dashboard-card');
    cards.forEach(card => {
        card.addEventListener('mouseenter', function () {
            this.style.transform = 'translateY(-2px)';
        });

        card.addEventListener('mouseleave', function () {
            this.style.transform = 'translateY(0)';
        });
    });

    // Add click handlers for navigation
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            // Remove active class from all nav items
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });

            // Add active class to clicked item
            this.parentElement.classList.add('active');
        });
    });
}

// Cleanup function for when leaving the dashboard
function cleanup() {
    if (window.__dashboardRefreshInterval) {
        clearInterval(window.__dashboardRefreshInterval);
        window.__dashboardRefreshInterval = null;
        console.log('🧹 Cleared periodic stats refresh interval');
    }
}

// Clean up when page is unloaded
window.addEventListener('beforeunload', cleanup);
window.addEventListener('pagehide', cleanup);

// Show notification function
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg transition-all duration-300 transform translate-x-full`;
    
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    notification.classList.add(bgColor, 'text-white');
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.classList.remove('translate-x-full');
    }, 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.classList.add('translate-x-full');
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Export functions for use in other scripts
window.dashboardFunctions = {
    showNotification,
    logout: window.logout
};
