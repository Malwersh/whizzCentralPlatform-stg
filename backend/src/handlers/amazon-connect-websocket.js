const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const responseHelper = require('../utils/response');

// Initialize AWS clients
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

// Environment variables
const WEBSOCKET_CONNECTIONS_TABLE = process.env.WEBSOCKET_CONNECTIONS_TABLE || 'amazon-connect-websocket-connections';
const TYPING_INDICATORS_TABLE = process.env.TYPING_INDICATORS_TABLE || 'amazon-connect-typing-indicators';
const PRESENCE_TABLE = process.env.PRESENCE_TABLE || 'amazon-connect-presence';

/**
 * Handle WebSocket connection
 */
exports.connect = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const { userId, userType, sessionId, agentId } = event.queryStringParameters || {};

    // Store connection information
    const connectionData = {
      connectionId,
      userId: userId || 'anonymous',
      userType: userType || 'customer',
      sessionId: sessionId || null,
      agentId: agentId || null,
      connectedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      status: 'connected'
    };

    await dynamodb.send(new PutCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Item: connectionData
    }));

    // Update presence status
    if (userId) {
      await updatePresenceStatus(userId, userType, 'online', connectionId);
    }

    console.log(`WebSocket connected: ${connectionId}, User: ${userId}, Type: ${userType}`);

    return { statusCode: 200 };

  } catch (error) {
    console.error('WebSocket connect error:', error);
    return { statusCode: 500 };
  }
};

/**
 * Handle WebSocket disconnection
 */
exports.disconnect = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;

    // Get connection info before deleting
    const connectionResult = await dynamodb.send(new GetCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId }
    }));

    // Remove connection
    await dynamodb.send(new DeleteCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId }
    }));

    // Update presence status
    if (connectionResult.Item && connectionResult.Item.userId) {
      await updatePresenceStatus(
        connectionResult.Item.userId,
        connectionResult.Item.userType,
        'offline',
        null
      );
    }

    // Remove typing indicators
    await removeTypingIndicator(connectionId);

    console.log(`WebSocket disconnected: ${connectionId}`);

    return { statusCode: 200 };

  } catch (error) {
    console.error('WebSocket disconnect error:', error);
    return { statusCode: 500 };
  }
};

/**
 * Handle WebSocket messages
 */
exports.message = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;
    
    const message = JSON.parse(event.body);
    const { action, data } = message;

    const apiGateway = new ApiGatewayManagementApiClient({
      endpoint: `https://${domain}/${stage}`
    });

    switch (action) {
      case 'typing_start':
        await handleTypingStart(connectionId, data, apiGateway);
        break;
      
      case 'typing_stop':
        await handleTypingStop(connectionId, data, apiGateway);
        break;
      
      case 'message_read':
        await handleMessageRead(connectionId, data, apiGateway);
        break;
      
      case 'presence_update':
        await handlePresenceUpdate(connectionId, data, apiGateway);
        break;
      
      case 'agent_status_update':
        await handleAgentStatusUpdate(connectionId, data, apiGateway);
        break;
      
      case 'ping':
        await sendToConnection(apiGateway, connectionId, {
          action: 'pong',
          timestamp: new Date().toISOString()
        });
        break;
      
      default:
        console.log(`Unknown action: ${action}`);
    }

    // Update last activity
    await dynamodb.send(new UpdateCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'SET lastActivity = :timestamp',
      ExpressionAttributeValues: {
        ':timestamp': new Date().toISOString()
      }
    }));

    return { statusCode: 200 };

  } catch (error) {
    console.error('WebSocket message error:', error);
    return { statusCode: 500 };
  }
};

/**
 * Handle typing start indicator
 */
async function handleTypingStart(connectionId, data, apiGateway) {
  try {
    const { sessionId, userId, userType } = data;

    // Store typing indicator
    const typingData = {
      sessionId,
      userId,
      userType,
      connectionId,
      startedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 30 // 30 seconds
    };

    await dynamodb.send(new PutCommand({
      TableName: TYPING_INDICATORS_TABLE,
      Item: typingData
    }));

    // Notify other participants in the session
    await notifySessionParticipants(sessionId, connectionId, {
      action: 'typing_indicator',
      data: {
        userId,
        userType,
        isTyping: true
      }
    }, apiGateway);

  } catch (error) {
    console.error('Handle typing start error:', error);
  }
}

/**
 * Handle typing stop indicator
 */
async function handleTypingStop(connectionId, data, apiGateway) {
  try {
    const { sessionId, userId, userType } = data;

    // Remove typing indicator
    await dynamodb.send(new DeleteCommand({
      TableName: TYPING_INDICATORS_TABLE,
      Key: { sessionId, userId }
    }));

    // Notify other participants in the session
    await notifySessionParticipants(sessionId, connectionId, {
      action: 'typing_indicator',
      data: {
        userId,
        userType,
        isTyping: false
      }
    }, apiGateway);

  } catch (error) {
    console.error('Handle typing stop error:', error);
  }
}

