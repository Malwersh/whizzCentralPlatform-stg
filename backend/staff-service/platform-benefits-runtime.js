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

// backend/wallet-service/src/platformBenefits.ts
var platformBenefits_exports = {};
__export(platformBenefits_exports, {
  BENEFIT_POLICY_PREFIX: () => BENEFIT_POLICY_PREFIX,
  BENEFIT_TABLE: () => BENEFIT_TABLE,
  benefitGrantKey: () => benefitGrantKey,
  platformBenefitBalance: () => platformBenefitBalance,
  platformBenefitEligibility: () => platformBenefitEligibility,
  preparePlatformBenefit: () => preparePlatformBenefit,
  readPlatformBenefit: () => readPlatformBenefit,
  settlePlatformBenefit: () => settlePlatformBenefit
});
module.exports = __toCommonJS(platformBenefits_exports);
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/deliveryQuoteRecord.ts
var import_node_crypto = require("node:crypto");

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
  const row2 = value;
  if (row2.currency !== "IQD" || row2.scale !== 1e3 || row2.moneySchemaVersion !== 1) throw new MoneyError("UNSUPPORTED_MONEY_SCHEMA");
  if (Object.keys(row2).some((key) => !["currency", "scale", "moneySchemaVersion", "minorAmount"].includes(key))) throw new MoneyError("INVALID_MONEY");
  return moneyFromMinor(integer(row2.minorAmount));
}
function subtractMoney(left, right) {
  return moneyFromMinor(bounded(BigInt(readMoney(left).minorAmount) - BigInt(readMoney(right).minorAmount)));
}
function multiplyMoney(value, numerator, denominator, rounding) {
  const amount2 = BigInt(readMoney(value).minorAmount);
  if (integer(numerator) < 0 || integer(denominator) <= 0) throw new MoneyError("INVALID_MONEY");
  if (!["EXACT", "TOWARD_ZERO", "HALF_AWAY_FROM_ZERO"].includes(rounding)) throw new MoneyError("INVALID_ROUNDING");
  const product = amount2 * BigInt(numerator), divisor = BigInt(denominator);
  let quotient = product / divisor;
  const remainder = product % divisor;
  if (remainder !== 0n) {
    if (rounding === "EXACT") throw new MoneyError("PRECISION_LOSS");
    const absolute = remainder < 0n ? -remainder : remainder;
    if (rounding === "HALF_AWAY_FROM_ZERO" && absolute * 2n >= divisor) quotient += product < 0n ? -1n : 1n;
  }
  return moneyFromMinor(bounded(quotient));
}

// backend/wallet-service/src/deliveryQuoteRecord.ts
var quoteEntityIdValid = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,150}$/.test(v);
function quoteCanonical(v) {
  return Array.isArray(v) ? "[" + v.map(quoteCanonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + quoteCanonical(v[k])).join(",") + "}" : JSON.stringify(v);
}
var quoteHash = (v) => (0, import_node_crypto.createHash)("sha256").update(quoteCanonical(v)).digest("hex");

