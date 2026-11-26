'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {legacyDriverSettlementGuards}=require('./driver-legacy-settlement.cjs');
const {tables}=require('./evidence.cjs');

function fixture(amount) {
  const subjectId='driver1',orderId='order1',walletId='WALLET#DRIVER#'+subjectId;
  const acceptedAt='2026-11-26T08:00:00Z',releasedAt='2026-11-26T08:05:00Z';
  const receipt={kind:'PINNED_LEGACY_ACCEPTANCE',success:true,orderId,offerId:'offer1',
    driverId:subjectId,subjectId,acceptedAt,assignmentAttempt:1,holdId:amount?'hold1':null,
    holdAmount:amount,holdStatus:amount?'ACTIVE':'NOT_REQUIRED'};
  const order={orderId,driverId:subjectId,status:'delivered',orderStatus:'delivered',
    assignmentAttemptCounter:1,assignmentWaveNumber:1,holdId:receipt.holdId,holdAmount:amount,
    holdStatus:amount?'RELEASED':'NOT_REQUIRED',dispatchAcceptance:receipt};
  const offer={responseStatus:'accepted',isWinner:true,dispatchReceipt:receipt,
    offerId:receipt.offerId,responseAt:acceptedAt,waveNumber:1,holdRequiredAmount:amount,legacyTermsDigest:'a'.repeat(64)};
  const hold={orderId,sk:'HOLD',walletId,holdId:'hold1',amount,status:'RELEASED',releasedAt};
  const journal={operationId:'hold1',orderId,walletId,amount,status:'COMPLETED',result:'RELEASED'};
  const row={walletId,transactionId:'TXN-1',type:'HOLD_RELEASED',relatedEntityId:'hold1',
    relatedEntityType:'HOLD',metadata:{orderId,holdId:'hold1'}};
  const debit={...row,sk:'ts#'+releasedAt+'#TXN-1#0',amount:-amount};
  const credit={...row,sk:'ts#'+releasedAt+'#TXN-1#1',amount};
  const state={hold:amount?hold:undefined,journal,credit};
  const db={async send(command) {
    const {TableName,Key}=command.input;
    if(command.constructor.name==='QueryCommand')return {Items:[debit]};
    if(TableName===tables.holds)return {Item:Key.sk==='HOLD'?state.hold:undefined};
    if(TableName===tables.events)return {Item:state.journal};
    assert.equal(Key.sk,credit.sk);
    return {Item:state.credit};
  }};
  return {state,run:()=>legacyDriverSettlementGuards({db,subjectId,order,offers:[offer],maxPages:3})};
}

test('a verified zero legacy hold produces absence guards',async()=>{
  const {state,run}=fixture(0);
  const guards=await run();
  assert.deepEqual(guards.map(g=>g.ConditionCheck.Key.sk),['MERCHANT_PAYABLE','FINANCIAL_OUTCOME','HOLD']);
  state.hold={status:'ACTIVE'};
  await assert.rejects(run(),{code:'LEGACY_DRIVER_SETTLEMENT_PROOF_REQUIRED'});
});

test('a released legacy hold requires matching ledger entries and completed lifecycle evidence',async()=>{
  const {state,run}=fixture(1200);
  assert.equal((await run()).length,6);
  state.credit={...state.credit,amount:1100};
  await assert.rejects(run(),{code:'LEGACY_DRIVER_SETTLEMENT_PROOF_REQUIRED'});
  state.credit={...state.credit,amount:1200};
  state.journal={...state.journal,status:'REVIEW_REQUIRED'};
  await assert.rejects(run(),{code:'LEGACY_DRIVER_SETTLEMENT_PROOF_REQUIRED'});
});
