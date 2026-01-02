// Merchants Management JavaScript - Using Centralized Data Service
console.log('merchants.js script loaded');

// API Base URL from configuration
const API_BASE_URL = window.WIZZCENTRAL_CONFIG.API_BASE_URL;

// DynamoDB table name - Updated to match actual table
const MERCHANTS_TABLE = 'WhizzMerchants_Businesses';

// DynamoDB client
// Use var to avoid "duplicate declaration" errors when dashboard.js is also present.
var dynamoDB;

// Status options for merchants - aligned with business app
const MERCHANT_STATUSES = {
    'pending': { label: 'Pending', class: 'pending', color: '#f59e0b', icon: 'hourglass_empty' },
    'approved': { label: 'Approved', class: 'verified', color: '#10b981', icon: 'check_circle' },
    'rejected': { label: 'Rejected', class: 'rejected', color: '#ef4444', icon: 'cancel' },
    'under-review': { label: 'Under Review', class: 'under-review', color: '#3b82f6', icon: 'assignment' },
    'unknown': { label: 'Unknown', class: 'unknown', color: '#6b7280', icon: 'help_outline' }
};

// Global merchants data
let allMerchants = [];
let merchantsData = [];
let filteredMerchants = [];

// Utility to add a timeout to a promise
function withTimeout(promise, ms, operationName = 'Unnamed operation') {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`'${operationName}' timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => {
        clearTimeout(timeoutId); // Ensure timeout is cleared
    });
}

// Initialize merchants page when DOM is ready
const onDomReady = async function () {
    console.log('🚀 Merchants page DOM loaded - Starting initialization...');
    console.log('DEBUG: Current page URL:', window.location.href);
    console.log('DEBUG: Data service available:', !!window.dataService);
    console.log('DEBUG: AWSUtils available:', !!window.AWSUtils);

    // Check authentication using centralized utility (with debug mode support)
    const debugMode = sessionStorage.getItem('debugMode') === 'true';
    if (!debugMode && !Auth.requireAuthentication()) {
        console.log('❌ Authentication required - redirecting to login');
        return;
    }

    if (debugMode) {
        console.log('🧪 Running in debug mode - authentication bypassed');
    }

    const tableBody = document.getElementById('merchantsTableBody');

    // Early exit if critical element is missing
    if (!tableBody) {
        console.error('CRITICAL: merchantsTableBody element not found! Aborting.');
        return;
    }

    // Always ensure the loader is managed and event listeners are set up.
    try {
        // Protocol check: file:// not supported for fetch
        if (window.location.protocol === 'file:') {
            throw new Error('Page cannot be loaded via file:// protocol. Please use a local HTTP server.');
        }

        // Initialize dashboard UI elements
        if (typeof initializeDashboard === 'function') {
            console.log('Initializing dashboard UI...');
            initializeDashboard();
        } else {
            console.warn('initializeDashboard function not found, skipping.');
        }

        console.log('🎯 Loading merchants directly from DynamoDB');
        showLoader(true, 'Loading merchants...');

        // Check if AWSUtils is available
        if (!window.AWSUtils) {
            throw new Error('AWSUtils is not available. Please ensure aws-utils.js is loaded.');
        }

        console.log('🔐 Initializing AWS...');
        // Initialize AWS using centralized utility
        await AWSUtils.initialize();
        console.log('✅ AWS initialized successfully');

        console.log('📊 Loading merchants from DynamoDB...');
        await loadMerchantsFromDynamoDB();

        if (merchantsData.length > 0) {
            console.log(`🎉 SUCCESS! Loaded ${merchantsData.length} merchants from DynamoDB`);
            filteredMerchants = [...merchantsData];
            renderMerchantsTable();
            updateMerchantStats();
            updateDataSourceIndicator('database', `Loaded ${merchantsData.length} merchants from database`);
            showMessage(`Loaded ${merchantsData.length} merchants from database`, 'success');
            setTimeout(() => hideMessage(), 2000); // Hide after 2 seconds
        } else {
            console.log('⚠️ No merchants found in database.');
            document.getElementById('merchantsTableBody').innerHTML = '<tr><td colspan="9" class="text-center p-8">No merchants found.</td></tr>';
            updateDataSourceIndicator('empty', 'No merchants to display');
            showMessage('No merchants to display.', 'info');
        }

    } catch (error) {
        console.error('❌ Error loading merchants from database:', error);
        document.getElementById('merchantsTableBody').innerHTML = `<tr><td colspan="9" class="text-center p-8 text-red-600 bg-red-50">${error.message}</td></tr>`;
        updateDataSourceIndicator('error', `Error: ${error.message}`);
        showMessage(`Failed to load merchants: ${error.message}`, 'error');
    } finally {
        showLoader(false);
        setupEventListeners();
    }
};

// New: Fetch merchants via backend API
async function fetchMerchantsFromApi() {
    console.log('🔍 Fetching merchants from API endpoint');
    const token = localStorage.getItem('idToken') || localStorage.getItem('accessToken');
    if (!token) throw new Error('No authentication token available');
    updateDataSourceIndicator('loading', 'Fetching merchants from API...');

    const response = await fetch(`${API_BASE_URL}/merchants`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch merchants from API');
    }
    merchantsData = data.merchants || data;
    filteredMerchants = [...merchantsData];
}

// Helper function to update the data source indicator
function updateDataSourceIndicator(status, message) {
    const indicator = document.getElementById('dataSourceIndicator');
    const authIndicator = document.getElementById('authIndicator');
    const loginBtn = document.getElementById('loginBtn');
    const loadRealDataBtn = document.getElementById('loadRealDataBtn');

    if (indicator) {
        indicator.textContent = message;
    }

    if (authIndicator) {
        switch (status) {
            case 'unauthenticated':
                authIndicator.textContent = 'Not Logged In';
                authIndicator.style.backgroundColor = '#ffc107';
                authIndicator.style.color = '#000';
                if (loginBtn) loginBtn.style.display = 'inline-block';
                if (loadRealDataBtn) loadRealDataBtn.style.display = 'none';
                break;
            case 'database':
                authIndicator.textContent = 'Real Data';
                authIndicator.style.backgroundColor = '#28a745';
                authIndicator.style.color = '#fff';
                if (loginBtn) loginBtn.style.display = 'none';
                if (loadRealDataBtn) loadRealDataBtn.style.display = 'none';
                break;
            case 'empty':
                authIndicator.textContent = 'No Data';
                authIndicator.style.backgroundColor = '#6c757d';
                authIndicator.style.color = '#fff';
                if (loginBtn) loginBtn.style.display = 'none';
                if (loadRealDataBtn) loadRealDataBtn.style.display = 'none';
                break;
            case 'error':
                authIndicator.textContent = 'Error';
                authIndicator.style.backgroundColor = '#dc3545';
                authIndicator.style.color = '#fff';
                if (loginBtn) loginBtn.style.display = 'none';
                if (loadRealDataBtn) loadRealDataBtn.style.display = 'none';
                break;
            default:
                authIndicator.textContent = 'Checking...';
                authIndicator.style.backgroundColor = '#007bff';
                authIndicator.style.color = '#fff';
                if (loginBtn) loginBtn.style.display = 'none';
                if (loadRealDataBtn) loadRealDataBtn.style.display = 'none';
        }
    }
}

// Function to refresh merchants data (for refresh button)
async function refreshMerchantsData() {
    showLoader(true, 'Refreshing merchants data...');
    updateDataSourceIndicator('loading', 'Refreshing data from database...');
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    try {
        // Initialize AWS using centralized utility
        await AWSUtils.initialize();
        await loadMerchantsFromDynamoDB();

        if (merchantsData.length > 0) {
            filteredMerchants = [...merchantsData];
            renderMerchantsTable();
            updateMerchantStats();
            updateDataSourceIndicator('database', `Showing ${merchantsData.length} real merchants from database`);
            showMessage(`Refreshed: Loaded ${merchantsData.length} merchants from database`, 'success');
            setTimeout(() => hideMessage(), 3000);
        } else {
            const tableBody = document.getElementById('merchantsTableBody');
            if (tableBody) tableBody.innerHTML = '<tr><td colspan="9" class="text-center p-8">No merchants to display.</td></tr>';
            updateDataSourceIndicator('empty', 'No merchants to display');
            showMessage('No merchants to display.', 'info');
        }
    } catch (error) {
        console.error('Refresh failed:', error);
        if (isLocal) {
            const errorMessage = `Failed to refresh data: ${error.message}. Check console for details.`;
            const tableBody = document.getElementById('merchantsTableBody');
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="9" class="text-center p-8 text-red-600 bg-red-50">${errorMessage}</td></tr>`;
            updateDataSourceIndicator('error', `Refresh Error: ${error.message}`);
            showMessage(errorMessage, 'error');
        } else {
            const tableBody = document.getElementById('merchantsTableBody');
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="9" class="text-center p-8 text-red-600 bg-red-50">Failed to refresh data: ${error.message}</td></tr>`;
            updateDataSourceIndicator('error', `Refresh failed: ${error.message}`);
            showMessage(`Failed to refresh data: ${error.message}`, 'error');
        }
    } finally {
        showLoader(false);
    }
}

// Export for global access
window.refreshMerchantsData = refreshMerchantsData;
window.onDomReady = onDomReady;

// Load merchants data from DynamoDB using AWS SDK
async function loadMerchantsFromDynamoDB() {
    console.log('DEBUG: Executing DynamoDB scan on WhizzMerchants_Businesses...');
    console.log('DEBUG: MERCHANTS_TABLE constant value:', MERCHANTS_TABLE);

    // Use centralized AWS utilities
    const dynamoDB = await AWSUtils.getDynamoDBClient();
    console.log('DEBUG: DynamoDB client obtained:', !!dynamoDB);

    const params = {
        TableName: 'WhizzMerchants_Businesses',
    };

    console.log('DEBUG: DynamoDB scan params:', params);

    try {
        const data = await withTimeout(
            dynamoDB.scan(params).promise(),
            10000,
            'DynamoDB scan'
        );
        console.log('DynamoDB scan result:', data);

        if (data && Array.isArray(data.Items)) {
            merchantsData = data.Items.map(item => ({
                id: item.businessId || item.id || `merchant-${Date.now()}-${Math.random()}`,
                name: item.businessName || item.name || item.title || 'Unknown Business',
                email: item.email || item.businessEmail || 'N/A',
                phone: item.phoneNumber || item.phone || item.businessPhone || 'N/A',
                category: mapBusinessType(item.businessType || item.category) || 'Other',
                // Updated status detection - use isActive for status since there's no status field
                status: item.status || (item.isActive === false ? 'pending' : (item.isActive === true ? 'approved' : 'unknown')),
                isActive: item.isActive !== undefined ? item.isActive : true,
                // Updated address handling for the actual table structure with proper fallbacks
                address: buildAddressFromData(item),
                owner: item.ownerName || item.owner || item.contactName || 'N/A',
                joinDate: item.createdAt ? formatDate(item.createdAt) : (item.dateCreated ? formatDate(item.dateCreated) : 'N/A'),
                avatar: item.businessPhotoUrl || item.ownerPhotoUrl || item.avatar || item.logo || generateAvatarUrl(item.businessName || item.name),
                description: item.description || item.businessDescription || '',
                website: item.website || item.businessWebsite || '',
                // Additional fields specific to WhizzMerchants_Businesses table
                businessType: item.businessType || 'Unknown',
                cognitoUserId: item.cognitoUserId || item.ownerId || 'N/A',
                acceptingOrders: item.acceptingOrders !== undefined ? item.acceptingOrders : false,
                onlineStatus: item.onlineStatus || (item.acceptingOrders ? 'online' : 'offline'),
                latitude: item.latitude || null,
                longitude: item.longitude || null,
                city: item.city || 'N/A',
                district: item.district || 'N/A',
                country: item.country || 'N/A',
                lastStatusUpdate: item.lastStatusUpdate || item.updatedAt || null,
                fullData: item
            }));

            console.log(`✅ Successfully loaded and mapped ${merchantsData.length} merchants from WhizzMerchants_Businesses!`);
            console.log('📊 Summary of loaded merchants:');
            merchantsData.forEach((merchant, index) => {
                console.log(`   ${index + 1}. ${merchant.name} (${merchant.id}) - Status: ${merchant.status}, Address: ${merchant.address}`);
            });

            console.log('Final merchants data for rendering:', merchantsData);
            return;
        } else {
            console.log('No merchants found in DynamoDB');
            showMessage('The database is currently empty. No merchants to display.', 'info');
            merchantsData = [];
            return;
        }
    } catch (error) {
        console.error('Error loading merchants from DynamoDB:', error);
        // Provide a more specific error message if it's a credential issue.
        if (error.code === 'CredentialsError' || error.message.includes('Missing credentials')) {
            throw new Error('Failed to obtain AWS credentials. Please check the Identity Pool configuration and ensure the auth token is valid.');
        }
        throw error;
    }
}

// Helper function to map business types to display categories
function mapBusinessType(businessType) {
    const typeMap = {
        'restaurant': 'Restaurant',
        'store': 'Grocery Store',
        'cafe': 'Cafe',
        'cloudkitchen': 'Cloud Kitchen',
        'pharmacy': 'Pharmacy',
        'retail': 'Retail'
    };
    return typeMap[businessType] || 'Other';
}

// Build address display string from item data (handles both formats and complex nested structure)
function buildAddressFromData(item) {
    console.log('Building address from item data:', item);

    // First, try to use the direct address string if available
    if (item.address && typeof item.address === 'string') {
        console.log('Using direct address string:', item.address);
        return item.address;
    }

    // Then try to build from individual fields
    const parts = [];
    if (item.street) parts.push(item.street);
    if (item.district) parts.push(item.district);
    if (item.city) parts.push(item.city);
    if (item.country) parts.push(item.country);

    if (parts.length > 0) {
        const address = parts.join(', ');
        console.log('Built address from individual fields:', address);
        return address;
    }

    // Try to extract from address_components object (complex nested format)
    if (item.address_components && typeof item.address_components === 'object') {
        const components = item.address_components;
        const addressParts = [];

        // Handle simple nested structure like { "country": { "S": "Iraq" } }
        if (components.street && components.street.S) addressParts.push(components.street.S);
        if (components.district && components.district.S) addressParts.push(components.district.S);
        if (components.city && components.city.S) addressParts.push(components.city.S);
        if (components.country && components.country.S) addressParts.push(components.country.S);

        // Handle more complex nested structure like { "country": { "M": { "S": { "S": "Iraq" } } } }
        if (!addressParts.length) {
            try {
                const extractValue = (obj) => {
                    if (typeof obj === 'string') return obj;
                    if (obj && obj.S && typeof obj.S === 'string') return obj.S;
                    if (obj && obj.M && obj.M.S && obj.M.S.S) return obj.M.S.S;
                    return null;
                };

                const street = extractValue(components.street);
                const district = extractValue(components.district);
                const city = extractValue(components.city);
                const country = extractValue(components.country);

                if (street) addressParts.push(street);
                if (district) addressParts.push(district);
                if (city) addressParts.push(city);
                if (country) addressParts.push(country);
            } catch (e) {
                console.warn('Error parsing complex address components:', e);
            }
        }

        if (addressParts.length > 0) {
            const address = addressParts.join(', ');
            console.log('Built address from address_components:', address);
            return address;
        }
    }

    console.log('No address data found, using default');
    return 'Address not available';
}

// Build address display string from individual fields (legacy function for compatibility)
function buildAddressFromIndividualFields(street, city, district, country) {
    console.log('Building address from individual fields:', { street, city, district, country });

    const parts = [];
    if (street) parts.push(street);
    if (district) parts.push(district);
    if (city) parts.push(city);
    if (country) parts.push(country);

    const address = parts.length > 0 ? parts.join(', ') : 'Address not available';
    console.log('Built address:', address);
    return address;
}

// Helper function to format dates
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        // Attempt to parse the date
        const date = new Date(dateString);
        // Check if the date is valid
        if (isNaN(date.getTime())) {
            return dateString; // Return original string if it's not a valid date
        }
        // Format to a more readable string e.g., "Jan 15, 2024"
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (e) {
        console.warn(`Could not parse date: ${dateString}`);
        return dateString; // Return original string if parsing fails
    }
}

// Generate avatar URL
function generateAvatarUrl(name) {
    if (!name) return 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=40&h=40&fit=crop&crop=center';
    const encodedName = encodeURIComponent(name);
    return `https://ui-avatars.com/api/?name=${encodedName}&size=40&background=random&color=fff`;
}

