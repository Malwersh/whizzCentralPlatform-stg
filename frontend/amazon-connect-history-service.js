// Amazon Connect Chat History Service
// Handles chat history storage, retrieval, and management using DynamoDB

class AmazonConnectHistoryService {
    constructor() {
        const cfg = (typeof window !== 'undefined' && window.WIZZCENTRAL_CONFIG) ? window.WIZZCENTRAL_CONFIG : {};
        this.apiBaseUrl = cfg.AMAZON_CONNECT_API_BASE_URL || cfg.API_BASE_URL || '';
        if (!this.apiBaseUrl) {
            throw new Error('Missing API base URL. Set window.__API_BASE_URL__ (or window.__AMAZON_CONNECT_API_BASE_URL__).');
        }
        if (String(this.apiBaseUrl).includes('/dev')) {
            throw new Error(`Refusing to use dev Amazon Connect API base URL in staging: ${this.apiBaseUrl}`);
        }
        this.initialized = false;
        this.historyCache = new Map();
    }

    async initialize() {
        if (this.initialized) return true;

        try {
            // Test API health
            const healthResponse = await fetch(`${this.apiBaseUrl}/health`);
            if (!healthResponse.ok) {
                throw new Error('Amazon Connect History API not available');
            }

            this.initialized = true;
            console.log('✅ Amazon Connect History Service initialized');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Amazon Connect History service:', error);
            return false;
        }
    }

