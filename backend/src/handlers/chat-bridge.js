/**
 * Chat Bridge Handler
 * Bridges HTTP chat messages from Flutter app to WebSocket Live Chat interface
 */

const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { PutCommand, GetCommand, UpdateCommand, QueryCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE || 'websocket-connections-dev';
const CHAT_SESSIONS_TABLE = process.env.CHAT_SESSIONS_TABLE || 'chat-sessions-dev';
const CHAT_MESSAGES_TABLE = process.env.CHAT_MESSAGES_TABLE || 'chat-messages-dev';

// Valid API keys for cross-platform communication
const VALID_API_KEYS = [
    'wizzdriver_mobile_app_v1',
    'wizzcentral_platform_v1'
];

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Content-Type': 'application/json'
};

/**
 * Validate API Key for cross-platform access
 */
function validateApiKey(event) {
    const apiKey = event.headers?.['X-API-Key'] || event.headers?.['x-api-key'] || 
                  event.queryStringParameters?.apiKey;
    
    if (!apiKey) {
        return { valid: false, error: 'Missing API key - use X-API-Key header' };
    }
    
    if (!VALID_API_KEYS.includes(apiKey)) {
        return { valid: false, error: 'Invalid API key' };
    }
    
    return { valid: true };
}

/**
 * Handle HTTP chat messages from Flutter app and forward to WebSocket Live Chat
 */
exports.sendChatMessage = async (event) => {
    console.log('📨 Chat bridge received HTTP message:', JSON.stringify(event, null, 2));

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    // Validate API key for cross-platform access
    const apiValidation = validateApiKey(event);
    if (!apiValidation.valid) {
        return {
            statusCode: 401,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: apiValidation.error
            })
        };
    }

    try {
        // Parse the incoming message
        const body = JSON.parse(event.body || '{}');
        const {
            participantToken,
            message,
            contentType = 'text/plain',
            metadata = {}
        } = body;

        console.log('📨 Incoming chat message:', {
            participantToken,
            messageLength: message?.length,
            contentType,
            metadata
        });

        if (!message || !metadata) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'Missing message or metadata'
                })
            };
        }

        // Extract driver information from metadata
        const {
            senderId,
            senderType,
            senderName,
            timestamp
        } = metadata;

        if (senderType !== 'driver') {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'Only driver messages are supported'
                })
            };
        }

        // Generate a unique message ID
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Find or create chat session for this driver
        const sessionId = await findOrCreateDriverSession(senderId, senderName);

        // Convert HTTP message to WebSocket format
        const webSocketMessage = {
            type: 'chat_message',
            sessionId: sessionId,
            messageText: message,
            senderType: 'driver',
            metadata: {
                senderId,
                senderName,
                timestamp: timestamp || new Date().toISOString(),
                messageId,
                source: 'http_api'
            }
        };

        // Store the message in the chat session (migrated to per-item ChatMessagesTable)
        const nowIso = new Date().toISOString();
        const nowMs = Date.now();
        const messageKey = `t#${nowMs}#${messageId}`;
        await storeMessageRecord({
            sessionId,
            messageKey,
            messageId,
            senderType: 'driver',
            text: message,
            createdAt: nowIso,
            senderId,
            senderName,
            source: 'http_api',
            ttl: Math.floor(nowMs/1000) + 60*60*24*30
        });
        await touchSessionOnNewMessage(sessionId, 'driver', nowIso);

        // Forward to WebSocket Live Chat interface
        const success = await forwardToWebSocketLiveChat(webSocketMessage);

        if (success) {
            console.log('✅ Message successfully bridged to WebSocket Live Chat');
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    messageId,
                    sessionId,
                    bridged: true,
                    message: 'Message sent to Live Chat support',
                    timestamp: nowIso
                })
            };
        } else {
            console.log('⚠️ No active Live Chat agents, message stored for later');
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    messageId,
                    sessionId,
                    bridged: false,
                    message: 'Message received, waiting for agent connection',
                    timestamp: nowIso
                })
            };
        }

    } catch (error) {
        console.error('❌ Error in chat bridge:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: 'Internal server error',
                details: error.message
            })
        };
    }
};

/**
 * Post agent reply and forward to WebSocket Live Chat
 */
