// Campaign Button Debug Script
// This script helps diagnose why the Create Campaign button isn't working

console.log('🔧 Campaign Button Debug Script Loaded');

// Check if elements exist
function checkElements() {
    console.log('🔍 Checking DOM elements...');
    
    const button = document.getElementById('createCampaignBtn');
    const modal = document.getElementById('simplifiedCampaignModal');
    const form = document.getElementById('simplifiedCampaignForm');
    
    console.log('Create Campaign Button:', button ? '✅ Found' : '❌ Not found');
    console.log('Campaign Modal:', modal ? '✅ Found' : '❌ Not found');
    console.log('Campaign Form:', form ? '✅ Found' : '❌ Not found');
    
    if (button) {
        console.log('Button events:', getEventListeners ? getEventListeners(button) : 'Event listeners not accessible');
    }
    
    return { button, modal, form };
}

// Test button click manually
function testButtonClick() {
    console.log('🧪 Testing button click manually...');
    const { button, modal } = checkElements();
    
    if (button && modal) {
        console.log('Manually triggering modal display...');
        modal.style.display = 'flex';
        console.log('Modal display style set to flex');
        
        // Test closing after 3 seconds
        setTimeout(() => {
            modal.style.display = 'none';
            console.log('Modal closed after 3 seconds');
        }, 3000);
    }
}

// Add direct event listener for testing
function addDirectListener() {
    console.log('🔗 Adding direct event listener...');
    const button = document.getElementById('createCampaignBtn');
    
    if (button) {
        button.addEventListener('click', (e) => {
            console.log('🎯 Direct button click detected!');
            const modal = document.getElementById('simplifiedCampaignModal');
            if (modal) {
                modal.style.display = 'flex';
                console.log('Modal opened via direct listener');
            }
        });
        console.log('✅ Direct listener added successfully');
    }
}

// Check if required scripts are loaded
function checkScripts() {
    console.log('📜 Checking required scripts...');
    console.log('SimplifiedCampaignManager:', typeof SimplifiedCampaignManager !== 'undefined' ? '✅ Loaded' : '❌ Not loaded');
    console.log('window.campaignManager:', window.campaignManager ? '✅ Available' : '❌ Not available');
}

// Run all checks when DOM is ready
function runDiagnostics() {
    console.log('🚀 Running Campaign Button Diagnostics...');
    checkElements();
    checkScripts();
    addDirectListener();
    
    // Provide manual test function
    window.testCampaignButton = testButtonClick;
    console.log('💡 Run testCampaignButton() in console to test manually');
}

// Auto-run diagnostics
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runDiagnostics);
} else {
    runDiagnostics();
}

// Export for manual testing
window.campaignButtonDebug = {
    checkElements,
    testButtonClick,
    addDirectListener,
    checkScripts,
    runDiagnostics
};
