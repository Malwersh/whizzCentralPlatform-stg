"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// backend/wallet-service/src/platformBenefitFinancialCompatibility.ts
var platformBenefitFinancialCompatibility_exports = {};
__export(platformBenefitFinancialCompatibility_exports, {
  allocateDeliveryFundedOrder: () => allocateDeliveryFundedOrder,
  verifyGoodsPromotionExposure: () => verifyGoodsPromotionExposure
});
module.exports = __toCommonJS(platformBenefitFinancialCompatibility_exports);

// backend/wallet-service/src/money.ts
var MoneyError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "MoneyError";
  }
};
var MAX = BigInt(Number.MAX_SAFE_INTEGER);
function integer(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new MoneyError("INVALID_MONEY");
  return value;
}
function bounded(value) {
  if (value > MAX || value < -MAX) throw new MoneyError("MONEY_OVERFLOW");
  return Number(value);
}
function moneyFromMinor(minorAmount) {
  return Object.freeze({ currency: "IQD", scale: 1e3, moneySchemaVersion: 1, minorAmount: integer(minorAmount) === 0 ? 0 : minorAmount });
}
function readMoney(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MoneyError("INVALID_MONEY");
  const row = value;
  if (row.currency !== "IQD" || row.scale !== 1e3 || row.moneySchemaVersion !== 1) throw new MoneyError("UNSUPPORTED_MONEY_SCHEMA");
  if (Object.keys(row).some((key) => !["currency", "scale", "moneySchemaVersion", "minorAmount"].includes(key))) throw new MoneyError("INVALID_MONEY");
  return moneyFromMinor(integer(row.minorAmount));
}
function parseIqd(text) {
  if (typeof text !== "string" || text.length > 24 || !/^-?(0|[1-9]\d*)(\.\d{1,3})?$/.test(text)) throw new MoneyError("INVALID_MONEY");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const amount2 = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return moneyFromMinor(bounded(negative ? -amount2 : amount2));
}
function toWholeIqdExact(value) {
  const amount2 = readMoney(value).minorAmount;
  if (amount2 % 1e3 !== 0) throw new MoneyError("PRECISION_LOSS");
  return amount2 / 1e3;
}
function addMoney(...values) {
  return moneyFromMinor(bounded(values.reduce((sum, value) => sum + BigInt(readMoney(value).minorAmount), 0n)));
}
function subtractMoney(left, right) {
  return moneyFromMinor(bounded(BigInt(readMoney(left).minorAmount) - BigInt(readMoney(right).minorAmount)));
}

// backend/wallet-service/src/deliveryQuoteRecord.ts
var import_node_crypto = require("node:crypto");
var quoteEntityIdValid = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,150}$/.test(v);
function quoteCanonical(v) {
  return Array.isArray(v) ? "[" + v.map(quoteCanonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + quoteCanonical(v[k])).join(",") + "}" : JSON.stringify(v);
}
var quoteHash = (v) => (0, import_node_crypto.createHash)("sha256").update(quoteCanonical(v)).digest("hex");

// backend/wallet-service/src/deliveryFundingComposition.ts
var fail = () => {
  throw Error("INVALID_DELIVERY_FUNDING_COMPOSITION");
};
function composeDeliveryFunding(agreement, promotion) {
  if (agreement?.allocation?.schemaVersion !== 2 || promotion?.allocation?.schemaVersion !== 1 || agreement.components || promotion.components) return fail();
  const a = agreement.allocation, p = promotion.allocation;
  const n = (v) => {
    const m = readMoney(v);
    if (m.minorAmount < 0) return fail();
    return m.minorAmount;
  };
  for (const f of [agreement, promotion]) {
    if (Object.keys(f).sort().join(",") !== "allocation,policyPin" || Object.keys(f.policyPin ?? {}).sort().join(",") !== "policyId,termsHash,version" || typeof f.policyPin.policyId !== "string" || !Number.isSafeInteger(f.policyPin.version) || f.policyPin.version < 1 || !/^[a-f0-9]{64}$/.test(f.policyPin.termsHash)) return fail();
    const x = f.allocation;
    if (Object.keys(x).sort().join(",") !== "customerFee,merchantShare,platformShare,referenceFee,schemaVersion,subsidy") return fail();
    const ref = n(x.referenceFee), fee = n(x.customerFee), sub = n(x.subsidy);
    if (sub !== (x.schemaVersion === 2 ? Math.max(0, ref - fee) : ref - fee) || n(x.merchantShare) + n(x.platformShare) !== sub) return fail();
  }
  if (n(a.customerFee) !== n(p.referenceFee) || n(p.subsidy) <= 0) return fail();
  const sum = (key) => {
    const value = n(a[key]) + n(p[key]);
    if (!Number.isSafeInteger(value)) return fail();
    return moneyFromMinor(value);
  };
  return { policyPin: agreement.policyPin, allocation: { schemaVersion: 3, referenceFee: a.referenceFee, customerFee: p.customerFee, subsidy: sum("subsidy"), merchantShare: sum("merchantShare"), platformShare: sum("platformShare") }, components: [agreement, promotion] };
}
function verifyDeliveryFundingComposition(value) {
  if (!Array.isArray(value?.components) || value.components.length !== 2) return fail();
  const rebuilt = composeDeliveryFunding(value.components[0], value.components[1]);
  if (quoteCanonical(value) !== quoteCanonical(rebuilt)) return fail();
  return rebuilt;
}

