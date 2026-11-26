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
