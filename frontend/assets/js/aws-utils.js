// Centralized AWS Utilities for WizzCentral Platform
console.log('Loading aws-utils.js...');

window.AWSUtils = {
    dynamodbClient: null,
    isInitialized: false,
    _redirectedThisLoad: false,

    // Helper: promisify credentials refresh/get for SDK v2
    async _ensureCredentials(creds) {
        if (!creds) throw new Error('No AWS credentials object');
        // Prefer refresh if available, else get
        const fn = typeof creds.refresh === 'function' ? 'refresh' : (typeof creds.get === 'function' ? 'get' : null);
        if (!fn) return; // Nothing to do
        await new Promise((resolve, reject) => {
            try { creds[fn]((err) => err ? reject(err) : resolve()); }
            catch (e) { reject(e); }
        });
    },

    // Initialize AWS SDK and DynamoDB client (optimized)
    async initialize() {
        if (this.isInitialized && this.dynamodbClient) {
            console.log('AWS already initialized, using cached client');
            return this.dynamodbClient;
        }

        try {
            const startTime = Date.now();
            const debugMode = sessionStorage.getItem('debugMode') === 'true';
            const idToken = localStorage.getItem('idToken');
            const accessToken = localStorage.getItem('accessToken');
            const basicAuth = localStorage.getItem('isAuthenticated') === 'true' && !!localStorage.getItem('userEmail');
            // Allow forcing unauth credentials in debug via sessionStorage or query param
            const debugForceUnauth = debugMode && (
                sessionStorage.getItem('debugForceUnauth') === 'true' ||
                (new URLSearchParams(window.location.search).get('debugForceUnauth') === '1')
            );

            if (typeof AWS === 'undefined') {
                throw new Error('AWS SDK not loaded.');
            }

            // Use configuration from config.js
            const cfg = window.WIZZCENTRAL_CONFIG || {};
            const outputs = {
                "auth": {
                    "user_pool_id": cfg.COGNITO_USER_POOL_ID || "us-east-1_Cp9YnOQWi",
                    "aws_region": cfg.COGNITO_REGION || "us-east-1",
                    "user_pool_client_id": cfg.COGNITO_CLIENT_ID || "5hun8p61grnakisu5gammcjelv",
                    "identity_pool_id": cfg.COGNITO_IDENTITY_POOL_ID || "us-east-1:864073dc-423f-42ae-9b1a-67c1c913b38a",
                    "mfa_methods": [],
                    "standard_required_attributes": ["email"],
                    "username_attributes": ["email"],
                    "user_verification_types": ["email"],
                    "groups": [],
                    "mfa_configuration": "NONE",
                    "password_policy": {
                        "min_length": 8,
                        "require_lowercase": true,
                        "require_numbers": true,
                        "require_symbols": true,
                        "require_uppercase": true
                    },
                    "unauthenticated_identities_enabled": true
                },
                "version": "1.4"
            };
            console.log('Using embedded AWS configuration');

            const region = outputs?.auth?.aws_region || outputs?.data?.aws_region || outputs?.aws_region || 'us-east-1';
            const userPoolId = outputs?.auth?.user_pool_id;
            const identityPoolId = outputs?.auth?.identity_pool_id;
            if (!userPoolId || !identityPoolId) {
                console.error('amplify_outputs.json missing auth IDs', { userPoolId, identityPoolId });
                throw new Error('Invalid amplify_outputs.json (missing Cognito IDs)');
            }
            const cognitoProvider = `cognito-idp.${region}.amazonaws.com/${userPoolId}`;

            AWS.config.region = region;

            // Debug Mode: Allow unauthenticated Cognito identity ONLY if explicitly forced and no idToken
            if (debugMode && debugForceUnauth && !idToken) {
                console.warn('AWSUtils: Debug mode FORCING UNAUTH. Using unauthenticated Cognito Identity.');
                AWS.config.credentials = new AWS.CognitoIdentityCredentials({
                    IdentityPoolId: identityPoolId
                });
                await this._ensureCredentials(AWS.config.credentials);
                console.log('AWS (debug unauth) credentials fetched.');

                this.dynamodbClient = new AWS.DynamoDB.DocumentClient({
                    convertEmptyValues: true,
                    removeUndefinedValues: true
                });
                this.isInitialized = true;
                const duration = Date.now() - startTime;
                console.log(`AWS initialized (debug unauth) in ${duration}ms.`);
                return this.dynamodbClient;
            }

            // If no idToken and not in debug mode, follow original behavior
            if (!idToken) { // changed: only idToken strictly required
                console.log('AWSUtils: missing idToken (accessToken optional)');
                // If app believes user is authenticated (basic flags), do not redirect; let callers handle fallback
                if (basicAuth) {
                    console.log('AWSUtils: basic auth present without idToken; skipping redirect and returning null');
                    return null;
                }
                // Avoid redirects if on login page or loop protection active
                const onLogin = window.location.pathname.endsWith('/index.html');
                const loopBroken = sessionStorage.getItem('redirectLoop:broken') === 'true';
                if (!this._redirectedThisLoad && !onLogin && !loopBroken) {
                    this._redirectedThisLoad = true;
                    try {
                        sessionStorage.setItem('lastRedirectFrom', window.location.pathname + window.location.search);
                        sessionStorage.setItem('lastRedirectReason', 'aws-utils:missing-idToken');
                        sessionStorage.setItem('lastRedirectTime', new Date().toISOString());
                    } catch (e) { }
                    if (window.Auth && window.Auth.redirectToLogin) {
                        window.Auth.redirectToLogin('AWSUtils initialize: missing idToken');
                    }
                } else {
                    console.log('AWSUtils: not redirecting (onLogin=' + onLogin + ', loopBroken=' + loopBroken + ')');
                }
                return null;
            }

            // Validate idToken issuer matches expected provider (skip in debugMode)
            if (!debugMode) {
                try {
                    const payload = JSON.parse(atob(idToken.split('.')[1] || '')) || {};
                    const iss = payload.iss || '';
                    const expectedIssuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
                    if (!iss || (iss !== expectedIssuer && !iss.endsWith(`/${userPoolId}`))) {
                        console.error('AWSUtils: idToken issuer mismatch', { iss, expectedIssuer });
                        sessionStorage.setItem('lastRedirectReason', 'aws-utils:issuer-mismatch');
                        sessionStorage.setItem('lastRedirectTime', new Date().toISOString());
                        const onLogin = window.location.pathname.endsWith('/index.html');
                        const loopBroken = sessionStorage.getItem('redirectLoop:broken') === 'true';
                        if (!this._redirectedThisLoad && !onLogin && !loopBroken) {
                            this._redirectedThisLoad = true;
                            if (window.Auth) {
                                try { Auth.clearTokens(); } catch (_) { }
                                Auth.redirectToLogin('AWSUtils: idToken issuer mismatch');
                            }
                        }
                        return null;
                    }
                } catch (e) {
                    console.warn('AWSUtils: failed to parse idToken for issuer check', e);
                }
            } else {
                console.warn('AWSUtils: Debug mode active. Skipping idToken issuer validation.');
            }

            // Configure AWS
            AWS.config.credentials = new AWS.CognitoIdentityCredentials({
                IdentityPoolId: identityPoolId,
                Logins: {
                    [cognitoProvider]: idToken
                }
            });

            await this._ensureCredentials(AWS.config.credentials);
            console.log('Successfully fetched AWS credentials.');

            this.dynamodbClient = new AWS.DynamoDB.DocumentClient({
                convertEmptyValues: true,
                removeUndefinedValues: true
            });

            this.isInitialized = true;
            console.log('AWS initialized successfully.');
            return this.dynamodbClient;

        } catch (error) {
            console.error('Failed to initialize AWS:', error);
            this.isInitialized = false;
            try {
                sessionStorage.setItem('lastRedirectFrom', window.location.pathname + window.location.search);
                sessionStorage.setItem('lastRedirectReason', `aws-utils:error:${error?.message || 'unknown'}`);
                sessionStorage.setItem('lastRedirectTime', new Date().toISOString());
            } catch (e) { }
            const onLogin = window.location.pathname.endsWith('/index.html');
            const loopBroken = sessionStorage.getItem('redirectLoop:broken') === 'true';
            const basicAuth = localStorage.getItem('isAuthenticated') === 'true' && !!localStorage.getItem('userEmail');
            if (!this._redirectedThisLoad && !onLogin && !loopBroken && !basicAuth) {
                this._redirectedThisLoad = true;
                if (window.Auth && window.Auth.redirectToLogin) {
                    window.Auth.redirectToLogin('AWSUtils initialize error');
                }
            } else {
                console.log('AWSUtils: not redirecting on error (onLogin=' + onLogin + ', loopBroken=' + loopBroken + ', basicAuth=' + basicAuth + ')');
            }
            throw error;
        }
    },

    // Get DynamoDB client (initializes if needed)
    async getDynamoDBClient() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        return this.dynamodbClient;
    },

    // Reset initialization state (useful for re-authentication)
    reset() {
        this.dynamodbClient = null;
        this.isInitialized = false;
    }
};

console.log('AWS utilities loaded successfully');
