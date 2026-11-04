"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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

// backend/staff-service/write-workflow.js
var require_write_workflow = __commonJS({
  "backend/staff-service/write-workflow.js"(exports2, module2) {
    "use strict";
    var direct = () => process.env.PLATFORM_ENVIRONMENT === "staging" && process.env.PLATFORM_WRITE_MODE === "DIRECT";
    var operator2 = (person) => direct() && person?.status === "ACTIVE" && (process.env.PLATFORM_DIRECT_OPERATOR_IDS || "").split(",").includes(person.employeeId);
    module2.exports = { direct, operator: operator2 };
  }
});

// backend/staff-service/catalog.js
var require_catalog = __commonJS({
  "backend/staff-service/catalog.js"(exports2, module2) {
    "use strict";
    var ROLES = {
      commercial_viewer: ["commercial.read"],
      commercial_editor: ["commercial.read", "commercial.request", "commercial.funding.request"],
      commercial_approver: ["commercial.read", "commercial.approve", "commercial.funding.approve"],
      pricing_viewer: ["pricing.read", "pricing.simulate"],
      pricing_editor: ["pricing.read", "pricing.simulate", "pricing.request"],
      pricing_approver: ["pricing.read", "pricing.simulate", "pricing.approve"],
      merchant_staff_policy_manager: ["merchant_staff_policy.read", "merchant_staff_policy.manage"],
      settings_viewer: ["settings.read"],
      settings_manager: ["settings.read", "settings.change.request"],
      settings_approver: ["settings.read", "settings.change.approve"],
      staff_manager: ["staff.read", "staff.invite", "staff.change.request"],
      staff_approver: ["staff.read", "staff.change.approve"],
      customer_service: ["support.read", "support.reply", "customers.read", "orders.read"],
      support_supervisor: ["support.read", "support.reply", "support.assign", "support.close", "support.metrics", "customers.read", "orders.read"],
      driver_manager: ["drivers.read", "drivers.edit", "orders.read"],
      driver_reviewer: ["drivers.read", "drivers.documents.read", "drivers.review", "drivers.suspend"],
      merchant_manager: ["merchants.read", "merchants.edit", "products.read", "products.edit"],
      merchant_reviewer: ["merchants.read", "merchants.documents.read", "merchants.review", "merchants.suspend"],
      operations: ["orders.read", "orders.assign", "orders.cancel", "drivers.read", "merchants.read"],
      region_manager: ["regions.read", "regions.edit", "regions.activate"],
      promotions_manager: ["promotions.read", "promotions.create", "promotions.edit"],
      promotions_approver: ["promotions.read", "promotions.approve"],
      finance_viewer: ["finance.read"],
      finance_operator: ["finance.read", "finance.request", "finance.topup.review"],
      finance_approver: ["finance.read", "finance.approve"],
      finance_settings: ["finance.read", "finance.settings.request"],
      finance_settings_approver: ["finance.read", "finance.settings.approve"],
      auditor: ["audit.read", "reports.read", "audit.export"],
      platform_manager: ["dashboard.read", "reports.read", "drivers.read", "merchants.read", "customers.read", "orders.read", "regions.read", "promotions.read", "staff.read"]
    };
    var LABELS2 = { commercial_viewer: "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0627\u062A\u0641\u0627\u0642\u064A\u0627\u062A \u0648\u0627\u0644\u062A\u0645\u0648\u064A\u0644", commercial_editor: "\u0625\u0639\u062F\u0627\u062F \u0627\u0644\u0627\u062A\u0641\u0627\u0642\u064A\u0627\u062A \u0648\u0627\u0644\u062A\u0645\u0648\u064A\u0644", commercial_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0627\u062A\u0641\u0627\u0642\u064A\u0627\u062A \u0648\u0627\u0644\u062A\u0645\u0648\u064A\u0644", pricing_viewer: "\u0642\u0631\u0627\u0621\u0629 \u0648\u0645\u062D\u0627\u0643\u0627\u0629 \u0627\u0644\u062A\u0633\u0639\u064A\u0631", pricing_editor: "\u0625\u0639\u062F\u0627\u062F \u0642\u0648\u0627\u0639\u062F \u0627\u0644\u062A\u0633\u0639\u064A\u0631", pricing_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0648\u0646\u0634\u0631 \u0627\u0644\u062A\u0633\u0639\u064A\u0631", merchant_staff_policy_manager: "\u0625\u062F\u0627\u0631\u0629 \u0633\u064A\u0627\u0633\u0629 \u0635\u0644\u0627\u062D\u064A\u0627\u062A \u0645\u0648\u0638\u0641\u064A \u0627\u0644\u062A\u062C\u0627\u0631", settings_viewer: "\u0645\u0634\u0627\u0647\u062F \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A\u0629", settings_manager: "\u0627\u0642\u062A\u0631\u0627\u062D \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u062A\u0634\u063A\u064A\u0644\u064A\u0629", settings_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u062A\u0634\u063A\u064A\u0644\u064A\u0629", staff_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0648\u0638\u0641\u064A\u0646", staff_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A", customer_service: "\u062E\u062F\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621", support_supervisor: "\u0645\u0634\u0631\u0641 \u0627\u0644\u062F\u0639\u0645", driver_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0633\u0627\u0626\u0642\u064A\u0646", driver_reviewer: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0633\u0627\u0626\u0642\u064A\u0646", merchant_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u062A\u0627\u062C\u0631", merchant_reviewer: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0645\u062A\u0627\u062C\u0631", operations: "\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A", region_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0627\u0637\u0642", promotions_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0639\u0631\u0648\u0636", promotions_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0639\u0631\u0648\u0636", finance_viewer: "\u0645\u0634\u0627\u0647\u062F \u0645\u0627\u0644\u064A", finance_operator: "\u0639\u0645\u0644\u064A\u0627\u062A \u0645\u0627\u0644\u064A\u0629", finance_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0645\u0627\u0644\u064A", finance_settings: "\u0627\u0642\u062A\u0631\u0627\u062D \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0645\u0627\u0644\u064A\u0629", finance_settings_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0645\u0627\u0644\u064A\u0629", auditor: "\u0645\u062F\u0642\u0642", platform_manager: "\u0625\u0634\u0631\u0627\u0641 \u0627\u0644\u0645\u0646\u0635\u0629" };
    ROLES.bootstrap_admin = [...new Set(Object.values(ROLES).flat())];
    LABELS2.bootstrap_admin = "\u0645\u062F\u064A\u0631 \u0627\u0644\u062A\u0623\u0633\u064A\u0633 \u0627\u0644\u062D\u0627\u0644\u064A";
    function effective(employee) {
      if (!employee || employee.status !== "ACTIVE") return [];
      if (require_write_workflow().operator?.(employee)) return [...ROLES.bootstrap_admin];
      return [...new Set((employee.roles || []).flatMap((role) => Object.hasOwn(ROLES, role) ? ROLES[role] : []))];
    }
    function allowed3(employee, permission, regionId) {
      if (!effective(employee).includes(permission)) return false;
      if (regionId === void 0) return true;
      return employee.scope?.allRegions === true || typeof regionId === "string" && employee.scope?.regionIds?.includes(regionId);
    }
    function validateAssignment(input) {
      if (!Array.isArray(input.roles) || input.roles.length < 1 || input.roles.length > 10 || input.roles.some((r) => !Object.hasOwn(ROLES, r) || r === "bootstrap_admin")) throw Error("INVALID_ROLES");
      if (!["ACTIVE", "SUSPENDED"].includes(input.status)) throw Error("INVALID_STATUS");
      if (!input.scope || typeof input.scope.allRegions !== "boolean" || !Array.isArray(input.scope.regionIds) || input.scope.regionIds.length > 100 || input.scope.regionIds.some((r) => typeof r !== "string" || r.length < 1 || r.length > 100)) throw Error("INVALID_SCOPE");
      if (!input.scope.allRegions && input.scope.regionIds.length === 0) throw Error("REGION_SCOPE_REQUIRED");
      if (!Number.isSafeInteger(input.approvalLimit) || input.approvalLimit < 0 || input.approvalLimit > 1e9) throw Error("INVALID_APPROVAL_LIMIT");
      if (input.roles.some((r) => ["commercial_viewer", "commercial_editor", "commercial_approver", "pricing_viewer", "pricing_editor", "pricing_approver", "merchant_staff_policy_manager", "settings_viewer", "settings_manager", "settings_approver", "staff_manager", "staff_approver", "finance_viewer", "finance_operator", "finance_approver", "finance_settings", "finance_settings_approver", "auditor"].includes(r)) && !input.scope.allRegions) throw Error("GLOBAL_ROLE_REQUIRES_GLOBAL_SCOPE");
      return { roles: [...new Set(input.roles)], status: input.status, scope: { allRegions: input.scope.allRegions, regionIds: [...new Set(input.scope.regionIds)] }, approvalLimit: input.approvalLimit };
    }
    module2.exports = { ROLES, LABELS: LABELS2, effective, allowed: allowed3, validateAssignment };
  }
});

