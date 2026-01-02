// Support Management JavaScript

// Centralize auth check using our Auth utilities instead of Amplify getCurrentUser
// This avoids module import issues and keeps redirects consistent with returnUrl + telemetry.

// Listen for global WebSocket ready event
window.addEventListener('websocket-ready', (event) => {
    console.log('🎉 Global WebSocket manager ready for live chat');
    const { manager, businessId } = event.detail;

    // Use the globally initialized WebSocket manager for live chat
    if (!wsManager) {
        wsManager = manager;
        setupLiveChatHandlers();

        // Update live chat state to show WebSocket is available
        liveChatState.isConnected = true;
        updateConnectionStatus('Connected', 'online');

        console.log('✅ Live chat WebSocket integration complete');
    }
});

// Initialize support page
document.addEventListener('DOMContentLoaded', async function () {
    try {
        if (window.Auth && !window.Auth.requireAuthentication()) {
            // Auth utility will handle redirect
            return;
        }
        // Optionally initialize AWS (not strictly required for support demo, but keeps consistency)
        if (window.AWSUtils && typeof window.AWSUtils.initialize === 'function') {
            try { await window.AWSUtils.initialize(); } catch (e) { console.warn('AWS init skipped on support page:', e?.message || e); }
        }
    } catch (e) {
        console.warn('Support page auth/AWS init check failed:', e);
    }

    initializeSupportPage();
    setupEventListeners();
    applyRoleGating();
});

// Support data - will be loaded from real tables
let tickets = [];
let faqs = [];
let articles = [];
// >>> Phase B Delegation Shim (Ticket modules integration)
(function (window) {
    if (window.__ticketPhaseBShimApplied) return; // prevent double application
    window.__ticketPhaseBShimApplied = true;
    const orig = {
        loadSampleTickets: window.loadSampleTickets,
        renderTicketsTable: window.renderTicketsTable,
        filterTickets: window.filterTickets,
        updateSupportStats: window.updateSupportStats
    };
    function ready() { return window.TicketService && window.TicketUI; }
    window.loadSampleTickets = function () {
        if (ready()) return window.TicketService.loadSampleTickets();
        return orig.loadSampleTickets && orig.loadSampleTickets.apply(this, arguments);
    };
    window.renderTicketsTable = function (list) {
        if (ready()) return window.TicketUI.render();
        return orig.renderTicketsTable && orig.renderTicketsTable.apply(this, arguments);
    };
    window.filterTickets = function () {
        if (ready()) return window.TicketUI.render();
        return orig.filterTickets && orig.filterTickets.apply(this, arguments);
    };
    window.updateSupportStats = function () {
        if (ready()) {
            const t = window.TicketService.getTickets();
            const openTickets = t.filter(ticket => {
                const status = ticket.status || ticket.ticketStatus;
                return status === 'open' || status === 'new' || status === 'pending';
            }).length;
            const resolvedToday = t.filter(ticket => {
                const status = ticket.status || ticket.ticketStatus;
                const createdDate = ticket.createdAt || ticket.created;
                const isToday = createdDate && new Date(createdDate).toDateString() === new Date().toDateString();
                return (status === 'resolved' || status === 'closed') && isToday;
            }).length;
            console.log('Support Stats:', { openTickets, resolvedToday, totalTickets: t.length });
            return;
        }
        return orig.updateSupportStats && orig.updateSupportStats.apply(this, arguments);
    };
})(window);

function initializeSupportPage() {
    console.log('🚀 Initializing Support Page...');
    loadSupportData();
    loadSampleTickets(); // Add sample tickets for demo
    renderTicketsTable();
    updateSupportStats();
    console.log('✅ Support Page initialized with', tickets.length, 'tickets');
}

// Load sample tickets for demonstration
function loadSampleTickets() {
    tickets = [
        {
            id: 'TKT001',
            customer: {
                name: 'John Smith',
                email: 'john.smith@email.com',
                avatar: 'https://i.pravatar.cc/40?img=1'
            },
            subject: 'Order delivery delay',
            category: 'delivery',
            priority: 'high',
            status: 'open',
            assignedTo: 'Lisa Support',
            created: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
            description: 'My order #12345 was supposed to arrive 2 hours ago but I haven\'t received it yet. Can you please check the status?'
        },
        {
            id: 'TKT002',
            customer: {
                name: 'Sarah Johnson',
                email: 'sarah.j@email.com',
                avatar: 'https://i.pravatar.cc/40?img=2'
            },
            subject: 'Payment issue with credit card',
            category: 'payment',
            priority: 'medium',
            status: 'in_progress',
            assignedTo: 'John Support',
            created: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
            description: 'I\'m having trouble adding my credit card to the payment methods. It keeps showing an error message.'
        },
        {
            id: 'TKT003',
            customer: {
                name: 'Mike Wilson',
                email: 'mike.wilson@email.com',
                avatar: 'https://i.pravatar.cc/40?img=3'
            },
            subject: 'App crash on iOS',
            category: 'app',
            priority: 'high',
            status: 'resolved',
            assignedTo: 'Tom Support',
            created: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
            description: 'The app keeps crashing when I try to place an order. I\'m using iPhone 13 with iOS 16.2.'
        },
        {
            id: 'TKT004',
            customer: {
                name: 'Emma Davis',
                email: 'emma.davis@email.com',
                avatar: 'https://i.pravatar.cc/40?img=4'
            },
            subject: 'Account verification problem',
            category: 'account',
            priority: 'medium',
            status: 'open',
            assignedTo: 'Unassigned',
            created: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
            description: 'I\'ve uploaded my documents for verification but the status hasn\'t changed. How long does verification usually take?'
        }
    ];
}

async function loadSupportData() {
    try {
        // Initialize data service
        if (window.dataService) {
            await window.dataService.initialize();

            // Load support tickets from real table
            const supportTickets = await window.dataService.getSupportTickets();

            if (supportTickets && supportTickets.length > 0) {
                // Convert DynamoDB format to UI format
                tickets = supportTickets.map(convertDynamoDBTicketToUIFormat);
                console.log('✅ Loaded support tickets from DynamoDB:', tickets.length);
            } else {
                console.log('📋 No existing tickets found in DynamoDB, keeping sample tickets');
                // Keep the sample tickets that were loaded in loadSampleTickets()
            }

            // Re-render after data loads
            renderTicketsTable();
            updateSupportStats();
        }
    } catch (error) {
        console.error('❌ Error loading support data:', error);
        console.log('📋 Using sample tickets due to loading error');
        // Keep sample tickets if loading fails
    }
}

