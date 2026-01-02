// Simplified Campaign Manager for WizzCentral Platform
// Handles campaign creation and management with Material 3 design

class SimplifiedCampaignManager {
    constructor() {
        this.campaigns = [];
        this.isLoading = false;
    }

    // UI Loading utilities
    showLoading(message = 'Loading...') {
        this.isLoading = true;
        console.log(`⏳ ${message}`);
        
        // Show loading in campaign table if available
        const tbody = document.getElementById('campaignsTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;">${message}</td></tr>`;
        }
    }

    hideLoading() {
        this.isLoading = false;
        console.log('✅ Loading completed');
    }

    // UI Notification utilities
    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type = 'info') {
        console.log(`${type.toUpperCase()}: ${message}`);
        
        // Use browser alert as fallback
        if (type === 'error') {
            alert(`Error: ${message}`);
        } else if (type === 'success') {
            alert(`Success: ${message}`);
        } else {
            alert(message);
        }
    }

    // Initialize the campaign manager
    async initialize() {
        try {
            console.log('🚀 Initializing Simplified Campaign Manager...');
            await this.loadCampaigns();
            this.setupEventListeners();
            console.log('✅ Campaign Manager initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Campaign Manager:', error);
        }
    }

    // Load campaigns from WizzCampaignsAPI (mock data)
    async loadCampaigns() {
        const tbody = document.getElementById('campaignsTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">Loading campaigns...</td></tr>';
        }

        try {
            this.isLoading = true;
            this.showLoading('Loading campaigns...');
            
            // Wait for WizzCampaignsAPI to be available (with retry)
            let retries = 0;
            const maxRetries = 10;
            while (!window.WizzCampaignsAPI && retries < maxRetries) {
                console.log(`⏳ Waiting for WizzCampaignsAPI... (attempt ${retries + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
            }

            if (!window.WizzCampaignsAPI) {
                throw new Error('WizzCampaignsAPI not available after waiting');
            }

            console.log('🔄 Loading campaigns from WizzCampaignsAPI...');
            const result = await window.WizzCampaignsAPI.getCampaigns(50);
            
            if (result.success && result.campaigns) {
                this.campaigns = result.campaigns;
                console.log(`📊 Loaded ${this.campaigns.length} campaigns from ${result.source}`);
            } else {
                throw new Error('Failed to load campaigns from API');
            }
            
            this.hideLoading();
            this.renderCampaignsTable();
            this.updateCampaignStats();
            
        } catch (error) {
            this.hideLoading();
            console.error('❌ Error loading campaigns:', error);
            
            // Fallback to empty state
            this.campaigns = [];
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #e74c3c;">
                    Error loading campaigns: ${error.message}
                    <br><button onclick="campaignManager.loadCampaigns()" class="btn-secondary" style="margin-top: 1rem;">
                        <i class="fas fa-refresh"></i> Retry
                    </button>
                </td></tr>`;
            }
        } finally {
            this.isLoading = false;
        }
    }

    // Render campaigns table
    renderCampaignsTable() {
        const tbody = document.getElementById('campaignsTableBody');
        if (!tbody) return;

        if (this.campaigns.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;">No campaigns found</td></tr>';
            return;
        }

        tbody.innerHTML = this.campaigns.map(campaign => `
            <tr>
                <td>${campaign.name || campaign.title || 'Unnamed Campaign'}</td>
                <td>${campaign.discountType || 'N/A'}</td>
                <td>${this.formatDiscount(campaign.discountType, campaign.discountValue)}</td>
                <td>
                    <span class="status-badge status-${campaign.status === 'active' ? 'active' : 'inactive'}">
                        ${campaign.status || 'draft'}
                    </span>
                </td>
                <td>${campaign.targetAudience || 'All'}</td>
                <td>${this.formatDateRange(campaign.startDate, campaign.endDate)}</td>
                <td>
                    <div class="action-buttons">
                        <button onclick="campaignManager.editCampaign('${campaign.campaignId}')" 
                                class="btn-sm btn-secondary" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="campaignManager.deleteCampaign('${campaign.campaignId}')" 
                                class="btn-sm btn-danger" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // Create new campaign with simplified form
    async createCampaign(formData) {
        try {
            this.showLoading('Creating campaign...');
            
            // Handle both FormData and regular object input
            let campaignData;
            
            if (formData instanceof FormData) {
                // Build campaign data from FormData
                campaignData = {
                    name: formData.get('name') || formData.get('title'),
                    description: formData.get('description') || '',
                    discountType: formData.get('discountType'),
                    discountValue: parseFloat(formData.get('discountValue')),
                    startDate: formData.get('startDate'),
                    endDate: formData.get('endDate'),
                    targetAudience: formData.get('customerSegment') || formData.get('targetAudience') || 'all_customers',
                    minimumOrderValue: parseFloat(formData.get('minOrderValue') || formData.get('minimumOrderValue')) || 0,
                    businessId: formData.get('businessId') || 'default-business',
                    status: formData.has('isActive') ? 'active' : 'draft'
                };
            } else {
                // Handle regular object
                campaignData = {
                    name: formData.name || formData.title,
                    description: formData.description || '',
                    discountType: formData.discountType,
                    discountValue: parseFloat(formData.discountValue),
                    startDate: formData.startDate,
                    endDate: formData.endDate,
                    targetAudience: formData.targetAudience || formData.customerSegment || 'all_customers',
                    minimumOrderValue: parseFloat(formData.minimumOrderValue || formData.minOrderValue) || 0,
                    businessId: formData.businessId || 'default-business',
                    status: formData.isActive ? 'active' : 'draft'
                };
            }

            console.log('📝 Creating campaign with data:', campaignData);
            
            // Validate required fields
            if (!campaignData.name || !campaignData.discountType || 
                campaignData.discountValue === null || campaignData.discountValue === undefined ||
                !campaignData.startDate || !campaignData.endDate) {
                throw new Error('Please fill in all required fields (name, discount type, discount value, start date, end date)');
            }
            
            // Use the backend API directly
            const response = await fetch('/campaigns', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': 'campaign-manager-user'
                },
                body: JSON.stringify(campaignData)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
            }

            const result = await response.json();

            this.hideLoading();
            this.showSuccess('Campaign created successfully!');
            this.closeCampaignModal();
            await this.loadCampaigns();
            
            return result;
            
        } catch (error) {
            this.hideLoading();
            console.error('❌ Error creating campaign:', error);
            this.showError('Failed to create campaign: ' + error.message);
            throw error;
        }
    }

    // Helper methods
    formatDiscount(type, value) {
        if (!type || value === null || value === undefined) return 'N/A';
        return type === 'percentage' ? `${value}%` : `$${value}`;
    }

    formatDateRange(startDate, endDate) {
        if (!startDate || !endDate) return 'N/A';
        const start = new Date(startDate).toLocaleDateString();
        const end = new Date(endDate).toLocaleDateString();
        return `${start} - ${end}`;
    }

    updateCampaignStats() {
        const totalElement = document.getElementById('totalCampaigns');
        if (totalElement) {
            totalElement.textContent = this.campaigns.length;
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Campaign creation form
        const form = document.getElementById('simplifiedCampaignForm');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(form);
                await this.createCampaign(formData);
            });
        }

        // Create campaign button
        const createBtn = document.getElementById('createCampaignBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.openCampaignModal());
        }

        // Close modal button
        const closeBtn = document.getElementById('closeCampaignModal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeCampaignModal());
        }

        // Refresh button
        const refreshBtn = document.getElementById('refreshCampaigns');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadCampaigns());
        }
    }

    // Modal management
    openCampaignModal() {
        const modal = document.getElementById('simplifiedCampaignModal');
        if (modal) {
            this.resetForm();
            modal.style.display = 'flex';
        }
    }

    closeCampaignModal() {
        const modal = document.getElementById('simplifiedCampaignModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    resetForm() {
        const form = document.getElementById('simplifiedCampaignForm');
        if (form) {
            form.reset();
        }
    }

    // Stub methods for future implementation
    async editCampaign(campaignId) {
        this.showNotification('Campaign editing coming soon', 'info');
    }

    async deleteCampaign(campaignId) {
        if (confirm('Are you sure you want to delete this campaign?')) {
            this.showNotification('Campaign deletion coming soon', 'info');
        }
    }
}

// Initialize global campaign manager
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🚀 Initializing Campaign Manager...');
        
        window.campaignManager = new SimplifiedCampaignManager();
        await window.campaignManager.initialize();
        
        console.log('✅ Campaign Manager ready!');
    } catch (error) {
        console.error('❌ Failed to initialize Campaign Manager:', error);
    }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimplifiedCampaignManager;
}
