// Apply before authentication or asynchronous sidebar loading to avoid an LTR first frame.
document.documentElement.lang = 'ar';
document.documentElement.dir = 'rtl';

// Unified Navigation System for WizzCentral Platform
// Handles sidebar loading, active states, navigation, and interactions

class NavigationManager {
    constructor() {
        this.currentPage = null;
        this.sidebar = null;
        this.mainContent = null;
        this.menuToggle = null;
        this.sidebarToggle = null;
        this.isInitialized = false;
        this._boundToggleHandler = this.toggleSidebar.bind(this);
        this._globalListenersBound = false;
        this._initPromise = null;
        // Must match styles/app-shell.css: overlay below 1024px, docked from 1024px.
        this._shellMedia = window.matchMedia('(width < 1024px)');
        this._shellMobile = undefined;
        this._desktopCollapsed = false;
        this._returnFocus = null;
        this._mainWasInert = false;
    }

    async init() {
        if (this.isInitialized) {
            console.log('🧭 NavigationManager: Already initialized, skipping...');
            return;
        }

        if (this._initPromise) {
            console.log('🧭 NavigationManager: Init already in progress, awaiting...');
            return this._initPromise;
        }

        this._initPromise = (async () => {

        console.log('🧭 NavigationManager: Initializing...');
        console.log('🔧 Current URL:', window.location.href);
        console.log('🔧 Current pathname:', window.location.pathname);

        try {
            // Central auth gate for all pages that use the navigation shell.
            // If a redirect-loop was previously detected, do not block rendering.
            try {
                let loopBroken = false;
                try {
                    loopBroken = (sessionStorage.getItem('redirectLoop:broken') || localStorage.getItem('redirectLoop:broken')) === 'true';
                } catch (_) { }

                if (!loopBroken && window.Auth && typeof window.Auth.requireAuthentication === 'function') {
                    const ok = window.Auth.requireAuthentication();
                    if (!ok) {
                        console.warn('🧭 NavigationManager: Authentication required; aborting init');
                        return;
                    }
                }
            } catch (e) {
                console.warn('🧭 NavigationManager: Auth gate error (continuing):', e);
            }

            await this.prepareShell();
            this.preparePageHeading();

            // Load sidebar HTML first
            await this.loadSidebar();

            // Setup DOM references
            this.setupDOMReferences();
            this.prepareDrawer();

            // Auto-correct duplicated /pages/ segments in current URL if present
            this.fixDuplicatedPagesInPath();

            // Normalize/repair nav links for current hosting base path
            this.rewriteNavLinks();

            // Initialize navigation features
            this.initializeNavigation();

            // Apply RBAC gating after sidebar & navigation are ready
            await this.applyRBACGating();

            // Set active page
            this.setActivePage();        // Setup event listeners
        this.setupEventListeners();

        // Ensure toggle buttons are connected with multiple retries
        setTimeout(() => this.ensureToggleButtonConnected(), 100);
        setTimeout(() => this.ensureToggleButtonConnected(), 300);
        setTimeout(() => this.ensureToggleButtonConnected(), 500);

        this.isInitialized = true;
        console.log('✅ NavigationManager: Initialized successfully');

            // Dispatch event for other scripts
            document.dispatchEvent(new CustomEvent('navigation:ready', {
                detail: { manager: this }
            }));

        } catch (error) {
            console.error('❌ NavigationManager: Initialization failed:', error);
        } finally {
            this._initPromise = null;
        }

        })();

        return this._initPromise;
    }

    // Collapse any repeated /pages/ segments in the current path and redirect once
    fixDuplicatedPagesInPath() {
        try {
            const { pathname, search, hash } = window.location;
            if (/(\/pages\/){2,}/.test(pathname)) {
                const cleaned = pathname.replace(/(?:\/pages\/)+/g, '/pages/');
                if (cleaned !== pathname) {
                    const basePrefix = this._getBasePrefix();
                    // Ensure we keep the frontend prefix if needed
                    let finalPath = cleaned;
                    if (basePrefix === '/frontend' && !cleaned.startsWith('/frontend/')) {
                        finalPath = '/frontend' + cleaned;
                    }
                    const target = finalPath + (search || '') + (hash || '');
                    console.warn('🧼 Fixing duplicated /pages/ in URL ->', target);
                    window.location.replace(target);
                }
            }
        } catch (e) {
            console.warn('fixDuplicatedPagesInPath failed', e);
        }
    }

    async loadSidebar() {
        const container = document.getElementById('sidebar-placeholder');
        if (!container) {
            throw new Error('sidebar-placeholder element not found');
        }

        console.log('🔄 NavigationManager: Loading sidebar...');

        const candidates = [
            '../includes/sidebar.html',
            '/frontend/includes/sidebar.html',
            '/includes/sidebar.html',
            'includes/sidebar.html'
        ];

        let lastError = null;
        for (const url of candidates) {
            try {
                console.log(`📋 Trying to load sidebar from: ${url}`);
                const response = await fetch(url, { cache: 'no-cache' });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const html = await response.text();
                container.innerHTML = html;
                console.log('✅ NavigationManager: Sidebar HTML loaded from', url);
                // Ensure links are valid for current base after injection
                this.rewriteNavLinks(container);
                // Re-setup DOM references and event listeners after sidebar loads
                setTimeout(() => {
                    this.setupDOMReferences();
                    this.setupEventListeners();
                    this.initializeUserProfile();
                    this.ensureToggleButtonConnected();
                }, 100);
                
                // Additional retries for toggle button connection
                setTimeout(() => this.ensureToggleButtonConnected(), 300);
                setTimeout(() => this.ensureToggleButtonConnected(), 600);
                setTimeout(() => this.ensureToggleButtonConnected(), 1000);
                return;
            } catch (err) {
                lastError = err;
                console.warn('❌ Sidebar fetch failed from', url, err);
            }
        }

        console.error('❌ NavigationManager: Failed to load sidebar from all candidates, using fallback:', lastError);
        // Fallback sidebar HTML
        container.innerHTML = this.getFallbackSidebar();
        // Normalize links in fallback sidebar as well
        this.rewriteNavLinks(container);
    }

