// Aggressive sidebar extended state enforcement
// This runs IMMEDIATELY when script loads, before DOM ready

console.log('🛡️ AGGRESSIVE SIDEBAR FIX - Enforcing extended state');

// Clear storage immediately
localStorage.removeItem('sidebar-collapsed');
localStorage.setItem('sidebar-collapsed', 'false');
sessionStorage.removeItem('sidebar-user-collapsed');

// Function to aggressively force extended state
function aggressivelyForceExtended() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    
    if (sidebar) {
        sidebar.classList.remove('collapsed');
        console.log('🛡️ Removed collapsed class from sidebar');
    }
    
    if (mainContent) {
        mainContent.classList.remove('collapsed-sidebar');
        console.log('🛡️ Removed collapsed-sidebar class from main content');
    }
    
    return !!(sidebar && mainContent);
}

// Run immediately
aggressivelyForceExtended();

// Run on DOM ready
document.addEventListener('DOMContentLoaded', aggressivelyForceExtended);

// Run on window load
window.addEventListener('load', aggressivelyForceExtended);

// Run periodically for first few seconds to catch any late DOM changes
const intervals = [100, 200, 500, 1000, 2000];
intervals.forEach(delay => {
    setTimeout(aggressivelyForceExtended, delay);
});

// Listen for navigation events
document.addEventListener('navigation:ready', aggressivelyForceExtended);

// Override any attempts to add collapsed class
try {
    if (window.Element && Element.prototype && Element.prototype.classList && Element.prototype.classList.add) {
        const originalAdd = Element.prototype.classList.add;
        Element.prototype.classList.add = function(...classes) {
            try {
                if (this instanceof Element && (this.id === 'sidebar' || this.id === 'mainContent')) {
                    if (classes.includes('collapsed') || classes.includes('collapsed-sidebar')) {
                        console.log('🛡️ BLOCKED attempt to add collapsed class to', this.id);
                        return; // Block the addition
                    }
                }
            } catch(_) { /* swallow */ }
            return originalAdd.apply(this, classes);
        };
    }
} catch (e) { console.warn('Aggressive sidebar patch: classList override skipped', e); }

console.log('🛡️ Aggressive sidebar fix installed - blocking collapsed classes');