// backend/wallet-service/src/orderAllocation.ts
var AllocationError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "AllocationError";
  }
};
var fields = ["goodsGross", "merchantGoodsDiscount", "platformGoodsDiscount", "merchantCommission", "serviceFee", "customerDeliveryFee", "driverEarning", "driverTip", "merchantOtherCharges", "platformOtherCharges", "thirdPartyOtherCharges"];
function allocateOrder(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AllocationError("INVALID_ALLOCATION");
  const raw = value;
  if (raw.allocationSchemaVersion !== 1 || !["COD", "PREPAID"].includes(raw.paymentMethod) || Object.keys(raw).some((key) => !["allocationSchemaVersion", "paymentMethod", ...fields].includes(key))) throw new AllocationError("INVALID_ALLOCATION");
  const amounts = {};
  for (const field of fields) {
    amounts[field] = readMoney(raw[field]);
    if (amounts[field].minorAmount < 0) throw new AllocationError("NEGATIVE_COMPONENT");
  }
  const a = amounts, zero = moneyFromMinor(0);
  const merchantGoodsEntitlement = subtractMoney(a.goodsGross, a.merchantGoodsDiscount);
  const customerGoodsPayment = subtractMoney(merchantGoodsEntitlement, a.platformGoodsDiscount);
  if (merchantGoodsEntitlement.minorAmount < 0 || customerGoodsPayment.minorAmount < 0) throw new AllocationError("EXCESS_GOODS_DISCOUNT");
  if (a.merchantCommission.minorAmount > merchantGoodsEntitlement.minorAmount) throw new AllocationError("EXCESS_COMMISSION");
  const merchantPayable = addMoney(subtractMoney(merchantGoodsEntitlement, a.merchantCommission), a.merchantOtherCharges);
  const customerTotal = addMoney(
    customerGoodsPayment,
    a.serviceFee,
    a.customerDeliveryFee,
    a.driverTip,
    a.merchantOtherCharges,
    a.platformOtherCharges,
    a.thirdPartyOtherCharges
  );
  const deliveryMargin = subtractMoney(a.customerDeliveryFee, a.driverEarning);
  const deliverySurplus = deliveryMargin.minorAmount > 0 ? deliveryMargin : zero;
  const deliverySubsidy = deliveryMargin.minorAmount < 0 ? subtractMoney(zero, deliveryMargin) : zero;
  const platformNetContribution = addMoney(
    a.merchantCommission,
    a.serviceFee,
    a.platformOtherCharges,
    deliveryMargin,
    subtractMoney(zero, a.platformGoodsDiscount)
  );
  const driverTotalEntitlement = addMoney(a.driverEarning, a.driverTip);
  const cod = raw.paymentMethod === "COD";
  const driverWalletHold = cod ? addMoney(
    customerGoodsPayment,
    a.serviceFee,
    deliverySurplus,
    a.merchantOtherCharges,
    a.platformOtherCharges,
    a.thirdPartyOtherCharges
  ) : zero;
  const driverCashRetained = cod ? subtractMoney(customerTotal, driverWalletHold) : zero;
  const driverCashTipRetained = cod ? a.driverTip : zero;
  const driverCashEarningRetained = cod ? subtractMoney(driverCashRetained, a.driverTip) : zero;
  const driverWalletEarningCredit = cod ? deliverySubsidy : a.driverEarning;
  const driverWalletTipCredit = cod ? zero : a.driverTip;
  const driverWalletCreditTotal = addMoney(driverWalletEarningCredit, driverWalletTipCredit);
  const platformCollection = cod ? driverWalletHold : customerTotal;
  const platformFundsAfterDriverCredit = subtractMoney(platformCollection, driverWalletCreditTotal);
  const platformSubsidy = addMoney(deliverySubsidy, a.platformGoodsDiscount);
  return Object.freeze({
    ruleVersion: "ORDER_ALLOCATION_V1",
    basis: "SUCCESSFUL_DELIVERY_PROPOSAL",
    paymentMethod: raw.paymentMethod,
    customerGoodsPayment,
    customerTotal,
    merchantGoodsEntitlement,
    merchantPayable,
    merchantCommission: a.merchantCommission,
    thirdPartyPayable: a.thirdPartyOtherCharges,
    driverEarningEntitlement: a.driverEarning,
    driverTipEntitlement: a.driverTip,
    driverTotalEntitlement,
    deliveryMargin,
    deliverySurplus,
    deliverySubsidy,
    platformGoodsDiscountFunding: a.platformGoodsDiscount,
    platformSubsidy,
    platformNetContribution,
    driverWalletHold,
    driverCashRetained,
    driverCashEarningRetained,
    driverCashTipRetained,
    driverWalletEarningCredit,
    driverWalletTipCredit,
    driverWalletCreditTotal,
    platformCollection,
    platformFundsAfterDriverCredit
  });
}

