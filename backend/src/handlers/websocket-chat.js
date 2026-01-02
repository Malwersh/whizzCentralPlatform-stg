/**
 * WebSocket Chat Handlers for Real-time Features
 * Handles WebSocket connections, typing indicators, read receipts, presence
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const responseHelper = require('../utils/response');

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

// WebSocket connection table
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE || 'AmazonConnect-WebSocketConnections-dev';
const CHAT_HISTORY_TABLE = process.env.CHAT_HISTORY_TABLE || 'AmazonConnect-ChatHistory-dev';
const AGENT_MANAGEMENT_TABLE = process.env.AGENT_MANAGEMENT_TABLE || 'AmazonConnect-AgentManagement-dev';

/**
 * Handle WebSocket Connection
 */
exports.connect = async (event) => {
  try {
    console.log('WebSocket connection request:', JSON.stringify(event, null, 2));

    const connectionId = event.requestContext.connectionId;
    const { sessionId, userType, userId, userName } = event.queryStringParameters || {};

    if (!sessionId || !userType || !userId) {
      console.error('Missing required parameters for WebSocket connection');
      return { statusCode: 400, body: 'Missing required parameters' };
    }

    // Store connection information
    const connectionRecord = {
      connectionId,
      sessionId,
      userType, // 'customer', 'agent', 'admin'
      userId,
      userName: userName || 'Unknown',
      connectedAt: new Date().toISOString(),
      lastPingAt: new Date().toISOString(),
      status: 'connected'
    };

    await dynamodb.send(new PutCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Item: connectionRecord
    }));

    // Notify other participants in the session about the new connection
    await notifySessionParticipants(sessionId, connectionId, 'user_connected', {
      userId,
      userName: connectionRecord.userName,
      userType,
      connectedAt: connectionRecord.connectedAt
    });

    // Update agent status if it's an agent connecting
    if (userType === 'agent') {
      try {
        await dynamodb.send(new UpdateCommand({
          TableName: AGENT_MANAGEMENT_TABLE,
          Key: { agentId: userId },
          UpdateExpression: 'SET #status = :status, connectionId = :connectionId, lastUpdated = :timestamp',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'online',
            ':connectionId': connectionId,
            ':timestamp': new Date().toISOString()
          }
        }));
      } catch (agentError) {
        console.warn('Failed to update agent status:', agentError);
      }
    }

    console.log(`WebSocket connected: ${connectionId} for session ${sessionId}`);

    return { statusCode: 200, body: 'Connected' };

  } catch (error) {
    console.error('Error handling WebSocket connection:', error);
    return { statusCode: 500, body: 'Failed to connect' };
  }
};

/**
 * Handle WebSocket Disconnection
 */
exports.disconnect = async (event) => {
  try {
    console.log('WebSocket disconnection request:', JSON.stringify(event, null, 2));

    const connectionId = event.requestContext.connectionId;

    // Get connection details before deleting
    const connectionQuery = await dynamodb.send(new GetCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId }
    }));

    if (connectionQuery.Item) {
      const connection = connectionQuery.Item;

      // Notify other participants about the disconnection
      await notifySessionParticipants(connection.sessionId, connectionId, 'user_disconnected', {
        userId: connection.userId,
        userName: connection.userName,
        userType: connection.userType,
        disconnectedAt: new Date().toISOString()
      });

      // Update agent status if it's an agent disconnecting
      if (connection.userType === 'agent') {
        try {
          await dynamodb.send(new UpdateCommand({
            TableName: AGENT_MANAGEMENT_TABLE,
            Key: { agentId: connection.userId },
            UpdateExpression: 'SET #status = :status, connectionId = :connectionId, lastUpdated = :timestamp',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':status': 'available',
              ':connectionId': null,
              ':timestamp': new Date().toISOString()
            }
          }));
        } catch (agentError) {
          console.warn('Failed to update agent status on disconnect:', agentError);
        }
      }
    }

    // Remove connection record
    await dynamodb.send(new DeleteCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId }
    }));

    console.log(`WebSocket disconnected: ${connectionId}`);

    return { statusCode: 200, body: 'Disconnected' };

  } catch (error) {
    console.error('Error handling WebSocket disconnection:', error);
    return { statusCode: 500, body: 'Failed to disconnect' };
  }
};

/**
 * Handle WebSocket Messages
 */
