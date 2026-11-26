'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deriveMerchantCodAccrual:derive,summarizeMerchantAccruals:summarize}=require('../dist/merchantSettlementAccrual');
const {moneyFromMinor}=require('../dist/money');
const {quoteHash}=require('../dist/deliveryQuoteRecord');
const {proof}=require('./helpers/merchant-accrual-fixture.cjs');

const iqd=v=>v.minorAmount/1000;
test('a completed COD journal yields an immutable pending merchant accrual without writing money',async()=>{
 const {input,f}=await proof();const before=JSON.stringify([...f.rows]);const a=derive(input);
 assert.equal(iqd(a.amounts.goodsGross),10000);assert.equal(iqd(a.amounts.merchantNet),9000);assert.equal(iqd(a.amounts.merchantCommission),1000);
 assert.equal(iqd(a.amounts.customerServiceFee),500);assert.equal(iqd(a.amounts.customerDeliveryFee),3000);assert.equal(iqd(a.amounts.driverTip),1000);
 assert.equal(a.status,'LOCKED_PENDING_SETTLEMENT');assert.equal(a.payoutAuthorized,false);assert.equal(a.walletMutationPerformed,false);
 assert.equal(JSON.stringify([...f.rows]),before);assert.deepEqual(derive(input),a);
 input.order.customerName='private';input.order.customerPhone='private';assert.deepEqual(derive(input),a);
 a.amounts.merchantNet.minorAmount=0;assert.equal(iqd(derive(input).amounts.merchantNet),9000);
});
test('platform funding does not reduce merchant entitlement; merchant funding is deducted once',async()=>{
 for(const [merchant,platform,net] of [[0,1000,9000],[700,0,8300],[400,600,8600]]){
  const {input}=await proof({merchant,platform});const a=derive(input);
  assert.equal(iqd(a.amounts.merchantNet),net);assert.equal(iqd(a.amounts.merchantFundedDiscount),merchant);assert.equal(iqd(a.amounts.platformFundedDiscount),platform);
  assert.equal(iqd(a.amounts.merchantGoodsEntitlement),10000-merchant);
 }
});
test('negative platform contribution is preserved as signed money without reducing merchant rights',async()=>{
 const {input}=await proof({earning:'9000'});const a=derive(input);
 assert.equal(iqd(a.amounts.platformNetContribution),-4500);assert.equal(iqd(a.amounts.merchantNet),9000);
});
test('zero merchant entitlement is explicit, with no invented zero journal line',async()=>{
 const {input}=await proof({goods:0,commission:0});const a=derive(input);
 assert.equal(iqd(a.amounts.merchantNet),0);assert.equal(input.outcome.journalLines.some(l=>l.walletId==='WALLET#MERCHANT#branch1'),false);
});
test('conflicting branch, terminal state, funding proof and acceptance cannot become a payable statement line',async()=>{
 const {input}=await proof({platform:1000});
 const changes=[v=>v.branchId='other',v=>v.order.status='picked_up',v=>v.order.financialOutcome='other',v=>v.order.cashCollected=false,
  v=>v.order.returnCaseId='return',v=>v.order.deletionRequestId='delete',v=>v.order.driverId='other',v=>v.outcome.subjectId='other',
  v=>v.acceptedOffer.isWinner=false,v=>v.outcome.kind='COD_RETURN_JOURNAL',v=>v.outcome.offerDigest='b'.repeat(64),
  v=>v.outcome.attempt++,v=>v.outcome.receipt.cashCollectedAmount++,v=>v.outcome.receipt.deliveredAt='2026-10-17T00:00:00.000Z',
  v=>v.payable.amount++,v=>v.payable.status='PAID',v=>v.payable.agreement.version++,v=>v.payable.branchId='other',
  v=>v.outcome.allocation.merchantPayable.minorAmount++,v=>v.outcome.journalLines[0].unit='IQD_MINOR',
  v=>v.outcome.journalLines[0].balanceAfter++,v=>v.outcome.journalLines.push(v.outcome.journalLines[0]),
  v=>v.outcome.journalLines=v.outcome.journalLines.filter(l=>l.balanceType!=='LOCKED'||l.walletId!=='WALLET#PLATFORM')];
 for(const change of changes){const value=structuredClone(input);change(value);assert.throws(()=>derive(value),/MERCHANT_ACCRUAL_PROOF_REQUIRED/);}
});
test('a balanced but redistributed journal is rejected',async()=>{
 const {input}=await proof();const merchant=input.outcome.journalLines.find(l=>l.walletId==='WALLET#MERCHANT#branch1'),platform=input.outcome.journalLines.find(l=>l.walletId==='WALLET#PLATFORM');
 merchant.delta--;merchant.balanceAfter--;platform.delta++;platform.balanceAfter++;
 assert.equal(input.outcome.journalLines.reduce((sum,l)=>sum+l.delta,0),0);assert.throws(()=>derive(input));
});
test('summary separates invoice fees from merchant net and rejects duplicate or foreign accruals',async()=>{
 const {input}=await proof();const a=derive(input),summary=summarize('branch1',[a]);
 assert.equal(iqd(summary.amounts.merchantNet),9000);assert.equal(iqd(summary.amounts.customerServiceFee),500);assert.equal(summary.payoutAuthorized,false);
 assert.match(summary.basis,/NOT_PERIOD_COVERAGE/);assert.throws(()=>summarize('branch1',[a,a]));assert.throws(()=>summarize('other',[a]));
 const changed=structuredClone(a);changed.amounts.merchantNet.minorAmount++;assert.throws(()=>summarize('branch1',[changed]));
});
test('summary does not overflow or depend on source row order',async()=>{
 const {input}=await proof();const a=derive(input),b=structuredClone(a);b.orderId='order2';b.accrualId='MACC:second';
 const seal=v=>{const {digest,...content}=v;v.digest=quoteHash(content);};seal(b);
 assert.deepEqual(summarize('branch1',[a,b]),summarize('branch1',[b,a]));
 for(const row of [a,b]){
  const gross=5000000000000000;
  for(const key of ['goodsGross','merchantGoodsEntitlement','customerGoodsPayment'])row.amounts[key]=moneyFromMinor(gross);
  row.amounts.merchantNet=moneyFromMinor(gross-1000000);row.amounts.customerTotal=moneyFromMinor(gross+4500000);seal(row);
 }
 assert.throws(()=>summarize('branch1',[a,b]),/MERCHANT_ACCRUAL_TOTAL_OVERFLOW/);
});
test('summary refuses missing fields or an inconsistent money equation even if its checksum is recomputed',async()=>{
 const {input}=await proof();const a=derive(input);
 for(const change of [v=>delete v.amounts.merchantNet,v=>v.amounts.merchantNet.minorAmount+=1000,v=>v.amounts.goodsGross.minorAmount=-1000]){
  const altered=structuredClone(a);change(altered);const {digest,...content}=altered;altered.digest=quoteHash(content);
  assert.throws(()=>summarize('branch1',[altered]),/MERCHANT_ACCRUAL_SET_INVALID/);
 }
});
