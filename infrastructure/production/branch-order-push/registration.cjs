'use strict';

const {TransactWriteCommand} = require('@aws-sdk/lib-dynamodb');
const {readPolicy} = require('../../../backend/src/handlers/notification-sound-policy');
const {tables,read,digest,bindingKey,tokenKey,reverseKey,id} = require('./bindings.cjs');
const resource = '/branch-device/push';
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const respond = (statusCode,data) => ({statusCode,headers,body:JSON.stringify(data)});

function createRegistry({db,authorize,policy = () => readPolicy(db,tables.staff),now = Date.now}) {
  return async event => {
    if (event?.requestContext?.stage !== 'production' || event.resource !== resource) return respond(404,{code:'NOT_FOUND'});
    if (event.httpMethod !== 'POST') return respond(405,{code:'METHOD_NOT_ALLOWED'});
    if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body)>10000) return respond(400,{code:'INVALID_DEVICE_REQUEST'});
    let input;
    try { input=JSON.parse(event.body); } catch { return respond(400,{code:'INVALID_DEVICE_REQUEST'}); }
    const fields=['action','businessId','pushToken','platform','soundEnabled','soundReady'];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!fields.includes(k)) ||
        input.action !== 'register_push' || !id(input.businessId) || typeof input.pushToken !== 'string' ||
        !/^[A-Za-z0-9_:.-]{20,4096}$/.test(input.pushToken) || !['android','ios'].includes(input.platform) ||
        typeof input.soundEnabled !== 'boolean' || !Array.isArray(input.soundReady) || input.soundReady.length>30 ||
        input.soundReady.some(value=>typeof value!=='string' || !/^(?:custom_[a-f0-9]{64}|[a-z_]{1,40})$/.test(value))) {
      return respond(400,{code:'INVALID_PUSH_TOKEN'});
    }
    // Installation scope comes from the paired credential, without any staff identity.
    if (Object.keys(event.headers??{}).some(key=>key.toLowerCase()==='x-staff-session')) return respond(400,{code:'INVALID_DEVICE_REQUEST'});
    try {
      const access = await authorize(event,input.businessId,[],true);
      const {actor,deviceId,deviceVersion,deviceExpiresAt} = access;
      if (!access.receptionOnly || !Number.isSafeInteger(deviceVersion) || !Number.isSafeInteger(deviceExpiresAt) ||
          deviceExpiresAt<=Math.floor(now()/1000)) return respond(401,{code:'DEVICE_REVOKED'});
      const key=bindingKey(input.businessId,deviceId), hash=digest(input.pushToken), current=await read(db,tables.platform,key);
      const registration={...tokenKey(deviceId),fcmToken:input.pushToken,subjectId:'BRANCH_DEVICE#'+deviceId,
        env:'production',app:'merchant',platform:input.platform,businessId:input.businessId,branchDeviceId:deviceId,
        branchDeviceVersion:deviceVersion,soundEnabled:input.soundEnabled,soundReady:[...new Set(input.soundReady)],
        ttl:deviceExpiresAt,updatedAt:new Date(now()).toISOString()};
      const binding={...key,businessId:input.businessId,ownerId:actor.ownerId,deviceId,deviceVersion,tokenHash:hash,
        version:(current?.version??0)+1};
      const pointer={...reverseKey(hash),boundDeviceId:deviceId,boundBranchId:input.businessId,deviceVersion,ttl:deviceExpiresAt};
      const sound=await policy();
      await db.send(new TransactWriteCommand({TransactItems:[
        ...actor.guards,
        {Put:{TableName:tables.platform,Item:binding,
          ...(current ? {ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}
            : {ConditionExpression:'attribute_not_exists(sk)'})}},
        {Put:{TableName:tables.registry,Item:registration}},
        {Put:{TableName:tables.registry,Item:pointer}},
      ]}));
      return respond(200,{success:true,notificationPolicy:sound});
    } catch (error) {
      if (error.name==='TransactionCanceledException') return respond(409,{code:'VERSION_OR_STATE_CONFLICT'});
      if ([401,403].includes(error.status) && /^[A-Z_]+$/.test(error.message)) return respond(error.status,{code:error.message});
      return respond(503,{code:'BRANCH_PUSH_UNAVAILABLE'});
    }
  };
}

module.exports={createRegistry,resource};
