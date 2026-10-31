// Simplified Campaign Manager for WizzCentral Platform
// Handles campaign creation, editing, deletion, and management backed by DynamoDB (WizzCentral_Platform_Discounts)

class SimplifiedCampaignManager {
    constructor() {
        this.campaigns = [];
        this.isLoading = false;
        this.editingCampaignId = null;
        window.CampaignImage?.reset();
    }

    // UI Loading utilities
    showLoading(message = 'Loading...') {
        this.isLoading = true;
        console.log(`⏳ ${message}`);

        const loader = document.getElementById('campaignLoader');
        if (loader) {
            const span = loader.querySelector('span');
            if (span) span.textContent = message;
            loader.style.display = 'flex';
        }

        const tbody = document.getElementById('special-campaigns-tbody') || document.getElementById('campaignsTableBody');
        if (tbody && this.campaigns.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem;">${message}</td></tr>`;
        }
    }

    hideLoading() {
        this.isLoading = false;
        const loader = document.getElementById('campaignLoader');
        if (loader) loader.style.display = 'none';
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
        if (window.dashboardFunctions?.showNotification) {
            window.dashboardFunctions.showNotification(message, type);
        } else if (type === 'error') {
            alert(`خطأ: ${message}`);
        } else if (type === 'success') {
            alert(`تم بنجاح: ${message}`);
        } else {
            alert(message);
        }
    }

    // Initialize the campaign manager
    async initialize() {
        this.setupEventListeners();
        this.regionPicker = new CampaignRegionPicker();
        await this.loadCampaigns();
    }

    // Load campaigns from unified data service
    async loadCampaigns() {
        const tbody = document.getElementById('special-campaigns-tbody') || document.getElementById('campaignsTableBody');
        try {
            this.showLoading("جارٍ تحميل الحملات...");

            if (window.dataService && typeof window.dataService.getCampaigns === 'function') {
                console.log('🔄 Loading campaigns from window.dataService...');
                const items = await window.dataService.getCampaigns({ strict: true });
                this.campaigns = Array.isArray(items) ? items : [];
                console.log(`📊 Loaded ${this.campaigns.length} campaigns from unified platform discounts table`);
            } else {
                throw new Error('Promotion data service is unavailable. Please reload the page.');
            }

            this.hideLoading();
            this.renderCampaignsTable();
            this.updateCampaignStats();

        } catch (error) {
            this.hideLoading();
            console.error('❌ Error loading campaigns:', error);
            this.campaigns = [];
            window.PromotionsUI.showLoadError('campaigns', error, () => this.loadCampaigns());
        }
    }

