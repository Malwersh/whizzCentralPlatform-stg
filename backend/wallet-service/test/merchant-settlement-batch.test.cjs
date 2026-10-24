'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {proof}=require('./helpers/merchant-accrual-fixture.cjs');
const {createMerchantSettlementBatchService:create}=require('../dist/merchantSettlementBatch');
const {createMerchantSettlementPreviewReader}=require('../dist/merchantSettlementPreview');
const {exactCheck}=require('../dist/driverFinancialTransaction');
const MP='staging-MerchantPlatform',STAFF='staging-PlatformStaff';
const schedule={schemaVersion:1,version:1,frequency:'WEEKLY',anchorLocalDate:'2026-10-01',timezone:'Asia/Baghdad'};
const roleKey={pk:'STAFF#finance1',sk:'AUTH'},scheduleKey={pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CURRENT'};
const at='2026-10-15T12:00:00.000Z';
const {fixture}=require('./helpers/merchant-settlement-batch-fixture.cjs');
const records=f=>[...f.rows.values()].filter(row=>['MERCHANT_SETTLEMENT_BATCH','MERCHANT_SETTLEMENT_LINE','MERCHANT_SETTLEMENT_REQUEST','MERCHANT_SETTLEMENT_LOOKUP'].includes(row.kind));
const accounting=f=>JSON.stringify([...f.rows].filter(([key])=>key.startsWith('staging-Wallets|')||key.startsWith('staging-LedgerEntries|')));
test('freezes header, line, exclusive payable membership, request receipt and audit together without moving funds',async()=>{
 const x=await fixture(),req=await x.request(),before=accounting(x.f),result=await x.service.create(req);
 assert.equal(result.replayed,false);assert.equal(result.header.status,'FROZEN_PENDING_REVIEW');assert.equal(result.header.lineCount,1);
 assert.equal(result.header.summary.amounts.merchantNet.minorAmount,9000000);assert.equal(result.header.payoutAuthorized,false);
 const payable=x.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'});
 assert.equal(payable.status,'LOCKED_PENDING_SETTLEMENT');assert.equal(payable.settlementBatchId,result.header.batchId);
 assert.equal(payable.settlementLineDigest,result.lines[0].lineDigest);assert.equal(accounting(x.f),before);
 assert.equal(records(x.f).length,4);assert.equal([...x.f.rows.values()].filter(r=>r.action==='MERCHANT_SETTLEMENT_FROZEN').length,1);
 assert.ok(records(x.f).every(row=>row.expiresAt===undefined&&row.ttl===undefined));
 const tx=x.f.calls.at(-1).input.TransactItems;
 assert.ok(tx.length<=100);assert.ok(tx.every(op=>!['staging-Wallets','staging-LedgerEntries'].includes((op.Put||op.Update||op.ConditionCheck).TableName)));
 assert.deepEqual((await x.service.read({branchId:'branch1',batchId:result.header.batchId})).header,result.header);
});
test('concurrent distinct requests for one payable produce only one statement',async()=>{
 const x=await fixture(),req=await x.request(),other={...req,requestId:randomUUID()};
 const r=await Promise.allSettled([x.service.create(req),x.service.create(other)]);
 assert.equal(r.filter(v=>v.status==='fulfilled').length,1);assert.equal(records(x.f).filter(v=>v.kind==='MERCHANT_SETTLEMENT_BATCH').length,1);
});
test('concurrent same-request retries return the same immutable statement',async()=>{
 const x=await fixture(),req=await x.request(),before=accounting(x.f);
 const [a,b]=await Promise.all([x.service.create(req),x.service.create(req)]);
 assert.equal(a.header.batchId,b.header.batchId);assert.equal(a.header.batchDigest,b.header.batchDigest);
 assert.equal(records(x.f).length,4);assert.equal(accounting(x.f),before);
});
test('a lost commit response is recovered from the durable receipt without a second reservation or audit',async()=>{
 const x=await fixture(),req=await x.request();x.lose();
 const a=await x.service.create(req);assert.equal(a.replayed,true);
 x.setClock('2026-11-01T00:00:00.000Z');x.f.get(MP,scheduleKey).enabled=false;
 const before=JSON.stringify([...x.f.rows]),b=await x.service.create(req);
 assert.equal(b.replayed,true);assert.deepEqual(a.header,b.header);assert.equal(JSON.stringify([...x.f.rows]),before);
});
test('overlapping multi-order batches cannot leave a partially reserved selection',async()=>{
 const x=await fixture(3),one=await x.request(['order1','order2']),two=await x.request(['order2','order3']);
 const r=await Promise.allSettled([x.service.create(one),x.service.create(two)]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);
 const saved=r.find(v=>v.status==='fulfilled').value;assert.equal(saved.lines.length,2);
 const claimed=['order1','order2','order3'].filter(id=>x.f.get('staging-Holds',{orderId:id,sk:'MERCHANT_PAYABLE'}).settlementBatchId);
 assert.deepEqual(claimed.sort(),saved.lines.map(l=>l.orderId).sort());assert.equal(records(x.f).length,5);
});
test('roles, schedule, ownership, deletion and source races abort all membership and statement writes',async()=>{
 for(const kind of ['role','schedule','owner','delete','order','offer','outcome','payable','audit']){
  const x=await fixture(),req=await x.request(),before=accounting(x.f);
  x.f.beforeCommit=tx=>{
   if(kind==='role')x.f.get(STAFF,roleKey).version++;
   if(kind==='schedule')x.f.get(MP,scheduleKey).version++;
   if(kind==='owner')x.f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).ownerId='other';
   if(kind==='delete')x.f.put('staging-AccountDeletion',{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch1',sk:'META'});
   if(kind==='order')x.f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).returnCaseId='return';
   if(kind==='offer')x.f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).isWinner=false;
   if(kind==='outcome')x.f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}).outcome='RETURNED';
   if(kind==='payable')x.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).amount++;
   if(kind==='audit')x.f.put('staging-AuditLog',tx.find(op=>op.Put?.Item.action==='MERCHANT_SETTLEMENT_FROZEN').Put.Item);
  };
  await assert.rejects(x.service.create(req));assert.equal(records(x.f).length,0,kind);
  assert.equal(x.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).settlementBatchId,undefined,kind);
  assert.equal(accounting(x.f),before,kind);
 }
});
test('changed preview, open period, missing schedule and an already claimed payable are blocked',async()=>{
 const x=await fixture(),req=await x.request();
 await assert.rejects(x.service.create({...req,previewId:'MSV:'+'a'.repeat(48)}),/PREVIEW_CHANGED/);
 x.setClock('2026-10-16T00:00:00.000Z');await assert.rejects(x.service.create(req),/PERIOD_STILL_OPEN/);
 x.setClock('2026-10-23T00:00:00.000Z');x.f.get(MP,scheduleKey).enabled=false;await assert.rejects(x.service.create(req),/SCHEDULE_GUARD_REQUIRED/);
 x.f.get(MP,scheduleKey).enabled=true;await x.service.create(req);
 await assert.rejects(x.service.create({...req,requestId:randomUUID()}),/ALREADY_IN_SETTLEMENT/);
});
test('same request ID cannot replace membership, reviewed content or creator identity',async()=>{
 const x=await fixture(2),req=await x.request();await x.service.create(req);const before=JSON.stringify([...x.f.rows]);
 for(const changed of [{...req,orderIds:['order2']},{...req,previewId:'MSV:'+'b'.repeat(48)},{...req,at:'2026-10-16T00:00:00.000Z'}])await assert.rejects(x.service.create(changed),/REQUEST_CONFLICT/);
 x.setActor('finance2');await assert.rejects(x.service.create(req),/REQUEST_CONFLICT/);assert.equal(JSON.stringify([...x.f.rows]),before);
});
test('saved statement read rejects missing or tampered lines and financial summaries',async()=>{
 for(const kind of ['missing','line','header']){
  const x=await fixture(),saved=await x.service.create(await x.request());
  if(kind==='missing')x.f.rows.delete(MP+'|'+require('../dist/deliveryQuoteRecord').quoteCanonical({pk:saved.header.pk,sk:saved.lines[0].sk}));
  if(kind==='line')x.f.get(MP,{pk:saved.header.pk,sk:saved.lines[0].sk}).accrual.amounts.merchantNet.minorAmount++;
  if(kind==='header')x.f.get(MP,{pk:saved.header.pk,sk:saved.header.sk}).summary.amounts.merchantNet.minorAmount++;
  await assert.rejects(x.service.read({branchId:'branch1',batchId:saved.header.batchId}),/PROOF_INVALID/);
 }
});
test('authorization is checked before replay/read and rechecked before returning a saved statement',async()=>{
 const x=await fixture(),req=await x.request(),saved=await x.service.create(req);
 x.f.get(STAFF,roleKey).status='REVOKED';await assert.rejects(x.service.create(req),/FORBIDDEN/);
 await assert.rejects(x.service.read({branchId:'branch1',batchId:saved.header.batchId}),/FORBIDDEN/);
 await assert.rejects(x.service.read({branchId:'other',batchId:saved.header.batchId}),/FORBIDDEN/);
});
test('invalid or oversized input is rejected before accessing authority or evidence',async()=>{
 const x=await fixture(),req=await x.request(),calls=x.authorizationCalls();
 for(const changed of [{...req,orderIds:[]},{...req,orderIds:['order1','order1']},{...req,orderIds:Array.from({length:16},(_,i)=>'order'+i)},{...req,requestId:'not-a-uuid'},{...req,amount:1},{...req,branchId:'../foreign'}])await assert.rejects(x.service.create(changed),/INVALID_SETTLEMENT_BATCH_REQUEST/);
 assert.equal(x.authorizationCalls(),calls);
});
test('unconfirmed network failure returns retry-same-request guidance and does not claim a saved batch',async()=>{
 const x=await fixture(),req=await x.request();x.offline();
 await assert.rejects(x.service.create(req),/OUTCOME_UNKNOWN_RETRY_SAME_REQUEST/);assert.equal(records(x.f).length,0);
});
test('history is queried by branch in descending time order with a branch-bound cursor and no table scan',async()=>{
 const x=await fixture(2),first=await x.service.create(await x.request(['order1']));
 x.setClock('2026-10-24T00:00:00.000Z');const second=await x.service.create(await x.request(['order2']));
 const page1=await x.service.list({branchId:'branch1',limit:1});assert.equal(page1.items[0].batchId,second.header.batchId);assert.ok(page1.nextCursor);
 assert.equal(page1.items[0].pk,undefined);assert.equal(page1.items[0].lineDigests,undefined);assert.equal(page1.items[0].requestHash,undefined);
 const page2=await x.service.list({branchId:'branch1',limit:1,cursor:page1.nextCursor});assert.equal(page2.items[0].batchId,first.header.batchId);assert.equal(page2.nextCursor,null);
 assert.equal(page2.coverage,'PAGE_OF_SAVED_STATEMENTS_ONLY');assert.equal(page2.items[0].payoutAuthorized,false);
 assert.ok(x.f.calls.every(c=>c.constructor.name!=='ScanCommand'));
});
test('malformed or foreign cursors cannot query another branch or include arbitrary DynamoDB keys',async()=>{
 const x=await fixture(),saved=await x.service.create(await x.request()),queryCount=()=>x.f.calls.filter(c=>c.constructor.name==='QueryCommand').length;
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const valid={schemaVersion:1,branchId:'branch1',key:{pk:saved.header.pk,sk:saved.header.sk}},before=queryCount();
 for(const cursor of ['invalid',encode({...valid,branchId:'other'}),encode({...valid,key:{pk:'MERCHANT_SETTLEMENT#other',sk:saved.header.sk}}),encode({...valid,key:{...valid.key,extra:'key'}}),encode({...valid,key:{pk:saved.header.pk,sk:'LINE#arbitrary'}})])await assert.rejects(x.service.list({branchId:'branch1',limit:1,cursor}),/INVALID_SETTLEMENT_CURSOR/);
 assert.equal(queryCount(),before);
});
test('foreign result pages and revocation during history reads do not expose a partial statement list',async()=>{
 for(const kind of ['foreign','duplicate','cursor','revoked']){
  const x=await fixture();await x.service.create(await x.request());
  x.setQueryHook(page=>{
   if(kind==='foreign')page.Items[0].branchId='other';
   if(kind==='duplicate')page.Items.push(page.Items[0]);
   if(kind==='cursor')page.LastEvaluatedKey={pk:'MERCHANT_SETTLEMENT#other',sk:page.Items[0].sk};
   if(kind==='revoked')x.f.get(STAFF,roleKey).status='REVOKED';
  });
  await assert.rejects(x.service.list({branchId:'branch1',limit:20}));
 }
});
test('zero-entitlement lines are still uniquely claimed and never represented as paid',async()=>{
 const x=await fixture(1,{goods:0,commission:0}),req=await x.request(),saved=await x.service.create(req);
 assert.equal(saved.header.summary.amounts.merchantNet.minorAmount,0);assert.equal(saved.header.payoutAuthorized,false);
 await assert.rejects(x.service.create({...req,requestId:randomUUID()}),/ALREADY_IN_SETTLEMENT/);
});
test('maximum supported selection commits in one bounded transaction, without silently splitting the statement',async()=>{
 const x=await fixture(15),ids=Array.from({length:15},(_,i)=>'order'+(i+1));
 const saved=await x.service.create(await x.request(ids));assert.equal(saved.header.lineCount,15);assert.equal(saved.lines.length,15);
 const tx=x.f.calls.at(-1).input.TransactItems;assert.ok(tx.length<=100);assert.equal(records(x.f).filter(v=>v.kind==='MERCHANT_SETTLEMENT_BATCH').length,1);
});
test('guards from an invalid or unfenced authority/schedule cannot create a saved statement',async()=>{
 const x=await fixture(),req=await x.request();
 for(const kind of ['empty','foreign','table','schedule']){
  const service=create({db:x.db,now:()=>Date.parse('2026-10-23T00:00:00.000Z'),
   authorizeBranch:async branch=>{const a=await x.authorize(branch,'CREATE');if(kind==='empty')a.guards=[];if(kind==='foreign')a.branchId='other';if(kind==='table')a.guards[0].ConditionCheck.TableName='production-PlatformStaff';return a;},
   readSchedule:async branch=>{const s=await x.readSchedule(branch);if(kind==='schedule')s.guard.ConditionCheck.Key.pk='BRANCH#other';return s;}});
  await assert.rejects(service.create(req));assert.equal(records(x.f).length,0);
 }
});
test('a caller cannot edit a frozen statement by modifying a returned response object',async()=>{
 const x=await fixture(),req=await x.request(),saved=await x.service.create(req),expected=saved.header.batchDigest;
 saved.header.summary.amounts.merchantNet={...saved.header.summary.amounts.merchantNet,minorAmount:0};saved.lines[0].accrual.amounts.merchantNet.minorAmount=0;
 const reread=await x.service.read({branchId:'branch1',batchId:saved.header.batchId});
 assert.equal(reread.header.batchDigest,expected);assert.equal(reread.header.summary.amounts.merchantNet.minorAmount,9000000);
 assert.equal(reread.lines[0].accrual.amounts.merchantNet.minorAmount,9000000);
});
test('a full connection loss after commit remains unknown until retrying the same request, without duplicate claims',async()=>{
 const x=await fixture(),req=await x.request();x.lose(true);
 await assert.rejects(x.service.create(req),/OUTCOME_UNKNOWN_RETRY_SAME_REQUEST/);assert.equal(records(x.f).length,4);
 x.setReadOutage(false);const saved=await x.service.create(req);assert.equal(saved.replayed,true);assert.equal(records(x.f).length,4);
 assert.equal([...x.f.rows.values()].filter(r=>r.action==='MERCHANT_SETTLEMENT_FROZEN').length,1);
});
test('service configuration failures do not masquerade as a successfully saved statement',async()=>{
 const x=await fixture(),req=await x.request();
 for(const name of ['ValidationException','AccessDeniedException','ResourceNotFoundException']){
  const db={send:async command=>{if(command.constructor.name==='TransactWriteCommand')throw Object.assign(Error('Configuration unavailable'),{name});return x.db.send(command);}};
  const service=create({db,authorizeBranch:x.authorize,readSchedule:x.readSchedule,now:()=>Date.parse('2026-10-23T00:00:00.000Z')});
  await assert.rejects(service.create(req),/CONFIGURATION_UNAVAILABLE/);assert.equal(records(x.f).length,0);
 }
});


