// Amazon Connect Enhanced UI Features Service
// Provides typing indicators, read receipts, message status updates, and real-time enhancements

class AmazonConnectUIService {
    constructor() {
        const cfg = (typeof window !== 'undefined' && window.WIZZCENTRAL_CONFIG) ? window.WIZZCENTRAL_CONFIG : {};
        this.apiBaseUrl = cfg.AMAZON_CONNECT_API_BASE_URL || cfg.API_BASE_URL || '';
        this.wsUrl = cfg.AMAZON_CONNECT_WS_URL || (cfg.WEBSOCKET && cfg.WEBSOCKET.LIVE_CHAT_URL) || '';

        if (!this.apiBaseUrl) {
            throw new Error('Missing API base URL. Set window.__API_BASE_URL__ (or window.__AMAZON_CONNECT_API_BASE_URL__).');
        }
        if (String(this.apiBaseUrl).includes('/dev')) {
            throw new Error(`Refusing to use dev Amazon Connect API base URL in staging: ${this.apiBaseUrl}`);
        }
        if (!this.wsUrl) {
            throw new Error('Missing WebSocket URL. Set window.__LIVE_CHAT_WEBSOCKET_URL__ (or window.__AMAZON_CONNECT_WS_URL__).');
        }
        if (String(this.wsUrl).includes('/dev')) {
            throw new Error(`Refusing to use dev Amazon Connect WebSocket URL in staging: ${this.wsUrl}`);
        }
        this.websocket = null;
        this.typingIndicators = new Map();
        this.messageStatuses = new Map();
        this.readReceipts = new Map();
        this.connectionId = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.typingTimeout = null;
        this.presenceStatus = 'online';
    }

    /**
     * Initialize WebSocket connection for real-time features
     */
    async initialize(contactId = null) {
        try {
            console.log('🚀 Initializing Amazon Connect UI enhanced features...');

            await this.connectWebSocket(contactId);
            this.setupEventListeners();
            this.startHeartbeat();

            console.log('✅ Amazon Connect UI Service initialized');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Amazon Connect UI service:', error);
            return false;
        }
    }

