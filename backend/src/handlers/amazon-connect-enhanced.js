const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { ConnectClient, StartChatContactCommand, StopContactCommand } = require('@aws-sdk/client-connect');
const { ConnectParticipantClient, CreateParticipantConnectionCommand, SendMessageCommand, DisconnectParticipantCommand } = require('@aws-sdk/client-connectparticipant');
const responseHelper = require('../utils/response');
const { v4: uuidv4 } = require('uuid');

// Initialize AWS clients
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });
const connectParticipant = new ConnectParticipantClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Environment variables
const CHAT_HISTORY_TABLE = process.env.CHAT_HISTORY_TABLE || 'amazon-connect-chat-history';
const CHAT_FILES_TABLE = process.env.CHAT_FILES_TABLE || 'amazon-connect-chat-files';
const AGENT_MANAGEMENT_TABLE = process.env.AGENT_MANAGEMENT_TABLE || 'amazon-connect-agents';
const CHAT_ANALYTICS_TABLE = process.env.CHAT_ANALYTICS_TABLE || 'amazon-connect-analytics';
const S3_BUCKET = process.env.CHAT_FILES_BUCKET || 'wizzcentral-chat-files';
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || '35281ded-3770-4eb9-ab23-9c7415f8cb9b';
const CONTACT_FLOW_ID = process.env.CONTACT_FLOW_ID || '67330f39-fe8c-4f0f-b824-3d50731b08d9';

/**
 * Generate presigned URL for file upload
 */
exports.generateFileUploadUrl = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { fileName, fileType, fileSize, sessionId } = JSON.parse(event.body);

    // Validate file size (10MB limit)
    if (fileSize > 10 * 1024 * 1024) {
      return responseHelper.error(400, 'File size exceeds 10MB limit');
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (!allowedTypes.includes(fileType)) {
      return responseHelper.error(400, 'File type not allowed');
    }

    const fileId = uuidv4();
    const fileKey = `chat-files/${sessionId}/${fileId}-${fileName}`;

    // Generate presigned URL for upload
    const uploadCommand = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: fileKey,
      ContentType: fileType,
      Metadata: {
        sessionId,
        originalName: fileName,
        uploadedAt: new Date().toISOString()
      }
    });

    const uploadUrl = await getSignedUrl(s3, uploadCommand, { expiresIn: 3600 });

    // Store file metadata in DynamoDB
    await dynamodb.send(new PutCommand({
      TableName: CHAT_FILES_TABLE,
      Item: {
        fileId,
        sessionId,
        fileName,
        fileType,
        fileSize,
        fileKey,
        status: 'uploading',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
      }
    }));

    return responseHelper.success({
      fileId,
      uploadUrl,
      fileKey
    });

  } catch (error) {
    console.error('Generate upload URL error:', error);
    return responseHelper.serverError('Failed to generate upload URL');
  }
};

/**
 * Complete file upload and generate download URL
 */
exports.completeFileUpload = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { fileId } = JSON.parse(event.body);

    // Update file status to completed
    await dynamodb.send(new UpdateCommand({
      TableName: CHAT_FILES_TABLE,
      Key: { fileId },
      UpdateExpression: 'SET #status = :status, completedAt = :completedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'completed',
        ':completedAt': new Date().toISOString()
      }
    }));

    // Get file metadata
    const fileResult = await dynamodb.send(new GetCommand({
      TableName: CHAT_FILES_TABLE,
      Key: { fileId }
    }));

    if (!fileResult.Item) {
      return responseHelper.error(404, 'File not found');
    }

    const file = fileResult.Item;

    // Generate download URL
    const downloadCommand = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: file.fileKey
    });

    const downloadUrl = await getSignedUrl(s3, downloadCommand, { expiresIn: 3600 });

    return responseHelper.success({
      fileId,
      fileName: file.fileName,
      fileType: file.fileType,
      fileSize: file.fileSize,
      downloadUrl
    });

  } catch (error) {
    console.error('Complete upload error:', error);
    return responseHelper.serverError('Failed to complete file upload');
  }
};

/**
 * Get file download URL
 */
