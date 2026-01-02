// RBAC Configuration for WizzCentral Platform
// Maps Cognito User Groups to allowed pages and permissions

console.log('Loading RBAC Configuration...');

window.RBAC_CONFIG = {
    // Define all Cognito groups and their permissions
    groups: {
        // Full system access
        admins: {
            name: 'Admins',
            description: 'Full system access',
            precedence: 1,
            allowedPages: '*', // Wildcard means all pages
            permissions: ['*'] // All permissions
        },

        // Financial management
        financial_admin: {
            name: 'Financial Admin',
            description: 'Financial administrators - manage commissions, fees, reports',
            precedence: 10,
            allowedPages: [
                'dashboard.html',
                'financial-management.html',
                'orders.html',
                'orders-management.html',
                'merchants.html', // Read-only for financial data
                'drivers.html' // Read-only for financial data
            ],
            permissions: [
                'view_financial_reports',
                'manage_commissions',
                'manage_fees',
                'view_orders',
                'view_merchants',
                'view_drivers'
            ]
        },

        // Support management
        support_admin: {
            name: 'Support Admin',
            description: 'Support administrators - handle customer support, tickets',
            precedence: 20,
            allowedPages: [
                'dashboard.html',
                'support.html',
                'support-merchants.html',
                'support-production.html',
                'customers.html',
                'customers-simple.html',
                'orders.html',
                'orders-management.html',
                'merchants.html',
                'drivers.html'
            ],
            permissions: [
                'view_support_tickets',
                'manage_support',
                'view_customers',
                'view_orders',
                'manage_customer_issues',
                'view_merchants',
                'view_drivers'
            ]
        },

        // Merchant management
        merchants_admin: {
            name: 'Merchants Admin',
            description: 'Merchant administrators - manage merchants, approvals',
            precedence: 30,
            allowedPages: [
                'dashboard.html',
                'merchants.html',
                'support-merchants.html'
            ],
            permissions: [
                'manage_merchants',
                'approve_merchants',
                'view_merchants'
            ]
        },

        // Driver management
        drivers_admin: {
            name: 'Drivers Admin',
            description: 'Driver administrators - manage drivers, assignments',
            precedence: 40,
            allowedPages: [
                'dashboard.html',
                'drivers.html',
                'orders.html',
                'orders-management.html',
                'regions.html',
                'regions-simple.html'
            ],
            permissions: [
                'manage_drivers',
                'view_driver_reports',
                'assign_orders',
                'view_orders',
                'view_regions'
            ]
        },

        // Customer management
        customers_admin: {
            name: 'Customers Admin',
            description: 'Customer administrators - manage customer accounts',
            precedence: 50,
            allowedPages: [
                'dashboard.html',
                'customers.html',
                'customers-simple.html',
                'orders.html',
                'support.html'
            ],
            permissions: [
                'manage_customers',
                'view_customer_reports',
                'view_orders',
                'view_support_tickets'
            ]
        },

        // Campaign/promotion management
        campaigns_admin: {
            name: 'Campaigns Admin',
            description: 'Campaign administrators - manage marketing campaigns',
            precedence: 60,
            allowedPages: [
                'dashboard.html',
                'promotions.html',
                'customers.html',
                'merchants.html'
            ],
            permissions: [
                'manage_campaigns',
                'manage_promotions',
                'view_customers',
                'view_merchants'
            ]
        },

        // Read-only reporting
        reporting_view: {
            name: 'Reporting View',
            description: 'Read-only access to reports and analytics',
            precedence: 100,
            allowedPages: [
                'dashboard.html',
                'orders.html',
                'financial-management.html',
                'merchants.html',
                'drivers.html',
                'customers.html'
            ],
            permissions: [
                'view_reports',
                'view_analytics',
                'view_orders',
                'view_merchants',
                'view_drivers',
                'view_customers'
            ],
            readOnly: true // Flag for UI to disable edit buttons
        }
    },

    // Public pages that don't require authentication or specific groups
    publicPages: [
        'index.html',
        'login.html',
        'unauthorized.html',
        'privacy-policy-merchants.html'
    ],

    // Pages that all authenticated users can access
    commonPages: [
        'dashboard.html',
        'unauthorized.html'
    ]
};

console.log('✅ RBAC Configuration loaded');
console.log('📋 Available groups:', Object.keys(window.RBAC_CONFIG.groups));
