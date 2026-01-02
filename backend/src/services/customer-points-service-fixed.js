/**
 * خدمة النقاط المُصححة للعملاء
 * Customer Points Service - Fixed Implementation
 * Manages customer loyalty points with persistent storage
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");

// Initialize DynamoDB client
const dynamoDBClient = new DynamoDBClient({ region: "us-east-1" });
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

// Table names - أسماء الجداول
const CUSTOMER_POINTS_TABLE = 'WizzUser_customer_points_dev';
const POINTS_TRANSACTIONS_TABLE = 'WizzUser_points_transactions_dev';
const ORDERS_TABLE = 'WizzOrders_dev';

// Points configuration - إعدادات النقاط
const POINTS_CONFIG = {
    POINTS_PER_1000_IQD: 100,       // 100 نقطة لكل 1000 دينار
    VIP_THRESHOLD: 5000,            // 5000 نقطة للحصول على VIP
    TIER_THRESHOLDS: {
        regular: 0,                 // عادي: 0 - 4,999
        silver: 5000,               // فضي: 5,000 - 9,999
        gold: 10000,                // ذهبي: 10,000 - 19,999
        platinum: 20000             // بلاتيني: 20,000+
    }
};

/**
 * منح نقاط للطلب المكتمل
 * Award points for a completed order
 */
