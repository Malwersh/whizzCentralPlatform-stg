/**
 * DynamoDB Stream Processors for Enhanced Amazon Connect
 * Processes chat events and triggers real-time notifications
 */

const { broadcastToSession } = require('./websocket-chat');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Environment variables
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE || 'AmazonConnect-Analytics-dev';
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@company.com';

/**
 * Process Chat Events from DynamoDB Streams
 */
exports.processChatEvents = async (event) => {
  console.log('Processing chat events from DynamoDB stream...');
  console.log('Event:', JSON.stringify(event, null, 2));

  const processedRecords = [];

  try {
    for (const record of event.Records) {
      try {
        const processed = await processRecord(record);
        processedRecords.push(processed);
      } catch (recordError) {
        console.error('Error processing record:', recordError);
        console.error('Record:', JSON.stringify(record, null, 2));
        // Continue processing other records
      }
    }

    console.log(`Successfully processed ${processedRecords.length} records`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Chat events processed successfully',
        processedRecords: processedRecords.length,
        totalRecords: event.Records.length
      })
    };

  } catch (error) {
    console.error('Error processing chat events:', error);
    throw error;
  }
};

/**
 * Process individual DynamoDB stream record
 */
async function processRecord(record) {
  const { eventName, dynamodb: recordData } = record;
  
  console.log(`Processing ${eventName} event`);

  switch (eventName) {
    case 'INSERT':
      return await handleInsertEvent(recordData);
    case 'MODIFY':
      return await handleModifyEvent(recordData);
    case 'REMOVE':
      return await handleRemoveEvent(recordData);
    default:
      console.log(`Unhandled event type: ${eventName}`);
      return { eventName, status: 'skipped' };
  }
}

/**
 * Handle INSERT events (new messages, sessions, etc.)
 */
async function handleInsertEvent(recordData) {
  try {
    const newImage = recordData.NewImage;
    const item = unmarshallDynamoDBItem(newImage);

    // Determine the type of item based on its structure
    if (item.sessionId && item.messageId) {
      // New chat message
      return await handleNewMessage(item);
    } else if (item.sessionId && item.customerId && !item.messageId) {
      // New chat session
      return await handleNewSession(item);
    } else if (item.fileId) {
      // New file attachment
      return await handleNewFileAttachment(item);
    }

    return { eventName: 'INSERT', status: 'unknown_type' };

  } catch (error) {
    console.error('Error handling INSERT event:', error);
    throw error;
  }
}

/**
 * Handle MODIFY events (message updates, status changes, etc.)
 */
async function handleModifyEvent(recordData) {
  try {
    const oldImage = recordData.OldImage ? unmarshallDynamoDBItem(recordData.OldImage) : {};
    const newImage = recordData.NewImage ? unmarshallDynamoDBItem(recordData.NewImage) : {};

    // Determine what changed
    if (newImage.sessionId && newImage.messageId) {
      // Message was updated (read receipts, reactions, etc.)
      return await handleMessageUpdate(oldImage, newImage);
    } else if (newImage.sessionId && newImage.status !== oldImage.status) {
      // Session status changed
      return await handleSessionStatusChange(oldImage, newImage);
    } else if (newImage.agentId) {
      // Agent status changed
      return await handleAgentStatusChange(oldImage, newImage);
    }

    return { eventName: 'MODIFY', status: 'no_relevant_changes' };

  } catch (error) {
    console.error('Error handling MODIFY event:', error);
    throw error;
  }
}

/**
 * Handle REMOVE events (session ended, message deleted, etc.)
 */
async function handleRemoveEvent(recordData) {
  try {
    const oldImage = recordData.OldImage;
    const item = unmarshallDynamoDBItem(oldImage);

    if (item.sessionId && !item.messageId) {
      // Session was deleted/ended
      return await handleSessionEnded(item);
    }

    return { eventName: 'REMOVE', status: 'processed' };

  } catch (error) {
    console.error('Error handling REMOVE event:', error);
    throw error;
  }
}

/**
 * Handle new chat message
 */
