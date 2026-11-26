'use strict';

const {randomUUID} = require('node:crypto');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient} = require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient, AdminGetUserCommand} = require('@aws-sdk/client-cognito-identity-provider');
const {CognitoJwtVerifier} = require('aws-jwt-verify');
const {route} = require('../../backend/staff-service/offers');
const broadcast=require('../../backend/staff-service/campaign-notifications');
const {decodeImage} = require('../../backend/staff-service/home-slide-contract');
const {allowed} = require('./driver-review/catalog');
const {createAssets,campaignImageKey,campaignOwnerPrefix} = require('./customer-home/media.cjs');
const {exact} = require('../../backend/staff-service/dispatch-followup-core');
const {authenticateStaff} = require('./admin-session/live-admin.cjs');
const {identities:{admin}} = require('./wallet-identity-bindings.json');

const path = '/staff/offers';
const staff = 'wizz-production-PlatformStaff';
const campaigns = 'wizz-production-PlatformDiscounts';
const offerTables = {
  sources:{platform:campaigns,campaign:campaigns},
  merchants:'wizz-production-Merchants',regions:'wizz-production-Regions',
  products:'wizz-production-Products',categories:'wizz-production-MenuCategories',
  lock:{platform:'wizz-production-MerchantPlatform',staff,project:true},
};
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply = (statusCode, value) => ({statusCode,headers,body:JSON.stringify(value)});
const validId = value => typeof value==='string' && /^[\w-]{1,150}$/.test(value);