    // Render campaigns table
    renderCampaignsTable() {
        const tbody = document.getElementById('special-campaigns-tbody') || document.getElementById('campaignsTableBody');
        if (!tbody) return;

        if (this.campaigns.length === 0) {
            tbody.innerHTML = "<tr><td colspan=\"8\" style=\"text-align: center; padding: 2rem;\">لا توجد حملات مطابقة</td></tr>";
            return;
        }

        const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        tbody.innerHTML = this.campaigns.map(campaign => {
            const id = campaign.discountId || campaign.campaignId || campaign.id;
            const code = campaign.code || '-';
            const status = (campaign.status || (campaign.isActive ? 'active' : 'draft')).toLowerCase();
            const minOrder = (campaign.minOrderValue || campaign.minOrderAmount) ? `${Number(campaign.minOrderValue || campaign.minOrderAmount).toLocaleString()} IQD` : 'None';
            const usage = `${campaign.usage || 0}/${campaign.usageLimit || campaign.limit || '∞'}`;
            const target = campaign.targetLocation || campaign.targetAudience || campaign.target || (Array.isArray(campaign.customerSegments) ? campaign.customerSegments.join(', ') : 'All Customers');

            return `
            <tr>
                <td>
                    <div><strong>${escape(campaign.name || campaign.title || 'Unnamed Campaign')}</strong></div>
                    <div style="font-size: 0.8rem; color: #666;">الرمز: <code style="font-weight: bold; color: #007bff;">${escape(code)}</code></div>
                    <div style="font-size:0.8rem">إصدار الشروط: ${escape(Number.isSafeInteger(campaign.version) && campaign.version > 0 ? campaign.version : 'غير مُرقّم')}</div>
                    ${campaign.description ? `<div style="font-size: 0.8rem; color: #888;">${escape(campaign.description)}</div>` : ''}
                </td>
                <td>${escape(this.formatType(campaign.discountType || campaign.type))}</td>
                <td>${escape(target)}</td>
                <td><strong>${escape(this.formatDiscount(campaign.discountType || campaign.type, campaign.discountValue ?? campaign.value))}</strong></td>
                <td>
                    <span class="status status-${status === 'active' ? 'active' : 'inactive'}">
                        ${escape(status)}
                    </span>
                </td>
                <td>${usage}</td>
                <td>${this.formatDateRange(campaign.startDate || campaign.validFrom, campaign.endDate || campaign.validTo)}</td>
                <td data-permission="campaigns_admin:write">
                    <div style="display: flex; gap: 6px;">
                        <button onclick="campaignManager.editCampaign(decodeURIComponent('${encodeURIComponent(id).replace(/'/g, '%27')}'))"
                                class="btn-icon" title="تعديل">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="campaignManager.toggleStatus(decodeURIComponent('${encodeURIComponent(id).replace(/'/g, '%27')}'))"
                                class="btn-icon"
                                title="${status === 'active' ? "تعطيل" : "تفعيل"}">
                            <i class="fas ${status === 'active' ? 'fa-pause' : 'fa-play'}"></i>
                        </button>
                        <button onclick="campaignManager.notifyCampaign(decodeURIComponent('${encodeURIComponent(id).replace(/'/g, '%27')}'))"
                                class="btn-icon" title="إرسال إشعار الحملة ومتابعة النتيجة">
                            <i class="fas fa-bell"></i>
                        </button>
                        <button onclick="campaignManager.deleteCampaign(decodeURIComponent('${encodeURIComponent(id).replace(/'/g, '%27')}'))"
                                class="btn-icon" title="حذف">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');
    }

    async notifyCampaign(id) {
        if (this.notifyingCampaign) return;
        this.notifyingCampaign = true;
        try {
            let result = await window.dataService.campaignNotificationStatus(id);
            if ((result.notificationStatus === 'NOT_REQUESTED' || result.retryable === true) &&
                confirm('هل تريد إرسال إشعار هذه الحملة إلى أجهزة المستخدمين المؤهلة؟')) {
                result = await window.dataService.sendCampaignNotification(id);
            }
            const labels = {
                NOT_REQUESTED:'لم يُطلب إرسال إشعار لهذه الحملة.',
                QUEUED:'الإشعار في قائمة الإرسال. اضغط زر الجرس لاحقاً لمتابعة النتيجة.',
                PROCESSING:'جارٍ إرسال الإشعار.', SENDING:'جارٍ إرسال الإشعار.',
                SENT:'اكتمل إرسال الإشعار.', NO_RECIPIENTS:'لا توجد أجهزة مؤهلة لاستلام الإشعار.',
                PARTIAL:'أُرسل الإشعار إلى بعض الأجهزة وفشل لدى أجهزة أخرى.',
                FAILED:'فشل إرسال الإشعار.',
            };
            const c=result.counts;
            this.showNotification((labels[result.notificationStatus] || result.notificationStatus) +
                (c ? ` المستهدف: ${c.targeted || 0}، المرسل: ${c.sent || 0}، المتعذر: ${c.failed || 0}.` : ''),
                result.notificationStatus==='FAILED'?'error':'info');
        } catch (e) { this.showError(e.message); }
        finally { this.notifyingCampaign = false; }
    }

    // Save or update campaign in DynamoDB
    async createCampaign(formData) {
        if (this.isSaving || window.CampaignImage?.uploading) return;
        this.isSaving = true;
        const form = document.getElementById('simplifiedCampaignForm');
        const submit = form?.querySelector('button[type="submit"]');
        const status = document.getElementById('campaign_saveStatus');
        if (submit) submit.disabled = true;
        if (status) { status.hidden = false; status.textContent = "جارٍ حفظ الحملة…"; status.dataset.state = 'saving'; }
        try {

            let title, code, description, discountType, discountValue, minOrderValue, usageLimit, startDate, endDate, campaignType;

            if (formData instanceof FormData) {
                title = (formData.get('title') || formData.get('name') || '').trim();
                code = (formData.get('code') || formData.get('campaign_code') || '').trim().toUpperCase();
                description = (formData.get('description') || '').trim();
                discountType = formData.get('discountType') || formData.get('type') || 'percentage';
                discountValue = parseFloat(formData.get('discountValue') || formData.get('value') || 0);
                minOrderValue = parseFloat(formData.get('minOrderValue') || formData.get('minOrder') || 0) || 0;
                usageLimit = formData.get('usageLimit') || formData.get('limit');
                usageLimit = usageLimit ? parseInt(usageLimit, 10) : 0;
                startDate = formData.get('startDate');
                endDate = formData.get('endDate');
                campaignType = formData.get('type') || 'marketing';
            } else {
                title = (formData.title || formData.name || '').trim();
                code = (formData.code || '').trim().toUpperCase();
                description = (formData.description || '').trim();
                discountType = formData.discountType || formData.type || 'percentage';
                discountValue = parseFloat(formData.discountValue || formData.value || 0);
                minOrderValue = parseFloat(formData.minOrderValue || formData.minOrderAmount || 0) || 0;
                usageLimit = parseInt(formData.usageLimit || formData.limit || 0, 10);
                startDate = formData.startDate;
                endDate = formData.endDate;
                campaignType = formData.campaignType || formData.type || 'marketing';
            }

            // Normalization
            let normalizedType = 'percentage';
            const lowerType = String(discountType).toLowerCase();
            if (lowerType === 'fixed' || lowerType === 'fixed_amount' || lowerType === 'fixedamount') {
                normalizedType = 'fixed';
            } else if (lowerType === 'free_delivery' || lowerType === 'free-delivery' || lowerType === 'freedelivery') {
                normalizedType = 'freeDelivery';
            } else if (lowerType === 'percentage') {
                normalizedType = 'percentage';
            }

            // Validation
            if (!title) throw new Error('Campaign title is required');
            if (!code) throw new Error('Promo code is required');
            if (normalizedType !== 'freeDelivery' && (isNaN(discountValue) || discountValue <= 0)) {
                throw new Error('Valid discount value is required');
            }
            if (!startDate || !endDate) throw new Error('Start and end dates are required');
            if (new Date(endDate) <= new Date(startDate)) {
                throw new Error('End date must be after start date');
            }

            if (normalizedType === 'percentage' && discountValue > 100) throw new Error('Percentage must not exceed 100.');
            const field = name => formData instanceof FormData ? formData.get(name) : formData[name];
            const checked = name => formData instanceof FormData ? formData.has(name) : formData[name] === true;
            const regionId = field('targetRegionId') || '';
            const region = regionId ? this.regionPicker?.regions.find(r => r.id === regionId) : null;
            if (regionId && !region) throw new Error('Choose a location from your existing regions.');
            const segment = field('customerSegment') || 'all';
            const active = checked('isActive');
            const campaignData = {
                title: title,
                name: title,
                code: code,
                description: description,
                imageKey: field('imageKey') || '',
                type: normalizedType,
                discountType: normalizedType,
                campaignType: campaignType,
                value: normalizedType === 'freeDelivery' ? 0 : discountValue,
                discountValue: normalizedType === 'freeDelivery' ? 0 : discountValue,
                minOrderValue: minOrderValue,
                minOrderAmount: minOrderValue,
                startDate: startDate,
                endDate: endDate,
                validFrom: startDate,
                validTo: endDate,
                usageLimit: usageLimit,
                limit: usageLimit,
                status: active ? 'active' : 'draft',
                isActive: active,
                autoActivate: active,
                targetRegionIds: region ? [region.id] : [],
                targetLocation: region?.label || '',
                target: region?.label || 'All regions',
                customerSegments: [segment],
                singleUse: checked('singleUse'),
                stackable: checked('stackable'),
                applicableToAll: !region && segment === 'all',
                ...(this.editingCampaignId ? {} : { discountSource: 'campaign' })
            };

            if (!window.dataService) {
                throw new Error('DataService is not available');
            }

            const fingerprint = JSON.stringify({ id: this.editingCampaignId, campaignData });
            if (this.saveFingerprint !== fingerprint || !this.saveRequestId) {
                this.saveRequestId = crypto.randomUUID();
                this.saveFingerprint = fingerprint;
            }
            const result = this.editingCampaignId
                ? await window.dataService.updateCampaign(this.editingCampaignId, campaignData)
                : await window.dataService.createCampaign({ ...campaignData, campaignId: 'campaign_' + this.saveRequestId, requestId: this.saveRequestId });

            if (!result || result.success === false) throw new Error(result?.error || 'Campaign was not saved. Please try again.');
            let pushMessage = '';
            if (checked('sendPushNotification')) {
                try {
                    const push = await window.dataService.notifyCampaignCustomers(result.discountId || result.campaignId || this.editingCampaignId, {
                        title: String(field('notificationTitle') || '').trim(),
                        body: String(field('notificationMessage') || '').trim(),
                    });
                    if(push.notificationStatus==='NO_RECIPIENTS'){
                        pushMessage=' لم يُرسل إشعار: لا توجد أجهزة زبائن مؤهلة لهذا العرض.'+(push.firstOrderOnly?' الحملة للطلب الأول فقط وتستبعد من لديهم طلب سابق.':'');
                    }else if(push.counts?.failuresByCode?.['messaging/third-party-auth-error']||push.counts?.failuresByCode?.['messaging/invalid-apns-credentials']){
                        pushMessage=' تعذر إرسال إشعارات iOS: مفتاح Apple APNs في Firebase غير صالح أو غير مكتمل. بعد تصحيح الإعدادات يمكنك إعادة الحفظ مع تفعيل الإشعارات للمحاولة مجددًا.';
                    }else if(push.notificationStatus==='SENT'){
                        pushMessage=' قبلت خدمة الإشعارات الإرسال إلى '+(push.counts?.sent??0)+' جهاز زبون.';
                    }else{
                        pushMessage=' حالة إشعار الزبائن: '+({QUEUED:'في انتظار الإرسال',SENDING:'جارٍ الإرسال',PARTIAL:'إرسال جزئي',FAILED:'فشل الإرسال',CANCELLED:'ملغى',NOT_REQUESTED:'لم يُطلب الإرسال'}[push.notificationStatus]||push.notificationStatus);
                    }
                } catch (pushError) {
                    pushMessage = ' حُفظت الحملة، لكن لم يُطلب الإشعار: ' + pushError.message;
                }
            }


            this.isSaving = false;
            this.closeCampaignModal();
            this.showSuccess(`الحملة «${title}» بنجاح.`);
            await this.loadCampaigns();
            return result;

        } catch (error) {
            console.error('Error saving campaign:', error);
            if (status) { status.hidden = false; status.dataset.state = 'error'; status.textContent = error.message || "تعذّر حفظ الحملة. يرجى إعادة المحاولة."; }
            throw error;
        } finally {
            this.isSaving = false;
            if (submit) submit.disabled = false;
        }
    }

    // Edit an existing campaign
    async editCampaign(campaignId) {
        try {
            console.log(`✏️ Editing campaign: ${campaignId}`);
            let campaign = this.campaigns.find(c => (c.discountId === campaignId || c.campaignId === campaignId || c.id === campaignId));

            if (!campaign && window.dataService?.getCampaignById) {
                campaign = await window.dataService.getCampaignById(campaignId);
            }

            if (!campaign) {
                throw new Error(`Campaign ${campaignId} not found`);
            }

            this.editingCampaignId = campaignId;

            // Populate form fields
            const form = document.getElementById('simplifiedCampaignForm');
            if (!form) return;

            const setVal = (id, val) => {
                const el = document.getElementById(id) || form.querySelector(`[name="${id}"]`);
                if (el) el.value = val ?? '';
            };

            setVal('campaign_title', campaign.title || campaign.name || '');
            setVal('campaign_code', campaign.code || '');
            setVal('campaign_type', campaign.campaignType || campaign.type || 'marketing');
            setVal('campaign_customerSegment', campaign.customerSegments?.[0] || 'all');
            for (const name of ['isActive', 'singleUse', 'stackable']) {
                const input = form.elements.namedItem(name);
                if (input) input.checked = campaign[name] === true;
            }
            await this.regionPicker.load();
            this.regionPicker.select(campaign.targetRegionIds?.[0] || '');
            setVal('campaign_description', campaign.description || '');
            await window.CampaignImage?.load(campaignId);

            const rawType = campaign.discountType || campaign.type;
            const typeVal = (rawType === 'freeDelivery' || rawType === 'free_delivery') ? 'free-delivery' :
                            (rawType === 'fixed' || rawType === 'fixed_amount') ? 'fixed' : 'percentage';
            setVal('campaign_discountType', typeVal);
            setVal('campaign_discountValue', campaign.discountValue ?? campaign.value ?? 0);
            setVal('campaign_minOrderValue', campaign.minOrderValue ?? campaign.minOrderAmount ?? 0);
            setVal('campaign_usageLimit', campaign.usageLimit || campaign.limit || '');

            // Format dates (YYYY-MM-DD)
            const fmtDate = (d) => {
                if (!d) return '';
                try { return new Date(d).toISOString().split('T')[0]; } catch (_) { return d; }
            };
            setVal('campaign_startDate', fmtDate(campaign.startDate || campaign.validFrom));
            setVal('campaign_endDate', fmtDate(campaign.endDate || campaign.validTo));

            // Update modal header and submit button
            const header = document.querySelector('#simplifiedCampaignModal .modal-header h2');
            if (header) {
                header.innerHTML = '<i class="fas fa-edit material-3-icon"></i> Edit Campaign';
            }
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.textContent = "تحديث الحملة";
            }

            this.openCampaignModal(false);

        } catch (error) {
            console.error('❌ Error preparing edit modal:', error);
            this.showError(`تعذّر تعديل الحملة: ${window.WizzLocale.error(error.message)}`);
        }
    }

    // Toggle active / inactive status
    async toggleStatus(campaignId) {
        try {
            const campaign = this.campaigns.find(c => (c.discountId === campaignId || c.campaignId === campaignId || c.id === campaignId));
            if (!campaign) return;

            const currentStatus = (campaign.status || (campaign.isActive ? 'active' : 'draft')).toLowerCase();
            const newStatus = currentStatus === 'active' ? 'draft' : 'active';
            const newActive = newStatus === 'active';

            if (!confirm(`هل تريد ${newActive ? "تفعيل" : "تعطيل"} "${campaign.title || campaign.name}"?`)) {
                return;
            }

            this.showLoading(`${newActive ? "جارٍ التفعيل" : "جارٍ إلغاء التفعيل"} عنوان الحملة...`);

            if (window.dataService?.updateCampaign) {
                await window.dataService.updateCampaign(campaignId, {
                    status: newStatus,
                    isActive: newActive
                });
            }

            this.showSuccess(`الحملة «${campaign.title || campaign.name}» الآن ${newStatus}!`);
            await this.loadCampaigns();

        } catch (error) {
            this.hideLoading();
            console.error('❌ Error toggling campaign status:', error);
            this.showError(`تعذّر تحديث الحالة: ${window.WizzLocale.error(error.message)}`);
        }
    }

    // Delete a campaign from DynamoDB
    async deleteCampaign(campaignId) {
        try {
            const campaign = this.campaigns.find(c => (c.discountId === campaignId || c.campaignId === campaignId || c.id === campaignId));
            const name = campaign ? (campaign.title || campaign.name) : campaignId;

            if (!confirm(`هل تريد حذف الحملة «${name}»؟ لا يمكن التراجع عن هذا الإجراء.`)) {
                return;
            }

            this.showLoading("جارٍ حذف الحملة...");

            if (window.dataService && typeof window.dataService.deletePlatformDiscount === 'function') {
                await window.dataService.deletePlatformDiscount(campaignId);
            } else if (window.dataService && typeof window.dataService.deleteCampaign === 'function') {
                await window.dataService.deleteCampaign(campaignId);
            } else {
                throw new Error('Delete method not available on dataService');
            }

            this.showSuccess(`الحملة «${name}" حُذف بنجاح.`);
            await this.loadCampaigns();

        } catch (error) {
            this.hideLoading();
            console.error('❌ Error deleting campaign:', error);
            this.showError(`تعذّر حذف الحملة: ${window.WizzLocale.error(error.message)}`);
        }
    }

    // Helper methods
    formatType(type) {
        switch (type) {
            case 'percentage': return 'Percentage';
            case 'fixed':
            case 'fixed_amount': return 'Fixed Amount';
            case 'freeDelivery':
            case 'free_delivery':
            case 'free-delivery': return 'Free Delivery';
            default: return type || 'Discount';
        }
    }

    formatDiscount(type, value) {
        if (type === 'freeDelivery' || type === 'free_delivery' || type === 'free-delivery') {
            return 'Free Delivery';
        }
        if (type === 'percentage') {
            return `${value}% OFF`;
        }
        return `${Number(value || 0).toLocaleString()} IQD OFF`;
    }

    formatDateRange(startDate, endDate) {
        if (!startDate || !endDate) return 'Always';
        try {
            const start = new Date(startDate).toLocaleDateString("ar-IQ", { month: 'short', day: 'numeric', year: 'numeric' });
            const end = new Date(endDate).toLocaleDateString("ar-IQ", { month: 'short', day: 'numeric', year: 'numeric' });
            return `${start} - ${end}`;
        } catch (_) {
            return `${startDate} - ${endDate}`;
        }
    }

    updateCampaignStats() {
        const totalElement = document.getElementById('campaigns-total') || document.getElementById('totalCampaigns');
        if (totalElement) {
            totalElement.textContent = this.campaigns.length;
        }
        const activeElement = document.getElementById('campaigns-active') || document.getElementById('activeCampaigns');
        if (activeElement) {
            const activeCount = this.campaigns.filter(c => (c.status === 'active' || c.isActive === true)).length;
            activeElement.textContent = activeCount;
        }
    }

    // Setup event listeners
    setupEventListeners() {
        const form = document.getElementById('simplifiedCampaignForm');
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                try { await this.createCampaign(new FormData(form)); }
                catch (_) { /* The inline save status owns error reporting. */ }
            };
        }

