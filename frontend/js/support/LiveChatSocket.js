// Phase C: LiveChatSocket wrapper that integrates with ChatSessionService
// Goal: Encapsulate WebSocket logic and provide clean integration with centralized session state
(function (global) {
  class LiveChatSocket {
    constructor({ businessId, endpoint, userId, token, agentId, agentName }) {
      this.businessId = businessId;
      const cfgEndpoint = (typeof window !== 'undefined' && window.WIZZCENTRAL_CONFIG && window.WIZZCENTRAL_CONFIG.WEBSOCKET && window.WIZZCENTRAL_CONFIG.WEBSOCKET.LIVE_CHAT_URL) ? window.WIZZCENTRAL_CONFIG.WEBSOCKET.LIVE_CHAT_URL : '';
      this.endpoint = endpoint || cfgEndpoint;
      if (!this.endpoint) {
        throw new Error('Missing WebSocket endpoint. Set window.__LIVE_CHAT_WEBSOCKET_URL__.');
      }
      if (String(this.endpoint).includes('/dev')) {
        throw new Error(`Refusing to use dev WebSocket endpoint in staging: ${this.endpoint}`);
      }
      this.userId = userId || 'support_dashboard';
      this.token = token || '';
      this.agentId = agentId || this.userId;
      this.agentName = agentName || 'Support Agent';
      this.ws = null;
      this.connected = false;
      this.retries = 0;
      this.maxRetries = 8;
      this.baseDelay = 1000;
      this.heartbeatIntervalMs = 30000;
      this.heartbeatTimer = null;
      this.typingThrottle = false;
      this._agentTypingActive = false;

      // Heartbeat watchdog
      this.lastHeartbeatAck = Date.now();
      this.watchdogInterval = null;
      this.watchdogIntervalMs = 10000;
      this.watchdogTriggered = false;

      // Integration with ChatSessionService
      this.sessionService = null;

      // Enhanced connection management
      this.connectionState = 'disconnected'; // disconnected, connecting, connected, error
      this.reconnectTimer = null;
      this.connectionListeners = new Set();
      this.messageQueue = [];
      this.lastConnectionTime = null;
      this.connectionAttempts = 0;

      // Performance tracking
      this.stats = {
        messagesReceived: 0,
        messagesSent: 0,
        reconnects: 0,
        errors: 0,
        connectionTime: 0
      };
    }

    // Identify test/mock sessions that should be ignored in Support UI
    _isTestSession(sessionData = {}) {
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

    init() {
      // Connect to ChatSessionService
      if (global.ChatSessionService) {
        this.sessionService = global.ChatSessionService;
        this.sessionService.setWebSocketInstance(this);
      }

      // Log initialization
      console.log('[LiveChatSocket] Initialized with enhanced error handling and reconnection');

      // Emit initialization event
      if (global.EventBus) {
        global.EventBus.emit('liveChat.initialized', {
          businessId: this.businessId,
          endpoint: this.endpoint,
          agentId: this.agentId
        });
      }
    }

    // Connection state management
    _setConnectionState(state, reason = null) {
      const previousState = this.connectionState;
      this.connectionState = state;

      // Update connected flag for backward compatibility
      this.connected = (state === 'connected');

      // Log state change
      console.log(`[LiveChatSocket] State: ${previousState} → ${state}${reason ? ` (${reason})` : ''}`);

      // Notify listeners
      this.connectionListeners.forEach(listener => {
        try {
          listener({ state, previousState, reason, timestamp: Date.now() });
        } catch (e) {
          console.warn('Connection listener error:', e);
        }
      });

      // Emit to EventBus
      if (global.EventBus) {
        global.EventBus.emit('liveChat.connectionStateChanged', {
          state, previousState, reason,
          stats: { ...this.stats },
          connectionTime: this.lastConnectionTime
        });
      }

      // Update UI if available
      this._updateConnectionUI(state, reason);
    }

    // Add connection state listener
    onConnectionStateChange(listener) {
      this.connectionListeners.add(listener);
      return () => this.connectionListeners.delete(listener);
    }

    // Get current connection info
    getConnectionInfo() {
      return {
        state: this.connectionState,
        connected: this.connected,
        retries: this.retries,
        maxRetries: this.maxRetries,
        stats: { ...this.stats },
        lastConnectionTime: this.lastConnectionTime,
        endpoint: this.endpoint,
        businessId: this.businessId
      };
    }

    buildUrl() {
      // Build URL aligned with SAM WebSocket API expectations
      const params = new URLSearchParams({
        businessId: this.businessId,
        userType: 'support',
        agentId: this.agentId,
        platform: 'web',
        appVersion: '1.0.0'
      });
      
      // Add JWT token for authentication if available
      const token = this._getAuthToken();
      if (token) {
        params.append('token', token);
        params.append('LIVECHAT_TOKEN', token);
        console.log('🔑 Adding authentication token to WebSocket URL');
      } else {
        console.warn('⚠️ No authentication token available - connection may be rejected');
      }
      
      return `${this.endpoint}?${params.toString()}`;
    }

    // Get authentication token for WebSocket connection
    _getAuthToken() {
      try {
        // Try to get JWT token from auth utils
        if (window.Auth && typeof window.Auth.getIdToken === 'function') {
          const idToken = window.Auth.getIdToken();
          if (idToken) {
            console.log('✅ Using idToken for WebSocket authentication');
            return idToken;
          }
        }

        // Fallback to direct sessionStorage access
        const idToken = localStorage.getItem('idToken');
        if (idToken) {
          console.log('✅ Using sessionStorage idToken for WebSocket authentication');
          return idToken;
        }

        // Generate a temporary token for browser clients (fallback)
        console.warn('⚠️ No JWT available, using temporary browser token');
        return `browser_agent_${this.agentId}_${Date.now()}`;
      } catch (error) {
        console.error('❌ Error getting auth token:', error);
        return null;
      }
    }

    connect() {
      // Prevent multiple connection attempts
      if (this.connectionState === 'connecting' || this.connectionState === 'connected') {
        console.log('[LiveChatSocket] Connection already in progress or established');
        return Promise.resolve(this.connected);
      }

      return new Promise((resolve, reject) => {
        try {
          this._setConnectionState('connecting', 'manual_connect');
          this.connectionAttempts++;

          const url = this.buildUrl();
          console.log(`🔌 LiveChatSocket connecting (attempt ${this.connectionAttempts}):`, url);

          this.ws = new WebSocket(url);

          // Connection timeout
          const connectionTimeout = setTimeout(() => {
            if (this.connectionState === 'connecting') {
              console.error('LiveChatSocket connection timeout');
              this.ws?.close();
              this._setConnectionState('error', 'connection_timeout');
              this.stats.errors++;
              reject(new Error('Connection timeout'));
            }
          }, 10000);

          this.ws.onopen = () => {
            clearTimeout(connectionTimeout);
            this.onOpen();
            resolve(true);
          };

          this.ws.onmessage = (e) => this.onMessage(e);

          this.ws.onerror = (e) => {
            clearTimeout(connectionTimeout);
            this.onError(e);
            if (this.connectionState === 'connecting') {
              reject(new Error('WebSocket connection failed'));
            }
          };

          this.ws.onclose = (e) => {
            clearTimeout(connectionTimeout);
            this.onClose(e);
            if (this.connectionState === 'connecting') {
              reject(new Error(`Connection closed during handshake: ${e.code}`));
            }
          };

        } catch (e) {
          console.error('LiveChatSocket connect error', e);
          this._setConnectionState('error', 'connection_exception');
          this.stats.errors++;
          this.scheduleReconnect();
          reject(e);
        }
      });
    }

    onOpen() {
      this.lastConnectionTime = Date.now();
      this.stats.connectionTime = this.lastConnectionTime;
      this.retries = 0;
      this.watchdogTriggered = false;
      this.lastHeartbeatAck = Date.now();

      this._setConnectionState('connected', 'websocket_open');
      this._hideLiveChatErrorBanner();

      console.log('✅ LiveChatSocket connected successfully');

      // Send agent connect message (using 'chat_agent_connect' action to align with AWS handler)
      this.send({
        action: 'chat_agent_connect',
        type: 'chat_agent_connect',
        userType: 'agent',
        agentId: this.agentId,
        agentName: this.agentName,
        businessId: '7ccf646c-9594-48d4-8f63-c366d89257e5'
      });

      // Request delta sync if we have last sync timestamp
      if (this.sessionService?.lastSyncAt) {
        this.send({
          action: 'sync_sessions',
          since: this.sessionService.lastSyncAt
        });
      }

      this.startHeartbeat();
      this.startWatchdog();

      // Send any queued messages
      this._sendQueuedMessages();

      // Notify EventBus
      if (global.EventBus) {
        global.EventBus.emit('liveChat.connected', {
          agentId: this.agentId,
          reconnect: this.stats.reconnects > 0,
          stats: { ...this.stats }
        });
      }
    }

    onMessage(event) {
      try {
        const data = JSON.parse(event.data);
        this.stats.messagesReceived++;
        this._handleMessage(data);
      } catch (e) {
        console.error('LiveChatSocket message parse error:', e);
        this.stats.errors++;
      }
    }

    _handleMessage(data) {
      let msgType = data.type || data.action;

      // Handle heartbeat
      if (msgType === 'heartbeat_response') {
        this.lastHeartbeatAck = Date.now();
        if (this.watchdogTriggered) {
          this.watchdogTriggered = false;
          this._hideLiveChatErrorBanner(true);
        }
        return;
      }

      // Skip ping messages
      if (msgType === 'ping') return;

      // Normalize driver_message to chat_message BEFORE switching
      if (msgType === 'driver_message') {
        data.type = 'chat_message';
        msgType = 'chat_message';
      }

      // Update sync timestamp for session-impacting events
      const sessionImpactTypes = new Set([
        'chat_message', 'system_event', 'session_closed',
        'chat_session_closed', 'active_sessions', 'new_chat_session'
      ]);

      if (sessionImpactTypes.has(msgType) && this.sessionService) {
        this.sessionService.updateLastSyncTimestamp();
      }

      // Route message to appropriate handler
      switch (msgType) {
        case 'active_sessions':
          this._handleActiveSessions(data.sessions || []);
          break;

        case 'new_chat_session':
          this._handleNewSession(data);
          break;

        case 'chat_message':
          this._handleChatMessage(data);
          break;

        case 'session_messages':
          this._handleSessionMessages(data);
          break;

        case 'system_event':
          this._handleSystemEvent(data);
          break;

        case 'session_closed':
        case 'chat_session_closed':
          this._handleSessionClosed(data);
          break;

        case 'chat_session_close_ack':
          this._handleSessionCloseAck(data);
          break;

        case 'typing_indicator':
          this._handleTypingIndicator(data);
          break;

        default:
          console.log('Unhandled message type:', msgType, data);
      }

      // Emit to EventBus for any subscribers using the normalized type
      if (global.EventBus) {
        global.EventBus.emit(`liveChat.${msgType}`, data);
      }
    }

    _handleActiveSessions(sessions) {
      if (!this.sessionService) return;

      sessions.forEach(sessionData => {
        // Skip test/mock sessions
        if (this._isTestSession(sessionData)) {
          console.log('[LiveChatSocket] Ignoring test session from backend:', sessionData.sessionId || sessionData.id);
          return;
        }

        const existingSession = this.sessionService.getSession(sessionData.sessionId);
        if (existingSession) {
          this.sessionService.updateSession(sessionData.sessionId, {
            status: sessionData.status,
            driverName: sessionData.driverName || sessionData.driverInfo?.driverName,
            metadata: sessionData
          });
        } else {
          this.sessionService.addSession(sessionData);
        }
      });

      // Re-render UI if LiveChatUI is available
      if (global.LiveChatUI) {
        global.LiveChatUI.renderSessionChips();
      }
    }

    _handleNewSession(data) {
      if (!this.sessionService) return;

      // Skip test/mock sessions
      if (this._isTestSession(data)) {
        console.log('[LiveChatSocket] Ignoring new test session:', data.sessionId || data.id);
        return;
      }

      const session = this.sessionService.addSession(data);
      console.log('New chat session:', session.id);

      // Auto-activate if no active session
      if (!this.sessionService.activeSessionId) {
        this.sessionService.setActiveSession(session.id);
      }

      // Re-render UI
      if (global.LiveChatUI) {
        global.LiveChatUI.renderSessionChips();
      }
    }

    _handleChatMessage(data) {
      // Unwrap SAM payloads: sometimes the actual message is nested under `message`
      const payload = (data && typeof data.message === 'object') ? data.message : data;

      // Determine sessionId from top-level or payload
      const sessionId = data.sessionId || data.session_id || payload.sessionId || payload.session_id;
      if (!sessionId || !this.sessionService) return;

      // If auto-creating a session from message, make sure it's not a test/mock session
      const inferredDriverName = data.driverName || payload.driverName || (data.metadata && data.metadata.driverName) || 'Driver';
      const tentativeSession = { sessionId, driverName: inferredDriverName, metadata: data.metadata || payload.metadata };
      if (!this.sessionService.getSession(sessionId) && this._isTestSession(tentativeSession)) {
        console.log('[LiveChatSocket] Ignoring test message/session:', sessionId);
        return; // Drop test message entirely
      }

      // Ensure session exists (in case message arrives before active_sessions)
      let session = this.sessionService.getSession(sessionId);
      if (!session) {
        session = this.sessionService.addSession({
          sessionId,
          driverName: inferredDriverName,
          status: 'active',
          metadata: data.metadata || payload.metadata
        });
      }

      // Normalize fields expected by ValidationManager/UI
      const rawSenderType = payload.senderType || data.senderType;
      const isDriver = rawSenderType === 'driver' || (data.metadata && data.metadata.senderType === 'driver');

      const normalized = {
        // IDs
        id: payload.messageId || data.messageId,
        sessionId,
        // Sender
        senderType: isDriver ? 'user' : (rawSenderType || 'agent'),
        senderName: payload.senderName || data.metadata?.senderName || (isDriver ? (data.driverName || payload.driverName || 'Driver') : (this.agentName || 'Agent')),
        // Content
        messageText: payload.messageText || payload.text || data.messageText || data.text || '',
        // Timestamp
        timestamp: payload.createdAt || payload.timestamp || data.timestamp || new Date().toISOString(),
        // Keep original metadata for debugging if present
        metadata: data.metadata || payload.metadata
      };

      // Add message to session
      const added = this.sessionService.addMessage(sessionId, normalized);

      // Legacy UI fallback
      if (added && global.appendChatMessage) {
        global.appendChatMessage({ ...normalized });
      }

      // Update unread badge if LiveChatUI available
      if (global.LiveChatUI && sessionId !== this.sessionService.activeSessionId) {
        global.LiveChatUI.incrementUnread(sessionId);
      }
    }

    _handleSystemEvent(data) {
      const sessionId = data.sessionId;
      if (!sessionId) return;

      // Add as system message
      if (this.sessionService) {
        this.sessionService.addMessage(sessionId, {
          senderType: 'system',
          messageText: data.message || data.text || 'System event',
          subtype: data.subtype,
          ...data
        });
      }

      // Legacy support
      if (global.appendChatSystemMessage) {
        global.appendChatSystemMessage(
          sessionId,
          data.message || data.text || 'System event',
          data.subtype,
          data.timestamp
        );
      }
    }

    _handleSessionClosed(data) {
      const sessionId = data.sessionId;
      if (!sessionId) return;

      if (this.sessionService) {
        this.sessionService.updateSession(sessionId, { status: 'closed' });

        // Remove session after a delay
        setTimeout(() => {
          this.sessionService.removeSession(sessionId);
          if (global.LiveChatUI) {
            global.LiveChatUI.renderSessionChips();
          }
        }, 5000);
      }
    }

    _handleSessionCloseAck(data) {
      const sessionId = data.sessionId;
      if (!sessionId) return;

      if (this.sessionService) {
        this.sessionService.updateSession(sessionId, { status: 'closing' });
      }

      // Legacy support
      if (global.appendChatSystemMessage) {
        global.appendChatSystemMessage(sessionId, 'Closing session…', 'session_closing', data.timestamp);
      }
    }

    _handleTypingIndicator(data) {
      const sessionId = data.sessionId;
      const isTyping = data.isTyping;

      // Only show typing indicator for active session
      if (this.sessionService?.activeSessionId === sessionId) {
        const indicator = document.getElementById('liveChatTypingIndicator');
        if (indicator) {
          indicator.style.display = isTyping ? 'block' : 'none';
          if (isTyping) {
            indicator.textContent = `${data.driverName || 'Driver'} is typing...`;
          }
        }
      }
    }

    _handleSessionMessages(data) {
      if (!this.sessionService) return;
      const sessionId = data.sessionId;
      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (!sessionId || !messages.length) return;

      // Ensure session exists
      let session = this.sessionService.getSession(sessionId);
      if (!session) {
        session = this.sessionService.addSession({ sessionId, driverName: data.driverName || 'Driver', status: 'active', metadata: { source: 'history_load' } });
      }

      // Messages come newest-first from backend; reverse to chronological
      const chron = [...messages].reverse();
      chron.forEach(m => {
        const normalized = {
          id: m.messageId,
          sessionId,
          senderType: m.senderType === 'driver' ? 'user' : 'agent',
          senderName: m.senderType === 'driver' ? (data.driverName || 'Driver') : (this.agentName || 'Agent'),
          messageText: m.text || '',
          timestamp: m.createdAt || new Date().toISOString(),
          metadata: { messageKey: m.messageKey }
        };
        // Avoid duplicates by id
        const exists = (session.messages || []).some(x => x.id === normalized.id);
        if (!exists) {
          this.sessionService.addMessage(sessionId, normalized);
        }
      });

      // Re-render transcript if this is the active session
      if (global.LiveChatUI && this.sessionService.activeSessionId === sessionId) {
        global.LiveChatUI.renderActiveTranscript();
      }
    }

    onError(error) {
      console.error('LiveChatSocket error:', error);
      this.stats.errors++;
      this._setConnectionState('error', 'websocket_error');
      this._showLiveChatErrorBanner('Connection error occurred');

      // Emit error event
      if (global.EventBus) {
        global.EventBus.emit('liveChat.error', { error, timestamp: Date.now() });
      }
    }

    onClose(event) {
      this.stopHeartbeat();
      this.stopWatchdog();

      const wasConnected = this.connected;
      const closeCode = event.code;
      const closeReason = event.reason || 'Unknown';
      const wasClean = event.wasClean;
      const readyState = this.ws ? this.ws.readyState : -1;
      const readyStateMap = { 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED' };

      console.log(`LiveChatSocket closed: code=${closeCode} reason=${closeReason} wasClean=${wasClean} readyState=${readyStateMap[readyState] || readyState}`);

      // Determine reconnection behavior based on close code
      const shouldReconnect = this._shouldReconnect(closeCode);
      const stateReason = this._getCloseReason(closeCode, closeReason);

      this._setConnectionState('disconnected', stateReason);

      if (shouldReconnect) {
        this._showLiveChatErrorBanner('Connection lost. Attempting to reconnect...');
        this.scheduleReconnect();
      } else if (closeCode !== 1000 && closeCode !== 1001) {
        this._showLiveChatErrorBanner(`Connection closed (${closeCode}): ${closeReason}`);
      }

      // Emit disconnect event
      if (global.EventBus) {
        global.EventBus.emit('liveChat.disconnected', {
          code: closeCode,
          reason: closeReason,
          wasConnected,
          willReconnect: shouldReconnect
        });
      }
    }

    // Helper methods for close handling
    _shouldReconnect(closeCode) {
      // Don't reconnect on normal closure, going away, or auth failures
      const noReconnectCodes = [1000, 1001, 1002, 1003, 1007, 1008, 1011];
      return !noReconnectCodes.includes(closeCode) && this.retries < this.maxRetries;
    }

    _getCloseReason(code, reason) {
      const codeReasons = {
        1000: 'normal_closure',
        1001: 'going_away',
        1002: 'protocol_error',
        1003: 'unsupported_data',
        1006: 'abnormal_closure',
        1007: 'invalid_data',
        1008: 'policy_violation',
        1009: 'message_too_big',
        1011: 'server_error',
        1012: 'service_restart',
        1013: 'try_again_later',
        1014: 'bad_gateway',
        1015: 'tls_handshake_failure'
      };
      return codeReasons[code] || `unknown_close_${code}`;
    }

    send(data) {
      // Add timestamp and sequence if not present
      if (!data.timestamp) data.timestamp = new Date().toISOString();
      if (!data.messageId) data.messageId = this._generateMessageId();

      if (this.ws && this.connected && this.ws.readyState === WebSocket.OPEN) {
        try {
          const message = JSON.stringify(data);
          this.ws.send(message);
          this.stats.messagesSent++;
          console.log('📤 LiveChatSocket sent:', data.type || data.action);
          return true;
        } catch (e) {
          console.error('Send error:', e);
          this.stats.errors++;
          this._queueMessage(data);
          return false;
        }
      } else {
        // Queue message for later sending
        this._queueMessage(data);
        console.log('📤 Message queued (not connected):', data.type || data.action);
        
        // Attempt reconnection if not already connecting
        if (!this.connected && this.connectionState !== 'connecting') {
          console.log('🔄 Auto-reconnecting to send queued message...');
          this.connect().catch(error => {
            console.error('Auto-reconnect failed:', error);
          });
        }
        
        return false;
      }
    }

    // Queue message for sending when connection is restored
    _queueMessage(message) {
      // Limit queue size to prevent memory issues
      if (this.messageQueue.length >= 100) {
        this.messageQueue.shift(); // Remove oldest message
      }
      this.messageQueue.push(message);
    }

    // Send all queued messages
    _sendQueuedMessages() {
      const queuedCount = this.messageQueue.length;
      if (queuedCount > 0) {
        console.log(`📤 Sending ${queuedCount} queued messages`);
        const messages = [...this.messageQueue];
        this.messageQueue = [];

        messages.forEach(message => {
          this.send(message);
        });
      }
    }

    // Generate unique message ID
    _generateMessageId() {
      return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    scheduleReconnect() {
      // Clear any existing reconnect timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      if (this.retries >= this.maxRetries) {
        console.error('Max reconnection attempts reached');
        this._setConnectionState('error', 'max_retries_exceeded');
        this._showLiveChatErrorBanner('Connection failed. Please refresh the page.');

        // Emit max retries event
        if (global.EventBus) {
          global.EventBus.emit('liveChat.maxRetriesReached', {
            retries: this.retries,
            maxRetries: this.maxRetries
          });
        }
        return;
      }

      this.retries++;
      this.stats.reconnects++;

      // Exponential backoff with jitter
      const baseDelay = this.baseDelay * Math.pow(1.5, this.retries - 1);
      const jitter = Math.random() * 1000; // Add up to 1 second of jitter
      const delay = Math.min(baseDelay + jitter, 30000);

      console.log(`🔄 Scheduling reconnect attempt ${this.retries}/${this.maxRetries} in ${Math.round(delay)}ms`);

      this._setConnectionState('connecting', 'scheduled_reconnect');

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        console.log(`🔄 Attempting reconnect ${this.retries}/${this.maxRetries}`);
        this.connect().catch(error => {
          console.error('Reconnect attempt failed:', error);
          this.scheduleReconnect();
        });
      }, delay);

      // Emit reconnect scheduled event
      if (global.EventBus) {
        global.EventBus.emit('liveChat.reconnectScheduled', {
          attempt: this.retries,
          maxAttempts: this.maxRetries,
          delay: Math.round(delay)
        });
      }
    }

    startHeartbeat() {
      this.stopHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        this.send({ type: 'heartbeat', timestamp: new Date().toISOString() });
      }, this.heartbeatIntervalMs);
    }

    stopHeartbeat() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }

    startWatchdog() {
      this.stopWatchdog();
      this.watchdogInterval = setInterval(() => {
        const now = Date.now();
        if (now - this.lastHeartbeatAck > this.watchdogIntervalMs * 2) {
          if (!this.watchdogTriggered) {
            this.watchdogTriggered = true;
            this._showLiveChatErrorBanner('Connection may be unstable...');
          }
        }
      }, this.watchdogIntervalMs);
    }

    stopWatchdog() {
      if (this.watchdogInterval) {
        clearInterval(this.watchdogInterval);
        this.watchdogInterval = null;
      }
    }

    _basicDisconnect() {
      this.stopHeartbeat();
      this.stopWatchdog();
      if (this.ws) {
        this.ws.close(1000, 'Manual disconnect');
        this.ws = null;
      }
      this.connected = false;
    }

    // UI Helper Methods
    _showLiveChatErrorBanner(message) {
      // Use legacy function if available, otherwise create simple banner
      if (global.showLiveChatErrorBanner) {
        global.showLiveChatErrorBanner(message);
      } else {
        console.warn('LiveChat Error:', message);
      }
    }

    _hideLiveChatErrorBanner(silent = false) {
      if (global.hideLiveChatErrorBanner) {
        global.hideLiveChatErrorBanner(silent);
      }
    }

    // Update connection status in UI
    _updateConnectionUI(state, reason) {
      // Support both legacy and current status elements
      const statusEl = document.getElementById('liveChatConnectionStatus') || document.getElementById('live-chat-status');
      if (statusEl) {
        const statusConfig = {
          connected: { text: '🟢 Connected', class: 'status-connected', color: '#10b981' },
          connecting: { text: '🟡 Connecting...', class: 'status-connecting', color: '#f59e0b' },
          disconnected: { text: '🔴 Disconnected', class: 'status-disconnected', color: '#ef4444' },
          error: { text: '❌ Error', class: 'status-error', color: '#ef4444' }
        };

        const config = statusConfig[state] || statusConfig.disconnected;
        statusEl.textContent = config.text;
        // Apply class if present, else fallback to inline color used by page
        if (statusEl.classList) {
          statusEl.className = `live-chat-status ${config.class}`;
        }
        statusEl.style.color = config.color;
        statusEl.title = reason ? `Reason: ${reason}` : '';
      }

      // Update retry info
      const retryEl = document.getElementById('liveChatRetryInfo');
      if (retryEl) {
        if (this.retries > 0) {
          retryEl.textContent = `Retry ${this.retries}/${this.maxRetries}`;
          retryEl.style.display = 'inline';
        } else {
          retryEl.style.display = 'none';
        }
      }

      // Update stats display
      const statsEl = document.getElementById('liveChatStats');
      if (statsEl) {
        statsEl.innerHTML = `
          <div class="live-chat-stat">Messages: ${this.stats.messagesSent}/${this.stats.messagesReceived}</div>
          <div class="live-chat-stat">Reconnects: ${this.stats.reconnects}</div>
          <div class="live-chat-stat">Errors: ${this.stats.errors}</div>
        `;
      }

      // Bridge to support page badge when available
      try {
        if (typeof window.updateConnectionStatus === 'function') {
          const map = {
        type: 'chat_message',
        sessionId,
        senderType: 'agent',
        senderName: this.agentName,
        messageText,
        timestamp: new Date().toISOString()
      });
    }

    closeSession(sessionId) {
      return this.send({
        type: 'chat_session_close',
        sessionId,
        closedByUserType: 'agent',
        closedByUserId: this.agentId,
        timestamp: new Date().toISOString()
      });
    }

    setTyping(sessionId, isTyping) {
      if (this.typingThrottle) return;

      this.typingThrottle = true;
      setTimeout(() => this.typingThrottle = false, 1000);

      return this.send({
        type: 'chat_typing',
        sessionId,
        senderType: 'agent',
        agentId: this.agentId,
        agentName: this.agentName,
        isTyping,
        timestamp: new Date().toISOString()
      });
    }

    // Manual disconnect
    disconnect() {
      console.log('[LiveChatSocket] Manual disconnect requested');

      // Clear timers
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      this.stopHeartbeat();
      this.stopWatchdog();

      // Send disconnect message if connected
      if (this.connected && this.ws) {
        this.send({
          type: 'chat_agent_disconnect',
          agentId: this.agentId,
          timestamp: new Date().toISOString()
        });
      }

      // Close WebSocket with normal closure code
      if (this.ws) {
        this.ws.close(1000, 'Manual disconnect');
        this.ws = null;
      }

      this._setConnectionState('disconnected', 'manual_disconnect');

      // Clear message queue
      this.messageQueue = [];

      // Reset retry counter
      this.retries = 0;
    }

    // Cleanup and dispose
    dispose() {
      console.log('[LiveChatSocket] Disposing instance');

      this.disconnect();

      // Clear all listeners
      this.connectionListeners.clear();

      // Reset stats
      this.stats = {
        messagesReceived: 0,
        messagesSent: 0,
        reconnects: 0,
        errors: 0,
        connectionTime: 0
      };

      // Clear session service reference
      if (this.sessionService) {
        this.sessionService.setWebSocketInstance(null);
        this.sessionService = null;
      }

      console.log('[LiveChatSocket] Disposed successfully');
    }
  }

  global.LiveChatSocket = LiveChatSocket;
})(window);