// backend/wallet-service/src/cashAdjudicationReadRuntime278.ts
var cashAdjudicationReadRuntime278_exports = {};
__export(cashAdjudicationReadRuntime278_exports, {
  deriveMerchantCodAccrual: () => deriveMerchantCodAccrual,
  exportMerchantSettlementPreview: () => exportMerchantSettlementPreview,
  merchantAccrualReportingAmounts: () => merchantAccrualReportingAmounts,
  readMerchantAccrualEvidence: () => readMerchantAccrualEvidence,
  summarizeMerchantAccruals: () => summarizeMerchantAccruals
});
module.exports = __toCommonJS(cashAdjudicationReadRuntime278_exports);

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
  const row3 = value;
  if (row3.currency !== "IQD" || row3.scale !== 1e3 || row3.moneySchemaVersion !== 1) throw new MoneyError("UNSUPPORTED_MONEY_SCHEMA");
  if (Object.keys(row3).some((key) => !["currency", "scale", "moneySchemaVersion", "minorAmount"].includes(key))) throw new MoneyError("INVALID_MONEY");
  return moneyFromMinor(integer(row3.minorAmount));
}
function toWholeIqdExact(value) {
  const amount3 = readMoney(value).minorAmount;
  if (amount3 % 1e3 !== 0) throw new MoneyError("PRECISION_LOSS");
  return amount3 / 1e3;
}
function addMoney(...values) {
  return moneyFromMinor(bounded(values.reduce((sum, value) => sum + BigInt(readMoney(value).minorAmount), 0n)));
}
function subtractMoney(left, right) {
  return moneyFromMinor(bounded(BigInt(readMoney(left).minorAmount) - BigInt(readMoney(right).minorAmount)));
}
function readWholeIqdRounding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MoneyError("INVALID_ROUNDING");
  const r = value;
  if (Object.keys(r).sort().join(",") !== "incrementIqd,mode" || typeof r.incrementIqd !== "number" || !Number.isSafeInteger(r.incrementIqd) || r.incrementIqd < 1 || r.incrementIqd > Math.floor(Number.MAX_SAFE_INTEGER / 1e3) || !["EXACT", "TOWARD_ZERO", "HALF_AWAY_FROM_ZERO"].includes(r.mode)) throw new MoneyError("INVALID_ROUNDING");
  return Object.freeze({ incrementIqd: r.incrementIqd, mode: r.mode });
}
function quantizeWholeIqd(value, policy) {
  const p = readWholeIqdRounding(policy), amount3 = BigInt(readMoney(value).minorAmount), step = BigInt(p.incrementIqd) * 1000n;
  let units = amount3 / step;
  const remainder = amount3 % step;
  if (remainder !== 0n) {
    if (p.mode === "EXACT") throw new MoneyError("PRECISION_LOSS");
    const absolute = remainder < 0n ? -remainder : remainder;
    if (p.mode === "HALF_AWAY_FROM_ZERO" && absolute * 2n >= step) units += amount3 < 0n ? -1n : 1n;
  }
  return moneyFromMinor(bounded(units * step));
}
function multiplyMoney(value, numerator, denominator, rounding) {
  const amount3 = BigInt(readMoney(value).minorAmount);
  if (integer(numerator) < 0 || integer(denominator) <= 0) throw new MoneyError("INVALID_MONEY");
  if (!["EXACT", "TOWARD_ZERO", "HALF_AWAY_FROM_ZERO"].includes(rounding)) throw new MoneyError("INVALID_ROUNDING");
  const product = amount3 * BigInt(numerator), divisor = BigInt(denominator);
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

// backend/wallet-service/src/cashAdjudication.ts
var CASH_ADJUDICATION_OUTCOMES = ["CUSTOMER_RECEIVABLE", "COMPANY_COVERAGE", "DRIVER_RESPONSIBILITY", "MERCHANT_ADJUSTMENT", "NO_SHORTFALL"];
var fail = (code = "CASH_ADJUDICATION_INVALID") => {
  throw Object.assign(Error(code), { code });
};
function cashAdjudicationEffects(outcome, shortfallIqd) {
  if (!CASH_ADJUDICATION_OUTCOMES.includes(outcome) || !Number.isSafeInteger(shortfallIqd) || shortfallIqd < 0 || shortfallIqd > Math.floor(Number.MAX_SAFE_INTEGER / 1e3)) return fail();
  const amount3 = shortfallIqd;
  const driverCreditIqd = ["CUSTOMER_RECEIVABLE", "COMPANY_COVERAGE", "MERCHANT_ADJUSTMENT"].includes(outcome) ? amount3 : 0;
  const merchantReductionIqd = outcome === "MERCHANT_ADJUSTMENT" ? amount3 : 0;
  const lines = driverCreditIqd ? [
    { account: outcome === "CUSTOMER_RECEIVABLE" ? "CUSTOMER_CASH_RECEIVABLE" : merchantReductionIqd ? "MERCHANT_PAYABLE" : "CASH_SHORTFALL_EXPENSE", side: "DEBIT", amount: moneyFromMinor(driverCreditIqd * 1e3) },
    { account: "DRIVER_WALLET_PAYABLE", side: "CREDIT", amount: moneyFromMinor(driverCreditIqd * 1e3) }
  ] : [];
  return {
    driverCreditIqd,
    merchantReductionIqd,
    receivableIqd: outcome === "CUSTOMER_RECEIVABLE" ? amount3 : 0,
    companyExpenseIqd: outcome === "COMPANY_COVERAGE" ? amount3 : 0,
    driverResponsibilityIqd: outcome === "DRIVER_RESPONSIBILITY" ? amount3 : 0,
    lines,
    additionalDriverDebitIqd: 0,
    physicalCashMovement: false
  };
}

// backend/wallet-service/src/deliveryPricing.ts
var PricingError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "PricingError";
  }
};
function fail2() {
  throw new PricingError("INVALID_PRICING");
}
function row(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail2();
  const r = value;
  if (Object.keys(r).some((k) => !keys.includes(k)) || keys.some((k) => !Object.prototype.hasOwnProperty.call(r, k))) return fail2();
  return r;
}
function ruleRow(value, keys) {
  return row(value, [...keys, ...value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "finalRounding") ? ["finalRounding"] : []]);
}
function roundingPolicy(r) {
  if (!Object.prototype.hasOwnProperty.call(r, "finalRounding")) return void 0;
  try {
    return readWholeIqdRounding(r.finalRounding);
  } catch {
    return fail2();
  }
}
function roundingLimits(policy, minimum2, maximum) {
  if (policy && [minimum2, maximum].some((m) => BigInt(m.minorAmount) % (BigInt(policy.incrementIqd) * 1000n) !== 0n)) return fail2();
}
function text(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,150}$/.test(value)) return fail2();
  return value;
}
function integer2(value, min = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) return fail2();
  return value;
}
function amount(value) {
  const m = readMoney(value);
  if (m.minorAmount < 0) return fail2();
  return m;
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail2();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return fail2();
  return ms;
}
var zero = moneyFromMinor(0);
var scopeTypes = ["GLOBAL", "GOVERNORATE", "CITY", "ZONE", "MERCHANT", "BRANCH"];
function scope(value) {
  const s = row(value, ["type", "id"]);
  if (!scopeTypes.includes(s.type)) return fail2();
  const id2 = text(s.id);
  if (s.type === "GLOBAL" && id2 !== "GLOBAL") return fail2();
  return { type: s.type, id: id2 };
}
function context(value) {
  const c = row(value, ["branchId", "merchantId", "zoneId", "cityId", "governorateId", "vehicleType"]);
  return { branchId: text(c.branchId), merchantId: text(c.merchantId), zoneId: text(c.zoneId), cityId: text(c.cityId), governorateId: text(c.governorateId), vehicleType: text(c.vehicleType) };
}
function common(r) {
  const version = integer2(r.version, 1), s = scope(r.scope), priority = integer2(r.priority);
  if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(r.status)) return fail2();
  const start = timestamp(r.effectiveFrom), end = r.effectiveTo === null ? Infinity : timestamp(r.effectiveTo);
  if (end <= start) return fail2();
  const rounding = r.rounding;
  if (!["EXACT", "TOWARD_ZERO", "HALF_AWAY_FROM_ZERO"].includes(rounding)) return fail2();
  if (r.vehicleType !== null) text(r.vehicleType);
  return { id: text(r.id), version, scope: s, priority, status: r.status, start, end, rounding, vehicleType: r.vehicleType, finalRounding: roundingPolicy(r) };
}
var commonKeys = ["id", "version", "scope", "priority", "status", "effectiveFrom", "effectiveTo", "rounding", "vehicleType"];
function surcharge(value) {
  const s = row(value, ["afterMeters", "flat", "perKm"]);
  return { afterMeters: integer2(s.afterMeters), flat: amount(s.flat), perKm: amount(s.perKm) };
}
function peaks(value) {
  if (!Array.isArray(value) || value.length > 100) return fail2();
  const list = value.map((v) => {
    const p = row(v, ["id", "from", "to", "amount"]);
    const start = timestamp(p.from), end = timestamp(p.to);
    if (end <= start) return fail2();
    return { id: text(p.id), start, end, amount: amount(p.amount) };
  }).sort((a, b) => a.start - b.start);
  if (new Set(list.map((p) => p.id)).size !== list.length || list.some((p, i) => i > 0 && p.start < list[i - 1].end)) return fail2();
  return list;
}
function compensationRule(value) {
  const r = ruleRow(value, [...commonKeys, "base", "pickupPerKm", "pickupIncludedMeters", "deliveryPerKm", "perMinute", "longDistance", "peaks", "minimum", "maximum", "fallbackPolicyId"]);
  const c = common(r), minimum2 = amount(r.minimum), maximum = amount(r.maximum);
  if (maximum.minorAmount < minimum2.minorAmount) return fail2();
  roundingLimits(c.finalRounding, minimum2, maximum);
  if (r.fallbackPolicyId !== null) text(r.fallbackPolicyId);
  return {
    ...c,
    base: amount(r.base),
    pickupPerKm: amount(r.pickupPerKm),
    pickupIncludedMeters: integer2(r.pickupIncludedMeters),
    deliveryPerKm: amount(r.deliveryPerKm),
    perMinute: amount(r.perMinute),
    longDistance: surcharge(r.longDistance),
    peaks: peaks(r.peaks),
    minimum: minimum2,
    maximum,
    fallbackPolicyId: r.fallbackPolicyId
  };
}
function select(rules, c, at) {
  const ids = { GLOBAL: "GLOBAL", GOVERNORATE: c.governorateId, CITY: c.cityId, ZONE: c.zoneId, MERCHANT: c.merchantId, BRANCH: c.branchId };
  const matches = rules.filter((r) => r.status === "PUBLISHED" && r.start <= at && at < r.end && ids[r.scope.type] === r.scope.id && (r.vehicleType === null || r.vehicleType === c.vehicleType));
  matches.sort((a, b) => scopeTypes.indexOf(b.scope.type) - scopeTypes.indexOf(a.scope.type) || b.priority - a.priority);
  if (!matches.length) throw new PricingError("NO_PRICING_RULE");
  if (matches[1] && matches[0].scope.type === matches[1].scope.type && matches[0].priority === matches[1].priority) throw new PricingError("AMBIGUOUS_PRICING_RULE");
  return matches[0];
}
function readRules(values, parse) {
  if (!Array.isArray(values) || values.length > 1e3) return fail2();
  const rules = values.map(parse);
  const identities = values.map((v) => `${v.id}:${v.version}`);
  if (new Set(identities).size !== identities.length) return fail2();
  return rules;
}
function route(value, at, fallbackPolicyId) {
  const r = row(value, ["id", "source", "quality", "fallbackPolicyId", "distanceMeters", "durationSeconds", "measuredAt", "expiresAt"]);
  const measuredAt = timestamp(r.measuredAt), expiresAt = timestamp(r.expiresAt);
  text(r.id);
  text(r.source);
  if (measuredAt > at || expiresAt <= at || expiresAt <= measuredAt) throw new PricingError("ROUTE_UNAVAILABLE");
  if (r.quality !== "ROAD" && r.quality !== "ESTIMATED") return fail2();
  if (r.quality === "ROAD" && r.fallbackPolicyId !== null) return fail2();
  if (r.quality === "ESTIMATED" && (fallbackPolicyId === null || text(r.fallbackPolicyId) !== fallbackPolicyId)) throw new PricingError("ROUTE_UNAVAILABLE");
  return Object.freeze({
    id: r.id,
    source: r.source,
    quality: r.quality,
    fallbackPolicyId: r.fallbackPolicyId,
    distanceMeters: integer2(r.distanceMeters),
    durationSeconds: integer2(r.durationSeconds),
    measuredAt: r.measuredAt,
    expiresAt: r.expiresAt
  });
}
function scaled(m, count, units, rounding) {
  return multiplyMoney(m, count, units, rounding);
}
function longPay(s, meters, rounding) {
  return meters > s.afterMeters ? addMoney(s.flat, scaled(s.perKm, meters - s.afterMeters, 1e3, rounding)) : zero;
}
function peakPay(list, at) {
  return list.find((p) => p.start <= at && at < p.end)?.amount ?? zero;
}
function clamp(m, min, max) {
  return m.minorAmount < min.minorAmount ? min : m.minorAmount > max.minorAmount ? max : m;
}
function reference(r) {
  return Object.freeze({ id: r.id, version: r.version, scope: Object.freeze({ ...r.scope }) });
}
function calculateDriverEarning(value) {
  const input = row(value, ["schemaVersion", "at", "context", "rules", "pickupRoute", "deliveryRoute"]);
  if (input.schemaVersion !== 1) return fail2();
  const at = timestamp(input.at), c = context(input.context), r = select(readRules(input.rules, compensationRule), c, at);
  const pickupRoute = route(input.pickupRoute, at, r.fallbackPolicyId), deliveryRoute = route(input.deliveryRoute, at, r.fallbackPolicyId);
  const pickup = scaled(r.pickupPerKm, Math.max(0, pickupRoute.distanceMeters - r.pickupIncludedMeters), 1e3, r.rounding);
  const delivery = scaled(r.deliveryPerKm, deliveryRoute.distanceMeters, 1e3, r.rounding);
  const seconds = BigInt(pickupRoute.durationSeconds) + BigInt(deliveryRoute.durationSeconds);
  const meters = BigInt(pickupRoute.distanceMeters) + BigInt(deliveryRoute.distanceMeters);
  if (seconds > BigInt(Number.MAX_SAFE_INTEGER) || meters > BigInt(Number.MAX_SAFE_INTEGER)) return fail2();
  const time2 = scaled(r.perMinute, Number(seconds), 60, r.rounding);
  const longDistance = longPay(r.longDistance, deliveryRoute.distanceMeters, r.rounding), peak = peakPay(r.peaks, at);
  const beforeLimits = addMoney(r.base, pickup, delivery, time2, longDistance, peak);
  const boundedEarning = clamp(beforeLimits, r.minimum, r.maximum);
  const driverEarning = r.finalRounding ? quantizeWholeIqd(boundedEarning, r.finalRounding) : boundedEarning;
  return Object.freeze({
    engineVersion: "DRIVER_COMPENSATION_V1",
    basis: "CALCULATION_PROPOSAL",
    rule: reference(r),
    pickupRoute,
    deliveryRoute,
    totalDistanceMeters: Number(meters),
    totalDurationSeconds: Number(seconds),
    components: Object.freeze({ base: r.base, pickup, delivery, time: time2, longDistance, peak, beforeLimits, limitAdjustment: subtractMoney(boundedEarning, beforeLimits), ...r.finalRounding ? { finalRounding: r.finalRounding, finalRoundingAdjustment: subtractMoney(driverEarning, boundedEarning) } : {} }),
    driverEarning
  });
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
  const a = amounts, zero2 = moneyFromMinor(0);
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
  const deliverySurplus = deliveryMargin.minorAmount > 0 ? deliveryMargin : zero2;
  const deliverySubsidy = deliveryMargin.minorAmount < 0 ? subtractMoney(zero2, deliveryMargin) : zero2;
  const platformNetContribution = addMoney(
    a.merchantCommission,
    a.serviceFee,
    a.platformOtherCharges,
    deliveryMargin,
    subtractMoney(zero2, a.platformGoodsDiscount)
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
  ) : zero2;
  const driverCashRetained = cod ? subtractMoney(customerTotal, driverWalletHold) : zero2;
  const driverCashTipRetained = cod ? a.driverTip : zero2;
  const driverCashEarningRetained = cod ? subtractMoney(driverCashRetained, a.driverTip) : zero2;
  const driverWalletEarningCredit = cod ? deliverySubsidy : a.driverEarning;
  const driverWalletTipCredit = cod ? zero2 : a.driverTip;
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

// backend/wallet-service/src/driverOffer.ts
var DriverOfferError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DriverOfferError";
  }
};
var fail3 = (code = "INVALID_DRIVER_OFFER") => {
  throw new DriverOfferError(code);
};
function row2(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail3();
  const r = value;
  if (Object.keys(r).sort().join(",") !== [...keys].sort().join(",")) return fail3();
  return r;
}
function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,150}$/.test(value)) return fail3();
  return value;
}
function integer3(value, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return fail3();
  return value;
}
function time(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail3();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return fail3();
  return ms;
}
function point(value) {
  const p = row2(value, ["latitude", "longitude"]);
  if (typeof p.latitude !== "number" || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || typeof p.longitude !== "number" || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) return fail3();
  return { latitude: p.latitude, longitude: p.longitude };
}
var equal = (a, b) => quoteCanonical(a) === quoteCanonical(b);
function boundRoute(value) {
  const r = row2(value, ["schemaVersion", "origin", "destination", "profile", "normalization", "route"]);
  if (r.schemaVersion !== 1 || !["driving", "driving-traffic"].includes(r.profile) || r.normalization !== "CEIL_METERS_SECONDS_V1") return fail3();
  if (r.route?.quality !== "ROAD" || r.route.fallbackPolicyId !== null || r.route.source !== "MAPBOX_DIRECTIONS_V5") return fail3();
  return { ...r, origin: point(r.origin), destination: point(r.destination) };
}
function validateDriverOfferOrderSnapshot(value) {
  const o = row2(value, [
    "snapshotId",
    "revision",
    "orderId",
    "branchId",
    "merchantId",
    "zoneId",
    "cityId",
    "governorateId",
    "branchPoint",
    "customerPoint",
    "confirmedCustomerTotal",
    "allocation",
    "paymentEvidence"
  ]);
  for (const field of ["snapshotId", "orderId", "branchId", "merchantId", "zoneId", "cityId", "governorateId"]) id(o[field]);
  integer3(o.revision);
  const a = row2(o.allocation, [
    "allocationSchemaVersion",
    "paymentMethod",
    "goodsGross",
    "merchantGoodsDiscount",
    "platformGoodsDiscount",
    "merchantCommission",
    "serviceFee",
    "customerDeliveryFee",
    "driverTip",
    "merchantOtherCharges",
    "platformOtherCharges",
    "thirdPartyOtherCharges"
  ]);
  const allocation = allocateOrder({ ...a, driverEarning: moneyFromMinor(0) });
  const total = readMoney(o.confirmedCustomerTotal);
  if (!equal(total, allocation.customerTotal)) return fail3();
  if (a.paymentMethod === "PREPAID") {
    const payment = row2(o.paymentEvidence, ["reference", "verifiedAt", "amount"]);
    id(payment.reference);
    time(payment.verifiedAt);
    if (!equal(readMoney(payment.amount), total)) return fail3();
  } else if (o.paymentEvidence !== null) return fail3();
  return { ...o, branchPoint: point(o.branchPoint), customerPoint: point(o.customerPoint), confirmedCustomerTotal: total };
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
var copy = (value) => JSON.parse(JSON.stringify(value));
function buildDriverOffer(value) {
  const input = row2(value, ["schemaVersion", "offerId", "assignment", "driver", "order", "policy", "pickupRoute", "deliveryRoute", "at", "ttlSeconds"]);
  if (input.schemaVersion !== 1 || Buffer.byteLength(JSON.stringify(input)) > 2e5) return fail3();
  const source = copy(input), at = time(source.at), ttl = integer3(source.ttlSeconds, 1, 900);
  id(source.offerId);
  const assignment = row2(source.assignment, ["id", "version", "expiresAt"]);
  id(assignment.id);
  integer3(assignment.version);
  const driver = row2(source.driver, ["id", "subjectId", "vehicleType", "positionVersion", "point", "observedAt", "expiresAt"]);
  for (const name of ["id", "subjectId", "vehicleType"]) id(driver[name]);
  integer3(driver.positionVersion);
  if (time(driver.observedAt) > at || time(driver.expiresAt) <= at) return fail3("DRIVER_OFFER_EXPIRED");
  const order = validateDriverOfferOrderSnapshot(source.order), policy = row2(source.policy, ["version", "rules"]);
  integer3(policy.version);
  if (order.paymentEvidence && time(order.paymentEvidence.verifiedAt) > at) return fail3();
  const pickupRoute = boundRoute(source.pickupRoute), deliveryRoute = boundRoute(source.deliveryRoute);
  if (pickupRoute.profile !== deliveryRoute.profile || !equal(point(driver.point), pickupRoute.origin) || !equal(pickupRoute.destination, order.branchPoint) || !equal(deliveryRoute.origin, order.branchPoint) || !equal(deliveryRoute.destination, order.customerPoint)) return fail3("DRIVER_OFFER_SCOPE_MISMATCH");
  const context2 = {
    branchId: order.branchId,
    merchantId: order.merchantId,
    zoneId: order.zoneId,
    cityId: order.cityId,
    governorateId: order.governorateId,
    vehicleType: driver.vehicleType
  };
  const calculation = calculateDriverEarning({
    schemaVersion: 1,
    at: source.at,
    context: context2,
    rules: policy.rules,
    pickupRoute: pickupRoute.route,
    deliveryRoute: deliveryRoute.route
  });
  const selectedRule = policy.rules.find((r) => r.id === calculation.rule.id && r.version === calculation.rule.version);
  const expiresAt = Math.min(
    at + ttl * 1e3,
    time(assignment.expiresAt),
    time(driver.expiresAt),
    time(pickupRoute.route.expiresAt),
    time(deliveryRoute.route.expiresAt),
    selectedRule.effectiveTo === null ? Infinity : time(selectedRule.effectiveTo)
  );
  if (expiresAt <= at) return fail3("DRIVER_OFFER_EXPIRED");
  const allocation = allocateOrder({ ...order.allocation, driverEarning: calculation.driverEarning });
  if (!equal(allocation.customerTotal, order.confirmedCustomerTotal)) return fail3();
  const content = {
    schemaVersion: 1,
    kind: "DRIVER_OFFER_PROPOSAL",
    offerId: source.offerId,
    createdAt: source.at,
    expiresAt: new Date(expiresAt).toISOString(),
    driverId: driver.id,
    driverSubjectId: driver.subjectId,
    orderId: order.orderId,
    branchId: order.branchId,
    assignmentId: assignment.id,
    assignmentVersion: assignment.version,
    snapshotId: order.snapshotId,
    orderRevision: order.revision,
    snapshotHash: quoteHash(order),
    policyVersion: policy.version,
    ruleHash: quoteHash(selectedRule),
    calculation,
    allocation,
    source
  };
  return freeze({ ...content, digest: quoteHash(content) });
}
function storedOffer(value) {
  try {
    const offered = value, rebuilt = buildDriverOffer(offered?.source);
    if (!equal(rebuilt, offered)) return fail3();
    return rebuilt;
  } catch {
    return fail3();
  }
}
function driverOfferView(value, driverId, subjectId, at) {
  const offer = storedOffer(value), ms = time(at);
  if (offer.driverId !== id(driverId) || offer.driverSubjectId !== id(subjectId)) return fail3("DRIVER_OFFER_SCOPE_MISMATCH");
  if (ms < time(offer.createdAt) || ms >= time(offer.expiresAt)) return fail3("DRIVER_OFFER_EXPIRED");
  const a = offer.allocation, c = offer.calculation;
  return freeze(copy({
    schemaVersion: 1,
    kind: offer.kind,
    offerId: offer.offerId,
    offerDigest: offer.digest,
    waveNumber: offer.assignmentVersion,
    orderId: offer.orderId,
    branchId: offer.branchId,
    createdAt: offer.createdAt,
    expiresAt: offer.expiresAt,
    pickupLocation: offer.source.order.branchPoint,
    deliveryZoneId: offer.source.order.zoneId,
    paymentMethod: a.paymentMethod,
    pickupDistanceMeters: c.pickupRoute.distanceMeters,
    pickupDurationSeconds: c.pickupRoute.durationSeconds,
    deliveryDistanceMeters: c.deliveryRoute.distanceMeters,
    deliveryDurationSeconds: c.deliveryRoute.durationSeconds,
    totalDistanceMeters: c.totalDistanceMeters,
    totalDurationSeconds: c.totalDurationSeconds,
    earningComponents: {
      base: c.components.base,
      pickup: c.components.pickup,
      delivery: c.components.delivery,
      time: c.components.time,
      longDistance: c.components.longDistance,
      peak: c.components.peak,
      limitAdjustment: c.components.limitAdjustment
    },
    driverEarning: c.driverEarning,
    driverTip: a.driverTipEntitlement,
    driverTotalEntitlement: a.driverTotalEntitlement,
    customerCashToCollect: a.paymentMethod === "COD" ? a.customerTotal : moneyFromMinor(0),
    driverWalletHold: a.driverWalletHold,
    driverCashRetained: a.driverCashRetained,
    laterWalletEarningCredit: a.driverWalletEarningCredit,
    laterWalletTipCredit: a.driverWalletTipCredit,
    walletCreditsRequireConfirmedCompletionAndFunding: true
  }));
}
function prepareDriverOfferAcceptance(value) {
  const input = row2(value, ["offer", "offerId", "driverId", "subjectId", "assignmentId", "assignmentVersion", "order", "at", "policy"]);
  const offer = storedOffer(input.offer);
  driverOfferView(offer, id(input.driverId), id(input.subjectId), input.at);
  if (offer.offerId !== id(input.offerId) || offer.assignmentId !== id(input.assignmentId) || offer.assignmentVersion !== integer3(input.assignmentVersion)) return fail3("DRIVER_OFFER_SCOPE_MISMATCH");
  const currentOrder = validateDriverOfferOrderSnapshot(input.order);
  if (quoteHash(currentOrder) !== offer.snapshotHash) return fail3("DRIVER_OFFER_SNAPSHOT_CHANGED");
  if (currentOrder.paymentEvidence && time(currentOrder.paymentEvidence.verifiedAt) > time(input.at)) return fail3();
  const policy = row2(input.policy, ["version", "enabledRuleVersions"]);
  integer3(policy.version);
  if (policy.version < offer.policyVersion || !Array.isArray(policy.enabledRuleVersions) || policy.enabledRuleVersions.length > 1e3) return fail3("DRIVER_OFFER_RULE_DISABLED");
  const enabled = policy.enabledRuleVersions.map((v) => {
    const r = row2(v, ["id", "version", "hash"]);
    id(r.id);
    integer3(r.version);
    if (typeof r.hash !== "string" || !/^[a-f0-9]{64}$/.test(r.hash)) return fail3();
    return r;
  });
  if (new Set(enabled.map((r) => r.id + ":" + r.version)).size !== enabled.length) return fail3();
  if (!enabled.some((r) => r.id === offer.calculation.rule.id && r.version === offer.calculation.rule.version && r.hash === offer.ruleHash)) return fail3("DRIVER_OFFER_RULE_DISABLED");
  const a = offer.allocation;
  let walletAmounts;
  try {
    walletAmounts = {
      acceptanceHoldIqd: toWholeIqdExact(a.driverWalletHold),
      completionEarningCreditIqd: toWholeIqdExact(a.driverWalletEarningCredit),
      completionTipCreditIqd: toWholeIqdExact(a.driverWalletTipCredit)
    };
  } catch {
    return fail3("DRIVER_OFFER_WALLET_PRECISION_UNSUPPORTED");
  }
  return freeze(copy({
    kind: "DRIVER_OFFER_ACCEPTANCE_PLAN",
    performsWrites: false,
    expected: {
      offerId: offer.offerId,
      digest: offer.digest,
      responseStatus: "pending",
      assignmentId: offer.assignmentId,
      assignmentVersion: offer.assignmentVersion,
      orderId: offer.orderId,
      orderRevision: offer.orderRevision,
      snapshotHash: offer.snapshotHash,
      driverId: offer.driverId,
      driverSubjectId: offer.driverSubjectId,
      policyVersion: policy.version,
      expiresAt: offer.expiresAt
    },
    acceptedTerms: {
      schemaVersion: 1,
      offerId: offer.offerId,
      offerDigest: offer.digest,
      rule: offer.calculation.rule,
      ruleHash: offer.ruleHash,
      offeredPolicyVersion: offer.policyVersion,
      acceptedAt: input.at,
      paymentMethod: a.paymentMethod,
      customerTotal: a.customerTotal,
      customerDeliveryFee: currentOrder.allocation.customerDeliveryFee,
      driverEarning: a.driverEarningEntitlement,
      driverTip: a.driverTipEntitlement,
      driverWalletHold: a.driverWalletHold,
      allocation: a,
      calculation: offer.calculation
    },
    legacyWalletAmounts: walletAmounts,
    financialWriterAndFundingChecksRequired: true
  }));
}

// backend/wallet-service/src/deliveryFundedAllocation.ts
var DeliveryFundedAllocationError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DeliveryFundedAllocationError";
  }
};
var fail4 = (code = "INVALID_DELIVERY_FUNDED_ALLOCATION") => {
  throw new DeliveryFundedAllocationError(code);
};
function exact(v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== [...keys].sort().join(",")) return fail4();
  return v;
}
function amount2(v) {
  const m = readMoney(v);
  if (m.minorAmount < 0) return fail4();
  return m;
}
var positive = (m) => m.minorAmount > 0 ? m : moneyFromMinor(0);
function allocateDeliveryFundedOrder(value) {
  try {
    const r = exact(value, ["allocationSchemaVersion", "base", "deliveryFunding"]);
    if (r.allocationSchemaVersion !== 2) return fail4();
    const funding = exact(r.deliveryFunding, ["policyPin", "allocation"]), pin = exact(funding.policyPin, ["policyId", "version", "termsHash"]);
    if (!quoteEntityIdValid(pin.policyId) || !Number.isSafeInteger(pin.version) || pin.version < 1 || typeof pin.termsHash !== "string" || !/^[a-f0-9]{64}$/.test(pin.termsHash)) return fail4();
    const a = exact(funding.allocation, ["schemaVersion", "referenceFee", "customerFee", "subsidy", "merchantShare", "platformShare"]);
    if (![1, 2].includes(a.schemaVersion)) return fail4();
    const referenceFee = amount2(a.referenceFee), customerFee = amount2(a.customerFee), subsidy = amount2(a.subsidy), merchantShare = amount2(a.merchantShare), platformShare = amount2(a.platformShare);
    if ((a.schemaVersion === 2 ? Math.max(0, referenceFee.minorAmount - customerFee.minorAmount) : subtractMoney(referenceFee, customerFee).minorAmount) !== subsidy.minorAmount || addMoney(merchantShare, platformShare).minorAmount !== subsidy.minorAmount) return fail4("DELIVERY_FUNDING_MISMATCH");
    const base = allocateOrder(r.base);
    if (readMoney(r.base.customerDeliveryFee).minorAmount !== customerFee.minorAmount) return fail4("DELIVERY_FUNDING_MISMATCH");
    const merchantPayable = subtractMoney(base.merchantPayable, merchantShare);
    if (merchantPayable.minorAmount < 0) return fail4("MERCHANT_DELIVERY_SUPPORT_EXCEEDS_PAYABLE");
    const baselineDeliveryMargin = subtractMoney(a.schemaVersion === 2 ? addMoney(customerFee, subsidy) : referenceFee, base.driverEarningEntitlement);
    const deliveryNetContribution = subtractMoney(baselineDeliveryMargin, platformShare);
    const platformNetContribution = addMoney(base.platformNetContribution, merchantShare);
    const sum = addMoney(merchantPayable, base.driverTotalEntitlement, base.thirdPartyPayable, platformNetContribution);
    if (sum.minorAmount !== base.customerTotal.minorAmount) return fail4("DELIVERY_ALLOCATION_UNBALANCED");
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
    return fail4();
  }
}