test('actual frozen COD statement records satisfy deletion-retention scope and digest checks',async()=>{
 const x=await fixture(),request=await x.request();await x.service.create(request);
 const {validate}=require('../../account-deletion/settlement-retention');
 const rows=records(x.f);assert.equal(rows.length,4);
 for(const row of rows)assert.doesNotThrow(()=>validate(row,'branch1'));
 const line=structuredClone(rows.find(r=>r.kind==='MERCHANT_SETTLEMENT_LINE'));
 line.accrual.customerPhone='PRIVATE';assert.throws(()=>validate(line,'branch1'),/SETTLEMENT_RETENTION_SCOPE_INVALID/);
});

test('approved schedule agreement cannot be applied to another commercial agreement',async()=>{
 const x=await fixture(),request=await x.request(),source=x.f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
 const service=create({db:x.db,authorizeBranch:x.authorize,readSchedule:async()=>({...await x.readSchedule(),agreementBinding:{...source.commercialPricing.agreement,version:999}}),now:()=>Date.parse('2026-10-23T00:00:00.000Z')});
 const before=accounting(x.f);await assert.rejects(service.create(request),/AGREEMENT_SCHEDULE_MISMATCH/);assert.equal(records(x.f).length,0);assert.equal(accounting(x.f),before);
});

