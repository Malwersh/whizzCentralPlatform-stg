'use strict';
const nativeRequire = require;
const factories = {
"merchant-challenge": function(module, exports, require) {
'use strict';
const crypto = require('node:crypto');
const TTL = 180;
const MAX_ATTEMPTS = 3;
const PREFIX = 'OTPREF#';
const PROOF_PREFIX = 'ENROLL_PROOF#';
const digest = (key, pool, subject, id, code) => crypto.createHmac('sha256', key)
  .update(JSON.stringify([pool, subject, id, code])).digest('hex');

function createHandler(deps) {
  return async event => {
    if (!deps.poolId || event.userPoolId !== deps.poolId ||
        (deps.clientId && event.callerContext?.clientId !== deps.clientId)) throw Error('Invalid authentication pool');
    event.response = event.response || {};
    const request = event.request || {};
    const session = request.session || [];
    if (request.userNotFound || !event.userName) {
      if (event.triggerSource === 'DefineAuthChallenge_Authentication') {
        event.response = { issueTokens: false, failAuthentication: true };
        return event;
      }
      throw Error('Unable to authenticate');
    }
    if (event.triggerSource === 'DefineAuthChallenge_Authentication') {
      const last = session.at(-1);
      const validHistory = session.every(x => x.challengeName === 'CUSTOM_CHALLENGE' &&
        typeof x.challengeMetadata === 'string' && (x.challengeMetadata.startsWith(PREFIX) ||
          (deps.proofs && x.challengeMetadata.startsWith(PROOF_PREFIX))));
      const passed = validHistory && last?.challengeResult === true && session.length <= MAX_ATTEMPTS;
      event.response = {issueTokens: Boolean(passed), failAuthentication: !validHistory || (!passed && session.length >= MAX_ATTEMPTS)};
      if (!event.response.issueTokens && !event.response.failAuthentication) event.response.challengeName = 'CUSTOM_CHALLENGE';
      return event;
    }
    const now = deps.now();
    const scope = {poolId: deps.poolId, subject: event.userName};
    const identity = {username:event.userName,sub:request.userAttributes?.sub,phone:request.userAttributes?.phone_number};
    if (deps.proofs && event.triggerSource === 'CreateAuthChallenge_Authentication' &&
        request.userAttributes?.phone_number_verified === 'true' && !session.length) {
      const proof = await deps.proofs.pending(identity);
      if (proof) {
        event.response.publicChallengeParameters = {kind:'verified-phone',expiresAt:String(proof.expiresAt)};
        event.response.privateChallengeParameters = {id:proof.id};
        event.response.challengeMetadata = proof.id;
        return event;
      }
    }
    if (deps.proofs && event.triggerSource === 'VerifyAuthChallengeResponse_Authentication' &&
        typeof request.privateChallengeParameters?.id === 'string' &&
        request.privateChallengeParameters.id.startsWith(PROOF_PREFIX)) {
      event.response.answerCorrect = false;
      if(request.userAttributes?.phone_number_verified !== 'true') return event;
      const config = await deps.config();
      event.response.answerCorrect = await deps.proofs.verify(request.privateChallengeParameters.id,identity,request.challengeAnswer,config.hmacKey);
      return event;
    }
    const valid = row => row && row.poolId === scope.poolId && row.subject === scope.subject &&
      row.expiresAt > now && row.used === false && row.invalid !== true && row.attempts < MAX_ATTEMPTS;
    if (event.triggerSource === 'CreateAuthChallenge_Authentication') {
      const phone = String(request.userAttributes?.phone_number || '');
      if (!/^\+9647\d{9}$/.test(phone)) throw Error('Invalid phone');
      let row;
      if (session.length) {
        const last = session.at(-1);
        if (session.length >= MAX_ATTEMPTS || last.challengeName !== 'CUSTOM_CHALLENGE' ||
            last.challengeResult !== false || !last.challengeMetadata?.startsWith(PREFIX)) throw Error('Challenge unavailable');
        row = await deps.get(last.challengeMetadata);
        if (!valid(row)) throw Error('Challenge unavailable');
      } else {
        const config = await deps.config();
        if (!config.apiKey || !config.hmacKey) throw Error('OTP configuration unavailable');
        const code = deps.code();
        if (!/^\d{6}$/.test(code)) throw Error('Invalid generated code');
        row = {...scope, id: PREFIX + deps.id(), phone, expiresAt: now + TTL, used: false, attempts: 0};
        row.digest = digest(config.hmacKey, scope.poolId, scope.subject, row.id, code);
        await deps.reserve(row, now); // Atomically reserve cooldown, daily cap, and challenge.
        try { await deps.send(phone, code, config.apiKey); }
        catch (_) { await deps.invalidate(row.id, scope); throw Error('Unable to deliver verification code'); }
      }
      event.response.publicChallengeParameters = {phone: phone.slice(0, 4) + '*******' + phone.slice(-3), expiresAt: String(row.expiresAt)};
      event.response.privateChallengeParameters = {id: row.id};
      event.response.challengeMetadata = row.id;
      return event;
    }
    if (event.triggerSource === 'VerifyAuthChallengeResponse_Authentication') {
      event.response.answerCorrect = false;
      const id = request.privateChallengeParameters?.id;
      if (typeof id !== 'string' || !id.startsWith(PREFIX)) return event;
      const row = await deps.get(id);
      if (!valid(row)) return event;
      const answer = String(request.challengeAnswer || '').trim();
      const config = await deps.config();
      if (!config.hmacKey) throw Error('OTP configuration unavailable');
      const expected = Buffer.from(String(row.digest), 'hex');
      const actual = Buffer.from(digest(config.hmacKey, scope.poolId, scope.subject, id, answer), 'hex');
      const correct = /^\d{6}$/.test(answer) && expected.length === 32 && crypto.timingSafeEqual(expected, actual);
      event.response.answerCorrect = await deps.attempt(row, scope, now, correct) && correct;
      return event;
    }
    throw Error('Unsupported authentication trigger');
  };
}
module.exports = {createHandler, digest, TTL, MAX_ATTEMPTS, PREFIX};

},
"runtime": function(module, exports, require) {
'use strict';
const crypto = require('node:crypto');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient, GetCommand, TransactWriteCommand, UpdateCommand} = require('@aws-sdk/lib-dynamodb');
const {SecretsManagerClient, GetSecretValueCommand} = require('@aws-sdk/client-secrets-manager');
const {createHandler, MAX_ATTEMPTS} = require('./merchant-challenge');
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secrets = new SecretsManagerClient({});
const table = process.env.OTP_TABLE;
const {createProofStore}=require('./merchant-login-proof.cjs');
const proofs=createProofStore({db,GetCommand,TransactWriteCommand});
const scopeCondition = 'poolId = :pool AND subject = :subject';
const handler = createHandler({
  poolId: process.env.USER_POOL_ID,
  clientId: process.env.USER_POOL_CLIENT_ID,
  proofs,
  now: () => Math.floor(Date.now() / 1000),
  id: () => crypto.randomUUID(),
  code: () => String(crypto.randomInt(0, 1000000)).padStart(6, '0'),
  async config() {
    if (process.env.ENVIRONMENT !== 'production' || process.env.OTP_ENABLED !== 'true' || !table || !process.env.OTP_SECRET_ARN) {
      throw Error('OTP configuration unavailable');
    }
    const result = await secrets.send(new GetSecretValueCommand({SecretId: process.env.OTP_SECRET_ARN}));
    return JSON.parse(result.SecretString);
  },
  async get(id) {
    return (await db.send(new GetCommand({TableName: table, Key: {id}, ConsistentRead: true}))).Item;
  },
  async reserve(row, now) {
    await db.send(new TransactWriteCommand({TransactItems: [
      {Update: {TableName: table, Key: {id: `COOLDOWN#${row.poolId}#${row.phone}`},
        UpdateExpression: 'SET nextAllowedAt = :next, expiresAt = :ttl',
        ConditionExpression: 'attribute_not_exists(nextAllowedAt) OR nextAllowedAt <= :now',
        ExpressionAttributeValues: {':next': now + 60, ':ttl': now + 86400, ':now': now}}},
      {Update: {TableName: table, Key: {id: `DAILY#${row.poolId}#${Math.floor(now / 86400)}#${row.phone}`},
        UpdateExpression: 'SET expiresAt = :ttl ADD sends :one',
        ConditionExpression: 'attribute_not_exists(sends) OR sends < :limit',
        ExpressionAttributeValues: {':ttl': now + 172800, ':one': 1, ':limit': 10}}},
      {Put: {TableName: table, Item: row, ConditionExpression: 'attribute_not_exists(id)'}},
    ]}));
  },
  async send(phone, code, apiKey) {
    const result = await fetch('https://api.otpiq.com/api/sms', {
      method: 'POST', headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent':'WizzProductionVerification/1.0'},
      body: JSON.stringify({phoneNumber: phone.slice(1), smsType: 'verification',
        provider: 'whatsapp-telegram-sms', verificationCode: code}), signal: AbortSignal.timeout(3500),
    });
    if (!result.ok) throw Error('OTP delivery failed');
  },
  async invalidate(id, scope) {
    await db.send(new UpdateCommand({TableName: table, Key: {id}, UpdateExpression: 'SET invalid = :yes',
      ConditionExpression: scopeCondition,
      ExpressionAttributeValues: {':pool': scope.poolId, ':subject': scope.subject, ':yes': true}}));
  },
  async attempt(row, scope, now, correct) {
    try {
      await db.send(new UpdateCommand({TableName: table, Key: {id: row.id},
        UpdateExpression: correct ? 'SET used = :yes ADD attempts :one' : 'ADD attempts :one',
        ConditionExpression: scopeCondition + ' AND used = :no AND attribute_not_exists(invalid) AND expiresAt > :now AND attempts = :seen AND attempts < :max AND digest = :digest',
        ExpressionAttributeValues: {':pool': scope.poolId, ':subject': scope.subject, ':no': false,
          ':now': now, ':seen': row.attempts, ':max': MAX_ATTEMPTS, ':one': 1, ':digest': row.digest,
          ...(correct ? {':yes': true} : {})}}));
      return true;
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  },
});
exports.handler = async event => {
  if (process.env.ENVIRONMENT !== 'production' || process.env.OTP_ENABLED !== 'true' ||
      process.env.USER_POOL_ID !== 'us-east-1_2sKZ4fGbZ' ||
      process.env.USER_POOL_CLIENT_ID !== '5l8ng11uudg146crop63926svq' ||
      table !== 'wizz-production-MerchantOtpSessions' ||
      !/^arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz\/production\/merchant\/otp-[A-Za-z0-9]{6}$/.test(process.env.OTP_SECRET_ARN||'')) {
    throw Error('OTP configuration unavailable');
  }
  return handler(event);
};

},
"merchant-login-proof.cjs": function(module, exports, require) {
'use strict';
const crypto=require('node:crypto');
const {POOL}=require('./merchant-enrollment.cjs');
const {TABLE,life}=require('./merchant-enrollment-store.cjs');
const PREFIX='ENROLL_PROOF#',PURPOSE='merchant-enrollment-login',TTL=90;
const digest=(key,r,answer)=>crypto.createHmac('sha256',key).update(JSON.stringify([POOL,PURPOSE,r.id,r.subject,r.sub,r.phone,answer])).digest('hex');
function createProofStore({db,GetCommand,TransactWriteCommand,now=()=>Math.floor(Date.now()/1000)}){
 const pointer=subject=>'ENROLL_LOGIN#'+POOL+'#'+subject;
 const read=async id=>(await db.send(new GetCommand({TableName:TABLE,Key:{id},ConsistentRead:true}))).Item;
 const valid=(r,identity)=>r?.poolId===POOL&&r.purpose===PURPOSE&&r.subject===identity.username&&r.sub===identity.sub&&r.phone===identity.phone&&r.used===false&&r.expiresAt>now();
 return {
  async issue(identity,key){
   if(identity.poolId!==POOL||!identity.username||!identity.sub||identity.phoneVerified!==true||!key)throw Error('INVALID_PROOF_IDENTITY');
   const answer=crypto.randomBytes(32).toString('hex'),r={id:PREFIX+crypto.randomUUID(),poolId:POOL,purpose:PURPOSE,subject:identity.username,sub:identity.sub,phone:identity.phone,used:false,expiresAt:now()+TTL};r.digest=digest(key,r,answer);
   await db.send(new TransactWriteCommand({TransactItems:[life(identity.sub),{Put:{TableName:TABLE,Item:r,ConditionExpression:'attribute_not_exists(id)'}},{Put:{TableName:TABLE,Item:{id:pointer(identity.username),proofId:r.id,expiresAt:r.expiresAt}}}]}));
   return {username:identity.username,loginProof:answer,expiresIn:TTL};
  },
  async pending(identity){const p=await read(pointer(identity.username));if(!p||p.expiresAt<=now()||typeof p.proofId!=='string'||!p.proofId.startsWith(PREFIX))return null;const r=await read(p.proofId);return valid(r,identity)?r:null;},
  async verify(id,identity,answer,key){
   if(typeof id!=='string'||!id.startsWith(PREFIX)||typeof answer!=='string'||!/^[a-f0-9]{64}$/.test(answer)||!key)return false;
   const r=await read(id);if(!valid(r,identity))return false;
   const expected=Buffer.from(String(r.digest),'hex'),actual=Buffer.from(digest(key,r,answer),'hex');if(expected.length!==32||!crypto.timingSafeEqual(expected,actual))return false;
   try{await db.send(new TransactWriteCommand({TransactItems:[life(identity.sub),{ConditionCheck:{TableName:TABLE,Key:{id:pointer(identity.username)},ConditionExpression:'proofId = :id AND expiresAt > :now',ExpressionAttributeValues:{':id':r.id,':now':now()}}},{Update:{TableName:TABLE,Key:{id:r.id},UpdateExpression:'SET used = :yes',ConditionExpression:'poolId = :pool AND purpose = :purpose AND subject = :subject AND sub = :sub AND phone = :phone AND digest = :digest AND used = :no AND expiresAt > :now',ExpressionAttributeValues:{':yes':true,':pool':POOL,':purpose':PURPOSE,':subject':identity.username,':sub':identity.sub,':phone':identity.phone,':digest':r.digest,':no':false,':now':now()}}}]}));return true;}catch(e){if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name))return false;throw e;}
  },
 };
}
module.exports={createProofStore,PREFIX};

},
"merchant-enrollment.cjs": function(module, exports, require) {
'use strict';
// Core only: AWS adapter and deployment are deliberately separate acceptance gates.
const crypto=require('node:crypto');
const POOL='us-east-1_2sKZ4fGbZ',PURPOSE='merchant-enrollment',TTL=180,MAX=3;
const fail=code=>{throw Object.assign(Error(code),{code});};
const normalize=value=>{if(typeof value!=='string')fail('INVALID_PHONE');let p=value.trim().replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)>=0x6f0?0x6f0:0x660))).replace(/[\s()-]/g,'');if(/^009647\d{9}$/.test(p))p='+'+p.slice(2);if(/^07\d{9}$/.test(p))p='+964'+p.slice(1);if(/^7\d{9}$/.test(p))p='+964'+p;if(/^9647\d{9}$/.test(p))p='+'+p;if(!/^\+9647\d{9}$/.test(p))fail('INVALID_PHONE');return p;};
const hash=(key,row,code)=>crypto.createHmac('sha256',key).update(JSON.stringify([POOL,PURPOSE,row.phone,row.id,code])).digest('hex');
function createService(d){
 const configured=()=>{if(d.enabled!==true||d.poolId!==POOL)fail('ENROLLMENT_UNAVAILABLE');};
 const valid=(r,p,now)=>r&&r.poolId===POOL&&r.purpose===PURPOSE&&r.phone===p&&!r.used&&!r.invalid&&r.attempts<MAX&&r.expiresAt>now;
 return {
  async send(input,context){
   configured();const phone=normalize(input.phone),key=await d.config();if(!key.apiKey||!key.hmacKey)fail('PROVIDER_UNAVAILABLE');
   await d.assertPhoneAvailable(phone); // Includes live identity/lifecycle and duplicate checks.
   const now=d.now(),row={id:crypto.randomUUID(),poolId:POOL,purpose:PURPOSE,phone,expiresAt:now+TTL,attempts:0,used:false};
   const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');row.digest=hash(key.hmacKey,row,code);
   // Adapter must atomically replace ACTIVE and reserve phone/IP/global budgets.
   await d.reserve(row,context);
   try{await d.deliver(phone,code,key.apiKey);}catch{await d.invalidate(row.id);fail('DELIVERY_FAILED');}
   return {sessionId:row.id,expiresIn:TTL};
  },
  async verify(input){
   configured();const phone=normalize(input.phone);
   if(typeof input.sessionId!=='string'||input.sessionId.length>100||typeof input.code!=='string'||!/^\d{6}$/.test(input.code))fail('INVALID_CHALLENGE');
   const row=await d.get(input.sessionId),now=d.now();
   if(!valid(row,phone,now)||!await d.isActive(phone,row.id))fail('CHALLENGE_EXPIRED');
   const key=await d.config();if(!key.hmacKey)fail('PROVIDER_UNAVAILABLE');
   const expected=Buffer.from(String(row.digest),'hex'),actual=Buffer.from(hash(key.hmacKey,row,input.code),'hex');
   const correct=expected.length===32&&crypto.timingSafeEqual(expected,actual);
   if(!correct){await d.attempt(row,now);fail('INVALID_CODE');}
   await d.assertPhoneAvailable(phone);
   const name=typeof input.name==='string'?input.name.trim():'';
   if(name.length<2||name.length>80||/[\u0000-\u001f]/.test(name))fail('NAME_REQUIRED');
   if(input.legalAccepted!==true||!input.legalAcceptance)fail('LEGAL_ACCEPTANCE_REQUIRED');
   const consent=await d.consent(input.legalAcceptance,'MERCHANT');
   // Single transaction must check ACTIVE, expiry, attempts, unused and legal pin.
   if(!await d.consume(row,now,consent))fail('CHALLENGE_EXPIRED');
   // Adapter must use deterministic phone ownership and recoverable AdminCreateUser,
   // never public SignUp or overwrite an existing identity/password.
   const identity=await d.provisionVerified({phone,name,challengeId:row.id,consent});
   if(identity?.poolId!==POOL||identity.phone!==phone||identity.phoneVerified!==true||!identity.sub)fail('IDENTITY_NOT_VERIFIED');
   await d.assertIdentityOpen(identity.sub);
   return await d.login(identity); // Scoped single-use proof; no wallet/branch approval.
  }
 };
}
module.exports={createService,POOL,PURPOSE,TTL,MAX,normalize};

},
"merchant-enrollment-store.cjs": function(module, exports, require) {
'use strict';
const crypto=require('node:crypto');
const {POOL,PURPOSE,MAX}=require('./merchant-enrollment.cjs');
const TABLE='wizz-production-MerchantOtpSessions',SETTINGS='wizz-production-PlatformStaff',LIFECYCLE='wizz-production-AccountDeletion';
const conditional=e=>['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name);
const life=sub=>({ConditionCheck:{TableName:LIFECYCLE,Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+sub,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
function createStore({db,GetCommand,UpdateCommand,TransactWriteCommand,now=()=>Math.floor(Date.now()/1000)}){
 const get=async id=>(await db.send(new GetCommand({TableName:TABLE,Key:{id},ConsistentRead:true}))).Item;
 const activeId=phone=>'ENROLL_ACTIVE#'+POOL+'#'+phone;
 const state=row=>({ConditionExpression:'poolId = :pool AND purpose = :purpose AND phone = :phone AND digest = :digest AND used = :no AND attribute_not_exists(invalid) AND expiresAt > :now AND attempts < :max AND attempts = :seen',ExpressionAttributeValues:{':pool':POOL,':purpose':PURPOSE,':phone':row.phone,':digest':row.digest,':no':false,':now':now(),':max':MAX,':seen':row.attempts}});
 const active=row=>({ConditionCheck:{TableName:TABLE,Key:{id:activeId(row.phone)},ConditionExpression:'sessionId = :id AND expiresAt > :now',ExpressionAttributeValues:{':id':row.id,':now':now()}}});
 return {
  get,
  async isActive(phone,id){const r=await get(activeId(phone));return r?.sessionId===id&&r.expiresAt>now();},
  async reserve(row,context){
   if(row.poolId!==POOL||row.purpose!==PURPOSE)throw Error('INVALID_SCOPE');
   const time=now(),day=Math.floor(time/86400),ip=context?.sourceIp;
   if(typeof ip!=='string'||ip.length<2||ip.length>100)throw Error('SOURCE_IP_REQUIRED');
   // Shared phone cooldown/daily cap also covers the existing merchant login path.
   const limits=[{id:`COOLDOWN#${POOL}#${row.phone}`,cooldown:true},{id:`DAILY#${POOL}#${day}#${row.phone}`,limit:10},{id:`ENROLL_IP#${day}#${crypto.createHash('sha256').update(ip).digest('hex')}`,limit:30},{id:`ENROLL_GLOBAL#${day}`,limit:200}];
   await db.send(new TransactWriteCommand({TransactItems:[...limits.map(x=>({Update:{TableName:TABLE,Key:{id:x.id},UpdateExpression:x.cooldown?'SET nextAllowedAt = :next, expiresAt = :ttl':'SET expiresAt = :ttl ADD sends :one',ConditionExpression:x.cooldown?'attribute_not_exists(nextAllowedAt) OR nextAllowedAt <= :now':'attribute_not_exists(sends) OR sends < :limit',ExpressionAttributeValues:x.cooldown?{':next':time+60,':ttl':time+86400,':now':time}:{':ttl':time+172800,':one':1,':limit':x.limit}}})),{Put:{TableName:TABLE,Item:row,ConditionExpression:'attribute_not_exists(id)'}},{Put:{TableName:TABLE,Item:{id:activeId(row.phone),sessionId:row.id,expiresAt:row.expiresAt}}}]}));
  },
  async invalidate(id){await db.send(new UpdateCommand({TableName:TABLE,Key:{id},UpdateExpression:'SET invalid = :yes',ConditionExpression:'poolId = :pool AND purpose = :purpose',ExpressionAttributeValues:{':yes':true,':pool':POOL,':purpose':PURPOSE}}));},
  async attempt(row){const s=state(row);try{await db.send(new TransactWriteCommand({TransactItems:[active(row),{Update:{TableName:TABLE,Key:{id:row.id},...s,UpdateExpression:'ADD attempts :one',ExpressionAttributeValues:{...s.ExpressionAttributeValues,':one':1}}}]}));}catch(e){if(!conditional(e))throw e;}},
  async consume(row,time,consent){
   if(consent?.condition?.ConditionCheck?.TableName!==SETTINGS||consent.condition.ConditionCheck.Key?.pk!=='OPERATIONAL_SETTINGS#MERCHANT_LEGAL'||consent.condition.ConditionCheck.Key?.sk!=='CURRENT'||consent.bundle?.audience!=='MERCHANT')throw Error('INVALID_LEGAL_SCOPE');
   const s=state(row);
   try{await db.send(new TransactWriteCommand({TransactItems:[active(row),consent.condition,{Update:{TableName:TABLE,Key:{id:row.id},...s,UpdateExpression:'SET used = :yes, legalAcceptance = :consent ADD attempts :one',ExpressionAttributeValues:{...s.ExpressionAttributeValues,':yes':true,':one':1,':consent':{acceptedAt:new Date(time*1000).toISOString(),bundle:consent.bundle}}}}]}));return true;}catch(e){if(conditional(e))return false;throw e;}
  },
  async assertIdentityOpen(sub){if(typeof sub!=='string'||!/^[a-f0-9-]{36}$/i.test(sub))throw Error('INVALID_IDENTITY');const r=await db.send(new GetCommand({TableName:LIFECYCLE,Key:life(sub).ConditionCheck.Key,ConsistentRead:true}));if(r.Item)throw Error('ACCOUNT_CLOSING');},
 };
}
module.exports={createStore,TABLE,SETTINGS,LIFECYCLE,life};

},
};
const cache = {};
function load(name) {
  if (!name.startsWith('./')) return nativeRequire(name);
  const id = name.slice(2);
  if (!Object.hasOwn(factories, id)) throw Error('Unknown bundled module');
  if (!cache[id]) {
    const module = {exports: {}};
    cache[id] = module;
    factories[id](module, module.exports, load);
  }
  return cache[id].exports;
}
const application = load('./runtime');
exports.handler = async event => {
  if (process.env.ENVIRONMENT !== 'production' || process.env.OTP_ENABLED !== 'true' ||
      !process.env.USER_POOL_ID || !process.env.OTP_TABLE || !process.env.OTP_SECRET_ARN ||
      event.userPoolId !== process.env.USER_POOL_ID) throw Error('OTP configuration unavailable');
  return application.handler(event);
};
