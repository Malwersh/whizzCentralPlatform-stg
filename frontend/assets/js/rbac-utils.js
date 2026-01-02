// RBAC Utilities for WizzCentral Platform
// Handles permission checking and access control based on Cognito groups

console.log('Loading RBAC Utilities...');

window.RBAC = {
    /**
     * Get user's groups from ID token
     * @returns {Array<string>} Array of group names
     */
    getUserGroups() {
        try {
            const idToken = localStorage.getItem('idToken');
            if (!idToken) {
                console.warn('RBAC: No idToken found');
                return [];
            }

            const payload = JSON.parse(atob(idToken.split('.')[1]));
            const groups = payload['cognito:groups'] || [];
            
            console.log('🔐 User groups:', groups);
            return groups;
        } catch (error) {
            console.error('RBAC: Error extracting groups from token:', error);
            return [];
        }
    },

    /**
     * Get user's highest priority group (lowest precedence number)
     * @returns {string|null} Primary group name
     */
    getPrimaryGroup() {
        const userGroups = this.getUserGroups();
        if (userGroups.length === 0) return null;

        const config = window.RBAC_CONFIG;
        if (!config) {
            console.error('RBAC: RBAC_CONFIG not loaded');
            return null;
        }

        // Find group with lowest precedence (highest priority)
        let primaryGroup = null;
        let lowestPrecedence = Infinity;

        userGroups.forEach(groupName => {
            const groupConfig = config.groups[groupName];
            if (groupConfig && groupConfig.precedence < lowestPrecedence) {
                lowestPrecedence = groupConfig.precedence;
                primaryGroup = groupName;
            }
        });

        console.log('👤 Primary group:', primaryGroup);
        return primaryGroup;
    },

    /**
     * Check if user has access to a specific page
     * @param {string} pageName - Name of the page (e.g., 'dashboard.html')
     * @returns {boolean} True if user has access
     */
    hasPageAccess(pageName) {
        // Remove leading slash if present
        pageName = pageName.replace(/^\//, '');
        
        // Extract just the filename if it's a full path
        if (pageName.includes('/')) {
            pageName = pageName.split('/').pop();
        }

        console.log('🔍 Checking access for page:', pageName);

        const config = window.RBAC_CONFIG;
        if (!config) {
            console.error('RBAC: RBAC_CONFIG not loaded');
            return false;
        }

        // Check if it's a public page
        if (config.publicPages.includes(pageName)) {
            console.log('✅ Public page - access granted');
            return true;
        }

        // Check if it's a common page (all authenticated users)
        if (config.commonPages.includes(pageName)) {
            console.log('✅ Common page - access granted');
            return true;
        }

        const userGroups = this.getUserGroups();
        if (userGroups.length === 0) {
            console.warn('❌ No groups assigned - access denied');
            return false;
        }

        // Check if user has access through any of their groups
        for (const groupName of userGroups) {
            const groupConfig = config.groups[groupName];
            if (!groupConfig) continue;

            // Check for wildcard access (admins)
            if (groupConfig.allowedPages === '*') {
                console.log(`✅ Group "${groupName}" has wildcard access`);
                return true;
            }

            // Check if page is in allowed list
            if (Array.isArray(groupConfig.allowedPages) && 
                groupConfig.allowedPages.includes(pageName)) {
                console.log(`✅ Access granted through group "${groupName}"`);
                return true;
            }
        }

        console.warn('❌ Access denied - page not in allowed list for any user group');
        return false;
    },

    /**
     * Check if user has a specific permission
     * @param {string} permission - Permission to check
     * @returns {boolean} True if user has the permission
     */
    hasPermission(permission) {
        const config = window.RBAC_CONFIG;
        if (!config) return false;

        const userGroups = this.getUserGroups();
        
        for (const groupName of userGroups) {
            const groupConfig = config.groups[groupName];
            if (!groupConfig) continue;

            // Check for wildcard permissions
            if (groupConfig.permissions.includes('*')) {
                return true;
            }

            // Check for specific permission
            if (groupConfig.permissions.includes(permission)) {
                return true;
            }
        }

        return false;
    },

    /**
     * Check if user should have read-only access
     * @returns {boolean} True if user is in read-only mode
     */
    isReadOnly() {
        const config = window.RBAC_CONFIG;
        if (!config) return false;

        const userGroups = this.getUserGroups();
        
        // If user has admin group, never read-only
        if (userGroups.includes('admins')) return false;

        // Check if any group has readOnly flag
        for (const groupName of userGroups) {
            const groupConfig = config.groups[groupName];
            if (groupConfig && groupConfig.readOnly) {
                return true;
            }
        }

        return false;
    },

    /**
     * Enforce page access - redirect to unauthorized if no access
     * Call this at the top of each protected page
     */
    enforcePage() {
        console.log('🛡️ Enforcing RBAC for current page...');
        
        // First check authentication
        if (!window.Auth || !window.Auth.requireAuthentication()) {
            console.warn('RBAC: User not authenticated');
            return;
        }

        // Get current page name
        const currentPath = window.location.pathname;
        const pageName = currentPath.split('/').pop() || 'index.html';

        console.log('📄 Current page:', pageName);

        // Check access
        if (!this.hasPageAccess(pageName)) {
            console.warn('🚫 Access denied to page:', pageName);
            this.redirectToUnauthorized();
        } else {
            console.log('✅ Access granted to page:', pageName);
            
            // Apply read-only mode if applicable
            if (this.isReadOnly()) {
                this.applyReadOnlyMode();
            }
        }
    },

    /**
     * Redirect to unauthorized page
     */
    redirectToUnauthorized() {
        console.log('🚨 Redirecting to unauthorized page...');
        
        // Store the attempted page
        sessionStorage.setItem('attemptedPage', window.location.pathname);
        
        // Determine base path
        const basePath = window.location.pathname.includes('/frontend/') ? '/frontend' : '';
        window.location.href = basePath + '/pages/unauthorized.html';
    },

    /**
     * Apply read-only mode to the page
     * Disables edit buttons and forms
     */
    applyReadOnlyMode() {
        console.log('🔒 Applying read-only mode...');
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._applyReadOnlyUI());
        } else {
            this._applyReadOnlyUI();
        }
    },

    /**
     * Internal method to apply read-only UI changes
     */
    _applyReadOnlyUI() {
        // Disable all buttons that contain edit/delete/add keywords
        const actionButtons = document.querySelectorAll('button, .btn');
        actionButtons.forEach(button => {
            const text = button.textContent.toLowerCase();
            if (text.includes('add') || text.includes('edit') || 
                text.includes('delete') || text.includes('remove') ||
                text.includes('create') || text.includes('save') ||
                text.includes('update')) {
                button.disabled = true;
                button.style.opacity = '0.5';
                button.style.cursor = 'not-allowed';
                button.title = 'Read-only mode - action not permitted';
            }
        });

        // Disable all input fields in forms
        const inputs = document.querySelectorAll('input:not([type="search"]), textarea, select');
        inputs.forEach(input => {
            if (!input.closest('.search-form')) { // Don't disable search
                input.disabled = true;
                input.style.backgroundColor = '#f5f5f5';
            }
        });

        // Add read-only banner
        if (!document.getElementById('rbac-readonly-banner')) {
            const banner = document.createElement('div');
            banner.id = 'rbac-readonly-banner';
            banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fbbf24;color:#92400e;padding:8px 16px;text-align:center;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.1);';
            banner.innerHTML = '🔒 Read-Only Mode - You have view-only access to this page';
            document.body.appendChild(banner);
        }
    },

    /**
     * Get user's role display name
     * @returns {string} Display name for user's primary role
     */
    getRoleDisplayName() {
        const primaryGroup = this.getPrimaryGroup();
        if (!primaryGroup) return 'User';

        const config = window.RBAC_CONFIG;
        if (!config || !config.groups[primaryGroup]) return primaryGroup;

        return config.groups[primaryGroup].name || primaryGroup;
    },

    /**
     * Filter navigation menu items based on user's access
     * Call this after rendering the navigation menu
     */
    filterNavigationMenu() {
        console.log('🧭 Filtering navigation menu based on RBAC...');
        
        const menuLinks = document.querySelectorAll('nav a[href], .sidebar a[href], .menu a[href]');
        
        menuLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;

            // Extract page name from href
            let pageName = href.split('/').pop().split('?')[0].split('#')[0];
            
            // Check if user has access
            if (!this.hasPageAccess(pageName)) {
                // Hide or disable the menu item
                link.style.display = 'none';
                // Alternative: link.classList.add('disabled');
            }
        });
    }
};

console.log('✅ RBAC Utilities loaded');