function createHandler({db, apiId, verifyStaff, getStaff, media, now = Date.now}) {
  return async event => {
    if (!apiId || event?.resource !== path || event?.requestContext?.stage !== 'production' ||
        event.requestContext.apiId !== apiId) return reply(404,{error:'NOT_FOUND'});
    const method = event.httpMethod;
    if (!['GET','POST'].includes(method)) return reply(405,{error:'METHOD_NOT_ALLOWED'});
    try {
      const {actor} = await authenticateStaff(event,{verifyStaff,getStaff},db,now,'promotions.read','PERMISSION_REQUIRED');
      const query = event.queryStringParameters ?? {};
      let actionPath = path, input;
      if (method==='GET') {
        if (Object.values(event.multiValueQueryStringParameters ?? {}).some(values => values.length!==1))
          return reply(400,{error:'CAMPAIGN_REQUEST_INVALID'});
        if (Object.keys(query).length) {
          if (Object.keys(query).join(',')!=='merchantId' || !validId(query.merchantId))
            return reply(400,{error:'CAMPAIGN_REQUEST_INVALID'});
          actionPath += '/catalog';
        }
      } else {
        if (Object.keys(query).length || event.isBase64Encoded || typeof event.body!=='string' || Buffer.byteLength(event.body)>4250000)
          return reply(400,{error:'CAMPAIGN_REQUEST_INVALID'});
        try { input=JSON.parse(event.body); } catch { return reply(400,{error:'CAMPAIGN_REQUEST_INVALID'}); }
        if (input?.operation==='upload-image') {
          if (!media || (!allowed(actor,'promotions.create') && !allowed(actor,'promotions.edit')))
            return reply(403,{error:'PERMISSION_REQUIRED'});
          if (Object.keys(input).some(key=>!['operation','image','contentType'].includes(key)))
            return reply(400,{error:'CAMPAIGN_REQUEST_INVALID'});
          let asset;
          try { asset=decodeImage(input); } catch { return reply(400,{error:'CAMPAIGN_IMAGE_INVALID'}); }
          const imageKey=campaignOwnerPrefix(actor.employeeId)+randomUUID()+'.'+asset.extension;
          await media.put(imageKey,asset.body);
          return reply(200,{imageKey,imageUrl:await media.url(imageKey)});
        }
        if (['NOTIFY','NOTIFY_STATUS'].includes(input?.action)) {
          if (Buffer.byteLength(event.body)>1800) return reply(400,{error:'CAMPAIGN_REQUEST_INVALID'});
          const ctx={
            db, now, enrolled:true,broadcast:broadcast.production,
            guard:employee=>exact(staff,{pk:'EMPLOYEE#'+employee.employeeId,sk:'PROFILE'},employee,
              [...new Set([...Object.keys(employee),'roles','minimumAuthTime','deletedAt','deletionRequestId','isDeleted'])]),
            audit:(employeeId,action,before,after,eventId)=>({
              Put:{TableName:staff,Item:{pk:'AUDIT#'+employeeId,sk:'CAMPAIGN_NOTICE#'+randomUUID(),
                action,jobId:eventId,offerId:after.discountId,version:after.version,at:new Date(now()).toISOString()},
              ConditionExpression:'attribute_not_exists(pk)'},
            }),
          };
          return reply(200,await (input.action==='NOTIFY'?broadcast.route:broadcast.status)(ctx,actor,input));
        }
        if (Buffer.byteLength(event.body)>20000 || !input || typeof input!=='object' || Array.isArray(input) || !validId(input.id) ||
            !Object.hasOwn(offerTables.sources,input.source) || !['save','status'].includes(input.operation))
          return reply(400,{error:'CAMPAIGN_REQUEST_INVALID'});
        const statusKeys = ['operation','id','source','baseRevision','status'];
        if (input.operation==='status' && (Object.keys(input).some(key=>!statusKeys.includes(key)) ||
            !['active','paused'].includes(input.status))) return reply(400,{error:'CAMPAIGN_REQUEST_INVALID'});
        if (input.operation==='save' && (Object.hasOwn(input,'imageKey') && input.imageKey!=='' && !campaignImageKey(input.imageKey) ||
            !['percentage','fixed'].includes(input.type) || !['draft','paused','active'].includes(input.status) || input.status==='active' && !input.baseRevision))
          return reply(400,{error:'CAMPAIGN_REQUEST_INVALID'});
        actionPath += '/'+input.operation;
      }
      const result = await route({
        db, offerTables, table:staff, query, campaignImagePrefix:campaignOwnerPrefix,
        assets:{url:async key=>media&&campaignImageKey(key)?media.url(key):'',
          head:async key=>media&&campaignImageKey(key)?media.head(key):null},
        guard:employee=>exact(staff,{pk:'EMPLOYEE#'+employee.employeeId,sk:'PROFILE'},employee,
          [...new Set([...Object.keys(employee),'roles','minimumAuthTime','deletedAt','deletionRequestId','isDeleted'])]),
        audit:(employeeId,action,before,after,eventId)=>({
          Put:{TableName:staff,Item:{pk:'AUDIT#'+employeeId,sk:'OFFER#'+eventId,action,who:employeeId,
            offerId:after.id,beforeStatus:before?.status ?? null,afterStatus:after.status,
            at:new Date(now()).toISOString()},ConditionExpression:'attribute_not_exists(pk)'},
        }),
      },actor,method,actionPath,input);
      return reply(200,result);
    } catch (error) {
      if ([400,401,403,404,409,503].includes(error.status)) return reply(error.status,{error:error.message});
      console.error('Campaign service unavailable',error?.name ?? 'Error');
      return reply(503,{error:'CAMPAIGN_SERVICE_UNAVAILABLE'});
    }
  };
}

const opts = {region:'us-east-1',maxAttempts:2};
const db = DynamoDBDocumentClient.from(new DynamoDBClient(opts),{marshallOptions:{removeUndefinedValues:true}});
const cognito = new CognitoIdentityProviderClient(opts);
const jwt = CognitoJwtVerifier.create({userPoolId:admin.poolId,clientId:admin.clientId,tokenUse:'access'});
const live = createHandler({db,media:createAssets(),apiId:process.env.OFFERS_API_ID,verifyStaff:token=>jwt.verify(token),
  getStaff:Username=>cognito.send(new AdminGetUserCommand({Username,UserPoolId:admin.poolId}))});
module.exports = {createHandler,offerTables,handler:event => process.env.STAGE==='production' &&
  process.env.AWS_REGION==='us-east-1' ? live(event) : reply(503,{error:'CAMPAIGN_SERVICE_UNAVAILABLE'})};
