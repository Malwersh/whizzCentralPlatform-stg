/**
 /**
 * Fixed Chat Bridge Handler - AWS SDK Compatible Version
 * Resolves the @aws/lambda-invoke-store dependency issue
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { PutCommand, GetCommand, QueryCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Use the built-in AWS SDK for API Gateway Management (avoids dependency issues)
const AWS = require('aws-sdk');

function getApiGatewayManagementApi() {
    const stage = String(process.env.STAGE || process.env.NODE_ENV || 'staging');
    const rawEndpoint = process.env.WEBSOCKET_API_ENDPOINT;
    if (!rawEndpoint) {
        throw new Error('Missing WEBSOCKET_API_ENDPOINT env var');
    }
    if (String(rawEndpoint).includes('/dev') && stage !== 'dev') {
        throw new Error(`Refusing to use dev WebSocket endpoint in ${stage}: ${rawEndpoint}`);
    }

    const endpoint = String(rawEndpoint).replace(/^wss:\/\//, 'https://');
    return new AWS.ApiGatewayManagementApi({ endpoint });
}

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE;
const CHAT_SESSIONS_TABLE = process.env.CHAT_SESSIONS_TABLE;
const CHAT_MESSAGES_TABLE = process.env.CHAT_MESSAGES_TABLE;

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
};

/**
 * Handle HTTP chat messages from Flutter app and forward to WebSocket Live Chat
 */
exports.sendChatMessage = async (event) => {
    console.log('📨 Fixed chat bridge received HTTP message:', JSON.stringify(event, null, 2));

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
        if (!CHAT_MESSAGES_TABLE) throw new Error('Missing CHAT_MESSAGES_TABLE env var');

        // Parse request body
        let body;
        try {
            body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        } catch (parseError) {
            console.error('❌ Invalid JSON in request body:', parseError);
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: 'Invalid JSON format',
                    message: 'Request body must be valid JSON'
                })
            };
        }

        console.log('📋 Parsed message body:', JSON.stringify(body, null, 2));

        // Validate required fields
        if (!body.participantToken || !body.message) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: 'Missing required fields',
                    required: ['participantToken', 'message']
                })
            };
        }

        const sessionId = body.participantToken;
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toISOString();

        // Store message in DynamoDB
        console.log('💾 Storing message in DynamoDB...');
        const messageRecord = {
            sessionId: sessionId,
            messageKey: messageId,
            messageId: messageId,
            senderId: body.metadata?.senderId || sessionId,
            senderType: body.metadata?.senderType || 'driver',
            senderName: body.metadata?.senderName || 'Driver',
            message: body.message,
            contentType: body.contentType || 'text/plain',
            timestamp: timestamp,
            createdAt: timestamp,
            metadata: body.metadata || {},
            platform: body.metadata?.platform || 'Flutter-HTTP'
        };

        try {
            await dynamodb.send(new PutCommand({
                TableName: CHAT_MESSAGES_TABLE,
                Item: messageRecord
            }));
            console.log('✅ Message stored successfully in DynamoDB');
        } catch (dbError) {
            console.error('❌ DynamoDB storage failed:', dbError);
            // Continue anyway - we can still try to broadcast
        }

        // Get active WebSocket connections
        console.log('🔍 Looking for active WebSocket connections...');
        let connections = [];
        try {
            const connectionsResult = await dynamodb.send(new QueryCommand({
                TableName: WEBSOCKET_CONNECTIONS_TABLE,
                IndexName: 'userType-index',
                KeyConditionExpression: 'userType = :userType',
                ExpressionAttributeValues: {
                    ':userType': 'agent'
                }
            }));
            connections = connectionsResult.Items || [];
            console.log(`📡 Found ${connections.length} agent connections`);
        } catch (connectionsError) {
            console.error('❌ Failed to get connections:', connectionsError);
            connections = [];
        }

        // Broadcast to WebSocket connections
        const broadcastMessage = {
            type: 'driver_message',
            sessionId: sessionId,
            messageId: messageId,
            senderId: messageRecord.senderId,
            senderType: messageRecord.senderType,
            senderName: messageRecord.senderName,
            message: body.message,
            timestamp: timestamp,
            metadata: messageRecord.metadata
        };

        console.log('📤 Broadcasting to WebSocket connections...');
        const apigatewaymanagementapi = getApiGatewayManagementApi();
        const broadcastPromises = connections.map(async (connection) => {
            try {
                await apigatewaymanagementapi.postToConnection({
                    ConnectionId: connection.connectionId,
                    Data: JSON.stringify(broadcastMessage)
                }).promise();
                console.log(`✅ Broadcasted to connection: ${connection.connectionId}`);
                return { connectionId: connection.connectionId, success: true };
            } catch (error) {
                console.error(`❌ Failed to broadcast to ${connection.connectionId}:`, error);
                
                // Remove stale connection if it's a 410 Gone error
                if (error.statusCode === 410) {
                    try {
                        await dynamodb.send(new DeleteCommand({
                            TableName: WEBSOCKET_CONNECTIONS_TABLE,
                            Key: { connectionId: connection.connectionId }
                        }));
                        console.log(`🧹 Removed stale connection: ${connection.connectionId}`);
                    } catch (deleteError) {
                        console.error(`❌ Failed to remove stale connection:`, deleteError);
                    }
                }
                return { connectionId: connection.connectionId, success: false, error: error.message };
            }
        });

        const broadcastResults = await Promise.all(broadcastPromises);
        const successfulBroadcasts = broadcastResults.filter(r => r.success).length;
        
        console.log(`📊 Broadcast summary: ${successfulBroadcasts}/${connections.length} successful`);

        // Return success response
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                messageId: messageId,
                sessionId: sessionId,
                timestamp: timestamp,
                broadcastResults: {
                    total: connections.length,
                    successful: successfulBroadcasts,
                    failed: connections.length - successfulBroadcasts
                },
                message: 'Message processed and broadcasted successfully'
            })
        };

    } catch (error) {
        console.error('❌ Chat bridge error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal server error',
                message: 'Failed to process chat message',
                details: error.message
            })
        };
    }
};