        const createBtn = document.getElementById('createCampaignBtn');
        if (createBtn) {
            createBtn.onclick = () => this.openCampaignModal(true);
        }

        const closeBtn = document.getElementById('closeCampaignModal');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeCampaignModal();
        }

        const refreshBtn = document.getElementById('refreshCampaigns');
        if (refreshBtn) {
            refreshBtn.onclick = () => this.loadCampaigns();
        }
    }

    // Modal management
    openCampaignModal(reset = true) {
        const modal = document.getElementById('simplifiedCampaignModal');
        if (modal) {
            if (this.isSaving || window.CampaignImage?.uploading) return;
            this.regionPicker?.load();
            if (reset) {
                this.resetForm();
            }
            modal.style.display = 'flex';
        }
    }

    closeCampaignModal() {
        if (this.isSaving || window.CampaignImage?.uploading) return;
        const modal = document.getElementById('simplifiedCampaignModal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.resetForm();
    }

    resetForm() {
        if (this.isSaving || window.CampaignImage?.uploading) return;
        this.regionPicker?.reset();
        const saveStatus = document.getElementById('campaign_saveStatus');
        if (saveStatus) saveStatus.hidden = true;
        this.editingCampaignId = null;
        window.CampaignImage?.reset();
        this.saveFingerprint = null;
        this.saveRequestId = null;
        const form = document.getElementById('simplifiedCampaignForm');
        if (form) {
            form.reset();
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.textContent = "إنشاء حملة";
            }
        }
        const header = document.querySelector('#simplifiedCampaignModal .modal-header h2');
        if (header) {
            header.innerHTML = '<i class="fas fa-rocket material-3-icon"></i> Create Campaign';
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimplifiedCampaignManager;
}