// backend/wallet-service/src/deliveryFundedAllocation.ts
var DeliveryFundedAllocationError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DeliveryFundedAllocationError";
  }
};
var fail2 = (code = "INVALID_DELIVERY_FUNDED_ALLOCATION") => {
  throw new DeliveryFundedAllocationError(code);
};
function exact(v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== [...keys].sort().join(",")) return fail2();
  return v;
}
function amount(v) {
  const m = readMoney(v);
  if (m.minorAmount < 0) return fail2();
  return m;
}
var positive = (m) => m.minorAmount > 0 ? m : moneyFromMinor(0);
function allocateDeliveryFundedOrder(value) {
  try {
    const r = exact(value, ["allocationSchemaVersion", "base", "deliveryFunding"]);
    if (r.allocationSchemaVersion !== 2) return fail2();
    const composite = r.deliveryFunding?.allocation?.schemaVersion === 3;
    if (composite) verifyDeliveryFundingComposition(r.deliveryFunding);
    const funding = exact(r.deliveryFunding, ["policyPin", "allocation", ...composite ? ["components"] : []]), pin = exact(funding.policyPin, ["policyId", "version", "termsHash"]);
    if (!(quoteEntityIdValid(pin.policyId) || typeof pin.policyId === "string" && pin.policyId.startsWith("PLATFORM_BENEFIT#") && quoteEntityIdValid(pin.policyId.slice("PLATFORM_BENEFIT#".length))) || !Number.isSafeInteger(pin.version) || pin.version < 1 || typeof pin.termsHash !== "string" || !/^[a-f0-9]{64}$/.test(pin.termsHash)) return fail2();
    const a = exact(funding.allocation, ["schemaVersion", "referenceFee", "customerFee", "subsidy", "merchantShare", "platformShare"]);
    if (![1, 2, 3].includes(a.schemaVersion)) return fail2();
    const referenceFee = amount(a.referenceFee), customerFee = amount(a.customerFee), subsidy = amount(a.subsidy), merchantShare = amount(a.merchantShare), platformShare = amount(a.platformShare);
    if ((a.schemaVersion === 3 ? subsidy.minorAmount : a.schemaVersion === 2 ? Math.max(0, referenceFee.minorAmount - customerFee.minorAmount) : subtractMoney(referenceFee, customerFee).minorAmount) !== subsidy.minorAmount || addMoney(merchantShare, platformShare).minorAmount !== subsidy.minorAmount) return fail2("DELIVERY_FUNDING_MISMATCH");
    const base = allocateOrder(r.base);
    if (readMoney(r.base.customerDeliveryFee).minorAmount !== customerFee.minorAmount) return fail2("DELIVERY_FUNDING_MISMATCH");
    const merchantPayable = subtractMoney(base.merchantPayable, merchantShare);
    if (merchantPayable.minorAmount < 0) return fail2("MERCHANT_DELIVERY_SUPPORT_EXCEEDS_PAYABLE");
    const baselineDeliveryMargin = subtractMoney([2, 3].includes(a.schemaVersion) ? addMoney(customerFee, subsidy) : referenceFee, base.driverEarningEntitlement);
    const deliveryNetContribution = subtractMoney(baselineDeliveryMargin, platformShare);
    const platformNetContribution = addMoney(base.platformNetContribution, merchantShare);
    const sum = addMoney(merchantPayable, base.driverTotalEntitlement, base.thirdPartyPayable, platformNetContribution);
    if (sum.minorAmount !== base.customerTotal.minorAmount) return fail2("DELIVERY_ALLOCATION_UNBALANCED");
    const netDeliverySubsidy = positive(subtractMoney(base.deliverySubsidy, merchantShare));
    const retained = { policyId: pin.policyId, version: pin.version, termsHash: pin.termsHash };
    return Object.freeze({
      ...base,
      ruleVersion: "ORDER_ALLOCATION_V2_DELIVERY_FUNDING",
      merchantPayableBeforeDeliverySupport: base.merchantPayable,
      merchantPayable,
      merchantDeliverySupport: merchantShare,
      platformDeliveryPromotionFunding: platformShare,
      platformPromotionCashReservation: addMoney(base.platformGoodsDiscountFunding, platformShare),
      referenceDeliveryFee: referenceFee,
      customerDeliveryFee: customerFee,
      deliveryPromotionSubsidy: subsidy,
      baselineDeliveryMargin,
      platformBaselineDeliverySubsidy: positive(subtractMoney(moneyFromMinor(0), baselineDeliveryMargin)),
      deliveryNetContribution,
      grossDeliveryShortfall: base.deliverySubsidy,
      deliverySubsidy: netDeliverySubsidy,
      platformSubsidy: addMoney(netDeliverySubsidy, base.platformGoodsDiscountFunding),
      platformNetContribution,
      deliveryFundingPin: Object.freeze(retained)
    });
  } catch (e) {
    if (e instanceof DeliveryFundedAllocationError) throw e;
    return fail2();
  }
}

