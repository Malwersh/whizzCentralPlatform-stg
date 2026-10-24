'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./helpers/merchant-settlement-schedule-fixture.cjs'),{proof}=require('./helpers/merchant-accrual-fixture.cjs');
const {createMerchantStatementsAdmin}=require('../dist/merchantStatementsAdmin');
const {createMerchantPayoutApi}=require('../dist/merchantPayoutApi');
const {staff}=require('../../staff-service/settlement-schedules');
const {handle}=require('../../staff-service/commercial-owner');
async function setup(){
 const s=fixture();await s.publish();const {f}=await proof();for(const [key,row]of s.rows)f.put(key.split('|')[0],row);
 const employeeId='11111111-1111-4111-8111-111111111111',clock=Date.parse('2026-10-23T00:00:00Z'),ownerId=f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).ownerId;
 f.put('staging-PlatformStaff',{pk:'EMPLOYEE#'+employeeId,sk:'PROFILE',employeeId,roles:['finance_operator','finance_approver'],status:'ACTIVE',version:1,scope:{allRegions:true},mfaRequired:true,approvalLimit:1000000});
 const db={send:async c=>{if(c.constructor.name==='QueryCommand'){const q=c.input;return {Items:[...f.rows.entries()].filter(([k,r])=>k.startsWith(q.TableName+'|')&&(q.TableName==='staging-LedgerEntries'?r.walletId===q.ExpressionAttributeValues[':wallet']:r.pk===q.ExpressionAttributeValues[':pk'])&&(!q.ExpressionAttributeValues[':from']||(r.sk>=q.ExpressionAttributeValues[':from']&&r.sk<=q.ExpressionAttributeValues[':until']))&&(!q.ExpressionAttributeValues[':prefix']||r.sk.startsWith(q.ExpressionAttributeValues[':prefix']))).slice(0,q.Limit||100).map(([,r])=>structuredClone(r))};}const sdk=require('@aws-sdk/lib-dynamodb');return f.db.send(new sdk[c.constructor.name](c.input));}};
 f.put('staging-MerchantPlatform',{pk:'MERCHANT_CASHBOXES#GLOBAL',sk:'BOX#CASH-DESK-01',kind:'MERCHANT_CASHBOX',code:'CASH-DESK-01',name:'صندوق الاختبار',custodian:'أمين الاختبار',location:'بغداد',status:'ACTIVE',version:1});
 require('./helpers/cashbox-accounting-251-seed.cjs').seed(f,'CASH-DESK-01',employeeId);
 const principal={employeeId,authTime:clock/1000,mfaEnrolled:true},statements=createMerchantStatementsAdmin({db,now:()=>clock,principal});const preview=await statements.preview({kind:'OPENING',fromLocalDate:'2026-10-01',branchId:'branch1',orderIds:['order1']}),saved=await statements.create({...preview.request,requestId:randomUUID()});await statements.approve({branchId:'branch1',batchId:saved.header.batchId,batchDigest:saved.header.batchDigest});
 return {f,db,clock,principal,ownerId,employeeId,saved,ctx:{db,enabled:true,claims:{auth_time:clock/1000},enrolled:true},actor:{employeeId}};
}
test('actual staff and owner HTTP adapters use existing route, verified ownership and named projections through final paid proof',async()=>{
 const s=await setup(),old=Date.now;Date.now=()=>s.clock;
 try{
  const ctx={...s.ctx,verify:async token=>{assert.equal(token,'synthetic-live-owner');return {sub:s.ownerId,auth_time:s.clock/1000};},cognito:{send:async()=>({UserAttributes:[{Name:'sub',Value:s.ownerId},{Name:'phone_number_verified',Value:'true'}]})}};
  const owner=async(method,input)=>{const r=await handle(ctx,{action:'settlement_schedule_owner',httpMethod:method,accessToken:'synthetic-live-owner',input});assert.equal(r.statusCode,200,JSON.stringify(r));return r.result;};
  const listings=await owner('GET',{view:'payout-statements',branchId:'branch1'});assert.equal(listings.items[0].approved,true);
  let p=(await owner('POST',{action:'REQUEST_PAYOUT',branchId:'branch1',batchId:s.saved.header.batchId,batchDigest:s.saved.header.batchDigest,method:'CASH',requestId:randomUUID()})).payout;
  const admin=async(action,extra={})=>{const r=await staff(s.ctx,s.actor,'POST',{action,branchId:'branch1',payoutId:p.payoutId,version:p.version,requestId:randomUUID(),...extra});p=r.payout;return r;};
  await admin('APPROVE_PAYOUT');await admin('BEGIN_PAYOUT');await admin('RECORD_PAYOUT_EXECUTION',{cashboxId:'CASH-DESK-01',actualAmount:p.amount.minorAmount/1000,destinationConfirmed:true});
  p=(await owner('POST',{action:'ACK_PAYOUT_RECEIPT',branchId:'branch1',payoutId:p.payoutId,version:p.version,requestId:randomUUID(),accepted:true,receivedAmount:p.amount.minorAmount/1000})).payout;await admin('RECONCILE_PAYOUT');assert.equal(p.status,'PAID');
  await require('../../staff-service/settlement-runtime').readMerchantAccrualEvidence(require('../../staff-service/settlement-orders').projectEvidenceDb(s.db),'branch1','order1');
  const orders=await staff(s.ctx,s.actor,'GET',{view:'orders',branchId:'branch1'});assert.equal(orders.items[0].status,'PAID');assert.equal(orders.items[0].evidenceVerified,true);
  const statements=await staff(s.ctx,s.actor,'GET',{view:'batches',branchId:'branch1',limit:'20'});assert.equal(statements.items[0].paymentStatus,'PAID');
  const paidDetail=await owner('GET',{view:'payout-statement',branchId:'branch1',batchId:s.saved.header.batchId});assert.equal(paidDetail.paymentStatus,'PAID');assert.equal(paidDetail.lines.length,1);assert.equal(paidDetail.generatedAt,new Date(s.clock).toISOString());
  assert.equal((await owner('GET',{view:'payout-statements',branchId:'branch1'})).items[0].payoutStatus,'PAID');
  const account=await owner('GET',{view:'merchant-account',branchId:'branch1',fromLocalDate:'2026-10-01',throughLocalDate:'2026-10-31'});assert.equal(account.items.filter(r=>r.kind==='PAYOUT').length,1);assert.equal(account.items.find(r=>r.kind==='ORDER_ACCRUAL').state,'PAID');assert.ok(account.items.every(r=>r.evidenceVerified));
  // A paid claim alone is not evidence: every list must reject the same defects as details.
  const api=createMerchantPayoutApi({db:s.db,now:()=>s.clock,owner:{subjectId:s.ownerId,authTime:s.clock/1000,revalidate:async()=>{}}});
  const readPaidLists=async()=>{
   await assert.rejects(staff(s.ctx,s.actor,'GET',{view:'batches',branchId:'branch1',limit:'20'}),/PAID_PROOF/);
   await assert.rejects(api.statements('branch1'),/PAID_PROOF/);
   await assert.rejects(api.list({branchId:'branch1'}),/PAID_PROOF/);
   await assert.rejects(api.details({branchId:'branch1',payoutId:p.payoutId}),/PAID_PROOF/);
   await assert.rejects(api.statement({branchId:'branch1',batchId:s.saved.header.batchId}),/PAID_PROOF/);
  };
  const journalKey={pk:'MERCHANT_PAYOUT_PAID#'+p.payoutId,sk:'META'},claimKey={pk:'MERCHANT_PAYOUT#branch1',sk:'BATCH#'+s.saved.header.batchId};
  const originalJournal=structuredClone(s.f.get('staging-MerchantPlatform',journalKey)),originalClaim=structuredClone(s.f.get('staging-MerchantPlatform',claimKey)),originalPayable=structuredClone(s.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}));
  const cases=[
   ()=>{s.f.get('staging-MerchantPlatform',journalKey).digest='broken';},
   ()=>{s.f.get('staging-MerchantPlatform',claimKey).paidAt='2020-01-01T00:00:00.000Z';},
   ()=>{s.f.get('staging-MerchantPlatform',claimKey).amount.minorAmount++;},
   ()=>{s.f.get('staging-MerchantPlatform',claimKey).branchId='foreign';},
   ()=>{s.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).amount++;},
   ()=>{s.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).status='LOCKED_PENDING_SETTLEMENT';}
  ];
  for(const corrupt of cases){
   corrupt();const before=JSON.stringify([...s.f.rows]);await readPaidLists();assert.equal(JSON.stringify([...s.f.rows]),before,'proof failure must not repair or mutate money');
   s.f.put('staging-MerchantPlatform',structuredClone(originalJournal));s.f.put('staging-MerchantPlatform',structuredClone(originalClaim));s.f.put('staging-Holds',structuredClone(originalPayable));
  }
  assert.equal((await api.statements('branch1')).items[0].payoutStatus,'PAID');
  assert.equal((await api.list({branchId:'branch1'})).items[0].status,'PAID');
  const paidResponse=await api.details({branchId:'branch1',payoutId:p.payoutId});assert.equal(paidResponse.payout.status,'PAID');assert.equal(paidResponse.generatedAt,new Date(s.clock).toISOString());
 }finally{Date.now=old;}
});
test('live owner revalidation, owner freshness, foreign ownership, viewer permissions and approval limit are enforced by production adapters',async()=>{
 const s=await setup(),base={db:s.db,now:()=>s.clock};let revoked=false;
 const own=createMerchantPayoutApi({...base,owner:{subjectId:s.ownerId,authTime:s.clock/1000,revalidate:async()=>{if(revoked)throw Error('UNAUTHORIZED');}}});const req={action:'REQUEST_PAYOUT',branchId:'branch1',batchId:s.saved.header.batchId,batchDigest:s.saved.header.batchDigest,method:'CASH',requestId:randomUUID()};
 const stale=createMerchantPayoutApi({...base,owner:{subjectId:s.ownerId,authTime:s.clock/1000-301,revalidate:async()=>{}}});await assert.rejects(stale.act(req),/REAUTH/);const stranger=createMerchantPayoutApi({...base,owner:{subjectId:'foreign',authTime:s.clock/1000,revalidate:async()=>{}}});await assert.rejects(stranger.statements('branch1'),/OWNER/);
 revoked=true;await assert.rejects(own.act(req),/UNAUTHORIZED/);revoked=false;const p=(await own.act(req)).payout;
 const profile=s.f.get('staging-PlatformStaff',{pk:'EMPLOYEE#'+s.employeeId,sk:'PROFILE'}),admin=createMerchantPayoutApi({...base,staff:s.principal}),approve={action:'APPROVE_PAYOUT',branchId:'branch1',payoutId:p.payoutId,version:p.version,requestId:randomUUID()};profile.approvalLimit=1;await assert.rejects(admin.act(approve),/LIMIT/);profile.approvalLimit=1000000;profile.roles=['finance_viewer'];await assert.rejects(admin.act(approve),/PERMISSION/);
});

