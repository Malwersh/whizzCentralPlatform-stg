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

// backend/wallet-service/src/exceptionCasePolicy.ts
var exceptionCasePolicy_exports = {};
__export(exceptionCasePolicy_exports, {
  CASE_POLICY_DEFAULTS: () => CASE_POLICY_DEFAULTS,
  CASE_POLICY_PK: () => CASE_POLICY_PK,
  CASE_PRIORITIES: () => CASE_PRIORITIES,
  casePhase: () => casePhase,
  readExceptionCasePolicy: () => readExceptionCasePolicy,
  validateExceptionCasePolicy: () => validateExceptionCasePolicy
});
module.exports = __toCommonJS(exceptionCasePolicy_exports);
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

// backend/wallet-service/src/exceptionCasePolicy.ts
var CASE_POLICY_PK = "OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES";
var CASE_PRIORITIES = ["SAFETY", "CUSTODY", "COD", "FINANCIAL", "STANDARD"];
var CASE_POLICY_DEFAULTS = { sla: { SAFETY: { responseSeconds: 60, escalationSeconds: 300 }, CUSTODY: { responseSeconds: 180, escalationSeconds: 600 }, COD: { responseSeconds: 300, escalationSeconds: 900 }, FINANCIAL: { responseSeconds: 14400, escalationSeconds: 86400 }, STANDARD: { responseSeconds: 86400, escalationSeconds: 172800 } }, postDeliveryClaimSeconds: 86400, appealSeconds: 259200, lateSafetyAndCashReviewAllowed: true };
var bad = () => {
  throw Object.assign(Error("INVALID_EXCEPTION_CASE_POLICY"), { code: "INVALID_EXCEPTION_CASE_POLICY", status: 400 });
};
function validateExceptionCasePolicy(v) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== "appealSeconds,lateSafetyAndCashReviewAllowed,postDeliveryClaimSeconds,sla" || v.lateSafetyAndCashReviewAllowed !== true || !v.sla || Object.keys(v.sla).sort().join(",") !== [...CASE_PRIORITIES].sort().join(",")) return bad();
  for (const p of CASE_PRIORITIES) {
    const r = v.sla[p];
    if (!r || typeof r !== "object" || Object.keys(r).sort().join(",") !== "escalationSeconds,responseSeconds" || !Number.isSafeInteger(r.responseSeconds) || !Number.isSafeInteger(r.escalationSeconds) || r.responseSeconds < 30 || r.escalationSeconds < r.responseSeconds || r.escalationSeconds > 2592e3) return bad();
  }
  for (const key of ["postDeliveryClaimSeconds", "appealSeconds"]) if (!Number.isSafeInteger(v[key]) || v[key] < 3600 || v[key] > 31536e3) return bad();
  return JSON.parse(JSON.stringify(v));
}
async function readExceptionCasePolicy(db) {
  const key = { pk: CASE_POLICY_PK, sk: "CURRENT" }, row = (await db.send(new import_lib_dynamodb.GetCommand({ TableName: "staging-PlatformStaff", Key: key, ConsistentRead: true }))).Item;
  if (!row || !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.policyVersion !== "string") throw Object.assign(Error("EXCEPTION_CASE_POLICY_UNAVAILABLE"), { code: "EXCEPTION_CASE_POLICY_UNAVAILABLE" });
  const values = validateExceptionCasePolicy(row.values), body = { schemaVersion: 1, version: row.version, policyVersion: row.policyVersion, values };
  return { snapshot: { ...body, digest: quoteHash(body) }, condition: { ConditionCheck: { TableName: "staging-PlatformStaff", Key: key, ConditionExpression: "#v=:v AND #p=:p AND #values=:values", ExpressionAttributeNames: { "#v": "version", "#p": "policyVersion", "#values": "values" }, ExpressionAttributeValues: { ":v": row.version, ":p": row.policyVersion, ":values": values } } } };
}
function casePhase(snapshot, priority, at) {
  const { digest, ...body } = snapshot ?? {};
  if (body.schemaVersion !== 1 || digest !== quoteHash(body)) return bad();
  const values = validateExceptionCasePolicy(snapshot.values), rule = values.sla[priority], t = Date.parse(at);
  if (!rule || !Number.isFinite(t)) return bad();
  return { priority, startedAt: at, responseDueAt: new Date(t + rule.responseSeconds * 1e3).toISOString(), escalationDueAt: new Date(t + rule.escalationSeconds * 1e3).toISOString(), policyVersion: snapshot.policyVersion };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CASE_POLICY_DEFAULTS,
  CASE_POLICY_PK,
  CASE_PRIORITIES,
  casePhase,
  readExceptionCasePolicy,
  validateExceptionCasePolicy
});
