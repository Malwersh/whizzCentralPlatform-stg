const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, ScanCommand, DeleteCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { CognitoJwtVerifier } = require('aws-jwt-verify');

// Initialize DynamoDB client
const dynamoDBClient = new DynamoDBClient({ region: "us-east-1" });
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

// Table names
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE || 'WizzUser_websocket_connections_dev';
const WEBSOCKET_SUBSCRIPTIONS_TABLE = process.env.WEBSOCKET_SUBSCRIPTIONS_TABLE || 'WizzUser_websocket_subscriptions_dev';
const CHAT_SESSIONS_TABLE = process.env.CHAT_SESSIONS_TABLE || 'chat-sessions-dev';
const CHAT_MESSAGES_TABLE = process.env.CHAT_MESSAGES_TABLE || 'chat-messages-dev';
const ORDERS_TABLE = process.env.ORDERS_TABLE || 'WizzUser_orders_dev';
const DRIVERS_TABLE = process.env.DRIVERS_TABLE || 'WizzUser_drivers_dev';

// Support multiple Cognito User Pools (one per app + central platform)
const COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-1';

// WhizzCentralPlatform Cognito (for support agents)
const CENTRAL_PLATFORM_USER_POOL_ID = process.env.CENTRAL_PLATFORM_USER_POOL_ID || 'us-east-1_Cp9YnOQWi';
const CENTRAL_PLATFORM_CLIENT_ID = process.env.CENTRAL_PLATFORM_CLIENT_ID || '22rf529lhbqtlvpdk2578h73l1';

// WhizzMerchants Cognito (for merchants) - phone-based pool (WhizzMerchants-phone-users-staging)
const MERCHANTS_USER_POOL_ID = process.env.MERCHANTS_USER_POOL_ID || 'us-east-1_gtCR3ndzT';
const MERCHANTS_CLIENT_ID = process.env.MERCHANTS_CLIENT_ID || '4qabvh11nmghmf9fmc6e6ludd2';

// WhizzDrivers Cognito (for drivers)
const DRIVERS_USER_POOL_ID = process.env.DRIVERS_USER_POOL_ID || 'us-east-1_Mnrmklxro';
const DRIVERS_CLIENT_ID = process.env.DRIVERS_CLIENT_ID || '4dkt45gole08kurh0o43rvk8q7';

// Create verifiers for each user pool
const verifiers = {};

// Central Platform verifier (support agents)
if (CENTRAL_PLATFORM_USER_POOL_ID !== 'YOUR_USER_POOL_ID') {
    try {
        verifiers.central = CognitoJwtVerifier.create({
            userPoolId: CENTRAL_PLATFORM_USER_POOL_ID,
            tokenUse: 'id',
            clientId: CENTRAL_PLATFORM_CLIENT_ID
        });
    } catch (e) {
        console.warn('Failed to create Central Platform verifier:', e.message);
    }
}

// Merchants verifier
if (MERCHANTS_USER_POOL_ID !== 'YOUR_MERCHANTS_POOL_ID') {
    try {
        verifiers.merchants = CognitoJwtVerifier.create({
            userPoolId: MERCHANTS_USER_POOL_ID,
            tokenUse: 'id',
            clientId: MERCHANTS_CLIENT_ID
        });
    } catch (e) {
        console.warn('Failed to create Merchants verifier:', e.message);
    }
}

// Drivers verifier
if (DRIVERS_USER_POOL_ID !== 'YOUR_DRIVERS_POOL_ID') {
    try {
        verifiers.drivers = CognitoJwtVerifier.create({
            userPoolId: DRIVERS_USER_POOL_ID,
            tokenUse: 'id',
            clientId: DRIVERS_CLIENT_ID
        });
    } catch (e) {
        console.warn('Failed to create Drivers verifier:', e.message);
    }
}

const BUILD_VERSION = 'merchant-chat-deploy-2025-11-12T00:00:00Z';

async function verifyJwt(idToken, userType = 'driver') {
    if (!idToken) throw new Error('Missing token');
    
    // Try to verify with the appropriate user pool based on userType
    let verifier = null;
    if (userType === 'support' || userType === 'agent') {
        verifier = verifiers.central;
    } else if (userType === 'merchant') {
        verifier = verifiers.merchants;
    } else if (userType === 'driver') {
        verifier = verifiers.drivers;
    }
    
    // If no specific verifier, try all verifiers
    if (!verifier) {
        const errors = [];
        for (const [poolName, v] of Object.entries(verifiers)) {
            try {
                const payload = await v.verify(idToken);
                console.log(`✅ JWT verified successfully with ${poolName} user pool`);
                return payload;
            } catch (e) {
                errors.push(`${poolName}: ${e.message}`);
            }
        }
        console.warn('JWT verification failed with all user pools:', errors.join('; '));
        throw new Error('Invalid token for all configured user pools');
    }
    
    // Verify with specific user pool
    try {
        const payload = await verifier.verify(idToken);
        console.log(`✅ JWT verified successfully for ${userType}`);
        return payload;
    } catch (e) {
        console.warn(`JWT verify failed for ${userType}:`, e.message || e);
        throw new Error('Invalid token');
    }
}