// backend/wallet-service/src/platformBenefits.ts
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
function fail3(code) {
  throw Object.assign(Error(code), { code, statusCode: 409, status: 409 });
}
var integer2 = (v, min = 0) => {
  if (!Number.isSafeInteger(v) || v < min || v > Number.MAX_SAFE_INTEGER) fail3("BENEFIT_INVALID");
  return v;
};
var exact2 = (v, keys) => {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== [...keys].sort().join(",")) fail3("BENEFIT_INVALID");
};
var id = (v) => {
  if (!quoteEntityIdValid(v)) fail3("BENEFIT_INVALID");
  return v;
};
var quantum = (v, min = 0) => {
  integer2(v, min);
  if (v > 1e9 || v % 250 !== 0) fail3("BENEFIT_DENOMINATION_INVALID");
  return v;
};
var ids = (v) => {
  if (!Array.isArray(v) || v.length > 100 || new Set(v).size !== v.length) fail3("BENEFIT_INVALID");
  v.forEach(id);
};
function readPlatformBenefit(value) {
  exact2(value, ["schemaVersion", "kind", "amountIqd", "usesPerCustomer", "maximumPerOrderIqd", "minimumGoodsIqd", "maximumRoadMeters", "grantMode", "audience", "branchIds", "regionIds", "customerIds", "allowGoodsStacking"]);
  if (value.schemaVersion !== 1 || !["FREE_DELIVERIES", "GOODS_AMOUNT", "DELIVERY_AMOUNT"].includes(value.kind) || !["AUTO", "DIRECT"].includes(value.grantMode) || !["ALL", "NEW_CUSTOMER", "FIRST_ORDER", "RETURNING", "VIP", "INACTIVE"].includes(value.audience) || typeof value.allowGoodsStacking !== "boolean") fail3("BENEFIT_INVALID");
  quantum(value.amountIqd);
  integer2(value.usesPerCustomer, 1);
  if (value.usesPerCustomer > 1e3) fail3("BENEFIT_INVALID");
  quantum(value.maximumPerOrderIqd, 250);
  quantum(value.minimumGoodsIqd);
  integer2(value.maximumRoadMeters, 1);
  if (value.maximumRoadMeters > 2e5 || value.kind === "FREE_DELIVERIES" && value.amountIqd !== 0 || value.kind !== "FREE_DELIVERIES" && (!value.amountIqd || value.amountIqd > value.maximumPerOrderIqd) || value.kind === "GOODS_AMOUNT" && value.usesPerCustomer !== 1) fail3("BENEFIT_INVALID");
  for (const key of ["branchIds", "regionIds", "customerIds"]) {
    ids(value[key]);
    if (key !== "customerIds" && value[key].length > 20) fail3("BENEFIT_TARGET_LIMIT");
  }
  return JSON.parse(JSON.stringify(value));
}

