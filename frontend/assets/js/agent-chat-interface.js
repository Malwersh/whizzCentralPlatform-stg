/**
 * Agent Chat Interface for Support Dashboard
 * Provides a unified interface for support agents to handle live chat requests
 * Works with the LiveChatManager and WebSocketManager
 */

class AgentChatInterface {
    constructor(options = {}) {
        this.containerId = options.containerId || 'agent-chat-container';
        this.agentId = options.agentId || 'agent_' + Date.now();
        this.agentName = options.agentName || 'Support Agent';
        
        // Chat state
        this.activeSessionId = null;
        this.sessions = new Map();
        this.isInitialized = false;
        
        // UI elements (will be set during initialization)
        this.sessionListEl = null;
        this.chatAreaEl = null;
        this.messageInputEl = null;
        this.sendButtonEl = null;
        
        // Initialize LiveChatManager
        if (typeof LiveChatManager === 'undefined') {
            console.error('❌ LiveChatManager class not available. Check if live-chat-manager.js loaded correctly.');
            throw new Error('LiveChatManager class not found. Please ensure live-chat-manager.js is loaded before agent-chat-interface.js');
        }
        
        this.liveChatManager = new LiveChatManager({
            userType: 'agent',
            userId: this.agentId,
            userDisplayName: this.agentName,
            enableVirtualAgent: true
        });
        
        // Bind event handlers
        this.setupEventHandlers();
        
        console.log('💬 AgentChatInterface initialized for:', this.agentName);
    }

    /**
     * Initialize the chat interface
     */
    async init() {
        if (this.isInitialized) {
            console.warn('💬 AgentChatInterface already initialized');
            return;
        }

        try {
            // Create the UI
            this.createUI();
            
            // Setup LiveChatManager event handlers
            this.setupLiveChatHandlers();
            
            // Start live chat connection (if not already connected)
            if (this.liveChatManager) {
                // The WebSocketManager should already be connected
                console.log('💬 Using existing WebSocket connection for live chat');
            }
            
            this.isInitialized = true;
            console.log('✅ AgentChatInterface initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize AgentChatInterface:', error);
            throw error;
        }
    }

