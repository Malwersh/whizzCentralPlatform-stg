// Campaign locations use the same base and derived records as the Regions page.
class CampaignRegionPicker {
    constructor() {
        this.regions = [];
        this.selectedId = '';
        this.search = document.getElementById('campaign_regionSearch');
        this.list = document.getElementById('campaign_targetRegionId');
        this.status = document.getElementById('campaign_regionStatus');
        this.retry = document.getElementById('campaign_retryRegions');
        this.search.addEventListener('input', () => this.render());
        this.list.addEventListener('change', () => {
            this.selectedId = this.list.value;
            this.status.textContent = this.selectedId ? `المحدد: ${this.regions.find(r => r.id === this.selectedId)?.label || this.selectedId}` : "يشمل جميع المناطق.";
        });
        this.retry.addEventListener('click', () => this.load(true));
    }
    async load(force = false) {
        if (this.pending) return this.pending;
        if (this.loaded && !force) return;
        this.pending = this.fetchRegions();
        try { await this.pending; } finally { this.pending = null; }
    }
    async fetchRegions() {
        this.status.textContent = "جارٍ تحميل المناطق المسجّلة…";
        this.retry.hidden = true;
        try {
            const [base, derived] = await Promise.all([
                window.AWSUtils.scanAll('WizzCentral_Regions'),
                window.AWSUtils.scanAll('WizzCentral_RegionsDerived_staging')
            ]);
            const extra = new Map(derived.map(r => [r.regionId, r]));
            const rows = base.map(r => ({ ...r, ...extra.get(r.regionId || r.id) }));
            const byId = new Map(rows.map(r => [r.regionId || r.id, r]));
            const name = r => [r.name_ar, r.name_en || r.name || r.regionName].filter((v, i, a) => v && a.indexOf(v) === i).join(' / ') || r.regionId || r.id;
            this.regions = rows.map(row => {
                const parts = [name(row)], visited = new Set([row.regionId || row.id]);
                let parent = byId.get(row.parent_id);
                while (parent && !visited.has(parent.regionId || parent.id)) {
                    visited.add(parent.regionId || parent.id);
                    parts.unshift(name(parent));
                    parent = byId.get(parent.parent_id);
                }
                return { id: row.regionId || row.id, label: parts.join(' › ') };
            }).filter(r => r.id).sort((a, b) => a.label.localeCompare(b.label));
            this.loaded = true;
            this.render();
            this.status.textContent = this.regions.length ? "اختر منطقة مسجّلة أو حدّد «جميع المناطق»." : "لا توجد مناطق متاحة. يمكنك إضافتها من صفحة المناطق.";
        } catch (error) {
            this.status.textContent = "تعذّر تحميل المناطق. أعد المحاولة لاختيار المنطقة المستهدفة.";
            this.retry.hidden = false;
            console.error('Campaign region loading failed:', error);
        }
    }
    render() {
        const query = this.search.value.trim().toLocaleLowerCase();
        const matches = this.regions.filter(r => r.id === this.selectedId || r.label.toLocaleLowerCase().includes(query));
        this.list.replaceChildren(new Option('All regions', ''));
        for (const region of matches) this.list.add(new Option(region.label, region.id));
        if (this.selectedId && !this.regions.some(r => r.id === this.selectedId)) {
            this.list.add(new Option('Previously selected region (unavailable)', this.selectedId));
        }
        this.list.value = this.selectedId;
        if (query) this.status.textContent = `${matches.filter(r => r.label.toLocaleLowerCase().includes(query)).length} منطقة مطابقة. اختر نتيجة من القائمة أدناه.`;
    }
    select(id) { this.selectedId = id; this.search.value = ''; this.render(); }
    reset() { this.select(''); }
}
