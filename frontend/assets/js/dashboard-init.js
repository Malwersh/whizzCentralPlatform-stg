// Dashboard initialization (Auth + Navigation) externalized for CSP compliance
(function(){
  document.addEventListener('DOMContentLoaded', async function(){
    // Auth check
    if (window.Auth && typeof window.Auth.requireAuthentication === 'function') {
      try { window.Auth.requireAuthentication(); } catch(e){ console.warn('Auth check error', e); }
    }
    // Navigation manager init
    try {
      if (typeof NavigationManager === 'function') {
        const navigationManager = new NavigationManager();
        await navigationManager.init();
        console.log('✅ Dashboard: Navigation initialized successfully');
      }
    } catch (err) { console.error('❌ Navigation initialization failed:', err); }
  });
})();
