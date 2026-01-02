/**
 * Driver Assignment Service
 * Automatically assigns drivers to orders when they become ready for pickup
 * Uses priority algorithms based on distance, rating, availability, and load balancing
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand, QueryCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");

// Initialize DynamoDB client
const dynamoDBClient = new DynamoDBClient({ region: "us-east-1" });
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

function requireEnv(name) {
    const value = process.env[name];
    if (!value || String(value).trim() === '') {
        throw new Error(`Missing required env var: ${name}`);
    }
    return value;
}

function assertNoDevEndpoint(value, name) {
    const stage = String(process.env.STAGE || process.env.NODE_ENV || 'staging');
    if (String(value).includes('/dev') && stage !== 'dev') {
        throw new Error(`Refusing to use dev value for ${name} in ${stage}: ${value}`);
    }
}

// Table names
const WEBSOCKET_CONNECTIONS_TABLE = requireEnv('WEBSOCKET_CONNECTIONS_TABLE');
const ORDERS_TABLE = requireEnv('ORDERS_TABLE');
const DRIVERS_TABLE = requireEnv('DRIVERS_TABLE');
const ASSIGNMENT_HISTORY_TABLE = requireEnv('ASSIGNMENT_HISTORY_TABLE');

// WebSocket endpoint
const WEBSOCKET_ENDPOINT = requireEnv('WEBSOCKET_ENDPOINT');
assertNoDevEndpoint(WEBSOCKET_ENDPOINT, 'WEBSOCKET_ENDPOINT');

// Driver assignment configuration
const ASSIGNMENT_CONFIG = {
    MAX_ASSIGNMENT_DISTANCE_KM: 15, // Maximum distance for assignment
    ASSIGNMENT_TIMEOUT_SECONDS: 30, // Time driver has to respond
    MAX_RETRY_ATTEMPTS: 3, // Maximum number of fallback attempts
    PRIORITY_WEIGHTS: {
        distance: 0.4,      // 40% weight for distance
        rating: 0.3,        // 30% weight for driver rating
        completion_rate: 0.2, // 20% weight for completion rate
        active_orders: 0.1  // 10% weight for current load
    }
};

// Global pending assignments tracker
const pendingAssignments = new Map();

/**
 * Main driver assignment function
 * Called when an order status changes to 'ready_for_pickup'
 */
