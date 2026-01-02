// Knowledge Base Loader for WhizzMe AI
// Loads and searches structured knowledge base JSON files

const fs = require('fs');
const path = require('path');

class KnowledgeBaseLoader {
  constructor(basePath = path.join(__dirname, '../../knowledge-base')) {
    this.basePath = basePath;
    this.cache = new Map();
    this.initialized = false;
  }

  /**
   * Initialize and load all knowledge base files
   */
  async initialize() {
    if (this.initialized) return;

    try {
      console.log('📚 Loading knowledge base from:', this.basePath);
      
      const categories = ['merchants', 'customers', 'policies', 'common-issues'];
      let totalFiles = 0;
      
      for (const category of categories) {
        const categoryPath = path.join(this.basePath, category);
        
        if (fs.existsSync(categoryPath)) {
          const files = fs.readdirSync(categoryPath);
          
          for (const file of files) {
            if (file.endsWith('.json')) {
              try {
                const filePath = path.join(categoryPath, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(content);
                
                const key = `${category}/${file}`;
                this.cache.set(key, data);
                totalFiles++;
                
                console.log(`  ✅ Loaded: ${key}`);
              } catch (error) {
                console.error(`  ❌ Error loading ${file}:`, error.message);
              }
            }
          }
        }
      }
      
      this.initialized = true;
      console.log(`✅ Knowledge base loaded: ${totalFiles} files, ${this.cache.size} entries`);
      
    } catch (error) {
      console.error('❌ Failed to initialize knowledge base:', error);
      // Continue without knowledge base - fallback to basic prompts
    }
  }

  /**
   * Search knowledge base for relevant content
   * @param {string} query - User's question/message
   * @param {string} category - Optional category filter (merchants/customers)
   * @param {number} limit - Maximum results to return
   * @returns {Array} Relevant knowledge base entries with scores
   */
  search(query, category = null, limit = 3) {
    if (!this.initialized) {
      console.warn('⚠️ Knowledge base not initialized');
      return [];
    }

    const results = [];
    const lowerQuery = query.toLowerCase();
    
    // Search through all cached knowledge bases
    for (const [key, data] of this.cache.entries()) {
      // Filter by category if specified
      if (category && !key.startsWith(category)) {
        continue;
      }
      
      // Search questions
      if (data.questions && Array.isArray(data.questions)) {
        for (const qa of data.questions) {
          const matchScore = this.calculateMatchScore(lowerQuery, qa);
          
          if (matchScore > 0.3) { // Threshold for relevance
            results.push({
              score: matchScore,
              title: qa.question,
              content: qa.answer,
              id: qa.id,
              category: data.category || category,
              priority: qa.priority || 'medium',
              keywords: qa.keywords || [],
              escalate_if: qa.escalate_if || [],
              related: qa.related || []
            });
          }
        }
      }
    }
    
    // Sort by score (highest first) and limit results
    const sortedResults = results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    console.log(`🔍 Found ${sortedResults.length} relevant KB entries for: "${query}"`);
    
    return sortedResults;
  }

  /**
   * Calculate match score between query and knowledge base entry
   * Supports bilingual search (Arabic + English)
   * @param {string} query - Lowercased user query
   * @param {object} qa - Question/Answer object from KB
   * @returns {number} Match score between 0 and 1
   */
  calculateMatchScore(query, qa) {
    let score = 0;
    
    // Check exact question match (highest score)
    const lowerQuestion = qa.question.toLowerCase();
    if (lowerQuestion === query) {
      return 1.0;
    }
    
    // Check if query is in question
    if (lowerQuestion.includes(query)) {
      score += 0.8;
    } else if (query.includes(lowerQuestion)) {
      score += 0.6;
    }
    
    // Check Arabic keywords (important for Iraqi users)
    if (qa.keywords && Array.isArray(qa.keywords)) {
      const matchedKeywords = qa.keywords.filter(keyword => 
        query.includes(keyword.toLowerCase()) || 
        keyword.toLowerCase().includes(query)
      );
      score += matchedKeywords.length * 0.3;
    }
    
    // Check English keywords for bilingual support
    if (qa.keywords_en && Array.isArray(qa.keywords_en)) {
      const matchedKeywordsEn = qa.keywords_en.filter(keyword => 
        query.includes(keyword.toLowerCase()) || 
        keyword.toLowerCase().includes(query)
      );
      score += matchedKeywordsEn.length * 0.3;
    }
    
    // Check answer relevance (lower weight)
    if (qa.answer) {
      const lowerAnswer = qa.answer.toLowerCase();
      const queryWords = query.split(/\s+/).filter(w => w.length > 2); // Reduced from 3 for Arabic support
      const matchedWords = queryWords.filter(word => 
        lowerAnswer.includes(word)
      );
      score += (matchedWords.length / Math.max(queryWords.length, 1)) * 0.2;
    }
    
    // Priority boost for critical issues
    if (qa.priority === 'critical' || qa.priority === 'high') {
      score *= 1.1;
    }
    
    return Math.min(score, 1.0); // Cap at 1.0
  }

  /**
   * Get all entries for a specific category
   * @param {string} category - Category name (merchants/customers/etc)
   * @returns {Array} All knowledge base entries for category
   */
  getByCategory(category) {
    if (!this.initialized) return [];
    
    const results = [];
    
    for (const [key, data] of this.cache.entries()) {
      if (key.startsWith(category)) {
        results.push(data);
      }
    }
    
    return results;
  }

  /**
   * Get a specific question by ID
   * @param {string} questionId - Question ID (e.g., 'OM001')
   * @returns {object|null} Question object or null
   */
  getQuestionById(questionId) {
    if (!this.initialized) return null;
    
    for (const data of this.cache.values()) {
      if (data.questions) {
        const question = data.questions.find(q => q.id === questionId);
        if (question) return question;
      }
    }
    
    return null;
  }

  /**
   * Get related questions for a given question ID
   * @param {string} questionId - Question ID
   * @returns {Array} Related question objects
   */
  getRelatedQuestions(questionId) {
    const question = this.getQuestionById(questionId);
    if (!question || !question.related) return [];
    
    return question.related
      .map(id => this.getQuestionById(id))
      .filter(q => q !== null);
  }

  /**
   * Get policies for a category
   * @param {string} category - Category name
   * @returns {Array} Policy objects
   */
  getPolicies(category) {
    const categoryData = this.getByCategory(category);
    const policies = [];
    
    for (const data of categoryData) {
      if (data.policies && Array.isArray(data.policies)) {
        policies.push(...data.policies);
      }
    }
    
    return policies;
  }

  /**
   * Get workflows for a category
   * @param {string} category - Category name
   * @returns {Array} Workflow objects
   */
  getWorkflows(category) {
    const categoryData = this.getByCategory(category);
    const workflows = [];
    
    for (const data of categoryData) {
      if (data.workflows && Array.isArray(data.workflows)) {
        workflows.push(...data.workflows);
      }
    }
    
    return workflows;
  }

  /**
   * Reload knowledge base (for updates without restart)
   */
  async reload() {
    console.log('🔄 Reloading knowledge base...');
    this.cache.clear();
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Get statistics about loaded knowledge base
   */
  getStats() {
    if (!this.initialized) return null;
    
    let totalQuestions = 0;
    let totalPolicies = 0;
    let totalWorkflows = 0;
    const categories = new Set();
    
    for (const data of this.cache.values()) {
      if (data.category) categories.add(data.category);
      if (data.questions) totalQuestions += data.questions.length;
      if (data.policies) totalPolicies += data.policies.length;
      if (data.workflows) totalWorkflows += data.workflows.length;
    }
    
    return {
      filesLoaded: this.cache.size,
      categories: Array.from(categories),
      totalQuestions,
      totalPolicies,
      totalWorkflows,
      initialized: this.initialized
    };
  }
}

// Export singleton instance
const knowledgeBase = new KnowledgeBaseLoader();

module.exports = {
  KnowledgeBaseLoader,
  knowledgeBase
};