// backend/wallet-service/src/fullCashSettlement.ts
var FULL_CASH_SETTLEMENT_MODEL = "FULL_CASH_AT_DELIVERY_V1";
var FullCashSettlementError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "FullCashSettlementError";
  }
};
var fail5 = (code = "INVALID_FULL_CASH_SETTLEMENT") => {
  throw new FullCashSettlementError(code);
};
var clone = (value) => JSON.parse(JSON.stringify(value));
function freeze2(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze2);
    Object.freeze(value);
  }
  return value;
}
var positive2 = (value) => value.minorAmount > 0 ? value : moneyFromMinor(0);
var minimum = (a, b) => moneyFromMinor(Math.min(a.minorAmount, b.minorAmount));
function prepareFullCashSettlement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "base,deliveryFunding,settlementSchemaVersion") return fail5();
  const source = clone(value);
  if (source.settlementSchemaVersion !== 1) return fail5();
  const economic = source.deliveryFunding === null ? allocateOrder(source.base) : allocateDeliveryFundedOrder({ allocationSchemaVersion: 2, base: source.base, deliveryFunding: source.deliveryFunding });
  const cod = economic.paymentMethod === "COD", zero2 = moneyFromMinor(0);
  const driverCashRetained = cod ? minimum(economic.customerTotal, economic.driverTotalEntitlement) : zero2;
  const driverWalletHold = cod ? positive2(subtractMoney(economic.customerTotal, economic.driverTotalEntitlement)) : zero2;
  const driverWalletCreditTotal = subtractMoney(economic.driverTotalEntitlement, driverCashRetained);
  const driverCashTipRetained = cod ? minimum(economic.driverTipEntitlement, driverCashRetained) : zero2;
  const driverWalletTipCredit = subtractMoney(economic.driverTipEntitlement, driverCashTipRetained);
  const platformCollection = cod ? driverWalletHold : economic.customerTotal;
  const allocation = {
    ...economic,
    ruleVersion: "ORDER_ALLOCATION_V3_FULL_CASH",
    driverCashRetained,
    driverWalletHold,
    driverWalletCreditTotal,
    driverCashTipRetained,
    driverWalletTipCredit,
    driverCashEarningRetained: subtractMoney(driverCashRetained, driverCashTipRetained),
    driverWalletEarningCredit: subtractMoney(driverWalletCreditTotal, driverWalletTipCredit),
    platformCollection,
    platformFundsAfterDriverCredit: subtractMoney(platformCollection, driverWalletCreditTotal)
  };
  if (quoteCanonical(addMoney(
    allocation.merchantPayable,
    allocation.driverTotalEntitlement,
    allocation.thirdPartyPayable,
    allocation.platformNetContribution
  )) !== quoteCanonical(allocation.customerTotal) || quoteCanonical(addMoney(allocation.driverCashRetained, allocation.driverWalletCreditTotal)) !== quoteCanonical(allocation.driverTotalEntitlement) || quoteCanonical(subtractMoney(platformCollection, driverWalletCreditTotal)) !== quoteCanonical(addMoney(allocation.merchantPayable, allocation.thirdPartyPayable, allocation.platformNetContribution))) return fail5("FULL_CASH_CONSERVATION_FAILED");
  const content = {
    schemaVersion: 3,
    kind: "FULL_CASH_SETTLEMENT_ALLOCATION",
    settlementModel: FULL_CASH_SETTLEMENT_MODEL,
    source,
    allocation
  };
  return freeze2({ ...content, digest: quoteHash(content) });
}
function verifyFullCashSettlement(value) {
  const saved = value;
  const rebuilt = prepareFullCashSettlement(saved?.source);
  if (quoteCanonical(saved) !== quoteCanonical(rebuilt)) return fail5("FULL_CASH_SETTLEMENT_CHANGED");
  return rebuilt;
}
function prepareFullCashJournal(value) {
  const proposal = verifyFullCashSettlement(value), a = proposal.allocation, source = proposal.source;
  const delivery = source.deliveryFunding !== null;
  const goodsFunding = readMoney(a.platformGoodsDiscountFunding);
  const deliveryFunding = delivery ? readMoney(a.platformDeliveryPromotionFunding) : moneyFromMinor(0);
  const baselineMargin = delivery ? readMoney(a.baselineDeliveryMargin) : readMoney(a.deliveryMargin);
  const lines = [];
  function post(account, side, value2) {
    const amount3 = readMoney(value2);
    if (amount3.minorAmount < 0) return fail5("FULL_CASH_NEGATIVE_POSTING");
    if (amount3.minorAmount) lines.push({ account, side, amount: amount3 });
  }
  post(a.paymentMethod === "COD" ? "DRIVER_PREPAID_COLLATERAL" : "PAYMENT_PROVIDER_CLEARING", "DEBIT", a.platformCollection);
  post("MERCHANT_PAYABLE", "CREDIT", a.merchantPayable);
  post("DRIVER_WALLET_PAYABLE", "CREDIT", a.driverWalletCreditTotal);
  post("THIRD_PARTY_PAYABLE", "CREDIT", a.thirdPartyPayable);
  post("MERCHANT_COMMISSION_REVENUE", "CREDIT", a.merchantCommission);
  post("SERVICE_FEE_REVENUE", "CREDIT", readMoney(source.base.serviceFee));
  post("PLATFORM_OTHER_REVENUE", "CREDIT", readMoney(source.base.platformOtherCharges));
  post("PLATFORM_GOODS_PROMOTION_EXPENSE", "DEBIT", goodsFunding);
  post("PLATFORM_DELIVERY_PROMOTION_EXPENSE", "DEBIT", deliveryFunding);
  post(
    baselineMargin.minorAmount < 0 ? "BASE_DELIVERY_SUBSIDY_EXPENSE" : "BASE_DELIVERY_MARGIN_REVENUE",
    baselineMargin.minorAmount < 0 ? "DEBIT" : "CREDIT",
    moneyFromMinor(Math.abs(baselineMargin.minorAmount))
  );
  const debit = addMoney(...lines.filter((l) => l.side === "DEBIT").map((l) => l.amount));
  const credit = addMoney(...lines.filter((l) => l.side === "CREDIT").map((l) => l.amount));
  if (debit.minorAmount !== credit.minorAmount) return fail5("FULL_CASH_JOURNAL_UNBALANCED");
  const content = {
    schemaVersion: 1,
    kind: "FULL_CASH_POSTING_PROPOSAL",
    settlementModel: proposal.settlementModel,
    allocationDigest: proposal.digest,
    paymentMethod: a.paymentMethod,
    lines,
    debit,
    credit,
    funding: {
      platformGoodsPromotion: goodsFunding,
      platformDeliveryPromotion: deliveryFunding,
      merchantDeliverySupport: delivery ? readMoney(a.merchantDeliverySupport) : moneyFromMinor(0),
      platformNetContribution: a.platformNetContribution,
      platformNetFundingObligation: positive2(subtractMoney(moneyFromMinor(0), a.platformNetContribution)),
      driverWalletCreditDueAtCompletion: a.driverWalletCreditTotal
    },
    canPost: false,
    paymentVerified: false,
    walletMutationPerformed: false
  };
  return freeze2({ ...content, digest: quoteHash(content) });
}

