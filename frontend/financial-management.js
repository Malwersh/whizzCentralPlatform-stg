/**
 * Financial Management JavaScript
 * Handles commission rules, delivery fees, and financial reporting
 */

class FinancialManager {
    constructor() {
        this.apiBaseUrl = this.detectAPIEndpoint();
        this.commissionRules = [];
        this.deliveryFeeRules = [];
        this.currentTab = 'overview';
        
        this.init();
    }

    detectAPIEndpoint() {
        // Try to detect API endpoint from various sources
        if (window.WIZZCENTRAL_CONFIG?.API_BASE_URL) {
            return window.WIZZCENTRAL_CONFIG.API_BASE_URL;
        }
        
        if (localStorage.getItem('wizzcentral_api_endpoint')) {
            return localStorage.getItem('wizzcentral_api_endpoint');
        }
        
        // Default development endpoint
        return window.location.origin;
    }

    async init() {
        console.log('🏦 Initializing Financial Manager...');
        
        this.setupEventListeners();
        await this.loadInitialData();
        this.setupTabs();
        
        console.log('✅ Financial Manager initialized');
    }

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Commission form
        const commissionForm = document.getElementById('commission-form');
        if (commissionForm) {
            commissionForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createCommissionRule();
            });
        }

        // Delivery fee form
        const deliveryForm = document.getElementById('delivery-fee-form');
        if (deliveryForm) {
            deliveryForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createDeliveryFeeRule();
            });
        }

        // Commission type change
        const commissionType = document.getElementById('commission-type');
        if (commissionType) {
            commissionType.addEventListener('change', () => {
                this.updateCommissionRatesFields();
            });
        }

        // Delivery fee type change
        const deliveryFeeType = document.getElementById('delivery-fee-type');
        if (deliveryFeeType) {
            deliveryFeeType.addEventListener('change', () => {
                this.updateDeliveryRatesFields();
            });
        }

        const loadBtn = document.getElementById('loadMerchantRulesBtn');
        if (loadBtn && !loadBtn._bound) {
            loadBtn.addEventListener('click', () => {
                const mid = document.getElementById('commission-rules-merchant').value.trim();
                this.loadCommissionRulesForMerchant(mid);
            });
            loadBtn._bound = true;
        }

        const searchBtn = document.getElementById('merchant-search-btn');
        const searchInput = document.getElementById('merchant-search');
        const resultsBox = document.getElementById('merchant-search-results');
        const merchantIdInput = document.getElementById('commission-merchant-id');
        // Merchant search enhancements
        this._merchantSearchCache = { raw: [], query: '' }; // cache last raw result set
        this._merchantActiveIndex = -1;
        const renderResults = (list, term) => {
            if (!list.length) {
                resultsBox.innerHTML = "<div style=\"padding:10px;font-size:0.8rem;color:#6c757d;\">لا توجد نتائج مطابقة</div>";
                return;
            }
            const esc = s => s.replace(/[.*+?^${}()|[\\]\\]/g, r => `\\${r}`);
            const re = term ? new RegExp(`(${esc(term)})`, 'ig') : null;
            resultsBox.innerHTML = list.map((m,i) => {
                const name = (m.name || '').replace(re, '<mark>$1</mark>');
                const nameAr = (m.name_ar || '').replace(re, '<mark>$1</mark>');
                const email = (m.email || '').replace(re, '<mark>$1</mark>');
                const loc = (m.location || '').replace(re, '<mark>$1</mark>');
                return `<div class="merchant-result-item" data-idx="${i}" data-id="${m.id}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #eee;">
                    <div style="font-weight:600;font-size:0.8rem;">${name || "(دون اسم)"} <span style="opacity:.7;">${nameAr}</span></div>
                    <div style="font-size:0.7rem;opacity:.75;">${email}</div>
                    <div style="font-size:0.7rem;opacity:.65;">${loc}</div>
                </div>`;
            }).join('');
            attachClickHandlers();
            updateActiveVisual();
        };
        const attachClickHandlers = () => {
            Array.from(resultsBox.querySelectorAll('.merchant-result-item')).forEach(el => {
                el.addEventListener('click', () => selectIndex(parseInt(el.dataset.idx,10)));
            });
        };
        const selectIndex = (idx) => {
            const list = this._merchantSearchCache.filtered || [];
            if (idx < 0 || idx >= list.length) return;
            const m = list[idx];
            merchantIdInput.value = m.id;
            resultsBox.style.display = 'none';
            resultsBox.innerHTML = '';
            this.showSuccess("تم اختيار المتجر");
        };
        const updateActiveVisual = () => {
            const nodes = resultsBox.querySelectorAll('.merchant-result-item');
            nodes.forEach((n,i) => {
                n.style.background = i === this._merchantActiveIndex ? 'rgba(0,194,232,0.12)' : '';
            });
        };
        const filterLocal = (term) => {
            const base = this._merchantSearchCache.raw;
            if (!term) return base.slice(0,25);
            const t = term.toLowerCase();
            return base.filter(m => [m.name,m.name_ar,m.email,m.location,m.id].some(v => (v||'').toLowerCase().includes(t))).slice(0,25);
        };
        const performRemoteFetch = async (q) => {
            resultsBox.style.display = 'block';
            resultsBox.innerHTML = "<div style=\"padding:10px;font-size:0.85rem;color:#6c757d;\">جارٍ البحث...</div>";
            try {
                const resp = await fetch(`${this.apiBaseUrl}/api/merchants/search?query=${encodeURIComponent(q)}`);
                const data = await resp.json();
                if (!data.success) {
                    resultsBox.innerHTML = "<div style=\"padding:10px;font-size:0.85rem;color:#b00020;\">تعذّر البحث</div>";
                    return;
                }
                this._merchantSearchCache.raw = data.data.merchants || [];
                this._merchantSearchCache.query = q;
                this._merchantSearchCache.filtered = filterLocal(q);
                renderResults(this._merchantSearchCache.filtered, q);
            } catch (e) {
                resultsBox.innerHTML = "<div style=\"padding:10px;font-size:0.85rem;color:#b00020;\">تعذّر البحث</div>";
            }
        };
        const liveFilter = (q) => {
            // Use cached raw results if current query is an extension of last remote query to reduce remote calls
            const last = this._merchantSearchCache.query || '';
            if (q.startsWith(last) && this._merchantSearchCache.raw.length) {
                this._merchantSearchCache.filtered = filterLocal(q);
                renderResults(this._merchantSearchCache.filtered, q);
            } else {
                performRemoteFetch(q);
            }
        };
        const handleInput = () => {
            const q = searchInput.value.trim();
            if (q.length < 2) {
                resultsBox.style.display = 'none';
                resultsBox.innerHTML = '';
                return;
            }
            this._merchantActiveIndex = -1;
            liveFilter(q);
        };
        const handleKeyDown = (e) => {
            if (resultsBox.style.display === 'none') return;
            const list = this._merchantSearchCache.filtered || [];
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._merchantActiveIndex = (this._merchantActiveIndex + 1) % list.length;
                updateActiveVisual();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._merchantActiveIndex = (this._merchantActiveIndex - 1 + list.length) % list.length;
                updateActiveVisual();
            } else if (e.key === 'Enter') {
                if (this._merchantActiveIndex >= 0) {
                    e.preventDefault();
                    selectIndex(this._merchantActiveIndex);
                }
            } else if (e.key === 'Escape') {
                resultsBox.style.display = 'none';
            }
        };
        const outsideClick = (e) => {
            if (!resultsBox.contains(e.target) && e.target !== searchInput) {
                resultsBox.style.display = 'none';
            }
        };
        if (searchBtn && !searchBtn._bound) {
            searchBtn.addEventListener('click', () => {
                const q = searchInput.value.trim();
                if (q.length >= 2) performRemoteFetch(q);
            });
            searchBtn._bound = true;
        }
        if (searchInput && !searchInput._bound2) {
            let t = null;
            searchInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(handleInput, 250); });
            searchInput.addEventListener('keydown', handleKeyDown);
            searchInput._bound2 = true;
        }
        if (!document._merchantOutsideBound) {
            document.addEventListener('click', outsideClick);
            document._merchantOutsideBound = true;
        }
    }

    async loadInitialData() {
        try {
            const merchantField = document.getElementById('commission-rules-merchant') || document.getElementById('commission-merchant-id');
            const presetMerchantId = merchantField ? merchantField.value.trim() : '';
            const tasks = [this.loadDeliveryFeeRules().catch(e=>({ _err:e })), this.loadFinancialSettings().catch(e=>({ _err:e }))];
            if (presetMerchantId) {
                tasks.push(this.loadCommissionRulesForMerchant(presetMerchantId).catch(e=>({ _err:e })));
            } else {
                this.commissionRules = [];
            }
            const results = await Promise.all(tasks);
            const failures = results.filter(r => r && r._err);
            // Avoid flashing an error if at least one critical load succeeded
            if (failures.length === results.length) {
                setTimeout(()=> this.showError("تعذّر تحميل البيانات المالية."), 200);
            }
            this.updateOverviewMetrics();
        } catch (error) {
            console.error('❌ Error loading initial data:', error);
            setTimeout(()=> this.showError("تعذّر تحميل البيانات المالية."), 200);
        }
    }

    async loadCommissionRules() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/commissions`);
            const data = await response.json();
            
            if (data.success) {
                this.commissionRules = data.data.rules;
                this.renderCommissionRules();
                console.log('✅ Loaded commission rules:', this.commissionRules.length);
            }
        } catch (error) {
            console.error('❌ Error loading commission rules:', error);
            throw error;
        }
    }

    async loadCommissionRulesForMerchant(merchantId) {
        if (!merchantId) {
            this.showError("أدخل معرّف المتجر");
            return;
        }
        const container = document.getElementById('commission-rules-list');
        container.innerHTML = "<div class=\"loading-spinner\">جارٍ تحميل قواعد العمولة...</div>";
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/commissions?merchantId=${encodeURIComponent(merchantId)}`);
            const data = await response.json();
            if (!data.success) {
                container.innerHTML = "<p style=\"padding:20px;text-align:center;color:#b00020;\">تعذّر تحميل القواعد.</p>";
                return;
            }
            this.commissionRules = data.data.rules || [];
            this.renderCommissionRules();
        } catch (e) {
            container.innerHTML = "<p style=\"padding:20px;text-align:center;color:#b00020;\">تعذّر تحميل القواعد</p>";
        }
    }

    async loadDeliveryFeeRules() { this.deliveryFeeRules=[]; }

    async loadFinancialSettings() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/financial-settings`);
            const data = await response.json();
            if (data.success) {
                this.financialSettings = data.data;
                // populate UI
                const c = document.getElementById('default-currency'); if (c) c.value = this.financialSettings.defaultCurrency || 'IQD';
                const t = document.getElementById('tax-rate'); if (t) t.value = this.financialSettings.taxRate ?? 0;
                const ac = document.getElementById('auto-calculate-commission'); if (ac) ac.checked = !!this.financialSettings.autoCalculateCommission;
                const dd = document.getElementById('dynamic-delivery-fees'); if (dd) dd.checked = !!this.financialSettings.dynamicDeliveryFees;
                console.log('✅ Loaded financial settings:', this.financialSettings);
            }
        } catch (error) {
            console.error('❌ Error loading financial settings:', error);
        }
    }

    updateOverviewMetrics() {
        const totalCommissionRules = this.commissionRules.length;
        const activeCommissionRules = this.commissionRules.filter(r => r.isActive).length;
        const totalDeliveryRules = this.deliveryFeeRules.length;
        const activeDeliveryRules = this.deliveryFeeRules.filter(r => r.isActive).length;

        document.getElementById('total-commission-rules').textContent = totalCommissionRules;
        document.getElementById('active-commission-rules').textContent = activeCommissionRules;
        document.getElementById('total-delivery-rules').textContent = totalDeliveryRules;
        document.getElementById('active-delivery-rules').textContent = activeDeliveryRules;
    }

    setupTabs() {
        // Set default date values
        const today = new Date();
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
        const start = document.getElementById('report-start-date');
        const end = document.getElementById('report-end-date');
        if (start) start.value = lastMonth.toISOString().split('T')[0];
        if (end) end.value = today.toISOString().split('T')[0];

        // Reports scope toggle & region loading
        const scopeSel = document.getElementById('report-scope');
        const merchantGroup = document.getElementById('report-merchant-group');
        const regionGroup = document.getElementById('report-region-group');
        const runBtn = document.getElementById('run-report-btn');
        const regionSel = document.getElementById('report-region');
        if (scopeSel && !scopeSel._bound) {
            scopeSel.addEventListener('change', ()=>{
                const isRegion = scopeSel.value === 'region';
                merchantGroup.style.display = isRegion ? 'none' : 'block';
                regionGroup.style.display = isRegion ? 'block' : 'none';
            });
            scopeSel._bound = true;
        }
        if (runBtn && !runBtn._bound) {
            runBtn.addEventListener('click', ()=> this.runReport());
            runBtn._bound = true;
        }
        // Load regions for selector
        if (regionSel && !regionSel._loaded) {
            this.loadRegionsForReports();
        }
    }

    async loadRegionsForReports() {
        try {
            const sel = document.getElementById('report-region');
            if (!sel) return;
            const url = `${this.apiBaseUrl}/api/regions?pageMode=server&limit=100&is_active=true`;
            const resp = await fetch(url);
            const data = await resp.json();
            const items = data.items || data.data?.items || [];
            sel.innerHTML = "<option value=\"\">اختر المنطقة...</option>" + items.map(r=>`<option value="${r.regionId}">${r.name} (${r.level})</option>`).join('');
            sel._loaded = true;
        } catch(e) {
            console.warn('Failed to load regions', e);
            const sel = document.getElementById('report-region');
            if (sel) sel.innerHTML = "<option value=\"\">تعذّر تحميل المناطق.</option>";
        }
    }

    async runReport() {
        const scope = document.getElementById('report-scope').value;
        const start = document.getElementById('report-start-date').value;
        const end = document.getElementById('report-end-date').value;
        if (!start || !end) { this.showError("اختر تاريخ البدء وتاريخ الانتهاء."); return; }
        if (scope === 'region') {
            const regionId = document.getElementById('report-region').value;
            if (!regionId) { this.showError("اختر منطقة"); return; }
            await this.generateRegionReport({ regionId, start, end });
        } else {
            await this.generateReport();
        }
    }

    async generateRegionReport({ regionId, start, end }) {
        const container = document.getElementById('report-results');
        container.innerHTML = "<div class=\"loading-spinner\" style=\"display:block;\">جارٍ تحميل تقرير المنطقة...</div>";
        try {
            const url = `${this.apiBaseUrl}/api/region-financials?regionId=${encodeURIComponent(regionId)}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (!data.success) { container.innerHTML = `<div class="error-message">${data.error || "تعذّر تحميل تقرير المنطقة."}</div>`; return; }
            const d = data.data;
            const rows = d.merchants || [];
            const totals = d.financialTotals || {};

            const table = `
                <div style="margin-bottom:10px;color:#6c757d;">المنطقة: <b>${d.region?.name || regionId}</b> · Period: ${new Date(d.period.startDate).toLocaleDateString()} → ${new Date(d.period.endDate).toLocaleDateString()}</div>
                <div style="overflow:auto;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f8f9fa;">
                            <th style="text-align:left;padding:10px;border-bottom:1px solid #eaecef;">المتجر</th>
                            <th style="text-align:right;padding:10px;border-bottom:1px solid #eaecef;">إجمالي الطلبات</th>
                            <th style="text-align:right;padding:10px;border-bottom:1px solid #eaecef;">مؤكد</th>
                            <th style="text-align:right;padding:10px;border-bottom:1px solid #eaecef;">ملغى</th>
                            <th style="text-align:right;padding:10px;border-bottom:1px solid #eaecef;">مرتجع</th>
                            <th style="text-align:right;padding:10px;border-bottom:1px solid #eaecef;">إجمالي الإيرادات</th>
                            <th style="text-align:right;padding:10px;border-bottom:1px solid #eaecef;">العمولات المحصّلة</th>
                            <th style="text-align:right;padding:10px;border-bottom:1px solid #eaecef;">نسبة العمولة %</th>
                            <th style="text-align:right;padding:10px;border-bottom:1px solid #eaecef;">مساهمة التوصيل</th>
                            <th style="text-align:right;padding:10px;border-bottom:1px solid #eaecef;">صافي مستحقات المتجر</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length ? rows.map(r=>`
                            <tr>
                                <td style="padding:8px 10px;border-bottom:1px solid #f1f3f4;">${r.name} <span style="opacity:.6;">(${r.merchantId})</span><div style="font-size:0.75rem;opacity:.7;">${r.city||''} ${r.district?('· '+r.district):''}</div></td>
                                <td style="text-align:right;padding:8px 10px;border-bottom:1px solid #f1f3f4;">${r.totals.totalOrders}</td>
                                <td style="text-align:right;padding:8px 10px;border-bottom:1px solid #f1f3f4;">${r.totals.confirmedOrders}</td>
                                <td style="text-align:right;padding:8px 10px;border-bottom:1px solid #f1f3f4;">${r.totals.canceledOrders}</td>
                                <td style="text-align:right;padding:8px 10px;border-bottom:1px solid #f1f3f4;">${r.totals.returnedOrders}</td>
                                <td style="text-align:right;padding:8px 10px;border-bottom:1px solid #f1f3f4;">${(r.financial.grossRevenue||0).toLocaleString()} IQD</td>
                                <td style="text-align:right;padding:8px 10px;border-bottom:1px solid #f1f3f4;">${(r.financial.commissionCollected||0).toLocaleString()} IQD</td>
                                <td style="text-align:right;padding:8px 10px;border-bottom:1px solid #f1f3f4;">${r.financial.commissionPercent||0}%</td>
                                <td style="text-align:right;padding:8px 10px;border-bottom:1px solid #f1f3f4;">${(r.financial.deliveryFees||0).toLocaleString()} IQD</td>
                                <td style="text-align:right;padding:8px 10px;border-bottom:1px solid #f1f3f4;">${(r.financial.netToMerchant||0).toLocaleString()} IQD</td>
                            </tr>
                        `).join('') : `<tr><td colspan="10" style="text-align:center;padding:20px;color:#6c757d;">لا توجد متاجر في المنطقة أو عمليات خلال الفترة المحددة.</td></tr>`}
                    </tbody>
                    <tfoot>
                        <tr style="background:#f8f9fa;font-weight:600;">
                            <td style="padding:10px;border-top:1px solid #eaecef;">الإجماليات</td>
                            <td style="text-align:right;padding:10px;border-top:1px solid #eaecef;">${(d.totals?.totalOrders)||0}</td>
                            <td style="text-align:right;padding:10px;border-top:1px solid #eaecef;">${(d.totals?.confirmedOrders)||0}</td>
                            <td style="text-align:right;padding:10px;border-top:1px solid #eaecef;">${(d.totals?.canceledOrders)||0}</td>
                            <td style="text-align:right;padding:10px;border-top:1px solid #eaecef;">${(d.totals?.returnedOrders)||0}</td>
                            <td style="text-align:right;padding:10px;border-top:1px solid #eaecef;">${(totals.grossRevenue||0).toLocaleString()} IQD</td>
                            <td style="text-align:right;padding:10px;border-top:1px solid #eaecef;">${(totals.commissionCollected||0).toLocaleString()} IQD</td>
                            <td style="text-align:right;padding:10px;border-top:1px solid #eaecef;">${(totals.commissionPercent||0)}%</td>
                            <td style="text-align:right;padding:10px;border-top:1px solid #eaecef;">${(totals.deliveryFees||0).toLocaleString()} IQD</td>
                            <td style="text-align:right;padding:10px;border-top:1px solid #eaecef;">${(totals.netToMerchant||0).toLocaleString()} IQD</td>
                        </tr>
                    </tfoot>
                </table>
                </div>
            `;
            container.innerHTML = table;
        } catch (e) {
            container.innerHTML = "<div class=\"error-message\">تعذّر تحميل تقرير المنطقة.</div>";
        }
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');

        this.currentTab = tabName;
        console.log(`📑 Switched to ${tabName} tab`);
    }

    async createCommissionRule() {
        try {
            const merchantId = document.getElementById('commission-merchant-id').value.trim();
            if (!merchantId) {
                this.showError("معرّف المتجر مطلوب.");
                return;
            }
            const effFromStr = document.getElementById('commission-effective-from').value;
            const effToStr = document.getElementById('commission-effective-to').value;
            const effectiveFrom = effFromStr ? new Date(effFromStr).getTime() : Date.now();
            const effectiveTo = effToStr ? new Date(effToStr).getTime() : null;
            if (effectiveTo && effectiveTo <= effectiveFrom) {
                this.showError("يجب أن يكون تاريخ الانتهاء بعد تاريخ بدء السريان.");
                return;
            }
            const formData = {
                ruleName: document.getElementById('commission-name').value.trim() || `Commission for ${merchantId}`,
                merchantId,
                ruleType: document.getElementById('commission-type').value,
                isActive: document.getElementById('commission-active').checked,
                priority: parseInt(document.getElementById('commission-priority').value) || 1,
                rates: this.getCommissionRates(),
                effectiveFrom,
                effectiveTo
            };
            const response = await fetch(`${this.apiBaseUrl}/api/commissions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await response.json();
            if (data.success) {
                this.showSuccess("أُنشئت قاعدة العمولة.");
                document.getElementById('commission-form').reset();
                // Preserve merchantId for convenience
                document.getElementById('commission-merchant-id').value = merchantId;
                await this.loadCommissionRulesForMerchant(merchantId);
            } else {
                this.showError(data.error || "تعذّر إنشاء قاعدة العمولة.");
            }
        } catch (error) {
            this.showError("تعذّر إنشاء قاعدة العمولة.");
        }
    }

    getCommissionRates() {
        const type = document.getElementById('commission-type').value;
        const rates = { currency: 'IQD' };

        switch (type) {
            case 'percentage':
                rates.percentage = parseFloat(document.getElementById('commission-percentage').value) || 0;
                break;
            case 'flat_fee':
                rates.flatFee = parseFloat(document.getElementById('commission-flat-fee').value) || 0;
                break;
            case 'hybrid':
                rates.percentage = parseFloat(document.getElementById('commission-percentage').value) || 0;
                rates.flatFee = parseFloat(document.getElementById('commission-flat-fee').value) || 0;
                break;
            case 'tiered':
                // For now, use default tiered structure
                rates.tiers = [
                    { minValue: 0, maxValue: 10000000, percentage: 15.0 },
                    { minValue: 10000000, maxValue: 50000000, percentage: 12.0 },
                    { minValue: 50000000, maxValue: null, percentage: 10.0 }
                ];
                break;
        }

        return rates;
    }

    createDeliveryFeeRule() { window.location.assign("/pages/delivery-pricing.html"); }

    getDeliveryRates() {
        const rates = {
            currency: 'IQD',
            baseFee: parseFloat(document.getElementById('delivery-base-fee').value) || 0,
            perKmRate: parseFloat(document.getElementById('delivery-per-km').value) || 0,
            minimumFee: parseFloat(document.getElementById('delivery-min-fee').value) || 0,
            maximumFee: parseFloat(document.getElementById('delivery-max-fee').value) || 0,
            freeDeliveryThreshold: parseFloat(document.getElementById('free-delivery-threshold').value) || 0
        };

        return rates;
    }

    updateCommissionRatesFields() {
        const type = document.getElementById('commission-type').value;
        const percentageField = document.getElementById('commission-percentage').parentElement;
        const flatFeeField = document.getElementById('commission-flat-fee').parentElement;

        // Reset visibility
        percentageField.style.display = 'block';
        flatFeeField.style.display = 'block';

        switch (type) {
            case 'percentage':
                flatFeeField.style.display = 'none';
                break;
            case 'flat_fee':
                percentageField.style.display = 'none';
                break;
            case 'tiered':
                percentageField.style.display = 'none';
                flatFeeField.style.display = 'none';
                break;
            case 'hybrid':
                // Show both
                break;
        }
    }

    updateDeliveryRatesFields() {
        const type = document.getElementById('delivery-fee-type').value;
        const baseField = document.getElementById('delivery-base-fee').parentElement;
        const perKmField = document.getElementById('delivery-per-km').parentElement;

        switch (type) {
            case 'flat':
                perKmField.style.display = 'none';
                break;
            case 'distance_based':
                baseField.style.display = 'block';
                perKmField.style.display = 'block';
                break;
            default:
                baseField.style.display = 'block';
                perKmField.style.display = 'block';
        }
    }

    renderCommissionRules() {
        const container = document.getElementById('commission-rules-list');
        if (!container) return;
        if (this.commissionRules.length === 0) {
            container.innerHTML = "<p style=\"text-align:center;color:#6c757d;padding:20px;\">لا توجد قواعد عمولة لهذا المتجر.</p>";
            return;
        }
        const now = Date.now();
        container.innerHTML = this.commissionRules.sort((a,b)=>a.priority-b.priority).map(rule => {
            const activeWindow = (rule.effectiveFrom && now >= rule.effectiveFrom) && (!rule.effectiveTo || now <= rule.effectiveTo);
            return `<div class="rule-item" data-id="${rule.ruleId}">
                <div class="rule-info">
                    <div class="rule-name">${rule.ruleName}</div>
                    <div class="rule-details">Type: ${rule.ruleType} | Priority: ${rule.priority} | Rate: ${this.formatCommissionRate(rule.rates)} | Window: ${rule.effectiveFrom ? new Date(rule.effectiveFrom).toLocaleDateString() : '—'} → ${rule.effectiveTo ? new Date(rule.effectiveTo).toLocaleDateString() : '∞'}</div>
                </div>
                <div class="rule-actions" style="display:flex;gap:6px;align-items:center;">
                    <span class="status-badge ${rule.isActive && activeWindow ? 'status-active' : 'status-inactive'}">${rule.isActive && activeWindow ? "نشط" : "غير نشط"}</span>
                    <button class="button-secondary" style="padding:6px 10px;font-size:0.7rem;" onclick="financialManager.editCommissionRule('${rule.ruleId}')">تعديل</button>
                    <button class="button-secondary" style="padding:6px 10px;font-size:0.7rem;border-color:#dc3545;color:#dc3545;" onclick="financialManager.deleteCommissionRule('${rule.ruleId}')">حذف</button>
                </div>
            </div>`;
        }).join('');
    }

    renderDeliveryFeeRules() {
        const container = document.getElementById('delivery-rules-list');
        if (this.deliveryFeeRules.length === 0) {
            container.innerHTML = "<p style=\"text-align: center; color: #6c757d; padding: 20px;\">لا توجد قواعد لرسوم التوصيل.</p>";
            return;
        }
        container.innerHTML = this.deliveryFeeRules.map(rule => `
            <div class="rule-item" data-id="${rule.ruleId}">
                <div class="rule-info">
                    <div class="rule-name">${rule.ruleName}</div>
                    <div class="rule-details">Type: ${rule.ruleType} | Region: ${rule.conditions?.regionId || '—'} | ${this.formatDeliveryRate(rule.rates)}</div>
                </div>
                <div class="rule-actions" style="display:flex;gap:6px;align-items:center;">
                    <span class="status-badge ${rule.isActive ? 'status-active' : 'status-inactive'}">${rule.isActive ? "نشط" : "غير نشط"}</span>
                    <button class="button-secondary" style="padding:6px 10px;font-size:0.7rem;" onclick="financialManager.editDeliveryRule('${rule.ruleId}')">تعديل</button>
                    <button class="button-secondary" style="padding:6px 10px;font-size:0.7rem;border-color:#dc3545;color:#dc3545;" onclick="financialManager.deleteDeliveryRule('${rule.ruleId}')">حذف</button>
                </div>
            </div>
        `).join('');
    }

    formatCommissionRate(rates) {
        if (rates.percentage && rates.flatFee) {
            return `${rates.percentage}% + ${rates.flatFee} IQD`;
        } else if (rates.percentage) {
            return `${rates.percentage}%`;
        } else if (rates.flatFee) {
            return `${rates.flatFee} IQD`;
        } else if (rates.tiers) {
            return `Tiered (${rates.tiers.length} tiers)`;
        }
        return 'Not configured';
    }

    formatDeliveryRate(rates) {
        if (rates.baseFee && rates.perKmRate) {
            return `${rates.baseFee} IQD + ${rates.perKmRate}/km`;
        } else if (rates.baseFee) {
            return `${rates.baseFee} IQD`;
        } else if (rates.zones) {
            return `Zone-based (${rates.zones.length} zones)`;
        }
        return 'Not configured';
    }

    async generateReport() {
        const reportType = document.getElementById('report-type').value;
        const startDate = document.getElementById('report-start-date').value;
        const endDate = document.getElementById('report-end-date').value;
        const merchantIdInput = document.getElementById('report-merchant-id');
        const merchantId = merchantIdInput ? merchantIdInput.value.trim() : '';
        if (!startDate || !endDate) { this.showError("اختر تاريخ البدء وتاريخ الانتهاء."); return; }
        try {
            const params = new URLSearchParams({ startDate, endDate });
            if (merchantId) params.append('merchantId', merchantId);
            const url = `${this.apiBaseUrl}/api/financial-reports/${reportType}?${params.toString()}`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.success) { this.renderReportResults(data.data, reportType); this.showSuccess("أُعدّ التقرير بنجاح."); }
            else { this.showError(data.error || "تعذّر إعداد التقرير."); }
        } catch (error) {
            console.error('❌ Error generating report:', error); this.showError("تعذّر إعداد التقرير.");
        }
    }

    renderReportResults(reportData, reportType) {
        const container = document.getElementById('report-results');
        
        const html = `
            <div class="report-content">
                <h3>📊 ${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report</h3>
                <div class="report-period">
                    Period: ${reportData.period?.startDate} to ${reportData.period?.endDate}
                </div>
                
                <div class="metrics-grid" style="margin-top: 20px;">
                    ${this.generateReportMetrics(reportData, reportType)}
                </div>
                
                <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                    <small style="color: #6c757d;">
                        Generated at: ${new Date(reportData.generatedAt).toLocaleString()}
                    </small>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }

    generateReportMetrics(reportData, reportType) {
        switch (reportType) {
            case 'summary':
                return `
                    <div class="metric-card">
                        <div class="metric-value">${reportData.summary?.totalRevenue || 0} IQD</div>
                        <div class="metric-label">إجمالي الإيرادات</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${reportData.summary?.totalCommissions || 0} IQD</div>
                        <div class="metric-label">إجمالي العمولات</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${reportData.summary?.totalDeliveryFees || 0} IQD</div>
                        <div class="metric-label">إجمالي رسوم التوصيل</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${reportData.summary?.commissionsPercentage || 0}%</div>
                        <div class="metric-label">نسبة العمولة</div>
                    </div>
                `;
            case 'commission':
                return `
                    <div class="metric-card">
                        <div class="metric-value">${reportData.totalOrders || 0}</div>
                        <div class="metric-label">إجمالي الطلبات</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${reportData.totalCommissions || 0} IQD</div>
                        <div class="metric-label">إجمالي العمولات</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${reportData.averageCommissionRate || 0}%</div>
                        <div class="metric-label">متوسط النسبة</div>
                    </div>
                `;
            case 'delivery-fees':
                return `
                    <div class="metric-card">
                        <div class="metric-value">${reportData.totalDeliveries || 0}</div>
                        <div class="metric-label">إجمالي التوصيلات</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${reportData.totalDeliveryFees || 0} IQD</div>
                        <div class="metric-label">إجمالي الرسوم</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${reportData.averageDeliveryFee || 0} IQD</div>
                        <div class="metric-label">متوسط الرسوم</div>
                    </div>
                `;
            default:
                return "<div class=\"metric-card\"><div class=\"metric-value\">لا توجد بيانات</div></div>";
        }
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showMessage(message, type) {
        // Remove existing messages
        document.querySelectorAll('.success-message, .error-message').forEach(el => el.remove());
        const messageEl = document.createElement('div');
        messageEl.className = type === 'success' ? 'success-message' : 'error-message';
        messageEl.textContent = message;
        const activeTab = document.querySelector('.tab-content.active');
        activeTab.insertBefore(messageEl, activeTab.firstChild);
        setTimeout(() => { messageEl.remove(); }, 5000);
    }

    async saveSettings() {
        try {
            const payload = {
                defaultCurrency: document.getElementById('default-currency').value,
                taxRate: parseFloat(document.getElementById('tax-rate').value) || 0,
                autoCalculateCommission: document.getElementById('auto-calculate-commission').checked,
                dynamicDeliveryFees: document.getElementById('dynamic-delivery-fees').checked
            };
            const resp = await fetch(`${this.apiBaseUrl}/api/financial-settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await resp.json();
            if (!data.success) return this.showError(data.error || "تعذّر حفظ الإعدادات.");
            this.showSuccess("حُفظت الإعدادات.");
        } catch (e) { this.showError("تعذّر حفظ الإعدادات."); }
    }

    // Quick action methods
    async calculateSampleCommission() {
        const sampleOrder = {
            orderId: 'TEST_ORDER_' + Date.now(),
            totalAmount: 25000,
            merchantType: 'standard',
            itemCount: 3
        };

        try {
            const response = await fetch(`${this.apiBaseUrl}/api/commissions/calculate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    orderData: sampleOrder,
                    merchantId: 'TEST_MERCHANT'
                })
            });

            const data = await response.json();
            
            if (data.success) {
                const commission = data.data.commission;
                this.showSuccess(`قيمة العمولة التجريبية: ${commission.commissionAmount} IQD (${commission.appliedRate.percentage || 0}%)`);
            }
        } catch (error) {
            console.error('❌ Error calculating sample commission:', error);
            this.showError("تعذّر احتساب العمولة التجريبية.");
        }
    }

    calculateSampleDeliveryFee() { window.location.assign("/pages/delivery-pricing.html"); }

    editCommissionRule(ruleId) {
        const rule = this.commissionRules.find(r => r.ruleId === ruleId);
        if (!rule) return this.showError("لم يُعثر على القاعدة.");
        // Simple prompt-based editor
        const newName = prompt("اسم القاعدة:", rule.ruleName);
        if (newName === null) return; // cancel
        let isActive = prompt("هل تريد التفعيل؟ أدخل true للتفعيل أو false للإيقاف:", String(rule.isActive));
        if (isActive === null) return;
        isActive = isActive === 'true';
        const newPriorityStr = prompt("الأولوية (رقم):", String(rule.priority));
        if (newPriorityStr === null) return;
        const newPriority = parseInt(newPriorityStr) || rule.priority;
        const effFromStr = prompt("تاريخ بدء السريان بصيغة YYYY-MM-DD. اتركه فارغًا للإبقاء على التاريخ الحالي:", rule.effectiveFrom ? new Date(rule.effectiveFrom).toISOString().slice(0,10) : '');
        if (effFromStr === null) return;
        const effToStr = prompt("تاريخ انتهاء السريان بصيغة YYYY-MM-DD. اتركه فارغًا دون تاريخ انتهاء:", rule.effectiveTo ? new Date(rule.effectiveTo).toISOString().slice(0,10) : '');
        if (effToStr === null) return;
        const body = {
            ruleName: newName.trim() || rule.ruleName,
            isActive,
            priority: newPriority
        };
        if (effFromStr) body.effectiveFrom = new Date(effFromStr).getTime();
        if (effToStr) body.effectiveTo = new Date(effToStr).getTime(); else if (effToStr === '') body.effectiveTo = null;
        // Rates editing (basic)
        if (rule.ruleType === 'percentage' || rule.ruleType === 'hybrid') {
            const percStr = prompt("النسبة المئوية (%). اتركه فارغًا للإبقاء على القيمة الحالية:", rule.rates.percentage != null ? String(rule.rates.percentage) : '');
            if (percStr === null) return; if (percStr.trim() !== '') body.rates = { ...rule.rates, percentage: parseFloat(percStr) };
        }
        if (rule.ruleType === 'flat_fee' || rule.ruleType === 'hybrid') {
            const flatStr = prompt("المبلغ الثابت (د.ع). اتركه فارغًا للإبقاء على القيمة الحالية:", rule.rates.flatFee != null ? String(rule.rates.flatFee) : '');
            if (flatStr === null) return; if (flatStr.trim() !== '') body.rates = { ...(body.rates || rule.rates), flatFee: parseFloat(flatStr) };
        }
        fetch(`${this.apiBaseUrl}/api/commissions/${ruleId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        }).then(r=>r.json()).then(data => {
            if (!data.success) {
                this.showError(data.error || "تعذّر التحديث");
                if (data.conflicts) console.warn('Conflicts:', data.conflicts);
                return;
            }
            this.showSuccess("حُدّثت قاعدة العمولة.");
            const merchantId = document.getElementById('commission-merchant-id').value.trim();
            if (merchantId) this.loadCommissionRulesForMerchant(merchantId);
        }).catch(()=>this.showError("تعذّر التحديث"));
    }

    deleteCommissionRule(ruleId) {
        if (!confirm("هل تريد حذف قاعدة العمولة؟ سيُحتفظ بسجلها في النظام.")) return;
        fetch(`${this.apiBaseUrl}/api/commissions/${ruleId}`, { method: 'DELETE' })
            .then(r=>r.json()).then(data => {
                if (!data.success) return this.showError(data.error || "تعذّر الحذف");
                this.showSuccess("حُذفت قاعدة العمولة.");
                const merchantId = document.getElementById('commission-merchant-id').value.trim();
                if (merchantId) this.loadCommissionRulesForMerchant(merchantId);
            }).catch(()=>this.showError("تعذّر الحذف"));
    }

    editDeliveryRule() { window.location.assign("/pages/delivery-pricing.html"); }

    deleteDeliveryRule() { window.location.assign("/pages/delivery-pricing.html"); }
}

// Overview: Merchant Financial Explorer logic
(function(){
    const base = (window.financialManager && financialManager.apiBaseUrl) || '';
    const searchInput = document.getElementById('overview-merchant-search');
    const resultsBox = document.getElementById('overview-merchant-results');
    const startEl = document.getElementById('overview-start-date');
    const endEl = document.getElementById('overview-end-date');
    const loadBtn = document.getElementById('overview-load-btn');
    const resetBtn = document.getElementById('overview-reset-btn');
    const kpiGrid = document.getElementById('merchant-kpi-cards');
    const details = document.getElementById('merchant-financial-details');
    if (!searchInput || !resultsBox) return;

    // defaults: last 30 days
    const today = new Date();
    const endISO = today.toISOString().slice(0,10);
    const startISO = new Date(Date.now()-30*24*60*60*1000).toISOString().slice(0,10);
    if (startEl && !startEl.value) startEl.value = startISO;
    if (endEl && !endEl.value) endEl.value = endISO;

    let selectedMerchant = null;
    let cache = { raw: [], query: '' };

    const renderResults = (list, term) => {
        if (!list.length) { resultsBox.innerHTML = "<div style=\"padding:8px;color:#6c757d;\">لا توجد نتائج مطابقة</div>"; return; }
        const esc = s => s.replace(/[.*+?^${}()|[\\]\\]/g, r => `\\${r}`);
        const re = term ? new RegExp(`(${esc(term)})`, 'ig') : null;
        resultsBox.innerHTML = list.map(m => {
            const name = (m.name||'').replace(re,'<mark>$1</mark>');
            const email = (m.email||'').replace(re,'<mark>$1</mark>');
            return `<div class="merchant-result-item" data-id="${m.id}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #eee;">
                <div style="font-weight:600;font-size:0.85rem;">${name||"(دون اسم)"} <span style="opacity:.7;font-size:0.75rem;">${m.city||''}</span></div>
                <div style="font-size:0.75rem;opacity:.75;">${email}</div>
            </div>`;
        }).join('');
        resultsBox.style.display='block';
        Array.from(resultsBox.querySelectorAll('.merchant-result-item')).forEach(el=>{
            el.addEventListener('click', ()=>{
                selectedMerchant = cache.filtered.find(x=>x.id===el.dataset.id) || null;
                resultsBox.style.display='none'; resultsBox.innerHTML='';
                searchInput.value = selectedMerchant ? `${selectedMerchant.name} (${selectedMerchant.id})` : '';
                loadBtn.disabled = !selectedMerchant;
            });
        });
    };

    const filterLocal = (q) => {
        const baseList = cache.raw || [];
        const t = q.toLowerCase();
        return baseList.filter(m => [m.name,m.name_ar,m.email,m.city,m.district,m.id].some(v => (v||'').toLowerCase().includes(t))).slice(0,25);
    };

    const performRemoteFetch = async (q) => {
        resultsBox.style.display='block';
        resultsBox.innerHTML = "<div style=\"padding:8px;color:#6c757d;\">جارٍ البحث...</div>";
        try {
            const resp = await fetch(`${base}/api/merchants/search?query=${encodeURIComponent(q)}`);
            const data = await resp.json();
            cache.raw = (data.data && data.data.merchants) || [];
            cache.query = q;
            cache.filtered = filterLocal(q);
            renderResults(cache.filtered,q);
        } catch(e){
            resultsBox.innerHTML = "<div style=\"padding:8px;color:#b00020;\">خطأ</div>";
        }
    };

    searchInput.addEventListener('input', ()=>{
        const q = searchInput.value.trim();
        if (q.length < 2) { resultsBox.style.display='none'; resultsBox.innerHTML=''; return; }
        if (q.startsWith(cache.query||'') && (cache.raw||[]).length) {
            cache.filtered = filterLocal(q);
            renderResults(cache.filtered,q);
        } else {
            performRemoteFetch(q);
        }
    });

    loadBtn.addEventListener('click', async ()=>{
        if (!selectedMerchant) return;
        const start = startEl?.value;
        const end = endEl?.value;
        try {
            const url = `${base}/api/merchant-financials?merchantId=${encodeURIComponent(selectedMerchant.id)}${start?`&startDate=${start}`:''}${end?`&endDate=${end}`:''}`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (!data.success) throw new Error(data.error||'Failed');
            const f = data.data;
            // Render KPI cards
            kpiGrid.style.display='grid';
            kpiGrid.innerHTML = [
                {label:"إجمالي الطلبات", value:f.totals.totalOrders},
                {label:"الطلبات المؤكدة", value:f.totals.confirmedOrders},
                {label:"الطلبات الملغاة", value:f.totals.canceledOrders},
                {label:"الطلبات المرتجعة", value:f.totals.returnedOrders},
                {label:"إجمالي الإيرادات (د.ع)", value:f.financial.grossRevenue.toLocaleString()},
                {label:"العمولات المحصّلة (د.ع)", value:f.financial.commissionCollected.toLocaleString()},
                {label:"نسبة العمولة %", value:`${f.financial.commissionPercent}%`},
                {label:"مساهمة التوصيل (د.ع)", value:f.financial.deliveryFees.toLocaleString()},
                {label:"صافي مستحقات المتجر (د.ع)", value:f.financial.netToMerchant.toLocaleString()}
            ].map(k=>`<div class="metric-card"><div class="metric-value">${k.value}</div><div class="metric-label">${k.label}</div></div>`).join('');

            // Details panel
            details.style.display='block';
            details.innerHTML = `
                <div class="section-title"><span class="icon">📅</span> الفترة</div>
                <div style="font-size:0.9rem;color:#6c757d;margin-bottom:10px;">${new Date(f.period.startDate).toLocaleDateString()} → ${new Date(f.period.endDate).toLocaleDateString()}</div>
                <div style="font-size:0.9rem;">المتجر: <b>${selectedMerchant.name}</b> <span style="opacity:.7">(${selectedMerchant.id})</span></div>
            `;
        } catch (e) {
            alert("تعذّر تحميل البيانات المالية للمتجر.");
        }
    });

    resetBtn.addEventListener('click', ()=>{
        selectedMerchant=null; searchInput.value=''; resultsBox.innerHTML=''; resultsBox.style.display='none';
        kpiGrid.style.display='none'; kpiGrid.innerHTML=''; details.style.display='none'; details.innerHTML='';
        loadBtn.disabled=true; startEl.value=startISO; endEl.value=endISO;
    });
})();

// Global functions for onclick handlers
let financialManager;

window.calculateSampleCommission = () => financialManager.calculateSampleCommission();
window.calculateSampleDeliveryFee = () => financialManager.calculateSampleDeliveryFee();
window.generateReport = () => financialManager.generateReport();
window.saveSettings = () => financialManager.saveSettings();
window.recalculateAllCommissions = () => financialManager.recalculateAllCommissions();
window.exportFinancialData = () => financialManager.exportFinancialData();

// Test functions for merchants
window.testMerchantCommission = async (merchantId, merchantName) => {
    try {
        const response = await fetch(`${financialManager.apiBaseUrl}/api/commissions/calculate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderData: {
                    totalAmount: 25000,
                    merchantId: merchantId,
                    regionId: 'REG_IQ_NJF'
                },
                merchantType: 'standard'
            })
        });

        const result = await response.json();
        if (result.success) {
            const commission = result.data.commission;
            alert(`💰 Commission for ${merchantName}:\n\nOrder: 25,000 IQD\nCommission: ${commission.commissionAmount.toLocaleString()} IQD\nRate: ${commission.appliedRate.percentage}%\nRule: ${result.data.appliedRule.ruleName}`);
        } else {
            alert(`تعذّر احتساب العمولة: ${result.message}`);
        }
    } catch (error) {
        alert(`خطأ: ${window.WizzLocale.error(error.message)}`);
    }
};

window.testMerchantDelivery = () => window.location.assign("/pages/delivery-pricing.html");

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    financialManager = new FinancialManager();
});
