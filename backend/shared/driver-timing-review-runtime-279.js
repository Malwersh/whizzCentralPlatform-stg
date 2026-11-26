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

// backend/shared/driver-performance-timing-273.js
var require_driver_performance_timing_273 = __commonJS({
  "backend/shared/driver-performance-timing-273.js"(exports2, module2) {
    "use strict";
    var POLICY = "ORIGINAL_ACCEPTED_ROUTE_V1";
    var ms = (v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN;
    var id = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v);
    var iso = (n) => new Date(n).toISOString();
    function buildTimingPlan({ orderId, driverId, offerId, attempt, acceptedAt, pickupSeconds, deliverySeconds, estimatedReadyAt = null }) {
      const at = ms(acceptedAt), ready = estimatedReadyAt == null ? at : ms(estimatedReadyAt);
      if (![orderId, driverId, offerId].every(id) || !Number.isSafeInteger(at) || !Number.isSafeInteger(ready) || !Number.isSafeInteger(attempt) || attempt < 1 || ![pickupSeconds, deliverySeconds].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 86400)) throw Error("INVALID_PERFORMANCE_TIMING");
      const pickup = at + pickupSeconds * 1e3, delivery = Math.max(ready, pickup) + deliverySeconds * 1e3;
      return { schemaVersion: 1, kind: "DRIVER_ORIGINAL_TIMING_PLAN", policyVersion: POLICY, orderId, driverId, offerId, attempt, acceptedAt: iso(at), estimatedReadyAt: estimatedReadyAt == null ? null : iso(ready), pickupSeconds, deliverySeconds, pickupTargetAt: iso(pickup), customerTargetAt: iso(delivery), graceSeconds: 300, eventBasis: "SERVER_RECORDED_DRIVER_STATUS", affectsEligibility: false };
    }
    function classifyTiming2(offer, order, asOf) {
      const p = offer?.performanceTiming;
      if (!p) return { status: "EXCLUDED", reason: "ORIGINAL_TARGET_UNAVAILABLE" };
      let rebuilt;
      try {
        rebuilt = buildTimingPlan(p);
      } catch {
        return { status: "EXCLUDED", reason: "ORIGINAL_TARGET_INVALID" };
      }
      if (Object.keys(p).length !== Object.keys(rebuilt).length || Object.keys(rebuilt).some((k) => rebuilt[k] !== p[k]) || p.orderId !== offer.orderId || p.driverId !== offer.driverId || p.offerId !== offer.offerId || p.attempt !== offer.financialReceipt?.assignmentAttempt || ms(p.acceptedAt) !== ms(offer.financialReceipt?.acceptedAt)) return { status: "EXCLUDED", reason: "ORIGINAL_TARGET_INVALID" };
      if (!order || order.orderId !== p.orderId || order.driverId !== p.driverId || order.financialAcceptance?.offerId !== p.offerId || order.assignmentAttemptCounter !== p.attempt) return { status: "EXCLUDED", reason: "ASSIGNMENT_CHANGED" };
      if (!Number.isFinite(ms(asOf)) || ms(p.acceptedAt) > ms(asOf)) return { status: "EXCLUDED", reason: "INVALID_EVENT_SEQUENCE" };
      if (!["delivered", "completed"].includes(order.status)) return { status: ["cancelled", "canceled", "returned", "failed", "rejected"].includes(order.status) ? "EXCLUDED" : "IN_PROGRESS", reason: ["cancelled", "canceled", "returned", "failed", "rejected"].includes(order.status) ? "NOT_DELIVERED" : "AWAITING_COMPLETION" };
      if (order.walletFinancialStatus !== "SETTLED" || !order.financialOutcome) return { status: "REVIEW", reason: "COMPLETION_UNVERIFIED" };
      const arrival = ms(order.arrivedAtStoreAt), pickup = ms(order.pickedUpAt), customer = ms(order.arrivedAtCustomerAt), delivered = ms(order.deliveredAt), accepted = ms(p.acceptedAt);
      if (![arrival, pickup, customer, delivered].every(Number.isFinite)) return { status: "EXCLUDED", reason: "SERVER_EVENTS_INCOMPLETE" };
      if (!(accepted <= arrival && arrival <= pickup && pickup <= customer && customer <= delivered && delivered <= ms(asOf))) return { status: "REVIEW", reason: "INVALID_EVENT_SEQUENCE" };
      const pickupLate = arrival > ms(p.pickupTargetAt) + p.graceSeconds * 1e3;
      const customerLate = customer > ms(p.customerTargetAt) + p.graceSeconds * 1e3;
      const expectedPickup = Math.max(ms(p.pickupTargetAt), p.estimatedReadyAt == null ? accepted : ms(p.estimatedReadyAt));
      if (customerLate && pickup > expectedPickup + p.graceSeconds * 1e3) return { status: "REVIEW", reason: "PICKUP_DELAY_REQUIRES_REVIEW", pickupLate, customerLate };
      return { status: pickupLate || customerLate ? "LATE_OBSERVED" : "ON_TIME", reason: pickupLate ? "STORE_ARRIVAL_AFTER_TARGET" : customerLate ? "CUSTOMER_ARRIVAL_AFTER_TARGET" : "WITHIN_ORIGINAL_TARGETS", pickupLate, customerLate };
    }
    module2.exports = { POLICY, buildTimingPlan, classifyTiming: classifyTiming2 };
  }
});