async function handleNewMessage(message) {
  try {
    console.log(`New message in session ${message.sessionId}`);

    // Broadcast to WebSocket connections
    await broadcastToSession(message.sessionId, {
      type: 'new_message',
      sessionId: message.sessionId,
      message: {
        messageId: message.messageId,
        senderId: message.senderId,
        senderName: message.senderName,
        senderType: message.senderType,
        message: message.message,
        messageType: message.messageType,
        attachments: message.attachments || [],
        timestamp: message.timestamp
      }
    }, message.senderId); // Exclude sender from broadcast

    // Send push notification to mobile users
    if (message.senderType === 'customer') {
      await sendAgentNotification(message);
    } else if (message.senderType === 'agent') {
      await sendCustomerNotification(message);
    }

    // Update analytics
    await updateAnalytics('message_sent', {
      sessionId: message.sessionId,
      senderId: message.senderId,
      senderType: message.senderType,
      messageType: message.messageType,
      hasAttachments: (message.attachments || []).length > 0
    });

    return { eventName: 'INSERT', type: 'new_message', status: 'processed' };

  } catch (error) {
    console.error('Error handling new message:', error);
    throw error;
  }
}

/**
 * Handle new chat session
 */
async function handleNewSession(session) {
  try {
    console.log(`New chat session created: ${session.sessionId}`);

    // Notify administrators about new session
    if (NOTIFICATION_TOPIC_ARN) {
      await snsClient.send(new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Subject: 'New Chat Session Started',
        Message: JSON.stringify({
          sessionId: session.sessionId,
          customerName: session.customerName,
          customerEmail: session.customerEmail,
          issue: session.issue,
          priority: session.priority,
          department: session.department,
          createdAt: session.createdAt
        }, null, 2)
      }));
    }

    // If no agent assigned, notify available agents
    if (!session.assignedAgentId) {
      await notifyAvailableAgents(session);
    }

    // Update analytics
    await updateAnalytics('session_started', {
      sessionId: session.sessionId,
      customerId: session.customerId,
      priority: session.priority,
      department: session.department,
      hasAgent: !!session.assignedAgentId
    });

    return { eventName: 'INSERT', type: 'new_session', status: 'processed' };

  } catch (error) {
    console.error('Error handling new session:', error);
    throw error;
  }
}

/**
 * Handle new file attachment
 */
async function handleNewFileAttachment(file) {
  try {
    console.log(`New file attachment: ${file.fileId}`);

    // Broadcast file notification to session participants
    if (file.sessionId) {
      await broadcastToSession(file.sessionId, {
        type: 'file_uploaded',
        sessionId: file.sessionId,
        file: {
          fileId: file.fileId,
          fileName: file.fileName,
          fileType: file.fileType,
          fileSize: file.fileSize,
          uploadedBy: file.uploadedBy,
          status: file.status,
          createdAt: file.createdAt
        }
      });
    }

    // Update analytics
    await updateAnalytics('file_uploaded', {
      fileId: file.fileId,
      sessionId: file.sessionId,
      fileType: file.fileType,
      fileSize: file.fileSize,
      uploadedBy: file.uploadedBy
    });

    return { eventName: 'INSERT', type: 'file_attachment', status: 'processed' };

  } catch (error) {
    console.error('Error handling file attachment:', error);
    throw error;
  }
}

/**
 * Handle message updates (read receipts, etc.)
 */
async function handleMessageUpdate(oldMessage, newMessage) {
  try {
    // Check for read receipts
    const oldReadBy = oldMessage.readBy || [];
    const newReadBy = newMessage.readBy || [];

    if (newReadBy.length > oldReadBy.length) {
      // New read receipt
      const newReaders = newReadBy.slice(oldReadBy.length);
      
      await broadcastToSession(newMessage.sessionId, {
        type: 'message_read',
        sessionId: newMessage.sessionId,
        messageId: newMessage.messageId,
        readBy: newReaders
      });
    }

    return { eventName: 'MODIFY', type: 'message_update', status: 'processed' };

  } catch (error) {
    console.error('Error handling message update:', error);
    throw error;
  }
}

/**
 * Handle session status changes
 */
