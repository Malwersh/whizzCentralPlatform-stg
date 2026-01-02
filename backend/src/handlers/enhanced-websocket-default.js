/**
 * Enhanced WebSocket Default Handler
 * Extends existing functionality with chat support
 * Compatible with existing WizzUser WebSocket API
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

// Initialize DynamoDB client
const dynamoDB = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

// Table names - fallback to default if not set
const CHAT_SESSIONS_TABLE = process.env.CHAT_SESSIONS_TABLE || 'ChatSessions';
const CHAT_MESSAGES_TABLE = process.env.CHAT_MESSAGES_TABLE || 'ChatMessages';
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE || 'WebSocketConnections';

/**
 * Main handler for WebSocket messages
 */
exports.handler = async (event) => {
    console.log('📨 Enhanced WebSocket handler:', JSON.stringify(event, null, 2));
    
    const { requestContext, body } = event;
    const { connectionId, stage, domainName, routeKey } = requestContext;
    
    // Create API Gateway Management API client
    const apiGatewayClient = new ApiGatewayManagementApiClient({
        endpoint: `https://${domainName}/${stage}`
    });

    // Handle connection events (no body)
    if (routeKey === '$connect') {
        console.log(`🔌 New connection: ${connectionId}`);
        return { statusCode: 200 };
    }
    
    if (routeKey === '$disconnect') {
        console.log(`🔌 Disconnection: ${connectionId}`);
        // Clean up connection record
        try {
            await dynamoDB.send(new DeleteCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                Key: { connectionId }
            }));
        } catch (error) {
            console.warn('⚠️ Failed to clean up connection:', error);
        }
        return { statusCode: 200 };
    }

    let message = {};
    try {
        if (body) {
            message = JSON.parse(body);
        }
    } catch (error) {
        console.warn('⚠️ Failed to parse message body:', error);
        return { statusCode: 400 };
    }

    const action = message.action || message.type || routeKey || 'unknown';
    console.log(`🎯 Processing action: ${action}`);

    try {
        switch (action) {
            // Chat-specific actions
            case 'join_channel':
                return await handleJoinChannel(connectionId, message, apiGatewayClient);
            case 'chat_init':
                return await handleChatInit(connectionId, message, apiGatewayClient);
            case 'chat_message':
                return await handleChatMessage(connectionId, message, apiGatewayClient);
            case 'close_session':
                return await handleCloseSession(connectionId, message, apiGatewayClient);
            case 'ping':
                return await handlePing(connectionId, apiGatewayClient);
            case 'driver_status_update':
                return await handleDriverStatusUpdate(connectionId, message, apiGatewayClient);
            
            // Existing actions - pass through or handle minimally
            case 'heartbeat':
                return await handleHeartbeat(connectionId, apiGatewayClient);
            case 'subscribe_order':
            case 'unsubscribe_order':
            case 'subscribe_business_status':
            case 'unsubscribe_business_status':
                console.log(`📦 Legacy action: ${action} - acknowledging`);
                return await sendToConnection(connectionId, {
                    action: 'ack',
                    originalAction: action,
                    timestamp: new Date().toISOString()
                }, apiGatewayClient);
            
            default:
                console.log(`❓ Unknown action: ${action}`);
                return await sendToConnection(connectionId, {
                    action: 'error',
                    message: `Unknown action: ${action}`,
                    timestamp: new Date().toISOString()
                }, apiGatewayClient);
        }
    } catch (error) {
        console.error('❌ Handler error:', error);
        
        // Try to send error message, but don't fail if connection is stale
        try {
            await sendToConnection(connectionId, {
                action: 'error',
                message: 'Internal server error',
                timestamp: new Date().toISOString()
            }, apiGatewayClient);
        } catch (sendError) {
            console.warn('⚠️ Failed to send error message (connection may be stale):', sendError.message);
        }
        
        return { statusCode: 500 };
    }
};

/**
 * Handle driver joining a channel (initial connection setup)
 */
