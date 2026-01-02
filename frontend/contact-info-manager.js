// ========== COMPREHENSIVE CONTACT INFORMATION MANAGEMENT ==========
// Contact Information Panel JavaScript Functions for Live Chat
// NOTE: This file contains mock/demo data generation for UI demonstration purposes
// In production, replace mock data functions with real API calls

// Contact Information State Management
let currentContactInfo = {
    contact: null,
    contactType: null, // 'driver', 'customer', 'merchant'
    profile: null,
    orders: {
        active: [],
        recent: []
    },
    history: [],
    isExpanded: false
};

// Profile Data Loading Functions
function loadContactProfile(contactId, contactType) {
    const profileDetails = document.getElementById('profileDetails');
    if (!profileDetails) return;
    
    // Show loading state
    profileDetails.innerHTML = `
        <div class="profile-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Loading profile...</p>
        </div>
    `;
    
    // Simulate API call
    setTimeout(() => {
        const profileData = generateMockProfileData(contactId, contactType);
        displayProfileData(profileData);
    }, 1500);
}

// TODO: Replace with real API call in production
function generateMockProfileData(contactId, contactType) {
    // DEMO/MOCK DATA - Replace with actual API call
    const baseData = {
        driver: {
            'Full Name': `Driver ${contactId}`,
            'Phone Number': '+966 50 123 4567',
            'Email': `driver${contactId}@wizzcentral.com`,
            'License Number': `DL${contactId.padStart(6, '0')}`,
            'Vehicle Type': 'Motorcycle',
            'Zone': 'Downtown Riyadh',
            'Rating': '4.8/5 (234 reviews)',
            'Total Deliveries': '1,247',
            'Join Date': 'March 15, 2024',
            'Emergency Contact': '+966 50 987 6543',
            'Status': 'Online - Available'
        },
        customer: {
            'Full Name': `Customer ${contactId}`,
            'Phone Number': '+966 55 123 4567',
            'Email': `customer${contactId}@gmail.com`,
            'Preferred Address': '123 King Fahd Road, Riyadh',
            'Customer Since': 'January 10, 2024',
            'Total Orders': '47',
            'Favorite Cuisine': 'Italian, Middle Eastern',
            'Payment Method': 'Credit Card ****1234',
            'Loyalty Points': '2,340 points',
            'Last Order': '2 hours ago',
            'Preferred Delivery Time': 'Evenings (6-9 PM)'
        },
        merchant: {
            'Restaurant Name': `Restaurant ${contactId}`,
            'Owner Name': `Owner ${contactId}`,
            'Phone Number': '+966 11 123 4567',
            'Email': `merchant${contactId}@business.com`,
            'Address': '456 Olaya Street, Riyadh',
            'Business License': `BL${contactId.padStart(6, '0')}`,
            'Cuisine Type': 'Fast Food, Burgers',
            'Operating Hours': '10:00 AM - 12:00 AM',
            'Rating': '4.6/5 (567 reviews)',
            'Total Orders': '3,456',
            'Join Date': 'February 20, 2024',
            'Commission Rate': '15%',
            'Status': 'Open - Accepting Orders'
        }
    };
    
    return baseData[contactType] || baseData.customer;
}

function displayProfileData(profileData) {
    const profileDetails = document.getElementById('profileDetails');
    if (!profileDetails) return;
    
    const profileHTML = Object.entries(profileData).map(([label, value]) => `
        <div class="profile-field">
            <label>${label}</label>
            <div class="value">${value}</div>
        </div>
    `).join('');
    
    profileDetails.innerHTML = profileHTML;
    
    // Store profile data
    currentContactInfo.profile = profileData;
}

// Orders Data Loading Functions
function loadContactOrders(contactId, contactType) {
    console.log('📦 Loading orders for:', contactId, contactType);
    
    // Generate mock orders based on contact type
    const orders = generateMockOrdersData(contactId, contactType);
    
    currentContactInfo.orders.active = orders.active;
    currentContactInfo.orders.recent = orders.recent;
    
    displayOrdersData(orders);
    updateOrdersCount();
}