// backend/shared/driver-timing-review.js
var require_driver_timing_review = __commonJS({
  "backend/shared/driver-timing-review.js"(exports2, module2) {
    "use strict";
    var { createHash: createHash2 } = require("node:crypto");
    var canonical = (v) => v && typeof v === "object" && !Array.isArray(v) ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : JSON.stringify(v);
    function sourceFingerprint2(offer, order) {
      return createHash2("sha256").update(canonical({
        plan: offer.performanceTiming,
        orderId: offer.orderId,
        driverId: offer.driverId,
        offerId: offer.offerId,
        attempt: offer.financialReceipt?.assignmentAttempt,
        status: order.status,
        walletFinancialStatus: order.walletFinancialStatus,
        financialOutcome: order.financialOutcome,
        arrivedAtStoreAt: order.arrivedAtStoreAt ?? null,
        pickedUpAt: order.pickedUpAt ?? null,
        arrivedAtCustomerAt: order.arrivedAtCustomerAt ?? null,
        deliveredAt: order.deliveredAt ?? null
      })).digest("hex");
    }
    var reviewable2 = (observation) => observation?.status === "LATE_OBSERVED" || observation?.status === "REVIEW" && observation.reason === "PICKUP_DELAY_REQUIRES_REVIEW";
    function applyTimingReview(observation, offer, order, review, event) {
      if (!review) return observation;
      const pending = (reason) => ({ ...observation, status: "REVIEW", reason });
      if (!order || review.kind !== "DRIVER_SERVICE_REVIEW" || review.schemaVersion !== 1 || review.dimension !== "TIMING" || review.orderId !== offer.orderId || review.driverId !== offer.driverId || review.offerId !== offer.offerId || review.attempt !== offer.financialReceipt?.assignmentAttempt || review.actorKind !== "STAFF" || review.sourceFingerprint !== sourceFingerprint2(offer, order)) return pending("TIMING_SOURCE_CHANGED");
      if ((review.appeals || []).some((a) => a.status === "OPEN")) return pending("TIMING_APPEAL_OPEN");
      const d = review.decision;
      if (!d || d.value === "PENDING_REVIEW") return pending("TIMING_REVIEW_PENDING");
      if (!event || event.kind !== "DRIVER_SERVICE_REVIEW_EVENT" || event.action !== "DECIDE_DRIVER_TIMING_REVIEW" || event.actorKind !== "STAFF" || event.schemaVersion !== 1 || event.orderId !== review.orderId || event.caseId !== review.caseId || event.recordId !== d.id || event.driverId !== review.driverId || event.offerId !== review.offerId || event.attempt !== review.attempt || event.sourceFingerprint !== review.sourceFingerprint || event.decision?.value !== d.value || event.decision?.id !== d.id || !reviewable2(observation)) return pending("TIMING_DECISION_UNVERIFIED");
      return d.value === "EXCUSED" ? { ...observation, status: "EXCLUDED", reason: "VERIFIED_DELAY_EXCUSED" } : d.value === "COUNT_LATE" ? { ...observation, status: "LATE_OBSERVED", reason: "REVIEW_CONFIRMED_LATE" } : pending("TIMING_DECISION_UNVERIFIED");
    }
    module2.exports = { sourceFingerprint: sourceFingerprint2, reviewable: reviewable2, applyTimingReview };
  }
});