// backend/wallet-service/src/deliveryFunding.ts
var DeliveryFundingError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DeliveryFundingError";
  }
};
var fail = (code = "INVALID_DELIVERY_FUNDING") => {
  throw new DeliveryFundingError(code);
};
function row(v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  const r = v;
  if (Object.keys(r).length !== keys.length || keys.some((k) => !Object.prototype.hasOwnProperty.call(r, k))) return fail();
  return r;
}
function amount(v) {
  try {
    const m = readMoney(v);
    if (m.minorAmount < 0) return fail();
    return m;
  } catch {
    return fail();
  }
}
function integer2(v, min) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min) return fail();
  return v;
}
function allocateDeliveryFunding(value) {
  const r = row(value, ["schemaVersion", "referenceFee", "customerFee", "funding"]);
  if (r.schemaVersion !== 1) return fail();
  const referenceFee = amount(r.referenceFee), customerFee = amount(r.customerFee);
  if (customerFee.minorAmount > referenceFee.minorAmount) return fail("DELIVERY_PROMOTION_INCREASES_PRICE");
  const subsidy = subtractMoney(referenceFee, customerFee);
  if (!r.funding || typeof r.funding !== "object") return fail();
  const kind = r.funding.kind;
  let merchantShare;
  if (kind === "MERCHANT" || kind === "PLATFORM") {
    row(r.funding, ["kind"]);
    merchantShare = kind === "MERCHANT" ? subsidy : moneyFromMinor(0);
  } else if (kind === "SHARED_RATIO") {
    const f = row(r.funding, ["kind", "merchantNumerator", "denominator", "merchantCap", "platformCap"]);
    const n = integer2(f.merchantNumerator, 0), d = integer2(f.denominator, 1);
    if (n > d) return fail();
    merchantShare = multiplyMoney(subsidy, n, d, "TOWARD_ZERO");
    if (merchantShare.minorAmount > amount(f.merchantCap).minorAmount || subtractMoney(subsidy, merchantShare).minorAmount > amount(f.platformCap).minorAmount) return fail("DELIVERY_FUNDING_CAP_EXCEEDED");
  } else if (kind === "CONTRIBUTION_THEN_REMAINDER") {
    const f = row(r.funding, ["kind", "contributor", "contribution", "remainderCap"]);
    if (f.contributor !== "MERCHANT" && f.contributor !== "PLATFORM") return fail();
    const contribution = moneyFromMinor(Math.min(amount(f.contribution).minorAmount, subsidy.minorAmount));
    const remainder = subtractMoney(subsidy, contribution);
    if (remainder.minorAmount > amount(f.remainderCap).minorAmount) return fail("DELIVERY_FUNDING_CAP_EXCEEDED");
    merchantShare = f.contributor === "MERCHANT" ? contribution : remainder;
  } else return fail();
  return Object.freeze({
    schemaVersion: 1,
    referenceFee,
    customerFee,
    subsidy,
    merchantShare,
    platformShare: subtractMoney(subsidy, merchantShare)
  });
}