// Helper to display messages in the UI
function showMessage(message, type = 'info') {
    const statusElement = document.getElementById('merchants-table-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `table-status-info table-status-${type}`;
        statusElement.style.display = 'block';
    }
}

// Helper to hide messages
function hideMessage() {
    const statusElement = document.getElementById('merchants-table-status');
    if (statusElement) {
        statusElement.style.display = 'none';
    }
}

// Show/hide loader
function showLoader(show, message = 'Loading...') {
    const loader = document.getElementById('loader');
    const loaderMessage = document.getElementById('loader-message');
    if (loader) {
        loader.style.display = show ? 'flex' : 'none';
        if (show && loaderMessage) {
            loaderMessage.textContent = message;
        }
    } else {
        // This is not a critical error, but good to know for debugging UI.
        // console.warn('#loader element not found in the DOM.');
    }
}

// Dummy function to avoid errors if it's missing.
// In a real app, this would handle search, filters, etc.
function setupEventListeners() {
    console.log('Setting up event listeners (search, filters, etc.)...');

    // Product view navigation buttons
    const backToMerchantsBtn = document.getElementById('backToMerchantsBtn');
    if (backToMerchantsBtn) {
        backToMerchantsBtn.addEventListener('click', backToMerchantsList);
    }
    const refreshProductsBtn = document.getElementById('refreshProductsBtn');
    if (refreshProductsBtn) {
        refreshProductsBtn.addEventListener('click', refreshMerchantProducts);
    }

    // Centralized Edit Merchant Form listeners
    const editForm = document.getElementById('editMerchantForm');
    if (editForm) {
        // Handle form submission
        editForm.addEventListener('submit', handleEditFormSubmission);

        // Handle status changes to show/hide the reason field
        const statusSelect = editForm.querySelector('#editStatus');
        const reasonSection = editForm.querySelector('#statusReasonSection');
        const reasonTextarea = editForm.querySelector('#editStatusReason');

        if (statusSelect && reasonSection && reasonTextarea) {
            statusSelect.addEventListener('change', function () {
                const originalStatus = editForm.getAttribute('data-original-status');
                const newStatus = this.value;
                const statusChanged = newStatus !== originalStatus && newStatus !== '';

                if (statusChanged) {
                    reasonSection.style.display = 'block';
                    reasonTextarea.required = true;

                    // Add visual indicator that status changed
                    statusSelect.style.borderColor = '#f59e0b';
                    statusSelect.style.backgroundColor = '#fef3c7';

                    // Auto-focus the reason field
                    setTimeout(() => reasonTextarea.focus(), 100);
                } else {
                    reasonSection.style.display = 'none';
                    reasonTextarea.required = false;
                    reasonTextarea.value = '';

                    // Reset status field styling
                    statusSelect.style.borderColor = '#d1d5db';
                    statusSelect.style.backgroundColor = 'white';
                }
            });
        }
    }
}