// backend/wallet-service/src/fullCashOffer.ts
var fail6 = (code = "INVALID_FULL_CASH_OFFER") => {
  throw Object.assign(Error(code), { code });
};
var copy2 = (v) => JSON.parse(JSON.stringify(v));
var same = (a, b) => quoteCanonical(a) === quoteCanonical(b);
function freeze3(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze3);
    Object.freeze(v);
  }
  return v;
}
function exact2(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) return fail6();
  return value;
}
function prepareFullCashOrderSnapshot(value) {
  const r = exact2(value, ["order", "deliveryFunding"]), order = validateDriverOfferOrderSnapshot(copy2(r.order));
  prepareFullCashSettlement({
    settlementSchemaVersion: 1,
    base: { ...order.allocation, driverEarning: moneyFromMinor(0) },
    deliveryFunding: r.deliveryFunding
  });
  const body = {
    schemaVersion: 3,
    kind: "ORDER_FULL_CASH_SNAPSHOT",
    settlementModel: FULL_CASH_SETTLEMENT_MODEL,
    order,
    deliveryFunding: copy2(r.deliveryFunding)
  };
  return freeze3({ ...body, digest: quoteHash(body) });
}
function buildFullCashOffer(value) {
  const r = exact2(value, ["schemaVersion", "base", "deliveryFunding"]);
  if (r.schemaVersion !== 3) return fail6();
  const baseOffer = buildDriverOffer(r.base);
  if (baseOffer.allocation.paymentMethod !== "COD") return fail6("FULL_CASH_VERIFIED_PAYMENT_READER_REQUIRED");
  const snapshot = prepareFullCashOrderSnapshot({ order: baseOffer.source.order, deliveryFunding: r.deliveryFunding });
  const settlement = prepareFullCashSettlement({
    settlementSchemaVersion: 1,
    base: { ...baseOffer.source.order.allocation, driverEarning: baseOffer.calculation.driverEarning },
    deliveryFunding: snapshot.deliveryFunding
  });
  const body = {
    schemaVersion: 3,
    kind: "DRIVER_FULL_CASH_OFFER",
    settlementModel: FULL_CASH_SETTLEMENT_MODEL,
    baseOffer,
    financialSnapshot: snapshot,
    settlement
  };
  return freeze3({ ...body, digest: quoteHash(body) });
}
function verifyFullCashOffer(value) {
  const r = exact2(value, ["schemaVersion", "kind", "settlementModel", "baseOffer", "financialSnapshot", "settlement", "digest"]);
  const rebuilt = buildFullCashOffer({ schemaVersion: 3, base: r.baseOffer?.source, deliveryFunding: r.financialSnapshot?.deliveryFunding });
  if (!same(rebuilt, r)) return fail6("FULL_CASH_OFFER_CHANGED");
  verifyFullCashSettlement(rebuilt.settlement);
  return rebuilt;
}
function fullCashOfferView(value, driverId, subjectId, at) {
  const offered = verifyFullCashOffer(value), view = driverOfferView(offered.baseOffer, driverId, subjectId, at);
  const a = offered.settlement.allocation;
  return freeze3({
    ...view,
    schemaVersion: 3,
    kind: offered.kind,
    settlementModel: offered.settlementModel,
    offerDigest: offered.digest,
    driverWalletHold: a.driverWalletHold,
    driverCashRetained: a.driverCashRetained,
    laterWalletEarningCredit: a.driverWalletEarningCredit,
    laterWalletTipCredit: a.driverWalletTipCredit,
    collectionRequired: true,
    customerCashToCollect: a.customerTotal
  });
}
function prepareFullCashOfferAcceptance(value) {
  const r = exact2(value, ["offer", "offerId", "driverId", "subjectId", "assignmentId", "assignmentVersion", "order", "deliveryFunding", "at", "policy"]);
  const offered = verifyFullCashOffer(r.offer);
  fullCashOfferView(offered, r.driverId, r.subjectId, r.at);
  const snapshot = prepareFullCashOrderSnapshot({ order: r.order, deliveryFunding: r.deliveryFunding });
  if (!same(snapshot, offered.financialSnapshot)) return fail6("FULL_CASH_SNAPSHOT_CHANGED");
  const { deliveryFunding: _funding, ...base } = r;
  const old = prepareDriverOfferAcceptance({ ...base, offer: offered.baseOffer });
  const a = offered.settlement.allocation;
  let walletAmounts;
  try {
    walletAmounts = {
      acceptanceHoldIqd: toWholeIqdExact(a.driverWalletHold),
      completionEarningCreditIqd: toWholeIqdExact(a.driverWalletEarningCredit),
      completionTipCreditIqd: toWholeIqdExact(a.driverWalletTipCredit)
    };
  } catch {
    return fail6("FULL_CASH_WALLET_PRECISION_UNSUPPORTED");
  }
  return freeze3(copy2({
    ...old,
    kind: "FULL_CASH_ACCEPTANCE_PLAN",
    expected: { ...old.expected, digest: offered.digest, snapshotHash: snapshot.digest, settlementModel: offered.settlementModel },
    acceptedTerms: {
      ...old.acceptedTerms,
      schemaVersion: 3,
      settlementModel: offered.settlementModel,
      offerDigest: offered.digest,
      financialSnapshotDigest: snapshot.digest,
      settlementDigest: offered.settlement.digest,
      deliveryFunding: snapshot.deliveryFunding,
      allocation: a,
      driverWalletHold: a.driverWalletHold
    },
    legacyWalletAmounts: walletAmounts,
    requiresFullCashLifecycle: true,
    performsWrites: false
  }));
}
function verifyFullCashAssignment(order, saved, subjectId) {
  const offered = verifyFullCashOffer(saved?.financialOffer), b = offered.baseOffer, terms = order?.financialAcceptance;
  if (!terms || terms.schemaVersion !== 3 || terms.settlementModel !== FULL_CASH_SETTLEMENT_MODEL || saved.responseStatus !== "financial_accepted" || saved.isWinner !== true || order.driverId !== b.driverId || b.driverSubjectId !== subjectId || order.orderId !== b.orderId || order.assignmentWaveNumber !== b.assignmentVersion || saved.waveNumber !== b.assignmentVersion || !same(terms, saved.acceptedTerms) || !same(order.financialSnapshot, offered.financialSnapshot) || order.merchantId !== b.source.order.merchantId || ![order.storeId, order.businessId].some((v) => v === b.branchId) || [order.storeId, order.businessId].some((v) => v !== void 0 && v !== b.branchId)) return fail6("FULL_CASH_ASSIGNMENT_CONFLICT");
  const prepared = prepareFullCashOfferAcceptance({
    offer: offered,
    offerId: b.offerId,
    driverId: b.driverId,
    subjectId,
    assignmentId: b.assignmentId,
    assignmentVersion: b.assignmentVersion,
    order: b.source.order,
    deliveryFunding: offered.financialSnapshot.deliveryFunding,
    at: terms.acceptedAt,
    policy: { version: b.policyVersion, enabledRuleVersions: [{ id: b.calculation.rule.id, version: b.calculation.rule.version, hash: b.ruleHash }] }
  });
  if (!same(prepared.acceptedTerms, terms)) return fail6("FULL_CASH_ASSIGNMENT_CONFLICT");
  return offered;
}