const handler = async (event) => {
    // Diagnostic banner to verify deployment and environment mapping
    console.log(`🛠️ Build ${BUILD_VERSION} | Tables: connections=${WEBSOCKET_CONNECTIONS_TABLE} sessions=${CHAT_SESSIONS_TABLE} messages=${CHAT_MESSAGES_TABLE}`);
    try {
        console.log('WebSocket route:', event.requestContext?.routeKey);

        const connectionId = event.requestContext?.connectionId;
        const routeKey = event.requestContext?.routeKey;
        const body = event.body;
        const apiId = event.requestContext?.apiId;
        const stage = event.requestContext?.stage || 'dev';

        if (!connectionId) {
            console.error('Missing connectionId in event.requestContext');
            return {
                statusCode: 400,
                body: 'Missing connectionId'
            };
        }

        console.log(`WebSocket message: ${connectionId}, route: ${routeKey}, body: ${body}`);

        // Initialize API Gateway Management API client
        const apiGatewayClient = new ApiGatewayManagementApiClient({
            endpoint: `https://${apiId}.execute-api.us-east-1.amazonaws.com/${stage}`
        });

        // Handle connection and disconnection
        if (routeKey === '$connect') {
            return await handleConnect(connectionId, event);
        } else if (routeKey === '$disconnect') {
            return await handleDisconnect(connectionId);
        }

        // Parse the message if it exists
        let message;
        if (body) {
            try {
                message = JSON.parse(body);
                console.log('Parsed message:', JSON.stringify(message));
            } catch (e) {
                console.log('Failed to parse message body:', body);
                message = { type: 'unknown', body };
            }
        }

        // Handle different message types
        const messageType = message?.type || message?.action;
        if (messageType) {
            // Authorization guard: ensure connection is authenticated unless heartbeat/authenticate
            const connAuth = await dynamoDB.send(new GetCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                Key: { connectionId },
                ConsistentRead: true
            }));
            const isAuthed = !!connAuth.Item?.authenticated;
            const exempt = ['authenticate', 'heartbeat', 'ping', 'chat_merchant_connect', 'chat_agent_connect', 'chat_driver_connect'];
            if (!isAuthed && !exempt.includes(messageType)) {
                console.warn('Blocking message from unauthenticated connection', connectionId, messageType);
                return await sendToConnection(connectionId, { type: 'error', message: 'Not authenticated' }, apiGatewayClient);
            }
            switch (messageType) {
                case 'authenticate':
                    return await handleAuthentication(connectionId, message, apiGatewayClient);
                case 'heartbeat':
                case 'ping':
                    return await handleHeartbeat(connectionId, apiGatewayClient);
                case 'chat_driver_connect':
                    console.log(`🚗 Driver connecting to live chat: ${connectionId}`);
                    return await handleDriverChatConnect(connectionId, message, apiGatewayClient);
                case 'chat_agent_connect':
                    console.log(`👩‍💼 Support agent connecting to live chat: ${connectionId}`);
                    return await handleAgentChatConnect(connectionId, message, apiGatewayClient);
                case 'chat_merchant_connect':
                    console.log(`🏪 Merchant connecting to live chat: ${connectionId}`);
                    return await handleMerchantChatConnect(connectionId, message, apiGatewayClient);
                case 'agent_message':
                    console.log('⚠️ Received agent_message. Normalizing to chat_message for session', message.sessionId);
                case 'driver_message':
                    console.log('⚠️ Received legacy driver_message. Normalizing to chat_message for session', message.sessionId);
                case 'chat_message':
                    console.log(`💬 Chat message from ${connectionId}`);
                    return await handleChatMessage(connectionId, { ...message, type: 'chat_message' }, apiGatewayClient);
                case 'chat_typing':
                    console.log(`⌨️ Typing indicator from ${connectionId}`);
                    return await handleTypingIndicator(connectionId, message, apiGatewayClient);
                case 'chat_session_close':
                    console.log(`🔚 Chat session close from ${connectionId}`);
                    return await handleChatSessionClose(connectionId, message, apiGatewayClient);
                case 'sync_sessions':
                    console.log(`🔄 Session sync request from ${connectionId}`);
                    return await handleSyncSessions(connectionId, message, apiGatewayClient);
                case 'get_session_messages':
                    return await handleGetSessionMessages(connectionId, message, apiGatewayClient);
                case 'ack':
                    return await handleAck(connectionId, message, apiGatewayClient);
                case 'driver_assignment_response':
                    console.log(`🎯 Driver assignment response from ${connectionId}`);
                    return await handleDriverAssignmentResponse(connectionId, message, apiGatewayClient);
                case 'driver_location_update':
                    console.log(`📍 Driver location update from ${connectionId}`);
                    return await handleDriverLocationUpdate(connectionId, message, apiGatewayClient);
                case 'driver_status_update':
                    console.log(`🔄 Driver status update from ${connectionId}`);
                    return await handleDriverStatusUpdate(connectionId, message, apiGatewayClient);
                case 'order_status_update':
                    console.log(`📦 Order status update from ${connectionId}`);
                    return await handleOrderStatusUpdate(connectionId, message, apiGatewayClient);
                case 'order_accept':
                    console.log(`✅ Order accept from ${connectionId}`);
                    return await handleOrderAccept(connectionId, message, apiGatewayClient);
                case 'order_reject':
                    console.log(`❌ Order reject from ${connectionId}`);
                    return await handleOrderReject(connectionId, message, apiGatewayClient);
                case 'subscribe':
                    console.log(`📡 Subscription request from ${connectionId}`);
                    return await handleSubscribe(connectionId, message, apiGatewayClient);
                case 'unsubscribe':
                    console.log(`📡 Unsubscription request from ${connectionId}`);
                    return await handleUnsubscribe(connectionId, message, apiGatewayClient);
                default:
                    console.log(`Unknown message type: ${messageType}`);
                    return await sendToConnection(connectionId, { type: 'error', message: `Unknown message type: ${messageType}` }, apiGatewayClient);
            }
        }

        return {
            statusCode: 200,
            body: 'Message received'
        };

    } catch (error) {
        console.error('Error handling WebSocket message:', error);
        return {
            statusCode: 500,
            body: 'Failed to process message'
        };
    }
};

// Handle WebSocket connection
async function handleConnect(connectionId, event) {
    try {
        const queryParams = event.queryStringParameters || {};
        const { token, businessId, userType: requestUserType } = queryParams;
        console.log(`New WebSocket connection: ${connectionId}, businessId: ${businessId}, userType: ${requestUserType}, hasToken: ${!!token}`);

        // Special handling for support agents - allow without JWT or with browser token
        if (requestUserType === 'support') {
            console.log('Support agent connection - bypassing JWT verification');
            const agentId = queryParams.agentId || 'support-agent-001';

            await dynamoDB.send(new PutCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                Item: {
                    connectionId,
                    userId: agentId,
                    userType: 'agent',
                    businessId: businessId || 'default',
                    platform: queryParams.platform || 'web',
                    appVersion: queryParams.appVersion || '1.0.0',
                    connectedAt: new Date().toISOString(),
                    lastActivity: new Date().toISOString(),
                    lastHeartbeat: new Date().toISOString(),
                    isActive: true,
                    connectionType: 'REAL',
                    source: 'support_portal',
                    ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
                    authenticated: true,
                    groups: ['support'],
                    email: 'support@wizzcentral.com'
                }
            }));

            console.log(`✅ Support agent connection stored ${connectionId} agentId=${agentId}`);
            return { statusCode: 200, body: 'Connected' };
        }

        // For non-support: Verify JWT if provided (skip if browser token or no token in dev)
        let verified = null;
        const isBrowserToken = token && (token.startsWith('browser_agent_') || token.startsWith('browser_'));
        if (!token || isBrowserToken) {
            console.warn(`⚠️ Connection without valid JWT - allowing in dev mode. connectionId: ${connectionId}`);
            verified = {
                sub: queryParams.driverId || `dev-user-${Date.now()}`,
                email: 'dev@wizzcentral.com',
                'cognito:groups': []
            };
        } else {
            try {
                verified = await verifyJwt(token);
                console.log(`✅ JWT verified for connectionId: ${connectionId}`);
            } catch (e) {
                console.error('❌ JWT verification failed:', e.message || e);
                return { statusCode: 401, body: 'Unauthorized: Invalid token' };
            }
        }

        // Determine role / userType from groups
        const groups = verified['cognito:groups'] || [];
        let role = 'driver';
        if (Array.isArray(groups)) {
            if (groups.includes('support') || groups.includes('admin')) role = 'agent';
        }
        const userId = queryParams.driverId || verified.sub;
        const userType = role === 'agent' ? 'agent' : (requestUserType || 'driver');

        // Store connection (schema: HASH key is connectionId)
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userId,
                userType,
                businessId: businessId || 'default',
                platform: queryParams.platform || 'web',
                appVersion: queryParams.appVersion || '1.0.0',
                deviceId: queryParams.deviceId || null,
                deviceInfo: queryParams.deviceInfo || null,
                connectedAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                lastHeartbeat: new Date().toISOString(),
                isActive: true,
                connectionType: 'REAL',
                source: userType === 'driver' ? 'driver_app' : 'business_app',
                ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
                authenticated: true,
                groups,
                email: verified.email || null
            }
        }));
        console.log(`Authenticated connection stored ${connectionId} userId=${userId} type=${userType}`);
        return { statusCode: 200, body: 'Connected' };
    } catch (error) {
        console.error('Error handling connection:', error);
        return { statusCode: 500, body: 'Failed to connect' };
    }
}

// Handle WebSocket disconnection
async function handleDisconnect(connectionId) {
    try {
        console.log(`WebSocket disconnection: ${connectionId}`);
        await dynamoDB.send(new DeleteCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        console.log(`Connection ${connectionId} removed successfully`);
        return {
            statusCode: 200,
            body: 'Disconnected'
        };
    } catch (error) {
        console.error('Error handling disconnection:', error);
        return {
            statusCode: 500,
            body: 'Failed to disconnect'
        };
    }
}

// Handle authentication
async function handleAuthentication(connectionId, message, apiGatewayClient) {
    try {
        const { userId, userType, token } = message;

        // Update connection with authentication info
        await dynamoDB.send(new UpdateCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET userId = :userId, userType = :userType, #token = :token, authenticatedAt = :authenticatedAt',
            ExpressionAttributeNames: {
                '#token': 'token'
            },
            ExpressionAttributeValues: {
                ':userId': userId,
                ':userType': userType,
                ':token': token,
                ':authenticatedAt': new Date().toISOString()
            }
        }));

        // Send authentication confirmation
        return await sendToConnection(connectionId, {
            type: 'auth_success',
            userId,
            userType,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);

    } catch (error) {
        console.error('Error handling authentication:', error);
        return await sendToConnection(connectionId, {
            type: 'auth_error',
            message: 'Authentication failed'
        }, apiGatewayClient);
    }
}

