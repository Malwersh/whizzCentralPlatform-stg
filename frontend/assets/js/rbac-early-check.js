// Early RBAC Enforcement - Add this inline script to <head> of protected pages
// This runs BEFORE page content loads to prevent blank pages and immediate redirect

(function() {
    'use strict';
    
    console.log('🛡️ Early RBAC check...');
    
    // Skip public pages
    const publicPages = ['index.html', 'login.html', 'unauthorized.html', 'privacy-policy-merchants.html'];
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const pathname = window.location.pathname || '/';
    const basePrefix = (pathname === '/frontend' || pathname.startsWith('/frontend/')) ? '/frontend' : '';
    
    if (publicPages.includes(currentPage)) {
        console.log('✅ Public page, skipping RBAC');
        return;
    }
    
    function decodeJwtPayload(token) {
        try {
            if (!token || typeof token !== 'string') return null;
            const parts = token.split('.');
            if (parts.length < 2) return null;
            let b64 = parts[1];
            b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            return JSON.parse(atob(b64));
        } catch (e) {
            console.warn('RBAC early-check: Failed to decode token payload', e);
            return null;
        }
    }

    // Check authentication first (support both storages)
    const idToken = sessionStorage.getItem('idToken') || localStorage.getItem('idToken');
    if (!idToken) {
        console.warn('❌ No token, redirecting to login');
        window.location.href = basePrefix + '/index.html';
        return;
    }
    
    // Extract groups from token
    try {
        const payload = decodeJwtPayload(idToken) || {};
        const raw = payload['cognito:groups'] || payload['groups'] || payload['custom:groups'] || [];
        const groups = (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(g => String(g));
        const groupsLower = groups.map(g => g.toLowerCase());
        
        console.log('👥 User groups:', groups);
        
        // Define page access map
        const groupAccess = {
            'admin': '*',
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
        
        for (const group of groupsLower) {
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
            window.location.href = basePrefix + '/pages/unauthorized.html';
        }
        
    } catch (error) {
        console.error('RBAC check failed:', error);
        window.location.href = basePrefix + '/index.html';
    }
})();
