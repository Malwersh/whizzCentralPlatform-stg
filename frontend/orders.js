// Orders Management JavaScript
console.log('orders.js script loaded');

// AWS and table config
let dynamoDB = null;
const ORDERS_TABLE = 'order-receiver-orders-dev';
const AWS_REGION = 'us-east-1';

// Global data
let ordersData = [];
let filteredOrders = [];
let centralPlatformService = null;
let orderManagementUI = null;

// Status mapping
const ORDER_STATUSES = {
    'pending': { label: 'Pending', class: 'pending', color: '#f59e0b', icon: 'hourglass_empty' },
    'confirmed': { label: 'Confirmed', class: 'confirmed', color: '#3b82f6', icon: 'check_circle' },
    'preparing': { label: 'Preparing', class: 'preparing', color: '#2563eb', icon: 'restaurant' },
    'ready_for_pickup': { label: 'Ready for Pickup', class: 'ready', color: '#10b981', icon: 'local_shipping' },
    'picked_up': { label: 'Picked Up', class: 'picked-up', color: '#6b21a8', icon: 'delivery_dining' },
    'out_for_delivery': { label: 'Out for Delivery', class: 'out-delivery', color: '#f97316', icon: 'directions_bike' },
    'delivered': { label: 'Delivered', class: 'delivered', color: '#10b981', icon: 'check_circle' },
    'cancelled': { label: 'Cancelled', class: 'cancelled', color: '#ef4444', icon: 'cancel' },
    'unknown': { label: 'Unknown', class: 'unknown', color: '#6b7280', icon: 'help_outline' }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Orders page DOM loaded');
    if (typeof initializeDashboard === 'function') {
        initializeDashboard();
    }

    // Check authentication using centralized utility
    console.log('Checking authentication for orders page...');

    // Check if user is authenticated before proceeding
    if (window.Auth && !window.Auth.requireAuthentication()) {
        console.warn('Authentication failed for orders page');
        return; // Auth utility will handle redirect
    }

    console.log('Authentication passed for orders page');

    showLoader(true, 'Loading orders...');
    try {
        // Initialize AWS using centralized utility
        await AWSUtils.initialize();

        // Initialize Central Platform Integration
        if (typeof CentralPlatformOrderService !== 'undefined') {
            centralPlatformService = new CentralPlatformOrderService();
            orderManagementUI = new OrderManagementUI('ordersTableBody');
            updateIntegrationStatus('Connected', 'success');
        } else {
            updateIntegrationStatus('Not Available', 'error');
        }

        await initializeOrdersManagement();
        startRealTimeUpdates();
    } catch (err) {
        console.error('Orders initialization failed:', err);
        showMessage(`Error loading orders: ${err.message}`, 'error');
        updateIntegrationStatus('Error', 'error');
    } finally {
        showLoader(false);
    }
});

// Initialize page logic
async function initializeOrdersManagement() {
    showLoader(true, 'Fetching orders...');
    try {
        // Use backend API to get real orders
        await loadOrdersFromBackend();
        hideMessage();
    } catch (error) {
        console.error('Error loading orders:', error);
        showMessage(`Error: ${error.message}. No orders available.`, 'error');
        ordersData = []; // Start with empty array instead of sample data
    } finally {
        filteredOrders = [...ordersData];
        initializeUI();
        setupEventListeners();
        showLoader(false);
    }
}