// backend/wallet-service/src/goodsPromotionExposure.ts
var fail4 = () => {
  throw Object.assign(Error("PLATFORM_GOODS_EXPOSURE_LIMIT_REQUIRED"), { code: "PLATFORM_GOODS_EXPOSURE_LIMIT_REQUIRED", statusCode: 409 });
};
function prepareGoodsPromotionExposure(campaign, source, amount2) {
  const actual = readMoney(amount2);
  toWholeIqdExact(actual);
  if (actual.minorAmount <= 0 || !quoteEntityIdValid(campaign?.discountId) || !Number.isSafeInteger(campaign.version) || campaign.version < 1 || !["MERCHANT", "PLATFORM"].includes(source)) return fail4();
  if (campaign.benefit) {
    const b = readPlatformBenefit(campaign.benefit);
    if (source !== "PLATFORM" || b.kind !== "GOODS_AMOUNT" || actual.minorAmount > Math.min(b.amountIqd, b.maximumPerOrderIqd) * 1e3) return fail4();
    const body2 = { schemaVersion: 2, kind: "GOODS_BENEFIT_EXPOSURE", campaignId: campaign.discountId, campaignVersion: campaign.version, source, perUseCap: moneyFromMinor(Math.min(b.amountIqd, b.maximumPerOrderIqd) * 1e3), usesPerCustomer: b.usesPerCustomer, platformAmount: actual, enforcement: "ATOMIC_RECIPIENT_ENTITLEMENT_AT_ORDER_COMMIT" };
    return { ...body2, digest: quoteHash(body2) };
  }
  const raw = source === "MERCHANT" ? campaign.usage_limit ?? campaign.usageLimit : campaign.usageLimit ?? campaign.limit;
  const limit = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (!Number.isSafeInteger(limit) || limit < 1) return fail4();
  const type = String(campaign.type ?? campaign.discountType ?? "").toLowerCase();
  const capValue = ["fixedamount", "fixed_amount", "fixed"].includes(type) ? campaign.value ?? campaign.discountValue : campaign.maxDiscountAmount ?? campaign.maxDiscount;
  let cap;
  try {
    cap = parseIqd(String(capValue));
    toWholeIqdExact(cap);
  } catch {
    return fail4();
  }
  const total = BigInt(cap.minorAmount) * BigInt(limit);
  if (cap.minorAmount <= 0 || actual.minorAmount > cap.minorAmount || total > BigInt(Number.MAX_SAFE_INTEGER)) return fail4();
  const body = { schemaVersion: 1, kind: "GOODS_PROMOTION_EXPOSURE", campaignId: campaign.discountId, campaignVersion: campaign.version, source, usageLimit: limit, perUseCap: cap, maximumCampaignExposure: moneyFromMinor(Number(total)), platformAmount: actual, enforcement: "ATOMIC_CAMPAIGN_USAGE_CAS_AT_ORDER_COMMIT" };
  return { ...body, digest: quoteHash(body) };
}
function verifyGoodsPromotionExposure(value, amount2) {
  if (!value) return fail4();
  const { digest, ...body } = value;
  if (digest !== quoteHash(body) || quoteHash(readMoney(value.platformAmount)) !== quoteHash(readMoney(amount2))) return fail4();
  if (value.schemaVersion === 2) {
    if (value.kind !== "GOODS_BENEFIT_EXPOSURE" || value.source !== "PLATFORM" || value.enforcement !== "ATOMIC_RECIPIENT_ENTITLEMENT_AT_ORDER_COMMIT" || !quoteEntityIdValid(value.campaignId) || !Number.isSafeInteger(value.campaignVersion) || value.campaignVersion < 1 || value.usesPerCustomer !== 1) return fail4();
    const cap = toWholeIqdExact(readMoney(value.perUseCap)), actual = toWholeIqdExact(readMoney(amount2));
    if (cap <= 0 || cap % 250 || actual <= 0 || actual % 250 || actual > cap) return fail4();
    return value;
  }
  if (value.schemaVersion !== 1 || value.kind !== "GOODS_PROMOTION_EXPOSURE" || value.enforcement !== "ATOMIC_CAMPAIGN_USAGE_CAS_AT_ORDER_COMMIT") return fail4();
  const rebuilt = prepareGoodsPromotionExposure({ discountId: value.campaignId, version: value.campaignVersion, type: "fixedAmount", value: toWholeIqdExact(value.perUseCap), usage_limit: value.usageLimit, usageLimit: value.usageLimit }, value.source, amount2);
  if (quoteHash(rebuilt) !== quoteHash(value)) return fail4();
  return rebuilt;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  allocateDeliveryFundedOrder,
  verifyGoodsPromotionExposure
});
