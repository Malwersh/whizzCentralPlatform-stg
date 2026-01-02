/**
 * Secure HTML Sanitization Utility
 * Protects against XSS attacks by sanitizing user-generated content
 * Uses DOMPurify for safe HTML rendering
 */

// Import DOMPurify (for browser usage via CDN or bundler)
// Add to HTML: <script src="https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js"></script>

window.SecurityUtils = {
    /**
     * Sanitize HTML content before inserting into DOM
     * @param {string} dirty - Untrusted HTML content
     * @param {object} config - DOMPurify configuration options
     * @returns {string} - Sanitized HTML
     */
    sanitizeHTML(dirty, config = {}) {
        if (typeof DOMPurify === 'undefined') {
            console.error('⚠️ DOMPurify not loaded! Falling back to text-only mode.');
            return this.escapeHTML(dirty);
        }

        const defaultConfig = {
            ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'span', 'div', 'ul', 'ol', 'li'],
            ALLOWED_ATTR: ['href', 'class', 'id', 'style'],
            ALLOW_DATA_ATTR: false,
            ALLOW_UNKNOWN_PROTOCOLS: false,
            SAFE_FOR_JQUERY: true
        };

        const mergedConfig = { ...defaultConfig, ...config };
        return DOMPurify.sanitize(dirty, mergedConfig);
    },

    /**
     * Escape HTML special characters (for text-only content)
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text
     */
    escapeHTML(text) {
        if (typeof text !== 'string') return '';
        
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Safely set text content (no HTML rendering)
     * @param {HTMLElement} element - Target element
     * @param {string} text - Text content
     */
    setTextContent(element, text) {
        if (!element) return;
        element.textContent = text || '';
    },

    /**
     * Safely set HTML content with sanitization
     * @param {HTMLElement} element - Target element
     * @param {string} html - HTML content to sanitize and insert
     */
    setSafeHTML(element, html) {
        if (!element) return;
        element.innerHTML = this.sanitizeHTML(html);
    },

    /**
     * Create DOM elements programmatically (safest approach)
     * @param {string} tag - Element tag name
     * @param {object} props - Element properties (className, textContent, etc.)
     * @param {array} children - Child elements
     * @returns {HTMLElement}
     */
    createElement(tag, props = {}, children = []) {
        const element = document.createElement(tag);
        
        Object.entries(props).forEach(([key, value]) => {
            if (key === 'textContent') {
                element.textContent = value;
            } else if (key === 'className') {
                element.className = value;
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value);
            } else if (key.startsWith('data-')) {
                element.setAttribute(key, value);
            } else {
                element[key] = value;
            }
        });

        children.forEach(child => {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof HTMLElement) {
                element.appendChild(child);
            }
        });

        return element;
    },

    /**
     * Validate and sanitize input values
     * @param {string} input - User input
     * @param {string} type - Input type ('email', 'alphanumeric', 'text')
     * @returns {object} - { isValid: boolean, sanitized: string, error: string }
     */
    validateInput(input, type = 'text') {
        const validators = {
            email: {
                regex: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
                error: 'Invalid email address'
            },
            alphanumeric: {
                regex: /^[a-zA-Z0-9\s\-_]+$/,
                error: 'Only letters, numbers, spaces, hyphens, and underscores allowed'
            },
            phone: {
                regex: /^[0-9\s\-\+\(\)]+$/,
                error: 'Invalid phone number format'
            },
            text: {
                regex: /^[\s\S]*$/,
                error: null
            }
        };

        const validator = validators[type] || validators.text;
        const trimmed = (input || '').trim();
        
        if (!trimmed) {
            return { isValid: false, sanitized: '', error: 'Input cannot be empty' };
        }

        const isValid = validator.regex.test(trimmed);
        const sanitized = this.escapeHTML(trimmed);

        return {
            isValid,
            sanitized,
            error: isValid ? null : validator.error
        };
    },

    /**
     * Prevent XSS in URL parameters
     * @param {string} url - URL to sanitize
     * @returns {string} - Sanitized URL
     */
    sanitizeURL(url) {
        try {
            const urlObj = new URL(url, window.location.origin);
            
            // Only allow http/https protocols
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                console.warn('⚠️ Blocked dangerous URL protocol:', urlObj.protocol);
                return '/';
            }

            return urlObj.toString();
        } catch (error) {
            console.error('⚠️ Invalid URL:', url);
            return '/';
        }
    },

    /**
     * Safe console logging (redact sensitive data in production)
     * @param {string} message - Log message
     * @param {any} data - Data to log
     */
    safeLog(message, data = null) {
        if (process.env.NODE_ENV === 'production') {
            // Don't log in production
            return;
        }

        if (data) {
            // Redact sensitive fields
            const redactedData = this.redactSensitiveData(data);
            console.log(message, redactedData);
        } else {
            console.log(message);
        }
    },

    /**
     * Redact sensitive data from objects
     * @param {any} data - Data to redact
     * @returns {any} - Redacted data
     */
    redactSensitiveData(data) {
        if (!data || typeof data !== 'object') return data;

        const sensitiveKeys = ['password', 'token', 'accessToken', 'idToken', 'refreshToken', 'secret', 'apiKey'];
        const redacted = Array.isArray(data) ? [...data] : { ...data };

        Object.keys(redacted).forEach(key => {
            if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
                redacted[key] = '***REDACTED***';
            } else if (typeof redacted[key] === 'object') {
                redacted[key] = this.redactSensitiveData(redacted[key]);
            }
        });

        return redacted;
    }
};

// Log when security utils are loaded
console.log('🔒 Security Utils loaded');
console.log('✅ XSS Protection available');
console.log('✅ Input validation available');
console.log('✅ Safe HTML rendering available');