// Handle heartbeat
async function handleHeartbeat(connectionId, apiGatewayClient) {
    try {
        const now = new Date();
        // update connection lastHeartbeatAt (best-effort)
        try {
            await dynamoDB.send(new UpdateCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                Key: { connectionId },
                UpdateExpression: 'SET lastHeartbeatAt = :ts',
                ExpressionAttributeValues: { ':ts': now.toISOString() }
            }));
        } catch (e) { console.warn('heartbeat update failed', e.message || e); }
        const heartbeatResponse = { type: 'heartbeat_response', timestamp: now.toISOString(), connectionId, serverTime: now.toISOString() };
        return await sendToConnection(connectionId, heartbeatResponse, apiGatewayClient);
    } catch (error) {
        console.error(`Failed to send heartbeat response to ${connectionId}:`, error);
        return { statusCode: 500, body: 'Failed to send heartbeat' };
    }
}

// Live Chat Support Functions
async function handleDriverChatConnect(connectionId, message, apiGatewayClient) {
    try {
        const { driverId, driverName, driverPhone, sessionId: clientSessionId } = message;

        // Use client-provided sessionId if available, otherwise generate one
        const sessionId = clientSessionId || `session_${driverId}_${Date.now()}`;

        // Store driver connection (preserve auth)
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userId: driverId,
                userType: 'driver',
                sessionId,
                connectedAt: new Date().toISOString(),
                driverInfo: {
                    name: driverName,
                    phone: driverPhone
                },
                authenticated: true,
                ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
            }
        }));

        // Create chat session record
        await dynamoDB.send(new PutCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Item: {
                sessionId,
                driverId,
                driverName,
                driverPhone,
                status: 'waiting_for_agent',
                createdAt: new Date().toISOString(),
                userType: 'driver',
                source: 'wizzdriver_app',
                userDisplayName: driverName,
                messages: []
            }
        }));

        // Notify all agents about new chat session
        await notifyAgentsOfNewSession(sessionId, {
            driverId,
            driverName,
            driverPhone,
            userType: 'driver',
            source: 'wizzdriver_app',
            userDisplayName: driverName
        }, apiGatewayClient);

        // Send confirmation to driver
        const response = {
            type: 'chat_session_created',
            sessionId,
            status: 'waiting_for_agent',
            message: 'Connected to support. An agent will be with you shortly.'
        };

        return await sendToConnection(connectionId, response, apiGatewayClient);

    } catch (error) {
        console.error('Error handling driver chat connect:', error);
        return await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to connect to chat'
        }, apiGatewayClient);
    }
}

async function handleAgentChatConnect(connectionId, message, apiGatewayClient) {
    try {
        const { agentId, agentName, sessionId } = message;

        // Store agent connection (preserve auth)
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userId: agentId,
                userType: 'agent',
                sessionId: sessionId || null,
                connectedAt: new Date().toISOString(),
                agentInfo: {
                    name: agentName
                },
                authenticated: true,
                ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
            }
        }));

        // If joining a specific session, update the session
        if (sessionId) {
            await dynamoDB.send(new UpdateCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Key: { sessionId },
                UpdateExpression: 'SET agentId = :agentId, agentName = :agentName, #status = :status, agentJoinedAt = :agentJoinedAt',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':agentId': agentId,
                    ':agentName': agentName,
                    ':status': 'active',
                    ':agentJoinedAt': new Date().toISOString()
                }
            }));

            // Notify driver that agent has joined
            await notifyDriverOfAgentJoin(sessionId, { agentId, agentName }, apiGatewayClient);
        }

        // Send confirmation to agent
        const response = {
            type: 'agent_connected',
            sessionId,
            message: sessionId ? 'Joined chat session' : 'Connected to support system'
        };

        await sendToConnection(connectionId, response, apiGatewayClient);

        // PHASE 1 STEP 1: Push list of currently active / waiting sessions to the agent upon connect
        try {
            const activeSessionsPayload = await getActiveChatSessions();
            await sendToConnection(connectionId, {
                type: 'active_sessions',
                sessions: activeSessionsPayload,
                timestamp: new Date().toISOString()
            }, apiGatewayClient);
        } catch (activeErr) {
            console.error('Failed to send active_sessions to agent', activeErr);
        }

        return {
            statusCode: 200,
            body: 'Agent connected'
        };

    } catch (error) {
        console.error('Error handling agent chat connect:', error);
        return await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to connect agent to chat'
        }, apiGatewayClient);
    }
}

async function handleMerchantChatConnect(connectionId, message, apiGatewayClient) {
    try {
        const { merchantId, merchantName, merchantEmail, sessionId: clientSessionId } = message;

        // Use client-provided sessionId if available, otherwise generate one
        const sessionId = clientSessionId || `merchant_session_${merchantId}_${Date.now()}`;

        console.log(`🏪 Merchant connecting: ${merchantName} (${merchantId})`);
        console.log(`📧 Email: ${merchantEmail}`);
        console.log(`🔑 Session ID: ${sessionId}`);

        // Store merchant connection (preserve auth)
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userId: merchantId,
                userType: 'merchant',
                sessionId,
                connectedAt: new Date().toISOString(),
                merchantInfo: {
                    name: merchantName,
                    email: merchantEmail
                },
                authenticated: true,
                ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
            }
        }));

        console.log(`✅ Merchant connection stored in ${WEBSOCKET_CONNECTIONS_TABLE}`);

        // Create chat session record
        await dynamoDB.send(new PutCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Item: {
                sessionId,
                merchantId,
                merchantName,
                merchantEmail,
                userId: merchantId,
                userType: 'merchant',
                userDisplayName: merchantName,
                source: 'whizzMerchants',
                status: 'waiting_for_agent',
                createdAt: new Date().toISOString(),
                messages: []
            }
        }));

        console.log(`✅ Chat session created in ${CHAT_SESSIONS_TABLE}`);

        // Notify all agents about new merchant chat session
        await notifyAgentsOfNewSession(sessionId, { 
            merchantId, 
            merchantName, 
            merchantEmail,
            userType: 'merchant',
            source: 'whizzMerchants',
            userDisplayName: merchantName
        }, apiGatewayClient);

        console.log(`✅ Notified agents of new merchant session`);

        // Send confirmation to merchant
        const response = {
            type: 'chat_session_created',
            sessionId,
            status: 'waiting_for_agent',
            message: 'Connected to support. An agent will be with you shortly.'
        };

        return await sendToConnection(connectionId, response, apiGatewayClient);

    } catch (error) {
        console.error('❌ Error handling merchant chat connect:', error);
        return await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to connect to chat'
        }, apiGatewayClient);
    }
}

