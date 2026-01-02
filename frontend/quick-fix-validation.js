console.log('🔧 Testing Campaign Condition UI Fix - Manual Validation');

// Test 1: Check that condition UI buttons have proper type="button"
console.log('\n1️⃣ Checking button types in condition UI...');
const conditionButtons = document.querySelectorAll('.condition-builder button, .condition-modal button');
let improperButtons = 0;
conditionButtons.forEach((btn, i) => {
    if (!btn.type || btn.type === '') {
        console.log(`❌ Button ${i} has no type:`, btn.textContent.trim());
        improperButtons++;
    } else if (btn.type === 'submit' && !btn.hasAttribute('data-submit')) {
        console.log(`⚠️ Button ${i} is submit type without data-submit:`, btn.textContent.trim());
    } else {
        console.log(`✅ Button ${i} has proper type "${btn.type}":`, btn.textContent.trim());
    }
});

if (improperButtons === 0) {
    console.log('✅ All condition UI buttons have proper types');
} else {
    console.log(`❌ Found ${improperButtons} buttons without proper type`);
}

// Test 2: Check advanced conditions checkbox attributes
console.log('\n2️⃣ Checking advanced conditions checkbox...');
const checkbox = document.getElementById('useAdvancedConditions');
if (checkbox) {
    const hasDataNoSubmit = checkbox.hasAttribute('data-no-submit');
    const hasName = checkbox.hasAttribute('name');
    
    console.log('✅ Checkbox found');
    console.log(`data-no-submit: ${hasDataNoSubmit ? '✅' : '❌'}`);
    console.log(`name attribute: ${hasName ? '❌ (should be removed)' : '✅ (properly removed)'}`);
} else {
    console.log('❌ Advanced conditions checkbox not found');
}

// Test 3: Check form submission handlers
console.log('\n3️⃣ Checking form submission setup...');
const form = document.getElementById('createCampaignForm');
if (form) {
    console.log('✅ Campaign form found');
    
    // Check if handleCampaignSubmit function exists
    if (typeof handleCampaignSubmit === 'function') {
        console.log('✅ handleCampaignSubmit function exists');
    } else {
        console.log('❌ handleCampaignSubmit function not found');
    }
    
    // Check submit button
    const submitBtn = document.getElementById('submitCampaignBtn');
    if (submitBtn) {
        console.log('✅ Submit button found');
        console.log(`Submit button type: ${submitBtn.type}`);
        console.log(`Submit button has data-submit: ${submitBtn.hasAttribute('data-submit')}`);
    } else {
        console.log('❌ Submit button not found');
    }
} else {
    console.log('❌ Campaign form not found');
}

console.log('\n🔍 Manual Test Instructions:');
console.log('1. Click "Create Special Campaign" button');
console.log('2. Check "Use sophisticated condition engine"');
console.log('3. Try clicking condition buttons');
console.log('4. Verify form does NOT close unexpectedly');
console.log('5. Fill form and click "Create Campaign" to test proper submission');
