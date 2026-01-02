// RBAC System for WizzCentral Platform
// Uses AWS Cognito groups for role-based access control
console.log('🔐 Loading RBAC System...');

// RBAC Configuration
window.RBAC_CONFIG = {
    groups: {
        admins: {
            name: 'Admins',
            precedence: 1,
            allowedPages: '*',
            permissions: ['*']
        },
        financial_admin: {
            name: 'Financial Admin',
            precedence: 10,
            allowedPages: ['dashboard.html', 'financial-management.html', 'orders.html', 'orders-management.html', 'merchants.html', 'drivers.html'],
            permissions: ['view_financial_reports', 'manage_commissions', 'manage_fees']
        },
        support_admin: {
            name: 'Support Admin',
            precedence: 20,
            allowedPages: ['dashboard.html', 'support.html', 'support-merchants.html', 'support-production.html', 'customers.html', 'customers-simple.html', 'orders.html', 'merchants.html', 'drivers.html'],
            permissions: ['view_support_tickets', 'manage_support', 'view_merchants', 'view_drivers']
        },
        merchants_admin: {
            name: 'Merchants Admin',
            precedence: 30,
            allowedPages: ['dashboard.html', 'merchants.html', 'support-merchants.html'],
            permissions: ['manage_merchants', 'approve_merchants', 'view_merchants']
        },
        drivers_admin: {
            name: 'Drivers Admin',
            precedence: 40,
            allowedPages: ['dashboard.html', 'drivers.html'],
            permissions: ['manage_drivers']
        },
        customers_admin: {
            name: 'Customers Admin',
            precedence: 50,
            allowedPages: ['dashboard.html', 'customers.html', 'customers-simple.html', 'orders.html', 'support.html'],
            permissions: ['manage_customers']
        },
        campaigns_admin: {
            name: 'Campaigns Admin',
            precedence: 60,
            allowedPages: ['dashboard.html', 'promotions.html', 'customers.html', 'merchants.html'],
            permissions: ['manage_campaigns', 'manage_promotions']
        },
        reporting_view: {
            name: 'Reporting View',
            precedence: 100,
            allowedPages: ['dashboard.html', 'orders.html', 'financial-management.html', 'merchants.html', 'drivers.html', 'customers.html'],
            permissions: ['view_reports'],
            readOnly: true
        }
    },
    publicPages: ['index.html', 'login.html', 'unauthorized.html', 'privacy-policy-merchants.html'],
    commonPages: ['dashboard.html', 'unauthorized.html']
};

