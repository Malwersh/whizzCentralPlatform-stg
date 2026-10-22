'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./helpers/merchant-settlement-batch-fixture.cjs');
const {createMerchantPayoutService:create,verifyMerchantPayoutJournal}=require('../dist/merchantPayout');
const {quoteHash}=require('../dist/deliveryQuoteRecord');
const {readMerchantAccrualEvidence}=require('../dist/merchantSettlementPreview');
const {ledgerEffect}=require('../dist/ledgerEffects');
async function setup(){
 const f=await fixture(),b=await f.service.create(await f.request()),owner=f.f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).ownerId;
 const body={schemaVersion:1,kind:'MERCHANT_STATEMENT_APPROVAL',branchId:'branch1',batchId:b.header.batchId,batchDigest:b.header.batchDigest,status:'APPROVED_NOT_PAID',approvalPolicy:'SINGLE_ADMIN',approvedBy:'admin1',approvedAt:'2026-10-23T00:00:00.000Z',payoutAuthorized:false,walletMutationPerformed:false,retentionClass:'FINANCIAL_SETTLEMENT'};
 f.f.put('staging-MerchantPlatform',{pk:'MERCHANT_SETTLEMENT#branch1',sk:'APPROVAL#'+b.header.batchId,...body,digest:quoteHash(body)});
 let role='OWNER',clock=Date.parse('2026-10-23T00:00:00.000Z'),sent=[],lose=false,hook=null;
 const db={send:async c=>{if(hook)await hook(c);const result=await f.db.send(c);if(lose&&c.constructor.name==='TransactWriteCommand'){lose=false;throw Error('response lost after commit');}return result;}};
 f.f.put('staging-MerchantPlatform',{pk:'MERCHANT_CASHBOXES#GLOBAL',sk:'BOX#CASH-DESK-01',kind:'MERCHANT_CASHBOX',code:'CASH-DESK-01',name:'صندوق الاختبار',custodian:'أمين الاختبار',location:'بغداد',status:'ACTIVE',version:1});
 require('./helpers/cashbox-accounting-251-seed.cjs').seed(f.f);
 const service=create({db,now:()=>clock,authorize:async(branch,action)=>{if(branch!=='branch1'||role==='OWNER'&&['STAFF','APPROVE'].includes(action)||role==='STAFF'&&action==='OWNER')throw Error('FORBIDDEN');return {actorId:role==='OWNER'?owner:'admin1',owner:role==='OWNER',guards:[]};},readBatch:()=>f.service.read({branchId:'branch1',batchId:b.header.batchId}),listBatches:()=>f.service.list({branchId:'branch1',limit:20}),otp:{secret:async()=> 'synthetic-test-only-secret',send:async(phone,code)=>sent.push({phone,code})}});
 const request=(extra={})=>({action:'REQUEST_PAYOUT',branchId:'branch1',batchId:b.header.batchId,batchDigest:b.header.batchDigest,method:'CASH',requestId:randomUUID(),...extra});
 const act=async(row,action,extra={})=>service.act({action,branchId:'branch1',payoutId:row.payoutId,version:row.version,requestId:randomUUID(),...extra});
 return {...f,b,owner,service,request,act,sent,role:r=>role=r,clock:n=>clock+=n,lose:()=>lose=true,hook:h=>hook=h};
}
async function throughExecution(s,method='CASH'){
 let extra={};if(method==='ZAIN_CASH'){const d=await s.service.act({action:'START_PAYOUT_DESTINATION',branchId:'branch1',requestId:randomUUID(),phone:'07800868280'});await s.service.act({action:'VERIFY_PAYOUT_DESTINATION',branchId:'branch1',proofId:d.proofId,code:s.sent[0].code});extra={method,destinationProofId:d.proofId};}
 let {payout:p}=await s.service.act(s.request(extra));s.role('STAFF');p=(await s.act(p,'APPROVE_PAYOUT')).payout;p=(await s.act(p,'BEGIN_PAYOUT')).payout;p=(await s.act(p,'RECORD_PAYOUT_EXECUTION',{...(method==='CASH'?{cashboxId:'CASH-DESK-01'}:{externalReference:'ZAIN-RECEIPT-0001',sourceAccount:'ZAIN-01'}),actualAmount:p.amount.minorAmount/1000,destinationConfirmed:true})).payout;return p;
}
test('cash payout requires owner receipt then same-admin reconciliation; atomically extinguishes only merchant liability once',async()=>{
 const s=await setup(),before=s.f.get('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META'}).lockedBalance;
 let p=await throughExecution(s);assert.equal(p.status,'AWAITING_RECEIPT');assert.equal(s.f.get('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META'}).lockedBalance,before);
 await assert.rejects(s.act(p,'RECONCILE_PAYOUT'));s.role('OWNER');await assert.rejects(s.act(p,'ACK_PAYOUT_RECEIPT',{accepted:true,receivedAmount:1}));p=(await s.act(p,'ACK_PAYOUT_RECEIPT',{accepted:true,receivedAmount:p.amount.minorAmount/1000})).payout;s.role('STAFF');
 const v={action:'RECONCILE_PAYOUT',branchId:'branch1',payoutId:p.payoutId,version:p.version,requestId:randomUUID()};s.lose();const result=await s.service.act(v);assert.equal(result.payout.status,'PAID');assert.equal(result.replayed,true);assert.equal((await s.service.act(v)).replayed,true);
 const payable=s.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}),journal=s.f.get('staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT_PAID#'+p.payoutId,sk:'META'});assert.equal(payable.status,'PAID');verifyMerchantPayoutJournal(journal,'branch1',payable);
 assert.equal(s.f.get('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META'}).lockedBalance,before-p.amount.minorAmount/1000);
 const entries=[...s.f.rows.values()].filter(r=>r.category==='MERCHANT_PAYOUT_PAID');assert.equal(entries.length,1);assert.equal(ledgerEffect(entries[0]).bucket,'LOCKED');
 assert.equal((await readMerchantAccrualEvidence(s.db,'branch1','order1')).payable.status,'PAID');s.role('OWNER');await assert.rejects(s.service.act(s.request()),/ALREADY_CLAIMED/);
});
test('Zain Cash needs independent destination OTP; raw phone is limited to executing staff and never changes login phone',async()=>{
 const s=await setup();await assert.rejects(s.service.act(s.request({method:'ZAIN_CASH',destinationProofId:'forged'})),/VERIFICATION_REQUIRED/);
 let p=await throughExecution(s,'ZAIN_CASH');assert.equal(s.sent.length,1);assert.match(p.destination,/8280$/);assert.equal(JSON.stringify(p).includes('+9647800868280'),false);
 const detail=await s.service.details({branchId:'branch1',payoutId:p.payoutId});assert.equal(detail.executionDestination,'+9647800868280');s.role('OWNER');assert.equal((await s.service.details({branchId:'branch1',payoutId:p.payoutId})).executionDestination,undefined);
 assert.equal(s.f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).phoneNumber,undefined);
});
test('bank and client amounts/actor are rejected; changed base, foreign branch and staff owner impersonation cannot request a payout',async()=>{
 const s=await setup();for(const extra of [{method:'BANK'},{amount:1},{actorId:s.owner},{branchId:'foreign'},{batchDigest:'a'.repeat(64)}])await assert.rejects(s.service.act(s.request(extra)));
 s.role('STAFF');await assert.rejects(s.service.act(s.request()));assert.equal([...s.f.rows.values()].some(r=>r.kind==='MERCHANT_PAYOUT'),false);
});
test('OTP wrong codes consume attempts; rate limit and expired proofs cannot produce Zain request',async()=>{
 const s=await setup(),d=await s.service.act({action:'START_PAYOUT_DESTINATION',branchId:'branch1',requestId:randomUUID(),phone:'07800868280'});
 await assert.rejects(s.service.act({action:'START_PAYOUT_DESTINATION',branchId:'branch1',requestId:randomUUID(),phone:'07800868280'}),/RATE_LIMIT/);
 for(let i=0;i<5;i++)await assert.rejects(s.service.act({action:'VERIFY_PAYOUT_DESTINATION',branchId:'branch1',proofId:d.proofId,code:s.sent[0].code==='000000'?'000001':'000000'}));
 await assert.rejects(s.service.act({action:'VERIFY_PAYOUT_DESTINATION',branchId:'branch1',proofId:d.proofId,code:s.sent[0].code}));
 s.clock(3600001);const second=await s.service.act({action:'START_PAYOUT_DESTINATION',branchId:'branch1',requestId:randomUUID(),phone:'07800868280'});s.clock(300001);await assert.rejects(s.service.act({action:'VERIFY_PAYOUT_DESTINATION',branchId:'branch1',proofId:second.proofId,code:s.sent[1].code}));
});
test('cancellation before execution releases claim; after execution uncertainty keeps claim and liability intact',async()=>{
 const s=await setup();let p=(await s.service.act(s.request())).payout;p=(await s.act(p,'CANCEL_PAYOUT')).payout;assert.equal(p.status,'CANCELLED');
 p=await throughExecution(s);s.role('OWNER');await assert.rejects(s.act(p,'CANCEL_PAYOUT'));p=(await s.act(p,'REPORT_PAYOUT_PROBLEM',{reason:'لم يصل المبلغ إلى المستلم'})).payout;assert.equal(p.status,'RECONCILIATION_REQUIRED');await assert.rejects(s.service.act(s.request()),/ALREADY_CLAIMED/);s.role('STAFF');await assert.rejects(s.act(p,'BEGIN_PAYOUT'));await assert.rejects(s.act(p,'RECONCILE_PAYOUT'));
 p=(await s.act(p,'REOPEN_PAYOUT_RECEIPT',{reason:'تمت مراجعة المصدر والمرجع، يلزم إقرار المالك مجددا'})).payout;assert.equal(p.status,'AWAITING_RECEIPT');assert.equal(p.ownerReceiptAt,null);
});
test('global execution references cannot pay another statement and concurrent wallet/source change rolls back paid state',async()=>{
 const s=await setup();let p=await throughExecution(s);s.role('OWNER');p=(await s.act(p,'ACK_PAYOUT_RECEIPT',{accepted:true,receivedAmount:p.amount.minorAmount/1000})).payout;s.role('STAFF');let changed=false;
 s.hook(async c=>{if(!changed&&c.input.TransactItems?.some(o=>o.Put?.Item.kind==='MERCHANT_PAYOUT_PAID_JOURNAL')){changed=true;s.f.get('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META'}).version++;}});
 await assert.rejects(s.act(p,'RECONCILE_PAYOUT'));assert.equal(s.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).status,'LOCKED_PENDING_SETTLEMENT');assert.equal([...s.f.rows.values()].some(r=>r.kind==='MERCHANT_PAYOUT_PAID_JOURNAL'),false);
});
test('non-receipt alone cannot release a possibly paid claim; final failure needs both owner denial and source proof',async()=>{
 const s=await setup();let p=await throughExecution(s);s.role('OWNER');p=(await s.act(p,'REPORT_PAYOUT_PROBLEM',{reason:'لم يصل أي مبلغ حتى الآن'})).payout;
 s.role('STAFF');await assert.rejects(s.act(p,'RESOLVE_PAYOUT_NOT_PAID',{actualAmount:0,confirmedNoDebit:true,failureReference:'FAILURE-1',sourceAccount:'CASH-DESK-01',reason:'يوجد إثبات نهائي بعدم الصرف'}));
 s.role('OWNER');p=(await s.act(p,'ACK_PAYOUT_NOT_RECEIVED',{accepted:true,receivedAmount:0})).payout;s.role('STAFF');await assert.rejects(s.act(p,'RESOLVE_PAYOUT_NOT_PAID',{actualAmount:0,confirmedNoDebit:false,failureReference:'FAILURE-1',sourceAccount:'CASH-DESK-01',reason:'النتيجة مجهولة حتى الآن'}));
 p=(await s.act(p,'RESOLVE_PAYOUT_NOT_PAID',{actualAmount:0,confirmedNoDebit:true,failureReference:'VOID-RECEIPT-1',sourceAccount:'CASH-DESK-01',reason:'تم إلغاء الإيصال وإعادة النقد إلى المصدر'})).payout;assert.equal(p.status,'FAILED_NOT_PAID');assert.equal([...s.f.rows.values()].some(r=>r.kind==='MERCHANT_PAYOUT_PAID_JOURNAL'),false);s.role('OWNER');assert.equal((await s.service.act(s.request())).payout.status,'UNDER_REVIEW');
});
test('Zain execution fees are platform expenses and never reduce the merchant receipt or merchant wallet by extra fees',async()=>{
 const s=await setup(),d=await s.service.act({action:'START_PAYOUT_DESTINATION',branchId:'branch1',requestId:randomUUID(),phone:'07800868280'});await s.service.act({action:'VERIFY_PAYOUT_DESTINATION',branchId:'branch1',proofId:d.proofId,code:s.sent[0].code});let p=(await s.service.act(s.request({method:'ZAIN_CASH',destinationProofId:d.proofId}))).payout;s.role('STAFF');p=(await s.act(p,'APPROVE_PAYOUT')).payout;p=(await s.act(p,'BEGIN_PAYOUT')).payout;p=(await s.act(p,'RECORD_PAYOUT_EXECUTION',{externalReference:'ZAIN-1000',sourceAccount:'ZAIN-01',actualAmount:p.amount.minorAmount/1000,executionFee:250,destinationConfirmed:true})).payout;assert.equal(p.sourceDebited,p.amount.minorAmount/1000+250);s.role('OWNER');p=(await s.act(p,'ACK_PAYOUT_RECEIPT',{accepted:true,receivedAmount:p.amount.minorAmount/1000})).payout;s.role('STAFF');p=(await s.act(p,'RECONCILE_PAYOUT')).payout;const j=s.f.get('staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT_PAID#'+p.payoutId,sk:'META'});assert.equal(j.debit,j.credit);assert.equal(j.lines.find(l=>l.account==='PAYOUT_FEE_EXPENSE').amount,250);verifyMerchantPayoutJournal(j,'branch1',s.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}));
});
test('an execution reference already bound to another payout cannot be reused even before any liability is paid',async()=>{
 const s=await setup();let p=(await s.service.act(s.request())).payout;s.role('STAFF');p=(await s.act(p,'APPROVE_PAYOUT')).payout;p=(await s.act(p,'BEGIN_PAYOUT')).payout;const reference=p.cashVoucherNumber,source='CASH-DESK-01';s.f.put('staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT_REFERENCE#'+quoteHash({method:'CASH',source,reference}),sk:'META',payoutId:'other'});await assert.rejects(s.act(p,'RECORD_PAYOUT_EXECUTION',{cashboxId:source,actualAmount:p.amount.minorAmount/1000,destinationConfirmed:true}));assert.equal(s.f.get('staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT#branch1',sk:p.payoutId}).status,'PROCESSING');
});