exports.getFileDownloadUrl = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { fileId } = event.pathParameters;

    // Get file metadata
    const fileResult = await dynamodb.send(new GetCommand({
      TableName: CHAT_FILES_TABLE,
      Key: { fileId }
    }));

    if (!fileResult.Item) {
      return responseHelper.error(404, 'File not found');
    }

    const file = fileResult.Item;

    // Generate download URL
    const downloadCommand = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: file.fileKey
    });

    const downloadUrl = await getSignedUrl(s3, downloadCommand, { expiresIn: 3600 });

    return responseHelper.success({
      fileName: file.fileName,
      fileType: file.fileType,
      fileSize: file.fileSize,
      downloadUrl
    });

  } catch (error) {
    console.error('Get download URL error:', error);
    return responseHelper.serverError('Failed to get file download URL');
  }
};

/**
 * Save chat message to history
 */
exports.saveChatMessage = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { sessionId, messageId, messageType, content, senderId, senderType, timestamp, metadata } = JSON.parse(event.body);

    const messageData = {
      messageId: messageId || uuidv4(),
      sessionId,
      messageType, // 'text', 'file', 'system'
      content,
      senderId,
      senderType, // 'customer', 'agent', 'system'
      timestamp: timestamp || new Date().toISOString(),
      metadata: metadata || {},
      createdAt: new Date().toISOString()
    };

    await dynamodb.send(new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: messageData
    }));

    return responseHelper.success({
      messageId: messageData.messageId,
      message: 'Message saved successfully'
    });

  } catch (error) {
    console.error('Save message error:', error);
    return responseHelper.serverError('Failed to save message');
  }
};

/**
 * Get chat history for a session
 */
exports.getChatHistory = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { sessionId } = event.pathParameters;
    const { limit = 50, startTime, endTime } = event.queryStringParameters || {};

    let queryExpression = 'sessionId = :sessionId';
    let expressionValues = { ':sessionId': sessionId };

    if (startTime && endTime) {
      queryExpression += ' AND #timestamp BETWEEN :startTime AND :endTime';
      expressionValues[':startTime'] = startTime;
      expressionValues[':endTime'] = endTime;
    }

    const result = await dynamodb.send(new QueryCommand({
      TableName: CHAT_HISTORY_TABLE,
      KeyConditionExpression: queryExpression,
      ExpressionAttributeNames: startTime && endTime ? { '#timestamp': 'timestamp' } : undefined,
      ExpressionAttributeValues: expressionValues,
      ScanIndexForward: true,
      Limit: parseInt(limit)
    }));

    return responseHelper.success({
      messages: result.Items || [],
      count: result.Items?.length || 0
    });

  } catch (error) {
    console.error('Get chat history error:', error);
    return responseHelper.serverError('Failed to get chat history');
  }
};

/**
 * Export chat history
 */
exports.exportChatHistory = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { sessionId } = event.pathParameters;
    const { format = 'json' } = event.queryStringParameters || {};

    // Get all messages for the session
    const result = await dynamodb.send(new QueryCommand({
      TableName: CHAT_HISTORY_TABLE,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: { ':sessionId': sessionId },
      ScanIndexForward: true
    }));

    const messages = result.Items || [];

    let exportData;
    let contentType;
    let filename;

    switch (format) {
      case 'json':
        exportData = JSON.stringify({ sessionId, messages, exportedAt: new Date().toISOString() }, null, 2);
        contentType = 'application/json';
        filename = `chat-history-${sessionId}.json`;
        break;

      case 'txt':
        exportData = messages.map(msg => 
          `[${msg.timestamp}] ${msg.senderType}: ${msg.content}`
        ).join('\n');
        contentType = 'text/plain';
        filename = `chat-history-${sessionId}.txt`;
        break;

      case 'html':
        exportData = `
<!DOCTYPE html>
<html>
<head>
    <title>Chat History - ${sessionId}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { margin: 10px 0; padding: 10px; border-radius: 5px; }
        .customer { background: #e3f2fd; }
        .agent { background: #f3e5f5; }
        .system { background: #f5f5f5; font-style: italic; }
        .timestamp { color: #666; font-size: 0.8em; }
    </style>
</head>
<body>
    <h1>Chat History</h1>
    <p><strong>Session ID:</strong> ${sessionId}</p>
    <p><strong>Exported:</strong> ${new Date().toISOString()}</p>
    <div class="messages">
        ${messages.map(msg => `
            <div class="message ${msg.senderType}">
                <div class="timestamp">${msg.timestamp}</div>
                <div><strong>${msg.senderType}:</strong> ${msg.content}</div>
            </div>
        `).join('')}
    </div>
</body>
</html>`;
        contentType = 'text/html';
        filename = `chat-history-${sessionId}.html`;
        break;

      default:
        return responseHelper.error(400, 'Unsupported export format');
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*'
      },
      body: exportData
    };

  } catch (error) {
    console.error('Export chat history error:', error);
    return responseHelper.serverError('Failed to export chat history');
  }
};

