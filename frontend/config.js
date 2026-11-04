// WizzCentral Platform Configuration
window.WIZZCENTRAL_CONFIG = {
    REGIONS_DATA_SOURCE: 'dynamodb',
    SUPPORT_ATTACHMENTS_API_URL: (typeof window !== 'undefined' && window.__SUPPORT_ATTACHMENTS_API_URL__) || 'https://5ytyphpnkc.execute-api.us-east-1.amazonaws.com/staging/support/attachments',
    STAFF_API_BASE_URL: (typeof window !== 'undefined' && window.__STAFF_API_BASE_URL__) || 'https://7oum9md7v6.execute-api.us-east-1.amazonaws.com/staging',
    // API Configuration
    // RegionDashboardAPI Lambda Function URL - Responds on root path without /regions
    API_BASE_URL: (typeof window !== 'undefined' && window.__API_BASE_URL__) || '',
    
    // Push Notification API Gateway Endpoint
    PUSH_NOTIFICATION_API_URL: (typeof window !== 'undefined' && window.__PUSH_NOTIFICATION_API_URL__) || '',

    // AI / whizzAI
    AI_API_ENDPOINT: (typeof window !== 'undefined' && window.__AI_API_ENDPOINT__) || '',

    // Amazon Connect integration (optional; can reuse API_BASE_URL if your backend proxies these)
    AMAZON_CONNECT_API_BASE_URL: (typeof window !== 'undefined' && window.__AMAZON_CONNECT_API_BASE_URL__) || '',
    AMAZON_CONNECT_WS_URL: (typeof window !== 'undefined' && window.__AMAZON_CONNECT_WS_URL__) || '',

    // Frontend Configuration
    APP_NAME: 'WizzCentral Platform',
    APP_VERSION: '1.0.0',
    // Deployment stage for API paths
    STAGE: (typeof window !== 'undefined' && window.__STAGE__) || 'staging',

    // New: default page to land on after a successful login
    // Works for both hosting layouts:
    // - CloudFront: /frontend/pages/...
    // - Amplify: /pages/...
    DEFAULT_POST_LOGIN_PAGE: (() => {
        if (typeof window === 'undefined' || !window.location) return '/pages/dashboard.html';
        const p = String(window.location.pathname || '');
        const base = p.startsWith('/frontend/') ? '/frontend' : '';
        return `${base}/pages/dashboard.html`;
    })(),

    // AWS Cognito Configuration (WizzCentral User Pool)
    COGNITO_REGION: (typeof window !== 'undefined' && window.__COGNITO_REGION__) || 'us-east-1',
    COGNITO_USER_POOL_ID: (typeof window !== 'undefined' && window.__COGNITO_USER_POOL_ID__) || '',
    COGNITO_CLIENT_ID: (typeof window !== 'undefined' && window.__COGNITO_CLIENT_ID__) || '',
    COGNITO_IDENTITY_POOL_ID: (typeof window !== 'undefined' && window.__COGNITO_IDENTITY_POOL_ID__) || '',

    // WebSocket Configuration for Live Chat
    WEBSOCKET: {
        // Live Chat Support WebSocket URL - Using working SAM deployed WebSocket endpoint
        LIVE_CHAT_URL: (typeof window !== 'undefined' && window.__LIVE_CHAT_WEBSOCKET_URL__) || '',
        PROTOCOLS: ['chat-protocol'],
        HEARTBEAT_INTERVAL: 30000,
        MESSAGE_TIMEOUT: 10000,
        MAX_RECONNECT_ATTEMPTS: 5,
        RECONNECT_DELAY: 1000
    },

    // Feature Flags
    FEATURES: {
        ANALYTICS: true,
        REAL_TIME_TRACKING: true,
        NOTIFICATIONS: true,
        PROMOTIONS: true
    },

    // UI Configuration
    THEME: {
        PRIMARY_COLOR: '#009de0',
        SECONDARY_COLOR: '#6c757d',
        SUCCESS_COLOR: '#28a745',
        WARNING_COLOR: '#ffc107',
        DANGER_COLOR: '#dc3545'
    }
};

function requireNonEmpty(value, name) {
    if (!value || String(value).trim() === '') {
        throw new Error(`Missing required config: ${name}. Set window.__${name}__ (Amplify env injection).`);
    }
}

function assertNoDevEndpoint(value, name) {
    const v = String(value || '');
    if (v.includes('/dev')) {
        throw new Error(`Refusing to use dev endpoint for ${name}: ${v}`);
    }
}

function assertNoProdInStaging(value, name) {
    const stage = String(window.WIZZCENTRAL_CONFIG?.STAGE || 'staging');
    const v = String(value || '');
    if (stage === 'staging' && /\/prod\b/i.test(v)) {
        throw new Error(`Refusing to use prod endpoint for ${name} in staging: ${v}`);
    }
}

// Fail-fast: prevent silent fallback to dev/prod defaults in staging builds
try {
    requireNonEmpty(window.WIZZCENTRAL_CONFIG.API_BASE_URL, 'API_BASE_URL');
    requireNonEmpty(window.WIZZCENTRAL_CONFIG.WEBSOCKET.LIVE_CHAT_URL, 'LIVE_CHAT_WEBSOCKET_URL');
    requireNonEmpty(window.WIZZCENTRAL_CONFIG.AI_API_ENDPOINT, 'AI_API_ENDPOINT');
    requireNonEmpty(window.WIZZCENTRAL_CONFIG.COGNITO_USER_POOL_ID, 'COGNITO_USER_POOL_ID');
    requireNonEmpty(window.WIZZCENTRAL_CONFIG.COGNITO_CLIENT_ID, 'COGNITO_CLIENT_ID');
    requireNonEmpty(window.WIZZCENTRAL_CONFIG.COGNITO_IDENTITY_POOL_ID, 'COGNITO_IDENTITY_POOL_ID');

    assertNoDevEndpoint(window.WIZZCENTRAL_CONFIG.WEBSOCKET.LIVE_CHAT_URL, 'LIVE_CHAT_WEBSOCKET_URL');
    assertNoDevEndpoint(window.WIZZCENTRAL_CONFIG.AI_API_ENDPOINT, 'AI_API_ENDPOINT');
    // API_BASE_URL may be Lambda URL (no stage path). Still disallow explicit /dev.
    assertNoDevEndpoint(window.WIZZCENTRAL_CONFIG.API_BASE_URL, 'API_BASE_URL');

    if (window.WIZZCENTRAL_CONFIG.PUSH_NOTIFICATION_API_URL) {
        assertNoDevEndpoint(window.WIZZCENTRAL_CONFIG.PUSH_NOTIFICATION_API_URL, 'PUSH_NOTIFICATION_API_URL');
        assertNoProdInStaging(window.WIZZCENTRAL_CONFIG.PUSH_NOTIFICATION_API_URL, 'PUSH_NOTIFICATION_API_URL');
    }
} catch (e) {
    console.error('❌ WIZZCENTRAL_CONFIG validation failed:', e);
    // Throw to make misconfiguration obvious in staging
    throw e;
}

// Local development override for serverless-offline or file protocol
if (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // Only for local dev; do not rely on this in staging/prod.
    window.WIZZCENTRAL_CONFIG.API_BASE_URL = `http://${window.location.hostname || 'localhost'}:3000/${window.WIZZCENTRAL_CONFIG.STAGE}`;
}

// Note: For Amplify Hosting, set Environment variable API_BASE_URL to your API Gateway/Lambda URL.
// The build will inject it into window.__API_BASE_URL__ if provided.

// Environment Detection
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.WIZZCENTRAL_CONFIG;
}
