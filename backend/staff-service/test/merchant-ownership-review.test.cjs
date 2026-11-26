'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {createReview}=require('../merchant-ownership-review');

class Get{constructor(input){this.input=input;}}
class Scan{constructor(input){this.input=input;}}
class Write{constructor(input){this.input=input;}}
const now=1_800_000_000_000;
const requestId='12345678-1234-1234-1234-123456789abc';
const organizationId='org';
const actor={employeeId:'reviewer',scope:{allRegions:true}};
const base={organizationId,requestId};
const path='/staff/merchants/ownership-transfer';

function setup(overrides={}){
 const calls=[];
 const row={...base,pk:'ORGANIZATION#org',sk:'OWNERSHIP_TRANSFER',status:'AWAITING_REVIEW',
  version:2,branchIds:['one','two'],expiresAt:now+30000,ownerId:'owner',recipientId:'recipient',...overrides};
 const route=createReview({Get,Write,clock:()=>now,authorize:(staff,permission)=>staff.employeeId==='reviewer'&&permission==='merchants.review'});
 return {route,calls,ctx:{
  query:base,
  db:{send:async command=>{calls.push(command);return command instanceof Get?{Item:row}:{};}},
  guard:()=>({ConditionCheck:{TableName:'staff'}}),
  audit:(actorId,action,before,after)=>({Put:{TableName:'audit',Item:{actorId,action,before,after}}}),
 }};
}

test('review lookup requires global merchant review authority and redacts personal identities',async()=>{
 const {route,ctx,calls}=setup();
 await assert.rejects(route(ctx,{...actor,scope:{allRegions:false}},'GET',path),/PERMISSION_REQUIRED/);
 assert.equal(calls.length,0);
 const result=await route(ctx,actor,'GET',path);
 assert.equal(result.canReject,true);
 assert.equal(result.request.ownerId,undefined);
 assert.deepEqual(result.request.branchIds,['one','two']);
});

test('active queue lists names and statuses without exposing account identities',async()=>{
 const calls=[];
 const row={...base,pk:'ORGANIZATION#org',sk:'OWNERSHIP_TRANSFER',
  status:'AWAITING_RECIPIENT',branchIds:['one'],createdAt:now-100,ownerId:'private'};
 const cursor={pk:'PERSON#test',sk:'PROFILE'};
 const route=createReview({Get,Scan,clock:()=>now,authorize:()=>true});
 const ctx={query:{view:'active'},db:{send:async command=>{
  calls.push(command);
  if(command instanceof Get)return {Item:{organizationId,businessName:'مطعم الاختبار'}};
  return command.input.ExclusiveStartKey?{Items:[row]}:{Items:[],LastEvaluatedKey:cursor};
 }}};
 await assert.rejects(route(ctx,{...actor,scope:{allRegions:false}},'GET',path),/PERMISSION_REQUIRED/);
 assert.equal(calls.length,0);
 const result=await route(ctx,actor,'GET',path);
 assert.equal(calls[0].input.ExpressionAttributeValues[':now'],now);
 assert.deepEqual(calls[1].input.ExclusiveStartKey,cursor);
 assert.deepEqual(result,{requests:[{...base,status:'AWAITING_RECIPIENT',
  businessName:'مطعم الاختبار',branchCount:1,createdAt:now-100}],nextCursor:null});
});

test('request detail supplies names for branches still attached to its organization',async()=>{
 const {route,ctx}=setup({status:'AWAITING_RECIPIENT'});
 const get=ctx.db.send;
 ctx.db.send=async command=>{
  if(command.input.Key.businessId==='one')return {Item:{organizationId,businessName:'فرع الاختبار'}};
  if(command.input.Key.businessId==='two')return {Item:{organizationId:'other',businessName:'اسم خاص'}};
  return get(command);
 };
 const result=await route(ctx,actor,'GET',path);
 assert.deepEqual(result.request.branchNames,['فرع الاختبار',null]);
 assert.equal(result.canPreflight,false);
});

test('rejects version conflicts without changing the request or branches',async()=>{
 const {route,ctx,calls}=setup();
 await assert.rejects(route(ctx,actor,'POST',path+'/reject',{...base,baseVersion:1,reason:'Administrative review'}),/VERSION_OR_STATE_CONFLICT/);
 assert.equal(calls.length,1);
});

