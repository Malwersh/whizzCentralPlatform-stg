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

    _initializing: null,
    _idToken: null,

    async initialize() {
        if (!window.Auth?.ensureSession) throw new Error('Authentication service is unavailable.');
        const idToken = await window.Auth.ensureSession();
        if (this.isInitialized && this.dynamodbClient && this._idToken === idToken) return this.dynamodbClient;
        if (this._initializing) return this._initializing;
        this._initializing = (async () => {
            if (typeof AWS === 'undefined') throw new Error('AWS SDK not loaded.');
            const cfg = window.WIZZCENTRAL_CONFIG || {};
            if (!cfg.COGNITO_USER_POOL_ID || !cfg.COGNITO_IDENTITY_POOL_ID) throw new Error('Missing Cognito configuration.');
            AWS.config.region = cfg.COGNITO_REGION;
            const provider = `cognito-idp.${cfg.COGNITO_REGION}.amazonaws.com/${cfg.COGNITO_USER_POOL_ID}`;
            const credentials = new AWS.CognitoIdentityCredentials({
                IdentityPoolId: cfg.COGNITO_IDENTITY_POOL_ID, Logins: { [provider]: idToken }
            });
            AWS.config.credentials = credentials;
            await this._ensureCredentials(credentials);
            if (window.Auth.getIdToken() !== idToken) throw new Error('Session changed. Please retry.');
            this.dynamodbClient = new AWS.DynamoDB.DocumentClient({ credentials, convertEmptyValues: true });
            this._idToken = idToken;
            this.isInitialized = true;
            return this.dynamodbClient;
        })();
        try { return await this._initializing; }
        catch (error) { this.reset(); throw error; }
        finally { this._initializing = null; }
    },

    async getDynamoDBClient() { return this.initialize(); },

    async scanAll(TableName) {
        const client = await this.getDynamoDBClient();
        if (!client) throw new Error('Please sign in again.');
        const items = [];
        let key;
        do {
            const page = await client.scan({ TableName, ...(key ? { ExclusiveStartKey: key } : {}) }).promise();
            items.push(...(page.Items || []));
            key = page.LastEvaluatedKey;
        } while (key);
        return items;
    },

    async resolveDriverDocument(value) {
        if (!value) return null;
        const bucket = 'whizzdrivers-documents-staging-699561669180';
        const prefix = `s3://${bucket}/`;
        if (!value.startsWith(prefix)) return /^https:\/\//.test(value) ? value : null;
        const key = value.slice(prefix.length);
        if (!key.startsWith('drivers/') || key.includes('..')) throw new Error('Invalid document path');
        await this.getDynamoDBClient();
        return new AWS.S3().getSignedUrlPromise('getObject', { Bucket: bucket, Key: key, Expires: 300 });
    },

    // Reset initialization state (useful for re-authentication)
    reset() {
        this.dynamodbClient = null;
        this.isInitialized = false;
        this._idToken = null;
    }
};

console.log('AWS utilities loaded successfully');
