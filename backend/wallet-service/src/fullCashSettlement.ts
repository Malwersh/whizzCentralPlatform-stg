import {verifyCashRoundingEvidence} from './cashRounding';
import { allocateOrder } from './orderAllocation';
import { allocateDeliveryFundedOrder } from './deliveryFundedAllocation';
import { Money, readMoney, moneyFromMinor, addMoney, subtractMoney } from './money';
import { quoteCanonical, quoteHash } from './deliveryQuoteRecord';

type Row = Record<string, any>;
export const FULL_CASH_SETTLEMENT_MODEL = 'FULL_CASH_AT_DELIVERY_V1' as const;
export class FullCashSettlementError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'FullCashSettlementError'; }
}
const fail = (code = 'INVALID_FULL_CASH_SETTLEMENT'): never => { throw new FullCashSettlementError(code); };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const positive = (value: Money) => value.minorAmount > 0 ? value : moneyFromMinor(0);
const minimum = (a: Money, b: Money) => moneyFromMinor(Math.min(a.minorAmount, b.minorAmount));

/** Pure versioned proposal only. Inputs must come from a trusted quote/agreement
 * adapter. This does not authenticate a customer/driver, prove a card capture,
 * reserve collateral/budget, authorize a payment or write a journal/wallet.
 * Existing V1/V2 allocators remain unchanged; their economics are preserved.
 */
export function prepareFullCashSettlement(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'base,deliveryFunding,settlementSchemaVersion') return fail();
  const source = clone(value) as Row;
  if (source.settlementSchemaVersion !== 1) return fail();
  const economic = source.deliveryFunding === null ? allocateOrder(source.base) :
    allocateDeliveryFundedOrder({ allocationSchemaVersion: 2, base: source.base, deliveryFunding: source.deliveryFunding });
  const cod = economic.paymentMethod === 'COD', zero = moneyFromMinor(0);
  const driverCashRetained = cod ? minimum(economic.customerTotal, economic.driverTotalEntitlement) : zero;
  const driverWalletHold = cod ? positive(subtractMoney(economic.customerTotal, economic.driverTotalEntitlement)) : zero;
  const driverWalletCreditTotal = subtractMoney(economic.driverTotalEntitlement, driverCashRetained);
  const driverCashTipRetained = cod ? minimum(economic.driverTipEntitlement, driverCashRetained) : zero;
  const driverWalletTipCredit = subtractMoney(economic.driverTipEntitlement, driverCashTipRetained);
  const platformCollection = cod ? driverWalletHold : economic.customerTotal;
  const allocation = {
    ...economic,
    ruleVersion: 'ORDER_ALLOCATION_V3_FULL_CASH' as const,
    driverCashRetained, driverWalletHold, driverWalletCreditTotal,
    driverCashTipRetained, driverWalletTipCredit,
    driverCashEarningRetained: subtractMoney(driverCashRetained, driverCashTipRetained),
    driverWalletEarningCredit: subtractMoney(driverWalletCreditTotal, driverWalletTipCredit),
    platformCollection,
    platformFundsAfterDriverCredit: subtractMoney(platformCollection, driverWalletCreditTotal),
  };
  if (quoteCanonical(addMoney(allocation.merchantPayable, allocation.driverTotalEntitlement,
      allocation.thirdPartyPayable, allocation.platformNetContribution)) !== quoteCanonical(allocation.customerTotal) ||
      quoteCanonical(addMoney(allocation.driverCashRetained, allocation.driverWalletCreditTotal)) !== quoteCanonical(allocation.driverTotalEntitlement) ||
      quoteCanonical(subtractMoney(platformCollection, driverWalletCreditTotal)) !==
        quoteCanonical(addMoney(allocation.merchantPayable, allocation.thirdPartyPayable, allocation.platformNetContribution))) return fail('FULL_CASH_CONSERVATION_FAILED');
  const content = { schemaVersion: 3 as const, kind: 'FULL_CASH_SETTLEMENT_ALLOCATION' as const,
    settlementModel: FULL_CASH_SETTLEMENT_MODEL, source, allocation };
  return freeze({ ...content, digest: quoteHash(content) });
}
export type FullCashSettlement = ReturnType<typeof prepareFullCashSettlement>;

/** Integrity check, not authorization or proof of origin. Never infer this model
 * from a legacy ruleVersion, current settings, cash amount or missing fields. */
export function verifyFullCashSettlement(value: unknown): FullCashSettlement {
  const saved = value as FullCashSettlement;
  const rebuilt = prepareFullCashSettlement(saved?.source);
  if (quoteCanonical(saved) !== quoteCanonical(rebuilt)) return fail('FULL_CASH_SETTLEMENT_CHANGED');
  return rebuilt;
}