async function assignDriverToOrder(orderId, orderData = null) {
    console.log(`🎯 Starting driver assignment for order: ${orderId}`);
    
    try {
        // Get order details if not provided
        const order = orderData || await getOrderDetails(orderId);
        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        // Check if order is eligible for assignment
        if (!isOrderEligibleForAssignment(order)) {
            console.log(`❌ Order ${orderId} is not eligible for driver assignment`);
            return { success: false, reason: 'Order not eligible for assignment' };
        }

        // Get available drivers
        const availableDrivers = await getAvailableDrivers(order);
        
        if (availableDrivers.length === 0) {
            console.log(`❌ No available drivers found for order ${orderId}`);
            await handleNoDriversAvailable(orderId, order);
            return { success: false, reason: 'No available drivers' };
        }

        // Calculate driver priorities and select best match
        const prioritizedDrivers = await calculateDriverPriorities(availableDrivers, order);
        
        // Attempt assignment with fallback mechanism
        const assignmentResult = await attemptDriverAssignment(orderId, order, prioritizedDrivers);
        
        return assignmentResult;

    } catch (error) {
        console.error(`❌ Error in driver assignment for order ${orderId}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Check if order is eligible for driver assignment
 */
function isOrderEligibleForAssignment(order) {
    const eligibleStatuses = ['ready_for_pickup', 'confirmed'];
    return eligibleStatuses.includes(order.status) && 
           !order.driverId && 
           !order.canceledAt &&
           order.deliveryAddress &&
           order.restaurantLocation;
}

/**
 * Get available drivers within service area
 */
async function getAvailableDrivers(order) {
    console.log(`🔍 Finding available drivers for order location...`);
    
    try {
        // Get all online driver connections
        const result = await dynamoDB.send(new ScanCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            FilterExpression: 'userType = :userType AND authenticated = :authenticated',
            ExpressionAttributeValues: {
                ':userType': 'driver',
                ':authenticated': true
            }
        }));

        const onlineConnections = result.Items || [];
        
        // Get detailed driver information
        const availableDrivers = [];
        
        for (const connection of onlineConnections) {
            try {
                const driverDetails = await getDriverDetails(connection.userId);
                if (driverDetails && isDriverAvailable(driverDetails, connection)) {
                    const distance = calculateDistance(
                        order.restaurantLocation.latitude,
                        order.restaurantLocation.longitude,
                        driverDetails.location?.latitude,
                        driverDetails.location?.longitude
                    );
                    
                    if (distance <= ASSIGNMENT_CONFIG.MAX_ASSIGNMENT_DISTANCE_KM) {
                        availableDrivers.push({
                            ...driverDetails,
                            connectionId: connection.connectionId,
                            distanceToRestaurant: distance,
                            lastSeen: connection.lastSeen
                        });
                    }
                }
            } catch (error) {
                console.warn(`⚠️ Error getting details for driver ${connection.userId}:`, error.message);
            }
        }

        console.log(`✅ Found ${availableDrivers.length} available drivers`);
        return availableDrivers;

    } catch (error) {
        console.error('❌ Error getting available drivers:', error);
        return [];
    }
}

/**
 * Check if driver is available for new assignments
 */
function isDriverAvailable(driver, connection) {
    // Check driver availability status (set by Flutter app)
    if (driver.availabilityStatus !== 'online' && driver.status !== 'online') return false;
    
    // Check if driver registration is approved
    if (driver.registrationStatus !== 'APPROVED' && driver.status !== 'APPROVED') return false;
    
    // Check if driver has too many active orders
    const maxActiveOrders = driver.vehicleType === 'motorcycle' ? 2 : 1;
    if (driver.activeOrdersCount >= maxActiveOrders) return false;
    
    // Check if connection is recent (within last 5 minutes)
    const lastSeenTime = new Date(connection.lastSeen || connection.connectedAt);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (lastSeenTime < fiveMinutesAgo) return false;
    
    return true;
}

/**
 * Calculate driver priorities based on multiple factors
 */
async function calculateDriverPriorities(drivers, order) {
    console.log(`📊 Calculating priorities for ${drivers.length} drivers`);
    
    const prioritizedDrivers = drivers.map(driver => {
        // Distance score (closer is better, normalized to 0-1)
        const maxDistance = ASSIGNMENT_CONFIG.MAX_ASSIGNMENT_DISTANCE_KM;
        const distanceScore = Math.max(0, (maxDistance - driver.distanceToRestaurant) / maxDistance);
        
        // Rating score (normalized to 0-1)
        const ratingScore = (driver.rating || 4.0) / 5.0;
        
        // Completion rate score
        const completionScore = (driver.completionRate || 0.95);
        
        // Active orders penalty (fewer active orders is better)
        const activeOrdersScore = Math.max(0, (2 - (driver.activeOrdersCount || 0)) / 2);
        
        // Calculate weighted priority score
        const priorityScore = 
            (distanceScore * ASSIGNMENT_CONFIG.PRIORITY_WEIGHTS.distance) +
            (ratingScore * ASSIGNMENT_CONFIG.PRIORITY_WEIGHTS.rating) +
            (completionScore * ASSIGNMENT_CONFIG.PRIORITY_WEIGHTS.completion_rate) +
            (activeOrdersScore * ASSIGNMENT_CONFIG.PRIORITY_WEIGHTS.active_orders);
        
        return {
            ...driver,
            priorityScore,
            distanceScore,
            ratingScore,
            completionScore,
            activeOrdersScore
        };
    });

    // Sort by priority score (highest first)
    prioritizedDrivers.sort((a, b) => b.priorityScore - a.priorityScore);
    
    console.log(`🏆 Top driver: ${prioritizedDrivers[0]?.name} (Score: ${prioritizedDrivers[0]?.priorityScore.toFixed(3)})`);
    
    return prioritizedDrivers;
}

/**
 * Attempt assignment with fallback mechanism
 */
async function attemptDriverAssignment(orderId, order, prioritizedDrivers) {
    console.log(`🎯 Attempting assignment for order ${orderId} with ${prioritizedDrivers.length} drivers`);
    
    for (let attempt = 0; attempt < ASSIGNMENT_CONFIG.MAX_RETRY_ATTEMPTS && attempt < prioritizedDrivers.length; attempt++) {
        const driver = prioritizedDrivers[attempt];
        
        console.log(`📞 Attempt ${attempt + 1}: Assigning to driver ${driver.name} (${driver.driverId})`);
        
        try {
            // Send assignment request to driver
            const assignmentResult = await sendAssignmentRequest(orderId, order, driver, attempt + 1, null);
            
            if (assignmentResult.success) {
                // Log successful assignment
                await logAssignmentHistory(orderId, driver.driverId, 'assigned', attempt + 1);
                
                console.log(`✅ Order ${orderId} successfully assigned to driver ${driver.name}`);
                return {
                    success: true,
                    driverId: driver.driverId,
                    driverName: driver.name,
                    driverPhone: driver.phone || driver.phoneNumber || null,
                    vehicleType: driver.vehicleType || null,
                    vehiclePlate: driver.vehiclePlate || driver.licenseNumber || null,
                    assignmentAttempt: attempt + 1,
                    estimatedPickupTime: assignmentResult.estimatedPickupTime
                };
            } else {
                // Log failed attempt
                await logAssignmentHistory(orderId, driver.driverId, 'declined', attempt + 1, assignmentResult.reason);
                console.log(`❌ Driver ${driver.name} declined assignment: ${assignmentResult.reason}`);
            }
        } catch (error) {
            console.error(`❌ Error assigning to driver ${driver.name}:`, error.message);
            await logAssignmentHistory(orderId, driver.driverId, 'error', attempt + 1, error.message);
        }
    }

    // All assignment attempts failed
    console.log(`❌ All assignment attempts failed for order ${orderId}`);
    await handleAssignmentFailure(orderId, order, prioritizedDrivers.length);
    
    return {
        success: false,
        reason: 'All drivers declined or unavailable',
        attemptsMade: Math.min(ASSIGNMENT_CONFIG.MAX_RETRY_ATTEMPTS, prioritizedDrivers.length)
    };
}

/**
 * Send assignment request to driver via WebSocket
 */
async function sendAssignmentRequest(orderId, order, driver, attemptNumber, apiGatewayClient = null) {
    // Create API Gateway client if not provided
    if (!apiGatewayClient) {
        apiGatewayClient = new ApiGatewayManagementApiClient({
            endpoint: WEBSOCKET_ENDPOINT
        });
    }

    // Calculate estimated delivery time and earnings
    const estimatedPickupTime = new Date(Date.now() + (driver.distanceToRestaurant * 3 + 10) * 60 * 1000); // 3 min per km + 10 min prep
    const estimatedDeliveryTime = new Date(estimatedPickupTime.getTime() + 30 * 60 * 1000); // +30 min delivery
    const estimatedEarnings = calculateDriverEarnings(order, driver.distanceToRestaurant);

    const assignmentMessage = {
        type: 'driver_assignment',
        action: 'order_assignment_request',
        data: {
            orderId: orderId,
            orderNumber: order.orderNumber || orderId,
            assignmentId: `${orderId}_${driver.driverId}_${Date.now()}`,
            attemptNumber,
            
            // Restaurant information
            restaurant: {
                name: order.storeName || order.restaurantName,
                address: order.storeAddress || order.restaurantAddress,
                location: order.restaurantLocation,
                phone: order.storePhone,
                preparationTime: order.estimatedPreparationTime || 15
            },
            
            // Customer information
            customer: {
                name: order.customerName,
                phone: order.customerPhone,
                address: order.deliveryAddress.street ? 
                    `${order.deliveryAddress.street}, ${order.deliveryAddress.city}` : 
                    order.deliveryAddress,
                location: order.deliveryLocation,
                notes: order.deliveryInstructions
            },
            
            // Order details
            order: {
                items: order.items || [],
                totalAmount: order.totalAmount,
                paymentMethod: order.paymentMethod,
                specialInstructions: order.deliveryInstructions,
                isPrePaid: order.paymentStatus === 'paid'
            },
            
            // Distance and timing
            distance: {
                toRestaurant: driver.distanceToRestaurant,
                toCustomer: calculateDistance(
                    order.restaurantLocation.latitude,
                    order.restaurantLocation.longitude,
                    order.deliveryLocation?.latitude || order.deliveryAddress.coordinates?.latitude,
                    order.deliveryLocation?.longitude || order.deliveryAddress.coordinates?.longitude
                ),
                total: driver.distanceToRestaurant + calculateDistance(
                    order.restaurantLocation.latitude,
                    order.restaurantLocation.longitude,
                    order.deliveryLocation?.latitude || order.deliveryAddress.coordinates?.latitude,
                    order.deliveryLocation?.longitude || order.deliveryAddress.coordinates?.longitude
                )
            },
            
            // Time estimates
            timing: {
                estimatedPickupTime: estimatedPickupTime.toISOString(),
                estimatedDeliveryTime: estimatedDeliveryTime.toISOString(),
                responseDeadline: new Date(Date.now() + ASSIGNMENT_CONFIG.ASSIGNMENT_TIMEOUT_SECONDS * 1000).toISOString()
            },
            
            // Earnings
            earnings: estimatedEarnings,
            
            // Assignment metadata
            priorityScore: driver.priorityScore,
            assignedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + ASSIGNMENT_CONFIG.ASSIGNMENT_TIMEOUT_SECONDS * 1000).toISOString()
        }
    };

    try {
        // Send to driver
        await apiGatewayClient.send(new PostToConnectionCommand({
            ConnectionId: driver.connectionId,
            Data: JSON.stringify(assignmentMessage)
        }));

        console.log(`📱 Assignment request sent to driver ${driver.name}`);

        // Wait for response with timeout
        const response = await waitForDriverResponse(orderId, driver.driverId, ASSIGNMENT_CONFIG.ASSIGNMENT_TIMEOUT_SECONDS);
        
        return response;

    } catch (error) {
        if (error.name === 'GoneException') {
            console.log(`🔌 Driver ${driver.name} disconnected, removing stale connection`);
            await removeStaleConnection(driver.connectionId);
            return { success: false, reason: 'Driver disconnected' };
        }
        throw error;
    }
}

/**
 * Wait for driver response with timeout
 */
async function waitForDriverResponse(orderId, driverId, timeoutSeconds) {
    const assignmentKey = `${orderId}_${driverId}`;
    
    return new Promise((resolve) => {
        // Set up timeout
        const timeout = setTimeout(() => {
            pendingAssignments.delete(assignmentKey);
            resolve({ success: false, reason: 'Response timeout' });
        }, timeoutSeconds * 1000);

        // Store the assignment with resolver
        pendingAssignments.set(assignmentKey, {
            orderId,
            driverId,
            resolve,
            timeout,
            createdAt: new Date().toISOString()
        });
    });
}

/**
 * Handle driver response (called from WebSocket handler)
 */
function handleDriverResponse(orderId, driverId, response, reason = null, estimatedPickupTime = null) {
    const assignmentKey = `${orderId}_${driverId}`;
    const assignment = pendingAssignments.get(assignmentKey);
    
    if (!assignment) {
        console.warn(`⚠️ No pending assignment found for ${assignmentKey}`);
        return false;
    }

    // Clear timeout and remove from pending
    clearTimeout(assignment.timeout);
    pendingAssignments.delete(assignmentKey);
    
    // Resolve with the response
    if (response === 'accept') {
        assignment.resolve({
            success: true,
            estimatedPickupTime: estimatedPickupTime || new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });
    } else {
        assignment.resolve({
            success: false,
            reason: reason || 'Driver declined'
        });
    }
    
    return true;
}

/**
 * Calculate driver earnings for the order
 */
function calculateDriverEarnings(order, distanceKm) {
    const baseEarning = 5.00; // Base earning per order
    const perKmRate = 1.50; // Rate per kilometer
    const orderValueCommission = (order.totalAmount || 0) * 0.15; // 15% of order value
    
    const distanceEarning = distanceKm * perKmRate;
    const totalEarning = baseEarning + distanceEarning + orderValueCommission;
    
    return {
        base: baseEarning,
        distance: distanceEarning,
        commission: orderValueCommission,
        total: Math.round(totalEarning * 100) / 100,
        currency: 'USD'
    };
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
 * Get driver details from database
 */
async function getDriverDetails(driverId) {
    try {
        // Try different key patterns as WhizzDrivers_dev uses different schemas
        let result;
        
        // First try with userId (most common)
        try {
            result = await dynamoDB.send(new GetCommand({
                TableName: DRIVERS_TABLE,
                Key: { userId: driverId }
            }));
        } catch (error) {
            // If that fails, try with driverId
            try {
                result = await dynamoDB.send(new GetCommand({
                    TableName: DRIVERS_TABLE,
                    Key: { driverId: driverId }
                }));
            } catch (error2) {
                // Finally try with id
                result = await dynamoDB.send(new GetCommand({
                    TableName: DRIVERS_TABLE,
                    Key: { id: driverId }
                }));
            }
        }

        return result.Item;
    } catch (error) {
        console.error(`❌ Error getting driver details for ${driverId}:`, error);
        return null;
    }
}

/**
 * Handle case when no drivers are available
 */
async function handleNoDriversAvailable(orderId, order) {
    console.log(`🚫 No drivers available for order ${orderId}, implementing fallback strategy`);
    
    try {
        // Update order status to indicate driver shortage
        await dynamoDB.send(new UpdateCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            },
            UpdateExpression: 'SET #status = :status, driverSearchStarted = :searchStarted, lastDriverSearch = :lastSearch',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'searching_for_driver',
                ':searchStarted': new Date().toISOString(),
                ':lastSearch': new Date().toISOString()
            }
        }));

        // Notify merchant about delay
        await notifyMerchantAboutDriverDelay(orderId, order);
        
        // Schedule retry in 2 minutes
        setTimeout(() => {
            assignDriverToOrder(orderId, order);
        }, 2 * 60 * 1000);

    } catch (error) {
        console.error(`❌ Error handling no drivers available for order ${orderId}:`, error);
    }
}

/**
 * Handle assignment failure after all attempts
 */
async function handleAssignmentFailure(orderId, order, driversContacted) {
    console.log(`❌ Assignment failed for order ${orderId} after contacting ${driversContacted} drivers`);
    
    try {
        // Update order status
        await dynamoDB.send(new UpdateCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            },
            UpdateExpression: 'SET #status = :status, assignmentFailedAt = :failedAt, driversContacted = :contacted',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'assignment_failed',
                ':failedAt': new Date().toISOString(),
                ':contacted': driversContacted
            }
        }));

        // Notify merchant and customer
        await notifyStakeholdersAboutAssignmentFailure(orderId, order);

    } catch (error) {
        console.error(`❌ Error handling assignment failure for order ${orderId}:`, error);
    }
}

/**
 * Log assignment history for analytics
 */
async function logAssignmentHistory(orderId, driverId, result, attemptNumber, reason = null) {
    try {
        const historyRecord = {
            PK: `ORDER#${orderId}`,
            SK: `ATTEMPT#${attemptNumber}#${Date.now()}`,
            orderId,
            driverId,
            result, // 'assigned', 'declined', 'timeout', 'error'
            attemptNumber,
            reason,
            timestamp: new Date().toISOString()
        };

        await dynamoDB.send(new UpdateCommand({
            TableName: ASSIGNMENT_HISTORY_TABLE,
            Key: {
                PK: historyRecord.PK,
                SK: historyRecord.SK
            },
            UpdateExpression: 'SET orderId = :orderId, driverId = :driverId, #result = :result, attemptNumber = :attempt, reason = :reason, #timestamp = :timestamp',
            ExpressionAttributeNames: {
                '#result': 'result',
                '#timestamp': 'timestamp'
            },
            ExpressionAttributeValues: {
                ':orderId': orderId,
                ':driverId': driverId,
                ':result': result,
                ':attempt': attemptNumber,
                ':reason': reason,
                ':timestamp': historyRecord.timestamp
            },
            ConditionExpression: 'attribute_not_exists(PK)'
        }));

    } catch (error) {
        console.warn(`⚠️ Error logging assignment history: ${error.message}`);
    }
}

