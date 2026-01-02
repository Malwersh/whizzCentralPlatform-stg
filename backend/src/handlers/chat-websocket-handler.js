/**
 * Lambda handler for live chat WebSocket connections
 * Handles chat_init, chat_message, agent_connect, and other chat actions
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

// Initialize DynamoDB client
const dynamoDB = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

// Table names
const CHAT_SESSIONS_TABLE = process.env.CHAT_SESSIONS_TABLE || 'ChatSessions';
const CHAT_MESSAGES_TABLE = process.env.CHAT_MESSAGES_TABLE || 'ChatMessages';
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE || 'WebSocketConnections';

/**
 * Main handler for WebSocket events
 */
exports.handler = async (event) => {
    console.log('📨 WebSocket event received:', JSON.stringify(event, null, 2));
    
    const { requestContext, body } = event;
    const { connectionId, routeKey, stage, domainName } = requestContext;
    
    // Create API Gateway Management API client
    const apiGatewayClient = new ApiGatewayManagementApiClient({
        endpoint: `https://${domainName}/${stage}`
    });

    try {
        switch (routeKey) {
            case '$connect':
                return await handleConnect(connectionId, event, apiGatewayClient);
            case '$disconnect':
                return await handleDisconnect(connectionId, apiGatewayClient);
            case '$default':
                return await handleMessage(connectionId, body, apiGatewayClient);
            case 'chat_init':
                return await handleChatInit(connectionId, body, apiGatewayClient);
            case 'chat_message':
                return await handleChatMessage(connectionId, body, apiGatewayClient);
            case 'agent_connect':
                return await handleAgentConnect(connectionId, body, apiGatewayClient);
            case 'agent_disconnect':
                return await handleAgentDisconnect(connectionId, body, apiGatewayClient);
            case 'join_channel':
                return await handleJoinChannel(connectionId, body, apiGatewayClient);
            case 'leave_channel':
                return await handleLeaveChannel(connectionId, body, apiGatewayClient);
            default:
                console.warn('❓ Unknown route:', routeKey);
                return { statusCode: 404 };
        }
    } catch (error) {
        console.error('❌ Handler error:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Internal server error',
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        return { statusCode: 500 };
    }
};

/**
 * Handle WebSocket connection
 */
async function handleConnect(connectionId, event, apiGatewayClient) {
    console.log('🔗 New WebSocket connection:', connectionId);
    
    const { queryStringParameters } = event;
    const userType = queryStringParameters?.userType || 'unknown';
    const userId = queryStringParameters?.userId || connectionId;
    const agentId = queryStringParameters?.agentId;
    const agentName = queryStringParameters?.agentName;
    
    try {
        // Store connection info
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userType,
                userId,
                agentId: agentId || null,
                agentName: agentName || null,
                connectedAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                status: 'connected'
            }
        }));
        
        console.log(`✅ Connection stored: ${userType}:${userId}`);
        
        // Send connection confirmation
        await sendToConnection(connectionId, {
            type: 'connection_confirmed',
            connectionId,
            userType,
            userId,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        // If this is an agent, send active sessions
        if (userType === 'agent' || userType === 'agent_dashboard') {
            await sendActiveSessions(connectionId, apiGatewayClient);
        }
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Connection error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle WebSocket disconnection
 */
async function handleDisconnect(connectionId, apiGatewayClient) {
    console.log('🔌 WebSocket disconnected:', connectionId);
    
    try {
        // Remove connection from table
        await dynamoDB.send(new DeleteCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        
        console.log('✅ Connection removed');
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Disconnect error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle WebSocket messages
 */
async function handleMessage(connectionId, body, apiGatewayClient) {
    if (!body) {
        return { statusCode: 400 };
    }
    
    try {
        const message = JSON.parse(body);
        console.log('📨 Processing message:', message.type || message.action);
        
        // Update last seen timestamp
        await updateLastSeen(connectionId);
        
        // Route message based on type/action
        const messageType = message.type || message.action;
        
        switch (messageType) {
            case 'chat_init':
                return await handleChatInit(connectionId, message, apiGatewayClient);
            case 'chat_merchant_connect':
                return await handleMerchantConnect(connectionId, message, apiGatewayClient);
            case 'chat_message':
                return await handleChatMessage(connectionId, message, apiGatewayClient);
            case 'agent_connect':
            case 'chat_agent_connect':
                return await handleAgentConnect(connectionId, message, apiGatewayClient);
            case 'chat_end':
            case 'chat_session_close':
                return await handleChatEnd(connectionId, message, apiGatewayClient);
            case 'get_session_messages':
                return await handleGetSessionMessages(connectionId, message, apiGatewayClient);
            case 'sync_sessions':
                return await handleSyncSessions(connectionId, message, apiGatewayClient);
            case 'ping':
                return await handlePing(connectionId, apiGatewayClient);
            case 'heartbeat':
                return await handleHeartbeat(connectionId, apiGatewayClient);
            default:
                console.warn('❓ Unknown message type:', messageType);
                return { statusCode: 400 };
        }
    } catch (error) {
        console.error('❌ Message handling error:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to process message',
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        return { statusCode: 500 };
    }
}

/**
 * Handle chat initialization from driver/customer
 */
async function handleChatInit(connectionId, message, apiGatewayClient) {
    console.log('🆕 Initializing chat session');
    
    const { payload } = message;
    const { userId, userType, userDisplayName, context } = payload;
    
    // Generate session ID
    const sessionId = `chat_${userType}_${userId}_${Date.now()}`;
    const now = new Date().toISOString();
    
    try {
        // Create chat session
        await dynamoDB.send(new PutCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Item: {
                sessionId,
                userId,
                userType,
                userDisplayName: userDisplayName || `${userType}_${userId}`,
                driverName: context?.driverName || userDisplayName,
                driverId: context?.driverId || userId,
                driverPhone: context?.driverPhone || '',
                status: 'active',
                createdAt: now,
                lastMessageAt: now,
                agentId: null,
                agentName: null,
                unreadAgent: 0,
                unreadDriver: 0,
                context: context || {}
            }
        }));
        
        console.log(`✅ Chat session created: ${sessionId}`);
        
        // Send confirmation to initiator
        await sendToConnection(connectionId, {
            type: 'chat_session_created',
            sessionId,
            status: 'active',
            timestamp: now
        }, apiGatewayClient);
        
        // Notify all agents about new session
        await notifyAgents({
            type: 'new_chat_session',
            sessionId,
            userType,
            userDisplayName: userDisplayName || `${userType}_${userId}`,
            driverName: context?.driverName || userDisplayName,
            createdAt: now
        }, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Chat init error:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to initialize chat session'
        }, apiGatewayClient);
        return { statusCode: 500 };
    }
}

/**
 * Handle merchant connection for support chat
 */
async function handleMerchantConnect(connectionId, message, apiGatewayClient) {
    console.log('🏪 Merchant connecting to support chat');
    
    const { merchantId, merchantName, merchantEmail, sessionId: providedSessionId } = message;
    
    if (!merchantId) {
        console.warn('❌ Missing merchantId in merchant connect');
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'merchantId is required'
        }, apiGatewayClient);
        return { statusCode: 400 };
    }
    
    // Generate or use provided session ID
    const sessionId = providedSessionId || `chat_merchant_${merchantId}_${Date.now()}`;
    const now = new Date().toISOString();
    
    try {
        // Check if session already exists
        let session;
        try {
            const result = await dynamoDB.send(new GetCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Key: { sessionId }
            }));
            session = result.Item;
        } catch (err) {
            console.log('Session not found, will create new one');
        }
        
        // Create new session if doesn't exist
        if (!session) {
            await dynamoDB.send(new PutCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Item: {
                    sessionId,
                    userId: merchantId,
                    userType: 'merchant',
                    userDisplayName: merchantName || `Merchant ${merchantId}`,
                    merchantId,
                    merchantName: merchantName || `Merchant ${merchantId}`,
                    merchantEmail: merchantEmail || '',
                    status: 'active',
                    createdAt: now,
                    lastMessageAt: now,
                    agentId: null,
                    agentName: null,
                    unreadAgent: 0,
                    unreadMerchant: 0,
                    context: {
                        app: 'whizzMerchants',
                        merchantId,
                        merchantName,
                        merchantEmail
                    }
                }
            }));
            
            console.log(`✅ Merchant chat session created: ${sessionId}`);
            
            // Notify all agents about new merchant session
            await notifyAgents({
                type: 'new_chat_session',
                sessionId,
                userType: 'merchant',
                userDisplayName: merchantName || `Merchant ${merchantId}`,
                merchantId,
                merchantName,
                createdAt: now
            }, apiGatewayClient);
        } else {
            console.log(`✅ Merchant reconnected to existing session: ${sessionId}`);
        }
        
        // Update connection info
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userType: 'merchant',
                userId: merchantId,
                merchantId,
                merchantName,
                sessionId,
                connectedAt: now,
                lastSeen: now,
                status: 'connected'
            }
        }));
        
        // Send confirmation to merchant
        await sendToConnection(connectionId, {
            type: 'connection_confirmed',
            sessionId,
            merchantId,
            status: 'connected',
            timestamp: now
        }, apiGatewayClient);
        
        // Send chat session created message
        await sendToConnection(connectionId, {
            type: 'chat_session_created',
            sessionId,
            merchantId,
            status: 'active',
            timestamp: now
        }, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Merchant connect error:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to connect merchant to support chat',
            error: error.message
        }, apiGatewayClient);
        return { statusCode: 500 };
    }
}

