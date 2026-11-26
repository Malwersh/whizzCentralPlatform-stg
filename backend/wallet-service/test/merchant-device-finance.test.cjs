const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
process.env.ENVIRONMENT='staging';
const {docClient,TABLES,GetCommand}=require('../dist/db');
const {readMerchantDeviceWallet}=require('../dist/merchantDeviceWallet');
const {deviceFinance}=require('../dist/merchantDeviceFinance');
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){process.env.IDEMPOTENCY_KEYS_TABLE='staging-IdempotencyKeys';
 const rows=new Map(),calls=[],audits=[],activities=[],d='11111111-1111-4111-8111-111111111111',s='22222222-2222-4222-8222-222222222222',secret='a'.repeat(43),sessionSecret='b'.repeat(43),T='staging-MerchantPlatform',pk='BRANCH#b';let race=false,auditFailure=false,activityFailure=false;
 const k=(table,key)=>table+'|'+JSON.stringify(key),put=(table,key,row)=>rows.set(k(table,key),{...key,...row}),get=(table,key)=>rows.get(k(table,key));
 put('WhizzMerchants_Businesses',{businessId:'b'},{ownerId:'owner',cognitoUserId:'owner',status:'approved',email:'hidden-owner-email'});
 put(T,{pk,sk:'DEVICE#'+d},{deviceId:d,businessId:'b',ownerId:'owner',version:1,status:'ACTIVE',expiresAt:Date.now()/1000+3600,tokenHash:hash(secret)});
 const permissions=['branch.read','wallet.balance.read','wallet.transactions.read','wallet.export','reports.sales.read','reports.export','finance.transfer'];
 put(T,{pk,sk:'MEMBER#employee'},{subjectId:'employee',businessId:'b',ownerId:'owner',version:1,status:'ACTIVE',role:'finance-read',permissionSchema:2,grant:{roleId:'finance-read',roleVersion:1,policyVersion:1,branchIds:['b'],permissions}});
 put(T,{pk,sk:'PIN#employee'},{membershipVersion:1,version:1,salt:'never-read-salt',digest:'never-read-digest'});
 put(T,{pk,sk:'STAFF_SESSION#'+s},{sessionId:s,subjectId:'employee',businessId:'b',deviceId:d,deviceVersion:1,membershipVersion:1,pinVersion:1,status:'ACTIVE',version:1,expiresAt:Date.now()/1000+3600,tokenHash:hash(sessionSecret)});
 put('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'},{version:1,enabledPermissions:permissions,roles:[{id:'finance-read',version:1,nameAr:'قارئ مالي',enabled:true,permissions}]});
 put(TABLES.WALLETS,{walletId:'WALLET#MERCHANT#b',sk:'META'},{ownerType:'MERCHANT',ownerId:'b',status:'ACTIVE',currency:'IQD',availableBalance:15000,lockedBalance:2000,secretPayment:'never-return'});
 docClient.send=async c=>{
  calls.push(c);const x=c.input,name=c instanceof GetCommand?'GetCommand':c.constructor.name;
  if(name==='GetCommand'){if(x.Key.idempotencyKey==='CONFIG#TRANSFERS')return {};let row=structuredClone(get(x.TableName,x.Key));if(row&&x.ProjectionExpression){const fields=x.ProjectionExpression.split(',').map(n=>x.ExpressionAttributeNames?.[n.trim()]||n.trim());row=Object.fromEntries(fields.filter(f=>row[f]!==undefined).map(f=>[f,row[f]]));}return {Item:row};}
  if(name==='QueryCommand')return {Items:[{walletId:'WALLET#MERCHANT#b',sk:'ts#one',amount:500,category:'TRANSFER',description:'حركة',metadata:{token:'secret'}},{walletId:'WALLET#MERCHANT#foreign',sk:'ts#foreign',amount:999}],LastEvaluatedKey:{walletId:'WALLET#MERCHANT#b',sk:'ts#one'}};
  if(name==='TransactWriteCommand'){
   const audited=x.TransactItems.some(op=>op.Put);
   if(audited&&race)get(T,{pk,sk:'MEMBER#employee'}).version++;
   if(audited&&(auditFailure||activityFailure&&x.TransactItems.some(op=>op.Put?.TableName===T)))throw Error('audit unavailable');
   for(const op of x.TransactItems){if(!op.ConditionCheck)continue;const q=op.ConditionCheck,row=get(q.TableName,q.Key);if(q.ConditionExpression==='attribute_not_exists(pk)'&&row||q.ExpressionAttributeValues?.[':v']!==undefined&&row?.version!==q.ExpressionAttributeValues[':v'])throw Object.assign(Error('conflict'),{name:'TransactionCanceledException'});}
   for(const op of x.TransactItems)if(op.Put?.TableName===TABLES.AUDIT_LOG)audits.push(op.Put.Item);for(const op of x.TransactItems)if(op.Put?.TableName===T)activities.push(op.Put.Item);return {};
  }
  throw Error('unexpected mutation '+name);
 };
 const event=(kind='balance',query={})=>({path:'/wallet/branch-device/'+kind,httpMethod:'GET',headers:{Authorization:'Bearer b:'+d+':'+secret,'X-Staff-Session':s+':'+sessionSecret},queryStringParameters:{businessId:'b',...query},requestContext:{authorizer:{userType:'merchant',userId:'owner',financeManager:true}}});
 return {put,get,event,read:(kind='balance',query={})=>readMerchantDeviceWallet(event(kind,query)),calls,audits,activities,failActivity:()=>activityFailure=true,member:get(T,{pk,sk:'MEMBER#employee'}),device:get(T,{pk,sk:'DEVICE#'+d}),policy:get('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'}),rows,race:()=>race=true,failAudit:()=>auditFailure=true};
}

