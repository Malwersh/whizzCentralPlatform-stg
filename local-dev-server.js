#!/usr/bin/env node
/**
 * WizzCentral Platform - Local Development Server
 * Integrates frontend, backend APIs, and condition engine
 */

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Use specific AWS SDK v3 clients instead of full v2 SDK to avoid conflicts
const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, PutCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// Configure AWS SDK v3 client
const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: process.env.AWS_PROFILE ? undefined : {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const dynamoDB = DynamoDBDocumentClient.from(ddbClient);

// Cache for table key schemas
const tableKeySchemaCache = new Map();

async function getTableKeySchema(tableName) {
    if (tableKeySchemaCache.has(tableName)) return tableKeySchemaCache.get(tableName);
    const cmd = new DescribeTableCommand({ TableName: tableName });
    const res = await ddbClient.send(cmd);
    const ks = res?.Table?.KeySchema || [];
    tableKeySchemaCache.set(tableName, ks);
    return ks;
}

function buildKeyFromItem(item, keySchema) {
    const key = {};
    for (const k of keySchema) {
        const attr = k.AttributeName;
        if (!(attr in item)) {
            throw new Error(`Missing key attribute '${attr}' in item`);
        }
        key[attr] = item[attr];
    }
    return key;
}

// Import condition engine handler
const { handler: conditionEngineHandler } = require('./backend/lambda/condition-engine-api.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Set AWS environment variables for local development
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_PROFILE = process.env.AWS_PROFILE || 'wizz-drivers-ghayth-dev';
process.env.AWS_SDK_LOAD_CONFIG = process.env.AWS_SDK_LOAD_CONFIG || '1';
// Default-disable financial auth in local unless explicitly enabled
process.env.FINANCIAL_AUTH_DISABLED = process.env.FINANCIAL_AUTH_DISABLED || 'true';

console.log('🔧 AWS Configuration:');
console.log(`   Region: ${process.env.AWS_REGION}`);
console.log(`   Profile: ${process.env.AWS_PROFILE}`);
console.log('');

// Add flag to guard debug routes in non-dev environments
const ENABLE_REGIONS_DEBUG = process.env.ENABLE_REGIONS_DEBUG === 'true';

// ============================================
// SECURITY MIDDLEWARE (ADDED)
// ============================================

// Security Headers with Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'", // Allow inline scripts for local dev
                "https://sdk.amazonaws.com",
                "https://cognito-idp.us-east-1.amazonaws.com",
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'", // Allow inline styles for local dev
                "https://fonts.googleapis.com",
                "https://cdnjs.cloudflare.com"
            ],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: [
                "'self'",
                "https://*.amazonaws.com",
                "https://cognito-idp.us-east-1.amazonaws.com",
                "ws://localhost:*",
                "wss://*"
            ],
            fontSrc: [
                "'self'", 
                "data:",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com"
            ],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'", "'unsafe-inline'"], // Allow inline form actions for local dev
            upgradeInsecureRequests: [] // Empty array to disable for local HTTP
        }
    },
    crossOriginEmbedderPolicy: false, // Allow embedding
    hsts: false // Disable HSTS for local development
}));

// Additional Security Headers
app.use((req, res, next) => {
    // Remove upgrade-insecure-requests for local HTTP development
    const csp = res.getHeader('Content-Security-Policy');
    if (csp && typeof csp === 'string') {
        const fixedCsp = csp.replace(/;?upgrade-insecure-requests;?/g, '');
        res.setHeader('Content-Security-Policy', fixedCsp);
    }
    
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

// Rate Limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply rate limiting to API routes
app.use('/api/', apiLimiter);

// Stricter rate limiting for authentication endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 login attempts per windowMs
    message: 'Too many login attempts, please try again later.',
    skipSuccessfulRequests: true,
});

app.use('/api/auth/', authLimiter);

// HTTPS Enforcement (production only)
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https') {
            console.log('⚠️ Redirecting HTTP to HTTPS');
            return res.redirect(301, `https://${req.header('host')}${req.url}`);
        }
        next();
    });
}

console.log('🔒 Security middleware enabled:');
console.log('   ✅ Helmet (Security Headers)');
console.log('   ✅ Rate Limiting (100 req/15min for API)');
console.log('   ✅ Auth Rate Limiting (5 attempts/15min)');
console.log('   ✅ HTTPS Enforcement (production only)');
console.log('');

// ============================================
// MIDDLEWARE SETUP
// ============================================

// Restrict CORS to specific origins
const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [process.env.PRODUCTION_URL || 'https://yourdomain.com']
    : ['http://localhost:3000', 'http://localhost:8080', 'http://localhost:5173'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Legacy path rewrite: /frontend/* -> /* (e.g., /frontend/pages/regions.html -> /pages/regions.html)
app.use((req, res, next) => {
    if (req.path.startsWith('/frontend/')) {
        const target = req.path.replace(/^\/frontend/, '');
        console.log(`🔀 Rewriting legacy path ${req.path} -> ${target}`);
        return res.redirect(target);
    }
    next();
});

// ============================================
// STATIC FILE SERVING
// ============================================
const frontendPath = path.join(__dirname, 'frontend');
console.log(`📂 Serving static files from: ${frontendPath}`);
app.use(express.static(frontendPath));

// Request logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n🔄 [${timestamp}] ${req.method} ${req.path}`);
    if (Object.keys(req.body).length > 0) {
        console.log('📦 Request Body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

// ============================================
// LAMBDA TRANSFORMER MIDDLEWARE
// ============================================

// Map Cognito groups to RBAC roles (fallback for local/dev)
function mapGroupsToRoles(groups = []) {
    const map = new Map([
        ['admins','admin'],
        ['admin','admin'],
        ['financialadmins','financial_admin'],
        ['financial_admin','financial_admin'],
        ['supportadmins','support_admin'],
        ['support_admin','support_admin'],
        ['merchantsadmins','merchants_admin'],
        ['merchants_admin','merchants_admin'],
        ['driversadmins','drivers_admin'],
        ['drivers_admin','drivers_admin'],
        ['customersadmins','customers_admin'],
        ['customers_admin','customers_admin'],
        ['campaignsadmins','campaigns_admin'],
        ['campaigns_admin','campaigns_admin'],
        ['reportingview','reporting_view'],
        ['reporting_view','reporting_view']
    ]);
    const out = new Set();
    for (const g of groups) {
        const key = String(g || '').toLowerCase().replace(/[^a-z_]/g, '');
        out.add(map.get(key) || key); // if already role-like, keep it
    }
    return Array.from(out).filter(Boolean);
}

const lambdaMiddleware = (req, res, next) => {
    // Derive roles/groups from headers for local dev
    const headerRoles = (req.headers['x-user-roles'] || '').split(',').map(s=>s.trim()).filter(Boolean);
    const headerGroups = (req.headers['x-user-groups'] || '').split(',').map(s=>s.trim()).filter(Boolean);
    const rolesFromGroups = mapGroupsToRoles(headerGroups);
    const finalRoles = headerRoles.length ? headerRoles : (rolesFromGroups.length ? rolesFromGroups : ['admin','user','financial_admin']);

    const event = {
        httpMethod: req.method,
        resource: req.route?.path || req.path,
        pathParameters: req.params,
        queryStringParameters: req.query,
        headers: req.headers,
        body: Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : null,
        // Provide fields expected by Lambda Function URL/APIGW v2 style handlers
        path: req.path,
        rawPath: req.path,
        requestContext: {
            requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            http: { method: req.method, path: req.path },
            authorizer: {
                claims: {
                    sub: req.headers['x-user-id'] || req.headers['user-id'] || 'dev-user-123',
                    email: req.headers['x-user-email'] || req.headers['user-email'] || 'dev@wizz.com',
                    'custom:roles': finalRoles.join(','),
                    'cognito:groups': headerGroups.join(','),
                    'custom:businessId': req.headers['x-business-id'] || 'dev-business-123'
                }
            }
        }
    };
    req.lambdaEvent = event;
    next();
};

app.use(lambdaMiddleware);

// Auth / role middleware for financial endpoints
function sendForbidden(req, res, { message, requiredRoles = [], method, path }) {
    const claims = req.lambdaEvent?.requestContext?.authorizer?.claims || {};
    const roles = (claims['custom:roles'] || '').split(',').map(r=>r.trim()).filter(Boolean);
    const email = claims.email || 'unknown';
    const ts = new Date().toISOString();
    console.warn(`[RBAC_FORBIDDEN] ts=${ts} email=${email} method=${method} path=${path} roles=${roles.join(',')} required=${requiredRoles.join(',')} msg=${message}`);
    // Best-effort audit log for denied access (financial table reused; future: dedicated table)
    try {
        const auditItem = {
            auditId: `AUD_DENY_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
            createdAt: Date.now(),
            actionType: 'access_denied',
            entityType: 'rbac',
            entityId: path,
            actorId: claims.sub || 'unknown',
            actorEmail: email,
            roles: roles.join(','),
            requiredRoles,
            method,
            message,
            sourceIp: req.headers['x-forwarded-for'] || req.ip
        };
        dynamoDB.send(new PutCommand({ TableName: FINANCIAL_AUDIT_TABLE, Item: auditItem })).catch(()=>{});
    } catch(e){ /* swallow */ }
    return res.status(403).json({ success:false, error:'forbidden', message, requiredRoles, method, path, roles, email, timestamp: ts });
}

// NEW: Generic RBAC role guard (phase 1) allows separation of read vs write permissions
function roleGuard({ anyOf = [], allowReadOnly = [], writeRequires = [] }) {
    const WRITE_METHODS = new Set(['POST','PATCH','DELETE','PUT']);
    return (req, res, next) => {
        if (process.env.RBAC_DISABLED === 'true') return next();
        try {
            const claims = req.lambdaEvent?.requestContext?.authorizer?.claims || {};
            const roles = (claims['custom:roles'] || '').split(',').map(r=>r.trim()).filter(Boolean);
            const isWrite = WRITE_METHODS.has(req.method.toUpperCase());
            const hasAdmin = roles.includes('admin');
            if (hasAdmin) return next(); // superuser shortcut
            // Combine logic: anyOf can read & write; writeRequires adds extra roles needed for writes; allowReadOnly can only read
            if (isWrite) {
                const canWrite = roles.some(r => anyOf.includes(r) || writeRequires.includes(r));
                if (!canWrite) return sendForbidden(req, res, { message:'Write access denied', requiredRoles:[...new Set([...anyOf, ...writeRequires])], method:req.method, path:req.path });
                return next();
            } else {
                const canRead = roles.some(r => anyOf.includes(r) || allowReadOnly.includes(r) || writeRequires.includes(r));
                if (!canRead) return sendForbidden(req, res, { message:'Read access denied', requiredRoles:[...new Set([...anyOf, ...allowReadOnly])], method:req.method, path:req.path });
                return next();
            }
        } catch (e) {
            return res.status(401).json({ success:false, error:'unauthorized', message:'RBAC evaluation failed' });
        }
    };
}

