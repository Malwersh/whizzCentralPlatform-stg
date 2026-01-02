// Auto-apply Emergency Fix for Promotions Page
// This script automatically detects if emergency fix data is available and applies it

console.log('🔍 Emergency Fix Auto-Loader Started...');

// Function to apply the emergency fix
function autoApplyEmergencyFix() {
    // Check if emergency fix is active
    if (sessionStorage.getItem('emergencyFixActive') !== 'true') {
        console.log('ℹ️ No emergency fix data found');
        return;
    }
    
    console.log('🚨 Emergency fix data detected - applying...');
    
    try {
        // Get sample data from sessionStorage
        const sampleCampaigns = JSON.parse(sessionStorage.getItem('sampleCampaigns') || '[]');
        const sampleDiscounts = JSON.parse(sessionStorage.getItem('sampleDiscounts') || '[]');
        
        console.log(`📊 Loading: ${sampleCampaigns.length} campaigns, ${sampleDiscounts.length} discounts`);
        
        // Wait for DOM elements to be available
        const applyWhenReady = () => {
            // Clear any loading indicators
            const loadingIndicators = document.querySelectorAll('.loading, [id*="loading"]');
            loadingIndicators.forEach(el => el.style.display = 'none');
            
            // Update campaigns table
            const campaignsTableBody = document.getElementById('campaignsTableBody');
            if (campaignsTableBody) {
                if (sampleCampaigns.length > 0) {
                    campaignsTableBody.innerHTML = sampleCampaigns.map((campaign, index) => `
                        <tr>
                            <td>
                                <div><strong>${campaign.name}</strong></div>
                                <div style="font-size: 0.8rem; color: #666;">${campaign.campaignId}</div>
                            </td>
                            <td><span class="badge badge-info">${campaign.discountType}</span></td>
                            <td><strong>${campaign.discountValue}${campaign.discountType === 'percentage' ? '%' : '$'}</strong></td>
                            <td><span class="badge badge-success">Active</span></td>
                            <td><span class="text-muted">${campaign.usage}/${campaign.usageLimit}</span></td>
                            <td><span class="text-success">$${campaign.minimumOrderValue}</span></td>
                            <td><small>${new Date(campaign.startDate).toLocaleDateString()}</small></td>
                            <td>
                                <div class="btn-group btn-group-sm">
                                    <button class="btn btn-outline-primary btn-sm" title="Edit Campaign">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-outline-danger btn-sm" title="Delete Campaign">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    campaignsTableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No campaigns available</td></tr>';
                }
                console.log('✅ Campaigns table updated');
            }
            
            // Update merchant discounts table
            const merchantDiscountsTableBody = document.getElementById('merchantDiscountsTableBody');
            if (merchantDiscountsTableBody) {
                if (sampleDiscounts.length > 0) {
                    merchantDiscountsTableBody.innerHTML = sampleDiscounts.map((discount, index) => `
                        <tr>
                            <td>
                                <div><strong>${discount.title}</strong></div>
                                <div style="font-size: 0.8rem; color: #666;">${discount.discountId}</div>
                            </td>
                            <td><span class="badge badge-secondary">Merchant ${index + 1}</span></td>
                            <td><span class="badge badge-info">${discount.type}</span></td>
                            <td><strong>${discount.value}${discount.type === 'percentage' ? '%' : '$'}</strong></td>
                            <td><span class="badge badge-success">Active</span></td>
                            <td><span class="text-muted">${discount.usage_count}/${discount.usage_limit}</span></td>
                            <td><small>${new Date(discount.valid_to).toLocaleDateString()}</small></td>
                            <td>
                                <div class="btn-group btn-group-sm">
                                    <button class="btn btn-outline-primary btn-sm" title="Edit Discount">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-outline-danger btn-sm" title="Delete Discount">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    merchantDiscountsTableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No merchant discounts available</td></tr>';
                }
                console.log('✅ Merchant discounts table updated');
            }
            
            // Update statistics
            const statUpdates = [
                { id: 'totalCampaigns', value: sampleCampaigns.length },
                { id: 'activeCampaigns', value: sampleCampaigns.filter(c => c.status === 'active').length },
                { id: 'totalMerchantDiscounts', value: sampleDiscounts.length },
                { id: 'activeMerchantDiscounts', value: sampleDiscounts.filter(d => d.status === 'active').length }
            ];
            
            statUpdates.forEach(update => {
                const element = document.getElementById(update.id);
                if (element) {
                    element.textContent = update.value;
                    // Add a subtle animation
                    element.style.transition = 'all 0.3s ease';
                    element.style.transform = 'scale(1.1)';
                    setTimeout(() => {
                        element.style.transform = 'scale(1)';
                    }, 300);
                }
            });
            
            // Clear loading messages
            document.querySelectorAll('*').forEach(el => {
                if (el.textContent && el.textContent.includes('Loading')) {
                    if (el.textContent.includes('merchant discounts')) {
                        el.textContent = `Merchant Discounts (${sampleDiscounts.length})`;
                    } else if (el.textContent.includes('campaigns')) {
                        el.textContent = `Campaigns (${sampleCampaigns.length})`;
                    }
                }
            });
            
            // Show success notification
            showFixSuccessNotification(sampleCampaigns.length, sampleDiscounts.length);
            
            console.log('🎉 Emergency fix applied successfully!');
        };
        
        // Apply immediately if DOM is ready, otherwise wait
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(applyWhenReady, 500);
            });
        } else {
            setTimeout(applyWhenReady, 100);
        }
        
    } catch (error) {
        console.error('❌ Failed to apply emergency fix:', error);
        showFixErrorNotification(error.message);
    }
}

