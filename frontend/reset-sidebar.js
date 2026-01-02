// Quick script to reset sidebar to extended state
// Run this in browser console to fix sidebar state issues

(function() {
    console.log('🔧 Resetting sidebar to extended state...');
    
    // Clear all sidebar-related storage
    localStorage.removeItem('sidebar-collapsed');
    localStorage.setItem('sidebar-collapsed', 'false');
    sessionStorage.removeItem('sidebar-user-collapsed');
    
    // Get sidebar and main content elements
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    
    if (sidebar && mainContent) {
        // Remove collapsed classes
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('collapsed-sidebar');
        
        console.log('✅ Sidebar reset to extended state');
        console.log('✅ All state markers cleared');
    } else {
        console.warn('⚠️ Sidebar elements not found, try running after page loads');
    }
    
    // Also try to call the navigation manager method if available
    if (window.navigationManager && typeof window.navigationManager.resetToExtendedState === 'function') {
        window.navigationManager.resetToExtendedState();
    }
    
    // Force reload to apply changes
    setTimeout(() => {
        console.log('🔄 Reloading page to apply changes...');
        window.location.reload();
    }, 1000);
})();