// FINANCIAL ACCESS GUARD: replaces financialAuth usages (supports reporting_view read-only)
const financialAccessGuard = roleGuard({ anyOf: ['financial_admin'], allowReadOnly: ['reporting_view'] });
// NEW: Domain guards
const campaignsAccessGuard = roleGuard({ anyOf: ['campaigns_admin'], allowReadOnly: ['merchants_admin'] });
const regionsAccessGuard = roleGuard({ anyOf: ['merchants_admin'] });
const ordersAccessGuard = roleGuard({ anyOf: ['support_admin','merchants_admin','drivers_admin'] });
const merchantsAccessGuard = roleGuard({ anyOf: ['merchants_admin','support_admin'] });
const merchantsSearchAccessGuard = roleGuard({ anyOf: ['merchants_admin','support_admin','financial_admin'], allowReadOnly: ['reporting_view'] });

// ============================================
// HELPER FUNCTIONS
// ============================================

const handleLambdaResponse = async (handler, req, res) => {
    try {
        const result = await handler(req.lambdaEvent);
        const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
        
        // Set CORS headers
        Object.keys(result.headers || {}).forEach(key => {
            res.setHeader(key, result.headers[key]);
        });
        
        res.status(result.statusCode).json(body);
    } catch (error) {
        console.error('❌ Lambda Handler Error:', error);
        // Surface AWS credentials issues to the client as 401 for better UX
        if (isAwsCredentialsError(error)) {
            return sendAwsAuthError(res, { route: req.path, method: req.method }, error);
        }
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Helper: Detect AWS credential/auth issues and respond with 401 + guidance
function isAwsCredentialsError(error) {
    const code = error?.name || error?.Code || error?.code;
    const msg = (error?.message || '').toLowerCase();
    const credentialCodes = new Set([
        'UnrecognizedClientException',
        'CredentialsProviderError',
        'ExpiredToken',
        'ExpiredTokenException',
        'AccessDeniedException',
        'AuthFailure',
        'SignatureDoesNotMatch',
        'InvalidSignatureException'
    ]);
    if (code && credentialCodes.has(code)) return true;
    return (
        msg.includes('could not load credentials') ||
        msg.includes('no credentials') ||
        msg.includes('expired') ||
        msg.includes('sso') ||
        msg.includes('not authorized') ||
        msg.includes('access denied')
    );
}

function sendAwsAuthError(res, context, error) {
    const profile = process.env.AWS_PROFILE || 'default';
    const region = process.env.AWS_REGION || 'us-east-1';
    return res.status(401).json({
        success: false,
        error: 'aws-credentials',
        message: 'AWS credentials missing or expired for DynamoDB access',
        context,
        profile,
        region,
        howToFix: `Run: aws sso login --profile ${profile}`,
        source: 'dynamodb-auth',
        details: process.env.NODE_ENV === 'development' ? (error?.message || String(error)) : undefined
    });
}

// Helper: Query commission rules by merchantId with fallback if index missing
async function getCommissionRulesByMerchant(merchantId) {
    let items = [];
    try {
        const q = new QueryCommand({
            TableName: COMMISSIONS_TABLE,
            IndexName: 'merchantId-priority-index',
            KeyConditionExpression: 'merchantId = :m',
            ExpressionAttributeValues: { ':m': merchantId },
            ScanIndexForward: true
        });
        const res = await dynamoDB.send(q);
        items = res.Items || [];
    } catch (err) {
        const msg = (err?.message || '').toLowerCase();
        if (msg.includes('does not have the specified index') || msg.includes('validationexception')) {
            const scan = await dynamoDB.send(new ScanCommand({
                TableName: COMMISSIONS_TABLE,
                FilterExpression: 'merchantId = :m',
                ExpressionAttributeValues: { ':m': merchantId }
            }));
            items = scan.Items || [];
        } else {
            throw err;
        }
    }
    return items;
}

// ============================================
// REAL DYNAMODB DATA ACCESS (AWS SDK v3)
// ============================================

// Table names (matching your existing configuration)
const USERS_TABLE = 'WizzUser_users_dev';
const TRANSACTIONS_TABLE = 'WizzUser_transactions_dev';
const BUSINESSES_TABLE = 'WhizzMerchants_Businesses';
const CONDITIONS_TABLE = 'WizzCentral_Campaign_Conditions';
const CAMPAIGNS_TABLE = 'WizzCentral_Campaigns';
const ORDERS_TABLE = 'WizzOrders_dev';
// Add regions table for regions management (DynamoDB exclusive source)
const REGIONS_TABLE = 'WizzCentral_Regions';
// NEW: Promotions table
const PROMOTIONS_TABLE = 'WizzCentral_Promotions';
// Merchant Discounts table (REAL DATA)
const MERCHANT_DISCOUNTS_TABLE = 'WhizzMerchants_Discounts';

// Financial Management Tables
const COMMISSIONS_TABLE = 'WizzCentral_Commission_Rules';
const DELIVERY_FEES_TABLE = 'WizzCentral_Delivery_Fee_Rules';
const FINANCIAL_TRANSACTIONS_TABLE = 'WizzCentral_Financial_Transactions';
const FINANCIAL_AUDIT_TABLE = 'WizzCentral_Financial_Audit';
const FINANCIAL_SETTINGS_TABLE = 'WizzCentral_Financial_Settings';

// Helpers for encoding/decoding DynamoDB LastEvaluatedKey
function encodeToken(obj) {
    try { return Buffer.from(JSON.stringify(obj || {}), 'utf8').toString('base64'); } catch { return null; }
}
function decodeToken(token) {
    try { return JSON.parse(Buffer.from(String(token), 'base64').toString('utf8')); } catch { return undefined; }
}

// Simple audit logger (best-effort)
async function logAudit({ actionType, entityType, entityId, details = {} }, req) {
    try {
        const actor = req?.lambdaEvent?.requestContext?.authorizer?.claims || {};
        const auditItem = {
            auditId: `AUD_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
            createdAt: Date.now(),
            actionType,
            entityType,
            entityId,
            actorId: actor.sub || 'dev-user-123',
            actorEmail: actor.email || 'dev@wizz.com',
            roles: actor['custom:roles'] || 'admin,user',
            sourceIp: req.headers['x-forwarded-for'] || req.ip,
            details
        };
        await dynamoDB.send(new PutCommand({ TableName: FINANCIAL_AUDIT_TABLE, Item: auditItem }));
    } catch (e) {
        console.warn('⚠️ Audit log failed:', e.message);
    }
}

// Real DynamoDB helper functions (updated for AWS SDK v3)
const getUserFromDynamoDB = async (userId) => {
    try {
        const command = new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId }
        });
        
        const result = await dynamoDB.send(command);
        return result.Item || null;
    } catch (error) {
        console.error('❌ Error fetching user from DynamoDB:', error);
        throw error;
    }
};

const getUserTransactions = async (userId) => {
    try {
        const command = new QueryCommand({
            TableName: TRANSACTIONS_TABLE,
            IndexName: 'userId-index',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': userId
            },
            ScanIndexForward: false, // Latest first
            Limit: 100
        });
        
        const result = await dynamoDB.send(command);
        return result.Items || [];
    } catch (error) {
        console.error('❌ Error fetching transactions from DynamoDB:', error);
        return [];
    }
};

const getCampaignsFromDynamoDB = async () => {
    try {
        const command = new ScanCommand({
            TableName: CAMPAIGNS_TABLE,
            Limit: 50
        });
        
        const result = await dynamoDB.send(command);
        return result.Items || [];
    } catch (error) {
        console.error('❌ Error fetching campaigns from DynamoDB:', error);
        return [];
    }
};

const getBusinessFromDynamoDB = async (businessId) => {
    try {
        const command = new GetCommand({
            TableName: BUSINESSES_TABLE,
            Key: { businessId }
        });
        
        const result = await dynamoDB.send(command);
        return result.Item || null;
    } catch (error) {
        console.error('❌ Error fetching business from DynamoDB:', error);
        return null;
    }
};

const getOrdersFromDynamoDB = async (limit = 50) => {
    try {
        const command = new ScanCommand({
            TableName: ORDERS_TABLE,
            Limit: limit
        });
        
        const result = await dynamoDB.send(command);
        return result.Items || [];
    } catch (error) {
        console.error('❌ Error fetching orders from DynamoDB:', error);
        return [];
    }
};

const getOrderFromDynamoDB = async (orderId) => {
    try {
        // Orders in WizzOrders_dev use PK as the primary key and SK as sort key
        const command = new GetCommand({
            TableName: ORDERS_TABLE,
            Key: { 
                PK: orderId,
                SK: 'META'  // Based on your table structure
            }
        });
        
        console.log(`🔍 Looking up order with PK: ${orderId}, SK: META`);
        const result = await dynamoDB.send(command);
        console.log(`📊 Order lookup result:`, result.Item ? 'Found' : 'Not found');
        
        return result.Item || null;
    } catch (error) {
        console.error('❌ Error fetching order from DynamoDB:', error);
        return null;
    }
};

// NEW: Helper to get all promotions and campaigns
const getPromotionsFromDynamoDB = async () => {
    try {
        const command = new ScanCommand({
            TableName: PROMOTIONS_TABLE,
            Limit: 100 // Fetch up to 100 items
        });
        const result = await dynamoDB.send(command);
        return result.Items || [];
    } catch (error) {
        console.error('❌ Error fetching promotions from DynamoDB:', error);
        if (error.name === 'ResourceNotFoundException') {
            console.warn(`⚠️ Promotions table (${PROMOTIONS_TABLE}) not found. Returning empty array.`);
            return []; // Return empty array if table doesn't exist
        }
        throw error; // Re-throw other errors
    }
};

// NEW: Helper to get merchant discounts from REAL DynamoDB table
const getMerchantDiscountsFromDynamoDB = async () => {
    try {
        console.log(`📊 Fetching merchant discounts from ${MERCHANT_DISCOUNTS_TABLE}...`);
        const command = new ScanCommand({
            TableName: MERCHANT_DISCOUNTS_TABLE,
            Limit: 100
        });
        const result = await dynamoDB.send(command);
        console.log(`✅ Found ${result.Items?.length || 0} merchant discounts in DynamoDB`);
        return result.Items || [];
    } catch (error) {
        console.error('❌ Error fetching merchant discounts from DynamoDB:', error);
        if (error.name === 'ResourceNotFoundException') {
            console.warn(`⚠️ Merchant discounts table (${MERCHANT_DISCOUNTS_TABLE}) not found.`);
            return [];
        }
        throw error;
    }
};

// ============================================
// Condition Engine Routes
// ============================================

app.put('/campaigns/:campaignId/conditions', campaignsAccessGuard, async (req, res) => {
    req.lambdaEvent.pathParameters = { campaignId: req.params.campaignId };
    await handleLambdaResponse(conditionEngineHandler, req, res);
});

app.post('/conditions/test', campaignsAccessGuard, async (req, res) => {
    req.lambdaEvent.resource = '/conditions/test';
    await handleLambdaResponse(conditionEngineHandler, req, res);
});

// ============================================
// PLATFORM API ROUTES
// ============================================

// Public endpoints
app.get('/public', (req, res) => {
    res.json({
        service: 'WizzCentral Platform',
        version: '2.0.0',
        status: 'running',
        environment: 'development',
        timestamp: new Date().toISOString(),
        features: ['condition-engine', 'campaigns', 'analytics', 'live-chat']
    });
});

app.post('/public', (req, res) => {
    res.json({
        message: 'Public data received',
        data: req.body,
        timestamp: new Date().toISOString()
    });
});

// Analytics endpoints - Real data from DynamoDB
app.get('/analytics', async (req, res) => {
    try {
        // Get real campaign count
        const campaigns = await getCampaignsFromDynamoDB();
        const activeCampaigns = campaigns.filter(c => c.status === 'active').length;
        const completedCampaigns = campaigns.filter(c => c.status === 'completed').length;
        
        // Get user count (sample scan)
        const userScanCommand = new ScanCommand({
            TableName: USERS_TABLE,
            Select: 'COUNT'
        });
        const userScan = await dynamoDB.send(userScanCommand);
        
        res.json({
            success: true,
            data: {
                campaigns: {
                    active: activeCampaigns,
                    completed: completedCampaigns,
                    total: campaigns.length,
                    pending: campaigns.filter(c => c.status === 'draft').length
                },
                users: {
                    total: userScan.Count || 0,
                    scannedAt: new Date().toISOString()
                },
                conditions: {
                    totalEvaluations: 'real-time-data',
                    successRate: 'calculated-from-logs',
                    avgProcessingTime: 'monitoring-metrics'
                }
            },
            timestamp: new Date().toISOString(),
            source: 'real-dynamodb'
        });
    } catch (error) {
        console.error('❌ Error fetching analytics from DynamoDB:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/analytics', error);
        res.status(500).json({
            error: 'Failed to fetch analytics',
            message: error.message
        });
    }
});

app.post('/analytics', (req, res) => {
    console.log('📊 Analytics Event:', req.body);
    res.json({
        success: true,
        message: 'Analytics event recorded',
        eventId: `evt_${Date.now()}`,
        data: req.body
    });
});

// Campaign endpoints - Real data from DynamoDB
app.get('/campaigns', campaignsAccessGuard, async (req, res) => {
    try {
        const campaigns = await getCampaignsFromDynamoDB();
        
        res.json({
            success: true,
            campaigns: campaigns,
            count: campaigns.length,
            source: 'real-dynamodb',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching campaigns from DynamoDB:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/campaigns', error);
        res.status(500).json({
            error: 'Failed to fetch campaigns',
            message: error.message
        });
    }
});

app.post('/campaigns', campaignsAccessGuard, async (req, res) => {
    try {
        const campaignData = req.body;
        // Basic validation
        if (!campaignData.campaignId || !campaignData.campaignName) {
            return res.status(400).json({ success: false, error: 'bad_request', message: 'campaignId and campaignName are required' });
        }
        
        const command = new PutCommand({
            TableName: CAMPAIGNS_TABLE,
            Item: {
                ...campaignData,
                updatedAt: new Date().toISOString()
            }
        });
        
        await dynamoDB.send(command);
        
        res.status(201).json({ success: true, data: campaignData });
    } catch (error) {
        console.error('❌ Error creating/updating campaign:', error);
        if (isAwsCredentialsError(error)) {
            return sendAwsAuthError(res, { route: '/campaigns', method: 'POST' }, error);
        }
        res.status(500).json({ success: false, error: 'server_error', message: error.message });
    }
});

// NEW: Promotions endpoints to fetch real data
app.get('/api/promotions', async (req, res) => {
    try {
        console.log('📊 Fetching promotions and merchant discounts...');
        
        const [promotions, campaigns, merchantDiscounts] = await Promise.all([
            getPromotionsFromDynamoDB(),
            getCampaignsFromDynamoDB(),
            getMerchantDiscountsFromDynamoDB()
        ]);
        
        console.log(`📊 Results: ${promotions.length} promotions, ${campaigns.length} campaigns, ${merchantDiscounts.length} merchant discounts`);
        
        // Transform merchant discounts to match frontend format
        const transformedDiscounts = merchantDiscounts.map(discount => ({
            promotionId: discount.discountId || discount.id,
            discountCode: discount.title || 'N/A',
            merchantId: discount.businessId || 'N/A',
            merchantName: discount.businessName || 'Unknown Merchant',
            type: discount.type === 'percentage' ? 'Percentage' : 
                  discount.type === 'freeDelivery' ? 'Free Delivery' :
                  discount.type === 'buyXGetY' ? 'Buy X Get Y' : 'Fixed Amount',
            value: discount.value || 0,
            discountCode: discount.title || 'N/A',
            description: discount.description || '',
            minValue: discount.minimum_order_amount || 0,
            status: (discount.status || 'inactive').toUpperCase(),
            usageCount: discount.usage_count || 0,
            usageLimit: discount.usage_limit || null,
            validUntil: discount.valid_to || null,
            applicability: discount.applicability || 'allItems',
            conditionalRule: discount.conditional_rule || null,
            conditionalParameters: discount.conditional_parameters || {}
        }));
        
        res.json({ 
            promotions: transformedDiscounts,
            campaigns: campaigns || [],
            source: 'dynamodb-real',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching promotions data:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/promotions', error);
        res.status(500).json({ 
            error: 'Failed to fetch promotions data', 
            details: error.message 
        });
    }
});

// NEW: Push notification endpoint for discount offers
const { handler: discountPushHandler } = require('./backend/lambda/discount-push-notification.js');

app.post('/api/discounts/:discountId/send-notification', campaignsAccessGuard, async (req, res) => {
    try {
        const { discountId } = req.params;
        console.log(`📱 Sending push notification for discount: ${discountId}`);
        
        // Get discount details from DynamoDB
        const discount = await dynamoDB.send(new GetCommand({
            TableName: MERCHANT_DISCOUNTS_TABLE,
            Key: { discountId }
        }));
        
        if (!discount.Item) {
            return res.status(404).json({
                success: false,
                message: 'Discount not found'
            });
        }
        
        // Prepare Lambda event with discount data and targeting options from request body
        const targetOptions = req.body || {};
        req.lambdaEvent.body = JSON.stringify({
            discountId: discount.Item.discountId || discount.Item.id,
            discountCode: discount.Item.title,
            merchantId: discount.Item.businessId,
            discountType: discount.Item.type,
            discountValue: discount.Item.value,
            description: discount.Item.description,
            validUntil: discount.Item.valid_to,
            minimumOrderValue: discount.Item.minimum_order_amount,
            ...targetOptions // Allow override from request
        });
        
        await handleLambdaResponse(discountPushHandler, req, res);
    } catch (error) {
        console.error('❌ Error sending discount notification:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/discounts/:discountId/send-notification', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send notification',
            error: error.message
        });
    }
});

// Generic push notification endpoint (for custom notifications)
app.post('/api/push-notifications/send', campaignsAccessGuard, async (req, res) => {
    req.lambdaEvent.httpMethod = 'POST';
    req.lambdaEvent.path = '/push-notifications/send';
    await handleLambdaResponse(discountPushHandler, req, res);
});

// NEW: Merchant information notification endpoint
const { handler: merchantInfoNotificationHandler } = require('./backend/lambda/merchant-info-notification.js');

app.post('/api/merchants/send-info-notification', campaignsAccessGuard, async (req, res) => {
    try {
        console.log('📢 Sending information notification to merchants');
        req.lambdaEvent.httpMethod = 'POST';
        req.lambdaEvent.path = '/merchants/send-info-notification';
        await handleLambdaResponse(merchantInfoNotificationHandler, req, res);
    } catch (error) {
        console.error('❌ Error sending merchant info notification:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/merchants/send-info-notification', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send notification',
            error: error.message
        });
    }
});

// Orders endpoints - Real data from DynamoDB
app.get('/orders', ordersAccessGuard, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const orders = await getOrdersFromDynamoDB(limit);
        
        // Transform data to include computed fields
        const transformedOrders = orders.map(order => ({
            ...order,
            orderId: order.PK,
            // Extract order ID from PK (ORDER#uuid format)
            cleanOrderId: order.PK ? order.PK.replace('ORDER#', '') : 'unknown',
            // Format dates
            createdAtFormatted: order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A',
            confirmedAtFormatted: order.confirmedAt ? new Date(order.confirmedAt).toLocaleDateString() : 'N/A',
            // Status determination
            status: order.canceledAt ? 'cancelled' : 
                   order.confirmedAt ? 'confirmed' : 
                   'pending',
            // Customer info
            customer: {
                name: order.customerName || 'Unknown Customer',
                email: order.customerEmail || 'No email'
            }
        }));

        res.json({
            success: true,
            orders: transformedOrders,
            count: transformedOrders.length,
            source: 'real-dynamodb',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching orders from DynamoDB:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/orders', error);
        res.status(500).json({
            error: 'Failed to fetch orders',
            message: error.message
        });
    }
});

app.get('/orders/:orderId', ordersAccessGuard, async (req, res) => {
    try {
        const orderId = req.params.orderId;
        // Add ORDER# prefix if not present
        const fullOrderId = orderId.startsWith('ORDER#') ? orderId : `ORDER#${orderId}`;
        
        const order = await getOrderFromDynamoDB(fullOrderId);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found',
                orderId: orderId
            });
        }

        // Transform the order data
        const transformedOrder = {
            ...order,
            orderId: order.PK,
            cleanOrderId: order.PK ? order.PK.replace('ORDER#', '') : 'unknown',
            createdAtFormatted: order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A',
            // Use actual status from database, fallback to legacy logic only if status missing
            status: order.status || 
                   (order.canceledAt ? 'cancelled' : 
                    order.confirmedAt ? 'confirmed' : 
                    'pending')
        };

        res.json({
            success: true,
            order: transformedOrder,
            source: 'real-dynamodb'
        });
    } catch (error) {
        console.error('❌ Error fetching order:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/orders/:orderId', error);
        res.status(500).json({
            error: 'Failed to fetch order',
            message: error.message
        });
    }
});