// Render the merchants table with the provided data
function renderMerchantsTable() {
    const tableBody = document.getElementById('merchantsTableBody');
    if (!tableBody) {
        console.error('Cannot render table: tbody element not found.');
        return;
    }

    if (filteredMerchants.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center p-8">No merchants match the current filters.</td></tr>';
        return;
    }

    const rows = filteredMerchants.map(merchant => {
        const statusInfo = MERCHANT_STATUSES[merchant.status] || MERCHANT_STATUSES['unknown'];

        // Use the address that was already built from individual fields
        let displayAddress = merchant.address || 'N/A';

        // SECURITY: Sanitize all user-generated content to prevent XSS
        const safeName = SecurityUtils.escapeHTML(merchant.name || 'N/A');
        const safeOwner = SecurityUtils.escapeHTML(merchant.owner || 'N/A');
        const safeCategory = SecurityUtils.escapeHTML(merchant.category || 'Business');
        const safeCity = SecurityUtils.escapeHTML(merchant.city || 'Unknown City');
        const safeEmail = SecurityUtils.escapeHTML(merchant.email || 'N/A');
        const safePhone = SecurityUtils.escapeHTML(merchant.phone || 'N/A');
        const safeAddress = SecurityUtils.escapeHTML(displayAddress);
        const safeAvatar = SecurityUtils.sanitizeURL(merchant.avatar);
        const safeId = SecurityUtils.escapeHTML(merchant.id || '');
        const safeStatus = SecurityUtils.escapeHTML(merchant.status || 'unknown');
        const safeStatusLabel = SecurityUtils.escapeHTML(statusInfo.label);

        // Format accepting orders status
        const acceptingOrdersStatus = merchant.acceptingOrders ?
            '<span class="status-badge approved" style="background-color: #10b98120; color: #10b981;">Accepting</span>' :
            '<span class="status-badge pending" style="background-color: #f59e0b20; color: #f59e0b;">Not Accepting</span>';

        // Format last update time
        const lastUpdate = merchant.lastStatusUpdate ?
            new Date(merchant.lastStatusUpdate).toLocaleDateString() :
            (merchant.joinDate !== 'N/A' ? merchant.joinDate : 'N/A');
        const safeLastUpdate = SecurityUtils.escapeHTML(lastUpdate);

        return `
            <tr data-merchant-row="${safeId}">
                <td>
                    <div class="business-info">
                        <img src="${safeAvatar}" alt="${safeName}" class="business-avatar" loading="lazy">
                        <div class="business-details">
                            <h4>${safeName}</h4>
                            <p>${safeCategory} • ${safeCity}</p>
                        </div>
                    </div>
                </td>
                <td>${safeOwner}</td>
                <td>
                    <span class="status-badge ${statusInfo.class}" style="background-color: ${statusInfo.color}20; color: ${statusInfo.color};">
                        ${safeStatusLabel}
                    </span>
                </td>
                <td>${acceptingOrdersStatus}</td>
                <td>${safeEmail}</td>
                <td>${safePhone}</td>
                <td><div class="address-info">${safeAddress}</div></td>
                <td>${safeLastUpdate}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action" data-action="view-details" data-id="${safeId}" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-view-products" data-action="view-products" data-id="${safeId}" title="View Products">
                            <i class="fas fa-box"></i>
                        </button>
                        <button class="btn-action" data-action="edit" data-id="${safeId}" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-toggle-status ${merchant.status === 'approved' ? 'approved' : 'pending'}" 
                                data-action="toggle-status" data-id="${safeId}" data-status="${safeStatus}" 
                                title="${merchant.status === 'approved' ? 'Suspend Merchant' : 'Approve Merchant'}">
                            <i class="fas ${merchant.status === 'approved' ? 'fa-pause' : 'fa-check'}"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tableBody.innerHTML = SecurityUtils.sanitizeHTML(rows);
    attachMerchantsDelegatedEvents();
}

// Delegated events for merchants table to remove inline handlers (CSP friendly)
function attachMerchantsDelegatedEvents() {
    const tableBody = document.getElementById('merchantsTableBody');
    if (!tableBody || tableBody.dataset.eventsAttached === 'true') return;
    tableBody.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (!id || !action) return;
        switch (action) {
            case 'view-details':
                viewMerchantDetails(id);
                break;
            case 'view-products':
                viewMerchantProducts(id);
                break;
            case 'edit':
                editMerchant(id);
                break;
            case 'toggle-status':
                toggleMerchantStatus(id); // current status determined inside
                break;
        }
    });
    tableBody.dataset.eventsAttached = 'true';
}

// Update dashboard stats based on loaded merchants
function updateMerchantStats() {
    const totalMerchants = document.getElementById('total-merchants');
    const approvedMerchants = document.getElementById('approved-merchants');
    const pendingMerchants = document.getElementById('pending-merchants');
    const newThisMonth = document.getElementById('new-this-month');

    if (totalMerchants) totalMerchants.textContent = merchantsData.length;
    if (approvedMerchants) approvedMerchants.textContent = merchantsData.filter(m => m.status === 'approved').length;
    if (pendingMerchants) pendingMerchants.textContent = merchantsData.filter(m => m.status === 'pending' || m.status === 'under_review').length;

    const thisMonthCount = merchantsData.filter(m => {
        const joinDate = new Date(m.joinDate);
        const today = new Date();
        return joinDate.getMonth() === today.getMonth() && joinDate.getFullYear() === today.getFullYear();
    }).length;

    if (newThisMonth) newThisMonth.textContent = thisMonthCount;
}

// Toggle merchant status between approved and pending
async function toggleMerchantStatus(merchantId, legacyStatusParam) {
    // Determine current status from data arrays if not explicitly passed
    let merchant = merchantsData.find(m => m.id === merchantId) || filteredMerchants.find(m => m.id === merchantId);
    if (!merchant) {
        console.warn('toggleMerchantStatus: merchant not found', merchantId);
        return;
    }
    const currentStatus = legacyStatusParam || merchant.status || 'pending';
    console.log(`🔄 Toggling status for merchant ${merchantId} from ${currentStatus}`);
    try {
        // Find button via data attributes
        const button = document.querySelector(`button[data-action="toggle-status"][data-id="${merchantId}"]`);
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }
        const newStatus = currentStatus === 'approved' ? 'pending' : 'approved';
        const newIsActive = newStatus === 'approved';
        console.log(`📝 Updating merchant ${merchantId} to status: ${newStatus}, isActive: ${newIsActive}`);
        const dynamoDB = await AWSUtils.getDynamoDBClient();
        const updateParams = {
            TableName: 'WhizzMerchants_Businesses',
            Key: { businessId: merchantId },
            UpdateExpression: 'SET #status = :status, #isActive = :isActive, #lastStatusUpdate = :timestamp, #statusUpdatedBy = :updatedBy, #statusSource = :source',
            ExpressionAttributeNames: {
                '#status': 'status',
                '#isActive': 'isActive',
                '#lastStatusUpdate': 'lastStatusUpdate',
                '#statusUpdatedBy': 'statusUpdatedBy',
                '#statusSource': 'statusSource'
            },
            ExpressionAttributeValues: {
                ':status': newStatus,
                ':isActive': newIsActive,
                ':timestamp': new Date().toISOString(),
                ':updatedBy': sessionStorage.getItem('userEmail') || 'admin',
                ':source': 'admin_dashboard'
            },
            ReturnValues: 'ALL_NEW'
        };
        const result = await dynamoDB.update(updateParams).promise();
        console.log('✅ Status update successful:', result);
        // Update local objects
        merchant.status = newStatus;
        merchant.isActive = newIsActive;
        const globalIdx = merchantsData.findIndex(m => m.id === merchantId); if (globalIdx !== -1) { merchantsData[globalIdx].status = newStatus; merchantsData[globalIdx].isActive = newIsActive; }
        const filteredIdx = filteredMerchants.findIndex(m => m.id === merchantId); if (filteredIdx !== -1) { filteredMerchants[filteredIdx].status = newStatus; filteredMerchants[filteredIdx].isActive = newIsActive; }
        renderMerchantsTable();
        updateMerchantStats();
        showMessage(`Merchant status updated to ${newStatus} successfully!`, 'success');
        setTimeout(() => hideMessage(), 3000);
    } catch (error) {
        console.error('❌ Error updating merchant status:', error);
        const button = document.querySelector(`button[data-action="toggle-status"][data-id="${merchantId}"]`);
        if (button) {
            button.disabled = false;
            const icon = (merchant.status === 'approved') ? 'fa-pause' : 'fa-check';
            button.innerHTML = `<i class="fas ${icon}"></i>`;
        }
        showMessage(`Error: ${error.message || 'Failed to update merchant status'}`, 'error');
        setTimeout(() => hideMessage(), 5000);
    }
}

// Modal functions for merchant management
function viewMerchantDetails(merchantId) {
    const merchant = filteredMerchants.find(m => m.id === merchantId);
    if (!merchant) {
        console.error('Merchant not found:', merchantId);
        return;
    }

    // Use the address that was already built from individual fields
    let displayAddress = merchant.address || 'Not provided';

    // SECURITY: Sanitize all user-generated content for modal display
    const safeName = SecurityUtils.escapeHTML(merchant.name || 'N/A');
    const safeCategory = SecurityUtils.escapeHTML(merchant.category || 'Business');
    const safeOwner = SecurityUtils.escapeHTML(merchant.owner || 'N/A');
    const safeEmail = SecurityUtils.escapeHTML(merchant.email || 'N/A');
    const safePhone = SecurityUtils.escapeHTML(merchant.phone || 'N/A');
    const safeAddress = SecurityUtils.escapeHTML(displayAddress);
    const safeAvatar = SecurityUtils.sanitizeURL(merchant.avatar);
    const safeStatusLabel = SecurityUtils.escapeHTML(MERCHANT_STATUSES[merchant.status]?.label || 'Unknown');

    const modalBody = document.getElementById('merchantDetailsBody');
    if (modalBody) {
        modalBody.innerHTML = SecurityUtils.sanitizeHTML(`
            <div style="display: grid; gap: 1rem;">
                <div style="display: flex; align-items: center; gap: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
                    <img src="${safeAvatar}" alt="${safeName}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover;">
                    <div>
                        <h4 style="margin: 0; color: #1e293b;">${safeName}</h4>
                        <p style="margin: 0; color: #64748b; font-size: 0.9rem;">${safeCategory}</p>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div><strong>Owner:</strong> ${safeOwner}</div>
                    <div><strong>Status:</strong> <span class="status-badge ${MERCHANT_STATUSES[merchant.status]?.class || 'unknown'}">${safeStatusLabel}</span></div>
                    <div><strong>Email:</strong> ${safeEmail}</div>
                    <div><strong>Phone:</strong> ${safePhone}</div>
                    <div style="grid-column: 1 / -1;"><strong>Address:</strong> ${safeAddress}</div>
                    <div><strong>Join Date:</strong> ${merchant.joinDate ? new Date(merchant.joinDate).toLocaleDateString() : 'N/A'}</div>
                    <div><strong>Commission:</strong> ${merchant.commission || 0}%</div>
                </div>
            </div>
        `);

        document.getElementById('viewMerchantModal').style.display = 'flex';
    }
}

function editMerchant(merchantId) {
    const merchant = filteredMerchants.find(m => m.id === merchantId);
    if (!merchant) {
        console.error('Merchant not found:', merchantId);
        showEditFormMessage('Merchant not found', 'error');
        return;
    }

    console.log('Editing merchant:', merchant.name || merchant.businessName);
    console.log('Merchant data:', merchant);
    console.log('Merchant status:', merchant.status);

    // Clear any previous messages
    hideEditFormMessage();

    // Populate form fields with current merchant data
    populateEditForm(merchant);

    // Store the merchant ID for submission
    document.getElementById('editMerchantForm').setAttribute('data-merchant-id', merchantId);

    // Show the modal
    document.getElementById('editMerchantModal').style.display = 'flex';
}

// Product view functions
let currentMerchantId = null;
let merchantProducts = [];
let categoryMap = {};

function viewMerchantProducts(merchantId) {
    const merchant = filteredMerchants.find(m => m.id === merchantId);
    if (!merchant) {
        console.error('Merchant not found:', merchantId);
        alert('Merchant not found. Please refresh the page and try again.');
        return;
    }

    console.log('Viewing products for merchant:', merchant.name || merchant.businessName);
    currentMerchantId = merchantId;

    // Hide merchants list view
    document.getElementById('merchantsListView').style.display = 'none';

    // Show products view
    document.getElementById('merchantProductsView').style.display = 'block';

    // Update page title
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) {
        pageTitle.textContent = 'Merchant Products';
    }

    // Update merchant info in header
    const merchantName = merchant.name || merchant.businessName || 'Unknown Business';
    const merchantDetails = [merchant.email, merchant.phone].filter(Boolean).join(' • ') || 'No contact details';

    document.getElementById('selectedMerchantName').textContent = merchantName;
    document.getElementById('selectedMerchantDetails').textContent = merchantDetails;

    // Load products
    loadMerchantProducts(merchantId);
}

function backToMerchantsList() {
    // Hide products view
    document.getElementById('merchantProductsView').style.display = 'none';

    // Show merchants list view
    document.getElementById('merchantsListView').style.display = 'block';

    // Update page title
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) {
        pageTitle.textContent = 'Merchants Management';
    }

    // Clear current merchant
    currentMerchantId = null;
    merchantProducts = [];
}

async function loadMerchantProducts(merchantId) {
    const statusElement = document.getElementById('productsStatus');
    const statusText = document.getElementById('productsStatusText');
    const container = document.getElementById('merchantProductsContainer');

    // Show loading status
    if (statusElement && statusText) {
        statusText.textContent = 'Loading products...';
        statusElement.style.display = 'block';
        statusElement.style.borderLeftColor = '#007bff';
    }

    if (container) {
        container.innerHTML = '<div class="loading-message" style="text-align: center; padding: 2rem; color: #6b7280;"><i class="fas fa-spinner fa-spin"></i> Loading products...</div>';
    }

    try {
        // Use API endpoints instead of direct DynamoDB access
        const idToken = localStorage.getItem('idToken');

        // Load categories first
        const categoriesResponse = await fetch(`${window.WIZZCENTRAL_CONFIG.API_BASE_URL}/categories`, {
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!categoriesResponse.ok) {
            throw new Error(`Failed to load categories: ${categoriesResponse.status}`);
        }

        const categoriesResult = await categoriesResponse.json();
        if (!categoriesResult.success) {
            throw new Error(categoriesResult.error?.message || 'Failed to load categories');
        }

        categoryMap = categoriesResult.data.categories || {};

        // Load products for this merchant using API
        const businessId = merchantId; // Use the merchant ID directly
        console.log(`Loading products for businessId: ${businessId}`);

        const productsResponse = await fetch(`${window.WIZZCENTRAL_CONFIG.API_BASE_URL}/merchants/${businessId}/products`, {
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!productsResponse.ok) {
            throw new Error(`Failed to load products: ${productsResponse.status}`);
        }

        const productsResult = await productsResponse.json();
        if (!productsResult.success) {
            throw new Error(productsResult.error?.message || 'Failed to load products');
        }

        merchantProducts = productsResult.data.products || [];

        console.log(`Loaded ${merchantProducts.length} products for merchant ${merchantId}`);

        // Log sample product for debugging
        if (merchantProducts.length > 0) {
            console.log('Sample product:', merchantProducts[0]);
        }

        // Update status
        if (statusElement && statusText) {
            if (merchantProducts.length > 0) {
                statusText.textContent = `Found ${merchantProducts.length} products`;
                statusElement.style.borderLeftColor = '#28a745';
            } else {
                statusText.textContent = 'No products found for this merchant';
                statusElement.style.borderLeftColor = '#ffc107';
            }
        }

        // Render products
        renderMerchantProducts();

    } catch (error) {
        console.error('Error loading merchant products:', error);

        if (statusElement && statusText) {
            statusText.textContent = `Error loading products: ${error.message}`;
            statusElement.style.borderLeftColor = '#dc3545';
        }

        if (container) {
            container.innerHTML = `
                <div class="no-products-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Error Loading Products</h3>
                    <p>${error.message}</p>
                    <button onclick="loadMerchantProducts('${merchantId}')" class="btn-primary" style="margin-top: 1rem;">
                        <i class="fas fa-redo"></i> Try Again
                    </button>
                    <button onclick="backToMerchantsList()" class="btn-secondary" style="margin-top: 1rem; margin-left: 0.5rem;">
                        <i class="fas fa-arrow-left"></i> Back to Merchants
                    </button>
                </div>
            `;
        }
    }
}

function renderMerchantProducts() {
    const container = document.getElementById('merchantProductsContainer');
    if (!container) return;

    if (merchantProducts.length === 0) {
        const merchant = filteredMerchants.find(m => m.id === currentMerchantId);
        const merchantName = merchant ? (merchant.name || merchant.businessName || 'this merchant') : 'this merchant';

        container.innerHTML = `
            <div class="no-products-message">
                <i class="fas fa-box-open"></i>
                <h3>No Products Found</h3>
                <p>${merchantName} hasn't added any products yet.</p>
                <p style="font-size: 0.9rem; color: #6b7280; margin-top: 1rem;">
                    Products will appear here once the merchant adds them to their inventory.
                </p>
            </div>
        `;
        return;
    }

    // Group products by category
    const groupedProducts = merchantProducts.reduce((acc, product) => {
        const categoryId = product.categoryId || product.category_id || 'uncategorized';
        if (!acc[categoryId]) {
            acc[categoryId] = [];
        }
        acc[categoryId].push(product);
        return acc;
    }, {});

    // Sort categories - put 'uncategorized' last
    const sortedCategories = Object.keys(groupedProducts).sort((a, b) => {
        if (a === 'uncategorized') return 1;
        if (b === 'uncategorized') return -1;
        return (categoryMap[a] || 'Unknown').localeCompare(categoryMap[b] || 'Unknown');
    });

    // Render each category section
    let html = '';
    for (const categoryId of sortedCategories) {
        const categoryName = categoryMap[categoryId] || categoryId;
        const safeCategoryName = SecurityUtils.escapeHTML(categoryName);
        const products = groupedProducts[categoryId];
        
        html += `
            <div class="product-category-section">
                <h3 class="product-category-title">${safeCategoryName} (${products.length} items)</h3>
                <div class="products-grid">
                    ${products.map(product => {
                        // SECURITY: Sanitize product data
                        const safeName = SecurityUtils.escapeHTML(product.name || 'Unnamed Product');
                        const safeDescription = SecurityUtils.escapeHTML(product.description || '');
                        const safeImageUrl = SecurityUtils.sanitizeURL(product.image_url || 'https://via.placeholder.com/150');
                        const safeProductId = SecurityUtils.escapeHTML(product.productId || '');
                        
                        return `
                        <div class="product-card">
                            <img src="${safeImageUrl}" alt="${safeName}" class="product-image">
                            <div class="product-info">
                                <h4 class="product-name">${safeName}</h4>
                                <p class="product-description">${safeDescription}</p>
                                <div class="product-price-and-actions">
                                    <span class="product-price">$${product.price}</span>
                                    <div class="product-actions">
                                        <button class="btn-action btn-edit-product" onclick="editProduct('${safeProductId}')" title="Edit Product">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    container.innerHTML = SecurityUtils.sanitizeHTML(html);
}

function refreshMerchantProducts() {
    if (currentMerchantId) {
        loadMerchantProducts(currentMerchantId);
    }
}

function editProduct(productId) {
    const product = merchantProducts.find(p => p.productId === productId);
    if (!product) {
        console.error('Product not found:', productId);
        alert('Product not found. Please refresh and try again.');
        return;
    }

    console.log('Editing Product:', product);

    // Populate the form
    document.getElementById('editProductId').value = product.productId;
    document.getElementById('editProductName').value = product.name || '';
    document.getElementById('editProductNameAr').value = product.name_ar || '';
    document.getElementById('editProductDescription').value = product.description || '';
    document.getElementById('editProductDescriptionAr').value = product.description_ar || '';
    document.getElementById('editProductAllergens').value = (product.allergens || []).join(', ');
    document.getElementById('editProductIngredients').value = (product.ingredients || []).join(', ');
    document.getElementById('editProductPrice').value = product.price;
    document.getElementById('editProductPreparationTime').value = product.preparation_time || 0;
    document.getElementById('editProductIsAvailable').checked = product.is_available;
    document.getElementById('editProductImageUrl').value = product.image_url || '';

    // Populate category dropdown
    const categorySelect = document.getElementById('editProductCategory');
    categorySelect.innerHTML = ''; // Clear existing options
    for (const categoryId in categoryMap) {
        const option = document.createElement('option');
        option.value = categoryId;
        option.textContent = categoryMap[categoryId];
        if (categoryId === product.categoryId || categoryId === product.category_id) {
            option.selected = true;
        }
        categorySelect.appendChild(option);
    }

    // Show the modal
    document.getElementById('editProductModal').style.display = 'flex';

    // Add form submission listener
    const editForm = document.getElementById('editProductForm');
    // To prevent multiple listeners, we clone and replace the element
    const newForm = editForm.cloneNode(true);
    editForm.parentNode.replaceChild(newForm, editForm);
    newForm.addEventListener('submit', handleEditProductFormSubmit);
}

async function handleEditProductFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const productId = form.querySelector('#editProductId').value;
    const submitButton = form.querySelector('button[type="submit"]');
    const messageElement = document.getElementById('editProductFormMessage');

    const updatedProductData = {
        name: form.querySelector('#editProductName').value,
        name_ar: form.querySelector('#editProductNameAr').value,
        description: form.querySelector('#editProductDescription').value,
        description_ar: form.querySelector('#editProductDescriptionAr').value,
        price: parseFloat(form.querySelector('#editProductPrice').value),
        categoryId: form.querySelector('#editProductCategory').value,
        preparation_time: parseInt(form.querySelector('#editProductPreparationTime').value, 10),
        is_available: form.querySelector('#editProductIsAvailable').checked,
        image_url: form.querySelector('#editProductImageUrl').value,
        allergens: form.querySelector('#editProductAllergens').value.split(',').map(s => s.trim()).filter(Boolean),
        ingredients: form.querySelector('#editProductIngredients').value.split(',').map(s => s.trim()).filter(Boolean),
    };

    console.log('Submitting updated product data:', updatedProductData);
    submitButton.disabled = true;
    submitButton.textContent = 'Saving...';
    messageElement.style.display = 'none';

    try {
        const idToken = localStorage.getItem('idToken');
        const response = await fetch(`${window.WIZZCENTRAL_CONFIG.API_BASE_URL}/merchants/${currentMerchantId}/products/${productId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedProductData)
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            // Use detailed error message if provided by API
            const errMsg = result.error?.message || result.message || 'Failed to update merchant on the server.';
            throw new Error(errMsg);
        }

        messageElement.textContent = 'Product updated successfully!';
        messageElement.className = 'form-message success';
        messageElement.style.display = 'block';

        // Hide modal and refresh products list after a short delay
        setTimeout(() => {
            document.getElementById('editProductModal').style.display = 'none';
            refreshMerchantProducts();
        }, 1500);

    } catch (error) {
        console.error('Error updating product:', error);
        messageElement.textContent = `Error: ${error.message}`;
        messageElement.className = 'form-message error';
        messageElement.style.display = 'block';
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Save Changes';
    }
}

function populateEditForm(merchant) {
    // Basic information - map to correct DynamoDB field names
    document.getElementById('editBusinessName').value = merchant.businessName || merchant.name || '';
    document.getElementById('editOwnerName').value = merchant.ownerName || merchant.owner || '';
    document.getElementById('editEmail').value = merchant.email || '';
    document.getElementById('editPhoneNumber').value = merchant.phoneNumber || merchant.phone || '';

    // Address details - populate from merchant.fullData with fallback to nested address
    const raw = merchant.fullData || {};
    document.getElementById('editStreet').value = raw.street || raw.address?.street || '';
    document.getElementById('editCity').value = raw.city || raw.address?.city || '';
    document.getElementById('editDistrict').value = raw.district || raw.address?.district || '';
    document.getElementById('editCountry').value = raw.country || raw.address?.country || 'Iraq'; // Default to Iraq

    // Business type - use exact DynamoDB values
    document.getElementById('editBusinessType').value = merchant.businessType?.toLowerCase() || 'restaurant';

    // Dynamically populate status dropdown first
    const statusSelect = document.getElementById('editStatus');
    const currentStatus = merchant.status || 'pending';

    console.log('Setting up status dropdown for merchant:', merchant.name || merchant.businessName);
    console.log('Current merchant status from DynamoDB:', currentStatus);

    statusSelect.innerHTML = ''; // Clear existing options

    // Add all possible statuses
    for (const statusKey in MERCHANT_STATUSES) {
        if (MERCHANT_STATUSES.hasOwnProperty(statusKey) && statusKey !== 'unknown') {
            const option = document.createElement('option');
            option.value = statusKey;
            option.textContent = MERCHANT_STATUSES[statusKey].label;
            statusSelect.appendChild(option);

            console.log('Added status option:', statusKey, '->', MERCHANT_STATUSES[statusKey].label);
        }
    }

    // Set the current status as selected
    statusSelect.value = currentStatus;
    console.log('Status dropdown value set to:', statusSelect.value);
    console.log('Selected option text:', statusSelect.options[statusSelect.selectedIndex]?.text);

    // Store original status for comparison
    document.getElementById('editMerchantForm').setAttribute('data-original-status', currentStatus);

    // Reset status change UI elements each time the form is populated
    const reasonSection = document.getElementById('statusReasonSection');
    const statusSelectField = document.getElementById('editStatus');
    if (reasonSection) {
        reasonSection.style.display = 'none';
    }
    if (statusSelectField) {
        statusSelectField.style.borderColor = '#d1d5db';
        statusSelectField.style.backgroundColor = 'white';
    }
    document.getElementById('editStatusReason').value = '';
}

// This function is no longer needed.
/* function setupStatusChangeHandler() { ... } */

// This function is no longer needed.
/* function setupEditFormSubmission() { ... } */

async function handleEditFormSubmission(event) {
    event.preventDefault();
    // The form is the direct target of the submit event.
    const form = event.target;
    const merchantId = form.getAttribute('data-merchant-id');
    const submitButton = form.querySelector('button[type="submit"]');

    if (!merchantId) {
        showEditFormMessage('Error: Merchant ID is missing.', 'error');
        return;
    }

    // Show loading state
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    showEditFormMessage('Updating merchant...', 'info');

    const originalStatus = form.getAttribute('data-original-status');
    const newStatus = document.getElementById('editStatus').value;
    // Trim the value to remove any leading/trailing whitespace.
    const statusReason = document.getElementById('editStatusReason').value.trim();

    const statusChanged = originalStatus !== newStatus;

    if (statusChanged && (!statusReason || statusReason.length < 10)) {
        showEditFormMessage('A reason of at least 10 characters is required for status changes.', 'error');
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = 'Save Changes';
        }
        return;
    }

    const updatedMerchantData = {
        businessName: document.getElementById('editBusinessName').value,
        ownerName: document.getElementById('editOwnerName').value,
        email: document.getElementById('editEmail').value,
        phoneNumber: document.getElementById('editPhoneNumber').value,
        businessType: document.getElementById('editBusinessType').value,
        status: newStatus,
        // Include status change details if applicable
        ...(statusChanged && { statusChangeReason: statusReason })
    };

    try {
        const idToken = localStorage.getItem('idToken');
        if (!idToken) {
            throw new Error('Authentication token not found.');
        }

        const response = await fetch(`${window.WIZZCENTRAL_CONFIG.API_BASE_URL}/merchants/${merchantId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedMerchantData)
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            // Use detailed error message if provided by API
            const errMsg = result.error?.message || result.message || 'Failed to update merchant on the server.';
            throw new Error(errMsg);
        }

        showEditFormMessage('Merchant updated successfully!', 'success');

        // Close modal and refresh data after a short delay
        setTimeout(() => {
            closeModal('editMerchantModal');
            refreshMerchantsData(); // This will refresh the main table
        }, 1500);

    } catch (error) {
        console.error('Error updating merchant:', error);
        showEditFormMessage(`Update failed: ${error.message}`, 'error');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = 'Save Changes';
        }
    }
}

function showEditFormMessage(message, type) {
    const messageContainer = document.getElementById('editFormMessages');
    if (messageContainer) {
        messageContainer.innerHTML = `<div class="form-message ${type}">${message}</div>`;
        messageContainer.style.display = 'block';
    }
}

function hideEditFormMessage() {
    const messageContainer = document.getElementById('editFormMessages');
    if (messageContainer) {
        messageContainer.style.display = 'none';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

// Force load real data function for development testing
window.forceLoadRealData = async function () {
    console.log('Forcing load of real data...');
    showLoader(true, 'Loading real data from database...');

    try {
        // Initialize AWS using centralized utility
        await AWSUtils.initialize();
        await loadMerchantsFromDynamoDB();

        if (merchantsData.length > 0) {
            filteredMerchants = [...merchantsData];
            renderMerchantsTable();
            updateMerchantStats();
            updateDataSourceIndicator('database', `Loaded ${merchantsData.length} real merchants from database`);
            showMessage(`Loaded ${merchantsData.length} merchants from database`, 'success');
        } else {
            showMessage('No merchants found in database', 'info');
        }
    } catch (error) {
        console.error('Error forcing real data load:', error);
        showMessage(`Error: ${error.message}`, 'error');
    } finally {
        showLoader(false);
    }
}

// Setup modal delegated events
function setupModalDelegatedEvents() {
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const action = target.getAttribute('data-action');
        switch (action) {
            case 'close-edit-product':
            case 'cancel-edit-product': {
                const modal = document.getElementById('editProductModal');
                if (modal) modal.style.display = 'none';
                break;
            }
            case 'close-view-merchant': {
                const modal = document.getElementById('viewMerchantModal');
                if (modal) modal.style.display = 'none';
                break;
            }
            case 'close-status-modal':
            case 'cancel-status-modal': {
                const modal = document.getElementById('statusModal');
                if (modal) modal.style.display = 'none';
                break;
            }
            case 'save-status-modal': {
                if (typeof updateMerchantStatus === 'function') {
                    updateMerchantStatus();
                }
                break;
            }
            case 'close-edit-merchant':
            case 'cancel-edit-merchant': {
                const modal = document.getElementById('editMerchantModal');
                if (modal) modal.style.display = 'none';
                break;
            }
        }
    }, { passive: true });
}

// Ensure modal events are set up on DOM ready
(function () {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupModalDelegatedEvents);
    } else {
        setupModalDelegatedEvents();
    }
})();
