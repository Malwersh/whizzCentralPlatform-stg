// Dashboard initialization (Auth + Navigation) externalized for CSP compliance
(function(){
  document.addEventListener('DOMContentLoaded', async function(){
    // Navigation manager init
    try {
      if (window.navigationManager && typeof window.navigationManager.init === 'function') {
        await window.navigationManager.init();
        console.log('✅ Dashboard: Navigation initialized successfully (singleton)');
      } else {
        console.warn('⚠️ Dashboard: navigationManager not ready; skipping init to avoid duplicate instances');
      }
    } catch (err) { console.error('❌ Navigation initialization failed:', err); }
  });
})();
