/**
 * WebSocket Handler for Driver Assignment System
 * Handles real-time communication for driver assignments
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const { assignDriverToOrder } = require('./driver-assignment-service');

// Initialize DynamoDB client
const dynamoDBClient = new DynamoDBClient({ region: "us-east-1" });
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

// Table names
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE || 'WizzUser_websocket_connections_dev';
const ORDERS_TABLE = process.env.ORDERS_TABLE || 'WizzOrders';
const DRIVERS_TABLE = process.env.DRIVERS_TABLE || 'WhizzDrivers_dev';

/**
 * Helper function to update driver record with proper key handling
 */
async function updateDriverRecord(driverId, updateExpression, expressionAttributeNames, expressionAttributeValues) {
    // Try different key patterns as WhizzDrivers_dev uses different schemas
    const keyPatterns = [
        { userId: driverId },
        { driverId: driverId },
        { id: driverId }
    ];
    
    for (const key of keyPatterns) {
        try {
            await dynamoDB.send(new UpdateCommand({
                TableName: DRIVERS_TABLE,
                Key: key,
                UpdateExpression: updateExpression,
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues
            }));
            return; // Success, exit
        } catch (error) {
            if (error.name === 'ValidationException' && keyPatterns.indexOf(key) < keyPatterns.length - 1) {
                continue; // Try next key pattern
            }
            throw error; // Re-throw if last attempt or different error
        }
    }
}

/**
 * Handle driver assignment response
 */
async function handleDriverAssignmentResponse(connectionId, message, apiGatewayClient) {
    console.log(`📞 Driver assignment response received from ${connectionId}`);
    
    try {
        const { orderId, assignmentId, response, reason, estimatedPickupTime } = message;
        
        if (!orderId || !assignmentId || !response) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Missing required fields: orderId, assignmentId, response'
            }, apiGatewayClient);
        }

        // Get driver info from connection
        const connection = await getConnection(connectionId);
        if (!connection) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Driver connection not found'
            }, apiGatewayClient);
        }

        const driverId = connection.userId;
        console.log(`📋 Processing ${response} response from driver ${driverId} for order ${orderId}`);

        if (response === 'accept') {
            await handleDriverAcceptance(orderId, driverId, estimatedPickupTime, apiGatewayClient);
        } else if (response === 'decline') {
            await handleDriverDecline(orderId, driverId, reason, apiGatewayClient);
        } else {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Invalid response. Must be "accept" or "decline"'
            }, apiGatewayClient);
        }

        // Send confirmation to driver
        await sendToConnection(connectionId, {
            type: 'assignment_response_confirmed',
            orderId,
            assignmentId,
            response,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);

    } catch (error) {
        console.error('❌ Error handling assignment response:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to process assignment response'
        }, apiGatewayClient);
    }
}

/**
 * Handle driver acceptance of assignment
 */
async function handleDriverAcceptance(orderId, driverId, estimatedPickupTime, apiGatewayClient) {
    console.log(`✅ Driver ${driverId} accepted order ${orderId}`);
    
    try {
        // Update order with driver assignment
        const updateResult = await dynamoDB.send(new UpdateCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            },
            UpdateExpression: `
                SET driverId = :driverId, 
                    #status = :status, 
                    assignedAt = :assignedAt,
                    estimatedPickupTime = :estimatedPickupTime,
                    updatedAt = :updatedAt
            `,
            ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(driverId)',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':driverId': driverId,
                ':status': 'assigned_to_driver',
                ':assignedAt': new Date().toISOString(),
                ':estimatedPickupTime': estimatedPickupTime || new Date(Date.now() + 20 * 60 * 1000).toISOString(),
                ':updatedAt': new Date().toISOString()
            },
            ReturnValues: 'ALL_NEW'
        }));

        const updatedOrder = updateResult.Attributes;

        // Update driver's active orders count
        await updateDriverActiveOrders(driverId, 1);

        // Notify all stakeholders
        await notifyStakeholdersOfAssignment(updatedOrder, driverId, apiGatewayClient);

        console.log(`🎯 Order ${orderId} successfully assigned to driver ${driverId}`);

    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            console.log(`⚠️ Order ${orderId} already assigned to another driver`);
            
            // Notify driver that order was already taken
            const driverConnection = await getDriverConnection(driverId);
            if (driverConnection) {
                await sendToConnection(driverConnection.connectionId, {
                    type: 'assignment_already_taken',
                    orderId,
                    message: 'This order has already been assigned to another driver',
                    timestamp: new Date().toISOString()
                }, apiGatewayClient);
            }
        } else {
            console.error(`❌ Error processing driver acceptance for order ${orderId}:`, error);
            throw error;
        }
    }
}

/**
 * Handle driver decline of assignment
 */
