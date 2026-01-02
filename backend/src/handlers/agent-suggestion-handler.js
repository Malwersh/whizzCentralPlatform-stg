// Lambda Handler for AI Agent Suggestions
const { getAISuggestion, validateConfiguration } = require('../services/bedrock-agent-service');

/**
 * CORS headers for all responses
 */
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
};

/**
 * Lambda handler for getting AI suggestions
 * Triggered via API Gateway POST /api/agent-suggestion
 */
exports.handler = async (event) => {
  console.log('📥 Received AI suggestion request:', JSON.stringify(event, null, 2));
  
  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }
  
  try {
    // Parse request body
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    
    // Validate required fields
    if (!body.message) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Missing required field: message'
        })
      };
    }
    
    // Extract conversation context
    const context = {
      sessionId: body.sessionId || `session-${Date.now()}`,
      userType: body.userType || 'merchant', // Default to 'merchant' for WhizzMerchants app
      message: body.message,
      category: body.category, // Support category from Flutter
      merchantId: body.merchantId,
      conversationHistory: body.conversationHistory || [],
      metadata: body.metadata || {}
    };
    
    // Get AI suggestion
    const suggestion = await getAISuggestion(context);
    
    if (!suggestion.success) {
      // Return error with proper format for frontend
      return {
        statusCode: 200, // Use 200 so frontend can parse JSON error details
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: suggestion.error || 'Failed to get AI suggestion',
          errorCode: suggestion.errorCode,
          details: suggestion.details || 'Amazon Bedrock AI is not accessible. Please ensure model access is enabled.',
          timestamp: suggestion.timestamp
        })
      };
    }
    
    // Return successful suggestion
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        suggestion: suggestion.suggestion,
        reasoning: suggestion.reasoning,
        confidence: suggestion.confidence,
        timestamp: suggestion.timestamp
      })
    };
    
  } catch (error) {
    console.error('❌ Error in agent suggestion handler:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};

/**
 * Health check handler
 */
exports.healthCheck = async (event) => {
  try {
    const config = await validateConfiguration();
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: 'healthy',
        service: 'whizzAI Agent Suggestion',
        configuration: config
      })
    };
  } catch (error) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'unhealthy',
        error: error.message
      })
    };
  }
};