async function handleJoinChannel(connectionId, message, apiGatewayClient) {
    console.log('🔗 Driver joining channel');
    
    const { userType, userId, userName, userPhone, channel } = message;
    
    try {
        // Store/update connection info
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userType: userType || 'driver',
                userId: userId || connectionId,
                userName: userName || `User ${userId}`,
                userPhone: userPhone || '',
                channel: channel || `driver_${userId}`,
                connectedAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                status: 'connected'
            }
        }));
        
        console.log(`✅ Driver ${userName} connected to channel ${channel}`);
        
        // Send confirmation
        await sendToConnection(connectionId, {
            action: 'channel_joined',
            channel,
            userId,
            userName,
            status: 'connected',
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Join channel error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle chat session initialization
 */
async function handleChatInit(connectionId, message, apiGatewayClient) {
    console.log('🆕 Initializing chat session');
    
    const { userType, userId, userName, topic, description, metadata } = message;
    
    const sessionId = `chat_${userType}_${userId}_${Date.now()}`;
    const now = new Date().toISOString();
    
    try {
        // Create chat session
        await dynamoDB.send(new PutCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Item: {
                sessionId,
                userId: userId || connectionId,
                userType: userType || 'driver',
                userDisplayName: userName || `User ${userId}`,
                driverName: userName,
                driverId: userId,
                driverPhone: message.userPhone || '',
                status: 'active',
                topic: topic || 'Driver Support',
                description: description || 'Driver requesting support',
                createdAt: now,
                lastMessageAt: now,
                agentId: null,
                agentName: null,
                unreadAgent: 0,
                unreadDriver: 0,
                metadata: metadata || {}
            }
        }));
        
        console.log(`✅ Chat session created: ${sessionId}`);
        
        // Send confirmation to driver
        await sendToConnection(connectionId, {
            action: 'session_created',
            sessionId,
            status: 'active',
            topic,
            timestamp: now
        }, apiGatewayClient);
        
        // Notify agents about new session
        await notifyAgents({
            action: 'new_chat_session',
            sessionId,
            userType,
            userName: userName || `User ${userId}`,
            driverName: userName,
            topic,
            createdAt: now
        }, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Chat init error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle chat message
 */
async function handleChatMessage(connectionId, message, apiGatewayClient) {
    console.log('💬 Processing chat message');
    
    const { sessionId, senderId, senderName, senderType, message: messageText } = message;
    
    if (!sessionId || !messageText) {
        console.warn('❌ Invalid message: missing sessionId or message text');
        return { statusCode: 400 };
    }
    
    try {
        // Check if session exists
        const sessionResult = await dynamoDB.send(new GetCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId }
        }));
        
        if (!sessionResult.Item) {
            console.warn('❌ Session not found:', sessionId);
            return await sendToConnection(connectionId, {
                action: 'error',
                message: 'Session not found',
                sessionId
            }, apiGatewayClient);
        }
        
        const session = sessionResult.Item;
        if (session.status === 'closed') {
            console.warn('❌ Session is closed:', sessionId);
            return await sendToConnection(connectionId, {
                action: 'error',
                message: 'Session is closed',
                sessionId
            }, apiGatewayClient);
        }
        
        const now = new Date().toISOString();
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const messageKey = `t#${Date.now()}#${messageId}`;
        
        // Store message
        await dynamoDB.send(new PutCommand({
            TableName: CHAT_MESSAGES_TABLE,
            Item: {
                sessionId,
                messageKey,
                messageId,
                senderType: senderType || 'driver',
                senderName: senderName || 'Driver',
                text: messageText,
                createdAt: now,
                metadata: message.metadata || {}
            }
        }));
        
        // Update session
        await dynamoDB.send(new UpdateCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET lastMessageAt = :now, unreadAgent = if_not_exists(unreadAgent, :zero) + :one',
            ExpressionAttributeValues: {
                ':now': now,
                ':one': 1,
                ':zero': 0
            }
        }));
        
        console.log(`✅ Message stored: ${messageId}`);
        
        // Broadcast message to agents
        const broadcastMessage = {
            action: 'message_received',
            sessionId,
            messageId,
            senderType: senderType || 'driver',
            senderName: senderName || 'Driver',
            message: messageText,
            timestamp: now
        };
        
        await notifyAgents(broadcastMessage, apiGatewayClient);
        
        // Send acknowledgment to sender
        await sendToConnection(connectionId, {
            action: 'message_sent',
            messageId,
            sessionId,
            timestamp: now
        }, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Chat message error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle closing a chat session
 */
async function handleCloseSession(connectionId, message, apiGatewayClient) {
    console.log('🔚 Closing chat session');
    
    const { sessionId, userId, userType } = message;
    
    if (!sessionId) {
        return { statusCode: 400 };
    }
    
    try {
        await dynamoDB.send(new UpdateCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET #status = :status, closedAt = :now, closedBy = :closedBy',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'closed',
                ':now': new Date().toISOString(),
                ':closedBy': `${userType}:${userId}`
            }
        }));
        
        console.log(`✅ Session closed: ${sessionId}`);
        
        // Notify agents
        await notifyAgents({
            action: 'session_closed',
            sessionId,
            closedBy: userType,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        // Confirm to sender
        await sendToConnection(connectionId, {
            action: 'session_closed',
            sessionId,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Close session error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle ping (heartbeat)
 */
async function handlePing(connectionId, apiGatewayClient) {
    await sendToConnection(connectionId, {
        action: 'pong',
        timestamp: new Date().toISOString()
    }, apiGatewayClient);
    return { statusCode: 200 };
}

/**
 * Handle heartbeat
 */
async function handleHeartbeat(connectionId, apiGatewayClient) {
    await sendToConnection(connectionId, {
        action: 'heartbeat_response',
        timestamp: new Date().toISOString()
    }, apiGatewayClient);
    return { statusCode: 200 };
}

/**
 * Handle driver status update
 */
async function handleDriverStatusUpdate(connectionId, message, apiGatewayClient) {
    console.log('📍 Driver status update');
    
    try {
        // Update connection status
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET #status = :status, lastSeen = :now, location = :location',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': message.status || 'active',
                ':now': new Date().toISOString(),
                ':location': message.location || null
            }
        }));
        
        // Send confirmation
        await sendToConnection(connectionId, {
            action: 'status_updated',
            status: message.status,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Status update error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Notify all connected agents
 */
async function notifyAgents(message, apiGatewayClient) {
    try {
        // Get all agent connections
        const result = await dynamoDB.send(new QueryCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            IndexName: 'UserTypeIndex',
            KeyConditionExpression: 'userType = :userType',
            ExpressionAttributeValues: {
                ':userType': 'agent'
            }
        }));
        
        const agents = result.Items || [];
        console.log(`📡 Notifying ${agents.length} agents`);
        
        const promises = agents.map(agent => 
            sendToConnection(agent.connectionId, message, apiGatewayClient)
        );
        
        await Promise.allSettled(promises);
    } catch (error) {
        console.error('❌ Notify agents error:', error);
    }
}

/**
 * Handle subscribe to order updates
 */
async function handleSubscribeOrder(connectionId, message, apiGatewayClient) {
    try {
        const orderId = message.orderId || message.order_id;
        const userId = message.userId || message.user_id;
        
        if (!orderId) {
            console.log('❌ Missing orderId in subscribe_order');
            return await sendToConnection(connectionId, {
                action: 'error',
                message: 'Missing orderId',
                originalAction: 'subscribe_order'
            }, apiGatewayClient);
        }

        console.log(`📝 Subscribing connection ${connectionId} to order ${orderId}`);

        // Store subscription in WEBSOCKET_SUBSCRIPTIONS_TABLE
        const subscriptionId = `${connectionId}_order_${orderId}`;
        
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_SUBSCRIPTIONS_TABLE,
            Item: {
                subscriptionId: subscriptionId,
                connectionId: connectionId,
                userId: userId || 'anonymous',
                subscriptionType: 'order_updates',
                orderId: orderId,
                topic: `order:${orderId}`,
                isActive: true,
                createdAt: new Date().toISOString(),
                ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
            }
        }));

        console.log(`✅ Subscription created: ${subscriptionId}`);

        // Send acknowledgement
        return await sendToConnection(connectionId, {
            action: 'subscription_ack',
            originalAction: 'subscribe_order',
            orderId: orderId,
            subscriptionId: subscriptionId,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
    } catch (error) {
        console.error('❌ handleSubscribeOrder error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle unsubscribe from order updates
 */
async function handleUnsubscribeOrder(connectionId, message, apiGatewayClient) {
    try {
        const orderId = message.orderId || message.order_id;
        
        if (!orderId) {
            console.log('❌ Missing orderId in unsubscribe_order');
            return await sendToConnection(connectionId, {
                action: 'error',
                message: 'Missing orderId'
            }, apiGatewayClient);
        }

        console.log(`📝 Unsubscribing connection ${connectionId} from order ${orderId}`);

        const subscriptionId = `${connectionId}_order_${orderId}`;
        
        // Mark subscription as inactive
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_SUBSCRIPTIONS_TABLE,
            Key: { subscriptionId },
            UpdateExpression: 'SET isActive = :isActive, unsubscribedAt = :unsubscribedAt',
            ExpressionAttributeValues: {
                ':isActive': false,
                ':unsubscribedAt': new Date().toISOString()
            }
        }));

        console.log(`✅ Unsubscribed: ${subscriptionId}`);

        // Send acknowledgement
        return await sendToConnection(connectionId, {
            action: 'unsubscribe_ack',
            orderId: orderId,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
    } catch (error) {
        console.error('❌ handleUnsubscribeOrder error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Send message to a WebSocket connection
 */
async function sendToConnection(connectionId, message, apiGatewayClient) {
    try {
        await apiGatewayClient.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(message)
        }));
        console.log(`📤 Sent message to ${connectionId}:`, message.action || 'unknown');
        return true;
    } catch (error) {
        if (error.statusCode === 410 || error.name === 'GoneException') {
            // Connection is stale, remove it but don't fail the request
            console.log(`🧹 Removing stale connection: ${connectionId}`);
            try {
                await dynamoDB.send(new DeleteCommand({
                    TableName: WEBSOCKET_CONNECTIONS_TABLE,
                    Key: { connectionId }
                }));
            } catch (deleteError) {
                console.warn('⚠️ Failed to remove stale connection:', deleteError);
            }
            return false; // Return false but don't throw
        } else {
            console.error(`❌ Send to connection error (${connectionId}):`, error);
            throw error; // Only throw for non-410 errors
        }
    }
}
