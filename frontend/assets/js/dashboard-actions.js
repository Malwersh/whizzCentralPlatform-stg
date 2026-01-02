// Bind dashboard UI actions (CSP-safe)
(function(){
  document.addEventListener('click', (e) => {
    const linkCard = e.target.closest('[data-href]');
    if (linkCard) {
      const href = linkCard.getAttribute('data-href');
      if (href) window.location.href = href;
      return;
    }
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (action === 'generate-report' && typeof window.generateReport === 'function') {
      window.generateReport();
    } else if (action === 'refresh-analytics' && typeof window.refreshAnalytics === 'function') {
      window.refreshAnalytics();
    }
  });
})();
