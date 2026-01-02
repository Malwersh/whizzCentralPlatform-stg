// Amazon Connect Agent Management Service
// Handles agent routing, availability status, queue management, and workload distribution

class AmazonConnectAgentService {
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
        this.currentAgent = null;
        this.agentStatus = 'offline';
        this.activeChats = new Map();
        this.queuedChats = [];
        this.maxConcurrentChats = 5;
        this.routingConfig = {
            routingMethod: 'round_robin', // 'round_robin', 'least_busy', 'skill_based'
            autoAssign: true,
            skillBasedRouting: false,
            escalationRules: []
        };
        this.agentSkills = [];
        this.workloadMetrics = {
            totalChats: 0,
            averageResponseTime: 0,
            customerSatisfaction: 0,
            activeChatsCount: 0
        };
    }

    /**
     * Initialize agent service
     */
    async initialize(agentInfo = {}) {
        try {
            console.log('🎯 Initializing Amazon Connect Agent Management Service...');

            // Set current agent info
            this.currentAgent = {
                agentId: agentInfo.agentId || this.generateAgentId(),
                name: agentInfo.name || 'Support Agent',
                email: agentInfo.email || '',
                skills: agentInfo.skills || ['general_support'],
                department: agentInfo.department || 'customer_support',
                level: agentInfo.level || 'standard', // 'junior', 'standard', 'senior', 'supervisor'
                languages: agentInfo.languages || ['en'],
                maxConcurrentChats: agentInfo.maxConcurrentChats || 5,
                timezone: agentInfo.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
            };

            this.agentSkills = this.currentAgent.skills;
            this.maxConcurrentChats = this.currentAgent.maxConcurrentChats;

            // Test API connectivity
            const healthResponse = await fetch(`${this.apiBaseUrl}/health`);
            if (!healthResponse.ok) {
                throw new Error('Agent Management API not available');
            }

            // Register agent
            await this.registerAgent();

            // Initialize routing and queue management
            await this.initializeRouting();

            // Start periodic updates
            this.startPeriodicUpdates();

            this.initialized = true;
            console.log('✅ Amazon Connect Agent Management Service initialized');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Agent Management service:', error);
            return false;
        }
    }

    /**
     * Register agent with the system
     */
    async registerAgent() {
        try {
            console.log('📝 Registering agent with Amazon Connect:', this.currentAgent);

            const response = await fetch(`${this.apiBaseUrl}/agents/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    ...this.currentAgent,
                    registeredAt: new Date().toISOString(),
                    status: 'offline'
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to register agent: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Agent registered successfully:', result);

            // Update agent info with server response
            if (result.agent) {
                this.currentAgent = { ...this.currentAgent, ...result.agent };
            }

            return result;

        } catch (error) {
            console.error('❌ Failed to register agent:', error);
            throw error;
        }
    }

    /**
     * Update agent availability status
     */
    async updateAgentStatus(status, reason = '') {
        try {
            const validStatuses = ['available', 'busy', 'away', 'offline', 'break', 'training'];

            if (!validStatuses.includes(status)) {
                throw new Error(`Invalid status: ${status}. Valid statuses: ${validStatuses.join(', ')}`);
            }

            console.log(`👤 Updating agent status to: ${status}`);

            const response = await fetch(`${this.apiBaseUrl}/agents/${this.currentAgent.agentId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    status,
                    reason,
                    timestamp: new Date().toISOString(),
                    activeChats: this.activeChats.size
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to update agent status: ${response.status}`);
            }

            const result = await response.json();
            this.agentStatus = status;

            // Update UI
            this.updateAgentStatusUI(status);

            // Handle status-specific logic
            await this.handleStatusChange(status);

            console.log('✅ Agent status updated successfully');
            return result;

        } catch (error) {
            console.error('❌ Failed to update agent status:', error);
            throw error;
        }
    }

    /**
     * Handle status change logic
     */
    async handleStatusChange(newStatus) {
        switch (newStatus) {
            case 'available':
                // Check for queued chats to assign
                await this.processQueuedChats();
                break;

            case 'offline':
                // Transfer active chats to other agents
                await this.transferActiveChats();
                break;

            case 'break':
            case 'training':
                // Pause new chat assignments
                await this.pauseChatAssignments();
                break;

            case 'busy':
                // Stop accepting new chats but keep active ones
                break;
        }
    }

    /**
     * Get available agents for routing
     */
    async getAvailableAgents(skillRequirements = []) {
        try {
            console.log('🔍 Getting available agents for routing...');

            const queryParams = new URLSearchParams();
            if (skillRequirements.length > 0) {
                queryParams.append('skills', skillRequirements.join(','));
            }

            const response = await fetch(`${this.apiBaseUrl}/agents/available?${queryParams}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get available agents: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Available agents retrieved:', result.agents?.length || 0);

            return result.agents || [];

        } catch (error) {
            console.error('❌ Failed to get available agents:', error);
            throw error;
        }
    }

    /**
     * Route chat to best available agent
     */
    async routeChat(chatRequest) {
        try {
            console.log('🎯 Routing chat request:', chatRequest);

            const routingRequest = {
                contactId: chatRequest.contactId,
                customerInfo: chatRequest.customerInfo,
                priority: chatRequest.priority || 'normal',
                skillRequirements: chatRequest.skillRequirements || ['general_support'],
                language: chatRequest.language || 'en',
                routingMethod: this.routingConfig.routingMethod,
                requestedAgent: chatRequest.requestedAgent || null
            };

            const response = await fetch(`${this.apiBaseUrl}/routing/route-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify(routingRequest)
            });

            if (!response.ok) {
                throw new Error(`Failed to route chat: ${response.status}`);
            }

            const result = await response.json();

            if (result.assignedAgent) {
                console.log('✅ Chat routed successfully to agent:', result.assignedAgent.agentId);

                // If assigned to current agent, accept the chat
                if (result.assignedAgent.agentId === this.currentAgent.agentId) {
                    await this.acceptChat(chatRequest.contactId);
                }
            } else {
                console.log('⏳ Chat added to queue - no available agents');
                this.addChatToQueue(chatRequest);
            }

            return result;

        } catch (error) {
            console.error('❌ Failed to route chat:', error);
            throw error;
        }
    }

    /**
     * Accept incoming chat
     */
    async acceptChat(contactId) {
        try {
            console.log('✅ Accepting chat:', contactId);

            // Check capacity
            if (this.activeChats.size >= this.maxConcurrentChats) {
                throw new Error('Agent at maximum chat capacity');
            }

            const response = await fetch(`${this.apiBaseUrl}/agents/${this.currentAgent.agentId}/accept-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    contactId,
                    acceptedAt: new Date().toISOString()
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to accept chat: ${response.status}`);
            }

            const result = await response.json();

            // Add to active chats
            this.activeChats.set(contactId, {
                contactId,
                acceptedAt: new Date(),
                status: 'active',
                customerInfo: result.customerInfo || {}
            });

            // Update workload metrics
            this.updateWorkloadMetrics();

            // Update UI
            this.updateActiveChatsList();

            console.log('✅ Chat accepted successfully');
            return result;

        } catch (error) {
            console.error('❌ Failed to accept chat:', error);
            throw error;
        }
    }

    /**
     * Transfer chat to another agent
     */
    async transferChat(contactId, targetAgentId, reason = '') {
        try {
            console.log('🔄 Transferring chat:', { contactId, targetAgentId, reason });

            const response = await fetch(`${this.apiBaseUrl}/agents/transfer-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    contactId,
                    fromAgentId: this.currentAgent.agentId,
                    toAgentId: targetAgentId,
                    reason,
                    transferredAt: new Date().toISOString()
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to transfer chat: ${response.status}`);
            }

            const result = await response.json();

            // Remove from active chats
            this.activeChats.delete(contactId);

            // Update UI
            this.updateActiveChatsList();
            this.updateWorkloadMetrics();

            console.log('✅ Chat transferred successfully');
            return result;

        } catch (error) {
            console.error('❌ Failed to transfer chat:', error);
            throw error;
        }
    }

    /**
     * End chat session
     */
    async endChat(contactId, resolution = '', customerSatisfied = null) {
        try {
            console.log('🔚 Ending chat session:', contactId);

            const response = await fetch(`${this.apiBaseUrl}/agents/${this.currentAgent.agentId}/end-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    contactId,
                    resolution,
                    customerSatisfied,
                    endedAt: new Date().toISOString(),
                    duration: this.getChatDuration(contactId)
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to end chat: ${response.status}`);
            }

            const result = await response.json();

            // Remove from active chats
            this.activeChats.delete(contactId);

            // Update metrics
            this.workloadMetrics.totalChats++;
            this.updateWorkloadMetrics();

            // Update UI
            this.updateActiveChatsList();

            console.log('✅ Chat ended successfully');
            return result;

        } catch (error) {
            console.error('❌ Failed to end chat:', error);
            throw error;
        }
    }

    /**
     * Get current queue status
     */
    async getQueueStatus() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/queue/status`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get queue status: ${response.status}`);
            }

            const result = await response.json();
            this.queuedChats = result.queuedChats || [];

            // Update UI
            this.updateQueueStatusUI(result);

            return result;

        } catch (error) {
            console.error('❌ Failed to get queue status:', error);
            throw error;
        }
    }

    /**
     * Process queued chats for assignment
     */
    async processQueuedChats() {
        if (this.agentStatus !== 'available' || this.activeChats.size >= this.maxConcurrentChats) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/queue/assign-next`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    agentId: this.currentAgent.agentId,
                    skills: this.agentSkills,
                    maxChats: this.maxConcurrentChats - this.activeChats.size
                })
            });

            if (response.ok) {
                const result = await response.json();
                if (result.assignedChats) {
                    for (const chat of result.assignedChats) {
                        await this.acceptChat(chat.contactId);
                    }
                }
            }

        } catch (error) {
            console.error('❌ Failed to process queued chats:', error);
        }
    }

    /**
     * Add chat to queue
     */
    addChatToQueue(chatRequest) {
        this.queuedChats.push({
            ...chatRequest,
            queuedAt: new Date(),
            priority: chatRequest.priority || 'normal'
        });

        // Sort by priority and queue time
        this.queuedChats.sort((a, b) => {
            const priorityOrder = { 'high': 0, 'normal': 1, 'low': 2 };
            const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
            if (priorityDiff !== 0) return priorityDiff;
            return new Date(a.queuedAt) - new Date(b.queuedAt);
        });

        this.updateQueueStatusUI({ queuedChats: this.queuedChats });
    }

    /**
     * Transfer all active chats to other agents
     */
    async transferActiveChats() {
        const transferPromises = Array.from(this.activeChats.keys()).map(contactId => {
            return this.transferChat(contactId, null, 'Agent going offline');
        });

        try {
            await Promise.all(transferPromises);
            console.log('✅ All active chats transferred');
        } catch (error) {
            console.error('❌ Failed to transfer some chats:', error);
        }
    }

    /**
     * Pause new chat assignments
     */
    async pauseChatAssignments() {
        try {
            await fetch(`${this.apiBaseUrl}/agents/${this.currentAgent.agentId}/pause-assignments`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });
            console.log('⏸️ Chat assignments paused');
        } catch (error) {
            console.error('❌ Failed to pause assignments:', error);
        }
    }

    /**
     * Get chat duration
     */
    getChatDuration(contactId) {
        const chat = this.activeChats.get(contactId);
        if (chat && chat.acceptedAt) {
            return Math.round((new Date() - chat.acceptedAt) / 1000);
        }
        return 0;
    }

    /**
     * Update workload metrics
     */
    updateWorkloadMetrics() {
        this.workloadMetrics.activeChatsCount = this.activeChats.size;

        // Calculate average response time (mock calculation)
        // In real implementation, this would be calculated from actual response data
        this.workloadMetrics.averageResponseTime = this.activeChats.size > 0 ?
            30 + (this.activeChats.size * 10) : 0;

        // Update UI
        this.updateMetricsUI();
    }

    /**
     * Update agent status UI
     */
    updateAgentStatusUI(status) {
        const statusElements = document.querySelectorAll('.agent-status-indicator');
        statusElements.forEach(element => {
            element.className = `agent-status-indicator ${status}`;
            element.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        });

        const statusSelect = document.getElementById('agentStatusSelect');
        if (statusSelect) {
            statusSelect.value = status;
        }
    }

    /**
     * Update active chats list UI
     */
    updateActiveChatsList() {
        const chatsList = document.getElementById('activechatsList');
        if (!chatsList) return;

        if (this.activeChats.size === 0) {
            chatsList.innerHTML = '<div class="no-active-chats">No active chats</div>';
            return;
        }

        chatsList.innerHTML = Array.from(this.activeChats.values()).map(chat => `
            <div class="active-chat-item" data-contact-id="${chat.contactId}">
                <div class="chat-info">
                    <div class="customer-name">${chat.customerInfo.name || 'Customer'}</div>
                    <div class="chat-duration">${this.formatDuration(this.getChatDuration(chat.contactId))}</div>
                </div>
                <div class="chat-actions">
                    <button onclick="amazonConnectAgentService.openChat('${chat.contactId}')" class="btn-open">Open</button>
                    <button onclick="amazonConnectAgentService.showTransferDialog('${chat.contactId}')" class="btn-transfer">Transfer</button>
                    <button onclick="amazonConnectAgentService.endChat('${chat.contactId}')" class="btn-end">End</button>
                </div>
            </div>
        `).join('');
    }

    /**
     * Update queue status UI
     */
    updateQueueStatusUI(queueData) {
        const queueCount = document.getElementById('queueCount');
        if (queueCount) {
            queueCount.textContent = queueData.queuedChats?.length || 0;
        }

        const queueList = document.getElementById('queuedChatsList');
        if (queueList && queueData.queuedChats) {
            queueList.innerHTML = queueData.queuedChats.map(chat => `
                <div class="queued-chat-item" data-contact-id="${chat.contactId}">
                    <div class="chat-info">
                        <div class="customer-name">${chat.customerInfo?.name || 'Customer'}</div>
                        <div class="queue-time">Waiting: ${this.formatDuration(Math.round((new Date() - new Date(chat.queuedAt)) / 1000))}</div>
                    </div>
                    <div class="chat-priority priority-${chat.priority}">
                        ${chat.priority.toUpperCase()}
                    </div>
                </div>
            `).join('');
        }
    }

    /**
     * Update metrics UI
     */
    updateMetricsUI() {
        const metricsElements = {
            activeChats: document.getElementById('activeChatsCount'),
            totalChats: document.getElementById('totalChatsCount'),
            avgResponseTime: document.getElementById('avgResponseTime'),
            satisfaction: document.getElementById('customerSatisfaction')
        };

        if (metricsElements.activeChats) {
            metricsElements.activeChats.textContent = this.workloadMetrics.activeChatsCount;
        }
        if (metricsElements.totalChats) {
            metricsElements.totalChats.textContent = this.workloadMetrics.totalChats;
        }
        if (metricsElements.avgResponseTime) {
            metricsElements.avgResponseTime.textContent = `${this.workloadMetrics.averageResponseTime}s`;
        }
        if (metricsElements.satisfaction) {
            metricsElements.satisfaction.textContent = `${this.workloadMetrics.customerSatisfaction}%`;
        }
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
     * Generate agent ID
     */
    generateAgentId() {
        return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Start periodic updates
     */
    startPeriodicUpdates() {
        // Update queue status every 30 seconds
        setInterval(() => {
            if (this.agentStatus === 'available') {
                this.getQueueStatus();
                this.processQueuedChats();
            }
        }, 30000);

        // Update metrics every 60 seconds
        setInterval(() => {
            this.updateWorkloadMetrics();
        }, 60000);
    }

    /**
     * Initialize routing configuration
     */
    async initializeRouting() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/routing/config`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (response.ok) {
                const config = await response.json();
                this.routingConfig = { ...this.routingConfig, ...config };
                console.log('✅ Routing configuration loaded');
            }
        } catch (error) {
            console.warn('⚠️ Could not load routing configuration, using defaults');
        }
    }

    /**
     * Open chat interface
     */
    openChat(contactId) {
        // This would integrate with your existing chat UI
        console.log('📱 Opening chat interface for:', contactId);

        // Emit event for UI to handle
        const event = new CustomEvent('amazon-connect-open-chat', {
            detail: { contactId }
        });
        window.dispatchEvent(event);
    }

    /**
     * Show transfer dialog
     */
    showTransferDialog(contactId) {
        // This would show a modal to select target agent
        console.log('🔄 Showing transfer dialog for:', contactId);

        // Simple implementation - in real app this would be a proper modal
        const targetAgent = prompt('Enter target agent ID:');
        if (targetAgent) {
            this.transferChat(contactId, targetAgent, 'Manual transfer');
        }
    }

    /**
     * Get authentication token
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
     * Create agent dashboard UI
     */
    createAgentDashboard(containerElement) {
        const dashboard = document.createElement('div');
        dashboard.className = 'agent-dashboard';
        dashboard.innerHTML = `
            <div class="dashboard-header">
                <h3>Agent Dashboard</h3>
                <div class="agent-controls">
                    <select id="agentStatusSelect" onchange="amazonConnectAgentService.updateAgentStatus(this.value)">
                        <option value="offline">Offline</option>
                        <option value="available">Available</option>
                        <option value="busy">Busy</option>
                        <option value="away">Away</option>
                        <option value="break">Break</option>
                        <option value="training">Training</option>
                    </select>
                    <div class="agent-status-indicator offline">Offline</div>
                </div>
            </div>
            
            <div class="dashboard-metrics">
                <div class="metric-item">
                    <label>Active Chats:</label>
                    <span id="activeChatsCount">0</span>
                </div>
                <div class="metric-item">
                    <label>Total Chats Today:</label>
                    <span id="totalChatsCount">0</span>
                </div>
                <div class="metric-item">
                    <label>Avg Response Time:</label>
                    <span id="avgResponseTime">0s</span>
                </div>
                <div class="metric-item">
                    <label>Queue:</label>
                    <span id="queueCount">0</span>
                </div>
            </div>

            <div class="dashboard-sections">
                <div class="section active-chats">
                    <h4>Active Chats</h4>
                    <div id="activechatsList" class="chats-list">
                        <div class="no-active-chats">No active chats</div>
                    </div>
                </div>

                <div class="section queued-chats">
                    <h4>Queue</h4>
                    <div id="queuedChatsList" class="chats-list">
                        <div class="no-queued-chats">No chats in queue</div>
                    </div>
                </div>
            </div>
        `;

        containerElement.appendChild(dashboard);
        return dashboard;
    }

    /**
     * Cleanup and disconnect
     */
    async disconnect() {
        try {
            // Set status to offline
            await this.updateAgentStatus('offline');

            // Transfer active chats
            await this.transferActiveChats();

            console.log('🔌 Agent service disconnected');

        } catch (error) {
            console.error('❌ Error during disconnect:', error);
        }
    }
}

// Global instance
window.amazonConnectAgentService = new AmazonConnectAgentService();

// Export for CommonJS if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AmazonConnectAgentService;
}

console.log('✅ Amazon Connect Agent Service loaded');
