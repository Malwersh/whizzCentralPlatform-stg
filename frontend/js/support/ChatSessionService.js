// Phase C: ChatSessionService centralizes session state, unread counters, and WebSocket management
// Goal: Abstract chat state from legacy globals; provide clean API for session management
(function (global) {
  class ChatSessionService {
    constructor() {
      this.sessions = new Map(); // sessionId -> { id, driverName, status, messages, unreadCount, lastActivity, metadata }
      this.activeSessionId = null;
      this.wsInstance = null; // will hold LiveChatSocket instance
      this.lastSyncAt = null;
      this.initialized = false;
      this.subscribers = new Set();
    }

    // Determine if a session looks like a test/mock
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

    // Only allow sessions from WizzDriver (Flutter) that are actively contacting support
    _isAllowedDriverSession(sessionData = {}) {
      try {
        const meta = sessionData.metadata || {};
        const platform = sessionData.platform || meta.platform || sessionData.driverInfo?.platform;
        const sourceRaw = meta.source || sessionData.source || sessionData.driverInfo?.source;
        const source = typeof sourceRaw === 'string' ? sourceRaw.toLowerCase() : null;
        const userAgent = (meta.userAgent || '').toString();
        const driverName = (sessionData.driverName || '').toLowerCase();
        
        // First check: Must be from WizzDriver Flutter app
        const allowByPlatform = typeof platform === 'string' && platform.toLowerCase() === 'flutter';
        const allowBySource = source === 'wizzdriver' || source === 'flutter_http_bridge';
        const allowByUA = /dart|flutter/i.test(userAgent);
        
        // Additional validation for genuine driver names
        const hasRealDriverName = driverName && 
          !driverName.includes('test') && 
          !driverName.includes('mock') && 
          !driverName.includes('demo') &&
          driverName !== 'driver 123' &&
          driverName !== 'driver';
        
        // Must have at least one positive indicator for WizzDriver app
        const hasPositiveIndicator = allowByPlatform || allowBySource || allowByUA;
        
        // Explicitly disallow test/mock sources
        const explicitNonFlutter = typeof platform === 'string' && platform && platform.toLowerCase() !== 'flutter';
        const explicitMock = typeof source === 'string' && /test|mock|demo|web|browser/i.test(source);
        if (explicitNonFlutter || explicitMock) return false;
        
        // Second check: Must be an active live chat session initiated by driver
        const isActiveChatSession = this._isActiveLiveChatSession(sessionData);
        
        // CORE REQUIREMENT: Only show drivers who actively contacted live chat support
        // Must have: WizzDriver app + Real driver name + Active chat session
        const isValidWizzDriverSession = hasPositiveIndicator && hasRealDriverName;
        
        // Return true only if BOTH conditions are met:
        // 1. Valid WizzDriver app session with real driver name
        // 2. Driver actively initiated a live chat conversation
        return isValidWizzDriverSession && isActiveChatSession;
        
      } catch (e) {
        return false; // Default to reject on error for security
      }
    }

    // Check if session is an active live chat initiated by a driver
    _isActiveLiveChatSession(sessionData = {}) {
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

    init() {
      if (this.initialized) return;

      // Sync with legacy globals if they exist
      if (global.liveChatSessions) {
        Object.entries(global.liveChatSessions).forEach(([id, sess]) => {
          const candidate = {
            id,
            driverName: sess.driverName || sess.driverInfo?.driverName || 'Driver',
            status: sess.status || 'waiting_for_agent',
            messages: sess.messages || [],
            unreadCount: 0,
            lastActivity: sess.lastActivity || new Date().toISOString(),
            metadata: sess
          };
          if (this._isTestSession(candidate)) return; // skip test
          if (!this._isAllowedDriverSession(candidate)) return; // skip non-WizzDriver
          this.sessions.set(id, candidate);
        });
      }

      // Sync active session
      if (global.liveChatUIState?.activeSessionId) {
        this.activeSessionId = global.liveChatUIState.activeSessionId;
      }

      // Restore from localStorage if available
      this._restoreFromStorage();

      this.initialized = true;
      this._notifySubscribers('initialized', { sessionCount: this.sessions.size });
    }

    // Session Management
    addSession(sessionData) {
      // Filter out test/mock or non-WizzDriver sessions
      if (this._isTestSession(sessionData)) { return null; }
      if (!this._isAllowedDriverSession(sessionData)) { return null; }

      const session = {
        id: sessionData.sessionId || sessionData.id,
        driverName: sessionData.driverName || sessionData.driverInfo?.driverName || 'Driver',
        status: sessionData.status || 'waiting_for_agent',
        messages: [],
        unreadCount: 0,
        lastActivity: new Date().toISOString(),
        metadata: sessionData
      };

      this.sessions.set(session.id, session);
      this._syncWithLegacyGlobals();
      this._persistToStorage();
      this._notifySubscribers('sessionAdded', { session });

      return session;
    }

    removeSession(sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.sessions.delete(sessionId);
        if (this.activeSessionId === sessionId) {
          this.activeSessionId = null;
        }
        this._syncWithLegacyGlobals();
        this._persistToStorage();
        this._notifySubscribers('sessionRemoved', { sessionId, session });
      }
    }

    updateSession(sessionId, updates) {
      const session = this.sessions.get(sessionId);
      if (session) {
        Object.assign(session, updates);
        session.lastActivity = new Date().toISOString();
        this._syncWithLegacyGlobals();
        this._persistToStorage();
        this._notifySubscribers('sessionUpdated', { sessionId, session, updates });
      }
    }

    getSession(sessionId) {
      return this.sessions.get(sessionId);
    }

    getAllSessions() {
      return Array.from(this.sessions.values());
    }

    getSessionEntries() {
      return Array.from(this.sessions.entries());
    }

    // Active Session Management
    setActiveSession(sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) return false;

      this.activeSessionId = sessionId;
      // Reset unread count for active session
      session.unreadCount = 0;

      // Request recent messages for this session
      if (this.wsInstance && this.wsInstance.connected) {
        try {
          this.wsInstance.send({ type: 'get_session_messages', sessionId, limit: 40 });
        } catch (e) { console.warn('[ChatSessionService] Failed to request session messages', e); }
      }

      this._syncWithLegacyGlobals();
      this._persistToStorage();
      this._notifySubscribers('activeSessionChanged', { sessionId, session });

      return true;
    }

    getActiveSession() {
      return this.activeSessionId ? this.sessions.get(this.activeSessionId) : null;
    }

    // Message Management
    addMessage(sessionId, message) {
      const session = this.sessions.get(sessionId);
      if (!session) return false;

      // If session becomes flagged as test or non-allowed later, stop adding messages
      if (this._isTestSession(session) || !this._isAllowedDriverSession(session)) {
        return false;
      }

      // Message validation (ValidationManager removed)

      let normalizedMessage = {
        id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sessionId,
        senderName: message.senderName || message.sender || 'Unknown',
        senderType: message.senderType || 'user',
        messageText: message.messageText || message.text || message.message || '',
        timestamp: message.timestamp || new Date().toISOString(),
        ...message
      };

      // Message sanitization (ValidationManager removed)

      session.messages.push(normalizedMessage);
      session.lastActivity = normalizedMessage.timestamp;

      // Increment unread if not active session
      if (sessionId !== this.activeSessionId) {
        session.unreadCount++;
      }

      this._syncWithLegacyGlobals();
      this._persistToStorage();
      this._notifySubscribers('messageAdded', { sessionId, message: normalizedMessage, session });

      return normalizedMessage;
    }

    getUnreadCount(sessionId) {
      const session = this.sessions.get(sessionId);
      return session ? session.unreadCount : 0;
    }

    getTotalUnreadCount() {
      return Array.from(this.sessions.values()).reduce((sum, session) => sum + session.unreadCount, 0);
    }

    // WebSocket Integration
    setWebSocketInstance(wsInstance) {
      this.wsInstance = wsInstance;
      this._notifySubscribers('webSocketConnected', { wsInstance });
    }

    sendMessage(sessionId, messageText) {
      if (!this.wsInstance || !this.wsInstance.connected) {
        console.warn('[ChatSessionService] WebSocket not connected');
        return false;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        console.warn('[ChatSessionService] Session not found:', sessionId);
        return false;
      }

      const message = {
        type: 'chat_message',
        sessionId,
        senderType: 'agent',
        messageText,
        timestamp: new Date().toISOString()
      };

      this.wsInstance.send(message);
      return true;
    }

    // Persistence
    _persistToStorage() {
      try {
        const state = {
          activeSessionId: this.activeSessionId,
          lastSyncAt: this.lastSyncAt,
          unreadCounts: Object.fromEntries(
            Array.from(this.sessions.entries()).map(([id, session]) => [id, session.unreadCount])
          )
        };
        localStorage.setItem('chatSessionState', JSON.stringify(state));
      } catch (e) {
        console.warn('[ChatSessionService] Failed to persist to storage:', e);
      }
    }

    _restoreFromStorage() {
      try {
        const stored = localStorage.getItem('chatSessionState');
        if (stored) {
          const state = JSON.parse(stored);
          this.activeSessionId = state.activeSessionId;
          this.lastSyncAt = state.lastSyncAt;

          // Restore unread counts
          if (state.unreadCounts) {
            Object.entries(state.unreadCounts).forEach(([sessionId, count]) => {
              const session = this.sessions.get(sessionId);
              if (session) {
                session.unreadCount = count || 0;
              }
            });
          }
        }
      } catch (e) {
        console.warn('[ChatSessionService] Failed to restore from storage:', e);
      }
    }

    // Legacy Synchronization
    _syncWithLegacyGlobals() {
      // Keep legacy globals in sync for backward compatibility
      if (!global.liveChatSessions) global.liveChatSessions = {};
      if (!global.liveChatUIState) global.liveChatUIState = {};

      // Sync sessions
      global.liveChatSessions = {};
      this.sessions.forEach((session, id) => {
        global.liveChatSessions[id] = session.metadata;
        global.liveChatSessions[id].messages = session.messages;
      });

      // Sync active session
      global.liveChatUIState.activeSessionId = this.activeSessionId;
    }

    // Event System
    subscribe(callback) {
      this.subscribers.add(callback);
      return () => this.subscribers.delete(callback);
    }

    _notifySubscribers(event, data) {
      this.subscribers.forEach(callback => {
        try {
          callback(event, data);
        } catch (e) {
          console.warn('[ChatSessionService] Subscriber error:', e);
        }
      });

      // Also emit via EventBus if available
      if (global.EventBus) {
        global.EventBus.emit(`chatSession.${event}`, data);
      }
    }

    // Utility Methods
    getSessionCount() {
      return this.sessions.size;
    }

    getSessionsByStatus(status) {
      return Array.from(this.sessions.values()).filter(session => session.status === status);
    }

    updateLastSyncTimestamp() {
      this.lastSyncAt = new Date().toISOString();
      this._persistToStorage();
    }

    // Debug/Development
    dumpState() {
      return {
        sessionCount: this.sessions.size,
        activeSessionId: this.activeSessionId,
        sessions: Object.fromEntries(this.sessions),
        totalUnread: this.getTotalUnreadCount(),
        lastSyncAt: this.lastSyncAt
      };
    }
  }

  global.ChatSessionService = new ChatSessionService();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => global.ChatSessionService.init());
  } else {
    global.ChatSessionService.init();
  }
})(window);
