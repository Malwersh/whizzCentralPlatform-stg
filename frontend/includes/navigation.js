// Legacy Navigation loader (compatibility shim)
// Many pages historically loaded this file. The modern navigation system is
// handled by NavigationManager in ../assets/js/navigation.js.
function loadNavigation() {
    try {
        if (window.navigationManager && typeof window.navigationManager.init === 'function') {
            window.navigationManager.init().catch((err) => {
                console.error('NavigationManager init failed (legacy shim):', err);
            });
            return;
        }
    } catch (e) {
        console.warn('Legacy loadNavigation shim failed, falling back:', e);
    }

    // Fallback to the old behavior only if NavigationManager is not available.
    fetch('../includes/sidebar.html')
        .then(response => response.text())
        .then(html => {
            const placeholder = document.getElementById('navigation-placeholder');
            if (placeholder) {
                placeholder.innerHTML = html;
            }

            setActiveNavItem();
            // Do NOT bind sidebar toggle here; it conflicts with NavigationManager.
        })
        .catch(error => {
            console.error('Error loading navigation:', error);
        });
}

function setActiveNavItem() {
    const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        const page = item.getAttribute('data-page');
        if (page === currentPage) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

function addSidebarToggle() {
    // Intentionally left as a no-op.
    // Sidebar toggling is owned by NavigationManager.
}

function logout() {
    try {
        if (window.Auth && typeof window.Auth.logout === 'function') {
            window.Auth.logout();
            return;
        }
        if (typeof window.logout === 'function') {
            window.logout();
            return;
        }
    } catch (e) {
        console.warn('Logout shim failed, using hard fallback:', e);
    }

    try { sessionStorage.clear(); } catch (_) {}
    try { localStorage.clear(); } catch (_) {}
    window.location.href = '../index.html';
}
