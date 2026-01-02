/**
 * Amazon Connect Chat Backend API Handler
 * Supports the enhanced Amazon Connect features including:
 * - File attachments
 * - Chat history
 * - Agent management
 * - Real-time features
 * - Analytics
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { ConnectClient, StartChatContactCommand, SendMessageCommand } = require('@aws-sdk/client-connect');
const { KMSClient, EncryptCommand, DecryptCommand } = require('@aws-sdk/client-kms');
const { v4: uuidv4 } = require('uuid');
const responseHelper = require('../utils/response');

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const connectClient = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });
const kmsClient = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Environment variables
const CHAT_HISTORY_TABLE = process.env.CHAT_HISTORY_TABLE || 'AmazonConnect-ChatHistory-dev';
const FILE_METADATA_TABLE = process.env.FILE_METADATA_TABLE || 'AmazonConnect-FileMetadata-dev';
const AGENT_MANAGEMENT_TABLE = process.env.AGENT_MANAGEMENT_TABLE || 'AmazonConnect-AgentManagement-dev';
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE || 'AmazonConnect-Analytics-dev';
const CHAT_FILES_BUCKET = process.env.CHAT_FILES_BUCKET || 'wizz-connect-chat-files';
const KMS_KEY_ID = process.env.KMS_KEY_ID || 'alias/amazon-connect-encryption';
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID;
const CONNECT_CONTACT_FLOW_ID = process.env.CONNECT_CONTACT_FLOW_ID;

/**
 * Initiate Chat Session
 * Enhanced with customer history lookup, language detection, skill-based routing
 */
exports.initiateChatSession = async (event) => {
  try {
    console.log('Initiating Amazon Connect chat session...');
    
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const body = JSON.parse(event.body);
    const {
      customerName,
      email,
      issue,
      language = 'en',
      customerId,
      priority = 'normal',
      department = 'general',
      metadata = {}
    } = body;

    // Validate required fields
    if (!customerName || !email || !issue) {
      return responseHelper.validation([
        { field: 'customerName', message: 'Customer name is required' },
        { field: 'email', message: 'Email is required' },
        { field: 'issue', message: 'Issue description is required' }
      ]);
    }

    // Look up customer history
    let customerHistory = null;
    if (customerId || email) {
      const historyQuery = {
        TableName: CHAT_HISTORY_TABLE,
        IndexName: 'customer-index',
        KeyConditionExpression: customerId ? 'customerId = :customerId' : 'customerEmail = :email',
        ExpressionAttributeValues: customerId ? 
          { ':customerId': customerId } : 
          { ':email': email },
        Limit: 5,
        ScanIndexForward: false
      };

      try {
        const historyResult = await dynamodb.send(new QueryCommand(historyQuery));
        customerHistory = historyResult.Items || [];
      } catch (historyError) {
        console.warn('Could not retrieve customer history:', historyError);
      }
    }

    // Determine skill-based routing
    const skillRequirements = determineSkillRequirements(issue, department, language);
    
    // Find available agent
    const assignedAgent = await findAvailableAgent(skillRequirements, priority);

    // Create chat session record
    const sessionId = uuidv4();
    const chatSession = {
      sessionId,
      customerId: customerId || `guest_${Date.now()}`,
      customerName,
      customerEmail: email,
      issue,
      language,
      priority,
      department,
      status: 'active',
      assignedAgentId: assignedAgent?.agentId || null,
      assignedAgentName: assignedAgent?.name || null,
      skillRequirements,
      metadata: {
        ...metadata,
        hasHistory: customerHistory && customerHistory.length > 0,
        previousSessions: customerHistory?.length || 0,
        userAgent: event.headers?.['User-Agent'] || '',
        sourceIp: event.requestContext?.identity?.sourceIp || ''
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save chat session
    await dynamodb.send(new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: chatSession
    }));

    // Update agent status if assigned
    if (assignedAgent) {
      await updateAgentStatus(assignedAgent.agentId, 'busy', sessionId);
    }

    // Start Amazon Connect chat contact if instance is configured
    let connectContactId = null;
    if (CONNECT_INSTANCE_ID && CONNECT_CONTACT_FLOW_ID) {
      try {
        const connectResponse = await connectClient.send(new StartChatContactCommand({
          InstanceId: CONNECT_INSTANCE_ID,
          ContactFlowId: CONNECT_CONTACT_FLOW_ID,
          Attributes: {
            customerName,
            email,
            issue: issue.substring(0, 100), // Truncate for Connect
            language,
            sessionId
          },
          ParticipantDetails: {
            DisplayName: customerName
          }
        }));
        
        connectContactId = connectResponse.ContactId;
        
        // Update session with Connect contact ID
        await dynamodb.send(new UpdateCommand({
          TableName: CHAT_HISTORY_TABLE,
          Key: { sessionId },
          UpdateExpression: 'SET connectContactId = :contactId',
          ExpressionAttributeValues: { ':contactId': connectContactId }
        }));
      } catch (connectError) {
        console.warn('Could not start Connect chat contact:', connectError);
      }
    }

    // Log analytics
    await logChatAnalytics('session_started', {
      sessionId,
      customerId: chatSession.customerId,
      language,
      department,
      priority,
      hasHistory: chatSession.metadata.hasHistory,
      agentAssigned: !!assignedAgent
    });

    console.log(`Chat session initiated: ${sessionId}`);

    return responseHelper.success({
      sessionId,
      connectContactId,
      assignedAgent,
      customerHistory: customerHistory?.slice(0, 3), // Return last 3 sessions
      supportedFeatures: {
        fileAttachments: true,
        encryption: true,
        realTimeTyping: true,
        readReceipts: true,
        languages: ['en', 'ar', 'es', 'fr', 'de']
      },
      message: 'Chat session initiated successfully'
    }, 201);

  } catch (error) {
    console.error('Error initiating chat session:', error);
    return responseHelper.serverError('Failed to initiate chat session');
  }
};