// Load orders directly from WizzOrders DynamoDB table
async function loadOrdersFromBackend() {
    console.log('Loading orders directly from WizzOrders DynamoDB table...');

    try {
        // Check if WizzOrdersAPI is available
        if (!window.WizzOrdersAPI) {
            throw new Error('WizzOrdersAPI not available. Please ensure orders-api.js is loaded.');
        }

        console.log('🔄 Fetching orders from WizzOrders table...');
        const result = await window.WizzOrdersAPI.getOrders(50);

        if (!result.success) {
            throw new Error(result.message || 'Failed to fetch orders');
        }

        const orders = result.orders || [];

        if (orders.length === 0) {
            console.log('📭 No orders found in WizzOrders table');
            ordersData = [];
            showMessage('No orders found in the database. Create some orders to see them here.', 'info');
            return;
        }

        // Transform orders for the UI
        ordersData = orders.map(order => ({
            orderId: order.orderId,
            customerId: order.customerName || order.customerPhone || 'N/A',
            merchantId: order.storeName || 'N/A',
            driverId: order.driverId || 'N/A',
            status: order.status || 'unknown',
            total: order.total || 'N/A',
            date: formatDate(order.createdAt),
            fullData: order
        }));

        console.log(`✅ Successfully loaded ${ordersData.length} orders from WizzOrders table`);
        showMessage(`Successfully loaded ${ordersData.length} orders from WizzOrders table`, 'success');

    } catch (error) {
        console.error('❌ Error loading orders from WizzOrders table:', error);

        // Show user-friendly error message
        if (error.message.includes('not available')) {
            showMessage('Orders API not loaded. Please refresh the page.', 'error');
        } else if (error.message.includes('credentials')) {
            showMessage('Authentication error: Unable to access WizzOrders table. Please check your login.', 'error');
        } else {
            showMessage(`Database error: ${error.message}. Please try again.`, 'error');
        }

        // Set empty orders instead of fallback data
        ordersData = [];
    }
}

