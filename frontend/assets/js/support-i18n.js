/**
 * Support Chat Internationalization (i18n)
 * Provides Arabic and English translations for the support chat interface
 */

const SupportI18n = {
    // Current language (default: Arabic for Iraqi merchants)
    currentLanguage: 'ar',
    
    // Translation strings
    translations: {
        ar: {
            // Page title and headers
            pageTitle: 'منصة ويز المركزية - الدعم المباشر',
            liveSupport: 'الدعم المباشر',
            realTimeAssistance: 'المساعدة الفورية للعملاء',
            
            // Connection status
            connecting: 'جاري الاتصال...',
            connected: 'متصل',
            disconnected: 'غير متصل',
            reconnecting: 'إعادة الاتصال...',
            reconnect: 'إعادة الاتصال',
            
            // Sessions panel
            activeConversations: 'المحادثات النشطة',
            closedSessions: 'الجلسات المغلقة (آخر ساعتين)',
            noActiveConversations: 'لا توجد محادثات نشطة',
            noActiveConversationsDesc: 'ستظهر المحادثات الجديدة هنا عندما يبدأ العملاء بالدردشة',
            noClosedSessions: 'لا توجد جلسات مغلقة مؤخراً',
            
            // Chat area
            selectConversation: 'اختر محادثة',
            welcomeToSupport: 'مرحباً بك في لوحة الدعم',
            selectConversationDesc: 'اختر محادثة نشطة من الشريط الجانبي لبدء مساعدة العملاء',
            endSession: 'إنهاء الجلسة',
            
            // Chat input
            typeYourMessage: 'اكتب رسالتك...',
            send: 'إرسال',
            
            // Customer info
            driver: 'سائق',
            merchant: 'تاجر',
            customer: 'عميل',
            
            // Time labels
            justNow: 'الآن',
            minutesAgo: 'منذ {0} دقيقة',
            hoursAgo: 'منذ {0} ساعة',
            yesterday: 'أمس',
            
            // Session status
            sessionEnded: 'تم إنهاء الجلسة',
            sessionEndedBy: 'تم الإنهاء بواسطة {0}',
            agent: 'الموظف',
            user: 'المستخدم',
            
            // AI suggestions
            aiSuggestion: 'اقتراح الذكاء الاصطناعي',
            useSuggestion: 'استخدام الاقتراح',
            generatingSuggestion: 'جاري توليد الاقتراح...',
            
            // Errors
            connectionError: 'خطأ في الاتصال',
            sendError: 'فشل إرسال الرسالة',
            tryAgain: 'حاول مرة أخرى',
            
            // Actions
            loading: 'جاري التحميل...',
            refresh: 'تحديث',
            close: 'إغلاق',
            
            // Notifications
            newMessage: 'رسالة جديدة',
            sessionStarted: 'بدأت جلسة جديدة',
            sessionEndedNotif: 'انتهت الجلسة',
            
            // Empty states
            noMessages: 'لا توجد رسائل بعد',
            startConversation: 'ابدأ المحادثة',
            
            // RBAC messages
            readOnlyMode: 'وضع القراءة فقط',
            noWritePermission: 'ليس لديك صلاحية الكتابة',
            
            // Category selection screen
            howCanWeHelp: 'كيف يمكننا مساعدتك اليوم؟',
            selectCategory: 'اختر فئة للحصول على مساعدة أفضل',
            orderManagement: 'إدارة الطلبات',
            orderManagementDesc: 'تتبع الطلبات، حالة التوصيل، وإدارة الطلبات',
            paymentIssues: 'مشاكل الدفع والتحويلات',
            paymentIssuesDesc: 'الدفعات، التحويلات المالية، والفواتير',
            accountIssues: 'مشاكل الحساب وتسجيل الدخول',
            accountIssuesDesc: 'تسجيل الدخول، كلمة المرور، وإعدادات الحساب',
            businessSetup: 'إعدادات المتجر والقائمة',
            businessSetupDesc: 'إعداد المتجر، القائمة، والمنتجات',
            technicalSupport: 'الدعم الفني',
            technicalSupportDesc: 'مشاكل التطبيق، الأخطاء، والمساعدة التقنية',
            humanAgent: 'التحدث مع موظف الدعم',
            humanAgentDesc: 'تواصل مباشر مع فريق الدعم',
            
            // WhizzMe AI Assistant
            whizzMeSuggestion: 'اقتراح WhizzMe',
            whizzMeSuggest: '🤖 اقتراح WhizzMe',
            useThisResponse: '✓ استخدم هذا الرد',
            regenerate: '🔄 إعادة التوليد',
            dismiss: 'إغلاق',
            reviewBeforeSending: 'اقتراح بالذكاء الاصطناعي • راجع قبل الإرسال',
            generatingSuggestionDots: 'جاري توليد الاقتراح...',
            aiSuggestionError: 'عذراً، حدث خطأ في توليد الاقتراح'
        },
        
        en: {
            // Page title and headers
            pageTitle: 'WizzCentral Platform - Live Support',
            liveSupport: 'Live Support',
            realTimeAssistance: 'Real-time customer assistance',
            
            // Connection status
            connecting: 'Connecting...',
            connected: 'Connected',
            disconnected: 'Disconnected',
            reconnecting: 'Reconnecting...',
            reconnect: 'Reconnect',
            
            // Sessions panel
            activeConversations: 'Active Conversations',
            closedSessions: 'Closed Sessions (Last 2h)',
            noActiveConversations: 'No active conversations',
            noActiveConversationsDesc: 'New conversations will appear here when customers start chatting',
            noClosedSessions: 'No recently closed sessions',
            
            // Chat area
            selectConversation: 'Select a conversation',
            welcomeToSupport: 'Welcome to Support Dashboard',
            selectConversationDesc: 'Select an active conversation from the sidebar to start helping customers',
            endSession: 'End Session',
            
            // Chat input
            typeYourMessage: 'Type your message...',
            send: 'Send',
            
            // Customer info
            driver: 'Driver',
            merchant: 'Merchant',
            customer: 'Customer',
            
            // Time labels
            justNow: 'Just now',
            minutesAgo: '{0} minutes ago',
            hoursAgo: '{0} hours ago',
            yesterday: 'Yesterday',
            
            // Session status
            sessionEnded: 'Session Ended',
            sessionEndedBy: 'Ended by {0}',
            agent: 'Agent',
            user: 'User',
            
            // AI suggestions
            aiSuggestion: 'AI Suggestion',
            useSuggestion: 'Use Suggestion',
            generatingSuggestion: 'Generating suggestion...',
            
            // Errors
            connectionError: 'Connection Error',
            sendError: 'Failed to send message',
            tryAgain: 'Try again',
            
            // Actions
            loading: 'Loading...',
            refresh: 'Refresh',
            close: 'Close',
            
            // Notifications
            newMessage: 'New message',
            sessionStarted: 'New session started',
            sessionEndedNotif: 'Session ended',
            
            // Empty states
            noMessages: 'No messages yet',
            startConversation: 'Start conversation',
            
            // RBAC messages
            readOnlyMode: 'Read-only mode',
            noWritePermission: 'You don\'t have write permission',
            
            // Category selection screen
            howCanWeHelp: 'How can we help you today?',
            selectCategory: 'Select a category to get better assistance',
            orderManagement: 'Order Management',
            orderManagementDesc: 'Track orders, delivery status, and manage orders',
            paymentIssues: 'Payment & Transfers',
            paymentIssuesDesc: 'Payments, money transfers, and invoices',
            accountIssues: 'Account & Login Issues',
            accountIssuesDesc: 'Login, password, and account settings',
            businessSetup: 'Business Setup & Menu',
            businessSetupDesc: 'Store setup, menu, and products',
            technicalSupport: 'Technical Support',
            technicalSupportDesc: 'App issues, errors, and technical help',
            humanAgent: 'Talk to Support Agent',
            humanAgentDesc: 'Direct connection with support team',
            
            // WhizzMe AI Assistant
            whizzMeSuggestion: 'WhizzMe Suggestion',
            whizzMeSuggest: '🤖 WhizzMe Suggest',
            useThisResponse: '✓ Use This Response',
            regenerate: '🔄 Regenerate',
            dismiss: 'Dismiss',
            reviewBeforeSending: 'AI-generated suggestion • Review before sending',
            generatingSuggestionDots: 'Generating suggestion...',
            aiSuggestionError: 'Sorry, an error occurred generating the suggestion'
        }
    },
    
    /**
     * Get translation for a key
     * @param {string} key - Translation key
     * @param {Array} params - Parameters to replace in translation (for {0}, {1}, etc.)
     * @returns {string} Translated text
     */
    t(key, ...params) {
        const lang = this.currentLanguage;
        let text = this.translations[lang]?.[key] || this.translations['en']?.[key] || key;
        
        // Replace parameters
        params.forEach((param, index) => {
            text = text.replace(`{${index}}`, param);
        });
        
        return text;
    },
    
    /**
     * Set current language
     * @param {string} lang - Language code ('ar' or 'en')
     */
    setLanguage(lang) {
        if (this.translations[lang]) {
            this.currentLanguage = lang;
            this.updatePageTexts();
            // Store preference
            try {
                localStorage.setItem('support_language', lang);
            } catch (e) {
                console.warn('Could not store language preference', e);
            }
        }
    },
    
    /**
     * Get current language
     * @returns {string} Current language code
     */
    getLanguage() {
        return this.currentLanguage;
    },
    
    /**
     * Initialize i18n system
     */
    init() {
        // Load saved language preference
        try {
            const savedLang = localStorage.getItem('support_language');
            if (savedLang && this.translations[savedLang]) {
                this.currentLanguage = savedLang;
            }
        } catch (e) {
            console.warn('Could not load language preference', e);
        }
        
        // Update page title
        document.title = this.t('pageTitle');
        
        // Update all translatable elements
        this.updatePageTexts();
        
        // Set HTML dir attribute for RTL support
        document.documentElement.dir = this.currentLanguage === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = this.currentLanguage;
        
        console.log(`✅ Support i18n initialized: Language = ${this.currentLanguage}`);
    },
    
    /**
     * Update all page texts with current language
     */
    updatePageTexts() {
        // Use data-i18n attribute for automatic translation
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = this.t(key);
            }
        });
        
        // Update placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                el.placeholder = this.t(key);
            }
        });
        
        // Update titles/tooltips
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                el.title = this.t(key);
            }
        });
        
        // Set text direction
        document.documentElement.dir = this.currentLanguage === 'ar' ? 'rtl' : 'ltr';
    },
    
    /**
     * Format relative time in current language
     * @param {Date|string} date - Date to format
     * @returns {string} Formatted time string
     */
    formatTime(date) {
        const now = new Date();
        const then = new Date(date);
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) {
            return this.t('justNow');
        } else if (diffMins < 60) {
            return this.t('minutesAgo', diffMins);
        } else if (diffHours < 24) {
            return this.t('hoursAgo', diffHours);
        } else if (diffDays === 1) {
            return this.t('yesterday');
        } else {
            // Return formatted date/time
            return then.toLocaleString(this.currentLanguage === 'ar' ? 'ar-IQ' : 'en-US');
        }
    },
    
    /**
     * Check if current language is RTL
     * @returns {boolean} True if RTL
     */
    isRTL() {
        return this.currentLanguage === 'ar';
    }
};

// Make globally available
if (typeof window !== 'undefined') {
    window.SupportI18n = SupportI18n;
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => SupportI18n.init());
    } else {
        SupportI18n.init();
    }
}