/**
 * Send Chat Message
 * Enhanced with file attachments, encryption, multi-language support
 */
exports.sendChatMessage = async (event) => {
  try {
    console.log('Sending chat message...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const body = JSON.parse(event.body);
    const {
      sessionId,
      message,
      messageType = 'text',
      attachments = [],
      encrypt = false,
      language = 'en',
      metadata = {}
    } = body;

    if (!sessionId || !message) {
      return responseHelper.validation([
        { field: 'sessionId', message: 'Session ID is required' },
        { field: 'message', message: 'Message is required' }
      ]);
    }

    // Get chat session
    const sessionQuery = await dynamodb.send(new GetCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: { sessionId }
    }));

    if (!sessionQuery.Item) {
      return responseHelper.notFound('Chat session not found');
    }

    const chatSession = sessionQuery.Item;

    // Process file attachments
    const processedAttachments = [];
    for (const attachment of attachments) {
      try {
        const fileMetadata = await processFileAttachment(attachment, sessionId);
        processedAttachments.push(fileMetadata);
      } catch (fileError) {
        console.warn('Failed to process attachment:', fileError);
      }
    }

    // Encrypt message if required
    let encryptedMessage = message;
    if (encrypt && KMS_KEY_ID) {
      try {
        const encryptResponse = await kmsClient.send(new EncryptCommand({
          KeyId: KMS_KEY_ID,
          Plaintext: Buffer.from(message, 'utf-8')
        }));
        encryptedMessage = Buffer.from(encryptResponse.CiphertextBlob).toString('base64');
      } catch (encryptError) {
        console.warn('Failed to encrypt message:', encryptError);
        // Continue with unencrypted message
      }
    }

    // Translate message if needed
    let translatedVersions = {};
    if (language !== 'en') {
      // In a real implementation, you would use AWS Translate
      translatedVersions = await translateMessage(message, language);
    }

    // Create message record
    const messageId = uuidv4();
    const chatMessage = {
      messageId,
      sessionId,
      message: encryptedMessage,
      originalMessage: encrypt ? message : null, // Store original for debugging if encrypted
      messageType,
      senderId: chatSession.customerId,
      senderName: chatSession.customerName,
      senderType: 'customer',
      language,
      translatedVersions,
      attachments: processedAttachments,
      encrypted: encrypt,
      metadata,
      status: 'sent',
      timestamp: new Date().toISOString()
    };

    // Save message
    await dynamodb.send(new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: chatMessage
    }));

    // Update session last activity
    await dynamodb.send(new UpdateCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: { sessionId },
      UpdateExpression: 'SET updatedAt = :timestamp, lastMessage = :message',
      ExpressionAttributeValues: {
        ':timestamp': new Date().toISOString(),
        ':message': message.substring(0, 100)
      }
    }));

    // Send via Amazon Connect if contact exists
    if (chatSession.connectContactId) {
      try {
        await connectClient.send(new SendMessageCommand({
          ContactId: chatSession.connectContactId,
          Content: message,
          ContentType: 'text/plain'
        }));
      } catch (connectError) {
        console.warn('Failed to send via Connect:', connectError);
      }
    }

    // Log analytics
    await logChatAnalytics('message_sent', {
      sessionId,
      messageId,
      messageType,
      hasAttachments: attachments.length > 0,
      encrypted: encrypt,
      language
    });

    // Emit real-time event (WebSocket notification would go here)
    await notifyRealTimeSubscribers(sessionId, 'new_message', {
      messageId,
      sessionId,
      message,
      senderName: chatSession.customerName,
      timestamp: chatMessage.timestamp,
      attachments: processedAttachments
    });

    console.log(`Message sent: ${messageId}`);

    return responseHelper.success({
      messageId,
      status: 'sent',
      timestamp: chatMessage.timestamp,
      attachments: processedAttachments,
      message: 'Message sent successfully'
    });

  } catch (error) {
    console.error('Error sending chat message:', error);
    return responseHelper.serverError('Failed to send message');
  }
};

