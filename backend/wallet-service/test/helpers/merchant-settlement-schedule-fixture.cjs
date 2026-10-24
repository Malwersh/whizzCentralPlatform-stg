'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createMerchantSettlementScheduleWorkflow:create}=require('../../dist/merchantSettlementScheduleWorkflow');
const {createMerchantSettlementScheduleHistoryReader:history}=require('../../dist/merchantSettlementScheduleHistory');
const {createMerchantSettlementScheduleReader:reader}=require('../../dist/merchantSettlementScheduleReader');
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses',D='staging-AccountDeletion';
const maker='11111111-1111-4111-8111-111111111111',reviewer='22222222-2222-4222-8222-222222222222';
const effectiveFrom='2026-10-21T21:00:00.000Z';
function fixture(){
 const rows=new Map(),calls=[],writes=[];let now=Date.parse('2026-10-18T12:00:00.000Z');
 const identity=(t,k)=>t+'|'+JSON.stringify(Object.fromEntries(Object.entries(k).sort()));
 const itemKey=(t,r)=>t===B?{businessId:r.businessId}:{pk:r.pk,sk:r.sk};
 const put=(t,r)=>rows.set(identity(t,itemKey(t,r)),structuredClone(r));
 const get=(t,k)=>structuredClone(rows.get(identity(t,k)));
 for(const [id,role]of [[maker,'finance_settings'],[reviewer,'finance_settings_approver']])put(S,{pk:'EMPLOYEE#'+id,sk:'PROFILE',employeeId:id,roles:[role],status:'ACTIVE',version:1,scope:{allRegions:true,regionIds:[]},mfaRequired:true});
 put(B,{businessId:'branch1',ownerId:'owner1',cognitoUserId:'owner1',organizationId:'merchant1',status:'approved',commercialAgreementId:'agreement1',commercialAgreementVersion:1});
 put(P,{pk:'COMMERCIAL_AGREEMENT#agreement1',sk:'CURRENT',version:1,termsHash:'a'.repeat(64),status:'ACTIVE'});
 put(P,{pk:'COMMERCIAL_AGREEMENT#agreement1',sk:'VERSION#1',schemaVersion:2,termsHash:'a'.repeat(64),terms:{status:'ACTIVE',merchantId:'merchant1',branchId:'branch1',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null}});
 put(P,{pk:'COMMERCIAL_AGREEMENT#agreement1',sk:'ACCEPTANCE#1',status:'ACCEPTED',subjectId:'owner1',termsHash:'a'.repeat(64)});
 function condition(t,k,q){const row=get(t,k);
  if(q.ConditionExpression==='attribute_not_exists(pk)'){if(row)throw Error('conditional conflict');return;}
  if(q.ExpressionAttributeValues?.[':owner']){if(!row||row.leaseOwner!==q.ExpressionAttributeValues[':owner']||row.version!==q.ExpressionAttributeValues[':v']||row.status!=='PROCESSING'||row.leaseUntil<=q.ExpressionAttributeValues[':now']||row.legalHold===true||row.retentionHold===true)throw Error('lease conflict');}
  for(const [name,field]of Object.entries(q.ExpressionAttributeNames||{})){
   if(!/^#[fc]/.test(name))continue;
   const n=name.slice(2),value=q.ExpressionAttributeValues?.[(name.startsWith('#f')?':v':':c')+n];
   if(!require('node:util').isDeepStrictEqual(row?.[field],value))throw Error('conditional conflict');
  }
 }
 const db={async send(command){calls.push(command);const q=command.input,name=command.constructor.name;
  if(name==='GetCommand'){const out={Item:get(q.TableName,q.Key)};if(db.readHook){const hook=db.readHook;db.readHook=null;hook(q);}return out;}
  if(name==='QueryCommand'){if(db.incomplete)return {Items:[],LastEvaluatedKey:{pk:'x',sk:'y'}};return {Items:[...rows.entries()].filter(([k,r])=>k.startsWith(q.TableName+'|')&&r.pk===q.ExpressionAttributeValues[':pk']&&(!q.ExpressionAttributeValues[':prefix']||r.sk.startsWith(q.ExpressionAttributeValues[':prefix']))).map(([,r])=>structuredClone(r))};}
  assert.equal(name,'TransactWriteCommand');
  if(db.beforeWrite){const hook=db.beforeWrite;db.beforeWrite=null;hook();}
  const targets=q.TransactItems.map(op=>{const x=op.ConditionCheck||op.Put;assert.equal(x.Key===undefined,!!op.Put);return identity(x.TableName,x.Key||itemKey(x.TableName,x.Item));});assert.equal(new Set(targets).size,targets.length,'unique transaction keys');
  for(const op of q.TransactItems){const x=op.ConditionCheck||op.Put;condition(x.TableName,x.Key||itemKey(x.TableName,x.Item),x);}
  for(const op of q.TransactItems)if(op.Put)put(op.Put.TableName,op.Put.Item);
  writes.push(q.TransactItems);if(db.loseReply){db.loseReply=false;throw Error('reply lost');}return {};
 }};
 const staff=id=>create({db,principal:{kind:'STAFF',employeeId:id,authTime:Math.floor(now/1000),mfaEnrolled:true},now:()=>now});
 const owner=sub=>create({db,principal:{kind:'OWNER',subjectId:sub||'owner1'},now:()=>now});
 const input=(overrides={})=>({branchId:'branch1',proposalId:randomUUID(),baseVersion:0,schedule:{timezone:'Asia/Baghdad',frequency:'WEEKLY',anchorLocalDate:'2026-10-01'},agreement:{id:'agreement1',version:1,termsHash:'a'.repeat(64)},effectiveFrom,effectiveTo:null,...overrides});
 const choice=p=>({branchId:p.branchId,proposalId:p.proposalId,proposalDigest:p.proposalDigest});
 async function publish(v=input()) {const proposed=await staff(maker).propose(v);await owner().consent(choice(proposed.proposal));return staff(reviewer).approve(choice(proposed.proposal));}
 return {db,rows,calls,writes,put,get,staff,owner,input,choice,publish,setNow:v=>now=Date.parse(v)};
}

module.exports={fixture};
