/**
 * Auto Session Filter Script
 * Automatically filters out test/mock sessions from the live chat system
 * to show only genuine WizzDriver app sessions
 */

(function() {
    'use strict';

    console.log('🔧 Auto Session Filter: Starting...');

    // Configuration
    const CONFIG = {
        filterInterval: 30000, // Filter every 30 seconds
        debugMode: true,
        autoCleanup: true,
        showNotifications: true
    };

    let filterIntervalId = null;
    let lastFilterTime = null;
    let filteredSessionsCount = 0;

    /**
     * Main filtering function
     */
    function applySessionFiltering() {
        try {
            // Try different manager types based on what's available
            let sessionManager = null;
            let sessionCount = 0;
            
            if (window.liveChatManager) {
                sessionManager = window.liveChatManager;
                sessionCount = sessionManager.chatSessions.size;
            } else if (window.ChatSessionService) {
                sessionManager = window.ChatSessionService;
                sessionCount = sessionManager.sessions ? sessionManager.sessions.size : 0;
            } else {
                console.log('🔧 Auto Session Filter: No session manager available yet');
                return;
            }

            if (sessionCount === 0) {
                console.log('🔧 Auto Session Filter: No sessions to filter');
                return;
            }

            let removedCount = 0;
            let afterCount = sessionCount;

            // Apply filtering based on manager type
            if (sessionManager.filterGenuineSessions) {
                // LiveChatManager style
                const beforeCount = sessionManager.chatSessions.size;
                const filteredSessions = sessionManager.filterGenuineSessions();
                afterCount = filteredSessions.size;
                removedCount = beforeCount - afterCount;
            } else if (sessionManager.sessions) {
                // ChatSessionService style - manually filter
                const beforeCount = sessionManager.sessions.size;
                const sessionsToRemove = [];
                
                sessionManager.sessions.forEach((session, sessionId) => {
                    if (isTestSession(session) || !isAllowedDriverSession(session)) {
                        sessionsToRemove.push(sessionId);
                    }
                });
                
                sessionsToRemove.forEach(sessionId => {
                    const session = sessionManager.sessions.get(sessionId);
                    console.log('🔧 Auto Filter: Removing test session:', sessionId, session?.driverName);
                    sessionManager.removeSession(sessionId);
                });
                
                removedCount = sessionsToRemove.length;
                afterCount = sessionManager.sessions.size;
            }

            if (removedCount > 0) {
                filteredSessionsCount += removedCount;
                console.log(`🔧 Auto Session Filter: Filtered ${removedCount} test/mock sessions (${afterCount} genuine remain)`);
                
                if (CONFIG.showNotifications && typeof window.showNotification === 'function') {
                    window.showNotification(
                        'Sessions Filtered',
                        `Removed ${removedCount} test sessions. ${afterCount} genuine WizzDriver sessions active.`,
                        'info'
                    );
                }
                
                // Update UI if available
                if (window.LiveChatUI && window.LiveChatUI.renderSessionChips) {
                    window.LiveChatUI.renderSessionChips();
                }
            } else if (CONFIG.debugMode) {
                console.log(`🔧 Auto Session Filter: All ${afterCount} sessions are genuine WizzDriver sessions`);
            }

            lastFilterTime = new Date();

        } catch (error) {
            console.error('🔧 Auto Session Filter Error:', error);
        }
    }

    /**
     * Session filtering helper functions
     */
    function isTestSession(sessionData = {}) {
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
     * Check if session is an active live chat initiated by a driver
     * Only show drivers who actively contacted support
     */
    function isActiveLiveChatSession(sessionData = {}) {
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

    function isAllowedDriverSession(sessionData = {}) {
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
            const isActiveChatSession = isActiveLiveChatSession(sessionData);
            
            // CORE REQUIREMENT: Only show drivers who actively contacted live chat support
            // Must have: WizzDriver app + Real driver name + Active chat session
            const isValidWizzDriverSession = hasPositiveIndicator && hasRealDriverName;
            
            if (CONFIG.debugMode && isValidWizzDriverSession) {
                console.log(`🔧 Valid WizzDriver session "${driverName}" - Active chat: ${isActiveChatSession}`);
            }
            
            // Return true only if BOTH conditions are met:
            // 1. Valid WizzDriver app session with real driver name
            // 2. Driver actively initiated a live chat conversation
            return isValidWizzDriverSession && isActiveChatSession;
            
        } catch (e) {
            return false; // Default to reject on error for security
        }
    }

    /**
     * Start automatic filtering
     */
    function startAutoFiltering() {
        if (filterIntervalId) {
            console.log('🔧 Auto Session Filter: Already running');
            return;
        }

        console.log(`🔧 Auto Session Filter: Starting automatic filtering (every ${CONFIG.filterInterval/1000}s)`);
        
        // Apply initial filtering
        applySessionFiltering();
        
        // Set up interval
        filterIntervalId = setInterval(applySessionFiltering, CONFIG.filterInterval);
        
        // Listen for new sessions from different managers
        if (window.liveChatManager && typeof window.liveChatManager.on === 'function') {
            window.liveChatManager.on('active_sessions', function() {
                setTimeout(applySessionFiltering, 1000); // Apply filtering after new sessions load
            });
            
            window.liveChatManager.on('driver_connected', function() {
                setTimeout(applySessionFiltering, 500); // Quick filter after driver connection
            });
        }
        
        // Listen for ChatSessionService events
        if (window.EventBus && typeof window.EventBus.on === 'function') {
            window.EventBus.on('liveChat.active_sessions', function() {
                setTimeout(applySessionFiltering, 1000);
            });
            
            window.EventBus.on('liveChat.session_added', function() {
                setTimeout(applySessionFiltering, 500);
            });
        }
    }

    /**
     * Stop automatic filtering
     */
    function stopAutoFiltering() {
        if (filterIntervalId) {
            clearInterval(filterIntervalId);
            filterIntervalId = null;
            console.log('🔧 Auto Session Filter: Stopped');
        }
    }

    /**
     * Manual cleanup function
     */
    function manualCleanup() {
        let removedCount = 0;
        
        if (window.liveChatManager && typeof window.liveChatManager.cleanupTestSessions === 'function') {
            removedCount = window.liveChatManager.cleanupTestSessions();
        } else if (window.ChatSessionService && window.ChatSessionService.sessions) {
            const sessionsToRemove = [];
            
            window.ChatSessionService.sessions.forEach((session, sessionId) => {
                if (isTestSession(session) || !isAllowedDriverSession(session)) {
                    sessionsToRemove.push(sessionId);
                }
            });
            
            sessionsToRemove.forEach(sessionId => {
                const session = window.ChatSessionService.sessions.get(sessionId);
                console.log('🔧 Manual Cleanup: Removing test session:', sessionId, session?.driverName);
                window.ChatSessionService.removeSession(sessionId);
            });
            
            removedCount = sessionsToRemove.length;
            
            // Update UI
            if (window.LiveChatUI && window.LiveChatUI.renderSessionChips) {
                window.LiveChatUI.renderSessionChips();
            }
        }
        
        console.log(`🔧 Auto Session Filter: Manual cleanup removed ${removedCount} sessions`);
        return removedCount;
    }

    /**
     * Get filter statistics
     */
    function getFilterStats() {
        const stats = {
            isRunning: !!filterIntervalId,
            lastFilterTime: lastFilterTime,
            totalFilteredSessions: filteredSessionsCount,
            currentGenuineSessions: window.liveChatManager ? window.liveChatManager.chatSessions.size : 0
        };
        
        console.log('🔧 Auto Session Filter Stats:', stats);
        return stats;
    }

    /**
     * Initialize when DOM is ready
     */
    function initialize() {
        console.log('🔧 Auto Session Filter: Initializing...');
        
        // Wait for session managers to be available
        const checkSessionManager = setInterval(() => {
            if (window.liveChatManager || window.ChatSessionService) {
                clearInterval(checkSessionManager);
                const managerType = window.liveChatManager ? 'LiveChatManager' : 'ChatSessionService';
                console.log(`🔧 Auto Session Filter: ${managerType} detected, starting filtering`);
                startAutoFiltering();
            }
        }, 1000);

        // Auto-stop check after 30 seconds if no manager found
        setTimeout(() => {
            clearInterval(checkSessionManager);
            if (!window.liveChatManager && !window.ChatSessionService) {
                console.log('🔧 Auto Session Filter: No session manager found after 30s, stopping initialization');
            }
        }, 30000);

        // Expose global functions for manual control
        window.autoSessionFilter = {
            start: startAutoFiltering,
            stop: stopAutoFiltering,
            cleanup: manualCleanup,
            stats: getFilterStats,
            filter: applySessionFiltering,
            isTestSession: isTestSession,
            isAllowedDriverSession: isAllowedDriverSession
        };

        console.log('🔧 Auto Session Filter: Available via window.autoSessionFilter');
    }

    // Auto-initialize when script loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Also try immediate initialization for live injection
    setTimeout(initialize, 100);

})();

console.log('🔧 Auto Session Filter Script loaded - Will auto-filter test/mock sessions from live chat');
