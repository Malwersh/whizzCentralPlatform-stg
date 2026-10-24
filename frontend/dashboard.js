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
    const stats = { customersCount: null, merchantsCount: null, driversCount: null,
        ordersCount: null, revenueCount: null, ticketsCount: null, promotionsCount: null };
    const requests = [
        ['customersCount', 'WizzUser_users_staging'],
        ['merchantsCount', 'WhizzMerchants_Businesses'],
        ['driversCount', 'WhizzDrivers_staging'],
        ['ordersCount', 'WizzOrders']
    ];
    const results = await Promise.allSettled(requests.map(async ([metric, table]) => {
        const rows = await window.AWSUtils.scanAll(table);
        if (metric === 'customersCount') stats[metric] = rows.length;
        if (metric === 'merchantsCount') stats[metric] = rows.filter(row =>
            String(row.status || row.approvalStatus || '').toLowerCase() === 'approved' || row.isApproved === true || row.isActive === true).length;
        if (metric === 'driversCount') stats[metric] = rows.filter(row => row.isOnline === true).length;
        if (metric === 'ordersCount') {
            const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Baghdad'}).format(new Date());
            const orders = rows.filter(row => {
                const date = new Date(row.createdAt || row.orderDate || row.timestamp);
                return row.SK === 'META' && row.PK?.startsWith('ORDER#') && !isNaN(date) &&
                    new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Baghdad'}).format(date) === today;
            });
            stats.ordersCount = orders.length;
            // Total order value is not platform revenue; revenue stays unavailable until defined.
        }
    }));
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') console.warn(`Dashboard ${requests[i][0]} unavailable`, results[i].reason?.code || 'load failed');
    }
    for (const [id, value] of Object.entries(stats)) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value === null ? '—' : value.toLocaleString();
            element.title = value === null ? "البيانات غير متاحة أو لم تُهيّأ بعد." : '';
        }
    }
    showDashboardDataSourceIndicator(results.some(r => r.status === 'rejected') ? 'failed' : 'real');
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
        revenueEl.textContent = `$${stats.revenueCount.toLocaleString("ar-IQ", {
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
            text.textContent = "بيانات فعلية";
            details.textContent = "عرض البيانات الفعلية والمحدّثة من النظام.";
            break;
            
        case 'demo':
            indicator.classList.add('demo');
            icon.className = 'indicator-icon fas fa-exclamation-triangle';
            text.textContent = "بيانات تجريبية";
            details.textContent = 'AWS credentials unavailable. Showing realistic demo data including 3 customers.';
            break;
            
        case 'failed':
            indicator.classList.add('failed');
            icon.className = 'indicator-icon fas fa-times-circle';
            text.textContent = "البيانات غير متاحة";
            details.textContent = "تعذّر تحميل بعض البيانات. تظهر القيم غير المتاحة بالرمز —. أعد المحاولة أو سجّل الدخول مجددًا.";
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
    if (customersCountEl) customersCountEl.textContent = '—';
    if (merchantsCountEl) merchantsCountEl.textContent = '—';
}

// Initialize dashboard functionality
function initializeDashboard() {
    if (window.__dashboardInitialized) return;
    window.__dashboardInitialized = true;
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
    const timeString = now.toLocaleTimeString("ar-IQ", {
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
