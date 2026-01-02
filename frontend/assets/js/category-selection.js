/**
 * WhizzMe Category Selection Screen
 * Localized "How can we help you today?" interface
 * Supports Arabic and English with RTL/LTR layout
 */

class CategorySelectionScreen {
  constructor(config = {}) {
    this.onCategorySelect = config.onCategorySelect || (() => {});
    this.containerId = config.containerId || 'category-selection-container';
    this.categories = [
      {
        id: 'order_management',
        icon: '📦',
        titleKey: 'orderManagement',
        descKey: 'orderManagementDesc'
      },
      {
        id: 'payment_issues',
        icon: '💳',
        titleKey: 'paymentIssues',
        descKey: 'paymentIssuesDesc'
      },
      {
        id: 'account_issues',
        icon: '👤',
        titleKey: 'accountIssues',
        descKey: 'accountIssuesDesc'
      },
      {
        id: 'business_setup',
        icon: '🏪',
        titleKey: 'businessSetup',
        descKey: 'businessSetupDesc'
      },
      {
        id: 'technical_support',
        icon: '🔧',
        titleKey: 'technicalSupport',
        descKey: 'technicalSupportDesc'
      },
      {
        id: 'human_agent',
        icon: '👨‍💼',
        titleKey: 'humanAgent',
        descKey: 'humanAgentDesc'
      }
    ];
  }

  /**
   * Get translation (with fallback)
   */
  t(key, fallback = '') {
    if (window.SupportI18n) {
      return window.SupportI18n.t(key);
    }
    return fallback || key;
  }

  /**
   * Check if current language is RTL
   */
  isRTL() {
    if (window.SupportI18n) {
      return window.SupportI18n.isRTL();
    }
    return false;
  }

  /**
   * Render the category selection screen
   */
  render() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`Container #${this.containerId} not found`);
      return;
    }

    const direction = this.isRTL() ? 'rtl' : 'ltr';
    
    container.innerHTML = `
      <div class="category-selection-screen" dir="${direction}">
        <div class="category-header">
          <h2 data-i18n="howCanWeHelp">${this.t('howCanWeHelp', 'How can we help you today?')}</h2>
          <p data-i18n="selectCategory">${this.t('selectCategory', 'Select a category to get better assistance')}</p>
        </div>
        
        <div class="category-grid">
          ${this.categories.map(cat => this.renderCategoryCard(cat)).join('')}
        </div>
      </div>
    `;

    // Bind click events
    this.bindEvents();
  }

  /**
   * Render a single category card
   */
  renderCategoryCard(category) {
    return `
      <div class="category-card" data-category="${category.id}">
        <div class="category-icon">${category.icon}</div>
        <div class="category-content">
          <h3 data-i18n="${category.titleKey}">${this.t(category.titleKey)}</h3>
          <p data-i18n="${category.descKey}">${this.t(category.descKey)}</p>
        </div>
        <div class="category-arrow">${this.isRTL() ? '←' : '→'}</div>
      </div>
    `;
  }

  /**
   * Bind click events to category cards
   */
  bindEvents() {
    const cards = document.querySelectorAll('.category-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const categoryId = card.getAttribute('data-category');
        this.selectCategory(categoryId);
      });
    });
  }

  /**
   * Handle category selection
   */
  selectCategory(categoryId) {
    console.log('📋 Category selected:', categoryId);
    
    // Visual feedback
    const card = document.querySelector(`.category-card[data-category="${categoryId}"]`);
    if (card) {
      card.classList.add('selected');
      setTimeout(() => card.classList.remove('selected'), 300);
    }

    // Trigger callback
    this.onCategorySelect(categoryId);
  }

  /**
   * Update UI when language changes
   */
  updateLanguage() {
    this.render();
  }

  /**
   * Hide the category selection screen
   */
  hide() {
    const container = document.getElementById(this.containerId);
    if (container) {
      container.style.display = 'none';
    }
  }

  /**
   * Show the category selection screen
   */
  show() {
    const container = document.getElementById(this.containerId);
    if (container) {
      container.style.display = 'block';
      this.render();
    }
  }
}

// Export for use in other files
if (typeof window !== 'undefined') {
  window.CategorySelectionScreen = CategorySelectionScreen;
}
