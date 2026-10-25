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

// backend/wallet-service/src/driverPerformanceDecision.ts
var driverPerformanceDecision_exports = {};
__export(driverPerformanceDecision_exports, {
  createDriverPerformanceDecision: () => createDriverPerformanceDecision
});
module.exports = __toCommonJS(driverPerformanceDecision_exports);
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/driverFinancialTransaction.ts
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
function moneyFromMinor(minorAmount) {
  return Object.freeze({ currency: "IQD", scale: 1e3, moneySchemaVersion: 1, minorAmount: integer(minorAmount) === 0 ? 0 : minorAmount });
}

// backend/wallet-service/src/deliveryQuoteRecord.ts
var quoteEntityIdValid = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,150}$/.test(v);
function quoteCanonical(v) {
  return Array.isArray(v) ? "[" + v.map(quoteCanonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + quoteCanonical(v[k])).join(",") + "}" : JSON.stringify(v);
}
var quoteHash = (v) => (0, import_node_crypto.createHash)("sha256").update(quoteCanonical(v)).digest("hex");

// backend/wallet-service/src/driverFinancialTransaction.ts
var equal = (a, b) => quoteCanonical(a) === quoteCanonical(b);
async function strongGet(db, TableName, Key) {
  return structuredClone((await db.send(new import_lib_dynamodb.GetCommand({ TableName, Key, ConsistentRead: true }))).Item ?? null);
}
function exactCheck(TableName, Key, saved, fields = Object.keys(saved)) {
  const names = {}, values = {}, conditions = [];
  fields.forEach((field, i) => {
    names["#f" + i] = field;
    if (saved[field] === void 0) conditions.push(`attribute_not_exists(#f${i})`);
    else {
      values[":v" + i] = structuredClone(saved[field]);
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

// backend/wallet-service/src/orderExceptionPolicy.ts
var fail = () => {
  throw Object.assign(Error("ORDER_EXCEPTION_POLICY_INVALID"), { code: "ORDER_EXCEPTION_POLICY_INVALID" });
};
var EXCEPTION_POLICY_VERSION = "OECSR_STAGING_COD_V1";
var rules = {
  payments: "COD_ONLY",
  returnExtraFeeEnabled: false,
  returnExtraFee: moneyFromMinor(0),
  originalFareAfterVerifiedAttempt: "FULL_WITHOUT_UNCOLLECTED_TIP",
  prePickupAutomaticFare: false,
  incidentBeforeAttempt: "MANUAL_REVIEW",
  merchantCompensation: "AGREEMENT_AND_EVIDENCE",
  allegedReasonDeterminesLiability: false,
  autoDisposition: false,
  autoDriverFare: false,
  autoMerchantCompensation: false,
  autoCustomerCashRefund: false,
  driverSelfDisposal: false,
  contactWaitSeconds: 600,
  minimumContactAttempts: 3,
  claimWindowSeconds: null,
  appealWindowSeconds: null
};
function freeze(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function createOrderExceptionPolicy(at) {
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) return fail();
  const body = { schemaVersion: 1, version: EXCEPTION_POLICY_VERSION, market: "STAGING", effectiveForOrderCreatedAt: at, rules };
  return freeze(JSON.parse(JSON.stringify({ ...body, digest: quoteHash(body) })));
}
function readOrderExceptionPolicy(order) {
  if (order.exceptionPolicy === void 0) return null;
  const expected = createOrderExceptionPolicy(order.createdAt);
  if (quoteCanonical(order.exceptionPolicy) !== quoteCanonical(expected) || !["cash", "cod"].includes(String(order.paymentMethod).toLowerCase())) return fail();
  return expected;
}

// backend/wallet-service/src/driverPerformanceDecision.ts
var evidenceIdValid = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,199}$/.test(v);
var fail2 = (code = "DRIVER_PERFORMANCE_DECISION_CONFLICT") => {
  throw Object.assign(Error(code), { code });
};
function createDriverPerformanceDecision(options) {
  const { db, authority } = options, now = options.now ?? Date.now;
  return async (v) => {
    const fields = ["orderId", "caseKey", "caseId", "expectedVersion", "action", "reason", "idempotencyKey", "decision", "evidenceIds", "supersedesDecisionId", "offerId", "attempt"];
    if (!v || Object.keys(v).sort().join(",") !== fields.sort().join(",") || v.action !== "SET_DRIVER_PERFORMANCE" || ![v.orderId, v.caseId, v.offerId].every(quoteEntityIdValid) || !["CUSTOMER_CANCELLATION", "MERCHANT_CANCELLATION"].includes(v.caseKey) && !/^RETURN#[1-9][0-9]{0,2}$/.test(v.caseKey) || !Number.isSafeInteger(v.expectedVersion) || v.expectedVersion < 1 || !Number.isSafeInteger(v.attempt) || v.attempt < 1 || v.attempt >= 1e3 || !["COUNT_FAILURE", "EXCUSED", "PENDING_REVIEW"].includes(v.decision) || typeof v.reason !== "string" || v.reason.trim().length < 5 || v.reason.length > 2e3 || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.idempotencyKey || "") || v.supersedesDecisionId !== null && !quoteEntityIdValid(v.supersedesDecisionId) || !Array.isArray(v.evidenceIds) || v.evidenceIds.length > 20 || new Set(v.evidenceIds).size !== v.evidenceIds.length || !v.evidenceIds.every(evidenceIdValid) || v.decision !== "PENDING_REVIEW" && !v.evidenceIds.length) return fail2("INVALID_DRIVER_PERFORMANCE_DECISION");
    const actor = await authority.authenticate();
    if (actor.kind !== "STAFF") return fail2("UNAUTHORIZED");
    const access = await authority.operate(actor);
    const ok = { PK: "ORDER#" + v.orderId, SK: "META" }, ck = { orderId: v.orderId, sk: v.caseKey }, ek = { orderId: v.orderId, sk: "PERFORMANCE_DECISION#" + v.idempotencyKey };
    const order = await strongGet(db, "WizzOrders", ok), row = await strongGet(db, "staging-Holds", ck);
    if (!order || order.orderId !== v.orderId || !readOrderExceptionPolicy(order) || order.isDeleted === true || order.deletedAt != null || order.deletionRequestId != null || !row || (row.caseId ?? row.exceptionResolution?.caseId) !== v.caseId || ["DECLINED", "SUPERSEDED"].includes(row.state)) return fail2("EXCEPTION_CASE_UNAVAILABLE");
    if (v.decision === "COUNT_FAILURE" && (row.appealReviewRequired || (row.caseAppeals ?? []).some((a) => a.status === "OPEN"))) return fail2("DRIVER_PERFORMANCE_APPEAL_OPEN");
    const digest = quoteHash({ ...v, actorId: actor.subjectId }), prior = await strongGet(db, "staging-Holds", ek);
    if (prior) {
      if (prior.requestDigest !== digest) return fail2();
      return { ...prior.receipt, replayed: true };
    }
    if (row.version !== v.expectedVersion) return fail2();
    const ak = { orderId: v.orderId, sk: "ASSIGNMENT_RELEASE#" + v.attempt }, archive = await strongGet(db, "staging-Holds", ak), guards = [];
    let driverId;
    if (archive) {
      if (archive.kind !== "COD_ASSIGNMENT_RELEASE" || archive.orderId !== v.orderId || archive.offerId !== v.offerId || archive.attempt !== v.attempt || !["UNASSIGNED", "CANCELLED"].includes(archive.outcome) || archive.receipt?.success !== true || archive.receipt.orderId !== v.orderId) return fail2("DRIVER_PERFORMANCE_ATTEMPT_UNAVAILABLE");
      driverId = archive.driverId;
      guards.push(exactCheck("staging-Holds", ak, archive));
    } else {
      if (order.financialAcceptance?.offerId !== v.offerId || order.assignmentAttemptCounter !== v.attempt || !["cancelled", "canceled", "returned"].includes(order.status) || order.status === "returned" && v.decision === "COUNT_FAILURE") return fail2("DRIVER_PERFORMANCE_ATTEMPT_UNAVAILABLE");
      driverId = order.driverId;
      guards.push({ ConditionCheck: { TableName: "staging-Holds", Key: ak, ConditionExpression: "attribute_not_exists(orderId)" } });
    }
    if (!quoteEntityIdValid(driverId)) return fail2("DRIVER_PERFORMANCE_ATTEMPT_UNAVAILABLE");
    const pk = { orderId: v.orderId, sk: "DRIVER_PERFORMANCE#" + driverId + "#" + v.attempt }, current = await strongGet(db, "staging-Holds", pk);
    if ((current?.decisionId ?? null) !== v.supersedesDecisionId || current && (current.driverId !== driverId || current.offerId !== v.offerId || current.caseId !== v.caseId || !Number.isSafeInteger(current.version) || current.version < 1)) return fail2();
    const sources = /* @__PURE__ */ new Set();
    for (const evidenceId of v.evidenceIds) {
      const key = { orderId: v.orderId, sk: "CASE_EVIDENCE#" + evidenceId }, evidence = await strongGet(db, "staging-Holds", key);
      if (!evidence || evidence.kind !== "ORDER_EXCEPTION_EVIDENCE" || evidence.caseId !== v.caseId || evidence.evidenceId !== evidenceId) return fail2("EXCEPTION_EVIDENCE_REQUIRED");
      guards.push(exactCheck("staging-Holds", key, evidence));
      const source = evidence.type === "SUPPORT_RECORD" ? evidence.proof?.reportedByParty : { DRIVER: "DRIVER", MERCHANT_OWNER: "MERCHANT", CUSTOMER: "CUSTOMER", SYSTEM: "SYSTEM" }[evidence.actorKind];
      if (["DRIVER", "MERCHANT", "CUSTOMER", "PLATFORM", "SYSTEM", "EXTERNAL"].includes(source)) sources.add(source);
    }
    if (v.decision === "COUNT_FAILURE" && sources.size < 2) return fail2("INDEPENDENT_EVIDENCE_REQUIRED");
    if ((row.performanceDecisionIds ?? []).length >= 100) return fail2("EXCEPTION_CASE_EVIDENCE_LIMIT");
    const at = new Date(now()).toISOString(), receipt = { success: true, action: v.action, orderId: v.orderId, caseId: v.caseId, version: row.version + 1, decisionId: v.idempotencyKey, decision: v.decision, financialPosting: false };
    const decision = { ...pk, kind: "DRIVER_PERFORMANCE_DECISION", action: "SET_DRIVER_PERFORMANCE", schemaVersion: 1, caseId: v.caseId, caseKey: v.caseKey, driverId, offerId: v.offerId, attempt: v.attempt, decisionId: v.idempotencyKey, decision: v.decision, evidenceIds: v.evidenceIds, reason: v.reason.trim(), actorId: actor.subjectId, actorKind: "STAFF", createdAt: at, version: (current?.version ?? 0) + 1, supersedesDecisionId: v.supersedesDecisionId, requestDigest: digest, financialPosting: false, receipt };
    const summaries = (row.driverPerformanceDecisions ?? []).filter((x) => !(x.driverId === driverId && x.attempt === v.attempt));
    const next = { ...row, version: row.version + 1, updatedAt: at, performanceDecisionIds: [...row.performanceDecisionIds ?? [], v.idempotencyKey], driverPerformanceDecisions: [...summaries, { driverId, offerId: v.offerId, attempt: v.attempt, decision: v.decision, decisionId: v.idempotencyKey, reason: v.reason.trim(), createdAt: at }] };
    const { Key: _k, ...caseFence } = exactCheck("staging-Holds", ck, row).ConditionCheck, { Key: _p, ...pointerFence } = current ? exactCheck("staging-Holds", pk, current).ConditionCheck : { TableName: "staging-Holds", Key: pk, ConditionExpression: "attribute_not_exists(orderId)" };
    const ops = [access.guard, exactCheck("WizzOrders", ok, order), ...guards, { ConditionCheck: { TableName: "staging-AccountDeletion", Key: { pk: "ACCOUNT_LIFECYCLE#DRIVER#" + driverId, sk: "META" }, ConditionExpression: "attribute_not_exists(pk)" } }, { Put: { ...caseFence, Item: next } }, { Put: { ...pointerFence, Item: decision } }, { Put: { TableName: "staging-Holds", Item: { ...decision, ...ek, kind: "DRIVER_PERFORMANCE_DECISION_EVENT" }, ConditionExpression: "attribute_not_exists(orderId)" } }, { Put: { TableName: "staging-AuditLog", Item: { datePartition: "date#" + at.slice(0, 10).replace(/-/g, ""), sk: at + "#" + v.idempotencyKey, logId: v.idempotencyKey, action: v.action, orderId: v.orderId, caseId: v.caseId, driverId, actorId: actor.subjectId, decisionId: v.idempotencyKey, decision: v.decision, reason: v.reason.trim(), createdAt: at, financialPosting: false }, ConditionExpression: "attribute_not_exists(sk)" } }];
    if (!equal(actor, await authority.authenticate())) return fail2("UNAUTHORIZED");
    try {
      await db.send(new import_lib_dynamodb2.TransactWriteCommand({ TransactItems: ops }));
    } catch (e) {
      const saved = await strongGet(db, "staging-Holds", ek);
      if (saved?.requestDigest === digest) return { ...saved.receipt, replayed: true };
      throw e;
    }
    return receipt;
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createDriverPerformanceDecision
});
