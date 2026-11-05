'use strict';
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand} = require('@aws-sdk/lib-dynamodb');
const {S3Client, PutObjectCommand, GetObjectCommand} = require('@aws-sdk/client-s3');
const {createHash} = require('node:crypto');
const {verifyJwt, merchantAccess} = require('./websocket-connections');
const {principalFromClaims, canReadSession} = require('../utils/support-access');
const files = require('../utils/support-attachments');
const {customerOwnsOrder} = require('../utils/support-customer-order-access');

function createHandler({db, s3, verify = verifyJwt, authorizeMerchant = merchantAccess, env = process.env}) {
    const allowedOrigins = new Set((env.SUPPORT_ALLOWED_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean));
    const response = (statusCode, payload, origin) => ({statusCode, headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        ...(origin && allowedOrigins.has(origin) ? {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Support-User-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'} : {})
    }, body: JSON.stringify(payload)});
    const get = async (TableName, Key) => (await db.send(new GetCommand({TableName, Key, ConsistentRead: true}))).Item;
    async function authorize(principal, sessionId) {
        if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw files.fail('SESSION_REQUIRED');
        const session = await get(env.CHAT_SESSIONS_TABLE, {sessionId});
        if (!canReadSession(principal, session)) throw files.fail('FORBIDDEN', 403);
        if (principal.userType === 'merchant' && !await authorizeMerchant(principal.authSubject, session.businessId || session.merchantId)) throw files.fail('FORBIDDEN', 403);
        if (principal.userType === 'customer' && session.orderId && !await customerOwnsOrder(db, env, principal.authSubject, session.orderId)) throw files.fail('FORBIDDEN', 403);
        return session;
    }
    return async event => {
        const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [k.toLowerCase(), v]));
        const origin = headers.origin;
        try {
            if (origin && !allowedOrigins.has(origin)) throw files.fail('ORIGIN_FORBIDDEN', 403);
            if (event.httpMethod === 'OPTIONS') return response(204, {}, origin);
            if (!['POST', 'GET'].includes(event.httpMethod)) throw files.fail('METHOD_NOT_ALLOWED', 405);
            let principal;
            try {
                const token = String(headers.authorization || '').replace(/^Bearer\s+/i, '');
                principal = principalFromClaims(await verify(token, headers['x-support-user-type']), headers['x-support-user-type']);
            } catch (_) { throw files.fail('UNAUTHORIZED', 401); }
            if (![env.SUPPORT_ATTACHMENTS_TABLE, env.SUPPORT_ATTACHMENTS_BUCKET, env.SUPPORT_BUCKET_OWNER, env.CHAT_SESSIONS_TABLE, env.CHAT_MESSAGES_TABLE].every(Boolean)) throw files.fail('ATTACHMENTS_UNAVAILABLE', 503);
            if (event.httpMethod === 'GET') {
                const {sessionId, attachmentId} = event.queryStringParameters || {};
                await authorize(principal, sessionId);
                const row = await files.getAttachment(db, env.SUPPORT_ATTACHMENTS_TABLE, attachmentId);
                if (row.sessionId !== sessionId || row.status !== 'PUBLISHED') throw files.fail('ATTACHMENT_UNAVAILABLE', 404);
                const saved = await get(env.CHAT_MESSAGES_TABLE, {sessionId, messageKey: row.messageKey});
                if (saved?.attachment?.attachmentId !== attachmentId) throw files.fail('ATTACHMENT_UNAVAILABLE', 404);
                const object = await s3.send(new GetObjectCommand({Bucket: env.SUPPORT_ATTACHMENTS_BUCKET, Key: row.key, ExpectedBucketOwner: env.SUPPORT_BUCKET_OWNER}));
                if (object.ContentLength > files.MAX_BYTES) throw files.fail('ATTACHMENT_INVALID');
                const data = Buffer.from(await object.Body.transformToByteArray());
                if (data.length !== row.size || createHash('sha256').update(data).digest('base64') !== row.checksum) throw files.fail('ATTACHMENT_INVALID');
                return response(200, {attachmentId, contentType: row.contentType, dataBase64: data.toString('base64')}, origin);
            }
            if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 3 * 1024 * 1024) throw files.fail('IMAGE_SIZE_INVALID');
            let input;
            try { input = JSON.parse(event.body); } catch (_) { throw files.fail('INVALID_JSON'); }
            const {sessionId, uploadId, contentType, dataBase64} = input || {};
            const session = await authorize(principal, sessionId);
            if (session.status === 'closed') throw files.fail('SESSION_CLOSED', 409);
            if (!files.ID.test(uploadId || '') || typeof dataBase64 !== 'string' || !dataBase64 || dataBase64.length > 4 * Math.ceil(files.MAX_BYTES / 3)) throw files.fail('IMAGE_INVALID');
            const data = Buffer.from(dataBase64, 'base64');
            if (data.toString('base64') !== dataBase64) throw files.fail('IMAGE_INVALID');
            const meta = files.validateImage(data, contentType);
            const previous = await get(env.SUPPORT_ATTACHMENTS_TABLE, {attachmentId: uploadId});
            if (previous) {
                if (previous.sessionId !== sessionId || previous.subjectId !== principal.authSubject || previous.userType !== principal.userType || previous.checksum !== meta.checksum || previous.contentType !== contentType || !Number.isFinite(previous.ttl) || previous.ttl <= Date.now()/1000) throw files.fail('UPLOAD_ID_CONFLICT', 409);
                if (['UPLOADED','PUBLISHED'].includes(previous.status)) return response(200, files.reference(previous), origin);
            }
            const now = Math.floor(Date.now()/1000);
            const row = {attachmentId: uploadId, sessionId, subjectId: principal.authSubject, userType: principal.userType,
                ...meta, status: 'PENDING', key: 'support-images/' + createHash('sha256').update(sessionId).digest('hex') + '/' + uploadId,
                createdAt: previous?.createdAt || new Date().toISOString(), ttl: now + 86400};
            await db.send(new PutCommand({TableName: env.SUPPORT_ATTACHMENTS_TABLE, Item: row,
                ConditionExpression: previous ? '#s=:pending AND checksum=:hash' : 'attribute_not_exists(attachmentId)',
                ...(previous ? {ExpressionAttributeNames: {'#s':'status'}, ExpressionAttributeValues: {':pending':'PENDING', ':hash':meta.checksum}} : {})}));
            await s3.send(new PutObjectCommand({Bucket: env.SUPPORT_ATTACHMENTS_BUCKET, Key: row.key, ExpectedBucketOwner: env.SUPPORT_BUCKET_OWNER,
                Body: data, ContentType: contentType, ServerSideEncryption: 'AES256', ChecksumSHA256: meta.checksum}));
            const current = await authorize(principal, sessionId);
            if (current.status === 'closed') throw files.fail('SESSION_CLOSED', 409);
            await db.send(new UpdateCommand({TableName: env.SUPPORT_ATTACHMENTS_TABLE, Key: {attachmentId: uploadId},
                UpdateExpression: 'SET #s=:ready', ConditionExpression: '(#s=:pending OR #s=:ready) AND checksum=:hash',
                ExpressionAttributeNames: {'#s':'status'}, ExpressionAttributeValues: {':ready':'UPLOADED', ':pending':'PENDING', ':hash':meta.checksum}}));
            return response(200, files.reference(row), origin);
        } catch (error) {
            if (error.name === 'ConditionalCheckFailedException') return response(409, {error: 'UPLOAD_STATE_CONFLICT'}, origin);
            return response(error.status || 503, {error: error.status ? error.code : 'ATTACHMENTS_UNAVAILABLE'}, origin);
        }
    };
}
const db = DynamoDBDocumentClient.from(new DynamoDBClient({region: process.env.AWS_REGION || 'us-east-1'}));
const s3 = new S3Client({region: process.env.AWS_REGION || 'us-east-1'});
module.exports = {createHandler, handler: createHandler({db, s3})};
