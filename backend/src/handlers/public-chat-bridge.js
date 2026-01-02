/**
 * Public Chat Bridge Handler
 * Handles cross-platform chat messages from WizzDriver app to WizzCentral Support
 * No authentication required - uses public API key authentication
 */

const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE;
const CHAT_SESSIONS_TABLE = process.env.CHAT_SESSIONS_TABLE;
const CHAT_MESSAGES_TABLE = process.env.CHAT_MESSAGES_TABLE;

function getApiGatewayManagementClient() {
    const stage = String(process.env.STAGE || process.env.NODE_ENV || 'staging');
    const rawEndpoint = process.env.WEBSOCKET_API_ENDPOINT;
    if (!rawEndpoint) {
        throw new Error('Missing WEBSOCKET_API_ENDPOINT env var');
    }
    if (String(rawEndpoint).includes('/dev') && stage !== 'dev') {
        throw new Error(`Refusing to use dev WebSocket endpoint in ${stage}: ${rawEndpoint}`);
    }
    const endpoint = String(rawEndpoint).replace(/^wss:\/\//, 'https://');
    return new ApiGatewayManagementApiClient({ endpoint });
}

// Valid API keys for public access (in production, store in environment variables)
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
 * Validate API Key for public access
 */
function validateApiKey(event) {
    const apiKey = event.headers?.['X-API-Key'] || event.headers?.['x-api-key'] || 
                  event.queryStringParameters?.apiKey;
    
    if (!apiKey) {
        return { valid: false, error: 'Missing API key' };
    }
    
    if (!VALID_API_KEYS.includes(apiKey)) {
        return { valid: false, error: 'Invalid API key' };
    }
    
    return { valid: true };
}

/**
 * Handle public chat messages from WizzDriver app
 */
exports.sendMessage = async (event) => {
    console.log('📨 Public chat bridge received message:', JSON.stringify(event, null, 2));

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    try {
        if (!WEBSOCKET_CONNECTIONS_TABLE) throw new Error('Missing WEBSOCKET_CONNECTIONS_TABLE env var');
        if (!CHAT_SESSIONS_TABLE) throw new Error('Missing CHAT_SESSIONS_TABLE env var');
        if (!CHAT_MESSAGES_TABLE) throw new Error('Missing CHAT_MESSAGES_TABLE env var');

        // Validate API key
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

        // Parse the incoming message
        const body = JSON.parse(event.body || '{}');
        const {
            participantToken,
            message,
            contentType = 'text/plain',
            metadata = {}
        } = body;

        console.log('📨 Processing public chat message:', {
            participantToken: participantToken ? '***' : null,
            messageLength: message?.length,
            contentType,
            senderType: metadata.senderType
        });

        // Validate required fields
        if (!message || !metadata || !metadata.senderId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'Missing required fields: message, metadata.senderId'
                })
            };
        }

        // Extract driver information from metadata
        const {
            senderId,
            senderType = 'driver',
            senderName,
            businessId,
            platform = 'WizzDriver'
        } = metadata;

        // Generate unique IDs
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const sessionId = participantToken || `session_${senderId}_${Date.now()}`;
        const timestamp = new Date().toISOString();

        // Find or create chat session
        await ensureChatSession(sessionId, senderId, senderName, businessId);

        // Store message in DynamoDB
        const messageRecord = {
            sessionId,
            messageKey: `t#${Date.now()}#${messageId}`,
            messageId,
            senderType,
            senderId,
            senderName: senderName || 'WizzDriver User',
            text: message,
            contentType,
            timestamp,
            createdAt: timestamp,
            platform,
            source: 'public_api',
            businessId: businessId || 'default',
            ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
        };

        await dynamodb.send(new PutCommand({
            TableName: CHAT_MESSAGES_TABLE,
            Item: messageRecord
        }));

        console.log('✅ Message stored in DynamoDB');

        // Forward to active WebSocket connections (support agents)
        const forwardResult = await forwardToSupportAgents(messageRecord);

        // Update session with last message info
        await updateSession(sessionId, timestamp);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                messageId,
                sessionId,
                bridged: forwardResult.agentCount > 0,
                message: forwardResult.agentCount > 0 
                    ? `Message delivered to ${forwardResult.agentCount} support agent(s)`
                    : 'Message received, waiting for support agent to connect',
                timestamp
            })
        };

    } catch (error) {
        console.error('❌ Error in public chat bridge:', error);
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
 * Ensure chat session exists
 */
async function ensureChatSession(sessionId, driverId, driverName, businessId) {
    try {
        // Check if session exists
        const existing = await dynamodb.send(new GetCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId }
        }));

        if (!existing.Item) {
            // Create new session
            const sessionRecord = {
                sessionId,
                driverId,
                driverName: driverName || 'WizzDriver User',
                businessId: businessId || 'default',
                status: 'active',
                platform: 'WizzDriver',
                createdAt: new Date().toISOString(),
                lastMessageAt: new Date().toISOString(),
                messageCount: 0,
                ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
            };

            await dynamodb.send(new PutCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Item: sessionRecord
            }));

            console.log('✅ Created new chat session:', sessionId);
        }
    } catch (error) {
        console.error('❌ Error ensuring chat session:', error);
        // Continue even if session creation fails
    }
}