// backend/wallet-service/src/driverTimingReview.ts
var driverTimingReview_exports = {};
__export(driverTimingReview_exports, {
  DRIVER_TIMING_ACTIONS: () => DRIVER_TIMING_ACTIONS,
  createDriverTimingReview: () => createDriverTimingReview
});
module.exports = __toCommonJS(driverTimingReview_exports);
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/driverFinancialTransaction.ts
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/deliveryQuoteRecord.ts
var import_node_crypto = require("node:crypto");

// backend/wallet-service/src/money.ts
var MAX = BigInt(Number.MAX_SAFE_INTEGER);

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

// backend/wallet-service/src/orderExceptionCaseIndex.ts
var CASE_OPEN_PARTITION = "ORDER_EXCEPTIONS_OPEN";
async function exceptionCaseIndexOperation(db, input) {
  const key = { operationId: "EXCEPTION_CASE#" + input.caseId }, old = await strongGet(db, "staging-WalletLifecycle", key);
  if (old && (old.kind !== "ORDER_EXCEPTION_CASE_POINTER" || old.orderId !== input.orderId || old.caseKey !== input.caseKey || old.caseId !== input.caseId || !Number.isSafeInteger(old.version))) throw Error("EXCEPTION_CASE_INDEX_CONFLICT");
  const item = { ...key, ...old ? { monitoringPhaseKey: old.monitoringPhaseKey, monitoringPhaseStartedAt: old.monitoringPhaseStartedAt, monitoringPriority: old.monitoringPriority, responseAlertAt: old.responseAlertAt, escalatedAt: old.escalatedAt, monitoringStatus: old.monitoringStatus } : {}, kind: "ORDER_EXCEPTION_CASE_POINTER", schemaVersion: 1, caseId: input.caseId, orderId: input.orderId, branchId: input.branchId, caseKey: input.caseKey, caseType: input.caseType, status: input.open ? "OPEN" : "CLOSED", caseState: input.state, version: (old?.version ?? 0) + 1, queuePartition: input.open ? CASE_OPEN_PARTITION : "ORDER_EXCEPTIONS_CLOSED", nextAttemptAt: Math.floor(Date.parse(input.dueAt ?? input.at) / 1e3), createdAt: old?.createdAt ?? input.at, updatedAt: input.at };
  if (!old) return { Put: { TableName: "staging-WalletLifecycle", Item: item, ConditionExpression: "attribute_not_exists(operationId)" } };
  const { Key: _key, ...condition } = exactCheck("staging-WalletLifecycle", key, old).ConditionCheck;
  return { Put: { ...condition, Item: item } };
}

