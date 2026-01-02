// Regions Manager with Google Places Autocomplete
// Simple, focused solution for adding Iraqi regions

class RegionsManager {
    constructor() {
        this.regions = [];
        this.autocomplete = null;
        this.selectedPlace = null;
        this.init();
    }

    async init() {
        console.log('🗺️ Initializing Regions Manager...');
        
        // Initialize Google Places Autocomplete
        this.initializeAutocomplete();
        
        // Load existing regions
        await this.loadRegions();
        
        // Setup form handler
        this.setupFormHandler();
        
        console.log('✅ Regions Manager ready');
    }

    initializeAutocomplete() {
        const input = document.getElementById('placeSearch');
        
        // Create autocomplete with Iraq-focused options
        this.autocomplete = new google.maps.places.Autocomplete(input, {
            componentRestrictions: { country: 'IQ' }, // Restrict to Iraq only
            fields: ['name', 'formatted_address', 'geometry', 'address_components', 'place_id'],
            types: ['(cities)'] // Focus on cities
        });

        // Listen for place selection
        this.autocomplete.addListener('place_changed', () => {
            this.onPlaceSelected();
        });

        console.log('✅ Google Places Autocomplete initialized');
    }

    onPlaceSelected() {
        const place = this.autocomplete.getPlace();
        
        if (!place.geometry) {
            this.showAlert('Please select a place from the dropdown', 'error');
            return;
        }

        this.selectedPlace = place;
        console.log('📍 Place selected:', place);

        // Auto-fill the form
        this.fillFormFromPlace(place);
        
        this.showAlert('✅ Place found! Review the details and click Save.', 'success');
    }

    fillFormFromPlace(place) {
        // Get address components
        const components = this.parseAddressComponents(place.address_components);
        
        // Fill English name
        document.getElementById('regionName').value = components.city || place.name;
        
        // Fill Arabic name (try to get from components)
        const arabicName = this.getArabicName(place) || components.city || place.name;
        document.getElementById('regionNameAr').value = arabicName;
        
        // Fill coordinates
        document.getElementById('regionLat').value = place.geometry.location.lat();
        document.getElementById('regionLng').value = place.geometry.location.lng();
        
        // Auto-select type based on address components
        const type = this.determineRegionType(components);
        document.getElementById('regionType').value = type;
        
        // Set default active status
        document.getElementById('regionStatus').value = 'active';
    }

    parseAddressComponents(components) {
        const parsed = {
            city: null,
            governorate: null,
            country: null
        };

        if (!components) return parsed;

        for (const component of components) {
            const types = component.types;
            
            if (types.includes('locality')) {
                parsed.city = component.long_name;
            } else if (types.includes('administrative_area_level_1')) {
                parsed.governorate = component.long_name;
            } else if (types.includes('country')) {
                parsed.country = component.long_name;
            }
        }

        return parsed;
    }

    getArabicName(place) {
        // Try to get Arabic name from address components
        if (place.address_components) {
            for (const component of place.address_components) {
                // Google often provides transliterations
                if (component.types.includes('locality')) {
                    return component.long_name;
                }
            }
        }
        return null;
    }

    determineRegionType(components) {
        // 18 Iraqi Governorates (محافظات)
        const governorates = [
            'Baghdad', 'Basra', 'Mosul', 'Erbil', 'Najaf', 'Karbala', 
            'Kirkuk', 'Sulaymaniyah', 'Dhi Qar', 'Diyala', 'Anbar',
            'Babil', 'Maysan', 'Muthanna', 'Nineveh', 'Saladin',
            'Wasit', 'Duhok'
        ];
        
        if (components.city && governorates.some(g => components.city.includes(g))) {
            return 'governorate';
        }
        
        // Everything else is a district
        return 'district';
    }