// backend/wallet-service/src/deliveryFundedOffer.ts
var DeliveryFundedOfferError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DeliveryFundedOfferError";
  }
};
var fail7 = (code = "INVALID_DELIVERY_FUNDED_OFFER") => {
  throw new DeliveryFundedOfferError(code);
};
var copy3 = (v) => JSON.parse(JSON.stringify(v));
var same2 = (a, b) => quoteCanonical(a) === quoteCanonical(b);
function exact3(v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== [...keys].sort().join(",")) return fail7();
  return v;
}
function freeze4(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze4);
    Object.freeze(v);
  }
  return v;
}
function prepareDeliveryFundedFinancialSnapshot(value) {
  const r = exact3(value, ["order", "deliveryFunding"]), order = validateDriverOfferOrderSnapshot(copy3(r.order));
  allocateDeliveryFundedOrder({ allocationSchemaVersion: 2, base: { ...order.allocation, driverEarning: moneyFromMinor(0) }, deliveryFunding: r.deliveryFunding });
  const content = { schemaVersion: 2, kind: "ORDER_DELIVERY_FUNDED_SNAPSHOT", order, deliveryFunding: copy3(r.deliveryFunding) };
  return freeze4({ ...content, digest: quoteHash(content) });
}
function buildDeliveryFundedOffer(value) {
  const r = exact3(value, ["schemaVersion", "base", "deliveryFunding"]);
  if (r.schemaVersion !== 2) return fail7();
  const baseOffer = buildDriverOffer(r.base), snapshot = prepareDeliveryFundedFinancialSnapshot({ order: baseOffer.source.order, deliveryFunding: r.deliveryFunding });
  const allocation = allocateDeliveryFundedOrder({ allocationSchemaVersion: 2, base: { ...baseOffer.source.order.allocation, driverEarning: baseOffer.calculation.driverEarning }, deliveryFunding: snapshot.deliveryFunding });
  const content = { schemaVersion: 2, kind: "DRIVER_DELIVERY_FUNDED_OFFER", baseOffer, financialSnapshot: snapshot, allocation };
  return freeze4({ ...content, digest: quoteHash(content) });
}
function stored(value) {
  const r = exact3(value, ["schemaVersion", "kind", "baseOffer", "financialSnapshot", "allocation", "digest"]);
  const rebuilt = buildDeliveryFundedOffer({ schemaVersion: 2, base: r.baseOffer?.source, deliveryFunding: r.financialSnapshot?.deliveryFunding });
  if (!same2(rebuilt, r)) return fail7("DELIVERY_FUNDED_OFFER_CHANGED");
  return rebuilt;
}
function deliveryFundedOfferView(value, driverId, subjectId, at) {
  const offer = stored(value), view = driverOfferView(offer.baseOffer, driverId, subjectId, at);
  return freeze4({ ...view, schemaVersion: 2, kind: offer.kind, offerDigest: offer.digest });
}
function prepareDeliveryFundedOfferAcceptance(value) {
  const r = exact3(value, ["offer", "offerId", "driverId", "subjectId", "assignmentId", "assignmentVersion", "order", "deliveryFunding", "at", "policy"]), offer = stored(r.offer);
  deliveryFundedOfferView(offer, r.driverId, r.subjectId, r.at);
  const snapshot = prepareDeliveryFundedFinancialSnapshot({ order: r.order, deliveryFunding: r.deliveryFunding });
  if (!same2(snapshot, offer.financialSnapshot)) return fail7("DELIVERY_FUNDED_SNAPSHOT_CHANGED");
  const { deliveryFunding: _funding, ...legacy } = r;
  const plan = prepareDriverOfferAcceptance({ ...legacy, offer: offer.baseOffer });
  return freeze4(copy3({
    ...plan,
    kind: "DELIVERY_FUNDED_OFFER_ACCEPTANCE_PLAN",
    expected: { ...plan.expected, digest: offer.digest, snapshotHash: snapshot.digest },
    acceptedTerms: { ...plan.acceptedTerms, schemaVersion: 2, offerDigest: offer.digest, allocation: offer.allocation, deliveryFunding: snapshot.deliveryFunding, financialSnapshotDigest: snapshot.digest },
    requiresDeliveryFundingLifecycle: true
  }));
}
function verifyDeliveryFundedAssignment(order, saved, subjectId) {
  const offer = stored(saved?.financialOffer), b = offer.baseOffer, terms = order.financialAcceptance;
  if (!terms || terms.schemaVersion !== 2 || terms.paymentMethod !== "COD" || saved.responseStatus !== "financial_accepted" || saved.isWinner !== true || order.driverId !== b.driverId || subjectId !== b.driverSubjectId || order.orderId !== b.orderId || order.assignmentWaveNumber !== b.assignmentVersion || saved.waveNumber !== b.assignmentVersion || !same2(terms, saved.acceptedTerms) || !same2(order.financialSnapshot, offer.financialSnapshot) || order.merchantId !== b.source.order.merchantId || ![order.storeId, order.businessId].some((v) => v === b.branchId) || [order.storeId, order.businessId].some((v) => v !== void 0 && v !== b.branchId)) return fail7("DELIVERY_FUNDED_ASSIGNMENT_CONFLICT");
  const plan = prepareDeliveryFundedOfferAcceptance({ offer, offerId: b.offerId, driverId: b.driverId, subjectId, assignmentId: b.assignmentId, assignmentVersion: b.assignmentVersion, order: b.source.order, deliveryFunding: offer.financialSnapshot.deliveryFunding, at: terms.acceptedAt, policy: { version: b.policyVersion, enabledRuleVersions: [{ id: b.calculation.rule.id, version: b.calculation.rule.version, hash: b.ruleHash }] } });
  if (!same2(plan.acceptedTerms, terms)) return fail7("DELIVERY_FUNDED_ASSIGNMENT_CONFLICT");
  return offer;
}

// backend/wallet-service/src/driverOfferOrderReader.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/driverFinancialTransaction.ts
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var equal2 = (a, b) => quoteCanonical(a) === quoteCanonical(b);

// backend/wallet-service/src/driverOfferOrderReader.ts
var copy4 = (v) => JSON.parse(JSON.stringify(v));
var DriverOfferOrderReadError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DriverOfferOrderReadError";
  }
};
function fail8(code) {
  throw new DriverOfferOrderReadError(code);
}
function prepareDriverOfferFinancialSnapshot(value) {
  try {
    const snapshot = copy4(validateDriverOfferOrderSnapshot(value));
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 1e5) return fail8("DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED");
    const content = { schemaVersion: 1, kind: "ORDER_FINANCIAL_SNAPSHOT", snapshot };
    return { ...content, digest: quoteHash(content) };
  } catch {
    return fail8("DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED");
  }
}

// backend/wallet-service/src/financialAssignment.ts
function verifyFinancialAssignment(order, saved, subjectId) {
  const bad = () => {
    throw Error("FINANCIAL_ASSIGNMENT_CONFLICT");
  };
  const terms = order.financialAcceptance;
  if (!terms || terms.schemaVersion !== 1 || terms.paymentMethod !== "COD" || !Number.isSafeInteger(order.assignmentWaveNumber)) return bad();
  const offer = buildDriverOffer(saved?.financialOffer?.source);
  if (!saved || saved.responseStatus !== "financial_accepted" || saved.isWinner !== true || !equal2(offer, saved.financialOffer) || offer.driverId !== order.driverId || offer.driverSubjectId !== subjectId || offer.orderId !== order.orderId || saved.waveNumber !== order.assignmentWaveNumber || offer.assignmentVersion !== order.assignmentWaveNumber || !equal2(terms, saved.acceptedTerms) || terms.offerDigest !== offer.digest || !equal2(terms.allocation, offer.allocation) || !equal2(order.financialSnapshot, prepareDriverOfferFinancialSnapshot(offer.source.order))) return bad();
  const expected = prepareDriverOfferAcceptance({
    offer,
    offerId: offer.offerId,
    driverId: offer.driverId,
    subjectId,
    assignmentId: offer.assignmentId,
    assignmentVersion: offer.assignmentVersion,
    order: offer.source.order,
    at: terms.acceptedAt,
    policy: { version: offer.policyVersion, enabledRuleVersions: [{ id: offer.calculation.rule.id, version: offer.calculation.rule.version, hash: offer.ruleHash }] }
  });
  if (!equal2(expected.acceptedTerms, terms)) return bad();
  if (![order.storeId, order.businessId].some((v) => v === offer.branchId) || [order.storeId, order.businessId].some((v) => v !== void 0 && v !== offer.branchId) || order.merchantId !== offer.source.order.merchantId) return bad();
  return offer;
}