/**
 * Handle chat message
 */
async function handleChatMessage(connectionId, message, apiGatewayClient) {
    console.log('💬 Processing chat message');
    
    const { payload, sessionId: msgSessionId } = message;
    const sessionId = msgSessionId || payload?.sessionId;
    const messageText = payload?.content || payload?.messageText || message.messageText;
    const senderType = payload?.senderType || message.senderType || 'driver';
    const senderName = payload?.senderName || message.senderName || 'User';
    
    if (!sessionId || !messageText) {
        console.warn('❌ Invalid message: missing sessionId or messageText');
        return { statusCode: 400 };
    }
    
    try {
        // Get session
        const sessionResult = await dynamoDB.send(new GetCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId }
        }));
        
        if (!sessionResult.Item) {
            console.warn('❌ Session not found:', sessionId);
            return { statusCode: 404 };
        }
        
        const session = sessionResult.Item;
        if (session.status === 'closed') {
            console.warn('❌ Session is closed:', sessionId);
            return { statusCode: 400 };
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
                senderType,
                senderName,
                text: messageText,
                createdAt: now,
                metadata: payload?.metadata || {}
            }
        }));
        
        // Update session
        const updateExpr = 'SET lastMessageAt = :now';
        const exprValues = { ':now': now };
        
        // Increment unread counters
        if (senderType === 'driver') {
            updateExpr += ', unreadAgent = if_not_exists(unreadAgent, :zero) + :one';
            exprValues[':one'] = 1;
            exprValues[':zero'] = 0;
        } else if (senderType === 'agent') {
            updateExpr += ', unreadDriver = if_not_exists(unreadDriver, :zero) + :one';
            exprValues[':one'] = 1;
            exprValues[':zero'] = 0;
        }
        
        await dynamoDB.send(new UpdateCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: updateExpr,
            ExpressionAttributeValues: exprValues
        }));
        
        console.log(`✅ Message stored: ${messageId}`);
        
        // Broadcast message to all relevant connections
        const broadcastMessage = {
            type: 'chat_message',
            sessionId,
            message: {
                messageId,
                sessionId,
                messageKey,
                senderType,
                senderName,
                text: messageText,
                createdAt: now
            },
            metadata: payload?.metadata || {}
        };
        
        await broadcastToSession(sessionId, broadcastMessage, connectionId, apiGatewayClient);
        
        // Send acknowledgment to sender
        await sendToConnection(connectionId, {
            type: 'message_ack',
            messageId,
            sessionId,
            timestamp: now
        }, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Chat message error:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to send message'
        }, apiGatewayClient);
        return { statusCode: 500 };
    }
}