exports.handleMessage = async (event) => {
  try {
    console.log('WebSocket message received:', JSON.stringify(event, null, 2));

    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body);
    const { action, data } = body;

    // Get connection details
    const connectionQuery = await dynamodb.send(new GetCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId }
    }));

    if (!connectionQuery.Item) {
      console.error('Connection not found:', connectionId);
      return { statusCode: 404, body: 'Connection not found' };
    }

    const connection = connectionQuery.Item;

    // Handle different message types
    switch (action) {
      case 'typing_start':
        await handleTypingIndicator(connection, 'start', data);
        break;

      case 'typing_stop':
        await handleTypingIndicator(connection, 'stop', data);
        break;

      case 'message_read':
        await handleReadReceipt(connection, data);
        break;

      case 'ping':
        await handlePing(connection);
        break;

      case 'status_update':
        await handleStatusUpdate(connection, data);
        break;

      case 'join_session':
        await handleJoinSession(connection, data);
        break;

      case 'leave_session':
        await handleLeaveSession(connection, data);
        break;

      case 'chat_session_close':
      case 'session_closed':
        await handleSessionClose(connection, data);
        break;

      default:
        console.warn('Unknown WebSocket action:', action);
        await sendToConnection(connectionId, {
          type: 'error',
          message: 'Unknown action',
          timestamp: new Date().toISOString()
        });
    }

    return { statusCode: 200, body: 'Message processed' };

  } catch (error) {
    console.error('Error handling WebSocket message:', error);
    return { statusCode: 500, body: 'Failed to process message' };
  }
};

/**
 * Handle Typing Indicators
 */
async function handleTypingIndicator(connection, action, data) {
  try {
    const { sessionId } = data;
    
    // Update connection with typing status
    await dynamodb.send(new UpdateCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId: connection.connectionId },
      UpdateExpression: 'SET isTyping = :isTyping, lastTypingAt = :timestamp',
      ExpressionAttributeValues: {
        ':isTyping': action === 'start',
        ':timestamp': new Date().toISOString()
      }
    }));

    // Notify other participants
    await notifySessionParticipants(sessionId, connection.connectionId, 'typing_indicator', {
      userId: connection.userId,
      userName: connection.userName,
      isTyping: action === 'start',
      timestamp: new Date().toISOString()
    });

    console.log(`Typing indicator: ${connection.userName} ${action} typing in session ${sessionId}`);

  } catch (error) {
    console.error('Error handling typing indicator:', error);
  }
}

/**
 * Handle Read Receipts
 */
async function handleReadReceipt(connection, data) {
  try {
    const { messageId, sessionId } = data;

    // Update message with read receipt
    try {
      await dynamodb.send(new UpdateCommand({
        TableName: CHAT_HISTORY_TABLE,
        Key: { messageId },
        UpdateExpression: 'SET readBy = list_append(if_not_exists(readBy, :empty_list), :reader)',
        ExpressionAttributeValues: {
          ':empty_list': [],
          ':reader': [{
            userId: connection.userId,
            userName: connection.userName,
            readAt: new Date().toISOString()
          }]
        }
      }));
    } catch (updateError) {
      console.warn('Failed to update read receipt:', updateError);
    }

    // Notify message sender about read receipt
    await notifySessionParticipants(sessionId, connection.connectionId, 'message_read', {
      messageId,
      readBy: {
        userId: connection.userId,
        userName: connection.userName,
        readAt: new Date().toISOString()
      }
    });

    console.log(`Read receipt: ${connection.userName} read message ${messageId}`);

  } catch (error) {
    console.error('Error handling read receipt:', error);
  }
}

/**
 * Handle Ping/Keepalive
 */
async function handlePing(connection) {
  try {
    // Update last ping time
    await dynamodb.send(new UpdateCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId: connection.connectionId },
      UpdateExpression: 'SET lastPingAt = :timestamp',
      ExpressionAttributeValues: {
        ':timestamp': new Date().toISOString()
      }
    }));

    // Send pong response
    await sendToConnection(connection.connectionId, {
      type: 'pong',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error handling ping:', error);
  }
}

/**
 * Handle Status Updates
 */
async function handleStatusUpdate(connection, data) {
  try {
    const { status, sessionId } = data;

    // Update connection status
    await dynamodb.send(new UpdateCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId: connection.connectionId },
      UpdateExpression: 'SET #status = :status, lastUpdated = :timestamp',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': status,
        ':timestamp': new Date().toISOString()
      }
    }));

    // If it's an agent, update agent table
    if (connection.userType === 'agent') {
      try {
        await dynamodb.send(new UpdateCommand({
          TableName: AGENT_MANAGEMENT_TABLE,
          Key: { agentId: connection.userId },
          UpdateExpression: 'SET #status = :status, lastUpdated = :timestamp',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': status,
            ':timestamp': new Date().toISOString()
          }
        }));
      } catch (agentError) {
        console.warn('Failed to update agent status:', agentError);
      }
    }

    // Notify other participants
    await notifySessionParticipants(sessionId, connection.connectionId, 'status_update', {
      userId: connection.userId,
      userName: connection.userName,
      userType: connection.userType,
      status,
      timestamp: new Date().toISOString()
    });

    console.log(`Status update: ${connection.userName} is now ${status}`);

  } catch (error) {
    console.error('Error handling status update:', error);
  }
}