exports.postAgentReply = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }
    try {
        const body = JSON.parse(event.body || '{}');
        const { sessionId, message, metadata = {} } = body;

        if (!sessionId || !message) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success:false, error:'Missing sessionId or message' }) };
        }
        const { senderType, agentId, agentName, timestamp } = metadata;
        if (senderType !== 'agent') {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success:false, error:'senderType must be agent' }) };
        }
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        const nowMs = Date.now();
        const now = timestamp || new Date().toISOString();
        const messageKey = `t#${nowMs}#${messageId}`;

        // Store
        await storeMessageRecord({
            sessionId,
            messageKey,
            messageId,
            senderType: 'agent',
            text: message,
            createdAt: now,
            agentId,
            agentName,
            source: 'agent_http_api',
            ttl: Math.floor(nowMs/1000) + 60*60*24*30
        });
        await touchSessionOnNewMessage(sessionId, 'agent', now);

        // Broadcast to agents (echo) and future driver channel (currently only agents subscribed)
        const webSocketMessage = {
            type: 'chat_message',
            sessionId,
            messageText: message,
            senderType: 'agent',
            metadata: { messageId, agentId, agentName, timestamp: now, source:'agent_http_api' }
        };
        const success = await forwardToWebSocketLiveChat(webSocketMessage);

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success:true, messageId, sessionId, delivered: success }) };
    } catch (e) {
        console.error('Error in postAgentReply', e);
        return { statusCode:500, headers: corsHeaders, body: JSON.stringify({ success:false, error:'Internal server error', details:e.message }) };
    }
};

/**
 * Find existing session or create new one for driver
 */
async function findOrCreateDriverSession(driverId, driverName) {
    try {
        // Look for existing active session for this driver
        const queryParams = {
            TableName: CHAT_SESSIONS_TABLE,
            IndexName: 'DriverIdIndex', // Assuming we have this GSI
            KeyConditionExpression: 'driverId = :driverId',
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':driverId': driverId,
                ':status': 'active'
            },
            ScanIndexForward: false, // Get most recent first
            Limit: 1
        };

        let existingSession;
        try {
            const queryResult = await dynamodb.send(new QueryCommand(queryParams));
            existingSession = queryResult.Items?.[0];
        } catch (queryError) {
            console.log('No GSI found, scanning for existing session...');
            // Fallback: scan for existing session (less efficient but works)
            const scanParams = {
                TableName: CHAT_SESSIONS_TABLE,
                FilterExpression: 'driverId = :driverId AND #status = :status',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':driverId': driverId,
                    ':status': 'active'
                }
            };
            const scanResult = await dynamodb.send(new ScanCommand(scanParams));
            existingSession = scanResult.Items?.[0];
        }

        if (existingSession) {
            console.log(`📋 Using existing session: ${existingSession.sessionId}`);
            return existingSession.sessionId;
        }

        // Create new session
        const sessionId = `session_${driverId}_${Date.now()}`;
        const now = new Date().toISOString();

        const newSession = {
            sessionId,
            driverId,
            driverName: driverName || `Driver ${driverId}`,
            status: 'active',
            createdAt: now,
            lastMessageAt: now,
            messages: [],
            source: 'http_api'
        };

        await dynamodb.send(new PutCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Item: newSession
        }));

        console.log(`✨ Created new session: ${sessionId}`);
        return sessionId;

    } catch (error) {
        console.error('Error finding/creating session:', error);
        // Fallback: create session with timestamp
        const fallbackSessionId = `session_${driverId}_${Date.now()}`;
        const now = new Date().toISOString();

        try {
            await dynamodb.send(new PutCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Item: {
                    sessionId: fallbackSessionId,
                    driverId,
                    driverName: driverName || `Driver ${driverId}`,
                    status: 'active',
                    createdAt: now,
                    lastMessageAt: now,
                    messages: [],
                    source: 'http_api'
                }
            }));
            return fallbackSessionId;
        } catch (fallbackError) {
            console.error('Fallback session creation failed:', fallbackError);
            throw error;
        }
    }
}

/**
 * Store chat message in session
 */
async function storeChatMessage(sessionId, chatMessage) { /* legacy no-op retained for backward compat */ return true; }

async function storeMessageRecord(item){
    try {
        await dynamodb.send(new PutCommand({ TableName: CHAT_MESSAGES_TABLE, Item: item }));
        console.log('💾 Stored message record', item.sessionId, item.messageId);
    } catch (e) { console.error('Failed storing message record', e); throw e; }
}