// TODO: Replace with real API call in production  
function generateMockOrdersData(contactId, contactType) {
    // DEMO/MOCK DATA - Replace with actual API call
    const now = new Date();
    
    if (contactType === 'driver') {
        return {
            active: [
                {
                    id: `ORD${Date.now()}`,
                    customer: 'Ahmed Al-Rashid',
                    restaurant: 'Pizza Palace',
                    amount: 67.50,
                    status: 'picked_up',
                    estimatedDelivery: new Date(now.getTime() + 15 * 60000),
                    pickupAddress: 'Pizza Palace, King Fahd Road',
                    deliveryAddress: '123 Al-Malaz District'
                }
            ],
            recent: [
                {
                    id: 'ORD789012',
                    customer: 'Fatima Hassan',
                    restaurant: 'Burger House',
                    amount: 45.00,
                    status: 'delivered',
                    completedAt: new Date(now.getTime() - 2 * 60 * 60000)
                }
            ]
        };
    } else if (contactType === 'customer') {
        return {
            active: [
                {
                    id: `ORD${Date.now()}`,
                    restaurant: 'Italian Corner',
                    amount: 78.50,
                    status: 'confirmed',
                    estimatedDelivery: new Date(now.getTime() + 25 * 60000),
                    driver: 'Khalid Al-Ahmed',
                    items: ['Margherita Pizza', 'Caesar Salad', 'Tiramisu']
                }
            ],
            recent: [
                {
                    id: 'ORD456789',
                    restaurant: 'Taco Bell',
                    amount: 34.75,
                    status: 'delivered',
                    completedAt: new Date(now.getTime() - 3 * 60 * 60000)
                }
            ]
        };
    } else { // merchant
        return {
            active: [
                {
                    id: `ORD${Date.now()}`,
                    customer: 'Sara Al-Mutairi',
                    amount: 56.25,
                    status: 'preparing',
                    estimatedReady: new Date(now.getTime() + 12 * 60000),
                    driver: 'Hassan Mohammed',
                    items: ['Chicken Burger', 'Fries', 'Coca Cola']
                }
            ],
            recent: [
                {
                    id: 'ORD123456',
                    customer: 'Nora Al-Zahra',
                    amount: 73.50,
                    status: 'delivered',
                    completedAt: new Date(now.getTime() - 1 * 60 * 60000)
                }
            ]
        };
    }
}

function displayOrdersData(orders) {
    displayActiveOrders(orders.active);
    displayRecentOrders(orders.recent);
}

function displayActiveOrders(activeOrders) {
    const activeOrdersList = document.getElementById('activeOrdersList');
    if (!activeOrdersList) return;
    
    if (activeOrders.length === 0) {
        activeOrdersList.innerHTML = `
            <div class="no-orders">
                <i class="fas fa-shopping-cart"></i>
                <p>No active orders</p>
            </div>
        `;
        return;
    }
    
    activeOrdersList.innerHTML = activeOrders.map(order => `
        <div class="order-item" onclick="viewOrderDetails('${order.id}')">
            <div class="order-header">
                <span class="order-id">#${order.id}</span>
                <span class="order-status ${order.status}">${formatOrderStatus(order.status)}</span>
            </div>
            <div class="order-details">
                ${formatOrderDetails(order, currentContactInfo.contactType)}
            </div>
            <div class="order-amount">$${order.amount.toFixed(2)}</div>
        </div>
    `).join('');
}

function displayRecentOrders(recentOrders) {
    const recentOrdersList = document.getElementById('recentOrdersList');
    if (!recentOrdersList) return;
    
    if (recentOrders.length === 0) {
        recentOrdersList.innerHTML = `
            <div class="no-orders">
                <i class="fas fa-history"></i>
                <p>No recent orders</p>
            </div>
        `;
        return;
    }
    
    recentOrdersList.innerHTML = recentOrders.map(order => `
        <div class="order-item" onclick="viewOrderDetails('${order.id}')">
            <div class="order-header">
                <span class="order-id">#${order.id}</span>
                <span class="order-status ${order.status}">${formatOrderStatus(order.status)}</span>
            </div>
            <div class="order-details">
                ${formatOrderDetails(order, currentContactInfo.contactType)}
                <div style="margin-top: 0.5rem; font-size: 0.75rem; color: #9ca3af;">
                    Completed: ${formatRelativeTime(order.completedAt)}
                </div>
            </div>
            <div class="order-amount">$${order.amount.toFixed(2)}</div>
        </div>
    `).join('');
}

