async function driverStaffApi(path,body) {
    await window.Auth.ensureSession();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    let response;
    try{response=await fetch(window.WIZZCENTRAL_CONFIG.STAFF_API_BASE_URL+path,{method:body?'POST':'GET',signal:controller.signal,headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}finally{clearTimeout(timer);}
    const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'تعذر تحميل بيانات السائقين'),{code:data.error});return data;
}
// Drivers Management JavaScript with Direct Authentication

// Use centralized AWS utilities
const DRIVERS_TABLE = 'WhizzDrivers_staging'; // Real drivers table

// Ensure user is authenticated before loading drivers data
async function ensureAuthenticated() {
    try {
        // Preferred: centralized Auth (single redirect authority)
        if (window.Auth && typeof window.Auth.requireAuthentication === 'function') {
            const ok = await window.Auth.requireAuthentication();
            return !!ok;
        }

        // Fallback: legacy AuthService
        if (!window.AuthService || typeof window.AuthService.isAuthenticated !== 'function') {
            throw new Error('No authentication service available');
        }

        if (window.AuthService.isAuthenticated()) {
            console.log('User is already authenticated');
            return true;
        }

        console.log('User not authenticated (legacy AuthService)');
        // IMPORTANT: don’t hard-redirect here; return false and let callers/page handle UI.
        return false;
        
    } catch (error) {
        console.error('Authentication check failed:', error);
        return false;
    }
}

// Load drivers data from DynamoDB - Real integration with WhizzDrivers_staging
async function loadDriversData() {
    try {
        console.log('Loading drivers data from WhizzDrivers_staging table...');

        // Ensure user is authenticated
        if (!(await ensureAuthenticated())) {
            return;
        }

        await window.RBAC.ensure();
        const result=await driverStaffApi('/staff/drivers');
        result.Items=result.items;
        const items = (result && Array.isArray(result.Items)) ? result.Items : [];
        
        console.log(`Found ${items.length} drivers in table`);
        return processDriversItems(items);
        
    } catch (error) {
        console.error('Error loading drivers data:', error);
        drivers = [];
        const tbody = document.getElementById('driversTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 2rem; color: #e74c3c;"></td></tr>';
            const cell = tbody.querySelector('td');
            cell.textContent = window.Auth.dataErrorMessage(error);
            const retry = document.createElement('button');
            retry.textContent = 'Retry';
            retry.onclick = () => loadDriversData();
            cell.appendChild(retry);
            if (error.code === 'SessionExpired') {
                const login = document.createElement('button');
                login.textContent = 'Sign in';
                login.onclick = () => window.Auth.redirectToLogin('Session expired');
                cell.appendChild(login);
            }
        }
    }
}