/**
 * Search chat history
 */
exports.searchChatHistory = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { query, customerId, agentId, startDate, endDate, messageType } = event.queryStringParameters || {};

    if (!query) {
      return responseHelper.error(400, 'Search query is required');
    }

    // This is a simplified search - in production, consider using ElasticSearch
    let scanParams = {
      TableName: CHAT_HISTORY_TABLE,
      FilterExpression: 'contains(content, :query)',
      ExpressionAttributeValues: { ':query': query }
    };

    // Add additional filters
    let filterExpressions = ['contains(content, :query)'];
    let expressionValues = { ':query': query };

    if (customerId) {
      filterExpressions.push('senderId = :customerId AND senderType = :customerType');
      expressionValues[':customerId'] = customerId;
      expressionValues[':customerType'] = 'customer';
    }

    if (agentId) {
      filterExpressions.push('senderId = :agentId AND senderType = :agentType');
      expressionValues[':agentId'] = agentId;
      expressionValues[':agentType'] = 'agent';
    }

    if (messageType) {
      filterExpressions.push('messageType = :messageType');
      expressionValues[':messageType'] = messageType;
    }

    if (startDate && endDate) {
      filterExpressions.push('#timestamp BETWEEN :startDate AND :endDate');
      expressionValues[':startDate'] = startDate;
      expressionValues[':endDate'] = endDate;
      scanParams.ExpressionAttributeNames = { '#timestamp': 'timestamp' };
    }

    scanParams.FilterExpression = filterExpressions.join(' AND ');
    scanParams.ExpressionAttributeValues = expressionValues;

    const result = await dynamodb.send(new ScanCommand(scanParams));

    return responseHelper.success({
      results: result.Items || [],
      count: result.Items?.length || 0,
      query
    });

  } catch (error) {
    console.error('Search chat history error:', error);
    return responseHelper.serverError('Failed to search chat history');
  }
};

/**
 * Get agent status and availability
 */
exports.getAgentStatus = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { agentId } = event.pathParameters;

    const result = await dynamodb.send(new GetCommand({
      TableName: AGENT_MANAGEMENT_TABLE,
      Key: { agentId }
    }));

    if (!result.Item) {
      return responseHelper.error(404, 'Agent not found');
    }

    return responseHelper.success({
      agent: result.Item
    });

  } catch (error) {
    console.error('Get agent status error:', error);
    return responseHelper.serverError('Failed to get agent status');
  }
};

/**
 * Update agent status
 */
exports.updateAgentStatus = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { agentId } = event.pathParameters;
    const { status, reason, currentQueue } = JSON.parse(event.body);

    const updateData = {
      status, // 'available', 'busy', 'offline', 'break'
      lastStatusChange: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (reason) updateData.statusReason = reason;
    if (currentQueue) updateData.currentQueue = currentQueue;

    await dynamodb.send(new UpdateCommand({
      TableName: AGENT_MANAGEMENT_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET #status = :status, lastStatusChange = :lastStatusChange, updatedAt = :updatedAt' +
        (reason ? ', statusReason = :reason' : '') +
        (currentQueue ? ', currentQueue = :currentQueue' : ''),
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':lastStatusChange': updateData.lastStatusChange,
        ':updatedAt': updateData.updatedAt,
        ...(reason && { ':reason': reason }),
        ...(currentQueue && { ':currentQueue': currentQueue })
      }
    }));

    return responseHelper.success({
      message: 'Agent status updated successfully',
      agentId,
      status
    });

  } catch (error) {
    console.error('Update agent status error:', error);
    return responseHelper.serverError('Failed to update agent status');
  }
};

/**
 * Get available agents for routing
 */