// ============================================
// REGIONS API ROUTES (proxy to Lambda handler)
// ============================================
const { handler: regionsHandler } = require('./backend/lambda-regions-api.js');

// List regions (supports server-side pagination and filters)
app.get('/api/regions', regionsAccessGuard, async (req, res) => {
    req.lambdaEvent.httpMethod = 'GET';
    req.lambdaEvent.path = '/api/regions';
    req.lambdaEvent.rawPath = '/api/regions';
    await handleLambdaResponse(regionsHandler, req, res);
});

// Create region
app.post('/api/regions', regionsAccessGuard, async (req, res) => {
    req.lambdaEvent.httpMethod = 'POST';
    req.lambdaEvent.path = '/api/regions';
    req.lambdaEvent.rawPath = '/api/regions';
    await handleLambdaResponse(regionsHandler, req, res);
});

// Get single region
app.get('/api/regions/:id', regionsAccessGuard, async (req, res) => {
    req.lambdaEvent.httpMethod = 'GET';
    req.lambdaEvent.path = `/api/regions/${req.params.id}`;
    req.lambdaEvent.rawPath = req.lambdaEvent.path;
    req.lambdaEvent.pathParameters = { id: req.params.id };
    await handleLambdaResponse(regionsHandler, req, res);
});

// Update region
app.put('/api/regions/:id', regionsAccessGuard, async (req, res) => {
    req.lambdaEvent.httpMethod = 'PUT';
    req.lambdaEvent.path = `/api/regions/${req.params.id}`;
    req.lambdaEvent.rawPath = req.lambdaEvent.path;
    req.lambdaEvent.pathParameters = { id: req.params.id };
    await handleLambdaResponse(regionsHandler, req, res);
});