test('saved statement detail exposes complete frozen merchant lines and refuses foreign ownership and tampered source without writing',async()=>{
 const s=await setup(),old=Date.now;Date.now=()=>s.clock;
 try{
  const api=createMerchantPayoutApi({db:s.db,now:()=>s.clock,owner:{subjectId:s.ownerId,authTime:s.clock/1000,revalidate:async()=>{}}});
  const before=JSON.stringify([...s.f.rows.entries()]);const detail=await api.statement({branchId:'branch1',batchId:s.saved.header.batchId});
  assert.equal(detail.coverage,'COMPLETE_SAVED_STATEMENT');assert.equal(detail.lines.length,detail.summary.accrualCount);assert.equal(detail.lines[0].amounts.merchantNet.minorAmount,detail.summary.amounts.merchantNet.minorAmount);assert.equal(detail.paymentStatus,'UNPAID');assert.equal(detail.walletMutationPerformed,false);assert.equal(detail.lines[0].amounts.driverTip,undefined);assert.equal(detail.lines[0].agreement,undefined);assert.equal(JSON.stringify([...s.f.rows.entries()]),before);
  const fromRoute=await staff(s.ctx,s.actor,'GET',{view:'payout-statement',branchId:'branch1',batchId:s.saved.header.batchId});assert.deepEqual(fromRoute,detail);
  const stranger=createMerchantPayoutApi({db:s.db,now:()=>s.clock,owner:{subjectId:'foreign',authTime:s.clock/1000,revalidate:async()=>{}}});await assert.rejects(stranger.statement({branchId:'branch1',batchId:s.saved.header.batchId}),/OWNER/);
  await assert.rejects(api.statement({branchId:'branch1',batchId:s.saved.header.batchId,amount:1}),/INVALID/);
  s.f.put('staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT#branch1',sk:'BATCH#'+s.saved.header.batchId,status:'PAID',payoutId:'MPO:'+'a'.repeat(48)});
  await assert.rejects(api.statement({branchId:'branch1',batchId:s.saved.header.batchId}),/PAID_PROOF/);
  const line=[...s.f.rows.entries()].find(([,r])=>r.kind==='MERCHANT_SETTLEMENT_LINE');line[1].accrual.amounts.merchantNet.minorAmount++;
  await assert.rejects(api.statement({branchId:'branch1',batchId:s.saved.header.batchId}),/PROOF/);
 }finally{Date.now=old;}
});