    /**
     * Create the chat interface UI
     */
    createUI() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            throw new Error(`Container element with ID '${this.containerId}' not found`);
        }

        container.innerHTML = `
            <div class="agent-chat-interface">
                <!-- Header -->
                <div class="chat-header">
                    <h3>Live Chat Support</h3>
                    <div class="agent-info">
                        <span class="agent-name">${this.agentName}</span>
                        <span class="connection-status" id="chat-connection-status">Connecting...</span>
                    </div>
                </div>

                <!-- Main Chat Area -->
                <div class="chat-main">
                    <!-- Session List -->
                    <div class="session-sidebar">
                        <div class="session-header">
                            <h4>Active Sessions</h4>
                            <span class="session-count" id="session-count">0</span>
                        </div>
                        <div class="session-list" id="session-list">
                            <div class="no-sessions">
                                <p>No active chat sessions</p>
                                <small>Sessions will appear here when customers start live chat</small>
                            </div>
                        </div>
                    </div>

                    <!-- Chat Area -->
                    <div class="chat-area">
                        <div class="chat-placeholder" id="chat-placeholder">
                            <div class="placeholder-content">
                                <i class="fas fa-comments fa-3x"></i>
                                <h3>Select a chat session</h3>
                                <p>Choose a session from the left to start chatting with customers</p>
                            </div>
                        </div>
                        
                        <div class="chat-conversation" id="chat-conversation" style="display: none;">
                            <!-- Session Info -->
                            <div class="session-info" id="session-info">
                                <div class="customer-info">
                                    <h4 id="customer-name">Customer</h4>
                                    <span id="customer-details"></span>
                                </div>
                                <div class="session-actions">
                                    <button class="btn btn-sm btn-outline-danger" id="close-session-btn">
                                        <i class="fas fa-times"></i> Close Session
                                    </button>
                                </div>
                            </div>

                            <!-- Messages -->
                            <div class="messages-container" id="messages-container">
                                <!-- Messages will be inserted here -->
                            </div>

                            <!-- Message Input -->
                            <div class="message-input-area">
                                <div class="input-group">
                                    <textarea 
                                        class="form-control" 
                                        id="message-input" 
                                        placeholder="Type your response..." 
                                        rows="2"
                                        style="resize: none;"
                                    ></textarea>
                                    <button class="btn btn-primary" id="send-message-btn" disabled>
                                        <i class="fas fa-paper-plane"></i> Send
                                    </button>
                                </div>
                                <div class="input-help">
                                    <small class="text-muted">Press Ctrl+Enter to send</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Store references to key elements
        this.sessionListEl = document.getElementById('session-list');
        this.chatAreaEl = document.getElementById('chat-conversation');
        this.messageInputEl = document.getElementById('message-input');
        this.sendButtonEl = document.getElementById('send-message-btn');
        this.messagesContainerEl = document.getElementById('messages-container');
        
        // Add CSS styles
        this.addStyles();
        
        // Setup UI event handlers
        this.setupUIHandlers();
    }

    /**
     * Add CSS styles for the chat interface
     */
    addStyles() {
        const styleId = 'agent-chat-interface-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .agent-chat-interface {
                height: 600px;
                border: 1px solid #dee2e6;
                border-radius: 8px;
                background: #fff;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .chat-header {
                background: #f8f9fa;
                border-bottom: 1px solid #dee2e6;
                padding: 1rem;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .chat-header h3 {
                margin: 0;
                color: #495057;
            }

            .agent-info {
                display: flex;
                align-items: center;
                gap: 1rem;
            }

            .agent-name {
                font-weight: 500;
                color: #495057;
            }

            .connection-status {
                padding: 0.25rem 0.5rem;
                border-radius: 4px;
                font-size: 0.875rem;
                font-weight: 500;
            }

            .connection-status.connected { background: #d1edff; color: #0c63e4; }
            .connection-status.disconnected { background: #f8d7da; color: #721c24; }
            .connection-status.connecting { background: #fff3cd; color: #856404; }

            .chat-main {
                flex: 1;
                display: flex;
                overflow: hidden;
            }

            .session-sidebar {
                width: 300px;
                border-right: 1px solid #dee2e6;
                background: #f8f9fa;
                display: flex;
                flex-direction: column;
            }

            .session-header {
                padding: 1rem;
                border-bottom: 1px solid #dee2e6;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .session-header h4 {
                margin: 0;
                color: #495057;
                font-size: 1rem;
            }

            .session-count {
                background: #6c757d;
                color: white;
                border-radius: 50%;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 0.75rem;
                font-weight: 500;
            }

            .session-list {
                flex: 1;
                overflow-y: auto;
            }

            .no-sessions {
                padding: 2rem 1rem;
                text-align: center;
                color: #6c757d;
            }

            .session-item {
                padding: 1rem;
                border-bottom: 1px solid #dee2e6;
                cursor: pointer;
                transition: background-color 0.15s ease;
                position: relative;
            }

            .session-item:hover {
                background: #e9ecef;
            }

            .session-item.active {
                background: #e3f2fd;
                border-left: 3px solid #2196f3;
            }

            .session-item .customer-name {
                font-weight: 500;
                color: #495057;
                margin-bottom: 0.25rem;
            }

            .session-item .last-message {
                font-size: 0.875rem;
                color: #6c757d;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .session-item .session-time {
                font-size: 0.75rem;
                color: #6c757d;
                margin-top: 0.25rem;
            }

            .session-item .unread-badge {
                position: absolute;
                top: 0.5rem;
                right: 0.5rem;
                background: #dc3545;
                color: white;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 0.625rem;
                font-weight: 500;
            }

            .chat-area {
                flex: 1;
                display: flex;
                flex-direction: column;
                position: relative;
            }

            .chat-placeholder {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #6c757d;
                text-align: center;
            }

            .placeholder-content i {
                color: #dee2e6;
                margin-bottom: 1rem;
            }

            .chat-conversation {
                flex: 1;
                flex-direction: column;
            }

            .session-info {
                background: #f8f9fa;
                border-bottom: 1px solid #dee2e6;
                padding: 1rem;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .customer-info h4 {
                margin: 0 0 0.25rem 0;
                color: #495057;
            }

            .customer-info span {
                font-size: 0.875rem;
                color: #6c757d;
            }

            .messages-container {
                flex: 1;
                overflow-y: auto;
                padding: 1rem;
                background: #fff;
            }

            .message {
                margin-bottom: 1rem;
                display: flex;
                flex-direction: column;
            }

            .message.agent {
                align-items: flex-end;
            }

            .message.customer {
                align-items: flex-start;
            }

            .message-bubble {
                max-width: 70%;
                padding: 0.75rem 1rem;
                border-radius: 18px;
                word-wrap: break-word;
            }

            .message.agent .message-bubble {
                background: #2196f3;
                color: white;
                border-bottom-right-radius: 4px;
            }

            .message.customer .message-bubble {
                background: #f1f3f4;
                color: #333;
                border-bottom-left-radius: 4px;
            }

            .message-timestamp {
                font-size: 0.75rem;
                color: #6c757d;
                margin-top: 0.25rem;
                padding: 0 0.5rem;
            }

            .message-input-area {
                border-top: 1px solid #dee2e6;
                padding: 1rem;
                background: #fff;
            }

            .message-input-area .input-group {
                margin-bottom: 0.5rem;
            }

            .message-input-area textarea {
                border-radius: 20px;
                border: 1px solid #ced4da;
                padding: 0.75rem 1rem;
            }

            .message-input-area textarea:focus {
                border-color: #2196f3;
                box-shadow: 0 0 0 0.2rem rgba(33, 150, 243, 0.25);
            }

            .message-input-area button {
                border-radius: 20px;
                padding: 0.75rem 1.5rem;
                margin-left: 0.5rem;
            }

            .input-help {
                text-align: center;
            }

            .system-message {
                text-align: center;
                margin: 1rem 0;
                padding: 0.5rem;
                background: #f8f9fa;
                border-radius: 8px;
                font-size: 0.875rem;
                color: #6c757d;
                border: 1px solid #dee2e6;
            }
        `;
        
        document.head.appendChild(style);
    }

    /**
     * Setup UI event handlers
     */
    setupUIHandlers() {
        // Send message button
        this.sendButtonEl?.addEventListener('click', () => {
            this.sendMessage();
        });

        // Message input keydown (Ctrl+Enter to send)
        this.messageInputEl?.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Enable/disable send button based on input
        this.messageInputEl?.addEventListener('input', (e) => {
            const hasText = e.target.value.trim().length > 0;
            this.sendButtonEl.disabled = !hasText || !this.activeSessionId;
        });

        // Close session button
        document.getElementById('close-session-btn')?.addEventListener('click', () => {
            this.closeSession();
        });
    }

    /**
     * Setup LiveChatManager event handlers
     */
    setupLiveChatHandlers() {
        if (!this.liveChatManager) return;

        // Handle incoming messages
        this.liveChatManager.onMessage = (message) => {
            this.handleIncomingMessage(message);
        };

        // Handle session start
        this.liveChatManager.onSessionStart = (sessionData) => {
            this.handleSessionStart(sessionData);
        };

        // Handle session end
        this.liveChatManager.onSessionEnd = (sessionId) => {
            this.handleSessionEnd(sessionId);
        };

        // Handle agent joined
        this.liveChatManager.onAgentJoined = (sessionId, agentInfo) => {
            this.handleAgentJoined(sessionId, agentInfo);
        };

        // Handle errors
        this.liveChatManager.onError = (error) => {
            this.handleError(error);
        };
    }

    /**
     * Setup event handlers for WebSocket and other events
     */
    setupEventHandlers() {
        // Listen for WebSocket connection status changes
        if (window.wsManager) {
            window.wsManager.on('connected', () => {
                this.updateConnectionStatus('connected');
            });

            window.wsManager.on('disconnected', () => {
                this.updateConnectionStatus('disconnected');
            });

            window.wsManager.on('connecting', () => {
                this.updateConnectionStatus('connecting');
            });
        }
    }

    /**
     * Handle incoming chat messages
     */
    handleIncomingMessage(messageData) {
        const { sessionId, message, session } = messageData;
        
        // Update or create session
        if (session) {
            this.sessions.set(sessionId, session);
        }
        
        // Update session list
        this.updateSessionList();
        
        // If this is the active session, add message to conversation
        if (this.activeSessionId === sessionId) {
            this.addMessageToConversation(message);
            this.scrollToBottom();
        }
        
        // Play notification sound for customer messages
        if (message.senderType === 'customer' || message.senderType === 'driver') {
            this.playNotificationSound();
        }
    }

    /**
     * Handle new session start
     */
    handleSessionStart(sessionData) {
        console.log('🆕 New chat session started:', sessionData);
        
        this.sessions.set(sessionData.sessionId, sessionData);
        this.updateSessionList();
        
        // Auto-select if no session is currently active
        if (!this.activeSessionId) {
            this.selectSession(sessionData.sessionId);
        }
        
        this.showNotification('New Chat Session', `${sessionData.customerName || 'Customer'} started a chat session`);
    }

    /**
     * Handle session end
     */
    handleSessionEnd(sessionId) {
        console.log('🔚 Chat session ended:', sessionId);
        
        const session = this.sessions.get(sessionId);
        if (session) {
            session.status = 'closed';
            session.endedAt = new Date().toISOString();
        }
        
        this.updateSessionList();
        
        // If this was the active session, clear it
        if (this.activeSessionId === sessionId) {
            this.activeSessionId = null;
            this.showChatPlaceholder();
        }
    }

    /**
     * Handle agent joined session
     */
    handleAgentJoined(sessionId, agentInfo) {
        console.log('👨‍💼 Agent joined session:', sessionId, agentInfo);
        
        const session = this.sessions.get(sessionId);
        if (session) {
            session.assignedAgent = agentInfo;
        }
        
        this.updateSessionList();
    }

    /**
     * Handle errors
     */
    handleError(error) {
        console.error('❌ LiveChat error:', error);
        this.showErrorNotification('Chat Error', error.message || 'An error occurred in live chat');
    }

    /**
     * Update connection status in UI
     */
    updateConnectionStatus(status) {
        const statusEl = document.getElementById('chat-connection-status');
        if (!statusEl) return;

        statusEl.className = `connection-status ${status}`;
        
        switch (status) {
            case 'connected':
                statusEl.textContent = 'Connected';
                break;
            case 'disconnected':
                statusEl.textContent = 'Disconnected';
                break;
            case 'connecting':
                statusEl.textContent = 'Connecting...';
                break;
        }
    }

    /**
     * Update session list in UI
     */
    updateSessionList() {
        if (!this.sessionListEl) return;

        const activeSessions = Array.from(this.sessions.values())
            .filter(session => session.status !== 'closed')
            .sort((a, b) => new Date(b.lastActivity || b.createdAt) - new Date(a.lastActivity || a.createdAt));

        const sessionCountEl = document.getElementById('session-count');
        if (sessionCountEl) {
            sessionCountEl.textContent = activeSessions.length;
        }

        if (activeSessions.length === 0) {
            this.sessionListEl.innerHTML = `
                <div class="no-sessions">
                    <p>No active chat sessions</p>
                    <small>Sessions will appear here when customers start live chat</small>
                </div>
            `;
            return;
        }

        this.sessionListEl.innerHTML = activeSessions.map(session => {
            const lastMessage = session.messages && session.messages.length > 0 
                ? session.messages[session.messages.length - 1] 
                : null;
            
            const unreadCount = session.unreadCount || 0;
            const timeAgo = this.formatTimeAgo(session.lastActivity || session.createdAt);
            
            return `
                <div class="session-item ${this.activeSessionId === session.sessionId ? 'active' : ''}" 
                     data-session-id="${session.sessionId}">
                    <div class="customer-name">${session.driverName || session.customerName || 'Customer'}</div>
                    <div class="last-message">
                        ${lastMessage ? lastMessage.messageText : 'Session started'}
                    </div>
                    <div class="session-time">${timeAgo}</div>
                    ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
                </div>
            `;
        }).join('');

        // Add click handlers to session items
        this.sessionListEl.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', () => {
                const sessionId = item.dataset.sessionId;
                this.selectSession(sessionId);
            });
        });
    }

    /**
     * Select a chat session
     */
    selectSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.warn('💬 Session not found:', sessionId);
            return;
        }

        console.log('💬 Selecting session:', sessionId);
        
        this.activeSessionId = sessionId;
        
        // Mark messages as read
        if (session.unreadCount > 0) {
            session.unreadCount = 0;
        }
        
        // Update UI
        this.updateSessionList();
        this.showChatConversation(session);
        
        // Enable message input
        if (this.messageInputEl) {
            this.messageInputEl.disabled = false;
            this.messageInputEl.placeholder = `Type your response to ${session.driverName || session.customerName || 'customer'}...`;
        }
        
        if (this.sendButtonEl) {
            this.sendButtonEl.disabled = !this.messageInputEl?.value.trim();
        }
    }

    /**
     * Show chat conversation for selected session
     */
    showChatConversation(session) {
        // Hide placeholder and show conversation
        const placeholderEl = document.getElementById('chat-placeholder');
        if (placeholderEl) placeholderEl.style.display = 'none';
        
        if (this.chatAreaEl) this.chatAreaEl.style.display = 'flex';

        // Update session info
        const customerNameEl = document.getElementById('customer-name');
        const customerDetailsEl = document.getElementById('customer-details');
        
        if (customerNameEl) {
            customerNameEl.textContent = session.driverName || session.customerName || 'Customer';
        }
        
        if (customerDetailsEl) {
            const details = [];
            if (session.driverPhone) details.push(`Phone: ${session.driverPhone}`);
            if (session.driverId) details.push(`ID: ${session.driverId}`);
            customerDetailsEl.textContent = details.join(' • ');
        }

        // Render messages
        this.renderMessages(session);
    }

    /**
     * Show chat placeholder when no session is selected
     */
    showChatPlaceholder() {
        const placeholderEl = document.getElementById('chat-placeholder');
        if (placeholderEl) placeholderEl.style.display = 'flex';
        
        if (this.chatAreaEl) this.chatAreaEl.style.display = 'none';
        
        // Disable message input
        if (this.messageInputEl) {
            this.messageInputEl.disabled = true;
            this.messageInputEl.placeholder = 'Select a session to start chatting...';
        }
        
        if (this.sendButtonEl) {
            this.sendButtonEl.disabled = true;
        }
    }

    /**
     * Render messages in the conversation area
     */
    renderMessages(session) {
        if (!this.messagesContainerEl || !session.messages) return;

        this.messagesContainerEl.innerHTML = '';

        session.messages.forEach(message => {
            this.addMessageToConversation(message);
        });

        this.scrollToBottom();
    }

    /**
     * Add a single message to the conversation
     */
    addMessageToConversation(message) {
        if (!this.messagesContainerEl) return;

        const messageEl = document.createElement('div');
        messageEl.className = `message ${message.senderType === 'agent' ? 'agent' : 'customer'}`;
        
        const timestamp = this.formatMessageTime(message.timestamp);
        
        messageEl.innerHTML = `
            <div class="message-bubble">
                ${this.escapeHtml(message.messageText)}
            </div>
            <div class="message-timestamp">${timestamp}</div>
        `;

        this.messagesContainerEl.appendChild(messageEl);
    }

    /**
     * Send a message
     */
    sendMessage() {
        if (!this.activeSessionId || !this.messageInputEl || !this.liveChatManager) {
            return;
        }

        const messageText = this.messageInputEl.value.trim();
        if (!messageText) return;

        console.log('💬 Sending message:', messageText);

        // Send via LiveChatManager
        const success = this.liveChatManager.sendMessage(messageText);
        
        if (success) {
            // Clear input
            this.messageInputEl.value = '';
            this.sendButtonEl.disabled = true;
            
            // Add message to conversation immediately (optimistic update)
            const message = {
                messageId: 'temp_' + Date.now(),
                messageText: messageText,
                senderType: 'agent',
                senderName: this.agentName,
                timestamp: new Date().toISOString()
            };
            
            this.addMessageToConversation(message);
            this.scrollToBottom();
            
            // Update session
            const session = this.sessions.get(this.activeSessionId);
            if (session) {
                if (!session.messages) session.messages = [];
                session.messages.push(message);
                session.lastActivity = new Date().toISOString();
            }
            
        } else {
            this.showErrorNotification('Send Failed', 'Failed to send message. Please try again.');
        }
    }

    /**
     * Close the current session
     */
    closeSession() {
        if (!this.activeSessionId || !this.liveChatManager) return;

        if (confirm('Are you sure you want to close this chat session?')) {
            console.log('💬 Closing session:', this.activeSessionId);
            
            // Close via LiveChatManager
            this.liveChatManager.endChat();
            
            // Update local state
            const session = this.sessions.get(this.activeSessionId);
            if (session) {
                session.status = 'closed';
                session.endedAt = new Date().toISOString();
            }
            
            // Clear active session
            this.activeSessionId = null;
            this.showChatPlaceholder();
            this.updateSessionList();
        }
    }

    /**
     * Scroll conversation to bottom
     */
    scrollToBottom() {
        if (this.messagesContainerEl) {
            this.messagesContainerEl.scrollTop = this.messagesContainerEl.scrollHeight;
        }
    }

    /**
     * Format time ago string
     */
    formatTimeAgo(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    /**
     * Format message timestamp
     */
    formatMessageTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Play notification sound
     */
    playNotificationSound() {
        // Create a simple notification beep
        if (typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined') {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                const audioContext = new AudioContext();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.frequency.value = 800;
                oscillator.type = 'sine';
                
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
                
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.5);
            } catch (e) {
                console.warn('Failed to play notification sound:', e);
            }
        }
    }

    /**
     * Show browser notification
     */
    showNotification(title, message) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body: message,
                icon: '/favicon.ico'
            });
        }
    }

    /**
     * Show error notification
     */
    showErrorNotification(title, message) {
        console.error(`💬 ${title}: ${message}`);
        
        // You can integrate with your existing notification system here
        if (window.showAlert) {
            window.showAlert(message, 'danger');
        } else {
            alert(`${title}: ${message}`);
        }
    }

    /**
     * Request notification permission
     */
    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                console.log('💬 Notification permission:', permission);
            });
        }
    }

    /**
     * Destroy the chat interface
     */
    destroy() {
        // Stop live chat manager
        if (this.liveChatManager) {
            this.liveChatManager.endChat();
        }
        
        // Clear sessions
        this.sessions.clear();
        this.activeSessionId = null;
        
        // Clear UI
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        this.isInitialized = false;
        console.log('💬 AgentChatInterface destroyed');
    }
}

// Export for global use
window.AgentChatInterface = AgentChatInterface;