// backend/wallet-service/src/exceptionMerchantAccrual.ts
var fail9 = () => {
  throw Error("EXCEPTION_MERCHANT_ACCRUAL_INVALID");
};
function deriveExceptionMerchantAccrual(input) {
  const { branchId, order, acceptedOffer, outcome: j, payable: p } = input, orderId = order.orderId;
  if (order.status !== "returned" || order.orderStatus !== "returned" || !order.returnTaskCompletedAt && !(order.returnStatus === "CONFIRMED" && order.returnedAt) || order.storeId !== branchId || order.deletedAt != null || order.deletionRequestId != null || order.isDeleted === true || order.cashCollected === true || Number(order.cashCollectedAmount ?? 0) !== 0 || j.kind !== "ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL" || j.orderId !== orderId || j.branchId !== branchId || j.state !== "POSTED" || j.sk !== "EXCEPTION_ENTITLEMENTS" || !j.subjectId) return fail9();
  let digest;
  if (order.financialAcceptance.schemaVersion === 3) digest = verifyFullCashAssignment(order, acceptedOffer, j.subjectId).digest;
  else if (order.financialAcceptance.schemaVersion === 2) digest = verifyDeliveryFundedAssignment(order, acceptedOffer, j.subjectId).digest;
  else digest = verifyFinancialAssignment(order, acceptedOffer, j.subjectId).digest;
  const { digest: journalDigest, ...body } = j;
  if (journalDigest !== quoteHash(body) || j.offerDigest !== digest || !equal2(j.agreement, order.commercialPricing?.agreement) || j.merchantCompensationIqd <= 0 || !Number.isSafeInteger(j.merchantCompensationIqd) || !Number.isFinite(Date.parse(j.createdAt))) return fail9();
  if (p.kind !== "MERCHANT_EXCEPTION_PAYABLE" || p.financialSchemaVersion !== 5 || p.orderId !== orderId || p.sk !== "MERCHANT_PAYABLE" || p.walletId !== "WALLET#MERCHANT#" + branchId || p.branchId !== branchId || p.status !== "LOCKED_PENDING_SETTLEMENT" || p.amount !== j.merchantCompensationIqd || p.operationId !== j.operationId || p.journalDigest !== journalDigest || p.createdAt !== j.createdAt || !equal2(p.agreement, j.agreement)) return fail9();
  const F = j.driverFareIqd, M = j.merchantCompensationIqd, B = j.merchantFundingIqd;
  if (![F, M, B, j.platformFundingIqd].every((x) => Number.isSafeInteger(x) && x >= 0) || j.platformFundingIqd !== F + M - B || !Array.isArray(j.walletLines)) return fail9();
  const expected = new Map([["WALLET#DRIVER#" + order.driverId + "|AVAILABLE", F], ["WALLET#MERCHANT#" + branchId + "|AVAILABLE", -B], ["WALLET#MERCHANT#" + branchId + "|LOCKED", M]].filter(([, v]) => v !== 0));
  for (const line of j.walletLines) {
    const key = line.walletId + "|" + line.balanceType;
    if (!expected.has(key) || expected.get(key) !== line.delta || line.balanceAfter - line.balanceBefore !== line.delta || line.balanceAfter < 0) return fail9();
    expected.delete(key);
  }
  if (expected.size || j.settlementModel !== "EXCEPTION_ACCRUAL_GL_V1" || j.platformNetIqd !== -F - M + B || j.walletLines.reduce((n, l) => n + BigInt(l.delta), 0n) + BigInt(j.platformNetIqd) !== 0n) return fail9();
  const accountingLines = [{ account: "DRIVER_FARE_EXPENSE", side: "DEBIT", amount: F }, { account: "MERCHANT_COMPENSATION_EXPENSE", side: "DEBIT", amount: M }, { account: "MERCHANT_FUNDING_RECOVERY", side: "CREDIT", amount: B }, { account: "DRIVER_WALLET_PAYABLE", side: "CREDIT", amount: F }, { account: "MERCHANT_WALLET_PAYABLE", side: "CREDIT", amount: M }, { account: "MERCHANT_WALLET_PAYABLE", side: "DEBIT", amount: B }].filter((l) => l.amount);
  if (!equal2(j.accountingLines, accountingLines) || j.debit !== F + M + B || j.credit !== j.debit) return fail9();
  const amounts = Object.fromEntries(["goodsGross", "merchantFundedDiscount", "platformFundedDiscount", "merchantGoodsEntitlement", "merchantCommission", "merchantOtherCharges", "customerGoodsPayment", "customerServiceFee", "customerDeliveryFee", "driverEarning", "driverTip", "platformOtherCharges", "customerTotal", "platformNetContribution"].map((k) => [k, moneyFromMinor(0)]));
  amounts.merchantNet = moneyFromMinor(j.merchantCompensationIqd * 1e3);
  amounts.merchantExceptionCompensation = amounts.merchantNet;
  for (const m of Object.values(amounts)) toWholeIqdExact(readMoney(m));
  const content = { schemaVersion: 5, kind: "MERCHANT_EXCEPTION_ACCRUAL", accrualId: "MACC:" + quoteHash({ branchId, orderId, operationId: j.operationId }).slice(0, 48), branchId, orderId, operationId: j.operationId, deliveredAt: j.createdAt, accruedAt: j.createdAt, currency: "IQD", status: "LOCKED_PENDING_SETTLEMENT", agreement: j.agreement, amounts, sourceDigests: { outcome: quoteHash(j), payable: quoteHash(p), acceptedOffer: digest }, payoutAuthorized: false, walletMutationPerformed: false };
  return { ...content, digest: quoteHash(content) };
}

