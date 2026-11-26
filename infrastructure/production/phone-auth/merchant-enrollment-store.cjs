'use strict';
const crypto=require('node:crypto');
const {POOL,PURPOSE,MAX}=require('./merchant-enrollment.cjs');
const {merchantPhoneClosureKey}=require('./merchant-phone-binding.cjs');
const TABLE='wizz-production-MerchantOtpSessions',SETTINGS='wizz-production-PlatformStaff',LIFECYCLE='wizz-production-AccountDeletion';
const conditional=e=>['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name);
const phoneFence=phone=>({ConditionCheck:{TableName:LIFECYCLE,Key:merchantPhoneClosureKey(phone),ConditionExpression:'attribute_not_exists(pk)'}});
const life=sub=>({ConditionCheck:{TableName:LIFECYCLE,Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+sub,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
function createStore({db,GetCommand,UpdateCommand,TransactWriteCommand,now=()=>Math.floor(Date.now()/1000)}){
 const get=async id=>(await db.send(new GetCommand({TableName:TABLE,Key:{id},ConsistentRead:true}))).Item;
 const activeId=phone=>'ENROLL_ACTIVE#'+POOL+'#'+phone;
 const state=row=>({ConditionExpression:'poolId = :pool AND purpose = :purpose AND phone = :phone AND digest = :digest AND used = :no AND attribute_not_exists(invalid) AND expiresAt > :now AND attempts < :max AND attempts = :seen',ExpressionAttributeValues:{':pool':POOL,':purpose':PURPOSE,':phone':row.phone,':digest':row.digest,':no':false,':now':now(),':max':MAX,':seen':row.attempts}});
 const active=row=>({ConditionCheck:{TableName:TABLE,Key:{id:activeId(row.phone)},ConditionExpression:'sessionId = :id AND expiresAt > :now',ExpressionAttributeValues:{':id':row.id,':now':now()}}});
 return {
  get,
  async assertPhoneOpen(phone){
   const {Item}=await db.send(new GetCommand({TableName:LIFECYCLE,Key:merchantPhoneClosureKey(phone),ConsistentRead:true}));
   if(Item)throw Error('ACCOUNT_CLOSING');
  },
  async isActive(phone,id){const r=await get(activeId(phone));return r?.sessionId===id&&r.expiresAt>now();},
  async reserve(row,context){
   if(row.poolId!==POOL||row.purpose!==PURPOSE)throw Error('INVALID_SCOPE');
   const time=now(),day=Math.floor(time/86400),ip=context?.sourceIp;
   if(typeof ip!=='string'||ip.length<2||ip.length>100)throw Error('SOURCE_IP_REQUIRED');
   // Shared phone cooldown/daily cap also covers the existing merchant login path.
   const limits=[{id:`COOLDOWN#${POOL}#${row.phone}`,cooldown:true},{id:`DAILY#${POOL}#${day}#${row.phone}`,limit:10},{id:`ENROLL_IP#${day}#${crypto.createHash('sha256').update(ip).digest('hex')}`,limit:30},{id:`ENROLL_GLOBAL#${day}`,limit:200}];
   await db.send(new TransactWriteCommand({TransactItems:[...limits.map(x=>({Update:{TableName:TABLE,Key:{id:x.id},UpdateExpression:x.cooldown?'SET nextAllowedAt = :next, expiresAt = :ttl':'SET expiresAt = :ttl ADD sends :one',ConditionExpression:x.cooldown?'attribute_not_exists(nextAllowedAt) OR nextAllowedAt <= :now':'attribute_not_exists(sends) OR sends < :limit',ExpressionAttributeValues:x.cooldown?{':next':time+60,':ttl':time+86400,':now':time}:{':ttl':time+172800,':one':1,':limit':x.limit}}})),{Put:{TableName:TABLE,Item:row,ConditionExpression:'attribute_not_exists(id)'}},{Put:{TableName:TABLE,Item:{id:activeId(row.phone),sessionId:row.id,expiresAt:row.expiresAt}}},phoneFence(row.phone)]}));
  },
  async invalidate(id){await db.send(new UpdateCommand({TableName:TABLE,Key:{id},UpdateExpression:'SET invalid = :yes',ConditionExpression:'poolId = :pool AND purpose = :purpose',ExpressionAttributeValues:{':yes':true,':pool':POOL,':purpose':PURPOSE}}));},
  async attempt(row){const s=state(row);try{await db.send(new TransactWriteCommand({TransactItems:[active(row),{Update:{TableName:TABLE,Key:{id:row.id},...s,UpdateExpression:'ADD attempts :one',ExpressionAttributeValues:{...s.ExpressionAttributeValues,':one':1}}}]}));}catch(e){if(!conditional(e))throw e;}},
  async consume(row,time,consent){
   if(consent?.condition?.ConditionCheck?.TableName!==SETTINGS||consent.condition.ConditionCheck.Key?.pk!=='OPERATIONAL_SETTINGS#MERCHANT_LEGAL'||consent.condition.ConditionCheck.Key?.sk!=='CURRENT'||consent.bundle?.audience!=='MERCHANT')throw Error('INVALID_LEGAL_SCOPE');
   const s=state(row);
   try{await db.send(new TransactWriteCommand({TransactItems:[phoneFence(row.phone),active(row),consent.condition,{Update:{TableName:TABLE,Key:{id:row.id},...s,UpdateExpression:'SET used = :yes, legalAcceptance = :consent ADD attempts :one',ExpressionAttributeValues:{...s.ExpressionAttributeValues,':yes':true,':one':1,':consent':{acceptedAt:new Date(time*1000).toISOString(),bundle:consent.bundle}}}}]}));return true;}catch(e){if(conditional(e))return false;throw e;}
  },
  async assertIdentityOpen(sub){if(typeof sub!=='string'||!/^[a-f0-9-]{36}$/i.test(sub))throw Error('INVALID_IDENTITY');const r=await db.send(new GetCommand({TableName:LIFECYCLE,Key:life(sub).ConditionCheck.Key,ConsistentRead:true}));if(r.Item)throw Error('ACCOUNT_CLOSING');},
 };
}
module.exports={createStore,TABLE,SETTINGS,LIFECYCLE,life};
