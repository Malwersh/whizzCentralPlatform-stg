'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./helpers/merchant-settlement-schedule-fixture.cjs');
const {proof}=require('./helpers/merchant-accrual-fixture.cjs');
const {createMerchantStatementsAdmin:create}=require('../dist/merchantStatementsAdmin');
async function admin(){
 const s=fixture();await s.publish();const {f}=await proof();
 for(const [key,row]of s.rows){const table=key.split('|')[0];f.put(table,row);}
 const employeeId='11111111-1111-4111-8111-111111111111',clock=Date.parse('2026-10-23T00:00:00.000Z');
 f.put('staging-PlatformStaff',{pk:'EMPLOYEE#'+employeeId,sk:'PROFILE',employeeId,roles:['finance_operator','finance_approver'],status:'ACTIVE',version:1,scope:{allRegions:true},mfaRequired:true});
 const db={send:async c=>{if(c.constructor.name==='QueryCommand'){const q=c.input;return {Items:[...f.rows.entries()].filter(([key,r])=>key.startsWith(q.TableName+'|')&&r.pk===q.ExpressionAttributeValues[':pk']&&r.sk.startsWith(q.ExpressionAttributeValues[':prefix'])).map(([,r])=>structuredClone(r))};}const sdk=require('@aws-sdk/lib-dynamodb');return f.db.send(new sdk[c.constructor.name](c.input));}};
 const service=create({db,now:()=>clock,principal:{employeeId,authTime:clock/1000,mfaEnrolled:true}});return {f,db,service,employeeId};
}
test('verified staff previews opening rights then freezes once; saved statement remains unpaid',async()=>{
 const {service}=await admin(),p=await service.preview({kind:'OPENING',fromLocalDate:'2026-10-01',branchId:'branch1',orderIds:['order1']});
 assert.equal(p.periodClosed,true);assert.equal(p.period.untilExclusiveUtc,'2026-10-21T21:00:00.000Z');assert.equal(p.summary.amounts.merchantNet.minorAmount,9000000);
 const r=await service.create({...p.request,requestId:randomUUID()});assert.equal(r.header.payoutAuthorized,false);
 await assert.rejects(service.preview({kind:'OPENING',fromLocalDate:'2026-10-01',branchId:'branch1',orderIds:['order1']}),/ALREADY_IN_SETTLEMENT/);
});
test('preview refuses untrusted fields, foreign branch and revoked finance authority',async()=>{
 const {service,f,employeeId}=await admin(),v={kind:'OPENING',fromLocalDate:'2026-10-01',branchId:'branch1',orderIds:['order1']};
 await assert.rejects(service.preview({...v,amount:1}));await assert.rejects(service.preview({...v,branchId:'foreign'}));
 f.get('staging-PlatformStaff',{pk:'EMPLOYEE#'+employeeId,sk:'PROFILE'}).status='DISABLED';await assert.rejects(service.preview(v));
});

test('staff HTTP adapter uses projected proof reads and never accepts a client authority',async()=>{
 const {staff}=require('../../staff-service/settlement-schedules'),{db,employeeId}=await admin();
 const clock=Date.parse('2026-10-23T00:00:00.000Z'),savedNow=Date.now;Date.now=()=>clock;
 try{
  const ctx={db,enabled:true,claims:{auth_time:clock/1000},enrolled:true},actor={employeeId,roles:['finance_operator','finance_approver'],scope:{allRegions:true}};
  const p=await staff(ctx,actor,'POST',{action:'PREVIEW_STATEMENT',kind:'OPENING',fromLocalDate:'2026-10-01',branchId:'branch1',orderIds:['order1']});
  const r=await staff(ctx,actor,'POST',{action:'CREATE_STATEMENT',...p.request,requestId:randomUUID()});assert.equal(r.header.payoutAuthorized,false);
  const list=await staff(ctx,actor,'GET',{view:'batches',branchId:'branch1',limit:'20'});assert.equal(list.items.length,1);
  await assert.rejects(staff(ctx,actor,'POST',{action:'PREVIEW_STATEMENT',kind:'OPENING',fromLocalDate:'2026-10-01',branchId:'branch1',orderIds:['order1'],actorId:'other'}));
 }finally{Date.now=savedNow;}
});
test('same authorized administrator freezes and approves with immutable audit, without payment or a second employee',async()=>{
 const {service,f}=await admin(),p=await service.preview({kind:'OPENING',fromLocalDate:'2026-10-01',branchId:'branch1',orderIds:['order1']});
 const r=await service.create({...p.request,requestId:randomUUID()}),v={branchId:'branch1',batchId:r.header.batchId,batchDigest:r.header.batchDigest};
 const before=JSON.stringify([...f.rows].filter(([k])=>/^(staging-Wallets|staging-LedgerEntries)\|/.test(k)));
 const a=await service.approve(v);assert.equal(a.approval.approvedBy,r.header.createdBy);assert.equal(a.approval.status,'APPROVED_NOT_PAID');assert.equal(a.approval.payoutAuthorized,false);
 assert.equal((await service.approve(v)).replayed,true);assert.equal([...f.rows.values()].filter(x=>x.action==='MERCHANT_STATEMENT_APPROVED').length,1);
 const list=await service.list({branchId:'branch1',limit:20});assert.equal(list.items[0].approvalStatus,'APPROVED_NOT_PAID');
 assert.equal(JSON.stringify([...f.rows].filter(([k])=>/^(staging-Wallets|staging-LedgerEntries)\|/.test(k))),before);
});
test('preparer without finance approval cannot approve, and a changed batch digest is rejected',async()=>{
 const {service,f,employeeId}=await admin(),p=await service.preview({kind:'OPENING',fromLocalDate:'2026-10-01',branchId:'branch1',orderIds:['order1']}),r=await service.create({...p.request,requestId:randomUUID()});
 const v={branchId:'branch1',batchId:r.header.batchId,batchDigest:r.header.batchDigest};
 f.get('staging-PlatformStaff',{pk:'EMPLOYEE#'+employeeId,sk:'PROFILE'}).roles=['finance_operator'];await assert.rejects(service.approve(v),/PERMISSION_REQUIRED/);
 f.get('staging-PlatformStaff',{pk:'EMPLOYEE#'+employeeId,sk:'PROFILE'}).roles=['finance_operator','finance_approver'];await assert.rejects(service.approve({...v,batchDigest:'b'.repeat(64)}),/PREVIEW_CHANGED/);
 assert.equal([...f.rows.values()].some(x=>x.kind==='MERCHANT_STATEMENT_APPROVAL'),false);
});
