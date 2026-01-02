// Central Platform Order Integration
// Frontend JavaScript for placing orders through the ecosystem

class CentralPlatformOrderService {
  constructor() {
    this.apiBaseUrl = window.WIZZCENTRAL_CONFIG.API_BASE_URL;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Ensure authentication is available
    if (!Auth.getToken()) {
      throw new Error('Authentication required');
    }
    
    this.initialized = true;
    console.log('Central Platform Order Service initialized');
  }

  /**
   * Place order through Central Platform (sends to Merchant Backend)
   * This is the main integration point for customer order placement
   */
  async placeOrder(orderData) {
    await this.initialize();
    
    const {
      businessId,
      customerId,
      customerName,
      customerPhone,
      deliveryAddress,
      items,
      totalAmount,
      notes,
      estimatedDeliveryTime
    } = orderData;

    // Generate unique order ID
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Prepare order payload for merchant backend
    const orderPayload = {
      orderId,
      businessId,
      customerId,
      customerName,
      customerPhone,
      deliveryAddress,
      items,
      totalAmount,
      notes: notes || '',
      estimatedDeliveryTime: estimatedDeliveryTime || new Date(Date.now() + 45 * 60 * 1000).toISOString()
    };

    try {
      console.log('Placing order through Central Platform:', orderPayload);

      const response = await fetch(`${this.apiBaseUrl}/api/send-order-to-merchant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify(orderPayload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to place order');
      }

      console.log('Order placed successfully:', result);
      return result;

    } catch (error) {
      console.error('Error placing order:', error);
      throw error;
    }
  }

  /**
   * Get order status from Central Platform
   */
  async getOrderStatus(orderId) {
    await this.initialize();

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/orders/${orderId}/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${Auth.getToken()}`
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to get order status');
      }

      return result;

    } catch (error) {
      console.error('Error getting order status:', error);
      throw error;
    }
  }

  /**
   * Get customer order history
   */
  async getCustomerOrderHistory(customerId) {
    await this.initialize();

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/customers/${customerId}/order-history`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${Auth.getToken()}`
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to get order history');
      }