/**
 * Handle message read receipt
 */
async function handleMessageRead(connectionId, data, apiGateway) {
  try {
    const { sessionId, messageId, userId, userType } = data;

    // Notify other participants about read receipt
    await notifySessionParticipants(sessionId, connectionId, {
      action: 'message_read',
      data: {
        messageId,
        readBy: userId,
        readByType: userType,
        readAt: new Date().toISOString()
      }
    }, apiGateway);

  } catch (error) {
    console.error('Handle message read error:', error);
  }
}

/**
 * Handle presence update
 */
async function handlePresenceUpdate(connectionId, data, apiGateway) {
  try {
    const { userId, userType, status } = data;

    await updatePresenceStatus(userId, userType, status, connectionId);

    // Notify relevant connections about presence change
    await notifyPresenceUpdate(userId, userType, status, apiGateway);

  } catch (error) {
    console.error('Handle presence update error:', error);
  }
}

/**
 * Handle agent status update
 */
async function handleAgentStatusUpdate(connectionId, data, apiGateway) {
  try {
    const { agentId, status, queue, reason } = data;

    // Notify other agents and supervisors about status change
    await notifyAgentStatusChange(agentId, status, queue, reason, apiGateway);

  } catch (error) {
    console.error('Handle agent status update error:', error);
  }
}

/**
 * Update user presence status
 */
async function updatePresenceStatus(userId, userType, status, connectionId) {
  try {
    const presenceData = {
      userId,
      userType,
      status, // 'online', 'offline', 'busy', 'away'
      connectionId,
      lastSeen: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await dynamodb.send(new PutCommand({
      TableName: PRESENCE_TABLE,
      Item: presenceData
    }));

  } catch (error) {
    console.error('Update presence status error:', error);
  }
}

/**
 * Remove typing indicator
 */
async function removeTypingIndicator(connectionId) {
  try {
    // Find and remove typing indicators for this connection
    const result = await dynamodb.send(new QueryCommand({
      TableName: TYPING_INDICATORS_TABLE,
      IndexName: 'ConnectionIdIndex', // Assuming GSI exists
      KeyConditionExpression: 'connectionId = :connectionId',
      ExpressionAttributeValues: {
        ':connectionId': connectionId
      }
    }));

    for (const item of result.Items || []) {
      await dynamodb.send(new DeleteCommand({
        TableName: TYPING_INDICATORS_TABLE,
        Key: {
          sessionId: item.sessionId,
          userId: item.userId
        }
      }));
    }

  } catch (error) {
    console.error('Remove typing indicator error:', error);
  }
}

/**
 * Notify session participants
 */
async function notifySessionParticipants(sessionId, senderConnectionId, message, apiGateway) {
  try {
    // Get all connections for this session
    const result = await dynamodb.send(new QueryCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      IndexName: 'SessionIdIndex', // Assuming GSI exists
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId
      }
    }));

    const notifications = (result.Items || [])
      .filter(item => item.connectionId !== senderConnectionId)
      .map(item => sendToConnection(apiGateway, item.connectionId, message));

    await Promise.allSettled(notifications);

  } catch (error) {
    console.error('Notify session participants error:', error);
  }
}

/**
 * Notify presence update
 */
async function notifyPresenceUpdate(userId, userType, status, apiGateway) {
  try {
    // Get connections that should be notified about this user's presence
    const result = await dynamodb.send(new QueryCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      IndexName: 'UserTypeIndex', // Assuming GSI exists
      KeyConditionExpression: 'userType = :userType',
      ExpressionAttributeValues: {
        ':userType': userType === 'customer' ? 'agent' : 'customer' // Notify opposite type
      }
    }));

    const message = {
      action: 'presence_update',
      data: {
        userId,
        userType,
        status,
        timestamp: new Date().toISOString()
      }
    };

    const notifications = (result.Items || [])
      .map(item => sendToConnection(apiGateway, item.connectionId, message));

    await Promise.allSettled(notifications);

  } catch (error) {
    console.error('Notify presence update error:', error);
  }
}

/**
 * Notify agent status change
 */
async function notifyAgentStatusChange(agentId, status, queue, reason, apiGateway) {
  try {
    // Get supervisor and admin connections
    const result = await dynamodb.send(new QueryCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      IndexName: 'UserTypeIndex',
      KeyConditionExpression: 'userType = :userType',
      ExpressionAttributeValues: {
        ':userType': 'supervisor'
      }
    }));

    const message = {
      action: 'agent_status_change',
      data: {
        agentId,
        status,
        queue,
        reason,
        timestamp: new Date().toISOString()
      }
    };

    const notifications = (result.Items || [])
      .map(item => sendToConnection(apiGateway, item.connectionId, message));

    await Promise.allSettled(notifications);

  } catch (error) {
    console.error('Notify agent status change error:', error);
  }
}

/**
 * Send message to specific connection
 */