async function handleSessionStatusChange(oldSession, newSession) {
  try {
    console.log(`Session status changed: ${oldSession.status} -> ${newSession.status}`);

    // Broadcast status change to participants
    await broadcastToSession(newSession.sessionId, {
      type: 'session_status_changed',
      sessionId: newSession.sessionId,
      oldStatus: oldSession.status,
      newStatus: newSession.status,
      timestamp: new Date().toISOString()
    });

    // Handle specific status changes
    if (newSession.status === 'ended') {
      await handleSessionEnd(newSession);
    } else if (newSession.status === 'transferred') {
      await handleSessionTransfer(oldSession, newSession);
    }

    // Update analytics
    await updateAnalytics('session_status_changed', {
      sessionId: newSession.sessionId,
      oldStatus: oldSession.status,
      newStatus: newSession.status,
      duration: oldSession.createdAt ? 
        Math.round((new Date() - new Date(oldSession.createdAt)) / 1000) : null
    });

    return { eventName: 'MODIFY', type: 'session_status', status: 'processed' };

  } catch (error) {
    console.error('Error handling session status change:', error);
    throw error;
  }
}

/**
 * Handle agent status changes
 */
async function handleAgentStatusChange(oldAgent, newAgent) {
  try {
    console.log(`Agent status changed: ${newAgent.agentId} ${oldAgent.status} -> ${newAgent.status}`);

    // Update analytics
    await updateAnalytics('agent_status_changed', {
      agentId: newAgent.agentId,
      oldStatus: oldAgent.status,
      newStatus: newAgent.status
    });

    // If agent became available, check for waiting sessions
    if (newAgent.status === 'available' && oldAgent.status !== 'available') {
      await checkForWaitingSessions(newAgent);
    }

    return { eventName: 'MODIFY', type: 'agent_status', status: 'processed' };

  } catch (error) {
    console.error('Error handling agent status change:', error);
    throw error;
  }
}

/**
 * Handle session ended
 */
async function handleSessionEnded(session) {
  try {
    console.log(`Session ended: ${session.sessionId}`);

    // Send session summary email to customer
    if (session.customerEmail) {
      await sendSessionSummaryEmail(session);
    }

    // Clean up related WebSocket connections
    // This would be handled by the WebSocket disconnect handler

    return { type: 'session_ended', status: 'processed' };

  } catch (error) {
    console.error('Error handling session end:', error);
    throw error;
  }
}

/**
 * Handle session end
 */
async function handleSessionEnd(session) {
  try {
    // Calculate session metrics
    const duration = session.createdAt ? 
      Math.round((new Date() - new Date(session.createdAt)) / 1000) : 0;

    // Update analytics
    await updateAnalytics('session_ended', {
      sessionId: session.sessionId,
      customerId: session.customerId,
      agentId: session.assignedAgentId,
      duration,
      endReason: session.endReason,
      satisfaction: session.customerSatisfaction
    });

    // Send notification to management if session was problematic
    if (session.customerSatisfaction && session.customerSatisfaction < 3) {
      await notifyManagementOfLowSatisfaction(session);
    }

  } catch (error) {
    console.error('Error handling session end:', error);
  }
}

/**
 * Handle session transfer
 */
async function handleSessionTransfer(oldSession, newSession) {
  try {
    console.log(`Session transferred: ${oldSession.assignedAgentId} -> ${newSession.assignedAgentId}`);

    // Notify both agents
    await broadcastToSession(newSession.sessionId, {
      type: 'session_transferred',
      sessionId: newSession.sessionId,
      fromAgentId: oldSession.assignedAgentId,
      toAgentId: newSession.assignedAgentId,
      transferReason: newSession.transferReason,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error handling session transfer:', error);
  }
}

/**
 * Send notification to agent about new message
 */
async function sendAgentNotification(message) {
  try {
    if (NOTIFICATION_TOPIC_ARN) {
      await snsClient.send(new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Subject: 'New Customer Message',
        Message: JSON.stringify({
          type: 'new_customer_message',
          sessionId: message.sessionId,
          customerName: message.senderName,
          message: message.message.substring(0, 100),
          timestamp: message.timestamp
        }),
        MessageAttributes: {
          'notification_type': {
            DataType: 'String',
            StringValue: 'agent_notification'
          },
          'session_id': {
            DataType: 'String',
            StringValue: message.sessionId
          }
        }
      }));
    }
  } catch (error) {
    console.error('Error sending agent notification:', error);
  }
}

