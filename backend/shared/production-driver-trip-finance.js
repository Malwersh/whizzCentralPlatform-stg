'use strict';
// Read only the accepted public amounts; never guess a unit or expose the internal allocation.
function financialOrderPricing(order) {
 if(!Object.prototype.hasOwnProperty.call(order,'financialSnapshot'))return null;
 const terms=order.financialAcceptance,a=terms?.allocation;
 if(!((terms?.schemaVersion===1&&a?.ruleVersion==='ORDER_ALLOCATION_V1')||(terms?.schemaVersion===2&&a?.ruleVersion==='ORDER_ALLOCATION_V2_DELIVERY_FUNDING')||(process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1'&&terms?.schemaVersion===3&&terms.settlementModel==='FULL_CASH_AT_DELIVERY_V1'&&a?.ruleVersion==='ORDER_ALLOCATION_V3_FULL_CASH'))||terms.paymentMethod!=='COD'||a.paymentMethod!=='COD')throw Error('FINANCIAL_ORDER_VIEW_UNAVAILABLE');
 const amount=v=>{
  if(v?.currency!=='IQD'||v.scale!==1000||v.moneySchemaVersion!==1||!Number.isSafeInteger(v.minorAmount)||v.minorAmount<0)throw Error('FINANCIAL_ORDER_VIEW_UNAVAILABLE');
  return v.minorAmount/1000;
 };
 if(terms.schemaVersion===3){
  const cash=amount(a.customerTotal),earning=amount(a.driverTotalEntitlement),retained=Math.min(cash,earning);
  if(amount(a.driverCashRetained)!==retained||amount(a.driverWalletHold)!==cash-retained||amount(a.driverWalletCreditTotal)!==earning-retained)throw Error('FINANCIAL_ORDER_VIEW_UNAVAILABLE');
 }
 return {schemaVersion:2,goodsSubtotal:amount(a.customerGoodsPayment),deliveryFee:amount(terms.customerDeliveryFee),tip:amount(a.driverTipEntitlement),
  total:amount(a.customerTotal),driverEarnings:amount(a.driverTotalEntitlement),driverEarning:amount(a.driverEarningEntitlement),
  holdRequiredAmount:amount(a.driverWalletHold),driverCashRetained:amount(a.driverCashRetained),laterWalletCredit:amount(a.driverWalletCreditTotal)};
}
module.exports={financialOrderPricing};
