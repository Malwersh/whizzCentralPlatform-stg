// Regions Management JavaScript for WizzCentral Platform
// Handles region CRUD operations, map integration, and real-time updates

class RegionsManager {
    constructor() {
        this.regions = [];
        this.map = null;
        this.markers = [];
        this.selectedRegion = null;
        this.currentModal = null;
        this.currentView = 'table'; // Default to table view
        this.currentPage = 1;
        this.itemsPerPage = 10;
        this.sortField = null;
        this.sortDirection = 'asc';
        this.filteredRegions = [];
        this.allRegionsForDropdown = []; // Master list of ALL regions for parent dropdown (not paginated)
        this.awsAuthWarningShown = this.awsAuthWarningShown || false;
        this._modalEl = null;
        this._formEl = null;
        this._drawMap = null;
        this._drawnLayer = null;
        this._drawnBoundary = null; // GeoJSON-like { type, coordinates }
        this._shapesLayer = null; // LayerGroup for polygons/lines
        // Server-side pagination state
        this.pageMode = 'server'; // enable server paging by default
        this.tokenStack = [null]; // stack of page start tokens (null for first page)
        this.serverPageIndex = 0; // current index in tokenStack
        this.lastNextToken = null; // nextToken returned by last fetch
        this.lastPageCount = 0; // last page item count
        this._apiBase = this._detectApiBase();
        // Enforce polygons-only when using the draw feature
        this.polygonsOnly = true;

        console.log('🗺️ RegionsManager: Constructor called, readyState:', document.readyState);

        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            console.log('🗺️ DOM still loading, waiting for DOMContentLoaded...');
            document.addEventListener('DOMContentLoaded', () => {
                console.log('🗺️ DOMContentLoaded fired, initializing...');
                this.init();
            });
        } else {
            console.log('🗺️ DOM already loaded, initializing immediately...');
            // Use setTimeout to ensure everything is rendered
            setTimeout(() => this.init(), 100);
        }
    }

    // ===== Notification helpers (in-page banners + console fallbacks) =====
    showNotification(message, type = 'info') {
        try {
            // If a modal is open, prefer toast overlay so it is visible above the form
            if (this.currentModal) {
                this._showToast(message, type);
                return;
            }
            const banner = document.getElementById('apiErrorBanner');
            if (banner) {
                banner.style.display = 'block';
                banner.style.background = type === 'error' ? 'var(--md-sys-color-error-container)' : 'var(--md-sys-color-surface-container-lowest)';
                banner.style.borderColor = type === 'error' ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-outline-variant)';
                banner.style.color = 'var(--md-sys-color-on-surface)';
                banner.textContent = message;
                // Auto-hide non-error messages after short delay
                if (type !== 'error') {
                    setTimeout(() => { try { banner.style.display = 'none'; } catch {} }, 3500);
                }
            } else {
                console.log(`[${type.toUpperCase()}]`, message);
            }
        } catch (e) { console.log(message); }
    }

    _ensureToastContainer() {
        let c = document.getElementById('toastContainer');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toastContainer';
            c.style.position = 'fixed';
            c.style.top = '20px';
            c.style.right = '20px';
            c.style.display = 'flex';
            c.style.flexDirection = 'column';
            c.style.gap = '10px';
            c.style.zIndex = '9999';
            c.style.pointerEvents = 'none';
            document.body.appendChild(c);
        }
        return c;
    }

    _showToast(message, type) {
        const container = this._ensureToastContainer();
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.fontSize = '0.85rem';
        toast.style.fontWeight = '500';
        toast.style.padding = '10px 14px';
        toast.style.borderRadius = '12px';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        toast.style.background = type === 'error' ? 'var(--md-sys-color-error-container, #b00020)' : 'var(--md-sys-color-surface-container-high, #333)';
        toast.style.color = type === 'error' ? 'var(--md-sys-color-on-error-container, #fff)' : 'var(--md-sys-color-on-surface, #fff)';
        toast.style.border = '1px solid var(--md-sys-color-outline-variant, rgba(255,255,255,0.15))';
        toast.style.pointerEvents = 'auto';
        toast.style.cursor = 'default';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-6px)';
        toast.style.transition = 'opacity .25s ease, transform .25s ease';
        container.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        const ttl = type === 'error' ? 6000 : 3500;
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-6px)';
            setTimeout(() => { try { container.removeChild(toast); } catch {} }, 300);
        }, ttl);
    }

    showError(message) { this.showNotification(message, 'error'); }
    showSuccess(message) { this.showNotification(message, 'success'); }

    _detectApiBase() {
        try {
            const host = (window.location && window.location.hostname) || '';
            // Local dev uses Express routes under /api
            if (host === 'localhost' || host === '127.0.0.1') return '/api';
            // Production: use API Gateway base from config.js (already includes stage)
            const cfg = window.WIZZCENTRAL_CONFIG || {};
            const base = (cfg.API_BASE_URL || '').replace(/\/$/, '');
            return base || '/api';
        } catch { return '/api'; }
    }

    async init() {
        console.log('🗺️ RegionsManager: Initializing...');
        console.log('🗺️ Checking required elements...');

        // Check if required elements exist
        const tableBody = document.getElementById('regionsTableBody');
        const tableContainer = document.getElementById('regionsTableContainer');

        console.log('🗺️ Elements found:', {
            tableBody: !!tableBody,
            tableContainer: !!tableContainer
        });

        if (!tableBody || !tableContainer) {
            console.error('❌ Required HTML elements not found! Cannot initialize.');
            return;
        }

        try {
            // Initialize map (optional)
            this.initializeMap();

            // Load ALL regions for dropdown (not paginated)
            await this.loadAllRegionsForDropdown();

            // Load regions data
            await this.loadRegions();

            // Setup event listeners
            this.setupEventListeners();

            // Bind form submit if present
            const form = document.getElementById('regionForm');
            if (form) {
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.saveRegion();
                });
            }

            // Bind Draw Area modal events
            const drawBtn = document.getElementById('drawAreaBtn');
            const drawModal = document.getElementById('drawRegionModal');
            const closeDrawBtn = document.getElementById('closeDrawRegionModalBtn');
            const useShapeBtn = document.getElementById('useDrawnShapeBtn');
            const clearShapeBtn = document.getElementById('clearDrawnShapeBtn');
            if (drawBtn && drawModal) {
                drawBtn.addEventListener('click', () => this.openDrawRegionModal());
            }
            if (closeDrawBtn) closeDrawBtn.addEventListener('click', () => this.closeDrawRegionModal());
            if (useShapeBtn) useShapeBtn.addEventListener('click', () => this.applyDrawnBoundary());
            if (clearShapeBtn) clearShapeBtn.addEventListener('click', () => this.clearDrawnBoundary());

            // Fallback: ensure Delivery Fee & Minimum Order fields exist even if HTML not updated
            this._ensureMinimumOrderField();

            console.log('✅ RegionsManager: Initialized successfully');
        } catch (error) {
            console.error('❌ RegionsManager initialization failed:', error);
            this.showError('Failed to initialize regions management');
        }
    }

    _ensureMinimumOrderField() {
        try {
            const form = document.getElementById('regionForm');
            if (!form) return;

            // Find an anchor row: prefer the row that contains Estimated Delivery
            const etaWrapper = document.getElementById('estimatedDeliveryWrapper') || document.getElementById('estimatedDelivery')?.closest?.('.form-row') || null;
            let anchorRow = etaWrapper ? (etaWrapper.classList?.contains('form-row') ? etaWrapper : etaWrapper.parentElement) : null;

            // If still not found, try to find any form-row that contains Status to insert before it
            const statusEl = document.getElementById('regionStatus');
            const statusGroup = statusEl ? statusEl.closest?.('.form-group') : null;
            const statusRow = statusGroup ? statusGroup.parentElement : null;

            if (!anchorRow) {
                // Create a new row and insert before statusRow or append at end
                anchorRow = document.createElement('div');
                anchorRow.className = 'form-row';
                if (statusRow && statusRow.parentElement === statusRow.parentElement) {
                    statusRow.parentElement?.insertBefore(anchorRow, statusRow);
                } else {
                    form.appendChild(anchorRow);
                }
            }

            // Ensure Base Delivery Fee
            let feeWrapper = document.getElementById('deliveryBaseFeeWrapper');
            if (!feeWrapper) {
                feeWrapper = document.createElement('div');
                feeWrapper.className = 'form-group';
                feeWrapper.id = 'deliveryBaseFeeWrapper';
                feeWrapper.innerHTML = `
                    <label class="form-label">Base Delivery Fee</label>
                    <input type="number" step="0.01" min="0" class="form-input" id="deliveryBaseFee" placeholder="0.00">
                    <div style="font-size:0.65rem; margin-top:4px; color:var(--md-sys-color-on-surface-variant);">Optional. If blank while editing, existing fee is preserved.</div>
                `;
                // Place after ETA wrapper if present, else append to anchor row
                if (etaWrapper && !etaWrapper.classList.contains('form-row')) {
                    anchorRow.appendChild(feeWrapper);
                } else {
                    anchorRow.appendChild(feeWrapper);
                }
            }

            // Ensure Minimum Order
            let minWrapper = document.getElementById('deliveryMinimumOrderWrapper');
            if (!minWrapper) {
                minWrapper = document.createElement('div');
                minWrapper.className = 'form-group';
                minWrapper.id = 'deliveryMinimumOrderWrapper';
                minWrapper.innerHTML = `
                    <label class="form-label">Minimum Order</label>
                    <input type="number" step="0.01" min="0" class="form-input" id="deliveryMinimumOrder" placeholder="0.00">
                    <div style="font-size:0.65rem; margin-top:4px; color:var(--md-sys-color-on-surface-variant);">Optional. If blank while editing, existing minimum is preserved.</div>
                `;
                anchorRow.appendChild(minWrapper);
            }

            // If we inserted in a single column layout (no .form-row), ensure they are visible by appending directly before Status group
            if (!anchorRow.classList.contains('form-row') && statusGroup && feeWrapper && minWrapper) {
                statusRow?.parentElement?.insertBefore(feeWrapper, statusGroup);
                statusRow?.parentElement?.insertBefore(minWrapper, statusGroup);
            }

            // Sync enabled/disabled state with Delivery toggle
            this._toggleDeliveryFields();
        } catch (e) { console.error('Inject delivery fields failed:', e); }
    }

    initializeMap() {
        // Guard if no map container or Leaflet
        const mapContainer = document.getElementById('regionsMap');
        if (!mapContainer || typeof L === 'undefined') {
            console.log('ℹ️ Map not initialized (container or Leaflet missing)');
            this.map = null;
            return;
        }
        // Initialize map centered on Iraq
        this.map = L.map('regionsMap').setView([33.3152, 44.3661], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(this.map);
        this._shapesLayer = L.layerGroup().addTo(this.map);
        this.map.on('click', (e) => this.onMapClick(e));
        // Pick-on-map helpers
        this._pickOnMapActive = false;
        const pickBtn = document.getElementById('pickOnMapBtn');
        const useCenterBtn = document.getElementById('useMapCenterBtn');
        if (pickBtn) {
            pickBtn.addEventListener('click', () => {
                this._pickOnMapActive = true;
                this.showNotification('Click on the map to set coordinates', 'info');
            });
        }
        if (useCenterBtn) {
            useCenterBtn.addEventListener('click', () => {
                if (!this.map) return;
                const c = this.map.getCenter();
                const latEl = document.getElementById('coordLat');
                const lngEl = document.getElementById('coordLng');
                if (latEl) latEl.value = c.lat.toFixed(6);
                if (lngEl) lngEl.value = c.lng.toFixed(6);
            });
        }
        console.log('✅ Map initialized');
    }

    onMapClick(e) {
        // If picking is active, set form coordinates
        if (this._pickOnMapActive) {
            const { lat, lng } = e.latlng;
            const latEl = document.getElementById('coordLat');
            const lngEl = document.getElementById('coordLng');
            if (latEl) latEl.value = lat.toFixed(6);
            if (lngEl) lngEl.value = lng.toFixed(6);
            this._pickOnMapActive = false;
            this.showSuccess('Coordinates set from map');
        }
        console.log('Map clicked at:', e.latlng);
    }

    openDrawRegionModal() {
        const modal = document.getElementById('drawRegionModal');
        if (!modal) return;
        modal.style.display = 'flex';
        setTimeout(() => this.initializeDrawMap(), 50);
    }

    closeDrawRegionModal() {
        const modal = document.getElementById('drawRegionModal');
        if (modal) modal.style.display = 'none';
    }

    initializeDrawMap() {
        const container = document.getElementById('regionDrawMap');
        if (!container || typeof L === 'undefined' || typeof L.Draw === 'undefined') {
            this.showError('Map draw tools not available');
            return;
        }
        if (this._drawMap) {
            this._drawMap.invalidateSize();
            return;
        }
        const center = this.map ? this.map.getCenter() : { lat: 33.3152, lng: 44.3661 };
        const map = L.map('regionDrawMap').setView([center.lat, center.lng], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(map);
        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        this._drawnItems = drawnItems;

        const drawControl = new L.Control.Draw({
            position: 'topleft',
            draw: {
                marker: false,
                circle: false,
                rectangle: false,
                circlemarker: false,
                polyline: false, // Disable polylines; polygons only
                polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#1e88e5' } }
            },
            edit: { featureGroup: drawnItems, remove: true }
        });
        map.addControl(drawControl);

        map.on(L.Draw.Event.CREATED, (e) => {
            // Replace previous shape
            drawnItems.clearLayers();
            this._drawnLayer = e.layer;
            drawnItems.addLayer(this._drawnLayer);
            this._drawnBoundary = this._convertLayerToBoundary(e.layer);
            this._updateDrawSummary();
        });
        map.on(L.Draw.Event.EDITED, () => {
            if (this._drawnLayer) {
                this._drawnBoundary = this._convertLayerToBoundary(this._drawnLayer);
                this._updateDrawSummary();
            }
        });
        map.on(L.Draw.Event.DELETED, () => {
            this._drawnLayer = null;
            this._drawnBoundary = null;
            this._updateDrawSummary();
        });

        this._drawMap = map;
        // If we already have a boundary (editing existing), render it
        try {
            if (this._drawnBoundary) {
                const layer = this._boundaryToLeafletLayer(this._drawnBoundary);
                if (layer) {
                    this._drawnItems.clearLayers();
                    this._drawnLayer = layer;
                    this._drawnItems.addLayer(layer);
                    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
                    this._updateDrawSummary();
                }
            }
        } catch {}
        setTimeout(() => map.invalidateSize(), 150);
    }

    _convertLayerToBoundary(layer) {
        if (!layer) return null;
        if (layer.getLatLngs) {
            // Polygon or Polyline
            const latlngs = layer.getLatLngs();
            // Leaflet returns multi-d arrays. Normalize to single ring for Polygon or sequence for LineString
            if (layer instanceof L.Polygon) {
                const ring = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs).map(p => [Number(p.lng), Number(p.lat)]);
                if (ring.length >= 3) {
                    // Ensure closure for GeoJSON
                    const first = ring[0];
                    const last = ring[ring.length - 1];
                    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
                    return { type: 'Polygon', coordinates: [ring] };
                }
            } else if (layer instanceof L.Polyline) {
                const line = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs).map(p => [Number(p.lng), Number(p.lat)]);
                if (line.length >= 2) return { type: 'LineString', coordinates: line };
            }
        }
        return null;
    }

    _boundaryToLeafletLayer(boundary) {
        if (!boundary || !boundary.coordinates) return null;
        try {
            if (boundary.type === 'Polygon') {
                const ring = boundary.coordinates[0] || [];
                const latlngs = ring.map(([lng, lat]) => [lat, lng]);
                return L.polygon(latlngs, { color: '#1e88e5', weight: 2, fillOpacity: 0.1 });
            }
            if (boundary.type === 'LineString') {
                const pts = boundary.coordinates.map(([lng, lat]) => [lat, lng]);
                return L.polyline(pts, { color: '#ff7f50', weight: 3 });
            }
        } catch {}
        return null;
    }

    _updateDrawSummary() {
        const el = document.getElementById('drawSummary');
        if (!el) return;
        if (!this._drawnBoundary) {
            el.style.display = 'none';
            el.textContent = '';
            return;
        }
        const type = this._drawnBoundary.type;
        const count = this._drawnBoundary.coordinates?.[0]?.length || this._drawnBoundary.coordinates?.length || 0;
        el.style.display = 'block';
        el.textContent = `Selected ${type} with ${count} points`;
    }

    // Disable/enable lat/lng/radius inputs when polygon boundary exists, and show inline note
    _toggleCoordinateInputsForBoundary() {
        const hasPoly = !!(this._drawnBoundary && this._drawnBoundary.type === 'Polygon' && Array.isArray(this._drawnBoundary.coordinates) && (this._drawnBoundary.coordinates[0]?.length || 0) >= 4);
        const latEl = document.getElementById('coordLat');
        const lngEl = document.getElementById('coordLng');
        const radEl = document.getElementById('coordRadius');
        [latEl, lngEl, radEl].forEach(el => { if (el) { el.disabled = hasPoly; el.classList?.toggle('disabled', hasPoly); }});
        let note = document.getElementById('coordInputsNote');
        const anchor = radEl?.parentElement || latEl?.parentElement || lngEl?.parentElement || document.getElementById('regionForm');
        if (!note && anchor) {
            note = document.createElement('div');
            note.id = 'coordInputsNote';
            note.style.fontSize = '0.8rem';
            note.style.marginTop = '6px';
            note.style.color = 'var(--md-sys-color-on-surface-variant, #666)';
            anchor.appendChild(note);
        }
        if (note) note.textContent = hasPoly ? 'Polygon selected. Center and radius will be ignored on save.' : '';
    }

    clearDrawnBoundary() {
        this._drawnBoundary = null;
        this._drawnLayer = null;
        if (this._drawMap && this._drawnItems) {
            this._drawnItems.clearLayers();
        }
        this._updateDrawSummary();
        // Re-enable coordinate inputs without changing their values
        this._toggleCoordinateInputsForBoundary();
    }

    applyDrawnBoundary() {
        if (!this._drawnBoundary) {
            this.showError('Draw a shape first');
            return;
        }
        // Do not touch lat/lng/radius when a polygon is selected
        // Simply close modal, show success, and disable inputs
        this.closeDrawRegionModal();
        this.showSuccess('Area selected from map');
        this._updateDrawSummary();
        this._toggleCoordinateInputsForBoundary();
    }

    _computeCentroid(boundary) {
        if (!boundary || !boundary.coordinates) return null;
        if (boundary.type === 'Polygon') {
            const ring = boundary.coordinates[0];
            let area = 0, cx = 0, cy = 0;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const [x1, y1] = ring[j];
                const [x2, y2] = ring[i];
                const f = (x1 * y2 - x2 * y1);
                area += f;
                cx += (x1 + x2) * f;
                cy += (y1 + y2) * f;
            }
            area *= 0.5;
            if (area === 0) return null;
            return { lng: cx / (6 * area), lat: cy / (6 * area) };
        }
        if (boundary.type === 'LineString') {
            const pts = boundary.coordinates;
            const m = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
            return { lng: m[0] / pts.length, lat: m[1] / pts.length };
        }
        return null;
    }

    async loadAllRegionsForDropdown() {
        try {
            console.log('📋 Loading all regions for dropdown...');
            const url = `${this._apiBase}/regions?limit=1000`;
            
            let response = await fetch(url, { headers: { 'Content-Type': 'application/json' }});
            
            if (!response.ok) {
                await this.maybeHandleAwsAuthError?.(response, url);
                const idToken = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('idToken') : null;
                if (idToken) {
                    response = await fetch(url, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` }});
                }
            }
            
            if (!response.ok) {
                console.warn('Failed to load all regions for dropdown, using empty list');
                this.allRegionsForDropdown = [];
                return;
            }
            
            const result = await response.json();
            const list = result?.data || result?.regions || result?.items || (Array.isArray(result) ? result : []);
            
            if (!Array.isArray(list)) {
                console.warn('Unexpected regions list shape for dropdown');
                this.allRegionsForDropdown = [];
                return;
            }
            
            // Transform regions
            const rawById = new Map(list.filter(r => r && (r.id || r.regionId)).map(r => [r.id || r.regionId, r]));
            const findGovernorateName = (rid) => {
                let cursor = rawById.get(rid);
                let steps = 0;
                while (cursor && steps < 10) {
                    const lvl = Number(cursor.level);
                    if (lvl === 1) return cursor.name || cursor.name_en || cursor.name_ar || cursor.regionName;
                    if (!cursor.parent_id) break;
                    cursor = rawById.get(cursor.parent_id);
                    steps++;
                }
                return undefined;
            };
            
            this.allRegionsForDropdown = list.map(r => this.transformRegionData(r, findGovernorateName));
            console.log('✅ Loaded', this.allRegionsForDropdown.length, 'regions for dropdown');
            
            // Log level distribution
            const byLevel = {};
            this.allRegionsForDropdown.forEach(r => {
                const lvl = r.level;
                if (!byLevel[lvl]) byLevel[lvl] = 0;
                byLevel[lvl]++;
            });
            console.log('📊 Dropdown regions by level:', byLevel);
            
        } catch (e) {
            console.error('loadAllRegionsForDropdown failed:', e);
            this.allRegionsForDropdown = [];
        }
    }

    async loadRegions() {
        try {
            const tbody = document.getElementById('regionsTableBody');
            if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="loading-cell"><div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Loading regions from API...</div></td></tr>`;
            const backendRegions = await this.fetchRegionsFromBackend();
            if (Array.isArray(backendRegions)) {
                this.regions = backendRegions;
                this.lastPageCount = backendRegions.length;
                this.renderRegionsList();
                this.updateStatistics?.();
            } else {
                throw new Error('Invalid regions payload');
            }
        } catch (e) {
            console.error('loadRegions failed:', e);
            this.showError('Failed to load regions');
            this.regions = [];
            this.renderRegionsList();
        }
    }

    async fetchRegionsFromBackend() {
        try {
            const tbody = document.getElementById('regionsTableBody');
            if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="loading-cell"><div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Loading regions from API...</div></td></tr>`;

            // Safe env detection for hosted vs local
            const isLocal = (typeof window !== 'undefined') && (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

            // Build query params based on current filters + server/client mode
            const params = new URLSearchParams();
            const levelEl = document.getElementById('levelFilter');
            const statusEl = document.getElementById('statusFilter');
            const searchEl = document.getElementById('regionSearch');
            if (levelEl && levelEl.value !== '') params.set('level', String(parseInt(levelEl.value, 10)));
            if (statusEl && statusEl.value !== '') params.set('is_active', statusEl.value); // backend expects is_active
            if (searchEl && searchEl.value.trim()) params.set('search', searchEl.value.trim());

            if (this.pageMode === 'server') {
                params.set('pageMode', 'server');
                params.set('limit', String(this.itemsPerPage));
                const token = this.tokenStack[this.serverPageIndex] || null;
                if (token) params.set('nextToken', token);
            } else {
                // client mode fetch-all then paginate locally
                params.set('limit', '1000');
                params.set('offset', '0');
            }

            // Lambda Function URL responds on root, not /regions path
            const isLambdaFunctionUrl = this._apiBase.includes('lambda-url');
            const url = isLambdaFunctionUrl 
                ? `${this._apiBase}${params.toString() ? `?${params.toString()}` : ''}`
                : `${this._apiBase}/regions${params.toString() ? `?${params.toString()}` : ''}`;
            console.log('🔎 Fetching regions:', { url, pageMode: this.pageMode, token: this.tokenStack[this.serverPageIndex] || null });
            const t0 = performance.now();
            let response = await fetch(url, { headers: { 'Content-Type': 'application/json' }});
            console.log('⏱️ Regions initial response status:', response.status, 'time(ms):', (performance.now()-t0).toFixed(0));

            if (!response.ok) {
                await this.maybeHandleAwsAuthError?.(response, url);
                const idToken = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('idToken') : null;
                if (idToken) {
                    console.log('🔐 Retrying regions fetch with Authorization Bearer');
                    const t1 = performance.now();
                    response = await fetch(url, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` }});
                    console.log('⏱️ Regions auth retry status:', response.status, 'time(ms):', (performance.now()-t1).toFixed(0));
                }
            }

            if (!response.ok) {
                const ct = response.headers?.get?.('content-type') || '';
                let msg = '';
                try { msg = ct.includes('application/json') ? JSON.stringify(await response.clone().json()) : await response.text(); } catch {}
                const fullMsg = `Failed to load regions (${response.status}). ${msg || ''}`;
                if (!isLocal && typeof showApiErrorBanner === 'function') {
                    showApiErrorBanner(fullMsg);
                }
                this.showError(fullMsg);
                throw new Error(fullMsg);
            }

            const result = await response.json();
            console.log('📦 Raw regions payload keys:', Object.keys(result || {}));
            // Support multiple backend response shapes: legacy {data|regions|pagination.nextToken} and new Lambda {items,total,nextToken}
            const list = result?.data || result?.regions || result?.items || (Array.isArray(result) ? result : []);
            this.lastNextToken = result?.nextToken || result?.pagination?.nextToken || null;
            console.log('📡 /regions returned items:', Array.isArray(list) ? list.length : 'N/A', 'nextToken:', this.lastNextToken);
            if (!Array.isArray(list)) {
                console.warn('Unexpected regions list shape:', result);
                throw new Error('Regions payload malformed');
            }

            const rawById = new Map(list.filter(r => r && (r.id || r.regionId)).map(r => [r.id || r.regionId, r]));
            const findGovernorateName = (rid) => {
                let cursor = rawById.get(rid);
                let steps = 0;
                while (cursor && steps < 10) {
                    const lvl = Number(cursor.level);
                    if (lvl === 1) return cursor.name || cursor.name_en || cursor.name_ar || cursor.regionName;
                    if (!cursor.parent_id) break;
                    cursor = rawById.get(cursor.parent_id);
                    steps++;
                }
                return undefined;
            };
            const transformed = list.map(r => this.transformRegionData(r, findGovernorateName));
            console.log('🧭 Transformed regions count:', transformed.length);
            return transformed;
        } catch (e) {
            console.error('fetchRegionsFromBackend failed:', e);
            if (typeof showApiErrorBanner === 'function') showApiErrorBanner(e.message || 'Failed to load regions');
            throw e;
        }
    }

    renderRegionsList() {
        this.applyFilters();
        this.renderTableView();
        this.renderMapMarkers();
    }

    applyFilters() {
        const searchInput = document.getElementById('regionSearch');
        const levelFilter = document.getElementById('levelFilter');
        const statusFilter = document.getElementById('statusFilter');
        let filtered = [...this.regions];
        if (this.pageMode !== 'server') {
            // Local filtering in client mode
            if (searchInput && searchInput.value.trim()) {
                const term = searchInput.value.trim().toLowerCase();
                filtered = filtered.filter(r =>
                    (r.regionName || '').toLowerCase().includes(term) ||
                    (r.regionNameArabic || '').toLowerCase().includes(term) ||
                    (r.governorate || '').toLowerCase().includes(term)
                );
            }
            if (levelFilter && levelFilter.value) {
                let lvl = parseInt(levelFilter.value, 10);
                if (lvl === 4) lvl = 3;
                filtered = filtered.filter(r => Number(r.level) === lvl);
            }
            if (statusFilter && statusFilter.value !== '') {
                const isActive = statusFilter.value === 'true';
                filtered = filtered.filter(r => !!r.isActive === isActive);
            }
        }
        this.filteredRegions = filtered;
        // Apply sort if set (page-level)
        if (this.sortField) {
            const dir = this.sortDirection === 'asc' ? 1 : -1;
            const f = this.sortField;
            this.filteredRegions.sort((a, b) => {
                let va = a[f];
                let vb = b[f];
                if (typeof va === 'string') va = va.toLowerCase();
                if (typeof vb === 'string') vb = vb.toLowerCase();
                if (va < vb) return -1 * dir;
                if (va > vb) return 1 * dir;
                return 0;
            });
        }
        console.log('📊 Filters applied:', {
            mode: this.pageMode,
            total: this.regions.length,
            afterFilters: this.filteredRegions.length,
            level: levelFilter?.value || '',
            status: statusFilter?.value || '',
            search: searchInput?.value || ''
        });
    }

    renderTableView() {
        const tbody = document.getElementById('regionsTableBody');
        if (!tbody) return;
        if (!this.filteredRegions || this.filteredRegions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="loading-cell"><div class="loading-state"><i class="fas fa-search"></i><div>No regions found</div><div style=\"font-size: 0.8rem; color: var(--md-sys-color-on-surface-variant);\">Try adjusting your search or filters</div></div></td></tr>`;
            this.updatePagination?.(0);
            return;
        }
        let pageRegions;
        if (this.pageMode === 'server') {
            pageRegions = this.filteredRegions; // already a single server page
        } else {
            const startIndex = (this.currentPage - 1) * this.itemsPerPage;
            const endIndex = Math.min(startIndex + this.itemsPerPage, this.filteredRegions.length);
            pageRegions = this.filteredRegions.slice(startIndex, endIndex);
        }
        const rows = pageRegions.map(region => `
            <tr data-id="${region.regionId}">
                <td class="region-name-cell">
                    <div class="region-name-en">${region.regionName || ''}</div>
                    <div class="region-name-ar">${region.regionNameArabic || ''}</div>
                </td>
                <td>
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <i class="fas fa-map" style="color: var(--md-sys-color-primary); opacity: 0.7;"></i>
                        ${region.governorate || '—'}
                    </div>
                </td>
                <td>
                    <span class="status-badge ${region.isActive ? 'active' : 'inactive'}">
                        <i class="fas fa-${region.isActive ? 'check-circle' : 'times-circle'}"></i>
                        ${region.isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td class="actions-cell">
                    <button class="action-btn view" onclick="window.viewRegionDetails('${region.regionId}', event)" title="View Details"><i class="fas fa-eye"></i></button>
                    <button class="action-btn edit" onclick="window.editRegion('${region.regionId}', event)" title="Edit"><i class="fas fa-edit"></i></button>
                    <button class="action-btn toggle" onclick="window.toggleRegionStatus('${region.regionId}', event)" title="Toggle Status"><i class="fas fa-power-off"></i></button>
                    <button class="action-btn delete" onclick="window.deleteRegion('${region.regionId}', event)" title="Delete"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`).join('');
        tbody.innerHTML = rows;
        this.updatePagination?.(this.pageMode === 'server' ? null : this.filteredRegions.length);
    }

    renderMapMarkers() {
        if (!this.map || !this._shapesLayer) return;
        this._shapesLayer.clearLayers();
        this.markers.forEach(m => { try { this._shapesLayer.removeLayer(m); } catch {} });
        this.markers = [];
        const regionsToShow = this.filteredRegions && this.filteredRegions.length ? this.filteredRegions : this.regions;
        regionsToShow.slice(0, 500).forEach(r => {
            const c = r.coordinates?.center || { lat: 33.3152, lng: 44.3661 };
            // Center marker (small)
            try {
                const m = L.circleMarker([c.lat, c.lng], { radius: 4, color: r.isActive ? '#2e7d32' : '#9e9e9e' })
                    .bindTooltip(`${r.regionName || ''}`);
                m.addTo(this._shapesLayer);
                this.markers.push(m);
            } catch {}
            // Boundary shape - Read from geometry first (new), fallback to boundary (old)
            const geom = r.geometry || r.boundary;
            if (geom && geom.coordinates) {
                const layer = this._boundaryToLeafletLayer(geom);
                if (layer) {
                    layer.addTo(this._shapesLayer);
                }
            }
        });
    }

    updatePagination(totalItems) {
        const paginationInfo = document.getElementById('tablePagination');
        const showingStart = document.getElementById('showingStart');
        const showingEnd = document.getElementById('showingEnd');
        const totalCount = document.getElementById('totalCount');
        const pageNumbers = document.getElementById('pageNumbers');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        if (!paginationInfo) return;

        if (this.pageMode === 'server') {
            const startIndex = this.serverPageIndex * this.itemsPerPage + 1;
            const endIndex = startIndex + (this.filteredRegions?.length || 0) - 1;
            paginationInfo.style.display = 'flex';
            showingStart && (showingStart.textContent = String(this.filteredRegions.length ? startIndex : 0));
            showingEnd && (showingEnd.textContent = String(this.filteredRegions.length ? endIndex : 0));
            totalCount && (totalCount.textContent = '—');
            if (pageNumbers) pageNumbers.innerHTML = '';
            prevBtn && (prevBtn.disabled = this.serverPageIndex <= 0);
            nextBtn && (nextBtn.disabled = !this.lastNextToken);
            return;
        }

        if (!totalItems) {
            paginationInfo.style.display = 'flex';
            showingStart && (showingStart.textContent = '0');
            showingEnd && (showingEnd.textContent = '0');
            totalCount && (totalCount.textContent = '0');
            pageNumbers && (pageNumbers.innerHTML = '');
            prevBtn && (prevBtn.disabled = true);
            nextBtn && (nextBtn.disabled = true);
            return;
        }
        const startIndex = (this.currentPage - 1) * this.itemsPerPage + 1;
        const endIndex = Math.min(this.currentPage * this.itemsPerPage, totalItems);
        const totalPages = Math.ceil(totalItems / this.itemsPerPage);
        paginationInfo.style.display = 'flex';
        showingStart && (showingStart.textContent = String(startIndex));
        showingEnd && (showingEnd.textContent = String(endIndex));
        totalCount && (totalCount.textContent = String(totalItems));
        if (pageNumbers) {
            let html = '';
            const maxVisible = 5;
            let startPage = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage + 1 < maxVisible) {
                startPage = Math.max(1, endPage - maxVisible + 1);
            }
            for (let p = startPage; p <= endPage; p++) {
                html += `<button class="page-number ${p === this.currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
            }
            pageNumbers.innerHTML = html;
        }
        prevBtn && (prevBtn.disabled = this.currentPage <= 1);
        nextBtn && (nextBtn.disabled = this.currentPage >= totalPages);
    }

    setupEventListeners() {
        const searchInput = document.getElementById('regionSearch');
        const statusFilter = document.getElementById('statusFilter');
        const levelFilter = document.getElementById('levelFilter');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        if (searchInput) searchInput.addEventListener('input', async () => {
            if (this.pageMode === 'server') { this.resetServerPaging(); await this.loadRegions(); }
            else { this.currentPage = 1; this.renderRegionsList(); }
        });
        if (statusFilter) statusFilter.addEventListener('change', async () => {
            if (this.pageMode === 'server') { this.resetServerPaging(); await this.loadRegions(); }
            else { this.currentPage = 1; this.renderRegionsList(); }
        });
        if (levelFilter) levelFilter.addEventListener('change', async () => {
            if (this.pageMode === 'server') { this.resetServerPaging(); await this.loadRegions(); }
            else { this.currentPage = 1; this.renderRegionsList(); }
        });
        if (prevBtn) prevBtn.addEventListener('click', async () => {
            if (this.pageMode === 'server') { await this.previousServerPage(); }
            else { this.currentPage = Math.max(1, this.currentPage - 1); this.renderRegionsList(); }
        });
        if (nextBtn) nextBtn.addEventListener('click', async () => {
            if (this.pageMode === 'server') { await this.nextServerPage(); }
            else { const totalPages = Math.ceil((this.filteredRegions?.length || 0) / this.itemsPerPage); this.currentPage = Math.min(totalPages, this.currentPage + 1); this.renderRegionsList(); }
        });
    }

    resetServerPaging() {
        this.tokenStack = [null];
        this.serverPageIndex = 0;
        this.lastNextToken = null;
        this.currentPage = 1; // keep table UI consistent
    }

    async nextServerPage() {
        if (!this.lastNextToken) return;
        this.serverPageIndex += 1;
        // store token for this page index (acts as ExclusiveStartKey for the requested page)
        this.tokenStack[this.serverPageIndex] = this.lastNextToken;
        return this.loadRegions();
    }

    async previousServerPage() {
        if (this.serverPageIndex <= 0) return;
        this.serverPageIndex -= 1;
        return this.loadRegions();
    }

    async maybeHandleAwsAuthError(response, endpoint) {
        try {
            if (response.status === 401) {
                const ct = response.headers.get('content-type') || '';
                if (ct.includes('application/json')) {
                    const data = await response.clone().json();
                    if (data && data.error === 'aws-credentials') this.showAwsCredentialsToast(data, endpoint);
                } else {
                    this.showAwsCredentialsToast({}, endpoint);
                }
            }
        } catch (e) { console.warn('AWS auth parse failed:', e); }
    }

    showAwsCredentialsToast(data = {}, endpoint = '') {
        if (this.awsAuthWarningShown) return; this.awsAuthWarningShown = true;
        const profile = data.profile || 'wizz-drivers-ghayth-dev';
        const region = data.region || 'us-east-1';
        this.showNotification(`AWS credentials missing/expired for DynamoDB (${region}). Run: aws sso login --profile ${profile}. Then retry ${endpoint}`, 'error');
    }

    transformRegionData(region, findGovernorateName) {
        let coordinates = { lat: 33.3152, lng: 44.3661 };
        if (region.coordinates) {
            coordinates = {
                lat: region.coordinates.lat || region.coordinates.center?.lat || 33.3152,
                lng: region.coordinates.lng || region.coordinates.center?.lng || 44.3661
            };
        }
        // Derive governorate for display
        let gov = region.governorate || region.governorate_id;
        const lvl = Number(region.level);
        if (!gov && typeof findGovernorateName === 'function') {
            if (lvl === 1) {
                gov = region.name || region.name_en || region.name_ar || region.regionName;
            } else if (lvl >= 2) {
                gov = findGovernorateName(region.parent_id || region.regionId || region.id) || '—';
            }
        }
        return {
            regionId: region.regionId || region.id,
            regionName: region.name || region.regionName,
            regionNameArabic: region.name_ar || region.regionNameArabic,
            governorate: gov || (lvl === 0 ? '—' : 'N/A'),
            level: lvl,
            parent_id: region.parent_id,
            isActive: (region.is_active === true || region.is_active === 'true'),
            serviceTypes: region.service_config,
            deliveryConfig: region.delivery_config,
            coordinates: { center: coordinates, boundaries: region.boundary ? region.boundary.coordinates : [] },
            boundary: region.boundary || null
        };
    }

    get modalEl() {
        return this._modalEl || (this._modalEl = document.getElementById('regionModal'));
    }

    get formEl() {
        return this._formEl || (this._formEl = document.getElementById('regionForm'));
    }

    _toggleDeliveryFields() {
        const svcDel = document.getElementById('serviceDelivery');
        const etaWrapper = document.getElementById('estimatedDeliveryWrapper') || document.getElementById('estimatedDelivery')?.parentElement;
        const etaInput = document.getElementById('estimatedDelivery');
        const feeWrapper = document.getElementById('deliveryBaseFeeWrapper');
        const feeInput = document.getElementById('deliveryBaseFee');
        const minWrapper = document.getElementById('deliveryMinimumOrderWrapper');
        const minInput = document.getElementById('deliveryMinimumOrder');
        if (!svcDel) return;
        const enabled = svcDel.checked;
        [etaWrapper, feeWrapper, minWrapper].forEach(w => { if (w) w.style.opacity = enabled ? '1' : '0.4'; });
        [etaInput, feeInput, minInput].forEach(i => { if (i) i.disabled = !enabled; });
    }

    openRegionModal(regionId = null) {
        const modal = this.modalEl;
        const form = this.formEl;
        if (!modal || !form) return;

        // Ensure delivery extra fields are in DOM before prefilling
        this._ensureMinimumOrderField();

        // Reset form
        form.reset();
        const modalTitle = document.getElementById('modalTitle');
        if (modalTitle) modalTitle.textContent = regionId ? 'Edit Region' : 'Add New Region';

        const levelEl = document.getElementById('regionLevel');
        const parentEl = document.getElementById('parentRegion');
        const latEl = document.getElementById('coordLat');
        const lngEl = document.getElementById('coordLng');
        const radEl = document.getElementById('coordRadius');

        // Find region data if editing
        // Search in allRegionsForDropdown first (complete list), then fall back to this.regions
        let regionData = null;
        if (regionId) {
            const sourceList = this.allRegionsForDropdown.length > 0 ? this.allRegionsForDropdown : this.regions;
            regionData = sourceList.find(x => x.regionId === regionId);
            console.log('🔧 Editing region:', regionData, 'Found in:', this.allRegionsForDropdown.length > 0 ? 'allRegionsForDropdown' : 'this.regions');
        }

        // Set level FIRST (before populateParentOptions)
        if (regionData && levelEl) {
            levelEl.value = String(regionData.level);
            console.log('✅ Set level to:', regionData.level);
        } else if (levelEl && !regionId) {
            levelEl.value = '3'; // Default for new regions
        }

        // Populate parent options based on the level
        this.populateParentOptions();
        
        // Bind level change listener (only once)
        if (levelEl && !levelEl._changeBound) {
            levelEl.addEventListener('change', () => {
                this.populateParentOptions();
                if (parentEl) parentEl.value = '';
            });
            levelEl._changeBound = true;
        }

        // Prefill ALL fields if editing
        if (regionData) {
            const name = document.getElementById('regionName');
            const nameAr = document.getElementById('regionNameArabic');
            const gov = document.getElementById('governorate');
            const est = document.getElementById('estimatedDelivery');
            const fee = document.getElementById('deliveryBaseFee');
            const minOrd = document.getElementById('deliveryMinimumOrder');
            const status = document.getElementById('regionStatus');
            const svcDel = document.getElementById('serviceDelivery');
            const svcPck = document.getElementById('servicePickup');
            const svcDine = document.getElementById('serviceDineIn');
            
            if (name) name.value = regionData.regionName || '';
            if (nameAr) nameAr.value = regionData.regionNameArabic || '';
            
            // Set governorate dropdown value
            if (gov) {
                const govValue = regionData.governorate && regionData.governorate !== '—' && regionData.governorate !== 'N/A' ? regionData.governorate : '';
                gov.value = govValue;
                console.log('✅ Set governorate to:', govValue);
            }
            
            if (est) est.value = (regionData.deliveryConfig?.estimated_time_minutes) || 30;
            if (fee) fee.value = (regionData.deliveryConfig?.base_fee != null ? regionData.deliveryConfig.base_fee : '');
            if (minOrd) minOrd.value = (regionData.deliveryConfig?.minimum_order != null ? regionData.deliveryConfig.minimum_order : '');
            if (status) status.value = regionData.isActive ? 'active' : 'inactive';
            if (svcDel) svcDel.checked = !!(regionData.serviceTypes?.delivery ?? true);
            if (svcPck) svcPck.checked = !!(regionData.serviceTypes?.pickup ?? false);
            if (svcDine) svcDine.checked = !!(regionData.serviceTypes?.dineIn ?? false);
            
            // Set parent region dropdown (after options are populated)
            if (parentEl && regionData.parent_id) {
                parentEl.value = regionData.parent_id;
                console.log('✅ Set parent_id to:', regionData.parent_id, 'Selected value:', parentEl.value);
                
                // Double-check if the option exists
                const optionExists = Array.from(parentEl.options).some(opt => opt.value === regionData.parent_id);
                if (!optionExists) {
                    console.warn('⚠️ Parent option not found in dropdown:', regionData.parent_id);
                }
            }
            
            // Keep selectedRegion and boundary for editing
            this.selectedRegion = regionData;
            // ✅ Read from geometry first (new), fallback to boundary (old)
            this._drawnBoundary = regionData.geometry || regionData.boundary || null;

            // Prefill coords when NO polygon boundary exists
            if (!this._drawnBoundary) {
                const c = this.map ? this.map.getCenter() : { lat: 33.3152, lng: 44.3661 };
                if (latEl) latEl.value = (regionData.coordinates?.center?.lat ?? c.lat).toFixed(6);
                if (lngEl) lngEl.value = (regionData.coordinates?.center?.lng ?? c.lng).toFixed(6);
                if (radEl) radEl.value = (regionData.coordinates?.center?.radius || 3000);
            }
        } else {
            // New region defaults
            this.selectedRegion = null;
            this._drawnBoundary = null;
            const c = this.map ? this.map.getCenter() : { lat: 33.3152, lng: 44.3661 };
            if (latEl) latEl.value = (c.lat || 33.3152).toFixed(6);
            if (lngEl) lngEl.value = (c.lng || 44.3661).toFixed(6);
            if (radEl) radEl.value = 3000;
            const fee = document.getElementById('deliveryBaseFee');
            const minOrd = document.getElementById('deliveryMinimumOrder');
            if (fee) fee.value = '';
            if (minOrd) minOrd.value = '';
        }

        // Update coordinate inputs state based on boundary
        this._toggleCoordinateInputsForBoundary();

        // Setup delivery toggle
        const svcDelChk = document.getElementById('serviceDelivery');
        if (svcDelChk && !svcDelChk._boundDeliveryToggle) {
            svcDelChk.addEventListener('change', () => this._toggleDeliveryFields());
            svcDelChk._boundDeliveryToggle = true;
        }
        this._toggleDeliveryFields();

        modal.style.display = 'flex';
        this.currentModal = 'region';
    }

    populateParentOptions() {
        const levelEl = document.getElementById('regionLevel');
        const parentEl = document.getElementById('parentRegion');
        if (!levelEl || !parentEl) return;
        const level = parseInt(levelEl.value || '3', 10);
        const neededParentLevel = level - 1;
        
        // ✅ Hide parent dropdown for Level 0 (Country)
        const parentContainer = parentEl.closest('.form-group') || parentEl.parentElement;
        if (level === 0) {
            if (parentContainer) parentContainer.style.display = 'none';
            parentEl.value = ''; // Clear selection
            console.log('🔒 Parent region hidden for Level 0 (Country)');
            return;
        } else {
            if (parentContainer) parentContainer.style.display = '';
        }
        
        // Use allRegionsForDropdown (complete list) instead of this.regions (paginated table)
        const sourceList = this.allRegionsForDropdown.length > 0 ? this.allRegionsForDropdown : this.regions;
        
        console.log('🔍 populateParentOptions:', { 
            selectedLevel: level, 
            neededParentLevel, 
            sourceListCount: sourceList.length,
            usingFullList: sourceList === this.allRegionsForDropdown
        });
        
        let options = '<option value="">-- Select Parent Region --</option>';
        if (neededParentLevel >= 0) {
            const parents = sourceList.filter(r => r.level === neededParentLevel);
            console.log('📋 Found parent options:', { 
                count: parents.length, 
                neededLevel: neededParentLevel,
                sample: parents.slice(0, 3).map(p => ({ id: p.regionId, name: p.regionName, level: p.level }))
            });
            
            // Sort parents alphabetically
            parents.sort((a, b) => (a.regionName || '').localeCompare(b.regionName || ''));
            
            parents.forEach(p => {
                options += `<option value="${p.regionId}">${p.regionName} (${p.regionId})</option>`;
            });
        }
        parentEl.innerHTML = options;
        console.log('✅ Parent dropdown populated with', (options.match(/<option/g) || []).length - 1, 'options');
    }

    closeRegionModal() {
        const modal = this.modalEl;
        if (modal) modal.style.display = 'none';
        this.currentModal = null;
    }

    async saveRegion() {
        const form = this.formEl;
        if (!form) return;

        // Button state
        const btnText = document.getElementById('saveButtonText');
        const btnSpin = document.getElementById('saveButtonSpinner');
        if (btnText) btnText.textContent = 'Saving...';
        if (btnSpin) btnSpin.style.display = 'inline-block';

        try {
            // Collect form values
            const name = document.getElementById('regionName')?.value?.trim();
            const nameAr = document.getElementById('regionNameArabic')?.value?.trim();
            const governorateLabel = document.getElementById('governorate')?.value || '';
            const estimated = parseInt(document.getElementById('estimatedDelivery')?.value || '30', 10);
            const baseFeeRaw = document.getElementById('deliveryBaseFee')?.value || '';
            const minOrderRaw = document.getElementById('deliveryMinimumOrder')?.value || '';
            const baseFee = baseFeeRaw.trim() === '' ? null : parseFloat(baseFeeRaw);
            const minOrder = minOrderRaw.trim() === '' ? null : parseFloat(minOrderRaw);
            const status = document.getElementById('regionStatus')?.value || 'active';
            const svcDelivery = document.getElementById('serviceDelivery')?.checked ?? true;
            const svcPickup = document.getElementById('servicePickup')?.checked ?? false;
            const svcDineIn = document.getElementById('serviceDineIn')?.checked ?? false;
            const selectedLevel = parseInt(document.getElementById('regionLevel')?.value || '3', 10);
            const parentRegionId = document.getElementById('parentRegion')?.value || null;
            const latVal = parseFloat(document.getElementById('coordLat')?.value || '33.3152');
            const lngVal = parseFloat(document.getElementById('coordLng')?.value || '44.3661');
            const radiusVal = parseInt(document.getElementById('coordRadius')?.value || '3000', 10);

            if (!name || !nameAr) {
                this.showError('Please enter both English and Arabic names');
                return;
            }

            // Editing vs creating
            const isEdit = !!(this.selectedRegion && this.selectedRegion.regionId);

            // ✅ Validate parent level relationship
            // Level 0 (Country) doesn't need parent
            // Level 1+ requires parent from previous level
            if (selectedLevel > 0 && !parentRegionId) {
                this.showError('Please select a parent region for this level');
                return;
            }
            if (parentRegionId) {
                const sourceList = this.allRegionsForDropdown.length > 0 ? this.allRegionsForDropdown : this.regions;
                const parent = sourceList.find(r => r.regionId === parentRegionId);
                if (!parent) {
                    this.showError('Parent region not found');
                    return;
                }
                if (Number(parent.level) !== selectedLevel - 1) {
                    this.showError(`Invalid parent level. Parent must be level ${selectedLevel - 1}`);
                    return;
                }
            }

            // For create, enforce polygon boundary (backend create requires it)
            if (!isEdit && !this._drawnBoundary) {
                this.showError('Please draw a polygon boundary for the new region');
                return;
            }

            // Build payload matching server normalization
            const payload = {
                // If editing, include regionId to update existing item
                ...(isEdit ? { regionId: this.selectedRegion.regionId } : { regionId: `R${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}` }),
                name,
                name_ar: nameAr,
                level: selectedLevel,
                parent_id: parentRegionId,
                is_active: status === 'active',
                service_config: {
                    delivery: svcDelivery,
                    pickup: svcPickup,
                    dineIn: svcDineIn
                },
                ...(svcDelivery ? { delivery_config: { estimated_time_minutes: isNaN(estimated) ? 30 : estimated, ...(baseFee != null && !isNaN(baseFee) ? { base_fee: baseFee } : {}), ...(minOrder != null && !isNaN(minOrder) ? { minimum_order: minOrder } : {}) } } : {}),
                coordinates: { lat: isNaN(latVal) ? 33.3152 : latVal, lng: isNaN(lngVal) ? 44.3661 : lngVal, radius: isNaN(radiusVal) ? 3000 : radiusVal }
            };

            // If a polygon boundary exists, validate and send only boundary (no center/radius)
            if (this._drawnBoundary) {
                const b = this._drawnBoundary;
                if (b.type !== 'Polygon' || !Array.isArray(b.coordinates)) {
                    this.showError('Only Polygon boundaries are allowed');
                    return;
                }
                const ring = (b.coordinates[0] || []).map(pt => [Number(pt[0]), Number(pt[1])]);
                if (ring.length < 3) {
                    this.showError('Polygon must have at least 3 points');
                    return;
                }
                // Ensure closure for GeoJSON
                const first = ring[0];
                const last = ring[ring.length - 1];
                if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
                if (ring.length < 4) {
                    this.showError('Polygon must be closed (first point equals last)');
                    return;
                }
                // ✅ Send geometry directly (not boundary)
                payload.geometry = { type: 'Polygon', coordinates: [ring] };
                // Remove legacy center/radius when polygon is present
                delete payload.coordinates;
            } else if (!isEdit) {
                // For create without polygon, already prevented above; this is a safety net
                this.showError('Boundary is required when creating a new region');
                return;
            }

            // Persist to backend: PUT for edits, POST for creates
            const resp = isEdit
                ? await this.updateRegionInBackend(this.selectedRegion.regionId, payload)
                : await this.saveRegionToBackend(payload);

            if (resp?.success || (resp && (resp.regionId || resp.id) && (resp.name || resp.name_ar))) {
                const created = resp.region || resp.data || resp || payload;
                // Preserve existing base_fee if editing and user left blank
                if (isEdit) {
                    if (baseFee == null && this.selectedRegion?.deliveryConfig?.base_fee != null) {
                        if (created.delivery_config && created.delivery_config.base_fee == null) {
                            created.delivery_config.base_fee = this.selectedRegion.deliveryConfig.base_fee;
                        }
                    }
                    if (minOrder == null && this.selectedRegion?.deliveryConfig?.minimum_order != null) {
                        if (created.delivery_config && created.delivery_config.minimum_order == null) {
                            created.delivery_config.minimum_order = this.selectedRegion.deliveryConfig.minimum_order;
                        }
                    }
                }
                // Update in-memory list and refresh UI
                const newItem = this.transformRegionData(created);
                const existingIdx = this.regions.findIndex(x => x.regionId === newItem.regionId);
                if (existingIdx >= 0) {
                    this.regions.splice(existingIdx, 1, newItem);
                } else {
                    this.regions.unshift(newItem);
                }
                // Refresh master dropdown list to keep it up to date
                try { await this.loadAllRegionsForDropdown(); } catch {}
                this.closeRegionModal();
                this.renderRegionsList();
                this.renderMapMarkers?.();
                this.updateStatistics?.();
                this.showSuccess('Region saved successfully');
            } else {
                // Handle known backend validation errors for better UX
                const code = resp?.code || resp?.error || '';
                const msg = resp?.message || 'Failed to save region';
                if (resp?.status === 409 || String(code).toUpperCase().includes('DUPLICATE')) {
                    this.showError('Duplicate region: a region with the same name exists under the same parent/level');
                } else if (resp?.status === 400) {
                    if (code === 'PARENT_NOT_FOUND') this.showError('Parent region does not exist');
                    else if (code === 'PARENT_LEVEL_INVALID') this.showError('Parent level must be exactly level-1');
                    else if (code === 'SELF_PARENT') this.showError('Region cannot be its own parent');
                    else if (code && code.startsWith('BOUNDARY_')) this.showError(msg);
                    else this.showError(msg);
                } else {
                    this.showError(msg);
                }
            }
        } catch (e) {
            console.error('saveRegion error:', e);
            this.showError(e.message || 'Failed to save region');
        } finally {
            if (btnText) btnText.textContent = 'Save Region';
            if (btnSpin) btnSpin.style.display = 'none';
        }
    }

    async saveRegionToBackend(region) {
        try {
            const url = `${this._apiBase}/regions`;
            let response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(region)
            });
            if (!response.ok) {
                await this.maybeHandleAwsAuthError(response, `${url} [POST]`);
                const idToken = sessionStorage.getItem('idToken');
                if (idToken) {
                    response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(region)
                    });
                }
            }
            const status = response.status;
            const ct = response.headers.get('content-type') || '';
            let body = null;
            try { body = ct.includes('application/json') ? await response.json() : { message: await response.text() }; } catch {}
            if (!response.ok) {
                return { success: false, status, ...(body || {}) };
            }
            // On success, return the parsed body directly (may be the created item)
            return body || { success: true };
        } catch (error) {
            console.warn('Failed to save to backend:', error);
            return { success: false, status: 0, message: error.message || 'Network error' };
        }
    }

    async updateRegionInBackend(regionId, region) {
        try {
            const url = `${this._apiBase}/regions/${encodeURIComponent(regionId)}`;
            let response = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(region)
            });
            if (!response.ok) {
                await this.maybeHandleAwsAuthError(response, `${url} [PUT]`);
                const idToken = sessionStorage.getItem('idToken');
                if (idToken) {
                    response = await fetch(url, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(region)
                    });
                }
            }
            const status = response.status;
            const ct = response.headers.get('content-type') || '';
            let body = null;
            try { body = ct.includes('application/json') ? await response.json() : { message: await response.text() }; } catch {}
            if (!response.ok) {
                return { success: false, status, ...(body || {}) };
            }
            return body || { success: true };
        } catch (error) {
            console.warn('Failed to update region:', error);
            return { success: false, status: 0, message: error.message || 'Network error' };
        }
    }

    refreshRegions() {
        return this.loadRegions();
    }

    editRegion(regionId, event) {
        if (event) event.stopPropagation();
        this.openRegionModal(regionId);
    }

    async toggleRegionStatus(regionId, event) {
        console.log('🔄 Toggle status for:', regionId);
        if (event) event.stopPropagation();
        const idx = this.regions.findIndex(r => r.regionId === regionId);
        if (idx === -1) {
            console.error('❌ Region not found:', regionId);
            return;
        }
        const prev = this.regions[idx].isActive;
        console.log('Previous status:', prev);
        this.regions[idx].isActive = !prev; // optimistic
        this.renderRegionsList();
        try {
            let url = `${this._apiBase}/regions/${regionId}/toggle`;
            console.log('📤 Calling:', url);
            let resp = await fetch(url, { method: 'PATCH' });
            if (!resp.ok) {
                await this.maybeHandleAwsAuthError(resp, url);
                const idToken = sessionStorage.getItem('idToken');
                if (idToken) {
                    resp = await fetch(url, { method: 'PATCH', headers: { 'Authorization': `Bearer ${idToken}` }});
                }
            }
            if (!resp.ok) throw new Error(await resp.text());
            const data = await resp.json();
            console.log('📥 Toggle response:', data);
            const newStatus = !!(data?.data?.newStatus ?? this.regions[idx].isActive);
            console.log('New status:', newStatus);
            this.regions[idx].isActive = newStatus;
            this.renderRegionsList();
            this.showSuccess('Status updated');
        } catch (e) {
            console.error('❌ Toggle failed:', e);
            this.regions[idx].isActive = prev; // rollback
            this.renderRegionsList();
            this.showError(e.message || 'Failed to toggle status');
        }
    }

    async deleteRegion(regionId, event) {
        if (event) event.stopPropagation();
        if (!regionId) return;
        const ok = window.confirm('Delete this region? This cannot be undone.');
        if (!ok) return;
        try {
            let url = `${this._apiBase}/regions/${regionId}`;
            let resp = await fetch(url, { method: 'DELETE' });
            if (!resp.ok) {
                await this.maybeHandleAwsAuthError(resp, `${url} [DELETE]`);
                const idToken = sessionStorage.getItem('idToken');
                if (idToken) resp = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${idToken}` }});
            }
            if (!resp.ok) throw new Error(await resp.text());
            // Remove from memory and refresh
            this.regions = this.regions.filter(r => r.regionId !== regionId);
            this.renderRegionsList();
            this.updateStatistics?.();
            this.showSuccess('Region deleted');
        } catch (e) {
            this.showError(e.message || 'Failed to delete region');
        }
    }

    viewRegionDetails(regionId, event) {
        if (event) event.stopPropagation();
        const r = this.regions.find(x => x.regionId === regionId);
        if (!r) return;
        // Focus map
        if (this.map) {
            const c = r.coordinates?.center || { lat: 33.3152, lng: 44.3661 };
            this.map.setView([c.lat, c.lng], 12, { animate: true });
            if (r.boundary) {
                const layer = this._boundaryToLeafletLayer(r.boundary);
                if (layer && this._shapesLayer) {
                    layer.addTo(this._shapesLayer);
                    try { this.map.fitBounds(layer.getBounds(), { padding: [20, 20] }); } catch {}
                    setTimeout(() => { try { this._shapesLayer.removeLayer(layer); } catch {} }, 2500);
                }
            }
        }
        // Render info panel
        this._renderRegionInfoPanel(r);
    }

    _renderRegionInfoPanel(region) {
        const panel = document.getElementById('regionInfoPanel');
        if (!panel) return;
        const parent = region.parent_id ? (this.regions.find(x => x.regionId === region.parent_id) || null) : null;
        const children = this.regions.filter(x => x.parent_id === region.regionId);
        const coords = region.coordinates?.center || { lat: 33.3152, lng: 44.3661 };
        // ✅ Read from geometry first (new), fallback to boundary (old)
        const geom = region.geometry || region.boundary;
        const boundaryType = geom?.type || '—';
        const boundaryPoints = geom?.coordinates ? (geom.type === 'Polygon' ? (geom.coordinates[0]?.length || 0) : geom.coordinates.length) : 0;
        const lvl = Number(region.level);
        const levelLabel = ({0:'Country',1:'Governorate',2:'District',3:'Neighborhood'})[lvl] || String(lvl);
        const statusCls = region.isActive ? 'active' : 'inactive';
        const statusText = region.isActive ? 'ACTIVE' : 'INACTIVE';
        panel.innerHTML = `
            <div class="region-info-header">
                <div class="region-info-title"><i class="fas fa-location-dot" style="opacity:.7;"></i> ${region.regionName || ''}</div>
                <button class="region-info-close" title="Close" onclick="(function(){const p=document.getElementById('regionInfoPanel'); if(p) p.style.display='none';})()"><i class="fas fa-times"></i></button>
            </div>
            <div class="region-info-grid">
                <div class="region-info-label">Arabic</div><div class="region-info-value">${region.regionNameArabic || '—'}</div>
                <div class="region-info-label">Region ID</div><div class="region-info-value">${region.regionId}</div>
                <div class="region-info-label">Level</div><div class="region-info-value">${levelLabel}</div>
                <div class="region-info-label">Status</div><div class="region-info-value"><span class="region-info-badge ${statusCls}">${statusText}</span></div>
                <div class="region-info-label">Governorate</div><div class="region-info-value">${region.governorate || '—'}</div>
                <div class="region-info-label">Parent</div><div class="region-info-value">${parent ? `${parent.regionName} (${parent.regionId})` : '—'}</div>
                <div class="region-info-label">Children</div><div class="region-info-value">${children.length}</div>
                <div class="region-info-label">Center</div><div class="region-info-value">${coords.lat?.toFixed ? coords.lat.toFixed(6) : coords.lat}, ${coords.lng?.toFixed ? coords.lng.toFixed(6) : coords.lng}</div>
                <div class="region-info-label">Boundary</div><div class="region-info-value">${boundaryType} ${boundaryPoints ? `(${boundaryPoints} pts)` : ''}</div>
                <div class="region-info-label">Updated</div><div class="region-info-value">${region.updatedAt || region.updated_at || '—'}</div>
            </div>
        `;
        panel.style.display = 'block';
    }

    selectRegion(regionId) {
        this.selectedRegion = this.regions.find(x => x.regionId === regionId) || null;
    }

    handleSort(field) {
        if (!field) return;
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        this.renderRegionsList();
    }

    changePage(page) {
        if (this.pageMode === 'server') return; // ignore direct page jumps in server mode
        this.goToPage(page);
    }

    goToPage(page) {
        if (this.pageMode === 'server') return; // handled by next/prev only
        const totalPages = Math.ceil((this.filteredRegions?.length || 0) / this.itemsPerPage) || 1;
        this.currentPage = Math.max(1, Math.min(totalPages, parseInt(page, 10) || 1));
        this.renderRegionsList();
    }

    previousPage() { this.pageMode === 'server' ? this.previousServerPage() : this.goToPage(this.currentPage - 1); }
    nextPage() { this.pageMode === 'server' ? this.nextServerPage() : this.goToPage(this.currentPage + 1); }

    toggleView(viewType) {
        this.currentView = viewType || 'table';
        this.renderRegionsList();
    }
}