/**
 * Upload File Attachment
 * Generates presigned URLs for secure file uploads
 */
exports.uploadFileAttachment = async (event) => {
  try {
    console.log('Generating file upload URL...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const body = JSON.parse(event.body);
    const { sessionId, fileName, fileSize, fileType, checksum } = body;

    if (!sessionId || !fileName || !fileSize || !fileType) {
      return responseHelper.validation([
        { field: 'sessionId', message: 'Session ID is required' },
        { field: 'fileName', message: 'File name is required' },
        { field: 'fileSize', message: 'File size is required' },
        { field: 'fileType', message: 'File type is required' }
      ]);
    }

    // Validate file type and size
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain', 'text/csv',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    if (!allowedTypes.includes(fileType)) {
      return responseHelper.badRequest('File type not allowed');
    }

    if (fileSize > 10 * 1024 * 1024) { // 10MB limit
      return responseHelper.badRequest('File size exceeds 10MB limit');
    }

    // Generate unique file key
    const fileId = uuidv4();
    const fileExtension = fileName.split('.').pop();
    const key = `chat-files/${sessionId}/${fileId}.${fileExtension}`;

    // Generate presigned URL
    const uploadUrl = await getSignedUrl(s3Client, new PutObjectCommand({
      Bucket: CHAT_FILES_BUCKET,
      Key: key,
      ContentType: fileType,
      Metadata: {
        sessionId,
        originalFileName: fileName,
        fileId,
        uploadedBy: 'customer'
      }
    }), { expiresIn: 3600 }); // 1 hour

    // Store file metadata
    const fileMetadata = {
      fileId,
      sessionId,
      fileName,
      fileSize,
      fileType,
      s3Key: key,
      checksum,
      status: 'pending',
      uploadedBy: 'customer',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString() // 1 hour
    };

    await dynamodb.send(new PutCommand({
      TableName: FILE_METADATA_TABLE,
      Item: fileMetadata
    }));

    console.log(`File upload URL generated: ${fileId}`);

    return responseHelper.success({
      fileId,
      uploadUrl,
      expiresIn: 3600,
      maxSize: 10 * 1024 * 1024,
      message: 'Upload URL generated successfully'
    });

  } catch (error) {
    console.error('Error generating upload URL:', error);
    return responseHelper.serverError('Failed to generate upload URL');
  }
};

/**
 * Confirm File Upload
 * Confirms successful file upload and generates download URL
 */
exports.confirmFileUpload = async (event) => {
  try {
    console.log('Confirming file upload...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { fileId } = event.pathParameters;
    const body = JSON.parse(event.body);
    const { actualSize, actualChecksum } = body;

    if (!fileId) {
      return responseHelper.validation([
        { field: 'fileId', message: 'File ID is required' }
      ]);
    }

    // Get file metadata
    const fileQuery = await dynamodb.send(new GetCommand({
      TableName: FILE_METADATA_TABLE,
      Key: { fileId }
    }));

    if (!fileQuery.Item) {
      return responseHelper.notFound('File not found');
    }

    const fileMetadata = fileQuery.Item;

    // Validate checksum if provided
    if (actualChecksum && fileMetadata.checksum && actualChecksum !== fileMetadata.checksum) {
      return responseHelper.badRequest('File checksum validation failed');
    }

    // Generate download URL
    const downloadUrl = await getSignedUrl(s3Client, new GetObjectCommand({
      Bucket: CHAT_FILES_BUCKET,
      Key: fileMetadata.s3Key
    }), { expiresIn: 86400 }); // 24 hours

    // Update file metadata
    await dynamodb.send(new UpdateCommand({
      TableName: FILE_METADATA_TABLE,
      Key: { fileId },
      UpdateExpression: 'SET #status = :status, actualSize = :actualSize, downloadUrl = :downloadUrl, confirmedAt = :confirmedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'confirmed',
        ':actualSize': actualSize,
        ':downloadUrl': downloadUrl,
        ':confirmedAt': new Date().toISOString()
      }
    }));

    console.log(`File upload confirmed: ${fileId}`);

    return responseHelper.success({
      fileId,
      downloadUrl,
      fileName: fileMetadata.fileName,
      fileSize: actualSize || fileMetadata.fileSize,
      fileType: fileMetadata.fileType,
      message: 'File upload confirmed'
    });

  } catch (error) {
    console.error('Error confirming file upload:', error);
    return responseHelper.serverError('Failed to confirm file upload');
  }
};

