/**
 * Live Chat Manager - Unified Version for Customer, Driver, and Merchant Apps
 * Uses the centralized WebSocketManager with channel-based routing
 */

class LiveChatManager {
    constructor({ userType, userId, userDisplayName = null, enableVirtualAgent = false, virtualAgentOptions = {} } = {}) {
        this.userType = userType; // 'customer' | 'driver' | 'merchant' | 'agent'
        this.userId = userId;
        this.userDisplayName = userDisplayName || `${userType}_${userId}`;
        this.sessionId = null;
        this.agentName = null;
        this.isActive = false;
        if (typeof enableVirtualAgent === 'boolean') {
            this.virtualAgentEnabled = enableVirtualAgent;
        } else {
            this.virtualAgentEnabled = userType === 'agent';
        }
        this.virtualAgentConfig = {
            maxAutoResponses: virtualAgentOptions.maxAutoResponses || 2,
            initialGreeting: virtualAgentOptions.initialGreeting || "👋 Hi! I'm WhizzAI, our virtual assistant. I'll do my best to solve this quickly for you.",
            escalateKeywords: virtualAgentOptions.escalateKeywords || ['agent', 'human', 'representative', 'person', 'support', 'real person'],
            resolutionKeywords: virtualAgentOptions.resolutionKeywords || ['thanks', 'resolved', 'fixed', 'great', 'perfect', 'all good', 'works now'],
            frustrationKeywords: virtualAgentOptions.frustrationKeywords || ['still', 'not working', 'angry', 'upset', 'frustrated', 'worse', 'problem', 'issue', 'cannot', 'cant']
        };
        
        // Get WebSocket connection from the global manager
        this.wsManager = window.wsManager || window.WebSocketManager;
        if (!this.wsManager) {
            console.error('❌ LiveChatManager: WebSocketManager not available');
            return;
        }

        // Subscribe to chat channel
        this.unsubscribe = this.wsManager.subscribe('chat', (message) => {
            this.handleChatMessage(message);
        });

        // Event handlers
        this.onMessage = null;
        this.onSessionStart = null;
        this.onSessionEnd = null;
        this.onAgentJoined = null;
        this.onAgentLeft = null;
        this.onTyping = null;
        this.onError = null;

        // Legacy compatibility
        this.chatSessions = new Map();
        this.activeSessionId = null;
        this.listeners = {};
        this.collapsedFaqPanels = new Set();
        this.virtualAgentSessions = new Map();
        this.watchedSessions = new Set();
        this.faqQuickReplies = [
            {
                category: 'Account & Access',
                label: 'Reset merchant PIN',
                description: 'Guide merchants through resetting their dashboard PIN.',
                message: 'To reset your PIN open the WhizzMerchant app, tap Profile > Security > Reset PIN, then follow the SMS verification prompt. Let me know once you see the confirmation screen.',
                keywords: ['pin', 'reset', 'password', 'forgot']
            },
            {
                category: 'Account & Access',
                label: 'Add new staff user',
                description: 'Steps for inviting a cashier/manager.',
                message: 'You can add a new team member from Settings > Staff Access > Invite New. Enter their email, pick their role, and they will get an invite link that expires in 24 hours.',
                keywords: ['staff', 'user', 'add employee', 'teammate', 'invite']
            },
            {
                category: 'Orders & Menu',
                label: 'Update menu item availability',
                description: 'Mark an item as sold out for the day.',
                message: 'Go to Menu > Items, tap the product, then toggle "Today Only - Sold Out". The change syncs to customers in under a minute.',
                keywords: ['sold out', 'availability', 'menu', 'item unavailable', 'out of stock']
            },
            {
                category: 'Orders & Menu',
                label: 'Missing order notification',
                description: 'Checklist when merchants do not see an incoming order.',
                message: 'Please confirm the device volume is up, the app is on version 3.12+, and the "Pause Orders" switch is off in Operations. If all looks good, force close and reopen the app to refresh the socket connection.',
                keywords: ['missing order', 'notification', 'alert', 'sound', 'not receiving']
            },
            {
                category: 'Payments & Payouts',
                label: 'Where is my payout?',
                description: 'Bank settlement timeline explanation.',
                message: 'Daily payouts land next business day by 6 PM local time. If today is a bank holiday it will shift to the following day. You can track the transfer under Finance > Payouts with the reference code shown there.',
                keywords: ['payout', 'payment', 'deposit', 'bank', 'money', 'transfer']
            },
            {
                category: 'Payments & Payouts',
                label: 'Update bank account',
                description: 'Remind merchants about verification documents.',
                message: 'To update your bank account open Finance > Banking > Replace Account, enter the new routing/account numbers, and upload a voided check. Our team approves changes within 2 business hours.',
                keywords: ['bank', 'routing', 'account', 'change bank', 'update payment']
            },
            {
                category: 'Device & App Health',
                label: 'General troubleshooting',
                description: 'Standard restart + network checklist.',
                message: 'Please confirm Wi-Fi or LTE has at least 3 bars, then restart the tablet/phone and reopen WhizzMerchant. This clears cached sessions and usually restores chat + orders instantly.',
                keywords: ['network', 'wifi', 'lte', 'app slow', 'restart', 'connection']
            },
            {
                category: 'Device & App Health',
                label: 'Printer not working',
                description: 'Pair Bluetooth printer quickly.',
                message: 'Check that the printer is powered, hold the pair button until it flashes, then in WhizzMerchant go to Settings > Hardware > Printers and tap "Reconnect". A successful sync shows a green dot next to the printer name.',
                keywords: ['printer', 'print', 'receipt', 'bluetooth', 'paper']
            }
        ];
        this.knowledgeBaseEntries = this.buildKnowledgeBaseEntries();

        console.log(`💬 LiveChatManager initialized for ${userType}: ${userId}`);
    }

    /**
     * Initialize a new chat session
     */
    initChat(context = {}) {
        if (this.isActive) {
            console.warn('💬 Chat session already active');
            return;
        }

        const chatContext = {
            userType: this.userType,
            userId: this.userId,
            userDisplayName: this.userDisplayName,
            timestamp: Date.now(),
            ...context
        };

        console.log(`💬 Initiating chat session for ${this.userType}: ${this.userId}`);

        this.wsManager.publish({
            action: 'chat_init',
            channel: 'chat',
            subchannel: `${this.userType}_support`,
            type: 'CHAT_INIT',
            payload: {
                userId: this.userId,
                userType: this.userType,
                userDisplayName: this.userDisplayName,
                context: chatContext
            },
            meta: {
                userId: this.userId,
                userType: this.userType
            }
        });

        this.isActive = true;
    }

    /**
     * Send a message in the chat
     */
    sendMessage(text, messageType = 'text') {
        if (!this.isActive || !this.sessionId) {
            console.error('💬 Cannot send message: No active chat session');
            return false;
        }

        if (!text || text.trim().length === 0) {
            console.warn('💬 Cannot send empty message');
            return false;
        }

        const message = {
            action: 'chat_message',
            channel: 'chat',
            subchannel: `${this.userType}_support`,
            type: 'CHAT_MESSAGE',
            payload: {
                sessionId: this.sessionId,
                senderId: this.userId,
                senderType: this.userType,
                senderName: this.userDisplayName,
                content: text.trim(),
                messageType: messageType,
                timestamp: Date.now()
            },
            meta: {
                userId: this.userId,
                userType: this.userType,
                sessionId: this.sessionId
            }
        };

        console.log(`💬 Sending message:`, message.payload.content);
        return this.wsManager.publish(message);
    }

    /**
     * End the current chat session
     */
    endChat() {
        if (!this.isActive) {
            console.warn('💬 No active chat session to end');
            return;
        }

        console.log(`💬 Ending chat session: ${this.sessionId}`);

        this.wsManager.publish({
            action: 'chat_end',
            channel: 'chat',
            subchannel: `${this.userType}_support`,
            type: 'CHAT_END',
            payload: {
                sessionId: this.sessionId,
                userId: this.userId,
                userType: this.userType,
                timestamp: Date.now()
            }
        });

        this.resetSession();
    }

    // ... rest of the methods (handleChatMessage, etc.)
    
    // Legacy compatibility methods
    async connect() {
        console.log('💬 LiveChatManager: Using unified WebSocket connection');
        return this.wsManager ? this.wsManager.isConnected : false;
    }

    disconnect() {
        this.endChat();
    }

    updateConnectionStatus(message, type) {
        console.log(`💬 Connection Status: ${message} (${type})`);
    }