// Defensive: purge any legacy/mock rows injected by old builds
function purgeMockRows(forceSpinner = false) {
    try {
        const tbody = document.getElementById('driversTableBody');
        if (!tbody) return;
        const text = (tbody.textContent || '').trim();
        const looksMock = /Carlos Rodriguez|Ahmed Hassan|Maria Santos|#DRV00\d|Downtown Area|North District|South Area|\$89\.50|\$125\.75|\$45\.25/.test(text);
        if (looksMock || forceSpinner) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem;">
                <i class="fas fa-spinner fa-spin"></i> Loading drivers from database...
            </td></tr>`;
        }
    } catch (_) {}
}

// Observe table body for unexpected legacy injections and purge them
(function setupMockGuard(){
    try {
        const tbody = document.getElementById('driversTableBody');
        if (!tbody || typeof MutationObserver === 'undefined') return;
        const observer = new MutationObserver(() => purgeMockRows(false));
        observer.observe(tbody, { childList: true, subtree: true, characterData: true });
        // Timed sweeps to catch late injections
        setTimeout(() => purgeMockRows(false), 0);
        setTimeout(() => purgeMockRows(false), 500);
        setTimeout(() => purgeMockRows(false), 1500);
    } catch (_) {}
})();

// Create a new driver record in DynamoDB (real integration)
async function createDriverInDB(driverInput) {
    if(!window.RBAC.staff?.employee.roles.includes('bootstrap_admin'))throw Error('إنشاء حساب السائق يتم من تطبيق السائق');
    // Ensure authenticated and AWS initialized
    const dynamoDB = await AWSUtils.getDynamoDBClient();
    if (!dynamoDB) {
        throw new Error('AWS is not initialized (missing idToken). Please login again.');
    }

    const nowSec = Math.floor(Date.now() / 1000);

    // Normalize fields expected by backend/table
    const item = {
        driverId: driverInput.id,
        id: driverInput.id, // keep both keys for schema compatibility
        name: driverInput.name,
        fullName: driverInput.name,
        email: driverInput.email,
        phoneNumber: driverInput.rawPhone || driverInput.phone,
        status: 'PENDING_REVIEW',
        registrationStatus: 'PENDING_REVIEW',
        vehicleType: driverInput.vehicleType || 'motorcycle',
        licenseNumber: driverInput.licenseNumber || driverInput.license || null,
        emergencyContact: driverInput.emergencyContact || null,
        ordersCompleted: 0,
        rating: 0,
        earnings: 0,
        createdAt: nowSec,
        updatedAt: nowSec
    };

    const params = {
        TableName: DRIVERS_TABLE,
        Item: item,
        // Prevent accidental overwrite if driverId already exists
        ConditionExpression: 'attribute_not_exists(driverId)'
    };

    console.log('Putting new driver item:', params);
    await dynamoDB.put(params).promise();
    return item;
}

function processDriversItems(items) {
    if (!Array.isArray(items)) items = [];
    drivers = items.map(item => ({
        id: item.driverId || item.id || `driver-${Date.now()}-${Math.random()}`,
        name: item.name || item.fullName || 'Unknown Driver',
        email: item.email || 'N/A',
        phone: formatPhoneNumber(item.phoneNumber || item.phone),
        status: mapDriverStatus(item.status || item.registrationStatus, item),
        location: [item.governorate_name, item.work_region_name].filter(Boolean).join(' / ') || item.city || item.location || 'Unknown Location',
        ordersCompleted: item.ordersCompleted || 0,
        rating: typeof item.rating === 'number' ? item.rating : 4.5,
        earnings: typeof item.earnings === 'number' ? item.earnings : 0,
        vehicleType: mapVehicleType(item.vehicleType),
        licenseNumber: item.licenseNumber || 'N/A',
        nationalId: item.nationalId || 'N/A',
        createdAt: item.profileCompletedAt ? formatDate(item.profileCompletedAt) : (item.createdAt ? formatDate(item.createdAt) : 'N/A'),
        updatedAt: item.updatedAt ? formatDate(item.updatedAt) : 'N/A',
        avatar: generateDriverAvatar(item.name || item.fullName),
        documents: {
            drivingLicense: item.drivingLicenseUrl || item.drivingLicense || null,
            nationalId: item.nationalIdUrl || null,
            vehicleRegistration: item.registrationPaperUrl || item.vehicleRegistration || null,
            nonCriminalRecord: item.nonCriminalRecord || null
        },
        fullData: item
    }));

    console.log(`✅ Successfully loaded ${drivers.length} drivers from WhizzDrivers_staging!`);
    initializeDriversPage();
}

// Helper function to map driver status from database to display format
function mapDriverStatus(dbStatus, driver = {}) {
    if (String(dbStatus).toUpperCase() === 'ACTIVE' &&
        driver.isVerified !== true && driver.is_verified !== true && driver.documentsVerified !== true &&
        !['APPROVED', 'VERIFIED'].includes(String(driver.registrationStatus || '').toUpperCase())) {
        return 'pending';
    }

    const statusMap = {
        'PENDING_REVIEW': 'pending',
        'PENDING': 'pending', 
        'APPROVED': 'online',
        'VERIFIED': 'online',
        'BANNED': 'offline',
        'ACTIVE': 'online',
        'REJECTED': 'offline',
        'SUSPENDED': 'offline',
        'INACTIVE': 'offline',
        // Handle lowercase versions too
        'pending_review': 'pending',
        'pending': 'pending',
        'approved': 'online', 
        'active': 'online',
        'rejected': 'offline',
        'suspended': 'offline',
        'inactive': 'offline'
    };
    return statusMap[dbStatus] || 'pending';
}

// Helper function to map vehicle type to display format
function mapVehicleType(dbVehicleType) {
    if (!dbVehicleType) return 'unknown';

    const vehicleMap = {
        'دراجة نارية': 'motorcycle',
        'سيارة': 'car',
        'دراجة هوائية': 'bicycle',
        'motorcycle': 'motorcycle',
        'car': 'car',
        'bicycle': 'bicycle'
    };
    return vehicleMap[dbVehicleType] || 'motorcycle';
}

// Helper function to format dates
function formatDate(timestamp) {
    if (!timestamp) return '—';
    const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
    return window.WizzLocale.date(date);
}

// Generate avatar URL for driver
function generateDriverAvatar(name) {
    if (!name) return 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=40&h=40&fit=crop&crop=center';
    const encodedName = encodeURIComponent(name);
    return `https://ui-avatars.com/api/?name=${encodedName}&size=40&background=4f46e5&color=fff`;
}

// Helper function to format phone numbers
function formatPhoneNumber(phone) {
    if (!phone || phone === 'None' || phone === 'null' || phone === 'undefined') {
        return 'N/A';
    }
    
    // Handle string phone numbers
    const phoneStr = phone.toString().trim();
    
    // If it's already formatted with +964, return as is
    if (phoneStr.startsWith('+964')) {
        return phoneStr;
    }
    
    // If it starts with 964, add the +
    if (phoneStr.startsWith('964')) {
        return '+' + phoneStr;
    }
    
    // If it starts with 07, convert to +964 format
    if (phoneStr.startsWith('07')) {
        return '+964' + phoneStr.substring(1);
    }
    
    // If it's just digits and looks like Iraqi number, try to format
    if (phoneStr.match(/^\d{10}$/) && phoneStr.startsWith('7')) {
        return '+964' + phoneStr;
    }
    
    // Return original if we can't format it
    return phoneStr || 'N/A';
}

// Driver management functions
let drivers = []; // Will be populated from DynamoDB

// Lightweight notification helper
function notify(message, type = 'info') {
    if (window.dashboardFunctions && typeof window.dashboardFunctions.showNotification === 'function') {
        window.dashboardFunctions.showNotification(message, type);
        return;
    }
    // Fallback toast
    const toast = document.createElement('div');
    toast.style.cssText = `position: fixed; right: 20px; bottom: 20px; background: ${type === 'error' ? '#fee2e2' : type === 'success' ? '#dcfce7' : '#dbeafe'}; color: #111; border: 1px solid ${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'}; border-radius: 8px; padding: 10px 14px; z-index: 10000; box-shadow: 0 4px 14px rgba(0,0,0,.15); font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity .3s'; }, 2500);
    setTimeout(() => { toast.remove(); }, 3000);
}

function initializeDriversPage() {
    renderDriversTable();
    updateDriverStats();
}

function setupEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', filterDrivers);
    }

    // Filter functionality
    const statusFilter = document.getElementById('statusFilter');
    const ratingFilter = document.getElementById('ratingFilter');

    if (statusFilter) {
        statusFilter.addEventListener('change', filterDrivers);
    }

    if (ratingFilter) {
        ratingFilter.addEventListener('change', filterDrivers);
    }

    // Add driver form
    const addDriverForm = document.getElementById('addDriverForm');
    if (addDriverForm) {
        addDriverForm.addEventListener('submit', handleAddDriver);
    }
    
    // Edit driver form
    const editDriverForm = document.getElementById('editDriverForm');
    if (editDriverForm) {
        editDriverForm.addEventListener('submit', handleEditDriver);
    }
}

function renderDriversTable(driversList = drivers) {
    const tbody = document.getElementById('driversTableBody');
    if (!tbody) return;

    // Build rows with escaped user data (structure is trusted, values sanitized)
    const rows = driversList.map(driver => {
        const safeName = SecurityUtils.escapeHTML(driver.name || 'N/A');
        const safePhone = SecurityUtils.escapeHTML(driver.phone || 'N/A');
        const safeLocation = SecurityUtils.escapeHTML(driver.location || 'N/A');
        const safeAvatar = SecurityUtils.sanitizeURL(driver.avatar || '');
        const safeId = SecurityUtils.escapeHTML(driver.id || '');
        const rawStatus = driver.status || 'offline';
        const safeStatus = SecurityUtils.escapeHTML(rawStatus);
        const ordersCompleted = Number(driver.ordersCompleted || 0);
        const ratingValue = Number(driver.rating || 0).toFixed(1);
        const earningsValue = Number(driver.earnings || 0).toFixed(2);

        // Build actions without relying on inline JS sanitization stripping
        const viewAction = `<button class="btn-action" data-driver-id="${safeId}" data-action="view" title="View Details"><i class="fas fa-eye"></i></button>`;
        const editAction = `<button class="btn-action" data-driver-id="${safeId}" data-action="edit" title="Edit" data-write-only><i class="fas fa-edit"></i></button>`;
        const toggleActionIcon = (rawStatus === 'online' || rawStatus === 'approved') ? 'fa-pause' : 'fa-check';
        const toggleActionTitle = (rawStatus === 'online' || rawStatus === 'approved') ? 'Suspend Driver' : 'Approve Driver';
        const toggleAction = `<button class="btn-toggle-status ${(rawStatus === 'online' || rawStatus === 'approved') ? 'approved' : 'pending'}" data-driver-id="${safeId}" data-current-status="${safeStatus}" title="${toggleActionTitle}" data-write-only><i class="fas ${toggleActionIcon}"></i></button>`;

        return `
        <tr>
            <td>
                <div class="driver-info">
                    <div class="driver-avatar">${safeAvatar ? `<img src="${safeAvatar}" alt="${safeName}">` : '<i class="fas fa-user"></i>'}</div>
                    <div>
                        <div class="driver-name">${safeName}</div>
                        <div class="driver-id">#${safeId}</div>
                    </div>
                </div>
            </td>
            <td>${safePhone}</td>
            <td><span class="status-badge ${safeStatus}">${capitalizeFirst(safeStatus)}</span></td>
            <td>${safeLocation}</td>
            <td>${ordersCompleted}</td>
            <td>
                <div class="rating">
                    <span class="rating-stars">${generateStars(Number(ratingValue))}</span>
                    <span class="rating-value">${ratingValue}</span>
                </div>
            </td>
            <td>${window.RBAC.staff?.employee.roles.includes('bootstrap_admin')?'$'+earningsValue:'—'}</td>
            <td>
                <div class="actions">${viewAction}${window.RBAC.staff?.permissions.includes('drivers.edit')?editAction:''}${window.RBAC.staff?.employee.roles.includes('bootstrap_admin')?toggleAction:''}</div>
            </td>
        </tr>`;
    }).join('');

    // Direct assignment (structure trusted, values escaped)
    tbody.innerHTML = rows || `<tr><td colspan="8" class="text-center" style="padding:2rem;">No drivers found</td></tr>`;

    // Attach event listeners for actions (delegation)
    tbody.onclick = function(e){
        const btn = e.target.closest('button');
        if(!btn) return;
        const id = btn.getAttribute('data-driver-id');
        const action = btn.getAttribute('data-action');
        if(action === 'view') { viewDriver(id); return; }
        if(action === 'edit') { editDriver(id); return; }
        if(btn.classList.contains('btn-toggle-status')) {
            const currentStatus = btn.getAttribute('data-current-status');
            toggleDriverStatus(id, currentStatus);
        }
    };
}

function generateStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;
    let stars = '';

    for (let i = 0; i < fullStars; i++) {
        stars += '<i class="fas fa-star"></i>';
    }

    if (hasHalfStar) {
        stars += '<i class="fas fa-star-half-alt"></i>';
    }

    const emptyStars = 5 - Math.ceil(rating);
    for (let i = 0; i < emptyStars; i++) {
        stars += '<i class="far fa-star"></i>';
    }

    return stars;
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function filterDrivers() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const ratingFilter = document.getElementById('ratingFilter').value;

    let filteredDrivers = drivers.filter(driver => {
        const matchesSearch = driver.name.toLowerCase().includes(searchTerm) ||
            driver.id.toLowerCase().includes(searchTerm) ||
            driver.phone.includes(searchTerm);

        const matchesStatus = !statusFilter || driver.status === statusFilter;

        const matchesRating = !ratingFilter ||
            (ratingFilter === '5' && driver.rating >= 5) ||
            (ratingFilter === '4' && driver.rating >= 4) ||
            (ratingFilter === '3' && driver.rating >= 3);

        return matchesSearch && matchesStatus && matchesRating;
    });

    renderDriversTable(filteredDrivers);
}

function updateDriverStats() {
    if (drivers.length === 0) {
        // Show zeros when no drivers loaded
        const statCards = document.querySelectorAll('.stat-card');
        if (statCards.length >= 4) {
            statCards[0].querySelector('h3').textContent = '0';
            statCards[1].querySelector('h3').textContent = '0';
            statCards[2].querySelector('h3').textContent = '0';
            statCards[3].querySelector('h3').textContent = '0.0';
        }
        return;
    }

    const onlineDrivers = drivers.filter(d => d.status === 'online' || d.status === 'approved').length;
    const deliveringDrivers = drivers.filter(d => d.status === 'delivering' || d.status === 'busy').length;
    const pendingDrivers = drivers.filter(d => d.status === 'pending').length;
    const totalDrivers = drivers.length;
    
    // Calculate average rating, excluding drivers with no rating
    const driversWithRating = drivers.filter(d => d.rating > 0);
    const avgRating = driversWithRating.length > 0 
        ? (driversWithRating.reduce((sum, d) => sum + d.rating, 0) / driversWithRating.length).toFixed(1)
        : '0.0';

    // Update stat cards
    const statCards = document.querySelectorAll('.stat-card');
    if (statCards.length >= 4) {
        statCards[0].querySelector('h3').textContent = onlineDrivers;
        statCards[0].querySelector('p').textContent = 'Approved Drivers';
        
        statCards[1].querySelector('h3').textContent = pendingDrivers;
        statCards[1].querySelector('p').textContent = 'Pending Review';
        
        statCards[2].querySelector('h3').textContent = totalDrivers;
        
        statCards[3].querySelector('h3').textContent = avgRating;
    }

    console.log(`📊 Driver Stats Updated: ${totalDrivers} total, ${onlineDrivers} approved, ${pendingDrivers} pending, ${avgRating} avg rating`);
}

// Modal functions
function openAddDriverModal() {
    const modal = document.getElementById('addDriverModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeAddDriverModal() {
    const modal = document.getElementById('addDriverModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        // Reset form
        document.getElementById('addDriverForm').reset();
    }
}

function handleAddDriver(e) {
    e.preventDefault();

    // Convert to async to allow real DB creation
    (async () => {
        try {
            const submitBtn = document.querySelector('#addDriverModal .btn-primary[form="addDriverForm"]');
            const originalBtnHTML = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...'; }

            // Collect form data
            const formData = new FormData(e.target);
            const name = formData.get('name');
            const email = formData.get('email');
            const rawPhone = formData.get('phone');
            const license = formData.get('license');
            const vehicleType = formData.get('vehicleType');
            const emergencyContact = formData.get('emergencyContact');

            // Generate driver id
            const genId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('DRV_' + Date.now() + '_' + Math.floor(Math.random()*1e6));

            const newDriver = {
                id: genId,
                name,
                email,
                phone: formatPhoneNumber(rawPhone),
                rawPhone,
                status: 'pending',
                location: 'Pending Location Verification',
                ordersCompleted: 0,
                rating: 0.0,
                earnings: 0,
                vehicleType,
                avatar: generateDriverAvatar(name),
                licenseNumber: license,
                emergencyContact,
                createdAt: new Date().toISOString()
            };

            // Persist to DynamoDB
            try {
                await createDriverInDB(newDriver);
                notify(`Driver "${newDriver.name}" created successfully.`, 'success');
            } catch (err) {
                console.error('Create driver failed:', err);
                const msg = (err && (err.message || err.code)) || 'Unknown error';
                notify(`Failed to create driver in database: ${msg}`, 'error');
                // If permissions missing, surface clear hint
                if ((err.code === 'AccessDeniedException') || /not authorized|access denied|insufficient/i.test(msg)) {
                    notify('AWS IAM role for Cognito Identity likely missing DynamoDB PutItem on WhizzDrivers_staging.', 'error');
                }
                // Fallback: add locally so user sees immediate result (optional)
                drivers.push(newDriver);
                renderDriversTable();
                updateDriverStats();
                throw err; // rethrow to skip success flow below
            }

            // Refresh from DB to reflect canonical values
            await loadDriversData();
            updateDriverStats();
            closeAddDriverModal();
        } catch (ex) {
            console.warn('Add driver flow finished with warnings/errors:', ex);
        } finally {
            const submitBtn = document.querySelector('#addDriverModal .btn-primary[form="addDriverForm"]');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Add Driver'; }
        }
    })();
}

// Driver action functions
function viewDriver(driverId) {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) {
        notify('Driver not found', 'error');
        return;
    }
    
    // Store current driver ID for quick edit access
    window.currentViewDriverId = driverId;
    
    // Populate driver header
    document.getElementById('viewDriverNameHeader').textContent = driver.name || 'Unknown Driver';
    
    // Populate status badge
    const statusBadge = document.getElementById('viewDriverStatusBadge');
    const statusMap = {
        'ACTIVE': { text: 'Active', color: 'var(--md-sys-color-primary)', bg: 'var(--md-sys-color-primary-container)' },
        'APPROVED': { text: 'Approved', color: 'var(--md-sys-color-primary)', bg: 'var(--md-sys-color-primary-container)' },
        'PENDING_REVIEW': { text: 'Pending Review', color: 'var(--md-sys-color-tertiary)', bg: 'var(--md-sys-color-tertiary-container)' },
        'SUSPENDED': { text: 'Suspended', color: 'var(--md-sys-color-error)', bg: 'var(--md-sys-color-error-container)' },
        'REJECTED': { text: 'Rejected', color: 'var(--md-sys-color-error)', bg: 'var(--md-sys-color-error-container)' }
    };
    
    const statusInfo = statusMap[driver.fullData?.status || driver.status] || statusMap[driver.status === 'online' ? 'APPROVED' : 'PENDING_REVIEW'];
    statusBadge.textContent = statusInfo.text;
    statusBadge.style.color = statusInfo.color;
    statusBadge.style.background = statusInfo.bg;
    
    // Populate Personal Information
    document.getElementById('viewDriverNameFull').textContent = driver.name || 'N/A';
    document.getElementById('viewDriverNationalId').textContent = driver.nationalId || 'N/A';
    document.getElementById('viewDriverCityFull').textContent = [driver.governorate_name, driver.work_region_name, driver.home_address_text].filter(Boolean).join(' / ') || driver.city || 'N/A';
    document.getElementById('viewDriverLicenseFull').textContent = driver.licenseNumber || 'N/A';
    
    // Populate Vehicle Information
    const vehicleTypeMap = {
        'motorcycle': 'Motorcycle (دراجة نارية)',
        'دراجة نارية': 'Motorcycle (دراجة نارية)',
        'car': 'Car (سيارة)',
        'سيارة': 'Car (سيارة)',
        'bicycle': 'Bicycle (دراجة هوائية)',
        'دراجة هوائية': 'Bicycle (دراجة هوائية)'
    };
    document.getElementById('viewDriverVehicleType').textContent = vehicleTypeMap[driver.vehicleType] || driver.vehicleType || 'N/A';
    document.getElementById('viewDriverRegStatus').textContent = statusInfo.text;
    
    // Populate System Information
    document.getElementById('viewDriverIdFull').textContent = driver.id || 'N/A';
    document.getElementById('viewProfileCompletedFull').textContent = formatDateTime(driver.profileCompletedAt);
    document.getElementById('viewLastUpdatedFull').textContent = formatDateTime(driver.updatedAt);
    
    // Display documents with larger previews
    displayViewDriverDocuments(driver);
    
    // Open the view modal
    openViewDriverModal();
}

async function displayViewDriverDocuments(driver) {
    const section = document.getElementById('viewDocumentsSection');
    if (!section) return;
    section.replaceChildren();
    for (const [label, value] of [
        ['رخصة القيادة', driver.drivingLicenseUrl || driver.fullData?.drivingLicenseUrl],
        ['سنوية السيارة', driver.registrationPaperUrl || driver.fullData?.registrationPaperUrl],
        ['البطاقة الوطنية', driver.nationalIdUrl || driver.fullData?.nationalIdUrl]
    ]) {
        const card = document.createElement('div');
        card.className = 'document-card';
        const heading = document.createElement('h4');
        heading.textContent = label;
        card.append(heading);
        section.append(card);
        try {
            const url = await AWSUtils.resolveDriverDocument(value);
            if (!url) { card.append('لم يتم رفع المستند'); continue; }
            const link = document.createElement('a');
            link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'فتح المستند';
            const img = document.createElement('img');
            img.src = url; img.alt = label;
            img.onerror = () => img.remove();
            card.append(link, img);
        } catch (_) { card.append('تعذر فتح المستند. تحقق من صلاحيات الإدارة وأعد المحاولة.'); }
    }
}

function openViewDriverModal() {
    const modal = document.getElementById('viewDriverModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeViewDriverModal() {
    const modal = document.getElementById('viewDriverModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function editDriverFromView() {
    // Close view modal
    closeViewDriverModal();
    
    // Open edit modal with the same driver
    if (window.currentViewDriverId) {
        editDriver(window.currentViewDriverId);
    }
}

async function editDriver(driverId) {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) {
        notify('Driver not found', 'error');
        return;
    }
    
    // Reset stale values before loading this driver.
    document.getElementById('editDriverForm').reset();
    document.getElementById('editDriverId').value = driver.id;
    openEditDriverModal();
    
    // Wait for cities to load
    await loadCitiesDropdown();
    if (document.getElementById('editDriverId').value !== driver.id || document.getElementById('editDriverModal').style.display === 'none') return;
    
    // Populate read-only information section
    document.getElementById('viewDriverId').textContent = driver.id || 'N/A';
    document.getElementById('viewProfileCompleted').textContent = formatDateTime(driver.fullData?.profileCompletedAt) || 'N/A';
    document.getElementById('viewLastUpdated').textContent = formatDateTime(driver.fullData?.updatedAt) || 'N/A';
    
    // Pre-populate the edit form with driver data
    document.getElementById('editDriverId').value = driver.id;
    document.getElementById('editDriverName').value = driver.name || '';
    
    selectDriverRegions(driver.fullData || {});
    document.getElementById('editLandmark').value = driver.fullData?.home_address_text || '';
    document.getElementById('editDriverLicense').value = driver.fullData?.licenseNumber || '';
    document.getElementById('editDriverNationalId').value = driver.fullData?.nationalId || '';
    document.getElementById('editDriverNationalId').closest('.form-row').hidden = Number(driver.fullData?.profileSchemaVersion) === 2;
    document.getElementById('editDriverNationalId').required = Number(driver.fullData?.profileSchemaVersion) !== 2;
    document.getElementById('editDriverLicense').required = Number(driver.fullData?.profileSchemaVersion) !== 2;
    document.getElementById('editVehicleType').value = driver.fullData?.vehicleType || driver.vehicleType || '';
    
    // Map display status to DB status
    const fullStatus = driver.status === 'pending' ? 'PENDING_REVIEW' : (driver.fullData?.status || driver.status);
    let dbStatus = 'PENDING_REVIEW';
    if (fullStatus === 'online' || fullStatus === 'approved' || fullStatus === 'APPROVED' || fullStatus === 'ACTIVE') {
        dbStatus = 'ACTIVE';
    } else if (fullStatus === 'offline' || fullStatus === 'suspended' || fullStatus === 'SUSPENDED') {
        dbStatus = 'SUSPENDED';
    } else if (fullStatus === 'rejected' || fullStatus === 'REJECTED') {
        dbStatus = 'REJECTED';
    }
    document.getElementById('editDriverStatus').value = dbStatus;
    document.getElementById('editDriverStatus').dataset.initialStatus = dbStatus;
    
    // Display documents
    displayDriverDocuments(driver);
}

async function displayDriverDocuments(driver) {
    for (const [field, value] of [
        ['drivingLicense', driver.fullData?.drivingLicenseUrl],
        ['registrationPaper', driver.fullData?.registrationPaperUrl],
        ['nationalId', driver.fullData?.nationalIdUrl]
    ]) {
        const link = document.getElementById(`${field}Link`);
        const image = document.getElementById(`${field}Image`);
        const none = document.getElementById(`${field}None`);
        if (!link) continue;
        link.style.display = image.style.display = 'none';
        none.style.display = 'block'; none.textContent = 'جار تحميل المستند...';
        try {
            const url = await AWSUtils.resolveDriverDocument(value);
            if (!url) { none.textContent = 'لم يتم رفع المستند'; continue; }
            link.href = url; link.style.display = 'inline-block'; none.style.display = 'none';
            const img = image.querySelector('img'); img.src = url;
            img.onerror = () => { image.style.display = 'none'; };
            image.style.display = 'block';
        } catch (_) { none.textContent = 'تعذر فتح المستند؛ تحقق من صلاحيات الإدارة'; }
    }
}

function formatDateTime(timestamp) {
    if (!timestamp) return null;
    const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
    return window.WizzLocale.dateTime(date);
}

let driverRegionModel = null;
let editorLoadVersion = 0;
function fillRegionSelect(select, rows, selected, label) {
    select.replaceChildren(new Option(label, ''));
    for (const row of rows) select.add(new Option(row.displayName, row.regionId));
    select.value = selected || '';
}
function selectDriverRegions(profile) {
    if (!driverRegionModel) return;
    const gov = document.getElementById('editGovernorate');
    const selectedRegion = driverRegionModel.regions.find(r => r.regionId === profile.work_region_id);
    fillRegionSelect(gov, driverRegionModel.governorates, profile.governorate_id || selectedRegion?.governorateId, 'اختر المحافظة');
    const fill = selected => fillRegionSelect(document.getElementById('editDriverCity'),
        driverRegionModel.regions.filter(r => r.governorateId === gov.value && (r.open || r.regionId === profile.work_region_id)), selected, 'اختر منطقة العمل');
    fill(profile.work_region_id);
    gov.onchange = () => fill(null);
}
async function loadCitiesDropdown() {
    const version = ++editorLoadVersion;
    const error = document.getElementById('editRegionError');
    const save = document.querySelector('#editDriverModal .btn-primary');
    if (save) save.disabled = true;
    error.textContent = 'جاري تحميل المناطق…';
    driverRegionModel = null;
    try {
        const {base,derived}=await driverStaffApi('/staff/drivers/regions');
        if (version !== editorLoadVersion) return;
        driverRegionModel = DriverRegions.hierarchy(base, derived);
        const driver = drivers.find(d => d.id === document.getElementById('editDriverId').value);
        selectDriverRegions(driver?.fullData || {});
        error.textContent = '';
        if (save) save.disabled = false;
    } catch (_) {
        if (version === editorLoadVersion) error.textContent = 'تعذر تحميل المناطق. أغلق النافذة وأعد فتحها للمحاولة مجددًا.';
    }
}

function openEditDriverModal() {
    document.getElementById('editDriverStatus').disabled=!window.RBAC.staff?.employee.roles.includes('bootstrap_admin');
    const modal = document.getElementById('editDriverModal');
    if (modal) {
        modal.style.display = 'flex';

    }
}

function closeEditDriverModal() {
    const modal = document.getElementById('editDriverModal');
    if (modal) {
        modal.style.display = 'none';
        editorLoadVersion++;
        // Reset form
        document.getElementById('editDriverForm').reset();
    }
}

async function handleEditDriver(e) {
    e.preventDefault();
    
    try {
        const submitBtn = document.querySelector('#editDriverModal .btn-primary');
        const originalBtnHTML = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        const formData = new FormData(e.target);
        const driverId = formData.get('driverId');
        const driver = drivers.find(d => d.id === driverId);
        if (!driver || !driverRegionModel) throw Error('تعذر تحميل بيانات السائق أو المناطق');
        const name = String(formData.get('name') || '').trim();
        const status = String(formData.get('status')||document.getElementById('editDriverStatus').dataset.initialStatus);
        if (!name || !['PENDING_REVIEW','ACTIVE','SUSPENDED','REJECTED'].includes(status)) throw Error('تحقق من الاسم وحالة الحساب');
        const values = DriverRegions.updateValues(driver.fullData, {
            name, governorateId:formData.get('governorate_id'),regionId:formData.get('work_region_id'),
            vehicleType:formData.get('vehicleType'),landmark:String(formData.get('landmark') || '')
        }, driverRegionModel);
        if (!values.home_address_text) throw Error('أدخل أقرب نقطة دالة');
        if (window.RBAC.staff?.employee.roles.includes('bootstrap_admin') && Number(driver.fullData?.profileSchemaVersion) !== 2) {
            values.licenseNumber = String(formData.get('licenseNumber') || '');
            values.nationalId = String(formData.get('nationalId') || '');
        }
        // Preserve administrative state on ordinary edits; explicit status changes update approval together.
        if (status !== document.getElementById('editDriverStatus').dataset.initialStatus) {
            values.status = status;
            values.registrationStatus = status === 'ACTIVE' ? 'APPROVED' : status;
            values.isVerified = status === 'ACTIVE';
        }
        values.updatedAt = new Date().toISOString();
        const names = {}, attributes = {}, updates = [];
        for (const [field,value] of Object.entries(values)) {
            names['#'+field] = field; attributes[':'+field] = value; updates.push('#'+field+' = :'+field);
        }
        names['#id'] = 'driverId';
        let condition = 'attribute_exists(#id)';
        if (driver.fullData?.updatedAt !== undefined) {
            condition += ' AND #updatedAt = :originalUpdatedAt'; attributes[':originalUpdatedAt'] = driver.fullData.updatedAt;
        }
        if(window.RBAC.staff.employee.roles.includes('bootstrap_admin')) {
        const dynamoDB = await AWSUtils.getDynamoDBClient();
        await dynamoDB.update({TableName:DRIVERS_TABLE,Key:{driverId},UpdateExpression:'SET '+updates.join(', '),
            ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:attributes}).promise();
        } else {
            await driverStaffApi('/staff/drivers/edit',{driverId,values,expectedUpdatedAt:driver.fullData.updatedAt});
        }

        // Refresh data from database
        await loadDriversData();
        
        // Update UI
        renderDriversTable();
        updateDriverStats();
        
        // Close modal
        closeEditDriverModal();
        
        // Show success notification
        notify(`Driver "${name}" updated successfully`, 'success');
        
    } catch (error) {
        console.error('❌ Error updating driver:', error);
        
        let errorMessage = 'Failed to update driver';
        if (error.code === 'ConditionalCheckFailedException') {
            errorMessage = 'تغيرت بيانات السائق أثناء التعديل. أغلق النافذة وحدّث القائمة ثم أعد المحاولة.';
        } else if (error.code === 'ResourceNotFoundException') {
            errorMessage = 'Driver not found in database';
        } else if (error.code === 'ValidationException') {
            errorMessage = 'Invalid data provided';
        } else if (error.code === 'AccessDeniedException') {
            errorMessage = 'Permission denied. Check IAM role has UpdateItem permission.';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        notify(`Error: ${errorMessage}`, 'error');
        
    } finally {
        const submitBtn = document.querySelector('#editDriverModal .btn-primary');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
        }
    }
}

// Toggle driver status between approved and suspended
async function toggleDriverStatus(driverId, currentStatus) {
    console.log(`🔄 Toggling status for driver ${driverId} from ${currentStatus}`);

    try {
        // Show loading state
        const button = document.querySelector(`button[onclick="toggleDriverStatus('${driverId}', '${currentStatus}')"]`);
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        // Determine new status based on current status
        const newStatus = (currentStatus === 'online' || currentStatus === 'approved') ? 'pending' : 'online';
        const dbStatus = newStatus === 'online' ? 'APPROVED' : 'PENDING_REVIEW';

        console.log(`📝 Updating driver ${driverId} to status: ${newStatus} (DB: ${dbStatus})`);
        
        // Show confirmation for critical actions
        if (newStatus === 'pending' && !confirm(`Are you sure you want to change ${driverId} status to pending review?`)) {
            // Reset button state
            const button = document.querySelector(`button[onclick="toggleDriverStatus('${driverId}', '${currentStatus}')"]`);
            if (button) {
                button.disabled = false;
                const icon = currentStatus === 'online' ? 'fa-pause' : 'fa-check';
                button.innerHTML = `<i class="fas ${icon}"></i>`;
            }
            return;
        }

        if(!window.RBAC.staff?.employee.roles.includes('bootstrap_admin'))throw Error('صلاحية الموافقة والإيقاف غير متاحة لهذا الدور');
        // Get DynamoDB client
        const dynamoDB = await AWSUtils.getDynamoDBClient();

        // Update the item in DynamoDB (write both status fields for compatibility)
        const baseUpdate = {
            ConditionExpression: 'attribute_exists(driverId)',
            UpdateExpression: 'SET #status = :status, #reg = :status, #isVerified = :isVerified, #updatedAt = :timestamp',
            ExpressionAttributeNames: {
                '#status': 'status',
                '#reg': 'registrationStatus',
                '#isVerified': 'isVerified',
                '#updatedAt': 'updatedAt'
            },
            ExpressionAttributeValues: {
                ':status': dbStatus,
                ':isVerified': newStatus === 'online',
                ':timestamp': Math.floor(Date.now() / 1000)
            },
            ReturnValues: 'ALL_NEW'
        };

        let result;
        try {
            const updateParams1 = {
                TableName: DRIVERS_TABLE,
                Key: { driverId: driverId },
                ...baseUpdate
            };
            result = await dynamoDB.update(updateParams1).promise();
        } catch (e1) {
            // Fallback: try with 'id' as key if schema differs
            if (e1?.code === 'ValidationException' || /key element does not match/i.test(e1?.message || '')) {
                console.warn('Primary key driverId update failed, retrying with id key');
                const updateParams2 = {
                    TableName: DRIVERS_TABLE,
                    Key: { id: driverId },
                    ...baseUpdate
                };
                result = await dynamoDB.update(updateParams2).promise();
            } else {
                throw e1;
            }
        }

        console.log('✅ Driver status update successful:', result);

        // Update local data (optimistic)
        const driverIndex = drivers.findIndex(d => d.id === driverId);
        if (driverIndex !== -1) {
            drivers[driverIndex].status = newStatus;
        }

        // Refresh from DB to ensure UI reflects persisted state
        await loadDriversData();

        // Refresh the table and stats
        renderDriversTable();
        updateDriverStats();

        // Show success message
        const driver = drivers.find(d => d.id === driverId);
        const driverName = driver ? driver.name : 'Driver';
        const statusMessage = newStatus === 'online' ? 'approved and activated' : 'suspended';

        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification(`${driverName} has been ${statusMessage}.`, 'success');
        }

        console.log(`✅ Driver ${driverId} status changed from ${currentStatus} to ${newStatus}`);

    } catch (error) {
        console.error('❌ Error updating driver status:', error);

        // Reset button state
        const button = document.querySelector(`button[onclick*="toggleDriverStatus('${driverId}'"]`);
        if (button) {
            button.disabled = false;
            const icon = currentStatus === 'online' ? 'fa-pause' : 'fa-check';
            button.innerHTML = `<i class="fas ${icon}"></i>`;
        }

        let errorMessage = 'Failed to update driver status';
        if (error.code === 'ResourceNotFoundException') {
            errorMessage = 'Driver not found in database';
        } else if (error.code === 'ValidationException') {
            errorMessage = 'Invalid data provided';
        } else if (error.message) {
            errorMessage = error.message;
        }

        if (window.dashboardFunctions) {
            window.dashboardFunctions.showNotification(`Error: ${errorMessage}`, 'error');
        }
    }
}

// Close modals when clicking outside
window.addEventListener('click', function (e) {
    const addModal = document.getElementById('addDriverModal');
    const editModal = document.getElementById('editDriverModal');
    const viewModal = document.getElementById('viewDriverModal');
    
    if (e.target === addModal) {
        closeAddDriverModal();
    }
    
    if (e.target === editModal) {
        closeEditDriverModal();
    }
    
    if (e.target === viewModal) {
        closeViewDriverModal();
    }
});

// Export functions
window.driversManager = {
    openAddDriverModal,
    closeAddDriverModal,
    openEditDriverModal,
    closeEditDriverModal,
    openViewDriverModal,
    closeViewDriverModal,
    viewDriver,
    editDriver,
    editDriverFromView,
    toggleDriverStatus
};

// Initialize page when DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Drivers page loading...');

    // Immediately clear any pre-existing/mock rows and show a loading placeholder
    try {
        const tbodyInit = document.getElementById('driversTableBody');
        if (tbodyInit) {
            tbodyInit.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem;">
                <i class="fas fa-spinner fa-spin"></i> Loading drivers from database...
            </td></tr>`;
        }
    } catch (_) { }
    
    try {
        // Wait for AuthService to be available
        let retries = 0;
        while (!window.AuthService && retries < 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
        }
        
        if (!window.AuthService) {
            throw new Error('AuthService not available');
        }
        
        // Initialize AuthService
        await AuthService.initialize();
        
        // Check authentication and load drivers data
        if (await ensureAuthenticated()) {
            console.log('✅ User authenticated, loading drivers data...');
            await loadDriversData();
            setupEventListeners();
            
            // Pre-load cities in background for faster edit modal
            loadCitiesDropdown().catch(err => {
                console.warn('Failed to pre-load cities:', err);
            });
        } else {
            console.log('❌ User not authenticated, redirecting...');
        }
        
    } catch (error) {
        console.error('Failed to initialize drivers page:', error);
        const tbody = document.getElementById('driversTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 2rem; color: #e74c3c;">
                ${window.Auth.dataErrorMessage(error)}
            </td></tr>`;
        }
    }
});

console.log('Drivers management script loaded');
