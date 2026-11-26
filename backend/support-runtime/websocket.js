'use strict';
// The support-only routines come from the active Staging WebSocket runtime.
// See staging-source.json for the deployed source fingerprints.
const {PostToConnectionCommand}=require('@aws-sdk/client-apigatewaymanagementapi');
const {PutCommand,UpdateCommand,ScanCommand,DeleteCommand,GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
const attachments=require('./support-attachments');
const {customerOwnsOrder}=require('./support-customer-order-access');
const {normalizeRole,principalFromClaims,isTrustedConnection,canReadSession}=require('./support-access');
const {customerLifecycleCheck,customerSessionChecks,customerSessionAvailable,writeWithChecks}=require('./customer-lifecycle');

function createSocket({db:dynamoDB,env,management,verifyJwt,merchantAccess,isCurrent,consumeTicket}) {
const {WEBSOCKET_CONNECTIONS_TABLE,CHAT_SESSIONS_TABLE,CHAT_MESSAGES_TABLE}=env;
const BUILD_VERSION='production-support';
const connectionChecks = connection => connection.userType === 'customer'
    ? [customerLifecycleCheck(env, connection.authSubject)] : [];

const handler = async (event) => {
    // Diagnostic banner to verify deployment and environment mapping
    console.log(`🛠️ Build ${BUILD_VERSION} | Tables: connections=${WEBSOCKET_CONNECTIONS_TABLE} sessions=${CHAT_SESSIONS_TABLE} messages=${CHAT_MESSAGES_TABLE}`);
    try {
        console.log('WebSocket route:', event.requestContext?.routeKey);

        const connectionId = event.requestContext?.connectionId;
        const routeKey = event.requestContext?.routeKey;
        const body = event.body;
        if (event.isBase64Encoded || (body != null && (typeof body !== 'string' || Buffer.byteLength(body)>24000))) {
            return {statusCode: 400, body: 'Invalid message'};
        }
        const apiId = event.requestContext?.apiId;
        const stage = event.requestContext?.stage;
        if (stage !== 'production' || apiId !== env.SUPPORT_WEBSOCKET_API_ID) return {statusCode: 404, body: 'NOT_FOUND'};

        if (!connectionId) {
            console.error('Missing connectionId in event.requestContext');
            return {
                statusCode: 400,
                body: 'Missing connectionId'
            };
        }

        console.log(`WebSocket message: ${connectionId}, route: ${routeKey}`);

        // Initialize API Gateway Management API client
        const apiGatewayClient = management(`https://${apiId}.execute-api.us-east-1.amazonaws.com/${stage}`);

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
                if (!message || typeof message !== 'object' || Array.isArray(message)) return {statusCode: 400, body: 'Invalid message'};
            } catch (e) {
                return {statusCode: 400, body: 'Invalid JSON'};
            }
        }

        // Handle different message types
        const messageType = message?.type || message?.action;
        if (message?.sessionId != null && (typeof message.sessionId !== 'string' ||
            !/^[A-Za-z0-9_:#.-]{1,200}$/.test(message.sessionId))) {
            return await rejectSupportRequest(connectionId, apiGatewayClient, 400, 'SESSION_REQUIRED');
        }
        if (messageType) {
            // Connection identity is established by JWT verification; chat frames cannot grant roles.
            const connAuth = await dynamoDB.send(new GetCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                Key: { connectionId },
                ConsistentRead: true
            }));
            const connection = connAuth.Item;
            if (messageType === 'authenticate') {
                return await handleAuthentication(connectionId, message, apiGatewayClient);
            }
            if (!isTrustedConnection(connection)) {
                await sendToConnection(connectionId, {type: 'error', code: 'AUTH_REQUIRED', message: 'Reconnect with a valid identity'}, apiGatewayClient);
                return {statusCode: 401, body: 'Not authenticated'};
            }
            const role = connection.userType;
            const permission = messageType === 'chat_session_close' ? 'support.close'
              : ['chat_message','agent_message','driver_message','chat_typing'].includes(messageType) ? 'support.reply' : 'support.read';
            if (!await isCurrent(connection, permission)) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'AUTH_REQUIRED');
            const requiredRole = {chat_agent_connect: 'agent', chat_driver_connect: 'driver', chat_merchant_connect: 'merchant', chat_customer_connect: 'customer'}[messageType];
            if ((requiredRole && role !== requiredRole) ||
                (['sync_sessions', 'join_channel'].includes(messageType) && role !== 'agent')) {
                return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'FORBIDDEN');
            }
            const identityKey = {agent: 'agentId', driver: 'driverId', merchant: 'merchantId', customer: 'customerId'}[role];
            if (requiredRole === 'merchant') {
                const businessId = message.businessId || message.merchantId;
                if (message.businessId && message.merchantId && message.businessId !== message.merchantId) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'BUSINESS_MISMATCH');
                const access = await merchantAccess(connection.authSubject, businessId);
                if (!access) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'BUSINESS_UNAVAILABLE');
                message.businessId = access.businessId;
                message.merchantId = access.businessId;
                message.merchantName = access.businessName;
                message.merchantEmail = typeof connection.email === 'string' ? connection.email : '';
            } else if (requiredRole) {
                if (message[identityKey] && message[identityKey] !== connection.userId) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'IDENTITY_MISMATCH');
                message[identityKey] = connection.userId;
            }
            const sessionActions = ['chat_message', 'agent_message', 'driver_message', 'chat_typing', 'chat_session_close', 'get_session_messages', 'join_channel'];
            let selectedSession;
            if (sessionActions.includes(messageType) || (requiredRole && message.sessionId)) {
                if (typeof message.sessionId !== 'string' || !message.sessionId) return await rejectSupportRequest(connectionId, apiGatewayClient, 400, 'SESSION_REQUIRED');
                const session = await dynamoDB.send(new GetCommand({TableName: CHAT_SESSIONS_TABLE, Key: {sessionId: message.sessionId}, ConsistentRead: true}));
                selectedSession = session.Item;
                // A new participant session may be created by its authenticated owner.
                const newParticipantSession = requiredRole && role !== 'agent' && !session.Item;
                if (!newParticipantSession && !canReadSession(connection, session.Item)) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'FORBIDDEN');
                if (!await customerSessionAvailable(dynamoDB, env, selectedSession)) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'FORBIDDEN');
                if (role === 'merchant' && session.Item) {
                    const businessId = session.Item.businessId || session.Item.merchantId;
                    if ((message.businessId && message.businessId !== businessId) || !await merchantAccess(connection.authSubject, businessId)) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'BUSINESS_UNAVAILABLE');
                }
                if (role === 'customer' && session.Item?.orderId && !await customerOwnsOrder(dynamoDB, env, connection.authSubject, session.Item.orderId)) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'ORDER_UNAVAILABLE');
                if (requiredRole && session.Item?.status === 'closed') return await rejectSupportRequest(connectionId, apiGatewayClient, 409, 'SESSION_CLOSED');
            }
            if (['chat_message', 'agent_message', 'driver_message', 'chat_typing'].includes(messageType)) {
                if (message.senderType && message.senderType !== role) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'SENDER_MISMATCH');
                message.senderType = role;
                message._senderSubject = connection.authSubject;
            }
            if (messageType === 'chat_session_close') {
                message.closedByUserType = role;
                message.closedByUserId = connection.userId;
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
                    return await handleAgentChatConnect(connectionId, message, apiGatewayClient, selectedSession);
                case 'chat_customer_connect':
                    return await handleCustomerChatConnect(connectionId, message, apiGatewayClient);
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
                case 'join_channel':
                    await writeWithChecks(dynamoDB, new UpdateCommand({TableName: WEBSOCKET_CONNECTIONS_TABLE, Key: {connectionId},
                        UpdateExpression: 'SET sessionId = :sid', ConditionExpression: 'attribute_exists(connectionId)',
                        ExpressionAttributeValues: {':sid': message.sessionId}}), 'Update', customerSessionChecks(env, selectedSession));
                    return await handleGetSessionMessages(connectionId, message, apiGatewayClient);
                case 'get_session_messages':
                    return await handleGetSessionMessages(connectionId, message, apiGatewayClient);
                case 'ack':
                    return await handleAck(connectionId, message, apiGatewayClient);
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
        const requestedRole = normalizeRole(queryParams.userType || 'driver');
        let principal;
        try {
            if (requestedRole === 'agent') {
                principal = await consumeTicket(queryParams.ticket);
            } else {
                const authorization = Object.entries(event.headers || {}).filter(([key]) => key.toLowerCase() === 'authorization');
                const value = authorization.length === 1 ? authorization[0][1] : '';
                const token = typeof value === 'string' ? /^Bearer (\S+)$/i.exec(value)?.[1] : undefined;
                if (!token || queryParams.token || queryParams.ticket) throw Error('UNAUTHORIZED');
                principal = principalFromClaims(await verifyJwt(token, requestedRole), requestedRole);
            }
            if (principal.userType !== requestedRole || !await isCurrent(principal, 'support.read')) throw Error('UNAUTHORIZED');
        } catch (_) {
            return {statusCode: 401, body: 'Unauthorized'};
        }
        const {userId, userType, groups} = principal;

        // Store connection (schema: HASH key is connectionId)
        await writeWithChecks(dynamoDB, new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userId,
                userType,
                businessId: 'default',
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
                ...principal
            }
        }), 'Put', connectionChecks(principal));
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
        if (normalizeRole(message.userType) === 'agent') return {statusCode: 403, body: 'Reconnect to authenticate'};
        const principal = principalFromClaims(await verifyJwt(message.token, message.userType), message.userType);
        if (!await isCurrent(principal, 'support.read')) return {statusCode: 403, body: 'Reconnect to authenticate'};
        const previous = await dynamoDB.send(new GetCommand({TableName: WEBSOCKET_CONNECTIONS_TABLE, Key: {connectionId}, ConsistentRead: true}));
        if (!isTrustedConnection(previous.Item) || previous.Item.authSubject !== principal.authSubject || previous.Item.userType !== principal.userType) {
            return {statusCode: 403, body: 'Reconnect to change identity'};
        }
        await writeWithChecks(dynamoDB, new PutCommand({TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {...previous.Item, ...principal, authenticatedAt: new Date().toISOString()},
            ConditionExpression: 'authSubject=:subject', ExpressionAttributeValues: {':subject': principal.authSubject}}),
            'Put', connectionChecks(principal));
        const {userId, userType} = principal;

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
                ConditionExpression: 'attribute_exists(connectionId)',
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
        const identity = await dynamoDB.send(new GetCommand({TableName: WEBSOCKET_CONNECTIONS_TABLE, Key: {connectionId}, ConsistentRead: true}));
        const {driverId, sessionId: clientSessionId} = message;
        const driverName = typeof message.driverName === 'string' ? (message.driverName.trim().slice(0,100) || 'سائق') : 'سائق';
        const driverPhone = typeof message.driverPhone === 'string' ? message.driverPhone.trim().slice(0,30) : '';
        if (clientSessionId != null && (typeof clientSessionId !== 'string' || !clientSessionId || clientSessionId.length > 200)) return await rejectSupportRequest(connectionId, apiGatewayClient, 400, 'SESSION_REQUIRED');

        // Use client-provided sessionId if available, otherwise generate one
        const sessionId = clientSessionId || `session_${driverId}_${Date.now()}`;

        const existingSession = await dynamoDB.send(new GetCommand({TableName: CHAT_SESSIONS_TABLE, Key: {sessionId}, ConsistentRead: true}));
        if (existingSession.Item && !canReadSession(identity.Item, existingSession.Item)) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'FORBIDDEN');
        if (existingSession.Item?.status === 'closed') return await rejectSupportRequest(connectionId, apiGatewayClient, 409, 'SESSION_CLOSED');

        // Store driver connection (preserve auth)
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                ...identity.Item,
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
        if (!existingSession.Item) await dynamoDB.send(new PutCommand({
            TableName: CHAT_SESSIONS_TABLE,
            ConditionExpression: 'attribute_not_exists(sessionId)',
            Item: {
                sessionId,
                userId: identity.Item.userId,
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
        if (!existingSession.Item) await notifyAgentsOfNewSession(sessionId, {
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
            status: existingSession.Item?.status || 'waiting_for_agent',
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

async function handleAgentChatConnect(connectionId, message, apiGatewayClient, selectedSession) {
    try {
        const identity = await dynamoDB.send(new GetCommand({TableName: WEBSOCKET_CONNECTIONS_TABLE, Key: {connectionId}, ConsistentRead: true}));
        const { agentId, sessionId } = message;
        const agentName = identity.Item?.staffDisplayName || 'فريق الدعم';

        // Store agent connection (preserve auth)
        const connection = new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                ...identity.Item,
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
            },
            ConditionExpression: 'authSubject=:agent',
            ExpressionAttributeValues: {':agent': agentId}
        });

        // If joining a specific session, update the session
        if (sessionId) {
            const update = {
                TableName: CHAT_SESSIONS_TABLE,
                Key: { sessionId },
                UpdateExpression: 'SET agentId = :agentId, agentName = :agentName, #status = :status, agentJoinedAt = :agentJoinedAt',
                ConditionExpression: 'attribute_exists(sessionId)',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':agentId': agentId,
                    ':agentName': agentName,
                    ':status': 'active',
                    ':agentJoinedAt': new Date().toISOString()
                }
            };
            if (selectedSession?.userType === 'customer') {
                update.ConditionExpression += ' AND customerId=:customer AND userType=:role';
                Object.assign(update.ExpressionAttributeValues, {':customer':selectedSession.customerId, ':role':'customer'});
                await writeWithChecks(dynamoDB, connection, 'Put', [
                    customerLifecycleCheck(env, selectedSession.customerId), {Update:update}
                ]);
            } else {
                await dynamoDB.send(connection);
                await dynamoDB.send(new UpdateCommand(update));
            }

            // Notify driver that agent has joined
            await notifyDriverOfAgentJoin(sessionId, { agentId, agentName }, apiGatewayClient);
        } else await dynamoDB.send(connection);

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

async function handleCustomerChatConnect(connectionId, message, apiGatewayClient) {
    const identity = (await dynamoDB.send(new GetCommand({TableName: WEBSOCKET_CONNECTIONS_TABLE, Key: {connectionId}, ConsistentRead: true}))).Item;
    const sessionId = message.sessionId;
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) return await rejectSupportRequest(connectionId, apiGatewayClient, 400, 'SESSION_REQUIRED');
    const existing = (await dynamoDB.send(new GetCommand({TableName: CHAT_SESSIONS_TABLE, Key: {sessionId}, ConsistentRead: true}))).Item;
    if (existing && !canReadSession(identity, existing)) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'FORBIDDEN');
    if (existing?.status === 'closed') return await rejectSupportRequest(connectionId, apiGatewayClient, 409, 'SESSION_CLOSED');
    const orderId = message.orderId;
    if (orderId != null && (existing && existing.orderId !== orderId || !await customerOwnsOrder(dynamoDB, env, identity.authSubject, orderId))) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'ORDER_UNAVAILABLE');
    // Display labels are untrusted text. Identity always comes from the verified connection.
    const name = typeof message.customerName === 'string' ? message.customerName.trim().slice(0, 100) : '';
    const session = existing || {sessionId, userId: identity.authSubject, customerId: identity.authSubject,
        userType: 'customer', customerName: name || 'زبون', userDisplayName: name || 'زبون',
        source: 'wizzuser_app', status: 'waiting_for_agent', createdAt: new Date().toISOString(),
        ...(orderId != null ? {orderId} : {})};
    const checks = existing ? customerSessionChecks(env, existing) : [customerLifecycleCheck(env, identity.authSubject)];
    await dynamoDB.send(new TransactWriteCommand({TransactItems: [
        ...checks,
        ...(!existing ? [{Put: {TableName: CHAT_SESSIONS_TABLE, Item: session, ConditionExpression: 'attribute_not_exists(sessionId)'}}] : []),
        {Update: {TableName: WEBSOCKET_CONNECTIONS_TABLE, Key: {connectionId}, UpdateExpression: 'SET sessionId=:session',
            ConditionExpression: 'authSubject=:subject', ExpressionAttributeValues: {':session':sessionId, ':subject':identity.authSubject}}},
    ]}));
    if (!existing) await notifyAgentsOfNewSession(sessionId, session, apiGatewayClient);
    return await sendToConnection(connectionId, {type: 'chat_session_created', sessionId, status: session.status}, apiGatewayClient);
}

async function handleMerchantChatConnect(connectionId, message, apiGatewayClient) {
    try {
        const identity = await dynamoDB.send(new GetCommand({TableName: WEBSOCKET_CONNECTIONS_TABLE, Key: {connectionId}, ConsistentRead: true}));
        const { merchantId, merchantName, merchantEmail, sessionId: clientSessionId } = message;

        // Use client-provided sessionId if available, otherwise generate one
        const sessionId = clientSessionId || `merchant_session_${merchantId}_${Date.now()}`;

        console.log(`🏪 Merchant connecting: ${merchantName} (${merchantId})`);

        console.log(`🔑 Session ID: ${sessionId}`);

        const existingSession = await dynamoDB.send(new GetCommand({TableName: CHAT_SESSIONS_TABLE, Key: {sessionId}, ConsistentRead: true}));
        if (existingSession.Item && (!canReadSession(identity.Item, existingSession.Item) || existingSession.Item.status === 'closed')) return await rejectSupportRequest(connectionId, apiGatewayClient, 403, 'FORBIDDEN');

        // Store merchant connection (preserve auth)
        await dynamoDB.send(new PutCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Item: {
                ...identity.Item,
                connectionId,
                userId: identity.Item.authSubject,
                businessId: merchantId,
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
        if (!existingSession.Item) await dynamoDB.send(new PutCommand({
            TableName: CHAT_SESSIONS_TABLE,
            ConditionExpression: 'attribute_not_exists(sessionId)',
            Item: {
                sessionId,
                userId: identity.Item.authSubject,
                businessId: merchantId,
                merchantId,
                merchantName,
                merchantEmail,
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
        if (!existingSession.Item) await notifyAgentsOfNewSession(sessionId, {
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
            status: existingSession.Item?.status || 'waiting_for_agent',
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
        const clientMessageId = typeof message.clientMessageId === 'string' && message.clientMessageId.length <= 128 ? message.clientMessageId : undefined;
        if (message.clientMessageId != null && (!clientMessageId || !clientMessageId.trim())) throw attachments.fail('INVALID_MESSAGE_ID');
        const sanitized = sanitizeChatContent(rawText);
        if (message.imageUrl || message.imageType) throw attachments.fail('ATTACHMENT_REFERENCE_REQUIRED');
        let receipt;
        if (clientMessageId) {
            const table = env.SUPPORT_MESSAGE_RECEIPTS_TABLE;
            if (!table) throw attachments.fail('MESSAGE_RECEIPTS_UNAVAILABLE', 503);
            const receiptId = createHash('sha256').update(JSON.stringify([sessionId, senderType, message._senderSubject, clientMessageId])).digest('hex');
            const contentHash = createHash('sha256').update(JSON.stringify([sanitized, message.attachmentId || null])).digest('hex');
            receipt = {table, receiptId, contentHash};
        }
        const acknowledgeReceipt = async () => {
            if (!receipt) return false;
            const saved = (await dynamoDB.send(new GetCommand({TableName: receipt.table, Key: {receiptId: receipt.receiptId}, ConsistentRead: true}))).Item;
            if (!saved) return false;
            if (saved.sessionId !== sessionId || typeof saved.messageId !== 'string' || !saved.messageId || !Number.isFinite(saved.ttl)) throw attachments.fail('MESSAGE_RECEIPT_INVALID', 503);
            if (saved.contentHash !== receipt.contentHash) throw attachments.fail('MESSAGE_ID_CONFLICT', 409);
            if (saved.ttl <= Date.now()/1000) throw attachments.fail('MESSAGE_ID_EXPIRED', 409);
            await sendToConnection(connectionId, {type: 'message_ack', clientMessageId, messageId: saved.messageId, sessionId}, apiGatewayClient);
            return true;
        };
        if (await acknowledgeReceipt()) return {statusCode: 200, body: 'Already saved'};
        let attachment;
        if (message.attachmentId) {
            attachment = await attachments.getAttachment(dynamoDB, env.SUPPORT_ATTACHMENTS_TABLE, message.attachmentId);
            if (attachment.sessionId !== sessionId || attachment.subjectId !== message._senderSubject || attachment.userType !== senderType || !clientMessageId) throw attachments.fail('ATTACHMENT_FORBIDDEN', 403);
            if (attachment.status === 'PUBLISHED') {
                if (attachment.clientMessageId !== clientMessageId) throw attachments.fail('ATTACHMENT_ALREADY_USED', 409);
                const saved = (await dynamoDB.send(new GetCommand({TableName: CHAT_MESSAGES_TABLE, Key: {sessionId, messageKey: attachment.messageKey}, ConsistentRead: true}))).Item;
                if (!saved || saved.text !== sanitized || saved.attachment?.attachmentId !== attachment.attachmentId) throw attachments.fail('MESSAGE_ID_CONFLICT', 409);
                await sendToConnection(connectionId, {type: 'message_ack', clientMessageId, messageId: attachment.messageId, sessionId}, apiGatewayClient);
                return {statusCode: 200, body: 'Already saved'};
            }
            if (attachment.status !== 'UPLOADED') throw attachments.fail('ATTACHMENT_NOT_READY', 409);
        }
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
            ...(clientMessageId ? {metadata: {clientMessageId}} : {}),
            text: sanitized,
            ...(attachment ? {attachment: attachments.reference(attachment)} : {}),
            createdAt: nowIso,
            ttl: Math.floor(now / 1000) + 60 * 60 * 24 * 30 // 30 days
        };
        // The session fence, counters, message, receipt and optional image binding
        // commit together. A repeated request never increments unread counters.
        const firstField = senderType === 'agent' ? 'agentFirstResponseAt' : senderType === 'driver' ? 'driverFirstMessageAt' : null;
        const counter = senderType === 'agent' ? 'unreadDriver' : 'unreadAgent';
        const transaction = [
            {Update: {TableName: CHAT_SESSIONS_TABLE, Key: {sessionId},
                UpdateExpression: 'SET lastMessageAt=:now' + (firstField ? ', '+firstField+'=if_not_exists('+firstField+', :now)' : '') + ' ADD '+counter+' :one',
                ConditionExpression: 'attribute_exists(sessionId) AND #s <> :closed',
                ExpressionAttributeNames: {'#s':'status'}, ExpressionAttributeValues: {':closed':'closed', ':now':nowIso, ':one':1}}},
            {Put: {TableName: CHAT_MESSAGES_TABLE, Item: chatMessageItem, ConditionExpression: 'attribute_not_exists(messageKey)'}}
        ];
        if (sessionRecord.userType === 'customer') {
            transaction.push(customerLifecycleCheck(env, sessionRecord.customerId));
            transaction[0].Update.ConditionExpression += ' AND customerId=:customer AND userType=:customerRole';
            Object.assign(transaction[0].Update.ExpressionAttributeValues, {':customer':sessionRecord.customerId, ':customerRole':'customer'});
        }
        // Customer reply notice commits atomically with message + receipt.
        const customerNotice = require('../src/utils/customer-inbox').supportReply(sessionRecord, chatMessageItem);
        if (customerNotice) transaction.push({Put: {
            TableName: env.WALLET_NOTIFICATIONS_TABLE,
            Item: customerNotice, ConditionExpression: 'attribute_not_exists(eventId)'
        }});
        if (receipt) transaction.push({Put: {TableName: receipt.table,
            Item: {receiptId: receipt.receiptId, sessionId, messageId, contentHash: receipt.contentHash, ttl: chatMessageItem.ttl},
            ConditionExpression: 'attribute_not_exists(receiptId)'}});
        if (attachment) transaction.push({Update: {TableName: env.SUPPORT_ATTACHMENTS_TABLE, Key: {attachmentId: attachment.attachmentId},
            UpdateExpression: 'SET #s=:published, messageId=:mid, messageKey=:key, clientMessageId=:cid, #ttl=:ttl',
            ConditionExpression: '#s=:uploaded AND subjectId=:sub AND sessionId=:sid AND #ttl>:now',
            ExpressionAttributeNames: {'#s':'status', '#ttl':'ttl'},
            ExpressionAttributeValues: {':published':'PUBLISHED', ':uploaded':'UPLOADED', ':sub':message._senderSubject, ':sid':sessionId,
                ':mid':messageId, ':key':messageKey, ':cid':clientMessageId, ':ttl':chatMessageItem.ttl, ':now':Math.floor(now/1000)}}});
        try {
            await dynamoDB.send(new TransactWriteCommand({TransactItems: transaction}));
        } catch (error) {
            // A concurrent duplicate or uncertain transaction result is resolved
            // with a strongly consistent receipt read, never another message put.
            if (await acknowledgeReceipt()) return {statusCode: 200, body: 'Already saved'};
            throw error;
        }
        // Broadcast
        const sessionUserType = sessionRecord?.userType || (sessionRecord?.merchantId ? 'merchant' : 'driver');
        const sessionSource = sessionRecord?.source || (sessionUserType === 'merchant' ? 'whizzMerchants' : 'wizzdriver_app');
        const outbound = {
            type: 'chat_message',
            sessionId,
            orderId: sessionRecord?.orderId || null,
            userType: sessionUserType,
            source: sessionSource,
            merchantName: sessionRecord?.merchantName || null,
            merchantEmail: sessionRecord?.merchantEmail || null,
            driverName: sessionRecord?.driverName || null,
            customerName: sessionRecord?.customerName || null,
            userDisplayName: sessionRecord?.userDisplayName || null,
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
                ...(clientMessageId ? {clientMessageId} : {}),
                sessionId,
                messageKey,
                senderType,
                text: sanitized,
                ...(attachment ? {attachment: attachments.reference(attachment)} : {}),
                createdAt: nowIso
            }
        };
        await broadcastToSession(sessionId, outbound, apiGatewayClient);
        if (clientMessageId) await sendToConnection(connectionId, {type: 'message_ack', clientMessageId, messageId, sessionId}, apiGatewayClient);
        // Ack to sender if requestId supplied
        if (requestId) {
            await sendToConnection(connectionId, { type: 'ack', requestId, messageId, sessionId }, apiGatewayClient);
        }
        return { statusCode: 200, body: 'Message stored' };
    } catch (error) {
        if (error.code && error.status) return rejectSupportRequest(connectionId, apiGatewayClient, error.status, error.code);
        console.error('Error handling chat message (refactored):', error.name);
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
            await sendToConnection(connectionId, { type: 'session_closed', sessionId, alreadyClosed: true, timestamp: new Date().toISOString() }, apiGatewayClient);
            return { statusCode: 200, body: 'Session already closed' };
        }

        // Immediate ACK to requester so UI can move to closing state
        await sendToConnection(connectionId, { type: 'chat_session_close_ack', sessionId, timestamp: new Date().toISOString() }, apiGatewayClient);

        const nowIso = new Date().toISOString();
        // Update session status (only if not already closed)
        try {
            await writeWithChecks(dynamoDB, new UpdateCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Key: { sessionId },
                UpdateExpression: 'SET #status = :status, closedAt = :closedAt, closedByUserType = :closedByUserType, closedByUserId = :closedByUserId',
                ConditionExpression: 'attribute_exists(sessionId)',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': 'closed',
                    ':closedAt': nowIso,
                    ':closedByUserType': closedByUserType,
                    ':closedByUserId': closedByUserId || null
                }
            }), 'Update', sessionRecord.userType === 'customer' ? [customerLifecycleCheck(env, sessionRecord.customerId)] : []);
        } catch (e) {
            console.error('handleChatSessionClose update failed', e);
            return await rejectSupportRequest(connectionId, apiGatewayClient, 500, 'CLOSE_FAILED');
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
                orderId: item.orderId || null,
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
        const { sessionId, limit = 30, cursor, requestId } = message;
        if ((cursor != null && (typeof cursor !== 'string' || !cursor || cursor.length > 500)) ||
            (requestId != null && (typeof requestId !== 'string' || !requestId || requestId.length > 100))) return await rejectSupportRequest(connectionId, apiGatewayClient, 400, 'INVALID_HISTORY_REQUEST');
        if (!sessionId) return await sendToConnection(connectionId, { type: 'error', message: 'sessionId required' }, apiGatewayClient);
        const queryParams = {
            TableName: CHAT_MESSAGES_TABLE,
            KeyConditionExpression: 'sessionId = :sid',
            ExpressionAttributeValues: { ':sid': sessionId },
            Limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 30,
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
            ...(message.requestId ? {requestId: message.requestId} : {}),
            messages: items.map(i => ({
                messageId: i.messageId,
                messageKey: i.messageKey,
                senderType: i.senderType,
                metadata: i.metadata || {},
                ...(i.attachment ? {attachment: i.attachment} : {}),
                text: i.text,
                createdAt: i.createdAt
            })),
            nextCursor
        }, apiGatewayClient);
    } catch (e) {
        console.error('handleGetSessionMessages failed', e);
        return await sendToConnection(connectionId, {type: 'history_error', sessionId: message.sessionId, ...(message.requestId ? {requestId: message.requestId} : {}), code: 'HISTORY_UNAVAILABLE'}, apiGatewayClient);
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
async function rejectSupportRequest(connectionId, apiGatewayClient, statusCode, code) {
    await sendToConnection(connectionId, {type: 'error', code, message: 'Support request rejected'}, apiGatewayClient);
    return {statusCode, body: code};
}

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
        const session = await dynamoDB.send(new GetCommand({TableName: CHAT_SESSIONS_TABLE, Key: {sessionId}, ConsistentRead: true}));
        if (!session.Item) return;
        // Support queue access is restricted to trusted support agents; participants must own the session.
        const result = await dynamoDB.send(new ScanCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            FilterExpression: 'sessionId = :sessionId OR userType = :agent',
            ExpressionAttributeValues: {
                ':sessionId': sessionId,
                ':agent': 'agent'
            }
        }));

        const connections = [];
        for (const conn of result.Items || []) {
            if (!canReadSession(conn, session.Item) || !await isCurrent(conn, 'support.read')) continue;
            if (conn.userType === 'merchant' && !await merchantAccess(conn.authSubject, session.Item.businessId || session.Item.merchantId)) continue;
            if (conn.userType === 'customer' && session.Item.orderId && !await customerOwnsOrder(dynamoDB, env, conn.authSubject, session.Item.orderId)) continue;
            connections.push(conn);
        }
        const sendPromises = connections
            .filter(conn => canReadSession(conn, session.Item) && !excludeConnections.includes(conn.connectionId))
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

        const agentConnections = [];
        for (const conn of result.Items || []) {
            if (isTrustedConnection(conn) && conn.userType === 'agent' && await isCurrent(conn, 'support.read')) agentConnections.push(conn);
        }
        const payload = {
            sessionId,
            orderId: sessionInfo.orderId || null,
            userType: sessionInfo.userType || (sessionInfo.merchantId ? 'merchant' : 'driver'),
            source: sessionInfo.source || ((sessionInfo.userType || '').toLowerCase() === 'merchant' ? 'whizzMerchants' : 'wizzdriver_app'),
            driverId: sessionInfo.driverId || null,
            driverName: sessionInfo.driverName || null,
            driverPhone: sessionInfo.driverPhone || null,
            merchantId: sessionInfo.merchantId || null,
            merchantName: sessionInfo.merchantName || null,
            customerName: sessionInfo.customerName || null,
            merchantEmail: sessionInfo.merchantEmail || null,
            userDisplayName: sessionInfo.userDisplayName || sessionInfo.merchantName || sessionInfo.customerName || sessionInfo.driverName || 'User'
        };
        const notificationData = {
            type: 'new_chat_session',
            sessionId,
            orderId: payload.orderId,
            userType: payload.userType,
            source: payload.source,
            driverName: payload.driverName,
            customerName: payload.customerName,
            userDisplayName: payload.userDisplayName,
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

        const driverConnections = [];
        const session = (await dynamoDB.send(new GetCommand({TableName: CHAT_SESSIONS_TABLE, Key: {sessionId}, ConsistentRead: true}))).Item;
        for (const conn of result.Items || []) {
            if (canReadSession(conn, session) && await isCurrent(conn, 'support.read')) driverConnections.push(conn);
        }
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
            orderId: item.orderId || null,
            merchantId: item.merchantId,
            merchantName: item.merchantName,
            customerName: item.customerName,
            merchantEmail: item.merchantEmail,
            userId: item.userId,
            driverId: item.driverId,
            driverName: item.driverName,
            driverPhone: item.driverPhone,
            userDisplayName: item.userDisplayName || item.driverName || item.merchantName || item.customerName,
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


return handler;
}
module.exports={createSocket};