async function handleChatMessage(connectionId, message, apiGatewayClient) {
    try {
        const rawText = message.messageText ?? message.message ?? message.text;
        const { sessionId, senderType = 'driver', requestId } = message;
        const sanitized = sanitizeChatContent(rawText);
        if (!sessionId || !sanitized) {
            return await sendToConnection(connectionId, { type: 'error', message: 'Missing sessionId or messageText' }, apiGatewayClient);
        }
        // Fetch session
        const getRes = await dynamoDB.send(new GetCommand({ TableName: CHAT_SESSIONS_TABLE, Key: { sessionId } }));
        const sessionRecord = getRes.Item;
        if (!sessionRecord) {
            return await sendToConnection(connectionId, { type: 'error', message: 'Session not found' }, apiGatewayClient);
        }
        if (sessionRecord.status === 'closed') {
            return await sendToConnection(connectionId, { type: 'error', message: 'Session closed' }, apiGatewayClient);
        }
        const now = Date.now();
        const nowIso = new Date(now).toISOString();
        const messageId = `msg_${now}_${Math.random().toString(36).slice(2,9)}`;
        const messageKey = `t#${now}#${messageId}`; // for ordered queries
        const chatMessageItem = {
            sessionId,
            messageKey,
            messageId,
            senderType,
            text: sanitized,
            createdAt: nowIso,
            ttl: Math.floor(now / 1000) + 60 * 60 * 24 * 30 // 30 days
        };
        // Persist message in messages table
        await dynamoDB.send(new PutCommand({ TableName: CHAT_MESSAGES_TABLE, Item: chatMessageItem }));
        // Update session metadata (first message timestamps + lastMessageAt + unread counters)
        const updates = [];
        const exprValues = { ':lastMessageAt': nowIso };
        updates.push('lastMessageAt = :lastMessageAt');
        if (senderType === 'driver' && !sessionRecord.driverFirstMessageAt) {
            updates.push('driverFirstMessageAt = :firstDriver');
            exprValues[':firstDriver'] = nowIso;
        }
        if (senderType === 'agent' && !sessionRecord.agentFirstResponseAt) {
            updates.push('agentFirstResponseAt = :firstAgent');
            exprValues[':firstAgent'] = nowIso;
        }
        // Apply SET updates (no ExpressionAttributeNames needed for these simple attributes)
        if (updates.length) {
            await dynamoDB.send(new UpdateCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Key: { sessionId },
                UpdateExpression: `SET ${updates.join(', ')}`,
                ExpressionAttributeValues: exprValues
            }));
        }
        // Increment unread counter for the opposite party
        try {
            if (senderType === 'driver') {
                await dynamoDB.send(new UpdateCommand({
                    TableName: CHAT_SESSIONS_TABLE,
                    Key: { sessionId },
                    UpdateExpression: 'ADD unreadAgent :one',
                    ExpressionAttributeValues: { ':one': 1 }
                }));
            } else if (senderType === 'agent') {
                await dynamoDB.send(new UpdateCommand({
                    TableName: CHAT_SESSIONS_TABLE,
                    Key: { sessionId },
                    UpdateExpression: 'ADD unreadDriver :one',
                    ExpressionAttributeValues: { ':one': 1 }
                }));
            }
        } catch (e) { console.warn('Unread counter update failed', e.message || e); }
        // Broadcast
        const sessionUserType = sessionRecord?.userType || (sessionRecord?.merchantId ? 'merchant' : 'driver');
        const sessionSource = sessionRecord?.source || (sessionUserType === 'merchant' ? 'whizzMerchants' : 'wizzdriver_app');
        const outbound = {
            type: 'chat_message',
            sessionId,
            userType: sessionUserType,
            source: sessionSource,
            merchantName: sessionRecord?.merchantName || null,
            merchantEmail: sessionRecord?.merchantEmail || null,
            driverName: sessionRecord?.driverName || null,
            driverPhone: sessionRecord?.driverPhone || null,
            metadata: {
                userType: sessionUserType,
                source: sessionSource,
                merchantName: sessionRecord?.merchantName || null,
                merchantEmail: sessionRecord?.merchantEmail || null,
                driverName: sessionRecord?.driverName || null,
                driverPhone: sessionRecord?.driverPhone || null
            },
            message: {
                messageId,
                sessionId,
                messageKey,
                senderType,
                text: sanitized,
                createdAt: nowIso
            }
        };
        await broadcastToSession(sessionId, outbound, apiGatewayClient);
        // Ack to sender if requestId supplied
        if (requestId) {
            await sendToConnection(connectionId, { type: 'ack', requestId, messageId, sessionId }, apiGatewayClient);
        }
        return { statusCode: 200, body: 'Message stored' };
    } catch (error) {
        console.error('Error handling chat message (refactored):', error);
        return await sendToConnection(connectionId, { type: 'error', message: 'Failed to send message' }, apiGatewayClient);
    }
}

async function handleTypingIndicator(connectionId, message, apiGatewayClient) {
    try {
        const { sessionId, isTyping, senderType } = message;
        // Fetch session status to guard against closed sessions
        let sessionRecord = null;
        try {
            const getRes = await dynamoDB.send(new GetCommand({ TableName: CHAT_SESSIONS_TABLE, Key: { sessionId } }));
            sessionRecord = getRes.Item || null;
        } catch (e) {
            console.warn('handleTypingIndicator: failed to fetch session', e.message || e);
        }
        if (!sessionRecord || sessionRecord.status === 'closed') {
            return { statusCode: 200, body: 'Typing ignored (session closed or missing)' };
        }

        // Broadcast typing indicator to other participants
        await broadcastToSession(sessionId, {
            type: 'typing_indicator',
            sessionId,
            isTyping,
            senderType,
            timestamp: new Date().toISOString()
        }, apiGatewayClient, [connectionId]); // Exclude sender

        return {
            statusCode: 200,
            body: 'Typing indicator sent'
        };

    } catch (error) {
        console.error('Error handling typing indicator:', error);
        return {
            statusCode: 500,
            body: 'Failed to send typing indicator'
        };
    }
}

async function handleChatSessionClose(connectionId, message, apiGatewayClient) {
    try {
        const { sessionId, closedByUserType = 'agent', closedByUserId } = message;
        // Fetch session first
        let sessionRecord = null;
        try {
            const getRes = await dynamoDB.send(new GetCommand({ TableName: CHAT_SESSIONS_TABLE, Key: { sessionId } }));
            sessionRecord = getRes.Item || null;
        } catch (e) {
            console.warn('handleChatSessionClose: failed to fetch session', e.message || e);
        }
        if (!sessionRecord) {
            return await sendToConnection(connectionId, { type: 'error', message: 'Session not found' }, apiGatewayClient);
        }
        if (sessionRecord.status === 'closed') {
            // Idempotent: already closed, send ack again (no broadcast needed) and return
            await sendToConnection(connectionId, { type: 'chat_session_close_ack', sessionId, alreadyClosed: true, timestamp: new Date().toISOString() }, apiGatewayClient);
            return { statusCode: 200, body: 'Session already closed' };
        }

        // Immediate ACK to requester so UI can move to closing state
        await sendToConnection(connectionId, { type: 'chat_session_close_ack', sessionId, timestamp: new Date().toISOString() }, apiGatewayClient);

        const nowIso = new Date().toISOString();
        // Update session status (only if not already closed)
        try {
            await dynamoDB.send(new UpdateCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Key: { sessionId },
                UpdateExpression: 'SET #status = :status, closedAt = :closedAt, closedByUserType = :closedByUserType, closedByUserId = :closedByUserId',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': 'closed',
                    ':closedAt': nowIso,
                    ':closedByUserType': closedByUserType,
                    ':closedByUserId': closedByUserId || null
                }
            }));
        } catch (e) {
            console.error('handleChatSessionClose update failed', e);
        }

        // Final broadcast
        await broadcastToSession(sessionId, {
            type: 'session_closed',
            sessionId,
            closedAt: nowIso,
            closedByUserType,
            closedByUserId: closedByUserId || null,
            timestamp: nowIso
        }, apiGatewayClient);

        return {
            statusCode: 200,
            body: 'Session closed'
        };

    } catch (error) {
        console.error('Error handling session close:', error);
        return {
            statusCode: 500,
            body: 'Failed to close session'
        };
    }
}