const event=(f,action='context',body)=>({...f.event(),path:'/wallet/branch-device/transfers/'+action,queryStringParameters:{},...(body?{httpMethod:'POST',body:JSON.stringify(body)}:{})});
test('device transfer context uses branch daily limit, no wallet creation, and audited actor',async()=>{const f=fixture();const result=await deviceFinance(event(f));assert.equal(result.walletId,'WALLET#MERCHANT#b');assert.equal(result.available,15000);assert.equal(result.dailyLimit,100000);assert.equal(result.isOwner,undefined);assert.equal(f.activities[0].action,'MERCHANT_STAFF_TRANSFER_CONTEXT_READ');assert.equal(f.activities[0].actorId,'employee');assert.ok(!f.calls.some(c=>c.constructor.name==='PutCommand'));});
test('missing wallet never creates a zero balance wallet from the employee context',async()=>{const f=fixture();f.rows.delete(TABLES.WALLETS+'|'+JSON.stringify({walletId:'WALLET#MERCHANT#b',sk:'META'}));await assert.rejects(deviceFinance(event(f)),e=>e.code==='WALLET_UNAVAILABLE');assert.equal(f.activities.length,0);});
test('transfer right is explicit and centrally removable even with a valid device/session',async()=>{for(const revoke of [f=>f.member.grant.permissions=f.member.grant.permissions.filter(p=>p!=='finance.transfer'),f=>f.policy.enabledPermissions=f.policy.enabledPermissions.filter(p=>p!=='finance.transfer')]){const f=fixture();revoke(f);await assert.rejects(deviceFinance(event(f)),e=>e.code==='PERMISSION_REQUIRED');assert.equal(f.activities.length,0);assert.ok(!f.calls.some(c=>c.input.TableName===TABLES.WALLETS));}});
test('foreign branch, caller account, phone injection and malformed actions are rejected before use',async()=>{for(const [action,body] of [['request',{businessId:'foreign'}],['otp/send',{phone:'+9647800000000'}],['request',{account:{isOwner:true}}]]){const f=fixture();await assert.rejects(deviceFinance(event(f,action,body)),e=>e.code==='INVALID_TRANSFER');assert.equal(f.calls.length,0);}});
test('revocation or audit failure after a financial read withholds its result',async()=>{for(const mode of ['race','activity']){const f=fixture();if(mode==='race'){const send=docClient.send;docClient.send=async c=>{if(c.constructor.name==='TransactWriteCommand'&&c.input.TransactItems.some(x=>x.Put))f.member.version++;return send(c);};}else f.failActivity();await assert.rejects(deviceFinance(event(f)));}});
test('device scope changes invalidate an otherwise matching verification fingerprint',()=>{const {verificationFingerprint}=require('../dist/transferVerification');const input={requestId:'00000000-0000-4000-8000-000000000001',recipientWalletId:'WALLET#DRIVER#recipient',amount:5000,reason:'اختبار'};const a={principalId:'employee',walletId:'WALLET#MERCHANT#b',verificationScope:'session-version-one'};assert.notEqual(verificationFingerprint(a,input),verificationFingerprint({...a,verificationScope:'session-version-two'},input));});
test('employee OTP targets the live verified employee phone and fences quota/challenge writes',async()=>{
 const {CognitoIdentityProviderClient}=require('@aws-sdk/client-cognito-identity-provider'),{SecretsManagerClient}=require('@aws-sdk/client-secrets-manager');const oldCognito=CognitoIdentityProviderClient.prototype.send,oldSecrets=SecretsManagerClient.prototype.send,oldFetch=global.fetch;let recipient,lookup;
 try{
  CognitoIdentityProviderClient.prototype.send=async c=>{lookup=c.input;return {Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'employee'},{Name:'phone_number',Value:'+9647800000000'},{Name:'phone_number_verified',Value:'true'}]};};
  SecretsManagerClient.prototype.send=async()=>({SecretString:JSON.stringify({apiKey:'synthetic-key',hmacKey:'synthetic-hmac'})});global.fetch=async(_url,options)=>{recipient=JSON.parse(options.body).phoneNumber;return {ok:true};};
  const f=fixture(),input={requestId:'00000000-0000-4000-8000-000000000001',recipientWalletId:'WALLET#DRIVER#recipient',amount:5000,reason:'اختبار'};const result=await deviceFinance(event(f,'otp/send',input));assert.equal(lookup.Username,'employee');assert.equal(recipient,'9647800000000');assert.equal(result.phoneHint,'••••0000');assert.equal(result.digest,undefined);const writes=f.calls.filter(c=>c.constructor.name==='TransactWriteCommand');const challenge=writes.find(c=>c.input.TransactItems.some(x=>x.Put?.Item.digest));assert.ok(challenge.input.TransactItems.some(x=>x.ConditionCheck?.TableName==='staging-PlatformStaff'));assert.ok(challenge.input.TransactItems.some(x=>x.ConditionCheck?.Key.sk==='MEMBER#employee'));assert.ok(challenge.input.TransactItems.some(x=>x.Update?.Key.idempotencyKey?.includes('COOLDOWN#employee')));assert.equal(f.activities[0].action,'MERCHANT_STAFF_TRANSFER_VERIFICATION_REQUESTED');
 }finally{CognitoIdentityProviderClient.prototype.send=oldCognito;SecretsManagerClient.prototype.send=oldSecrets;global.fetch=oldFetch;}
});
test('disabled or unverified Cognito employee cannot request a transfer code',async()=>{
 const {CognitoIdentityProviderClient}=require('@aws-sdk/client-cognito-identity-provider');const original=CognitoIdentityProviderClient.prototype.send;
 try{for(const enabled of [false,true]){CognitoIdentityProviderClient.prototype.send=async()=>({Enabled:enabled,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'employee'},{Name:'phone_number',Value:'+9647800000000'},{Name:'phone_number_verified',Value:'false'}]});const f=fixture();await assert.rejects(deviceFinance(event(f,'otp/send',{requestId:'00000000-0000-4000-8000-000000000001',recipientWalletId:'WALLET#DRIVER#recipient',amount:5000,reason:'اختبار'})),e=>e.code==='PHONE_VERIFICATION_REQUIRED');assert.equal(f.activities.length,0);}}
 finally{CognitoIdentityProviderClient.prototype.send=original;}
});

test('transfer history uses consistent branch-only reads and rejects a foreign row',async()=>{const f=fixture();await assert.rejects(deviceFinance(event(f,'history')),e=>e.code==='INVALID_LEDGER');const query=f.calls.find(c=>c.constructor.name==='QueryCommand');assert.equal(query.input.ConsistentRead,true);assert.equal(f.activities.length,0);});

test('a revoked employee session returns a client authorization failure, never a fake server success',async()=>{const f=fixture();f.device.status='REVOKED';const response=await require('../dist/merchantDeviceFinance').handler(event(f));assert.equal(response.statusCode,401);assert.equal(JSON.parse(response.body).error.code,'DEVICE_REVOKED');assert.equal(f.activities.length,0);});