// Convert DynamoDB item format to UI format
function convertDynamoDBTicketToUIFormat(dynamoItem) {
    // Handle both DynamoDB attribute format and plain object format
    const getValue = (field) => {
        if (!field) return '';
        return field.S || field.N || field || '';
    };

    return {
        id: getValue(dynamoItem.ticketId) || getValue(dynamoItem.id) || 'Unknown',
        customer: {
            name: getValue(dynamoItem.customerName) || 'Unknown Customer',
            email: getValue(dynamoItem.customerEmail) || 'No email',
            avatar: `https://i.pravatar.cc/40?img=${Math.floor(Math.random() * 20) + 1}`
        },
        subject: getValue(dynamoItem.subject) || 'No subject',
        category: getValue(dynamoItem.category) || 'general',
        priority: getValue(dynamoItem.priority) || 'medium',
        status: getValue(dynamoItem.status) || 'open',
        assignedTo: getValue(dynamoItem.assignedTo) || 'Unassigned',
        created: getValue(dynamoItem.createdAt) || getValue(dynamoItem.created) || new Date().toISOString(),
        description: getValue(dynamoItem.description) || 'No description'
    };
}

function setupEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', filterTickets);
    }

    // Filter functionality
    const statusFilter = document.getElementById('statusFilter');
    const priorityFilter = document.getElementById('priorityFilter');
    const categoryFilter = document.getElementById('categoryFilter');

    if (statusFilter) statusFilter.addEventListener('change', filterTickets);
    if (priorityFilter) statusFilter.addEventListener('change', filterTickets);
    if (categoryFilter) statusFilter.addEventListener('change', filterTickets);

    // New ticket form
    const newTicketForm = document.getElementById('newTicketForm');
    if (newTicketForm) {
        newTicketForm.addEventListener('submit', handleNewTicket);
    }
}

// Refresh tickets from database
async function refreshTicketsFromDatabase() {
    try {
        console.log('🔄 Refreshing tickets from DynamoDB...');

        // Show loading state
        const refreshBtn = document.querySelector('[onclick="refreshTicketsFromDatabase()"]');
        if (refreshBtn) {
            const originalText = refreshBtn.innerHTML;
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            refreshBtn.disabled = true;

            // Restore button after loading
            setTimeout(() => {
                refreshBtn.innerHTML = originalText;
                refreshBtn.disabled = false;
            }, 2000);
        }

        await loadSupportData();

        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification('✅ Tickets refreshed from database', 'success');
        } else {
            console.log('✅ Tickets refreshed from database');
        }
    } catch (error) {
        console.error('❌ Error refreshing tickets:', error);
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification('❌ Failed to refresh tickets', 'error');
        }
    }
}

// Add helper to inject Amazon Connect Agent Banner if missing (for CCP status display)
function injectAgentBannerIfMissing() {
    try {
        const livechatTab = document.getElementById('livechatTab');
        if (!livechatTab) return;
        if (!document.getElementById('connectAgentBanner')) {
            const banner = document.createElement('div');
            banner.id = 'connectAgentBanner';
            banner.className = 'agent-banner initializing';
            banner.className = 'agent-banner';
            banner.innerHTML = '<span class="agent-status-icon">⏳</span><strong style="font-weight:600;">Amazon Connect:</strong> <span id="ccpStatusText">Initializing…</span> <span class="flex-spacer"></span><button id="openCcpBtn" class="ccp-open-btn">Open CCP</button>';
            livechatTab.prepend(banner);
            const openBtn = banner.querySelector('#openCcpBtn');
            if (openBtn) {
                openBtn.addEventListener('click', () => {
                    if (window.CONNECT_CCP_URL) {
                        window.open(window.CONNECT_CCP_URL, '_blank', 'noopener');
                    } else {
                        alert('CCP URL not configured yet.');
                    }
                });
            }
        }
    } catch (e) {
        console.warn('Failed to inject agent banner:', e);
    }
}

// Tab switching functionality
function switchTab(tabName) {
    try {
        console.log(`🧭 switchTab invoked for: ${tabName}`);
        const allTabButtons = document.querySelectorAll('.tab-btn');
        const allTabContents = document.querySelectorAll('.tab-content');

        // Remove active + hide all contents explicitly
        allTabButtons.forEach(btn => btn.classList.remove('active'));
        allTabContents.forEach(c => {
            c.classList.remove('active');
            // Explicitly hide to avoid CSS specificity issues
            c.style.display = 'none';
        });

        // Activate matching tab button (robust selector)
        const activeTabBtn = Array.from(allTabButtons).find(btn => {
            const onclickVal = btn.getAttribute('onclick') || '';
            return onclickVal.includes(`switchTab('${tabName}')`) || onclickVal.includes(`switchTab(\"${tabName}\")`);
        });
        if (activeTabBtn) {
            activeTabBtn.classList.add('active');
        } else {
            console.warn('⚠️ Could not find tab button for', tabName);
        }

        // Show corresponding content
        const tabContentId = `${tabName}Tab`;
        const tabContent = document.getElementById(tabContentId);
        if (tabContent) {
            tabContent.classList.add('active');
            tabContent.style.display = 'block';
        } else {
            console.error('❌ Tab content not found for id:', tabContentId);
        }

        // Feature-specific initialization
        if (tabName === 'livechat') {
            injectAgentBannerIfMissing();
            if (!window.ccpInitialized && typeof initializeLiveChat === 'function') {
                console.log('🟢 Initializing Live Chat / CCP...');
                try { initializeLiveChat(); } catch (e) { console.error('LiveChat init error', e); }
            }
            if (typeof initializeDynamoDBQuery === 'function') {
                try { initializeDynamoDBQuery(); } catch (e) { console.error('DynamoDB query UI init error', e); }
            }
        }

        // Update pagination / status text
        const paginationInfo = document.querySelector('.pagination-info');
        if (paginationInfo) {
            switch (tabName) {
                case 'tickets': {
                    const ticketCount = tickets.length;
                    const displayCount = Math.min(10, ticketCount);
                    paginationInfo.textContent = ticketCount > 0 ? `Showing 1-${displayCount} of ${ticketCount} tickets` : 'No tickets available';
                    break;
                }
                case 'livechat':
                    paginationInfo.textContent = 'Live Chat Support Dashboard';
                    break;
                case 'faq': {
                    const faqCount = faqs.length;
                    const displayFaqCount = Math.min(10, faqCount);
                    paginationInfo.textContent = faqCount > 0 ? `Showing 1-${displayFaqCount} of ${faqCount} FAQs` : 'No FAQs available';
                    break;
                }
                case 'knowledge': {
                    const articleCount = articles.length;
                    const displayArticleCount = Math.min(6, articleCount);
                    paginationInfo.textContent = articleCount > 0 ? `Showing 1-${displayArticleCount} of ${articleCount} articles` : 'No articles available';
                    break;
                }
            }
        }
    } catch (err) {
        console.error('❌ switchTab fatal error:', err);
    }
}

// Expose to global (ensure overrides any legacy definition)
window.switchTab = switchTab;

// Ensure default tab visibility after DOM ready (in case CSS conflicts hide others)
document.addEventListener('DOMContentLoaded', () => {
    // Normalize initial state
    const activeContent = document.querySelector('.tab-content.active');
    if (activeContent) activeContent.style.display = 'block';
    // Safety: if none active, activate tickets
    if (!activeContent) {
        switchTab('tickets');
    }
});

