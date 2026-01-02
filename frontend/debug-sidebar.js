// Sidebar State Debugger
// Run this in browser console to debug sidebar state issues

(function() {
    console.log('🔍 === SIDEBAR STATE DEBUG ===');
    
    // Check localStorage
    const localStorageState = localStorage.getItem('sidebar-collapsed');
    const sessionStorageState = sessionStorage.getItem('sidebar-user-collapsed');
    
    console.log('📦 Storage State:');
    console.log('  localStorage sidebar-collapsed:', localStorageState);
    console.log('  sessionStorage sidebar-user-collapsed:', sessionStorageState);
    
    // Check DOM elements
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    
    console.log('🏗️ DOM Elements:');
    console.log('  sidebar found:', !!sidebar);
    console.log('  mainContent found:', !!mainContent);
    
    if (sidebar) {
        console.log('  sidebar classes:', sidebar.className);
        console.log('  sidebar has collapsed class:', sidebar.classList.contains('collapsed'));
    }
    
    if (mainContent) {
        console.log('  mainContent classes:', mainContent.className);
        console.log('  mainContent has collapsed-sidebar class:', mainContent.classList.contains('collapsed-sidebar'));
    }
    
    // Check navigation manager
    console.log('🧭 Navigation Manager:');
    console.log('  navigationManager exists:', !!window.navigationManager);
    if (window.navigationManager) {
        console.log('  navigationManager initialized:', window.navigationManager.isReady());
    }
    
    // Check screen size
    console.log('📱 Screen Info:');
    console.log('  window width:', window.innerWidth);
    console.log('  is mobile:', window.innerWidth <= 768);
    
    console.log('🔍 === END DEBUG ===');
})();