// Delete region
app.delete('/api/regions/:id', regionsAccessGuard, async (req, res) => {
    req.lambdaEvent.httpMethod = 'DELETE';
    req.lambdaEvent.path = `/api/regions/${req.params.id}`;
    req.lambdaEvent.rawPath = req.lambdaEvent.path;
    req.lambdaEvent.pathParameters = { id: req.params.id };
    await handleLambdaResponse(regionsHandler, req, res);
});

// Toggle region status
app.patch('/api/regions/:id/toggle', regionsAccessGuard, async (req, res) => {
    req.lambdaEvent.httpMethod = 'PATCH';
    req.lambdaEvent.path = `/api/regions/${req.params.id}/toggle`;
    req.lambdaEvent.rawPath = req.lambdaEvent.path;
    req.lambdaEvent.pathParameters = { id: req.params.id };
    await handleLambdaResponse(regionsHandler, req, res);
});

// ============================================
// DEVELOPMENT UTILITIES - Real DynamoDB Data
// ============================================

// Real user data endpoint
app.get('/dev/users/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const user = await getUserFromDynamoDB(userId);
        const transactions = await getUserTransactions(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found in DynamoDB',
                userId: userId
            });
        }
        
        res.json({
            success: true,
            user,
            transactions,
            source: 'real-dynamodb',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching user data:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/dev/users/:userId', error);
        res.status(500).json({
            error: 'Failed to fetch user data',
            message: error.message
        });
    }
});

// List all users (development only - with pagination)
app.get('/dev/users', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const lastKey = req.query.lastKey ? JSON.parse(decodeURIComponent(req.query.lastKey)) : undefined;
        
        const params = {
            TableName: USERS_TABLE,
            Limit: limit
        };
        
        if (lastKey) {
            params.ExclusiveStartKey = lastKey;
        }
        
        const command = new ScanCommand(params);
        const result = await dynamoDB.send(command);
        
        res.json({
            success: true,
            users: result.Items || [],
            count: result.Items?.length || 0,
            lastEvaluatedKey: result.LastEvaluatedKey,
            nextPageUrl: result.LastEvaluatedKey ? 
                `/dev/users?limit=${limit}&lastKey=${encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))}` : 
                null,
            source: 'real-dynamodb'
        });
    } catch (error) {
        console.error('❌ Error listing users:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/dev/users', error);
        res.status(500).json({
            error: 'Failed to list users',
            message: error.message
        });
    }
});

// Get business data
app.get('/dev/businesses/:businessId', async (req, res) => {
    try {
        const business = await getBusinessFromDynamoDB(req.params.businessId);
        
        if (!business) {
            return res.status(404).json({
                success: false,
                message: 'Business not found in DynamoDB',
                businessId: req.params.businessId
            });
        }
        
        res.json({
            success: true,
            business,
            source: 'real-dynamodb'
        });
    } catch (error) {
        console.error('❌ Error fetching business data:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/dev/businesses/:businessId', error);
        res.status(500).json({
            error: 'Failed to fetch business data',
            message: error.message
        });
    }
});

// Get all businesses data
app.get('/businesses', merchantsAccessGuard, async (req, res) => {
    try {
        console.log('📊 Fetching all businesses from WhizzMerchants_Businesses table...');
        
        const command = new ScanCommand({
            TableName: BUSINESSES_TABLE,
            Limit: 100 // Reasonable limit for development
        });
        
        const result = await dynamoDB.send(command);
        const businesses = result.Items || [];
        
        console.log(`✅ Found ${businesses.length} businesses in DynamoDB`);
        
        // Log sample business for debugging
        if (businesses.length > 0) {
            console.log('📋 Sample business:', JSON.stringify(businesses[0], null, 2));
        }
        
        res.json({
            success: true,
            businesses: businesses,
            count: businesses.length,
            source: 'real-dynamodb',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error fetching businesses from DynamoDB:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/businesses', error);
        res.status(500).json({
            error: 'Failed to fetch businesses',
            message: error.message,
            table: BUSINESSES_TABLE
        });
    }
});

// Search merchants/businesses with query parameter
app.get('/api/merchants/search', merchantsSearchAccessGuard, async (req, res) => {
    try {
        const query = req.query.query || '';
        console.log(`🔍 Searching merchants with query: "${query}"`);
        
        // Fetch all businesses from DynamoDB
        const command = new ScanCommand({
            TableName: BUSINESSES_TABLE,
            Limit: 100
        });
        
        const result = await dynamoDB.send(command);
        let merchants = result.Items || [];
        
        // Normalize the data structure and filter based on query
        merchants = merchants.map(m => ({
            id: m.businessId || m.id,
            name: m.businessName || m.name,
            name_ar: m.businessName || m.name_ar, // Arabic name might be in businessName
            email: m.email,
            location: m.address ? `${m.address.street || ''}, ${m.address.district || ''}, ${m.address.city || ''}`.trim() : (m.city || m.location || ''),
            city: m.city,
            district: m.district,
            businessType: m.businessType,
            phoneNumber: m.phoneNumber,
            status: m.status
        }));
        
        // Filter merchants based on query if provided
        if (query && query.length >= 2) {
            const q = query.toLowerCase();
            merchants = merchants.filter(m => {
                const name = (m.name || '').toLowerCase();
                const nameAr = (m.name_ar || '').toLowerCase();
                const email = (m.email || '').toLowerCase();
                const location = (m.location || '').toLowerCase();
                const id = (m.id || '').toLowerCase();
                const city = (m.city || '').toLowerCase();
                const district = (m.district || '').toLowerCase();
                
                return name.includes(q) || nameAr.includes(q) || 
                       email.includes(q) || location.includes(q) || 
                       id.includes(q) || city.includes(q) || district.includes(q);
            });
        }
        
        // Limit results to 50 for performance
        merchants = merchants.slice(0, 50);
        
        console.log(`✅ Found ${merchants.length} matching merchants`);
        
        res.json({
            success: true,
            data: {
                merchants: merchants,
                count: merchants.length,
                query: query
            },
            source: 'real-dynamodb',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error searching merchants:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/merchants/search', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search merchants',
            message: error.message,
            table: BUSINESSES_TABLE
        });
    }
});

// ============================================
// WhizzMe AI Chat API - Production Ready
// ============================================

// WhizzMe Chat endpoint
app.post('/api/whizzme/chat', async (req, res) => {
    try {
        console.log('🤖 WhizzMe Chat Request:', {
            userType: req.body.userType,
            sessionId: req.body.sessionId,
            messageLength: req.body.message?.length,
            category: req.body.metadata?.category
        });

        // Validate request
        if (!req.body.message || !req.body.userType) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: message, userType'
            });
        }

        // Import Bedrock service
        const { getAISuggestion } = require('./backend/src/services/bedrock-agent-service');

        // Prepare context for AI
        const context = {
            sessionId: req.body.sessionId || `session_${Date.now()}`,
            userType: req.body.userType, // 'merchant' or 'customer'
            message: req.body.message,
            conversationHistory: req.body.conversationHistory || [],
            metadata: req.body.metadata || {}
        };

        // Try to get AI suggestion from AWS Bedrock
        let aiResponse = null;
        try {
            aiResponse = await getAISuggestion(context);
        } catch (error) {
            console.warn('⚠️ Bedrock AI unavailable, using fallback:', error.message);
        }

        if (aiResponse && aiResponse.success) {
            return res.json({
                success: true,
                suggestion: aiResponse.suggestion,
                confidence: aiResponse.confidence || 0.8,
                category: req.body.metadata?.category || 'general',
                sessionId: context.sessionId,
                source: 'aws-bedrock'
            });
        } else {
            // Fallback response if AI service fails
            const fallbackResponse = getFallbackWhizzMeResponse(req.body.message, req.body.metadata?.category);
            return res.json({
                success: true,
                suggestion: fallbackResponse,
                confidence: 0.7,
                category: req.body.metadata?.category || 'general',
                sessionId: context.sessionId,
                source: 'fallback',
                note: 'Using knowledge base due to AI service unavailability'
            });
        }

    } catch (error) {
        console.error('❌ WhizzMe Chat Error:', error);
        
        // Return fallback response even on error
        const fallbackResponse = getFallbackWhizzMeResponse(req.body.message, req.body.metadata?.category);
        return res.json({
            success: true,
            suggestion: fallbackResponse,
            confidence: 0.6,
            category: 'general',
            source: 'error-fallback',
            note: 'Fallback response due to unexpected error'
        });
    }
});