/**
 * Handle Join Session
 */
async function handleJoinSession(connection, data) {
  try {
    const { sessionId } = data;

    // Update connection with new session
    await dynamodb.send(new UpdateCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId: connection.connectionId },
      UpdateExpression: 'SET sessionId = :sessionId, lastUpdated = :timestamp',
      ExpressionAttributeValues: {
        ':sessionId': sessionId,
        ':timestamp': new Date().toISOString()
      }
    }));

    // Notify other participants
    await notifySessionParticipants(sessionId, connection.connectionId, 'user_joined', {
      userId: connection.userId,
      userName: connection.userName,
      userType: connection.userType,
      joinedAt: new Date().toISOString()
    });

    // Send session info to the new participant
    await sendSessionInfo(connection.connectionId, sessionId);

    console.log(`User joined session: ${connection.userName} joined ${sessionId}`);

  } catch (error) {
    console.error('Error handling join session:', error);
  }
}

/**
 * Handle Leave Session
 */
async function handleLeaveSession(connection, data) {
  try {
    const { sessionId } = data;

    // Notify other participants
    await notifySessionParticipants(sessionId, connection.connectionId, 'user_left', {
      userId: connection.userId,
      userName: connection.userName,
      userType: connection.userType,
      leftAt: new Date().toISOString()
    });

    console.log(`User left session: ${connection.userName} left ${sessionId}`);

  } catch (error) {
    console.error('Error handling leave session:', error);
  }
}

/**
 * Handle Session Close (Agent ends chat session)
 */
