import { addMoney, moneyFromMinor, readMoney, toWholeIqdExact } from './money';
import { quoteEntityIdValid } from './deliveryQuoteRecord';
type Row = Record<string, any>;
export class PlatformPromotionFundingError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'PlatformPromotionFundingError'; }
}
const fail = (code='DISCOUNT_FUNDING_UNAVAILABLE'):never=>{throw new PlatformPromotionFundingError(code);};
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
/** Pure cash reservation operation builder shared by goods and delivery subsidies.
 * One platform wallet update even with both components. Requires trusted source
 * amounts/metadata and atomic commit with order, budget, usage and authority
 * fences. Never executes these operations; not an external or driver endpoint.
 */
export function preparePlatformPromotionFunding(input:{orderId:string;at:string;wallet:Row;components:Array<{kind:'GOODS'|'DELIVERY';amount:unknown;metadata:Row}>}) {
 const {orderId,at,wallet}=input,walletId='WALLET#PLATFORM';
 if(!quoteEntityIdValid(orderId)||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at||!Array.isArray(input.components)||input.components.length<1||input.components.length>2)return fail();
 const seen=new Set<string>();let total=moneyFromMinor(0);
 const components=input.components.map(c=>{
  if(!c||!['GOODS','DELIVERY'].includes(c.kind)||seen.has(c.kind)||!c.metadata||typeof c.metadata!=='object'||Array.isArray(c.metadata))return fail();seen.add(c.kind);
  let amount;try{const m=readMoney(c.amount);amount=toWholeIqdExact(m);if(amount<=0)return fail();total=addMoney(total,m);}catch{return fail('FUNDING_WALLET_PRECISION_UNSUPPORTED');}
  return {...c,amount,metadata:copy(c.metadata)};
 });
 let amount:number;try{amount=toWholeIqdExact(total);}catch{return fail();}
 if(!wallet||wallet.walletId!==walletId||wallet.sk!=='META'||wallet.ownerType!=='PLATFORM'||wallet.status!=='ACTIVE'||wallet.currency!=='IQD'||
  !Number.isSafeInteger(wallet.availableBalance)||wallet.availableBalance<amount||!Number.isSafeInteger(wallet.lockedBalance)||wallet.lockedBalance<0||
  !Number.isSafeInteger(wallet.availableBalance+wallet.lockedBalance)||!Number.isSafeInteger(wallet.lockedBalance+amount)||!Number.isSafeInteger(wallet.version)||wallet.version<1||wallet.version>=Number.MAX_SAFE_INTEGER||wallet.deletionRequestId!=null)return fail();
 const names:Row={},values:Row={},clauses:string[]=[];
 ['walletId','sk','ownerType','ownerId','status','currency','availableBalance','lockedBalance','version','deletionRequestId'].forEach((k,i)=>{names['#p'+i]=k;if(wallet[k]===undefined)clauses.push('attribute_not_exists(#p'+i+')');else{values[':p'+i]=copy(wallet[k]);clauses.push('#p'+i+'=:p'+i);}});
 const operations:Row[]=[{Update:{TableName:'staging-Wallets',Key:{walletId,sk:'META'},ConditionExpression:clauses.join(' AND '),
  UpdateExpression:'SET availableBalance=:available, lockedBalance=:locked, #wv=:next, updatedAt=:at',ExpressionAttributeNames:{...names,'#wv':'version'},
  ExpressionAttributeValues:{...values,':available':wallet.availableBalance-amount,':locked':wallet.lockedBalance+amount,':next':wallet.version+1,':at':at}}}];
 let available=wallet.availableBalance,locked=wallet.lockedBalance;
 for(const c of components){
  const delivery=c.kind==='DELIVERY',prefix=delivery?'DELIVERY_PROMO':'PROMO',holdId=prefix+'#'+orderId,sk=delivery?'DELIVERY_PROMOTION_FUNDING':'PROMOTION_FUNDING',purpose=delivery?'PLATFORM_DELIVERY_SUBSIDY':'PLATFORM_GOODS_DISCOUNT';
  operations.push({Put:{TableName:'staging-Holds',Item:{orderId,sk,holdId,walletId,amount:c.amount,status:'ACTIVE',purpose,statusCreatedAt:'ACTIVE#'+at,createdAt:at,updatedAt:at,metadata:{...c.metadata,orderId}},ConditionExpression:'attribute_not_exists(orderId)'}});
  operations.push({Put:{TableName:'staging-AuditLog',Item:{logId:holdId,sk:at+'#'+holdId,datePartition:'date#'+at.slice(0,10).replace(/-/g,''),actorId:'SYSTEM_COMMERCIAL_ORDER',targetId:orderId,createdAt:at,action:'PROMOTION_FUNDING_RESERVED',walletId,orderId,holdId,amount:c.amount,currency:'IQD',timestamp:at,metadata:c.metadata},ConditionExpression:'attribute_not_exists(sk)'}});
  for(const bucket of ['AVAILABLE','LOCKED']){
   const debit=bucket==='AVAILABLE',balance=debit?available:locked;
   operations.push({Put:{TableName:'staging-LedgerEntries',Item:{walletId,sk:`ts#${at}#${prefix}_${bucket}#${orderId}`,transactionId:holdId,type:debit?'DEBIT':'CREDIT',category:'HOLD_CREATED',amount:debit?-c.amount:c.amount,balanceBefore:balance,balanceAfter:balance+(debit?-c.amount:c.amount),relatedEntityId:orderId,relatedEntityType:'HOLD',metadata:{orderId,holdId,balanceType:bucket,purpose},createdAt:at},ConditionExpression:'attribute_not_exists(sk)'}});
  }
  available-=c.amount;locked+=c.amount;
 }
 return {amount:total,operations,requiresAtomicCommit:true as const};
}