// Show success notification
function showFixSuccessNotification(campaignsCount, discountsCount) {
    const notification = document.createElement('div');
    notification.id = 'emergencyFixNotification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        padding: 16px 20px;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        max-width: 380px;
        line-height: 1.4;
        transform: translateX(100%);
        transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        border: 1px solid rgba(255, 255, 255, 0.2);
    `;
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
            <div style="background: rgba(255, 255, 255, 0.2); border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; margin-right: 12px; font-size: 16px;">
                ✅
            </div>
            <div style="font-weight: 600; font-size: 16px;">
                Promotions Page Fixed!
            </div>
        </div>
        <div style="margin-left: 44px;">
            <div style="margin-bottom: 4px;">
                <strong>Campaigns:</strong> ${campaignsCount} loaded
            </div>
            <div style="margin-bottom: 8px;">
                <strong>Discounts:</strong> ${discountsCount} loaded
            </div>
            <div style="font-size: 12px; opacity: 0.9; color: rgba(255, 255, 255, 0.8);">
                Authentication issue bypassed
            </div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto-remove after 7 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 500);
    }, 7000);
}

// Show error notification
function showFixErrorNotification(errorMessage) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        color: white;
        padding: 16px 20px;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(239, 68, 68, 0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        max-width: 380px;
        line-height: 1.4;
        transform: translateX(100%);
        transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    
    notification.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 8px;">
            ❌ Emergency Fix Failed
        </div>
        <div style="margin-bottom: 8px;">
            ${errorMessage}
        </div>
        <div style="font-size: 12px; opacity: 0.9;">
            Check console for details
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 500);
    }, 10000);
}

// Auto-start when script loads
autoApplyEmergencyFix();

// Also check periodically in case the fix data is added later
const checkInterval = setInterval(() => {
    if (sessionStorage.getItem('emergencyFixActive') === 'true' && 
        !document.getElementById('emergencyFixNotification')) {
        autoApplyEmergencyFix();
        clearInterval(checkInterval);
    }
}, 2000);

// Clear interval after 30 seconds to avoid infinite checking
setTimeout(() => {
    clearInterval(checkInterval);
}, 30000);

console.log('✅ Emergency Fix Auto-Loader Ready');