test('merchant account production routes show verified current accruals with merchant privacy and Baghdad date validation, without a saved statement requirement',async()=>{
 const s=await setup(),old=Date.now;Date.now=()=>s.clock;
 try{
  const input={view:'merchant-account',branchId:'branch1',fromLocalDate:'2026-10-01',throughLocalDate:'2026-10-31'};
  for(const [key,row] of s.f.rows)if(row.pk==='MERCHANT_SETTLEMENT#branch1')s.f.rows.delete(key);
  const payable=s.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'});for(const key of ['settlementBatchId','settlementLineDigest','settlementClaimedAt'])delete payable[key];
  const result=await staff(s.ctx,s.actor,'GET',input);assert.equal(result.coverage,'POSTED_MERCHANT_LEDGER_MOVEMENTS');assert.equal(result.items.filter(r=>r.evidenceVerified).length,1);assert.equal(result.items[0].kind,'ORDER_ACCRUAL');assert.equal(result.items[0].state,'PENDING_SETTLEMENT');assert.equal(result.walletMutationPerformed,false);
  const ctx={...s.ctx,verify:async()=>({sub:s.ownerId,auth_time:s.clock/1000}),cognito:{send:async()=>({UserAttributes:[{Name:'sub',Value:s.ownerId},{Name:'phone_number_verified',Value:'true'}]})}};
  const own=await handle(ctx,{action:'settlement_schedule_owner',httpMethod:'GET',accessToken:'synthetic-owner',input});assert.equal(own.statusCode,200,JSON.stringify(own));assert.equal(own.result.items[0].amounts.driverWalletHold,undefined);assert.equal(own.result.items[0].amounts.platformNetContribution,undefined);assert.ok(own.result.items[0].amounts.merchantNet);
  const bounds=require('../../staff-service/merchant-account').bounds;
  const {view,...filter}=input;assert.deepEqual(bounds(filter),{from:'2026-09-30T21:00:00.000Z',until:'2026-10-31T21:00:00.000Z'});
  assert.throws(()=>bounds({...filter,fromLocalDate:'2026-02-30'}),/INVALID_FILTER/);assert.throws(()=>bounds({...filter,throughLocalDate:'2025-01-01'}),/INVALID_FILTER/);assert.throws(()=>bounds({...filter,throughLocalDate:'2028-01-01'}),/INVALID_FILTER/);
 }finally{Date.now=old;}
});