function formatOrderStatus(status) {
    const statusLabels = {
        'pending': 'Pending',
        'confirmed': 'Confirmed',
        'preparing': 'Preparing',
        'ready': 'Ready',
        'picked_up': 'Picked Up',
        'delivered': 'Delivered',
        'cancelled': 'Cancelled'
    };
    return statusLabels[status] || status;
}

function formatOrderDetails(order, contactType) {
    if (contactType === 'driver') {
        return `
            <div>Customer: ${order.customer}</div>
            <div>Restaurant: ${order.restaurant}</div>
            ${order.estimatedDelivery ? `<div>ETA: ${formatTime(order.estimatedDelivery)}</div>` : ''}
        `;
    } else if (contactType === 'customer') {
        return `
            <div>Restaurant: ${order.restaurant}</div>
            ${order.driver ? `<div>Driver: ${order.driver}</div>` : ''}
            ${order.estimatedDelivery ? `<div>ETA: ${formatTime(order.estimatedDelivery)}</div>` : ''}
        `;
    } else { // merchant
        return `
            <div>Customer: ${order.customer}</div>
            ${order.driver ? `<div>Driver: ${order.driver}</div>` : ''}
            ${order.estimatedReady ? `<div>Ready in: ${formatTime(order.estimatedReady)}</div>` : ''}
        `;
    }
}

function updateOrdersCount() {
    const ordersCount = document.getElementById('ordersCount');
    if (ordersCount) {
        const totalOrders = currentContactInfo.orders.active.length + currentContactInfo.orders.recent.length;
        ordersCount.textContent = totalOrders.toString();
    }
}

function refreshOrders() {
    if (!currentContactInfo.contact) return;
    
    console.log('🔄 Refreshing orders...');
    loadContactOrders(currentContactInfo.contact.id, currentContactInfo.contactType);
}

// Contact History Functions
function loadContactHistory(contactId) {
    const historyTimeline = document.getElementById('historyTimeline');
    if (!historyTimeline) return;
    
    // Show loading state
    historyTimeline.innerHTML = `
        <div class="history-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Loading history...</p>
        </div>
    `;
    
    // Simulate API call
    setTimeout(() => {
        const historyData = generateMockHistoryData(contactId);
        displayHistoryData(historyData);
    }, 1000);
}

// TODO: Replace with real API call in production
function generateMockHistoryData(contactId) {
    // DEMO/MOCK DATA - Replace with actual API call
    const now = new Date();
    return [
        {
            time: new Date(now.getTime() - 10 * 60000),
            action: 'Started live chat session',
            type: 'chat'
        },
        {
            time: new Date(now.getTime() - 2 * 60 * 60000),
            action: 'Order #ORD789012 delivered successfully',
            type: 'order'
        },
        {
            time: new Date(now.getTime() - 4 * 60 * 60000),
            action: 'Payment processed for order #ORD789011',
            type: 'payment'
        },
        {
            time: new Date(now.getTime() - 24 * 60 * 60000),
            action: 'Profile information updated',
            type: 'profile'
        },
        {
            time: new Date(now.getTime() - 3 * 24 * 60 * 60000),
            action: 'Account created',
            type: 'account'
        }
    ];
}

function displayHistoryData(historyData) {
    const historyTimeline = document.getElementById('historyTimeline');
    if (!historyTimeline) return;
    
    historyTimeline.innerHTML = historyData.map(item => `
        <div class="history-item">
            <div class="history-icon"></div>
            <div class="history-content">
                <div class="history-time">${formatRelativeTime(item.time)}</div>
                <div class="history-action">${item.action}</div>
            </div>
        </div>
    `).join('');
    
    currentContactInfo.history = historyData;
}

// Quick Action Functions
function createSupportTicket() {
    if (!currentContactInfo.contact) {
        alert('No contact selected');
        return;
    }
    
    console.log('🎫 Creating support ticket for:', currentContactInfo.contact.name);
    
    if (typeof showNewTicketModal === 'function') {
        showNewTicketModal();
        
        // Pre-populate customer information
        setTimeout(() => {
            const customerNameField = document.getElementById('newTicketCustomerName');
            const customerEmailField = document.getElementById('newTicketCustomerEmail');
            
            if (customerNameField) {
                customerNameField.value = currentContactInfo.contact.name || '';
            }
            if (customerEmailField) {
                customerEmailField.value = currentContactInfo.contact.email || '';
            }
        }, 100);
    } else {
        alert(`Creating support ticket for: ${currentContactInfo.contact.name}`);
    }
}

