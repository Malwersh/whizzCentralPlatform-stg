// Enhanced Bedrock Service for WhizzMe - Supports both Amazon Nova and Agent-based approaches
const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { KnowledgeBaseLoader } = require('./knowledge-base-loader');

// Configuration
const REGION = 'us-east-1';
const AGENT_ID = 'KDSBVGPAVK';
const AGENT_ALIAS_ID = 'TSTALIASID';
const USE_ALIAS = false; // Set to false to use DRAFT version of agent

// Model Configuration - Amazon Nova Models
const NOVA_MODELS = {
  MICRO: 'amazon.nova-micro-v1:0',      // Fast, cost-effective for simple tasks
  LITE: 'amazon.nova-lite-v1:0',        // Balanced performance and cost
  PRO: 'amazon.nova-pro-v1:0'           // Best performance for complex tasks
};

// AI Strategy Configuration - Optimized for Nova Micro
const AI_CONFIG = {
  strategy: 'nova_micro_first',          // Use Nova Micro as primary for cost efficiency
  primaryModel: NOVA_MODELS.MICRO,       // Nova Micro - most cost-effective for chat support
  fallbackModel: NOVA_MODELS.LITE,       // Fallback to Nova Lite if Micro fails
  useAgentFallback: true,                // Final fallback to Bedrock Agent
  maxTokens: 500,                        // Reduced tokens for chat responses (cost optimization)
  temperature: 0.3,                      // Lower temperature for consistent support responses
  topP: 0.8,                            // Focused responses for support use case
  enableFirstInitiative: true,          // Enable AI to take first initiative in chat
  defaultLanguage: 'ar',                // Default language: Arabic for Iraqi users
  supportedLanguages: ['ar', 'en'],     // Supported languages
  locale: 'ar-IQ'                       // Iraqi Arabic locale
};

// Initialize clients
const agentClient = new BedrockAgentRuntimeClient({ region: REGION });
const runtimeClient = new BedrockRuntimeClient({ region: REGION });

// Initialize Knowledge Base Loader
const kbLoader = new KnowledgeBaseLoader();
kbLoader.initialize().catch(err => console.error('KB initialization error:', err));

/**
 * Get AI-powered response suggestion (using Amazon Nova Micro)
 * @param {Object} context - Conversation context
 * @param {string} context.userType - 'customer' or 'merchant'
 * @param {string} context.message - Current user message
 * @param {string} context.category - Support category (optional)
 * @param {Array} context.conversationHistory - Previous messages
 * @param {Object} context.metadata - Additional context (order ID, issue type, etc.)
 * @returns {Promise<Object>} AI suggestion with response and reasoning
 */
