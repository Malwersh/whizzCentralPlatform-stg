import { moneyFromMinor, readMoney, multiplyMoney, toWholeIqdExact } from './money';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
import { validateCommercialCharge } from './orderCommercialPricing';
type Row = Record<string, any>;
const fail = (): never => { throw Object.assign(Error('INVALID_STORE_DELIVERY_AGREEMENT'), {code:'INVALID_STORE_DELIVERY_AGREEMENT'}); };
function exact(v: any, keys: string[]): Row {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) return fail();
  return v;
}
function amount(v: unknown) { const m = readMoney(v); if(m.minorAmount < 0) return fail(); toWholeIqdExact(m); return m; }
function instant(v: any) { if(typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) return fail(); return Date.parse(v); }
/** Version two is a dated commercial agreement, never an unlimited campaign.
 * Publication requires the same authenticated staff intent and merchant consent.
 * Per-order cash funding remains mandatory; no campaign allowance is invented.
 */
export function readStoreDeliveryAgreement(value: unknown) {
  const p = exact(value, ['schemaVersion','id','version','merchantId','branchId','origin','effectiveFrom','effectiveTo','customerRule','funding','eligibility','commission']);
  if(p.schemaVersion !== 2 || ![p.id,p.merchantId,p.branchId].every(quoteEntityIdValid) || !Number.isSafeInteger(p.version) || p.version < 1 || instant(p.effectiveTo) <= instant(p.effectiveFrom)) return fail();
  if(p.customerRule?.kind === 'FREE') exact(p.customerRule, ['kind']);
  else { exact(p.customerRule, ['kind','amount']); if(p.customerRule.kind !== 'FIXED_TARIFF') return fail(); amount(p.customerRule.amount); }
  const f = p.funding;
  if(['MERCHANT','PLATFORM'].includes(f?.kind)) { exact(f,['kind']); if(p.origin !== f.kind) return fail(); }
  else {
    exact(f,['kind','merchantNumerator','denominator']);
    if(f.kind !== 'SHARED_RATIO' || p.origin !== 'SHARED' || !Number.isSafeInteger(f.denominator) || f.denominator < 1 || !Number.isSafeInteger(f.merchantNumerator) || f.merchantNumerator < 0 || f.merchantNumerator > f.denominator) return fail();
  }
  const e = exact(p.eligibility,['regionIds','minimumGoods']);
  if(!Array.isArray(e.regionIds) || !e.regionIds.length || e.regionIds.length > 100 || new Set(e.regionIds).size !== e.regionIds.length || !e.regionIds.every(quoteEntityIdValid)) return fail();
  amount(e.minimumGoods);
  const c = validateCommercialCharge(p.commission);
  if(c.kind !== 'PERCENT' || c.basis !== 'GOODS_GROSS' || !c.finalRounding || c.finalRounding.incrementIqd !== 1) return fail();
  const policy = JSON.parse(JSON.stringify(p));
  return {policy, termsHash:quoteHash(policy)};
}
/** Pure arithmetic only; does not prove approval, liquidity or order admission. */
export function calculateStoreDeliveryAgreement(value: unknown, reference: unknown) {
  const {policy,termsHash} = readStoreDeliveryAgreement(value), referenceFee = amount(reference);
  const customerFee = policy.customerRule.kind === 'FREE' ? moneyFromMinor(0) : amount(policy.customerRule.amount);
  const subsidy = moneyFromMinor(Math.max(0, referenceFee.minorAmount - customerFee.minorAmount));
  let merchantShare = moneyFromMinor(0);
  if(policy.funding.kind === 'MERCHANT') merchantShare = subsidy;
  else if(policy.funding.kind === 'SHARED_RATIO') {
    // Whole IQD wallets: deterministic remainder belongs to the platform.
    const raw = multiplyMoney(subsidy,policy.funding.merchantNumerator,policy.funding.denominator,'TOWARD_ZERO');
    merchantShare = moneyFromMinor(Math.floor(raw.minorAmount / 1000) * 1000);
  }
  return {policyPin:{policyId:policy.id,version:policy.version,termsHash}, allocation:{schemaVersion:2,referenceFee,customerFee,subsidy,merchantShare,platformShare:moneyFromMinor(subsidy.minorAmount-merchantShare.minorAmount)}};
}

/** Commit-side structural evidence. The authenticated source reader supplies live
 * owner/staff/deletion guards; this additionally binds the exact dated policy,
 * per-order reservation and arithmetic without requiring a campaign budget. */
export function hasStoreAgreementOrderEvidence(operations:Row[], funding:Row, orderId:string, customerId:string) {
  try {
    if(funding?.allocation?.schemaVersion!==2)return false;
    const pin=funding.policyPin,pk='DELIVERY_FUNDING#'+pin.policyId;
    let policy:Row|undefined;
    for(const sk of ['CURRENT','VERSION#'+pin.version]){
      const checks=operations.map(o=>o.ConditionCheck).filter(c=>c?.TableName==='staging-PlatformStaff'&&c.Key?.pk===pk&&c.Key?.sk===sk);
      const matched=checks.some(check=>{
        const field=(name:string)=>{
          const alias=Object.entries(check.ExpressionAttributeNames??{}).find(([,v])=>v===name)?.[0];
          if(!alias)return undefined;
          for(const [key,value] of Object.entries(check.ExpressionAttributeValues??{}))if(check.ConditionExpression?.split(' AND ').includes(alias+'='+key))return value;
          return undefined;
        };
        const p=field('policy');if(field('termsHash')!==pin.termsHash||field('version')!==pin.version||field('status')!=='ACTIVE'||!p)return false;
        const resolved=readStoreDeliveryAgreement(p);if(resolved.termsHash!==pin.termsHash||resolved.policy.id!==pin.policyId||resolved.policy.version!==pin.version)return false;
        if(policy&&quoteHash(policy)!==quoteHash(resolved.policy))return false;policy=resolved.policy;return true;
      });
      if(!matched)return false;
    }
    if(!policy||quoteHash(calculateStoreDeliveryAgreement(policy,funding.allocation.referenceFee))!==quoteHash(funding))return false;
    const puts=operations.map(o=>o.Put).filter(p=>p?.TableName==='staging-PlatformStaff');
    const reservation=puts.find(p=>p.Item?.pk==='DELIVERY_RESERVATION#'+orderId&&p.Item.sk==='META');
    const h=reservation?.Item;
    return !!h&&reservation.ConditionExpression==='attribute_not_exists(pk)'&&h.schemaVersion===2&&h.orderId===orderId&&h.customerId===customerId&&h.status==='RESERVED'&&quoteHash({policyPin:h.policyPin,allocation:h.allocation})===quoteHash(funding)&&!puts.some(p=>p.Item?.pk==='DELIVERY_BUDGET#'+pin.policyId||p.Item?.pk==='DELIVERY_USAGE#'+pin.policyId);
  }catch{return false;}
}