    setupFormHandler() {
        const form = document.getElementById('regionForm');
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveRegion();
        });
    }

    async saveRegion() {
        const saveBtn = document.getElementById('saveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = '💾 Saving...';

        try {
            // Collect form data
            const regionData = {
                name: document.getElementById('regionName').value.trim(),
                name_ar: document.getElementById('regionNameAr').value.trim(),
                level: document.getElementById('regionType').value,
                is_active: document.getElementById('regionStatus').value === 'active',
                coordinates: {
                    lat: parseFloat(document.getElementById('regionLat').value),
                    lng: parseFloat(document.getElementById('regionLng').value),
                    radius: parseInt(document.getElementById('regionRadius').value) || 10000
                },
                delivery_config: {
                    enabled: true,
                    delivery_fee: parseInt(document.getElementById('regionFee').value) || 2000,
                    min_order_value: 10000 // Default
                },
                place_id: this.selectedPlace?.place_id || null,
                source: 'google_places'
            };

            // Generate ID
            regionData.region_id = this.generateRegionId(regionData.name);

            console.log('💾 Saving region:', regionData);

            // Save to API
            const response = await fetch('/api/regions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(regionData)
            });

            const result = await response.json();

            if (result.success) {
                this.showAlert('✅ Region saved successfully!', 'success');
                
                // Reset form
                document.getElementById('regionForm').reset();
                document.getElementById('placeSearch').value = '';
                this.selectedPlace = null;
                
                // Reload regions list
                await this.loadRegions();
            } else {
                throw new Error(result.message || 'Failed to save region');
            }

        } catch (error) {
            console.error('❌ Error saving region:', error);
            this.showAlert('❌ Error: ' + error.message, 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save Region';
        }
    }

    generateRegionId(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') + '_' + Date.now();
    }

    async loadRegions() {
        const container = document.getElementById('tableContainer');
        container.innerHTML = '<div class="loading">Loading regions</div>';

        try {
            const response = await fetch('/api/regions');
            const data = await response.json();

            if (data.success) {
                this.regions = data.regions || [];
                this.renderRegionsTable();
                this.updateStatistics();
            } else {
                throw new Error('Failed to load regions');
            }

        } catch (error) {
            console.error('❌ Error loading regions:', error);
            container.innerHTML = `
                <div class="empty-state">
                    <div>⚠️</div>
                    <p>Failed to load regions. Please refresh the page.</p>
                </div>
            `;
        }
    }

    renderRegionsTable() {
        const container = document.getElementById('tableContainer');

        if (this.regions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div>📍</div>
                    <p>No regions yet. Add your first region above!</p>
                </div>
            `;
            return;
        }

        const table = `
            <table class="regions-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Arabic Name</th>
                        <th>Type</th>
                        <th>Coordinates</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.regions.map(region => this.renderRegionRow(region)).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = table;
    }

    renderRegionRow(region) {
        const typeBadge = this.getTypeBadge(region.level);
        const statusBadge = region.is_active 
            ? '<span class="badge badge-active">Active</span>'
            : '<span class="badge badge-inactive">Inactive</span>';

        return `
            <tr>
                <td><strong>${region.name}</strong></td>
                <td>${region.name_ar || '-'}</td>
                <td>${typeBadge}</td>
                <td>
                    <small>${region.coordinates.lat.toFixed(4)}, ${region.coordinates.lng.toFixed(4)}</small>
                </td>
                <td>${statusBadge}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-edit" onclick="regionsManager.editRegion('${region.region_id}')">
                            ✏️ Edit
                        </button>
                        <button class="btn-small btn-delete" onclick="regionsManager.deleteRegion('${region.region_id}')">
                            🗑️ Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    getTypeBadge(level) {
        const badges = {
            'governorate': '<span class="badge badge-governorate">Governorate (محافظة)</span>',
            'district': '<span class="badge badge-district">District (قضاء)</span>'
        };
        return badges[level] || `<span class="badge">${level}</span>`;
    }

    updateStatistics() {
        const stats = {
            total: this.regions.length,
            governorate: 0,
            district: 0,
            active: 0
        };

        this.regions.forEach(region => {
            if (region.level === 'governorate') stats.governorate++;
            if (region.level === 'district') stats.district++;
            if (region.is_active) stats.active++;
        });

        document.getElementById('statTotal').textContent = stats.total;
        document.getElementById('statGovernorate').textContent = stats.governorate;
        document.getElementById('statDistrict').textContent = stats.district;
        document.getElementById('statActive').textContent = stats.active;
    }

    async deleteRegion(regionId) {
        if (!confirm('Are you sure you want to delete this region?')) {
            return;
        }

        try {
            const response = await fetch(`/api/regions/${regionId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                this.showAlert('✅ Region deleted successfully', 'success');
                await this.loadRegions();
            } else {
                throw new Error(result.message || 'Failed to delete region');
            }

        } catch (error) {
            console.error('❌ Error deleting region:', error);
            this.showAlert('❌ Error: ' + error.message, 'error');
        }
    }

    editRegion(regionId) {
        // TODO: Implement edit functionality
        this.showAlert('Edit functionality coming soon!', 'error');
    }

    showAlert(message, type = 'success') {
        const container = document.getElementById('alertContainer');
        const alertClass = type === 'success' ? 'alert-success' : 'alert-error';
        
        const alert = document.createElement('div');
        alert.className = `alert ${alertClass}`;
        alert.textContent = message;
        
        container.innerHTML = '';
        container.appendChild(alert);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            alert.remove();
        }, 5000);
    }
}

// Initialize when page loads
let regionsManager;
document.addEventListener('DOMContentLoaded', () => {
    regionsManager = new RegionsManager();
});
