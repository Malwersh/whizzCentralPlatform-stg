'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture:schedules}=require('./merchant-settlement-schedule-fixture.cjs'),{proof}=require('./merchant-accrual-fixture.cjs');
const {createMerchantPeriodCollection:create,MERCHANT_ACCRUAL_COVERAGE_KEY}=require('../../dist/merchantPeriodCollection');
const {quoteHash}=require('../../dist/deliveryQuoteRecord');
const {prepareMerchantAccrualIndex}=require('../../dist/merchantAccrualIndex');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const MP='staging-MerchantPlatform';
async function fixture(count=1,zeroLast=false){
 const config=schedules();await config.publish();const {f}=await proof({commission:zeroLast&&count===1?10000:1000});
 for(let n=2;n<=count;n++){const {f:other}=await proof({orderId:'order'+n,commission:zeroLast&&n===count?10000:1000});for(const [k,r]of other.rows){if(r.orderId==='order'+n)f.rows.set(k,structuredClone(r));if(r.kind==='MERCHANT_ACCRUAL_INDEX_HEAD'){const old=f.get(MP,{pk:r.pk,sk:r.sk});f.put(MP,{...r,revision:(old?.revision??0)+r.revision});}}}
 for(const [k,r]of config.rows)f.put(k.split('|')[0],r);
 const employeeId='11111111-1111-4111-8111-111111111111',clock=Date.parse('2026-10-23T00:00:00.000Z');f.put('staging-PlatformStaff',{pk:'EMPLOYEE#'+employeeId,sk:'PROFILE',employeeId,roles:['finance_operator','finance_approver'],status:'ACTIVE',version:1,scope:{allRegions:true},mfaRequired:true,approvalLimit:1000000});
 const body={...MERCHANT_ACCRUAL_COVERAGE_KEY,kind:'MERCHANT_ACCRUAL_INDEX_COVERAGE',schemaVersion:1,status:'COMPLETE',sourceInventory:'synthetic'};f.put(MP,{...body,digest:quoteHash(body)});
 let lose=null;
 const db={send:async c=>{if(c.constructor.name==='QueryCommand'){const q=c.input;let rows=[...f.rows.entries()].filter(([k,r])=>k.startsWith(q.TableName+'|')&&r.pk===q.ExpressionAttributeValues[':pk']&&(!q.ExpressionAttributeValues[':prefix']||r.sk.startsWith(q.ExpressionAttributeValues[':prefix']))&&(!q.ExpressionAttributeValues[':from']||r.sk>=q.ExpressionAttributeValues[':from']&&r.sk<=q.ExpressionAttributeValues[':until'])).map(([,r])=>r);rows.sort((a,b)=>a.sk.localeCompare(b.sk)*(q.ScanIndexForward===false?-1:1));if(q.ExclusiveStartKey)rows=rows.filter(r=>q.ScanIndexForward===false?r.sk<q.ExclusiveStartKey.sk:r.sk>q.ExclusiveStartKey.sk);const items=rows.slice(0,q.Limit||100);return {Items:structuredClone(items),...(rows.length>items.length?{LastEvaluatedKey:{pk:items.at(-1).pk,sk:items.at(-1).sk}}:{})};}
  const out=await f.db.send(c);if(lose&&c.constructor.name==='TransactWriteCommand'&&c.input.TransactItems.some(o=>o.Put?.Item.kind===lose)){lose=null;throw Error('reply lost after durable commit');}return out;}};
 const principal={employeeId,authTime:clock/1000,mfaEnrolled:true},service=create({db,principal,now:()=>clock}),request={branchId:'branch1',kind:'OPENING',fromLocalDate:'2026-10-01',requestId:randomUUID()};
 const start=()=>service.start(request),advance=r=>service.advance({branchId:r.branchId,collectionId:r.collectionId,version:r.version});
 const ready=async()=>{let {collection:r}=await start();while(r.status==='DISCOVERING')r=(await advance(r)).collection;return r;};
 return {f,db,principal,clock,employeeId,service,start,request,advance,ready,lose:kind=>lose=kind};
}

module.exports={fixture};