/**
 * Forward message to active support agents via WebSocket
 */
async function forwardToSupportAgents(messageRecord) {
    try {
        // Find active support agent connections
        const connections = await dynamodb.send(new ScanCommand({
            TableName: WEBSOCKET_CONNECTIONS_TABLE,
            FilterExpression: 'userType = :userType AND attribute_exists(connectedAt)',
            ExpressionAttributeValues: {
                ':userType': 'agent'
            }
        }));

        const activeConnections = connections.Items || [];
        console.log(`📡 Found ${activeConnections.length} active support agent connections`);

        if (activeConnections.length === 0) {
            return { agentCount: 0, delivered: false };
        }

        // Prepare WebSocket message
        const webSocketMessage = {
            type: 'new_message',
            action: 'chat_message',
            sessionId: messageRecord.sessionId,
            messageId: messageRecord.messageId,
            senderType: messageRecord.senderType,
            senderId: messageRecord.senderId,
            senderName: messageRecord.senderName,
            message: messageRecord.text,
            timestamp: messageRecord.timestamp,
            platform: messageRecord.platform || 'WizzDriver'
        };

        // Send to all active agents
        const apiGatewayClient = getApiGatewayManagementClient();

        const deliveryPromises = activeConnections.map(async (connection) => {
            try {
                await apiGatewayClient.send(new PostToConnectionCommand({
                    ConnectionId: connection.connectionId,
                    Data: JSON.stringify(webSocketMessage)
                }));
                return { connectionId: connection.connectionId, success: true };
            } catch (error) {
                console.error(`❌ Failed to deliver to ${connection.connectionId}:`, error);
                
                // Clean up stale connections
                if (error.statusCode === 410) {
                    try {
                        await dynamodb.send(new DeleteCommand({
                            TableName: WEBSOCKET_CONNECTIONS_TABLE,
                            Key: { connectionId: connection.connectionId }
                        }));
                    } catch (deleteError) {
                        console.error('❌ Failed to clean up stale connection:', deleteError);
                    }
                }
                return { connectionId: connection.connectionId, success: false };
            }
        });

        const results = await Promise.all(deliveryPromises);
        const successfulDeliveries = results.filter(r => r.success).length;

        console.log(`📊 Message delivery: ${successfulDeliveries}/${activeConnections.length} successful`);

        return {
            agentCount: successfulDeliveries,
            delivered: successfulDeliveries > 0
        };

    } catch (error) {
        console.error('❌ Error forwarding to support agents:', error);
        return { agentCount: 0, delivered: false };
    }
}

/**
 * Update session with last message timestamp
 */
async function updateSession(sessionId, timestamp) {
    try {
        await dynamodb.send(new UpdateCommand({
            TableName: CHAT_SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET lastMessageAt = :timestamp, messageCount = if_not_exists(messageCount, :zero) + :one',
            ExpressionAttributeValues: {
                ':timestamp': timestamp,
                ':zero': 0,
                ':one': 1
            }
        }));
    } catch (error) {
        console.error('❌ Error updating session:', error);
        // Continue even if update fails
    }
}

/**
 * Get chat history for debugging
 */
exports.getChatHistory = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        const apiValidation = validateApiKey(event);
        if (!apiValidation.valid) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ error: apiValidation.error })
            };
        }

        const sessionId = event.pathParameters?.sessionId;

        if (sessionId) {
            // Get messages for specific session
            const messages = await dynamodb.send(new QueryCommand({
                TableName: CHAT_MESSAGES_TABLE,
                KeyConditionExpression: 'sessionId = :sessionId',
                ExpressionAttributeValues: { ':sessionId': sessionId },
                ScanIndexForward: false, // Most recent first
                Limit: 50
            }));

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    sessionId,
                    messageCount: messages.Items?.length || 0,
                    messages: messages.Items || []
                })
            };
        } else {
            // Get recent sessions
            const sessions = await dynamodb.send(new ScanCommand({
                TableName: CHAT_SESSIONS_TABLE,
                Limit: 20
            }));

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    sessionCount: sessions.Items?.length || 0,
                    sessions: sessions.Items || []
                })
            };
        }

    } catch (error) {
        console.error('❌ Error getting chat history:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