async function handleSyncSessions(connectionId, message, apiGatewayClient) {
    try {
        const { since } = message;
        const sinceTs = since ? new Date(since).getTime() : 0;
        const scanResult = await dynamoDB.send(new ScanCommand({ TableName: CHAT_SESSIONS_TABLE }));
        let sessions = (scanResult.Items || []);
        // Filter to sessions of interest: active, waiting, or recently closed (< 2h) and changed after since
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        sessions = sessions.filter(s => {
            const status = s.status;
            const lastChange = new Date(s.lastMessageAt || s.closedAt || s.updatedAt || s.createdAt || 0).getTime();
            if (sinceTs && lastChange <= sinceTs) return false; // not changed since
            if (status === 'waiting_for_agent' || status === 'active') return true;
            if (status === 'closed') return (lastChange >= twoHoursAgo); // recently closed
            return false;
        }).map(item => {
            const userType = item.userType || (item.merchantId ? 'merchant' : 'driver');
            const source = item.source || (userType === 'merchant' ? 'whizzMerchants' : 'wizzdriver_app');
            const userDisplayName = item.userDisplayName || (userType === 'merchant'
                ? (item.merchantName || item.merchantEmail)
                : (item.driverName || item.driverPhone));
            return {
                sessionId: item.sessionId,
                driverId: item.driverId || null,
                driverName: item.driverName || null,
                driverPhone: item.driverPhone || null,
                merchantId: item.merchantId || null,
                merchantName: item.merchantName || null,
                merchantEmail: item.merchantEmail || null,
                userDisplayName,
                userType,
                source,
                status: item.status,
                createdAt: item.createdAt,
                lastMessageAt: item.lastMessageAt || item.createdAt,
                closedAt: item.closedAt || null,
                agentId: item.agentId || null,
                agentName: item.agentName || null,
                messages: Array.isArray(item.messages) ? item.messages.slice(-40) : [],
                metadata: {
                    source,
                    userType,
                    merchantName: item.merchantName || null,
                    merchantEmail: item.merchantEmail || null,
                    driverName: item.driverName || null,
                    driverPhone: item.driverPhone || null
                }
            };
        });
        // Sort latest first
        sessions.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
        await sendToConnection(connectionId, { type: 'active_sessions', delta: true, since, count: sessions.length, sessions, timestamp: new Date().toISOString() }, apiGatewayClient);
        return { statusCode: 200, body: 'Sync sent' };
    } catch (e) {
        console.error('handleSyncSessions failed', e);
        return await sendToConnection(connectionId, { type: 'error', message: 'Failed to sync sessions' }, apiGatewayClient);
    }
}

async function handleGetSessionMessages(connectionId, message, apiGatewayClient) {
    try {
        const { sessionId, limit = 30, cursor } = message;
        if (!sessionId) return await sendToConnection(connectionId, { type: 'error', message: 'sessionId required' }, apiGatewayClient);
        const queryParams = {
            TableName: CHAT_MESSAGES_TABLE,
            KeyConditionExpression: 'sessionId = :sid',
            ExpressionAttributeValues: { ':sid': sessionId },
            Limit: Math.min(limit, 100),
            ScanIndexForward: false // newest first
        };
        if (cursor) {
            queryParams.ExclusiveStartKey = { sessionId, messageKey: cursor };
        }
        const res = await dynamoDB.send(new QueryCommand(queryParams));
        const items = res.Items || [];
        const nextCursor = res.LastEvaluatedKey ? res.LastEvaluatedKey.messageKey : null;
        return await sendToConnection(connectionId, {
            type: 'session_messages',
            sessionId,
            messages: items.map(i => ({
                messageId: i.messageId,
                messageKey: i.messageKey,
                senderType: i.senderType,
                text: i.text,
                createdAt: i.createdAt
            })),
            nextCursor
        }, apiGatewayClient);
    } catch (e) {
        console.error('handleGetSessionMessages failed', e);
        return await sendToConnection(connectionId, { type: 'error', message: 'Failed to load messages' }, apiGatewayClient);
    }
}

async function handleAck(connectionId, message, apiGatewayClient) {
    // Currently stateless; placeholder for future delivery tracking
    try {
        const { requestId, messageId } = message;
        if (!requestId && !messageId) return { statusCode: 200, body: 'Nothing to ack' };
        return await sendToConnection(connectionId, { type: 'ack_received', requestId, messageId, ts: new Date().toISOString() }, apiGatewayClient);
    } catch (e) {
        console.error('handleAck failed', e);
        return { statusCode: 500, body: 'Ack failed' };
    }
}

// Helper functions
async function sendToConnection(connectionId, data, apiGatewayClient) {
    try {
        const command = new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify(data)
        });

        await apiGatewayClient.send(command);
        console.log(`Message sent to connection ${connectionId}`);

        return {
            statusCode: 200,
            body: 'Message sent'
        };
    } catch (error) {
        if (error.statusCode === 410) {
            console.log(`Connection ${connectionId} is stale, removing from database`);
            await dynamoDB.send(new DeleteCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                Key: { connectionId }
            }));
        } else {
            console.error(`Failed to send message to ${connectionId}:`, error);
        }
        throw error;
    }
}

async function broadcastToSession(sessionId, data, apiGatewayClient, excludeConnections = []) {
    try {
        // Get all connections for this session OR all agents
        const result = await dynamoDB.send(new ScanCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            FilterExpression: 'sessionId = :sessionId OR userType = :agent',
            ExpressionAttributeValues: {
                ':sessionId': sessionId,
                ':agent': 'agent'
            }
        }));

        const connections = result.Items || [];
        const sendPromises = connections
            .filter(conn => !excludeConnections.includes(conn.connectionId))
            .map(conn => sendToConnection(conn.connectionId, data, apiGatewayClient).catch(error => {
                console.error(`Failed to send to ${conn.connectionId}:`, error);
            }));

        await Promise.all(sendPromises);
        console.log(`Broadcasted message to ${sendPromises.length} connections in session ${sessionId} (including agents)`);

    } catch (error) {
        console.error('Error broadcasting to session:', error);
    }
}

async function notifyAgentsOfNewSession(sessionId, sessionInfo, apiGatewayClient) {
    try {
        // Get all agent connections
        const result = await dynamoDB.send(new ScanCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            FilterExpression: 'userType = :userType',
            ExpressionAttributeValues: {
                ':userType': 'agent'
            }
        }));

        const agentConnections = result.Items || [];
        const payload = {
            sessionId,
            userType: sessionInfo.userType || (sessionInfo.merchantId ? 'merchant' : 'driver'),
            source: sessionInfo.source || ((sessionInfo.userType || '').toLowerCase() === 'merchant' ? 'whizzMerchants' : 'wizzdriver_app'),
            driverId: sessionInfo.driverId || null,
            driverName: sessionInfo.driverName || null,
            driverPhone: sessionInfo.driverPhone || null,
            merchantId: sessionInfo.merchantId || null,
            merchantName: sessionInfo.merchantName || sessionInfo.userDisplayName || null,
            merchantEmail: sessionInfo.merchantEmail || null,
            userDisplayName: sessionInfo.userDisplayName || sessionInfo.merchantName || sessionInfo.driverName || 'User'
        };
        const notificationData = {
            type: 'new_chat_session',
            sessionId,
            userType: payload.userType,
            source: payload.source,
            driverName: payload.driverName,
            merchantName: payload.merchantName,
            merchantEmail: payload.merchantEmail,
            metadata: {
                source: payload.source,
                userType: payload.userType,
                merchantName: payload.merchantName,
                merchantEmail: payload.merchantEmail,
                driverName: payload.driverName,
                driverPhone: payload.driverPhone
            },
            payload,
            timestamp: new Date().toISOString()
        };

        const sendPromises = agentConnections.map(conn =>
            sendToConnection(conn.connectionId, notificationData, apiGatewayClient).catch(error => {
                console.error(`Failed to notify agent ${conn.connectionId}:`, error);
            })
        );

        await Promise.all(sendPromises);
        console.log(`Notified ${agentConnections.length} agents of new session ${sessionId}`);

    } catch (error) {
        console.error('Error notifying agents:', error);
    }
}

