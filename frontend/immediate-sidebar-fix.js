// Immediate Sidebar State Fix
// This script ensures sidebar is ALWAYS extended by default

(function() {
    'use strict';
    
    console.log('🚀 Simple sidebar fix: FORCE EXTENDED STATE');
    
    // Function to force extended state
    function forceExtendedState() {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.getElementById('mainContent');
        
        if (sidebar && mainContent) {
            // ALWAYS force extended state - remove any collapsed classes
            sidebar.classList.remove('collapsed');
            mainContent.classList.remove('collapsed-sidebar');
            
            // Clear any stored collapsed state
            localStorage.setItem('sidebar-collapsed', 'false');
            sessionStorage.removeItem('sidebar-user-collapsed');
            
            console.log('✅ FORCED sidebar to extended state');
            return true;
        }
        return false;
    }
    
    // Try immediately
    if (!forceExtendedState()) {
        // If elements not found, wait for DOM ready
        document.addEventListener('DOMContentLoaded', forceExtendedState);
        
        // Also try after delays to catch any async sidebar loading
        setTimeout(forceExtendedState, 50);
        setTimeout(forceExtendedState, 200);
        setTimeout(forceExtendedState, 500);
        setTimeout(forceExtendedState, 1000);
    }
    
    // Also listen for navigation ready event
    document.addEventListener('navigation:ready', forceExtendedState);
    
    console.log('✅ Simple sidebar fix loaded - forcing extended state');
})();
