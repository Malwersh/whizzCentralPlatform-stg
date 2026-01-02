// Ultra-Simple Regions Manager
// 2-Level System: Governorates → Districts Only

class SimpleRegionsManager {
    constructor() {
        this.regions = [];
        this.governorates = [];
        this.init();
    }

    async init() {
        console.log('🗺️ Initializing Simple Regions Manager...');
        await this.loadRegions();
        this.setupForm();
        console.log('✅ Ready!');
    }

    setupForm() {
        const form = document.getElementById('regionForm');
        const typeSelect = document.getElementById('regionType');
        const parentGroup = document.getElementById('parentGroup');

        // Show/hide parent dropdown based on type
        typeSelect.addEventListener('change', (e) => {
            if (e.target.value === 'district') {
                parentGroup.style.display = 'block';
                this.populateParentDropdown();
            } else {
                parentGroup.style.display = 'none';
            }
        });

        // Form submission
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveRegion();
        });
    }

    populateParentDropdown() {
        const select = document.getElementById('parentId');
        select.innerHTML = '<option value="">Select governorate...</option>';
        
        this.governorates.forEach(gov => {
            const option = document.createElement('option');
            option.value = gov.region_id;
            option.textContent = `${gov.name} (${gov.name_ar})`;
            select.appendChild(option);
        });
    }

    async saveRegion() {
        const type = document.getElementById('regionType').value;
        const name = document.getElementById('regionName').value.trim();
        const nameAr = document.getElementById('regionNameAr').value.trim();
        const lat = parseFloat(document.getElementById('regionLat').value);
        const lng = parseFloat(document.getElementById('regionLng').value);
        const parentId = type === 'district' ? document.getElementById('parentId').value : 'root';

        if (type === 'district' && !parentId) {
            this.showAlert('Please select a parent governorate', 'error');
            return;
        }

        const regionData = {
            region_id: this.generateId(name),
            name: name,
            name_ar: nameAr,
            level: type,
            parent_id: parentId,
            governorate_id: type === 'governorate' ? this.generateId(name) : parentId,
            coordinates: { lat, lng, radius: 10000 },
            is_active: true,
            created_at: new Date().toISOString()
        };

        try {
            const response = await fetch('/api/regions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(regionData)
            });

            const result = await response.json();

            if (result.success) {
                this.showAlert('✅ Region saved!', 'success');
                document.getElementById('regionForm').reset();
                await this.loadRegions();
            } else {
                throw new Error(result.message || 'Failed to save');
            }
        } catch (error) {
            console.error('Error:', error);
            this.showAlert('❌ Error: ' + error.message, 'error');
        }
    }

    async loadRegions() {
        try {
            const response = await fetch('/api/regions');
            const data = await response.json();

            if (data.success) {
                this.regions = data.regions || [];
                this.governorates = this.regions.filter(r => r.level === 'governorate');
                this.renderTable();
                this.updateStats();
            }
        } catch (error) {
            console.error('Error loading regions:', error);
            document.getElementById('tableContainer').innerHTML = 
                '<p>Failed to load regions</p>';
        }
    }

    renderTable() {
        const container = document.getElementById('tableContainer');

        if (this.regions.length === 0) {
            container.innerHTML = '<p>No regions yet. Add your first one!</p>';
            return;
        }

        const html = `
            <table class="regions-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Arabic</th>
                        <th>Type</th>
                        <th>Coordinates</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.regions.map(r => this.renderRow(r)).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    }

    renderRow(region) {
        const badge = region.level === 'governorate' 
            ? '<span class="badge badge-governorate">Governorate</span>'
            : '<span class="badge badge-district">District</span>';

        return `
            <tr>
                <td><strong>${region.name}</strong></td>
                <td>${region.name_ar}</td>
                <td>${badge}</td>
                <td><small>${region.coordinates.lat.toFixed(4)}, ${region.coordinates.lng.toFixed(4)}</small></td>
                <td>
                    <button class="btn-delete" onclick="regionsManager.deleteRegion('${region.region_id}')">
                        🗑️ Delete
                    </button>
                </td>
            </tr>
        `;
    }

    updateStats() {
        const govCount = this.regions.filter(r => r.level === 'governorate').length;
        const distCount = this.regions.filter(r => r.level === 'district').length;

        document.getElementById('statTotal').textContent = this.regions.length;
        document.getElementById('statGovernorates').textContent = govCount;
        document.getElementById('statDistricts').textContent = distCount;
    }

    async deleteRegion(regionId) {
        if (!confirm('Delete this region?')) return;

        try {
            const response = await fetch(`/api/regions/${regionId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                this.showAlert('✅ Deleted!', 'success');
                await this.loadRegions();
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            console.error('Error:', error);
            this.showAlert('❌ Error: ' + error.message, 'error');
        }
    }

    generateId(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    showAlert(message, type) {
        const container = document.getElementById('alertContainer');
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.textContent = message;
        container.innerHTML = '';
        container.appendChild(alert);
        setTimeout(() => alert.remove(), 5000);
    }
}

// Initialize
let regionsManager;
document.addEventListener('DOMContentLoaded', () => {
    regionsManager = new SimpleRegionsManager();
});