async function awardPointsForOrder(customerId, orderId) {
    console.log(`🎯 منح نقاط للطلب ${orderId} للعميل ${customerId}`);
    console.log(`🎯 Awarding points for order ${orderId} to customer ${customerId}`);
    
    try {
        // جلب بيانات الطلب - Fetch order data
        const order = await getOrderData(orderId);
        if (!order) {
            console.log(`⚠️ الطلب ${orderId} غير موجود`);
            return { success: false, reason: 'Order not found' };
        }

        // التحقق من ملكية الطلب - Verify order ownership
        if (order.customerId !== customerId) {
            console.log(`⚠️ الطلب ${orderId} لا ينتمي للعميل ${customerId}`);
            return { success: false, reason: 'Order does not belong to customer' };
        }

        // التحقق من حالة الطلب - Check order status
        const validStatuses = ['delivered', 'completed', 'finished'];
        if (!validStatuses.includes(order.status)) {
            console.log(`⚠️ حالة الطلب ${order.status} غير صالحة لمنح النقاط`);
            return { success: false, reason: 'Invalid order status for points' };
        }

        // التحقق من عدم منح النقاط مسبقاً - Check if points already awarded
        const existingTransaction = await checkExistingEarnedPoints(orderId);
        if (existingTransaction) {
            console.log(`⚠️ تم منح النقاط للطلب ${orderId} مسبقاً`);
            return { success: false, reason: 'Points already awarded for this order' };
        }

        // حساب النقاط - Calculate points
        const actualAmountPaid = extractActualPayment(order);
        const pointsEarned = Math.floor(actualAmountPaid / 1000) * POINTS_CONFIG.POINTS_PER_1000_IQD;
        
        if (pointsEarned <= 0) {
            console.log(`ℹ️ لا توجد نقاط للمنح (المبلغ: ${actualAmountPaid})`);
            return { success: false, reason: 'No points to award' };
        }

        // جلب الرصيد الحالي - Get current balance
        const currentBalance = await getCustomerPointsBalance(customerId);
        
        // حساب الرصيد الجديد - Calculate new balance
        const newTotalPoints = (currentBalance.totalPoints || 0) + pointsEarned;
        const newLifetimeEarned = (currentBalance.lifetimePointsEarned || 0) + pointsEarned;
        
        // تحديد المستوى الجديد - Determine new tier
        const newTierLevel = calculateTierLevel(newTotalPoints);
        const newVipStatus = newTotalPoints >= POINTS_CONFIG.VIP_THRESHOLD;

        // معرف المعاملة - Transaction ID
        const transactionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date().toISOString();

        // معاملة آمنة لتحديث النقاط - Secure transaction to update points
        await dynamoDB.send(new TransactWriteCommand({
            TransactItems: [
                {
                    // تحديث/إنشاء رصيد العميل - Update/create customer balance
                    Put: {
                        TableName: CUSTOMER_POINTS_TABLE,
                        Item: {
                            customerId,
                            totalPoints: newTotalPoints,
                            lifetimePointsEarned: newLifetimeEarned,
                            lifetimePointsRedeemed: currentBalance.lifetimePointsRedeemed || 0,
                            vipStatus: newVipStatus,
                            tierLevel: newTierLevel,
                            lastEarnedDate: now,
                            lastRedeemedDate: currentBalance.lastRedeemedDate || null,
                            createdAt: currentBalance.createdAt || now,
                            updatedAt: now
                        }
                    }
                },
                {
                    // إضافة سجل المعاملة - Add transaction record
                    Put: {
                        TableName: POINTS_TRANSACTIONS_TABLE,
                        Item: {
                            customerId,
                            transactionId,
                            orderId,
                            transactionType: 'earned',
                            pointsAmount: pointsEarned,
                            orderAmount: order.totalAmount || 0,
                            actualAmountPaid,
                            paymentMethod: order.paymentMethod || 'unknown',
                            description: `نقاط من الطلب ${orderId} / Points from order ${orderId}`,
                            timestamp: now,
                            metadata: {
                                restaurantId: order.restaurantId || order.businessId,
                                orderStatus: order.status,
                                originalTotalAmount: order.totalAmount
                            }
                        }
                    }
                }
            ]
        }));

        console.log(`✅ تم منح ${pointsEarned} نقطة للعميل ${customerId} من الطلب ${orderId}`);
        console.log(`✅ Awarded ${pointsEarned} points to customer ${customerId} for order ${orderId}`);
        
        return {
            success: true,
            pointsEarned,
            newTotalPoints,
            newTierLevel,
            newVipStatus,
            transactionId
        };

    } catch (error) {
        console.error(`❌ خطأ في منح النقاط للطلب ${orderId}:`, error);
        console.error(`❌ Error awarding points for order ${orderId}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * استهلاك النقاط
 * Redeem customer points
 */
async function redeemCustomerPoints(customerId, pointsToRedeem, orderId, description) {
    console.log(`💳 استهلاك ${pointsToRedeem} نقطة للعميل ${customerId}`);
    console.log(`💳 Redeeming ${pointsToRedeem} points for customer ${customerId}`);
    
    try {
        // التحقق من صحة البيانات - Validate input
        if (!customerId || !pointsToRedeem || pointsToRedeem <= 0) {
            return {
                success: false,
                error: 'بيانات غير صحيحة / Invalid input data'
            };
        }

        // التحقق من الرصيد الحالي - Check current balance
        const currentBalance = await getCustomerPointsBalance(customerId);
        
        if ((currentBalance.totalPoints || 0) < pointsToRedeem) {
            console.log(`⚠️ رصيد غير كافي: متوفر ${currentBalance.totalPoints}, مطلوب ${pointsToRedeem}`);
            return {
                success: false,
                error: 'رصيد النقاط غير كافي / Insufficient points balance',
                availablePoints: currentBalance.totalPoints || 0,
                requestedPoints: pointsToRedeem
            };
        }

        // التحقق من عدم الاستهلاك المتكرر - Prevent double spending
        if (orderId) {
            const existingRedemption = await checkExistingRedemption(orderId);
            if (existingRedemption) {
                console.log(`⚠️ تم استهلاك النقاط للطلب ${orderId} مسبقاً`);
                return {
                    success: false,
                    error: 'تم استهلاك النقاط لهذا الطلب مسبقاً / Points already redeemed for this order'
                };
            }
        }

        // حساب الرصيد الجديد - Calculate new balance
        const newTotalPoints = currentBalance.totalPoints - pointsToRedeem;
        const newLifetimeRedeemed = (currentBalance.lifetimePointsRedeemed || 0) + pointsToRedeem;
        
        // تحديد المستوى الجديد - Determine new tier
        const newTierLevel = calculateTierLevel(newTotalPoints);
        const newVipStatus = newTotalPoints >= POINTS_CONFIG.VIP_THRESHOLD;

        // معرف المعاملة - Transaction ID
        const transactionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date().toISOString();

        // معاملة آمنة للاستهلاك - Secure redemption transaction
        await dynamoDB.send(new TransactWriteCommand({
            TransactItems: [
                {
                    // تحديث رصيد العميل - Update customer balance
                    Put: {
                        TableName: CUSTOMER_POINTS_TABLE,
                        Item: {
                            ...currentBalance,
                            totalPoints: newTotalPoints,
                            lifetimePointsRedeemed: newLifetimeRedeemed,
                            vipStatus: newVipStatus,
                            tierLevel: newTierLevel,
                            lastRedeemedDate: now,
                            updatedAt: now
                        },
                        ConditionExpression: 'attribute_exists(customerId)' // التأكد من وجود العميل
                    }
                },
                {
                    // إضافة سجل الاستهلاك - Add redemption record
                    Put: {
                        TableName: POINTS_TRANSACTIONS_TABLE,
                        Item: {
                            customerId,
                            transactionId,
                            orderId: orderId || null,
                            transactionType: 'redeemed',
                            pointsAmount: -pointsToRedeem, // سالب للاستهلاك
                            orderAmount: 0,
                            actualAmountPaid: pointsToRedeem, // المبلغ المخصوم
                            paymentMethod: 'points',
                            description: description || `استهلاك ${pointsToRedeem} نقطة / Redeemed ${pointsToRedeem} points`,
                            timestamp: now,
                            metadata: {
                                previousBalance: currentBalance.totalPoints,
                                newBalance: newTotalPoints,
                                previousTier: currentBalance.tierLevel,
                                newTier: newTierLevel
                            }
                        }
                    }
                }
            ]
        }));

        console.log(`✅ تم استهلاك ${pointsToRedeem} نقطة للعميل ${customerId}`);
        console.log(`✅ Successfully redeemed ${pointsToRedeem} points for customer ${customerId}`);
        
        return {
            success: true,
            pointsRedeemed: pointsToRedeem,
            newTotalPoints,
            newTierLevel,
            newVipStatus,
            transactionId
        };

    } catch (error) {
        console.error(`❌ خطأ في استهلاك النقاط للعميل ${customerId}:`, error);
        console.error(`❌ Error redeeming points for customer ${customerId}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * جلب رصيد نقاط العميل
 * Get customer points balance
 */
async function getCustomerPointsBalance(customerId) {
    try {
        const result = await dynamoDB.send(new GetCommand({
            TableName: CUSTOMER_POINTS_TABLE,
            Key: { customerId }
        }));

        return result.Item || {
            customerId,
            totalPoints: 0,
            lifetimePointsEarned: 0,
            lifetimePointsRedeemed: 0,
            vipStatus: false,
            tierLevel: 'regular',
            lastEarnedDate: null,
            lastRedeemedDate: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

    } catch (error) {
        console.error(`❌ خطأ في جلب رصيد النقاط للعميل ${customerId}:`, error);
        return {
            customerId,
            totalPoints: 0,
            lifetimePointsEarned: 0,
            lifetimePointsRedeemed: 0,
            vipStatus: false,
            tierLevel: 'regular',
            lastEarnedDate: null,
            lastRedeemedDate: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }
}

/**
 * جلب تاريخ معاملات النقاط
 * Get customer points transaction history
 */
async function getPointsTransactionHistory(customerId, limit = 50) {
    try {
        const result = await dynamoDB.send(new QueryCommand({
            TableName: POINTS_TRANSACTIONS_TABLE,
            KeyConditionExpression: 'customerId = :customerId',
            ExpressionAttributeValues: {
                ':customerId': customerId
            },
            ScanIndexForward: false, // Most recent first
            Limit: limit
        }));

        return {
            success: true,
            transactions: result.Items || []
        };

    } catch (error) {
        console.error(`❌ خطأ في جلب تاريخ المعاملات للعميل ${customerId}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * دوال مساعدة - Helper Functions
 */

// جلب بيانات الطلب - Get order data
async function getOrderData(orderId) {
    try {
        // Try different possible key structures
        const keyFormats = [
            { PK: `ORDER#${orderId}`, SK: `ORDER#${orderId}` },
            { PK: `ORDER#${orderId}`, SK: `DETAILS` },
            { orderId: orderId },
            { id: orderId }
        ];

        for (const key of keyFormats) {
            try {
                const result = await dynamoDB.send(new GetCommand({
                    TableName: ORDERS_TABLE,
                    Key: key
                }));
                
                if (result.Item) {
                    return result.Item;
                }
            } catch (error) {
                // Continue to next key format
                continue;
            }
        }
        
        return null;
    } catch (error) {
        console.error(`خطأ في جلب بيانات الطلب ${orderId}:`, error);
        return null;
    }
}

// التحقق من وجود نقاط مكتسبة مسبقاً - Check existing earned points
async function checkExistingEarnedPoints(orderId) {
    try {
        const result = await dynamoDB.send(new QueryCommand({
            TableName: POINTS_TRANSACTIONS_TABLE,
            IndexName: 'OrderIndex',
            KeyConditionExpression: 'orderId = :orderId',
            FilterExpression: 'transactionType = :type',
            ExpressionAttributeValues: {
                ':orderId': orderId,
                ':type': 'earned'
            }
        }));
        return result.Items && result.Items.length > 0;
    } catch (error) {
        return false;
    }
}

// التحقق من وجود استهلاك مسبق - Check existing redemption
async function checkExistingRedemption(orderId) {
    try {
        const result = await dynamoDB.send(new QueryCommand({
            TableName: POINTS_TRANSACTIONS_TABLE,
            IndexName: 'OrderIndex',
            KeyConditionExpression: 'orderId = :orderId',
            FilterExpression: 'transactionType = :type',
            ExpressionAttributeValues: {
                ':orderId': orderId,
                ':type': 'redeemed'
            }
        }));
        return result.Items && result.Items.length > 0;
    } catch (error) {
        return false;
    }
}

// استخراج المبلغ المدفوع فعلياً - Extract actual payment amount
function extractActualPayment(order) {
    let actualAmountPaid = 0;

    if (order.paymentMethod === 'card' && order.cardPayment) {
        actualAmountPaid = order.cardPayment.amount || 0;
    } else if (order.paymentMethod === 'cash' && order.cashPayment) {
        actualAmountPaid = order.cashPayment.amount || 0;
    } else if (order.paymentMethod === 'zain_cash' && order.zainCashPayment) {
        actualAmountPaid = order.zainCashPayment.amount || 0;
    } else if (order.finalAmount) {
        actualAmountPaid = order.finalAmount;
    } else if (order.totalAmount) {
        actualAmountPaid = order.totalAmount;
    }

    return actualAmountPaid;
}

// حساب مستوى العميل - Calculate customer tier level
function calculateTierLevel(currentPoints) {
    if (currentPoints >= POINTS_CONFIG.TIER_THRESHOLDS.platinum) return 'platinum';
    if (currentPoints >= POINTS_CONFIG.TIER_THRESHOLDS.gold) return 'gold';
    if (currentPoints >= POINTS_CONFIG.TIER_THRESHOLDS.silver) return 'silver';
    return 'regular';
}

// إحصائيات النقاط الإجمالية - Get points statistics
async function getPointsStatistics() {
    try {
        // This would require a scan operation - implement if needed
        // For now, return placeholder data
        return {
            totalCustomersWithPoints: 0,
            totalPointsIssued: 0,
            totalPointsRedeemed: 0,
            vipCustomers: 0
        };
    } catch (error) {
        console.error('خطأ في جلب إحصائيات النقاط:', error);
        return {
            totalCustomersWithPoints: 0,
            totalPointsIssued: 0,
            totalPointsRedeemed: 0,
            vipCustomers: 0
        };
    }
}

module.exports = {
    awardPointsForOrder,
    redeemCustomerPoints,
    getCustomerPointsBalance,
    getPointsTransactionHistory,
    getPointsStatistics,
    CUSTOMER_POINTS_TABLE,
    POINTS_TRANSACTIONS_TABLE,
    POINTS_CONFIG
};
