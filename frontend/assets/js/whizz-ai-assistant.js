/**
 * WhizzMe Assistant - Frontend Integration
 * Provides AI-powered response suggestions for support agents
 */

class WhizzMeAssistant {
  constructor(config) {
    this.apiEndpoint = config.apiEndpoint;
    this.cognitoToken = null;
    this.isEnabled = true;
    this.autoTriggerEnabled = config.autoTrigger || true;
    this.currentSuggestion = null;
    
    this.initializeUI();
  }

  /**
   * Initialize AI suggestion UI panel
   */
  initializeUI() {
    // Get translations (with fallback if i18n not loaded)
    const t = (key, fallback) => {
      if (window.SupportI18n) {
        return window.SupportI18n.t(key);
      }
      return fallback;
    };
    
    // Create AI suggestion panel (inserted above chat input)
    const panel = document.createElement('div');
    panel.id = 'ai-suggestion-panel';
    panel.className = 'ai-suggestion-panel hidden';
    panel.innerHTML = `
      <div class="ai-suggestion-header">
        <div class="ai-icon">🤖</div>
        <span class="ai-title" data-i18n="whizzMeSuggestion">${t('whizzMeSuggestion', 'WhizzMe Suggestion')}</span>
        <button class="ai-close-btn" type="button">×</button>
      </div>
      <div class="ai-suggestion-body">
        <div class="ai-loading hidden">
          <div class="spinner"></div>
          <span data-i18n="generatingSuggestionDots">${t('generatingSuggestionDots', 'Generating suggestion...')}</span>
        </div>
        <div class="ai-content hidden">
          <p class="ai-suggestion-text"></p>
          <div class="ai-actions">
            <button class="btn-ai-use" type="button" data-i18n="useThisResponse">
              ${t('useThisResponse', '✓ Use This Response')}
            </button>
            <button class="btn-ai-regenerate" type="button" data-i18n="regenerate">
              ${t('regenerate', '🔄 Regenerate')}
            </button>
            <button class="btn-ai-dismiss" type="button" data-i18n="dismiss">
              ${t('dismiss', 'Dismiss')}
            </button>
          </div>
        </div>
        <div class="ai-error hidden">
          <p class="ai-error-text"></p>
          <button class="btn-ai-retry" type="button" data-i18n="tryAgain">${t('tryAgain', 'Try Again')}</button>
        </div>
      </div>
      <div class="ai-footer">
        <small data-i18n="reviewBeforeSending">${t('reviewBeforeSending', 'AI-generated suggestion • Review before sending')}</small>
      </div>
    `;
    
    // Insert before chat input area
    const chatInput = document.querySelector('.chat-input');
    if (chatInput) {
      chatInput.parentNode.insertBefore(panel, chatInput);
    }
    
    this.bindUIActions(panel);
    this.addTriggerButton();
  }

  /**
   * Wire up AI panel buttons without inline handlers
   */
  bindUIActions(panel) {
    const closeBtn = panel.querySelector('.ai-close-btn');
    const useBtn = panel.querySelector('.btn-ai-use');
    const regenBtn = panel.querySelector('.btn-ai-regenerate');
    const dismissBtn = panel.querySelector('.btn-ai-dismiss');
    const retryBtn = panel.querySelector('.btn-ai-retry');

    closeBtn?.addEventListener('click', () => this.hideSuggestion());
    dismissBtn?.addEventListener('click', () => this.hideSuggestion());
    useBtn?.addEventListener('click', () => this.useSuggestion());
    regenBtn?.addEventListener('click', () => this.regenerateSuggestion());
    retryBtn?.addEventListener('click', () => this.retrySuggestion());
  }

  /**
   * Add AI trigger button next to send button
   */
  addTriggerButton() {
    const t = (key, fallback) => {
      if (window.SupportI18n) {
        return window.SupportI18n.t(key);
      }
      return fallback;
    };
    
    const sendBtn = document.querySelector('.send-button');
    if (sendBtn) {
      const aiBtn = document.createElement('button');
      aiBtn.className = 'ai-trigger-btn';
      aiBtn.setAttribute('data-i18n', 'whizzMeSuggest');
      aiBtn.innerHTML = t('whizzMeSuggest', '🤖 WhizzMe Suggest');
      aiBtn.type = 'button';
      aiBtn.addEventListener('click', () => this.requestSuggestion());
      sendBtn.parentNode.insertBefore(aiBtn, sendBtn);
    }
  }