async function notifyDriverOfAgentJoin(sessionId, agentInfo, apiGatewayClient) {
    try {
        // Get driver connection for this session
        const result = await dynamoDB.send(new ScanCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            FilterExpression: 'sessionId = :sessionId AND userType = :userType',
            ExpressionAttributeValues: {
                ':sessionId': sessionId,
                ':userType': 'driver'
            }
        }));

        const driverConnections = result.Items || [];
        const notificationData = {
            type: 'agent_joined',
            sessionId,
            agentInfo,
            timestamp: new Date().toISOString()
        };

        const sendPromises = driverConnections.map(conn =>
            sendToConnection(conn.connectionId, notificationData, apiGatewayClient).catch(error => {
                console.error(`Failed to notify driver ${conn.connectionId}:`, error);
            })
        );

        await Promise.all(sendPromises);
        console.log(`Notified ${driverConnections.length} drivers of agent join in session ${sessionId}`);

    } catch (error) {
        console.error('Error notifying driver:', error);
    }
}

async function getActiveChatSessions(limit = 25, msgLimit = 40) {
    try {
        // Scan for sessions with status waiting_for_agent or active
        const scanResult = await dynamoDB.send(new ScanCommand({
            TableName: CHAT_SESSIONS_TABLE,
            // Use OR expression because IN not directly supported in expressions
            FilterExpression: '#status = :waiting OR #status = :active',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':waiting': 'waiting_for_agent', ':active': 'active' }
        }));

        let sessions = (scanResult.Items || []).map(item => ({
            sessionId: item.sessionId,
            userType: item.userType || 'driver',
            merchantId: item.merchantId,
            merchantName: item.merchantName,
            merchantEmail: item.merchantEmail,
            userId: item.userId,
            driverId: item.driverId,
            driverName: item.driverName,
            driverPhone: item.driverPhone,
            userDisplayName: item.userDisplayName || item.driverName || item.merchantName,
            source: item.source || 'wizzdriver_app',
            status: item.status,
            createdAt: item.createdAt,
            lastMessageAt: item.lastMessageAt || item.createdAt,
            agentId: item.agentId || null,
            agentName: item.agentName || null,
            unreadDriver: item.unreadDriver || 0,
            unreadAgent: item.unreadAgent || 0,
            messages: [] // messages no longer embedded
        }));

        // Sort by lastMessageAt desc (fallback createdAt)
        sessions.sort((a, b) => new Date(b.lastMessageAt || b.createdAt || 0) - new Date(a.lastMessageAt || a.createdAt || 0));
        if (sessions.length > limit) sessions = sessions.slice(0, limit);
        return sessions;
    } catch (e) {
        console.error('getActiveChatSessions failed', e);
        return [];
    }
}

function sanitizeChatContent(text) {
    if (typeof text !== 'string') return '';
    let t = text.trim();
    // Basic length limit
    if (t.length > 4000) t = t.slice(0, 4000);
    // Strip simple script tags
    t = t.replace(/<script.*?>.*?<\/script>/gi, '[removed]');
    // Remove dangerous on* attributes (very naive)
    t = t.replace(/on[a-z]+="[^"]*"/gi, '');
    return t;
}

// Helper function to get connections for a business
async function getBusinessConnections(businessId) {
    try {
        const result = await dynamoDB.send(new QueryCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            IndexName: 'BusinessIdIndex',
            KeyConditionExpression: 'businessId = :businessId',
            ExpressionAttributeValues: {
                ':businessId': businessId
            }
        }));
        
        return result.Items || [];
    } catch (error) {
        console.error('❌ Error getting business connections:', error);
        return [];
    }
}

// ==============================================
// DRIVER ASSIGNMENT HANDLERS
// ==============================================

/**
 * Handle driver assignment response (accept/decline)
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

        // Notify the assignment service about the driver response
        const { handleDriverResponse } = require('../services/driver-assignment-service');
        handleDriverResponse(orderId, driverId, response, reason, estimatedPickupTime);

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
        // 🚗 Get driver info to add to order
        let driverInfo = {};
        try {
            const driverResult = await dynamoDB.send(new GetCommand({
                TableName: 'WhizzDrivers_dev',
                Key: { driverId }
            }));
            
            const driver = driverResult.Item;
            if (driver) {
                driverInfo = {
                    driverName: driver.name || null,
                    driverPhone: driver.phoneNumber || driver.phone || null,
                    vehicleType: driver.vehicleType || null,
                    vehiclePlate: driver.licenseNumber || driver.vehiclePlate || null
                };
                console.log(`🚗 Driver info loaded:`, driverInfo);
            }
        } catch (error) {
            console.warn(`⚠️ Could not fetch driver info: ${error.message}`);
        }
        
        // Build update expression
        const updateExpression = driverInfo.driverName
            ? `SET driverId = :driverId, 
                    #status = :status, 
                    assignedAt = :assignedAt,
                    estimatedPickupTime = :estimatedPickupTime,
                    updatedAt = :updatedAt,
                    driverName = :driverName,
                    driverPhone = :driverPhone,
                    vehicleType = :vehicleType,
                    vehiclePlate = :vehiclePlate`
            : `SET driverId = :driverId, 
                    #status = :status, 
                    assignedAt = :assignedAt,
                    estimatedPickupTime = :estimatedPickupTime,
                    updatedAt = :updatedAt`;
        
        const expressionValues = {
            ':driverId': driverId,
            ':status': 'assigned_to_driver',
            ':assignedAt': new Date().toISOString(),
            ':estimatedPickupTime': estimatedPickupTime || new Date(Date.now() + 15 * 60000).toISOString(),
            ':updatedAt': new Date().toISOString()
        };
        
        if (driverInfo.driverName) {
            Object.assign(expressionValues, {
                ':driverName': driverInfo.driverName,
                ':driverPhone': driverInfo.driverPhone,
                ':vehicleType': driverInfo.vehicleType,
                ':vehiclePlate': driverInfo.vehiclePlate
            });
        }
        
        // Update order with driver assignment and driver info
        await dynamoDB.send(new UpdateCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            },
            UpdateExpression: updateExpression,
            ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(driverId)',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: expressionValues
        }));

        // Update driver status to busy
        await dynamoDB.send(new UpdateCommand({
            TableName: DRIVERS_TABLE,
            Key: {
                PK: `DRIVER#${driverId}`,
                SK: `DRIVER#${driverId}`
            },
            UpdateExpression: 'SET #status = :status, currentOrderId = :orderId, updatedAt = :updatedAt',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'busy',
                ':orderId': orderId,
                ':updatedAt': new Date().toISOString()
            }
        }));

        // Notify all relevant parties
        await notifyOrderStatusChange(orderId, 'assigned_to_driver', { driverId, estimatedPickupTime }, apiGatewayClient);

        console.log(`✅ Order ${orderId} successfully assigned to driver ${driverId}`);
    } catch (error) {
        console.error(`❌ Error processing driver acceptance:`, error);
        throw error;
    }
}

/**
 * Handle driver decline of assignment
 */
async function handleDriverDecline(orderId, driverId, reason, apiGatewayClient) {
    console.log(`❌ Driver ${driverId} declined order ${orderId}, reason: ${reason}`);
    
    try {
        // Log the decline for analytics
        console.log(`📊 Assignment declined - Order: ${orderId}, Driver: ${driverId}, Reason: ${reason}`);

        // Note: The assignDriverToOrder will be called through handleDriverResponse
        // No need to call it here to avoid double assignment attempts
    } catch (error) {
        console.error(`❌ Error processing driver decline:`, error);
        throw error;
    }
}

/**
 * Handle driver location updates
 */