function viewFullProfile() {
    if (!currentContactInfo.contact) {
        alert('No contact selected');
        return;
    }
    
    console.log('👤 Viewing full profile for:', currentContactInfo.contact.name);
    
    const profileData = currentContactInfo.profile;
    if (!profileData) {
        alert('Profile data not loaded yet');
        return;
    }
    
    alert(`Full Profile: ${currentContactInfo.contact.name}\n\n${Object.entries(profileData).map(([k,v]) => `${k}: ${v}`).join('\n')}`);
}

function escalateContact() {
    if (!currentContactInfo.contact) {
        alert('No contact selected');
        return;
    }
    
    console.log('⚠️ Escalating contact:', currentContactInfo.contact.name);
    
    const reason = prompt('Please provide a reason for escalation:');
    if (reason) {
        alert(`Contact escalated successfully!\n\nContact: ${currentContactInfo.contact.name}\nReason: ${reason}\n\nA supervisor will be notified.`);
    }
}

function addContactNote() {
    if (!currentContactInfo.contact) {
        alert('No contact selected');
        return;
    }
    
    console.log('📝 Adding note for contact:', currentContactInfo.contact.name);
    
    const note = prompt('Add a note about this contact:');
    if (note) {
        alert(`Note added successfully!\n\nContact: ${currentContactInfo.contact.name}\nNote: ${note}`);
    }
}

function viewOrderDetails(orderId) {
    console.log('📦 Viewing order details:', orderId);
    
    // Find order in active or recent orders
    const allOrders = [...currentContactInfo.orders.active, ...currentContactInfo.orders.recent];
    const order = allOrders.find(o => o.id === orderId);
    
    if (!order) {
        alert('Order not found');
        return;
    }
    
    const orderDetails = `
Order Details: #${order.id}

Amount: $${order.amount.toFixed(2)}
Status: ${formatOrderStatus(order.status)}
${order.customer ? `Customer: ${order.customer}\n` : ''}
${order.restaurant ? `Restaurant: ${order.restaurant}\n` : ''}
${order.driver ? `Driver: ${order.driver}\n` : ''}
${order.items ? `Items: ${order.items.join(', ')}\n` : ''}
${order.estimatedDelivery ? `Estimated Delivery: ${order.estimatedDelivery.toLocaleString()}\n` : ''}
${order.completedAt ? `Completed: ${order.completedAt.toLocaleString()}\n` : ''}
    `;
    
    alert(orderDetails);
}

// Utility Functions
function formatTime(date) {
    return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

function formatRelativeTime(date) {
    const now = new Date();
    const diffInMinutes = Math.floor((now - date) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes} minutes ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays} days ago`;
}

function showContactLoading() {
    const sections = ['profileDetails', 'activeOrdersList', 'recentOrdersList', 'historyTimeline'];
    
    sections.forEach(sectionId => {
        const element = document.getElementById(sectionId);
        if (element) {
            element.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #6b7280;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
                    <p>Loading...</p>
                </div>
            `;
        }
    });
}

function updateLastRefreshTime() {
    console.log('📅 Contact info last refreshed at:', new Date().toLocaleTimeString());
}

// Demo contact simulation - REMOVE IN PRODUCTION
function simulateIncomingContact(contactType = null) {
    // DEMO FUNCTION - Remove this function in production
    const contactTypes = ['driver', 'customer', 'merchant'];
    const selectedType = contactType || contactTypes[Math.floor(Math.random() * contactTypes.length)];
    
    const names = {
        driver: ['Ahmed Al-Rashid', 'Omar Abdullah', 'Khalid Al-Mansouri', 'Faisal Al-Zahrani'],
        customer: ['Sarah Al-Qahtani', 'Noor Al-Otaibi', 'Layla Al-Harbi', 'Amira Al-Dosari'],
        merchant: ['Restaurant Al-Baik', 'Café Corner', 'Pizza Palace', 'Shawarma Station']
    };
    
    const randomName = names[selectedType][Math.floor(Math.random() * names[selectedType].length)];
    
    const mockContact = {
        id: `DEMO_${Date.now()}`,
        name: randomName,
        phone: '+966 50 ' + Math.floor(Math.random() * 900 + 100) + ' ' + Math.floor(Math.random() * 9000 + 1000),
        email: `${randomName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '')}@example.com`
    };
    
    console.log('📞 Simulating incoming contact:', mockContact.name, `(${selectedType})`);
    
    // Show notification
    showNotification(`Incoming ${selectedType} contact: ${mockContact.name}`, 'info');
    
    // Start loading state
    showContactLoading();
    
    // Simulate loading delay
    setTimeout(() => {
        displayContactInfo(mockContact, selectedType);
        
        // Show in active chat interface
        showActiveContact(mockContact, selectedType);
    }, 1500);
}