exports.getAvailableAgents = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { queue, skills, language } = event.queryStringParameters || {};

    let filterExpression = '#status = :availableStatus';
    let expressionValues = { ':availableStatus': 'available' };
    let expressionNames = { '#status': 'status' };

    if (queue) {
      filterExpression += ' AND currentQueue = :queue';
      expressionValues[':queue'] = queue;
    }

    if (language) {
      filterExpression += ' AND contains(languages, :language)';
      expressionValues[':language'] = language;
    }

    const result = await dynamodb.send(new ScanCommand({
      TableName: AGENT_MANAGEMENT_TABLE,
      FilterExpression: filterExpression,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    }));

    let agents = result.Items || [];

    // Filter by skills if provided
    if (skills) {
      const requiredSkills = skills.split(',');
      agents = agents.filter(agent => 
        agent.skills && requiredSkills.every(skill => agent.skills.includes(skill))
      );
    }

    // Sort by workload (least busy first)
    agents.sort((a, b) => (a.currentChats || 0) - (b.currentChats || 0));

    return responseHelper.success({
      agents,
      count: agents.length
    });

  } catch (error) {
    console.error('Get available agents error:', error);
    return responseHelper.serverError('Failed to get available agents');
  }
};

/**
 * Assign chat to agent
 */
exports.assignChatToAgent = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { sessionId, agentId, priority = 'normal', customerContext } = JSON.parse(event.body);

    // Update agent's current chat count
    await dynamodb.send(new UpdateCommand({
      TableName: AGENT_MANAGEMENT_TABLE,
      Key: { agentId },
      UpdateExpression: 'ADD currentChats :increment SET lastAssignment = :timestamp',
      ExpressionAttributeValues: {
        ':increment': 1,
        ':timestamp': new Date().toISOString()
      }
    }));

    // Create chat assignment record
    const assignmentData = {
      assignmentId: uuidv4(),
      sessionId,
      agentId,
      priority,
      assignedAt: new Date().toISOString(),
      status: 'active',
      customerContext: customerContext || {}
    };

    await dynamodb.send(new PutCommand({
      TableName: CHAT_ANALYTICS_TABLE,
      Item: {
        ...assignmentData,
        recordType: 'assignment'
      }
    }));

    return responseHelper.success({
      assignmentId: assignmentData.assignmentId,
      message: 'Chat assigned to agent successfully'
    });

  } catch (error) {
    console.error('Assign chat error:', error);
    return responseHelper.serverError('Failed to assign chat to agent');
  }
};

/**
 * Record chat analytics
 */
exports.recordChatAnalytics = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { sessionId, eventType, eventData, timestamp } = JSON.parse(event.body);

    const analyticsData = {
      analyticsId: uuidv4(),
      sessionId,
      eventType, // 'session_start', 'message_sent', 'file_shared', 'session_end'
      eventData: eventData || {},
      timestamp: timestamp || new Date().toISOString(),
      recordType: 'analytics'
    };

    await dynamodb.send(new PutCommand({
      TableName: CHAT_ANALYTICS_TABLE,
      Item: analyticsData
    }));

    return responseHelper.success({
      analyticsId: analyticsData.analyticsId,
      message: 'Analytics recorded successfully'
    });

  } catch (error) {
    console.error('Record analytics error:', error);
    return responseHelper.serverError('Failed to record analytics');
  }
};

/**
 * Get chat analytics
 */
exports.getChatAnalytics = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { period = '7d', agentId, queue } = event.queryStringParameters || {};

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case '1d':
        startDate.setDate(endDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      default:
        startDate.setDate(endDate.getDate() - 7);
    }

    let filterExpression = '#timestamp BETWEEN :startDate AND :endDate';
    let expressionValues = {
      ':startDate': startDate.toISOString(),
      ':endDate': endDate.toISOString()
    };
    let expressionNames = { '#timestamp': 'timestamp' };

    if (agentId) {
      filterExpression += ' AND agentId = :agentId';
      expressionValues[':agentId'] = agentId;
    }

    const result = await dynamodb.send(new ScanCommand({
      TableName: CHAT_ANALYTICS_TABLE,
      FilterExpression: filterExpression,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    }));

    const records = result.Items || [];

    // Calculate metrics
    const totalChats = records.filter(r => r.eventType === 'session_start').length;
    const completedChats = records.filter(r => r.eventType === 'session_end').length;
    const averageResponseTime = calculateAverageResponseTime(records);
    const customerSatisfaction = calculateCustomerSatisfaction(records);

    return responseHelper.success({
      period,
      metrics: {
        totalChats,
        completedChats,
        completionRate: totalChats > 0 ? (completedChats / totalChats * 100).toFixed(2) : 0,
        averageResponseTime,
        customerSatisfaction
      },
      records: records.slice(0, 100) // Return first 100 records
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    return responseHelper.serverError('Failed to get chat analytics');
  }
};