test('rejection, removal of matching pauses and audit share one transaction',async()=>{
 const {route,ctx,calls}=setup();
 const result=await route(ctx,actor,'POST',path+'/reject',{...base,baseVersion:2,reason:'Administrative review'});
 assert.equal(result.request.status,'REJECTED');
 assert.equal(result.canReject,false);
 const items=calls.at(-1).input.TransactItems;
 assert.equal(items[1].Put.Item.version,3);
 assert.deepEqual(items.slice(2,4).map(({Update})=>Update.Key.businessId),['one','two']);
 assert.ok(items.slice(2,4).every(({Update})=>Update.ConditionExpression==='orderIntakeTransferRequestId=:request'));
 assert.equal(items[4].Put.Item.action,'MERCHANT_OWNERSHIP_TRANSFER_REJECTED');
});

test('expired requests are visible with no decision action',async()=>{
 const {route,ctx}=setup({expiresAt:now});
 const result=await route(ctx,actor,'GET',path);
 assert.equal(result.request.status,'EXPIRED');
 assert.equal(result.canReject,false);
});

test('approval stays disabled without the deployment switch even for authorized staff',async()=>{
 const {ctx}=setup();
 const route=createReview({Get,Write,clock:()=>now,authorize:()=>true,approvalEnabled:()=>false});
 const result=await route(ctx,actor,'GET',path);
 assert.equal(result.canApprove,false);
 await assert.rejects(route(ctx,actor,'POST',path+'/approve',{...base,baseVersion:2,reason:'Approve reviewed transfer'}),/TRANSFER_APPROVAL_UNAVAILABLE/);
});