function showActiveContact(contact, contactType) {
    // Hide placeholder and show active chat
    const placeholder = document.getElementById('chatPlaceholder');
    const activeChat = document.getElementById('activeContactDisplay');
    
    if (placeholder) placeholder.style.display = 'none';
    if (activeChat) {
        activeChat.classList.remove('hidden');
        activeChat.style.display = 'flex';
        
        // Update active contact details
        const nameEl = document.getElementById('activeContactName');
        const detailsEl = document.getElementById('activeContactDetails');
        
        if (nameEl) nameEl.textContent = contact.name;
        if (detailsEl) detailsEl.textContent = `${contactType.charAt(0).toUpperCase() + contactType.slice(1)} • ${contact.phone}`;
    }
}

// Real-time Updates (simulated)
function startContactUpdates() {
    // Simulate real-time order status updates
    setInterval(() => {
        if (currentContactInfo.contact && currentContactInfo.orders.active.length > 0) {
            updateOrderStatuses();
        }
    }, 30000); // Every 30 seconds
}

function updateOrderStatuses() {
    const activeOrders = currentContactInfo.orders.active;
    let hasUpdates = false;
    
    activeOrders.forEach(order => {
        // Simulate status progression
        if (order.status === 'confirmed' && Math.random() > 0.7) {
            order.status = 'preparing';
            hasUpdates = true;
        } else if (order.status === 'preparing' && Math.random() > 0.8) {
            order.status = 'ready';
            hasUpdates = true;
        } else if (order.status === 'ready' && Math.random() > 0.9) {
            order.status = 'picked_up';
            hasUpdates = true;
        }
    });
    
    if (hasUpdates) {
        console.log('📦 Order statuses updated');
        displayOrdersData(currentContactInfo.orders);
        showNotification('Order status updated!', 'info');
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'info' ? '#3b82f6' : '#059669'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Make functions globally available
window.createSupportTicket = createSupportTicket;
window.viewFullProfile = viewFullProfile;
window.escalateContact = escalateContact;
window.addContactNote = addContactNote;
window.refreshOrders = refreshOrders;
window.simulateIncomingContact = simulateIncomingContact;
window.viewOrderDetails = viewOrderDetails;
window.refreshContactInfo = refreshContactInfo;
window.toggleContactPanel = toggleContactPanel;
window.showContactSection = showContactSection;
window.displayContactInfo = displayContactInfo;

// Contact Information Panel Functions
function refreshContactInfo() {
    console.log('🔄 Refreshing contact information...');
    
    if (!currentContactInfo.contact) {
        console.log('No active contact to refresh');
        return;
    }
    
    // Show loading state
    showContactLoading();
    
    // Simulate loading delay for demo
    setTimeout(() => {
        loadContactProfile(currentContactInfo.contact.id, currentContactInfo.contactType);
        loadContactOrders(currentContactInfo.contact.id, currentContactInfo.contactType);
        loadContactHistory(currentContactInfo.contact.id);
        
        // Update last refresh indicator
        updateLastRefreshTime();
    }, 1000);
}

function toggleContactPanel() {
    const panel = document.querySelector('.contact-info-panel');
    const toggleBtn = document.getElementById('contactPanelToggle');
    
    if (!panel || !toggleBtn) return;
    
    currentContactInfo.isExpanded = !currentContactInfo.isExpanded;
    
    if (currentContactInfo.isExpanded) {
        panel.classList.add('expanded');
        toggleBtn.innerHTML = '<i class="fas fa-compress-arrows-alt"></i>';
        toggleBtn.title = 'Collapse Panel';
    } else {
        panel.classList.remove('expanded');
        toggleBtn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i>';
        toggleBtn.title = 'Expand Panel';
    }
    
    console.log('📱 Contact panel toggled:', currentContactInfo.isExpanded ? 'expanded' : 'collapsed');
}

// Contact Selection and Display Functions
function displayContactInfo(contact, contactType = 'customer') {
    console.log('👤 Displaying contact info:', contact.name, `(${contactType})`);
    
    currentContactInfo.contact = contact;
    currentContactInfo.contactType = contactType;
    
    // Hide no contact selected state
    const noContactSelected = document.getElementById('noContactSelected');
    const contactDetails = document.getElementById('contactDetails');
    
    if (noContactSelected) noContactSelected.style.display = 'none';
    if (contactDetails) {
        contactDetails.classList.remove('hidden');
        contactDetails.style.display = 'block';
    }
    
    // Update contact header
    updateContactHeader(contact, contactType);
    
    // Load contact data
    loadContactProfile(contact.id, contactType);
    loadContactOrders(contact.id, contactType);
    loadContactHistory(contact.id);
    
    // Show profile tab by default
    showContactSection('profile');
}

function updateContactHeader(contact, contactType) {
    // Update contact avatar
    const avatar = document.getElementById('contactAvatar');
    if (avatar) {
        const iconClass = getContactTypeIcon(contactType);
        avatar.innerHTML = `<i class="${iconClass}"></i>`;
    }
    
    // Update contact name and phone
    const nameEl = document.getElementById('contactName');
    const phoneEl = document.getElementById('contactPhone');
    
    if (nameEl) nameEl.textContent = contact.name || 'Unknown Contact';
    if (phoneEl) phoneEl.textContent = contact.phone || 'No phone number';
    
    // Update contact type badge
    const typeBadge = document.getElementById('contactTypeBadge');
    if (typeBadge) {
        typeBadge.textContent = contactType.charAt(0).toUpperCase() + contactType.slice(1);
        typeBadge.className = `contact-type-badge ${contactType}`;
    }
    
    // Update status indicator
    const statusIndicator = document.getElementById('contactStatusIndicator');
    if (statusIndicator) {
        const status = getContactStatus(contact, contactType);
        statusIndicator.className = `status-indicator ${status}`;
    }
}

function getContactTypeIcon(contactType) {
    const icons = {
        'driver': 'fas fa-car',
        'customer': 'fas fa-user',
        'merchant': 'fas fa-store'
    };
    return icons[contactType] || 'fas fa-user';
}

function getContactStatus(contact, contactType) {
    // Simulate different status logic based on contact type
    if (contactType === 'driver') {
        return contact.status || 'online'; // online, busy, offline
    } else if (contactType === 'merchant') {
        return contact.isOpen ? 'online' : 'offline';
    } else {
        return 'online'; // customers are generally online when contacting
    }
}

// Contact Section Navigation
function showContactSection(sectionName) {
    console.log('📋 Showing contact section:', sectionName);
    
    // Update tab states
    const tabs = document.querySelectorAll('.contact-tab');
    tabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.id === `${sectionName}Tab`) {
            tab.classList.add('active');
        }
    });
    
    // Update section states
    const sections = document.querySelectorAll('.contact-section');
    sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === `${sectionName}Section`) {
            section.classList.add('active');
        }
    });
    
    // Load section-specific data if needed
    if (sectionName === 'orders') {
        refreshOrders();
    } else if (sectionName === 'history') {
        loadContactHistory(currentContactInfo.contact?.id);
    }
}

// Initialize contact updates when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Start real-time updates
    startContactUpdates();
    
    // Add demo button for testing
    setTimeout(() => {
        const demoButton = document.createElement('button');
        demoButton.textContent = '📞 Simulate Contact';
        demoButton.className = 'btn-primary';
        demoButton.style.cssText = `
            position: fixed; 
            top: 80px; 
            right: 10px; 
            z-index: 9999;
            font-size: 0.875rem;
            padding: 0.5rem 1rem;
        `;
        demoButton.onclick = simulateIncomingContact;
        document.body.appendChild(demoButton);
    }, 2000);
});

// Export contact functions for global access
window.ContactInfoManager = {
    displayContactInfo,
    refreshContactInfo,
    toggleContactPanel,
    showContactSection,
    createSupportTicket,
    viewFullProfile,
    escalateContact,
    addContactNote,
    viewOrderDetails,
    simulateIncomingContact,
    loadContactProfile,
    loadContactOrders,
    loadContactHistory,
    currentContactInfo
};

console.log('✅ Contact Information Manager loaded successfully');