// Try to create test orders if database is empty
async function tryCreateTestOrders() {
    try {
        console.log('📝 Attempting to create test orders...');

        const API_BASE_URL = (window.WIZZCENTRAL_CONFIG && window.WIZZCENTRAL_CONFIG.API_BASE_URL) || '';
        if (!API_BASE_URL) {
            throw new Error('Missing API_BASE_URL. Set window.__API_BASE_URL__.');
        }
        if (String(API_BASE_URL).includes('/dev')) {
            throw new Error(`Refusing to use dev API_BASE_URL in staging: ${API_BASE_URL}`);
        }
        const idToken = sessionStorage.getItem('idToken');
        const accessToken = sessionStorage.getItem('accessToken');

        const authHeaders = {};
        if (idToken) {
            authHeaders['Authorization'] = `Bearer ${idToken}`;
        } else if (accessToken) {
            authHeaders['Authorization'] = `Bearer ${accessToken}`;
        }

        // Create a realistic test order
        const testOrder = {
            customerId: 'CUST001',
            merchantId: 'MER001',
            items: [
                {
                    name: 'Margherita Pizza',
                    price: 18.99,
                    quantity: 1,
                    options: ['Extra Cheese']
                },
                {
                    name: 'Caesar Salad',
                    price: 12.99,
                    quantity: 1,
                    options: []
                }
            ],
            deliveryAddress: {
                street: '123 Test Street',
                city: 'Test City',
                state: 'NY',
                zipCode: '10001',
                country: 'USA'
            },
            paymentMethod: 'credit_card',
            specialInstructions: 'Test order created automatically'
        };

        const response = await fetch(`${API_BASE_URL}/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders
            },
            body: JSON.stringify(testOrder)
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ Test order created successfully:', result);
        } else {
            console.log('❌ Failed to create test order:', response.status, response.statusText);
        }
    } catch (error) {
        console.log('❌ Error creating test orders:', error.message);
    }
}

// Load from DynamoDB (kept for backward compatibility, but not used)
async function loadOrdersFromDynamoDB(dynamoDB) {
    console.warn('Direct DynamoDB access deprecated - using backend API instead');
    await loadOrdersFromBackend();
}

// Sample fallback
function getSampleOrdersData() {
    return [
        {
            orderId: 'ORD1001',
            customerId: 'CUST001',
            merchantId: 'MER001',
            driverId: 'DRV001',
            status: 'pending',
            total: '$45.99',
            date: '7/24/2025',
            fullData: {
                orderId: 'ORD1001',
                customerId: 'CUST001',
                merchantId: 'MER001',
                items: [
                    { name: 'Margherita Pizza', price: 18.99, quantity: 1 },
                    { name: 'Caesar Salad', price: 12.99, quantity: 1 },
                    { name: 'Garlic Bread', price: 8.99, quantity: 1 },
                    { name: 'Coca Cola', price: 4.99, quantity: 1 }
                ],
                total: 45.99,
                deliveryAddress: {
                    street: '123 Main Street',
                    city: 'New York',
                    zipCode: '10001'
                },
                customerInfo: {
                    name: 'John Doe',
                    phone: '+1234567890',
                    email: 'john@example.com'
                },
                status: 'pending',
                createdAt: '2025-07-24T10:30:00Z'
            }
        },
        {
            orderId: 'ORD1002',
            customerId: 'CUST002',
            merchantId: 'MER002',
            driverId: 'DRV002',
            status: 'out_for_delivery',
            total: '$120.00',
            date: '7/25/2025',
            fullData: {
                orderId: 'ORD1002',
                customerId: 'CUST002',
                merchantId: 'MER002',
                items: [
                    { name: 'Sushi Combo', price: 45.99, quantity: 2 },
                    { name: 'Miso Soup', price: 8.99, quantity: 2 },
                    { name: 'Green Tea', price: 5.99, quantity: 2 }
                ],
                total: 120.00,
                deliveryAddress: {
                    street: '456 Oak Avenue',
                    city: 'Los Angeles',
                    zipCode: '90210'
                },
                customerInfo: {
                    name: 'Jane Smith',
                    phone: '+1987654321',
                    email: 'jane@example.com'
                },
                status: 'out_for_delivery',
                createdAt: '2025-07-25T14:15:00Z'
            }
        },
        {
            orderId: 'ORD1003',
            customerId: 'CUST003',
            merchantId: 'MER001',
            driverId: 'DRV003',
            status: 'delivered',
            total: '$89.50',
            date: '7/23/2025',
            fullData: {
                orderId: 'ORD1003',
                customerId: 'CUST003',
                merchantId: 'MER001',
                items: [
                    { name: 'BBQ Burger', price: 24.99, quantity: 2 },
                    { name: 'Sweet Potato Fries', price: 12.99, quantity: 2 },
                    { name: 'Milkshake', price: 8.99, quantity: 2 },
                    { name: 'Apple Pie', price: 7.99, quantity: 1 }
                ],
                total: 89.50,
                deliveryAddress: {
                    street: '789 Pine Road',
                    city: 'Chicago',
                    zipCode: '60601'
                },
                customerInfo: {
                    name: 'Mike Johnson',
                    phone: '+1555666777',
                    email: 'mike@example.com'
                },
                status: 'delivered',
                createdAt: '2025-07-23T18:45:00Z'
            }
        }
    ];
}

// UI and events
function initializeUI() { renderOrdersTable(); }
function setupEventListeners() {
    document.getElementById('ordersTableBody');
}

// Render table
function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    if (filteredOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:#666;"><i class="fas fa-shopping-bag" style="font-size:3rem; color:#ccc;"></i><div>No orders found</div></td></tr>`;
        return;
    }
    tbody.innerHTML = filteredOrders.map(o => {
        // Determine available actions based on order status
        const canSendToMerchant = ['pending', 'confirmed'].includes(o.status);
        const sendButton = canSendToMerchant ?
            `<button class="btn-action" onclick="sendOrderToMerchant('${o.orderId}')" title="Send to Merchant"><i class="fas fa-paper-plane"></i></button>` : '';

        return `
        <tr id="order-row-${o.orderId}">
            <td>${o.orderId}</td>
            <td>${o.customerId}</td>
            <td>${o.merchantId}</td>
            <td>${o.driverId}</td>
            <td><span class="status-badge ${ORDER_STATUSES[o.status]?.class || 'unknown'}">${ORDER_STATUSES[o.status]?.label || 'Unknown'}</span></td>
            <td>${o.total}</td>
            <td>${o.date}</td>
            <td>
                <div class="actions">
                    <button class="btn-action" onclick="viewOrder('${o.orderId}')" title="View Details"><i class="fas fa-eye"></i></button>
                    ${sendButton}
                    <button class="btn-action" onclick="trackOrderStatus('${o.orderId}')" title="Track Status"><i class="fas fa-route"></i></button>
                </div>
            </td>
        </tr>`
    }).join('');
}

// View details
function viewOrder(id) {
    const o = ordersData.find(x => x.orderId === id);
    if (!o) return;

    // Enhanced order details with full information
    const orderData = o.fullData || {};
    const items = orderData.items || [];
    const deliveryAddress = orderData.deliveryAddress || {};
    const customerInfo = orderData.customerInfo || {};

    const itemsList = items.map(item =>
        `• ${item.name} - $${item.price} x ${item.quantity} = $${(item.price * item.quantity).toFixed(2)}`
    ).join('\n');

    const orderDetails = `
📦 ORDER DETAILS
Order ID: ${o.orderId}
Customer: ${customerInfo.name || o.customerId}
Phone: ${customerInfo.phone || 'N/A'}
Email: ${customerInfo.email || 'N/A'}

🏪 MERCHANT
Merchant ID: ${o.merchantId}

🛵 DRIVER
Driver ID: ${o.driverId}

📍 DELIVERY ADDRESS
${deliveryAddress.street || 'N/A'}
${deliveryAddress.city || 'N/A'} ${deliveryAddress.zipCode || ''}

🛒 ITEMS
${itemsList || 'No items available'}

💰 TOTAL: ${o.total}
📅 ORDER DATE: ${o.date}
📊 STATUS: ${ORDER_STATUSES[o.status]?.label || 'Unknown'}

Would you like to send this order to the merchant backend?
    `;

    if (confirm(orderDetails)) {
        sendOrderToMerchant(o.orderId);
    }
}

// Send order to merchant backend
async function sendOrderToMerchant(orderId) {
    if (!centralPlatformService) {
        alert('Central Platform Integration not available');
        return;
    }

    // Find the order data
    const order = ordersData.find(o => o.orderId === orderId);
    if (!order || !order.fullData) {
        showMessage(`Order ${orderId} not found or missing data`, 'error');
        return;
    }

    showLoader(true, `Sending order ${orderId} to merchant...`);

    try {
        console.log('Sending order to merchant:', order.fullData);

        // Use the Central Platform Integration service
        const result = await centralPlatformService.sendOrderToMerchant(order.fullData);

        if (result.success) {
            showMessage(`Order ${orderId} sent to merchant successfully! Status: ${result.status}`, 'success');

            // Update the order status locally
            const orderIndex = ordersData.findIndex(o => o.orderId === orderId);
            if (orderIndex !== -1) {
                ordersData[orderIndex].status = 'confirmed';
                ordersData[orderIndex].fullData.status = 'confirmed';
                filteredOrders = [...ordersData];
                renderOrdersTable();

                // Highlight the updated row
                setTimeout(() => {
                    const row = document.getElementById(`order-row-${orderId}`);
                    if (row) {
                        row.classList.add('order-row-updated');
                        setTimeout(() => row.classList.remove('order-row-updated'), 2000);
                    }
                }, 100);
            }

        } else {
            throw new Error(result.error || 'Failed to send order to merchant');
        }

    } catch (error) {
        console.error('Send to merchant failed:', error);
        showMessage(`Failed to send order ${orderId}: ${error.message}`, 'error');
    } finally {
        showLoader(false);
    }
}

// Track order status
async function trackOrderStatus(orderId) {
    if (!centralPlatformService) {
        alert('Central Platform Integration not available');
        return;
    }

    showLoader(true, `Tracking order ${orderId}...`);

    try {
        const result = await centralPlatformService.getOrderStatus(orderId);

        if (result.success) {
            const statusInfo = `
Order ID: ${orderId}
Current Status: ${result.order.status}
Last Updated: ${new Date(result.order.updatedAt || Date.now()).toLocaleString()}
Merchant ID: ${result.order.merchantId}
${result.order.estimatedDelivery ? `Estimated Delivery: ${new Date(result.order.estimatedDelivery).toLocaleString()}` : ''}

Track this order in real-time?
            `;

            if (confirm(statusInfo)) {
                // Start real-time tracking for this specific order
                startOrderTracking(orderId);
            }

        } else {
            throw new Error(result.error || 'Failed to get order status');
        }

    } catch (error) {
        console.error('Order tracking failed:', error);
        showMessage(`Failed to track order ${orderId}: ${error.message}`, 'error');
    } finally {
        showLoader(false);
    }
}

// Start tracking a specific order
function startOrderTracking(orderId) {
    const trackingInterval = setInterval(async () => {
        try {
            const result = await centralPlatformService.getOrderStatus(orderId);
            if (result.success) {
                // Update the order in the table if status changed
                const orderIndex = ordersData.findIndex(o => o.orderId === orderId);
                if (orderIndex !== -1 && ordersData[orderIndex].status !== result.order.status) {
                    ordersData[orderIndex].status = result.order.status;
                    ordersData[orderIndex].fullData = result.order;
                    filteredOrders = [...ordersData];
                    renderOrdersTable();

                    // Show notification
                    showMessage(`Order ${orderId} status updated to: ${result.order.status}`, 'success');

                    // Stop tracking if order is completed
                    if (['delivered', 'cancelled'].includes(result.order.status)) {
                        clearInterval(trackingInterval);
                        console.log(`Stopped tracking order ${orderId} - final status: ${result.order.status}`);
                    }
                }
            }
        } catch (error) {
            console.error(`Error tracking order ${orderId}:`, error);
            // Continue tracking despite errors
        }
    }, 10000); // Check every 10 seconds

    console.log(`Started real-time tracking for order ${orderId}`);
}

// Refresh data (enhanced with silent option)
async function refreshOrdersData(showLoading = true) {
    if (showLoading) showLoader(true, 'Refreshing orders...');

    try {
        await loadOrdersFromBackend();
        filteredOrders = [...ordersData];
        renderOrdersTable();
        if (showLoading) hideMessage();
        updateLastUpdateTime();
    }
    catch (e) {
        console.error(e);
        if (showLoading) showMessage(`Error: ${e.message}`, 'error');
    }
    finally {
        if (showLoading) showLoader(false);
    }
}

// Helpers
function showMessage(msg, type = 'info') {
    const el = document.getElementById('orders-table-status');
    if (el) { el.textContent = msg; el.className = `table-status-info table-status-${type}`; el.style.display = 'block'; }
}
function hideMessage() { const el = document.getElementById('orders-table-status'); if (el) el.style.display = 'none'; }
function showLoader(show, msg = 'Loading...') { let loader = document.getElementById('loader-overlay'); /* reuse from merchants.js */ }
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString() : 'N/A'; }