test('staging execution is restricted to the configured request',async t=>{
 const keys=['PLATFORM_ENVIRONMENT','MERCHANT_OWNERSHIP_EXECUTION_ENABLED','MERCHANT_OWNERSHIP_EXECUTION_REQUEST_ID'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 t.after(()=>{
  for(const key of keys){
   if(previous[key]===undefined)delete process.env[key];
   else process.env[key]=previous[key];
  }
 });
 const {ctx}=setup();
 const route=createReview({Get,Write,clock:()=>now,authorize:()=>true});
 process.env.PLATFORM_ENVIRONMENT='staging';
 process.env.MERCHANT_OWNERSHIP_EXECUTION_ENABLED='true';
 delete process.env.MERCHANT_OWNERSHIP_EXECUTION_REQUEST_ID;
 assert.equal((await route(ctx,actor,'GET',path)).executionAvailable,false);
 process.env.MERCHANT_OWNERSHIP_EXECUTION_REQUEST_ID='12345678-1234-1234-1234-123456789abd';
 assert.equal((await route(ctx,actor,'GET',path)).executionAvailable,false);
 await assert.rejects(route(ctx,actor,'POST',path+'/approve',{...base,baseVersion:2,reason:'Approve reviewed transfer'}),/TRANSFER_APPROVAL_UNAVAILABLE/);
 process.env.MERCHANT_OWNERSHIP_EXECUTION_REQUEST_ID=requestId;
 assert.equal((await route(ctx,actor,'GET',path)).executionAvailable,true);
 process.env.PLATFORM_ENVIRONMENT='production';
 assert.equal((await route(ctx,actor,'GET',path)).executionAvailable,false);
});

test('approval requires a recent financial reviewer and forwards the stored request',async()=>{
 const {ctx,calls}=setup();
 const input={...base,baseVersion:2,reason:'Approve reviewed transfer'};
 const sequence=[];
 const route=createReview({
  Get,Write,clock:()=>now,authorize:()=>true,approvalEnabled:()=>true,
  notifyCompletion:async request=>{
   assert.equal(request.status,'COMPLETED');
   sequence.push('notify');
   return true;
  },
  approve:async(_ctx,staff,row,reason)=>{
   assert.equal(staff.employeeId,actor.employeeId);
   assert.equal(row.requestId,requestId);
   assert.equal(reason,input.reason);
   sequence.push('commit');
   return {...row,status:'COMPLETED',version:3};
  },
 });
 await assert.rejects(route({...ctx,authenticatedAt:now/1000-301},actor,'POST',path+'/approve',input),/REAUTH_REQUIRED/);
 const result=await route({...ctx,authenticatedAt:now/1000},actor,'POST',path+'/approve',input);
 assert.equal(result.request.status,'COMPLETED');
 assert.equal(result.notificationsQueued,true);
 assert.deepEqual(sequence,['commit','notify']);
 assert.ok(calls.every(call=>call instanceof Get));
});

test('financial reviewer can approve the settlement destination while final ownership commit remains disabled',async()=>{
 const {ctx}=setup();
 const route=createReview({
  Get,Write,clock:()=>now,authorize:()=>true,approvalEnabled:()=>false,settlementEnabled:()=>true,
  approveSettlement:async(_ctx,_actor,row)=>{assert.equal(row.requestId,requestId);return {status:'APPROVED'};},
 });
 const result=await route({...ctx,authenticatedAt:now/1000},actor,'POST',path+'/approve-settlement',{...base,baseVersion:2,reason:'Finance destination reviewed'});
 assert.equal(result.settlement.status,'APPROVED');
 assert.equal(result.canApprove,false);
 assert.equal(result.request.status,'AWAITING_REVIEW');
});

test('approval preflight reports the request-level settlement condition alongside branch checks',async()=>{
 const {ctx}=setup({digest:'scope'});
 const original=ctx.db.send;
 let verified=false,approved=false;
 ctx.db.send=async command=>{
  const key=command.input.Key;
  if(key.sk==='PROFILE')return {Item:{subjectId:'recipient',version:1}};
  if(key.sk==='OWNERSHIP_TRANSFER_DESTINATION#'+requestId)return verified?{Item:{
   kind:'OWNERSHIP_TRANSFER_DESTINATION',status:'VERIFIED',requestId,recipientId:'recipient',
   scopeDigest:'scope',profileVersion:1,version:1,expiresAt:now+30000,
  }}:{};
  if(key.sk==='OWNERSHIP_TRANSFER_SETTLEMENT#'+requestId)return approved?{Item:{
   kind:'OWNERSHIP_TRANSFER_SETTLEMENT',status:'APPROVED',requestId,recipientId:'recipient',
   scopeDigest:'scope',profileVersion:1,proofVersion:1,version:1,
  }}:{};
  return original(command);
 };
 const route=createReview({
  Get,clock:()=>now,authorize:()=>true,approvalEnabled:()=>true,settlementEnabled:()=>true,
  readPreflight:async()=>({branches:[{name:'مطعم فتوش',blockers:[]}],checkedAt:now}),
 });
 const check=()=>route(ctx,actor,'GET',path+'/preflight');
 let result=await check();
 assert.deepEqual(result.requestBlockers,[{code:'TRANSFER_DESTINATION_VERIFICATION_REQUIRED'}]);
 assert.equal(result.canApprove,false);
 verified=true;
 result=await check();
 assert.deepEqual(result.requestBlockers,[{code:'TRANSFER_SETTLEMENT_APPROVAL_REQUIRED'}]);
 assert.equal(result.canApproveSettlement,true);
 approved=true;
 result=await check();
 assert.deepEqual(result.requestBlockers,[]);
 assert.equal(result.canApprove,true);
});

test('staging approval accepts a valid session under the configured policy',async t=>{
 const environment=process.env.PLATFORM_ENVIRONMENT;
 const policy=process.env.PLATFORM_SESSION_POLICY;
 t.after(()=>{
  if(environment===undefined)delete process.env.PLATFORM_ENVIRONMENT;
  else process.env.PLATFORM_ENVIRONMENT=environment;
  if(policy===undefined)delete process.env.PLATFORM_SESSION_POLICY;
  else process.env.PLATFORM_SESSION_POLICY=policy;
 });
 process.env.PLATFORM_ENVIRONMENT='staging';
 process.env.PLATFORM_SESSION_POLICY='VALID_SESSION';
 const {ctx}=setup();
 const route=createReview({
  Get,Write,clock:()=>now,authorize:()=>true,approvalEnabled:()=>true,
  notifyCompletion:async()=>true,
  approve:async(_ctx,_actor,row)=>({...row,status:'COMPLETED',version:3}),
 });
 const input={...base,baseVersion:2,reason:'Approve reviewed transfer'};
 const result=await route({...ctx,authenticatedAt:now/1000-7200},actor,'POST',path+'/approve',input);
 assert.equal(result.request.status,'COMPLETED');
 await assert.rejects(route({...ctx,authenticatedAt:now/1000+60},actor,'POST',path+'/approve',input),/REAUTH_REQUIRED/);
});