// backend/wallet-service/src/merchantSettlementAccrual.ts
var amountFields = [
  "goodsGross",
  "merchantFundedDiscount",
  "platformFundedDiscount",
  "merchantGoodsEntitlement",
  "merchantCommission",
  "merchantOtherCharges",
  "merchantNet",
  "customerGoodsPayment",
  "customerServiceFee",
  "customerDeliveryFee",
  "driverEarning",
  "driverTip",
  "platformOtherCharges",
  "platformNetContribution",
  "customerTotal"
];
var administrativeAmountFields = ["merchantAdministrativeAdjustment", "customerCashCollected", "customerCashShortfall", "driverAdministrativeCredit"];
var deliveryAmountFields = ["merchantDeliverySupport", "platformDeliveryPromotionFunding", "referenceDeliveryFee", "deliveryPromotionSubsidy", "baselineDeliveryMargin", "deliveryNetContribution"];
var MerchantAccrualError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "MerchantAccrualError";
  }
};
var fail10 = (code = "MERCHANT_ACCRUAL_PROOF_REQUIRED") => {
  throw new MerchantAccrualError(code);
};
var same3 = (a, b) => quoteCanonical(a) === quoteCanonical(b);
function whole(value) {
  try {
    return toWholeIqdExact(readMoney(value));
  } catch {
    return fail10();
  }
}
function integer4(value, signed = false) {
  if (!Number.isSafeInteger(value) || !signed && Number(value) < 0) return fail10();
  return value;
}
function instant(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return fail10();
  return value;
}
function deriveMerchantCodAccrual(input) {
  try {
    if (input.payable.kind === "MERCHANT_EXCEPTION_PAYABLE") return deriveExceptionMerchantAccrual(input);
    const { branchId, order, acceptedOffer, outcome, payable } = input;
    const orderId = order.orderId;
    const administrative = order.cashAdjudication != null;
    if (![branchId, orderId, order.driverId, outcome.subjectId].every(quoteEntityIdValid) || order.PK !== "ORDER#" + orderId || order.SK !== "META" || order.status !== "delivered" || order.orderStatus !== "delivered" || !administrative && order.cashCollected !== true || order.returnStatus != null || order.returnCaseId != null || order.cancellationStatus != null || order.cancellationRequestId != null || order.deletedAt != null || order.deletionRequestId != null || order.isDeleted === true) return fail10();
    const fullCash = outcome.schemaVersion === 3, deliveryFunded = outcome.schemaVersion === 2 || fullCash && order.financialSnapshot?.deliveryFunding != null;
    let fullOffer;
    let offer;
    if (fullCash) {
      fullOffer = verifyFullCashAssignment(order, acceptedOffer, outcome.subjectId);
      offer = { ...fullOffer.baseOffer, digest: fullOffer.digest, allocation: fullOffer.settlement.allocation };
    } else if (deliveryFunded) {
      const verified = verifyDeliveryFundedAssignment(order, acceptedOffer, outcome.subjectId);
      offer = { ...verified.baseOffer, digest: verified.digest, allocation: verified.allocation };
    } else offer = verifyFinancialAssignment(order, acceptedOffer, outcome.subjectId);
    const a = offer.allocation, goods = offer.source.order.allocation;
    const operationId = fullCash ? "FCS:" + quoteHash({ orderId, settlementModel: FULL_CASH_SETTLEMENT_MODEL }).slice(0, 48) : "COD:" + quoteHash({ orderId }).slice(0, 48);
    if (offer.branchId !== branchId || outcome.orderId !== orderId || outcome.sk !== "FINANCIAL_OUTCOME" || outcome.kind !== (fullCash ? "FULL_CASH_COMPLETION_JOURNAL" : "COD_COMPLETION_JOURNAL") || outcome.schemaVersion !== (fullCash ? 3 : deliveryFunded ? 2 : 1) || outcome.outcome !== "COMPLETED" || outcome.branchId !== branchId || outcome.driverId !== order.driverId || outcome.operationId !== operationId || order.financialOutcome !== operationId || outcome.attempt !== order.assignmentAttemptCounter || outcome.offerId !== offer.offerId || outcome.offerDigest !== offer.digest || !same3(outcome.allocation, a)) return fail10();
    const deliveredAt = instant(outcome.createdAt);
    if (instant(order.deliveredAt) !== deliveredAt || instant(order.financialAcceptance.acceptedAt) > deliveredAt) return fail10();
    const receipt = outcome.receipt;
    const H = whole(a.driverWalletHold), baseA = whole(a.driverWalletCreditTotal), baseM = whole(a.merchantPayable), PD = whole(a.platformGoodsDiscountFunding), DD = deliveryFunded ? whole(a.platformDeliveryPromotionFunding) : 0, C = whole(a.customerTotal);
    let adjustment = null;
    const actual = administrative ? order.cashAdjudication.actualCollectedIqd : C;
    if (administrative) {
      const j = input.cashAdjudicationJournal;
      if (!fullCash || !Number.isSafeInteger(actual) || actual < 0 || actual > C || !j) return fail10();
      const { digest, ...content2 } = j;
      adjustment = cashAdjudicationEffects(order.cashAdjudication.outcome, C - actual);
      if (j.orderId !== orderId || j.sk !== "CASH_ADJUDICATION_JOURNAL" || j.kind !== "CASH_ADJUDICATION_ACCOUNTING_JOURNAL" || j.financialSchemaVersion !== 4 || j.status !== "POSTED" || j.operationId !== operationId || j.branchId !== branchId || j.driverId !== order.driverId || j.actualCollectedIqd !== actual || j.expectedIqd !== C || j.decisionId !== order.cashAdjudication.decisionId || receipt?.administrativeDecisionId !== j.decisionId || order.deliveryEvidenceSource !== "ADMINISTRATIVE_FINDING" || j.originalAllocationDigest !== fullOffer.settlement.digest || quoteHash(content2) !== digest || !same3(j.adjustment, adjustment) || !same3(receipt.adjustment, adjustment) || !same3(j.lines, adjustment.lines)) return fail10();
    }
    const A = baseA + (adjustment?.driverCreditIqd ?? 0), M = baseM - (adjustment?.merchantReductionIqd ?? 0);
    if (!receipt || receipt.kind !== (fullCash ? "FULL_CASH_COMPLETION" : "COD_COMPLETION") || receipt.success !== true || receipt.orderId !== orderId || receipt.operationId !== operationId || receipt.deliveredAt !== deliveredAt || receipt.cashCollected !== (actual === C) || receipt.cashCollectedAmount !== actual || (fullCash ? receipt.settledCollateral !== H || receipt.retainedCash !== whole(a.driverCashRetained) || receipt.driverWalletCredit !== A : receipt.capturedAmount !== H || receipt.holdCaptured !== H > 0) || order.cashCollectedAmount !== actual || order.cashCollected !== (actual === C) || whole(a.thirdPartyPayable) !== 0) return fail10();
    const agreement = order.commercialPricing?.agreement;
    if (!agreement || !quoteEntityIdValid(agreement.id) || !Number.isSafeInteger(agreement.version) || agreement.version < 1 || typeof agreement.termsHash !== "string" || !/^[a-f0-9]{64}$/.test(agreement.termsHash) || payable.orderId !== orderId || payable.sk !== "MERCHANT_PAYABLE" || payable.kind !== "MERCHANT_ORDER_PAYABLE" || payable.financialSchemaVersion !== (fullCash ? 4 : deliveryFunded ? 3 : 2) || payable.branchId !== branchId || payable.walletId !== "WALLET#MERCHANT#" + branchId || payable.status !== "LOCKED_PENDING_SETTLEMENT" || payable.amount !== M || payable.operationId !== operationId || payable.createdAt !== deliveredAt || !same3(payable.agreement, agreement)) return fail10();
    if (deliveryFunded && (!same3(payable.deliveryFunding, order.financialAcceptance.deliveryFunding) || !fullCash && !same3(payable.merchantDeliverySupport, a.merchantDeliverySupport))) return fail10();
    const expected = /* @__PURE__ */ new Map();
    const expect = (wallet, bucket2, delta) => {
      integer4(delta, true);
      if (delta) expected.set(wallet + "|" + bucket2, delta);
    };
    expect("WALLET#DRIVER#" + order.driverId, "AVAILABLE", A);
    expect("WALLET#DRIVER#" + order.driverId, "LOCKED", -H);
    expect(payable.walletId, "LOCKED", M);
    const platformDelta = BigInt(H) + BigInt(PD) + BigInt(DD) - BigInt(M) - BigInt(A);
    if (platformDelta > BigInt(Number.MAX_SAFE_INTEGER) || platformDelta < BigInt(Number.MIN_SAFE_INTEGER)) return fail10();
    if (!fullCash) {
      expect("WALLET#PLATFORM", "AVAILABLE", Number(platformDelta));
      expect("WALLET#PLATFORM", "LOCKED", -(PD + DD));
    }
    const walletLines = fullCash ? outcome.walletLines : outcome.journalLines;
    if (!Array.isArray(walletLines) || walletLines.length !== expected.size) return fail10();
    let sum = 0n;
    for (const line of walletLines) {
      const key = line.walletId + "|" + line.balanceType;
      const delta = integer4(line.delta, true), before = integer4(line.balanceBefore), after = integer4(line.balanceAfter);
      if (line.unit !== "IQD_WHOLE" || !expected.has(key) || expected.get(key) !== delta || BigInt(before) + BigInt(delta) !== BigInt(after)) return fail10();
      expected.delete(key);
      sum += BigInt(delta);
    }
    if (expected.size || sum + (fullCash ? BigInt(whole(a.platformNetContribution)) : 0n) - BigInt(adjustment?.driverCreditIqd ?? 0) + BigInt(adjustment?.merchantReductionIqd ?? 0) !== 0n) return fail10();
    if (fullCash) {
      if (!same3(payable.deliveryFunding, order.financialSnapshot.deliveryFunding) || receipt.payoutPerformed !== false) return fail10();
      const j = input.accountingJournal, posting = prepareFullCashJournal(fullOffer.settlement);
      if (!j || j.pk !== "FULL_CASH_JOURNAL#" + orderId || j.sk !== "META" || j.kind !== "FULL_CASH_ACCOUNTING_JOURNAL" || j.schemaVersion !== 1 || j.status !== "POSTED" || j.orderId !== orderId || j.branchId !== branchId || j.driverId !== order.driverId || j.operationId !== operationId || j.settlementModel !== FULL_CASH_SETTLEMENT_MODEL || j.offerDigest !== offer.digest || j.allocationDigest !== fullOffer.settlement.digest || j.postingDigest !== posting.digest || outcome.journalDigest !== posting.digest || payable.journalDigest !== posting.digest || payable.settlementModel !== FULL_CASH_SETTLEMENT_MODEL || outcome.settlementModel !== FULL_CASH_SETTLEMENT_MODEL || j.createdAt !== deliveredAt || !same3(j.lines, posting.lines) || !same3(j.debit, posting.debit) || !same3(j.credit, posting.credit) || !same3(j.funding, posting.funding) || !same3(j.walletLines, walletLines)) return fail10();
    }
    const amounts = {
      goodsGross: readMoney(goods.goodsGross),
      merchantFundedDiscount: readMoney(goods.merchantGoodsDiscount),
      platformFundedDiscount: readMoney(goods.platformGoodsDiscount),
      merchantGoodsEntitlement: readMoney(a.merchantGoodsEntitlement),
      merchantCommission: readMoney(a.merchantCommission),
      merchantOtherCharges: readMoney(goods.merchantOtherCharges),
      merchantNet: moneyFromMinor(M * 1e3),
      customerGoodsPayment: readMoney(a.customerGoodsPayment),
      customerServiceFee: readMoney(goods.serviceFee),
      customerDeliveryFee: readMoney(goods.customerDeliveryFee),
      driverEarning: readMoney(a.driverEarningEntitlement),
      driverTip: readMoney(a.driverTipEntitlement),
      platformOtherCharges: readMoney(goods.platformOtherCharges),
      platformNetContribution: readMoney(a.platformNetContribution),
      customerTotal: readMoney(a.customerTotal)
    };
    if (deliveryFunded) for (const field of deliveryAmountFields) amounts[field] = readMoney(a[field]);
    if (adjustment) Object.assign(amounts, { merchantAdministrativeAdjustment: moneyFromMinor(adjustment.merchantReductionIqd * 1e3), customerCashCollected: moneyFromMinor(actual * 1e3), customerCashShortfall: moneyFromMinor((C - actual) * 1e3), driverAdministrativeCredit: moneyFromMinor(adjustment.driverCreditIqd * 1e3) });
    for (const amount3 of Object.values(amounts)) whole(amount3);
    const content = {
      schemaVersion: administrative ? 6 : fullCash ? 4 : deliveryFunded ? 2 : 1,
      kind: "MERCHANT_COD_ACCRUAL",
      accrualId: "MACC:" + quoteHash({ branchId, orderId, operationId }).slice(0, 48),
      branchId,
      orderId,
      operationId,
      deliveredAt,
      currency: "IQD",
      status: "LOCKED_PENDING_SETTLEMENT",
      agreement: JSON.parse(JSON.stringify(agreement)),
      amounts,
      sourceDigests: { outcome: quoteHash(outcome), payable: quoteHash(payable), acceptedOffer: offer.digest, ...fullCash ? { accountingJournal: quoteHash(input.accountingJournal) } : {}, ...administrative ? { cashAdjudicationJournal: quoteHash(input.cashAdjudicationJournal) } : {} },
      payoutAuthorized: false,
      walletMutationPerformed: false
    };
    return JSON.parse(JSON.stringify({ ...content, digest: quoteHash(content) }));
  } catch (error) {
    if (error instanceof MerchantAccrualError) throw error;
    return fail10();
  }
}
function summarizeMerchantAccruals(branchId, accruals) {
  if (!quoteEntityIdValid(branchId)) return fail10();
  const orders = /* @__PURE__ */ new Set(), ids = /* @__PURE__ */ new Set(), totals = {};
  const versions = new Set(accruals.map((r) => r.schemaVersion));
  if ([...versions].some((v) => ![1, 2, 4, 5, 6].includes(v))) return fail10("MERCHANT_ACCRUAL_SET_INVALID");
  const mixed = versions.size > 1, schema = mixed ? 3 : accruals[0]?.schemaVersion ?? 1;
  for (const row3 of accruals) {
    const rowSchema = row3.schemaVersion;
    const { digest, ...content } = row3;
    if (row3.kind !== (rowSchema === 5 ? "MERCHANT_EXCEPTION_ACCRUAL" : "MERCHANT_COD_ACCRUAL") || ![1, 2, 4, 5, 6].includes(rowSchema) || row3.branchId !== branchId || row3.status !== "LOCKED_PENDING_SETTLEMENT" || row3.currency !== "IQD" || row3.payoutAuthorized !== false || row3.walletMutationPerformed !== false || quoteHash(content) !== digest || orders.has(row3.orderId) || ids.has(row3.accrualId) || !row3.amounts || Object.keys(row3.amounts).sort().join(",") !== [...amountFields, ...rowSchema === 6 ? administrativeAmountFields : [], ...rowSchema === 5 ? ["merchantExceptionCompensation"] : [], ...rowSchema === 2 || [4, 6].includes(rowSchema) && row3.amounts.merchantDeliverySupport !== void 0 ? deliveryAmountFields : []].sort().join(",")) return fail10("MERCHANT_ACCRUAL_SET_INVALID");
    const m = Object.fromEntries(Object.entries(row3.amounts).map(([key, value]) => [key, BigInt(readMoney(value).minorAmount)]));
    if (rowSchema === 5) {
      if (m.merchantExceptionCompensation <= 0n || m.merchantNet !== m.merchantExceptionCompensation || Object.entries(m).some(([k, v]) => !["merchantNet", "merchantExceptionCompensation"].includes(k) && v !== 0n)) return fail10("MERCHANT_ACCRUAL_SET_INVALID");
    } else if (Object.entries(m).some(([key, value]) => !["platformNetContribution", "baselineDeliveryMargin", "deliveryNetContribution"].includes(key) && value < 0n) || m.goodsGross - m.merchantFundedDiscount !== m.merchantGoodsEntitlement || m.merchantGoodsEntitlement - m.platformFundedDiscount !== m.customerGoodsPayment || m.merchantGoodsEntitlement - m.merchantCommission + m.merchantOtherCharges - (m.merchantDeliverySupport ?? 0n) - (m.merchantAdministrativeAdjustment ?? 0n) !== m.merchantNet || m.customerGoodsPayment + m.customerServiceFee + m.customerDeliveryFee + m.driverTip + m.merchantOtherCharges + m.platformOtherCharges !== m.customerTotal || m.merchantCommission + m.customerServiceFee + m.platformOtherCharges + m.customerDeliveryFee - m.driverEarning - m.platformFundedDiscount + (m.merchantDeliverySupport ?? 0n) !== m.platformNetContribution) return fail10("MERCHANT_ACCRUAL_SET_INVALID");
    if ((rowSchema === 2 || [4, 6].includes(rowSchema) && m.merchantDeliverySupport !== void 0) && (m.referenceDeliveryFee - m.customerDeliveryFee !== m.deliveryPromotionSubsidy || m.merchantDeliverySupport + m.platformDeliveryPromotionFunding !== m.deliveryPromotionSubsidy || m.referenceDeliveryFee - m.driverEarning !== m.baselineDeliveryMargin || m.baselineDeliveryMargin - m.platformDeliveryPromotionFunding !== m.deliveryNetContribution)) return fail10("MERCHANT_ACCRUAL_SET_INVALID");
    if (rowSchema === 6 && (m.customerCashCollected + m.customerCashShortfall !== m.customerTotal || m.merchantAdministrativeAdjustment > m.merchantGoodsEntitlement || m.driverAdministrativeCredit > m.customerCashShortfall)) return fail10("MERCHANT_ACCRUAL_SET_INVALID");
    orders.add(row3.orderId);
    ids.add(row3.accrualId);
    const reportingAmounts = mixed ? { ...row3.amounts, ...deliveryReportingAmounts(row3) } : row3.amounts;
    for (const [key, value] of Object.entries(reportingAmounts)) {
      const amount3 = readMoney(value);
      whole(amount3);
      if (!totals[key]) totals[key] = 0n;
      totals[key] += BigInt(amount3.minorAmount);
      if (totals[key] > BigInt(Number.MAX_SAFE_INTEGER) || totals[key] < BigInt(Number.MIN_SAFE_INTEGER)) return fail10("MERCHANT_ACCRUAL_TOTAL_OVERFLOW");
    }
  }
  return {
    schemaVersion: schema,
    kind: "MERCHANT_ACCRUAL_SET_SUMMARY",
    branchId,
    currency: "IQD",
    ...mixed ? { sourceSchemaCounts: { v1: accruals.filter((a) => a.schemaVersion === 1).length, v2: accruals.filter((a) => a.schemaVersion === 2).length, ...versions.has(5) ? { v5: accruals.filter((a) => a.schemaVersion === 5).length } : {}, ...versions.has(4) ? { v4: accruals.filter((a) => a.schemaVersion === 4).length } : {}, ...versions.has(6) ? { v6: accruals.filter((a) => a.schemaVersion === 6).length } : {} } } : {},
    accrualCount: accruals.length,
    amounts: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, moneyFromMinor(Number(v))])),
    sourceSetDigest: quoteHash([...accruals].sort((a, b) => a.accrualId.localeCompare(b.accrualId)).map((a) => a.digest)),
    basis: "EXPLICIT_VERIFIED_ACCRUAL_SET_NOT_PERIOD_COVERAGE",
    payoutAuthorized: false
  };
}
function deliveryReportingAmounts(row3) {
  if (row3.schemaVersion === 2 || [4, 6].includes(row3.schemaVersion) && row3.amounts.merchantDeliverySupport !== void 0) return Object.fromEntries(deliveryAmountFields.map((k) => [k, readMoney(row3.amounts[k])]));
  const margin = BigInt(readMoney(row3.amounts.customerDeliveryFee).minorAmount) - BigInt(readMoney(row3.amounts.driverEarning).minorAmount);
  if (margin > BigInt(Number.MAX_SAFE_INTEGER) || margin < BigInt(Number.MIN_SAFE_INTEGER)) return fail10("MERCHANT_ACCRUAL_TOTAL_OVERFLOW");
  return {
    merchantDeliverySupport: moneyFromMinor(0),
    platformDeliveryPromotionFunding: moneyFromMinor(0),
    referenceDeliveryFee: readMoney(row3.amounts.customerDeliveryFee),
    deliveryPromotionSubsidy: moneyFromMinor(0),
    baselineDeliveryMargin: moneyFromMinor(Number(margin)),
    deliveryNetContribution: moneyFromMinor(Number(margin))
  };
}
function merchantAccrualReportingAmounts(row3) {
  summarizeMerchantAccruals(row3.branchId, [row3]);
  return Object.fromEntries(Object.entries({ ...row3.amounts, ...deliveryReportingAmounts(row3) }).map(([k, v]) => [k, readMoney(v)]));
}

