// Centralized Authentication Utilities for WizzCentral Platform
console.log('Loading auth-utils.js...');

window.Auth = {
    _redirectedThisLoad: false,
    _redirectInProgress: false,
    _authCheckedThisLoad: false,
    _authCheckResult: null,
    _authCheckWasSilent: false,

    _readStorageItem(key) {
        try {
            return sessionStorage.getItem(key) || localStorage.getItem(key);
        } catch (e) {
            try { return localStorage.getItem(key); } catch (_) { return null; }
        }
    },

    _writeStorageItem(key, value) {
        try { sessionStorage.setItem(key, value); } catch (_) { }
        try { localStorage.setItem(key, value); } catch (_) { }
    },

    _removeStorageItem(key) {
        try { sessionStorage.removeItem(key); } catch (_) { }
        try { localStorage.removeItem(key); } catch (_) { }
    },

    _decodeJwtPayload(token) {
        try {
            if (!token || typeof token !== 'string') return null;
            const parts = token.split('.');
            if (parts.length < 2) return null;
            let b64 = parts[1];
            b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            return JSON.parse(atob(b64));
        } catch (e) {
            return null;
        }
    },

    // Check if user is authenticated
    // options: { silent: true } => do NOT redirect; just return boolean
    requireAuthentication(options) {
        const silent = (options === true) || (options && typeof options === 'object' && options.silent === true);
        const force = !!(options && typeof options === 'object' && options.force === true);

        const finalize = (result) => {
            this._authCheckedThisLoad = true;
            this._authCheckResult = result;
            this._authCheckWasSilent = silent;
            return result;
        };

        if (!force && this._authCheckedThisLoad) {
            if (this._authCheckResult === true) {
                console.log('🔐 Auth: Using cached authentication result (true)');
                return true;
            }
            // If the previous check was a silent failure, allow a later non-silent call to re-check and redirect.
            if (!silent && this._authCheckWasSilent === true) {
                console.log('🔐 Auth: Previous check was silent+false; rechecking non-silent...');
            } else {
                console.log('🔐 Auth: Using cached authentication result (false)');
                return false;
            }
        }

        console.log('🔐 Checking authentication...');
        this._writeStorageItem('lastAuthCheckTime', new Date().toISOString());
        console.log('🔍 Current URL:', window.location.href);
        console.log('🔍 Current Path:', window.location.pathname);

        // If a redirect is already happening (or loop was broken), do not keep triggering redirects.
        try {
            const loopBroken = this._readStorageItem('redirectLoop:broken') === 'true';
            if (this._redirectInProgress || this._redirectedThisLoad || loopBroken) {
                console.warn('Auth: redirect already in progress / loop broken; skipping new redirect attempt');
                return finalize(false);
            }
        } catch (_) {}

        // Get authentication data
        const isAuthenticated = this._readStorageItem('isAuthenticated');
        const userEmail = this._readStorageItem('userEmail');
        const userId = this._readStorageItem('userId');
        const idToken = this._readStorageItem('idToken');
        const accessToken = this._readStorageItem('accessToken');

        console.log('📊 Auth status:', {
            isAuthenticated: isAuthenticated,
            userEmail: userEmail ? userEmail.substring(0, 5) + '***' : null,
            userId: !!userId,
            hasIdToken: !!idToken,
            hasAccessToken: !!accessToken,
            idTokenLength: idToken ? idToken.length : 0
        });

        // More lenient check - if we have basic auth flags, trust them
        if (isAuthenticated === 'true') {
            console.log('✅ Authentication check passed (isAuthenticated flag is true)');
            return finalize(true);
        }

        // Also check if we have userEmail (might be set without isAuthenticated flag)
        if (userEmail && idToken) {
            console.log('✅ Authentication check passed (userEmail + idToken present)');
            this._writeStorageItem('isAuthenticated', 'true'); // Set the flag for next time
            return finalize(true);
        }

        // Adjusted: accept presence of idToken OR both basic flags; do not require accessToken strictly
        if (idToken) {
            console.log('🔑 Found idToken (accessToken optional), validating...');
            try {
                const tokenPayload = this._decodeJwtPayload(idToken) || {};
                const currentTime = Math.floor(Date.now() / 1000);

                // Check if token is expired
                if (tokenPayload.exp && tokenPayload.exp < currentTime) {
                    console.warn('⚠️ Token expired, clearing token values only');
                    this._removeStorageItem('idToken');
                    this._removeStorageItem('accessToken');
                    this._removeStorageItem('refreshToken');
                    if (!silent) this.redirectToLogin('Token expired');
                    return finalize(false);
                }

                // Validate issuer matches expected Cognito provider from config
                try {
                    const cfg = window.WIZZCENTRAL_CONFIG || {};
                    const region = cfg.COGNITO_REGION || 'us-east-1';
                    const poolId = cfg.COGNITO_USER_POOL_ID;
                    if (tokenPayload.iss && poolId) {
                        const expectedIssuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
                        if (tokenPayload.iss !== expectedIssuer) {
                            console.error('Auth: idToken issuer mismatch', { iss: tokenPayload.iss, expectedIssuer });
                            // Clear only auth tokens and force clean login
                            this.clearTokens();
                            if (!silent) this.redirectToLogin('Auth: idToken issuer mismatch');
                            return finalize(false);
                        }
                    }
                } catch (e) { console.warn('Auth: issuer validation failed', e); }

                // Token is valid, ensure basic auth flags are set
                if (isAuthenticated !== 'true') {
                    console.log('🔧 Setting basic auth flags from valid token');
                    this._writeStorageItem('isAuthenticated', 'true');
                    if (!userEmail && tokenPayload.email) {
                        this._writeStorageItem('userEmail', tokenPayload.email);
                    }
                    if (!userId && tokenPayload.sub) {
                        this._writeStorageItem('userId', tokenPayload.sub);
                    }
                }

                console.log('✅ Authentication check passed (token validation)');
                return finalize(true);
            } catch (error) {
                console.warn('⚠️ Token validation failed, falling back:', error);
                if (isAuthenticated === 'true' && userEmail) {
                    console.log('✅ Falling back to basic auth despite token error');
                    return finalize(true);
                }
            }
        }

        // If we get here, authentication failed
        console.warn('❌ Authentication failed - redirecting to login');
        if (!silent) this.redirectToLogin('No valid authentication found');
        return finalize(false);
    },

    // Redirect to login with return URL
    redirectToLogin(reason = 'Authentication required') {
        console.log('🚨 Redirecting to login. Reason:', reason);

        // Prevent multiple redirects from multiple scripts on the same page load
        if (this._redirectInProgress || this._redirectedThisLoad) {
            console.warn('Auth: redirect already triggered this load; skipping');
            return;
        }

        // Skip redirect if already on login page
        if (window.location.pathname.endsWith('/index.html') || window.location.pathname === '/') {
            console.log('Already on login page, not redirecting again.');
            return;
        }

        // If we just came from login, do NOT redirect and do NOT increment loop counters.
        const lastLoginTime = this._readStorageItem('lastLoginTime');
        if (lastLoginTime) {
            const timeSinceLogin = Date.now() - parseInt(lastLoginTime, 10);
            if (timeSinceLogin < 10000) {
                console.log('✅ Within grace period after login (' + timeSinceLogin + 'ms ago), skipping redirect');
                return;
            }
        }

        // Loop protection (only when we are actually going to redirect)
        try {
            if (this._readStorageItem('redirectLoop:broken') === 'true') {
                console.warn('Redirect loop previously broken; skipping redirect.');
                return;
            }

            const now = Date.now();
            const lastTime = parseInt(this._readStorageItem('redirectLoop:lastTime') || '0', 10);
            let count = parseInt(this._readStorageItem('redirectLoop:count') || '0', 10);
            if (now - lastTime < 8000) {
                count += 1;
            } else {
                count = 1;
            }
            this._writeStorageItem('redirectLoop:lastTime', String(now));
            this._writeStorageItem('redirectLoop:count', String(count));

            if (count > 5) {
                console.warn('🛑 Redirect loop detected (count=' + count + '). Breaking loop.');
                this._writeStorageItem('redirectLoop:broken', 'true');
                if (!document.getElementById('auth-loop-banner')) {
                    const b = document.createElement('div');
                    b.id = 'auth-loop-banner';
                    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b91c1c;color:#fff;padding:6px 10px;font:12px sans-serif;text-align:center';
                    b.innerHTML = 'Authentication redirect loop stopped. Please open console, copy auth debug overlay, then click <button style="margin-left:6px;padding:2px 6px;background:#111;color:#fff;border:1px solid #444;border-radius:3px;cursor:pointer" onclick="(function(){try{sessionStorage.removeItem(\'redirectLoop:count\');sessionStorage.removeItem(\'redirectLoop:lastTime\');sessionStorage.removeItem(\'redirectLoop:broken\');}catch(e){} try{localStorage.removeItem(\'redirectLoop:count\');localStorage.removeItem(\'redirectLoop:lastTime\');localStorage.removeItem(\'redirectLoop:broken\');}catch(e){} location.reload();})()">Retry</button>';
                    document.body.appendChild(b);
                }
                return;
            }
        } catch (e) {
            console.warn('Loop protection error', e);
        }

        // Telemetry for debugging redirect loops
        try {
            const history = JSON.parse(localStorage.getItem('redirectHistory') || '[]');
            history.push({ time: new Date().toISOString(), from: window.location.pathname + window.location.search, reason });
            while (history.length > 25) history.shift();
            localStorage.setItem('redirectHistory', JSON.stringify(history));
        } catch (e) { }

        try {
            this._writeStorageItem('lastRedirectFrom', window.location.pathname + window.location.search);
            this._writeStorageItem('lastRedirectReason', reason || 'unspecified');
            this._writeStorageItem('lastRedirectTime', new Date().toISOString());
        } catch (e) {
            console.warn('Failed to record redirect telemetry');
        }

        // Store the current page as return URL (exclude login page itself)
        const currentPath = window.location.pathname;
        console.log('🔗 Current path for return URL:', currentPath);

        if (!currentPath.includes('/index.html') && !currentPath.endsWith('/login.html')) {
            const returnUrl = currentPath + window.location.search;
            this._writeStorageItem('returnUrl', returnUrl);
            console.log('💾 Stored return URL:', returnUrl);
        }

        // Build login URL based on hosting layout (root hosting vs /frontend prefix)
        const basePrefix = (typeof this._getBasePrefix === 'function') ? this._getBasePrefix() : '';
        const loginUrl = window.location.origin + basePrefix + '/index.html';
        console.log('🔄 Redirecting to login URL:', loginUrl);
        this._redirectInProgress = true;
        this._redirectedThisLoad = true;
        window.location.href = loginUrl;
    },

    // Store authentication tokens
    setToken(key, value) {
        this._writeStorageItem(key, value);
    },

    // Get authentication token (defaults to idToken when no key specified)
    getToken(key = 'idToken') {
        return this._readStorageItem(key);
    },

    // Convenience helpers
    getIdToken() {
        return this._readStorageItem('idToken');
    },

    getAccessToken() {
        return this._readStorageItem('accessToken');
    },

    // Extract current user info from stored session and token
    getCurrentUser() {
        try {
            const userId = this._readStorageItem('userId');
            const userEmail = this._readStorageItem('userEmail');
            const idToken = this._readStorageItem('idToken');

            let role = localStorage.getItem('role') || null;
            let username = null;

            if (idToken) {
                try {
                    const payload = this._decodeJwtPayload(idToken) || {};
                    username = payload['cognito:username'] || payload['username'] || username;
                    // Map cognito groups to a simple role
                    const groups = payload['cognito:groups'] || [];
                    if (!role && Array.isArray(groups) && groups.length) {
                        if (groups.includes('admin') || groups.includes('super_admin')) role = 'admin';
                        else if (groups.includes('support')) role = 'support';
                        else if (groups.includes('manager')) role = 'manager';
                        else role = 'customer';
                    }
                } catch (e) {
                    console.warn('Failed to parse idToken payload for user info');
                }
            }

            // Sensible defaults
            return {
                userId: userId || null,
                email: userEmail || null,
                username: username || userEmail || null,
                role: role || 'customer'
            };
        } catch (e) {
            console.error('getCurrentUser() failed:', e);
            return null;
        }
    },

    // Clear all authentication tokens
    clearTokens() {
        // More surgical clearing (keep returnUrl & debug flags)
        const preservedReturn = this._readStorageItem('returnUrl');
        const preservedDebug = this._readStorageItem('authDebug');
        this._removeStorageItem('idToken');
        this._removeStorageItem('accessToken');
        this._removeStorageItem('refreshToken');
        this._removeStorageItem('userEmail');
        this._removeStorageItem('userId');
        this._removeStorageItem('isAuthenticated');
        if (preservedReturn) this._writeStorageItem('returnUrl', preservedReturn);
        if (preservedDebug) this._writeStorageItem('authDebug', preservedDebug);
        this._removeStorageItem('rememberLogin');
        this._removeStorageItem('lastEmail');
    },

    // Global logout function
    logout: async () => {
        try {
            if (typeof AWS !== 'undefined' && AWS.config && AWS.config.credentials) {
                try { AWS.config.credentials.clearCachedId(); } catch (e) { }
            }

            // Clear auth tokens/flags
            Auth.clearTokens();

            // On manual logout we also clear returnUrl & loop/telemetry keys so we don't get
            // stuck by redirect-loop protection when we *want* to go to login.
            const extraKeys = [
                'returnUrl',
                'lastLoginTime',
                'lastRedirectFrom',
                'lastRedirectReason',
                'lastRedirectTime',
                'redirectLoop:count',
                'redirectLoop:lastTime',
                'redirectLoop:broken'
            ];

            extraKeys.forEach((k) => {
                try { Auth._removeStorageItem(k); } catch (_) { }
            });

            // role is read directly from localStorage in getCurrentUser()
            try { localStorage.removeItem('role'); } catch (_) { }

            // Reset in-memory flags so we can always navigate away on logout
            Auth._redirectedThisLoad = false;
            Auth._redirectInProgress = false;
            Auth._authCheckedThisLoad = false;
            Auth._authCheckResult = null;
            Auth._authCheckWasSilent = false;

            const basePrefix = (typeof Auth._getBasePrefix === 'function') ? Auth._getBasePrefix() : '';
            const loginUrl = window.location.origin + basePrefix + '/index.html';
            window.location.replace(loginUrl);
        } catch (error) {
            console.error('Logout error:', error);
            try {
                const basePrefix = (typeof Auth._getBasePrefix === 'function') ? Auth._getBasePrefix() : '';
                window.location.replace(window.location.origin + basePrefix + '/index.html');
            } catch (_) {
                window.location.href = '/index.html';
            }
        }
    },

    // Get and clear return URL after successful login
    getAndClearReturnUrl() {
        const returnUrl = this._readStorageItem('returnUrl');
        if (returnUrl) {
            this._removeStorageItem('returnUrl');
            return returnUrl;
        }
        return null;
    },

    // Determine current base prefix for hosted path ("/frontend" when served from repo root; empty when /frontend is web root)
    _getBasePrefix() {
        try {
            const path = window.location.pathname || '';
            // If we are under /frontend/* (e.g., /frontend/index.html or /frontend/pages/..), we need the /frontend prefix
            if (path.startsWith('/frontend/')) {
                return '/frontend';
            }
            // If we are already under /pages/*, no prefix is needed (frontend is root)
            if (path.startsWith('/pages/')) {
                return '';
            }
            // When served with /frontend as the web root, the login path will be /index.html
            if (path === '/' || path === '/index.html' || path === '/login.html') {
                return '';
            }
            // If we are under any .../pages/* segment, derive the prefix before it
            const idx = path.indexOf('/pages/');
            if (idx > -1) {
                return path.slice(0, idx);
            }
        } catch (e) {
            console.warn('Auth: failed to detect base prefix', e);
        }
        // Default to no prefix; individual pages under /frontend/* will be covered by the first condition
        return '';
    },

    // Normalize a target path to include the detected base prefix
    _withBasePrefix(targetPath) {
        if (!targetPath) return null;
        // Ensure leading slash
        if (!/^\//.test(targetPath)) targetPath = '/' + targetPath;
        const basePrefix = this._getBasePrefix();

        // If target already contains /pages/ segment, normalize with/without /frontend
        if (targetPath.startsWith('/frontend/')) {
            return basePrefix === '' ? targetPath.replace(/^\/frontend/, '') : targetPath;
        }
        if (targetPath.startsWith('/pages/')) {
            return basePrefix === '/frontend' ? ('/frontend' + targetPath) : targetPath;
        }
        // If a raw html page name (e.g., dashboard.html) or /dashboard.html is provided, place it under pages/
        if (/^\/[A-Za-z0-9_-]+\.html(\?|#|$)/.test(targetPath)) {
            return basePrefix + '/pages' + targetPath;
        }
        // Fallback to combining as-is
        return basePrefix + targetPath;
    },

    // Get the post-login redirect URL (return URL or default dashboard)
    getPostLoginRedirectUrl() {
        console.log('🎯 getPostLoginRedirectUrl() called');
        
        let returnUrl = this.getAndClearReturnUrl();
        console.log('🔍 Return URL from session:', returnUrl);
        
        try {
            const basePrefix = this._getBasePrefix();
            console.log('🔍 Detected base prefix:', basePrefix);
            
            if (returnUrl) {
                // Avoid redirecting back to login
                if (/\/index\.html(\?|$)/.test(returnUrl)) {
                    console.log('⚠️ Return URL is login page, clearing it');
                    returnUrl = '';
                }
                if (returnUrl) {
                    // Support absolute and relative returnUrl values
                    if (/^https?:\/\//i.test(returnUrl)) {
                        console.log('✅ Using absolute return URL:', returnUrl);
                        return returnUrl; // already absolute
                    }
                    const normalizedPath = this._withBasePrefix(returnUrl);
                    const fullUrl = window.location.origin + normalizedPath;
                    console.log('✅ Using normalized return URL:', fullUrl);
                    return fullUrl;
                }
            }
        } catch (e) {
            console.warn('Failed to normalize returnUrl, falling back:', e);
        }

        // No valid return URL, use default
        try {
            const cfg = window.WIZZCENTRAL_CONFIG || {};
            const basePrefix = this._getBasePrefix();
            console.log('🔍 Config:', cfg);
            console.log('🔍 Base prefix for default:', basePrefix);
            
            let defaultPage = cfg.DEFAULT_POST_LOGIN_PAGE || basePrefix + '/pages/dashboard.html';
            console.log('🔍 Default page from config:', defaultPage);
            
            // Ensure it is normalized against the detected base
            defaultPage = this._withBasePrefix(defaultPage);
            const fullUrl = window.location.origin + defaultPage;
            console.log('✅ Using default redirect URL:', fullUrl);
            return fullUrl;
        } catch (e) {
            console.warn('Failed to build default URL, using fallback:', e);
            const fallback = this._withBasePrefix('/pages/dashboard.html');
            const fallbackUrl = window.location.origin + fallback;
            console.log('✅ Using fallback redirect URL:', fallbackUrl);
            return fallbackUrl;
        }
    }
};

// Set global logout function
window.logout = Auth.logout;

// NOTE: Authentication checks are now handled manually by each page
// This prevents automatic redirects that could interfere with login flow

// Auth Debug Overlay (optional) - enable with ?authdebug=1 or sessionStorage.authDebug = 'true'
(function authDebugOverlay() {
    try {
        const enabled = window.location.search.includes('authdebug=1') || localStorage.getItem('authDebug') === 'true';
        if (!enabled) return;
        localStorage.setItem('authDebug', 'true');
        if (document.getElementById('auth-debug-overlay')) return;
        const box = document.createElement('div');
        box.id = 'auth-debug-overlay';
        box.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:9999;background:#111;color:#fff;font:12px/1.3 monospace;padding:8px 10px;border:1px solid #444;border-radius:6px;max-width:280px;max-height:50vh;overflow:auto;box-shadow:0 2px 8px rgba(0,0,0,.4)';
        box.innerHTML = '<div style="font-weight:bold;display:flex;justify-content:space-between;align-items:center;">Auth Debug <button id="authDbgToggle" style="background:#444;color:#fff;border:none;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:11px;">−</button></div><pre id="authDbgBody" style="margin:6px 0 0;white-space:pre-wrap"></pre><div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;"><button id="authDbgCopy" style="flex:1;background:#2563eb;color:#fff;border:none;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:11px;">Copy</button><button id="authDbgClearRet" style="background:#b45309;color:#fff;border:none;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:11px;">Clr returnUrl</button><button id="authDbgOff" style="background:#6b7280;color:#fff;border:none;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:11px;">Off</button></div>';
        document.body.appendChild(box);
        const bodyEl = document.getElementById('authDbgBody');
        function short(t) { if (!t) return '∅'; return t.length > 18 ? t.slice(0, 8) + '…' + t.slice(-8) : t; }
        function expInfo() { try { const t = localStorage.getItem('idToken'); if (!t) return 'n/a'; const p = JSON.parse(atob(t.split('.')[1] || '')); if (!p.exp) return 'no exp'; const left = p.exp - Math.floor(Date.now() / 1000); return left + 's'; } catch (e) { return 'err'; } }
        function render() {
            const data = {
                path: window.location.pathname,
                isAuth: localStorage.getItem('isAuthenticated'),
                email: localStorage.getItem('userEmail'),
                idTok: short(localStorage.getItem('idToken') || ''),
                accTok: short(localStorage.getItem('accessToken') || ''),
                expIn: expInfo(),
                lastRedirectReason: localStorage.getItem('lastRedirectReason'),
                lastRedirectFrom: localStorage.getItem('lastRedirectFrom'),
                lastRedirectTime: localStorage.getItem('lastRedirectTime'),
                returnUrl: localStorage.getItem('returnUrl'),
                lastAuthCheck: localStorage.getItem('lastAuthCheckTime'),
                redirectHistory: (() => { try { return (JSON.parse(localStorage.getItem('redirectHistory') || '[]')).slice(-5); } catch (e) { return []; } })()
            };
            bodyEl.textContent = JSON.stringify(data, null, 2);
        }
        render();
        const intId = setInterval(() => { if (!document.body.contains(box)) { clearInterval(intId); return; } render(); }, 1500);
        document.getElementById('authDbgCopy').onclick = () => { try { navigator.clipboard.writeText(bodyEl.textContent); } catch (e) { } };
        document.getElementById('authDbgClearRet').onclick = () => { localStorage.removeItem('returnUrl'); render(); };
        document.getElementById('authDbgOff').onclick = () => { localStorage.removeItem('authDebug'); box.remove(); };
        document.getElementById('authDbgToggle').onclick = (e) => { const pre = bodyEl; if (pre.style.display === 'none') { pre.style.display = 'block'; e.target.textContent = '−'; } else { pre.style.display = 'none'; e.target.textContent = '+'; } };
    } catch (e) { console.warn('Auth debug overlay failed', e); }
})();

console.log('Auth utilities loaded successfully');