    setupDOMReferences() {
        this.sidebar = document.getElementById('sidebar');
        this.mainContent = document.getElementById('mainContent');
        this.menuToggle = document.getElementById('menuToggle');
        this.sidebarToggle = document.getElementById('sidebarToggle');

        // Get current page from body data attribute
        this.currentPage = document.body.dataset.page;

        console.log('🔗 NavigationManager: DOM references setup', {
            sidebar: !!this.sidebar,
            mainContent: !!this.mainContent,
            menuToggle: !!this.menuToggle,
            sidebarToggle: !!this.sidebarToggle,
            currentPage: this.currentPage
        });
    }

    async prepareShell() {
        const main = document.getElementById('mainContent');
        if (!main || !document.getElementById('sidebar-placeholder')) return;
        document.body.classList.add('wizz-shell');
        let stylesheet = document.getElementById('wizz-shell-styles');
        if (!stylesheet) {
            stylesheet = document.createElement('link');
            stylesheet.id = 'wizz-shell-styles';
            stylesheet.rel = 'stylesheet';
            stylesheet.href = this._prefix('/styles/app-shell.css?v=20261022-rtl1');
            const ready = new Promise((resolve, reject) => {
                stylesheet.onload = resolve;
                stylesheet.onerror = () => reject(new Error('Could not load the shared layout stylesheet.'));
            });
            document.head.appendChild(stylesheet);
            await ready;
        }
        if (!document.getElementById('wizz-admin-styles')) {
            const visual = document.createElement('link');
            visual.id = 'wizz-admin-styles';
            visual.rel = 'stylesheet';
            visual.href = this._prefix('/styles/admin-ui.css?v=20261025-shell2');
            const ready = new Promise((resolve, reject) => {
                visual.onload = resolve;
                visual.onerror = () => reject(new Error('Could not load the admin presentation stylesheet.'));
            });
            document.head.appendChild(visual);
            await ready;
        }
        let trigger = document.getElementById('menuToggle') || main.querySelector('.menu-toggle');
        if (!trigger) {
            const bar = document.createElement('header');
            bar.className = 'wizz-shell-bar';
            trigger = document.createElement('button');
            trigger.type = 'button';
            const caption = document.createElement('span');
            caption.textContent = "القائمة";
            trigger.append(this.menuIcon(), caption);
            const brand = document.createElement('span');
            brand.textContent = "ويز سنترال";
            bar.append(trigger, brand);
            main.prepend(bar);
        }
        trigger.id = 'menuToggle';
        if (!trigger.querySelector('svg')) {
            trigger.replaceChildren(this.menuIcon());
        }
        trigger.setAttribute('aria-controls', 'sidebar');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', "فتح القائمة الرئيسية");
    }

    preparePageHeading() {
        const main = document.getElementById('mainContent');
        if (!main || main.querySelector('.admin-heading-copy')) return;
        const pages = {
            dashboard: ["المنصة / نظرة عامة", "لوحة التحكم", "نظرة عامة على نشاط المنصة وعملياتها اليومية."],
            drivers: ["العمليات / التوصيل", "السائقون", "إدارة حسابات السائقين وتوافرهم وطلبات اعتمادهم."],
            customers: ["المنصة / العملاء", "العملاء", "إدارة حسابات العملاء ونشاطهم وبرامج الولاء."],
            merchants: ["العمليات / المتاجر", "المتاجر", "مراجعة المتاجر وإدارة حسابات الأنشطة التجارية."],
            orders: ["العمليات / الطلبات", "الطلبات", "البحث عن الطلبات ومتابعة حالاتها وإدارة التوصيل."],
            regions: ["العمليات / التغطية", "المناطق", "تنظيم المناطق التي تغطيها خدمات المنصة."],
            financial: ["المالية / حسابات الشركة", "حسابات الشركة", "الإيرادات والمصاريف والذمم والكشوفات المالية."],
            finance: ['المالية / المحافظ', 'المحافظ والتسويات التشغيلية', 'متابعة المحافظ وطلبات الشحن والتسويات المالية.'],
            settings: ['الإدارة / الإعدادات', 'الإعدادات', 'إدارة إعدادات المنصة وتفضيلات التشغيل.'],
            staff: ['الإدارة / الفريق', 'الموظفون والصلاحيات', 'إدارة الفريق والصلاحيات وطلبات الاعتماد.'],
            pricing: ["المالية / التسعير", "التسعير والعمولات", "إدارة تسعير التوصيل وقواعد العمولات."]
        };
        const data = pages[document.body.dataset.page];
        // Preserve the custom campaign workspace and Arabic finance/support headings.
        if (!data) return;
        let title = [...main.querySelectorAll('h1')].find(el => !el.closest('.modal,dialog'));
        if (!title) {
            const header = document.createElement('header');
            header.className = 'admin-page-header';
            title = document.createElement('h1');
            title.textContent = data[1];
            header.append(title);
            const bar = main.querySelector(':scope > .wizz-shell-bar');
            if (bar) bar.after(header); else main.prepend(header);
        }
        const copy = document.createElement('div');
        copy.className = 'admin-heading-copy';
        title.before(copy);
        const eyebrow = document.createElement('span');
        eyebrow.className = 'admin-eyebrow';
        eyebrow.textContent = data[0];
        copy.append(eyebrow, title);
        // Retain a page's own descriptive copy rather than duplicating it.
        const sibling = copy.nextElementSibling;
        if (sibling?.tagName === 'P' && !sibling.id) copy.append(sibling);
        else {
            const description = document.createElement('p');
            description.textContent = data[2];
            copy.append(description);
        }
    }

    menuIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M4 6h16M4 12h16M4 18h16');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linecap', 'round');
        svg.append(path);
        return svg;
    }

    adminIcon(name) {
        const paths = {
            home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
            dashboard: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
            customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
            drivers: 'M3 4h11v12H3ZM14 8h4l3 4v4h-7M7 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
            merchants: 'M3 9 5 3h14l2 6M3 9h18v4a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0ZM5 16v5h14v-5M9 21v-5h6v5',
            orders: 'M6 4h12v17l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6',
            promotions: 'M20 13 12 21 3 12V3h9l8 8a1.4 1.4 0 0 1 0 2ZM7 7h.01',
            regions: 'M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 0 1 18 0ZM15 10a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
            finance: 'M3 6h17v15H3ZM3 6V3h14v3M15 12h6v5h-6ZM17 14.5h.01',
            settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
            clock: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0M12 7v5l3 2',
            check: 'M20 6 9 17l-5-5',
            close: 'M6 6l12 12M6 18 18 6',
            support: 'M3 14v-2a9 9 0 0 1 18 0v2M3 12h4v7H3ZM17 12h4v7h-4ZM21 19v2h-9',
            staff: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M18 8v6M15 11h6'
        };
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.6');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', paths[name] || paths.finance);
        svg.append(path);
        return svg;
    }

    prepareDrawer() {
        if (!this.sidebar) return;
        this.sidebar.classList.remove('sidebar');
        this.sidebar.classList.add('md-navigation-drawer');
        this.sidebar.style.removeProperty('transform');
        this.sidebar.tabIndex = -1;
        this.sidebar.setAttribute('aria-label', "القائمة الرئيسية");
        // Home and Dashboard previously linked to the same screen twice.
        const home = this.sidebar.querySelector('.nav-item[data-page="home"]');
        const dashboard = this.sidebar.querySelector('.nav-item[data-page="dashboard"]');
        if (home?.querySelector('a')?.getAttribute('href') === dashboard?.querySelector('a')?.getAttribute('href')) home?.remove();
        this.sidebar.querySelectorAll('.nav-link').forEach(link => link.classList.add('md-navigation-item'));
        this.sidebar.querySelectorAll('.md-navigation-item').forEach(link => {
            const label = link.querySelector('span')?.textContent.trim() || link.textContent.trim();
            if (label) { link.setAttribute('aria-label', label); link.title = label; }
            const oldIcon = link.querySelector('i');
            if (oldIcon) {
                const icon = this.adminIcon(link.closest('[data-page]')?.dataset.page);
                icon.classList.add('md-navigation-item__icon');
                oldIcon.replaceWith(icon);
            }
        });
        const logo = this.sidebar.querySelector('.logo > div');
        if (logo) {
            const mark = document.createElement('span');
            mark.className = 'admin-brand-mark';
            mark.setAttribute('aria-hidden', 'true');
            mark.textContent = 'W';
            logo.replaceWith(mark);
        }
        const metricIcons = { 'fa-users': 'customers', 'fa-user-check': 'customers', 'fa-store': 'merchants', 'fa-motorcycle': 'drivers', 'fa-shopping-bag': 'orders', 'fa-dollar-sign': 'finance', 'fa-headset': 'support', 'fa-tags': 'promotions', 'fa-star': 'promotions', 'fa-clock': 'clock', 'fa-check-circle': 'check', 'fa-times-circle': 'close' };
        this.mainContent?.querySelectorAll('.stat-icon i').forEach(old => {
            const key = Object.keys(metricIcons).find(c => old.classList.contains(c));
            if (key) old.replaceWith(this.adminIcon(metricIcons[key]));
        });
        document.querySelectorAll('.modal-close').forEach(button => {
            if (button.tagName === 'BUTTON' && !button.textContent.trim()) {
                button.replaceChildren(this.adminIcon('close'));
                if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', "إغلاق النافذة");
            }
        });
        if (this.sidebarToggle) {
            this.sidebarToggle.type = 'button';
            this.sidebarToggle.setAttribute('aria-controls', 'sidebar');
            this.sidebarToggle.replaceChildren(this.menuIcon());
        }
    }

    initializeNavigation() {
        // Add navigation click handlers
        if (this.sidebar) {
            const navLinks = this.sidebar.querySelectorAll('.md-navigation-item');
            navLinks.forEach(link => {
                link.addEventListener('click', (e) => this.handleNavigation(e));
            });
            
            this.restoreCollapseState();
        }

        // Setup responsive behavior
        this.handleResize();

        // Initialize user profile if available
        this.initializeUserProfile();
    }

    // Force sidebar to extended state as the absolute default
    forceExtendedAsDefault() {
        if (!this.sidebar || !this.mainContent) return;
        this._desktopCollapsed = false;
        this.applyDesktopState();
    }

    // Method to ensure sidebar starts in extended state by default
    restoreCollapseState() {
        if (!this.sidebar || !this.mainContent) return;
        
        try { this._desktopCollapsed = localStorage.getItem('sidebar-collapsed') === 'true'; }
        catch (_) { this._desktopCollapsed = false; }
    }

    setActivePage() {
        if (!this.currentPage || !this.sidebar) return;

        // Remove all active states
        const navItems = this.sidebar.querySelectorAll('.nav-item');
        navItems.forEach(item => item.classList.remove('active'));
        this.sidebar.querySelectorAll('[aria-current]').forEach(link => link.removeAttribute('aria-current'));

        // Set active state for current page
        const activeItem = this.sidebar.querySelector(`.nav-item[data-page="${this.currentPage}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
            activeItem.querySelector('a')?.setAttribute('aria-current', 'page');
            console.log(`🎯 NavigationManager: Set active page: ${this.currentPage}`);
        } else {
            console.warn(`⚠️ NavigationManager: No nav item found for page: ${this.currentPage}`);
        }
    }

    setupEventListeners() {
        // Mobile menu toggle
        if (this.menuToggle && !this.menuToggle.dataset.navToggleBound) {
            this.menuToggle.addEventListener('click', this._boundToggleHandler);
            this.menuToggle.dataset.navToggleBound = '1';
            console.log('🔧 NavigationManager: Mobile menu toggle connected');
        }

        // Logout button in sidebar footer
        try {
            const logoutBtn = this.sidebar && this.sidebar.querySelector('.logout-btn');
            if (logoutBtn && !logoutBtn.dataset.logoutBound) {
                logoutBtn.addEventListener('click', (e) => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) { }

                    try {
                        if (window.Auth && typeof window.Auth.logout === 'function') {
                            window.Auth.logout();
                            return;
                        }
                        if (typeof window.logout === 'function') {
                            window.logout();
                            return;
                        }

                        const basePrefix = this._getBasePrefix();
                        window.location.replace(window.location.origin + basePrefix + '/index.html');
                    } catch (err) {
                        console.warn('Logout failed:', err);
                        try {
                            const basePrefix = this._getBasePrefix();
                            window.location.replace(window.location.origin + basePrefix + '/index.html');
                        } catch (_) {
                            window.location.href = '/index.html';
                        }
                    }
                });
                logoutBtn.dataset.logoutBound = '1';
                console.log('🔧 NavigationManager: Logout button connected');
            }
        } catch (e) {
            console.warn('NavigationManager: Failed to bind logout button', e);
        }

        // Sidebar toggle button
        if (this.sidebarToggle) {
            if (!this.sidebarToggle.dataset.navToggleBound) {
                this.sidebarToggle.addEventListener('click', this._boundToggleHandler);
                this.sidebarToggle.dataset.navToggleBound = '1';
                console.log('🔧 NavigationManager: Sidebar toggle button connected');
            }
        } else {
            console.warn('⚠️ NavigationManager: Sidebar toggle button not found');
        }

        // Global listeners can be set up multiple times due to sidebar re-injection.
        // Ensure we only bind them once to avoid duplicate navigation/toggle behavior.
        if (!this._globalListenersBound) {
            window.addEventListener('resize', () => this.handleResize());

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isMobileSidebarOpen()) {
                    e.preventDefault();
                    this.closeMobileSidebar();
                }
                if (e.key === 'Tab' && this.isMobileSidebarOpen()) this.trapDrawerFocus(e);
            });
            document.addEventListener('focusin', (e) => {
                if (this.isMobileSidebarOpen() && !this.sidebar.contains(e.target)) this.focusDrawer();
            });

            document.addEventListener('click', (e) => {
                if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                const a = e.target.closest && e.target.closest('a');
                if (!a) return;
                const href = a.getAttribute('href') || '';

                const normalized = this.normalizeHref(href);
                if (normalized) {
                    e.preventDefault();
                    console.log('🧭 NavigationManager: Global normalized navigation', { from: href, to: normalized });
                    window.location.href = normalized;
                }
            }, true);

            this._globalListenersBound = true;
        }
    }

    handleNavigation(event) {
        const link = event.currentTarget;
        const rawHref = link.getAttribute('href');

        try {
            const newHref = this.normalizeHref(rawHref);
            if (newHref) {
                event.preventDefault();
                console.log('🧭 NavigationManager: Normalized navigation', { from: rawHref, to: newHref });
                window.location.href = newHref;
                return;
            }
        } catch (e) {
            console.warn('NavigationManager: handleNavigation normalization failed, falling back', e);
        }

        console.log(`🧭 NavigationManager: Navigating to ${rawHref}`);
    }

    // Helper to detect current base prefix consistently with auth-utils
    _getBasePrefix() {
        try {
            const path = window.location.pathname || '';
            // When served from Amplify with frontend as root, no prefix needed
            if (path.startsWith('/pages/')) return '';
            // When served from repo with /frontend/ in path, use /frontend prefix
            if (path.startsWith('/frontend/')) return '/frontend';
            // When path contains /pages/ somewhere, extract prefix
            const idx = path.indexOf('/pages/');
            if (idx > -1) return path.slice(0, idx);
            // For root pages like / or /index.html, no prefix
            if (path === '/' || path === '/index.html' || path === '/login.html') return '';
        } catch (_) { }
        return '';
    }

    // Compute normalized absolute href for in-app html pages; returns null if cannot normalize
    normalizeHref(rawHref) {
        if (!rawHref) return null;
        // Ignore absolute external links
        if (/^https?:\/\//i.test(rawHref)) return null;
        // Ignore anchors and javascript links
        if (rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return null;

        // Build a URL to parse search/hash reliably without inheriting deep nested paths
        let url;
        try {
            url = new URL(rawHref, window.location.origin + '/');
        } catch (e) {
            return null;
        }

        let path = url.pathname || '';

        // Normalize trailing slashes (e.g., /frontend/pages/merchants/ -> /frontend/pages/merchants)
        // Keep root '/' intact.
        if (path.length > 1) {
            path = path.replace(/\/+$/g, '');
        }

        const basePrefix = this._getBasePrefix();

        // If a link hard-codes /frontend/* but we're hosted at root (Amplify), strip it.
        if (!basePrefix && path.startsWith('/frontend/')) {
            path = path.replace(/^\/frontend/, '');
            if (!path) path = '/';
        }

        // If we're hosted under /frontend but the link isn't prefixed, keep it unmodified here;
        // we'll apply basePrefix on the normalized output.

        // Normalize explicit index/login destinations to the correct base
        if (path === '/' || /\/index\.html$/i.test(path) || /\/login\.html$/i.test(path)) {
            const file = /\/login\.html$/i.test(path) ? 'login.html' : 'index.html';
            return (basePrefix || '') + '/' + file + (url.search || '') + (url.hash || '');
        }

        // Helper to ensure filename has .html
        const ensureHtml = (name) => /\.[a-z0-9]+$/i.test(name) ? name : (name + '.html');

        // 1) If path already contains /pages/, collapse to the final filename under a single /pages/
        let match = path.match(/\/pages\/(?:.*\/)?([^\/?#]+)$/i);
        if (match && match[1]) {
            const file = ensureHtml(match[1]);
            const tail = '/pages/' + file;
            return (basePrefix || '') + tail + (url.search || '') + (url.hash || '');
        }

        // 2) If path starts with /frontend/pages but regex above failed (edge cases)
        match = path.match(/\/frontend\/pages\/(?:.*\/)?([^\/?#]+)$/i);
        if (match && match[1]) {
            const file = ensureHtml(match[1]);
            const tail = '/pages/' + file;
            return (basePrefix || '') + tail + (url.search || '') + (url.hash || '');
        }

        // 3) If a plain html file name or relative like merchants or merchants.html
        const fileOnly = path.replace(/^\/+/, '');
        if (/^[A-Za-z0-9_-]+(\.[a-z0-9]+)?$/i.test(fileOnly)) {
            const file = ensureHtml(fileOnly);
            const tail = '/pages/' + file;
            return (basePrefix || '') + tail + (url.search || '') + (url.hash || '');
        }

        // 4) Unknown pattern -> do not intercept
        return null;
    }

    // Detect current base prefix ('' or '/frontend') and rewrite sidebar links accordingly
    rewriteNavLinks(containerEl) {
        try {
            const container = containerEl || this.sidebar || document;
            const links = container.querySelectorAll?.('a[href]');
            if (!links || !links.length) return;

            links.forEach(a => {
                const rawHref = a.getAttribute('href') || '';
                const newHref = this.normalizeHref(rawHref);
                if (newHref && newHref !== rawHref) {
                    a.setAttribute('href', newHref);
                    if (Math.random() < 0.05) console.log('🔧 Rewrote nav link', { from: rawHref, to: newHref });
                }
            });
        } catch (e) {
            console.warn('NavigationManager: rewriteNavLinks failed', e);
        }
    }

    toggleSidebar() {
        if (!this.sidebar) return;

        if (this.isMobile()) {
            // Mobile: Toggle overlay sidebar
            this.toggleMobileSidebar();
        } else {
            // Desktop: Toggle collapsed state
            this.toggleDesktopSidebar();
        }
    }

    toggleMobileSidebar() {
        if (!this.sidebar || !this.isMobile()) return;
        if (this.isMobileSidebarOpen()) { this.closeMobileSidebar(); return; }
        this._returnFocus = document.activeElement;
        this._mainWasInert = this.mainContent?.inert || false;
        this.sidebar.classList.add('active');
        document.body.classList.add('wizz-shell--drawer-open');
        this.createBackdrop();
        this.syncDrawerAccessibility();
        if (this.mainContent) this.mainContent.inert = true;
        this.focusDrawer();
    }

    toggleDesktopSidebar() {
        if (!this.sidebar || !this.mainContent || this.isMobile()) {
            console.warn('⚠️ NavigationManager: Cannot toggle - sidebar or mainContent not found');
            return;
        }

        this._desktopCollapsed = !this._desktopCollapsed;
        try { localStorage.setItem('sidebar-collapsed', String(this._desktopCollapsed)); } catch (_) { }
        this.applyDesktopState();
    }

    closeMobileSidebar({ restoreFocus = true } = {}) {
        if (!this.sidebar) return;
        const wasOpen = this.sidebar.classList.contains('active');
        const focusInside = this.sidebar.contains(document.activeElement);
        this.sidebar.classList.remove('active');
        this.removeBackdrop();
        document.body.classList.remove('wizz-shell--drawer-open');
        if (wasOpen && this.mainContent) this.mainContent.inert = this._mainWasInert;
        if (restoreFocus && (wasOpen || focusInside && this.isMobile())) {
            const target = this._returnFocus?.isConnected && this._returnFocus !== document.body ? this._returnFocus : this.menuToggle;
            target?.focus({ preventScroll: true });
        }
        this._returnFocus = null;
        this.syncDrawerAccessibility();
    }

    isMobileSidebarOpen() {
        return this.sidebar && this.sidebar.classList.contains('active') && this.isMobile();
    }

    createBackdrop() {
        this.removeBackdrop(); // Remove existing backdrop first

        const backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');

        backdrop.addEventListener('click', () => this.closeMobileSidebar());
        document.body.appendChild(backdrop);
    }

    removeBackdrop() {
        const backdrop = document.querySelector('.sidebar-backdrop');
        if (backdrop) {
            backdrop.remove();
        }
    }

    handleResize() {
        if (!this.sidebar) return;
        const mobile = this.isMobile();
        // Ordinary mobile resizes (e.g. an on-screen keyboard) must not close the drawer.
        if (this._shellMobile === mobile) return;
        this._shellMobile = mobile;
        this.closeMobileSidebar({ restoreFocus: mobile });
        this.sidebar.style.removeProperty('transform');
        this.applyDesktopState();
    }

    applyDesktopState() {
        const collapsed = !this.isMobile() && this._desktopCollapsed;
        this.sidebar?.classList.toggle('collapsed', collapsed);
        this.sidebar?.classList.toggle('md-navigation-drawer--open', !this.isMobile());
        this.mainContent?.classList.toggle('collapsed-sidebar', collapsed);
        document.body.classList.toggle('wizz-shell--collapsed', collapsed);
        this.syncDrawerAccessibility();
    }

    syncDrawerAccessibility() {
        if (!this.sidebar) return;
        const mobile = this.isMobile(), open = this.isMobileSidebarOpen();
        this.sidebar.inert = mobile && !open;
        this.sidebar.setAttribute('aria-hidden', String(mobile && !open));
        this.sidebar.setAttribute('role', mobile ? 'dialog' : 'complementary');
        if (mobile && open) this.sidebar.setAttribute('aria-modal', 'true');
        else this.sidebar.removeAttribute('aria-modal');
        this.menuToggle?.setAttribute('aria-expanded', String(open));
        if (this.sidebarToggle) {
            this.sidebarToggle.setAttribute('aria-expanded', String(mobile ? open : !this._desktopCollapsed));
            this.sidebarToggle.setAttribute('aria-label', mobile ? "إغلاق القائمة الرئيسية" : this._desktopCollapsed ? "توسيع القائمة الرئيسية" : "طيّ القائمة الرئيسية");
        }
    }

    drawerFocusables() {
        return [...this.sidebar.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]')]
            .filter(el => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    }

    focusDrawer() {
        (this.drawerFocusables()[0] || this.sidebar).focus({ preventScroll: true });
    }

    trapDrawerFocus(event) {
        const items = this.drawerFocusables();
        if (!items.length) { event.preventDefault(); this.sidebar.focus(); return; }
        const first = items[0], last = items[items.length - 1], active = document.activeElement;
        if (event.shiftKey && (active === first || !this.sidebar.contains(active))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (active === last || !this.sidebar.contains(active))) { event.preventDefault(); first.focus(); }
    }

    initializeUserProfile() {
        // Wait for sidebar to be loaded, then try multiple times
        const maxRetries = 5;
        let retryCount = 0;
        
        const updateUserProfile = () => {
            const userNameEl = this.sidebar?.querySelector('.user-name') || document.querySelector('.user-name');
            const userRoleEl = this.sidebar?.querySelector('.user-role') || document.querySelector('.user-role');
            const userAvatarEl = this.sidebar?.querySelector('.user-avatar') || document.querySelector('.user-avatar');

            if (userNameEl || userRoleEl) {
                console.log('🔍 Updating user profile in sidebar...');
                
                // Try to get user info from multiple sources
                let userName = 'مستخدم مسؤول';
                let userRole = 'مدير النظام';
                let userEmail = '';
                
                try {
                    const readStorageItem = (key) => {
                        try {
                            const v = sessionStorage.getItem(key);
                            if (v !== null && v !== undefined && v !== '') return v;
                        } catch (_) {}
                        try { return localStorage.getItem(key); } catch (_) { return null; }
                    };

                    const decodeJwtPayload = (token) => {
                        const part = (token || '').split('.')[1] || '';
                        const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
                        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
                        return JSON.parse(atob(padded));
                    };

                    // First try: Get from storage (session preferred)
                    userEmail = readStorageItem('userEmail') || '';
                    const isAuthenticated = readStorageItem('isAuthenticated') === 'true';
                    
                    if (userEmail) {
                        userName = userEmail.split('@')[0]; // Use part before @
                        console.log(`✅ Found user email in session: ${userEmail}`);
                    }
                    
                    // Second try: Decode JWT token if available
                    const token = readStorageItem('idToken');
                    if (token) {
                        try {
                            const payload = decodeJwtPayload(token);
                            
                            if (payload.email) {
                                userEmail = payload.email;
                                userName = payload.name || payload.given_name || payload.email.split('@')[0];
                            }
                            
                            if (payload['custom:role']) {
                                userRole = payload['custom:role'];
                            } else if (payload.username) {
                                userName = payload.username;
                            }
                            
                            console.log(`✅ Decoded user from token:`, { userName, userEmail, userRole });
                        } catch (tokenError) {
                            console.log('⚠️ Could not decode JWT token:', tokenError.message);
                        }
                    }
                    
                    // Update the UI elements
                    if (userNameEl) {
                        userNameEl.textContent = userName;
                        console.log(`✅ Updated user name: ${userName}`);
                    }
                    if (userRoleEl) {
                        userRoleEl.textContent = window.WizzLocale?.role(userRole) || 'موظف';
                        console.log(`✅ Updated user role: ${userRole}`);
                    }
                    
                    // Update avatar with user initials
                    if (userAvatarEl && userName !== 'مستخدم مسؤول') {
                        const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase();
                        userAvatarEl.innerHTML = `<span style="font-weight: bold; color: white;">${initials}</span>`;
                    }
                    
                } catch (error) {
                    console.log('⚠️ Could not get user info:', error.message);
                    // Keep default values
                }
            } else if (retryCount < maxRetries) {
                // Retry if elements not found yet
                retryCount++;
                console.log(`🔄 User profile elements not found, retrying... (${retryCount}/${maxRetries})`);
                setTimeout(updateUserProfile, 500);
            }
        };
        
        // Start the update process
        updateUserProfile();
    }

    isMobile() {
        return this._shellMedia.matches;
    }

    getFallbackSidebar() {
        return `
            <div class="md-navigation-drawer" id="sidebar">
                <div class="sidebar-header">
                    <div class="logo">
                        <i class="fas fa-rocket"></i>
                        <span>ويز سنترال</span>
                    </div>
                    <button class="sidebar-toggle" id="sidebarToggle">
                        <i class="fas fa-bars"></i>
                    </button>
                </div>
                <nav class="sidebar-nav">
                    <ul>
                        <li class="nav-item" data-page="dashboard">
                            <a href="dashboard.html" class="nav-link">
                                <i class="fas fa-tachometer-alt"></i>
                                <span>لوحة التحكم</span>
                            </a>
                        </li>
                        <li class="nav-item" data-page="drivers">
                            <a href="drivers.html" class="nav-link">
                                <i class="fas fa-motorcycle"></i>
                                <span>السائقون</span>
                            </a>
                        </li>
                        <li class="nav-item" data-page="customers">
                            <a href="customers.html" class="nav-link">
                                <i class="fas fa-users"></i>
                                <span>العملاء</span>
                            </a>
                        </li>
                        <li class="nav-item" data-page="settings"><a href="settings.html" class="nav-link"><i class="fas fa-cog"></i><span>الإعدادات</span></a></li>
                        <li class="nav-item" data-page="pricing"><a href="delivery-pricing.html" class="nav-link" data-nav="page"><i class="fas fa-route"></i><span>التسعير والعمولات</span></a></li>
<li class="nav-item" data-page="financial"><a href="financial-management.html" class="nav-link"><i class="fas fa-chart-line"></i><span>حسابات الشركة</span></a></li>
<li class="nav-item" data-page="finance"><a href="finance.html" class="nav-link"><i class="fas fa-wallet"></i><span>إدارة شحن المحافظ</span></a></li>
                        <li class="nav-item" data-page="merchants">
                            <a href="merchants.html" class="nav-link">
                                <i class="fas fa-store"></i>
                                <span>المتاجر</span>
                            </a>
                        </li>
                        <li class="nav-item" data-page="orders">
                            <a href="orders.html" class="nav-link">
                                <i class="fas fa-shopping-bag"></i>
                                <span>الطلبات</span>
                            </a>
                        </li>
                        <li class="nav-item" data-page="promotions">
                            <a href="promotions.html" class="nav-link">
                                <i class="fas fa-tags"></i>
                                <span>العروض والحملات</span>
                            </a>
                        </li>
                        <li class="nav-item" data-page="support">
                            <a href="support.html" class="nav-link">
                                <i class="fas fa-headset"></i>
                                <span>الدعم المباشر</span>
                            </a>
                        </li>
                    </ul>
                </nav>
                <div class="sidebar-footer">
                    <div class="user-profile">
                        <div class="user-avatar">
                            <i class="fas fa-user"></i>
                        </div>
                        <div class="user-info">
                            <span class="user-name">مستخدم مسؤول</span>
                            <span class="user-role">مدير النظام</span>
                        </div>
                    </div>
                    <button class="logout-btn">
                        <i class="fas fa-sign-out-alt"></i>
                        <span>تسجيل الخروج</span>
                    </button>
                </div>
            </div>
        `;
    }

    // Ensure toggle button is properly connected
    ensureToggleButtonConnected() {
        let connected = false;
        
        // Connect sidebar toggle button (desktop)
        if (!this.sidebarToggle || !this.sidebarToggle.isConnected) {
            this.sidebarToggle = document.getElementById('sidebarToggle');
            if (this.sidebarToggle) {
                if (!this.sidebarToggle.dataset.navToggleBound) {
                    this.sidebarToggle.addEventListener('click', this._boundToggleHandler);
                    this.sidebarToggle.dataset.navToggleBound = '1';
                    console.log('🔧 NavigationManager: Connected sidebar toggle button');
                    connected = true;
                }
            }
        }
        
        // Connect menu toggle button (mobile hamburger)
        if (!this.menuToggle || !this.menuToggle.isConnected) {
            this.menuToggle = document.getElementById('menuToggle');
            if (this.menuToggle) {
                if (!this.menuToggle.dataset.navToggleBound) {
                    this.menuToggle.addEventListener('click', this._boundToggleHandler);
                    this.menuToggle.dataset.navToggleBound = '1';
                    console.log('🔧 NavigationManager: Connected menu toggle button (hamburger)');
                    connected = true;
                }
            }
        }
        
        // Also try to connect by class name as fallback
        if (!this.menuToggle) {
            const menuToggleByClass = document.querySelector('.menu-toggle');
            if (menuToggleByClass && menuToggleByClass.id !== 'menuToggle') {
                menuToggleByClass.id = 'menuToggle';  // Assign ID for consistency
                this.menuToggle = menuToggleByClass;
                if (!this.menuToggle.dataset.navToggleBound) {
                    this.menuToggle.addEventListener('click', this._boundToggleHandler);
                    this.menuToggle.dataset.navToggleBound = '1';
                    console.log('🔧 NavigationManager: Connected menu toggle by class (assigned ID)');
                    connected = true;
                }
            }
        }
        
        console.log('🔍 NavigationManager: Toggle button status', {
            sidebarToggle: !!this.sidebarToggle,
            menuToggle: !!this.menuToggle,
            sidebarExists: !!document.getElementById('sidebar'),
            connected: connected
        });
        
        return connected;
    }

    // Reset sidebar to default extended state
    resetToExtendedState() {
        if (!this.sidebar || !this.mainContent) return;
        
        this._desktopCollapsed = false;
        this.applyDesktopState();
        try { localStorage.setItem('sidebar-collapsed', 'false'); sessionStorage.removeItem('sidebar-user-collapsed'); } catch (_) { }
        console.log('🔧 NavigationManager: Reset to extended state and cleared all state markers');
    }

    // Public API
    refresh() {
        this.setActivePage();
    }

    isReady() {
        return this.isInitialized;
    }

    // Ensure RBAC utility is present; load dynamically if missing
    async ensureRBACLoaded() {
        if (window.RBAC) return;
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = this._prefix('/assets/js/rbac.js?v=20261017-ar1');
            s.async = true;
            s.onload = () => resolve();
            s.onerror = (e) => reject(new Error('Failed to load RBAC util'));
            document.head.appendChild(s);
        });
    }

    _prefix(path) {
        const base = this._getBasePrefix() || '';
        return base + path;
    }

    // Centralized RBAC enforcement for sidebar and current page
    async applyRBACGating() {
        try {
            await this.ensureRBACLoaded();
            await window.RBAC.ensure();

            // Update sidebar user info
            const me = await window.RBAC.fetchMe();
            const nameEl = document.querySelector('.sidebar-footer .user-name');
            const roleEl = document.querySelector('.sidebar-footer .user-role');
            if (nameEl) nameEl.textContent = me?.email || "المستخدم";
            if (roleEl) roleEl.textContent = (me?.roles || []).map(role => window.WizzLocale?.role(role) || 'موظف').join('، ') || "للاطلاع فقط";

            // Hide nav items without page permission
            const items = (this.sidebar || document).querySelectorAll?.('.nav-item[data-page]') || [];
            items.forEach(li => {
                const p = li.getAttribute('data-page');
                if (!window.RBAC.pageAllowed(p)) {
                    li.style.display = 'none';
                }
            });

            // Enforce current page access (skip on unauthorized page itself)
            const current = this.currentPage;
            const isUnauthorized = /\/pages\/unauthorized\.html$/.test(window.location.pathname || '');
            if (current && !isUnauthorized && !window.RBAC.pageAllowed(current)) {
                const target = this._prefix('/pages/unauthorized.html');
                console.warn('RBAC: redirecting to unauthorized page for', current);
                window.location.replace(target);
                return;
            }

            // Apply read-only mode for domains where user lacks write
            const pageToDomain = {
                financial: 'financial',
                promotions: 'campaigns',
                regions: 'regions',
                orders: 'orders',
                merchants: 'merchants',
                drivers: 'drivers',
                customers: 'customers',
                support: 'support'
            };
            const domain = pageToDomain[current];
            if (domain && !window.RBAC.can(domain, 'write')) {
                window.RBAC.applyReadOnly('body', domain);
                // Hide explicit write-only UI hooks if present
                document.querySelectorAll('[data-write-only]').forEach(el => el.style.display = 'none');
            }
        } catch (e) {
            console.warn('RBAC gating failed or not available', e);
        }
    }
}

// Export for global access
window.NavigationManager = NavigationManager;

// Initialize/reuse a single navigation manager instance.
// Multiple instances cause duplicated listeners and sidebar flicker.
window.navigationManager = (window.navigationManager instanceof NavigationManager)
    ? window.navigationManager
    : new NavigationManager();

const navigationManager = window.navigationManager;

// Global logout function for sidebar
if (!window.logout) {
    window.logout = function() {
        console.log('🚪 Logout initiated from sidebar...');
        
        try {
            // Clear all authentication data
            sessionStorage.clear();
            localStorage.clear();
            
            // Try to use Auth.logout if available
            if (window.Auth && typeof window.Auth.logout === 'function') {
                console.log('🔐 Using Auth.logout...');
                window.Auth.logout();
                return;
            }
            
            // Fallback: Direct redirect to login
            console.log('🔄 Fallback logout - redirecting to login...');
            const currentPath = window.location.pathname;
            const isInFrontendFolder = currentPath.includes('/frontend/');
            
            let loginUrl;
            if (isInFrontendFolder) {
                loginUrl = window.location.origin + '/frontend/index.html';
            } else {
                loginUrl = window.location.origin + '/index.html';
            }
            
            window.location.href = loginUrl;
            
        } catch (error) {
            console.error('❌ Logout error:', error);
            // Emergency fallback
            window.location.href = window.location.origin + '/index.html';
        }
    };
}

// Ensure logout works under CSP (no inline handlers)
(function attachLogoutHandlerOnce() {
    if (window.__logoutHandlerAttached) return;
    window.__logoutHandlerAttached = true;
    document.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest && e.target.closest('.logout-btn');
        if (btn) {
            e.preventDefault();
            try {
                if (typeof window.logout === 'function') {
                    window.logout();
                } else if (window.Auth && typeof window.Auth.logout === 'function') {
                    window.Auth.logout();
                } else {
                    // Fallback: clear storage and go to login
                    sessionStorage.clear();
                    localStorage.clear();
                    window.location.href = window.location.origin + '/index.html';
                }
            } catch (err) {
                console.error('Logout handler error:', err);
                window.location.href = window.location.origin + '/index.html';
            }
        }
    }, true);
})();

// Global function to refresh user profile (useful for testing and manual updates)
window.refreshUserProfile = function() {
    console.log('🔄 Manually refreshing user profile...');
    if (window.navigationManager && typeof window.navigationManager.initializeUserProfile === 'function') {
        window.navigationManager.initializeUserProfile();
        console.log('✅ User profile refresh triggered');
    } else {
        console.error('❌ NavigationManager not available for profile refresh');
    }
};

// Global function to manually toggle sidebar (useful for testing and debugging)
window.toggleSidebar = function() {
    console.log('🔄 Manually toggling sidebar...');
    if (window.navigationManager && typeof window.navigationManager.toggleSidebar === 'function') {
        window.navigationManager.toggleSidebar();
        console.log('✅ Sidebar toggle triggered');
    } else {
        console.error('❌ NavigationManager not available for sidebar toggle');
    }
};

// Global function to reset sidebar to default extended state
window.resetSidebarToExtended = function() {
    console.log('🔄 Resetting sidebar to extended state...');
    if (window.navigationManager && typeof window.navigationManager.resetToExtendedState === 'function') {
        window.navigationManager.resetToExtendedState();
        console.log('✅ Sidebar reset to extended state');
        // Reload page to apply changes
        window.location.reload();
    } else {
        console.error('❌ NavigationManager not available for sidebar reset');
    }
};

console.log('🧭 Navigation system loaded');

// Every page loading the shared script gets navigation, including pages without
// a page-specific init call. init() already deduplicates concurrent/legacy calls.
function startSharedNavigation() {
    if (!document.getElementById('mainContent') || !document.getElementById('sidebar-placeholder')) return;
    window.navigationManager.init();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSharedNavigation, { once: true });
} else {
    startSharedNavigation();
}

// Additional global debugging functions
window.debugToggleButtons = function() {
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('menuToggle');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const mainContent = document.getElementById('mainContent');
    
    console.log('🔍 Debug Toggle Buttons:', {
        sidebar: !!sidebar,
        menuToggle: !!menuToggle,
        sidebarToggle: !!sidebarToggle,
        mainContent: !!mainContent,
        navigationManager: !!window.navigationManager,
        sidebarClasses: sidebar ? Array.from(sidebar.classList) : null,
        menuToggleListeners: menuToggle ? 'check DevTools' : null
    });
    
    if (menuToggle) {
        console.log('🔧 Found menu toggle button, attempting manual click test...');
        try {
            menuToggle.click();
            console.log('✅ Manual click successful');
        } catch (error) {
            console.error('❌ Manual click failed:', error);
        }
    }
    
    return {sidebar, menuToggle, sidebarToggle, mainContent};
};

window.forceConnectToggle = function() {
    if (window.navigationManager && window.navigationManager.ensureToggleButtonConnected) {
        const result = window.navigationManager.ensureToggleButtonConnected();
        console.log('🔧 Force connect toggle result:', result);
        return result;
    }
    return false;
};

window.forceSidebarExtended = function() {
    if (window.navigationManager?.isReady()) {
        window.navigationManager.resetToExtendedState();
        return true;
    }
    return false;
};
