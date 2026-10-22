import {BENEFIT_POLICY_PREFIX,settlePlatformBenefit} from './platformBenefits';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { readDeliveryFundingPolicy, calculatePolicyDeliveryFunding } from './deliveryFundingPolicy';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
type Row = Record<string, any>;
const TABLE = 'staging-PlatformStaff';
export class DeliveryBudgetError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'DeliveryBudgetError'; }
}
const fail = (code = 'INVALID_DELIVERY_BUDGET'): never => { throw new DeliveryBudgetError(code); };
function exact(v: unknown, keys: string[]): Row {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) return fail(); return v as Row;
}
function id(v: unknown): string { if (!quoteEntityIdValid(v)) return fail(); return v; }
function num(v: unknown): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return fail(); return v; }
function increment(v: unknown): number { const n = num(v); if (n < 1 || n === Number.MAX_SAFE_INTEGER) return fail(); return n + 1; }
const budgetKey = (id: string, version: number) => ({pk:'DELIVERY_BUDGET#'+id,sk:'VERSION#'+version});
const usageKey = (id: string, customer: string) => ({pk:'DELIVERY_USAGE#'+id,sk:'CUSTOMER#'+customer});
const holdKey = (order: string) => ({pk:'DELIVERY_RESERVATION#'+order,sk:'META'});
function put(next: Row, before?: Row) {
  const condition = before ? {ConditionExpression:'#v=:v AND #digest=:digest',ExpressionAttributeNames:{'#v':'version','#digest':'digest'},ExpressionAttributeValues:{':v':before.version,':digest':before.digest}} : {ConditionExpression:'attribute_not_exists(pk)'};
  const {digest: _digest,...content} = next;
  return {Put:{TableName:TABLE,Item:{...content,digest:quoteHash(content)},...condition}};
}
function verify(row: Row) {
  const {digest,...content}=row;
  if (typeof digest !== 'string' || digest !== quoteHash(content) || num(row.version)<1 || ![1,2].includes(row.schemaVersion)) return fail();
}
export function validateDeliveryCampaignBudgetRecord(row: Row) {
  if(row.schemaVersion!==1)return fail();
  exact(row,['pk','sk','schemaVersion','version','policyPin','merchantTotal','platformTotal','merchantAvailable','platformAvailable','merchantReserved','platformReserved','merchantSpent','platformSpent','digest']);verify(row);
  for (const party of ['merchant','platform']) {
    const total=num(row[party+'Total']), available=num(row[party+'Available']), reserved=num(row[party+'Reserved']), spent=num(row[party+'Spent']);
    if (BigInt(available)+BigInt(reserved)+BigInt(spent)!==BigInt(total)) return fail();
  }
}
export function validateDeliveryCampaignUsageRecord(row: Row) { if(row.schemaVersion!==1)return fail(); exact(row,['pk','sk','schemaVersion','version','reservedUses','completedUses','digest']);verify(row);num(row.reservedUses);num(row.completedUses); }
/** Campaign spend allowance, NOT cash liquidity or a wallet hold. Creation must
 * join policy acceptance transaction. Each new approved version gets its own cap.
 * Do not sum or reset historical reservations when the current policy changes.
 */
export function deliveryCampaignBudgetInitialization(value: unknown) {
  const {policy,termsHash}=readDeliveryFundingPolicy(value);
  return put({...budgetKey(policy.id,policy.version),schemaVersion:1,version:1,
    policyPin:{policyId:policy.id,version:policy.version,termsHash},merchantTotal:policy.limits.merchantBudget.minorAmount,platformTotal:policy.limits.platformBudget.minorAmount,
    merchantAvailable:policy.limits.merchantBudget.minorAmount,platformAvailable:policy.limits.platformBudget.minorAmount,
    merchantReserved:0,platformReserved:0,merchantSpent:0,platformSpent:0});
}
/** Read-only transaction planner. All returned operations MUST commit with actual
 * order admission/completion/cancellation, its authorization, money liquidity
 * holds, financial journal and audit. Calling this alone changes no state.
 * Terminal outcome authorization is the caller's existing order lifecycle duty.
 */