// WhizzMe Health Check
app.get('/api/whizzme/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'WhizzMe Chat API',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        endpoints: {
            chat: '/api/whizzme/chat',
            health: '/api/whizzme/health'
        }
    });
});

/**
 * Get fallback WhizzMe response when AI is unavailable
 */
function getFallbackWhizzMeResponse(message, category) {
    const lowerMessage = message.toLowerCase();

    // Category-specific responses
    if (category === 'technical_support' || lowerMessage.includes('crash') || lowerMessage.includes('bug') || lowerMessage.includes('not working')) {
        return "For technical issues, I recommend:\n\n" +
               "1️⃣ Restart the app\n" +
               "2️⃣ Check your internet connection\n" +
               "3️⃣ Update to the latest version\n" +
               "4️⃣ Clear app cache if the problem persists\n\n" +
               "Would you like me to connect you with our technical support team?";
    }

    if (category === 'order_management' || lowerMessage.includes('order')) {
        return "For order-related questions:\n\n" +
               "📋 Check the Orders tab for current status\n" +
               "🔔 Enable push notifications for new orders\n" +
               "💬 Contact customers directly through the app\n" +
               "⏱️ Accept orders within the time limit\n\n" +
               "What specific order question do you have?";
    }

    if (category === 'payment_issues' || lowerMessage.includes('payment') || lowerMessage.includes('payout')) {
        return "For payment inquiries:\n\n" +
               "💰 Payouts are processed weekly\n" +
               "📊 Check your Earnings section for details\n" +
               "🏦 Ensure your bank details are up to date\n" +
               "💳 Payment methods can be updated in Settings\n\n" +
               "What specific payment question do you have?";
    }

    if (category === 'account_issues' || lowerMessage.includes('login') || lowerMessage.includes('password')) {
        return "For account issues:\n\n" +
               "🔐 Use 'Forgot Password' to reset your password\n" +
               "📧 Check your email for verification links\n" +
               "✅ Ensure your account is verified\n" +
               "👤 Update your profile in Settings\n\n" +
               "What account issue are you experiencing?";
    }

    if (category === 'business_setup' || lowerMessage.includes('menu') || lowerMessage.includes('hours')) {
        return "For business setup:\n\n" +
               "📝 Update menu items in Menu Management\n" +
               "🕒 Set store hours in Business Settings\n" +
               "📍 Verify your location for accurate delivery\n" +
               "🏪 Keep your business info current\n\n" +
               "Which setup area needs help?";
    }

    // Generic fallback
    return "I understand you need assistance. Let me help you with that!\n\n" +
           "Could you provide more details about your issue? " +
           "Or would you like me to connect you with a human support agent for personalized assistance?";
}

// ============================================
// End WhizzMe AI API
// ============================================

// Test condition evaluation with real DynamoDB data
app.post('/dev/test-conditions', async (req, res) => {
    try {
        const { userId = 'dev-user-123', conditions, campaignId = 'test-campaign' } = req.body;
        
        // Get real user data from DynamoDB
        const user = await getUserFromDynamoDB(userId);
        const transactions = await getUserTransactions(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found in DynamoDB',
                userId: userId,
                suggestion: 'Try /dev/users to see available users'
            });
        }
        
        const testPayload = {
            campaignId: campaignId,
            userId: userId,
            conditions: conditions || [
                {
                    type: 'userAttribute',
                    field: 'age',
                    operator: 'greaterThan',
                    value: 18
                }
            ],
            orderData: {
                total: 150,
                businessId: 'test-business'
            }
        };

        // Create event for Lambda handler with real data context
        const mockEvent = {
            httpMethod: 'POST',
            resource: '/conditions/evaluate',
            pathParameters: {},
            queryStringParameters: {},
            headers: req.headers,
            body: JSON.stringify(testPayload),
            requestContext: {
                requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                authorizer: {
                    claims: {
                        sub: userId,
                        email: user.email || 'test@wizz.com',
                        'custom:roles': 'admin,user',
                        'custom:businessId': 'dev-business-123'
                    }
                }
            }
        };

        const result = await conditionEngineHandler(mockEvent);
        const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
        
        // Add debug information
        body.debugInfo = {
            realUserData: user,
            transactionCount: transactions.length,
            source: 'real-dynamodb',
            testNote: 'Using real DynamoDB data for condition evaluation'
        };
        
        res.status(result.statusCode).json(body);
    } catch (error) {
        console.error('❌ Test Condition Error:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/dev/test-conditions', error);
        res.status(500).json({ 
            error: 'Test condition evaluation failed',
            message: error.message,
            source: 'real-dynamodb-error'
        });
    }
});

// Redirect for old regions management URLs
app.get('/frontend/regions-management-iraq.html', (req, res) => {
    console.log('📍 Redirecting old regions URL to new location...');
    res.redirect('/pages/regions.html');
});

app.get('/regions-management-iraq.html', (req, res) => {
    console.log('📍 Redirecting old regions URL to new location...');
    res.redirect('/pages/regions.html');
});

// NEW: Backward-compatibility redirect for /frontend/pages/* paths
app.get('/frontend/pages/*', (req, res) => {
    const newPath = req.path.replace(/^\/frontend/, '');
    console.log(`📍 Redirecting legacy path ${req.path} -> ${newPath}`);
    res.redirect(newPath);
});

// Legacy redirect for financial management page
app.get(['/financial-management', '/financial-management.html'], (req, res) => {
    const target = '/pages/financial-management.html';
    console.log(`🔀 Redirecting legacy financial path ${req.path} -> ${target}`);
    res.redirect(302, target);
});

// Health check
app.get('/health', async (req, res) => {
    try {
        // Get region count from DynamoDB for health check
        const scanCommand = new ScanCommand({
            TableName: REGIONS_TABLE,
            Select: 'COUNT'
        });
        
        const result = await dynamoDB.send(scanCommand);
        const regionsCount = result.Count || 0;
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            features: ['condition-engine', 'regions-management', 'real-dynamodb'],
            dataSource: 'dynamodb',
            regionsCount: regionsCount,
            tableName: REGIONS_TABLE
        });
    } catch (error) {
        console.error('❌ Health check error:', error);
        res.status(200).json({
            status: 'healthy-with-warnings',
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            features: ['condition-engine', 'regions-management', 'real-dynamodb'],
            dataSource: 'dynamodb',
            warning: 'Cannot connect to DynamoDB',
            error: error.message
        });
    }
});

// ============================================
// FINANCIAL MANAGEMENT API ROUTES
// ============================================

const FinancialCalculator = require('./backend/services/financial-calculator.js');
const financialCalculator = new FinancialCalculator();