/**
 * Handle agent connection
 */
async function handleAgentConnect(connectionId, message, apiGatewayClient) {
    console.log('👨‍💼 Agent connecting');
    
    const { agentId, agentName } = message;
    
    try {
        // Update connection with agent info
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET userType = :userType, agentId = :agentId, agentName = :agentName, lastSeen = :now',
            ExpressionAttributeValues: {
                ':userType': 'agent',
                ':agentId': agentId,
                ':agentName': agentName,
                ':now': new Date().toISOString()
            }
        }));
        
        console.log(`✅ Agent connected: ${agentName} (${agentId})`);
        
        // Send agent authentication confirmation
        await sendToConnection(connectionId, {
            type: 'agent_authenticated',
            agentId,
            agentName,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        // Send active sessions
        await sendActiveSessions(connectionId, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Agent connect error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle agent disconnect
 */
async function handleAgentDisconnect(connectionId, message, apiGatewayClient) {
    console.log('👨‍💼 Agent disconnecting');
    
    try {
        // Get agent info from connection
        const connResult = await dynamoDB.send(new GetCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        
        if (connResult.Item) {
            const { agentId, agentName } = connResult.Item;
            
            // Notify other agents
            await notifyAgents({
                type: 'agent_disconnected',
                agentId,
                agentName,
                timestamp: new Date().toISOString()
            }, apiGatewayClient);
            
            console.log(`✅ Agent disconnected: ${agentName} (${agentId})`);
        }
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Agent disconnect error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle join channel/session
 */
async function handleJoinChannel(connectionId, message, apiGatewayClient) {
    console.log('📥 Joining channel');
    
    const { sessionId, agentId, agentName } = message;
    
    if (!sessionId) {
        return { statusCode: 400 };
    }
    
    try {
        // Update session with agent assignment
        await dynamoDB.send(new UpdateCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET agentId = :agentId, agentName = :agentName, agentJoinedAt = :now',
            ExpressionAttributeValues: {
                ':agentId': agentId,
                ':agentName': agentName,
                ':now': new Date().toISOString()
            }
        }));
        
        // Update connection with session info
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET sessionId = :sessionId',
            ExpressionAttributeValues: {
                ':sessionId': sessionId
            }
        }));
        
        // Send confirmation
        await sendToConnection(connectionId, {
            type: 'channel_joined',
            sessionId,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        // Notify session participants
        await broadcastToSession(sessionId, {
            type: 'agent_joined',
            sessionId,
            agentId,
            agentName,
            timestamp: new Date().toISOString()
        }, connectionId, apiGatewayClient);
        
        // Send session messages to agent
        await handleGetSessionMessages(connectionId, { sessionId }, apiGatewayClient);
        
        console.log(`✅ Agent ${agentName} joined session ${sessionId}`);
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Join channel error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle leave channel/session
 */
async function handleLeaveChannel(connectionId, message, apiGatewayClient) {
    console.log('📤 Leaving channel');
    
    const { sessionId, agentId, agentName } = message;
    
    if (!sessionId) {
        return { statusCode: 400 };
    }
    
    try {
        // Remove agent from session
        await dynamoDB.send(new UpdateCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'REMOVE agentId, agentName, agentJoinedAt',
            ConditionExpression: 'agentId = :agentId',
            ExpressionAttributeValues: {
                ':agentId': agentId
            }
        }));
        
        // Update connection to remove session
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'REMOVE sessionId'
        }));
        
        // Send confirmation
        await sendToConnection(connectionId, {
            type: 'channel_left',
            sessionId,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        // Notify session participants
        await broadcastToSession(sessionId, {
            type: 'agent_left',
            sessionId,
            agentId,
            agentName,
            timestamp: new Date().toISOString()
        }, connectionId, apiGatewayClient);
        
        console.log(`✅ Agent ${agentName} left session ${sessionId}`);
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Leave channel error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle chat end
 */
async function handleChatEnd(connectionId, message, apiGatewayClient) {
    console.log('🔚 Ending chat session');
    
    const { sessionId, userId, userType } = message.payload || message;
    
    if (!sessionId) {
        console.warn('❌ No sessionId provided for chat end');
        return { statusCode: 400 };
    }
    
    try {
        // Update session status
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
        
        // Notify all participants
        await broadcastToSession(sessionId, {
            type: 'session_closed',
            sessionId,
            closedBy: userType,
            timestamp: new Date().toISOString()
        }, null, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Chat end error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle get session messages
 */
async function handleGetSessionMessages(connectionId, message, apiGatewayClient) {
    console.log('📜 Getting session messages');
    
    const { sessionId, limit = 50 } = message;
    
    if (!sessionId) {
        return { statusCode: 400 };
    }
    
    try {
        // Query messages for session
        const result = await dynamoDB.send(new QueryCommand({
            TableName: CHAT_MESSAGES_TABLE,
            KeyConditionExpression: 'sessionId = :sessionId',
            ExpressionAttributeValues: {
                ':sessionId': sessionId
            },
            Limit: Math.min(limit, 100),
            ScanIndexForward: false // Get newest first
        }));
        
        const messages = (result.Items || []).map(item => ({
            messageId: item.messageId,
            senderType: item.senderType,
            senderName: item.senderName,
            text: item.text,
            createdAt: item.createdAt,
            metadata: item.metadata || {}
        }));
        
        await sendToConnection(connectionId, {
            type: 'session_messages',
            sessionId,
            messages,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        return { statusCode: 200 };
    } catch (error) {
        console.error('❌ Get messages error:', error);
        return { statusCode: 500 };
    }
}

/**
 * Handle sync sessions
 */
async function handleSyncSessions(connectionId, message, apiGatewayClient) {
    console.log('🔄 Syncing sessions');
    
    await sendActiveSessions(connectionId, apiGatewayClient);
    return { statusCode: 200 };
}

/**
 * Handle ping
 */
async function handlePing(connectionId, apiGatewayClient) {
    await sendToConnection(connectionId, {
        type: 'pong',
        timestamp: new Date().toISOString()
    }, apiGatewayClient);
    return { statusCode: 200 };
}

/**
 * Handle heartbeat
 */
async function handleHeartbeat(connectionId, apiGatewayClient) {
    await sendToConnection(connectionId, {
        type: 'heartbeat_response',
        timestamp: new Date().toISOString()
    }, apiGatewayClient);
    return { statusCode: 200 };
}

/**
 * Send active sessions to agent
 */
async function sendActiveSessions(connectionId, apiGatewayClient) {
    try {
        // Query active sessions
        const result = await dynamoDB.send(new QueryCommand({
            TableName: CHAT_SESSIONS_TABLE,
            IndexName: 'StatusIndex',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'active'
            },
            Limit: 100
        }));
        
        const sessions = (result.Items || []).map(session => ({
            sessionId: session.sessionId,
            userType: session.userType || 'driver',
            driverName: session.driverName || session.userDisplayName,
            driverId: session.driverId || session.userId,
            driverPhone: session.driverPhone || '',
            merchantId: session.merchantId,
            merchantName: session.merchantName,
            merchantEmail: session.merchantEmail,
            userId: session.userId,
            status: session.status,
            createdAt: session.createdAt,
            lastMessageAt: session.lastMessageAt || session.createdAt,
            agentId: session.agentId,
            agentName: session.agentName,
            unreadAgent: session.unreadAgent || 0,
            unreadDriver: session.unreadDriver || 0
        }));
        
        await sendToConnection(connectionId, {
            type: 'active_sessions',
            sessions,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
        console.log(`✅ Sent ${sessions.length} active sessions`);
    } catch (error) {
        console.error('❌ Send active sessions error:', error);
    }
}

/**
 * Broadcast message to all connections in a session
 */
async function broadcastToSession(sessionId, message, excludeConnectionId, apiGatewayClient) {
    try {
        // Get all connections (agents and session participants)
        const connections = await getSessionConnections(sessionId);
        
        const promises = connections
            .filter(conn => conn.connectionId !== excludeConnectionId)
            .map(conn => sendToConnection(conn.connectionId, message, apiGatewayClient));
        
        await Promise.allSettled(promises);
        
        console.log(`✅ Broadcast to ${promises.length} connections`);
    } catch (error) {
        console.error('❌ Broadcast error:', error);
    }
}

/**
 * Get all connections for a session (agents + participants)
 */
async function getSessionConnections(sessionId) {
    try {
        // Get all agent connections
        const agentResult = await dynamoDB.send(new QueryCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            IndexName: 'UserTypeIndex',
            KeyConditionExpression: 'userType = :userType',
            ExpressionAttributeValues: {
                ':userType': 'agent'
            }
        }));
        
        // Get session participants
        const sessionResult = await dynamoDB.send(new GetCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId }
        }));
        
        const connections = [...(agentResult.Items || [])];
        
        // Add session participant if connected
        if (sessionResult.Item) {
            const participantResult = await dynamoDB.send(new QueryCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                IndexName: 'UserIdIndex',
                KeyConditionExpression: 'userId = :userId',
                ExpressionAttributeValues: {
                    ':userId': sessionResult.Item.userId
                }
            }));
            
            connections.push(...(participantResult.Items || []));
        }
        
        return connections;
    } catch (error) {
        console.error('❌ Get session connections error:', error);
        return [];
    }
}

/**
 * Notify all agents
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
        const promises = agents.map(agent => 
            sendToConnection(agent.connectionId, message, apiGatewayClient)
        );
        
        await Promise.allSettled(promises);
        
        console.log(`✅ Notified ${agents.length} agents`);
    } catch (error) {
        console.error('❌ Notify agents error:', error);
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
    } catch (error) {
        if (error.statusCode === 410) {
            // Connection is stale, remove it
            console.log(`🧹 Removing stale connection: ${connectionId}`);
            await dynamoDB.send(new DeleteCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                Key: { connectionId }
            }));
        } else {
            console.error(`❌ Send to connection error (${connectionId}):`, error);
        }
        throw error;
    }
}

/**
 * Update last seen timestamp for connection
 */
async function updateLastSeen(connectionId) {
    try {
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET lastSeen = :now',
            ExpressionAttributeValues: {
                ':now': new Date().toISOString()
            }
        }));
    } catch (error) {
        console.warn('⚠️ Update last seen error:', error);
    }
}