/**
 * Send notification to customer about agent response
 */
async function sendCustomerNotification(message) {
  try {
    if (NOTIFICATION_TOPIC_ARN) {
      await snsClient.send(new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Subject: 'New Agent Response',
        Message: JSON.stringify({
          type: 'new_agent_message',
          sessionId: message.sessionId,
          agentName: message.senderName,
          message: message.message.substring(0, 100),
          timestamp: message.timestamp
        }),
        MessageAttributes: {
          'notification_type': {
            DataType: 'String',
            StringValue: 'customer_notification'
          },
          'session_id': {
            DataType: 'String',
            StringValue: message.sessionId
          }
        }
      }));
    }
  } catch (error) {
    console.error('Error sending customer notification:', error);
  }
}

/**
 * Notify available agents about new session
 */
async function notifyAvailableAgents(session) {
  try {
    if (NOTIFICATION_TOPIC_ARN) {
      await snsClient.send(new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Subject: 'New Chat Session Waiting',
        Message: JSON.stringify({
          type: 'session_waiting_for_agent',
          sessionId: session.sessionId,
          customerName: session.customerName,
          issue: session.issue,
          priority: session.priority,
          department: session.department,
          skillRequirements: session.skillRequirements,
          createdAt: session.createdAt
        }),
        MessageAttributes: {
          'notification_type': {
            DataType: 'String',
            StringValue: 'agent_assignment'
          },
          'priority': {
            DataType: 'String',
            StringValue: session.priority
          },
          'department': {
            DataType: 'String',
            StringValue: session.department
          }
        }
      }));
    }
  } catch (error) {
    console.error('Error notifying available agents:', error);
  }
}

/**
 * Check for waiting sessions when agent becomes available
 */
async function checkForWaitingSessions(agent) {
  try {
    // This would implement logic to assign waiting sessions to newly available agents
    console.log(`Checking for waiting sessions for agent ${agent.agentId}`);
    
    // In a real implementation, you would:
    // 1. Query for sessions with status 'waiting' or 'queued'
    // 2. Match agent skills with session requirements
    // 3. Assign the highest priority session to the agent
    // 4. Update both session and agent records
    
  } catch (error) {
    console.error('Error checking for waiting sessions:', error);
  }
}

/**
 * Send session summary email
 */
async function sendSessionSummaryEmail(session) {
  try {
    const emailParams = {
      Source: FROM_EMAIL,
      Destination: {
        ToAddresses: [session.customerEmail]
      },
      Message: {
        Subject: {
          Data: 'Chat Session Summary - Your Support Request'
        },
        Body: {
          Html: {
            Data: generateSessionSummaryEmailHtml(session)
          },
          Text: {
            Data: generateSessionSummaryEmailText(session)
          }
        }
      }
    };

    await sesClient.send(new SendEmailCommand(emailParams));
    console.log(`Session summary email sent to ${session.customerEmail}`);

  } catch (error) {
    console.error('Error sending session summary email:', error);
  }
}

/**
 * Notify management of low satisfaction
 */
async function notifyManagementOfLowSatisfaction(session) {
  try {
    if (NOTIFICATION_TOPIC_ARN) {
      await snsClient.send(new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Subject: 'Low Customer Satisfaction Alert',
        Message: JSON.stringify({
          type: 'low_satisfaction_alert',
          sessionId: session.sessionId,
          customerName: session.customerName,
          customerEmail: session.customerEmail,
          agentId: session.assignedAgentId,
          agentName: session.assignedAgentName,
          satisfaction: session.customerSatisfaction,
          feedback: session.feedback,
          issue: session.issue,
          endedAt: session.endedAt
        }),
        MessageAttributes: {
          'notification_type': {
            DataType: 'String',
            StringValue: 'management_alert'
          },
          'severity': {
            DataType: 'String',
            StringValue: 'high'
          }
        }
      }));
    }
  } catch (error) {
    console.error('Error notifying management:', error);
  }
}

/**
 * Update analytics
 */
