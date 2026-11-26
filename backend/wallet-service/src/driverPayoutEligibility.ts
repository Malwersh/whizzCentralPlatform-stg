import {QueryCommand,BatchGetCommand,DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {strongGet,equal,exactCheck} from './driverFinancialTransaction';
import {ledgerEffect} from './ledgerEffects';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
type Row=Record<string,any>;
export const DRIVER_PAYOUT_POLICY='DRIVER_CASH_PAYOUT_V1';
export const payoutFail=(code:string):never=>{throw Object.assign(Error(code),{code});};
export function validDriverPayoutWallet(w:Row|null,driverId:string){
 if(!w||w.walletId!=='WALLET#DRIVER#'+driverId||w.sk!=='META'||w.ownerId!==driverId||w.ownerType!=='DRIVER'||w.currency!=='IQD'||w.status!=='ACTIVE'||w.deletedAt!=null||w.deletionRequestId!=null||w.isDeleted===true||![w.availableBalance,w.lockedBalance,w.driverPayoutReservedIqd??0].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isSafeInteger(w.version)||w.version<1||w.version>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(w.availableBalance+w.lockedBalance)||(w.driverPayoutReservedIqd??0)>w.lockedBalance)return payoutFail('DRIVER_PAYOUT_WALLET_UNAVAILABLE');
 return w;
}
/** Conservative source budget: unknown credits NEVER become refundable. Temporary
 * moves between AVAILABLE/LOCKED net to zero within their immutable operation.
 * All net debits consume verified funding first. All locked liability is excluded.
 * This is a refundable floor, not a claim to all historical income. No repair writes.
 */
export function driverPayoutBudget(wallet:Row,entries:Row[],verified:Map<string,Row>){
 const seen=new Set<string>(),ops=new Map<string,{delta:number;mint:number;lastKey:string}>();let total=0,sourceTotal=0;const sources:Row[]=[];
 for(const e of entries){
  if(e.walletId!==wallet.walletId||typeof e.sk!=='string'||seen.has(e.sk))return payoutFail('DRIVER_PAYOUT_HISTORY_UNVERIFIED');seen.add(e.sk);
  const fx=ledgerEffect(e),op=e.transactionId||e.txnId;
  if(fx.status!=='CLASSIFIED'||typeof op!=='string'||!op)return payoutFail('DRIVER_PAYOUT_HISTORY_UNVERIFIED');
  total+=fx.delta;const operation=ops.get(op)??{delta:0,mint:0,lastKey:e.sk};operation.delta+=fx.delta;if(e.sk>operation.lastKey)operation.lastKey=e.sk;ops.set(op,operation);
  const proof=verified.get(e.sk);
  if(proof){if(fx.bucket!=='AVAILABLE'||fx.delta<=0||proof.amountIqd!==fx.delta||!proof.sourceId||sources.some(s=>s.sourceId===proof.sourceId))return payoutFail('DRIVER_PAYOUT_SOURCE_INVALID');sourceTotal+=fx.delta;operation.mint+=fx.delta;sources.push(proof);}
  if(![total,sourceTotal,operation.delta,operation.mint].every(Number.isSafeInteger))return payoutFail('DRIVER_PAYOUT_AMOUNT_INVALID');
 }
 // Full history is required, including opening funding. Never invent an opening balance.
 if(total!==wallet.availableBalance+wallet.lockedBalance)return payoutFail('DRIVER_PAYOUT_RECONCILIATION_REQUIRED');
 let remaining=0,netDebits=0;
 for(const operation of [...ops.values()].sort((a,b)=>a.lastKey<b.lastKey?-1:a.lastKey>b.lastKey?1:0)){
  netDebits+=Math.max(0,-operation.delta);
  remaining=Math.max(0,remaining+operation.mint+Math.min(0,operation.delta-operation.mint));
  if(!Number.isSafeInteger(remaining)||!Number.isSafeInteger(netDebits))return payoutFail('DRIVER_PAYOUT_AMOUNT_INVALID');
 }
 const consumed=sourceTotal-remaining;
 const eligibleIqd=Math.min(wallet.availableBalance,Math.max(0,remaining-wallet.lockedBalance));
 return {policyVersion:DRIVER_PAYOUT_POLICY,eligibleIqd,verifiedFundingIqd:sourceTotal,consumedIqd:consumed,lockedExcludedIqd:wallet.lockedBalance,sources,sourcesDigest:quoteHash(sources),historyDigest:quoteHash(entries),historyCount:entries.length,historyLastKey:entries.map(e=>e.sk).sort().at(-1)??null,coverage:'COMPLETE_HISTORY',calculation:'CONSERVATIVE_VERIFIED_FUNDING_FLOOR'};
}
export async function readDriverPayoutEligibility(db:Pick<DynamoDBDocumentClient,'send'>,driverId:string){
 if(!quoteEntityIdValid(driverId))return payoutFail('DRIVER_PAYOUT_INVALID_DRIVER');
 const wk={walletId:'WALLET#DRIVER#'+driverId,sk:'META'},w=validDriverPayoutWallet(await strongGet(db,'staging-Wallets',wk),driverId),rows:Row[]=[];let cursor:Row|undefined;
 for(let page=0;page<20;page++){
  const r=await db.send(new QueryCommand({TableName:'staging-LedgerEntries',KeyConditionExpression:'walletId=:w',ExpressionAttributeValues:{':w':wk.walletId},ConsistentRead:true,Limit:250,...(cursor?{ExclusiveStartKey:cursor}:{})}));rows.push(...(r.Items||[]));if(!r.LastEvaluatedKey){cursor=undefined;break;}if(equal(cursor??null,r.LastEvaluatedKey))return payoutFail('DRIVER_PAYOUT_HISTORY_UNVERIFIED');cursor=r.LastEvaluatedKey;
 }
 if(cursor)return payoutFail('DRIVER_PAYOUT_HISTORY_TOO_LARGE');
 const proofs=new Map<string,Row>(),needs=new Map<string,{table:string;key:Row}>();
 const proofId=(table:string,key:Row)=>table+'|'+JSON.stringify(key);
 for(const e of rows){let table:string|undefined,k:Row|undefined;
  if(e.type==='TOPUP'&&e.amount>0&&e.relatedEntityType==='TOPUP'){
   if(e.metadata?.method==='ZAINCASH_GATEWAY'){table='staging-IdempotencyKeys';k={idempotencyKey:'ZC#PAYMENT#'+driverId+'#'+e.relatedEntityId,sk:'META'};}
   else{table='staging-TopupRequests';k={topupId:e.relatedEntityId,sk:'META'};}
  }else if(e.category==='ORDER_EXCEPTION_FINANCIAL'&&e.amount>0&&e.metadata?.balanceType==='AVAILABLE'&&String(e.transactionId).startsWith('EXF:')){table='staging-Holds';k={orderId:e.relatedEntityId,sk:'EXCEPTION_ENTITLEMENTS'};}
  if(table&&k){if(Object.values(k).some(v=>typeof v!=='string'||!v||v.length>300))return payoutFail('DRIVER_PAYOUT_SOURCE_INVALID');needs.set(proofId(table,k),{table,key:k});}
 }
 const all=[...needs.values()];
 for(let n=0;n<all.length;n+=100){let request:Row={};for(const item of all.slice(n,n+100))(request[item.table]??={Keys:[],ConsistentRead:true}).Keys.push(item.key);
  for(let attempt=0;Object.keys(request).length;attempt++){
   if(attempt>=3)return payoutFail('DRIVER_PAYOUT_SOURCE_UNAVAILABLE');
   const out=await db.send(new BatchGetCommand({RequestItems:request}));
   for(const [table,items]of Object.entries(out.Responses??{}))for(const item of items){const k=table==='staging-Holds'?{orderId:item.orderId,sk:item.sk}:table==='staging-TopupRequests'?{topupId:item.topupId,sk:item.sk}:{idempotencyKey:item.idempotencyKey,sk:item.sk};proofs.set(proofId(table,k),item);}
   request=out.UnprocessedKeys??{};
  }
 }
 const getProof=(table:string,k:Row)=>proofs.get(proofId(table,k));
 const verified=new Map<string,Row>();
 for(const e of rows){
  if(e.type==='TOPUP'&&e.amount>0&&e.relatedEntityType==='TOPUP'){
   if(e.metadata?.method==='ZAINCASH_GATEWAY'){
    const p=getProof('staging-IdempotencyKeys',{idempotencyKey:'ZC#PAYMENT#'+driverId+'#'+e.relatedEntityId,sk:'META'});
    if(p?.state==='SUCCESS'&&p.driverId===driverId&&p.amount===e.amount&&p.transactionId===e.transactionId&&p.paymentId===e.metadata.providerPaymentId&&p.mode==='LIVE')verified.set(e.sk,{sourceId:e.transactionId,kind:'VERIFIED_GATEWAY_TOPUP',amountIqd:e.amount,digest:quoteHash(p)});
   }else{
    const p=getProof('staging-TopupRequests',{topupId:e.relatedEntityId,sk:'META'});
    if(p?.status==='APPROVED'&&p.driverId===driverId&&p.walletId===wk.walletId&&p.amount===e.amount&&p.approvedAt&&p.approvedById&&p.approvedById===e.metadata?.approvedById)verified.set(e.sk,{sourceId:'TOPUP#'+p.topupId,kind:'APPROVED_TOPUP',amountIqd:e.amount,digest:quoteHash(p)});
   }
  }else if(e.category==='ORDER_EXCEPTION_FINANCIAL'&&e.amount>0&&e.metadata?.balanceType==='AVAILABLE'&&String(e.transactionId).startsWith('EXF:')){
   const j=getProof('staging-Holds',{orderId:e.relatedEntityId,sk:'EXCEPTION_ENTITLEMENTS'});
   if(j){const {digest,...body}=j;const line=j.walletLines?.find((l:Row)=>l.walletId===wk.walletId&&l.balanceType==='AVAILABLE');
    if(digest===quoteHash(body)&&j.kind==='ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL'&&j.state==='POSTED'&&j.driverId===driverId&&j.operationId===e.transactionId&&j.driverFareIqd===e.amount&&line?.delta===e.amount&&line.balanceBefore===e.balanceBefore&&line.balanceAfter===e.balanceAfter)verified.set(e.sk,{sourceId:j.operationId,orderId:j.orderId,caseId:j.caseId,kind:'APPROVED_COMPENSATION',amountIqd:e.amount,digest});}
  }
 }
 const after=await strongGet(db,'staging-Wallets',wk);if(!equal(w,after))return payoutFail('DRIVER_PAYOUT_WALLET_CHANGED');
 return {wallet:w,budget:driverPayoutBudget(w,rows,verified),walletGuard:exactCheck('staging-Wallets',wk,w,[...Object.keys(w),'driverPayoutReservedIqd','driverPayoutActiveId','deletedAt','deletionRequestId','isDeleted'])};
}