async function handleSessionClose(connection, data) {
  try {
    const { sessionId, closedByUserType, closedByUserId, reason } = data;
    const sessionToClose = sessionId || connection.sessionId;

    console.log(`Session close request: ${connection.userName} (${connection.userType}) closing session ${sessionToClose}`);

    // Update session status in database if needed
    // (You may want to add a SESSIONS_TABLE to track session metadata)

    // Notify all participants in the session that it's closed
    await notifySessionParticipants(sessionToClose, connection.connectionId, 'session_closed', {
      sessionId: sessionToClose,
      closedByUserId: closedByUserId || connection.userId,
      closedByUserType: closedByUserType || connection.userType,
      closedByUserName: connection.userName,
      reason: reason || 'ended_by_agent',
      closedAt: new Date().toISOString(),
      timestamp: new Date().toISOString()
    });

    // Also send confirmation back to the agent who closed it
    await sendToConnection(connection.connectionId, {
      type: 'session_closed_confirm',
      sessionId: sessionToClose,
      message: 'Session closed successfully',
      closedAt: new Date().toISOString(),
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Session closed: ${sessionToClose} by ${connection.userName} (${connection.userType})`);

  } catch (error) {
    console.error('Error handling session close:', error);
    
    // Send error back to requester
    try {
      await sendToConnection(connection.connectionId, {
        type: 'error',
        message: 'Failed to close session',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    } catch (sendError) {
      console.error('Failed to send error message:', sendError);
    }
  }
}

/**
 * Notify all participants in a session
 */
async function notifySessionParticipants(sessionId, excludeConnectionId, eventType, data) {
  try {
    // Get all connections for this session
    const connectionsQuery = {
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      FilterExpression: 'sessionId = :sessionId AND connectionId <> :excludeId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId,
        ':excludeId': excludeConnectionId
      }
    };

    const connectionsResult = await dynamodb.send(new QueryCommand(connectionsQuery));
    const connections = connectionsResult.Items || [];

    // Send notification to all connections
    const notifications = connections.map(connection => 
      sendToConnection(connection.connectionId, {
        type: eventType,
        sessionId,
        data,
        timestamp: new Date().toISOString()
      })
    );

    await Promise.allSettled(notifications);

    console.log(`Notified ${connections.length} participants about ${eventType} in session ${sessionId}`);

  } catch (error) {
    console.error('Error notifying session participants:', error);
  }
}

/**
 * Send session information to a connection
 */
async function sendSessionInfo(connectionId, sessionId) {
  try {
    // Get session details
    const sessionQuery = await dynamodb.send(new GetCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: { sessionId }
    }));

    if (!sessionQuery.Item) {
      console.warn('Session not found:', sessionId);
      return;
    }

    // Get active participants
    const participantsQuery = {
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      FilterExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId
      }
    };

    const participantsResult = await dynamodb.send(new QueryCommand(participantsQuery));
    const participants = participantsResult.Items || [];

    // Send session info
    await sendToConnection(connectionId, {
      type: 'session_info',
      sessionId,
      sessionData: sessionQuery.Item,
      participants: participants.map(p => ({
        userId: p.userId,
        userName: p.userName,
        userType: p.userType,
        status: p.status,
        connectedAt: p.connectedAt,
        isTyping: p.isTyping || false
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error sending session info:', error);
  }
}

/**
 * Send message to a specific WebSocket connection
 */
async function sendToConnection(connectionId, message) {
  try {
    const stage = String(process.env.STAGE || process.env.NODE_ENV || 'staging');
    const rawEndpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT || process.env.WEBSOCKET_API_ENDPOINT;
    if (!rawEndpoint) {
      throw new Error('Missing WEBSOCKET_MANAGEMENT_ENDPOINT (or WEBSOCKET_API_ENDPOINT) env var');
    }
    if (String(rawEndpoint).includes('/dev') && stage !== 'dev') {
      throw new Error(`Refusing to use dev WebSocket management endpoint in ${stage}: ${rawEndpoint}`);
    }
    const endpoint = String(rawEndpoint).replace(/^wss:\/\//, 'https://');
    const apiGateway = new ApiGatewayManagementApiClient({
      region: process.env.AWS_REGION || 'us-east-1',
      endpoint
    });

    await apiGateway.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }));

  } catch (error) {
    if (error.statusCode === 410) {
      // Connection is gone, remove it
      console.log('Removing stale connection:', connectionId);
      await dynamodb.send(new DeleteCommand({
        TableName: WEBSOCKET_CONNECTIONS_TABLE,
        Key: { connectionId }
      }));
    } else {
      console.error('Error sending message to connection:', error);
    }
  }
}

/**
 * Broadcast message to all connections in a session
 * (Can be called by external functions)
 */
exports.broadcastToSession = async (sessionId, message, excludeConnectionId = null) => {
  try {
    const connectionsQuery = {
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      FilterExpression: excludeConnectionId ? 
        'sessionId = :sessionId AND connectionId <> :excludeId' :
        'sessionId = :sessionId',
      ExpressionAttributeValues: excludeConnectionId ? {
        ':sessionId': sessionId,
        ':excludeId': excludeConnectionId
      } : {
        ':sessionId': sessionId
      }
    };

    const connectionsResult = await dynamodb.send(new QueryCommand(connectionsQuery));
    const connections = connectionsResult.Items || [];

    const broadcasts = connections.map(connection => 
      sendToConnection(connection.connectionId, message)
    );

    await Promise.allSettled(broadcasts);

    console.log(`Broadcasted message to ${connections.length} connections in session ${sessionId}`);
    return { sent: connections.length };

  } catch (error) {
    console.error('Error broadcasting to session:', error);
    throw error;
  }
};

/**
 * Get active connections for a session
 */
exports.getSessionConnections = async (sessionId) => {
  try {
    const connectionsQuery = {
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      FilterExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId
      }
    };

    const connectionsResult = await dynamodb.send(new QueryCommand(connectionsQuery));
    return connectionsResult.Items || [];

  } catch (error) {
    console.error('Error getting session connections:', error);
    return [];
  }
};

/**
 * Clean up stale connections (can be called by a scheduled function)
 */
exports.cleanupStaleConnections = async () => {
  try {
    console.log('Cleaning up stale WebSocket connections...');

    // Get all connections older than 1 hour with no recent ping
    const staleTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const staleQuery = {
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      FilterExpression: 'lastPingAt < :staleTime',
      ExpressionAttributeValues: {
        ':staleTime': staleTime
      }
    };

    const staleResult = await dynamodb.send(new QueryCommand(staleQuery));
    const staleConnections = staleResult.Items || [];

    console.log(`Found ${staleConnections.length} stale connections`);

    // Remove stale connections
    const cleanupPromises = staleConnections.map(connection =>
      dynamodb.send(new DeleteCommand({
        TableName: WEBSOCKET_CONNECTIONS_TABLE,
        Key: { connectionId: connection.connectionId }
      }))
    );

    await Promise.allSettled(cleanupPromises);

    console.log(`Cleaned up ${staleConnections.length} stale connections`);
    return { cleaned: staleConnections.length };

  } catch (error) {
    console.error('Error cleaning up stale connections:', error);
    throw error;
  }
};

module.exports = {
  connect: exports.connect,
  disconnect: exports.disconnect,
  handleMessage: exports.handleMessage,
  broadcastToSession: exports.broadcastToSession,
  getSessionConnections: exports.getSessionConnections,
  cleanupStaleConnections: exports.cleanupStaleConnections
};