    /**
     * Connect to WebSocket for real-time features
     */
    async connectWebSocket(contactId = null) {
        try {
            let wsUrl = this.wsUrl;
            if (contactId) {
                wsUrl += `?contactId=${contactId}&userType=agent`;
            }

            console.log('🔌 Connecting to WebSocket:', wsUrl);

            this.websocket = new WebSocket(wsUrl);

            this.websocket.onopen = (event) => {
                console.log('✅ WebSocket connected for enhanced UI features');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;

                // Send initial presence
                this.updatePresenceStatus('online');

                this.emitUIEvent('websocket-connected', { connectionId: this.connectionId });
            };

            this.websocket.onmessage = (event) => {
                this.handleWebSocketMessage(event);
            };

            this.websocket.onclose = (event) => {
                console.log('🔌 WebSocket disconnected for enhanced UI features');
                this.isConnected = false;
                this.scheduleReconnect();

                this.emitUIEvent('websocket-disconnected', { code: event.code, reason: event.reason });
            };

            this.websocket.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.emitUIEvent('websocket-error', { error });
            };

            return new Promise((resolve, reject) => {
                this.websocket.addEventListener('open', resolve);
                this.websocket.addEventListener('error', reject);
            });

        } catch (error) {
            console.error('❌ Failed to connect WebSocket:', error);
            throw error;
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('📨 Received enhanced UI message:', message);

            switch (message.type) {
                case 'connection_established':
                    this.connectionId = message.connectionId;
                    break;

                case 'typing_indicator':
                    this.handleTypingIndicator(message);
                    break;

                case 'typing_stopped':
                    this.handleTypingStopped(message);
                    break;

                case 'message_read':
                    this.handleMessageRead(message);
                    break;

                case 'message_delivered':
                    this.handleMessageDelivered(message);
                    break;

                case 'presence_update':
                    this.handlePresenceUpdate(message);
                    break;

                case 'agent_joined':
                    this.handleAgentJoined(message);
                    break;

                case 'agent_left':
                    this.handleAgentLeft(message);
                    break;

                case 'heartbeat_response':
                    console.log('💓 Heartbeat response received');
                    break;

                default:
                    console.log('📨 Unknown enhanced UI message type:', message.type);
            }

        } catch (error) {
            console.error('❌ Error handling WebSocket message:', error);
        }
    }

    /**
     * Send typing indicator
     */
    async sendTypingIndicator(contactId, isTyping = true) {
        try {
            if (!this.isConnected) {
                console.warn('⚠️ Cannot send typing indicator - WebSocket not connected');
                return;
            }

            const message = {
                type: isTyping ? 'typing_indicator' : 'typing_stopped',
                contactId: contactId,
                participantId: this.getParticipantId(),
                timestamp: new Date().toISOString()
            };

            this.sendWebSocketMessage(message);

            // Also send via HTTP for reliability
            await fetch(`${this.apiBaseUrl}/chat/typing-indicator`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify(message)
            });

            console.log(`⌨️ Typing indicator sent: ${isTyping ? 'typing' : 'stopped'}`);

        } catch (error) {
            console.error('❌ Failed to send typing indicator:', error);
        }
    }

    /**
     * Handle typing indicator received
     */
    handleTypingIndicator(message) {
        const { contactId, participantId, senderName } = message;

        this.typingIndicators.set(participantId, {
            contactId,
            senderName: senderName || 'Someone',
            timestamp: new Date()
        });

        this.displayTypingIndicator(contactId, participantId, senderName);

        // Auto-clear typing indicator after 3 seconds
        setTimeout(() => {
            if (this.typingIndicators.has(participantId)) {
                this.handleTypingStopped({ participantId, contactId });
            }
        }, 3000);

        this.emitUIEvent('typing-indicator', message);
    }

    /**
     * Handle typing stopped
     */
    handleTypingStopped(message) {
        const { participantId, contactId } = message;

        this.typingIndicators.delete(participantId);
        this.hideTypingIndicator(contactId, participantId);

        this.emitUIEvent('typing-stopped', message);
    }

    /**
     * Display typing indicator in UI
     */
    displayTypingIndicator(contactId, participantId, senderName) {
        const chatContainer = this.getChatContainer(contactId);
        if (!chatContainer) return;

        // Remove existing typing indicator for this participant
        this.hideTypingIndicator(contactId, participantId);

        // Create typing indicator element
        const typingElement = document.createElement('div');
        typingElement.className = 'typing-indicator';
        typingElement.id = `typing-${participantId}`;
        typingElement.innerHTML = `
            <div class="typing-content">
                <div class="typing-avatar">
                    <i class="fas fa-user"></i>
                </div>
                <div class="typing-message">
                    <div class="typing-text">
                        <span class="typing-name">${senderName || 'Customer'}</span> is typing
                    </div>
                    <div class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            </div>
        `;

        // Insert at the end of the messages container
        const messagesContainer = chatContainer.querySelector('.chat-messages');
        if (messagesContainer) {
            messagesContainer.appendChild(typingElement);
            this.scrollToBottom(messagesContainer);
        }
    }

    /**
     * Hide typing indicator from UI
     */
    hideTypingIndicator(contactId, participantId) {
        const typingElement = document.getElementById(`typing-${participantId}`);
        if (typingElement) {
            typingElement.remove();
        }
    }

    /**
     * Send message read receipt
     */
    async sendMessageRead(contactId, messageId) {
        try {
            const message = {
                type: 'message_read',
                contactId: contactId,
                messageId: messageId,
                participantId: this.getParticipantId(),
                timestamp: new Date().toISOString()
            };

            if (this.isConnected) {
                this.sendWebSocketMessage(message);
            }

            // Also send via HTTP
            await fetch(`${this.apiBaseUrl}/chat/message-read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify(message)
            });

            console.log('✅ Message read receipt sent:', messageId);

        } catch (error) {
            console.error('❌ Failed to send read receipt:', error);
        }
    }

    /**
     * Handle message read receipt
     */
    handleMessageRead(message) {
        const { messageId, participantId, timestamp } = message;

        this.readReceipts.set(messageId, {
            participantId,
            readAt: timestamp
        });

        this.updateMessageReadStatus(messageId, true);

        this.emitUIEvent('message-read', message);
    }

    /**
     * Handle message delivered receipt
     */
    handleMessageDelivered(message) {
        const { messageId, participantId, timestamp } = message;

        this.messageStatuses.set(messageId, {
            status: 'delivered',
            participantId,
            deliveredAt: timestamp
        });

        this.updateMessageDeliveryStatus(messageId, 'delivered');

        this.emitUIEvent('message-delivered', message);
    }

    /**
     * Update message read status in UI
     */
    updateMessageReadStatus(messageId, isRead) {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            const statusIndicator = messageElement.querySelector('.message-status');
            if (statusIndicator) {
                statusIndicator.classList.toggle('read', isRead);
                statusIndicator.title = isRead ? 'Read' : 'Delivered';

                if (isRead) {
                    statusIndicator.innerHTML = '<i class="fas fa-check-double"></i>';
                } else {
                    statusIndicator.innerHTML = '<i class="fas fa-check"></i>';
                }
            }
        }
    }

    /**
     * Update message delivery status in UI
     */
    updateMessageDeliveryStatus(messageId, status) {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            const statusIndicator = messageElement.querySelector('.message-status') ||
                this.createMessageStatusIndicator();

            statusIndicator.className = `message-status ${status}`;

            switch (status) {
                case 'sending':
                    statusIndicator.innerHTML = '<i class="fas fa-clock"></i>';
                    statusIndicator.title = 'Sending';
                    break;
                case 'sent':
                    statusIndicator.innerHTML = '<i class="fas fa-check"></i>';
                    statusIndicator.title = 'Sent';
                    break;
                case 'delivered':
                    statusIndicator.innerHTML = '<i class="fas fa-check"></i>';
                    statusIndicator.title = 'Delivered';
                    break;
                case 'read':
                    statusIndicator.innerHTML = '<i class="fas fa-check-double"></i>';
                    statusIndicator.title = 'Read';
                    break;
                case 'failed':
                    statusIndicator.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                    statusIndicator.title = 'Failed to send';
                    break;
            }

            if (!messageElement.querySelector('.message-status')) {
                const messageContent = messageElement.querySelector('.message-content');
                if (messageContent) {
                    messageContent.appendChild(statusIndicator);
                }
            }
        }
    }

    /**
     * Create message status indicator element
     */
    createMessageStatusIndicator() {
        const indicator = document.createElement('span');
        indicator.className = 'message-status';
        return indicator;
    }

    /**
     * Update presence status
     */
    async updatePresenceStatus(status) {
        try {
            this.presenceStatus = status;

            const message = {
                type: 'presence_update',
                status: status, // 'online', 'away', 'busy', 'offline'
                timestamp: new Date().toISOString()
            };

            if (this.isConnected) {
                this.sendWebSocketMessage(message);
            }

            // Update UI
            this.updatePresenceUI(status);

            console.log(`👤 Presence updated: ${status}`);

        } catch (error) {
            console.error('❌ Failed to update presence:', error);
        }
    }

    /**
     * Handle presence update from other participants
     */
    handlePresenceUpdate(message) {
        const { participantId, status, timestamp } = message;

        this.updateParticipantPresence(participantId, status);

        this.emitUIEvent('presence-update', message);
    }

    /**
     * Update presence UI
     */
    updatePresenceUI(status) {
        const presenceElements = document.querySelectorAll('.agent-presence-indicator');
        presenceElements.forEach(element => {
            element.className = `agent-presence-indicator ${status}`;
            element.title = `Agent is ${status}`;
        });
    }

    /**
     * Update participant presence
     */
    updateParticipantPresence(participantId, status) {
        const participantElements = document.querySelectorAll(`[data-participant-id="${participantId}"]`);
        participantElements.forEach(element => {
            const presenceIndicator = element.querySelector('.presence-indicator');
            if (presenceIndicator) {
                presenceIndicator.className = `presence-indicator ${status}`;
                presenceIndicator.title = `${status}`;
            }
        });
    }

    /**
     * Handle text input for typing indicators
     */
    handleTextInput(contactId, inputElement) {
        // Clear existing timeout
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }

        // Send typing indicator
        this.sendTypingIndicator(contactId, true);

        // Set timeout to stop typing indicator
        this.typingTimeout = setTimeout(() => {
            this.sendTypingIndicator(contactId, false);
        }, 1000);

        // Also stop typing when input loses focus
        inputElement.addEventListener('blur', () => {
            if (this.typingTimeout) {
                clearTimeout(this.typingTimeout);
            }
            this.sendTypingIndicator(contactId, false);
        }, { once: true });
    }

    /**
     * Auto-scroll to bottom of chat
     */
    scrollToBottom(container) {
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    /**
     * Get chat container for contact
     */
    getChatContainer(contactId) {
        return document.querySelector(`[data-contact-id="${contactId}"]`) ||
            document.querySelector('.active-chat-container');
    }

    /**
     * Send WebSocket message
     */
    sendWebSocketMessage(message) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message));
        } else {
            console.warn('⚠️ WebSocket not connected, cannot send message');
        }
    }

    /**
     * Start heartbeat to keep connection alive
     */
    startHeartbeat() {
        setInterval(() => {
            if (this.isConnected) {
                this.sendWebSocketMessage({
                    type: 'heartbeat',
                    timestamp: new Date().toISOString()
                });
            }
        }, 30000); // Send heartbeat every 30 seconds
    }

    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;

            console.log(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);

            setTimeout(() => {
                this.connectWebSocket();
            }, this.reconnectDelay);

            // Exponential backoff
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        } else {
            console.error('❌ Max reconnection attempts reached');
            this.emitUIEvent('connection-failed', { attempts: this.reconnectAttempts });
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for beforeunload to update presence
        window.addEventListener('beforeunload', () => {
            this.updatePresenceStatus('offline');
        });

        // Listen for visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.updatePresenceStatus('away');
            } else {
                this.updatePresenceStatus('online');
            }
        });

        // Listen for page focus/blur
        window.addEventListener('focus', () => {
            this.updatePresenceStatus('online');
        });

        window.addEventListener('blur', () => {
            this.updatePresenceStatus('away');
        });
    }

    /**
     * Get participant ID (integrate with existing system)
     */
    getParticipantId() {
        // This should integrate with your existing participant tracking
        return this.participantId || 'agent_' + Date.now();
    }

    /**
     * Get auth token
     */
    getAuthToken() {
        if (typeof window.Auth !== 'undefined' && window.Auth.getToken) {
            // Try to get access token first, then ID token as fallback
            return window.Auth.getToken('accessToken') ||
                window.Auth.getToken('idToken') ||
                localStorage.getItem('accessToken') ||
                sessionStorage.getItem('idToken');
        }

        // Fallback to direct session storage access
        return localStorage.getItem('accessToken') ||
            sessionStorage.getItem('idToken') ||
            localStorage.getItem('authToken');
    }

    /**
     * Emit UI events
     */
    emitUIEvent(eventType, data) {
        const event = new CustomEvent(`amazon-connect-ui-${eventType}`, {
            detail: data
        });
        window.dispatchEvent(event);
    }

    /**
     * Handle agent joined chat
     */
    handleAgentJoined(message) {
        console.log('👨‍💼 Agent joined chat:', message);
        this.showSystemMessage(`${message.agentName || 'An agent'} joined the chat`);
        this.emitUIEvent('agent-joined', message);
    }

    /**
     * Handle agent left chat
     */
    handleAgentLeft(message) {
        console.log('👨‍💼 Agent left chat:', message);
        this.showSystemMessage(`${message.agentName || 'Agent'} left the chat`);
        this.emitUIEvent('agent-left', message);
    }

    /**
     * Show system message
     */
    showSystemMessage(message) {
        const activeChat = document.querySelector('.active-chat-container .chat-messages');
        if (activeChat) {
            const systemMsg = document.createElement('div');
            systemMsg.className = 'system-message';
            systemMsg.innerHTML = `
                <div class="system-content">
                    <i class="fas fa-info-circle"></i>
                    <span>${message}</span>
                </div>
            `;
            activeChat.appendChild(systemMsg);
            this.scrollToBottom(activeChat);
        }
    }

    /**
     * Initialize enhanced features for a chat session
     */
    enhanceChatSession(contactId, chatContainer) {
        // Add typing indicator container
        this.addTypingIndicatorContainer(chatContainer);

        // Add message status indicators
        this.addMessageStatusIndicators(chatContainer);

        // Setup input handlers
        this.setupInputHandlers(contactId, chatContainer);

        // Initialize file drag and drop if file service is available
        if (window.amazonConnectFileService) {
            window.amazonConnectFileService.initializeFileDragDrop(chatContainer, contactId);
        }

        console.log('✨ Chat session enhanced with UI features:', contactId);
    }

    /**
     * Add typing indicator container
     */
    addTypingIndicatorContainer(chatContainer) {
        const messagesContainer = chatContainer.querySelector('.chat-messages');
        if (messagesContainer && !messagesContainer.querySelector('.typing-indicators-container')) {
            const typingContainer = document.createElement('div');
            typingContainer.className = 'typing-indicators-container';
            messagesContainer.appendChild(typingContainer);
        }
    }

    /**
     * Add message status indicators
     */
    addMessageStatusIndicators(chatContainer) {
        const messages = chatContainer.querySelectorAll('.message:not(.system-message)');
        messages.forEach(message => {
            if (!message.querySelector('.message-status')) {
                const statusIndicator = this.createMessageStatusIndicator();
                statusIndicator.className = 'message-status sent';
                statusIndicator.innerHTML = '<i class="fas fa-check"></i>';
                statusIndicator.title = 'Sent';

                const messageContent = message.querySelector('.message-content');
                if (messageContent) {
                    messageContent.appendChild(statusIndicator);
                }
            }
        });
    }

    /**
     * Setup input handlers for typing indicators
     */
    setupInputHandlers(contactId, chatContainer) {
        const inputElement = chatContainer.querySelector('.chat-input');
        if (inputElement) {
            inputElement.addEventListener('input', () => {
                this.handleTextInput(contactId, inputElement);
            });

            inputElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    // Stop typing indicator when sending message
                    if (this.typingTimeout) {
                        clearTimeout(this.typingTimeout);
                    }
                    this.sendTypingIndicator(contactId, false);
                }
            });
        }
    }

    /**
     * Disconnect and cleanup
     */
    disconnect() {
        if (this.websocket) {
            this.updatePresenceStatus('offline');
            this.websocket.close();
            this.websocket = null;
        }

        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }

        this.isConnected = false;
        console.log('🔌 Amazon Connect UI Service disconnected');
    }
}

// Global instance
window.amazonConnectUIService = new AmazonConnectUIService();

// Export for CommonJS if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AmazonConnectUIService;
}

console.log('✅ Amazon Connect UI Service loaded');