async function handleDriverDecline(orderId, driverId, reason, apiGatewayClient) {
    console.log(`❌ Driver ${driverId} declined order ${orderId}: ${reason}`);
    
    // Log the decline reason for analytics
    await logDriverDecline(orderId, driverId, reason);
    
    // Continue assignment process with next available driver
    await assignDriverToOrder(orderId);
}

/**
 * Handle driver location update
 */
async function handleDriverLocationUpdate(connectionId, message, apiGatewayClient) {
    try {
        const { latitude, longitude, accuracy, timestamp } = message;
        
        if (!latitude || !longitude) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Location coordinates required'
            }, apiGatewayClient);
        }

        const connection = await getConnection(connectionId);
        if (!connection) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Connection not found'
            }, apiGatewayClient);
        }

        const driverId = connection.userId;

        // Update driver location in database
        await updateDriverRecord(driverId, 
            `SET #location = :location,
                lastLocationUpdate = :timestamp,
                updatedAt = :updatedAt`,
            {
                '#location': 'location'
            },
            {
                ':location': {
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude),
                    accuracy: accuracy || null
                },
                ':timestamp': timestamp || new Date().toISOString(),
                ':updatedAt': new Date().toISOString()
            }
        );

        // Update connection last seen
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET lastSeen = :lastSeen',
            ExpressionAttributeValues: {
                ':lastSeen': new Date().toISOString()
            }
        }));

        console.log(`📍 Location updated for driver ${driverId}: ${latitude}, ${longitude}`);

        // Send confirmation
        await sendToConnection(connectionId, {
            type: 'location_update_confirmed',
            timestamp: new Date().toISOString()
        }, apiGatewayClient);

    } catch (error) {
        console.error('❌ Error handling location update:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to update location'
        }, apiGatewayClient);
    }
}

/**
 * Handle driver status change
 */
async function handleDriverStatusChange(connectionId, message, apiGatewayClient) {
    try {
        const { status, reason } = message;
        
        const validStatuses = ['online', 'offline', 'busy', 'break'];
        if (!validStatuses.includes(status)) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: `Invalid status. Valid statuses: ${validStatuses.join(', ')}`
            }, apiGatewayClient);
        }

        const connection = await getConnection(connectionId);
        if (!connection) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Connection not found'
            }, apiGatewayClient);
        }

        const driverId = connection.userId;

        // Update driver status (both status and availabilityStatus for compatibility)
        await updateDriverRecord(driverId,
            `SET #status = :status,
                availabilityStatus = :status,
                statusChangedAt = :timestamp,
                statusReason = :reason,
                updatedAt = :updatedAt`,
            {
                '#status': 'status'
            },
            {
                ':status': status,
                ':timestamp': new Date().toISOString(),
                ':reason': reason || null,
                ':updatedAt': new Date().toISOString()
            }
        );

        // Update connection status
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET #status = :status, lastSeen = :lastSeen',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': status === 'online' ? 'online' : 'offline',
                ':lastSeen': new Date().toISOString()
            }
        }));

        console.log(`🔄 Driver ${driverId} status changed to: ${status}`);

        // Send confirmation
        await sendToConnection(connectionId, {
            type: 'status_change_confirmed',
            status,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);

    } catch (error) {
        console.error('❌ Error handling status change:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to update status'
        }, apiGatewayClient);
    }
}

/**
 * Handle order status update from driver
 */
async function handleOrderStatusUpdate(connectionId, message, apiGatewayClient) {
    try {
        const { orderId, status, location, notes, timestamp } = message;
        
        if (!orderId || !status) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'orderId and status are required'
            }, apiGatewayClient);
        }

        const connection = await getConnection(connectionId);
        if (!connection) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Connection not found'
            }, apiGatewayClient);
        }

        const driverId = connection.userId;

        // Verify driver is assigned to this order
        const order = await getOrder(orderId);
        if (!order || order.driverId !== driverId) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'You are not assigned to this order'
            }, apiGatewayClient);
        }

        // Update order status
        const updateExpression = 'SET #status = :status, updatedAt = :updatedAt';
        const expressionAttributeNames = { '#status': 'status' };
        const expressionAttributeValues = {
            ':status': status,
            ':updatedAt': new Date().toISOString()
        };

        // Add status-specific updates
        if (status === 'picked_up') {
            updateExpression += ', pickedUpAt = :pickedUpAt';
            expressionAttributeValues[':pickedUpAt'] = timestamp || new Date().toISOString();
        } else if (status === 'delivered') {
            updateExpression += ', deliveredAt = :deliveredAt';
            expressionAttributeValues[':deliveredAt'] = timestamp || new Date().toISOString();
            
            // Decrease driver's active orders count
            await updateDriverActiveOrders(driverId, -1);
        }

        if (location) {
            updateExpression += ', lastKnownLocation = :location';
            expressionAttributeValues[':location'] = location;
        }

        if (notes) {
            updateExpression += ', driverNotes = :notes';
            expressionAttributeValues[':notes'] = notes;
        }

        await dynamoDB.send(new UpdateCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        }));

        console.log(`📦 Order ${orderId} status updated to: ${status} by driver ${driverId}`);

        // Notify stakeholders of status update
        await notifyStakeholdersOfStatusUpdate(orderId, status, driverId, apiGatewayClient);

        // Send confirmation to driver
        await sendToConnection(connectionId, {
            type: 'order_status_update_confirmed',
            orderId,
            status,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);

    } catch (error) {
        console.error('❌ Error handling order status update:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to update order status'
        }, apiGatewayClient);
    }
}

