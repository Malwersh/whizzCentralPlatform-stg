// Early RBAC Enforcement - Add this inline script to <head> of protected pages
// This runs BEFORE page content loads to prevent blank pages and immediate redirect

(function() {
    'use strict';
    
    console.log('🛡️ Early RBAC check...');
    
    // Skip public pages
    const publicPages = ['index.html', 'login.html', 'unauthorized.html', 'privacy-policy-merchants.html'];
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    if (publicPages.includes(currentPage)) {
        console.log('✅ Public page, skipping RBAC');
        return;
    }
    
    // Check authentication first
    const idToken = localStorage.getItem('idToken');
    if (!idToken) {
        console.warn('❌ No token, redirecting to login');
        window.location.href = '/index.html';
        return;
    }
    
    // Extract groups from token
    try {
        const payload = JSON.parse(atob(idToken.split('.')[1]));
        const groups = payload['cognito:groups'] || [];
        
        console.log('👥 User groups:', groups);
        
        // Define page access map
        const groupAccess = {
            'admins': '*',
            'financial_admin': ['dashboard.html', 'financial-management.html', 'orders.html', 'orders-management.html', 'merchants.html', 'drivers.html'],
            'support_admin': ['dashboard.html', 'support.html', 'support-merchants.html', 'support-production.html', 'customers.html', 'customers-simple.html', 'orders.html', 'merchants.html', 'drivers.html'],
            'merchants_admin': ['dashboard.html', 'merchants.html', 'support-merchants.html', 'orders.html', 'promotions.html', 'regions.html', 'regions-management.html'],
            'drivers_admin': ['dashboard.html', 'drivers.html'],
            'customers_admin': ['dashboard.html', 'customers.html', 'customers-simple.html', 'orders.html', 'support.html'],
            'campaigns_admin': ['dashboard.html', 'promotions.html', 'customers.html', 'merchants.html'],
            'reporting_view': ['dashboard.html', 'orders.html', 'financial-management.html', 'merchants.html', 'drivers.html', 'customers.html']
        };
        
        // Common pages all users can access
        const commonPages = ['dashboard.html'];
        if (commonPages.includes(currentPage)) {
            console.log('✅ Common page access granted');
            return;
        }
        
        // Check if user has access
        let hasAccess = false;
        
        for (const group of groups) {
            const allowedPages = groupAccess[group];
            if (allowedPages === '*') {
                console.log(`✅ Group "${group}" has wildcard access`);
                hasAccess = true;
                break;
            }
            if (Array.isArray(allowedPages) && allowedPages.includes(currentPage)) {
                console.log(`✅ Access granted through group "${group}"`);
                hasAccess = true;
                break;
            }
        }
        
        if (!hasAccess) {
            console.warn('❌ Access denied for page:', currentPage);
            sessionStorage.setItem('attemptedPage', window.location.pathname);
            window.location.href = '/pages/unauthorized.html';
        }
        
    } catch (error) {
        console.error('RBAC check failed:', error);
        window.location.href = '/index.html';
    }
})();
