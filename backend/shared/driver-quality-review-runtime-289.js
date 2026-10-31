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

// backend/wallet-service/src/driverQualityReview.ts
var driverQualityReview_exports = {};
__export(driverQualityReview_exports, {
  DRIVER_QUALITY_ACTIONS: () => DRIVER_QUALITY_ACTIONS,
  createDriverQualityReview: () => createDriverQualityReview
});
module.exports = __toCommonJS(driverQualityReview_exports);
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

// backend/wallet-service/src/driverQualityReview.ts
var DRIVER_QUALITY_ACTIONS = ["READ_DRIVER_QUALITY_REVIEW", "OPEN_DRIVER_QUALITY_REVIEW", "ADD_DRIVER_QUALITY_EVIDENCE", "DECIDE_DRIVER_QUALITY_REVIEW", "OPEN_DRIVER_QUALITY_APPEAL", "CLOSE_DRIVER_QUALITY_APPEAL"];
var fail = (code = "DRIVER_QUALITY_REVIEW_CONFLICT") => {
  throw Object.assign(Error(code), { code });
};
var uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
function createDriverQualityReview(options) {
  const { db, authority } = options, now = options.now ?? Date.now;
  return async (v) => {
    const read = v?.action === "READ_DRIVER_QUALITY_REVIEW", open = v?.action === "OPEN_DRIVER_QUALITY_REVIEW", evidence = v?.action === "ADD_DRIVER_QUALITY_EVIDENCE", decide = v?.action === "DECIDE_DRIVER_QUALITY_REVIEW", appeal = v?.action === "OPEN_DRIVER_QUALITY_APPEAL", close = v?.action === "CLOSE_DRIVER_QUALITY_APPEAL";
    const fields = ["action", "orderId", "attempt", "incidentId", ...open ? ["category", "severity"] : [], ...!read ? ["reason", "idempotencyKey", "expectedVersion"] : [], ...!read && !open ? ["caseId"] : [], ...evidence ? ["reportedByParty", "reference"] : [], ...decide ? ["decision", "evidenceIds", "supersedesDecisionId"] : [], ...appeal ? ["reference"] : [], ...close ? ["appealId", "resolution", "evidenceIds"] : []];
    if (!v || !DRIVER_QUALITY_ACTIONS.includes(v.action) || Object.keys(v).sort().join(",") !== fields.sort().join(",") || !quoteEntityIdValid(v.orderId) || !uuid(v.incidentId) || !Number.isSafeInteger(v.attempt) || v.attempt < 1 || v.attempt >= 1e3 || !read && (!uuid(v.idempotencyKey) || !Number.isSafeInteger(v.expectedVersion) || v.expectedVersion < (open ? 0 : 1) || typeof v.reason !== "string" || v.reason.trim().length < 5 || v.reason.length > 1e3) || !read && !open && !uuid(v.caseId)) return fail("INVALID_DRIVER_QUALITY_REVIEW");
    if (open && (!["ORDER_DAMAGE", "MISSING_ITEMS", "CONDUCT", "ROAD_SAFETY", "PERSONAL_SAFETY", "OTHER"].includes(v.category) || !["NORMAL", "HIGH", "URGENT"].includes(v.severity))) return fail("INVALID_DRIVER_QUALITY_REVIEW");
    if (evidence && (!["DRIVER", "MERCHANT", "CUSTOMER", "PLATFORM", "EXTERNAL", "SYSTEM"].includes(v.reportedByParty) || typeof v.reference !== "string" || v.reference.trim().length < 3 || v.reference.length > 500) || appeal && (typeof v.reference !== "string" || v.reference.trim().length < 3 || v.reference.length > 500)) return fail("INVALID_DRIVER_QUALITY_REVIEW");
    if (decide && (!["SUBSTANTIATED", "NOT_SUBSTANTIATED", "PENDING_REVIEW"].includes(v.decision) || v.supersedesDecisionId !== null && !uuid(v.supersedesDecisionId))) return fail("INVALID_DRIVER_QUALITY_REVIEW");
    if ((decide || close) && (!Array.isArray(v.evidenceIds) || v.evidenceIds.length > 30 || new Set(v.evidenceIds).size !== v.evidenceIds.length || !v.evidenceIds.every(uuid))) return fail("INVALID_DRIVER_QUALITY_REVIEW");
    if (close && (!uuid(v.appealId) || !["UPHELD", "REVISED"].includes(v.resolution))) return fail("INVALID_DRIVER_QUALITY_REVIEW");
    const actor = await authority.authenticate();
    if (actor.kind !== "STAFF") return fail("UNAUTHORIZED");
    const access = read ? await authority.read(actor) : await authority.operate(actor);
    const ok = { PK: "ORDER#" + v.orderId, SK: "META" }, ck = { orderId: v.orderId, sk: "DRIVER_QUALITY#" + v.incidentId };
    const order = await strongGet(db, "WizzOrders", ok), row = await strongGet(db, "staging-Holds", ck);
    if (!order || order.orderId !== v.orderId || order.deletedAt != null || order.deletionRequestId != null || order.isDeleted === true) return fail("DRIVER_QUALITY_ATTEMPT_UNAVAILABLE");
    const current = order.assignmentAttemptCounter === v.attempt && quoteEntityIdValid(order.driverId) && quoteEntityIdValid(order.financialAcceptance?.offerId) && Number.isSafeInteger(order.assignmentWaveNumber);
    const archiveKey = { orderId: v.orderId, sk: "ASSIGNMENT_RELEASE#" + v.attempt };
    let archive = null, historical = null;
    if (!row && !current) {
      archive = await strongGet(db, "staging-Holds", archiveKey);
      if (!archive || archive.kind !== "COD_ASSIGNMENT_RELEASE" || archive.orderId !== v.orderId || archive.attempt !== v.attempt || !quoteEntityIdValid(archive.driverId) || !quoteEntityIdValid(archive.offerId) || archive.acceptedTerms?.offerId !== archive.offerId || archive.receipt?.success !== true || archive.receipt.orderId !== v.orderId || archive.receipt.offerId !== archive.offerId || archive.receipt.attempt !== v.attempt) return fail("DRIVER_QUALITY_ATTEMPT_UNAVAILABLE");
      const archivedEvent = await strongGet(db, "staging-WalletLifecycle", { operationId: archive.operationId + ":EVENT" });
      if (!archivedEvent || archivedEvent.integrationSchemaVersion !== 1 || !["COD_UNASSIGN_OUTBOX", "COD_CANCEL_OUTBOX"].includes(archivedEvent.kind) || archivedEvent.financialOperationId !== archive.operationId || archivedEvent.orderId !== v.orderId || archivedEvent.driverId !== archive.driverId || archivedEvent.offerId !== archive.offerId || archivedEvent.attempt !== v.attempt || !Number.isSafeInteger(archivedEvent.waveNumber) || archivedEvent.waveNumber < 1) return fail("DRIVER_QUALITY_ATTEMPT_UNAVAILABLE");
      historical = { driverId: archive.driverId, offerId: archive.offerId, wave: archivedEvent.waveNumber, event: archivedEvent };
    }
    const driverId = row?.driverId ?? historical?.driverId ?? order.driverId, wave = row?.wave ?? historical?.wave ?? order.assignmentWaveNumber, offerId = row?.offerId ?? historical?.offerId ?? order.financialAcceptance?.offerId;
    if (!quoteEntityIdValid(driverId) || !quoteEntityIdValid(offerId) || !Number.isSafeInteger(wave)) return fail("DRIVER_QUALITY_ATTEMPT_UNAVAILABLE");
    const fk = { orderId: v.orderId, SK: "FINANCIAL#" + driverId + "#WAVE#" + wave }, offer = await strongGet(db, "WaveOffers_staging", fk);
    if (!offer || offer.kind !== "FINANCIAL_DRIVER_OFFER" || offer.schemaVersion !== 2 || offer.orderId !== v.orderId || offer.driverId !== driverId || offer.offerId !== offerId || offer.responseStatus !== "financial_accepted" || offer.isWinner !== true || offer.financialReceipt?.success !== true || typeof offer.financialReceipt.acceptedAt !== "string" || !Number.isFinite(Date.parse(offer.financialReceipt.acceptedAt)) || offer.financialReceipt.assignmentAttempt !== v.attempt || offer.financialReceipt.offerId !== offer.offerId || offer.financialReceipt.driverId !== offer.driverId || offer.financialReceipt.orderId !== offer.orderId) return fail("DRIVER_QUALITY_ATTEMPT_UNAVAILABLE");
    const at = new Date(now()).toISOString(), fingerprint = quoteHash({ orderId: v.orderId, driverId, offerId, attempt: v.attempt, wave, acceptedAt: offer.financialReceipt.acceptedAt });
    if (row && (row.kind !== "DRIVER_QUALITY_REVIEW" || row.schemaVersion !== 1 || row.dimension !== "QUALITY_SAFETY" || row.orderId !== v.orderId || row.driverId !== driverId || row.offerId !== offer.offerId || row.attempt !== v.attempt || row.caseId !== v.incidentId || !uuid(row.caseId))) return fail();
    if (read) return { success: true, item: { orderId: v.orderId, orderNumber: order.orderNumber || v.orderId, branchName: order.storeName || order.restaurantName || "\u0627\u0644\u0645\u0637\u0639\u0645", driverName: row?.driverName || (row && row.driverId !== order.driverId ? "\u0633\u0627\u0626\u0642 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0644\u0645\u0648\u062B\u0642\u0629" : order.driverName || "\u0627\u0644\u0633\u0627\u0626\u0642"), attempt: v.attempt, incidentId: v.incidentId, reviewable: true, sourceChanged: !!row && row.sourceFingerprint !== fingerprint, review: row, financialPosting: false, eligibilityEffect: "NONE", ratingEffect: "NONE" } };
    const ek = { orderId: v.orderId, sk: "QUALITY_REVIEW_EVENT#" + v.idempotencyKey }, digest = quoteHash({ ...v, actorId: actor.subjectId }), prior = await strongGet(db, "staging-Holds", ek);
    if (prior) {
      if (prior.requestDigest !== digest) return fail();
      return { ...prior.receipt, replayed: true };
    }
    if (row && row.sourceFingerprint !== fingerprint) return fail("DRIVER_QUALITY_SOURCE_NOT_REVIEWABLE");
    if (open ? !!row || v.expectedVersion !== 0 : !row || row.version !== v.expectedVersion || row.caseId !== v.caseId) return fail();
    if ((row?.history || []).length >= 100 || (row?.evidence || []).length >= 30 && evidence) return fail("DRIVER_QUALITY_REVIEW_LIMIT");
    const next = open ? { ...ck, kind: "DRIVER_QUALITY_REVIEW", schemaVersion: 1, dimension: "QUALITY_SAFETY", caseId: v.incidentId, category: v.category, severity: v.severity, wave, branchId: offer.branchId, driverName: historical ? "\u0633\u0627\u0626\u0642 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629" : order.driverName || "\u0627\u0644\u0633\u0627\u0626\u0642", orderId: v.orderId, driverId, offerId: offer.offerId, attempt: v.attempt, actorKind: "STAFF", ownerId: actor.subjectId, ownerLabel: access.employee?.name || access.employee?.fullName || "\u0641\u0631\u064A\u0642 \u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A", state: "OPEN", version: 1, sourceFingerprint: fingerprint, createdAt: at, evidence: [], history: [], appeals: [] } : { ...row, version: row.version + 1 };
    const selected = decide || close ? next.evidence.filter((e) => v.evidenceIds.includes(e.id)) : [];
    if ((decide || close) && selected.length !== v.evidenceIds.length) return fail("EXCEPTION_EVIDENCE_REQUIRED");
    const independent = new Set(selected.map((e) => e.party)).size;
    if (evidence) next.evidence = [...next.evidence, { id: v.idempotencyKey, party: v.reportedByParty, reference: v.reference.trim(), note: v.reason.trim(), actorId: actor.subjectId, createdAt: at, classification: "REPORTED_AS_RECEIVED", doesNotEstablishResponsibility: true }];
    if (decide) {
      if ((next.decision?.id ?? null) !== v.supersedesDecisionId) return fail();
      if (v.decision !== "PENDING_REVIEW" && !selected.length) return fail("EXCEPTION_EVIDENCE_REQUIRED");
      if (v.decision === "SUBSTANTIATED" && independent < 2) return fail("INDEPENDENT_EVIDENCE_REQUIRED");
      if (v.decision === "SUBSTANTIATED" && next.appeals.some((a) => a.status === "OPEN")) return fail("DRIVER_QUALITY_APPEAL_OPEN");
      next.decision = { id: v.idempotencyKey, value: v.decision, evidenceIds: v.evidenceIds, reason: v.reason.trim(), actorId: actor.subjectId, createdAt: at, supersedesDecisionId: v.supersedesDecisionId };
    }
    if (appeal) {
      if (!next.decision || next.decision.value === "PENDING_REVIEW" || next.appeals.some((a) => a.status === "OPEN")) return fail("DRIVER_QUALITY_APPEAL_CONFLICT");
      next.appeals = [...next.appeals, { id: v.idempotencyKey, status: "OPEN", againstDecisionId: next.decision.id, reference: v.reference.trim(), reason: v.reason.trim(), createdAt: at, recordedBy: actor.subjectId, reportedByParty: "DRIVER" }];
    }
    if (close) {
      const a = next.appeals.find((a2) => a2.id === v.appealId && a2.status === "OPEN");
      if (!a || !selected.length) return fail("DRIVER_QUALITY_APPEAL_CONFLICT");
      if (v.resolution === "UPHELD" && (next.decision?.id !== a.againstDecisionId || next.decision.value === "SUBSTANTIATED" && independent < 2)) return fail("INDEPENDENT_EVIDENCE_REQUIRED");
      if (v.resolution === "REVISED" && (next.decision?.id === a.againstDecisionId || !["NOT_SUBSTANTIATED", "PENDING_REVIEW"].includes(next.decision?.value))) return fail("DRIVER_QUALITY_APPEAL_CONFLICT");
      next.appeals = next.appeals.map((a2) => a2.id === v.appealId ? { ...a2, status: "CLOSED", resolution: v.resolution, resolvedAt: at, reason: v.reason.trim(), evidenceIds: v.evidenceIds, resolvedBy: actor.subjectId } : a2);
    }
    next.state = next.appeals.some((a) => a.status === "OPEN") ? "APPEAL_OPEN" : next.decision && next.decision.value !== "PENDING_REVIEW" ? "RESOLVED" : "OPEN";
    next.updatedAt = at;
    next.history = [...next.history, { id: v.idempotencyKey, action: v.action, reason: v.reason.trim(), createdAt: at, actorId: actor.subjectId, decision: next.decision?.value ?? null }];
    if (Buffer.byteLength(JSON.stringify(next)) > 28e4) return fail("DRIVER_QUALITY_REVIEW_LIMIT");
    const receipt = { success: true, caseId: next.caseId, caseKey: ck.sk, version: next.version, action: v.action, financialPosting: false, eligibilityEffect: "NONE", ratingEffect: "NONE" };
    const event = { ...ek, kind: "DRIVER_QUALITY_REVIEW_EVENT", schemaVersion: 1, recordId: v.idempotencyKey, caseId: next.caseId, orderId: v.orderId, driverId: next.driverId, offerId: next.offerId, attempt: next.attempt, sourceFingerprint: fingerprint, action: v.action, actorKind: "STAFF", actorId: actor.subjectId, requestDigest: digest, createdAt: at, reason: v.reason.trim(), ...decide ? { decision: next.decision } : {}, receipt, financialPosting: false, eligibilityEffect: "NONE", ratingEffect: "NONE" };
    const fence = row ? exactCheck("staging-Holds", ck, row).ConditionCheck : { TableName: "staging-Holds", Key: ck, ConditionExpression: "attribute_not_exists(orderId)" };
    const { Key: _key, ...putFence } = fence;
    const index = await exceptionCaseIndexOperation(db, { caseId: next.caseId, orderId: v.orderId, caseKey: ck.sk, caseType: "DRIVER_QUALITY_REVIEW", state: next.state, open: next.state !== "RESOLVED", at, branchId: order.storeId });
    const ops = [access.guard, ...archive ? [exactCheck("staging-Holds", archiveKey, archive), exactCheck("staging-WalletLifecycle", { operationId: archive.operationId + ":EVENT" }, historical.event)] : [], exactCheck("WizzOrders", ok, order), exactCheck("WaveOffers_staging", fk, offer), { ConditionCheck: { TableName: "staging-AccountDeletion", Key: { pk: "ACCOUNT_LIFECYCLE#DRIVER#" + driverId, sk: "META" }, ConditionExpression: "attribute_not_exists(pk)" } }, index, { Put: { ...putFence, Item: next } }, { Put: { TableName: "staging-Holds", Item: event, ConditionExpression: "attribute_not_exists(orderId)" } }, { Put: { TableName: "staging-AuditLog", Item: { datePartition: "date#" + at.slice(0, 10).replace(/-/g, ""), sk: at + "#" + v.idempotencyKey, logId: v.idempotencyKey, action: v.action, caseId: next.caseId, orderId: v.orderId, actorKind: "STAFF", actorId: actor.subjectId, createdAt: at, financialPosting: false, eligibilityEffect: "NONE", ratingEffect: "NONE" }, ConditionExpression: "attribute_not_exists(sk)" } }];
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
  DRIVER_QUALITY_ACTIONS,
  createDriverQualityReview
});
