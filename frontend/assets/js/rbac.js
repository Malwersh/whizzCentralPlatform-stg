// RBAC System for WizzCentral Platform
// Uses AWS Cognito groups for role-based access control
console.log('🔐 Loading RBAC System...');

function _rbacDecodeJwtPayload(token) {
    try {
        if (!token || typeof token !== 'string') return null;
        const parts = token.split('.');
        if (parts.length < 2) return null;
        let b64 = parts[1];
        // base64url -> base64
        b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
        // pad
        while (b64.length % 4) b64 += '=';
        const json = atob(b64);
        return JSON.parse(json);
    } catch (e) {
        console.warn('RBAC: Failed to decode JWT payload', e);
        return null;
    }
}

// RBAC Configuration
window.RBAC_CONFIG = {
    groups: {
        // Support both 'admin' and 'admins' group names
        admin: {
            name: 'Administrator',
            precedence: 1,
            allowedPages: '*',
            permissions: ['*']
        },
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
            allowedPages: ['dashboard.html', 'merchants.html', 'support-merchants.html', 'orders.html', 'promotions.html', 'regions.html', 'regions-management.html', 'regions-toggle.html'],
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
            // Check both sessionStorage and localStorage for idToken
            const idToken = sessionStorage.getItem('idToken') || localStorage.getItem('idToken');
            if (!idToken) {
                console.log('🔍 RBAC: No idToken found in sessionStorage or localStorage');
                return [];
            }
            const payload = _rbacDecodeJwtPayload(idToken) || {};
            const raw = payload['cognito:groups'] || payload['groups'] || payload['custom:groups'] || [];
            const groups = Array.isArray(raw) ? raw : [raw].filter(Boolean);
            const normalized = groups.map(g => String(g)).filter(Boolean);
            console.log('🔐 RBAC: User groups from token:', normalized);
            return normalized;
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
        userGroups.forEach(groupNameRaw => {
            const groupName = String(groupNameRaw);
            const key = RBAC_CONFIG.groups[groupName] ? groupName : groupName.toLowerCase();
            const groupConfig = RBAC_CONFIG.groups[key];
            if (groupConfig && groupConfig.precedence < lowestPrecedence) {
                lowestPrecedence = groupConfig.precedence;
                primaryGroup = key;
            }
        });
        return primaryGroup;
    },

    hasPageAccess(pageName) {
        pageName = pageName.replace(/^\//, '').split('/').pop();

        // Normalize navigation "data-page" keys (e.g. "dashboard") to actual filenames.
        // Many pages/menus reference routes without the .html suffix.
        if (pageName && !pageName.includes('.') && !pageName.endsWith('.html')) {
            pageName = pageName + '.html';
        }
        
        if(this.staff && pageName==='order-exceptions.html')return this.staff.employee.roles.includes('bootstrap_admin')||this.staff.permissions.includes('orders.read')||this.staff.permissions.includes('finance.read');
        if(this.staff && !this.staff.employee.roles.includes('bootstrap_admin')) {
            if(['pricing.html','delivery-pricing.html'].includes(pageName))return this.staff.permissions.includes('pricing.read');
            if(['merchants.html','promotions.html'].includes(pageName)&&this.staff.permissions.includes('commercial.read'))return true;
            if(pageName==='settings.html')return this.staff.permissions.includes('settings.read')||this.staff.permissions.includes('finance.read');
            const permission={'staff.html':'staff.read','finance.html':'finance.read','financial-management.html':'finance.read','settings.html':'finance.read','drivers.html':'drivers.read','regions.html':'regions.read'}[pageName];
            return pageName==='account-security.html'||pageName==='index.html'||(!!permission&&this.staff.permissions.includes(permission));
        }
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
        
        for (const groupNameRaw of userGroups) {
            const groupName = String(groupNameRaw);
            const key = RBAC_CONFIG.groups[groupName] ? groupName : groupName.toLowerCase();
            const groupConfig = RBAC_CONFIG.groups[key];
            if (!groupConfig) {
                console.warn(`⚠️ Group config not found for: ${groupName}`);
                continue;
            }
            if (groupConfig.allowedPages === '*') {
                console.log(`✅ Wildcard access via group: ${key}`);
                return true;
            }
            if (Array.isArray(groupConfig.allowedPages) && groupConfig.allowedPages.includes(pageName)) {
                console.log(`✅ Access granted via group: ${key}`);
                return true;
            }
        }
        
        console.warn('❌ Access denied - page not in allowedPages for any group');
        return false;
    },

    hasPermission(permission) {
        if(this.staff)return this.staff.permissions.includes(permission);
        const userGroups = this.getUserGroups();
        for (const groupNameRaw of userGroups) {
            const groupName = String(groupNameRaw);
            const key = RBAC_CONFIG.groups[groupName] ? groupName : groupName.toLowerCase();
            const groupConfig = RBAC_CONFIG.groups[key];
            if (!groupConfig) continue;
            if (groupConfig.permissions.includes('*')) return true;
            if (groupConfig.permissions.includes(permission)) return true;
        }
        return false;
    },

    isReadOnly() {
        if(this.staff) {
            const page=window.location.pathname.split('/').pop();
            const domain={'drivers.html':'drivers','merchants.html':'merchants','orders.html':'orders','support.html':'support','finance.html':'financial','financial-management.html':'financial','regions.html':'regions','promotions.html':'campaigns'}[page];
            return domain?!this.can(domain,'write'):false;
        }
        const userGroups = this.getUserGroups();
        // Check if user is admin (either 'admin' or 'admins' group)
        const lowered = userGroups.map(g => String(g).toLowerCase());
        if (lowered.includes('admin') || lowered.includes('admins')) return false;

        for (const groupNameRaw of userGroups) {
            const groupName = String(groupNameRaw);
            const key = RBAC_CONFIG.groups[groupName] ? groupName : groupName.toLowerCase();
            const groupConfig = RBAC_CONFIG.groups[key];
            if (groupConfig && groupConfig.readOnly) return true;
        }
        return false;
    },

    enforcePage() {
        console.log('🛡️ Enforcing RBAC...');
        // RBAC must NOT trigger redirects; Auth is the sole redirect authority.
        if (!window.Auth || !window.Auth.requireAuthentication({ silent: true })) return;
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
        if(document.body.dataset.page==='order-exceptions')return; // Case controls use server-projected capabilities; keep search available.
        const actionButtons = document.querySelectorAll('button, .btn');
        actionButtons.forEach(button => {
            // Commercial sections render only server-authorized actions; other page domains remain read-only.
            if(button.closest('[data-commercial-kind]'))return;
            const text = button.textContent.toLowerCase();
            const markedWrite = button.matches('[data-write-only], [data-write-action]');
            const arabicWrite = /إضافة|تعديل|حذف|إزالة|إنشاء|حفظ|اعتماد|نشر|إيقاف|تفعيل/.test(text) ||
                /(?:تحديث|تغيير)\s+(?:الحالة|العرض|الحملة|المتجر|المنتج|بيانات)/.test(text);
            if (markedWrite || arabicWrite || text.includes('add') || text.includes('edit') || text.includes('delete') ||
                text.includes('remove') || text.includes('create') || text.includes('save') || 
                text.includes('update')) {
                button.disabled = true;
                button.style.opacity = '0.5';
                button.style.cursor = 'not-allowed';
                button.title = 'للاطلاع فقط';
            }
        });
        const inputs = document.querySelectorAll('input:not([type="search"]), textarea, select');
        inputs.forEach(input => {
            if (!input.closest('.search-form') && !input.closest('[data-commercial-kind]')) {
                input.disabled = true;
                input.style.backgroundColor = '#f5f5f5';
            }
        });
        if (!document.getElementById('rbac-readonly-banner')) {
            const banner = document.createElement('div');
            banner.id = 'rbac-readonly-banner';
            banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fbbf24;color:#92400e;padding:8px 16px;text-align:center;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.1);';
            banner.textContent = 'للاطلاع فقط — لا تملك صلاحية إجراء التعديلات';
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
                link.style.display = '';
                const parentLi=link.closest('li');if(parentLi)parentLi.style.display='';
                console.log('✅ Showing menu item:', pageName);
            }
        });
        
        console.log('🧭 Navigation menu filtered');
    },
    
    // Auto-run navigation filtering when DOM is ready
    autoFilterNavigation() {
        this.ensure().catch(()=>{});
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
    async ensure() {
        const base=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL;
        if(!base)return;
        await window.Auth.ensureSession();
        const response=await fetch(base+'/staff/me',{headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken')}});
        if(!response.ok){this.staff=null;throw Error('Staff session unavailable');}
        this.staff=await response.json();
        this.filterNavigationMenu();
        if(!this.staff.employee.roles.includes('bootstrap_admin')&&window.location.pathname.endsWith('/dashboard.html')) {
            const page=this.staff.permissions.includes('staff.read')?'staff.html':this.staff.permissions.includes('finance.read')?'finance.html':this.staff.permissions.includes('drivers.read')?'drivers.html':this.staff.permissions.includes('settings.read')?'settings.html':'account-security.html';
            window.location.replace(page);
        }
    },
    pageAllowed(page) { return this.hasPageAccess(page); },
    applyReadOnly() { this.applyReadOnlyMode(); },
    
    // Fetch current user information
    async fetchMe() {
        if(this.staff)return {email:this.staff.employee.email,roles:this.staff.employee.roles};
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
        if(this.staff) {
            const read={pricing:'pricing.read',financial:'finance.read',campaigns:'promotions.read'};
            const writes={pricing:['pricing.request','pricing.approve'],drivers:['drivers.edit','drivers.review','drivers.suspend'],merchants:['merchants.edit','merchants.review','merchants.suspend'],orders:['orders.assign','orders.cancel'],customers:['customers.edit'],support:['support.reply','support.assign','support.close'],regions:['regions.edit','regions.activate'],campaigns:['promotions.create','promotions.edit','promotions.approve'],financial:['finance.request','finance.approve','finance.settings.request','finance.settings.approve']};
            return action==='read'?this.staff.permissions.includes(read[domain]||domain+'.read'):(writes[domain]||[]).some(p=>this.staff.permissions.includes(p));
        }
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