/**
 * Handle agent replies from Central Platform
 */
exports.postAgentReply = async (event) => {
    console.log('📨 Agent reply received:', JSON.stringify(event, null, 2));

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    try {
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        
        const messageId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toISOString();

        // Store agent reply
        const messageRecord = {
            sessionId: body.sessionId,
            messageKey: messageId,
            messageId: messageId,
            senderId: body.agentId || 'agent',
            senderType: 'agent',
            senderName: body.agentName || 'Support Agent',
            message: body.message,
            contentType: 'text/plain',
            timestamp: timestamp,
            createdAt: timestamp,
            metadata: {
                agentId: body.agentId,
                agentName: body.agentName,
                platform: 'CentralPlatform'
            }
        };

        await dynamodb.send(new PutCommand({
            TableName: CHAT_MESSAGES_TABLE,
            Item: messageRecord
        }));

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                messageId: messageId,
                message: 'Agent reply stored successfully'
            })
        };

    } catch (error) {
        console.error('❌ Agent reply error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Failed to process agent reply',
                details: error.message
            })
        };
    }
};

/**
 * Get chat history for debugging
 */
exports.getChatHistory = async (event) => {
    console.log('📋 Get chat history request:', JSON.stringify(event, null, 2));

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    try {
        const sessionId = event.queryStringParameters?.sessionId || 'all';
        
        let messages = [];
        if (sessionId === 'all') {
            // Get recent messages from all sessions
            const result = await dynamodb.send(new ScanCommand({
                TableName: CHAT_MESSAGES_TABLE,
                Limit: 50
            }));
            messages = result.Items || [];
        } else {
            // Get messages for specific session
            const result = await dynamodb.send(new QueryCommand({
                TableName: CHAT_MESSAGES_TABLE,
                KeyConditionExpression: 'sessionId = :sessionId',
                ExpressionAttributeValues: {
                    ':sessionId': sessionId
                }
            }));
            messages = result.Items || [];
        }

        // Sort by timestamp
        messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                sessionId: sessionId,
                messageCount: messages.length,
                messages: messages,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('❌ Get chat history error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Failed to get chat history',
                details: error.message
            })
        };
    }
};
