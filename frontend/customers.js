// Customers Management JavaScript

// Customer management variables
let customers = [];
let filteredCustomers = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 10;

// Points system configuration
const POINTS_CONFIG = {
    POINTS_PER_1000_IQD: 100,
    IQD_THRESHOLD: 1000
};

// Calculate points earned from total spent amount
function calculateCustomerPoints(totalSpentIQD) {
    if (!totalSpentIQD || totalSpentIQD <= 0) {
        return 0;
    }
    
    // Calculate points: 100 points for every 1000 IQD spent
    const pointsEarned = Math.floor(totalSpentIQD / POINTS_CONFIG.IQD_THRESHOLD) * POINTS_CONFIG.POINTS_PER_1000_IQD;
    return pointsEarned;
}

// Remove mock data - using only real DynamoDB data

// Load customer order data and calculate points
async function loadCustomerOrderData(customerId) {
    try {
        console.log(`📊 Loading real points data for customer: ${customerId}`);
        
        // Use the CustomerPointsService to get real data from backend API
        const pointsData = await CustomerPointsService.getCustomerPoints(customerId);
        
        if (pointsData && pointsData.success) {
            const dataSource = pointsData.dataSource || 'real-api';
            
            if (dataSource === 'real-api-attempted') {
                console.log(`🔄 Real API attempted for ${customerId} but AWS not configured - showing zeros instead of mock data`);
            } else {
                console.log(`✅ Real points data loaded for ${customerId}:`, pointsData);
            }
            
            return {
                totalSpent: pointsData.totalSpentIQD || 0, // Use real spending data
                totalOrders: pointsData.totalOrders || 0, // Use real order count
                points: pointsData.pointsEarned || 0,     // Use real points earned
                vipStatus: pointsData.vipStatus || false, // VIP status based on real spending
                tierLevel: pointsData.tierLevel || 'regular', // Tier based on real spending
                dataSource: dataSource, // Track data source for debugging
                note: pointsData.note // Include any notes about data source
            };
        } else {
            console.warn(`⚠️ Failed to load real points data for ${customerId}:`, pointsData?.error || 'Unknown error');
            
            // Return zero values when API fails - no mock data
            return {
                totalSpent: 0,
                totalOrders: 0,
                points: 0,
                vipStatus: false,
                tierLevel: 'regular',
                dataSource: 'api-failed'
            };
        }
        
    } catch (error) {
        console.error('Error loading customer order data:', error);
        
        // Return zero values when there's an error - no mock data
        return {
            totalSpent: 0,
            totalOrders: 0,
            points: 0,
            vipStatus: false,
            tierLevel: 'regular',
            dataSource: 'error'
        };
    }
}

// Load order data and calculate points for all customers
async function loadOrderDataForCustomers() {
    try {
        console.log('Loading order data for customers to calculate points...');
        
        // Process customers in parallel for better performance
        const customerPromises = customers.map(async (customer) => {
            const orderData = await loadCustomerOrderData(customer.id);
            
            // Update customer with order data and points
            customer.totalSpent = orderData.totalSpent;
            customer.totalOrders = orderData.totalOrders;
            customer.points = orderData.points;
            customer.vipStatus = orderData.vipStatus;
            customer.tierLevel = orderData.tierLevel;
            
            // Update segment based on actual spending and VIP status
            if (orderData.vipStatus) {
                customer.segment = 'vip';
            } else {
                customer.segment = determineCustomerSegment(customer.totalSpent, customer.totalOrders);
            }
            
            return customer;
        });
        
        await Promise.all(customerPromises);
        console.log('✅ Order data loaded and points calculated for all customers');
        
        // Update data source banner
        updateDataSourceBanner();
        
    } catch (error) {
        console.error('❌ Error loading order data for customers:', error);
        // Continue with default values if order data fails to load
        updateDataSourceBanner(); // Update banner even on error
    }
}