    /**
     * Setup WebSocket event handlers
     */
    setupEventHandlers() {
        this.ws.onopen = () => this.onConnected();
        this.ws.onclose = (event) => this.onDisconnected(event);
        this.ws.onerror = (error) => this.onError(error);
        this.ws.onmessage = (event) => this.onMessage(event);
    }

    /**
     * Handle WebSocket connection opened
     */
    onConnected() {
        console.log('✅ Live Chat WebSocket connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        // Add a small delay to ensure connection is fully established
        setTimeout(() => {
            // Send platform authentication
            this.authenticateAsPlatform();
        }, 500);
        
        // Start ping/pong to keep connection alive
        this.startPing();
        
        // Update UI
        this.updateConnectionStatus('Connected to Live Chat', 'success');
        
        this.emit('connected');
    }

    /**
     * Handle WebSocket connection closed
     */
    onDisconnected(event) {
        console.log('❌ Live Chat WebSocket disconnected:', event.code, event.reason);
        this.isConnected = false;
        this.authenticationSent = false;
        this.authenticationTime = null;
        this.stopPing();
        
        // Different handling based on close code
        let shouldReconnect = false;
        let statusMessage = 'Live Chat Disconnected';
        
        switch (event.code) {
            case 1000: // Normal closure
                console.log('✅ WebSocket closed normally');
                statusMessage = 'Live Chat Disconnected (Normal)';
                break;
            case 1001: // Going away
                console.log('🚪 WebSocket closed - going away');
                shouldReconnect = true;
                break;
            case 1006: // Abnormal closure
                console.log('⚠️ WebSocket closed abnormally - will reconnect');
                shouldReconnect = true;
                statusMessage = 'Live Chat Disconnected (Reconnecting...)';
                break;
            default:
                console.log(`⚠️ WebSocket closed with code ${event.code} - will reconnect`);
                shouldReconnect = true;
                statusMessage = 'Live Chat Disconnected (Reconnecting...)';
        }
        
        // Update UI
        this.updateConnectionStatus(statusMessage, 'error');
        
        // Attempt to reconnect if not intentionally closed
        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.updateConnectionStatus('Live Chat Connection Failed - Please Refresh', 'error');
        }
        
        this.emit('disconnected', { code: event.code, reason: event.reason });
    }

    /**
     * Handle WebSocket errors
     */
    onError(error) {
        console.error('❌ Live Chat WebSocket error:', error);
        this.updateConnectionStatus('Live Chat Error', 'error');
        this.emit('error', error);
    }

