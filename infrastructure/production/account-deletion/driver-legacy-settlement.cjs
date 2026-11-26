'use strict';

const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');

const ledgerTable='wizz-production-LedgerEntries';
const fail=()=>{throw error('LEGACY_DRIVER_SETTLEMENT_PROOF_REQUIRED');};

function legacyAcceptedOffer(offer) {
  return offer.responseStatus==='accepted' && offer.isWinner===true &&
    offer.dispatchReceipt?.kind==='PINNED_LEGACY_ACCEPTANCE';
}

async function legacyDriverSettlementGuards({db,subjectId,order,offers,maxPages}) {
  const get=async (TableName,Key)=>(await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
  const check=(TableName,Key,row)=>({ConditionCheck:{TableName,Key,...exact(row)}});
  const absent=(TableName,Key,field)=>({ConditionCheck:{TableName,Key,
    ConditionExpression:'attribute_not_exists(#key)',ExpressionAttributeNames:{'#key':field}}});
  const {orderId}=order;
  const walletId='WALLET#DRIVER#'+subjectId;
  const accepted=offers.filter(legacyAcceptedOffer);
  if (order.status!=='delivered' || order.orderStatus!=='delivered' || accepted.length!==1 ||
      order.driverId!==subjectId || order.assignmentAttemptCounter!==1 ||
      order.financialAcceptance!=null || order.financialOutcome!=null) fail();
  const offer=accepted[0], receipt=offer.dispatchReceipt, orderReceipt=order.dispatchAcceptance;
  const binding=['kind','success','orderId','offerId','driverId','subjectId','acceptedAt','holdId',
    'holdStatus','holdAmount','assignmentAttempt','acceptanceAttemptId'];
  if (receipt.success!==true || receipt.orderId!==orderId || receipt.offerId!==offer.offerId ||
      receipt.driverId!==subjectId || receipt.subjectId!==subjectId || receipt.assignmentAttempt!==1 ||
      !Number.isFinite(Date.parse(receipt.acceptedAt)) || receipt.acceptedAt!==offer.responseAt ||
      !Number.isSafeInteger(receipt.holdAmount)||receipt.holdAmount<0||receipt.holdAmount!==offer.holdRequiredAmount||
      !/^[a-f0-9]{64}$/.test(offer.legacyTermsDigest??'') ||
      order.assignmentWaveNumber!==offer.waveNumber||order.holdAmount!==receipt.holdAmount||
      (order.holdId??null)!==receipt.holdId ||
      binding.some(field=>orderReceipt?.[field]!==receipt[field])) fail();

  const payableKey={orderId,sk:'MERCHANT_PAYABLE'}, outcomeKey={orderId,sk:'FINANCIAL_OUTCOME'};
  const holdKey={orderId,sk:'HOLD'};
  const [payable,outcome,hold]=await Promise.all([
    get(tables.holds,payableKey),get(tables.holds,outcomeKey),get(tables.holds,holdKey),
  ]);
  if (payable || outcome) fail();
  const guards=[absent(tables.holds,payableKey,'orderId'),absent(tables.holds,outcomeKey,'orderId')];
  if (receipt.acceptanceAttemptId) {
    const attemptKey={orderId,SK:'DISPATCH_ACCEPTANCE#'+receipt.acceptanceAttemptId};
    const attempt=await get(tables.dispatch,attemptKey);
    if (!attempt||attempt.kind!=='LEGACY_ACCEPTANCE_ATTEMPT'||attempt.state!=='ASSIGNED'||
        attempt.orderId!==orderId||attempt.attemptId!==receipt.acceptanceAttemptId||
        attempt.driverId!==subjectId||attempt.subjectId!==subjectId||attempt.offerId!==offer.offerId||
        attempt.cycleId!==offer.dispatchCycleId||attempt.offerDigest!==offer.legacyTermsDigest||
        attempt.amount!==receipt.holdAmount||attempt.holdId!==receipt.holdId||
        binding.some(field=>attempt.receipt?.[field]!==receipt[field])) fail();
    if (attempt.legalHold||attempt.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
    guards.push(check(tables.dispatch,attemptKey,attempt));
  }
  if (!receipt.holdAmount) {
    if (hold || receipt.holdId!==null || receipt.holdStatus!=='NOT_REQUIRED' || order.holdStatus!=='NOT_REQUIRED') fail();
    return [...guards,absent(tables.holds,holdKey,'orderId')];
  }
  if (!hold||hold.orderId!==orderId||hold.walletId!==walletId||hold.holdId!==receipt.holdId||
      hold.amount!==receipt.holdAmount||hold.financialSchemaVersion!==undefined||
      !['CAPTURED','RELEASED'].includes(hold.status)||receipt.holdStatus!=='ACTIVE'||
      typeof hold.holdId!=='string'||!hold.holdId||
      (receipt.acceptanceAttemptId && hold.metadata?.pinnedDispatchAttemptId!==receipt.acceptanceAttemptId)) fail();
  if (hold.legalHold||hold.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
  const operationKey={operationId:hold.holdId};
  const lifecycle=await get(tables.events,operationKey);
  if (!lifecycle||!['SETTLED','COMPLETED'].includes(lifecycle.status)||lifecycle.result!==hold.status||
      lifecycle.operationId!==hold.holdId||lifecycle.orderId!==orderId||
      lifecycle.walletId!==walletId||lifecycle.amount!==hold.amount) fail();
  if (lifecycle.legalHold||lifecycle.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
  const captured=hold.status==='CAPTURED';
  const timestamp=captured?hold.capturedAt:hold.releasedAt;
  if (!Number.isFinite(Date.parse(timestamp)) || Date.parse(timestamp)<Date.parse(receipt.acceptedAt) ||
      captured&&(!Number.isSafeInteger(hold.capturedAmount)||hold.capturedAmount<1||hold.capturedAmount>hold.amount)) fail();

  const ledgerPrefix='ts#'+timestamp+'#';
  const debits=[];
  let cursor, pages=0;
  do {
    const result=await db.send(new QueryCommand({
      TableName:ledgerTable,ConsistentRead:true,Limit:100,ExclusiveStartKey:cursor,
      KeyConditionExpression:'walletId=:wallet AND begins_with(sk,:prefix)',
      ExpressionAttributeValues:{':wallet':walletId,':prefix':ledgerPrefix},
    }));
    debits.push(...(result.Items??[]).filter(row=>row.walletId===walletId&&
      row.sk===ledgerPrefix+row.transactionId+'#0'&&row.type===(captured?'HOLD_CAPTURED':'HOLD_RELEASED')&&
      row.amount===-hold.amount&&row.relatedEntityId===hold.holdId&&row.relatedEntityType==='HOLD'&&
      row.metadata?.orderId===orderId&&row.metadata?.holdId===hold.holdId));
    cursor=result.LastEvaluatedKey;
    if (++pages>=maxPages&&cursor) throw error('INVENTORY_INCOMPLETE');
  } while(cursor);
  if (debits.length!==1||typeof debits[0].transactionId!=='string'||!debits[0].transactionId) fail();
  const debit=debits[0];
  const creditKey={walletId:captured?'WALLET#PLATFORM':walletId,sk:ledgerPrefix+debit.transactionId+'#1'};
  const credit=await get(ledgerTable,creditKey);
  if (!credit||credit.transactionId!==debit.transactionId||credit.type!==(captured?'SETTLEMENT_RECEIVED':'HOLD_RELEASED')||
      credit.amount!==(captured?hold.capturedAmount:hold.amount)||credit.relatedEntityId!==hold.holdId||
      credit.relatedEntityType!=='HOLD'||credit.metadata?.orderId!==orderId||credit.metadata?.holdId!==hold.holdId) fail();
  const counterpart=[check(ledgerTable,creditKey,credit)];
  if (captured&&hold.capturedAmount<hold.amount) {
    const remainderKey={walletId,sk:creditKey.sk};
    const remainder=await get(ledgerTable,remainderKey);
    if (!remainder||remainder.transactionId!==debit.transactionId||remainder.type!=='HOLD_PARTIAL_RELEASE'||
        remainder.amount!==hold.amount-hold.capturedAmount||remainder.relatedEntityId!==hold.holdId||
        remainder.metadata?.orderId!==orderId||remainder.metadata?.holdId!==hold.holdId) fail();
    if (remainder.legalHold||remainder.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
    counterpart.push(check(ledgerTable,remainderKey,remainder));
  }
  if (debit.legalHold||debit.retentionHold||credit.legalHold||credit.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
  return [...guards,check(tables.holds,holdKey,hold),check(tables.events,operationKey,lifecycle),
    check(ledgerTable,{walletId,sk:debit.sk},debit),...counterpart];
}

module.exports={legacyAcceptedOffer,legacyDriverSettlementGuards};