// Update data source banner based on customer data sources
function updateDataSourceBanner() {
    const banner = document.getElementById('dataSourceBanner');
    const message = document.getElementById('dataSourceMessage');
    
    if (!banner || !message) return;
    
    // Analyze data sources from customers
    const dataSources = customers.map(c => c.dataSource).filter(Boolean);
    const realApiCount = dataSources.filter(ds => ds === 'real-api').length;
    const realApiAttemptedCount = dataSources.filter(ds => ds === 'real-api-attempted').length;
    const apiFailedCount = dataSources.filter(ds => ds === 'api-failed' || ds === 'error').length;
    
    let bannerType = 'info';
    let messageText = '';
    let iconClass = 'fas fa-info-circle';
    let bannerColor = '#e3f2fd';
    
    if (realApiCount > 0) {
        // Some real data available
        bannerType = 'success';
        messageText = `✅ Successfully loading real customer order data from database (${realApiCount}/${customers.length} customers). No more mock data!`;
        iconClass = 'fas fa-check-circle';
        bannerColor = '#e8f5e8';
    } else if (realApiAttemptedCount > 0) {
        // API attempted but AWS not configured
        bannerType = 'warning';
        messageText = `⚠️ Real API configured but AWS credentials pending (${realApiAttemptedCount}/${customers.length} customers). Showing zeros instead of mock data until AWS is configured.`;
        iconClass = 'fas fa-exclamation-triangle';
        bannerColor = '#fff3e0';
    } else if (apiFailedCount > 0) {
        // API completely failed
        bannerType = 'error';
        messageText = `❌ Unable to connect to real data API (${apiFailedCount}/${customers.length} customers). Showing zeros instead of mock data.`;
        iconClass = 'fas fa-exclamation-circle';
        bannerColor = '#ffebee';
    } else {
        // Default informational message
        messageText = '🔄 System configured to fetch customer data exclusively from DynamoDB. No mock data is used.';
    }
    
    // Update banner appearance
    banner.style.background = `linear-gradient(135deg, ${bannerColor}, #f3e5f5)`;
    banner.querySelector('i').className = iconClass;
    message.textContent = messageText;
    
    // Show the banner
    banner.style.display = 'block';
    
    console.log(`📊 Data source summary: Real=${realApiCount}, Attempted=${realApiAttemptedCount}, Failed=${apiFailedCount}`);
}

// Initialize customers page
async function initializeCustomersPage() {
    console.log('🎯 Initializing customers page with DynamoDB-only data...');

    // Show loading state
    const tbody = document.querySelector('#customersTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 40px; color: var(--md-sys-color-on-surface-variant);">
                    <i class="fas fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 12px; color: var(--md-sys-color-primary);"></i>
                    <div style="font-weight: 500; margin-bottom: 0.5rem;">Loading customers from DynamoDB...</div>
                    <div style="font-size: 0.875rem; opacity: 0.8;">Fetching data from WizzUser_users_dev table</div>
                </td>
            </tr>
        `;
    }

    try {
        // Load customers data from DynamoDB
        console.log('🔄 Loading customers data from DynamoDB...');
        await loadCustomersData();
        console.log('✅ Customers data loaded successfully from DynamoDB');

        // Setup event listeners
        setupEventListeners();

        // Render page
        renderCustomersTable();
        updateStatCards();
        updatePagination();
        updateDataSourceBanner();

        console.log('Customers page initialization complete');
    } catch (error) {
        console.error('Error initializing customers page:', error);
        
        // Show error in UI when DynamoDB fails - no mock data fallback
        const tbody = document.querySelector('#customersTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 40px; color: var(--md-sys-color-error);">
                        <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px; opacity: 0.7;"></i>
                        <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">Database Connection Error</div>
                        <div style="font-size: 14px; opacity: 0.8;">Unable to load customer data from DynamoDB</div>
                        <div style="font-size: 12px; margin-top: 8px; opacity: 0.6;">Error: ${error.message}</div>
                        <button onclick="refreshCustomerData()" style="margin-top: 16px; padding: 8px 16px; background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); border: none; border-radius: 4px; cursor: pointer;">
                            <i class="fas fa-sync"></i> Retry
                        </button>
                    </td>
                </tr>
            `;
        }
        
        // Update stats cards to show error state
        updateStatCardsWithError();
        
        // Setup event listeners even on error
        setupEventListeners();
    }
}

