'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {proof}=require('./merchant-accrual-fixture.cjs');
const {createMerchantSettlementBatchService:create}=require('../../dist/merchantSettlementBatch');
const {createMerchantSettlementPreviewReader}=require('../../dist/merchantSettlementPreview');
const {exactCheck}=require('../../dist/driverFinancialTransaction');
const MP='staging-MerchantPlatform',STAFF='staging-PlatformStaff';
const schedule={schemaVersion:1,version:1,frequency:'WEEKLY',anchorLocalDate:'2026-10-01',timezone:'Asia/Baghdad'};
const roleKey={pk:'STAFF#finance1',sk:'AUTH'},scheduleKey={pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CURRENT'};
const at='2026-10-15T12:00:00.000Z';
async function fixture(count=1,proofOptions={}){
 const {f}=await proof(proofOptions);
 for(let n=2;n<=count;n++){
  const other=await proof({orderId:'order'+n});
  for(const [key,row] of other.f.rows)if(row.orderId==='order'+n)f.rows.set(key,structuredClone(row));
 }
 f.put(STAFF,{...roleKey,subjectId:'finance1',status:'ACTIVE',version:1});
 f.put(MP,{...scheduleKey,enabled:true,version:1,schedule});
 let clock=Date.parse('2026-10-23T00:00:00.000Z'),loseResponse=false,offline=false,actor='finance1',authorizationCalls=0,queryHook=null,readOutage=false,failReadsAfterLost=false;
 const authorize=async(branchId,action)=>{
  authorizationCalls++;assert.ok(['CREATE','READ'].includes(action));
  const role=f.get(STAFF,roleKey);if(role.status!=='ACTIVE'||branchId!=='branch1')throw Error('FORBIDDEN');
  return {branchId,actorId:actor,guards:[exactCheck(STAFF,roleKey,role)]};
 };
 const readSchedule=async()=>{const row=f.get(MP,scheduleKey);return row.enabled?{schedule:row.schedule,guard:exactCheck(MP,{...scheduleKey},row)}:null;};
 const db={send:async command=>{
  if(readOutage&&command.constructor.name==='GetCommand')throw Error('Read connection unavailable');
  if(command.constructor.name==='QueryCommand'){
   f.calls.push(command);const q=command.input;assert.equal(q.TableName,MP);assert.equal(q.ConsistentRead,true);assert.equal(q.ScanIndexForward,false);
   const all=[...f.rows.values()].filter(row=>row.pk===q.ExpressionAttributeValues[':pk']&&row.sk.startsWith(q.ExpressionAttributeValues[':prefix'])&&(!q.ExclusiveStartKey||row.sk<q.ExclusiveStartKey.sk)).sort((a,b)=>b.sk.localeCompare(a.sk));
   const items=all.slice(0,q.Limit),last=all.length>q.Limit?{pk:items.at(-1).pk,sk:items.at(-1).sk}:undefined;
   const result={Items:structuredClone(items),...(last?{LastEvaluatedKey:last}:{})};if(queryHook)queryHook(result);return result;
  }
  if(offline&&command.constructor.name==='TransactWriteCommand')throw Error('Offline');
  const result=await f.db.send(command);
  if(loseResponse&&command.input.TransactItems?.some(op=>op.Put?.Item.kind==='MERCHANT_SETTLEMENT_BATCH')){loseResponse=false;readOutage=failReadsAfterLost;throw Error('Response lost after commit');}
  return result;
 }};
 const service=create({db,authorizeBranch:authorize,readSchedule,now:()=>clock});
 const preview=createMerchantSettlementPreviewReader({db,authorizeBranch:async branch=>{await authorize(branch,'READ');},readSchedule:async()=> (await readSchedule())?.schedule||null});
 const request=async(orderIds=['order1'])=>({branchId:'branch1',requestId:randomUUID(),orderIds,at,previewId:(await preview.preview({branchId:'branch1',orderIds,at})).previewId});
 return {f,db,service,request,readSchedule,authorize,setReadOutage:v=>readOutage=v,setQueryHook:v=>queryHook=v,setActor:v=>actor=v,setClock:v=>clock=Date.parse(v),lose:(alsoReads=false)=>{loseResponse=true;failReadsAfterLost=alsoReads;},offline:()=>offline=true,authorizationCalls:()=>authorizationCalls};
}
module.exports={fixture};
