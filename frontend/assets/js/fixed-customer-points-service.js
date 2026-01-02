/**
 * خدمة النقاط المُصححة - الواجهة الأمامية
 * Fixed Customer Points Service - Frontend
 * WizzCentral Platform
 */

class FixedCustomerPointsService {
    constructor() {
        this.baseUrl = '/api';
        console.log('🎯 تم تهيئة خدمة النقاط المُصححة');
        console.log('🎯 Fixed Customer Points Service initialized');
    }

    /**
     * جلب رصيد نقاط العميل من الجدول المخصص
     * Get customer points balance from dedicated table
     */
    async getCustomerPoints(customerId) {
        try {
            console.log(`🔍 جلب نقاط العميل: ${customerId}`);
            
            const response = await fetch(`${this.baseUrl}/customers/${customerId}/points`);
            const result = await response.json();
            
            if (result.success) {
                console.log(`✅ تم جلب النقاط: ${result.data.totalPoints}`);
                return result.data;
            } else {
                console.error('❌ فشل في جلب النقاط:', result.error);
                return this.getEmptyPointsData(customerId);
            }
        } catch (error) {
            console.error('❌ خطأ في جلب النقاط:', error);
            return this.getEmptyPointsData(customerId);
        }
    }

    /**
     * استهلاك النقاط
     * Redeem customer points
     */
    async redeemPoints(customerId, pointsAmount, orderId = null, description = null) {
        try {
            console.log(`💳 استهلاك ${pointsAmount} نقطة للعميل ${customerId}`);
            
            const response = await fetch(`${this.baseUrl}/customers/redeem-points`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    customerId,
                    pointsAmount,
                    orderId,
                    description: description || `استهلاك ${pointsAmount} نقطة`
                })
            });

            const result = await response.json();
            
            if (result.success) {
                console.log(`✅ تم استهلاك ${pointsAmount} نقطة بنجاح`);
                
                // إشعار المستخدم
                this.showSuccessNotification(
                    `تم استهلاك ${pointsAmount} نقطة بنجاح`,
                    `رصيدك الجديد: ${result.newTotalPoints} نقطة`
                );
                
                return result;
            } else {
                console.error('❌ فشل في استهلاك النقاط:', result.error);
                
                // إشعار بالخطأ
                this.showErrorNotification(
                    'فشل في استهلاك النقاط',
                    result.error || 'حدث خطأ غير متوقع'
                );
                
                return result;
            }
        } catch (error) {
            console.error('❌ خطأ في استهلاك النقاط:', error);
            
            this.showErrorNotification(
                'خطأ في الاتصال',
                'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.'
            );
            
            return { success: false, error: error.message };
        }
    }

    /**
     * منح نقاط للطلب المكتمل
     * Award points for completed order
     */
    async awardPointsForOrder(customerId, orderId) {
        try {
            console.log(`🎯 منح نقاط للطلب ${orderId}`);
            
            const response = await fetch(`${this.baseUrl}/orders/${orderId}/award-points`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ customerId })
            });

            const result = await response.json();
            
            if (result.success) {
                console.log(`✅ تم منح ${result.pointsEarned} نقطة للعميل ${customerId}`);
                
                // إشعار المستخدم
                this.showSuccessNotification(
                    `مبروك! حصلت على ${result.pointsEarned} نقطة`,
                    `رصيدك الجديد: ${result.newTotalPoints} نقطة`
                );
                
                return result;
            } else {
                console.log(`ℹ️ ${result.reason || result.error}`);
                return result;
            }
        } catch (error) {
            console.error('❌ خطأ في منح النقاط:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * جلب تاريخ معاملات النقاط
     * Get points transaction history
     */
    async getPointsHistory(customerId, limit = 50) {
        try {
            console.log(`📊 جلب تاريخ النقاط للعميل: ${customerId}`);
            
            const response = await fetch(`${this.baseUrl}/customers/${customerId}/points-history?limit=${limit}`);
            const result = await response.json();
            
            if (result.success) {
                console.log(`✅ تم جلب ${result.count} معاملة`);
                return result.transactions;
            } else {
                console.error('❌ فشل في جلب تاريخ النقاط:', result.error);
                return [];
            }
        } catch (error) {
            console.error('❌ خطأ في جلب تاريخ النقاط:', error);
            return [];
        }
    }

    /**
     * جلب إحصائيات النظام
     * Get system statistics
     */
    async getSystemStatistics() {
        try {
            const response = await fetch(`${this.baseUrl}/points/statistics`);
            const result = await response.json();
            
            if (result.success) {
                return result.statistics;
            } else {
                console.error('❌ فشل في جلب الإحصائيات:', result.error);
                return {};
            }
        } catch (error) {
            console.error('❌ خطأ في جلب الإحصائيات:', error);
            return {};
        }
    }

    /**
     * تحديث عرض النقاط في الواجهة
     * Update points display in UI
     */
    async updateCustomerPointsDisplay(customerId, containerId = 'customer-points-display') {
        try {
            const pointsData = await this.getCustomerPoints(customerId);
            const container = document.getElementById(containerId);
            
            if (container) {
                container.innerHTML = this.generatePointsDisplayHTML(pointsData);
            }
            
            return pointsData;
        } catch (error) {
            console.error('❌ خطأ في تحديث عرض النقاط:', error);
        }
    }

    /**
     * توليد HTML لعرض النقاط
     * Generate HTML for points display
     */
    generatePointsDisplayHTML(pointsData) {
        const tierEmojis = {
            regular: '🥉',
            silver: '🥈', 
            gold: '🥇',
            platinum: '💎'
        };

        const tierNames = {
            regular: 'عادي',
            silver: 'فضي',
            gold: 'ذهبي', 
            platinum: 'بلاتيني'
        };

        return `
            <div class="customer-points-card">
                <div class="points-header">
                    <h3>رصيد النقاط</h3>
                    <span class="vip-badge ${pointsData.vipStatus ? 'vip' : 'regular'}">
                        ${pointsData.vipStatus ? '✨ VIP' : 'عادي'}
                    </span>
                </div>
                
                <div class="points-balance">
                    <span class="points-number">${pointsData.totalPoints.toLocaleString()}</span>
                    <span class="points-label">نقطة</span>
                </div>
                
                <div class="tier-info">
                    <span class="tier-icon">${tierEmojis[pointsData.tierLevel] || '🥉'}</span>
                    <span class="tier-name">مستوى ${tierNames[pointsData.tierLevel] || 'عادي'}</span>
                </div>
                
                <div class="points-stats">
                    <div class="stat-item">
                        <span class="stat-label">إجمالي المكتسب:</span>
                        <span class="stat-value">${pointsData.lifetimePointsEarned.toLocaleString()}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">إجمالي المستخدم:</span>
                        <span class="stat-value">${pointsData.lifetimePointsRedeemed.toLocaleString()}</span>
                    </div>
                </div>
                
                ${pointsData.lastEarnedDate ? `
                    <div class="last-activity">
                        آخر كسب نقاط: ${new Date(pointsData.lastEarnedDate).toLocaleDateString('ar-EG')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * بيانات النقاط الفارغة
     * Empty points data
     */
    getEmptyPointsData(customerId) {
        return {
            customerId,
            totalPoints: 0,
            lifetimePointsEarned: 0,
            lifetimePointsRedeemed: 0,
            vipStatus: false,
            tierLevel: 'regular',
            lastEarnedDate: null,
            lastRedeemedDate: null
        };
    }

    /**
     * إشعارات النجاح
     * Success notifications
     */
    showSuccessNotification(title, message) {
        // يمكن استخدام مكتبة Toast أو نظام الإشعارات الموجود
        if (typeof window.showToast === 'function') {
            window.showToast('success', title, message);
        } else {
            console.log(`✅ ${title}: ${message}`);
        }
    }

    /**
     * إشعارات الخطأ
     * Error notifications
     */
    showErrorNotification(title, message) {
        if (typeof window.showToast === 'function') {
            window.showToast('error', title, message);
        } else {
            console.error(`❌ ${title}: ${message}`);
        }
    }

    /**
     * حساب النقاط من مبلغ
     * Calculate points from amount
     */
    calculatePointsFromAmount(amountIQD) {
        return Math.floor(amountIQD / 1000) * 100;
    }

    /**
     * حساب المبلغ من النقاط (للاسترداد)
     * Calculate amount from points (for redemption)
     */
    calculateAmountFromPoints(points) {
        return points; // 1 نقطة = 1 دينار
    }

    /**
     * التحقق من إمكانية الاستهلاك
     * Check if redemption is possible
     */
    canRedeemPoints(currentPoints, requestedPoints) {
        return currentPoints >= requestedPoints && requestedPoints > 0;
    }

    /**
     * حساب النقاط المطلوبة للمستوى التالي
     * Calculate points needed for next tier
     */
    getPointsForNextTier(currentPoints) {
        const tiers = [
            { name: 'regular', min: 0, max: 4999 },
            { name: 'silver', min: 5000, max: 9999 },
            { name: 'gold', min: 10000, max: 19999 },
            { name: 'platinum', min: 20000, max: Infinity }
        ];

        for (let tier of tiers) {
            if (currentPoints >= tier.min && currentPoints <= tier.max) {
                const nextTier = tiers[tiers.indexOf(tier) + 1];
                if (nextTier) {
                    return nextTier.min - currentPoints;
                }
                return 0; // Already at highest tier
            }
        }
        return 0;
    }
}

// تصدير الخدمة للاستخدام العام
// Export service for global use
window.FixedCustomerPointsService = FixedCustomerPointsService;

// إنشاء مثيل عام
// Create global instance
window.fixedPointsService = new FixedCustomerPointsService();

console.log('✅ تم تحميل خدمة النقاط المُصححة');
console.log('✅ Fixed Customer Points Service loaded');

// CSS للنقاط (يمكن نقله لملف CSS منفصل)
const pointsCSS = `
<style>
.customer-points-card {
    background: linear-gradient(135deg, #00c2e8 0%, #009bb8 100%);
    color: white;
    padding: 20px;
    border-radius: 12px;
    margin: 15px 0;
    box-shadow: 0 4px 15px rgba(0, 194, 232, 0.3);
}

.points-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
}

.points-header h3 {
    margin: 0;
    font-size: 1.2rem;
}

.vip-badge {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 600;
}

.vip-badge.vip {
    background: rgba(255, 215, 0, 0.2);
    border: 1px solid gold;
}

.vip-badge.regular {
    background: rgba(255, 255, 255, 0.2);
}

.points-balance {
    text-align: center;
    margin: 20px 0;
}

.points-number {
    font-size: 2.5rem;
    font-weight: 700;
    display: block;
}

.points-label {
    font-size: 1rem;
    opacity: 0.9;
}

.tier-info {
    text-align: center;
    margin: 15px 0;
    font-size: 1.1rem;
}

.tier-icon {
    margin-right: 8px;
    font-size: 1.3rem;
}

.points-stats {
    display: flex;
    justify-content: space-between;
    margin-top: 20px;
    padding-top: 15px;
    border-top: 1px solid rgba(255, 255, 255, 0.3);
}

.stat-item {
    text-align: center;
}

.stat-label {
    display: block;
    font-size: 0.85rem;
    opacity: 0.8;
}

.stat-value {
    display: block;
    font-size: 1.1rem;
    font-weight: 600;
    margin-top: 4px;
}

.last-activity {
    text-align: center;
    margin-top: 10px;
    font-size: 0.85rem;
    opacity: 0.8;
}

/* الوضع المظلم */
@media (prefers-color-scheme: dark) {
    .customer-points-card {
        background: linear-gradient(135deg, #00748a 0%, #005a6b 100%);
    }
}
</style>
`;

// إضافة CSS للصفحة
if (!document.getElementById('points-styles')) {
    const styleElement = document.createElement('style');
    styleElement.id = 'points-styles';
    styleElement.innerHTML = pointsCSS.replace('<style>', '').replace('</style>', '');
    document.head.appendChild(styleElement);
}