async function sendToConnection(apiGateway, connectionId, message) {
  try {
    await apiGateway.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }));
  } catch (error) {
    if (error.statusCode === 410) {
      // Connection is stale, remove it
      await dynamodb.send(new DeleteCommand({
        TableName: WEBSOCKET_CONNECTIONS_TABLE,
        Key: { connectionId }
      }));
    } else {
      console.error(`Failed to send message to ${connectionId}:`, error);
    }
  }
}

/**
 * Broadcast message to all connections of a specific type
 */
exports.broadcast = async (event) => {
  try {
    const { userType, message, excludeConnectionId } = JSON.parse(event.body);

    const domain = event.requestContext.domainName;
    const stage = event.requestContext.stage;
    
    const apiGateway = new ApiGatewayManagementApiClient({
      endpoint: `https://${domain}/${stage}`
    });

    // Get all connections of the specified type
    const result = await dynamodb.send(new QueryCommand({
      TableName: WEBSOCKET_CONNECTIONS_TABLE,
      IndexName: 'UserTypeIndex',
      KeyConditionExpression: 'userType = :userType',
      ExpressionAttributeValues: {
        ':userType': userType
      }
    }));

    const connections = (result.Items || [])
      .filter(item => item.connectionId !== excludeConnectionId);

    const notifications = connections.map(item => 
      sendToConnection(apiGateway, item.connectionId, message)
    );

    await Promise.allSettled(notifications);

    return responseHelper.success({
      message: 'Broadcast sent successfully',
      sentTo: connections.length
    });

  } catch (error) {
    console.error('Broadcast error:', error);
    return responseHelper.serverError('Failed to broadcast message');
  }
};

/**
 * Get active connections for monitoring
 */
exports.getActiveConnections = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { userType, sessionId } = event.queryStringParameters || {};

    let queryParams = {
      TableName: WEBSOCKET_CONNECTIONS_TABLE
    };

    if (userType) {
      queryParams = {
        ...queryParams,
        IndexName: 'UserTypeIndex',
        KeyConditionExpression: 'userType = :userType',
        ExpressionAttributeValues: {
          ':userType': userType
        }
      };
    } else if (sessionId) {
      queryParams = {
        ...queryParams,
        IndexName: 'SessionIdIndex',
        KeyConditionExpression: 'sessionId = :sessionId',
        ExpressionAttributeValues: {
          ':sessionId': sessionId
        }
      };
    } else {
      // Scan all connections
      const result = await dynamodb.send(new ScanCommand({
        TableName: WEBSOCKET_CONNECTIONS_TABLE
      }));

      return responseHelper.success({
        connections: result.Items || [],
        count: result.Items?.length || 0
      });
    }

    const result = await dynamodb.send(new QueryCommand(queryParams));

    return responseHelper.success({
      connections: result.Items || [],
      count: result.Items?.length || 0
    });

  } catch (error) {
    console.error('Get active connections error:', error);
    return responseHelper.serverError('Failed to get active connections');
  }
};

/**
 * Get typing indicators for a session
 */
exports.getTypingIndicators = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { sessionId } = event.pathParameters;

    const result = await dynamodb.send(new QueryCommand({
      TableName: TYPING_INDICATORS_TABLE,
      KeyConditionExpression: 'sessionId = :sessionId',
      FilterExpression: 'expiresAt > :currentTime',
      ExpressionAttributeValues: {
        ':sessionId': sessionId,
        ':currentTime': Math.floor(Date.now() / 1000)
      }
    }));

    return responseHelper.success({
      typingUsers: result.Items || [],
      count: result.Items?.length || 0
    });

  } catch (error) {
    console.error('Get typing indicators error:', error);
    return responseHelper.serverError('Failed to get typing indicators');
  }
};

/**
 * Get presence status for users
 */
exports.getPresenceStatus = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { userIds, userType } = event.queryStringParameters || {};

    let queryParams = {
      TableName: PRESENCE_TABLE
    };

    if (userType) {
      queryParams = {
        ...queryParams,
        IndexName: 'UserTypeIndex',
        KeyConditionExpression: 'userType = :userType',
        ExpressionAttributeValues: {
          ':userType': userType
        }
      };

      const result = await dynamodb.send(new QueryCommand(queryParams));
      return responseHelper.success({
        presenceData: result.Items || [],
        count: result.Items?.length || 0
      });
    }

    if (userIds) {
      const userIdList = userIds.split(',');
      const results = await Promise.all(
        userIdList.map(userId => 
          dynamodb.send(new GetCommand({
            TableName: PRESENCE_TABLE,
            Key: { userId }
          }))
        )
      );

      const presenceData = results
        .map(result => result.Item)
        .filter(item => item !== undefined);

      return responseHelper.success({
        presenceData,
        count: presenceData.length
      });
    }

    // Get all presence data
    const result = await dynamodb.send(new ScanCommand({
      TableName: PRESENCE_TABLE
    }));

    return responseHelper.success({
      presenceData: result.Items || [],
      count: result.Items?.length || 0
    });

  } catch (error) {
    console.error('Get presence status error:', error);
    return responseHelper.serverError('Failed to get presence status');
  }
};