function renderTicketsTable(ticketsList = tickets) {
    const tbody = document.getElementById('ticketsTableBody');
    if (!tbody) return;

    // Handle empty state
    if (!ticketsList || ticketsList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="tickets-empty-state">
                    <div style="font-size: 48px; margin-bottom: 16px;">
                        <i class="fas fa-ticket-alt tickets-empty-icon"></i>
                    </div>
                    <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">No Support Tickets</div>
                    <div style="font-size: 14px;">No support tickets have been created yet.</div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = ticketsList.map(ticket => {
        // Map real DynamoDB structure to expected format
        const mappedTicket = {
            id: ticket.ticketId || ticket.id || 'N/A',
            customer: {
                name: ticket.customerName || ticket.customer?.name || 'Unknown Customer',
                email: ticket.customerEmail || ticket.customer?.email || 'No email',
                avatar: ticket.customer?.avatar || 'https://i.pravatar.cc/40?img=1'
            },
            subject: ticket.subject || ticket.title || 'No subject',
            category: ticket.category || 'general',
            priority: ticket.priority || 'medium',
            status: ticket.status || 'open',
            assignedTo: ticket.assignedTo || ticket.assignee || 'Unassigned',
            created: ticket.createdAt || ticket.created || new Date().toISOString(),
            description: ticket.description || ticket.message || ''
        };

        return `
            <tr>
                <td>#${mappedTicket.id}</td>
                <td>
                    <div class="customer-info">
                        <div class="customer-avatar">
                            <img src="${mappedTicket.customer.avatar}" alt="${mappedTicket.customer.name}">
                        </div>
                        <div>
                            <div class="customer-name">${mappedTicket.customer.name}</div>
                            <div class="customer-email">${mappedTicket.customer.email}</div>
                        </div>
                    </div>
                </td>
                <td>${mappedTicket.subject}</td>
                <td><span class="category-badge ${mappedTicket.category}">${getCategoryName(mappedTicket.category)}</span></td>
                <td><span class="priority-badge ${mappedTicket.priority}">${capitalizeFirst(mappedTicket.priority)}</span></td>
                <td><span class="status-badge ${mappedTicket.status}">${getStatusName(mappedTicket.status)}</span></td>
                <td>${mappedTicket.assignedTo}</td>
                <td>${formatDate(mappedTicket.created)}</td>
                <td>
                    <div class="actions">
                        <button class="btn-action" onclick="viewTicket('${mappedTicket.id}')" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-action" onclick="assignTicket('${mappedTicket.id}')" title="Assign">
                            <i class="fas fa-user-plus"></i>
                        </button>
                        <button class="btn-action" onclick="resolveTicket('${mappedTicket.id}')" title="Resolve">
                            <i class="fas fa-check"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function getCategoryName(category) {
    const categories = {
        'order': 'Order Issues',
        'payment': 'Payment',
        'delivery': 'Delivery',
        'app': 'App Issues',
        'account': 'Account'
    };
    return categories[category] || category;
}

function getStatusName(status) {
    const statuses = {
        'open': 'Open',
        'in-progress': 'In Progress',
        'resolved': 'Resolved',
        'closed': 'Closed'
    };
    return statuses[status] || status;
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';

    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 60) {
            return diffMins <= 1 ? 'Just now' : `${diffMins} minutes ago`;
        } else if (diffHours < 24) {
            return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
        } else if (diffDays < 7) {
            return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    } catch (error) {
        return dateString;
    }
}

function filterTickets() {
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const priorityFilter = document.getElementById('priorityFilter')?.value || '';
    const categoryFilter = document.getElementById('categoryFilter')?.value || '';

    let filteredTickets = tickets.filter(ticket => {
        const matchesSearch = ticket.customer.name.toLowerCase().includes(searchTerm) ||
            ticket.customer.email.toLowerCase().includes(searchTerm) ||
            ticket.subject.toLowerCase().includes(searchTerm) ||
            ticket.id.toLowerCase().includes(searchTerm);

        const matchesStatus = !statusFilter || ticket.status === statusFilter;
        const matchesPriority = !priorityFilter || ticket.priority === priorityFilter;
        const matchesCategory = !categoryFilter || ticket.category === categoryFilter;

        return matchesSearch && matchesStatus && matchesPriority && matchesCategory;
    });

    renderTicketsTable(filteredTickets);
}

function updateSupportStats() {
    // Calculate stats from real tickets data
    const openTickets = tickets.filter(t => {
        const status = t.status || t.ticketStatus;
        return status === 'open' || status === 'new' || status === 'pending';
    }).length;

    const resolvedToday = tickets.filter(t => {
        const status = t.status || t.ticketStatus;
        const createdDate = t.createdAt || t.created;
        const isToday = createdDate && new Date(createdDate).toDateString() === new Date().toDateString();
        return (status === 'resolved' || status === 'closed') && isToday;
    }).length;

    const totalTickets = tickets.length;
    const inProgressTickets = tickets.filter(t => {
        const status = t.status || t.ticketStatus;
        return status === 'in_progress' || status === 'assigned' || status === 'in-progress';
    }).length;

    // Log stats for debugging (since stats cards were removed)
    console.log('Support Stats:', {
        openTickets,
        resolvedToday,
        totalTickets,
        inProgressTickets
    });

    // Update page title with ticket count if available
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle && totalTickets > 0) {
        pageTitle.textContent = `Support Center (${totalTickets} tickets)`;
    }
}

// Modal functions
function openNewTicketModal() {
    const modal = document.getElementById('newTicketModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeNewTicketModal() {
    const modal = document.getElementById('newTicketModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';

        // Reset form if it exists
        const form = document.getElementById('newTicketForm');
        if (form) {
            form.reset();
        }
    }
}

async function handleNewTicket(e) {
    e.preventDefault();

    const formData = new FormData(e.target);

    // Prepare ticket data for DynamoDB
    const ticketData = {
        customerEmail: formData.get('customer'),
        customerName: 'Support Created', // Could be enhanced to get real name
        subject: formData.get('subject'),
        category: formData.get('category'),
        priority: formData.get('priority'),
        status: 'open',
        assignedTo: formData.get('assignee') || 'Unassigned',
        description: formData.get('description')
    };

    try {
        // Save to DynamoDB
        if (window.dataService && typeof window.dataService.createSupportTicket === 'function') {
            console.log('💾 Saving ticket to DynamoDB...');
            const savedTicket = await window.dataService.createSupportTicket(ticketData);

            if (savedTicket) {
                console.log('✅ Ticket saved successfully, refreshing list...');

                // Reload all tickets from DynamoDB to get the latest data
                await loadSupportData();

                closeNewTicketModal();

                if (window.dashboardFunctions) {
                    window.dashboardFunctions.showNotification('✅ Support ticket created and saved to DynamoDB!', 'success');
                } else {
                    console.log('✅ Support ticket created and saved to DynamoDB!');
                }
            } else {
                throw new Error('Failed to save ticket to DynamoDB');
            }
        } else {
            // Fallback to memory-only storage
            console.warn('⚠️ DynamoDB not available, saving to memory only');
            const newTicket = {
                id: 'TKT' + String(tickets.length + 1).padStart(3, '0'),
                customer: {
                    name: 'Support Created',
                    email: ticketData.customerEmail,
                    avatar: 'https://i.pravatar.cc/40?img=' + (tickets.length + 24)
                },
                subject: ticketData.subject,
                category: ticketData.category,
                priority: ticketData.priority,
                status: 'open',
                assignedTo: ticketData.assignedTo,
                created: 'Just now',
                description: ticketData.description
            };

            tickets.unshift(newTicket);
            renderTicketsTable();
            updateSupportStats();
            closeNewTicketModal();

            if (window.dashboardFunctions) {
                window.dashboardFunctions.showNotification('Support ticket created (memory only)', 'warning');
            }
        }
    } catch (error) {
        console.error('❌ Error creating support ticket:', error);
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification('❌ Failed to create support ticket: ' + error.message, 'error');
        } else {
            alert('Failed to create support ticket: ' + error.message);
        }
    }
}

// Ticket action functions
function viewTicket(ticketId) {
    const ticket = tickets.find(t => t.id === ticketId || t.ticketId === ticketId);
    if (ticket) {
        // Create a better modal instead of alert
        showTicketDetailsModal(ticket);
    } else {
        console.error('Ticket not found:', ticketId);
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification('❌ Ticket not found', 'error');
        }
    }
}

function assignTicket(ticketId) {
    const ticket = tickets.find(t => t.id === ticketId || t.ticketId === ticketId);
    if (ticket) {
        showAssignTicketModal(ticket);
    } else {
        console.error('Ticket not found for assignment:', ticketId);
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification('❌ Ticket not found', 'error');
        }
    }
}

function resolveTicket(ticketId) {
    const ticket = tickets.find(t => t.id === ticketId || t.ticketId === ticketId);
    if (ticket && confirm(`Mark ticket ${ticketId} as resolved?`)) {
        ticket.status = 'resolved';

        // Update in DynamoDB if available
        updateTicketInDatabase(ticket);

        renderTicketsTable();
        updateSupportStats();

        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification(`✅ Ticket ${ticketId} marked as resolved!`, 'success');
        }
    }
}

// Function to update ticket in database
async function updateTicketInDatabase(ticket) {
    try {
        const ticketId = ticket.id || ticket.ticketId;
        if (!ticketId) {
            console.warn('updateTicketInDatabase: missing ticket id');
            return;
        }
        // Prefer dataService if available
        if (window.dataService && typeof window.dataService.updateSupportTicket === 'function') {
            await window.dataService.updateSupportTicket({
                ticketId,
                assignedTo: ticket.assignedTo,
                status: ticket.status,
                priority: ticket.priority,
                category: ticket.category,
                subject: ticket.subject,
                description: ticket.description
            });
            console.log('✅ Ticket updated via dataService:', ticketId);
            return;
        }
        // Fallback REST PATCH (best-effort)
        const apiBase = window.API_BASE_URL || window.API_BASE || '/api';
        const url = `${apiBase.replace(/\/$/, '')}/support/tickets/${encodeURIComponent(ticketId)}`;
        const token = (window.Auth && typeof window.Auth.getIdToken === 'function') ? window.Auth.getIdToken() : null;
        const res = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
                assignedTo: ticket.assignedTo,
                status: ticket.status,
                priority: ticket.priority
            })
        });
        if (!res.ok) {
            console.warn('⚠️ Backend PATCH failed (non-fatal):', res.status);
            return;
        }
        console.log('✅ Ticket update PATCH success:', ticketId);
    } catch (error) {
        console.error('❌ Error updating ticket in database (non-fatal, UI already optimistic):', error);
    }
}

// Enhanced ticket details modal
function showTicketDetailsModal(ticket) {
    // Create modal overlay
    const safeDescription = typeof sanitizeHTML === 'function' ? sanitizeHTML(ticket.description || 'No description provided') : (ticket.description || 'No description provided');
    const safeSubject = typeof sanitizeHTML === 'function' ? sanitizeHTML(ticket.subject || 'No subject') : (ticket.subject || 'No subject');
    const modalHTML = `
        <div class="modal" id="ticketDetailsModal" style="display: flex;">
            <div class="modal-content" style="max-width: 700px;">
                <div class="modal-header">
                    <h2>Ticket Details - #${ticket.id || ticket.ticketId}</h2>
                    <button class="modal-close" onclick="closeTicketDetailsModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="ticket-details">
                        <div class="detail-grid">
                            <div class="detail-item">
                                <label>Customer Name</label>
                                <span>${sanitizeHTML(ticket.customer?.name || ticket.customerName || 'Unknown')}</span>
                            </div>
                            <div class="detail-item">
                                <label>Email</label>
                                <span>${sanitizeHTML(ticket.customer?.email || ticket.customerEmail || 'No email')}</span>
                            </div>
                            <div class="detail-item">
                                <label>Subject</label>
                                <span>${safeSubject}</span>
                            </div>
                            <div class="detail-item">
                                <label>Category</label>
                                <span class="category-badge ${ticket.category}">${sanitizeHTML(getCategoryName(ticket.category))}</span>
                            </div>
                            <div class="detail-item">
                                <label>Priority</label>
                                <span class="priority-badge ${ticket.priority}">${sanitizeHTML(capitalizeFirst(ticket.priority))}</span>
                            </div>
                            <div class="detail-item">
                                <label>Status</label>
                                <span class="status-badge ${ticket.status}">${sanitizeHTML(getStatusName(ticket.status))}</span>
                            </div>
                            <div class="detail-item">
                                <label>Assigned To</label>
                                <span>${sanitizeHTML(ticket.assignedTo || 'Unassigned')}</span>
                            </div>
                            <div class="detail-item">
                                <label>Created</label>
                                <span>${sanitizeHTML(formatDate(ticket.created || ticket.createdAt))}</span>
                            </div>
                        </div>
                        <div class="detail-description">
                            <label>Description</label>
                            <div class="description-content">${safeDescription}</div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeTicketDetailsModal()">Close</button>
                    <button class="btn-primary" onclick="editTicket('${ticket.id || ticket.ticketId}')">
                        <i class="fas fa-edit"></i> Edit Ticket
                    </button>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('ticketDetailsModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.body.style.overflow = 'hidden';
}

function closeTicketDetailsModal() {
    const modal = document.getElementById('ticketDetailsModal');
    if (modal) {
        modal.remove();
        document.body.style.overflow = 'auto';
    }
}

// Enhanced assign ticket modal
function showAssignTicketModal(ticket) {
    const assignees = [
        'John Support',
        'Lisa Support',
        'Tom Support',
        'Sarah Agent',
        'Mike Helper',
        'Unassigned'
    ];

    const modalHTML = `
        <div class="modal" id="assignTicketModal" style="display: flex;">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Assign Ticket #${ticket.id || ticket.ticketId}</h2>
                    <button class="modal-close" onclick="closeAssignTicketModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="ticket-summary">
                        <h4>${ticket.subject}</h4>
                        <p>Customer: ${ticket.customer?.name || ticket.customerName || 'Unknown'}</p>
                        <p>Current Assignment: ${ticket.assignedTo || 'Unassigned'}</p>
                    </div>
                    <div class="form-group">
                        <label for="assigneeSelect">Assign to:</label>
                        <select id="assigneeSelect" class="form-control">
                            ${assignees.map(assignee =>
        `<option value="${assignee}" ${assignee === ticket.assignedTo ? 'selected' : ''}>${assignee}</option>`
    ).join('')}
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeAssignTicketModal()">Cancel</button>
                    <button class="btn-primary" onclick="confirmAssignTicket('${ticket.id || ticket.ticketId}')">
                        <i class="fas fa-user-plus"></i> Assign Ticket
                    </button>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('assignTicketModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.body.style.overflow = 'hidden';
}

function closeAssignTicketModal() {
    const modal = document.getElementById('assignTicketModal');
    if (modal) {
        modal.remove();
        document.body.style.overflow = 'auto';
    }
}

function confirmAssignTicket(ticketId) {
    const assigneeSelect = document.getElementById('assigneeSelect');
    const newAssignee = assigneeSelect.value;

    const ticket = tickets.find(t => t.id === ticketId || t.ticketId === ticketId);
    if (ticket) {
        ticket.assignedTo = newAssignee;

        // Update in DynamoDB if available
        updateTicketInDatabase(ticket);

        renderTicketsTable();
        closeAssignTicketModal();

        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification(`✅ Ticket ${ticketId} assigned to ${newAssignee}`, 'success');
        }
    }
}

// Edit ticket function (placeholder for future enhancement)
function editTicket(ticketId) {
    // This could open an edit modal similar to the new ticket modal
    if (window.dashboardFunctions) {
        window.dashboardFunctions.showNotification('Edit functionality coming soon!', 'info');
    } else {
        alert('Edit functionality coming soon!');
    }
    closeTicketDetailsModal();
}

// FAQ functions
function openAddFAQModal() {
    alert('Add FAQ modal would open here.');
}

function editFAQ(faqId) {
    alert(`Edit FAQ ${faqId} modal would open here.`);
}

function deleteFAQ(faqId) {
    if (confirm(`Delete FAQ ${faqId}?`)) {
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification('FAQ deleted successfully!', 'success');
        }
    }
}

// Knowledge Base functions
function openAddArticleModal() {
    alert('Add article modal would open here.');
}

function viewArticle(articleId) {
    const article = articles.find(a => a.id === articleId);
    if (article) {
        alert(`Article: ${article.title}\n\nDescription: ${article.description}\n\nLast Updated: ${article.updated}\nViews: ${article.views}`);
    }
}

function editArticle(articleId) {
    alert(`Edit article ${articleId} modal would open here.`);
}

function deleteArticle(articleId) {
    if (confirm(`Delete article ${articleId}?`)) {
        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification('Article deleted successfully!', 'success');
        }
    }
}

// ==================== Added: Live Chat + Amazon Connect CCP Integration ==================== //

// Basic HTML sanitizer to prevent XSS when injecting user content
function sanitizeHTML(input) {
    if (input == null) return '';
    const div = document.createElement('div');
    div.textContent = String(input);
    return div.innerHTML;
}

// State for Amazon Connect CCP
window.connectAgentState = {
    ccpReady: false,
    agentPresent: false,
    agentStatus: 'Unknown',
    lastError: null
};

// Ensure banner reflects state
function updateAgentBanner() {
    try {
        const banner = document.getElementById('connectAgentBanner');
        if (!banner) return;
        const statusTextEl = document.getElementById('ccpStatusText');
        let text;
        let emoji = 'ℹ️';
        if (window.connectAgentState.lastError) {
            text = 'Amazon Connect Error: ' + window.connectAgentState.lastError;
            emoji = '❌';
            banner.className = 'agent-banner error';
        } else if (!window.connectAgentState.ccpReady) {
            text = 'Initializing…';
            emoji = '⏳';
            banner.className = 'agent-banner initializing';
        } else if (window.connectAgentState.ccpReady && !window.connectAgentState.agentPresent) {
            text = 'CCP Ready - Agent not logged in';
            emoji = '🚪';
            banner.className = 'agent-banner warn';
        } else {
            text = 'Agent Status: ' + window.connectAgentState.agentStatus;
            emoji = window.connectAgentState.agentStatus === 'Available' ? '🟢' : '🟡';
            banner.className = 'agent-banner success';
        }
        if (statusTextEl) {
            statusTextEl.textContent = text;
        } else {
            banner.innerHTML = `${emoji} ${sanitizeHTML(text)}`;
        }
    } catch (e) {
        console.warn('updateAgentBanner failed', e);
    }
}

// Load connect-streams with retry if not yet loaded
async function ensureConnectStreamsLoaded(maxAttempts = 10, delayMs = 750) {
    let attempt = 0;
    while (attempt < maxAttempts) {
        if (window.connect && window.connect.core && typeof window.connect.core.initCCP === 'function') {
            return true;
        }
        await new Promise(r => setTimeout(r, delayMs));
        attempt++;
    }
    return false;
}

let ccpInitializing = false;
window.ccpInitialized = false;
async function initAmazonConnectCCP() {
    if (window.ccpInitialized || ccpInitializing) return;
    ccpInitializing = true;
    const loaded = await ensureConnectStreamsLoaded();
    if (!loaded) {
        window.connectAgentState.lastError = 'connect-streams not loaded';
        updateAgentBanner();
        ccpInitializing = false;
        return;
    }
    try {
        const container = document.getElementById('ccpContainer');
        if (!container) {
            console.warn('CCP container not found');
            return;
        }
        console.log('🟡 Initializing Amazon Connect CCP (frontend/support.js)...');
        window.connect.core.initCCP(container, {
            ccpUrl: window.CONNECT_CCP_URL || window.WIZZCENTRAL_CONFIG?.CONNECT_CCP_URL || '',
            loginPopup: true,
            loginPopupAutoClose: true,
            softphone: { allowFramedSoftphone: true },
            region: window.CONNECT_REGION || 'us-east-1'
        });
        window.connect.core.onReady(() => {
            window.connectAgentState.ccpReady = true;
            updateAgentBanner();
        });
        window.connect.agent(agent => {
            window.connectAgentState.agentPresent = true;
            window.connectAgentState.agentStatus = agent.getStatus()?.name || 'Unknown';
            updateAgentBanner();
            agent.onRefresh(a => {
                window.connectAgentState.agentStatus = a.getStatus()?.name || 'Unknown';
                updateAgentBanner();
            });
        });
        window.connect.contact(contact => {
            console.log('📞 New contact:', contact.getContactId(), contact.getType());
        });
        window.ccpInitialized = true;
    } catch (e) {
        window.connectAgentState.lastError = e.message || String(e);
        console.error('CCP init error:', e);
    } finally {
        updateAgentBanner();
        ccpInitializing = false;
    }
}

// Enhance existing banner injection to include status span if missing
(function patchBannerInjection() {
    const original = window.injectAgentBannerIfMissing;
    window.injectAgentBannerIfMissing = function () {
        if (original) original();
        // After original creates the banner, ensure status updates
        updateAgentBanner();
    };
})();

// Live Chat Transcript UI
function ensureTranscriptContainer() {
    const livechatTab = document.getElementById('livechatTab');
    if (!livechatTab) return null;

    // Prefer rendering inside the new conversation area if present
    const convoArea = document.getElementById('conversation-area') || livechatTab;

    let transcript = document.getElementById('liveChatTranscript');
    if (!transcript) {
        transcript = document.createElement('div');
        transcript.id = 'liveChatTranscript';
        transcript.className = 'chat-transcript';
        transcript.innerHTML = '<div class="chat-empty-state" id="liveChatEmpty">No live chat messages yet.</div>';
        convoArea.appendChild(transcript);

        // Ensure a typing indicator exists in the conversation area for driver typing events
        if (!document.getElementById('liveChatTypingIndicator')) {
            const indicator = document.createElement('div');
            indicator.id = 'liveChatTypingIndicator';
            indicator.className = 'chat-typing-indicator';
            indicator.style.display = 'none';
            convoArea.appendChild(indicator);
        }
    }
    return transcript;
}

// System message appender (distinct styling)
function appendChatSystemMessage(sessionId, text, subtype, timestamp = new Date().toISOString()) {
    // Dedup guard for certain subtypes
    try {
        if (!window.liveChatDedup) window.liveChatDedup = { systemEvents: new Set() };
        const dedupKey = `${sessionId}|${subtype}`;
        const dedupbedSubtypes = new Set(['session_closed', 'agent_first_response', 'session_closing']);
        if (dedupbedSubtypes.has(subtype) && window.liveChatDedup.systemEvents.has(dedupKey)) return; // skip duplicate
        if (dedupbedSubtypes.has(subtype)) window.liveChatDedup.systemEvents.add(dedupKey);
    } catch (_) { }
    try {
        if (!window.liveChatSessions) window.liveChatSessions = {};
        if (!window.liveChatSessions[sessionId]) window.liveChatSessions[sessionId] = { messages: [] };
        const sysMsg = { sessionId, senderType: 'system', subtype, messageText: text, timestamp };
        window.liveChatSessions[sessionId].messages.push(sysMsg);
        if (window.liveChatUIState.activeSessionId !== sessionId) {
            const badge = document.querySelector(`[data-session-id="${sessionId}"] .lc-unread`);
            if (badge) { const cur = parseInt(badge.textContent || '0', 10); badge.textContent = String(cur + 1); badge.style.display = 'inline-flex'; }
            return; // don't render if not active
        }
        const transcript = ensureTranscriptContainer();
        if (!transcript) return;
        const empty = document.getElementById('liveChatEmpty');
        if (empty) empty.remove();
        const div = document.createElement('div');
        div.className = 'chat-system-message';
        div.textContent = text;
        transcript.appendChild(div);
        transcript.scrollTop = transcript.scrollHeight;
    } catch (e) { console.warn('appendChatSystemMessage failed', e); }
}

// Chat WebSocket Manager (specialized for support live chat)
// If a modern LiveChatSocket is already defined (from js/support/LiveChatSocket.js), don't override it here
if (!window.LiveChatSocket) {
class LiveChatSocket {
    constructor({ businessId, endpoint, userId, token, agentId, agentName }) {
        this.watchdogIntervalMs = 10000; // check every 10s
        this.watchdogTriggered = false;
    }
    buildUrl() {
        const params = new URLSearchParams({
            businessId: this.businessId,
            userId: this.userId,
            userType: 'agent_dashboard',
            platform: 'dashboard',
            version: '1.0.0'
        });
        if (this.token) params.append('token', this.token);
        return `${this.endpoint}?${params.toString()}`;
    }
    connect() {
        try {
            const url = this.buildUrl();
            console.log('🔌 LiveChatSocket connecting:', url);
            this.ws = new WebSocket(url);
            this.ws.onopen = () => this.onOpen();
            this.ws.onmessage = (e) => this.onMessage(e);
            this.ws.onerror = (e) => this.onError(e);
            this.ws.onclose = (e) => this.onClose(e);
        } catch (e) {
            console.error('LiveChatSocket connect error', e);
            this.scheduleReconnect();
        }
    }
    onOpen() {
        this.connected = true;
        this.retries = 0;
        this.watchdogTriggered = false;
        this.lastHeartbeatAck = Date.now();
        hideLiveChatErrorBanner();
        console.log('✅ LiveChatSocket connected');
        this.send({ type: 'chat_agent_connect', agentId: this.agentId, agentName: this.agentName });
        // Request delta sync if we have last sync timestamp
        if (window.liveChatState?.lastSyncAt) {
            this.send({ type: 'sync_sessions', since: window.liveChatState.lastSyncAt });
        }
        this.startHeartbeat();
        this.startWatchdog();
    }
    onMessage(event) {
        try {
            const data = JSON.parse(event.data);
            const msgType = data.type || data.action;
            if (msgType === 'heartbeat_response') {
                this.lastHeartbeatAck = Date.now();
                if (this.watchdogTriggered) {
                    this.watchdogTriggered = false;
                    hideLiveChatErrorBanner(true); // silent clear
                }
                return;
            }
            if (msgType === 'ping') return;
            if (msgType === 'driver_message') { data.type = 'chat_message'; }
            // Update last sync timestamp on any session impacting event
            const sessionImpactTypes = new Set(['chat_message', 'system_event', 'session_closed', 'chat_session_closed', 'active_sessions', 'new_chat_session']);
            if (sessionImpactTypes.has(data.type)) {
                if (!window.liveChatState) window.liveChatState = {};
                window.liveChatState.lastSyncAt = new Date().toISOString();
            }
            switch (msgType) {
                case 'active_sessions':
                    handleActiveSessions(data.sessions || []);
                    break;
                case 'chat_session_close_ack': {
                    const sid = data.sessionId;
                    if (sid) {
                        markSessionClosing(sid);
                        // Avoid duplicate system message if already added
                        const sess = window.liveChatSessions?.[sid];
                        if (sess && !sess._closeAckNoted) {
                            appendChatSystemMessage(sid, 'Closing session…', 'session_closing', data.timestamp);
                            sess._closeAckNoted = true;
                        }
                    }
                    break;
                }
                case 'session_closed':
                case 'chat_session_closed':
                case 'chat_session_close': {
                    if (data.sessionId) {
                        const sess = window.liveChatSessions?.[data.sessionId];
                        if (!sess || sess.status !== 'closed') {
                            markSessionClosed(data.sessionId);
                            appendChatSystemMessage(data.sessionId, 'Chat session closed', 'session_closed', data.timestamp);
                        }
                    }
                    break;
                }
                default:
                    appendChatMessage(data);
            }
        } catch (e) { console.error('LiveChatSocket parse error', e, event.data); }
    }
    onError(err) {
        console.warn('⚠️ LiveChatSocket error', err);
    }
    onClose(evt) {
        console.warn('🔌 LiveChatSocket closed', evt.code, evt.reason);
        this.connected = false;
        this.stopHeartbeat();
        this.stopWatchdog();
        this.scheduleReconnect();
    }
    send(obj) {
        try {
            if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(obj));
            } else {
                console.warn('LiveChatSocket send while not open');
            }
        } catch (e) {
            console.error('LiveChatSocket send failed', e);
        }
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.connected) {
                this.send({ action: 'ping', ts: Date.now() });
            }
        }, this.heartbeatIntervalMs);
    }
    // Heartbeat watchdog: detects missing acks and forces reconnect
    startWatchdog() {
        this.stopWatchdog();
        this.watchdogInterval = setInterval(() => {
            if (!this.connected) return;
            const now = Date.now();
            const staleThreshold = (this.heartbeatIntervalMs * 2) + 5000; // 2 heartbeats + 5s grace
            if (now - this.lastHeartbeatAck > staleThreshold) {
                if (!this.watchdogTriggered) {
                    this.watchdogTriggered = true;
                    showLiveChatErrorBanner('Live chat connection lost. Reconnecting…');
                }
                // Force reconnect if socket still appears open (stuck)
                try {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.close(4000, 'watchdog_reconnect');
                    }
                } catch (_) { }
                this.connected = false;
                this.stopHeartbeat();
                this.stopWatchdog();
                this.scheduleReconnect();
            }
        }, this.watchdogIntervalMs);
    }
    stopWatchdog() {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    scheduleReconnect() {
        if (this.retries >= this.maxRetries) {
            console.error('LiveChatSocket max retries reached');
            return;
        }
        const delay = Math.min(this.baseDelay * Math.pow(2, this.retries), 30000);
        console.log(`LiveChatSocket reconnecting in ${delay}ms`);
        setTimeout(() => {
            this.retries++;
            this.connect();
        }, delay);
    }
    sendChatMessage(sessionId, messageText) {
        this.send({ type: 'chat_message', sessionId, messageText, senderType: 'agent', agentId: this.agentId, agentName: this.agentName, timestamp: new Date().toISOString() });
    }
    sendTyping(sessionId, isTyping) {
        this.send({ type: 'chat_typing', sessionId, isTyping, senderType: 'agent', agentId: this.agentId });
    }
    sendSessionClose(sessionId) {
        this.send({ type: 'chat_session_close', sessionId, agentId: this.agentId, agentName: this.agentName, timestamp: new Date().toISOString() });
    }
}
}

function appendChatMessage(msg) {
    // Extended: store per-session & only render active session
    try {
        if (!window.liveChatSessions) window.liveChatSessions = {}; // { sessionId: { messages: [] } }
        const sessionId = msg.sessionId || msg.message?.sessionId || msg.message?.session_id;
        const pureMessage = msg.message && msg.type === 'chat_message_received' ? msg.message : msg; // unify shape
        if (sessionId) {
            if (!window.liveChatSessions[sessionId]) window.liveChatSessions[sessionId] = { messages: [] };
            window.liveChatSessions[sessionId].messages.push(pureMessage);
        }
        // Only render if active session matches (or no session filtering yet)
        if (window.liveChatUIState && window.liveChatUIState.activeSessionId && sessionId && window.liveChatUIState.activeSessionId !== sessionId) {
            // Increment unread badge for that session
            const badge = document.querySelector(`[data-session-id="${sessionId}"] .lc-unread`);
            if (badge) {
                const cur = parseInt(badge.textContent || '0', 10); badge.textContent = String(cur + 1); badge.style.display = 'inline-flex';
            }
            return; // do not append in transcript now
        }
    } catch (e) { console.warn('appendChatMessage storage failed', e); }
    const transcript = ensureTranscriptContainer();
    if (!transcript) return;
    const empty = document.getElementById('liveChatEmpty');
    if (empty) empty.remove();
    const wrapper = document.createElement('div');
    const sender = sanitizeHTML((msg.senderName || msg.sender || msg.senderType || msg.message?.senderName || msg.message?.senderType || 'unknown'));
    const role = sanitizeHTML((msg.senderType || msg.message?.senderType) || '');
    const base = msg.message && msg.type === 'chat_message' ? msg.message : (msg.message || msg);
    const contentRaw = base.messageText || base.message || base.text || base.body || (base.text ? base.text : JSON.stringify(base));
    const content = sanitizeHTML(contentRaw);
    const ts = sanitizeHTML(base.timestamp || new Date().toISOString());
    wrapper.className = 'chat-message';
    wrapper.innerHTML = `<div class="chat-message-header"><strong>${sender}</strong> <span class="chat-message-sender">${role}</span> <span class="chat-message-timestamp">${ts}</span></div><div class="chat-message-content">${content}</div>`;
    transcript.appendChild(wrapper);
    transcript.scrollTop = transcript.scrollHeight;
}

// Chat WebSocket Manager (specialized for support live chat)
class LiveChatSocket {
    constructor({ businessId, endpoint, userId, token, agentId, agentName }) {
        this.watchdogIntervalMs = 10000; // check every 10s
        this.watchdogTriggered = false;
    }
    buildUrl() {
        const params = new URLSearchParams({
            businessId: this.businessId,
            userId: this.userId,
            userType: 'agent_dashboard',
            platform: 'dashboard',
            version: '1.0.0'
        });
        if (this.token) params.append('token', this.token);
        return `${this.endpoint}?${params.toString()}`;
    }
    connect() {
        try {
            const url = this.buildUrl();
            console.log('🔌 LiveChatSocket connecting:', url);
            this.ws = new WebSocket(url);
            this.ws.onopen = () => this.onOpen();
            this.ws.onmessage = (e) => this.onMessage(e);
            this.ws.onerror = (e) => this.onError(e);
            this.ws.onclose = (e) => this.onClose(e);
        } catch (e) {
            console.error('LiveChatSocket connect error', e);
            this.scheduleReconnect();
        }
    }
    onOpen() {
        this.connected = true;
        this.retries = 0;
        this.watchdogTriggered = false;
        this.lastHeartbeatAck = Date.now();
        hideLiveChatErrorBanner();
        console.log('✅ LiveChatSocket connected');
        this.send({ type: 'chat_agent_connect', agentId: this.agentId, agentName: this.agentName });
        // Request delta sync if we have last sync timestamp
        if (window.liveChatState?.lastSyncAt) {
            this.send({ type: 'sync_sessions', since: window.liveChatState.lastSyncAt });
        }
        this.startHeartbeat();
        this.startWatchdog();
    }
    onMessage(event) {
        try {
            const data = JSON.parse(event.data);
            const msgType = data.type || data.action;
            if (msgType === 'heartbeat_response') {
                this.lastHeartbeatAck = Date.now();
                if (this.watchdogTriggered) {
                    this.watchdogTriggered = false;
                    hideLiveChatErrorBanner(true); // silent clear
                }
                return;
            }
            if (msgType === 'ping') return;
            if (msgType === 'driver_message') { data.type = 'chat_message'; }
            // Update last sync timestamp on any session impacting event
            const sessionImpactTypes = new Set(['chat_message', 'system_event', 'session_closed', 'chat_session_closed', 'active_sessions', 'new_chat_session']);
            if (sessionImpactTypes.has(data.type)) {
                if (!window.liveChatState) window.liveChatState = {};
                window.liveChatState.lastSyncAt = new Date().toISOString();
            }
            switch (msgType) {
                case 'active_sessions':
                    handleActiveSessions(data.sessions || []);
                    break;
                case 'chat_session_close_ack': {
                    const sid = data.sessionId;
                    if (sid) {
                        markSessionClosing(sid);
                        // Avoid duplicate system message if already added
                        const sess = window.liveChatSessions?.[sid];
                        if (sess && !sess._closeAckNoted) {
                            appendChatSystemMessage(sid, 'Closing session…', 'session_closing', data.timestamp);
                            sess._closeAckNoted = true;
                        }
                    }
                    break;
                }
                case 'session_closed':
                case 'chat_session_closed':
                case 'chat_session_close': {
                    if (data.sessionId) {
                        const sess = window.liveChatSessions?.[data.sessionId];
                        if (!sess || sess.status !== 'closed') {
                            markSessionClosed(data.sessionId);
                            appendChatSystemMessage(data.sessionId, 'Chat session closed', 'session_closed', data.timestamp);
                        }
                    }
                    break;
                }
                default:
                    appendChatMessage(data);
            }
        } catch (e) { console.error('LiveChatSocket parse error', e, event.data); }
    }
    onError(err) {
        console.warn('⚠️ LiveChatSocket error', err);
    }
    onClose(evt) {
        console.warn('🔌 LiveChatSocket closed', evt.code, evt.reason);
        this.connected = false;
        this.stopHeartbeat();
        this.stopWatchdog();
        this.scheduleReconnect();
    }
    send(obj) {
        try {
            if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(obj));
            } else {
                console.warn('LiveChatSocket send while not open');
            }
        } catch (e) {
            console.error('LiveChatSocket send failed', e);
        }
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.connected) {
                this.send({ action: 'ping', ts: Date.now() });
            }
        }, this.heartbeatIntervalMs);
    }
    // Heartbeat watchdog: detects missing acks and forces reconnect
    startWatchdog() {
        this.stopWatchdog();
        this.watchdogInterval = setInterval(() => {
            if (!this.connected) return;
            const now = Date.now();
            const staleThreshold = (this.heartbeatIntervalMs * 2) + 5000; // 2 heartbeats + 5s grace
            if (now - this.lastHeartbeatAck > staleThreshold) {
                if (!this.watchdogTriggered) {
                    this.watchdogTriggered = true;
                    showLiveChatErrorBanner('Live chat connection lost. Reconnecting…');
                }
                // Force reconnect if socket still appears open (stuck)
                try {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.close(4000, 'watchdog_reconnect');
                    }
                } catch (_) { }
                this.connected = false;
                this.stopHeartbeat();
                this.stopWatchdog();
                this.scheduleReconnect();
            }
        }, this.watchdogIntervalMs);
    }
    stopWatchdog() {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    scheduleReconnect() {
        if (this.retries >= this.maxRetries) {
            console.error('LiveChatSocket max retries reached');
            return;
        }
        const delay = Math.min(this.baseDelay * Math.pow(2, this.retries), 30000);
        console.log(`LiveChatSocket reconnecting in ${delay}ms`);
        setTimeout(() => {
            this.retries++;
            this.connect();
        }, delay);
    }
    sendChatMessage(sessionId, messageText) {
        this.send({ type: 'chat_message', sessionId, messageText, senderType: 'agent', agentId: this.agentId, agentName: this.agentName, timestamp: new Date().toISOString() });
    }
    sendTyping(sessionId, isTyping) {
        this.send({ type: 'chat_typing', sessionId, isTyping, senderType: 'agent', agentId: this.agentId });
    }
    sendSessionClose(sessionId) {
        this.send({ type: 'chat_session_close', sessionId, agentId: this.agentId, agentName: this.agentName, timestamp: new Date().toISOString() });
    }
}

// Role-based UI gating using Cognito groups mapped to role in auth-utils
function applyRoleGating() {
    try {
        const user = (window.Auth && typeof window.Auth.getCurrentUser === 'function') ? window.Auth.getCurrentUser() : null;
        const role = user?.role || 'customer';
        // Only admin & support can see FAQ / Knowledge creation controls
        if (!['admin', 'support'].includes(role)) {
            // Hide FAQ & Knowledge tabs
            const faqTabBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => (b.getAttribute('onclick') || '').includes("switchTab('faq')"));
            const kbTabBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => (b.getAttribute('onclick') || '').includes("switchTab('knowledge')"));
            if (faqTabBtn) faqTabBtn.style.display = 'none';
            if (kbTabBtn) faqTabBtn.style.display = 'none';
            // Hide new ticket button if exists (example of management feature)
            const newTicketBtn = document.querySelector('[onclick="openNewTicketModal()"]');
            if (newTicketBtn) newTicketBtn.style.display = 'none';
        }
    } catch (e) { console.warn('applyRoleGating failed', e); }
}
// Apply gating after DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => { applyRoleGating(); });

// Auto-init if live chat tab already active on load
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    const active = document.querySelector('#livechatTab.active');
    if (active) {
        setTimeout(() => initializeLiveChat(), 500);
    }
} else {
    document.addEventListener('DOMContentLoaded', () => {
        const active = document.querySelector('#livechatTab.active');
        if (active) setTimeout(() => initializeLiveChat(), 500);
    });
}

function showLiveChatErrorBanner(message) {
    try {
        let banner = document.getElementById('liveChatErrorBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'liveChatErrorBanner';
            banner.style.cssText = 'margin-top:12px;padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:6px;font-size:13px;';
            const tab = document.getElementById('livechatTab');
            tab?.prepend(banner);
        }
        banner.textContent = message;
    } catch (e) { console.warn('showLiveChatErrorBanner failed', e); }
}

// ==================== End Added Section ==================== //
