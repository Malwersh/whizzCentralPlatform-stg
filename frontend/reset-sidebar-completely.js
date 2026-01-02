// Complete Sidebar State Reset
// Run this script to completely clear all sidebar state and force extended default

(function() {
    'use strict';
    
    console.log('🧹 COMPLETE SIDEBAR STATE RESET');
    
    // Clear ALL storage
    localStorage.removeItem('sidebar-collapsed');
    sessionStorage.removeItem('sidebar-user-collapsed');
    sessionStorage.removeItem('page-loaded-before');
    
    console.log('✅ Cleared all localStorage and sessionStorage sidebar data');
    
    // Force DOM to extended state
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    
    if (sidebar && mainContent) {
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('collapsed-sidebar');
        console.log('✅ Forced DOM elements to extended state');
    } else {
        console.log('⚠️ Sidebar DOM elements not found yet');
    }
    
    // Set proper defaults
    localStorage.setItem('sidebar-collapsed', 'false');
    console.log('✅ Set sidebar-collapsed to false in localStorage');
    
    console.log('🎯 RESET COMPLETE - Sidebar should now be extended by default');
    console.log('🔄 Refresh the page to see the changes');
    
    // Auto-refresh after a short delay
    setTimeout(() => {
        console.log('🔄 Auto-refreshing page...');
        window.location.reload();
    }, 1000);
    
})();