// Helper functions
function calculateAverageResponseTime(records) {
  const responseTimeRecords = records.filter(r => r.eventData && r.eventData.responseTime);
  if (responseTimeRecords.length === 0) return 0;
  
  const totalTime = responseTimeRecords.reduce((sum, record) => sum + record.eventData.responseTime, 0);
  return Math.round(totalTime / responseTimeRecords.length);
}

function calculateCustomerSatisfaction(records) {
  const satisfactionRecords = records.filter(r => r.eventType === 'satisfaction_rating');
  if (satisfactionRecords.length === 0) return null;
  
  const totalRating = satisfactionRecords.reduce((sum, record) => sum + (record.eventData.rating || 0), 0);
  return (totalRating / satisfactionRecords.length).toFixed(1);
}

/**
 * Enhanced chat initiation with agent routing
 */
exports.initiateEnhancedChat = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { userId, userType, language = 'en', priority = 'normal', customerContext, skills } = JSON.parse(event.body);

    // Find available agent
    const availableAgentsResponse = await exports.getAvailableAgents({
      httpMethod: 'GET',
      queryStringParameters: { language, skills: skills?.join(',') }
    });

    let selectedAgent = null;
    if (availableAgentsResponse.statusCode === 200) {
      const agentsData = JSON.parse(availableAgentsResponse.body);
      if (agentsData.agents && agentsData.agents.length > 0) {
        selectedAgent = agentsData.agents[0]; // Get least busy agent
      }
    }

    // Start Amazon Connect chat
    const chatCommand = new StartChatContactCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      ContactFlowId: CONTACT_FLOW_ID,
      Attributes: {
        userId,
        userType,
        language,
        priority,
        agentId: selectedAgent?.agentId || 'auto-assign'
      },
      ParticipantDetails: {
        DisplayName: customerContext?.name || `${userType}-${userId}`
      }
    });

    const chatResponse = await connect.send(chatCommand);

    // Create participant connection
    const participantCommand = new CreateParticipantConnectionCommand({
      ParticipantToken: chatResponse.ParticipantToken,
      Type: ['WEBSOCKET', 'CONNECTION_CREDENTIALS']
    });

    const participantResponse = await connectParticipant.send(participantCommand);

    const sessionData = {
      sessionId: chatResponse.ContactId,
      contactId: chatResponse.ContactId,
      participantId: chatResponse.ParticipantId,
      participantToken: chatResponse.ParticipantToken,
      connectionToken: participantResponse.ConnectionCredentials.ConnectionToken,
      websocketUrl: participantResponse.Websocket.Url,
      userId,
      userType,
      language,
      priority,
      agentId: selectedAgent?.agentId,
      customerContext: customerContext || {},
      status: 'active',
      createdAt: new Date().toISOString()
    };

    // Save session data
    await dynamodb.send(new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: {
        ...sessionData,
        messageId: `session-${chatResponse.ContactId}`,
        messageType: 'session_start',
        content: 'Chat session started',
        senderId: 'system',
        senderType: 'system',
        timestamp: new Date().toISOString()
      }
    }));

    // Assign to agent if available
    if (selectedAgent) {
      await exports.assignChatToAgent({
        httpMethod: 'POST',
        body: JSON.stringify({
          sessionId: chatResponse.ContactId,
          agentId: selectedAgent.agentId,
          priority,
          customerContext
        })
      });
    }

    // Record analytics
    await exports.recordChatAnalytics({
      httpMethod: 'POST',
      body: JSON.stringify({
        sessionId: chatResponse.ContactId,
        eventType: 'session_start',
        eventData: {
          userType,
          language,
          priority,
          agentAssigned: !!selectedAgent
        }
      })
    });

    return responseHelper.success({
      sessionId: chatResponse.ContactId,
      contactId: chatResponse.ContactId,
      participantId: chatResponse.ParticipantId,
      participantToken: chatResponse.ParticipantToken,
      connectionToken: participantResponse.ConnectionCredentials.ConnectionToken,
      websocketUrl: participantResponse.Websocket.Url,
      agentAssigned: !!selectedAgent,
      agentInfo: selectedAgent ? {
        agentId: selectedAgent.agentId,
        name: selectedAgent.name,
        languages: selectedAgent.languages
      } : null
    });

  } catch (error) {
    console.error('Enhanced chat initiation error:', error);
    return responseHelper.serverError('Failed to initiate enhanced chat');
  }
};