// Global functions for HTML onclick handlers
// Initialize a singleton instance and expose helpers on window
(function() {
    try {
        if (!window.regionsManager) {
            window.regionsManager = new RegionsManager();
        }
        const mgr = window.regionsManager;

        // Sorting
        if (!window.sortTable) {
            window.sortTable = function(field) {
                try { mgr.handleSort(field); } catch (e) { console.error('sortTable failed:', e); }
            };
        }

        // Pagination helpers (both server and client modes)
        if (!window.changePage) {
            window.changePage = function(delta) {
                try {
                    if (!mgr) return;
                    if (mgr.pageMode === 'server') {
                        if (delta === -1) mgr.previousServerPage();
                        else if (delta === 1) mgr.nextServerPage();
                    } else {
                        const target = (typeof delta === 'number' && Math.abs(delta) === 1) ? (mgr.currentPage + delta) : 1;
                        mgr.goToPage(target);
                    }
                } catch (e) { console.error('changePage failed:', e); }
            };
        }
        if (!window.goToPage) {
            window.goToPage = function(page) { try { mgr.goToPage(page); } catch (e) { console.error('goToPage failed:', e); } };
        }

        // CRUD/UI wrappers referenced in onclick attributes
        if (!window.openAddRegionModal) window.openAddRegionModal = function() { try { mgr.openRegionModal(); } catch (e) { console.error(e); } };
        if (!window.closeRegionModal) window.closeRegionModal = function() { try { mgr.closeRegionModal(); } catch (e) { console.error(e); } };
        if (!window.saveRegion) window.saveRegion = function() { try { mgr.saveRegion(); } catch (e) { console.error(e); } };
        if (!window.refreshRegionsData) window.refreshRegionsData = function() { try { mgr.refreshRegions(); } catch (e) { console.error(e); } };

        if (!window.viewRegionDetails) window.viewRegionDetails = function(id, ev) { try { mgr.viewRegionDetails(id, ev); } catch (e) { console.error(e); } };
        if (!window.editRegion) window.editRegion = function(id, ev) { try { mgr.editRegion(id, ev); } catch (e) { console.error(e); } };
        if (!window.toggleRegionStatus) window.toggleRegionStatus = function(id, ev) { try { mgr.toggleRegionStatus(id, ev); } catch (e) { console.error(e); } };
        if (!window.deleteRegion) window.deleteRegion = function(id, ev) { try { mgr.deleteRegion(id, ev); } catch (e) { console.error(e); } };
    } catch (e) {
        console.error('Failed to bootstrap RegionsManager globals:', e);
    }
})();