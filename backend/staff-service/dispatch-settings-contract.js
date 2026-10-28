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

// backend/wallet-service/src/deliveryOperationsPolicy.ts
var deliveryOperationsPolicy_exports = {};
__export(deliveryOperationsPolicy_exports, {
  OPERATIONS_LIMITS: () => OPERATIONS_LIMITS,
  OPERATIONS_PK: () => OPERATIONS_PK,
  validateOperationsSnapshot: () => validateOperationsSnapshot,
  validateOperationsValues: () => validateOperationsValues
});
module.exports = __toCommonJS(deliveryOperationsPolicy_exports);

// backend/wallet-service/src/dispatchPolicy.ts
var invalid = () => {
  throw Object.assign(Error("INVALID_DISPATCH_POLICY"), { code: "INVALID_DISPATCH_POLICY", status: 400 });
};
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) return invalid();
  return value;
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}
function validateDispatchPolicy(value) {
  const root = object(value, ["schemaVersion", "performanceMode", "profiles"]);
  if (root.schemaVersion !== 2 || !["LEGACY_METRICS","VERIFIED_SNAPSHOT_V1"].includes(root.performanceMode)) return invalid();
  const profiles = object(root.profiles, ["LEGACY", "FINANCIAL"]);
  for (const engine of ["LEGACY", "FINANCIAL"]) {
    const p = object(profiles[engine], ["normalWaves", "offerTtlSeconds", "waveDurationSeconds", "totalDispatchSeconds", "reassignmentWindowSeconds", "positionMaxAgeSeconds", "newDriverExemption", "repeatOffers", "recovery"]);
    if (!Array.isArray(p.normalWaves) || p.normalWaves.length < 1 || p.normalWaves.length > 10) return invalid();
    for (const [i, rule] of p.normalWaves.entries()) {
      const w = object(rule, ["number", "radiusMeters", "recipients", "minimumAcceptancePercent", "minimumCompletionPercent", "maximumConsecutiveDeclines"]);
      if (w.number !== i + 1) return invalid();
      integer(w.radiusMeters, 1, 5e4);
      if (w.recipients !== "ALL") integer(w.recipients, 1, 25);
      if (engine === "FINANCIAL" && w.recipients === "ALL") return invalid();
      integer(w.minimumAcceptancePercent, 0, 100);
      integer(w.minimumCompletionPercent, 0, 100);
      integer(w.maximumConsecutiveDeclines, 0, 999);
    }
    integer(p.offerTtlSeconds, 1, 900);
    integer(p.waveDurationSeconds, p.offerTtlSeconds, 900);
    integer(p.totalDispatchSeconds, 30, 3600);
    integer(p.reassignmentWindowSeconds, 30, 900);
    if (p.positionMaxAgeSeconds !== null) integer(p.positionMaxAgeSeconds, p.offerTtlSeconds, 900);
    if (engine === "FINANCIAL" && p.positionMaxAgeSeconds === null) return invalid();
    const exemption = object(p.newDriverExemption, ["belowCompletedTrips", "missingHistory"]);
    integer(exemption.belowCompletedTrips, 0, 100);
    if (!["LEGACY_COMPAT", "NOT_EXEMPT"].includes(exemption.missingHistory)) return invalid();
    const repeat = object(p.repeatOffers, ["reofferFromWave", "excludeUnassignedDrivers", "policy"]);
    if (repeat.reofferFromWave !== null) integer(repeat.reofferFromWave, 1, p.normalWaves.length);
    if (repeat.excludeUnassignedDrivers !== true || repeat.policy !== "LEGACY_COMPAT") return invalid();
    const recovery = object(p.recovery, ["enabled", "radiusMeters", "boostBasisPoints", "maximumPickupEtaSeconds", "durationSeconds", "budgetMinor", "legacyReference"]);
    if (recovery.enabled !== false) return invalid();
    for (const [field, min, max] of [["radiusMeters", 1, 5e4], ["boostBasisPoints", 0, 1e4], ["maximumPickupEtaSeconds", 1, 7200], ["durationSeconds", 1, 1800], ["budgetMinor", 0, Number.MAX_SAFE_INTEGER]])
      if (recovery[field] !== null) integer(recovery[field], min, max);
    if (recovery.legacyReference !== null) {
      object(recovery.legacyReference, ["radiusMeters", "boostBasisPoints"]);
      integer(recovery.legacyReference.radiusMeters, 1, 5e4);
      integer(recovery.legacyReference.boostBasisPoints, 0, 1e4);
    }
  }
  if (Buffer.byteLength(JSON.stringify(root)) > 32e3) return invalid();
  return JSON.parse(JSON.stringify(root));
}

// backend/wallet-service/src/deliveryOperationsPolicy.ts
var OPERATIONS_PK = "OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS";
var OPERATIONS_LIMITS = { quoteMaxPerCustomerPerMinute: [1, 120], driverOfferTtlSeconds: [1, 900], driverPositionMaxAgeSeconds: [1, 900], reassignmentWindowSeconds: [30, 900], maximumWaves: [1, 10] };
function validateOperationsValues(input) {
  const bad = (code = "INVALID_DISPATCH_SETTINGS") => {
    throw Object.assign(Error(code), { code, status: 400 });
  };
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).filter((k) => k !== "dispatch").sort().join(",") !== Object.keys(OPERATIONS_LIMITS).sort().join(",")) return bad();
  const v = input;
  for (const k of Object.keys(OPERATIONS_LIMITS)) {
    const [min, max] = OPERATIONS_LIMITS[k];
    if (!Number.isSafeInteger(v[k]) || v[k] < min || v[k] > max) return bad();
  }
  if (v.driverPositionMaxAgeSeconds < v.driverOfferTtlSeconds) return bad("POSITION_WINDOW_TOO_SHORT");
  if (Object.prototype.hasOwnProperty.call(v, "dispatch")) {
    const dispatch = validateDispatchPolicy(v.dispatch), p = dispatch.profiles.FINANCIAL;
    if (p.offerTtlSeconds !== v.driverOfferTtlSeconds || p.positionMaxAgeSeconds !== v.driverPositionMaxAgeSeconds || p.reassignmentWindowSeconds !== v.reassignmentWindowSeconds || p.normalWaves.length !== v.maximumWaves) return bad("DISPATCH_LIMITS_CONFLICT");
    return { ...v, dispatch };
  }
  return { ...v };
}
function validateOperationsSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== "values,version" || !Number.isSafeInteger(input.version) || input.version < 0) throw Error("DELIVERY_OPERATIONS_UNAVAILABLE");
  return { version: input.version, values: validateOperationsValues(input.values) };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OPERATIONS_LIMITS,
  OPERATIONS_PK,
  validateOperationsSnapshot,
  validateOperationsValues
});