/**
 * Get connection details
 */
async function getConnection(connectionId) {
    try {
        const result = await dynamoDB.send(new GetCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        return result.Item;
    } catch (error) {
        console.error(`❌ Error getting connection ${connectionId}:`, error);
        return null;
    }
}

/**
 * Get driver connection
 */
async function getDriverConnection(driverId) {
    try {
        const result = await dynamoDB.send(new QueryCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            IndexName: 'UserIdIndex',
            KeyConditionExpression: 'userId = :userId',
            FilterExpression: 'userType = :userType AND #status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':userId': driverId,
                ':userType': 'driver',
                ':status': 'online'
            },
            Limit: 1
        }));
        
        return result.Items && result.Items.length > 0 ? result.Items[0] : null;
    } catch (error) {
        console.error(`❌ Error getting driver connection for ${driverId}:`, error);
        return null;
    }
}

/**
 * Get order details
 */
async function getOrder(orderId) {
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
        console.error(`❌ Error getting order ${orderId}:`, error);
        return null;
    }
}

/**
 * Update driver active orders count
 */
async function updateDriverActiveOrders(driverId, increment) {
    try {
        await updateDriverRecord(driverId,
            'ADD activeOrdersCount :increment SET updatedAt = :updatedAt',
            {},
            {
                ':increment': increment,
                ':updatedAt': new Date().toISOString()
            }
        );
    } catch (error) {
        console.error(`❌ Error updating active orders count for driver ${driverId}:`, error);
    }
}

/**
 * Log driver decline for analytics
 */
async function logDriverDecline(orderId, driverId, reason) {
    // Implementation for logging decline reasons
    console.log(`📊 Logging decline: Driver ${driverId} declined order ${orderId} - Reason: ${reason}`);
}

/**
 * Notify stakeholders of successful assignment
 */
async function notifyStakeholdersOfAssignment(order, driverId, apiGatewayClient) {
    // Implementation for notifying merchant, customer, and admin dashboard
    console.log(`📧 Notifying stakeholders of assignment: Order ${order.orderId} assigned to driver ${driverId}`);
    
    // Notify merchant
    await notifyMerchantOfAssignment(order, driverId, apiGatewayClient);
    
    // Notify customer
    await notifyCustomerOfAssignment(order, driverId, apiGatewayClient);
    
    // Notify admin dashboard
    await notifyAdminDashboard(order, driverId, apiGatewayClient);
}

/**
 * Notify stakeholders of status updates
 */
async function notifyStakeholdersOfStatusUpdate(orderId, status, driverId, apiGatewayClient) {
    console.log(`📧 Notifying stakeholders of status update: Order ${orderId} - ${status}`);
    // Implementation for status update notifications
}

/**
 * Notify merchant of driver assignment
 */
async function notifyMerchantOfAssignment(order, driverId, apiGatewayClient) {
    // Implementation for merchant notification
}

/**
 * Notify customer of driver assignment
 */
async function notifyCustomerOfAssignment(order, driverId, apiGatewayClient) {
    // Implementation for customer notification
}

/**
 * Notify admin dashboard
 */
async function notifyAdminDashboard(order, driverId, apiGatewayClient) {
    // Implementation for admin dashboard notification
}

/**
 * Send message to WebSocket connection
 */
async function sendToConnection(connectionId, message, apiGatewayClient) {
    try {
        await apiGatewayClient.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(message)
        }));
        return true;
    } catch (error) {
        if (error.name === 'GoneException') {
            console.log(`🔌 Connection ${connectionId} is stale, removing...`);
            // Remove stale connection
            await dynamoDB.send(new UpdateCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                Key: { connectionId },
                UpdateExpression: 'SET #status = :status',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':status': 'disconnected' }
            }));
        } else {
            console.error(`❌ Error sending message to ${connectionId}:`, error);
        }
        return false;
    }
}

module.exports = {
    handleDriverAssignmentResponse,
    handleDriverLocationUpdate,
    handleDriverStatusChange,
    handleOrderStatusUpdate,
    sendToConnection
};
