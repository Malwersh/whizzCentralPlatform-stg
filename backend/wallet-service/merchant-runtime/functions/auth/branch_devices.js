'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID,randomInt}=require('node:crypto');
const sec=require('../../merchant-platform/branch-device-security');
const policyAccess=require('./staff_policy_access');
const T='staging-MerchantPlatform',B='WhizzMerchants_Businesses',D='staging-AccountDeletion';
const now=()=>Math.floor(Date.now()/1000);
const get=async(db,t,k)=>(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
async function rows(db,pk,prefix){let cursor;const all=[];do{const r=await db.send(new QueryCommand({TableName:T,KeyConditionExpression:'pk=:pk AND begins_with(sk,:sk)',ExpressionAttributeValues:{':pk':pk,':sk':prefix},ConsistentRead:true,ExclusiveStartKey:cursor}));all.push(...r.Items||[]);cursor=r.LastEvaluatedKey;}while(cursor);return all;}
const fence=pk=>({ConditionCheck:{TableName:D,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
const put=(r,old)=>({Put:{TableName:T,Item:r,ConditionExpression:old?'#v=:v':'attribute_not_exists(pk)',...(old?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':old.version}}:{})}});
const check=(r,extra='',values={})=>({ConditionCheck:{TableName:T,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'#v=:v'+extra,ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':r.version,...values}}});
async function tx(db,items){try{await db.send(new TransactWriteCommand({TransactItems:items}));}catch(e){if(e.name==='TransactionCanceledException')sec.fail('VERSION_OR_STATE_CONFLICT',409);throw e;}}
async function branch(db,id){if(typeof id!=='string'||!/^[\w-]{1,150}$/.test(id))sec.fail('INVALID_BUSINESS_ID',400);const b=await get(db,B,{businessId:id});if(!b||b.ownerId!==b.cognitoUserId||!b.ownerId||b.deletionRequestId||String(b.status).toLowerCase()!=='approved')sec.fail('BUSINESS_UNAVAILABLE');for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+id,'ACCOUNT_LIFECYCLE#MERCHANT#'+b.ownerId])if(await get(db,D,{pk,sk:'META'}))sec.fail('BUSINESS_UNAVAILABLE');return b;}
const guards=b=>[fence('BUSINESS_LIFECYCLE#MERCHANT#'+b.businessId),fence('ACCOUNT_LIFECYCLE#MERCHANT#'+b.ownerId),{ConditionCheck:{TableName:B,Key:{businessId:b.businessId},ConditionExpression:'ownerId=:o AND cognitoUserId=:o AND attribute_not_exists(deletionRequestId) AND #s=:s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':o':b.ownerId,':s':b.status}}}];
const publicDevice=d=>({deviceId:d.deviceId,name:d.name,status:d.status,version:d.version,expiresAt:d.expiresAt,createdAt:d.createdAt});
const audit=(b,actor,action,id=randomUUID())=>({pk:'BRANCH#'+b.businessId,sk:'DEVICE_AUDIT#'+id,businessId:b.businessId,ownerId:b.ownerId,actorId:actor,action,createdAt:new Date().toISOString()});
async function management({db,sub,identity},event,input){
 const id=event.httpMethod==='GET'?event.queryStringParameters?.businessId:input.businessId,b=await branch(db,id),pk='BRANCH#'+id;
 if(await get(db,D,{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+sub,sk:'META'}))sec.fail('ACCOUNT_CLOSING');
 const common=[...guards(b),...(sub!==b.ownerId?[fence('ACCOUNT_LIFECYCLE#MERCHANT#'+sub)]:[])];
 if(event.httpMethod==='GET'){if(sub!==b.ownerId)sec.fail('OWNER_REQUIRED');return {devices:(await rows(db,pk,'DEVICE#')).map(publicDevice)};}
 if(event.httpMethod!=='POST')sec.fail('INVALID_DEVICE_REQUEST',400);
 if(Object.keys(input).some(k=>!['action','businessId','name','deviceId','baseVersion','pairingCode','pin','deviceToken'].includes(k)))sec.fail('INVALID_DEVICE_REQUEST',400);
 const fresh=()=>{const t=identity?.claims?.auth_time;if(!Number.isFinite(t)||t>now()+60||now()-t>300)sec.fail('RECENT_SIGN_IN_REQUIRED',401);};
 if(input.action==='create_pairing'){
  if(sub!==b.ownerId)sec.fail('OWNER_REQUIRED');fresh();
  const name=typeof input.name==='string'?input.name.trim():'';if(!name||name.length>60)sec.fail('INVALID_DEVICE_NAME',400);
  const code=String(randomInt(0,100000000)).padStart(8,'0'),key={pk,sk:'PAIRING'},old=await get(db,T,key);
  const r={...key,businessId:id,ownerId:b.ownerId,name,codeHash:sec.hash(code),status:'PENDING',version:(old?.version||0)+1,attempts:0,expiresAt:now()+300};
  await tx(db,[...common,put(r,old),put(audit(b,sub,'CREATE_PAIRING'))]);return {pairingCode:code,expiresAt:r.expiresAt};
 }
 if(input.action==='claim_pairing'){
  fresh();if(typeof input.pairingCode!=='string'||!/^\d{8}$/.test(input.pairingCode))sec.fail('INVALID_PAIRING_CODE',400);
  if(sub!==b.ownerId){const m=await get(db,T,{pk,sk:'MEMBER#'+sub});if(m?.status!=='ACTIVE'||m.ownerId!==b.ownerId)sec.fail('MEMBERSHIP_REQUIRED');common.push(check(m));}
  const p=await get(db,T,{pk,sk:'PAIRING'});if(!p||p.status!=='PENDING'||p.expiresAt<=now()||p.attempts>=5)sec.fail('PAIRING_EXPIRED',409);
  if(sec.hash(input.pairingCode)!==p.codeHash){await tx(db,[...common,put({...p,attempts:p.attempts+1,version:p.version+1},p)]);sec.fail('INVALID_PAIRING_CODE',400);}
  const deviceId=randomUUID(),token=sec.secret(),d={pk,sk:'DEVICE#'+deviceId,businessId:id,ownerId:b.ownerId,deviceId,name:p.name,status:'ACTIVE',version:1,tokenHash:sec.hash(token),expiresAt:now()+30*86400,createdAt:new Date().toISOString()};
  await tx(db,[...common,put({...p,status:'USED',version:p.version+1},p),put(d),put(audit(b,sub,'PAIR_DEVICE'))]);return {device:publicDevice(d),businessId:id,businessName:b.businessName||b.name,deviceToken:id+':'+deviceId+':'+token};
 }
 if(input.action==='revoke_device'){
  if(sub!==b.ownerId)sec.fail('OWNER_REQUIRED');const d=await get(db,T,{pk,sk:'DEVICE#'+input.deviceId});if(!d||d.ownerId!==b.ownerId||d.version!==input.baseVersion)sec.fail('VERSION_OR_STATE_CONFLICT',409);
  await tx(db,[...common,put({...d,status:'REVOKED',version:d.version+1},d),put(audit(b,sub,'REVOKE_DEVICE'))]);return {success:true};
 }
 if(input.action==='set_pin'){
  fresh();const access=await reception(db,input.deviceToken);if(access.b.businessId!==id)sec.fail('DEVICE_SCOPE_REQUIRED');
  const m=await get(db,T,{pk,sk:'MEMBER#'+sub});if(m?.status!=='ACTIVE'||m.ownerId!==b.ownerId)sec.fail('MEMBERSHIP_REQUIRED');
  const key={pk,sk:'PIN#'+sub},old=await get(db,T,key),profile=await get(db,T,{pk:'PERSON#'+sub,sk:'PROFILE'});if(!profile)sec.fail('PERSON_PROFILE_REQUIRED',409);
  const r={...key,businessId:id,ownerId:b.ownerId,subjectId:sub,...sec.pinRecord(input.pin),membershipVersion:m.version,attempts:0,status:'ACTIVE',version:(old?.version||0)+1,updatedAt:new Date().toISOString()};
  await tx(db,[...common,check(m),check(access.d),put(r,old),put(audit(b,sub,'SET_PIN'))]);return {success:true};
 }
 sec.fail('UNKNOWN_ACTION',400);
}
function parseDevice(token){if(typeof token!=='string'||token.length>512)sec.fail('DEVICE_REVOKED',401);const parts=token.split(':');if(parts.length!==3||!/^[\w-]{1,150}$/.test(parts[0])||!/^[a-f0-9-]{36}$/.test(parts[1])||!/^[A-Za-z0-9_-]{43}$/.test(parts[2]))sec.fail('DEVICE_REVOKED',401);return parts;}
async function reception(db,token){const [bid,did,secret]=parseDevice(token),b=await branch(db,bid),d=await get(db,T,{pk:'BRANCH#'+bid,sk:'DEVICE#'+did});sec.activeDevice(d,secret,now());if(d.ownerId!==b.ownerId||d.businessId!==bid)sec.fail('DEVICE_REVOKED',401);return {b,d};}
async function runtime(db,event,input){
 const token=(event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer /,''),{b,d}=await reception(db,token),pk=d.pk;
 const common=[...guards(b),check(d,' AND #state=:active AND expiresAt>:now',{':active':'ACTIVE',':now':now()})];common.at(-1).ConditionCheck.ExpressionAttributeNames['#state']='status';
 if(event.httpMethod!=='POST')sec.fail('INVALID_DEVICE_REQUEST',400);
 if(input.action==='register_push'){
  if(typeof input.pushToken!=='string'||input.pushToken.length<20||input.pushToken.length>4096||!['ios','android'].includes(input.platform))sec.fail('INVALID_PUSH_TOKEN',400);
  const key={pk,sk:'DEVICE_PUSH#'+d.deviceId},old=await get(db,T,key);
  const binding={...key,businessId:b.businessId,ownerId:b.ownerId,deviceId:d.deviceId,deviceVersion:d.version,tokenHash:sec.hash(input.pushToken),version:(old?.version||0)+1};
  const item={token:'BRANCH_DEVICE#'+d.deviceId,fcmToken:input.pushToken,subjectId:'BRANCH_DEVICE#'+d.deviceId,app:'merchant',platform:input.platform,businessId:b.businessId,branchDeviceId:d.deviceId,branchDeviceVersion:d.version,env:'staging',updatedAt:new Date().toISOString(),ttl:d.expiresAt};
  await tx(db,[...common,put(binding,old),{Put:{TableName:'WizzCentral_PushDeviceTokens_staging',Item:item}}]);
  return {success:true};
 }
 if(input.action==='disconnect'){
  const next={...d,status:'REVOKED',version:d.version+1};
  await tx(db,[...common.filter(x=>x.ConditionCheck?.Key.sk!==d.sk),put(next,d),put(audit(b,null,'DISCONNECT_DEVICE'))]);
  return {success:true};
 }
 if(input.action==='reception'){
  const staff=[];for(const m of await rows(db,pk,'MEMBER#')){if(m.status!=='ACTIVE'||m.ownerId!==b.ownerId)continue;if(await get(db,D,{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+m.subjectId,sk:'META'}))continue;const p=await get(db,T,{pk,sk:'PIN#'+m.subjectId});staff.push({subjectId:m.subjectId,displayName:m.displayName,role:m.role,pinReady:p?.status==='ACTIVE'&&p.membershipVersion===m.version&&p.attempts<5});}
  await tx(db,[...common.filter(x=>x.ConditionCheck?.Key.sk!==d.sk),put({...d,lastSeenAt:now()},d)]);
  const push=await get(db,T,{pk,sk:'DEVICE_PUSH#'+d.deviceId});
  return {businessName:b.businessName||b.name,device:publicDevice(d),staff,pushRegistered:push?.deviceVersion===d.version};
 }
 if(input.action==='unlock'){
  const sub=input.subjectId;if(typeof sub!=='string'||sub.length>100)sec.fail('INVALID_STAFF_REQUEST',400);
  const m=await get(db,T,{pk,sk:'MEMBER#'+sub}),p=await get(db,T,{pk,sk:'PIN#'+sub});if(m?.status!=='ACTIVE'||m.ownerId!==b.ownerId)sec.fail('MEMBERSHIP_REVOKED');
  if(!p||p.status!=='ACTIVE'||p.membershipVersion!==m.version||p.attempts>=5)sec.fail('PIN_RESET_REQUIRED',409);
  const authorization=await policyAccess.employee(db,m,b.businessId);if(authorization){if(!authorization.permissions.includes('branch.read'))sec.fail('PERMISSION_REQUIRED');common.push(authorization.fence);}
  common.push(fence('ACCOUNT_LIFECYCLE#MERCHANT#'+sub),check(m));
  if(!sec.checkPin(input.pin,p)){await tx(db,[...common,put({...p,attempts:p.attempts+1,version:p.version+1},p)]);sec.fail('INVALID_PIN',400);}
  const id=randomUUID(),secret=sec.secret(),s={pk,sk:'STAFF_SESSION#'+id,sessionId:id,businessId:b.businessId,ownerId:b.ownerId,subjectId:sub,membershipId:m.membershipId,membershipVersion:m.version,pinVersion:p.version+1,deviceId:d.deviceId,deviceVersion:d.version,tokenHash:sec.hash(secret),expiresAt:now()+120,maxExpiresAt:now()+8*3600,status:'ACTIVE',version:1};
  await tx(db,[...common,put({...p,attempts:0,version:p.version+1},p),put(s),put(audit(b,sub,'UNLOCK'))]);return {staffSession:id+':'+secret,expiresAt:s.expiresAt};
 }
 const {s,m,authorization,common:staffGuards}=await employeeAccess(db,event,{b,d});
 common.push(...staffGuards);
 if(['discounts_list','discounts_create','discounts_update','discounts_status','discounts_delete'].includes(input.action))return require('./branch_device_discounts').execute(db,{b,d,s,m,authorization,common},input);
 if(['read_status','set_status'].includes(input.action))return require('./branch_device_status').execute(db,{b,d,s,m,authorization,common},input);
 if(input.action==='touch'){
  const next={...s,expiresAt:Math.min(now()+120,s.maxExpiresAt||s.expiresAt),version:s.version+1};
  await tx(db,[...common.filter(x=>x.ConditionCheck?.Key.sk!==s.sk),put(next,s)]);
  return {expiresAt:next.expiresAt};
 }
 if(input.action==='lock'){await tx(db,[...common.filter(x=>x.ConditionCheck?.Key.sk!==s.sk),put({...s,status:'LOCKED',version:s.version+1},s)]);return {success:true};}
 if(input.action==='profile'){
  const membership={...m,branchIds:[m.businessId]},session={...s,branchId:s.businessId},device={...d,branchId:d.businessId};
  const result=require('../../merchant-platform/branch-profile-policy').view(b,{subjectId:s.subjectId,membership,session,device,branchId:b.businessId,policy:authorization?.policy,registry:authorization?require('../../merchant-platform/staff-capabilities').REGISTRY:undefined});
  await tx(db,common);return {...result,staff:{subjectId:s.subjectId,displayName:m.displayName,role:m.role,...(authorization?{permissionSchema:2,permissions:authorization.permissions,policyVersion:authorization.policy.version}:{})},expiresAt:s.expiresAt};
 }
 sec.fail('UNKNOWN_ACTION',400);
}
async function employeeAccess(db,event,{b,d}){
 const pk=d.pk,common=[];
 const st=event.headers?.['X-Staff-Session']||event.headers?.['x-staff-session'];if(typeof st!=='string'||!/^[-a-f0-9]{36}:[\w-]{43}$/.test(st))sec.fail('SESSION_REVOKED',401);const [sid,ss]=st.split(':');
 const s=await get(db,T,{pk,sk:'STAFF_SESSION#'+sid}),m=s&&await get(db,T,{pk,sk:'MEMBER#'+s.subjectId});sec.activeSession(s,ss,d,m,now());
 if(await get(db,D,{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+s.subjectId,sk:'META'}))sec.fail('ACCOUNT_CLOSING');
 const pin=await get(db,T,{pk,sk:'PIN#'+s.subjectId});if(!pin||pin.membershipVersion!==m.version||pin.version!==s.pinVersion)sec.fail('SESSION_REVOKED',401);
 common.push(fence('ACCOUNT_LIFECYCLE#MERCHANT#'+s.subjectId),check(m),check(pin),check(s,' AND expiresAt>:now',{':now':now()}));
 const authorization=await policyAccess.employee(db,m,b.businessId);if(authorization)common.push(authorization.fence);
 return {s,m:authorization?.membership||m,common,authorization};
}
async function authorizer(db,event){try{const {d}=await reception(db,(event.authorizationToken||'').replace(/^Bearer /,''));return {principalId:d.deviceId,policyDocument:{Version:'2012-10-17',Statement:[{Action:'execute-api:Invoke',Effect:'Allow',Resource:event.methodArn}]}};}catch(_){throw Error('Unauthorized');}}
module.exports={management,runtime,authorizer,reception,employeeAccess,guards,check,tx};