async function updateAnalytics(eventType, data) {
  try {
    const analyticsRecord = {
      eventId: `${eventType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      eventType,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
      data,
      createdAt: new Date().toISOString()
    };

    await dynamodb.send(new UpdateCommand({
      TableName: ANALYTICS_TABLE,
      Key: { eventId: analyticsRecord.eventId },
      UpdateExpression: 'SET eventType = :eventType, #timestamp = :timestamp, #date = :date, #data = :data, createdAt = :createdAt',
      ExpressionAttributeNames: {
        '#timestamp': 'timestamp',
        '#date': 'date',
        '#data': 'data'
      },
      ExpressionAttributeValues: {
        ':eventType': analyticsRecord.eventType,
        ':timestamp': analyticsRecord.timestamp,
        ':date': analyticsRecord.date,
        ':data': analyticsRecord.data,
        ':createdAt': analyticsRecord.createdAt
      }
    }));

  } catch (error) {
    console.error('Error updating analytics:', error);
  }
}

/**
 * Generate HTML email content for session summary
 */
function generateSessionSummaryEmailHtml(session) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .content { padding: 20px; border: 1px solid #e9ecef; border-radius: 8px; }
        .footer { margin-top: 20px; font-size: 12px; color: #6c757d; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Chat Session Summary</h2>
          <p>Thank you for contacting our support team.</p>
        </div>
        <div class="content">
          <h3>Session Details</h3>
          <p><strong>Session ID:</strong> ${session.sessionId}</p>
          <p><strong>Date:</strong> ${new Date(session.createdAt).toLocaleDateString()}</p>
          <p><strong>Agent:</strong> ${session.assignedAgentName || 'Unassigned'}</p>
          <p><strong>Issue:</strong> ${session.issue}</p>
          ${session.summary ? `
            <h3>Session Summary</h3>
            <p>Messages exchanged: ${session.summary.messageCount || 0}</p>
            <p>Attachments shared: ${session.summary.attachmentCount || 0}</p>
          ` : ''}
          ${session.customerSatisfaction ? `
            <h3>Your Feedback</h3>
            <p>Satisfaction Rating: ${session.customerSatisfaction}/5</p>
            ${session.feedback ? `<p>Comments: ${session.feedback}</p>` : ''}
          ` : ''}
        </div>
        <div class="footer">
          <p>If you need further assistance, please don't hesitate to contact us.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate plain text email content for session summary
 */
function generateSessionSummaryEmailText(session) {
  return `
Chat Session Summary

Thank you for contacting our support team.

Session Details:
- Session ID: ${session.sessionId}
- Date: ${new Date(session.createdAt).toLocaleDateString()}
- Agent: ${session.assignedAgentName || 'Unassigned'}
- Issue: ${session.issue}

${session.summary ? `
Session Summary:
- Messages exchanged: ${session.summary.messageCount || 0}
- Attachments shared: ${session.summary.attachmentCount || 0}
` : ''}

${session.customerSatisfaction ? `
Your Feedback:
- Satisfaction Rating: ${session.customerSatisfaction}/5
${session.feedback ? `- Comments: ${session.feedback}` : ''}
` : ''}

If you need further assistance, please don't hesitate to contact us.
  `;
}

/**
 * Unmarshal DynamoDB item from stream record
 */
function unmarshallDynamoDBItem(dynamoItem) {
  const result = {};
  
  for (const [key, value] of Object.entries(dynamoItem)) {
    if (value.S !== undefined) {
      result[key] = value.S;
    } else if (value.N !== undefined) {
      result[key] = Number(value.N);
    } else if (value.BOOL !== undefined) {
      result[key] = value.BOOL;
    } else if (value.L !== undefined) {
      result[key] = value.L.map(item => unmarshallDynamoDBItem({ temp: item }).temp);
    } else if (value.M !== undefined) {
      result[key] = unmarshallDynamoDBItem(value.M);
    } else if (value.SS !== undefined) {
      result[key] = value.SS;
    } else if (value.NS !== undefined) {
      result[key] = value.NS.map(Number);
    } else if (value.NULL !== undefined) {
      result[key] = null;
    }
  }
  
  return result;
}

module.exports = {
  processChatEvents: exports.processChatEvents
};