    /**
     * Handle incoming WebSocket messages
     */
    onMessage(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('📨 Live Chat message received:', message);
            
            // DIAGNOSTIC: Log ALL messages to console for debugging
            console.log('🔍 RAW MESSAGE DATA:', JSON.stringify(message, null, 2));
            
            // Handle different message types (support both old and new formats)
            const messageType = message.type || message.action;
            
            // DIAGNOSTIC: Always log the message type
            console.log('🏷️ Message type detected:', messageType);
            
            switch (messageType) {
                case 'active_sessions':
                    console.log('📊 Processing active sessions');
                    this.handleActiveSessions(message);
                    break;
                    
                case 'new_chat_session':
                case 'chat_session_created':
                    console.log('🆕 Processing new chat session');
                    this.handleSessionCreated(message);
                    break;
                    
                case 'chat_message':
                case 'support_message':
                case 'driver_message':
                case 'chat_message_received':
                    console.log('💬 Processing chat message');
                    this.handleChatMessage(message);
                    break;
                    
                case 'driver_connect':
                case 'chat_driver_connect':
                    console.log('🚗 Processing driver connected');
                    this.handleDriverConnected(message);
                    break;
                    
                case 'session_closed':
                case 'chat_session_closed':
                    console.log('❌ Processing session closed');
                    this.handleSessionClosed(message);
                    break;
                    
                case 'agent_authenticated':
                    console.log('✅ Agent authentication confirmed');
                    this.handleAgentAuthenticated(message);
                    break;
                    
                case 'typing_indicator':
                case 'chat_typing_indicator':
                    console.log('⌨️ Processing typing indicator');
                    this.handleTypingIndicator(message);
                    break;
                    
                case 'pong':
                case 'heartbeat_response':
                    console.log('💓 Live chat heartbeat acknowledged');
                    this.lastHeartbeatResponse = Date.now();
                    break;
                    
                default:
                    console.log('📨 Unknown live chat message type:', messageType);
                    console.log('🔍 UNHANDLED MESSAGE DETAILS:', {
                        type: messageType,
                        payload: message.payload,
                        data: message.data,
                        fullMessage: message
                    });
                    
                    // ENHANCED: Try to handle any message that looks like it could be a chat message
                    if (message.payload || message.data || message.sessions || message.message) {
                        console.log('🔄 Attempting to process as potential chat data...');
                        
                        // If it has sessions, treat as active sessions
                        if (message.sessions) {
                            console.log('📊 Processing as active sessions (fallback)');
                            this.handleActiveSessions(message);
                        }
                        // If it has chat-like properties, treat as chat message
                        else if (message.payload && (message.payload.sender_type === 'driver' || message.payload.feature === 'live_chat' || message.payload.message)) {
                            console.log('💬 Processing as chat message (fallback)');
                            this.handleChatMessage(message);
                        }
                        // If it has session info, treat as session update
                        else if (message.payload && message.payload.session_id) {
                            console.log('📝 Processing as session update (fallback)');
                            this.handleSessionCreated(message);
                        }
                        // Last resort: emit as unhandled but log extensively
                        else {
                            console.log('❓ Could not categorize message - emitting as unhandled');
                            this.emit('unhandled_message', message);
                        }
                    } else {
                        console.log('❓ Message has no recognizable data structure');
                        this.emit('unhandled_message', message);
                    }
            }
            
            // Emit message event for custom handlers
            this.emit('message', message);
            
        } catch (error) {
            console.error('Error parsing Live Chat WebSocket message:', error);
        }
    }

    /**
     * Authenticate as platform to receive all chat messages
     */
    authenticateAsPlatform() {
        // Use the same authentication format as the Flutter app for compatibility
        const authMessage = {
            action: 'agent_connect',
            type: 'agent_authenticate', 
            payload: {
                agent_id: 'platform_agent_' + Date.now(),
                agent_name: 'WizzCentral Platform',
                user_type: 'agent',
                platform: 'web',
                feature: 'live_chat_support'
            },
            timestamp: new Date().toISOString()
        };
        
        console.log('🔑 Preparing to send agent authentication:', JSON.stringify(authMessage, null, 2));
        const success = this.send(authMessage);
        console.log('🔑 Agent authentication send result:', success);
        if (success) {
            console.log('✅ Agent authentication sent successfully to live chat service');
            
            // Store that we've attempted authentication
            this.authenticationSent = true;
            this.authenticationTime = Date.now();
        } else {
            console.error('❌ Failed to send agent authentication - WebSocket not ready');
            
            // Retry authentication after a short delay
            setTimeout(() => {
                if (this.isConnected && !this.authenticationSent) {
                    console.log('🔄 Retrying agent authentication...');
                    this.authenticateAsPlatform();
                }
            }, 2000);
        }
    }

    /**
     * Send message to WebSocket server
     */
    send(message) {
        console.log('📤 Attempting to send message:', JSON.stringify(message, null, 2));
        console.log('📊 WebSocket state - isConnected:', this.isConnected, 'readyState:', this.ws?.readyState);
        
        if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            console.log('✅ Message sent successfully');
            return true;
        } else {
            console.error('❌ Live Chat WebSocket not connected, cannot send message');
            console.error('   - isConnected:', this.isConnected);
            console.error('   - WebSocket readyState:', this.ws?.readyState);
            return false;
        }
    }

    /**
     * Update connection status in UI
     */
    updateConnectionStatus(status, type) {
        const statusElement = document.getElementById('live-chat-status');
        const indicatorElement = document.getElementById('status-indicator');
        
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = `status-${type}`;
        }
        
        if (indicatorElement) {
            indicatorElement.className = `status-indicator status-${type}`;
        }
        
        console.log(`📊 Live Chat Status: ${status}`);
    }

    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
        
        console.log(`🔄 Scheduling live chat reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        this.updateConnectionStatus(`Reconnecting in ${Math.ceil(delay/1000)}s... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'warning');
        
        this.connectionTimeout = setTimeout(() => {
            if (this.reconnectAttempts <= this.maxReconnectAttempts) {
                console.log('🔄 Attempting live chat reconnection...');
                this.updateConnectionStatus('Reconnecting...', 'warning');
                this.connect();
            }
        }, delay);
    }

    /**
     * Start ping to keep connection alive
     */
    startPing() {
        this.pingInterval = setInterval(() => {
            if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping', timestamp: Date.now() });
                this.lastHeartbeatResponse = Date.now();
            }
        }, 30000); // Ping every 30 seconds
    }

    /**
     * Stop ping
     */
    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Start connection monitoring
     */
    startConnectionMonitoring() {
        this.connectionCheckInterval = setInterval(() => {
            if (this.isConnected && this.lastHeartbeatResponse) {
                const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatResponse;
                const heartbeatTimeout = 45000; // 45 seconds timeout
                
                if (timeSinceLastHeartbeat > heartbeatTimeout) {
                    console.log('⚠️ Heartbeat timeout detected - connection may be stale');
                    this.handleStaleConnection();
                }
            }
        }, 10000); // Check every 10 seconds
    }

    /**
     * Stop connection monitoring
     */
    stopConnectionMonitoring() {
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
            this.connectionCheckInterval = null;
        }
    }

    /**
     * Handle stale connection by forcing reconnection
     */
    handleStaleConnection() {
        console.log('🔄 Forcing reconnection due to stale connection');
        this.updateConnectionStatus('Connection Stale - Reconnecting...', 'warning');
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close(1000, 'Stale connection detected');
        }
        
        this.isConnected = false;
        this.stopPing();
        
        // Reset reconnect attempts for stale connection
        this.reconnectAttempts = 0;
        this.scheduleReconnect();
    }

    /**
     * Basic handlers for chat events (to be enhanced)
     */
    handleActiveSessions(message) {
        console.log('📊 Active sessions received:', message);
        
        // Store active sessions with filtering
        if (message.sessions && Array.isArray(message.sessions)) {
            this.chatSessions.clear();
            let addedCount = 0;
            
            message.sessions.forEach(session => {
                // Apply enhanced filtering
                if (!this.isTestSession(session) && this.isAllowedUserSession(session)) {
                    this.chatSessions.set(session.sessionId, session);
                    addedCount++;
                } else {
                    console.log('🚫 Filtered out session:', session.sessionId, session.driverName || 'Unknown');
                }
            });
            
            console.log(`📊 Loaded ${addedCount} genuine user sessions (filtered ${message.sessions.length - addedCount} test/mock sessions)`);
        }
        
        // Update UI with filtered sessions
        this.updateChatSessionsList();
        
        this.emit('active_sessions', message);
    }

    handleAgentAuthenticated(message) {
        console.log('✅ Agent authentication confirmed:', message);
        this.authenticationSent = true;
        this.authenticationTime = Date.now();
        this.emit('agent_authenticated', message);
    }

    handleSessionCreated(message) {
        console.log('🆕 New chat session created:', message);
        
        // Add session to our local storage
        if (message.payload && message.payload.session_id) {
            this.chatSessions.set(message.payload.session_id, message.payload);
        }
        
        this.emit('session_created', message);
    }

    handleChatMessage(message) {
        console.log('💬 Enhanced chat message handling:', message);
        
        // Support multiple message formats from Flutter app
        let sessionId, messageText, senderType, senderName, senderPhone, timestamp;
        
        // Primary format: message.payload
        if (message.payload) {
            sessionId = message.payload.session_id;
            messageText = message.payload.message || message.payload.message_text;
            senderType = message.payload.sender_type || 'driver';
            senderName = message.payload.driver_name || message.payload.sender_name || 'Driver';
            senderPhone = message.payload.driver_phone || '';
            timestamp = message.payload.timestamp;
        }
        // Secondary format: direct properties
        else {
            sessionId = message.sessionId || message.session_id;
            messageText = message.message || message.messageText || message.text;
            senderType = message.senderType || message.sender_type || 'driver';
            senderName = message.senderName || message.driver_name || 'Driver';
            senderPhone = message.driver_phone || '';
            timestamp = message.timestamp;
        }
        
        // Fallback for session ID generation if missing
        if (!sessionId && message.payload && message.payload.driver_id) {
            sessionId = `support_session_${message.payload.driver_id}_${Date.now()}`;
            console.log('🔧 Generated session ID:', sessionId);
        }
        
        if (!sessionId || !messageText) {
            console.warn('⚠️ Invalid chat message format:', message);
            console.warn('   - sessionId:', sessionId);
            console.warn('   - messageText:', messageText);
            return;
        }

        // Get or create session
        let session = this.chatSessions.get(sessionId);
        if (!session) {
            session = {
                sessionId: sessionId,
                driverName: senderName,
                driverPhone: senderPhone,
                driverId: message.payload?.driver_id || 'unknown',
                messages: [],
                lastActivity: new Date().toISOString(),
                status: 'active',
                unreadCount: 0
            };
            this.chatSessions.set(sessionId, session);
            console.log('🆕 Created new chat session:', sessionId);
        }

        // Add message to session
        const newMessage = {
            messageId: message.payload?.message_id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            messageText: messageText,
            senderType: senderType,
            senderName: senderName,
            timestamp: timestamp || new Date().toISOString(),
            read: senderType === 'agent' // Agent messages are automatically read
        };

        session.messages.push(newMessage);
        session.lastActivity = new Date().toISOString();
        
        // Increment unread count for driver messages
        if (senderType === 'driver') {
            session.unreadCount = (session.unreadCount || 0) + 1;
        }

        // Update UI
        if (this.virtualAgentEnabled) {
            this.maybeHandleWithVirtualAgent(session, newMessage);
        }

        this.updateChatSessionsList();
        
        // If this session is currently active, update the conversation
        if (this.activeSessionId === sessionId) {
            this.renderConversation(session);
            // Mark messages as read if session is active
            if (senderType === 'driver') {
                session.unreadCount = 0;
            }
        }

        // Emit event for other handlers
        this.emit('chat_message', {
            sessionId: sessionId,
            message: newMessage,
            session: session
        });

        // Show notification for new driver messages
        if (senderType === 'driver') {
            this.showBrowserNotification(
                'New Driver Message',
                `${session.driverName}: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`,
                'driver-message'
            );
            
            // Play notification sound if available
            this.playNotificationSound();
        }

        console.log('✅ Chat message processed and UI updated');
        console.log('📊 Session now has', session.messages.length, 'messages');
    }

    handleDriverConnected(message) {
        console.log('🚗 Driver connected:', message);
        
        // Extract driver information from the connection message
        const driverInfo = message.payload || {};
        const driverId = driverInfo.driver_id;
        const driverName = driverInfo.driver_name || 'Driver';
        const driverPhone = driverInfo.driver_phone || '';
        
        if (driverId) {
            // Create or update session for this driver if they're connecting for live chat
            const sessionId = `support_session_${driverId}_${Date.now()}`;
            
            if (driverInfo.feature === 'live_chat_support') {
                // Create preliminary session data for filtering
                const sessionData = {
                    sessionId: sessionId,
                    driverName: driverName,
                    driverPhone: driverPhone,
                    driverId: driverId,
                    messages: [],
                    lastActivity: new Date().toISOString(),
                    status: 'connected',
                    unreadCount: 0,
                    metadata: driverInfo
                };
                
                // Apply enhanced filtering
                if (this.isTestSession(sessionData)) {
                    console.log('🚫 Filtered out test driver connection:', driverName, sessionId);
                    return;
                }
                
                if (!this.isAllowedUserSession(sessionData)) {
                    console.log('🚫 Filtered out non-WizzDriver connection:', driverName, sessionId);
                    return;
                }
                
                let session = this.chatSessions.get(sessionId);
                if (!session) {
                    this.chatSessions.set(sessionId, sessionData);
                    console.log('🆕 Created session for genuine WizzDriver:', sessionId, driverName);
                    
                    // Update UI
                    this.updateChatSessionsList();
                }
            }
        }
        
        this.emit('driver_connected', message);
    }

    handleSessionClosed(message) {
        console.log('🔚 Session closed:', message);
        this.emit('session_closed', message);
    }

    handleTypingIndicator(message) {
        console.log('⌨️ Typing indicator:', message);
        this.emit('typing_indicator', message);
    }

    /**
     * Enhanced filtering to exclude test/mock sessions
     */
    isTestSession(sessionData = {}) {
        try {
            const meta = sessionData.metadata || {};
            const id = (sessionData.sessionId || sessionData.id || '').toString().toLowerCase();
            const name = (
                sessionData.driverName ||
                sessionData.driverInfo?.driverName ||
                meta.driverName ||
                ''
            ).toString().toLowerCase();
            
            // Enhanced test detection patterns
            const testFlags = [
                sessionData.isTest, 
                meta.isTest, 
                meta.source === 'test', 
                meta.source === 'mock',
                meta.source === 'demo'
            ];
            
            // More comprehensive test patterns
            const testPatterns = [
                id.startsWith('test_'),
                id.startsWith('mock_'),
                id.startsWith('demo_'),
                id.includes('test'),
                id.includes('mock'),
                id.includes('demo'),
                name.includes('test'),
                name.includes('mock'),
                name.includes('demo'),
                name === 'driver 123',
                name === 'test driver',
                name === 'mock driver',
                id.startsWith('support_session_') && name.toLowerCase().includes('test')
            ];
            
            return Boolean(testFlags.some(Boolean) || testPatterns.some(Boolean));
        } catch (e) {
            return false;
        }
    }

    /**
     * Check if session is from genuine WizzDriver app AND actively contacting support
     */
    isAllowedUserSession(sessionData = {}) {
        try {
            const meta = sessionData.metadata || {};
            const platform = sessionData.platform || meta.platform;
            const sourceRaw = meta.source || sessionData.source;
            const source = typeof sourceRaw === 'string' ? sourceRaw.toLowerCase() : null;
            const userAgent = (meta.userAgent || '').toString();
            
            // Get user information from session - check all possible user types
            const driverName = (sessionData.driverName || sessionData.driver_name || '').toLowerCase();
            const customerName = (sessionData.customerName || sessionData.customer_name || '').toLowerCase();
            const merchantName = (sessionData.merchantName || sessionData.merchant_name || sessionData.businessName || '').toLowerCase();
            const userName = (sessionData.userName || sessionData.user_name || '').toLowerCase();
            
            // First check: Must be from legitimate Wizz apps (Flutter or web)
            const allowByPlatform = typeof platform === 'string' && 
                (platform.toLowerCase() === 'flutter' || platform.toLowerCase() === 'web' || platform.toLowerCase() === 'mobile');
            const allowBySource = source && (
                source.includes('wizzdriver') || 
                source.includes('wizzmerchant') || 
                source.includes('wizzcustomer') ||
                source.includes('flutter') ||
                source.includes('web')
            );
            const allowByUA = /dart|flutter|wizz/i.test(userAgent);
            
            // Additional validation for genuine user names (any user type)
            const hasRealUserName = (driverName || customerName || merchantName || userName) && 
                ![driverName, customerName, merchantName, userName].some(name => 
                    name && (
                        name.includes('test') || 
                        name.includes('mock') || 
                        name.includes('demo') ||
                        name === 'driver 123' ||
                        name === 'customer 123' ||
                        name === 'merchant 123' ||
                        name === 'driver' ||
                        name === 'customer' ||
                        name === 'merchant'
                    )
                );
            
            // Must have at least one positive indicator for legitimate Wizz app
            const hasPositiveIndicator = allowByPlatform || allowBySource || allowByUA;
            
            // Explicitly disallow test/mock sources
            const explicitMock = typeof source === 'string' && /test|mock|demo/i.test(source);
            if (explicitMock) return false;
            
            // Second check: Must be an active live chat session
            const isActiveChatSession = this.isActiveLiveChatSession(sessionData);
            
            // CORE REQUIREMENT: Only show users who actively contacted live chat support
            // Must have: Legitimate Wizz app + Real user name + Active chat session
            const isValidUserSession = hasPositiveIndicator && (hasRealUserName || isActiveChatSession);
            
            // Return true if this is a valid user session with active chat
            return isValidUserSession && isActiveChatSession;
            
        } catch (e) {
            return false; // Default to reject on error for security
        }
    }

    /**
     * Check if session is an active live chat initiated by a driver
     */
    isActiveLiveChatSession(sessionData = {}) {
        try {
            const meta = sessionData.metadata || {};
            const hasMessages = sessionData.messages && sessionData.messages.length > 0;
            const hasCustomerMessage = sessionData.messages?.some(msg => 
                msg.senderType === 'customer' || msg.senderType === 'driver'
            );
            
            // Check for active chat indicators
            const chatIndicators = [
                // Has actual conversation
                hasMessages && hasCustomerMessage,
                
                // Session was initiated by clicking "Live Chat" in WizzDriver app
                meta.source === 'wizz_driver_app',
                meta.initiatedBy === 'driver',
                meta.chatType === 'support',
                
                // Driver explicitly requested support
                meta.action === 'contact_support',
                meta.userAction === 'start_chat',
                
                // Has initial support message
                sessionData.initialMessage && sessionData.initialMessage.length > 0,
                
                // Driver-initiated session (not just connected)
                sessionData.status === 'chat_active' || sessionData.status === 'waiting_for_agent',
                
                // Has recent activity (not just idle connection)
                sessionData.lastActivity && (Date.now() - new Date(sessionData.lastActivity).getTime()) < 300000, // 5 minutes
                
                // Session has chat context
                sessionData.context === 'support_chat' || sessionData.type === 'support_request'
            ];
            
            return chatIndicators.some(Boolean);
        } catch (e) {
            return false;
        }
    }

    /**
     * Clean up all existing test/mock sessions
     */
    cleanupTestSessions() {
        console.log('🧹 Cleaning up test/mock sessions...');
        
        let removedCount = 0;
        const sessionsToRemove = [];
        
        this.chatSessions.forEach((session, sessionId) => {
            if (this.isTestSession(session) || !this.isAllowedUserSession(session)) {
                sessionsToRemove.push(sessionId);
                removedCount++;
            }
        });
        
        // Remove the filtered sessions
        sessionsToRemove.forEach(sessionId => {
            const session = this.chatSessions.get(sessionId);
            console.log('🗑️ Removing test/mock session:', sessionId, session?.driverName);
            this.chatSessions.delete(sessionId);
        });
        
        console.log(`✅ Cleanup complete: Removed ${removedCount} test/mock sessions`);
        
        // Update UI
        this.updateChatSessionsList();
        
        return removedCount;
    }

    /**
     * Debug method to show session filtering details
     */
    debugSessionFiltering() {
        console.log('🔍 Debug: Current session filtering status');
        
        this.chatSessions.forEach((session, sessionId) => {
            const isTest = this.isTestSession(session);
            const isAllowed = this.isAllowedUserSession(session);
            const status = isTest ? '❌ TEST' : isAllowed ? '✅ ALLOWED' : '🚫 FILTERED';
            
            console.log(`${status} ${sessionId}: ${session.driverName}`, {
                isTest,
                isAllowed,
                metadata: session.metadata,
                driverName: session.driverName
            });
        });
    }

    /**
     * Filter sessions to show only genuine WizzDriver app sessions
     */
    filterGenuineSessions() {
        const filteredSessions = new Map();
        
        this.chatSessions.forEach((session, sessionId) => {
            // Skip test sessions
            if (this.isTestSession(session)) {
                console.log('🚫 Filtering out test session:', sessionId, session.driverName);
                return;
            }
            
            // Only allow genuine WizzDriver sessions
            if (this.isAllowedUserSession(session)) {
                filteredSessions.set(sessionId, session);
            } else {
                console.log('🚫 Filtering out non-WizzDriver session:', sessionId, session.driverName);
            }
        });
        
        this.chatSessions = filteredSessions;
        console.log(`✅ Filtered to ${filteredSessions.size} genuine WizzDriver sessions`);
        
        return filteredSessions;
    }

    /**
     * Manually refresh sessions and apply filtering
     */
    refreshSessions() {
        console.log('🔄 Manually refreshing and filtering sessions...');
        
        // Apply filtering to existing sessions
        this.filterGenuineSessions();
        
        // Update the UI
        this.updateChatSessionsList();
        
        // Request fresh session data from server if connected
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'get_active_sessions',
                agentId: this.agentId
            }));
        }
    }

    /**
     * Event system
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this.listeners[event]) return;
        const index = this.listeners[event].indexOf(callback);
        if (index > -1) {
            this.listeners[event].splice(index, 1);
        }
    }

    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in ${event} listener:`, error);
            }
        });
    }

    /**
     * Enhanced disconnect method
     */
    disconnect() {
        console.log('🔌 Manually disconnecting live chat');
        this.stopPing();
        this.stopConnectionMonitoring();
        
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        
        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        }
        
        this.isConnected = false;
        this.updateConnectionStatus('Disconnected', 'info');
    }

    /**
     * Get connection status and statistics
     */
    getConnectionStatus() {
        return {
            connected: this.isConnected,
            sessionsCount: this.chatSessions.size,
            reconnectAttempts: this.reconnectAttempts,
            lastHeartbeat: this.lastHeartbeatResponse,
            authenticationSent: this.authenticationSent,
            authenticationTime: this.authenticationTime
        };
    }

    /**
     * Get all chat sessions
     */
    getAllSessions() {
        return Array.from(this.chatSessions.values());
    }

    /**
     * Force refresh sessions
     */
    refreshSessions() {
        if (this.isConnected) {
            this.send({
                type: 'get_active_sessions',
                timestamp: Date.now()
            });
        }
        
        // Also update the UI immediately with current sessions
        this.updateChatSessionsList();
    }

    /**
     * Initialize chat sessions list on page load
     */
    initializeChatSessions() {
        console.log('🚀 Initializing chat sessions...');
        this.updateChatSessionsList();
        
        // Request active sessions from server
        this.refreshSessions();
    }

    /**
     * Initialize session controls (search and filters)
     */
    initializeSessionControls() {
        // Search functionality
        const searchInput = document.getElementById('session-search');
        if (searchInput) {
            searchInput.addEventListener('input', (event) => {
                this.filterSessions({ search: event.target.value });
            });
        }

        // Filter buttons
        const filterButtons = document.querySelectorAll('.filter-btn');
        filterButtons.forEach(btn => {
            btn.addEventListener('click', (event) => {
                // Update active filter
                filterButtons.forEach(b => b.classList.remove('active'));
                event.target.classList.add('active');
                
                // Apply filter
                this.filterSessions({ filter: event.target.dataset.filter });
            });
        });
    }

    /**
     * Filter sessions based on search and filter criteria
     */
    filterSessions(criteria = {}) {
        const { search = '', filter = 'all' } = criteria;
        let sessions = Array.from(this.chatSessions.values());

        // Apply search filter
        if (search) {
            sessions = sessions.filter(session => {
                const searchTerm = search.toLowerCase();
                return (
                    (session.driverName || '').toLowerCase().includes(searchTerm) ||
                    (session.driverPhone || '').includes(searchTerm) ||
                    (session.sessionId || '').toLowerCase().includes(searchTerm) ||
                    (session.messages || []).some(msg => 
                        msg.messageText.toLowerCase().includes(searchTerm)
                    )
                );
            });
        }

        // Apply category filter
        if (filter !== 'all') {
            sessions = sessions.filter(session => {
                switch (filter) {
                    case 'unread':
                        return session.messages && session.messages.some(msg => 
                            msg.senderType === 'driver' && !msg.read
                        );
                    case 'active':
                        return session.status === 'active';
                    case 'priority':
                        return session.priority === 'high';
                    default:
                        return true;
                }
            });
        }

        // Update the UI with filtered sessions
        this.renderFilteredSessions(sessions);
    }

    /**
     * Render filtered sessions
     */
    renderFilteredSessions(sessions) {
        const sessionsList = document.getElementById('chat-sessions-list');
        if (!sessionsList) return;

        if (sessions.length === 0) {
            sessionsList.innerHTML = `
                <div class="no-sessions">
                    <div class="icon">🔍</div>
                    <div>No matching conversations found</div>
                    <button class="refresh-btn" onclick="document.getElementById('session-search').value = ''; window.liveChatManager.updateChatSessionsList();" style="margin-top: 16px;">
                        <i class="fas fa-refresh"></i> Show All
                    </button>
                </div>
            `;
            return;
        }

        sessionsList.innerHTML = sessions.map(session => {
            const lastMessage = session.messages && session.messages.length > 0 
                ? session.messages[session.messages.length - 1] 
                : null;
            
            const unreadCount = session.messages 
                ? session.messages.filter(msg => msg.senderType === 'driver' && !msg.read).length 
                : 0;
            
            const timeAgo = session.lastActivity 
                ? this.getTimeAgo(new Date(session.lastActivity))
                : 'Just now';
            
            const priorityClass = session.priority ? `priority-${session.priority}` : '';
            
            return `
                <div class="session-item ${session.sessionId === this.activeSessionId ? 'active' : ''} ${unreadCount > 0 ? 'unread' : ''} ${priorityClass}" 
                     onclick="window.liveChatManager.selectSession('${session.sessionId}')">
                    <div class="session-header">
                        <div class="driver-info">
                            <div class="driver-avatar">
                                ${(session.driverName || 'D')[0].toUpperCase()}
                            </div>
                            <div class="driver-details">
                                <h4>${session.driverName || 'Driver'}</h4>
                                <div class="phone">${session.driverPhone || 'No phone'}</div>
                            </div>
                        </div>
                        <div class="session-meta">
                            <div class="time">${timeAgo}</div>
                            ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
                        </div>
                    </div>
                    ${lastMessage ? `
                        <div class="last-message">
                            ${lastMessage.senderType === 'driver' ? '🚗' : '👤'} ${lastMessage.messageText.substring(0, 50)}${lastMessage.messageText.length > 50 ? '...' : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    /**
     * Enhanced updateChatSessionsList with search consideration
     */
    updateChatSessionsList() {
        console.log('🔄 Updating chat sessions list...');
        
        // Get current search and filter
        const searchInput = document.getElementById('session-search');
        const activeFilter = document.querySelector('.filter-btn.active');
        
        const search = searchInput ? searchInput.value : '';
        const filter = activeFilter ? activeFilter.dataset.filter : 'all';
        
        // Apply current filters
        if (search || filter !== 'all') {
            this.filterSessions({ search, filter });
        } else {
            // Show all sessions
            const sessionsList = document.getElementById('chat-sessions-list');
            if (!sessionsList) return;

            const sessions = Array.from(this.chatSessions.values());
            
            if (sessions.length === 0) {
                sessionsList.innerHTML = `
                    <div class="no-sessions">
                        <div class="icon">💬</div>
                        <div>Waiting for incoming chat sessions...</div>
                        <button class="refresh-btn" onclick="window.liveChatManager.refreshSessions()" style="margin-top: 16px;">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>
                `;
                return;
            }

            this.renderFilteredSessions(sessions);
        }
    }

    /**
     * Select and display a chat session
     */
    selectSession(sessionId) {
        console.log('📱 Selecting session:', sessionId);
        this.activeSessionId = sessionId;
        const session = this.chatSessions.get(sessionId);
        
        if (!session) {
            console.error('Session not found:', sessionId);
            return;
        }

        // Mark messages as read
        if (session.messages) {
            session.messages.forEach(msg => {
                // Mark all non-agent messages as read when session is selected
                if (msg.senderType !== 'agent' && msg.senderType !== 'support') {
                    msg.read = true;
                }
            });
        }

        // Update sessions list to show active state
        this.updateChatSessionsList();
        
        // Render the conversation
        this.renderConversation(session);
    }

    /**
     * Render conversation area for selected session
     */
    renderConversation(session) {
        console.log('💬 Rendering conversation for session:', session.sessionId);
        const conversationArea = document.getElementById('conversation-area');
        if (!conversationArea) return;

        const messages = session.messages || [];
        
        // Determine user type and display name
        const getUserTypeAndName = (session) => {
            // Check for customer information first
            if (session.customerName || session.customer_name) {
                return {
                    type: 'Customer',
                    name: session.customerName || session.customer_name,
                    phone: session.customerPhone || session.customer_phone || 'No phone'
                };
            }
            // Check for merchant information
            if (session.merchantName || session.merchant_name || session.businessName) {
                return {
                    type: 'Merchant',
                    name: session.merchantName || session.merchant_name || session.businessName,
                    phone: session.merchantPhone || session.merchant_phone || session.phone || 'No phone'
                };
            }
            // Check for driver information
            if (session.driverName || session.driver_name) {
                return {
                    type: 'Driver',
                    name: session.driverName || session.driver_name,
                    phone: session.driverPhone || session.driver_phone || 'No phone'
                };
            }
            // Default fallback - check userType field
            if (session.userType || session.user_type) {
                const userType = session.userType || session.user_type;
                const capitalizedType = userType.charAt(0).toUpperCase() + userType.slice(1);
                return {
                    type: capitalizedType,
                    name: session.userName || session.user_name || `Unknown ${capitalizedType}`,
                    phone: session.userPhone || session.user_phone || 'No phone'
                };
            }
            // Final fallback
            return {
                type: 'User',
                name: 'Unknown User',
                phone: 'No phone'
            };
        };

        const userInfo = getUserTypeAndName(session);
        const faqQuickRepliesSection = this.renderFaqQuickRepliesSection(session);
        const virtualAgentBanner = this.renderVirtualAgentBanner(session.sessionId);
        const sessionInsights = this.renderSessionMeta(session);
        const messageToolbar = this.renderMessageToolbar(session);
        
        conversationArea.innerHTML = `
            <div class="conversation-header">
                <h3>Chat with ${userInfo.name} (${userInfo.type})</h3>
                <div class="conversation-subtitle">
                    ${userInfo.phone} • Session: ${session.sessionId}
                </div>
            </div>

            ${virtualAgentBanner}
            ${sessionInsights}
            
            <div class="messages-container" id="messages-${session.sessionId}">
                ${messages.length === 0 ? `
                    <div class="empty-conversation">
                        <div class="empty-icon">💬</div>
                        <h4>Start the conversation</h4>
                        <p>Send a message to help ${userInfo.name.toLowerCase()}</p>
                    </div>
                ` : messages.map(msg => this.renderMessage(msg)).join('')}
            </div>

            <div class="message-input-container">
                ${faqQuickRepliesSection}

                ${messageToolbar}

                <div class="agent-tools">
                    <button class="tool-btn" onclick="window.liveChatManager.insertQuickReply('👋 Hello! How can I help you today?')" title="Greeting">
                        <i class="fas fa-hand-wave"></i>
                    </button>
                    <button class="tool-btn" onclick="window.liveChatManager.insertQuickReply('📍 Please share your current location so I can assist you better.')" title="Location Request">
                        <i class="fas fa-map-marker-alt"></i>
                    </button>
                    <button class="tool-btn" onclick="window.liveChatManager.insertQuickReply('🚗 I\\'m checking on your order status now. Please wait a moment.')" title="Order Status">
                        <i class="fas fa-truck"></i>
                    </button>
                    <button class="tool-btn" onclick="window.liveChatManager.insertQuickReply('✅ Issue resolved! Is there anything else I can help you with?')" title="Issue Resolved">
                        <i class="fas fa-check-circle"></i>
                    </button>
                </div>
                
                <div class="message-input">
                    <input type="text" 
                           id="message-input-${session.sessionId}" 
                           placeholder="Type your response..." 
                           onkeypress="window.liveChatManager.handleKeyPress(event, '${session.sessionId}')"
                           maxlength="500">
                    <button class="send-button" onclick="window.liveChatManager.sendMessage('${session.sessionId}')">
                        <i class="fas fa-paper-plane"></i>
                        Send
                    </button>
                </div>
                
                <div class="message-info">
                    <small>Press Enter to send • Shift+Enter for newline • Max 500 characters</small>
                </div>
            </div>
        `;

        // Auto-scroll to bottom
        setTimeout(() => {
            const messagesContainer = document.getElementById(`messages-${session.sessionId}`);
            if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }, 100);
    }

    /**
     * Render the FAQ quick replies drawer
     */
    renderFaqQuickRepliesSection(session) {
        if (!Array.isArray(this.faqQuickReplies) || this.faqQuickReplies.length === 0) {
            return '';
        }

        const groupedReplies = this.faqQuickReplies.reduce((map, reply) => {
            if (!map.has(reply.category)) {
                map.set(reply.category, []);
            }
            map.get(reply.category).push(reply);
            return map;
        }, new Map());

        const isCollapsed = this.collapsedFaqPanels.has(session.sessionId);
        const categoriesHtml = Array.from(groupedReplies.entries()).map(([category, replies]) => `
            <div class="faq-category">
                <div class="faq-category-title">${this.escapeHtml(category)}</div>
                <div class="faq-replies">
                    ${replies.map(reply => `
                        <button class="faq-reply-btn" data-message="${this.escapeAttribute(reply.message)}" onclick="window.liveChatManager.insertFaqQuickReply(this)">
                            <div class="faq-reply-label">${this.escapeHtml(reply.label)}</div>
                            <div class="faq-reply-description">${this.escapeHtml(reply.description)}</div>
                        </button>
                    `).join('')}
                </div>
            </div>
        `).join('');

        return `
            <div class="faq-quick-replies" id="faq-replies-${session.sessionId}">
                <div class="faq-header">
                    <div>
                        <div class="faq-title">FAQ Quick Replies</div>
                        <div class="faq-subtitle">QA-approved responses for the most common merchant issues</div>
                    </div>
                    <button class="faq-toggle-btn" onclick="window.liveChatManager.toggleFaqQuickReplies('${session.sessionId}')">
                        ${isCollapsed ? '<i class="fas fa-chevron-down"></i> Expand' : '<i class="fas fa-chevron-up"></i> Collapse'}
                    </button>
                </div>
                <div class="faq-body ${isCollapsed ? 'collapsed' : ''}" id="faq-body-${session.sessionId}">
                    ${categoriesHtml}
                </div>
            </div>
        `;
    }

    /**
     * Render the status banner for the virtual AI agent
     */
    renderVirtualAgentBanner(sessionId) {
        if (!this.virtualAgentEnabled) return '';
        const state = this.virtualAgentSessions.get(sessionId);
        if (!state) return '';

        let statusText = 'WhizzAI is assisting with this request.';
        let statusClass = 'handling';

        if (state.status === 'resolved') {
            statusText = '✅ Resolved by WhizzAI. Monitoring for further questions.';
            statusClass = 'resolved';
        } else if (state.status === 'escalated') {
            statusText = '⏳ Escalated to a live agent. Please take over.';
            statusClass = 'escalated';
        } else if (state.status === 'handed_off') {
            statusText = '👤 Human agent is now leading this conversation.';
            statusClass = 'handed-off';
        }

        const attemptsText = typeof state.attempts === 'number'
            ? `AI Attempts: ${state.attempts}/${this.virtualAgentConfig.maxAutoResponses}`
            : '';

        return `
            <div class="virtual-agent-banner ${statusClass}">
                <div class="va-left">
                    <div class="va-icon">🤖</div>
                    <div>
                        <div class="va-title">WhizzAI Virtual Agent</div>
                        <div class="va-status">${statusText}</div>
                        ${attemptsText ? `<div class="va-attempts">${attemptsText}</div>` : ''}
                    </div>
                </div>
                ${state.status === 'handling' ? `
                    <button class="va-escalate-btn" onclick="window.liveChatManager.escalateToHumanAgent('${sessionId}', 'manual_handoff')">
                        <i class="fas fa-headset"></i> Connect to agent
                    </button>
                ` : ''}
            </div>
        `;
    }

    /**
     * Render session metadata chips and stats
     */
    renderSessionMeta(session) {
        if (!session) return '';

        const chips = [];
        if (session.priority) {
            chips.push(`<span class="meta-chip priority-${session.priority}">Priority: ${session.priority}</span>`);
        }
        if (session.context?.orderId || session.orderId) {
            chips.push(`<span class="meta-chip"><i class="fas fa-receipt"></i> Order ${session.context?.orderId || session.orderId}</span>`);
        }
        if (session.platform || session.source) {
            chips.push(`<span class="meta-chip"><i class="fas fa-mobile-screen"></i> ${session.platform || session.source}</span>`);
        }

        const lastMessageTime = session.messages && session.messages.length > 0
            ? this.getTimeAgo(new Date(session.messages[session.messages.length - 1].timestamp || Date.now()))
            : 'No messages yet';
        const startedAt = session.startedAt ? this.getTimeAgo(new Date(session.startedAt)) : 'Just now';
        const unreadCount = session.messages
            ? session.messages.filter(msg => msg.senderType !== 'agent' && !msg.read).length
            : 0;

        return `
            <div class="conversation-insights">
                <div class="insight-chips">
                    ${chips.join('')}
                    <span class="meta-chip neutral">Session ${session.sessionId}</span>
                </div>
                <div class="insight-stats">
                    <span><strong>${session.messages?.length || 0}</strong> messages</span>
                    <span><strong>${unreadCount}</strong> unread</span>
                    <span>Last message ${lastMessageTime}</span>
                    <span>Started ${startedAt}</span>
                </div>
            </div>
        `;
    }

    /**
     * Render toolbar for composer actions
     */
    renderMessageToolbar(session) {
        if (!session) return '';
        const watchLabel = this.watchedSessions.has(session.sessionId) ? 'Watching' : 'Watch';

        return `
            <div class="message-toolbar">
                <div class="toolbar-left">
                    <button class="toolbar-button" onclick="window.liveChatManager.handleSessionQuickAction('history','${session.sessionId}')">
                        <i class="fas fa-clock-rotate-left"></i> History
                    </button>
                    <button class="toolbar-button" onclick="window.liveChatManager.handleSessionQuickAction('copy','${session.sessionId}')">
                        <i class="fas fa-copy"></i> Copy ID
                    </button>
                    <button class="toolbar-button ${this.watchedSessions.has(session.sessionId) ? 'active' : ''}" onclick="window.liveChatManager.handleSessionQuickAction('watch','${session.sessionId}')">
                        <i class="fas fa-eye${this.watchedSessions.has(session.sessionId) ? '' : '-slash'}"></i> ${watchLabel}
                    </button>
                </div>
                <div class="toolbar-right">
                    <span class="composer-counter">${(session.messages?.length || 0)} msgs • Limit 500 chars</span>
                </div>
            </div>
        `;
    }

    /**
     * Render individual message
     */
    renderMessage(message) {
        const isAgent = message.senderType === 'agent' || message.senderType === 'support';
        const isAI = message.senderType === 'ai_agent';
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        
        // Use 'user' class instead of 'driver' for better styling consistency
        const messageClass = isAI ? 'ai' : (isAgent ? 'agent' : 'user');
        
        return `
            <div class="message ${messageClass}">
                <div class="message-bubble">
                    <div class="message-content">${this.escapeHtml(message.messageText)}</div>
                    <div class="message-time">${timestamp}</div>
                </div>
            </div>
        `;
    }

    /**
     * Send message as agent
     */
    async sendMessage(sessionId) {
        const inputElement = document.getElementById(`message-input-${sessionId}`);
        if (!inputElement) return;

        const messageText = inputElement.value.trim();
        if (!messageText) return;

        this.markVirtualAgentHandedOff(sessionId);
        console.log('📤 Sending agent message:', messageText);

        // Show typing indicator
        this.showTypingIndicator(sessionId);

        try {
            const agentMessage = {
                type: 'agent_message',
                payload: {
                    session_id: sessionId,
                    message_text: messageText,
                    sender_type: 'agent',
                    sender_id: 'agent_platform_' + Date.now(),
                    timestamp: new Date().toISOString()
                }
            };

            const success = this.send(agentMessage);
            
            if (success) {
                // Add message to local session immediately for better UX
                const session = this.chatSessions.get(sessionId);
                if (session) {
                    if (!session.messages) session.messages = [];
                    session.messages.push({
                        messageText: messageText,
                        senderType: 'agent',
                        timestamp: new Date().toISOString(),
                        messageId: 'local_' + Date.now()
                    });
                    
                    // Re-render conversation to show new message
                    this.renderConversation(session);
                }

                // Clear input
                inputElement.value = '';
                
                // Show success feedback
                this.showMessageStatus('Message sent ✓', 'success');
                
                console.log('✅ Agent message sent successfully');
            } else {
                throw new Error('Failed to send message - WebSocket not connected');
            }
        } catch (error) {
            console.error('❌ Failed to send agent message:', error);
            this.showMessageStatus('Failed to send message ✗', 'error');
        } finally {
            // Hide typing indicator
            this.hideTypingIndicator(sessionId);
        }
    }

    /**
     * Insert FAQ quick reply text from button data
     */
    insertFaqQuickReply(element) {
        if (!element || !element.dataset) return;
        const message = element.dataset.message;
        if (message) {
            this.insertQuickReply(message);
            element.classList.add('selected');
            setTimeout(() => element.classList.remove('selected'), 1200);
        }
    }

    /**
     * Toggle FAQ quick replies visibility for a session
     */
    toggleFaqQuickReplies(sessionId) {
        const body = document.getElementById(`faq-body-${sessionId}`);
        if (!body) return;

        const isCollapsed = body.classList.toggle('collapsed');
        if (isCollapsed) {
            this.collapsedFaqPanels.add(sessionId);
        } else {
            this.collapsedFaqPanels.delete(sessionId);
        }

        const toggleBtn = document.querySelector(`#faq-replies-${sessionId} .faq-toggle-btn`);
        if (toggleBtn) {
            toggleBtn.innerHTML = isCollapsed
                ? '<i class="fas fa-chevron-down"></i> Expand'
                : '<i class="fas fa-chevron-up"></i> Collapse';
        }
    }

    /**
     * Handle toolbar actions (history, copy, watch)
     */
    handleSessionQuickAction(action, sessionId) {
        switch (action) {
            case 'history':
                this.openSessionHistory(sessionId);
                break;
            case 'copy':
                this.copySessionId(sessionId);
                break;
            case 'watch':
                this.toggleSessionWatch(sessionId);
                break;
            default:
                console.log('Unknown quick action:', action);
        }
    }

    copySessionId(sessionId) {
        if (!sessionId) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(sessionId).then(() => {
                this.showMessageStatus('Session ID copied', 'success');
            }).catch(() => {
                this.showMessageStatus('Copy failed', 'error');
            });
        } else {
            this.showMessageStatus('Clipboard unavailable', 'error');
        }
    }

    openSessionHistory(sessionId) {
        const session = this.chatSessions.get(sessionId);
        console.log('Opening session history for', sessionId, session);
        window.dispatchEvent(new CustomEvent('open-session-history', { detail: { sessionId, session } }));
        this.showMessageStatus('History panel opened', 'success');
    }

    toggleSessionWatch(sessionId) {
        if (this.watchedSessions.has(sessionId)) {
            this.watchedSessions.delete(sessionId);
            this.showMessageStatus('Watch removed', 'success');
        } else {
            this.watchedSessions.add(sessionId);
            this.showMessageStatus('Session pinned to watchlist', 'success');
        }
        const session = this.chatSessions.get(sessionId);
        if (session && this.activeSessionId === sessionId) {
            this.renderConversation(session);
        }
    }

    /**
     * Build normalized knowledge base entries from FAQ quick replies
     */
    buildKnowledgeBaseEntries() {
        return this.faqQuickReplies.map(entry => {
            const keywords = Array.isArray(entry.keywords) && entry.keywords.length > 0
                ? entry.keywords.map(keyword => keyword.toLowerCase())
                : (entry.label || '')
                    .toLowerCase()
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 3);
            return {
                ...entry,
                keywords
            };
        });
    }

    /**
     * Ensure a virtual agent state exists for a session
     */
    ensureVirtualAgentSession(sessionId) {
        if (!sessionId || !this.virtualAgentEnabled) return null;

        if (!this.virtualAgentSessions.has(sessionId)) {
            this.virtualAgentSessions.set(sessionId, {
                status: 'handling',
                attempts: 0,
                createdAt: Date.now(),
                lastMessageAt: null
            });
            this.sendVirtualAgentMessage(sessionId, this.virtualAgentConfig.initialGreeting, { stage: 'greeting' });
        }

        return this.virtualAgentSessions.get(sessionId);
    }

    /**
     * Let WhizzAI try to resolve the merchant request
     */
    maybeHandleWithVirtualAgent(session, message) {
        if (!this.virtualAgentEnabled || !session || !message) return;
        const sessionId = session.sessionId;
        if (!sessionId) return;

        const senderType = (message.senderType || '').toLowerCase();
        if (['agent', 'support', 'ai_agent', 'system'].includes(senderType)) {
            return;
        }

        const text = (message.messageText || message.content || '').trim();
        if (!text) return;

        const state = this.ensureVirtualAgentSession(sessionId);
        if (!state || ['escalated', 'handed_off', 'resolved'].includes(state.status)) {
            return;
        }

        if (this.detectHumanAgentRequest(text)) {
            this.escalateToHumanAgent(sessionId, 'user_requested_agent');
            return;
        }

        if (this.detectFrustration(text)) {
            this.escalateToHumanAgent(sessionId, 'user_frustrated');
            return;
        }

        if (this.detectResolutionKeywords(text)) {
            this.markVirtualAgentResolved(sessionId);
            return;
        }

        if (state.attempts >= this.virtualAgentConfig.maxAutoResponses) {
            this.escalateToHumanAgent(sessionId, 'max_attempts');
            return;
        }

        const kbMatch = this.findKnowledgeBaseResponse(text);
        if (kbMatch) {
            this.sendVirtualAgentMessage(sessionId, kbMatch.message, {
                topic: kbMatch.category,
                source: 'knowledge_base',
                label: kbMatch.label
            });
            state.attempts += 1;
            state.lastMessageAt = Date.now();
        } else {
            this.escalateToHumanAgent(sessionId, 'no_kb_match');
        }
    }

    /**
     * Attempt to find a knowledge base response for a message
     */
    findKnowledgeBaseResponse(messageText) {
        if (!messageText) return null;
        const normalized = messageText.toLowerCase();
        let bestMatch = null;
        let bestScore = 0;

        this.knowledgeBaseEntries.forEach(entry => {
            let score = 0;
            entry.keywords.forEach(keyword => {
                if (normalized.includes(keyword)) {
                    score += 1;
                }
            });

            if (score > bestScore) {
                bestMatch = entry;
                bestScore = score;
            }
        });

        return bestScore > 0 ? bestMatch : null;
    }

    /**
     * Send a message from the AI agent into the conversation
     */
    sendVirtualAgentMessage(sessionId, text, metadata = {}) {
        if (!this.virtualAgentEnabled || !sessionId || !text) return;

        const aiMessage = {
            type: 'agent_message',
            payload: {
                session_id: sessionId,
                message_text: text,
                sender_type: 'ai_agent',
                sender_name: 'WhizzAI Assistant',
                sender_id: 'whizz_ai_' + Date.now(),
                metadata,
                timestamp: new Date().toISOString()
            }
        };

        let sent = false;
        try {
            sent = this.send(aiMessage);
        } catch (error) {
            console.warn('⚠️ Failed to send virtual agent message:', error);
        }

        if (!sent) {
            return;
        }

        const session = this.chatSessions.get(sessionId);
        if (session) {
            if (!session.messages) session.messages = [];
            session.messages.push({
                messageId: aiMessage.payload.sender_id,
                messageText: text,
                senderType: 'ai_agent',
                senderName: 'WhizzAI Assistant',
                timestamp: aiMessage.payload.timestamp,
                metadata
            });

            this.renderConversation(session);
            this.updateChatSessionsList();
        }
    }

    /**
     * Escalate the conversation to a live agent
     */
    escalateToHumanAgent(sessionId, reason = 'manual') {
        if (!sessionId) return;
        const session = this.chatSessions.get(sessionId);
        if (!session) return;

        const state = this.virtualAgentSessions.get(sessionId) || {};
        if (state.status === 'escalated') return;

        state.status = 'escalated';
        state.escalatedAt = Date.now();
        state.reason = reason;
        this.virtualAgentSessions.set(sessionId, state);

        session.priority = 'high';
        session.requiresHuman = true;

        this.sendVirtualAgentMessage(sessionId, "I'm going to connect you with a live support specialist who can take it from here. Please hold for a moment.", {
            stage: 'escalate',
            reason
        });

        this.updateChatSessionsList();

        try {
            window.dispatchEvent(new CustomEvent('virtual-agent-escalated', {
                detail: { sessionId, reason }
            }));
        } catch (_) { /* no-op */ }
    }

    /**
     * Mark a session as resolved by the virtual agent
     */
    markVirtualAgentResolved(sessionId) {
        const state = this.virtualAgentSessions.get(sessionId);
        if (!state) return;

        if (state.status !== 'resolved') {
            state.status = 'resolved';
            state.resolvedAt = Date.now();
            this.virtualAgentSessions.set(sessionId, state);
            this.sendVirtualAgentMessage(sessionId, "Glad I could help! I'll stay here in case you need anything else. Just type your question.", {
                stage: 'resolved'
            });
        }
    }

    /**
     * Mark a session as handed off to a human
     */
    markVirtualAgentHandedOff(sessionId) {
        const state = this.virtualAgentSessions.get(sessionId);
        if (!state) return;

        if (state.status !== 'handed_off') {
            state.status = 'handed_off';
            state.handedOffAt = Date.now();
            this.virtualAgentSessions.set(sessionId, state);
            this.updateChatSessionsList();
        }
    }

    /**
     * Keyword helpers for escalation/resolution
     */
    detectHumanAgentRequest(text) {
        const normalized = text.toLowerCase();
        return this.virtualAgentConfig.escalateKeywords.some(keyword => normalized.includes(keyword));
    }

    detectResolutionKeywords(text) {
        const normalized = text.toLowerCase();
        return this.virtualAgentConfig.resolutionKeywords.some(keyword => normalized.includes(keyword));
    }

    detectFrustration(text) {
        const normalized = text.toLowerCase();
        return this.virtualAgentConfig.frustrationKeywords.some(keyword => normalized.includes(keyword));
    }

    /**
     * Handle Enter key press in message input
     */
    handleKeyPress(event, sessionId) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage(sessionId);
        }
    }

    /**
     * Insert quick reply into message input
     */
    insertQuickReply(text) {
        if (!this.activeSessionId) return;
        
        const inputElement = document.getElementById(`message-input-${this.activeSessionId}`);
        if (inputElement) {
            inputElement.value = text;
            inputElement.focus();
        }
    }

    /**
     * Show typing indicator
     */
    showTypingIndicator(sessionId) {
        const messagesContainer = document.getElementById(`messages-${sessionId}`);
        if (!messagesContainer) return;

        // Remove existing typing indicator
        const existingIndicator = messagesContainer.querySelector('.typing-indicator');
        if (existingIndicator) existingIndicator.remove();

        // Add new typing indicator
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.innerHTML = `
            <div class="typing-avatar">👤</div>
            <div class="typing-dots">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
            <span class="typing-text">Agent is typing...</span>
        `;
        
        messagesContainer.appendChild(typingIndicator);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    /**
     * Hide typing indicator
     */
    hideTypingIndicator(sessionId) {
        const messagesContainer = document.getElementById(`messages-${sessionId}`);
        if (!messagesContainer) return;

        const typingIndicator = messagesContainer.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    /**
     * Show message status feedback
     */
    showMessageStatus(message, type) {
        // Create or update status element
        let statusElement = document.getElementById('message-status');
        if (!statusElement) {
            statusElement = document.createElement('div');
            statusElement.id = 'message-status';
            statusElement.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                z-index: 1000;
                transition: all 0.3s ease;
            `;
            document.body.appendChild(statusElement);
        }

        statusElement.textContent = message;
        statusElement.style.background = type === 'success' ? '#10b981' : '#ef4444';
        statusElement.style.color = 'white';
        statusElement.style.opacity = '1';

        // Auto-hide after 3 seconds
        setTimeout(() => {
            if (statusElement) {
                statusElement.style.opacity = '0';
            }
        }, 3000);
    }

    /**
     * Utility function to get time ago string
     */
    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d ago`;
    }

    /**
     * Utility function to escape HTML
     */
    escapeHtml(text) {
        if (typeof text !== 'string') {
            return '';
        }
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Escape text for safe usage inside data attributes
     */
    escapeAttribute(text) {
        return this.escapeHtml(text).replace(/"/g, '&quot;');
    }

    /**
     * Show browser notification for new messages
     */
    async showBrowserNotification(title, body, tag) {
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                const notification = new Notification(title, {
                    body: body,
                    tag: tag,
                    icon: '/favicon.ico',
                    badge: '/favicon.ico'
                });

                // Auto-close after 5 seconds
                setTimeout(() => notification.close(), 5000);
            } else if (Notification.permission === 'default') {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    new Notification(title, { body: body, tag: tag });
                }
            }
        }
    }

    /**
     * Play notification sound for new messages
     */
    playNotificationSound() {
        try {
            // Create a simple beep sound using Web Audio API
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800; // 800 Hz frequency
            oscillator.type = 'square';
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (error) {
            console.log('🔇 Could not play notification sound:', error);
        }
    }
}

// Make LiveChatManager available globally
window.LiveChatManager = LiveChatManager;

// Auto-initialize live chat for platform (only if not manually initialized)
document.addEventListener('DOMContentLoaded', () => {
    // Only auto-initialize if we're not on a page that manually initializes it
    if (!window.manualLiveChatInit && !window.liveChatManager) {
        console.log('🚀 Auto-initializing Live Chat Manager...');
        
        try {
            window.liveChatManager = new LiveChatManager({
                userType: 'agent',
                userId: 'platform_agent_' + Date.now(),
                userDisplayName: 'Platform Agent',
                enableVirtualAgent: true
            });
            
            // Connect to live chat WebSocket
            window.liveChatManager.connect().then((connected) => {
                if (connected) {
                    console.log('🎉 Live Chat enabled - platform will receive driver messages!');
                } else {
                    console.warn('⚠️ Live Chat not available');
                }
            }).catch((error) => {
                console.error('❌ Failed to enable Live Chat:', error);
            });
        } catch (error) {
            console.error('❌ Failed to auto-initialize Live Chat:', error);
        }
    }
});
