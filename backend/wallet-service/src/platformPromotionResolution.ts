import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { strongGet, exactCheck, updateChecked, equal } from './driverFinancialTransaction';
import { quoteEntityIdValid } from './deliveryQuoteRecord';
import { addMoney, moneyFromMinor, readMoney, toWholeIqdExact } from './money';
type Row=Record<string,any>;
export class PlatformPromotionResolutionError extends Error {
 constructor(public readonly code:string){super(code);this.name='PlatformPromotionResolutionError';}
}
const fail=(code='PROMOTION_RESOLUTION_CONFLICT'):never=>{throw new PlatformPromotionResolutionError(code);};
function exact(v:unknown,keys:string[]):Row {
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))return fail();return v as Row;
}
function instant(v:unknown):number {if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)return fail();return Date.parse(v);}
/** Read-only terminal cash-hold planner, not a public cancellation/capture API.
 * expected amounts/metadata come from the original verified order funding proof,
 * never current campaign terms or a client. No funds move on calling this method.
 * walletDelta MUST be combined with completion/cancellation's other platform
 * movements into ONE guarded wallet update and balanced journal. Hold updates,
 * walletCheck, audit and campaign terminal operations must join that transaction.
 */
export function createStagingPlatformPromotionResolution(options:{db:Pick<DynamoDBDocumentClient,'send'>}) {
 const {db}=options;
 return Object.freeze({async prepare(value:unknown){
  const r=exact(value,['orderId','operationId','outcome','at','expected']);
  if(!quoteEntityIdValid(r.orderId)||!quoteEntityIdValid(r.operationId)||!['CAPTURED','RELEASED'].includes(r.outcome)||!Array.isArray(r.expected)||r.expected.length!==2)return fail();
  const at=instant(r.at),seen=new Set<string>(),operations:Row[]=[],active:Row[]=[],terminal:Row[]=[];
  let total=moneyFromMinor(0);
  for(const raw of r.expected){
   const c=exact(raw,['kind','amount','metadata']);if(!['GOODS','DELIVERY'].includes(c.kind)||seen.has(c.kind)||!c.metadata||typeof c.metadata!=='object'||Array.isArray(c.metadata))return fail();seen.add(c.kind);
   let amount;try{amount=toWholeIqdExact(readMoney(c.amount));if(amount<0)return fail();total=addMoney(total,readMoney(c.amount));}catch{return fail('PROMOTION_RESOLUTION_PRECISION_UNSUPPORTED');}
   const delivery=c.kind==='DELIVERY',key={orderId:r.orderId,sk:delivery?'DELIVERY_PROMOTION_FUNDING':'PROMOTION_FUNDING'},hold=await strongGet(db,'staging-Holds',key);
   if(!amount){if(hold)return fail();operations.push({ConditionCheck:{TableName:'staging-Holds',Key:key,ConditionExpression:'attribute_not_exists(orderId)'}});continue;}
   const holdId=(delivery?'DELIVERY_PROMO#':'PROMO#')+r.orderId;
   if(!hold||hold.orderId!==r.orderId||hold.sk!==key.sk||hold.holdId!==holdId||hold.walletId!=='WALLET#PLATFORM'||hold.amount!==amount||
    hold.purpose!==(delivery?'PLATFORM_DELIVERY_SUBSIDY':'PLATFORM_GOODS_DISCOUNT')||!equal(hold.metadata,{...c.metadata,orderId:r.orderId})||instant(hold.createdAt)>at)return fail();
   const status=r.outcome==='CAPTURED'?'SETTLED':'RELEASED';
   if(hold.status===status&&hold.settlementOperationId===r.operationId){terminal.push(hold);continue;}
   if(hold.status!=='ACTIVE'||hold.settlementOperationId!=null)return fail();active.push(hold);
   const check=exactCheck('staging-Holds',key,hold);
   operations.push(updateChecked(check,'SET #s=:s, statusCreatedAt=:sc, updatedAt=:at, settledAt=:at, settlementOperationId=:op',{'#s':'status'},{':s':status,':sc':status+'#'+r.at,':at':r.at,':op':r.operationId}));
  }
  if(terminal.length){if(active.length)return fail();return {replayed:true,operations:[],walletDelta:{available:0,locked:0},requiresAtomicLifecycleCommit:true};}
  const amount=toWholeIqdExact(total);
  if(!amount)return {replayed:false,operations,walletDelta:{available:0,locked:0},requiresAtomicLifecycleCommit:true};
  const walletKey={walletId:'WALLET#PLATFORM',sk:'META'},wallet=await strongGet(db,'staging-Wallets',walletKey);
  if(!wallet||wallet.walletId!==walletKey.walletId||wallet.sk!=='META'||wallet.ownerType!=='PLATFORM'||!(wallet.status==='ACTIVE'||r.outcome==='RELEASED'&&wallet.status==='SUSPENDED')||wallet.currency!=='IQD'||wallet.deletionRequestId!=null||
   !Number.isSafeInteger(wallet.version)||wallet.version<1||wallet.version>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(wallet.availableBalance)||wallet.availableBalance<0||!Number.isSafeInteger(wallet.lockedBalance)||wallet.lockedBalance<amount||!Number.isSafeInteger(wallet.availableBalance+wallet.lockedBalance))return fail('PROMOTION_RESOLUTION_WALLET_UNAVAILABLE');
  // The existing completion journal combines +funding with H-M-A. This transfer
  // alone is not an expense, payable credit or proof of a delivered order.
  operations.push({Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+r.at.slice(0,10).replace(/-/g,''),sk:r.at+'#'+r.operationId+'#PROMOTION_RESOLUTION',logId:r.operationId+'#PROMOTION_RESOLUTION',action:'PLATFORM_PROMOTIONS_'+r.outcome,orderId:r.orderId,operationId:r.operationId,amount,currency:'IQD',createdAt:r.at,actorId:'SYSTEM_ORDER_FINANCIAL_LIFECYCLE'},ConditionExpression:'attribute_not_exists(sk)'}});
  return {replayed:false,operations,walletCheck:exactCheck('staging-Wallets',walletKey,wallet,[...new Set([...Object.keys(wallet),'deletionRequestId'])]),walletDelta:{available:amount,locked:-amount},fundingAmount:total,requiresAtomicLifecycleCommit:true};
 }});
}