test('account cursors are date and branch bound, wallet changes invalidate pagination, unsupported movements are visible for review',async()=>{
 const s=await setup(),account=require('../../staff-service/merchant-account'),input={branchId:'branch1',fromLocalDate:'2026-10-01',throughLocalDate:'2026-10-31'};
 let first=true;
 const db={send:async command=>{const r=await s.db.send(command);if(command.constructor.name==='QueryCommand'&&command.input.TableName==='staging-LedgerEntries'){
  assert.match(command.input.KeyConditionExpression,/sk BETWEEN/);assert.equal(command.input.ExpressionAttributeValues[':from'],'ts#2026-09-30T21:00:00.000Z');
  if(first){first=false;r.LastEvaluatedKey={walletId:'WALLET#MERCHANT#branch1',sk:r.Items[0].sk};}
 }return r;}};
 const page=await account.read(db,input,true);assert.ok(page.nextCursor);
 await assert.rejects(account.read(db,{...input,fromLocalDate:'2026-10-02',cursor:page.nextCursor},true),/INVALID_CURSOR/);
 const wallet=s.f.get('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META'});wallet.version++;
 await assert.rejects(account.read(db,{...input,cursor:page.nextCursor},true),/ACCOUNT_CHANGED/);
 const unknown={send:async c=>{const r=await s.db.send(c);if(c.constructor.name==='QueryCommand'&&c.input.TableName==='staging-LedgerEntries')r.Items.push({walletId:'WALLET#MERCHANT#branch1',sk:'ts#2026-10-20T00:00:00.000Z#unknown',category:'UNKNOWN_ADJUSTMENT',amount:-100,transactionId:'historical-unknown'});return r;}};
 const review=await account.read(unknown,input,true);assert.equal(review.items.at(-1).kind,'REVIEW_REQUIRED');assert.equal(review.items.at(-1).evidenceVerified,false);assert.equal(review.items.at(-1).amount,undefined);
});