// backend/wallet-service/src/platformBenefits.ts
var BENEFIT_TABLE = "staging-WizzOfferJourney";
var BENEFIT_POLICY_PREFIX = "PLATFORM_BENEFIT#";
function fail2(code) {
  throw Object.assign(Error(code), { code, statusCode: 409, status: 409 });
}
var integer3 = (v, min = 0) => {
  if (!Number.isSafeInteger(v) || v < min || v > Number.MAX_SAFE_INTEGER) fail2("BENEFIT_INVALID");
  return v;
};
var exact = (v, keys) => {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== [...keys].sort().join(",")) fail2("BENEFIT_INVALID");
};
var id = (v) => {
  if (!quoteEntityIdValid(v)) fail2("BENEFIT_INVALID");
  return v;
};
var quantum = (v, min = 0) => {
  integer3(v, min);
  if (v > 1e9 || v % 250 !== 0) fail2("BENEFIT_DENOMINATION_INVALID");
  return v;
};
var ids = (v) => {
  if (!Array.isArray(v) || v.length > 100 || new Set(v).size !== v.length) fail2("BENEFIT_INVALID");
  v.forEach(id);
};
function readPlatformBenefit(value) {
  exact(value, ["schemaVersion", "kind", "amountIqd", "usesPerCustomer", "maximumPerOrderIqd", "minimumGoodsIqd", "maximumRoadMeters", "grantMode", "audience", "branchIds", "regionIds", "customerIds", "allowGoodsStacking"]);
  if (value.schemaVersion !== 1 || !["FREE_DELIVERIES", "GOODS_AMOUNT", "DELIVERY_AMOUNT"].includes(value.kind) || !["AUTO", "DIRECT"].includes(value.grantMode) || !["ALL", "NEW_CUSTOMER", "FIRST_ORDER", "RETURNING", "VIP", "INACTIVE"].includes(value.audience) || typeof value.allowGoodsStacking !== "boolean") fail2("BENEFIT_INVALID");
  quantum(value.amountIqd);
  integer3(value.usesPerCustomer, 1);
  if (value.usesPerCustomer > 1e3) fail2("BENEFIT_INVALID");
  quantum(value.maximumPerOrderIqd, 250);
  quantum(value.minimumGoodsIqd);
  integer3(value.maximumRoadMeters, 1);
  if (value.maximumRoadMeters > 2e5 || value.kind === "FREE_DELIVERIES" && value.amountIqd !== 0 || value.kind !== "FREE_DELIVERIES" && (!value.amountIqd || value.amountIqd > value.maximumPerOrderIqd) || value.kind === "GOODS_AMOUNT" && value.usesPerCustomer !== 1) fail2("BENEFIT_INVALID");
  for (const key of ["branchIds", "regionIds", "customerIds"]) {
    ids(value[key]);
    if (key !== "customerIds" && value[key].length > 20) fail2("BENEFIT_TARGET_LIMIT");
  }
  return JSON.parse(JSON.stringify(value));
}
var benefitGrantKey = (campaignId, sub) => ({ pk: "USER#" + id(sub), sk: "BENEFIT#" + id(campaignId) });
var holdKey = (orderId, target) => ({ pk: "BENEFIT_ORDER#" + id(orderId), sk: target });
var get = async (db, key) => (await db.send(new import_lib_dynamodb.GetCommand({ TableName: BENEFIT_TABLE, Key: key, ConsistentRead: true }))).Item;
function write(next, before) {
  return { Put: { TableName: BENEFIT_TABLE, Item: next, ...before ? { ConditionExpression: "#v=:v", ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": before.version } } : { ConditionExpression: "attribute_not_exists(pk)" } } };
}
function grantValid(g) {
  integer3(g.version, 1);
  integer3(g.grantedUses, 1);
  integer3(g.reservedUses);
  integer3(g.usedUses);
  if (typeof g.revoked !== "boolean" || g.reservedUses + g.usedUses > g.grantedUses) fail2("BENEFIT_GRANT_INVALID");
}
function platformBenefitEligibility(campaign, facts, at = Date.now()) {
  const b = readPlatformBenefit(campaign.benefit);
  id(facts.sub);
  id(campaign.discountId);
  integer3(campaign.version, 1);
  if (b.customerIds.length && !b.customerIds.includes(facts.sub)) return "BENEFIT_NOT_ELIGIBLE";
  if (b.branchIds.length && facts.branchId && !b.branchIds.includes(facts.branchId)) return "BENEFIT_WRONG_BRANCH";
  if (b.regionIds.length && !b.regionIds.some((x) => facts.regionIds.includes(x))) return "BENEFIT_WRONG_REGION";
  if (b.audience === "FIRST_ORDER" && !facts.firstOrder || b.audience === "NEW_CUSTOMER" && !facts.newCustomer || b.audience === "RETURNING" && facts.firstOrder || b.audience === "VIP" && !facts.vip || b.audience === "INACTIVE" && !facts.inactive) return "BENEFIT_NOT_ELIGIBLE";
  if (campaign.status === "paused") return "BENEFIT_PAUSED";
  if (campaign.status !== "active" || campaign.isActive !== true || campaign.isDeleted || campaign.deletedAt || !Number.isFinite(Date.parse(campaign.startDate)) || !Number.isFinite(Date.parse(campaign.endDate)) || at < Date.parse(campaign.startDate) || at >= Date.parse(campaign.endDate)) return "BENEFIT_EXPIRED";
  if (facts.goodsMinor !== void 0 && integer3(facts.goodsMinor) < b.minimumGoodsIqd * 1e3) return "BENEFIT_MINIMUM_ORDER";
  if (facts.roadMeters !== void 0 && integer3(facts.roadMeters) > b.maximumRoadMeters) return "BENEFIT_DISTANCE_EXCEEDED";
  return null;
}
async function platformBenefitBalance(db, campaign, sub) {
  const b = readPlatformBenefit(campaign.benefit), grant = await get(db, benefitGrantKey(campaign.discountId, sub));
  if (grant) grantValid(grant);
  const granted = grant?.grantedUses ?? (b.grantMode === "AUTO" ? b.usesPerCustomer : 0), reserved = grant?.reservedUses ?? 0, used = grant?.usedUses ?? 0;
  return { grant, granted, reserved, used, remaining: grant?.revoked ? 0 : Math.max(0, granted - reserved - used), revoked: grant?.revoked === true };
}
async function preparePlatformBenefit(db, input) {
  const { campaign, facts } = input, b = readPlatformBenefit(campaign.benefit), at = input.now ?? Date.now();
  const reason = platformBenefitEligibility(campaign, facts, at);
  if (reason) fail2(reason);
  if (!facts.branchId || facts.goodsMinor === void 0) fail2("BENEFIT_CART_REQUIRED");
  if (b.kind !== "GOODS_AMOUNT" && input.hasGoodsDiscount && !b.allowGoodsStacking) fail2("BENEFIT_STACKING_DENIED");
  const reference = input.referenceDeliveryMinor ?? 0;
  integer3(reference);
  let amount2;
  if (b.kind === "GOODS_AMOUNT") amount2 = Math.floor(Math.min(b.amountIqd * 1e3, facts.goodsMinor) / 25e4) * 25e4;
  else {
    if (reference % 25e4 !== 0) fail2("BENEFIT_DELIVERY_TARIFF_UNSUPPORTED");
    if (b.kind === "FREE_DELIVERIES" && reference > b.maximumPerOrderIqd * 1e3) fail2("BENEFIT_DELIVERY_CAP_EXCEEDED");
    amount2 = b.kind === "FREE_DELIVERIES" ? reference : Math.min(reference, b.amountIqd * 1e3);
  }
  if (!amount2) fail2("BENEFIT_NO_SAVINGS");
  if (amount2 > b.maximumPerOrderIqd * 1e3) fail2("BENEFIT_CAP_EXCEEDED");
  const balance = await platformBenefitBalance(db, campaign, facts.sub);
  if (balance.revoked || balance.remaining < 1) fail2("BENEFIT_EXHAUSTED");
  const target = b.kind === "GOODS_AMOUNT" ? "GOODS" : "DELIVERY", operations = [];
  const grant = balance.grant ?? { ...benefitGrantKey(campaign.discountId, facts.sub), version: 0, grantedUses: balance.granted, reservedUses: 0, usedUses: 0, revoked: false };
  const termsHash = quoteHash({ campaignId: campaign.discountId, benefit: b, startDate: campaign.startDate, endDate: campaign.endDate });
  const deliveryFunding = target === "DELIVERY" ? { policyPin: { policyId: BENEFIT_POLICY_PREFIX + campaign.discountId, version: campaign.version, termsHash }, allocation: allocateDeliveryFunding({ schemaVersion: 1, referenceFee: moneyFromMinor(reference), customerFee: moneyFromMinor(reference - amount2), funding: { kind: "PLATFORM" } }) } : null;
  if (!input.preview) {
    const orderId = id(input.orderId), key = holdKey(orderId, target), previous = await get(db, key);
    if (previous) fail2("BENEFIT_ORDER_RECOVERY_REQUIRED");
    operations.push(write({ ...grant, version: integer3(grant.version + 1, 1), reservedUses: grant.reservedUses + 1 }, balance.grant), write({ ...key, version: 1, campaignId: campaign.discountId, sub: facts.sub, orderId, target, amountMinor: amount2, status: "RESERVED", deliveryFunding, createdAt: new Date(at).toISOString() }));
  }
  return { amountMinor: amount2, target, deliveryFunding, customerFee: moneyFromMinor(reference - (target === "DELIVERY" ? amount2 : 0)), operations, receipt: { schemaVersion: 1, campaignId: campaign.discountId, target, termsHash }, validUntil: campaign.endDate };
}
async function settlePlatformBenefit(db, input) {
  const key = holdKey(input.orderId, input.target), h = await get(db, key);
  if (!h) fail2("BENEFIT_RESERVATION_MISSING");
  if (h.orderId !== input.orderId || h.target !== input.target || !["GOODS", "DELIVERY"].includes(h.target)) fail2("BENEFIT_RESERVATION_INVALID");
  integer3(h.version, 1);
  integer3(h.amountMinor, 1);
  id(h.campaignId);
  id(h.sub);
  if (input.expectedFunding && quoteHash(input.expectedFunding) !== quoteHash(h.deliveryFunding)) fail2("BENEFIT_RESERVATION_INVALID");
  const keep = input.outcome === "CAPTURED" || input.keepUse === true, status = input.outcome + (keep ? "_USED" : "");
  if (h.status === status) return { replayed: true, operations: [] };
  if (h.status !== "RESERVED") fail2("BENEFIT_RESERVATION_CONFLICT");
  const grant = await get(db, benefitGrantKey(h.campaignId, h.sub));
  if (!grant) fail2("BENEFIT_RESERVATION_INVALID");
  grantValid(grant);
  if (grant.reservedUses < 1) fail2("BENEFIT_RESERVATION_INVALID");
  return { replayed: false, operations: [write({ ...grant, version: integer3(grant.version + 1, 1), reservedUses: grant.reservedUses - 1, usedUses: grant.usedUses + (keep ? 1 : 0) }, grant), write({ ...h, version: integer3(h.version + 1, 1), status }, h)] };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BENEFIT_POLICY_PREFIX,
  BENEFIT_TABLE,
  benefitGrantKey,
  platformBenefitBalance,
  platformBenefitEligibility,
  preparePlatformBenefit,
  readPlatformBenefit,
  settlePlatformBenefit
});