// backend/wallet-service/src/merchantSettlementPreview.ts
var import_lib_dynamodb8 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/merchantSettlementPeriod.ts
var local = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Baghdad",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

// backend/wallet-service/src/db.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var client = new import_client_dynamodb.DynamoDBClient({
  region: process.env.AWS_REGION || "me-south-1"
});
var docClient = import_lib_dynamodb3.DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true
  },
  unmarshallOptions: {
    wrapNumbers: false
    // ✅ Important: Keep numbers as native JS numbers (not BigInt)
  }
});
var TABLES = {
  WALLETS: process.env.WALLETS_TABLE || "dev-Wallets",
  LEDGER: process.env.LEDGER_TABLE || "dev-LedgerEntries",
  HOLDS: process.env.HOLDS_TABLE || "dev-Holds",
  TOPUP_REQUESTS: process.env.TOPUP_REQUESTS_TABLE || "dev-TopupRequests",
  AUDIT_LOG: process.env.AUDIT_LOG_TABLE || "dev-AuditLog",
  IDEMPOTENCY_KEYS: process.env.IDEMPOTENCY_KEYS_TABLE || "dev-IdempotencyKeys"
};

// backend/wallet-service/src/fundingService.ts
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");
var s3 = new import_client_s3.S3Client({});
var bucket = process.env.FUNDING_RECEIPTS_BUCKET || "";

// backend/wallet-service/src/walletStatement.ts
function csvCell(value) {
  let s = String(value ?? "");
  if (typeof value !== "number" && /^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// backend/wallet-service/src/cashboxAccounting.ts
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");
var { allowed, LABELS } = require_catalog();
var { operator } = require_write_workflow();
var MAX2 = Math.floor(Number.MAX_SAFE_INTEGER / 1e3);

// backend/wallet-service/src/merchantPayout.ts
var import_lib_dynamodb7 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/merchantSettlementAuthority.ts
var import_lib_dynamodb5 = require("@aws-sdk/lib-dynamodb");
var { allowed: allowed2 } = require_catalog();

// backend/wallet-service/src/merchantStatementApproval.ts
var import_lib_dynamodb6 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/merchantPayout.ts
function fail11(code = "PAYOUT_CONFLICT") {
  throw Object.assign(Error(code), { code });
}
function validSeal(row3) {
  const { digest, ...body } = row3 || {};
  return typeof digest === "string" && digest === quoteHash(body);
}
function verifyMerchantPayoutJournal(row3, branchId, payable) {
  if (!validSeal(row3) || row3.kind !== "MERCHANT_PAYOUT_PAID_JOURNAL" || row3.schemaVersion !== 1 || row3.status !== "PAID" || row3.branchId !== branchId || row3.payoutId !== payable.paidPayoutId || row3.paidAt !== payable.paidAt || row3.batchId !== payable.settlementBatchId || row3.pk !== "MERCHANT_PAYOUT_PAID#" + row3.payoutId || row3.sk !== "META" || !["CASH", "ZAIN_CASH"].includes(row3.method)) return fail11("PAYOUT_PAID_PROOF_INVALID");
  const amount3 = toWholeIqdExact(readMoney(row3.amount));
  if (!Number.isSafeInteger(amount3) || amount3 <= 0 || !Number.isSafeInteger(row3.executionFee) || row3.executionFee < 0 || !Number.isSafeInteger(amount3 + row3.executionFee) || row3.method === "CASH" && row3.executionFee !== 0 || row3.debit !== amount3 + row3.executionFee || row3.credit !== amount3 + row3.executionFee || !Array.isArray(row3.orderLines) || new Set(row3.orderLines.map((l) => l.orderId)).size !== row3.orderLines.length || row3.orderLines.reduce((s, l) => s + l.amount, 0) !== amount3 || !row3.orderLines.some((l) => l.orderId === payable.orderId && l.amount === payable.amount && l.lineDigest === payable.settlementLineDigest) || row3.receiptOwnerId !== row3.ownerId || !row3.externalReference || !row3.sourceAccount || !row3.reconciledBy || !equal2(row3.lines, [{ account: "MERCHANT_PAYABLE", side: "DEBIT", amount: amount3 }, ...row3.executionFee ? [{ account: "PAYOUT_FEE_EXPENSE", side: "DEBIT", amount: row3.executionFee }] : [], { account: row3.method === "CASH" ? row3.cashLedgerJournalId ? "MERCHANT_DISBURSEMENT_CLEARING" : "CASH_DISBURSEMENT" : "ZAIN_CASH_DISBURSEMENT", side: "CREDIT", amount: amount3 + row3.executionFee }])) return fail11("PAYOUT_PAID_PROOF_INVALID");
  return row3;
}

// backend/wallet-service/src/merchantSettlementPreview.ts
var fail12 = (code = "MERCHANT_SETTLEMENT_PREVIEW_UNAVAILABLE") => {
  throw Object.assign(Error(code), { code });
};
async function readMerchantAccrualEvidence(db, branchId, orderId) {
  const get = async (table, key) => {
    const row3 = (await db.send(new import_lib_dynamodb8.GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item;
    if (!row3) return fail12();
    return JSON.parse(JSON.stringify(row3));
  };
  const order = await get("WizzOrders", { PK: "ORDER#" + orderId, SK: "META" });
  if (order.orderId !== orderId || ![order.storeId, order.businessId].some((b) => b === branchId) || [order.storeId, order.businessId].some((b) => b !== void 0 && b !== branchId) || !quoteEntityIdValid(order.driverId) || !Number.isSafeInteger(order.assignmentWaveNumber) || order.assignmentWaveNumber < 1) return fail12();
  const [payable, acceptedOffer] = await Promise.all([
    get("staging-Holds", { orderId, sk: "MERCHANT_PAYABLE" }),
    get("WaveOffers_staging", { orderId, SK: `FINANCIAL#${order.driverId}#WAVE#${order.assignmentWaveNumber}` })
  ]);
  const outcomeKey = { orderId, sk: payable.kind === "MERCHANT_EXCEPTION_PAYABLE" ? "EXCEPTION_ENTITLEMENTS" : "FINANCIAL_OUTCOME" };
  const outcome = await get("staging-Holds", outcomeKey);
  const accountingJournal = outcome.schemaVersion === 3 ? await get("staging-MerchantPlatform", { pk: "FULL_CASH_JOURNAL#" + orderId, sk: "META" }) : void 0;
  const cashAdjudicationJournal = order.cashAdjudication ? await get("staging-Holds", { orderId, sk: "CASH_ADJUDICATION_JOURNAL" }) : void 0;
  let sourcePayable = payable;
  if (payable.status === "PAID") {
    const paidJournal = await get("staging-MerchantPlatform", { pk: "MERCHANT_PAYOUT_PAID#" + payable.paidPayoutId, sk: "META" });
    verifyMerchantPayoutJournal(paidJournal, branchId, payable);
    const { paidAt: _paidAt, paidPayoutId: _payout, ...original } = payable;
    sourcePayable = { ...original, status: "LOCKED_PENDING_SETTLEMENT" };
  }
  return {
    order,
    outcome,
    outcomeKey,
    payable,
    acceptedOffer,
    ...cashAdjudicationJournal ? { cashAdjudicationJournal } : {},
    ...accountingJournal ? { accountingJournal } : {},
    accrual: deriveMerchantCodAccrual({ branchId, order, outcome, payable: sourcePayable, acceptedOffer, accountingJournal, cashAdjudicationJournal })
  };
}
function exportMerchantSettlementPreview(preview) {
  const { previewId, ...content } = preview;
  if (previewId !== "MSV:" + quoteHash(content).slice(0, 48) || preview.canPay !== false || preview.canReserve !== false || quoteHash(preview.summary) !== quoteHash(summarizeMerchantAccruals(preview.branchId, preview.accruals))) return fail12();
  const includeDelivery = preview.accruals.some((a) => a.schemaVersion === 2 || [4, 6].includes(a.schemaVersion));
  const deliveryFields = ["referenceDeliveryFee", "deliveryPromotionSubsidy", "merchantDeliverySupport", "platformDeliveryPromotionFunding", "baselineDeliveryMargin", "deliveryNetContribution"];
  const rows = [
    ["report_type", preview.kind],
    ["branch_id", preview.branchId],
    ["preview_id", preview.previewId],
    ["coverage", preview.coverage],
    ["consistency", preview.consistency],
    ["payment_authorized", false],
    ["period_from_UTC_inclusive", preview.period.fromUtc],
    ["period_until_UTC_exclusive", preview.period.untilExclusiveUtc],
    ["period_timezone", preview.period.timezone],
    ["schedule_version", preview.period.scheduleVersion],
    ["source_set_digest", preview.summary.sourceSetDigest],
    [
      "order_id",
      "accrual_id",
      "delivered_at_UTC",
      "agreement_id",
      "agreement_version",
      "goods_gross_IQD",
      "merchant_funded_discount_IQD",
      "platform_funded_discount_IQD",
      "merchant_commission_IQD",
      "merchant_other_charges_IQD",
      "merchant_net_pending_IQD",
      "customer_service_fee_IQD",
      "customer_delivery_fee_IQD",
      "driver_tip_IQD",
      ...includeDelivery ? deliveryFields.map((k) => k + "_IQD") : []
    ]
  ];
  const iqd = (value) => {
    const n = BigInt(readMoney(value).minorAmount);
    if (n % 1000n) return fail12();
    return Number(n / 1000n);
  };
  for (const a of preview.accruals) {
    const amounts = includeDelivery ? merchantAccrualReportingAmounts(a) : a.amounts;
    rows.push([
      a.orderId,
      a.accrualId,
      a.deliveredAt,
      a.agreement.id,
      a.agreement.version,
      ...[
        "goodsGross",
        "merchantFundedDiscount",
        "platformFundedDiscount",
        "merchantCommission",
        "merchantOtherCharges",
        "merchantNet",
        "customerServiceFee",
        "customerDeliveryFee",
        "driverTip"
      ].map((key) => iqd(amounts[key])),
      ...includeDelivery ? deliveryFields.map((k) => iqd(amounts[k])) : []
    ]);
  }
  rows.push(["metric", "total_IQD"]);
  for (const [key, value] of Object.entries(preview.summary.amounts)) rows.push([key, iqd(value)]);
  const csv = "\uFEFF" + rows.map((row3) => row3.map(csvCell).join(",")).join("\r\n");
  if (Buffer.byteLength(csv) > 512e3) return fail12("MERCHANT_SETTLEMENT_PREVIEW_TOO_LARGE");
  return { csv, filename: `merchant-settlement-preview-${preview.previewId.slice(4)}.csv`, paymentAuthorized: false };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  deriveMerchantCodAccrual,
  exportMerchantSettlementPreview,
  merchantAccrualReportingAmounts,
  readMerchantAccrualEvidence,
  summarizeMerchantAccruals
});