/** Double-entry posting proposal: collateral/payment clearing funds liabilities;
 * platform costs are explicit debits, never an implicitly negative wallet.
 * Promotion budget commitments are disclosed separately and not expensed twice.
 * No durable account IDs, payment proof or posting authority is supplied here.
 */
export function prepareFullCashJournal(value: unknown, cashRounding?: unknown) {
  const proposal = verifyFullCashSettlement(value), a = proposal.allocation, source = proposal.source;
  const delivery = source.deliveryFunding !== null;
  const goodsFunding = readMoney(a.platformGoodsDiscountFunding);
  const deliveryFunding = delivery ? readMoney((a as Row).platformDeliveryPromotionFunding) : moneyFromMinor(0);
  const baselineMargin = delivery ? readMoney((a as Row).baselineDeliveryMargin) : readMoney(a.deliveryMargin);
  const lines: { account: string; side: 'DEBIT' | 'CREDIT'; amount: Money }[] = [];
  function post(account: string, side: 'DEBIT' | 'CREDIT', value: Money) {
    const amount = readMoney(value);
    if (amount.minorAmount < 0) return fail('FULL_CASH_NEGATIVE_POSTING');
    if (amount.minorAmount) lines.push({ account, side, amount });
  }
  post(a.paymentMethod === 'COD' ? 'DRIVER_PREPAID_COLLATERAL' : 'PAYMENT_PROVIDER_CLEARING', 'DEBIT', a.platformCollection);
  post('MERCHANT_PAYABLE', 'CREDIT', a.merchantPayable);
  post('DRIVER_WALLET_PAYABLE', 'CREDIT', a.driverWalletCreditTotal);
  post('THIRD_PARTY_PAYABLE', 'CREDIT', a.thirdPartyPayable);
  post('MERCHANT_COMMISSION_REVENUE', 'CREDIT', a.merchantCommission);
  const cash=cashRounding===undefined?null:verifyCashRoundingEvidence(cashRounding);
  if(cash&&(cash.paymentMethod!==a.paymentMethod||cash.customerTotal.minorAmount!==a.customerTotal.minorAmount||cash.serviceFee.minorAmount!==readMoney(source.base.serviceFee).minorAmount))return fail('CASH_ROUNDING_SETTLEMENT_MISMATCH');
  post('SERVICE_FEE_REVENUE', 'CREDIT', cash?cash.baseServiceFee:readMoney(source.base.serviceFee));
  if(cash)post('CASH_ROUNDING_SERVICE_ADJUSTMENT',cash.adjustment.minorAmount<0?'DEBIT':'CREDIT',moneyFromMinor(Math.abs(cash.adjustment.minorAmount)));
  post('PLATFORM_OTHER_REVENUE', 'CREDIT', readMoney(source.base.platformOtherCharges));
  post('PLATFORM_GOODS_PROMOTION_EXPENSE', 'DEBIT', goodsFunding);
  post('PLATFORM_DELIVERY_PROMOTION_EXPENSE', 'DEBIT', deliveryFunding);
  post(baselineMargin.minorAmount < 0 ? 'BASE_DELIVERY_SUBSIDY_EXPENSE' : 'BASE_DELIVERY_MARGIN_REVENUE',
    baselineMargin.minorAmount < 0 ? 'DEBIT' : 'CREDIT', moneyFromMinor(Math.abs(baselineMargin.minorAmount)));
  const debit = addMoney(...lines.filter(l => l.side === 'DEBIT').map(l => l.amount));
  const credit = addMoney(...lines.filter(l => l.side === 'CREDIT').map(l => l.amount));
  if (debit.minorAmount !== credit.minorAmount) return fail('FULL_CASH_JOURNAL_UNBALANCED');
  const content = { schemaVersion: 1, kind: 'FULL_CASH_POSTING_PROPOSAL', settlementModel: proposal.settlementModel,
    allocationDigest: proposal.digest, paymentMethod: a.paymentMethod, ...(cash?{cashRounding:cash}:{}), lines, debit, credit,
    funding: { platformGoodsPromotion: goodsFunding, platformDeliveryPromotion: deliveryFunding,
      merchantDeliverySupport: delivery ? readMoney((a as Row).merchantDeliverySupport) : moneyFromMinor(0),
      platformNetContribution: a.platformNetContribution,
      platformNetFundingObligation: positive(subtractMoney(moneyFromMinor(0), a.platformNetContribution)),
      driverWalletCreditDueAtCompletion: a.driverWalletCreditTotal },
    canPost: false, paymentVerified: false, walletMutationPerformed: false };
  return freeze({ ...content, digest: quoteHash(content) });
}
