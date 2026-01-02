// Sidebar State Verification Script
// Run this in browser console to verify sidebar state

(function() {
    'use strict';
    
    console.log('🔍 SIDEBAR STATE VERIFICATION');
    console.log('=' .repeat(50));
    
    // Check DOM elements
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    const menuToggle = document.getElementById('menuToggle');
    const sidebarToggle = document.getElementById('sidebarToggle');
    
    console.log('📋 DOM Elements:');
    console.log('  - Sidebar:', !!sidebar);
    console.log('  - Main Content:', !!mainContent);
    console.log('  - Menu Toggle:', !!menuToggle);
    console.log('  - Sidebar Toggle:', !!sidebarToggle);
    
    // Check current state
    if (sidebar && mainContent) {
        const isCollapsed = sidebar.classList.contains('collapsed');
        const hasCollapsedClass = mainContent.classList.contains('collapsed-sidebar');
        
        console.log('📊 Current State:');
        console.log('  - Sidebar collapsed class:', isCollapsed);
        console.log('  - Main content collapsed class:', hasCollapsedClass);
        console.log('  - Effective state:', isCollapsed ? 'COLLAPSED' : 'EXTENDED');
    }
    
    // Check storage
    const storedState = localStorage.getItem('sidebar-collapsed');
    const sessionState = sessionStorage.getItem('sidebar-user-collapsed');
    
    console.log('💾 Storage State:');
    console.log('  - localStorage sidebar-collapsed:', storedState);
    console.log('  - sessionStorage sidebar-user-collapsed:', sessionState);
    
    // Check navigation manager
    console.log('🧭 Navigation Manager:');
    console.log('  - Available:', !!window.navigationManager);
    console.log('  - Initialized:', window.navigationManager?.isInitialized);
    
    // Provide manual fix
    console.log('🔧 Manual Commands:');
    console.log('  - Force extended: window.forceSidebarExtended()');
    console.log('  - Toggle: window.toggleSidebar()');
    console.log('  - Debug toggles: window.debugToggleButtons()');
    
    console.log('=' .repeat(50));
    
    return {
        sidebar: !!sidebar,
        mainContent: !!mainContent,
        isCollapsed: sidebar?.classList.contains('collapsed'),
        storedState,
        sessionState
    };
})();