export function createStagingDeliveryCampaignBudget(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number}) {
  const {db}=options,now=options.now??Date.now;
  async function get(key: Row):Promise<Row|undefined> {
    try { return (await db.send(new GetCommand({TableName:TABLE,Key:key,ConsistentRead:true}))).Item; }
    catch { return fail('DELIVERY_BUDGET_UNAVAILABLE'); }
  }
  return Object.freeze({async reserve(value: unknown) {
    const r=exact(value,['orderId','customerId','policy','referenceFee','customerFee']);id(r.orderId);id(r.customerId);
    const {policy}=readDeliveryFundingPolicy(r.policy),clock=now();
    if (!Number.isSafeInteger(clock)||clock<Date.parse(policy.effectiveFrom)||clock>=Date.parse(policy.effectiveTo)) return fail('DELIVERY_POLICY_EXPIRED');
    const allocation=calculatePolicyDeliveryFunding(policy,r.referenceFee,r.customerFee);
    if (allocation.allocation.subsidy.minorAmount<=0 && policy.schemaVersion!==2) return fail('DELIVERY_SUBSIDY_REQUIRED');
    const m=allocation.allocation.merchantShare.minorAmount,p=allocation.allocation.platformShare.minorAmount;
    const request={orderId:r.orderId,customerId:r.customerId,policyPin:allocation.policyPin,allocation:allocation.allocation};
    const requestDigest=quoteHash(request),existing=await get(holdKey(r.orderId));
    if(existing){verify(existing);if(existing.requestDigest!==requestDigest||!['RESERVED','CAPTURED'].includes(existing.status))return fail('DELIVERY_RESERVATION_CONFLICT');return {replayed:true,status:existing.status,operations:[]};}
    if(policy.schemaVersion===2){
      const hold={...holdKey(r.orderId),schemaVersion:2,version:1,...request,requestDigest,status:'RESERVED',createdAt:new Date(clock).toISOString()};
      return {replayed:false,status:'RESERVED',operations:[put(hold)]};
    }
    const b=await get(budgetKey(policy.id,policy.version));if(!b)return fail('DELIVERY_BUDGET_UNAVAILABLE');validateDeliveryCampaignBudgetRecord(b);
    if(quoteHash(b.policyPin)!==quoteHash(allocation.policyPin)||b.merchantTotal!==policy.limits.merchantBudget.minorAmount||b.platformTotal!==policy.limits.platformBudget.minorAmount)return fail();
    if(b.merchantAvailable<m||b.platformAvailable<p)return fail('DELIVERY_BUDGET_EXHAUSTED');
    const u=await get(usageKey(policy.id,r.customerId));if(u)validateDeliveryCampaignUsageRecord(u);
    if(BigInt(u?.reservedUses??0)+BigInt(u?.completedUses??0)>=BigInt(policy.limits.perCustomerUses))return fail('DELIVERY_USAGE_EXHAUSTED');
    const nextBudget={...b,version:increment(b.version),merchantAvailable:b.merchantAvailable-m,platformAvailable:b.platformAvailable-p,merchantReserved:b.merchantReserved+m,platformReserved:b.platformReserved+p};
    const nextUsage={...usageKey(policy.id,r.customerId),schemaVersion:1,version:u?increment(u.version):1,reservedUses:num((u?.reservedUses??0)+1),completedUses:u?.completedUses??0};
    const hold={...holdKey(r.orderId),schemaVersion:1,version:1,...request,requestDigest,status:'RESERVED',createdAt:new Date(clock).toISOString()};
    return {replayed:false,status:'RESERVED',operations:[put(nextBudget,b),put(nextUsage,u),put(hold)]};
  },async settle(value: unknown) {
    const hasExpected=!!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'expectedFunding');
    const r=exact(value,['orderId','outcome',...(hasExpected?['expectedFunding']:[])]);id(r.orderId);if(!['CAPTURED','RELEASED'].includes(r.outcome))return fail();
    if(r.expectedFunding?.policyPin?.policyId?.startsWith(BENEFIT_POLICY_PREFIX)){
      const order=(await db.send(new GetCommand({TableName:'WizzOrders',Key:{PK:'ORDER#'+r.orderId,SK:'META'},ConsistentRead:true}))).Item;
      const receipt=order?.platformDeliveryBenefitReceipt??order?.platformBenefitReceipt;
      if(!order||receipt?.target!=='DELIVERY'||BENEFIT_POLICY_PREFIX+receipt.campaignId!==r.expectedFunding.policyPin.policyId)return fail();
      const keepUse=order.status!=='pending'||['confirmedAt','merchantAcceptedAt','acceptedAt','financialAcceptance'].some(k=>order[k]!=null);
      return settlePlatformBenefit(db,{orderId:r.orderId,target:'DELIVERY',outcome:r.outcome,keepUse,expectedFunding:r.expectedFunding});
    }
    const h=await get(holdKey(r.orderId));if(!h)return fail('DELIVERY_RESERVATION_UNAVAILABLE');verify(h);
    if(h.orderId!==r.orderId||!quoteEntityIdValid(h.customerId)||!quoteEntityIdValid(h.policyPin?.policyId)||!Number.isSafeInteger(h.policyPin?.version)||h.policyPin.version<1)return fail();
    if(hasExpected){exact(r.expectedFunding,['policyPin','allocation']);if(quoteHash(r.expectedFunding)!==quoteHash({policyPin:h.policyPin,allocation:h.allocation}))return fail('DELIVERY_RESERVATION_CONFLICT');}
    if(h.requestDigest!==quoteHash({orderId:h.orderId,customerId:h.customerId,policyPin:h.policyPin,allocation:h.allocation}))return fail();
    if(h.status===r.outcome)return {replayed:true,status:h.status,operations:[]};
    if(h.status!=='RESERVED')return fail('DELIVERY_RESERVATION_CONFLICT');
    if(h.schemaVersion===2){
      if(h.allocation?.schemaVersion!==2)return fail();
      for(const name of ['referenceFee','customerFee','subsidy','merchantShare','platformShare']){const m=h.allocation[name];if(!m||m.moneySchemaVersion!==1||m.currency!=='IQD'||m.scale!==1000||!Number.isSafeInteger(m.minorAmount)||m.minorAmount<0)return fail();}
      if(h.allocation.subsidy.minorAmount!==Math.max(0,h.allocation.referenceFee.minorAmount-h.allocation.customerFee.minorAmount)||h.allocation.merchantShare.minorAmount+h.allocation.platformShare.minorAmount!==h.allocation.subsidy.minorAmount)return fail();
      return {replayed:false,status:r.outcome,operations:[put({...h,version:increment(h.version),status:r.outcome,settledAt:new Date(now()).toISOString()},h)]};
    }
    const b=await get(budgetKey(h.policyPin.policyId,h.policyPin.version)),u=await get(usageKey(h.policyPin.policyId,h.customerId));
    if(!b||!u)return fail();validateDeliveryCampaignBudgetRecord(b);validateDeliveryCampaignUsageRecord(u);
    const m=num(h.allocation?.merchantShare?.minorAmount),p=num(h.allocation?.platformShare?.minorAmount);
    if(quoteHash(b.policyPin)!==quoteHash(h.policyPin)||b.merchantReserved<m||b.platformReserved<p||u.reservedUses<1)return fail();
    const captured=r.outcome==='CAPTURED';
    const nextBudget={...b,version:increment(b.version),merchantReserved:b.merchantReserved-m,platformReserved:b.platformReserved-p,
      merchantAvailable:b.merchantAvailable+(captured?0:m),platformAvailable:b.platformAvailable+(captured?0:p),merchantSpent:b.merchantSpent+(captured?m:0),platformSpent:b.platformSpent+(captured?p:0)};
    const nextUsage={...u,version:increment(u.version),reservedUses:u.reservedUses-1,completedUses:num(u.completedUses+(captured?1:0))};
    return {replayed:false,status:r.outcome,operations:[put(nextBudget,b),put(nextUsage,u),put({...h,version:increment(h.version),status:r.outcome,settledAt:new Date(now()).toISOString()},h)]};
  }});
}