    /**
     * Save chat message to history
     */
    async saveMessage(messageData) {
        try {
            await this.initialize();

            console.log('💾 Saving message to chat history:', messageData);

            const response = await fetch(`${this.apiBaseUrl}/chat/history/save-message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    contactId: messageData.contactId,
                    messageId: messageData.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    participantId: messageData.participantId,
                    participantToken: messageData.participantToken,
                    content: messageData.content,
                    senderType: messageData.senderType, // 'agent' | 'customer' | 'system'
                    senderName: messageData.senderName,
                    timestamp: messageData.timestamp || new Date().toISOString(),
                    messageType: messageData.messageType || 'text', // 'text' | 'file' | 'system'
                    fileAttachments: messageData.fileAttachments || [],
                    metadata: messageData.metadata || {}
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to save message: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Message saved to history successfully');

            // Update cache
            this.updateCacheWithMessage(messageData.contactId, result.message);

            return result;

        } catch (error) {
            console.error('❌ Failed to save message to history:', error);
            throw error;
        }
    }

    /**
     * Save complete chat session to history
     */
    async saveChatSession(sessionData) {
        try {
            await this.initialize();

            console.log('💾 Saving chat session to history:', sessionData.contactId);

            const response = await fetch(`${this.apiBaseUrl}/chat/history/save-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    contactId: sessionData.contactId,
                    participantId: sessionData.participantId,
                    customerInfo: sessionData.customerInfo,
                    agentInfo: sessionData.agentInfo || {},
                    startTime: sessionData.startTime,
                    endTime: sessionData.endTime || new Date().toISOString(),
                    duration: sessionData.duration || this.calculateDuration(sessionData.startTime, sessionData.endTime),
                    status: sessionData.status || 'completed',
                    resolution: sessionData.resolution || '',
                    tags: sessionData.tags || [],
                    rating: sessionData.rating || null,
                    feedback: sessionData.feedback || '',
                    totalMessages: sessionData.messages?.length || 0,
                    metadata: sessionData.metadata || {}
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to save chat session: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Chat session saved to history successfully');

            return result;

        } catch (error) {
            console.error('❌ Failed to save chat session to history:', error);
            throw error;
        }
    }

    /**
     * Retrieve chat history for a contact
     */
    async getChatHistory(contactId, options = {}) {
        try {
            await this.initialize();

            // Check cache first
            if (this.historyCache.has(contactId) && !options.forceRefresh) {
                console.log('📖 Returning cached chat history for:', contactId);
                return this.historyCache.get(contactId);
            }

            console.log('📖 Retrieving chat history for:', contactId);

            const queryParams = new URLSearchParams();
            if (options.limit) queryParams.append('limit', options.limit);
            if (options.startTime) queryParams.append('startTime', options.startTime);
            if (options.endTime) queryParams.append('endTime', options.endTime);

            const response = await fetch(`${this.apiBaseUrl}/chat/history/get-chat/${contactId}?${queryParams}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to retrieve chat history: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Chat history retrieved successfully');

            // Cache the result
            this.historyCache.set(contactId, result);

            return result;

        } catch (error) {
            console.error('❌ Failed to retrieve chat history:', error);
            throw error;
        }
    }

    /**
     * Search chat history
     */
    async searchChatHistory(searchParams) {
        try {
            await this.initialize();

            console.log('🔍 Searching chat history:', searchParams);

            const response = await fetch(`${this.apiBaseUrl}/chat/history/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    query: searchParams.query,
                    customerEmail: searchParams.customerEmail,
                    customerPhone: searchParams.customerPhone,
                    agentId: searchParams.agentId,
                    dateRange: searchParams.dateRange,
                    tags: searchParams.tags,
                    status: searchParams.status,
                    rating: searchParams.rating,
                    limit: searchParams.limit || 50,
                    offset: searchParams.offset || 0
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to search chat history: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Chat history search completed');

            return result;

        } catch (error) {
            console.error('❌ Failed to search chat history:', error);
            throw error;
        }
    }

    /**
     * Get customer chat history
     */
    async getCustomerHistory(customerIdentifier, identifierType = 'email') {
        try {
            await this.initialize();

            console.log('👤 Retrieving customer chat history:', { customerIdentifier, identifierType });

            const response = await fetch(`${this.apiBaseUrl}/chat/history/customer-history`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    customerIdentifier,
                    identifierType // 'email' | 'phone' | 'userId'
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to retrieve customer history: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Customer chat history retrieved successfully');

            return result;

        } catch (error) {
            console.error('❌ Failed to retrieve customer history:', error);
            throw error;
        }
    }

    /**
     * Export chat transcript
     */
    async exportChatTranscript(contactId, format = 'json') {
        try {
            await this.initialize();

            console.log('📄 Exporting chat transcript:', { contactId, format });

            const response = await fetch(`${this.apiBaseUrl}/chat/history/export-transcript`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    contactId,
                    format, // 'json' | 'html' | 'pdf' | 'txt'
                    includeMetadata: true,
                    includeAttachments: true
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to export transcript: ${response.status}`);
            }

            if (format === 'json') {
                const result = await response.json();
                return result;
            } else {
                // For other formats, return blob for download
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `chat-transcript-${contactId}.${format}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);

                console.log('✅ Chat transcript exported successfully');
                return { success: true, message: 'Transcript downloaded' };
            }

        } catch (error) {
            console.error('❌ Failed to export chat transcript:', error);
            throw error;
        }
    }

    /**
     * Add tags to chat session
     */
    async addChatTags(contactId, tags) {
        try {
            await this.initialize();

            console.log('🏷️ Adding tags to chat session:', { contactId, tags });

            const response = await fetch(`${this.apiBaseUrl}/chat/history/add-tags`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    contactId,
                    tags: Array.isArray(tags) ? tags : [tags]
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to add tags: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Tags added successfully');

            // Update cache
            this.invalidateCache(contactId);

            return result;

        } catch (error) {
            console.error('❌ Failed to add tags:', error);
            throw error;
        }
    }

    /**
     * Rate chat session
     */
    async rateChatSession(contactId, rating, feedback = '') {
        try {
            await this.initialize();

            console.log('⭐ Rating chat session:', { contactId, rating, feedback });

            const response = await fetch(`${this.apiBaseUrl}/chat/history/rate-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    contactId,
                    rating, // 1-5 stars
                    feedback,
                    ratedAt: new Date().toISOString()
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to rate session: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Session rated successfully');

            // Update cache
            this.invalidateCache(contactId);

            return result;

        } catch (error) {
            console.error('❌ Failed to rate session:', error);
            throw error;
        }
    }

    /**
     * Get chat analytics
     */
    async getChatAnalytics(dateRange = {}) {
        try {
            await this.initialize();

            console.log('📊 Retrieving chat analytics:', dateRange);

            const response = await fetch(`${this.apiBaseUrl}/chat/history/analytics`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    startDate: dateRange.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                    endDate: dateRange.endDate || new Date().toISOString(),
                    metrics: [
                        'totalChats',
                        'averageDuration',
                        'customerSatisfaction',
                        'resolutionRate',
                        'responseTime',
                        'agentPerformance'
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to retrieve analytics: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Chat analytics retrieved successfully');

            return result;

        } catch (error) {
            console.error('❌ Failed to retrieve chat analytics:', error);
            throw error;
        }
    }

    /**
     * Calculate duration between start and end time
     */
    calculateDuration(startTime, endTime) {
        if (!startTime || !endTime) return 0;

        const start = new Date(startTime);
        const end = new Date(endTime);
        return Math.round((end - start) / 1000); // Duration in seconds
    }

    /**
     * Format duration for display
     */
    formatDuration(seconds) {
        if (seconds < 60) {
            return `${seconds}s`;
        } else if (seconds < 3600) {
            return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        }
    }

    /**
     * Update cache with new message
     */
    updateCacheWithMessage(contactId, message) {
        const cached = this.historyCache.get(contactId);
        if (cached && cached.messages) {
            cached.messages.push(message);
            cached.lastUpdated = new Date().toISOString();
        }
    }

    /**
     * Invalidate cache for contact
     */
    invalidateCache(contactId) {
        this.historyCache.delete(contactId);
    }

    /**
     * Clear all cache
     */
    clearCache() {
        this.historyCache.clear();
    }

    /**
     * Get auth token
     */
    getAuthToken() {
        if (typeof window.Auth !== 'undefined' && window.Auth.getToken) {
            // Try to get access token first, then ID token as fallback
            return window.Auth.getToken('accessToken') ||
                window.Auth.getToken('idToken') ||
                sessionStorage.getItem('accessToken') ||
                sessionStorage.getItem('idToken');
        }

        // Fallback to direct session storage access
        return sessionStorage.getItem('accessToken') ||
            sessionStorage.getItem('idToken') ||
            localStorage.getItem('authToken');
    }

    /**
     * Create chat history UI component
     */
    createChatHistoryUI(containerElement) {
        const historyContainer = document.createElement('div');
        historyContainer.className = 'chat-history-container';
        historyContainer.innerHTML = `
            <div class="history-header">
                <h3>Chat History</h3>
                <div class="history-controls">
                    <input type="text" id="historySearch" placeholder="Search chats..." class="search-input">
                    <select id="historyFilter" class="filter-select">
                        <option value="all">All Chats</option>
                        <option value="today">Today</option>
                        <option value="week">This Week</option>
                        <option value="month">This Month</option>
                    </select>
                    <button id="exportHistory" class="btn-secondary">Export</button>
                </div>
            </div>
            <div class="history-list" id="historyList">
                <div class="loading">Loading chat history...</div>
            </div>
            <div class="history-pagination" id="historyPagination"></div>
        `;

        containerElement.appendChild(historyContainer);

        // Setup event listeners
        this.setupHistoryEventListeners(historyContainer);

        return historyContainer;
    }

    /**
     * Setup event listeners for history UI
     */
    setupHistoryEventListeners(container) {
        const searchInput = container.querySelector('#historySearch');
        const filterSelect = container.querySelector('#historyFilter');
        const exportBtn = container.querySelector('#exportHistory');

        if (searchInput) {
            searchInput.addEventListener('input', this.debounce((e) => {
                this.searchAndDisplayHistory(e.target.value, container);
            }, 300));
        }

        if (filterSelect) {
            filterSelect.addEventListener('change', (e) => {
                this.filterAndDisplayHistory(e.target.value, container);
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.showExportDialog();
            });
        }
    }

    /**
     * Debounce function for search
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Search and display history
     */
    async searchAndDisplayHistory(query, container) {
        try {
            const results = await this.searchChatHistory({ query });
            this.displayHistoryResults(results.chats, container);
        } catch (error) {
            console.error('Search failed:', error);
        }
    }

    /**
     * Filter and display history
     */
    async filterAndDisplayHistory(filter, container) {
        try {
            let dateRange = {};
            const now = new Date();

            switch (filter) {
                case 'today':
                    dateRange.startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
                    break;
                case 'week':
                    const weekStart = new Date(now);
                    weekStart.setDate(now.getDate() - now.getDay());
                    dateRange.startDate = weekStart.toISOString();
                    break;
                case 'month':
                    dateRange.startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                    break;
            }

            const results = await this.searchChatHistory(dateRange);
            this.displayHistoryResults(results.chats, container);
        } catch (error) {
            console.error('Filter failed:', error);
        }
    }

    /**
     * Display history results
     */
    displayHistoryResults(chats, container) {
        const listElement = container.querySelector('#historyList');
        if (!listElement) return;

        if (!chats || chats.length === 0) {
            listElement.innerHTML = '<div class="no-results">No chat history found</div>';
            return;
        }

        listElement.innerHTML = chats.map(chat => `
            <div class="history-item" data-contact-id="${chat.contactId}">
                <div class="chat-info">
                    <div class="customer-name">${chat.customerInfo?.name || 'Unknown Customer'}</div>
                    <div class="chat-date">${new Date(chat.startTime).toLocaleString()}</div>
                </div>
                <div class="chat-summary">
                    <div class="last-message">${chat.lastMessage || 'No messages'}</div>
                    <div class="chat-stats">
                        <span class="duration">${this.formatDuration(chat.duration || 0)}</span>
                        <span class="message-count">${chat.totalMessages || 0} messages</span>
                        ${chat.rating ? `<span class="rating">⭐ ${chat.rating}/5</span>` : ''}
                    </div>
                </div>
                <div class="chat-actions">
                    <button onclick="amazonConnectHistoryService.viewChatDetails('${chat.contactId}')" class="btn-view">View</button>
                    <button onclick="amazonConnectHistoryService.exportChatTranscript('${chat.contactId}', 'html')" class="btn-export">Export</button>
                </div>
            </div>
        `).join('');

        // Add click handlers
        listElement.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('btn-view') && !e.target.classList.contains('btn-export')) {
                    const contactId = item.dataset.contactId;
                    this.viewChatDetails(contactId);
                }
            });
        });
    }

    /**
     * View chat details
     */
    async viewChatDetails(contactId) {
        try {
            const history = await this.getChatHistory(contactId);
            this.showChatDetailsModal(history);
        } catch (error) {
            console.error('Failed to load chat details:', error);
        }
    }

    /**
     * Show chat details modal
     */
    showChatDetailsModal(chatData) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('chatDetailsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'chatDetailsModal';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Chat Details - ${chatData.contactId}</h3>
                    <button class="modal-close" onclick="this.closest('.modal').style.display='none'">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="chat-details">
                        <div class="details-section">
                            <h4>Session Information</h4>
                            <div class="details-grid">
                                <div class="detail-item">
                                    <label>Customer:</label>
                                    <span>${chatData.customerInfo?.name || 'Unknown'}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Email:</label>
                                    <span>${chatData.customerInfo?.email || 'N/A'}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Phone:</label>
                                    <span>${chatData.customerInfo?.phone || 'N/A'}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Start Time:</label>
                                    <span>${new Date(chatData.startTime).toLocaleString()}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Duration:</label>
                                    <span>${this.formatDuration(chatData.duration)}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Status:</label>
                                    <span class="status-badge status-${chatData.status}">${chatData.status}</span>
                                </div>
                            </div>
                        </div>
                        <div class="details-section">
                            <h4>Messages (${chatData.messages?.length || 0})</h4>
                            <div class="messages-container">
                                ${this.renderChatMessages(chatData.messages || [])}
                            </div>
                        </div>
                        ${chatData.tags?.length ? `
                            <div class="details-section">
                                <h4>Tags</h4>
                                <div class="tags-container">
                                    ${chatData.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="modal-footer">
                    <button onclick="amazonConnectHistoryService.exportChatTranscript('${chatData.contactId}', 'html')" class="btn-primary">Export Transcript</button>
                    <button onclick="this.closest('.modal').style.display='none'" class="btn-secondary">Close</button>
                </div>
            </div>
        `;

        modal.style.display = 'block';
    }

    /**
     * Render chat messages for details view
     */
    renderChatMessages(messages) {
        return messages.map(msg => `
            <div class="message-item ${msg.senderType}">
                <div class="message-header">
                    <span class="sender-name">${msg.senderName || msg.senderType}</span>
                    <span class="message-time">${new Date(msg.timestamp).toLocaleString()}</span>
                </div>
                <div class="message-content">${msg.content}</div>
                ${msg.fileAttachments?.length ? `
                    <div class="message-attachments">
                        ${msg.fileAttachments.map(file => `
                            <div class="attachment-item">
                                <i class="fas ${window.amazonConnectFileService?.getFileIcon(file.fileType) || 'fa-file'}"></i>
                                <span>${file.fileName}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');
    }

    /**
     * Show export dialog
     */
    showExportDialog() {
        // Implementation for export dialog
        if (typeof window.showMessage === 'function') {
            window.showMessage('Export feature will be implemented', 'info');
        }
    }
}

// Global instance
window.amazonConnectHistoryService = new AmazonConnectHistoryService();

// Export for CommonJS if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AmazonConnectHistoryService;
}

console.log('✅ Amazon Connect History Service loaded');