// RBAC Utilities
window.RBAC = {
    getUserGroups() {
        try {
            const idToken = localStorage.getItem('idToken');
            if (!idToken) return [];
            const payload = JSON.parse(atob(idToken.split('.')[1]));
            return payload['cognito:groups'] || [];
        } catch (error) {
            console.error('RBAC: Error getting groups:', error);
            return [];
        }
    },

    getPrimaryGroup() {
        const userGroups = this.getUserGroups();
        if (userGroups.length === 0) return null;
        let primaryGroup = null;
        let lowestPrecedence = Infinity;
        userGroups.forEach(groupName => {
            const groupConfig = RBAC_CONFIG.groups[groupName];
            if (groupConfig && groupConfig.precedence < lowestPrecedence) {
                lowestPrecedence = groupConfig.precedence;
                primaryGroup = groupName;
            }
        });
        return primaryGroup;
    },

    hasPageAccess(pageName) {
        pageName = pageName.replace(/^\//, '').split('/').pop();
        
        console.log('🔍 Checking page access for:', pageName);
        
        if (RBAC_CONFIG.publicPages.includes(pageName)) {
            console.log('✅ Public page - access granted');
            return true;
        }
        if (RBAC_CONFIG.commonPages.includes(pageName)) {
            console.log('✅ Common page - access granted');
            return true;
        }
        
        const userGroups = this.getUserGroups();
        console.log('👥 User groups:', userGroups);
        
        if (userGroups.length === 0) {
            console.warn('❌ No groups assigned');
            return false;
        }
        
        for (const groupName of userGroups) {
            const groupConfig = RBAC_CONFIG.groups[groupName];
            if (!groupConfig) {
                console.warn(`⚠️ Group config not found for: ${groupName}`);
                continue;
            }
            if (groupConfig.allowedPages === '*') {
                console.log(`✅ Wildcard access via group: ${groupName}`);
                return true;
            }
            if (Array.isArray(groupConfig.allowedPages) && groupConfig.allowedPages.includes(pageName)) {
                console.log(`✅ Access granted via group: ${groupName}`);
                return true;
            }
        }
        
        console.warn('❌ Access denied - page not in allowedPages for any group');
        return false;
    },

    hasPermission(permission) {
        const userGroups = this.getUserGroups();
        for (const groupName of userGroups) {
            const groupConfig = RBAC_CONFIG.groups[groupName];
            if (!groupConfig) continue;
            if (groupConfig.permissions.includes('*')) return true;
            if (groupConfig.permissions.includes(permission)) return true;
        }
        return false;
    },

    isReadOnly() {
        const userGroups = this.getUserGroups();
        if (userGroups.includes('admins')) return false;
        for (const groupName of userGroups) {
            const groupConfig = RBAC_CONFIG.groups[groupName];
            if (groupConfig && groupConfig.readOnly) return true;
        }
        return false;
    },

    enforcePage() {
        console.log('🛡️ Enforcing RBAC...');
        if (!window.Auth || !window.Auth.requireAuthentication()) return;
        const pageName = window.location.pathname.split('/').pop() || 'index.html';
        if (!this.hasPageAccess(pageName)) {
            console.warn('🚫 Access denied:', pageName);
            this.redirectToUnauthorized();
        } else {
            console.log('✅ Access granted:', pageName);
            if (this.isReadOnly()) this.applyReadOnlyMode();
        }
    },

    redirectToUnauthorized() {
        sessionStorage.setItem('attemptedPage', window.location.pathname);
        const basePath = window.location.pathname.includes('/frontend/') ? '/frontend' : '';
        window.location.href = basePath + '/pages/unauthorized.html';
    },

    applyReadOnlyMode() {
        console.log('🔒 Applying read-only mode...');
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._applyReadOnlyUI());
        } else {
            this._applyReadOnlyUI();
        }
    },

    _applyReadOnlyUI() {
        const actionButtons = document.querySelectorAll('button, .btn');
        actionButtons.forEach(button => {
            const text = button.textContent.toLowerCase();
            if (text.includes('add') || text.includes('edit') || text.includes('delete') || 
                text.includes('remove') || text.includes('create') || text.includes('save') || 
                text.includes('update')) {
                button.disabled = true;
                button.style.opacity = '0.5';
                button.style.cursor = 'not-allowed';
                button.title = 'Read-only mode';
            }
        });
        const inputs = document.querySelectorAll('input:not([type="search"]), textarea, select');
        inputs.forEach(input => {
            if (!input.closest('.search-form')) {
                input.disabled = true;
                input.style.backgroundColor = '#f5f5f5';
            }
        });
        if (!document.getElementById('rbac-readonly-banner')) {
            const banner = document.createElement('div');
            banner.id = 'rbac-readonly-banner';
            banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fbbf24;color:#92400e;padding:8px 16px;text-align:center;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.1);';
            banner.innerHTML = '🔒 Read-Only Mode - You have view-only access';
            document.body.appendChild(banner);
        }
    },

    getRoleDisplayName() {
        const primaryGroup = this.getPrimaryGroup();
        if (!primaryGroup) return 'User';
        return RBAC_CONFIG.groups[primaryGroup]?.name || primaryGroup;
    },

    filterNavigationMenu() {
        console.log('🧭 Filtering navigation menu...');
        
        const menuLinks = document.querySelectorAll('nav a[href], .sidebar a[href], .menu a[href], .nav-item[data-page]');
        
        menuLinks.forEach(link => {
            const href = link.getAttribute('href');
            const dataPage = link.getAttribute('data-page');
            
            let pageName = null;
            
            // Extract page name from href
            if (href) {
                pageName = href.split('/').pop().split('?')[0].split('#')[0];
            }
            
            // Or from data-page attribute (convert to .html format)
            if (!pageName && dataPage) {
                // Special mapping for data-page to actual file names
                const pageMapping = {
                    'financial': 'financial-management.html',
                    'support': 'support.html',
                    'dashboard': 'dashboard.html',
                    'drivers': 'drivers.html',
                    'customers': 'customers.html',
                    'merchants': 'merchants.html',
                    'orders': 'orders.html',
                    'promotions': 'promotions.html',
                    'regions': 'regions.html'
                };
                pageName = pageMapping[dataPage] || (dataPage + '.html');
            }
            
            if (pageName && !this.hasPageAccess(pageName)) {
                console.log('❌ Hiding menu item:', pageName);
                
                // Hide the entire navigation item
                link.style.display = 'none';
                
                // Also hide parent li if exists
                const parentLi = link.closest('li');
                if (parentLi) {
                    parentLi.style.display = 'none';
                }
            } else if (pageName) {
                console.log('✅ Showing menu item:', pageName);
            }
        });
        
        console.log('🧭 Navigation menu filtered');
    },
    
    // Auto-run navigation filtering when DOM is ready
    autoFilterNavigation() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.filterNavigationMenu());
        } else {
            this.filterNavigationMenu();
        }
        
        // Also filter after a short delay to catch dynamically loaded sidebars
        setTimeout(() => this.filterNavigationMenu(), 500);
        setTimeout(() => this.filterNavigationMenu(), 1500);
    },

    // Legacy API compatibility
    async ensure() { return Promise.resolve(); },
    pageAllowed(page) { return this.hasPageAccess(page); },
    applyReadOnly() { this.applyReadOnlyMode(); },
    
    // Fetch current user information
    async fetchMe() {
        try {
            const idToken = localStorage.getItem('idToken');
            if (!idToken) {
                return { email: 'Guest', roles: [] };
            }
            
            const payload = JSON.parse(atob(idToken.split('.')[1]));
            const email = payload.email || payload['cognito:username'] || 'User';
            const groups = payload['cognito:groups'] || [];
            
            // Convert groups to display names
            const roles = groups.map(groupName => {
                const groupConfig = RBAC_CONFIG.groups[groupName];
                return groupConfig?.name || groupName;
            });
            
            return {
                email,
                roles,
                groups,
                primaryRole: this.getRoleDisplayName()
            };
        } catch (error) {
            console.error('RBAC: Error fetching user info:', error);
            return { email: 'User', roles: [] };
        }
    },
    
    // Check if user can perform action on domain
    can(domain, action = 'read') {
        const userGroups = this.getUserGroups();
        
        // Admins can do everything
        if (userGroups.includes('admins')) {
            return true;
        }
        
        // Domain to permission mapping
        const domainPermissions = {
            financial: ['view_financial_reports', 'manage_commissions', 'manage_fees'],
            campaigns: ['manage_campaigns', 'manage_promotions'],
            regions: ['manage_regions'],
            orders: ['view_orders', 'manage_orders'],
            merchants: ['view_merchants', 'manage_merchants', 'approve_merchants'],
            drivers: ['manage_drivers'],
            customers: ['manage_customers'],
            support: ['view_support_tickets', 'manage_support']
        };
        
        const permissions = domainPermissions[domain] || [];
        
        // Check if user has any permission for this domain
        for (const groupName of userGroups) {
            const groupConfig = RBAC_CONFIG.groups[groupName];
            if (!groupConfig) continue;
            
            // Wildcard permissions
            if (groupConfig.permissions.includes('*')) {
                return true;
            }
            
            // Check specific permissions
            for (const permission of permissions) {
                if (groupConfig.permissions.includes(permission)) {
                    // If action is 'write', check if group is read-only
                    if (action === 'write' && groupConfig.readOnly) {
                        return false;
                    }
                    return true;
                }
            }
        }
        
        return false;
    }
};

// Auto-filter navigation on script load
if (window.location.pathname !== '/index.html' && !window.location.pathname.endsWith('/')) {
    window.RBAC.autoFilterNavigation();
}

console.log('✅ RBAC System loaded');
console.log('👥 User groups:', window.RBAC.getUserGroups());
console.log('👤 Primary role:', window.RBAC.getRoleDisplayName());
