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

// backend/wallet-service/src/returnOperationsPolicy.ts
var returnOperationsPolicy_exports = {};
__export(returnOperationsPolicy_exports, {
  RETURN_OPERATIONS_DEFAULTS: () => RETURN_OPERATIONS_DEFAULTS,
  RETURN_OPERATIONS_PK: () => RETURN_OPERATIONS_PK,
  branchClosingAt: () => branchClosingAt,
  readReturnOperations: () => readReturnOperations,
  validateReturnOperations: () => validateReturnOperations
});
module.exports = __toCommonJS(returnOperationsPolicy_exports);

// backend/wallet-service/src/driverFinancialTransaction.ts
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

// backend/wallet-service/src/driverFinancialTransaction.ts
var detach = (v) => JSON.parse(JSON.stringify(v));
async function strongGet(db, TableName, Key) {
  return detach((await db.send(new import_lib_dynamodb.GetCommand({ TableName, Key, ConsistentRead: true }))).Item ?? null);
}
function exactCheck(TableName, Key, saved, fields = Object.keys(saved)) {
  const names = {}, values = {}, conditions = [];
  fields.forEach((field, i) => {
    names["#f" + i] = field;
    if (saved[field] === void 0) conditions.push(`attribute_not_exists(#f${i})`);
    else {
      values[":v" + i] = detach(saved[field]);
      conditions.push(`#f${i}=:v${i}`);
    }
  });
  return { ConditionCheck: {
    TableName,
    Key,
    ConditionExpression: conditions.join(" AND "),
    ExpressionAttributeNames: names,
    ...Object.keys(values).length ? { ExpressionAttributeValues: values } : {}
  } };
}

// backend/wallet-service/src/returnOperationsPolicy.ts
var RETURN_OPERATIONS_PK = "OPERATIONAL_SETTINGS#RETURN_OPERATIONS";
var RETURN_OPERATIONS_DEFAULTS = { enabled: true, closingMarginSeconds: 900, branchWaitSeconds: 300 };
function validateReturnOperations(v) {
  if (!v || Object.keys(v).sort().join(",") !== "branchWaitSeconds,closingMarginSeconds,enabled" || typeof v.enabled !== "boolean" || !Number.isSafeInteger(v.closingMarginSeconds) || v.closingMarginSeconds < 300 || v.closingMarginSeconds > 3600 || !Number.isSafeInteger(v.branchWaitSeconds) || v.branchWaitSeconds < 60 || v.branchWaitSeconds > 1800) throw Object.assign(Error("INVALID_RETURN_OPERATIONS"), { code: "INVALID_RETURN_OPERATIONS", status: 400 });
  return { ...v };
}
async function readReturnOperations(db) {
  const key = { pk: RETURN_OPERATIONS_PK, sk: "CURRENT" }, row = await strongGet(db, "staging-PlatformStaff", key);
  if (!row || !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.policyVersion !== "string") throw Object.assign(Error("RETURN_OPERATIONS_UNAVAILABLE"), { code: "RETURN_OPERATIONS_UNAVAILABLE" });
  const body = { schemaVersion: 1, version: row.version, policyVersion: row.policyVersion, values: validateReturnOperations(row.values) };
  return { snapshot: { ...body, digest: quoteHash(body) }, condition: exactCheck("staging-PlatformStaff", key, row) };
}
function branchClosingAt(hours, at) {
  if (!Array.isArray(hours) || hours.length !== 7 || new Set(hours.map((x) => Number(x.day))).size !== 7) return null;
  const minute = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null;
  const local = new Date(at + 108e5), midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 108e5, day = local.getUTCDay(), intervals = [];
  for (const offset of [-1, 0]) {
    const h = hours.find((x) => Number(x.day) === (day + offset + 7) % 7);
    if (!h || typeof h.closed !== "boolean" || !Array.isArray(h.periods) || h.periods.length > 4) return null;
    if (h.closed) continue;
    for (const p of h.periods) {
      const a = minute(p.open), b = minute(p.close);
      if (a == null || b == null || a === b) return null;
      const start = midnight + offset * 864e5 + a * 6e4, end = midnight + offset * 864e5 + b * 6e4 + (b < a ? 864e5 : 0);
      if (at >= start && at < end) intervals.push([start, end]);
    }
  }
  return intervals.length === 1 ? intervals[0][1] : null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RETURN_OPERATIONS_DEFAULTS,
  RETURN_OPERATIONS_PK,
  branchClosingAt,
  readReturnOperations,
  validateReturnOperations
});