  /**
   * Request AI suggestion for current conversation
   */
  async requestSuggestion() {
    const session = this.getCurrentSession();
    if (!session) {
      console.warn('No active chat session');
      return;
    }

    const lastMessage = this.getLastMessage(session);
    if (!lastMessage) {
      console.warn('No messages in conversation');
      return;
    }

    this.showLoading();

    try {
      const context = {
        sessionId: session.id,
        userType: session.userType || 'customer',
        message: lastMessage.text,
        conversationHistory: session.messages.slice(-10).map(msg => ({
          sender: msg.sender,
          text: msg.text
        })),
        metadata: {
          orderId: session.orderId,
          issueType: session.issueType,
          urgency: this.detectUrgency(lastMessage.text)
        }
      };

      const response = await this.callAIAPI(context);
      
      if (response.success) {
        this.currentSuggestion = response.suggestion;
        this.showSuggestion(response.suggestion);
        this.trackUsage('suggestion_generated', { confidence: response.confidence });
      } else {
        this.showError(response.error || 'Failed to generate suggestion');
      }

    } catch (error) {
      console.error('Error requesting AI suggestion:', error);
      this.showError('Network error. Please try again.');
    }
  }

  /**
   * Call AI Agent API
   */
  async callAIAPI(context) {
    const token = await this.getCognitoToken();
    
    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(context)
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Use AI suggestion in chat input
   */
  useSuggestion() {
    if (!this.currentSuggestion) return;

    const chatInput = document.getElementById('messageInput');
    if (chatInput) {
      chatInput.value = this.currentSuggestion;
      chatInput.focus();
      this.hideSuggestion();
      this.trackUsage('suggestion_used');
    }
  }

  /**
   * Regenerate suggestion with different context
   */
  async regenerateSuggestion() {
    this.trackUsage('suggestion_regenerated');
    await this.requestSuggestion();
  }

  /**
   * Retry after error
   */
  async retrySuggestion() {
    await this.requestSuggestion();
  }

  /**
   * Show/hide UI states
   */
  showLoading() {
    const panel = document.getElementById('ai-suggestion-panel');
    panel.classList.remove('hidden');
    panel.querySelector('.ai-loading').classList.remove('hidden');
    panel.querySelector('.ai-content').classList.add('hidden');
    panel.querySelector('.ai-error').classList.add('hidden');
  }

  showSuggestion(text) {
    const panel = document.getElementById('ai-suggestion-panel');
    panel.querySelector('.ai-loading').classList.add('hidden');
    panel.querySelector('.ai-content').classList.remove('hidden');
    panel.querySelector('.ai-suggestion-text').textContent = text;
  }

  showError(message) {
    const panel = document.getElementById('ai-suggestion-panel');
    panel.querySelector('.ai-loading').classList.add('hidden');
    panel.querySelector('.ai-error').classList.remove('hidden');
    panel.querySelector('.ai-error-text').textContent = message;
  }

  hideSuggestion() {
    const panel = document.getElementById('ai-suggestion-panel');
    panel.classList.add('hidden');
    this.currentSuggestion = null;
    this.trackUsage('suggestion_dismissed');
  }

  /**
   * Helper: Get current active session
   */
  getCurrentSession() {
    // Hook into existing support.html session management
    if (window.activeChatSessions && window.currentSessionId) {
      return window.activeChatSessions.get(window.currentSessionId);
    }
    return null;
  }

  /**
   * Helper: Get last message from session
   */
  getLastMessage(session) {
    if (!session.messages || session.messages.length === 0) return null;
    // Get last non-system message
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].sender !== 'system') {
        return session.messages[i];
      }
    }
    return null;
  }

  /**
   * Helper: Detect urgency from message content
   */
  detectUrgency(message) {
    const urgentKeywords = ['urgent', 'emergency', 'asap', 'immediately', 'help', 'problem', 'issue', 'wrong', 'error'];
    const lowerMessage = message.toLowerCase();
    return urgentKeywords.some(keyword => lowerMessage.includes(keyword)) ? 'high' : 'normal';
  }

  /**
   * Helper: Get Cognito authentication token
   */
  async getCognitoToken() {
    // Hook into existing Cognito auth from support.html
    if (window.cognitoUser) {
      return new Promise((resolve, reject) => {
        window.cognitoUser.getSession((err, session) => {
          if (err) reject(err);
          else resolve(session.getIdToken().getJwtToken());
        });
      });
    }
    
    // Fallback: try to get from localStorage
    const token = localStorage.getItem('idToken');
    return token || null;
  }

  /**
   * Track AI usage analytics
   */
  trackUsage(event, metadata = {}) {
    console.log('📊 AI Usage:', event, metadata);
    // TODO: Send to analytics service (CloudWatch, etc.)
  }
}

// Initialize global AI assistant
let whizzAI = null;

function initializeWhizzAI(apiEndpoint) {
  if (!apiEndpoint) {
    console.warn('⚠️ AI API endpoint not configured');
    return;
  }
  
  whizzAI = new WhizzAIAssistant({
    apiEndpoint: apiEndpoint,
    autoTrigger: true
  });
  if (typeof window !== 'undefined') {
    window.whizzAI = whizzAI;
  }
  console.log('✅ whizzAI Assistant initialized');
}
