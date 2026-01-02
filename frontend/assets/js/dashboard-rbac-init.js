// Dashboard RBAC initialization externalized for CSP compliance
(function(){
  function applyRBAC() {
    try {
      if (!window.RBAC || typeof window.RBAC.enforcePage !== 'function') {
        console.warn('RBAC not ready yet');
        return false;
      }
      window.RBAC.enforcePage();
      // Hide quick action links to pages user cannot access
      document.querySelectorAll('.quick-action-btn[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/([a-z-]+)\.html$/);
        if (m) {
          const page = m[1] + '.html';
          if (!window.RBAC.hasPageAccess(page)) {
            a.style.display = 'none';
          }
        }
      });
      // Hide write-only elements for domains without write permission
      document.querySelectorAll('[data-domain][data-write-only]').forEach(el => {
        const d = el.getAttribute('data-domain');
        if (d && window.RBAC && typeof window.RBAC.can === 'function' && !window.RBAC.can(d, 'write')) {
          el.style.display = 'none';
        }
      });
      return true;
    } catch (e) { console.warn('Dashboard RBAC init failed', e); return false; }
  }

  // Attempt immediately, then retry a few times if RBAC loads late
  if (!applyRBAC()) {
    let attempts = 0;
    const maxAttempts = 10;
    const interval = setInterval(() => {
      attempts++;
      if (applyRBAC() || attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 300);
  }
})();
