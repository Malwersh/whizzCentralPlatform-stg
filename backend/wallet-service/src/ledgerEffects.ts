/** Read-only interpretation of the entry shapes produced by this service.
 * Unknown or contradictory shapes remain unclassified; no ledger is rewritten.
 */
export const EFFECT_RULE_VERSION = 'LEDGER_EFFECTS_V8';
type Bucket = 'AVAILABLE' | 'LOCKED';
type Effect = {status:'CLASSIFIED';bucket:Bucket;delta:number} | {status:'UNCLASSIFIED';reason:'UNKNOWN_SHAPE'|'INVALID_VALUES'};
export function ledgerEffect(row:Record<string,any>):Effect {
  const unknown:Effect={status:'UNCLASSIFIED',reason:'UNKNOWN_SHAPE'};
  const invalid:Effect={status:'UNCLASSIFIED',reason:'INVALID_VALUES'};
  if(!Number.isSafeInteger(row.amount)||row.amount===0)return invalid;
  const amount=row.amount;
  if(row.category==='CASH_ADJUDICATION_SETTLED'){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.metadata?.decisionId??'')||
      !Number.isSafeInteger(row.metadata?.driverShortfallCreditIqd)||row.metadata.driverShortfallCreditIqd<0)return invalid;
    return ledgerEffect({...row,category:'FULL_CASH_COMPLETED'});
  }
  if(row.category==='MERCHANT_PAYOUT_PAID'){
    const m=row.metadata;
    if(row.type!=='DEBIT'||amount>=0||!/^MPO:[a-f0-9]{48}$/.test(row.transactionId||'')||row.transactionId!==row.relatedEntityId||m?.payoutId!==row.transactionId||row.relatedEntityType!=='MERCHANT_PAYOUT'||m?.balanceType!=='LOCKED'||row.walletId!=='WALLET#MERCHANT#'+m?.branchId||! /^[a-f0-9]{64}$/.test(m?.journalDigest||'')||!Number.isSafeInteger(row.balanceBefore)||!Number.isSafeInteger(row.balanceAfter)||row.balanceAfter<0||row.balanceAfter-row.balanceBefore!==amount)return invalid;
    return {status:'CLASSIFIED',bucket:'LOCKED',delta:amount};
  }
  const beforeAfter=row.balanceBefore!==undefined||row.balanceAfter!==undefined;
  const validPair=Number.isSafeInteger(row.balanceBefore)&&Number.isSafeInteger(row.balanceAfter)&&row.balanceBefore>=0&&row.balanceAfter>=0;
  const validBalance=Number.isSafeInteger(row.balance)&&row.balance>=0;
  function result(bucket:Bucket,delta:number,pairRequired:boolean):Effect {
    if(!Number.isSafeInteger(delta))return invalid;
    if(pairRequired&&!validPair||beforeAfter&&(!validPair||row.balanceAfter-row.balanceBefore!==delta))return invalid;
    if(!pairRequired&&!beforeAfter&&!validBalance)return invalid;
    // A legacy single balance and the explicit pair must agree when both exist.
    if(row.balance!==undefined&&(!validBalance||beforeAfter&&row.balance!==row.balanceAfter))return invalid;
    return {status:'CLASSIFIED',bucket,delta};
  }
  if(['DRIVER_PAYOUT_RESERVED','DRIVER_PAYOUT_RELEASED','DRIVER_PAYOUT_PAID'].includes(row.category)) {
    const m=row.metadata,bucket=m?.balanceType;
    if(m?.financialSchemaVersion!==1||!['AVAILABLE','LOCKED'].includes(bucket)||row.relatedEntityType!=='DRIVER_PAYOUT'||row.walletId!=='WALLET#DRIVER#'+m.driverId||!/^DPO:[a-f0-9]{48}$/.test(m.payoutId||'')||row.relatedEntityId!==m.payoutId||!/^DPC:[a-f0-9-]{36}$/.test(row.transactionId||'')||row.type!==(amount>0?'CREDIT':'DEBIT')||!String(row.sk).endsWith('#'+bucket+'#'+row.transactionId.slice(4)))return invalid;
    const validSign=row.category==='DRIVER_PAYOUT_RESERVED'?(bucket==='AVAILABLE'?amount<0:amount>0):row.category==='DRIVER_PAYOUT_RELEASED'?(bucket==='AVAILABLE'?amount>0:amount<0):bucket==='LOCKED'&&amount<0;
    return validSign?result(bucket,amount,true):invalid;
  }
  if(['COD_COMPLETED','COD_RETURN_RELEASED','COD_ASSIGNMENT_RELEASED'].includes(row.category)){
    const bucket=row.metadata?.balanceType,operation=row.metadata?.operationId;
    if(![2,3].includes(row.metadata?.financialSchemaVersion)||!['AVAILABLE','LOCKED'].includes(bucket)||
      typeof operation!=='string'||!(row.category==='COD_COMPLETED'?/^COD:[a-f0-9]{48}$/:row.category==='COD_RETURN_RELEASED'?/^CR:[a-f0-9]{48}$/:/^CA:[a-f0-9]{48}$/).test(operation)||row.transactionId!==operation||
      row.relatedEntityType!=='ORDER'||row.relatedEntityId!==row.metadata?.orderId||
      typeof row.sk!=='string'||!row.sk.endsWith('#'+bucket+'#'+operation)||row.type!==(amount>0?'CREDIT':'DEBIT'))return invalid;
    return result(bucket,amount,true);
  }
  if(['FULL_CASH_COMPLETED','FULL_CASH_RELEASED'].includes(row.category)){
    const bucket=row.metadata?.balanceType,operation=row.metadata?.operationId;
    if(row.metadata?.financialSchemaVersion!==4||row.metadata?.settlementModel!=='FULL_CASH_AT_DELIVERY_V1'||!['AVAILABLE','LOCKED'].includes(bucket)||
      typeof operation!=='string'||!(row.category==='FULL_CASH_COMPLETED'?/^FCS:[a-f0-9]{48}$/:/^(CA|CR):[a-f0-9]{48}$/).test(operation)||row.transactionId!==operation||
      row.relatedEntityType!=='ORDER'||row.relatedEntityId!==row.metadata?.orderId||typeof row.sk!=='string'||!row.sk.endsWith('#'+bucket+'#'+operation)||row.type!==(amount>0?'CREDIT':'DEBIT'))return invalid;
    return result(bucket,amount,true);
  }
  if(row.category==='ORDER_EXCEPTION_FINANCIAL'){const m=row.metadata,bucket=m?.balanceType;if(m?.financialSchemaVersion!==5||!['AVAILABLE','LOCKED'].includes(bucket)||!/^EX[FG]:[a-f0-9]{48}$/.test(row.transactionId||'')||m.operationId!==row.transactionId||row.relatedEntityType!=='ORDER'||row.relatedEntityId!==m.orderId||row.type!==(amount>0?'CREDIT':'DEBIT')||!String(row.sk).endsWith('#'+bucket+'#'+row.transactionId))return invalid;return result(bucket,amount,true);}
  if(row.category==='TRANSFER'){
    if(row.type==='DEBIT'&&amount<0||row.type==='CREDIT'&&amount>0)return result('AVAILABLE',amount,true);
    return invalid;
  }
  // The settlement writer records a positive fee even for the debit side.
  if(row.category==='PLATFORM_FEE'){
    if(amount<0||!['DEBIT','CREDIT'].includes(row.type))return invalid;
    return result('AVAILABLE',row.type==='DEBIT'?-amount:amount,true);
  }
  if(row.category==='HOLD_CREATED'&&row.relatedEntityType==='HOLD'&&[2,4].includes(row.metadata?.financialSchemaVersion)){
    const m=row.metadata,bucket=m.balanceType,id=m.holdId;
    if(!['AVAILABLE','LOCKED'].includes(bucket)||typeof id!=='string'||!(m.financialSchemaVersion===4?/^FCH:[a-f0-9]{48}$/:/^FH:[a-f0-9]{48}$/).test(id)||row.transactionId!==id||row.relatedEntityId!==m.orderId||!String(row.sk).endsWith('#'+bucket+'#'+id)||row.type!==(bucket==='LOCKED'?'CREDIT':'DEBIT')||!(bucket==='LOCKED'?amount>0:amount<0))return invalid;
    return result(bucket,amount,true);
  }
  if(row.category==='HOLD_CREATED'&&row.relatedEntityType==='HOLD'){
    if(row.type==='DEBIT'&&amount<0&&typeof row.transactionId==='string'&&row.transactionId.length>0&&typeof row.sk==='string'&&row.sk.endsWith('#HOLD_DEBIT#'+row.transactionId))return result('AVAILABLE',amount,true);
    if(row.type==='CREDIT'&&amount>0&&typeof row.transactionId==='string'&&row.transactionId.length>0&&typeof row.sk==='string'&&row.sk.endsWith('#HOLD_CREDIT#'+row.transactionId))return result('LOCKED',amount,true);
    return invalid;
  }
  if(row.type==='HOLD_RELEASED'&&row.relatedEntityType==='HOLD')return result(amount<0?'LOCKED':'AVAILABLE',amount,false);
  if(row.type==='HOLD_CAPTURED'&&row.relatedEntityType==='HOLD')return amount<0?result('LOCKED',amount,false):invalid;
  if(row.type==='HOLD_PARTIAL_RELEASE'&&row.relatedEntityType==='HOLD')return amount>0?result('AVAILABLE',amount,false):invalid;
  if(row.type==='TOPUP'&&row.relatedEntityType==='TOPUP')return amount>0?result('AVAILABLE',amount,false):invalid;
  if(row.type==='SETTLEMENT_RECEIVED'&&row.relatedEntityType==='HOLD')return amount>0?result('AVAILABLE',amount,false):invalid;
  return unknown;
}
export function summarizeLedger(entries:Record<string,any>[]){
  const classified=entries.map(row=>({...row,ledgerEffect:ledgerEffect(row)}));
  const unclassifiedCount=classified.filter(row=>row.ledgerEffect.status!=='CLASSIFIED').length;
  const base={ruleVersion:EFFECT_RULE_VERSION,rowCount:entries.length,unclassifiedCount};
  if(unclassifiedCount)return {entries:classified,summary:{...base,status:'UNAVAILABLE' as const,reason:'UNCLASSIFIED_ENTRIES'}};
  const totals={AVAILABLE:{increases:0,decreases:0,net:0},LOCKED:{increases:0,decreases:0,net:0}};
  for(const row of classified){
    const effect=row.ledgerEffect;if(effect.status!=='CLASSIFIED')continue;
    const group=totals[effect.bucket];
    group.increases+=Math.max(effect.delta,0);group.decreases+=Math.max(-effect.delta,0);group.net+=effect.delta;
    if(!Object.values(group).every(Number.isSafeInteger))return {entries:classified,summary:{...base,status:'UNAVAILABLE' as const,reason:'UNSAFE_TOTAL'}};
  }
  return {entries:classified,summary:{...base,status:'AVAILABLE' as const,totals}};
}
