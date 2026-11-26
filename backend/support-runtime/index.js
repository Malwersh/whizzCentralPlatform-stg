'use strict';

const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');
const {ApiGatewayManagementApiClient}=require('@aws-sdk/client-apigatewaymanagementapi');
const {CognitoIdentityProviderClient,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {S3Client}=require('@aws-sdk/client-s3');
const {CognitoJwtVerifier}=require('aws-jwt-verify');
const {identities}=require('../../infrastructure/production/wallet-identity-bindings.json');
const {createIdentity}=require('./identity');
const {createSocket}=require('./websocket');
const {createHandler:createAttachments}=require('./attachments');
const {resolveMerchantAccess}=require('./support-merchant-access');

const account='746727375268';
const portal='https://production.dy2cvcjvju3cf.amplifyapp.com';
const env=process.env;
const expected={
    STAGE:'production',AWS_REGION:'us-east-1',SUPPORT_BUCKET_OWNER:account,
    WEBSOCKET_CONNECTIONS_TABLE:'wizz-production-SupportConnections',
    WEBSOCKET_SUBSCRIPTIONS_TABLE:'wizz-production-SupportSubscriptions',
    CHAT_SESSIONS_TABLE:'wizz-production-SupportChatSessions',CHAT_MESSAGES_TABLE:'wizz-production-SupportChatMessages',
    SUPPORT_MESSAGE_RECEIPTS_TABLE:'wizz-production-SupportMessageReceipts',
    SUPPORT_ATTACHMENTS_TABLE:'wizz-production-SupportAttachments',
    SUPPORT_ATTACHMENTS_BUCKET:'wizz-production-support-attachments-'+account+'-us-east-1',
    SUPPORT_BUSINESSES_TABLE:'wizz-production-Merchants',SUPPORT_MEMBERSHIPS_TABLE:'wizz-production-MerchantPlatform',
    SUPPORT_CUSTOMER_ORDERS_TABLE:'wizz-production-Orders',SUPPORT_CUSTOMER_PROFILES_TABLE:'wizz-production-Customers',
    SUPPORT_SETTINGS_TABLE:'wizz-production-PlatformStaff',SUPPORT_LIFECYCLE_TABLE:'wizz-production-AccountDeletion',
    WALLET_NOTIFICATIONS_TABLE:'wizz-production-WalletNotifications',SUPPORT_ALLOWED_ORIGIN:portal,
};
const assertBindings=() => {
    if (Object.entries(expected).some(([k,v])=>env[k]!==v) || !/^[a-z0-9]{10}$/.test(env.SUPPORT_WEBSOCKET_API_ID||'')) {
        throw Error('SUPPORT_PRODUCTION_BINDINGS_REQUIRED');
    }
};
const options={region:'us-east-1',maxAttempts:2};
const db=DynamoDBDocumentClient.from(new DynamoDBClient(options),{marshallOptions:{removeUndefinedValues:true}});
const s3=new S3Client(options);
const cognito=new CognitoIdentityProviderClient(options);
const verifier=(role,tokenUse)=>CognitoJwtVerifier.create({userPoolId:identities[role].poolId,clientId:identities[role].clientId,tokenUse});
const staff=verifier('admin','access');
const mobile=Object.fromEntries(['customer','driver','merchant'].map(role=>[role,{access:verifier(role,'access'),id:verifier(role,'id')}]));
const identity=createIdentity({db,env,verifyStaff:token=>staff.verify(token),
    getStaff:username=>cognito.send(new AdminGetUserCommand({UserPoolId:identities.admin.poolId,Username:username})),
    verifyApp:async(role,token)=>{
        try {return await mobile[role].access.verify(token);} catch {return mobile[role].id.verify(token);}
    }});
const tables={businesses:expected.SUPPORT_BUSINESSES_TABLE,memberships:expected.SUPPORT_MEMBERSHIPS_TABLE,
    settings:expected.SUPPORT_SETTINGS_TABLE,lifecycle:expected.SUPPORT_LIFECYCLE_TABLE};
const merchantAccess=(subject,business)=>resolveMerchantAccess(db,tables,business,subject);
const socket=createSocket({db,env,merchantAccess,management:endpoint=>new ApiGatewayManagementApiClient({...options,endpoint}),...identity});
const attachments=createAttachments({db,s3,env,verify:identity.verifyJwt,authorizeMerchant:merchantAccess,
    authorizePrincipal:async(principal,permission)=>{
        if (!await identity.isCurrent(principal,permission)) throw Object.assign(Error('FORBIDDEN'),{status:403,code:'FORBIDDEN'});
    }});
const jsonHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(statusCode,body)=>({statusCode,headers:jsonHeaders,body:JSON.stringify(body)});

exports.handler=async event=>{
    try {
        assertBindings();
        if(event.requestContext?.stage!=='production')return json(404,{error:'NOT_FOUND'});
        if(event.requestContext?.routeKey)return socket(event);
        if(event.resource==='/support/attachments')return attachments(event);
        if(event.resource==='/support/socket-ticket' && event.httpMethod==='POST'){
            const origin=Object.entries(event.headers??{}).find(([key])=>key.toLowerCase()==='origin')?.[1];
            if(origin && origin!==portal)return json(403,{error:'ORIGIN_FORBIDDEN'});
            if(event.isBase64Encoded || (event.body && event.body!=='{}'))return json(400,{error:'INVALID_REQUEST'});
            return json(200,await identity.createTicket(event));
        }
        return json(404,{error:'NOT_FOUND'});
    } catch(error) {
        return json([400,401,403,409].includes(error.status)?error.status:503,
            {error:/^[A-Z_]+$/.test(error.code??error.message??'')&&error.status?error.code??error.message:'SUPPORT_UNAVAILABLE'});
    }
};