async function handleDriverLocationUpdate(connectionId, message, apiGatewayClient) {
    try {
        const { latitude, longitude, heading, speed } = message;
        
        if (!latitude || !longitude) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Missing required location data: latitude, longitude'
            }, apiGatewayClient);
        }

        const connection = await getConnection(connectionId);
        if (!connection) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Driver connection not found'
            }, apiGatewayClient);
        }

        const driverId = connection.userId;

        // Update driver location in database
        await dynamoDB.send(new UpdateCommand({
            TableName: DRIVERS_TABLE,
            Key: {
                PK: `DRIVER#${driverId}`,
                SK: `DRIVER#${driverId}`
            },
            UpdateExpression: `
                SET latitude = :latitude, 
                    longitude = :longitude, 
                    heading = :heading, 
                    speed = :speed,
                    lastLocationUpdate = :timestamp,
                    updatedAt = :updatedAt
            `,
            ExpressionAttributeValues: {
                ':latitude': latitude,
                ':longitude': longitude,
                ':heading': heading || 0,
                ':speed': speed || 0,
                ':timestamp': new Date().toISOString(),
                ':updatedAt': new Date().toISOString()
            }
        }));

        // If driver has an active order, notify customer of location update
        const driver = await getDriverInfo(driverId);
        if (driver && driver.currentOrderId) {
            await notifyCustomerOfDriverLocation(driver.currentOrderId, {
                latitude,
                longitude,
                heading,
                speed,
                driverId
            }, apiGatewayClient);
        }

        // Send confirmation to driver
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
 * Handle driver status updates (online, offline, busy, break)
 */
async function handleDriverStatusUpdate(connectionId, message, apiGatewayClient) {
    try {
        const { status } = message;
        const validStatuses = ['online', 'offline', 'busy', 'break'];
        
        if (!status || !validStatuses.includes(status)) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
            }, apiGatewayClient);
        }

        const connection = await getConnection(connectionId);
        if (!connection) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Driver connection not found'
            }, apiGatewayClient);
        }

        const driverId = connection.userId;

        // Update driver status
        await dynamoDB.send(new UpdateCommand({
            TableName: DRIVERS_TABLE,
            Key: {
                PK: `DRIVER#${driverId}`,
                SK: `DRIVER#${driverId}`
            },
            UpdateExpression: 'SET #status = :status, lastStatusUpdate = :timestamp, updatedAt = :updatedAt',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': status,
                ':timestamp': new Date().toISOString(),
                ':updatedAt': new Date().toISOString()
            }
        }));

        console.log(`🔄 Driver ${driverId} status updated to: ${status}`);

        // Send confirmation to driver
        await sendToConnection(connectionId, {
            type: 'status_update_confirmed',
            status,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);

    } catch (error) {
        console.error('❌ Error handling status update:', error);
        await sendToConnection(connectionId, {
            type: 'error',
            message: 'Failed to update status'
        }, apiGatewayClient);
    }
}

/**
 * Handle order status updates from drivers
 */
async function handleOrderStatusUpdate(connectionId, message, apiGatewayClient) {
    try {
        const { orderId, status, location } = message;
        const validStatuses = ['picked_up', 'on_the_way', 'delivered', 'cancelled'];
        
        if (!orderId || !status || !validStatuses.includes(status)) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: `Missing or invalid data. Status must be one of: ${validStatuses.join(', ')}`
            }, apiGatewayClient);
        }

        const connection = await getConnection(connectionId);
        if (!connection) {
            return await sendToConnection(connectionId, {
                type: 'error',
                message: 'Driver connection not found'
            }, apiGatewayClient);
        }

        const driverId = connection.userId;

        // Update order status
        const updateExpression = 'SET #status = :status, updatedAt = :updatedAt';
        const expressionAttributeValues = {
            ':status': status,
            ':updatedAt': new Date().toISOString()
        };

        // Add specific fields based on status
        let updateExpr = updateExpression;
        if (status === 'picked_up') {
            updateExpr += ', pickedUpAt = :pickedUpAt';
            expressionAttributeValues[':pickedUpAt'] = new Date().toISOString();
        } else if (status === 'delivered') {
            updateExpr += ', deliveredAt = :deliveredAt';
            expressionAttributeValues[':deliveredAt'] = new Date().toISOString();
            
            // Also update driver status back to online
            await dynamoDB.send(new UpdateCommand({
                TableName: DRIVERS_TABLE,
                Key: {
                    PK: `DRIVER#${driverId}`,
                    SK: `DRIVER#${driverId}`
                },
                UpdateExpression: 'REMOVE currentOrderId SET #status = :status, updatedAt = :updatedAt',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':status': 'online',
                    ':updatedAt': new Date().toISOString()
                }
            }));
        }

        await dynamoDB.send(new UpdateCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            },
            UpdateExpression: updateExpr,
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ...expressionAttributeValues,
                ':driverId': driverId
            },
            ConditionExpression: 'driverId = :driverId'
        }));

        // Notify all relevant parties of the status change
        await notifyOrderStatusChange(orderId, status, { driverId, location }, apiGatewayClient);

        console.log(`📦 Order ${orderId} status updated to: ${status} by driver ${driverId}`);

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

// ==============================================
// HELPER FUNCTIONS FOR DRIVER ASSIGNMENT
// ==============================================

async function getConnection(connectionId) {
    try {
        const result = await dynamoDB.send(new GetCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        return result.Item || null;
    } catch (error) {
        console.error('Error getting connection:', error);
        return null;
    }
}

async function getDriverInfo(driverId) {
    try {
        const result = await dynamoDB.send(new GetCommand({
            TableName: DRIVERS_TABLE,
            Key: {
                PK: `DRIVER#${driverId}`,
                SK: `DRIVER#${driverId}`
            }
        }));
        return result.Item;
    } catch (error) {
        console.error('Error getting driver info:', error);
        return null;
    }
}

async function notifyOrderStatusChange(orderId, status, data, apiGatewayClient) {
    try {
        // Get order details to find customer and restaurant
        const orderResult = await dynamoDB.send(new GetCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            }
        }));

        if (!orderResult.Item) return;

        const order = orderResult.Item;
        const message = {
            type: 'order_status_change',
            orderId,
            status,
            timestamp: new Date().toISOString(),
            ...data
        };

        // Notify customer
        if (order.customerId) {
            await notifyUser(order.customerId, message, apiGatewayClient);
        }

        // Notify restaurant
        if (order.restaurantId) {
            await notifyUser(order.restaurantId, message, apiGatewayClient);
        }

        // Notify admin/support
        await notifyUsersByType('agent', message, apiGatewayClient);

    } catch (error) {
        console.error('Error notifying order status change:', error);
    }
}

async function notifyCustomerOfDriverLocation(orderId, locationData, apiGatewayClient) {
    try {
        // Get order to find customer
        const orderResult = await dynamoDB.send(new GetCommand({
            TableName: ORDERS_TABLE,
            Key: {
                PK: `ORDER#${orderId}`,
                SK: `ORDER#${orderId}`
            }
        }));

        if (!orderResult.Item) return;

        const message = {
            type: 'driver_location_update',
            orderId,
            ...locationData,
            timestamp: new Date().toISOString()
        };

        // Notify customer
        if (orderResult.Item.customerId) {
            await notifyUser(orderResult.Item.customerId, message, apiGatewayClient);
        }

    } catch (error) {
        console.error('Error notifying customer of driver location:', error);
    }
}

async function notifyUser(userId, message, apiGatewayClient) {
    try {
        // Find user connections
        const result = await dynamoDB.send(new ScanCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            FilterExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': userId
            }
        }));

        // Send message to all user connections
        for (const connection of result.Items || []) {
            await sendToConnection(connection.connectionId, message, apiGatewayClient);
        }
    } catch (error) {
        console.error(`Error notifying user ${userId}:`, error);
    }
}

async function notifyUsersByType(userType, message, apiGatewayClient) {
    try {
        // Find connections by user type
        const result = await dynamoDB.send(new ScanCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            FilterExpression: 'userType = :userType',
            ExpressionAttributeValues: {
                ':userType': userType
            }
        }));

        // Send message to all matching connections
        for (const connection of result.Items || []) {
            await sendToConnection(connection.connectionId, message, apiGatewayClient);
        }
    } catch (error) {
        console.error(`Error notifying users of type ${userType}:`, error);
    }
}

