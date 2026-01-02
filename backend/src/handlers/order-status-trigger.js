/**
 * Order Status Trigger Handler
 * Automatically triggers driver assignment when order status changes to 'ready_for_pickup'
 * This function is typically called by DynamoDB streams or order update APIs
 */

const { assignDriverToOrder } = require('../services/driver-assignment-service');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

// Initialize DynamoDB client
const dynamoDBClient = new DynamoDBClient({ region: "us-east-1" });
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

const ORDERS_TABLE = process.env.ORDERS_TABLE || 'WizzUser_orders_dev';

/**
 * Lambda handler for order status changes
 */
exports.handler = async (event) => {
    console.log('📋 Order status trigger received:', JSON.stringify(event, null, 2));
    
    try {
        let processedRecords = 0;
        let errors = [];

        // Handle different event sources
        if (event.Records) {
            // DynamoDB Stream event
            for (const record of event.Records) {
                try {
                    await processDynamoDBRecord(record);
                    processedRecords++;
                } catch (error) {
                    console.error('❌ Error processing DynamoDB record:', error);
                    errors.push({
                        recordId: record.eventID,
                        error: error.message
                    });
                }
            }
        } else if (event.orderId && event.newStatus) {
            // Direct API call
            try {
                await processOrderStatusChange(event.orderId, event.newStatus, event.orderData);
                processedRecords++;
            } catch (error) {
                console.error('❌ Error processing direct order status change:', error);
                errors.push({
                    orderId: event.orderId,
                    error: error.message
                });
            }
        } else {
            throw new Error('Invalid event format');
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                processedRecords,
                errors: errors.length > 0 ? errors : undefined
            })
        };

    } catch (error) {
        console.error('❌ Handler error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};

/**
 * Process DynamoDB stream record
 */
async function processDynamoDBRecord(record) {
    console.log(`🔄 Processing DynamoDB record: ${record.eventName}`);
    
    if (record.eventName !== 'MODIFY') {
        console.log('📋 Skipping non-modify event');
        return;
    }

    const newImage = record.dynamodb.NewImage;
    const oldImage = record.dynamodb.OldImage;

    if (!newImage || !oldImage) {
        console.log('📋 Skipping record without proper images');
        return;
    }

    // Extract order data
    const orderId = newImage.orderId?.S || newImage.PK?.S?.replace('ORDER#', '');
    const newStatus = newImage.status?.S;
    const oldStatus = oldImage.status?.S;

    if (!orderId || !newStatus || newStatus === oldStatus) {
        console.log('📋 No relevant status change detected');
        return;
    }

    console.log(`🔄 Order ${orderId} status changed: ${oldStatus} → ${newStatus}`);

    // Convert DynamoDB item to regular object
    const orderData = unmarshallDynamoDBItem(newImage);
    
    await processOrderStatusChange(orderId, newStatus, orderData);
}

/**
 * Process order status change and trigger appropriate actions
 */
async function processOrderStatusChange(orderId, newStatus, orderData = null) {
    console.log(`🎯 Processing status change for order ${orderId}: ${newStatus}`);

    try {
        // Get full order data if not provided
        const order = orderData || await getOrderDetails(orderId);
        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        // Handle different status changes
        switch (newStatus) {
            case 'ready_for_pickup':
                await handleReadyForPickup(orderId, order);
                break;
                
            case 'confirmed':
                await handleOrderConfirmed(orderId, order);
                break;
                
            case 'preparing':
                await handleOrderPreparing(orderId, order);
                break;
                
            case 'cancelled':
                await handleOrderCancelled(orderId, order);
                break;
                
            case 'delivered':
                await handleOrderDelivered(orderId, order);
                break;
                
            default:
                console.log(`📋 No specific action for status: ${newStatus}`);
        }

    } catch (error) {
        console.error(`❌ Error processing status change for order ${orderId}:`, error);
        throw error;
    }
}

/**
 * Handle order ready for pickup - trigger driver assignment
 */
async function handleReadyForPickup(orderId, order) {
    console.log(`🚚 Order ${orderId} is ready for pickup - triggering driver assignment`);
    
    try {
        // Check if order already has a driver assigned
        if (order.driverId) {
            console.log(`📋 Order ${orderId} already has driver ${order.driverId} assigned`);
            return;
        }

        // Start driver assignment process
        const assignmentResult = await assignDriverToOrder(orderId, order);
        
        if (assignmentResult.success) {
            console.log(`✅ Driver assignment initiated for order ${orderId}`);
            
            // Update order with assignment attempt info
            await updateOrderAssignmentInfo(orderId, {
                assignmentStarted: true,
                assignmentInitiatedAt: new Date().toISOString(),
                lastAssignmentAttempt: new Date().toISOString()
            });
            
        } else {
            console.log(`❌ Driver assignment failed for order ${orderId}: ${assignmentResult.reason}`);
            
            // Update order status to indicate assignment issues
            await updateOrderStatus(orderId, 'searching_for_driver', {
                assignmentFailureReason: assignmentResult.reason,
                lastAssignmentAttempt: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error(`❌ Error handling ready for pickup for order ${orderId}:`, error);
        
        // Update order with error info
        await updateOrderAssignmentInfo(orderId, {
            assignmentError: error.message,
            lastAssignmentAttempt: new Date().toISOString()
        });
        
        throw error;
    }
}

/**
 * Handle order confirmed - prepare for assignment
 */
async function handleOrderConfirmed(orderId, order) {
    console.log(`✅ Order ${orderId} confirmed - preparing for driver assignment`);
    
    try {
        // Pre-validate order for driver assignment
        const validationResult = validateOrderForAssignment(order);
        
        if (!validationResult.valid) {
            console.log(`⚠️ Order ${orderId} failed pre-assignment validation: ${validationResult.reason}`);
            
            // Update order with validation issues
            await updateOrderAssignmentInfo(orderId, {
                validationFailed: true,
                validationFailureReason: validationResult.reason,
                validatedAt: new Date().toISOString()
            });
            
            return;
        }

        // Update order as validated and ready for assignment when pickup is ready
        await updateOrderAssignmentInfo(orderId, {
            validatedForAssignment: true,
            validatedAt: new Date().toISOString(),
            estimatedReadyTime: calculateEstimatedReadyTime(order)
        });

        console.log(`✅ Order ${orderId} validated and ready for future assignment`);

    } catch (error) {
        console.error(`❌ Error handling order confirmation for ${orderId}:`, error);
    }
}

/**
 * Handle order preparing - update estimated ready time
 */
async function handleOrderPreparing(orderId, order) {
    console.log(`👨‍🍳 Order ${orderId} is being prepared`);
    
    try {
        const estimatedReadyTime = calculateEstimatedReadyTime(order);
        
        await updateOrderAssignmentInfo(orderId, {
            preparationStarted: true,
            preparationStartedAt: new Date().toISOString(),
            estimatedReadyTime: estimatedReadyTime
        });

        // Schedule driver assignment for estimated ready time minus buffer
        const assignmentTime = new Date(new Date(estimatedReadyTime).getTime() - 5 * 60 * 1000); // 5 minutes before ready
        
        if (assignmentTime > new Date()) {
            console.log(`⏰ Will start driver search at ${assignmentTime.toISOString()} for order ${orderId}`);
            // In production, this would use a scheduler like EventBridge or SQS delay
        }

    } catch (error) {
        console.error(`❌ Error handling order preparing for ${orderId}:`, error);
    }
}

/**
 * Handle order cancelled - clean up any assignments
 */
async function handleOrderCancelled(orderId, order) {
    console.log(`❌ Order ${orderId} cancelled - cleaning up assignments`);
    
    try {
        if (order.driverId) {
            // Notify assigned driver of cancellation
            await notifyDriverOfCancellation(order.driverId, orderId);
            
            // Update driver's active order count
            await updateDriverActiveOrders(order.driverId, -1);
        }

        await updateOrderAssignmentInfo(orderId, {
            cancelledAt: new Date().toISOString(),
            assignmentCleaned: true
        });

    } catch (error) {
        console.error(`❌ Error handling order cancellation for ${orderId}:`, error);
    }
}

/**
 * Handle order delivered - complete assignment
 */
async function handleOrderDelivered(orderId, order) {
    console.log(`📦 Order ${orderId} delivered - completing assignment`);
    
    try {
        if (order.driverId) {
            // Update driver statistics
            await updateDriverStats(order.driverId, {
                completedOrders: 1,
                totalEarnings: order.driverEarnings || 0,
                lastDelivery: new Date().toISOString()
            });
        }

        await updateOrderAssignmentInfo(orderId, {
            assignmentCompleted: true,
            completedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ Error handling order delivery for ${orderId}:`, error);
    }
}

/**
 * Validate order for driver assignment
 */
function validateOrderForAssignment(order) {
    // Check required fields
    if (!order.deliveryAddress) {
        return { valid: false, reason: 'Missing delivery address' };
    }

    if (!order.restaurantLocation && !order.storeLocation) {
        return { valid: false, reason: 'Missing restaurant location' };
    }

    if (!order.totalAmount || order.totalAmount <= 0) {
        return { valid: false, reason: 'Invalid order amount' };
    }

    if (!order.customerPhone) {
        return { valid: false, reason: 'Missing customer phone' };
    }

    // Check order value minimums
    const minimumOrderValue = 10.00; // $10 minimum
    if (order.totalAmount < minimumOrderValue) {
        return { valid: false, reason: `Order value below minimum (${minimumOrderValue})` };
    }

    return { valid: true };
}

/**
 * Calculate estimated ready time based on order details
 */
function calculateEstimatedReadyTime(order) {
    const now = new Date();
    const basePreparationTime = 20; // 20 minutes base
    
    // Add time based on order complexity
    const itemCount = order.items ? order.items.length : 1;
    const additionalTime = Math.min(itemCount * 2, 15); // Max 15 extra minutes
    
    const totalMinutes = basePreparationTime + additionalTime;
    
    return new Date(now.getTime() + totalMinutes * 60 * 1000).toISOString();
}

/**
 * Get order details from database
 */
async function getOrderDetails(orderId) {
    try {
        const result = await dynamoDB.send(new GetCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            }
        }));

        return result.Item;
    } catch (error) {
        console.error(`❌ Error getting order details for ${orderId}:`, error);
        return null;
    }
}

/**
 * Update order assignment information
 */
async function updateOrderAssignmentInfo(orderId, updates) {
    try {
        const updateExpressions = [];
        const expressionAttributeValues = {};
        
        Object.entries(updates).forEach(([key, value]) => {
            updateExpressions.push(`${key} = :${key}`);
            expressionAttributeValues[`:${key}`] = value;
        });

        updateExpressions.push('updatedAt = :updatedAt');
        expressionAttributeValues[':updatedAt'] = new Date().toISOString();

        await dynamoDB.send(new UpdateCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeValues: expressionAttributeValues
        }));

    } catch (error) {
        console.error(`❌ Error updating assignment info for order ${orderId}:`, error);
    }
}

/**
 * Update order status
 */
async function updateOrderStatus(orderId, newStatus, additionalUpdates = {}) {
    try {
        const updates = {
            status: newStatus,
            ...additionalUpdates
        };

        await updateOrderAssignmentInfo(orderId, updates);

    } catch (error) {
        console.error(`❌ Error updating status for order ${orderId}:`, error);
    }
}

/**
 * Notify driver of order cancellation
 */
async function notifyDriverOfCancellation(driverId, orderId) {
    // Implementation would send WebSocket message to driver
    console.log(`📱 Notifying driver ${driverId} of order ${orderId} cancellation`);
}

/**
 * Update driver active orders count
 */
async function updateDriverActiveOrders(driverId, increment) {
    // Implementation would update driver's active order count
    console.log(`📊 Updating driver ${driverId} active orders by ${increment}`);
}

/**
 * Update driver statistics
 */
async function updateDriverStats(driverId, updates) {
    // Implementation would update driver performance statistics
    console.log(`📊 Updating driver ${driverId} stats:`, updates);
}

/**
 * Convert DynamoDB item to regular object
 */
function unmarshallDynamoDBItem(dynamoItem) {
    const item = {};
    
    for (const [key, value] of Object.entries(dynamoItem)) {
        if (value.S) item[key] = value.S;
        else if (value.N) item[key] = parseFloat(value.N);
        else if (value.BOOL) item[key] = value.BOOL;
        else if (value.SS) item[key] = value.SS;
        else if (value.NS) item[key] = value.NS.map(n => parseFloat(n));
        else if (value.M) item[key] = unmarshallDynamoDBItem(value.M);
        else if (value.L) item[key] = value.L.map(item => unmarshallDynamoDBItem({ temp: item }).temp);
        // Add more types as needed
    }
    
    return item;
}

/**
 * Manual trigger function for testing
 */
exports.triggerAssignmentForOrder = async (orderId) => {
    console.log(`🧪 Manual trigger for order ${orderId}`);
    
    try {
        const order = await getOrderDetails(orderId);
        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        await handleReadyForPickup(orderId, order);
        
        return {
            success: true,
            message: `Driver assignment triggered for order ${orderId}`
        };

    } catch (error) {
        console.error(`❌ Manual trigger failed for order ${orderId}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
};

module.exports = {
    handler: exports.handler,
    triggerAssignmentForOrder: exports.triggerAssignmentForOrder,
    processOrderStatusChange
};