test('staging valid owner session requests payout after five minutes; revoked, future and foreign sessions still fail',async()=>{
 const s=await setup(),env=process.env.PLATFORM_ENVIRONMENT,policy=process.env.PLATFORM_SESSION_POLICY;
 try{
 process.env.PLATFORM_ENVIRONMENT='staging';process.env.PLATFORM_SESSION_POLICY='VALID_SESSION';
 let revoked=false;const owner={subjectId:s.ownerId,authTime:s.clock/1000-7200,revalidate:async()=>{if(revoked)throw Error('UNAUTHORIZED');}};
 const api=createMerchantPayoutApi({db:s.db,now:()=>s.clock,owner}),req={action:'REQUEST_PAYOUT',branchId:'branch1',batchId:s.saved.header.batchId,batchDigest:s.saved.header.batchDigest,method:'CASH',requestId:randomUUID()};
 revoked=true;await assert.rejects(api.act(req),/UNAUTHORIZED/);revoked=false;
 for(const bad of [{...owner,subjectId:'foreign'},{...owner,authTime:s.clock/1000+60}])await assert.rejects(createMerchantPayoutApi({db:s.db,now:()=>s.clock,owner:bad}).act(req),/OWNER|REAUTH/);
 const result=await api.act(req);assert.equal(result.payout.status,'UNDER_REVIEW');
 process.env.PLATFORM_ENVIRONMENT='production';await assert.rejects(api.act({...req,requestId:randomUUID()}),/REAUTH/);
 }finally{for(const [k,v]of [['PLATFORM_ENVIRONMENT',env],['PLATFORM_SESSION_POLICY',policy]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('cashbox administration requires live finance approver and cannot be invoked from a merchant session',async()=>{
 const s=await setup(),body={action:'CREATE_CASHBOX',branchId:'branch1',code:'CASH-API-01',name:'صندوق اختبار',custodianEmployeeId:s.employeeId,location:'بغداد',status:'ACTIVE',reason:'تجهيز مصدر صرف مسجل للاختبار',requestId:randomUUID()},base={db:s.db,now:()=>s.clock};
 const owner=createMerchantPayoutApi({...base,owner:{subjectId:s.ownerId,authTime:s.clock/1000,revalidate:async()=>{}}});await assert.rejects(owner.act(body),/PERMISSION/);
 const profile=s.f.get('staging-PlatformStaff',{pk:'EMPLOYEE#'+s.employeeId,sk:'PROFILE'}),admin=createMerchantPayoutApi({...base,staff:s.principal});profile.roles=['finance_viewer'];await assert.rejects(admin.act(body),/PERMISSION/);profile.roles=['finance_operator','finance_approver'];assert.equal((await admin.act(body)).cashbox.code,'CASH-API-01');profile.status='SUSPENDED';await assert.rejects(admin.cashboxes({branchId:'branch1'}),/EMPLOYEE_UNAVAILABLE/);
});

test('report recipient role comes from verified branch ownership, never a submitted role or person label',async()=>{const s=await setup();s.f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).businessName='مطعم الاختبار';s.f.put('staging-MerchantPlatform',{pk:'PERSON#'+s.ownerId,sk:'PROFILE',name:'محمد علي',version:1});const owner=createMerchantPayoutApi({db:s.db,now:()=>s.clock,owner:{subjectId:s.ownerId,authTime:s.clock/1000,revalidate:async()=>{}}}),body={action:'REQUEST_PAYOUT',branchId:'branch1',batchId:s.saved.header.batchId,batchDigest:s.saved.header.batchDigest,method:'CASH',requestId:randomUUID()};await assert.rejects(owner.act({...body,recipientRole:'BRANCH_MANAGER'}),/INVALID_REQUEST/);const requested=await owner.act(body),admin=createMerchantPayoutApi({db:s.db,now:()=>s.clock,staff:s.principal}),detail=await admin.details({branchId:'branch1',payoutId:requested.payout.payoutId});assert.deepEqual(detail.printIdentity.recipientIdentity,{name:'محمد علي',role:'OWNER',roleLabel:'مالك',businessName:'مطعم الاختبار',identityBasis:'VERIFIED_OWNER_REQUEST'});});