test('live platform authority integrates with atomic freeze, and revoked employee cannot read it',async()=>{
 const x=await fixture(),request=await x.request(),id='11111111-1111-4111-8111-111111111111',key={pk:'EMPLOYEE#'+id,sk:'PROFILE'};
 x.f.put(STAFF,{...key,employeeId:id,status:'ACTIVE',version:1,roles:['finance_operator'],scope:{allRegions:true,regionIds:[]},mfaRequired:true});
 const {createMerchantSettlementAuthority}=require('../dist/merchantSettlementAuthority');
 const authorize=createMerchantSettlementAuthority({db:x.db,principal:{employeeId:id,authTime:Date.parse('2026-10-23T00:00:00.000Z')/1000,mfaEnrolled:true},now:()=>Date.parse('2026-10-23T00:00:00.000Z')});
 const service=create({db:x.db,authorizeBranch:authorize,readSchedule:x.readSchedule,now:()=>Date.parse('2026-10-23T00:00:00.000Z')});
 const result=await service.create(request);assert.equal(result.header.createdBy,id);
 x.f.put(STAFF,{...x.f.get(STAFF,key),roles:[]});await assert.rejects(service.read({branchId:'branch1',batchId:result.header.batchId}),/PERMISSION_REQUIRED/);
});

test('historical schedule selection is pinned with old version, successor and closure in the atomic freeze',async()=>{
 for(const race of [false,true]){
  const x=await fixture(),req=await x.request(),branch=x.f.get('WhizzMerchants_Businesses',{businessId:'branch1'}),order=x.f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
  const {quoteHash}=require('../dist/deliveryQuoteRecord');
  const {createMerchantSettlementScheduleHistoryReader:history}=require('../dist/merchantSettlementScheduleHistory');
  const body={schemaVersion:1,kind:'MERCHANT_SETTLEMENT_SCHEDULE',branchId:'branch1',ownerId:branch.ownerId,enabled:true,status:'APPROVED',schedule,
   agreement:order.commercialPricing.agreement,effectiveFrom:'2026-09-30T21:00:00.000Z',effectiveTo:null,acceptedBy:branch.ownerId,acceptedAt:'2026-09-29T12:00:00.000Z',approvedBy:'finance1',approvedAt:'2026-09-29T13:00:00.000Z'};
  const pk='BRANCH#branch1',old={pk,sk:'SETTLEMENT_SCHEDULE#VERSION#1',...body,digest:quoteHash(body)};
  const body2={...body,schedule:{...schedule,version:2},effectiveFrom:'2026-10-21T21:00:00.000Z'};
  const current={pk,sk:'SETTLEMENT_SCHEDULE#CURRENT',...body2,digest:quoteHash(body2)};
  const closure={pk,sk:'SETTLEMENT_SCHEDULE#CLOSED#1',kind:'MERCHANT_SETTLEMENT_SCHEDULE_CLOSURE',branchId:'branch1',version:1,sourceDigest:old.digest,untilExclusive:body2.effectiveFrom,replacedByVersion:2};
  x.f.put(MP,old);x.f.put(MP,current);x.f.put(MP,{...current,sk:'SETTLEMENT_SCHEDULE#VERSION#2'});x.f.put(MP,closure);
  const db={send:command=>command.constructor.name==='QueryCommand'&&command.input.ExpressionAttributeValues[':prefix']==='SETTLEMENT_SCHEDULE#VERSION#'
   ? Promise.resolve({Items:[old,{...current,sk:'SETTLEMENT_SCHEDULE#VERSION#2'}]}) : x.db.send(command)};
  const service=create({db,authorizeBranch:x.authorize,readSchedule:history(db),now:()=>Date.parse('2026-10-23T00:00:00.000Z')});
  if(race)x.f.beforeCommit=()=>x.f.put(MP,{...closure,untilExclusive:'2026-10-20T21:00:00.000Z'});
  if(race){await assert.rejects(service.create(req),/SOURCE_CHANGED_OR_ALREADY_CLAIMED/);assert.equal(records(x.f).length,0);}
  else {const saved=await service.create(req);assert.equal(saved.header.period.scheduleVersion,1);}
 }
});