// backend/wallet-service/src/driverTimingReview.ts
var { classifyTiming } = require_driver_performance_timing_273();
var { sourceFingerprint, reviewable } = require_driver_timing_review();
var DRIVER_TIMING_ACTIONS = ["READ_DRIVER_TIMING_REVIEW", "OPEN_DRIVER_TIMING_REVIEW", "ADD_DRIVER_TIMING_EVIDENCE", "DECIDE_DRIVER_TIMING_REVIEW", "OPEN_DRIVER_TIMING_APPEAL", "CLOSE_DRIVER_TIMING_APPEAL"];
var fail = (code = "DRIVER_TIMING_REVIEW_CONFLICT") => {
  throw Object.assign(Error(code), { code });
};
var uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
function createDriverTimingReview(options) {
  const { db, authority } = options, now = options.now ?? Date.now;
  return async (v) => {
    const read = v?.action === "READ_DRIVER_TIMING_REVIEW", open = v?.action === "OPEN_DRIVER_TIMING_REVIEW", evidence = v?.action === "ADD_DRIVER_TIMING_EVIDENCE", decide = v?.action === "DECIDE_DRIVER_TIMING_REVIEW", appeal = v?.action === "OPEN_DRIVER_TIMING_APPEAL", close = v?.action === "CLOSE_DRIVER_TIMING_APPEAL";
    const fields = ["action", "orderId", "attempt", ...!read ? ["reason", "idempotencyKey", "expectedVersion"] : [], ...!read && !open ? ["caseId"] : [], ...evidence ? ["reportedByParty", "reference"] : [], ...decide ? ["decision", "evidenceIds", "supersedesDecisionId"] : [], ...appeal ? ["reference"] : [], ...close ? ["appealId", "resolution", "evidenceIds"] : []];
    if (!v || !DRIVER_TIMING_ACTIONS.includes(v.action) || Object.keys(v).sort().join(",") !== fields.sort().join(",") || !quoteEntityIdValid(v.orderId) || !Number.isSafeInteger(v.attempt) || v.attempt < 1 || v.attempt >= 1e3 || !read && (!uuid(v.idempotencyKey) || !Number.isSafeInteger(v.expectedVersion) || v.expectedVersion < (open ? 0 : 1) || typeof v.reason !== "string" || v.reason.trim().length < 5 || v.reason.length > 1e3) || !read && !open && !uuid(v.caseId)) return fail("INVALID_DRIVER_TIMING_REVIEW");
    if (evidence && (!["DRIVER", "MERCHANT", "CUSTOMER", "PLATFORM", "EXTERNAL", "SYSTEM"].includes(v.reportedByParty) || typeof v.reference !== "string" || v.reference.trim().length < 3 || v.reference.length > 500) || appeal && (typeof v.reference !== "string" || v.reference.trim().length < 3 || v.reference.length > 500)) return fail("INVALID_DRIVER_TIMING_REVIEW");
    if (decide && (!["COUNT_LATE", "EXCUSED", "PENDING_REVIEW"].includes(v.decision) || v.supersedesDecisionId !== null && !uuid(v.supersedesDecisionId))) return fail("INVALID_DRIVER_TIMING_REVIEW");
    if ((decide || close) && (!Array.isArray(v.evidenceIds) || v.evidenceIds.length > 30 || new Set(v.evidenceIds).size !== v.evidenceIds.length || !v.evidenceIds.every(uuid))) return fail("INVALID_DRIVER_TIMING_REVIEW");
    if (close && (!uuid(v.appealId) || !["UPHELD", "REVISED"].includes(v.resolution))) return fail("INVALID_DRIVER_TIMING_REVIEW");
    const actor = await authority.authenticate();
    if (actor.kind !== "STAFF") return fail("UNAUTHORIZED");
    const access = read ? await authority.read(actor) : await authority.operate(actor);
    const ok = { PK: "ORDER#" + v.orderId, SK: "META" }, ck = { orderId: v.orderId, sk: "DRIVER_SERVICE#" + v.attempt };
    const order = await strongGet(db, "WizzOrders", ok), row = await strongGet(db, "staging-Holds", ck);
    if (!order || order.orderId !== v.orderId || order.deletedAt != null || order.deletionRequestId != null || order.isDeleted === true || order.assignmentAttemptCounter !== v.attempt || !quoteEntityIdValid(order.driverId) || !quoteEntityIdValid(order.financialAcceptance?.offerId) || !Number.isSafeInteger(order.assignmentWaveNumber) || !["delivered", "completed"].includes(order.status) || order.walletFinancialStatus !== "SETTLED" || !order.financialOutcome) return fail("DRIVER_TIMING_ATTEMPT_UNAVAILABLE");
    const fk = { orderId: v.orderId, SK: "FINANCIAL#" + order.driverId + "#WAVE#" + order.assignmentWaveNumber }, offer = await strongGet(db, "WaveOffers_staging", fk);
    if (!offer || offer.kind !== "FINANCIAL_DRIVER_OFFER" || offer.schemaVersion !== 2 || offer.orderId !== v.orderId || offer.driverId !== order.driverId || offer.offerId !== order.financialAcceptance.offerId || offer.responseStatus !== "financial_accepted" || offer.isWinner !== true || offer.financialReceipt?.success !== true || offer.financialReceipt.assignmentAttempt !== v.attempt || offer.financialReceipt.offerId !== offer.offerId || offer.financialReceipt.driverId !== offer.driverId || offer.financialReceipt.orderId !== offer.orderId) return fail("DRIVER_TIMING_ATTEMPT_UNAVAILABLE");
    const at = new Date(now()).toISOString(), observation = classifyTiming(offer, order, at), fingerprint = sourceFingerprint(offer, order);
    if (row && (row.kind !== "DRIVER_SERVICE_REVIEW" || row.schemaVersion !== 1 || row.dimension !== "TIMING" || row.orderId !== v.orderId || row.driverId !== order.driverId || row.offerId !== offer.offerId || row.attempt !== v.attempt || !uuid(row.caseId))) return fail();
    if (read) return { success: true, item: { orderId: v.orderId, orderNumber: order.orderNumber || v.orderId, branchName: order.storeName || order.restaurantName || "\u0627\u0644\u0645\u0637\u0639\u0645", driverName: order.driverName || "\u0627\u0644\u0633\u0627\u0626\u0642", attempt: v.attempt, observation, targets: offer.performanceTiming ?? null, reviewable: reviewable(observation), sourceChanged: !!row && row.sourceFingerprint !== fingerprint, review: row, financialPosting: false } };
    const ek = { orderId: v.orderId, sk: "SERVICE_REVIEW_EVENT#" + v.idempotencyKey }, digest = quoteHash({ ...v, actorId: actor.subjectId }), prior = await strongGet(db, "staging-Holds", ek);
    if (prior) {
      if (prior.requestDigest !== digest) return fail();
      return { ...prior.receipt, replayed: true };
    }
    if (!reviewable(observation) || row && row.sourceFingerprint !== fingerprint) return fail("DRIVER_TIMING_SOURCE_NOT_REVIEWABLE");
    if (open ? !!row || v.expectedVersion !== 0 : !row || row.version !== v.expectedVersion || row.caseId !== v.caseId) return fail();
    if ((row?.history || []).length >= 100 || (row?.evidence || []).length >= 30 && evidence) return fail("DRIVER_TIMING_REVIEW_LIMIT");
    const next = open ? { ...ck, kind: "DRIVER_SERVICE_REVIEW", schemaVersion: 1, dimension: "TIMING", caseId: v.idempotencyKey, orderId: v.orderId, driverId: order.driverId, offerId: offer.offerId, attempt: v.attempt, actorKind: "STAFF", ownerId: actor.subjectId, ownerLabel: access.employee?.name || access.employee?.fullName || "\u0641\u0631\u064A\u0642 \u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A", state: "OPEN", version: 1, sourceFingerprint: fingerprint, observation, createdAt: at, evidence: [], history: [], appeals: [] } : { ...row, version: row.version + 1 };
    const selected = decide || close ? next.evidence.filter((e) => v.evidenceIds.includes(e.id)) : [];
    if ((decide || close) && selected.length !== v.evidenceIds.length) return fail("EXCEPTION_EVIDENCE_REQUIRED");
    const independent = new Set(selected.map((e) => e.party)).size;
    if (evidence) next.evidence = [...next.evidence, { id: v.idempotencyKey, party: v.reportedByParty, reference: v.reference.trim(), note: v.reason.trim(), actorId: actor.subjectId, createdAt: at, classification: "REPORTED_AS_RECEIVED", doesNotEstablishResponsibility: true }];
    if (decide) {
      if ((next.decision?.id ?? null) !== v.supersedesDecisionId) return fail();
      if (v.decision !== "PENDING_REVIEW" && !selected.length) return fail("EXCEPTION_EVIDENCE_REQUIRED");
      if (v.decision === "COUNT_LATE" && independent < 2) return fail("INDEPENDENT_EVIDENCE_REQUIRED");
      if (v.decision === "COUNT_LATE" && next.appeals.some((a) => a.status === "OPEN")) return fail("DRIVER_TIMING_APPEAL_OPEN");
      next.decision = { id: v.idempotencyKey, value: v.decision, evidenceIds: v.evidenceIds, reason: v.reason.trim(), actorId: actor.subjectId, createdAt: at, supersedesDecisionId: v.supersedesDecisionId };
    }
    if (appeal) {
      if (!next.decision || next.decision.value === "PENDING_REVIEW" || next.appeals.some((a) => a.status === "OPEN")) return fail("DRIVER_TIMING_APPEAL_CONFLICT");
      next.appeals = [...next.appeals, { id: v.idempotencyKey, status: "OPEN", againstDecisionId: next.decision.id, reference: v.reference.trim(), reason: v.reason.trim(), createdAt: at, recordedBy: actor.subjectId, reportedByParty: "DRIVER" }];
    }
    if (close) {
      const a = next.appeals.find((a2) => a2.id === v.appealId && a2.status === "OPEN");
      if (!a || !selected.length) return fail("DRIVER_TIMING_APPEAL_CONFLICT");
      if (v.resolution === "UPHELD" && (next.decision?.id !== a.againstDecisionId || next.decision.value === "COUNT_LATE" && independent < 2)) return fail("INDEPENDENT_EVIDENCE_REQUIRED");
      if (v.resolution === "REVISED" && (next.decision?.id === a.againstDecisionId || !["EXCUSED", "PENDING_REVIEW"].includes(next.decision?.value))) return fail("DRIVER_TIMING_APPEAL_CONFLICT");
      next.appeals = next.appeals.map((a2) => a2.id === v.appealId ? { ...a2, status: "CLOSED", resolution: v.resolution, resolvedAt: at, reason: v.reason.trim(), evidenceIds: v.evidenceIds, resolvedBy: actor.subjectId } : a2);
    }
    next.state = next.appeals.some((a) => a.status === "OPEN") ? "APPEAL_OPEN" : next.decision && next.decision.value !== "PENDING_REVIEW" ? "RESOLVED" : "OPEN";
    next.updatedAt = at;
    next.history = [...next.history, { id: v.idempotencyKey, action: v.action, reason: v.reason.trim(), createdAt: at, actorId: actor.subjectId, decision: next.decision?.value ?? null }];
    if (Buffer.byteLength(JSON.stringify(next)) > 28e4) return fail("DRIVER_TIMING_REVIEW_LIMIT");
    const receipt = { success: true, caseId: next.caseId, caseKey: ck.sk, version: next.version, action: v.action, financialPosting: false };
    const event = { ...ek, kind: "DRIVER_SERVICE_REVIEW_EVENT", schemaVersion: 1, recordId: v.idempotencyKey, caseId: next.caseId, orderId: v.orderId, driverId: next.driverId, offerId: next.offerId, attempt: next.attempt, sourceFingerprint: fingerprint, action: v.action, actorKind: "STAFF", actorId: actor.subjectId, requestDigest: digest, createdAt: at, reason: v.reason.trim(), ...decide ? { decision: next.decision } : {}, receipt, financialPosting: false };
    const fence = row ? exactCheck("staging-Holds", ck, row).ConditionCheck : { TableName: "staging-Holds", Key: ck, ConditionExpression: "attribute_not_exists(orderId)" };
    const { Key: _key, ...putFence } = fence;
    const index = await exceptionCaseIndexOperation(db, { caseId: next.caseId, orderId: v.orderId, caseKey: ck.sk, caseType: "DRIVER_TIMING_REVIEW", state: next.state, open: next.state !== "RESOLVED", at, branchId: order.storeId });
    const ops = [access.guard, exactCheck("WizzOrders", ok, order), exactCheck("WaveOffers_staging", fk, offer), { ConditionCheck: { TableName: "staging-AccountDeletion", Key: { pk: "ACCOUNT_LIFECYCLE#DRIVER#" + order.driverId, sk: "META" }, ConditionExpression: "attribute_not_exists(pk)" } }, index, { Put: { ...putFence, Item: next } }, { Put: { TableName: "staging-Holds", Item: event, ConditionExpression: "attribute_not_exists(orderId)" } }, { Put: { TableName: "staging-AuditLog", Item: { datePartition: "date#" + at.slice(0, 10).replace(/-/g, ""), sk: at + "#" + v.idempotencyKey, logId: v.idempotencyKey, action: v.action, caseId: next.caseId, orderId: v.orderId, actorKind: "STAFF", actorId: actor.subjectId, createdAt: at, financialPosting: false }, ConditionExpression: "attribute_not_exists(sk)" } }];
    if (!equal(actor, await authority.authenticate())) return fail("UNAUTHORIZED");
    try {
      await db.send(new import_lib_dynamodb2.TransactWriteCommand({ TransactItems: ops }));
    } catch (error) {
      const saved = await strongGet(db, "staging-Holds", ek);
      if (saved?.requestDigest === digest) return { ...saved.receipt, replayed: true };
      throw error;
    }
    return receipt;
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DRIVER_TIMING_ACTIONS,
  createDriverTimingReview
});