// Load customers data from DynamoDB with proper permissions
async function loadCustomersData() {
    try {
        console.log('Loading customers data from DynamoDB...');

        // Use centralized AWS utilities
        const dynamoDB = await AWSUtils.getDynamoDBClient();

        console.log('Scanning WizzUser_users_dev table with proper permissions...');

        const params = {
            TableName: 'WizzUser_users_dev'
        };

        const result = await dynamoDB.scan(params).promise();
        console.log('✅ DynamoDB scan successful! Result:', result);
        console.log('📊 Items returned:', result.Items ? result.Items.length : 0);

        if (!result.Items || result.Items.length === 0) {
            console.warn('No users found in DynamoDB table');
            customers = [];
            filteredCustomers = [];
            return;
        }

        console.log(`🎉 Successfully found ${result.Items.length} users in DynamoDB!`);

        // Map your real DynamoDB users to the customers management UI format
        customers = result.Items.map((user, index) => {
            console.log(`Processing user ${index + 1}:`, user);

            // Handle phone number display - combine countryCode if available
            let phoneDisplay = 'N/A';
            if (user.countryCode && user.countryCode !== 'N/A') {
                phoneDisplay = user.countryCode;
            } else if (user.phone || user.phoneNumber || user.mobile) {
                phoneDisplay = user.phone || user.phoneNumber || user.mobile;
            }

            // Determine customer segment based on activity and profile completeness
            let segment = 'new';
            if (user.lastLoginAt && user.name && user.email) {
                const lastLogin = new Date(user.lastLoginAt);
                const daysSinceLogin = (Date.now() - lastLogin.getTime()) / (1000 * 60 * 60 * 24);

                if (daysSinceLogin < 7) {
                    segment = 'vip'; // Active recent users
                } else if (daysSinceLogin < 30) {
                    segment = 'regular'; // Regular users
                } else {
                    segment = 'inactive'; // Inactive users
                }
            }

            const customer = {
                id: user.userId,
                name: user.name || 'Unknown User',
                email: user.email || 'N/A',
                phone: phoneDisplay,
                status: user.isActive ? 'active' : 'inactive',
                totalOrders: 0, // Will be populated from orders table if available
                totalSpent: 0,  // Will be populated from orders table if available
                points: 0, // Will be calculated based on totalSpent
                lastOrder: user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never',
                segment: segment,
                joinDate: user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown',
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&size=40&background=4f46e5&color=fff`,
                isActive: !!user.isActive,

                // Additional real data fields
                cognitoUsername: user.cognitoUsername || 'N/A',
                countryCode: user.countryCode || 'N/A',
                gender: user.gender || 'N/A',
                birthDate: user.birth_date || 'N/A',
                preferredLanguage: user.preferredLanguage || 'en',
                marketingConsent: user.marketingConsent || user.marketing_consent || false,
                newsletterSubscription: user.newsletter_subscription || false,
                privacyAccepted: user.privacyAccepted || false,
                termsAccepted: user.termsAccepted || false,
                addresses: user.addresses || [],
                paymentMethods: user.paymentMethods || [],
                createdAt: user.createdAt,
                updatedAt: user.updatedAt || user.updated_at,
                lastLoginAt: user.lastLoginAt
            };

            console.log(`✅ Mapped customer ${index + 1} for UI:`, customer);
            return customer;
        });

        // Load order data and calculate points for all customers
        await loadOrderDataForCustomers();

        filteredCustomers = [...customers];
        console.log('🎯 Final customers array ready for UI:', customers);
        console.log(`📈 Total customers mapped: ${customers.length}`);

    } catch (error) {
        console.error('❌ Error loading customers data:', error);
        console.error('Error details:', error.code, error.message);
        
        // Set empty arrays when DynamoDB fails - no mock data
        customers = [];
        filteredCustomers = [];
        
        throw error; // Re-throw to be handled by caller

    }
}

// Determine customer segment based on spending and orders
function determineCustomerSegment(totalSpent, totalOrders) {
    if (totalSpent > 500 || totalOrders > 20) {
        return 'vip';
    } else if (totalSpent >= 100 && totalSpent <= 500) {
        return 'regular';
    } else if (totalOrders <= 3) {
        return 'new';
    } else {
        return 'regular';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
    }

    // Filter functionality
    const statusFilter = document.getElementById('statusFilter');
    const segmentFilter = document.getElementById('segmentFilter');

    if (statusFilter) {
        statusFilter.addEventListener('change', handleFilter);
    }

    if (segmentFilter) {
        segmentFilter.addEventListener('change', handleFilter);
    }

    // Pagination
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderCustomersTable();
                updatePagination();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredCustomers.length / ITEMS_PER_PAGE);
            if (currentPage < totalPages) {
                currentPage++;
                renderCustomersTable();
                updatePagination();
            }
        });
    }
}

// Handle search functionality
function handleSearch(event) {
    const searchTerm = event.target.value.toLowerCase().trim();

    if (searchTerm === '') {
        filteredCustomers = [...customers];
    } else {
        filteredCustomers = customers.filter(customer =>
            customer.name.toLowerCase().includes(searchTerm) ||
            customer.email.toLowerCase().includes(searchTerm) ||
            customer.phone.includes(searchTerm)
        );
    }

    currentPage = 1;
    renderCustomersTable();
    updatePagination();
}

// Handle filter functionality
function handleFilter() {
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const segmentFilter = document.getElementById('segmentFilter')?.value || '';

    filteredCustomers = customers.filter(customer => {
        const matchesStatus = !statusFilter || customer.status === statusFilter;
        const matchesSegment = !segmentFilter || customer.segment === segmentFilter;
        return matchesStatus && matchesSegment;
    });

    currentPage = 1;
    renderCustomersTable();
    updatePagination();
}

// Render customers table
function renderCustomersTable() {
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const pageCustomers = filteredCustomers.slice(startIndex, endIndex);

    if (pageCustomers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center" style="padding: 2rem; color: var(--md-sys-color-on-surface-variant);">
                    <i class="fas fa-database" style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <br>
                    <div style="font-weight: 500; margin-bottom: 0.5rem;">No customers found in DynamoDB</div>
                    <div style="font-size: 0.875rem; opacity: 0.8;">The WizzUser_users_dev table appears to be empty</div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = pageCustomers.map(customer => `
        <tr>
            <td>
                <div class="customer-info">
                    <div class="customer-avatar">${customer.name.charAt(0)}</div>
                    <div class="customer-details">
                        <h4>${customer.name}</h4>
                        <p>ID: ${customer.id}</p>
                    </div>
                </div>
            </td>
            <td>
                <div class="contact-info">
                    <div>${customer.email}</div>
                    <small style="color: #666;">${customer.phone}</small>
                </div>
            </td>
            <td>
                <span class="status-badge ${customer.status}">
                    ${customer.status.charAt(0).toUpperCase() + customer.status.slice(1)}
                </span>
            </td>
            <td>
                <div class="metric-value">${customer.totalOrders}</div>
            </td>
            <td>
                <div class="currency-value">${customer.totalSpent.toLocaleString()} IQD</div>
            </td>
            <td>
                <div class="points-display">
                    <span class="points-value">${customer.points.toLocaleString()}</span>
                    <small style="color: #666; display: block;">points</small>
                </div>
            </td>
            <td>${formatDate(customer.lastOrder)}</td>
            <td>
                <span class="segment-badge ${customer.segment}">
                    ${customer.segment.toUpperCase()}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn view" onclick="viewCustomer('${customer.id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn edit" onclick="editCustomer('${customer.id}')" title="Edit Customer">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn toggle" onclick="toggleCustomerStatus('${customer.id}')" title="Toggle Status">
                        <i class="fas fa-toggle-${customer.status === 'active' ? 'on' : 'off'}"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Update statistics cards with error state
function updateStatCardsWithError() {
    const statElements = [
        'totalCustomers',
        'activeCustomers'
    ];
    
    statElements.forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: var(--md-sys-color-error);"></i>';
            element.title = 'Database connection error';
        }
    });
}

// Update statistics cards
function updateStatCards() {
    const totalCustomersEl = document.getElementById('totalCustomers');
    const activeCustomersEl = document.getElementById('activeCustomers');

    if (totalCustomersEl) {
        totalCustomersEl.textContent = customers.length.toString();
    }

    if (activeCustomersEl) {
        const activeCount = customers.filter(c => c.status === 'active').length;
        activeCustomersEl.textContent = activeCount.toString();
    }
}

// Update pagination
function updatePagination() {
    const totalPages = Math.ceil(filteredCustomers.length / ITEMS_PER_PAGE);
    const paginationInfo = document.getElementById('paginationInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    if (paginationInfo) {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE + 1;
        const endIndex = Math.min(currentPage * ITEMS_PER_PAGE, filteredCustomers.length);
        paginationInfo.textContent = `Showing ${startIndex}-${endIndex} of ${filteredCustomers.length} customers`;
    }

    if (prevBtn) {
        prevBtn.disabled = currentPage === 1;
    }

    if (nextBtn) {
        nextBtn.disabled = currentPage >= totalPages;
    }
}

// Utility functions
function formatDate(dateString) {
    if (!dateString || dateString === 'Never') return 'Never';
    try {
        return new Date(dateString).toLocaleDateString();
    } catch {
        return 'Invalid Date';
    }
}

// Customer action functions
function viewCustomer(customerId) {
    console.log('👁️ View customer called with ID:', customerId);
    console.log('📊 Total customers in array:', customers.length);
    
    const customer = customers.find(c => c.id === customerId);
    
    if (!customer) {
        console.error('❌ Customer not found! ID:', customerId);
        console.log('Available customer IDs:', customers.map(c => c.id));
        showMessage('Customer not found', 'error');
        return;
    }
    
    console.log('✅ Customer found:', customer);
    
    try {
        // Store current customer ID for quick edit access
        window.currentViewCustomerId = customerId;
        
        // Check if modal exists
        const modal = document.getElementById('viewCustomerModal');
        if (!modal) {
            console.error('❌ viewCustomerModal not found in DOM!');
            showMessage('View modal not found. Please refresh the page.', 'error');
            return;
        }
        
        // Populate customer header
        const headerNameEl = document.getElementById('viewCustomerFullName');
        const headerEmailEl = document.getElementById('viewCustomerEmail');
        
        if (headerNameEl) headerNameEl.textContent = customer.name || 'Unknown Customer';
        if (headerEmailEl) headerEmailEl.textContent = customer.email || 'N/A';
        
        // Populate status badge
        const statusBadge = document.getElementById('viewCustomerStatusBadge');
        if (statusBadge) {
            const isActive = customer.status === 'active' || customer.isActive === true || customer.isActive === 'true';
            statusBadge.textContent = isActive ? 'Active' : 'Inactive';
            statusBadge.className = isActive ? 'active' : 'inactive';
        }
        
        // Helper function to safely set text content
        const setTextContent = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
            else console.warn(`⚠️ Element not found: ${id}`);
        };
        
        // Populate Personal Information
        setTextContent('viewFullName', customer.name || 'N/A');
        setTextContent('viewEmail', customer.email || 'N/A');
        setTextContent('viewPhone', customer.phone || customer.countryCode || 'N/A');
        
        // Format gender
        let genderText = 'N/A';
        if (customer.gender) {
            const genderMap = {
                'male': 'Male',
                'female': 'Female',
                'other': 'Other',
                'prefer-not-to-say': 'Prefer not to say'
            };
            genderText = genderMap[customer.gender.toLowerCase()] || customer.gender.charAt(0).toUpperCase() + customer.gender.slice(1);
        }
        setTextContent('viewGender', genderText);
        
        // Populate Account Details
        setTextContent('viewSegment', customer.segment ? customer.segment.toUpperCase() : customer.customer_segment ? customer.customer_segment.toUpperCase() : 'REGULAR');
        
        // Populate tier
        const tierElement = document.getElementById('viewTier');
        if (tierElement) {
            if (customer.vipStatus || customer.tier === 'vip') {
                tierElement.innerHTML = '<span style="background: rgba(255, 215, 0, 0.2); color: #b8860b; padding: 4px 12px; border-radius: 12px; font-weight: 600;">⭐ VIP</span>';
            } else {
                tierElement.textContent = customer.tierLevel || customer.tier || 'Regular';
            }
        }
        
        setTextContent('viewLanguage', getLanguageName(customer.preferredLanguage));
        setTextContent('viewMarketing', customer.marketingConsent || customer.marketing_consent ? '✓ Yes' : '✗ No');
        
        // Populate Order & Points Statistics
        setTextContent('viewTotalOrders', customer.totalOrders || customer.total_orders || 0);
        setTextContent('viewTotalSpent', `${(customer.totalSpent || customer.total_spent || 0).toLocaleString()} IQD`);
        setTextContent('viewLoyaltyPoints', (customer.points || customer.loyalty_points || 0).toLocaleString());
        setTextContent('viewLastOrderDate', customer.lastOrder || customer.last_order_date || 'Never');
        
        // Populate System Information
        setTextContent('viewSysCustomerId', customer.id || customer.userId || 'N/A');
        setTextContent('viewJoinedDate', customer.joinDate || formatDateTime(customer.createdAt) || 'N/A');
        setTextContent('viewUpdatedDate', formatDateTime(customer.updatedAt) || 'N/A');
        
        console.log('✅ All fields populated, opening modal...');
        
        // Open the view modal
        openViewCustomerModal();
        
    } catch (error) {
        console.error('❌ Error in viewCustomer:', error);
        showMessage('Error displaying customer details: ' + error.message, 'error');
    }
}

function getLanguageName(code) {
    const languages = {
        'en': 'English',
        'ar': 'Arabic (العربية)',
        'ku': 'Kurdish (کوردی)'
    };
    return languages[code] || code || 'N/A';
}

function openViewCustomerModal() {
    const modal = document.getElementById('viewCustomerModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeViewCustomerModal() {
    const modal = document.getElementById('viewCustomerModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function editCustomerFromView() {
    // Close view modal
    closeViewCustomerModal();
    
    // Open edit modal with the same customer
    if (window.currentViewCustomerId) {
        editCustomer(window.currentViewCustomerId);
    }
}

async function editCustomer(customerId) {
    console.log('✏️ Edit customer:', customerId);
    const customer = customers.find(c => c.id === customerId);
    if (!customer) {
        showMessage('Customer not found', 'error');
        return;
    }
    
    // Open the edit modal
    openEditCustomerModal();
    
    // Populate read-only information
    document.getElementById('viewCustomerId').textContent = customer.id || 'N/A';
    document.getElementById('viewJoinDate').textContent = customer.joinDate || 'N/A';
    document.getElementById('viewLastUpdated').textContent = customer.updatedAt 
        ? formatDateTime(customer.updatedAt) 
        : 'N/A';
    
    // Pre-populate the edit form with customer data
    document.getElementById('editCustomerId').value = customer.id;
    document.getElementById('editCustomerName').value = customer.name || '';
    document.getElementById('editCustomerEmail').value = customer.email || '';
    document.getElementById('editCustomerPhone').value = customer.phone || customer.countryCode || '';
    document.getElementById('editCustomerGender').value = customer.gender || '';
    document.getElementById('editCustomerBirthDate').value = customer.birthDate || '';
    document.getElementById('editCustomerLanguage').value = customer.preferredLanguage || 'en';
    document.getElementById('editCustomerStatus').value = customer.isActive ? 'true' : 'false';
    document.getElementById('editMarketingConsent').checked = customer.marketingConsent || false;
    document.getElementById('editNewsletterSubscription').checked = customer.newsletterSubscription || false;
}

function formatDateTime(timestamp) {
    if (!timestamp) return 'N/A';
    try {
        let date;
        if (typeof timestamp === 'number') {
            date = new Date(timestamp * 1000); // Unix timestamp
        } else {
            date = new Date(timestamp); // ISO string
        }
        
        if (isNaN(date.getTime())) return 'Invalid Date';
        
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        console.error('Error formatting date:', e);
        return 'N/A';
    }
}

function openEditCustomerModal() {
    const modal = document.getElementById('editCustomerModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeEditCustomerModal() {
    const modal = document.getElementById('editCustomerModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('editCustomerForm').reset();
    }
}

async function handleEditCustomer(e) {
    e.preventDefault();
    
    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalText = submitButton.innerHTML;
    
    try {
        // Show loading state
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        
        // Get form data
        const customerId = document.getElementById('editCustomerId').value;
        const name = document.getElementById('editCustomerName').value;
        const email = document.getElementById('editCustomerEmail').value;
        const phone = document.getElementById('editCustomerPhone').value;
        const gender = document.getElementById('editCustomerGender').value;
        const birthDate = document.getElementById('editCustomerBirthDate').value;
        const preferredLanguage = document.getElementById('editCustomerLanguage').value;
        const isActive = document.getElementById('editCustomerStatus').value === 'true';
        const marketingConsent = document.getElementById('editMarketingConsent').checked;
        const newsletterSubscription = document.getElementById('editNewsletterSubscription').checked;
        
        console.log('💾 Saving customer:', { customerId, name, email, phone });
        
        // Get DynamoDB client
        const dynamoDB = await AWSUtils.getDynamoDBClient();
        if (!dynamoDB) {
            throw new Error('Failed to initialize DynamoDB client');
        }
        
        // Build update expression
        const updateExpression = 'SET #name = :name, #email = :email, #countryCode = :phone, #gender = :gender, #birthDate = :birthDate, #preferredLanguage = :preferredLanguage, #isActive = :isActive, #marketingConsent = :marketingConsent, #newsletterSubscription = :newsletterSubscription, #updatedAt = :timestamp';
        
        const expressionAttributeNames = {
            '#name': 'name',
            '#email': 'email',
            '#countryCode': 'countryCode',
            '#gender': 'gender',
            '#birthDate': 'birth_date',
            '#preferredLanguage': 'preferredLanguage',
            '#isActive': 'isActive',
            '#marketingConsent': 'marketingConsent',
            '#newsletterSubscription': 'newsletter_subscription',
            '#updatedAt': 'updatedAt'
        };
        
        const expressionAttributeValues = {
            ':name': name,
            ':email': email,
            ':phone': phone,
            ':gender': gender || null,
            ':birthDate': birthDate || null,
            ':preferredLanguage': preferredLanguage,
            ':isActive': isActive,
            ':marketingConsent': marketingConsent,
            ':newsletterSubscription': newsletterSubscription,
            ':timestamp': new Date().toISOString()
        };
        
        // Update customer in DynamoDB
        const params = {
            TableName: 'WizzUser_users_dev',
            Key: { userId: customerId },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        };
        
        console.log('Updating customer in DynamoDB:', params);
        const result = await dynamoDB.update(params).promise();
        console.log('✅ Customer updated successfully:', result);
        
        // Reload customer data
        await loadCustomersData();
        await loadOrderDataForCustomers();
        renderCustomersTable();
        updateStatCards();
        
        // Close modal and show success message
        closeEditCustomerModal();
        showMessage('Customer updated successfully!', 'success');
        
    } catch (error) {
        console.error('❌ Error updating customer:', error);
        
        let errorMessage = 'Failed to update customer';
        if (error.code === 'ValidationException') {
            errorMessage = 'Invalid data provided';
        } else if (error.code === 'AccessDeniedException') {
            errorMessage = 'Permission denied. Check IAM role permissions.';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        showMessage(errorMessage, 'error');
    } finally {
        // Restore button state
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
    }
}

function toggleCustomerStatus(customerId) {
    console.log('🔄 Toggle customer status:', customerId);
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
        customer.status = customer.status === 'active' ? 'inactive' : 'active';
        customer.isActive = customer.status === 'active';
        renderCustomersTable();
        updateStatCards();
        showMessage(`Customer ${customer.name} status changed to ${customer.status}`, 'success');
    }
}

// Make functions globally available
window.viewCustomer = viewCustomer;
window.editCustomer = editCustomer;
window.toggleCustomerStatus = toggleCustomerStatus;
window.refreshCustomerData = refreshCustomerData;
window.openEditCustomerModal = openEditCustomerModal;
window.closeEditCustomerModal = closeEditCustomerModal;
window.openViewCustomerModal = openViewCustomerModal;
window.closeViewCustomerModal = closeViewCustomerModal;
window.editCustomerFromView = editCustomerFromView;
// Added global exposure for initialization & data loading
window.initializeCustomersPage = initializeCustomersPage;
window.loadCustomersData = loadCustomersData;

// Export customers data
function exportCustomers() {
    try {
        if (customers.length === 0) {
            alert('No customer data to export');
            return;
        }

        // Prepare CSV data
        const headers = ['ID', 'Name', 'Email', 'Phone', 'Status', 'Total Orders', 'Total Spent', 'Last Order', 'Segment', 'Join Date'];

        const csvData = [
            headers.join(','),
            ...customers.map(customer => [
                customer.id,
                `"${customer.name}"`,
                customer.email,
                customer.phone,
                customer.status,
                customer.totalOrders,
                customer.totalSpent.toFixed(2),
                customer.lastOrder,
                customer.segment,
                formatDate(customer.joinDate)
            ].join(','))
        ].join('\n');

        // Create and download file
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `customers-export-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log('Customer data exported successfully');

    } catch (error) {
        console.error('Error exporting customer data:', error);
        alert('Failed to export customer data. Please try again.');
    }
}

// Global functions for HTML onclick handlers
function refreshCustomerData() {
    console.log('🔄 Refreshing customer data...');
    initializeCustomersPage();
}

// Make export function globally available
window.exportCustomers = exportCustomers;

// Refresh customer points data
async function refreshCustomerPoints() {
    try {
        console.log('🔄 Refreshing customer points data...');
        
        // Show loading indicator
        const totalPointsEl = document.getElementById('totalPointsEarned');
        if (totalPointsEl) {
            totalPointsEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }
        
        // Get system statistics to verify service is working
        const stats = await CustomerPointsService.getSystemStatistics();
        if (stats && stats.success) {
            console.log('📊 Points system statistics:', stats);
        }
        
        // Reload order data for all customers using new service
        await loadOrderDataForCustomers();
        
        // Update UI
        renderCustomersTable();
        updateStatCards();
        updatePagination();
        updateDataSourceBanner();
        
        console.log('✅ Customer points data refreshed successfully');
        
        // Show success message
        showMessage('Customer points data refreshed successfully', 'success');
        
    } catch (error) {
        console.error('❌ Error refreshing customer points:', error);
        showMessage('Failed to refresh customer points data', 'error');
    }
}

// Show message helper function
function showMessage(message, type = 'info') {
    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 24px;
        border-radius: 6px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        max-width: 400px;
        background-color: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#00c2e8'};
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease-out;
    `;
    
    // Add animation keyframes
    if (!document.querySelector('#toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// Customer points management functions
async function viewCustomerPointsHistory(customerId) {
    try {
        console.log(`📊 Loading points history for customer: ${customerId}`);
        
        // Get points transaction history
        const history = await CustomerPointsService.getPointsHistory(customerId);
        
        if (history && history.success) {
            const transactions = history.transactions || [];
            
            // Create points history modal
            const historyHtml = `
                <div class="modal-overlay" id="pointsHistoryModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1001; display: flex; align-items: center; justify-content: center;">
                    <div class="modal-content" style="background: white; border-radius: 8px; padding: 2rem; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                            <h2 style="margin: 0; color: #2c3e50;">Points Transaction History</h2>
                            <button onclick="closePointsHistoryModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">&times;</button>
                        </div>
                        
                        <div class="points-summary" style="background: #f8f9fa; padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; text-align: center;">
                                <div>
                                    <div style="font-size: 1.5rem; font-weight: bold; color: #27ae60;">${history.totalPoints || 0}</div>
                                    <div style="color: #666; font-size: 0.9rem;">Total Points</div>
                                </div>
                                <div>
                                    <div style="font-size: 1.5rem; font-weight: bold; color: #3498db;">${history.lifetimePointsEarned || 0}</div>
                                    <div style="color: #666; font-size: 0.9rem;">Lifetime Earned</div>
                                </div>
                                <div>
                                    <div style="font-size: 1.5rem; font-weight: bold; color: #e74c3c;">${history.lifetimePointsRedeemed || 0}</div>
                                    <div style="color: #666; font-size: 0.9rem;">Lifetime Redeemed</div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="transactions-list">
                            ${transactions.length > 0 ? `
                                <table style="width: 100%; border-collapse: collapse;">
                                    <thead>
                                        <tr style="background: #f1f2f6;">
                                            <th style="padding: 0.8rem; text-align: left; border-bottom: 1px solid #ddd;">Date</th>
                                            <th style="padding: 0.8rem; text-align: left; border-bottom: 1px solid #ddd;">Type</th>
                                            <th style="padding: 0.8rem; text-align: right; border-bottom: 1px solid #ddd;">Points</th>
                                            <th style="padding: 0.8rem; text-align: left; border-bottom: 1px solid #ddd;">Order</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${transactions.map(transaction => `
                                            <tr>
                                                <td style="padding: 0.8rem; border-bottom: 1px solid #eee;">${new Date(transaction.timestamp).toLocaleDateString()}</td>
                                                <td style="padding: 0.8rem; border-bottom: 1px solid #eee;">
                                                    <span style="background: ${transaction.transactionType === 'earned' ? '#e8f5e8' : '#ffeaea'}; color: ${transaction.transactionType === 'earned' ? '#27ae60' : '#e74c3c'}; padding: 0.2rem 0.5rem; border-radius: 12px; font-size: 0.8rem;">
                                                        ${transaction.transactionType === 'earned' ? '+ Earned' : '- Redeemed'}
                                                    </span>
                                                </td>
                                                <td style="padding: 0.8rem; border-bottom: 1px solid #eee; text-align: right; font-weight: bold; color: ${transaction.transactionType === 'earned' ? '#27ae60' : '#e74c3c'};">
                                                    ${transaction.transactionType === 'earned' ? '+' : '-'}${Math.abs(transaction.pointsAmount)}
                                                </td>
                                                <td style="padding: 0.8rem; border-bottom: 1px solid #eee;">${transaction.orderId || 'N/A'}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            ` : `
                                <div style="text-align: center; padding: 2rem; color: #666;">
                                    <i class="fas fa-history" style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                                    <br>
                                    No transaction history found
                                </div>
                            `}
                        </div>
                        
                        <div style="margin-top: 1.5rem; text-align: right;">
                            <button onclick="closePointsHistoryModal()" style="background: #95a5a6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', historyHtml);
        } else {
            alert('Failed to load points history');
        }
        
    } catch (error) {
        console.error('Error loading points history:', error);
        alert('Failed to load points history');
    }
}

function closePointsHistoryModal() {
    const modal = document.getElementById('pointsHistoryModal');
    if (modal) {
        modal.remove();
    }
}

async function showRedeemPointsModal(customerId) {
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return;
    
    // Create redeem points modal
    const redeemHtml = `
        <div class="modal-overlay" id="redeemPointsModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1001; display: flex; align-items: center; justify-content: center;">
            <div class="modal-content" style="background: white; border-radius: 8px; padding: 2rem; max-width: 500px; width: 90%;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h2 style="margin: 0; color: #2c3e50;">Redeem Points</h2>
                    <button onclick="closeRedeemPointsModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">&times;</button>
                </div>
                
                <div class="customer-info" style="background: #f8f9fa; padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
                    <div><strong>Customer:</strong> ${customer.name}</div>
                    <div><strong>Available Points:</strong> <span style="color: #e74c3c; font-weight: bold;">${customer.points.toLocaleString()}</span></div>
                    <div style="margin-top: 0.5rem; font-size: 0.9rem; color: #666;">1 point = 1 IQD discount</div>
                </div>
                
                <div class="redeem-form">
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold;">Points to Redeem:</label>
                        <input type="number" id="redeemAmount" min="1" max="${customer.points}" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;" placeholder="Enter points amount">
                    </div>
                    
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold;">Reason (Optional):</label>
                        <textarea id="redeemReason" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; resize: vertical;" rows="3" placeholder="e.g., Applied to order #12345"></textarea>
                    </div>
                    
                    <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                        <button onclick="closeRedeemPointsModal()" style="background: #95a5a6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                            Cancel
                        </button>
                        <button onclick="processPointsRedemption('${customerId}')" style="background: #e74c3c; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                            Redeem Points
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', redeemHtml);
}

function closeRedeemPointsModal() {
    const modal = document.getElementById('redeemPointsModal');
    if (modal) {
        modal.remove();
    }
}

async function processPointsRedemption(customerId) {
    try {
        const redeemAmountEl = document.getElementById('redeemAmount');
        const redeemReasonEl = document.getElementById('redeemReason');
        
        if (!redeemAmountEl) return;
        
        const pointsAmount = parseInt(redeemAmountEl.value);
        const reason = redeemReasonEl ? redeemReasonEl.value : '';
        
        if (!pointsAmount || pointsAmount <= 0) {
            alert('Please enter a valid points amount');
            return;
        }
        
        const customer = customers.find(c => c.id === customerId);
        if (!customer) {
            alert('Customer not found');
            return;
        }
        
        if (pointsAmount > customer.points) {
            alert('Cannot redeem more points than available');
            return;
        }
        
        // Process redemption via CustomerPointsService
        const result = await CustomerPointsService.redeemPoints(customerId, pointsAmount, reason);
        
        if (result && result.success) {
            // Update customer points locally
            customer.points -= pointsAmount;
            
            // Update UI
            renderCustomersTable();
            updateStatCards();
            
            // Close modal
            closeRedeemPointsModal();
            
            // Show success message
            showMessage(`Successfully redeemed ${pointsAmount} points for ${customer.name}`, 'success');
        } else {
            alert('Failed to redeem points: ' + (result?.error || 'Unknown error'));
        }
        
    } catch (error) {
        console.error('Error processing points redemption:', error);
        alert('Failed to redeem points. Please try again.');
    }
}

// Make functions globally available
window.refreshCustomerPoints = refreshCustomerPoints;
window.viewCustomerPointsHistory = viewCustomerPointsHistory;
window.closePointsHistoryModal = closePointsHistoryModal;
window.showRedeemPointsModal = showRedeemPointsModal;
window.closeRedeemPointsModal = closeRedeemPointsModal;
window.processPointsRedemption = processPointsRedemption;

// Initialize the customers page when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('🎯 Customers page DOM loaded, initializing...');
    setTimeout(() => {
        initializeCustomersPage().catch(error => {
            console.error('❌ Failed to initialize customers page:', error);
        });
    }, 100);
    
    // Setup edit customer form submit handler
    const editCustomerForm = document.getElementById('editCustomerForm');
    if (editCustomerForm) {
        editCustomerForm.addEventListener('submit', handleEditCustomer);
        console.log('✅ Edit customer form handler attached');
    }
});

// Close modal when clicking outside
window.addEventListener('click', function(e) {
    const editModal = document.getElementById('editCustomerModal');
    const viewModal = document.getElementById('viewCustomerModal');
    
    if (e.target === editModal) {
        closeEditCustomerModal();
    }
    
    if (e.target === viewModal) {
        closeViewCustomerModal();
    }
});