// Get all commission rules (optionally by merchantId)
app.get('/api/commissions', financialAccessGuard, async (req, res) => {
    try {
        const { merchantId } = req.query;
        if (!merchantId) return res.status(400).json({ success: false, error: 'merchantId query param is required' });
        const items = await getCommissionRulesByMerchant(merchantId);
        res.json({ success: true, data: { rules: items } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/commissions', error);
        res.status(500).json({ success: false, error: 'Failed to fetch commission rules', message: error.message });
    }
});

// Create new commission rule (merchant-specific)
app.post('/api/commissions', financialAccessGuard, async (req, res) => {
    try {
        const { merchantId, ruleType, rates, priority = 1, effectiveFrom, effectiveTo, ruleName } = req.body;
        if (!merchantId || !ruleType || !rates) return res.status(400).json({ success: false, error: 'merchantId, ruleType and rates are required' });
        // Basic rate validation
        if (ruleType === 'percentage' || ruleType === 'hybrid') {
            const pct = Number(rates.percentage);
            if (isNaN(pct) || pct < 0 || pct > 100) return res.status(400).json({ success:false, error:'percentage must be between 0 and 100' });
        }
        if (ruleType === 'flat_fee' || ruleType === 'hybrid') {
            const ff = Number(rates.flatFee);
            if (isNaN(ff) || ff < 0) return res.status(400).json({ success:false, error:'flatFee must be >= 0' });
        }
        if (ruleType === 'tiered') {
            const tiers = rates.tiers || [];
            if (!Array.isArray(tiers) || !tiers.length) return res.status(400).json({ success:false, error:'tiered rules require tiers array' });
            for (let i=0;i<tiers.length;i++) {
                const t = tiers[i];
                if (t.minValue < 0 || (t.maxValue!=null && t.maxValue <= t.minValue)) return res.status(400).json({ success:false, error:'Invalid tier range ordering' });
                if (typeof t.percentage !== 'number' || t.percentage < 0 || t.percentage > 100) return res.status(400).json({ success:false, error:'Tier percentage invalid' });
                if (i>0 && t.minValue < tiers[i-1].maxValue) return res.status(400).json({ success:false, error:'Tier overlaps previous tier' });
            }
        }
        const now = Date.now();
        const effFrom = effectiveFrom || now;
        const effTo = effectiveTo || null;
        if (effTo && effTo <= effFrom) return res.status(400).json({ success: false, error: 'effectiveTo must be greater than effectiveFrom' });
        const requestedActive = req.body.isActive;
        const isActiveStr = requestedActive === false || requestedActive === 'false' ? 'false' : 'true';
        const existingItems = await getCommissionRulesByMerchant(merchantId);
        const overlaps = existingItems.filter(r => {
            const rActive = r.isActive === true || r.isActive === 'true';
            if (!rActive) return false;
            const rFrom = r.effectiveFrom || 0;
            const rTo = r.effectiveTo || Number.MAX_SAFE_INTEGER;
            const newFrom = effFrom;
            const newTo = effTo || Number.MAX_SAFE_INTEGER;
            return newFrom <= rTo && rFrom <= newTo;
        });
        if (isActiveStr === 'true' && overlaps.length) return res.status(409).json({ success: false, error: 'Overlapping active commission rule exists for merchant', conflicts: overlaps.map(o => ({ ruleId: o.ruleId, priority: o.priority, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo })) });
        const item = { ruleId: `COMM_${now}_${Math.random().toString(36).slice(2,9)}`, merchantId, ruleName: ruleName || `Commission for ${merchantId}`, ruleType, rates, priority: Number(priority)||1, isActive: isActiveStr, effectiveFrom: effFrom, effectiveTo: effTo, createdAt: now, updatedAt: now };
        await dynamoDB.send(new PutCommand({ TableName: COMMISSIONS_TABLE, Item: item }));
        await logAudit({ actionType: 'create', entityType: 'commission_rule', entityId: item.ruleId, details: { new: item } }, req);
        res.json({ success: true, data: { rule: item } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/commissions', error);
        res.status(500).json({ success: false, error: 'Failed to create commission rule', message: error.message });
    }
});

// Update commission rule
app.patch('/api/commissions/:ruleId', financialAccessGuard, async (req, res) => {
    try {
        const { ruleId } = req.params;
        const updatable = ['ruleName','rates','priority','isActive','effectiveFrom','effectiveTo','ruleType'];
        const getCmd = new GetCommand({ TableName: COMMISSIONS_TABLE, Key: { ruleId } });
        const getRes = await dynamoDB.send(getCmd);
        if (!getRes.Item) return res.status(404).json({ success:false, error:'Rule not found' });
        const existing = getRes.Item;
        const updates = {}; for (const f of updatable) if (f in req.body) updates[f]=req.body[f];
        if (updates.isActive !== undefined) updates.isActive = updates.isActive === false || updates.isActive === 'false' ? 'false' : 'true';
        if (!Object.keys(updates).length) return res.json({ success:true, data:{ rule: existing } });
        const effFrom = updates.effectiveFrom !== undefined ? updates.effectiveFrom : existing.effectiveFrom;
        const effTo = updates.effectiveTo !== undefined ? updates.effectiveTo : existing.effectiveTo;
        if (effTo && effTo <= effFrom) return res.status(400).json({ success:false, error:'effectiveTo must be greater than effectiveFrom' });
        const isActiveStr = updates.isActive !== undefined ? updates.isActive : existing.isActive;
        const otherItems = await getCommissionRulesByMerchant(existing.merchantId);
        const overlaps = otherItems.filter(r => {
            if (r.ruleId === ruleId) return false; const rActive = r.isActive === true || r.isActive === 'true'; if (!rActive) return false;
            const rFrom = r.effectiveFrom || 0; const rTo = r.effectiveTo || Number.MAX_SAFE_INTEGER;
            const newFrom = effFrom || 0; const newTo = effTo || Number.MAX_SAFE_INTEGER;
            return newFrom <= rTo && rFrom <= newTo;
        });
        if (isActiveStr === 'true' && overlaps.length) return res.status(409).json({ success:false, error:'Overlapping active commission rule exists for merchant', conflicts: overlaps.map(o=>({ ruleId:o.ruleId, priority:o.priority, effectiveFrom:o.effectiveFrom, effectiveTo:o.effectiveTo })) });
        const before = existing;
        let UpdateExpression='SET'; const ExpressionAttributeNames={}; const ExpressionAttributeValues={}; let first=true;
        for (const [k,v] of Object.entries(updates)) { UpdateExpression += `${first?' ':', '}#${k} = :${k}`; ExpressionAttributeNames['#'+k]=k; ExpressionAttributeValues[':'+k]=v; first=false; }
        UpdateExpression += ', #updatedAt = :updatedAt'; ExpressionAttributeNames['#updatedAt']='updatedAt'; ExpressionAttributeValues[':updatedAt']=Date.now();
        const updCmd = new UpdateCommand({ TableName: COMMISSIONS_TABLE, Key:{ ruleId }, UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues, ReturnValues:'ALL_NEW' });
        const updRes = await dynamoDB.send(updCmd);
        await logAudit({ actionType:'update', entityType:'commission_rule', entityId:ruleId, details:{ before, after: updRes.Attributes } }, req);
        res.json({ success:true, data:{ rule: updRes.Attributes } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/commissions/:ruleId', error);
        res.status(500).json({ success:false, error:'Failed to update commission rule', message:error.message });
    }
});

// Delete (soft) commission rule
app.delete('/api/commissions/:ruleId', financialAccessGuard, async (req, res) => {
    try {
        const { ruleId } = req.params;
        const getCmd = new GetCommand({ TableName: COMMISSIONS_TABLE, Key: { ruleId } });
        const getRes = await dynamoDB.send(getCmd);
        if (!getRes.Item) return res.status(404).json({ success: false, error: 'Rule not found' });
        const before = getRes.Item;
        const updCmd = new UpdateCommand({
            TableName: COMMISSIONS_TABLE,
            Key: { ruleId },
            UpdateExpression: 'SET #isActive = :f, #deletedAt = :d, #updatedAt = :u',
            ExpressionAttributeNames: { '#isActive': 'isActive', '#deletedAt': 'deletedAt', '#updatedAt': 'updatedAt' },
            ExpressionAttributeValues: { ':f': 'false', ':d': Date.now(), ':u': Date.now() },
            ReturnValues: 'ALL_NEW'
        });
        const updRes = await dynamoDB.send(updCmd);
        await logAudit({ actionType: 'delete', entityType: 'commission_rule', entityId: ruleId, details: { before, after: updRes.Attributes } }, req);
        res.json({ success: true, data: { rule: updRes.Attributes } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/commissions/:ruleId', error);
        res.status(500).json({ success: false, error: 'Failed to delete commission rule', message: error.message });
    }
});

// Calculate commission for an order (merchant-specific)
app.post('/api/commissions/calculate', financialAccessGuard, async (req, res) => {
    try {
        const { orderData } = req.body;
        if (!orderData?.merchantId) return res.status(400).json({ success:false, error:'orderData.merchantId is required' });
        const rules = await getCommissionRulesByMerchant(orderData.merchantId); // legacy merchantType fallback removed
        const calculation = financialCalculator.calculateCommission(orderData, rules);
        if (!calculation.success) return res.status(404).json(calculation);
        const transactionId = `TXN_COMM_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        const transaction = { transactionId, createdAt: Date.now(), transactionType:'commission', orderId: orderData.orderId || `ORDER_${Date.now()}`, merchantId: orderData.merchantId, amount: calculation.commission.commissionAmount, currency:'IQD', appliedRuleId: calculation.appliedRule.ruleId, calculationDetails: calculation.commission };
        await dynamoDB.send(new PutCommand({ TableName: FINANCIAL_TRANSACTIONS_TABLE, Item: transaction }));
        await logAudit({ actionType:'calculate', entityType:'commission', entityId: transaction.transactionId, details:{ orderData, transaction, calculation } }, req);
        res.json({ success:true, data: calculation });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/commissions/calculate', error);
        res.status(500).json({ success:false, error:'Failed to calculate commission', message:error.message });
    }
});

// Create new delivery fee rule (region/service-type based)
app.post('/api/delivery-fees', financialAccessGuard, async (req, res) => {
    try {
        const ruleData = {
            ruleId: `DELIV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ...req.body,
            isActive: req.body.isActive !== undefined ? String(req.body.isActive) : 'true', // store as string for consistency
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        const command = new PutCommand({ TableName: DELIVERY_FEES_TABLE, Item: ruleData });
        await dynamoDB.send(command);
        await logAudit({ actionType: 'create', entityType: 'delivery_fee_rule', entityId: ruleData.ruleId, details: { new: ruleData } }, req);
        res.json({ success: true, data: { rule: ruleData }, message: 'Delivery fee rule created successfully' });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/delivery-fees', error);
        res.status(500).json({ success: false, error: 'Failed to create delivery fee rule', message: error.message });
    }
});

// Get delivery fee rules
app.get('/api/delivery-fees', financialAccessGuard, async (req, res) => {
    try {
        const { regionId, serviceType, limit = '200' } = req.query;
        const max = Math.min(parseInt(limit, 10) || 200, 500);
        const scanCmd = new ScanCommand({ TableName: DELIVERY_FEES_TABLE });
        const scanRes = await dynamoDB.send(scanCmd);
        let items = scanRes.Items || [];
        if (regionId) items = items.filter(r => (r.conditions?.regionId === regionId) || r.regionId === regionId);
        if (serviceType) items = items.filter(r => (r.conditions?.serviceType === serviceType) || r.serviceType === serviceType);
        items = items.slice(0, max);
        res.json({ success: true, data: { rules: items, count: items.length } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/delivery-fees', error);
        res.status(500).json({ success:false, error:'Failed to fetch delivery fee rules', message:error.message });
    }
});

// Update delivery fee rule
app.patch('/api/delivery-fees/:ruleId', financialAccessGuard, async (req, res) => {
    try {
        const { ruleId } = req.params;
        const getCmd = new GetCommand({ TableName: DELIVERY_FEES_TABLE, Key: { ruleId } });
        const getRes = await dynamoDB.send(getCmd);
        if (!getRes.Item) return res.status(404).json({ success:false, error:'Rule not found' });
        const before = getRes.Item;
        const updatable = ['ruleName','rates','priority','isActive','conditions','ruleType'];
        const updates = {};
        for (const f of updatable) if (f in req.body) updates[f] = req.body[f];
        if ('isActive' in updates) updates.isActive = updates.isActive === false || updates.isActive === 'false' ? 'false' : 'true';
        if (Object.keys(updates).length === 0) return res.json({ success:true, data:{ rule: before } });
        let UpdateExpression = 'SET';
        const ExpressionAttributeNames = {}; const ExpressionAttributeValues = {}; let first = true;
        for (const [k,v] of Object.entries(updates)) { UpdateExpression += `${first?' ':', '}#${k} = :${k}`; ExpressionAttributeNames['#'+k]=k; ExpressionAttributeValues[':'+k]=v; first=false; }
        UpdateExpression += ', #updatedAt = :updatedAt'; ExpressionAttributeNames['#updatedAt']='updatedAt'; ExpressionAttributeValues[':updatedAt']=Date.now();
        const updCmd = new UpdateCommand({ TableName: DELIVERY_FEES_TABLE, Key: { ruleId }, UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues, ReturnValues:'ALL_NEW' });
        const updRes = await dynamoDB.send(updCmd);
        await logAudit({ actionType:'update', entityType:'delivery_fee_rule', entityId:ruleId, details:{ before, after: updRes.Attributes } }, req);
        res.json({ success:true, data:{ rule: updRes.Attributes } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/delivery-fees/:ruleId', error);
        res.status(500).json({ success:false, error:'Failed to update delivery fee rule', message:error.message });
    }
});

// Delete (soft) delivery fee rule
app.delete('/api/delivery-fees/:ruleId', financialAccessGuard, async (req, res) => {
    try {
        const { ruleId } = req.params;
        const getCmd = new GetCommand({ TableName: DELIVERY_FEES_TABLE, Key: { ruleId } });
        const getRes = await dynamoDB.send(getCmd);
        if (!getRes.Item) return res.status(404).json({ success:false, error:'Rule not found' });
        const before = getRes.Item;
        const updCmd = new UpdateCommand({ TableName: DELIVERY_FEES_TABLE, Key:{ ruleId }, UpdateExpression:'SET #isActive = :f, #deletedAt = :d, #updatedAt = :u', ExpressionAttributeNames:{ '#isActive':'isActive', '#deletedAt':'deletedAt', '#updatedAt':'updatedAt' }, ExpressionAttributeValues:{ ':f':'false', ':d':Date.now(), ':u':Date.now() }, ReturnValues:'ALL_NEW' });
        const updRes = await dynamoDB.send(updCmd);
        await logAudit({ actionType:'delete', entityType:'delivery_fee_rule', entityId:ruleId, details:{ before, after: updRes.Attributes } }, req);
        res.json({ success:true, data:{ rule: updRes.Attributes } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/delivery-fees/:ruleId', error);
        res.status(500).json({ success:false, error:'Failed to delete delivery fee rule', message:error.message });
    }
});

// Calculate delivery fee (region-based rules)
app.post('/api/delivery-fees/calculate', financialAccessGuard, async (req, res) => {
    try {
        const { orderData } = req.body;
        if (!orderData?.regionId) return res.status(400).json({ success:false, error:'orderData.regionId is required' });
        // naive: scan and pick first active matching rule; future optimize with GSI
        const scanRes = await dynamoDB.send(new ScanCommand({ TableName: DELIVERY_FEES_TABLE }));
        const rules = (scanRes.Items || []).filter(r => (r.isActive === 'true' || r.isActive === true) && (r.regionId === orderData.regionId || r.conditions?.regionId === orderData.regionId));
        if (!rules.length) return res.status(404).json({ success:false, error:'No active delivery fee rule found for region', regionId: orderData.regionId });
        // Simple selection: highest priority (numerically largest) else first
        const selected = rules.sort((a,b) => (b.priority||0) - (a.priority||0))[0];
        const baseFee = selected.rates?.baseFee || selected.baseFee || 0;
        const distanceKm = orderData.distanceKm || 0;
        const perKm = selected.rates?.perKm || selected.perKm || 0;
        const amount = Math.round(baseFee + (distanceKm * perKm));
        const calculation = { ruleId: selected.ruleId, regionId: orderData.regionId, baseFee, distanceKm, perKm, amount, appliedRates: selected.rates || { baseFee, perKm } };
        const transactionId = `TXN_DELIV_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
        const txn = { transactionId, createdAt: Date.now(), transactionType:'delivery_fee', regionId: orderData.regionId, amount, currency:'IQD', appliedRuleId: selected.ruleId, calculationDetails: calculation };
        await dynamoDB.send(new PutCommand({ TableName: FINANCIAL_TRANSACTIONS_TABLE, Item: txn }));
        await logAudit({ actionType:'calculate', entityType:'delivery_fee', entityId:transactionId, details:{ orderData, calculation } }, req);
        res.json({ success:true, data:{ calculation } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/delivery-fees/calculate', error);
        res.status(500).json({ success:false, error:'Failed to calculate delivery fee', message:error.message });
    }
});

// Generate financial report
app.get('/api/financial-reports/:type', financialAccessGuard, async (req, res) => {
    try {
        const { type } = req.params;
        const valid = ['commissions','delivery-fees','summary'];
        if (!valid.includes(type)) return res.status(400).json({ success:false, error:'Invalid report type', allowed: valid });
        // Basic aggregation via scan (optimize later)
        const txnScan = await dynamoDB.send(new ScanCommand({ TableName: FINANCIAL_TRANSACTIONS_TABLE }));
        const txns = txnScan.Items || [];
        let report = {};
        if (type === 'commissions') {
            const commissions = txns.filter(t => t.transactionType === 'commission');
            report = { count: commissions.length, totalAmount: commissions.reduce((s,t)=>s+(t.amount||0),0) };
        } else if (type === 'delivery-fees') {
            const delivs = txns.filter(t => t.transactionType === 'delivery_fee');
            report = { count: delivs.length, totalAmount: delivs.reduce((s,t)=>s+(t.amount||0),0) };
        } else if (type === 'summary') {
            const byType = txns.reduce((acc,t)=>{ acc[t.transactionType] = acc[t.transactionType]||{ count:0, total:0 }; acc[t.transactionType].count++; acc[t.transactionType].total += (t.amount||0); return acc; }, {});
            report = { byType, totalTransactions: txns.length, grandTotal: Object.values(byType).reduce((s,v)=>s+v.total,0) };
        }
        res.json({ success:true, data:{ type, report, generatedAt: Date.now() } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/financial-reports/:type', error);
        res.status(500).json({ success:false, error:'Failed to generate financial report', message:error.message });
    }
});

// Get financial settings (persisted)
app.get('/api/financial-settings', financialAccessGuard, async (req, res) => {
    try {
        const scanRes = await dynamoDB.send(new ScanCommand({ TableName: FINANCIAL_SETTINGS_TABLE }));
        const items = scanRes.Items || [];
        res.json({ success:true, data:{ settings: items }, count: items.length });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/financial-settings', error);
        res.status(500).json({ success:false, error:'Failed to fetch financial settings', message:error.message });
    }
});

// Update financial settings
app.patch('/api/financial-settings', financialAccessGuard, async (req, res) => {
    try {
        const { settingKey, value } = req.body;
        if (!settingKey) return res.status(400).json({ success:false, error:'settingKey is required' });
        const item = { settingKey, value, updatedAt: Date.now() };
        await dynamoDB.send(new PutCommand({ TableName: FINANCIAL_SETTINGS_TABLE, Item: item }));
        await logAudit({ actionType:'update', entityType:'financial_setting', entityId: settingKey, details:{ item } }, req);
        res.json({ success:true, data:{ setting: item } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/financial-settings', error);
        res.status(500).json({ success:false, error:'Failed to update financial setting', message:error.message });
    }
});

// Financial audit query endpoint
app.get('/api/financial-audit', financialAccessGuard, async (req, res) => {
    try {
        const { entityType, actionType, startTime, endTime, limit = '100', token } = req.query;
        const max = Math.min(parseInt(limit,10)||100, 500);
        // Prefer GSIs when filters present, else Scan (limited)
        if (entityType) {
            const cmd = new QueryCommand({
                TableName: FINANCIAL_AUDIT_TABLE,
                IndexName: 'entityType-createdAt-index',
                KeyConditionExpression: 'entityType = :e AND createdAt BETWEEN :s AND :e2',
                ExpressionAttributeValues: { ':e': entityType, ':s': Number(startTime||0), ':e2': Number(endTime||Date.now()) },
                Limit: max,
                ExclusiveStartKey: token ? decodeToken(token) : undefined,
                ScanIndexForward: false
            });
            const out = await dynamoDB.send(cmd);
            return res.json({ success:true, data:{ items: out.Items||[], nextToken: out.LastEvaluatedKey ? encodeToken(out.LastEvaluatedKey) : null } });
        }
        if (actionType) {
            const cmd = new QueryCommand({
                KeyConditionExpression: 'actionType = :a AND createdAt BETWEEN :s AND :e2',
                ExpressionAttributeValues: { ':a': actionType, ':s': Number(startTime||0), ':e2': Number(endTime||Date.now()) },
                Limit: max,
                ExclusiveStartKey: token ? decodeToken(token) : undefined,
                ScanIndexForward: false
            });
            const out = await dynamoDB.send(cmd);
            return res.json({ success:true, data:{ items: out.Items||[], nextToken: out.LastEvaluatedKey ? encodeToken(out.LastEvaluatedKey) : null } });
        }
        // Fallback scan (bounded)
        const scan = await dynamoDB.send(new ScanCommand({ TableName: FINANCIAL_AUDIT_TABLE, Limit: max }));
        res.json({ success:true, data:{ items: scan.Items||[], nextToken: scan.LastEvaluatedKey ? encodeToken(scan.LastEvaluatedKey) : null } });
    } catch (error) {
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/financial-audit', error);
        res.status(500).json({ success:false, error:'Failed to query audit logs', message:error.message });
    }
});

// Current user endpoint
app.get('/api/me', (req,res) => {
    const claims = req.lambdaEvent?.requestContext?.authorizer?.claims || {};
    const roles = (claims['custom:roles'] || '').split(',').map(r=>r.trim()).filter(Boolean);
    res.json({ success:true, data:{ userId: claims.sub, email: claims.email, roles } });
});

// Merchant financials (aggregated KPIs for a merchant over a date range)
app.get('/api/merchant-financials', financialAccessGuard, async (req, res) => {
    try {
        const merchantId = req.query.merchantId;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        if (!merchantId) return res.status(400).json({ success: false, error: 'merchantId is required' });
        const endMs = endDate ? new Date(endDate).getTime() : Date.now();
        const startMs = startDate ? new Date(startDate).getTime() : (endMs - 30 * 24 * 60 * 60 * 1000);
        if (isNaN(startMs) || isNaN(endMs)) return res.status(400).json({ success: false, error: 'Invalid startDate or endDate' });

        const data = await computeMerchantFinancials({ merchantId, startMs, endMs });
        return res.json({ success: true, data });
    } catch (error) {
        console.error('❌ Error building merchant financials:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/merchant-financials', error);
        res.status(500).json({ success: false, error: 'Failed to compute merchant financials', message: error.message });
    }
});

// Region-based financial aggregation endpoint
app.get('/api/region-financials', financialAccessGuard, async (req, res) => {
    try {
        const { regionId, startDate, endDate, limit } = req.query;
        if (!regionId) return res.status(400).json({ success:false, error:'regionId is required' });
        const endMs = endDate ? new Date(endDate).getTime() : Date.now();
        const startMs = startDate ? new Date(startDate).getTime() : (endMs - 30*24*60*60*1000);
        if (isNaN(startMs) || isNaN(endMs)) return res.status(400).json({ success:false, error:'Invalid startDate or endDate' });

        // Fetch region (direct DynamoDB query for performance)
        const regGet = new GetCommand({ TableName: REGIONS_TABLE, Key: { regionId } });
        const regRes = await dynamoDB.send(regGet);
        if (!regRes.Item) return res.status(404).json({ success:false, error:'Region not found' });
        const region = regRes.Item;

        // Fetch merchants (businesses) - bounded scan
        const bizScan = new ScanCommand({ TableName: BUSINESSES_TABLE, Limit: 1000 });
        const bizRes = await dynamoDB.send(bizScan);
        let merchants = bizRes.Items || [];

        // Filter merchants inside polygon
        merchants = merchants.filter(m => {
            const pos = extractMerchantLatLng(m);
            if (!pos) return false; // skip merchants without coordinates
            return pointInPolygonLocal(pos.lat, pos.lng, region.boundary);
        });
        const hardLimit = Math.min(parseInt(limit||'200',10)||200, 500);
        merchants = merchants.slice(0, hardLimit);

        // Pre-fetch orders & transactions once for efficiency
        const ordersCache = await getOrdersFromDynamoDB(5000);
        const txScan = new ScanCommand({ TableName: FINANCIAL_TRANSACTIONS_TABLE });
        const txRes = await dynamoDB.send(txScan);
        const transactionsCache = txRes.Items || [];

        const rows = [];
        for (const m of merchants) {
            try {
                const mf = await computeMerchantFinancials({ merchantId: m.businessId || m.merchantId || m.id, startMs, endMs, ordersCache, transactionsCache });
                rows.push({
                    merchantId: mf.merchantId,
                    name: m.businessName || m.name || m.displayName || 'Unknown',
                    city: m.city || (m.address && m.address.city) || '',
                    district: m.district || (m.address && m.address.district) || '',
                    totals: mf.totals,
                    financial: mf.financial
                });
            } catch (e) {
                console.warn('⚠️ Merchant financial compute failed for', m.businessId || m.id, e.message);
            }
        }

        // Aggregate totals across merchants
        const agg = rows.reduce((acc, r) => {
            acc.totalOrders += r.totals.totalOrders;
            acc.confirmedOrders += r.totals.confirmedOrders;
            acc.canceledOrders += r.totals.canceledOrders;
            acc.returnedOrders += r.totals.returnedOrders;
            acc.grossRevenue += r.financial.grossRevenue;
            acc.commissionCollected += r.financial.commissionCollected;
            acc.deliveryFees += r.financial.deliveryFees;
            acc.netToMerchant += r.financial.netToMerchant;
            return acc;
        }, { totalOrders:0, confirmedOrders:0, canceledOrders:0, returnedOrders:0, grossRevenue:0, commissionCollected:0, deliveryFees:0, netToMerchant:0 });
        const commissionPercent = agg.grossRevenue>0 ? Math.round((agg.commissionCollected/agg.grossRevenue)*10000)/100 : 0;

        res.json({ success:true, data:{
            regionId,
            region: { regionId: regionId, name: region.name, name_ar: region.name_ar, level: region.level },
            period: { startDate: new Date(startMs).toISOString(), endDate: new Date(endMs).toISOString() },
            merchants: rows,
            totals: { 
                totalOrders: agg.totalOrders,
                confirmedOrders: agg.confirmedOrders,
                canceledOrders: agg.canceledOrders,
                returnedOrders: agg.returnedOrders
            },
            financialTotals: {
                grossRevenue: Math.round(agg.grossRevenue*100)/100,
                commissionCollected: Math.round(agg.commissionCollected*100)/100,
                commissionPercent,
                deliveryFees: Math.round(agg.deliveryFees*100)/100,
                netToMerchant: Math.round(agg.netToMerchant*100)/100
            }
        }});
    } catch (error) {
        console.error('❌ Error building region financials:', error);
        if (isAwsCredentialsError(error)) return sendAwsAuthError(res, '/api/region-financials', error);
        res.status(500).json({ success:false, error:'Failed to compute region financials', message:error.message });
    }
});

// ============================================
// FRONTEND STATIC FILE SERVING
// ============================================

// Serve frontend pages
app.use('/pages', express.static(path.join(__dirname, 'frontend/pages')));
app.use('/css', express.static(path.join(__dirname, 'frontend/css')));
app.use('/js', express.static(path.join(__dirname, 'frontend/js')));
app.use('/assets', express.static(path.join(__dirname, 'frontend/assets')));

// Serve main frontend from root
app.use(express.static(path.join(__dirname, 'frontend')));

// Default route - serve main dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

// NEW: Central RBAC matrix + permissions resolver
const RBAC_MATRIX = {
    pages: {
        dashboard: ['financial_admin','support_admin','merchants_admin','drivers_admin','customers_admin','campaigns_admin','reporting_view'],
        drivers: ['drivers_admin','support_admin'],
        customers: ['customers_admin','support_admin'],
        merchants: ['merchants_admin','support_admin'],
        orders: ['support_admin','merchants_admin','drivers_admin'],
        promotions: ['campaigns_admin'],
        regions: ['merchants_admin'],
        financial: ['financial_admin','reporting_view'],
        support: ['support_admin']
    },
    domains: {
        financial: { read: ['financial_admin','reporting_view'], write: ['financial_admin'] },
        campaigns: { read: ['campaigns_admin','merchants_admin'], write: ['campaigns_admin'] },
        regions: { read: ['merchants_admin'], write: ['merchants_admin'] },
        orders: { read: ['support_admin','merchants_admin','drivers_admin'], write: ['support_admin','merchants_admin','drivers_admin'] },
        merchants: { read: ['merchants_admin','support_admin','financial_admin','reporting_view'], write: ['merchants_admin'] },
        drivers: { read: ['drivers_admin','support_admin'], write: ['drivers_admin'] },
        customers: { read: ['customers_admin','support_admin'], write: ['customers_admin'] },
        support: { read: ['support_admin'], write: ['support_admin'] }
    }
};
function resolvePermissionsForRoles(roleList) {
    const roles = new Set(roleList || []);
    if (roles.has('admin')) {
        // Grant everything
        const allPages = Object.keys(RBAC_MATRIX.pages);
        const domains = {};
        Object.keys(RBAC_MATRIX.domains).forEach(k => { domains[k] = { read: true, write: true }; });
        return { roles: Array.from(roles), pages: allPages, domains };
    }
    // Pages allowed
    const pages = Object.entries(RBAC_MATRIX.pages)
        .filter(([_, allowed]) => allowed.some(r => roles.has(r)))
        .map(([p]) => p);
    // Domain permissions
    const domains = {};
    Object.entries(RBAC_MATRIX.domains).forEach(([k, v]) => {
        const canRead = v.read.some(r => roles.has(r));
        const canWrite = v.write.some(r => roles.has(r));
        domains[k] = { read: canRead || canWrite, write: canWrite };
    });
    return { roles: Array.from(roles), pages, domains };
}

// Lightweight cache for permissions by roles string
const PERMISSIONS_CACHE = new Map();
const PERMISSIONS_TTL_MS = 60 * 1000; // 1 minute
function getCachedPermissions(rolesStr) {
    const rec = PERMISSIONS_CACHE.get(rolesStr);
    if (!rec) return null;
    if (Date.now() - rec.t > PERMISSIONS_TTL_MS) { PERMISSIONS_CACHE.delete(rolesStr); return null; }
    return rec.v;
}
function setCachedPermissions(rolesStr, value) { PERMISSIONS_CACHE.set(rolesStr, { v: value, t: Date.now() }); }

// Expose computed permissions for current user (with simple cache)
app.get('/api/permissions', (req, res) => {
    try {
        const claims = req.lambdaEvent?.requestContext?.authorizer?.claims || {};
        const rolesStr = (claims['custom:roles'] || '').split(',').map(r=>r.trim()).filter(Boolean).sort().join(',');
        const cached = getCachedPermissions(rolesStr);
        if (cached) return res.json({ success: true, data: cached, cache: 'hit' });
        const perms = resolvePermissionsForRoles(rolesStr ? rolesStr.split(',') : []);
        setCachedPermissions(rolesStr, perms);
        res.json({ success: true, data: perms, cache: 'miss' });
    } catch (e) {
        res.status(500).json({ success:false, error:'Failed to resolve permissions', message: e.message });
    }
});

// Export RBAC helpers for tests (dev only). Safe as they are pure functions.
module.exports.rbac = { roleGuard, resolvePermissionsForRoles, RBAC_MATRIX };

// ============================================
// START SERVER
// ============================================

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('');
        console.log('🚀 WizzCentral Platform - Development Server Started');
        console.log('===============================================');
        console.log(`🌐 Server running at: http://localhost:${PORT}`);
        console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📊 DynamoDB: Real AWS connection (${process.env.AWS_REGION})`);
        console.log(`📍 Data Source: DynamoDB (${REGIONS_TABLE})`);
        console.log('');
        console.log('🔗 Available Endpoints:');
        console.log(`   Dashboard: http://localhost:${PORT}/`);
        console.log(`   Conditions: http://localhost:${PORT}/pages/conditions.html`);
        console.log(`   Analytics: http://localhost:${PORT}/pages/analytics.html`);
        console.log(`   Regions: http://localhost:${PORT}/pages/regions.html`);
        console.log(`   API Health: http://localhost:${PORT}/health`);
        console.log('');
        console.log('🔄 DynamoDB Integration:');
        console.log(`   ✅ Regions API: Connected to ${REGIONS_TABLE}`);
        console.log(`   ✅ Toggle API: PATCH /api/regions/:id/toggle`);
        console.log(`   ✅ Statistics API: Real-time from DynamoDB`);
        console.log('===============================================');
    });
}

// Export app and RBAC helpers for testing
module.exports.app = app;
module.exports.rbac = Object.assign(
    module.exports.rbac || {},
    { roleGuard, resolvePermissionsForRoles, RBAC_MATRIX, getCachedPermissions, setCachedPermissions }
);