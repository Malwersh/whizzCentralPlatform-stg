// Support Center Handlers - Using sample data for testing
// const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
// const { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// const client = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
// const dynamoDB = DynamoDBDocumentClient.from(client);

// Response helper
const response = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  },
  body: JSON.stringify(body)
});

// Get all support tickets
exports.getTickets = async (event) => {
  try {
    console.log('Getting support tickets');
    
    // For testing - return sample data instead of DynamoDB
    const sampleTickets = [
      {
        ticketId: 'TKT001',
        subject: 'Unable to receive delivery notifications',
        description: 'Driver is not receiving push notifications for new delivery assignments',
        customerEmail: 'ahmed.driver@wizzdelivery.com',
        customerName: 'Ahmed Al-Rashid',
        priority: 'high',
        status: 'open',
        category: 'app',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        ticketId: 'TKT002',
        subject: 'Payment issue with weekly earnings',
        description: 'Weekly payment did not arrive as expected',
        customerEmail: 'sara.driver@wizzdelivery.com',
        customerName: 'Sara Al-Mahmoud',
        priority: 'medium',
        status: 'in-progress',
        category: 'payment',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    
    console.log(`Retrieved ${sampleTickets.length} tickets`);
    
    return response(200, {
      success: true,
      tickets: sampleTickets,
      count: sampleTickets.length
    });
  } catch (error) {
    console.error('Error getting tickets:', error);
    return response(500, {
      success: false,
      error: 'Failed to retrieve tickets'
    });
  }
};

// Create a new support ticket
exports.createTicket = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const ticketId = `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const ticket = {
      ticketId,
      subject: body.subject,
      description: body.description,
      customerEmail: body.customerEmail,
      customerName: body.customerName,
      priority: body.priority || 'medium',
      status: 'open',
      category: body.category || 'general',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const params = {
      TableName: process.env.TICKETS_TABLE || 'wizzcentral-support-tickets',
      Item: ticket
    };

    await dynamoDB.send(new PutCommand(params));
    
    console.log(`Created ticket: ${ticketId}`);
    
    return response(201, {
      success: true,
      ticket
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    return response(500, {
      success: false,
      error: 'Failed to create ticket'
    });
  }
};

// Get FAQ items
exports.getFAQs = async (event) => {
  try {
    console.log('Getting FAQs');
    
    // For testing - return sample data
    const sampleFAQs = [
      {
        faqId: 'FAQ001',
        question: 'How do I update my delivery availability status?',
        answer: 'You can update your availability status by going to the main dashboard and toggling the "Available for Deliveries" switch.',
        category: 'app',
        views: 156
      },
      {
        faqId: 'FAQ002',
        question: 'When will I receive my weekly payment?',
        answer: 'Weekly payments are processed every Monday for the previous week. Payments typically arrive within 1-2 business days.',
        category: 'payment',
        views: 89
      }
    ];
    
    console.log(`Retrieved ${sampleFAQs.length} FAQs`);
    
    return response(200, {
      success: true,
      faqs: sampleFAQs,
      count: sampleFAQs.length
    });
  } catch (error) {
    console.error('Error getting FAQs:', error);
    return response(500, {
      success: false,
      error: 'Failed to retrieve FAQs'
    });
  }
};

// Get knowledge base articles
exports.getKnowledgeBase = async (event) => {
  try {
    console.log('Getting knowledge base articles');
    
    // For testing - return sample data
    const sampleArticles = [
      {
        articleId: 'KB001',
        title: 'Driver App Complete User Guide',
        description: 'Comprehensive guide covering all features of the WizzCentral driver mobile application',
        category: 'user-guide',
        views: 445,
        updatedAt: new Date().toISOString()
      },
      {
        articleId: 'KB002',
        title: 'Payment and Earnings Troubleshooting',
        description: 'Solutions for common payment-related issues and how to track your earnings',
        category: 'payment',
        views: 289,
        updatedAt: new Date().toISOString()
      }
    ];
    
    console.log(`Retrieved ${sampleArticles.length} knowledge base articles`);
    
    return response(200, {
      success: true,
      articles: sampleArticles,
      count: sampleArticles.length
    });
  } catch (error) {
    console.error('Error getting knowledge base articles:', error);
    return response(500, {
      success: false,
      error: 'Failed to retrieve knowledge base articles'
    });
  }
};

// Update ticket status
exports.updateTicket = async (event) => {
  try {
    const { ticketId } = event.pathParameters;
    const body = JSON.parse(event.body);
    
    const params = {
      TableName: process.env.TICKETS_TABLE || 'wizzcentral-support-tickets',
      Key: { ticketId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': body.status,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    };

    if (body.response) {
      params.UpdateExpression += ', response = :response';
      params.ExpressionAttributeValues[':response'] = body.response;
    }

    const result = await dynamoDB.send(new UpdateCommand(params));
    
    console.log(`Updated ticket: ${ticketId}`);
    
    return response(200, {
      success: true,
      ticket: result.Attributes
    });
  } catch (error) {
    console.error('Error updating ticket:', error);
    return response(500, {
      success: false,
      error: 'Failed to update ticket'
    });
  }
};