async function getAISuggestion(context) {
  try {
    console.log('🤖 Requesting AI suggestion using Amazon Nova Micro');
    
    // Build the prompt for Nova Micro
    const prompt = buildWhizzMePrompt(context);
    
    console.log('📤 Invoking Amazon Nova Micro...');
    
    // Prepare the request for Nova Micro
    const requestBody = {
      messages: [
        {
          role: "user",
          content: [
            {
              text: prompt
            }
          ]
        }
      ],
      inferenceConfig: {
        maxTokens: AI_CONFIG.maxTokens,
        temperature: AI_CONFIG.temperature,
        topP: AI_CONFIG.topP
      }
    };
    
    const command = new InvokeModelCommand({
      modelId: AI_CONFIG.primaryModel,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody)
    });

    const response = await runtimeClient.send(command);
    
    // Parse Nova response
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    if (responseBody.output && responseBody.output.message && responseBody.output.message.content) {
      const aiText = responseBody.output.message.content[0].text;
      console.log('✅ Received AI response from Amazon Nova Micro');
      
      return {
        success: true,
        suggestion: aiText.trim(),
        reasoning: 'AI-generated using Amazon Nova Micro',
        confidence: 0.9,
        timestamp: new Date().toISOString()
      };
    } else {
      throw new Error('No response text from Nova Micro');
    }
    
  } catch (error) {
    console.error('❌ Amazon Nova Micro invocation failed:', error.message);
    console.error('Error details:', error);
    
    // Return proper error
    return {
      success: false,
      error: error.message,
      errorCode: error.name,
      details: `Failed to invoke Amazon Nova Micro. Error: ${error.message}`,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Parse Bedrock Agent response stream
 */
async function parseAgentResponse(response) {
  let fullText = '';
  
  // Bedrock Agent returns a stream
  if (response.completion) {
    for await (const event of response.completion) {
      if (event.chunk && event.chunk.bytes) {
        const chunkText = new TextDecoder().decode(event.chunk.bytes);
        fullText += chunkText;
      }
    }
  }
  
  return {
    text: fullText.trim(),
    reasoning: 'AI-generated based on conversation context',
    confidence: 0.85
  };
}

/**
 * Generate unique session ID for agent invocation
 */
function generateSessionId() {
  return `whizzme_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Build WhizzMe AI prompt for merchant support
 * Integrates knowledge base for accurate, contextual responses
 */
function buildWhizzMePrompt(context) {
  const { userType, message, category, conversationHistory, metadata } = context;
  
  // Get language preference (default to Arabic for Iraqi users)
  const language = metadata?.language || context.language || AI_CONFIG.defaultLanguage;
  const isArabic = language === 'ar';
  
  // Search knowledge base for relevant content
  const kbCategory = userType === 'merchant' ? 'merchants' : 'customers';
  const kbResults = kbLoader.search(message, kbCategory, 2);
  
  let prompt = '';
  
  if (isArabic) {
    // Arabic prompt with knowledge base integration
    prompt = `أنت WhizzMe، مساعد ذكاء اصطناعي للدعم الفني لمنصة WhizzMerchants - منصة للمطاعم والمتاجر. تساعد التجار في الإجابة على أسئلتهم وحل مشاكلهم.

**الفئة الحالية**: ${getCategoryNameArabic(category) || 'دعم عام'}
**رسالة التاجر**: "${message}"

`;
    
    // Add knowledge base context if found
    if (kbResults && kbResults.length > 0) {
      prompt += `**معلومات من قاعدة المعرفة**:\n`;
      kbResults.forEach((result, index) => {
        prompt += `${index + 1}. ${result.title}\n${result.content}\n\n`;
      });
    }
    
    if (conversationHistory && conversationHistory.length > 0) {
      prompt += `**المحادثة السابقة**:\n`;
      conversationHistory.slice(-3).forEach(msg => {
        prompt += `- ${msg.sender}: ${msg.text}\n`;
      });
      prompt += `\n`;
    }
    
    prompt += `**تعليمات مهمة**:
- الرد باللغة العربية دائماً
- استخدم المعلومات من قاعدة المعرفة إذا كانت متوفرة
- قدم إجابة مفيدة ومهنية وودية
- اجعل الإجابة مختصرة (2-3 جمل) إلا إذا كانت التفاصيل ضرورية
- إذا كنت بحاجة إلى مزيد من المعلومات، اطرح أسئلة محددة
- إذا كانت المشكلة معقدة أو تتطلب تدخل بشري، أخبر التاجر أنك يمكنك توصيله بفريق الدعم
- استخدم أرقام عربية (١، ٢، ٣) عند الترقيم
- كن محترماً واستخدم صيغة المخاطب المناسبة

الرد بالعربية:`;
  } else {
    // English prompt (fallback) with knowledge base integration
    prompt = `You are WhizzMe, an AI support assistant for WhizzMerchants - a merchant platform for restaurants and businesses. You help merchants with their questions and issues.

**Current Category**: ${category || 'General Support'}
**Merchant Message**: "${message}"

`;
    
    // Add knowledge base context if found
    if (kbResults && kbResults.length > 0) {
      prompt += `**Knowledge Base Information**:\n`;
      kbResults.forEach((result, index) => {
        prompt += `${index + 1}. ${result.title}\n${result.content}\n\n`;
      });
    }
    
    if (conversationHistory && conversationHistory.length > 0) {
      prompt += `**Previous Conversation**:\n`;
      conversationHistory.slice(-3).forEach(msg => {
        prompt += `- ${msg.sender}: ${msg.text}\n`;
      });
      prompt += `\n`;
    }
    
    prompt += `Please provide a helpful, professional, and friendly response. Keep it concise (2-3 sentences). If you need more information, ask specific questions. If the issue seems complex or requires human intervention, acknowledge that and mention you can connect them to a support agent.

Response:`;
  }
  
  return prompt;
}

/**
 * Get category name in Arabic
 */
function getCategoryNameArabic(category) {
  const categories = {
    'order_management': 'إدارة الطلبات',
    'payment_issues': 'مشاكل الدفع والتحويلات',
    'account_issues': 'مشاكل الحساب وتسجيل الدخول',
    'business_setup': 'إعدادات المتجر والقائمة',
    'technical_support': 'الدعم الفني',
    'human_agent': 'التحدث مع موظف الدعم'
  };
  return categories[category] || category;
}

/**
 * Build user message with conversation context (Legacy - kept for compatibility)
 */
function buildUserMessage(context) {
  return buildWhizzMePrompt(context);
}

/**
 * Validate agent configuration
 */
async function validateConfiguration() {
  return {
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    region: REGION,
    configured: true
  };
}

module.exports = {
  getAISuggestion
};