// Integration Status Management
function updateIntegrationStatus(status, type) {
    const statusEl = document.getElementById('integration-status');
    if (statusEl) {
        statusEl.textContent = status;
        statusEl.className = `stat-value ${type}`;
    }
}

function updateLastUpdateTime() {
    const lastUpdateEl = document.getElementById('last-update');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = new Date().toLocaleTimeString();
    }
}

// Real-time Updates
function startRealTimeUpdates() {
    // Update every 30 seconds
    setInterval(async () => {
        try {
            await refreshOrdersData(false); // Silent refresh
            updateLastUpdateTime();
        } catch (error) {
            console.error('Real-time update failed:', error);
        }
    }, 30000);
}

// Test Order Modal Functions
function openTestOrderModal() {
    const modal = document.getElementById('testOrderModal');
    if (modal) {
        modal.style.display = 'flex';
        setupTestOrderForm();
    }
}

function closeTestOrderModal() {
    const modal = document.getElementById('testOrderModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function setupTestOrderForm() {
    const form = document.getElementById('testOrderForm');
    if (form) {
        // Pre-populate with realistic test data
        document.getElementById('testCustomerId').value = 'CUST' + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
        document.getElementById('testMerchantId').value = 'MER' + String(Math.floor(Math.random() * 100)).padStart(3, '0');
        document.getElementById('testOrderTotal').value = (Math.random() * 80 + 20).toFixed(2); // Random total between $20-$100

        // Realistic order items
        const sampleItems = [
            [
                { "name": "Classic Burger", "price": 15.99, "quantity": 1 },
                { "name": "French Fries", "price": 6.99, "quantity": 1 },
                { "name": "Coca Cola", "price": 3.99, "quantity": 1 }
            ],
            [
                { "name": "Margherita Pizza", "price": 18.99, "quantity": 1 },
                { "name": "Caesar Salad", "price": 12.99, "quantity": 1 },
                { "name": "Garlic Bread", "price": 7.99, "quantity": 1 }
            ],
            [
                { "name": "Chicken Teriyaki", "price": 22.99, "quantity": 1 },
                { "name": "Fried Rice", "price": 8.99, "quantity": 1 },
                { "name": "Miso Soup", "price": 4.99, "quantity": 1 },
                { "name": "Green Tea", "price": 2.99, "quantity": 1 }
            ],
            [
                { "name": "Fish Tacos", "price": 16.99, "quantity": 2 },
                { "name": "Guacamole", "price": 5.99, "quantity": 1 },
                { "name": "Mexican Rice", "price": 4.99, "quantity": 1 }
            ]
        ];

        const randomItems = sampleItems[Math.floor(Math.random() * sampleItems.length)];
        document.getElementById('testOrderItems').value = JSON.stringify(randomItems, null, 2);

        form.onsubmit = async (e) => {
            e.preventDefault();
            await submitTestOrder();
        };
    }
}

async function submitTestOrder() {
    if (!centralPlatformService) {
        alert('Central Platform Integration not available');
        return;
    }

    showLoader(true, 'Creating test order...');

    try {
        const customerId = document.getElementById('testCustomerId').value;
        const merchantId = document.getElementById('testMerchantId').value;
        const orderTotal = parseFloat(document.getElementById('testOrderTotal').value);
        const orderItemsText = document.getElementById('testOrderItems').value;

        let orderItems;
        try {
            orderItems = JSON.parse(orderItemsText);
        } catch (e) {
            throw new Error('Invalid JSON format for order items');
        }

        // Generate unique order ID
        const orderId = 'ORD' + Date.now().toString().slice(-6);

        const testOrder = {
            orderId,
            customerId,
            merchantId,
            items: orderItems,
            total: orderTotal,
            deliveryAddress: {
                street: '123 Test Street',
                city: 'Test City',
                zipCode: '12345'
            },
            customerInfo: {
                name: 'Test Customer',
                phone: '+1234567890',
                email: 'test@example.com'
            },
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        // Add to local orders data immediately
        const newOrderDisplay = {
            orderId: testOrder.orderId,
            customerId: testOrder.customerId,
            merchantId: testOrder.merchantId,
            driverId: 'N/A',
            status: 'pending',
            total: `$${testOrder.total.toFixed(2)}`,
            date: formatDate(testOrder.createdAt),
            fullData: testOrder
        };

        ordersData.unshift(newOrderDisplay); // Add to beginning of array
        filteredOrders = [...ordersData];
        renderOrdersTable();

        showMessage(`Test order ${orderId} created successfully! You can now send it to merchant.`, 'success');
        closeTestOrderModal();

        // Highlight the new order
        setTimeout(() => {
            const row = document.getElementById(`order-row-${orderId}`);
            if (row) {
                row.classList.add('order-row-updated');
                setTimeout(() => row.classList.remove('order-row-updated'), 3000);
                row.scrollIntoView({ behavior: 'smooth' });
            }
        }, 100);

    } catch (error) {
        console.error('Test order creation failed:', error);
        showMessage(`Test order failed: ${error.message}`, 'error');
    } finally {
        showLoader(false);
    }
}

// Generate Test Order Function - Automatically creates and sends orders to merchant app