/**
 * Calculate distance between two points using Haversine formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999; // Return large distance if coordinates missing
    
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    
    return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

/**
 * Remove stale WebSocket connection
 */
async function removeStaleConnection(connectionId) {
    try {
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET #status = :status, disconnectedAt = :disconnectedAt',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'disconnected',
                ':disconnectedAt': new Date().toISOString()
            }
        }));
    } catch (error) {
        console.warn(`⚠️ Error removing stale connection ${connectionId}:`, error.message);
    }
}

/**
 * Notify merchant about driver delay
 */
async function notifyMerchantAboutDriverDelay(orderId, order) {
    // Implementation for merchant notification
    console.log(`📧 Notifying merchant about driver delay for order ${orderId}`);
}

/**
 * Notify stakeholders about assignment failure
 */
async function notifyStakeholdersAboutAssignmentFailure(orderId, order) {
    // Implementation for stakeholder notifications
    console.log(`📧 Notifying stakeholders about assignment failure for order ${orderId}`);
}

/**
 * Get assignment analytics
 */
async function getAssignmentAnalytics(timeRange = '24h') {
    try {
        const hoursBack = timeRange === '24h' ? 24 : timeRange === '7d' ? 168 : 24;
        const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
        
        const result = await dynamoDB.send(new ScanCommand({
            TableName: ASSIGNMENT_HISTORY_TABLE,
            FilterExpression: '#timestamp > :since',
            ExpressionAttributeNames: {
                '#timestamp': 'timestamp'
            },
            ExpressionAttributeValues: {
                ':since': since
            }
        }));

        const assignments = result.Items || [];
        
        return {
            totalAssignments: assignments.length,
            successfulAssignments: assignments.filter(a => a.result === 'assigned').length,
            declinedAssignments: assignments.filter(a => a.result === 'declined').length,
            timeoutAssignments: assignments.filter(a => a.result === 'timeout').length,
            errorAssignments: assignments.filter(a => a.result === 'error').length,
            averageAttemptsPerOrder: assignments.length > 0 ? 
                assignments.reduce((sum, a) => sum + a.attemptNumber, 0) / assignments.length : 0,
            timeRange: timeRange
        };

    } catch (error) {
        console.error('❌ Error getting assignment analytics:', error);
        return null;
    }
}

module.exports = {
    assignDriverToOrder,
    handleDriverResponse,
    getAssignmentAnalytics,
    calculateDistance,
    ASSIGNMENT_CONFIG
};