async function touchSessionOnNewMessage(sessionId, senderType, iso){
    try {
        const updateExprParts = ['lastMessageAt = :lm'];
        const exprVals = { ':lm': iso };
        if (senderType === 'driver') updateExprParts.push('ADD unreadAgent :one');
        if (senderType === 'agent') updateExprParts.push('ADD unreadDriver :one');
        const setParts = updateExprParts.filter(p=>!p.startsWith('ADD'));
        const addNeeded = updateExprParts.some(p=>p.startsWith('ADD'));
        let UpdateExpression = '';
        if (setParts.length) UpdateExpression += 'SET ' + setParts.join(', ');
        if (addNeeded) UpdateExpression += (UpdateExpression? ' ' : '') + 'ADD ' + ['unreadAgent','unreadDriver'].filter(f=>updateExprParts.some(p=>p.includes(f))).map(f=> f + ' :one').join(', ');
        exprVals[':one'] = 1;
        await dynamodb.send(new UpdateCommand({ TableName: CHAT_SESSIONS_TABLE, Key:{ sessionId }, UpdateExpression, ExpressionAttributeValues: exprVals }));
    } catch(e){ console.error('touchSessionOnNewMessage failed', e); }
}

/**
 * Forward message to WebSocket Live Chat interface
 */
async function forwardToWebSocketLiveChat(webSocketMessage) {
    try {
        const agentConnections = await getActiveSupportAgentConnections();
        if (!agentConnections.length) {
            console.log('📭 No active support agents connected');
            return false;
        }
        console.log(`📡 Forwarding to ${agentConnections.length} active support agents`);

        const results = await Promise.allSettled(agentConnections.map(async (connection) => {
            try {
                // Use the correct WebSocket API endpoint that agents are connected to
                const apiId = connection.apiId || '0fs1zdwyzf'; // This is the correct WebSocket API ID
                const stage = connection.stage || 'dev';
                const endpoint = `https://${apiId}.execute-api.us-east-1.amazonaws.com/${stage}`;
                console.log(`📡 Forwarding to WebSocket endpoint: ${endpoint}`);
                const apiGatewayClient = new ApiGatewayManagementApiClient({ endpoint });
                await apiGatewayClient.send(new PostToConnectionCommand({
                    ConnectionId: connection.connectionId,
                    Data: JSON.stringify(webSocketMessage)
                }));
                console.log(`✅ Message sent to agent connection: ${connection.connectionId}`);
                return { status: 'sent', connectionId: connection.connectionId };
            } catch (error) {
                console.error(`❌ Failed to send to connection ${connection.connectionId}:`, error);
                if (error.statusCode === 410) {
                    await removeStaleConnection(connection.connectionId);
                }
                return { status: 'failed', connectionId: connection.connectionId, error: error.message };
            }
        }));

        const successful = results.filter(r => r.status === 'fulfilled' && r.value.status === 'sent').length;
        console.log(`📊 WebSocket delivery results: ${successful}/${agentConnections.length} successful`);
        return successful > 0;
    } catch (error) {
        console.error('Error forwarding to WebSocket:', error);
        return false;
    }
}

async function getActiveSupportAgentConnections() {
    try {
        const scanParams = {
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            FilterExpression: 'userType = :userType OR userType = :userType2',
            ExpressionAttributeValues: { 
                ':userType': 'agent',
                ':userType2': 'support'
            }
        };
        const result = await dynamodb.send(new ScanCommand(scanParams));
        return result.Items || [];
    } catch (error) {
        console.error('Error getting support agent connections:', error);
        return [];
    }
}

async function removeStaleConnection(connectionId) {
    try {
        await dynamodb.send(new DeleteCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        console.log(`🗑️ Removed stale connection: ${connectionId}`);
    } catch (error) {
        console.error('Error removing stale connection:', error);
    }
}

/**
 * Get chat history for debugging
 */
exports.getChatHistory = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    try {
        const { sessionId } = event.pathParameters || {};
        const { limit = 50 } = event.queryStringParameters || {};

        if (sessionId) {
            // Get specific session
            const session = await dynamodb.send(new GetCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Key: { sessionId }
            }));

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    session: session.Item || null
                })
            };
        } else {
            // Get recent sessions using scan instead of query (since we don't have a key condition)
            const sessions = await dynamodb.send(new ScanCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Limit: parseInt(limit)
            }));
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    sessions: sessions.Items || []
                })
            };
        }
    } catch (error) {
        console.error('Error getting chat history:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: 'Failed to get chat history'
            })
        };
    }
};
