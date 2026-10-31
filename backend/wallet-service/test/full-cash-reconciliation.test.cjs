'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{reconcile}=require('../dist/reconciliation');
test('pending merchant rights explain locked balance and are not overdue driver collateral',()=>{
 const w={walletId:'WALLET#MERCHANT#branch1',sk:'META',ownerType:'MERCHANT',availableBalance:0,lockedBalance:7875};
 const p={orderId:'order1',sk:'MERCHANT_PAYABLE',walletId:w.walletId,kind:'MERCHANT_ORDER_PAYABLE',status:'LOCKED_PENDING_SETTLEMENT',amount:7875,createdAt:'2026-01-01T00:00:00.000Z'};
 const r=reconcile([w],[p],[{walletId:w.walletId,amount:7875,type:'CREDIT',category:'FULL_CASH_COMPLETED',transactionId:'FCS:'+'a'.repeat(48),sk:'ts#LOCKED#FCS:'+'a'.repeat(48),balanceBefore:0,balanceAfter:7875,relatedEntityType:'ORDER',relatedEntityId:'order1',metadata:{financialSchemaVersion:4,settlementModel:'FULL_CASH_AT_DELIVERY_V1',balanceType:'LOCKED',operationId:'FCS:'+'a'.repeat(48),orderId:'order1'}}],Date.parse('2026-10-19T00:00:00.000Z'));
 assert.equal(r.issues.length,0);assert.equal(r.wallets[0].pendingMerchantPayableTotal,7875);assert.equal(r.wallets[0].activeHoldTotal,0);
 const changed=reconcile([{...w,lockedBalance:7876}],[p],[{walletId:w.walletId,amount:7875,type:'CREDIT',category:'FULL_CASH_COMPLETED',transactionId:'FCS:'+'a'.repeat(48),sk:'ts#LOCKED#FCS:'+'a'.repeat(48),balanceBefore:0,balanceAfter:7875,relatedEntityType:'ORDER',relatedEntityId:'order1',metadata:{financialSchemaVersion:4,settlementModel:'FULL_CASH_AT_DELIVERY_V1',balanceType:'LOCKED',operationId:'FCS:'+'a'.repeat(48),orderId:'order1'}}]);assert.ok(changed.issues.some(x=>x.type==='LOCKED_MISMATCH'));
});