/**
 * Handle subscription requests (driver subscribes to order notifications)
 */
async function handleSubscribe(connectionId, message, apiGatewayClient) {
    try {
        const { subscriptionType, businessId, driverId, topic } = message;
        
        console.log(`📡 Creating subscription: ${subscriptionType} for driver ${driverId}`);
        
        // Get connection details
        const connResult = await dynamoDB.send(new GetCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        
        if (!connResult.Item) {
            console.error(`Connection ${connectionId} not found`);
            return await sendToConnection(connectionId, {
                type: 'subscription_error',
                message: 'Connection not found'
            }, apiGatewayClient);
        }
        
        const connection = connResult.Item;
        const userId = connection.userId || driverId;
        const userType = connection.userType || 'driver';
        
        // Create subscription record
        const subscriptionId = `${connectionId}_${subscriptionType}_${Date.now()}`;
        const subscriptionItem = {
            subscriptionId,
            connectionId,
            userId,
            userType,
            entityType: userType,
            subscriptionType: subscriptionType || 'driver_orders',
            businessId: businessId || connection.businessId,
            driverId: driverId || userId,
            topic: topic || `driver:${userId}:orders`,
            isActive: true,
            createdAt: new Date().toISOString(),
            lastUpdate: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
        };
        
        // Store subscription
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_SUBSCRIPTIONS_TABLE,
            Item: subscriptionItem
        }));
        
        console.log(`✅ Subscription created: ${subscriptionId}`);
        
        // Send confirmation
        return await sendToConnection(connectionId, {
            type: 'subscription_confirmed',
            subscriptionId,
            subscriptionType,
            topic,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
    } catch (error) {
        console.error(`Error creating subscription for ${connectionId}:`, error);
        return await sendToConnection(connectionId, {
            type: 'subscription_error',
            message: error.message
        }, apiGatewayClient);
    }
}

/**
 * Handle unsubscription requests
 */
async function handleUnsubscribe(connectionId, message, apiGatewayClient) {
    try {
        const { subscriptionId, subscriptionType } = message;
        
        console.log(`📡 Removing subscription: ${subscriptionId || subscriptionType}`);
        
        if (subscriptionId) {
            // Remove specific subscription
            await dynamoDB.send(new UpdateCommand({
                TableName: WEBSOCKET_SUBSCRIPTIONS_TABLE,
                Key: { subscriptionId },
                UpdateExpression: 'SET isActive = :isActive, disconnectedAt = :timestamp',
                ExpressionAttributeValues: {
                    ':isActive': false,
                    ':timestamp': new Date().toISOString()
                }
            }));
        } else {
            // Remove all subscriptions for this connection
            const result = await dynamoDB.send(new ScanCommand({
                TableName: WEBSOCKET_SUBSCRIPTIONS_TABLE,
                FilterExpression: 'connectionId = :connectionId AND isActive = :isActive',
                ExpressionAttributeValues: {
                    ':connectionId': connectionId,
                    ':isActive': true
                }
            }));
            
            for (const sub of result.Items || []) {
                await dynamoDB.send(new UpdateCommand({
                    TableName: WEBSOCKET_SUBSCRIPTIONS_TABLE,
                    Key: { subscriptionId: sub.subscriptionId },
                    UpdateExpression: 'SET isActive = :isActive, disconnectedAt = :timestamp',
                    ExpressionAttributeValues: {
                        ':isActive': false,
                        ':timestamp': new Date().toISOString()
                    }
                }));
            }
        }
        
        console.log(`✅ Unsubscribed successfully`);
        
        return await sendToConnection(connectionId, {
            type: 'unsubscription_confirmed',
            subscriptionId,
            timestamp: new Date().toISOString()
        }, apiGatewayClient);
        
    } catch (error) {
        console.error(`Error removing subscription for ${connectionId}:`, error);
        return await sendToConnection(connectionId, {
            type: 'unsubscription_error',
            message: error.message
        }, apiGatewayClient);
    }
}

/**
 * Handle order acceptance from driver
 */
async function handleOrderAccept(connectionId, message, apiGatewayClient) {
    const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
    const lambdaClient = new LambdaClient({ region: "us-east-1" });
    
    try {
        const { order_id: orderId, offer_id: offerId, driver_location: driverLocation } = message.payload || message;
        
        console.log(`✅ Driver accepting order: ${orderId}`);
        
        // Get driver ID from connection
        const connection = await dynamoDB.send(new GetCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        
        if (!connection.Item || !connection.Item.userId) {
            return await sendToConnection(connectionId, {
                type: 'order_accept_error',
                message: 'Driver not authenticated',
                orderId
            }, apiGatewayClient);
        }
        
        const driverId = connection.Item.userId;
        
        // Invoke HandleDriverAccept Lambda
        const payload = {
            driverId,
            orderId,
            offerId: offerId || `OFFER_${orderId}_${driverId}`,
            driverLocation
        };
        
        const invokeResult = await lambdaClient.send(new InvokeCommand({
            FunctionName: process.env.HANDLE_DRIVER_ACCEPT_FUNCTION || 'WaveSystem_HandleDriverAccept',
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify(payload)
        }));
        
        const result = JSON.parse(Buffer.from(invokeResult.Payload).toString());
        
        if (result.statusCode === 200) {
            return await sendToConnection(connectionId, {
                type: 'order_accepted_confirmation',
                orderId,
                message: 'تم قبول الطلب بنجاح',
                timestamp: new Date().toISOString()
            }, apiGatewayClient);
        } else {
            return await sendToConnection(connectionId, {
                type: 'order_accept_error',
                orderId,
                message: result.body || 'Failed to accept order'
            }, apiGatewayClient);
        }
        
    } catch (error) {
        console.error('Error handling order accept:', error);
        return await sendToConnection(connectionId, {
            type: 'order_accept_error',
            message: error.message
        }, apiGatewayClient);
    }
}

/**
 * Handle order rejection from driver
 */
async function handleOrderReject(connectionId, message, apiGatewayClient) {
    const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
    const lambdaClient = new LambdaClient({ region: "us-east-1" });
    
    try {
        const { order_id: orderId, offer_id: offerId, reason } = message.payload || message;
        
        console.log(`❌ Driver rejecting order: ${orderId}, reason: ${reason}`);
        
        // Get driver ID from connection
        const connection = await dynamoDB.send(new GetCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        
        if (!connection.Item || !connection.Item.userId) {
            return await sendToConnection(connectionId, {
                type: 'order_reject_error',
                message: 'Driver not authenticated',
                orderId
            }, apiGatewayClient);
        }
        
        const driverId = connection.Item.userId;
        
        // Invoke HandleDriverReject Lambda
        const payload = {
            driverId,
            orderId,
            offerId: offerId || `OFFER_${orderId}_${driverId}`,
            rejectionReason: reason || 'not_specified'
        };
        
        const invokeResult = await lambdaClient.send(new InvokeCommand({
            FunctionName: process.env.HANDLE_DRIVER_REJECT_FUNCTION || 'WaveSystem_HandleDriverReject',
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify(payload)
        }));
        
        const result = JSON.parse(Buffer.from(invokeResult.Payload).toString());
        
        if (result.statusCode === 200) {
            return await sendToConnection(connectionId, {
                type: 'order_rejected_confirmation',
                orderId,
                message: 'تم رفض الطلب',
                timestamp: new Date().toISOString()
            }, apiGatewayClient);
        } else {
            return await sendToConnection(connectionId, {
                type: 'order_reject_error',
                orderId,
                message: result.body || 'Failed to reject order'
            }, apiGatewayClient);
        }
        
    } catch (error) {
        console.error('Error handling order reject:', error);
        return await sendToConnection(connectionId, {
            type: 'order_reject_error',
            message: error.message
        }, apiGatewayClient);
    }
}

module.exports = { handler, getBusinessConnections };
