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

// backend/wallet-service/src/orderExceptionSettings.ts
var orderExceptionSettings_exports = {};
__export(orderExceptionSettings_exports, {
  EXCEPTION_SETTINGS_DEFAULTS: () => EXCEPTION_SETTINGS_DEFAULTS,
  EXCEPTION_SETTINGS_LIMITS: () => EXCEPTION_SETTINGS_LIMITS,
  EXCEPTION_SETTINGS_PK: () => EXCEPTION_SETTINGS_PK,
  readExceptionSettings: () => readExceptionSettings,
  validateExceptionSettings: () => validateExceptionSettings
});
module.exports = __toCommonJS(orderExceptionSettings_exports);
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/deliveryQuoteRecord.ts
var import_node_crypto = require("node:crypto");

// backend/wallet-service/src/money.ts
var MAX = BigInt(Number.MAX_SAFE_INTEGER);

// backend/wallet-service/src/deliveryQuoteRecord.ts
function quoteCanonical(v) {
  return Array.isArray(v) ? "[" + v.map(quoteCanonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + quoteCanonical(v[k])).join(",") + "}" : JSON.stringify(v);
}
var quoteHash = (v) => (0, import_node_crypto.createHash)("sha256").update(quoteCanonical(v)).digest("hex");

// backend/wallet-service/src/orderExceptionSettings.ts
var EXCEPTION_SETTINGS_PK = "OPERATIONAL_SETTINGS#ORDER_EXCEPTIONS";
var EXCEPTION_SETTINGS_LIMITS = { waitSeconds: [60, 3600], minimumContactAttempts: [1, 10], contactIntervalSeconds: [30, 600], arrivalRadiusMeters: [25, 1e3], maximumAccuracyMeters: [5, 200], positionMaxAgeSeconds: [15, 300] };
var EXCEPTION_SETTINGS_DEFAULTS = { waitSeconds: 600, minimumContactAttempts: 3, contactIntervalSeconds: 60, arrivalRadiusMeters: 100, maximumAccuracyMeters: 50, positionMaxAgeSeconds: 120 };
var fail = () => {
  throw Object.assign(Error("INVALID_EXCEPTION_SETTINGS"), { status: 400, code: "INVALID_EXCEPTION_SETTINGS" });
};
function validateExceptionSettings(v) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== Object.keys(EXCEPTION_SETTINGS_LIMITS).sort().join(",")) return fail();
  for (const [k, [min, max]] of Object.entries(EXCEPTION_SETTINGS_LIMITS)) if (!Number.isSafeInteger(v[k]) || v[k] < min || v[k] > max) return fail();
  if ((v.minimumContactAttempts - 1) * v.contactIntervalSeconds > v.waitSeconds || v.maximumAccuracyMeters > v.arrivalRadiusMeters) return fail();
  return { ...v };
}
async function readExceptionSettings(db) {
  const key = { pk: EXCEPTION_SETTINGS_PK, sk: "CURRENT" }, row = (await db.send(new import_lib_dynamodb.GetCommand({ TableName: "staging-PlatformStaff", Key: key, ConsistentRead: true }))).Item;
  if (!row || !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.policyVersion !== "string" || !row.policyVersion.length) throw Object.assign(Error("EXCEPTION_SETTINGS_UNAVAILABLE"), { code: "EXCEPTION_SETTINGS_UNAVAILABLE" });
  const values = validateExceptionSettings(row.values), body = { schemaVersion: 1, version: row.version, policyVersion: row.policyVersion, values };
  return { snapshot: { ...body, digest: quoteHash(body) }, condition: { ConditionCheck: { TableName: "staging-PlatformStaff", Key: key, ConditionExpression: "#v=:v AND #p=:p AND #values=:values", ExpressionAttributeNames: { "#v": "version", "#p": "policyVersion", "#values": "values" }, ExpressionAttributeValues: { ":v": row.version, ":p": row.policyVersion, ":values": values } } } };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXCEPTION_SETTINGS_DEFAULTS,
  EXCEPTION_SETTINGS_LIMITS,
  EXCEPTION_SETTINGS_PK,
  readExceptionSettings,
  validateExceptionSettings
});
