import { Money, readMoney, moneyFromMinor, addMoney, subtractMoney } from './money';

/** Resolved amounts from a trusted quote/agreement, never raw checkout prices. */
export interface OrderAllocationInput {
  allocationSchemaVersion: 1;
  paymentMethod: 'COD' | 'PREPAID';
  goodsGross: Money;
  merchantGoodsDiscount: Money;
  platformGoodsDiscount: Money;
  merchantCommission: Money;
  serviceFee: Money;
  customerDeliveryFee: Money;
  driverEarning: Money;
  driverTip: Money;
  merchantOtherCharges: Money;
  platformOtherCharges: Money;
  thirdPartyOtherCharges: Money;
}
export class AllocationError extends Error {
  constructor(public readonly code: 'INVALID_ALLOCATION' | 'NEGATIVE_COMPONENT' | 'EXCESS_GOODS_DISCOUNT' | 'EXCESS_COMMISSION') {
    super(code);
    this.name = 'AllocationError';
  }
}
const fields = ['goodsGross', 'merchantGoodsDiscount', 'platformGoodsDiscount', 'merchantCommission', 'serviceFee', 'customerDeliveryFee', 'driverEarning', 'driverTip', 'merchantOtherCharges', 'platformOtherCharges', 'thirdPartyOtherCharges'] as const;

/** Pure successful-delivery allocation proposal. Does not prove payment, entitlement or funding. */
export function allocateOrder(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AllocationError('INVALID_ALLOCATION');
  const raw = value as Record<string, unknown>;
  if (raw.allocationSchemaVersion !== 1 || !['COD', 'PREPAID'].includes(raw.paymentMethod as string)
    || Object.keys(raw).some(key => !['allocationSchemaVersion', 'paymentMethod', ...fields].includes(key))) throw new AllocationError('INVALID_ALLOCATION');
  const amounts = {} as Record<typeof fields[number], Money>;
  for (const field of fields) {
    amounts[field] = readMoney(raw[field]);
    if (amounts[field].minorAmount < 0) throw new AllocationError('NEGATIVE_COMPONENT');
  }
  const a = amounts, zero = moneyFromMinor(0);
  // Subtract separately: discount sums may exceed the safe range and must never be clamped.
  const merchantGoodsEntitlement = subtractMoney(a.goodsGross, a.merchantGoodsDiscount);
  const customerGoodsPayment = subtractMoney(merchantGoodsEntitlement, a.platformGoodsDiscount);
  if (merchantGoodsEntitlement.minorAmount < 0 || customerGoodsPayment.minorAmount < 0) throw new AllocationError('EXCESS_GOODS_DISCOUNT');
  if (a.merchantCommission.minorAmount > merchantGoodsEntitlement.minorAmount) throw new AllocationError('EXCESS_COMMISSION');
  const merchantPayable = addMoney(subtractMoney(merchantGoodsEntitlement, a.merchantCommission), a.merchantOtherCharges);
  const customerTotal = addMoney(customerGoodsPayment, a.serviceFee, a.customerDeliveryFee, a.driverTip,
    a.merchantOtherCharges, a.platformOtherCharges, a.thirdPartyOtherCharges);
  const deliveryMargin = subtractMoney(a.customerDeliveryFee, a.driverEarning);
  const deliverySurplus = deliveryMargin.minorAmount > 0 ? deliveryMargin : zero;
  const deliverySubsidy = deliveryMargin.minorAmount < 0 ? subtractMoney(zero, deliveryMargin) : zero;
  // Signed contribution, not platform cash, profit or a withdrawable balance.
  const platformNetContribution = addMoney(a.merchantCommission, a.serviceFee, a.platformOtherCharges,
    deliveryMargin, subtractMoney(zero, a.platformGoodsDiscount));
  const driverTotalEntitlement = addMoney(a.driverEarning, a.driverTip);
  const cod = raw.paymentMethod === 'COD';
  const driverWalletHold = cod ? addMoney(customerGoodsPayment, a.serviceFee, deliverySurplus,
    a.merchantOtherCharges, a.platformOtherCharges, a.thirdPartyOtherCharges) : zero;
  const driverCashRetained = cod ? subtractMoney(customerTotal, driverWalletHold) : zero;
  const driverCashTipRetained = cod ? a.driverTip : zero;
  const driverCashEarningRetained = cod ? subtractMoney(driverCashRetained, a.driverTip) : zero;
  const driverWalletEarningCredit = cod ? deliverySubsidy : a.driverEarning;
  const driverWalletTipCredit = cod ? zero : a.driverTip;
  const driverWalletCreditTotal = addMoney(driverWalletEarningCredit, driverWalletTipCredit);
  const platformCollection = cod ? driverWalletHold : customerTotal;
  const platformFundsAfterDriverCredit = subtractMoney(platformCollection, driverWalletCreditTotal);
  // Both funding needs are explicit. Availability is verified by the eventual financial writer.
  const platformSubsidy = addMoney(deliverySubsidy, a.platformGoodsDiscount);
  return Object.freeze({
    ruleVersion: 'ORDER_ALLOCATION_V1' as const,
    basis: 'SUCCESSFUL_DELIVERY_PROPOSAL' as const,
    paymentMethod: raw.paymentMethod as 'COD' | 'PREPAID',
    customerGoodsPayment, customerTotal, merchantGoodsEntitlement, merchantPayable,
    merchantCommission: a.merchantCommission, thirdPartyPayable: a.thirdPartyOtherCharges,
    driverEarningEntitlement: a.driverEarning, driverTipEntitlement: a.driverTip, driverTotalEntitlement,
    deliveryMargin, deliverySurplus, deliverySubsidy, platformGoodsDiscountFunding: a.platformGoodsDiscount,
    platformSubsidy, platformNetContribution,
    driverWalletHold, driverCashRetained, driverCashEarningRetained, driverCashTipRetained,
    driverWalletEarningCredit, driverWalletTipCredit, driverWalletCreditTotal,
    platformCollection, platformFundsAfterDriverCredit,
  });
}