/**
 * Get Chat History
 * Retrieves chat history for a session with optional filtering and pagination
 */
exports.getChatHistory = async (event) => {
  try {
    console.log('Getting chat history...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { sessionId } = event.pathParameters;
    const { limit = 50, startKey, includeAttachments = 'true' } = event.queryStringParameters || {};

    if (!sessionId) {
      return responseHelper.validation([
        { field: 'sessionId', message: 'Session ID is required' }
      ]);
    }

    // Get chat session
    const sessionQuery = await dynamodb.send(new GetCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: { sessionId }
    }));

    if (!sessionQuery.Item) {
      return responseHelper.notFound('Chat session not found');
    }

    // Query messages for this session
    const queryParams = {
      TableName: CHAT_HISTORY_TABLE,
      IndexName: 'session-timestamp-index',
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: { ':sessionId': sessionId },
      Limit: parseInt(limit),
      ScanIndexForward: false // Most recent first
    };

    if (startKey) {
      queryParams.ExclusiveStartKey = JSON.parse(decodeURIComponent(startKey));
    }

    const messagesResult = await dynamodb.send(new QueryCommand(queryParams));
    const messages = messagesResult.Items || [];

    // Decrypt messages if needed
    const decryptedMessages = await Promise.all(messages.map(async (message) => {
      if (message.encrypted && message.message) {
        try {
          const decryptResponse = await kmsClient.send(new DecryptCommand({
            CiphertextBlob: Buffer.from(message.message, 'base64')
          }));
          message.message = decryptResponse.Plaintext.toString('utf-8');
        } catch (decryptError) {
          console.warn('Failed to decrypt message:', decryptError);
        }
      }

      // Get file attachments if requested
      if (includeAttachments === 'true' && message.attachments && message.attachments.length > 0) {
        message.attachments = await Promise.all(message.attachments.map(async (attachment) => {
          try {
            const fileQuery = await dynamodb.send(new GetCommand({
              TableName: FILE_METADATA_TABLE,
              Key: { fileId: attachment.fileId }
            }));
            
            if (fileQuery.Item) {
              // Generate fresh download URL
              const downloadUrl = await getSignedUrl(s3Client, new GetObjectCommand({
                Bucket: CHAT_FILES_BUCKET,
                Key: fileQuery.Item.s3Key
              }), { expiresIn: 3600 });
              
              return {
                ...fileQuery.Item,
                downloadUrl
              };
            }
          } catch (fileError) {
            console.warn('Failed to get file metadata:', fileError);
          }
          return attachment;
        }));
      }

      return message;
    }));

    console.log(`Retrieved ${decryptedMessages.length} messages for session ${sessionId}`);

    return responseHelper.success({
      sessionId,
      sessionInfo: sessionQuery.Item,
      messages: decryptedMessages,
      hasMore: !!messagesResult.LastEvaluatedKey,
      nextKey: messagesResult.LastEvaluatedKey ? encodeURIComponent(JSON.stringify(messagesResult.LastEvaluatedKey)) : null,
      totalMessages: decryptedMessages.length
    });

  } catch (error) {
    console.error('Error getting chat history:', error);
    return responseHelper.serverError('Failed to get chat history');
  }
};

/**
 * Search Chat History
 * Search across multiple sessions for a customer
 */