      return result;

    } catch (error) {
      console.error('Error getting order history:', error);
      throw error;
    }
  }

  /**
   * Get user notifications (for both customers and drivers)
   */
  async getUserNotifications(userId, options = {}) {
    await this.initialize();

    const queryParams = new URLSearchParams();
    if (options.limit) queryParams.append('limit', options.limit);
    if (options.unreadOnly) queryParams.append('unreadOnly', 'true');

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/users/${userId}/notifications?${queryParams}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${Auth.getToken()}`
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to get notifications');
      }

      return result;

    } catch (error) {
      console.error('Error getting notifications:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markNotificationRead(notificationId) {
    await this.initialize();

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/notifications/${notificationId}/read`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${Auth.getToken()}`
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to mark notification as read');
      }

      return result;

    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Driver: Accept order assignment
   */
  async acceptOrderAssignment(orderId, estimatedPickupTime) {
    await this.initialize();

    const payload = {
      estimatedPickupTime: estimatedPickupTime || new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/orders/${orderId}/accept-assignment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to accept order assignment');
      }

      return result;

    } catch (error) {
      console.error('Error accepting order assignment:', error);
      throw error;
    }
  }

  /**
   * Driver: Update delivery status
   */
  async updateDeliveryStatus(orderId, status, options = {}) {
    await this.initialize();

    const payload = {
      status,
      location: options.location,
      notes: options.notes
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/orders/${orderId}/delivery-status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to update delivery status');
      }

      return result;

    } catch (error) {
      console.error('Error updating delivery status:', error);
      throw error;
    }
  }
}

// Global instance
window.CentralPlatformOrderService = new CentralPlatformOrderService();

// Enhanced order management with real-time status updates
class OrderManagementUI {
  constructor() {
    this.orderService = window.CentralPlatformOrderService;
    this.refreshInterval = null;
    this.currentFilter = 'all';
  }

  async initialize() {
    await this.orderService.initialize();
    this.setupEventListeners();
    this.startAutoRefresh();
    console.log('Order Management UI initialized');
  }

  setupEventListeners() {
    // Order creation form (if exists)
    const orderForm = document.getElementById('createOrderForm');
    if (orderForm) {
      orderForm.addEventListener('submit', this.handleOrderSubmit.bind(this));
    }

    // Status filter buttons
    const filterButtons = document.querySelectorAll('.order-filter-btn');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentFilter = btn.dataset.status || 'all';
        this.refreshOrders();
      });
    });

    // Refresh button
    const refreshBtn = document.getElementById('refreshOrdersBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshOrders());
    }
  }

  async handleOrderSubmit(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const orderData = {
      businessId: formData.get('businessId'),
      customerId: formData.get('customerId'),
      customerName: formData.get('customerName'),
      customerPhone: formData.get('customerPhone'),
      deliveryAddress: {
        street: formData.get('street'),
        city: formData.get('city'),
        zipCode: formData.get('zipCode'),
        coordinates: {
          latitude: parseFloat(formData.get('latitude') || 0),
          longitude: parseFloat(formData.get('longitude') || 0)
        }
      },
      items: JSON.parse(formData.get('items') || '[]'),
      totalAmount: parseFloat(formData.get('totalAmount')),
      notes: formData.get('notes'),
      estimatedDeliveryTime: formData.get('estimatedDeliveryTime')
    };

    try {
      showLoader(true, 'Placing order...');
      
      const result = await this.orderService.placeOrder(orderData);
      
      showMessage('Order placed successfully! Merchant has been notified.', 'success');
      
      // Reset form
      event.target.reset();
      
      // Refresh orders list
      await this.refreshOrders();
      
    } catch (error) {
      console.error('Error placing order:', error);
      showMessage(`Failed to place order: ${error.message}`, 'error');
    } finally {
      showLoader(false);
    }
  }

  async refreshOrders() {
    try {
      showLoader(true, 'Refreshing orders...');
      
      // Get current user info
      const user = Auth.getCurrentUser();
      if (!user) throw new Error('User not authenticated');

      let orders = [];

      // Get orders based on user role
      if (user.role === 'customer') {
        const result = await this.orderService.getCustomerOrderHistory(user.userId);
        orders = result.orders || [];
      } else if (user.role === 'admin') {
        // Admin can see all orders - use existing DynamoDB scan
        const dynamoDB = await AWSUtils.getDynamoDBClient();
        const params = { TableName: 'order-receiver-orders-dev' };
        const result = await dynamoDB.scan(params).promise();
        orders = result.Items || [];
      }

      // Filter orders based on current filter
      if (this.currentFilter !== 'all') {
        orders = orders.filter(order => order.status === this.currentFilter);
      }

      // Update UI
      this.renderOrdersTable(orders);
      
      hideMessage();
      
    } catch (error) {
      console.error('Error refreshing orders:', error);
      showMessage(`Error refreshing orders: ${error.message}`, 'error');
    } finally {
      showLoader(false);
    }
  }

  renderOrdersTable(orders) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (orders.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center" style="padding: 2rem; color: #666;">
            <i class="fas fa-shopping-bag" style="font-size: 3rem; margin-bottom: 1rem; color: #ddd;"></i>
            <div>No orders found</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = orders.map(order => {
      const statusInfo = ORDER_STATUSES[order.status] || ORDER_STATUSES['unknown'];
      
      return `
        <tr>
          <td>
            <div class="order-info">
              <strong>${order.orderId}</strong>
              <small class="d-block text-muted">${formatDate(order.createdAt)}</small>
            </div>
          </td>
          <td>
            <div class="customer-info">
              <strong>${order.customerName || order.customerId}</strong>
              <small class="d-block text-muted">${order.customerPhone || ''}</small>
            </div>
          </td>
          <td>
            <span class="merchant-badge">${order.businessId}</span>
          </td>
          <td>
            <span class="status-badge status-${statusInfo.class}">
              <i class="material-icons">${statusInfo.icon}</i>
              ${statusInfo.label}
            </span>
          </td>
          <td>
            <strong>$${typeof order.totalAmount === 'number' ? order.totalAmount.toFixed(2) : order.totalAmount}</strong>
          </td>
          <td>
            <div class="delivery-info">
              <small>${order.deliveryAddress ? 
                `${order.deliveryAddress.street}, ${order.deliveryAddress.city}` : 
                'N/A'}</small>
            </div>
          </td>
          <td>
            <div class="actions">
              <button class="btn-action" onclick="viewOrderDetails('${order.orderId}')" title="View Details">
                <i class="fas fa-eye"></i>
              </button>
              <button class="btn-action" onclick="trackOrder('${order.orderId}')" title="Track Order">
                <i class="fas fa-map-marker-alt"></i>
              </button>
              ${order.status === 'pending' ? `
                <button class="btn-action danger" onclick="cancelOrder('${order.orderId}')" title="Cancel Order">
                  <i class="fas fa-times"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  startAutoRefresh() {
    // Refresh orders every 30 seconds for real-time updates
    this.refreshInterval = setInterval(() => {
      this.refreshOrders();
    }, 30000);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

// Global function for order actions
async function viewOrderDetails(orderId) {
  try {
    const orderStatus = await window.CentralPlatformOrderService.getOrderStatus(orderId);
    
    // Create modal or popup with order details
    const modalContent = `
      <div class="modal-header">
        <h3>Order Details: ${orderId}</h3>
      </div>
      <div class="modal-body">
        <div class="order-detail-grid">
          <div class="detail-item">
            <label>Status:</label>
            <span class="status-badge status-${ORDER_STATUSES[orderStatus.status]?.class || 'unknown'}">
              ${ORDER_STATUSES[orderStatus.status]?.label || orderStatus.status}
            </span>
          </div>
          <div class="detail-item">
            <label>Customer:</label>
            <span>${orderStatus.customerName}</span>
          </div>
          <div class="detail-item">
            <label>Total Amount:</label>
            <span>$${orderStatus.totalAmount}</span>
          </div>
          <div class="detail-item">
            <label>Created:</label>
            <span>${formatDate(orderStatus.createdAt)}</span>
          </div>
          ${orderStatus.estimatedCompletionTime ? `
          <div class="detail-item">
            <label>Estimated Completion:</label>
            <span>${formatDate(orderStatus.estimatedCompletionTime)}</span>
          </div>
          ` : ''}
          ${orderStatus.merchantNotes ? `
          <div class="detail-item">
            <label>Merchant Notes:</label>
            <span>${orderStatus.merchantNotes}</span>
          </div>
          ` : ''}
        </div>
        
        <h4>Items:</h4>
        <div class="items-list">
          ${orderStatus.items.map(item => `
            <div class="item-row">
              <span class="item-name">${item.name}</span>
              <span class="item-quantity">x${item.quantity}</span>
              <span class="item-price">$${item.price}</span>
            </div>
          `).join('')}
        </div>
        
        ${orderStatus.deliveryAddress ? `
        <h4>Delivery Address:</h4>
        <div class="address-info">
          ${orderStatus.deliveryAddress.street}<br>
          ${orderStatus.deliveryAddress.city}, ${orderStatus.deliveryAddress.zipCode}
        </div>
        ` : ''}
      </div>
    `;
    
    // Show modal (implement your modal system here)
    showModal('Order Details', modalContent);
    
  } catch (error) {
    console.error('Error viewing order details:', error);
    showMessage(`Failed to load order details: ${error.message}`, 'error');
  }
}

async function trackOrder(orderId) {
  try {
    const orderStatus = await window.CentralPlatformOrderService.getOrderStatus(orderId);
    
    // Implement order tracking UI
    console.log('Track order:', orderStatus);
    showMessage('Order tracking feature coming soon!', 'info');
    
  } catch (error) {
    console.error('Error tracking order:', error);
    showMessage(`Failed to track order: ${error.message}`, 'error');
  }
}

async function cancelOrder(orderId) {
  if (!confirm('Are you sure you want to cancel this order?')) {
    return;
  }
  
  try {
    // Implement order cancellation
    showMessage('Order cancellation feature coming soon!', 'info');
    
  } catch (error) {
    console.error('Error canceling order:', error);
    showMessage(`Failed to cancel order: ${error.message}`, 'error');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page === 'orders') {
    const orderUI = new OrderManagementUI();
    await orderUI.initialize();
    window.orderManagementUI = orderUI;
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (window.orderManagementUI) {
    window.orderManagementUI.stopAutoRefresh();
  }
});

// Helper functions
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function showModal(title, content) {
  // Implement your modal system here
  // This is a placeholder for the actual modal implementation
  alert(`${title}\n\n${content.replace(/<[^>]*>/g, '')}`);
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CentralPlatformOrderService,
    OrderManagementUI
  };
}
