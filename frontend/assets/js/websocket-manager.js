/**
 * WebSocket Real-Time Integration for Central Platform
 * Connects to AWS API Gateway WebSocket API for real-time notifications
 */

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.businessId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000; // Increased base delay
        this.maxReconnectDelay = 30000; // Added max delay cap
        this.pingInterval = null;
        this.isConnected = false;
        this.listeners = {};
        this.eventHandlers = {}; // Add event handling capability

        // Channel-based routing for live chat and other features
        this.channels = new Map(); // channel -> Set<handler>
        this.globalHandlers = new Set();

        // New stability features
        this.connectionId = null;
        this.messageQueue = [];
        this.pendingMessages = new Map();
        this.messageCounter = 0;
        this.lastHeartbeatResponse = null;
        this.connectionHealth = 'unknown';
        this.healthCheckTimer = null;
        this.connectionTimeoutTimer = null;

        // Optimized intervals for AWS API Gateway
        this.heartbeatInterval = 45000; // 45 seconds (AWS optimized)
        this.heartbeatTimeout = 5000;
        this.healthCheckInterval = 60000;
        this.connectionTimeout = 10000;
    }

    /**
     * Add event listener
     */
    on(event, callback) {
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(callback);
    }

    /**
     * Remove event listener
     */
    off(event, callback) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event] = this.eventHandlers[event].filter(cb => cb !== callback);
        }
    }

    /**
     * Emit event to all listeners
     */
    emit(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }    /**
     * Initialize WebSocket connection with improved stability
     */
    async connect(businessId) {
        if (!businessId) {
            console.error('❌ Business ID is required for WebSocket connection');
            return false;
        }

        this.businessId = businessId;
        this.connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        try {
            // Get WebSocket URL from configuration
            const wsUrl = this.getWebSocketUrl();
            console.log(`🔌 [${this.connectionId}] Connecting to WebSocket: ${wsUrl}`);

            this.ws = new WebSocket(wsUrl);
            this.setupEventHandlers();

            return new Promise((resolve, reject) => {
                // Set connection timeout
                this.connectionTimeoutTimer = setTimeout(() => {
                    this.ws.close();
                    reject(new Error('Connection timeout'));
                }, this.connectionTimeout);

                this.ws.onopen = () => {
                    clearTimeout(this.connectionTimeoutTimer);
                    this.onConnected();
                    resolve(true);
                };

                this.ws.onerror = (error) => {
                    clearTimeout(this.connectionTimeoutTimer);
                    console.error('WebSocket connection error:', error);
                    reject(error);
                };
            });

        } catch (error) {
            console.error('Failed to initialize WebSocket:', error);
            return false;
        }
    }

    /**
     * Get WebSocket URL from environment
     */
    getWebSocketUrl() {
        const wsEndpoint = (window.WIZZCENTRAL_CONFIG && window.WIZZCENTRAL_CONFIG.WEBSOCKET && window.WIZZCENTRAL_CONFIG.WEBSOCKET.LIVE_CHAT_URL) || '';

        if (!wsEndpoint) {
            throw new Error('Missing LIVE_CHAT_URL. Set window.__LIVE_CHAT_WEBSOCKET_URL__ in frontend/config.js injection.');
        }

        if (String(wsEndpoint).includes('/dev')) {
            throw new Error(`Refusing to connect to dev WebSocket endpoint: ${wsEndpoint}`);
        }

        console.log(`🔌 Connecting to WebSocket: ${wsEndpoint}`);

        // Connect as support agent for receiving chat messages from merchants and drivers
        return `${wsEndpoint}?businessId=${this.businessId}&userType=support&agentId=wizzcentral-platform&platform=web&appVersion=1.0.0`;
    }

    /**
     * Setup WebSocket event handlers
     */
    setupEventHandlers() {
        this.ws.onopen = () => this.onConnected();
        this.ws.onclose = (event) => this.onDisconnected(event);
        this.ws.onerror = (error) => this.onError(error);
        this.ws.onmessage = (event) => this.onMessage(event);
    }    /**
     * Handle WebSocket connection opened with enhanced features
     */
    onConnected() {
        console.log(`✅ [${this.connectionId}] WebSocket connected successfully`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 2000; // Reset delay
        this.connectionHealth = 'good';

        // Start optimized heartbeat system
        this.startPing();
        this.startHealthCheck();

        // Process any queued messages
        this.processMessageQueue();

        // Emit connection event
        this.emit('connected', { businessId: this.businessId, connectionId: this.connectionId });

        // Update UI connection status
        this.updateConnectionStatus('Connected', 'success');
    }

    /**
     * Handle WebSocket connection closed with improved reconnection
     */
    onDisconnected(event) {
        console.log(`❌ [${this.connectionId}] WebSocket disconnected: ${event.code} - ${event.reason}`);
        this.isConnected = false;
        this.connectionHealth = 'disconnected';
        this.stopPing();
        this.stopHealthCheck();

        // Update UI connection status
        this.updateConnectionStatus('Disconnected', 'error');

        // Only attempt reconnection for unexpected disconnections
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`❌ [${this.connectionId}] Max reconnection attempts reached`);
            this.emit('reconnect_failed', {
                connectionId: this.connectionId,
                attempts: this.reconnectAttempts
            });
        }

        this.emit('disconnected', {
            connectionId: this.connectionId,
            code: event.code,
            reason: event.reason
        });
    }

    /**
     * Handle WebSocket errors
     */
    onError(error) {
        console.error('❌ WebSocket error:', error);
        this.updateConnectionStatus('Error', 'error');
        this.emit('error', error);
    }    /**
     * Enhanced message handling with acknowledgments and channel routing
     */
    onMessage(event) {
        try {
            const message = JSON.parse(event.data);
            console.log(`📨 [${this.connectionId}] WebSocket message received:`, message);

            // Handle heartbeat responses
            if (message.type === 'ping_response' || message.type === 'pong') {
                this.lastHeartbeatResponse = Date.now();
                this.connectionHealth = 'good';
                console.log(`🏓 [${this.connectionId}] Heartbeat response received`);
                return;
            }

            // Handle message acknowledgments
            if (message.type === 'message_ack' && message.messageId) {
                this.pendingMessages.delete(message.messageId);
                return;
            }

            // Route to channel subscribers first (new channel-based routing)
            const channel = message.channel || (message.meta && message.meta.channel);
            if (channel && this.channels.has(channel)) {
                this.channels.get(channel).forEach(handler => {
                    try {
                        handler(message);
                    } catch (e) {
                        console.error(`❌ Channel handler error for ${channel}:`, e);
                    }
                });
            }

            // Route to global handlers (for backward compatibility)
            this.globalHandlers.forEach(handler => {
                try {
                    handler(message);
                } catch (e) {
                    console.error('❌ Global handler error:', e);
                }
            });

            // Handle different message types (existing functionality)
            switch (message.type) {
                case 'connection_established':
                    console.log('🎉 Connection established:', message.message);
                    break;

                case 'chat_message':
                case 'CHAT_MESSAGE':
                case 'INCOMING_CHAT':
                case 'AGENT_JOINED':
                case 'CHAT_END':
                    this.handleChatMessage(message);
                    break;

                case 'new_order':
                    this.handleNewOrder(message);
                    break;

                case 'order_status_update':
                    this.handleOrderStatusUpdate(message);
                    break;

                case 'test_notification':
                    this.handleTestNotification(message);
                    break;

                default:
                    console.log('📨 Unknown message type:', message.type);
            }

            // Emit message event for custom handlers
            this.emit('message', message);

        } catch (error) {
            console.error(`❌ [${this.connectionId}] Error parsing WebSocket message:`, error);
        }
    }

    /**
     * Handle chat message notifications from drivers
     */
    handleChatMessage(message) {
        console.log('💬 Chat message from driver:', message);

        const driverName = message.metadata?.senderName || 'Driver';
        const messageText = message.messageText || 'New message';

        // Show browser notification
        this.showBrowserNotification(
            `Message from ${driverName}`,
            messageText.length > 100 ? messageText.substring(0, 100) + '...' : messageText,
            'chat-message'
        );

        // Update chat UI if available
        if (typeof window.handleChatMessage === 'function') {
            window.handleChatMessage(message);
        }

        // Play notification sound for chat messages
        this.playNotificationSound();

        // Emit chat message event
        this.emit('chat_message', message);
    }

    /**
     * Handle new order notifications
     */
    handleNewOrder(message) {
        console.log('🆕 New order notification:', message.order);

        // Show browser notification if permission granted
        this.showBrowserNotification(
            'New Order Received!',
            `Order ${message.orderId} from ${message.order.customerName}`,
            'new-order'
        );

        // Update orders table in real-time
        if (typeof window.handleNewOrderNotification === 'function') {
            window.handleNewOrderNotification(message.order);
        }

        // Play notification sound
        this.playNotificationSound();

        this.emit('new_order', message);
    }

    /**
     * Handle order status update notifications
     */
    handleOrderStatusUpdate(message) {
        console.log('📊 Order status update:', message);

        // Update UI
        if (typeof window.handleOrderStatusUpdate === 'function') {
            window.handleOrderStatusUpdate(message);
        }

        this.emit('order_status_update', message);
    }

    /**
     * Handle test notifications
     */
    handleTestNotification(message) {
        console.log('🧪 Test notification:', message.message);

        this.showBrowserNotification(
            'Test Notification',
            message.message,
            'test'
        );

        this.emit('test_notification', message);
    }

    /**
     * Enhanced message sending with queuing and retry
     */
    send(message) {
        if (typeof message === 'object') {
            message.messageId = `msg_${++this.messageCounter}_${Date.now()}`;
            message.connectionId = this.connectionId;
            message.timestamp = new Date().toISOString();
        }

        if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(message));

                // Track pending message for acknowledgment (if needed)
                if (message.messageId) {
                    this.pendingMessages.set(message.messageId, {
                        message,
                        timestamp: Date.now()
                    });
                }

                console.log(`📤 [${this.connectionId}] Message sent: ${message.type || 'unknown'}`);
                return true;
            } catch (error) {
                console.error(`❌ [${this.connectionId}] Failed to send message:`, error);
                this.queueMessage(message);
                return false;
            }
        } else {
            console.log(`📦 [${this.connectionId}] WebSocket not connected, queuing message`);
            this.queueMessage(message);
            return false;
        }
    }

    /**
     * Optimized ping system for AWS API Gateway
     */
    startPing() {
        this.stopPing();

        this.pingInterval = setInterval(() => {
            if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
                const pingMessage = {
                    type: 'ping',
                    timestamp: new Date().toISOString(),
                    connectionId: this.connectionId
                };
                this.send(pingMessage);

                // Check for ping timeout
                setTimeout(() => {
                    if (this.lastHeartbeatResponse &&
                        (Date.now() - this.lastHeartbeatResponse) > this.heartbeatTimeout) {
                        this.connectionHealth = 'poor';
                        console.warn(`⚠️ [${this.connectionId}] Ping timeout detected`);
                    }
                }, this.heartbeatTimeout);
            }
        }, this.heartbeatInterval); // 45 seconds for AWS optimization

        console.log(`🏓 [${this.connectionId}] Heartbeat started (${this.heartbeatInterval}ms interval)`);
    }

    /**
     * Stop ping interval
     */
    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }    /**
     * Smart reconnection with exponential backoff and jitter
     */
    scheduleReconnect() {
        this.reconnectAttempts++;

        // Exponential backoff with jitter to prevent thundering herd
        const baseDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        const jitter = Math.random() * 1000; // Add up to 1 second jitter
        const delay = Math.min(baseDelay + jitter, this.maxReconnectDelay);

        console.log(`🔄 [${this.connectionId}] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${Math.round(delay)}ms`);

        setTimeout(async () => {
            if (this.reconnectAttempts <= this.maxReconnectAttempts) {
                console.log(`🔄 [${this.connectionId}] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                try {
                    await this.connect(this.businessId);
                } catch (error) {
                    console.error(`❌ [${this.connectionId}] Reconnection failed:`, error);

                    if (this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    } else {
                        this.emit('reconnect_failed', {
                            connectionId: this.connectionId,
                            attempts: this.reconnectAttempts
                        });
                    }
                }
            }
        }, delay);
    }

    /**
     * Update connection status in UI
     */
    updateConnectionStatus(status, type) {
        const statusElement = document.getElementById('realtime-status');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = `status-${type}`;
        }

        const lastUpdateElement = document.getElementById('last-update');
        if (lastUpdateElement) {
            lastUpdateElement.textContent = new Date().toLocaleTimeString();
        }
    }

    /**
     * Show browser notification
     */
    async showBrowserNotification(title, body, tag) {
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                new Notification(title, {
                    body: body,
                    tag: tag,
                    icon: '/favicon.ico',
                    badge: '/favicon.ico'
                });
            } else if (Notification.permission === 'default') {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    new Notification(title, { body: body, tag: tag });
                }
            }
        }
    }

    /**
     * Play notification sound
     */
    playNotificationSound() {
        try {
            // Create a simple notification sound
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.2);

            gainNode.gain.setValueAtTime(0, audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (error) {
            console.log('Could not play notification sound:', error);
        }
    }

    /**
     * Enhanced disconnect with cleanup
     */
    disconnect() {
        console.log(`🔌 [${this.connectionId}] Disconnecting WebSocket`);

        this.stopPing();
        this.stopHealthCheck();

        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
        }

        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }

        this.isConnected = false;
        this.emit('manual_disconnect', { connectionId: this.connectionId });
    }

    /**
     * Enhanced connection status with detailed metrics
     */
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            connectionId: this.connectionId,
            businessId: this.businessId,
            health: this.connectionHealth,
            reconnectAttempts: this.reconnectAttempts,
            queuedMessages: this.messageQueue.length,
            pendingMessages: this.pendingMessages.size,
            lastHeartbeat: this.lastHeartbeatResponse ? new Date(this.lastHeartbeatResponse) : null,
            uptime: this.isConnected ? Date.now() - (this.lastHeartbeatResponse || Date.now()) : 0
        };
    }

    /**
     * Queue message for later delivery
     */
    queueMessage(message) {
        if (this.messageQueue.length >= 100) { // Limit queue size
            this.messageQueue.shift(); // Remove oldest message
        }
        this.messageQueue.push(message);
        console.log(`📦 [${this.connectionId}] Message queued (${this.messageQueue.length} in queue)`);
    }

    /**
     * Process queued messages
     */
    processMessageQueue() {
        console.log(`📤 [${this.connectionId}] Processing ${this.messageQueue.length} queued messages`);
        while (this.messageQueue.length > 0 && this.isConnected) {
            const message = this.messageQueue.shift();
            this.send(message);
        }
    }

    /**
     * Start connection health monitoring
     */
    startHealthCheck() {
        this.stopHealthCheck();

        this.healthCheckTimer = setInterval(() => {
            if (this.isConnected) {
                const now = Date.now();
                const timeSinceLastHeartbeat = this.lastHeartbeatResponse ?
                    now - this.lastHeartbeatResponse : Infinity;

                // Check if connection is unhealthy
                if (timeSinceLastHeartbeat > this.heartbeatInterval * 2) {
                    this.connectionHealth = 'poor';
                    console.warn(`⚠️ [${this.connectionId}] Connection health degraded (${timeSinceLastHeartbeat}ms since last heartbeat)`);

                    // Attempt recovery if connection is very poor
                    if (timeSinceLastHeartbeat > this.heartbeatInterval * 3) {
                        console.log(`🔧 [${this.connectionId}] Attempting connection recovery`);
                        this.ws.close(1000, 'Connection recovery');
                    }
                }

                this.emit('health_check', {
                    connectionId: this.connectionId,
                    health: this.connectionHealth,
                    timeSinceLastHeartbeat,
                    queuedMessages: this.messageQueue.length
                });
            }
        }, this.healthCheckInterval);

        console.log(`💊 [${this.connectionId}] Health monitoring started`);
    }

    /**
     * Stop health monitoring
     */
    stopHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    /**
     * Subscribe to a channel for live chat and other features
     * @param {string} channel - Channel name (e.g., 'chat', 'orders', 'location')
     * @param {function} handler - Message handler function
     * @returns {function} - Unsubscribe function
     */
    subscribe(channel, handler) {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        
        const channelSet = this.channels.get(channel);
        channelSet.add(handler);
        
        console.log(`📡 Subscribed to channel: ${channel} (${channelSet.size} subscribers)`);
        
        // Return unsubscribe function
        return () => {
            channelSet.delete(handler);
            if (channelSet.size === 0) {
                this.channels.delete(channel);
            }
            console.log(`📡 Unsubscribed from channel: ${channel}`);
        };
    }

    /**
     * Add global message handler (for backward compatibility)
     * @param {function} handler - Message handler function
     * @returns {function} - Unsubscribe function
     */
    onMessage(handler) {
        this.globalHandlers.add(handler);
        return () => this.globalHandlers.delete(handler);
    }

    /**
     * Publish a message to a specific channel
     * @param {object} options - Message options
     * @param {string} options.action - Action for API Gateway routing
     * @param {string} options.channel - Channel name
     * @param {string} options.subchannel - Subchannel for further routing
     * @param {string} options.type - Message type
     * @param {object} options.payload - Message payload
     * @param {object} options.meta - Additional metadata
     * @returns {boolean} - True if sent immediately, false if queued
     */
    publish({ action, channel, subchannel, type, payload, meta = {} }) {
        const message = {
            action: action || 'route',
            channel,
            subchannel,
            type,
            payload,
            meta: {
                timestamp: Date.now(),
                connectionId: this.connectionId,
                ...meta
            }
        };
        
        return this.sendMessage(message);
    }

    /**
     * Set authentication for this connection
     * @param {object} auth - Authentication data (userId, token, etc.)
     */
    setAuth(auth) {
        this.auth = auth;
        if (this.isConnected) {
            this.sendMessage({
                action: 'authenticate',
                type: 'AUTH',
                auth: this.auth
            });
        }
    }

    /**
     * Get detailed status including channel information
     * @returns {object} - Connection status
     */
    getDetailedStatus() {
        return {
            ...this.getStatus(),
            channelCount: this.channels.size,
            subscriberCount: Array.from(this.channels.values()).reduce((sum, set) => sum + set.size, 0),
            channels: Array.from(this.channels.keys()),
            globalHandlers: this.globalHandlers.size
        };
    }
}

// Make WebSocketManager available globally for live chat
if (typeof window !== 'undefined') {
    window.WebSocketManager = WebSocketManager;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketManager;
}

// Global WebSocket manager instance
window.WebSocketManager = WebSocketManager;

// Auto-initialize WebSocket manager globally for all pages that need real-time functionality
// Skip auto-init if a page explicitly disables it (e.g., support.html using LiveChatSocket directly)
document.addEventListener('DOMContentLoaded', () => {
    if (window.DISABLE_GLOBAL_WS_MANAGER) {
        console.log('ℹ️ Global WebSocketManager auto-init disabled on this page');
        return;
    }

    // Always initialize WebSocket manager for live chat and real-time features
    const businessId = '7ccf646c-9594-48d4-8f63-c366d89257e5'; // Updated to match working config

    window.wsManager = new WebSocketManager();

    // Connect to WebSocket for all pages
    window.wsManager.connect(businessId).then((connected) => {
        if (connected) {
            console.log('🎉 Real-time WebSocket connection established!');

            // Dispatch global event for components that need to know WebSocket is ready
            window.dispatchEvent(new CustomEvent('websocket-ready', {
                detail: { manager: window.wsManager, businessId: businessId }
            }));
        } else {
            console.warn('⚠️ Real-time WebSocket connection not available');
        }
    }).catch((error) => {
        console.error('❌ Failed to establish WebSocket connection:', error);
    });

    // Orders page specific functionality
    if (window.location.pathname.includes('orders.html')) {

        // Handle new orders in the orders table
        window.handleNewOrderNotification = (order) => {
            console.log('🆕 Adding new order to table:', order);

            // Add to orders data if orders.js is loaded
            if (typeof window.ordersData !== 'undefined' && typeof window.renderOrdersTable === 'function') {
                const newOrderDisplay = {
                    orderId: order.orderId,
                    customerId: order.customerId,
                    merchantId: order.businessId,
                    driverId: 'N/A',
                    status: order.status || 'pending',
                    total: `$${parseFloat(order.total || 0).toFixed(2)}`,
                    date: new Date().toLocaleDateString(),
                    fullData: order
                };

                window.ordersData.unshift(newOrderDisplay);
                window.filteredOrders = [...window.ordersData];
                window.renderOrdersTable();

                // Show success message
                if (typeof window.showMessage === 'function') {
                    window.showMessage(`🆕 New order ${order.orderId} received in real-time!`, 'success');
                }
            }
        };

        // Handle order status updates
        window.handleOrderStatusUpdate = (update) => {
            console.log('📊 Updating order status:', update);

            if (typeof window.ordersData !== 'undefined' && typeof window.renderOrdersTable === 'function') {
                const orderIndex = window.ordersData.findIndex(o => o.orderId === update.orderId);
                if (orderIndex !== -1) {
                    window.ordersData[orderIndex].status = update.newStatus;
                    window.filteredOrders = [...window.ordersData];
                    window.renderOrdersTable();

                    if (typeof window.showMessage === 'function') {
                        window.showMessage(`📊 Order ${update.orderId} status updated to ${update.newStatus}`, 'info');
                    }
                }
            }
        };
    }
});