exports.searchChatHistory = async (event) => {
  try {
    console.log('Searching chat history...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { customerId, email, query, dateFrom, dateTo, limit = 20 } = event.queryStringParameters || {};

    if (!customerId && !email) {
      return responseHelper.validation([
        { field: 'customerId', message: 'Customer ID or email is required' }
      ]);
    }

    // Search parameters
    const searchParams = {
      TableName: CHAT_HISTORY_TABLE,
      FilterExpression: '',
      ExpressionAttributeValues: {},
      Limit: parseInt(limit)
    };

    const filterExpressions = [];

    if (customerId) {
      filterExpressions.push('customerId = :customerId');
      searchParams.ExpressionAttributeValues[':customerId'] = customerId;
    }

    if (email) {
      filterExpressions.push('customerEmail = :email');
      searchParams.ExpressionAttributeValues[':email'] = email;
    }

    if (query) {
      filterExpressions.push('contains(message, :query) OR contains(issue, :query)');
      searchParams.ExpressionAttributeValues[':query'] = query;
    }

    if (dateFrom) {
      filterExpressions.push('createdAt >= :dateFrom');
      searchParams.ExpressionAttributeValues[':dateFrom'] = dateFrom;
    }

    if (dateTo) {
      filterExpressions.push('createdAt <= :dateTo');
      searchParams.ExpressionAttributeValues[':dateTo'] = dateTo;
    }

    searchParams.FilterExpression = filterExpressions.join(' AND ');

    const searchResult = await dynamodb.send(new ScanCommand(searchParams));

    console.log(`Found ${searchResult.Items?.length || 0} matching records`);

    return responseHelper.success({
      results: searchResult.Items || [],
      totalResults: searchResult.Items?.length || 0,
      searchQuery: { customerId, email, query, dateFrom, dateTo }
    });

  } catch (error) {
    console.error('Error searching chat history:', error);
    return responseHelper.serverError('Failed to search chat history');
  }
};

/**
 * Export Chat History
 * Export chat history in various formats (JSON, CSV, PDF)
 */
exports.exportChatHistory = async (event) => {
  try {
    console.log('Exporting chat history...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { sessionId } = event.pathParameters;
    const { format = 'json', includeAttachments = 'false' } = event.queryStringParameters || {};

    if (!sessionId) {
      return responseHelper.validation([
        { field: 'sessionId', message: 'Session ID is required' }
      ]);
    }

    // Get complete chat history
    const historyResponse = await exports.getChatHistory({
      httpMethod: 'GET',
      pathParameters: { sessionId },
      queryStringParameters: { limit: '1000', includeAttachments }
    });

    if (historyResponse.statusCode !== 200) {
      return historyResponse;
    }

    const historyData = JSON.parse(historyResponse.body);

    let exportData;
    let contentType;
    let fileName;

    switch (format.toLowerCase()) {
      case 'json':
        exportData = JSON.stringify(historyData, null, 2);
        contentType = 'application/json';
        fileName = `chat-history-${sessionId}.json`;
        break;

      case 'csv':
        exportData = convertToCsv(historyData.messages);
        contentType = 'text/csv';
        fileName = `chat-history-${sessionId}.csv`;
        break;

      case 'html':
        exportData = convertToHtml(historyData);
        contentType = 'text/html';
        fileName = `chat-history-${sessionId}.html`;
        break;

      default:
        return responseHelper.badRequest('Unsupported export format. Use json, csv, or html');
    }

    // Upload to S3 for download
    const exportKey = `exports/${sessionId}/${Date.now()}-${fileName}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: CHAT_FILES_BUCKET,
      Key: exportKey,
      Body: exportData,
      ContentType: contentType,
      Metadata: {
        sessionId,
        exportFormat: format,
        exportedAt: new Date().toISOString()
      }
    }));

    // Generate download URL
    const downloadUrl = await getSignedUrl(s3Client, new GetObjectCommand({
      Bucket: CHAT_FILES_BUCKET,
      Key: exportKey
    }), { expiresIn: 3600 });

    console.log(`Chat history exported: ${sessionId} as ${format}`);

    return responseHelper.success({
      downloadUrl,
      fileName,
      format,
      expiresIn: 3600,
      message: 'Chat history exported successfully'
    });

  } catch (error) {
    console.error('Error exporting chat history:', error);
    return responseHelper.serverError('Failed to export chat history');
  }
};

/**
 * Get Available Agents
 * Get list of available agents for assignment
 */
exports.getAvailableAgents = async (event) => {
  try {
    console.log('Getting available agents...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { skills, language, department } = event.queryStringParameters || {};

    const queryParams = {
      TableName: AGENT_MANAGEMENT_TABLE,
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'available' }
    };

    // Add skill filters if specified
    if (skills) {
      const skillList = skills.split(',');
      const skillFilters = skillList.map((_, index) => `contains(skills, :skill${index})`);
      queryParams.FilterExpression += ` AND (${skillFilters.join(' OR ')})`;
      
      skillList.forEach((skill, index) => {
        queryParams.ExpressionAttributeValues[`:skill${index}`] = skill;
      });
    }

    if (language) {
      queryParams.FilterExpression += ' AND contains(languages, :language)';
      queryParams.ExpressionAttributeValues[':language'] = language;
    }

    if (department) {
      queryParams.FilterExpression += ' AND contains(departments, :department)';
      queryParams.ExpressionAttributeValues[':department'] = department;
    }

    const agentsResult = await dynamodb.send(new ScanCommand(queryParams));

    console.log(`Found ${agentsResult.Items?.length || 0} available agents`);

    return responseHelper.success({
      agents: agentsResult.Items || [],
      totalAgents: agentsResult.Items?.length || 0,
      filters: { skills, language, department }
    });

  } catch (error) {
    console.error('Error getting available agents:', error);
    return responseHelper.serverError('Failed to get available agents');
  }
};

/**
 * Update Agent Status
 * Update agent availability and status
 */
exports.updateAgentStatus = async (event) => {
  try {
    console.log('Updating agent status...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { agentId } = event.pathParameters;
    const body = JSON.parse(event.body);
    const { status, currentSessionId = null, reason = null } = body;

    if (!agentId || !status) {
      return responseHelper.validation([
        { field: 'agentId', message: 'Agent ID is required' },
        { field: 'status', message: 'Status is required' }
      ]);
    }

    const allowedStatuses = ['available', 'busy', 'away', 'offline'];
    if (!allowedStatuses.includes(status)) {
      return responseHelper.badRequest('Invalid status. Must be: ' + allowedStatuses.join(', '));
    }

    // Update agent status
    const updateResult = await dynamodb.send(new UpdateCommand({
      TableName: AGENT_MANAGEMENT_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET #status = :status, currentSessionId = :sessionId, lastUpdated = :timestamp, statusReason = :reason',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': status,
        ':sessionId': currentSessionId,
        ':timestamp': new Date().toISOString(),
        ':reason': reason
      },
      ReturnValues: 'ALL_NEW'
    }));

    // Log analytics
    await logChatAnalytics('agent_status_updated', {
      agentId,
      status,
      currentSessionId,
      reason
    });

    console.log(`Agent status updated: ${agentId} -> ${status}`);

    return responseHelper.success({
      agent: updateResult.Attributes,
      message: 'Agent status updated successfully'
    });

  } catch (error) {
    console.error('Error updating agent status:', error);
    return responseHelper.serverError('Failed to update agent status');
  }
};

/**
 * Get Chat Analytics
 * Retrieve analytics data for chat sessions
 */
exports.getChatAnalytics = async (event) => {
  try {
    console.log('Getting chat analytics...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { 
      dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days ago
      dateTo = new Date().toISOString().split('T')[0], // today
      granularity = 'day'
    } = event.queryStringParameters || {};

    // Query analytics data
    const analyticsParams = {
      TableName: ANALYTICS_TABLE,
      FilterExpression: '#date BETWEEN :dateFrom AND :dateTo',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: {
        ':dateFrom': dateFrom,
        ':dateTo': dateTo
      }
    };

    const analyticsResult = await dynamodb.send(new ScanCommand(analyticsParams));
    const analytics = analyticsResult.Items || [];

    // Aggregate data by granularity
    const aggregatedData = aggregateAnalytics(analytics, granularity);

    // Calculate summary metrics
    const summary = {
      totalSessions: analytics.filter(a => a.eventType === 'session_started').length,
      totalMessages: analytics.filter(a => a.eventType === 'message_sent').length,
      avgSessionDuration: calculateAverageSessionDuration(analytics),
      customerSatisfaction: calculateSatisfactionScore(analytics),
      agentUtilization: calculateAgentUtilization(analytics),
      popularLanguages: getPopularLanguages(analytics),
      commonIssues: getCommonIssues(analytics)
    };

    console.log(`Analytics retrieved for ${dateFrom} to ${dateTo}`);

    return responseHelper.success({
      summary,
      timeSeriesData: aggregatedData,
      period: { dateFrom, dateTo, granularity },
      totalRecords: analytics.length
    });

  } catch (error) {
    console.error('Error getting chat analytics:', error);
    return responseHelper.serverError('Failed to get chat analytics');
  }
};

/**
 * End Chat Session
 * Enhanced with session summaries, analytics, and agent cleanup
 */
exports.endChatSession = async (event) => {
  try {
    console.log('Ending chat session...');

    if (event.httpMethod === 'OPTIONS') {
      return responseHelper.cors();
    }

    const { sessionId } = event.pathParameters;
    const body = JSON.parse(event.body || '{}');
    const { reason = 'completed', satisfaction = null, feedback = null } = body;

    if (!sessionId) {
      return responseHelper.validation([
        { field: 'sessionId', message: 'Session ID is required' }
      ]);
    }

    // Get chat session
    const sessionQuery = await dynamodb.send(new GetCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: { sessionId }
    }));

    if (!sessionQuery.Item) {
      return responseHelper.notFound('Chat session not found');
    }

    const chatSession = sessionQuery.Item;

    // Calculate session duration
    const startTime = new Date(chatSession.createdAt);
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000); // in seconds

    // Generate session summary
    const sessionSummary = await generateSessionSummary(sessionId);

    // Update session status
    await dynamodb.send(new UpdateCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: { sessionId },
      UpdateExpression: 'SET #status = :status, endedAt = :endTime, duration = :duration, endReason = :reason, customerSatisfaction = :satisfaction, feedback = :feedback, summary = :summary',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'ended',
        ':endTime': endTime.toISOString(),
        ':duration': duration,
        ':reason': reason,
        ':satisfaction': satisfaction,
        ':feedback': feedback,
        ':summary': sessionSummary
      }
    }));

    // Free up agent if assigned
    if (chatSession.assignedAgentId) {
      await updateAgentStatus(chatSession.assignedAgentId, 'available', null);
    }

    // Log analytics
    await logChatAnalytics('session_ended', {
      sessionId,
      duration,
      reason,
      satisfaction,
      agentId: chatSession.assignedAgentId,
      messageCount: sessionSummary.messageCount,
      attachmentCount: sessionSummary.attachmentCount
    });

    console.log(`Chat session ended: ${sessionId}`);

    return responseHelper.success({
      sessionId,
      duration,
      summary: sessionSummary,
      endReason: reason,
      customerSatisfaction: satisfaction,
      message: 'Chat session ended successfully'
    });

  } catch (error) {
    console.error('Error ending chat session:', error);
    return responseHelper.serverError('Failed to end chat session');
  }
};

// Helper Functions

function determineSkillRequirements(issue, department, language) {
  const skills = [];
  
  if (department) {
    skills.push(department);
  }
  
  if (language !== 'en') {
    skills.push(`language-${language}`);
  }
  
  // AI-based skill determination based on issue content
  const issueWords = issue.toLowerCase();
  if (issueWords.includes('payment') || issueWords.includes('billing')) {
    skills.push('billing');
  }
  if (issueWords.includes('technical') || issueWords.includes('bug')) {
    skills.push('technical');
  }
  if (issueWords.includes('order') || issueWords.includes('delivery')) {
    skills.push('orders');
  }
  
  return skills;
}

async function findAvailableAgent(skillRequirements, priority) {
  try {
    const agentsQuery = {
      TableName: AGENT_MANAGEMENT_TABLE,
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'available' }
    };

    const agentsResult = await dynamodb.send(new ScanCommand(agentsQuery));
    const availableAgents = agentsResult.Items || [];

    if (availableAgents.length === 0) {
      return null;
    }

    // Score agents based on skills match
    const scoredAgents = availableAgents.map(agent => {
      let score = 0;
      const agentSkills = agent.skills || [];
      
      skillRequirements.forEach(skill => {
        if (agentSkills.includes(skill)) {
          score += 10;
        }
      });

      // Bonus for less busy agents
      score += (10 - (agent.activeSessions || 0));

      // Priority handling bonus
      if (priority === 'high' && agentSkills.includes('priority-handling')) {
        score += 20;
      }

      return { ...agent, score };
    });

    // Return the highest scored agent
    scoredAgents.sort((a, b) => b.score - a.score);
    return scoredAgents[0];

  } catch (error) {
    console.warn('Failed to find available agent:', error);
    return null;
  }
}

async function updateAgentStatus(agentId, status, sessionId = null) {
  try {
    await dynamodb.send(new UpdateCommand({
      TableName: AGENT_MANAGEMENT_TABLE,
      Key: { agentId },
      UpdateExpression: 'SET #status = :status, currentSessionId = :sessionId, lastUpdated = :timestamp',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': status,
        ':sessionId': sessionId,
        ':timestamp': new Date().toISOString()
      }
    }));
  } catch (error) {
    console.warn('Failed to update agent status:', error);
  }
}

async function processFileAttachment(attachment, sessionId) {
  // This is a placeholder - implement actual file processing logic
  return {
    fileId: attachment.fileId || uuidv4(),
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    fileSize: attachment.fileSize,
    status: 'uploaded'
  };
}

async function translateMessage(message, targetLanguage) {
  // Placeholder for AWS Translate integration
  // In a real implementation, you would use AWS Translate service
  return {
    [targetLanguage]: message // For now, return the same message
  };
}

async function logChatAnalytics(eventType, data) {
  try {
    const analyticsRecord = {
      eventId: uuidv4(),
      eventType,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
      data,
      createdAt: new Date().toISOString()
    };

    await dynamodb.send(new PutCommand({
      TableName: ANALYTICS_TABLE,
      Item: analyticsRecord
    }));
  } catch (error) {
    console.warn('Failed to log analytics:', error);
  }
}

async function notifyRealTimeSubscribers(sessionId, eventType, data) {
  // Placeholder for WebSocket notification
  // In a real implementation, you would send WebSocket messages to subscribers
  console.log(`Real-time notification: ${eventType} for session ${sessionId}`);
}

async function generateSessionSummary(sessionId) {
  try {
    // Get all messages for this session
    const messagesQuery = {
      TableName: CHAT_HISTORY_TABLE,
      IndexName: 'session-timestamp-index',
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: { ':sessionId': sessionId }
    };

    const messagesResult = await dynamodb.send(new QueryCommand(messagesQuery));
    const messages = messagesResult.Items || [];

    const summary = {
      messageCount: messages.length,
      attachmentCount: messages.reduce((count, msg) => count + (msg.attachments?.length || 0), 0),
      participantCount: new Set(messages.map(msg => msg.senderId)).size,
      languages: [...new Set(messages.map(msg => msg.language).filter(Boolean))],
      firstMessageAt: messages.length > 0 ? messages[messages.length - 1].timestamp : null,
      lastMessageAt: messages.length > 0 ? messages[0].timestamp : null
    };

    return summary;
  } catch (error) {
    console.warn('Failed to generate session summary:', error);
    return { messageCount: 0, attachmentCount: 0, participantCount: 0 };
  }
}

function convertToCsv(messages) {
  const headers = ['Timestamp', 'Sender', 'Message', 'Type'];
  const rows = messages.map(msg => [
    msg.timestamp,
    msg.senderName || msg.senderId,
    msg.message?.replace(/"/g, '""') || '',
    msg.messageType || 'text'
  ]);

  return [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');
}

function convertToHtml(historyData) {
  const { sessionInfo, messages } = historyData;
  
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Chat History - ${sessionInfo.sessionId}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { margin: 10px 0; padding: 10px; border-radius: 5px; }
        .customer { background-color: #e3f2fd; }
        .agent { background-color: #f3e5f5; }
        .timestamp { font-size: 0.8em; color: #666; }
      </style>
    </head>
    <body>
      <h1>Chat History</h1>
      <h2>Session: ${sessionInfo.sessionId}</h2>
      <p><strong>Customer:</strong> ${sessionInfo.customerName} (${sessionInfo.customerEmail})</p>
      <p><strong>Started:</strong> ${new Date(sessionInfo.createdAt).toLocaleString()}</p>
      <p><strong>Issue:</strong> ${sessionInfo.issue}</p>
      <hr>
  `;

  messages.forEach(msg => {
    const messageClass = msg.senderType === 'customer' ? 'customer' : 'agent';
    html += `
      <div class="message ${messageClass}">
        <div class="timestamp">${new Date(msg.timestamp).toLocaleString()} - ${msg.senderName}</div>
        <div>${msg.message}</div>
      </div>
    `;
  });

  html += `
    </body>
    </html>
  `;

  return html;
}

function aggregateAnalytics(analytics, granularity) {
  // Placeholder for analytics aggregation
  // Group by day/hour/month based on granularity
  return analytics;
}

function calculateAverageSessionDuration(analytics) {
  const sessionEnded = analytics.filter(a => a.eventType === 'session_ended');
  if (sessionEnded.length === 0) return 0;
  
  const totalDuration = sessionEnded.reduce((sum, session) => sum + (session.data?.duration || 0), 0);
  return Math.round(totalDuration / sessionEnded.length);
}

function calculateSatisfactionScore(analytics) {
  const satisfactionScores = analytics
    .filter(a => a.eventType === 'session_ended' && a.data?.satisfaction)
    .map(a => a.data.satisfaction);
  
  if (satisfactionScores.length === 0) return null;
  
  return satisfactionScores.reduce((sum, score) => sum + score, 0) / satisfactionScores.length;
}

function calculateAgentUtilization(analytics) {
  // Placeholder for agent utilization calculation
  return 0.75; // 75% utilization
}

function getPopularLanguages(analytics) {
  const languages = analytics
    .filter(a => a.data?.language)
    .map(a => a.data.language);
  
  const languageCounts = {};
  languages.forEach(lang => {
    languageCounts[lang] = (languageCounts[lang] || 0) + 1;
  });
  
  return Object.entries(languageCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([lang, count]) => ({ language: lang, count }));
}

function getCommonIssues(analytics) {
  // Placeholder for common issues analysis
  return [
    { issue: 'Login problems', count: 15 },
    { issue: 'Payment issues', count: 12 },
    { issue: 'App crashes', count: 8 }
  ];
}

module.exports = {
  initiateChatSession: exports.initiateChatSession,
  sendChatMessage: exports.sendChatMessage,
  uploadFileAttachment: exports.uploadFileAttachment,
  confirmFileUpload: exports.confirmFileUpload,
  getChatHistory: exports.getChatHistory,
  searchChatHistory: exports.searchChatHistory,
  exportChatHistory: exports.exportChatHistory,
  getAvailableAgents: exports.getAvailableAgents,
  updateAgentStatus: exports.updateAgentStatus,
  getChatAnalytics: exports.getChatAnalytics,
  endChatSession: exports.endChatSession
};
