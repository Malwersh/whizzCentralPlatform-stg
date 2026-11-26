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

// backend/wallet-service/src/exceptionCaseSlaWorker.ts
var exceptionCaseSlaWorker_exports = {};
__export(exceptionCaseSlaWorker_exports, {
  createExceptionCaseSlaWorker: () => createExceptionCaseSlaWorker,
  exceptionCaseSlaHandler: () => exceptionCaseSlaHandler
});
module.exports = __toCommonJS(exceptionCaseSlaWorker_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");

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

// backend/wallet-service/src/exceptionCasePolicy.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var CASE_PRIORITIES = ["SAFETY", "CUSTODY", "COD", "FINANCIAL", "STANDARD"];
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
function casePhase(snapshot, priority, at) {
  const { digest, ...body } = snapshot ?? {};
  if (body.schemaVersion !== 1 || digest !== quoteHash(body)) return bad();
  const values = validateExceptionCasePolicy(snapshot.values), rule = values.sla[priority], t = Date.parse(at);
  if (!rule || !Number.isFinite(t)) return bad();
  return { priority, startedAt: at, responseDueAt: new Date(t + rule.responseSeconds * 1e3).toISOString(), escalationDueAt: new Date(t + rule.escalationSeconds * 1e3).toISOString(), policyVersion: snapshot.policyVersion };
}

// backend/wallet-service/src/orderExceptionCaseIndex.ts
var CASE_OPEN_PARTITION = "ORDER_EXCEPTIONS_OPEN";

// backend/wallet-service/src/exceptionCaseSlaWorker.ts
var EVENTS = "staging-WalletLifecycle";
var HOLDS = "staging-Holds";
function createExceptionCaseSlaWorker(options) {
  const { db } = options, now = options.now ?? Date.now;
  async function process2(pointer) {
    if (pointer.kind !== "ORDER_EXCEPTION_CASE_POINTER" || !quoteEntityIdValid(pointer.caseId) || !quoteEntityIdValid(pointer.orderId) || pointer.operationId !== "EXCEPTION_CASE#" + pointer.caseId || pointer.queuePartition !== CASE_OPEN_PARTITION || !Number.isSafeInteger(pointer.version) || !["CUSTOMER_CANCELLATION", "MERCHANT_CANCELLATION"].includes(pointer.caseKey) && !/^RETURN#[1-9][0-9]{0,2}$/.test(pointer.caseKey || "")) return "ignored";
    const key = { operationId: pointer.operationId }, live = await strongGet(db, EVENTS, key);
    if (!live || live.version !== pointer.version || live.status !== "OPEN" || live.queuePartition !== CASE_OPEN_PARTITION) return "stale";
    const ck = { orderId: pointer.orderId, sk: pointer.caseKey }, row = await strongGet(db, HOLDS, ck), t = now(), at = new Date(t).toISOString();
    const operations = [], next = { ...live, version: live.version + 1, updatedAt: at };
    const identity = row?.caseId ?? row?.exceptionResolution?.caseId;
    const closed = ["CUSTOMER_CANCELLATION", "MERCHANT_CANCELLATION"].includes(row?.kind) ? ["DECLINED", "SUPERSEDED"].includes(row?.state) || row?.state === "CANCELLED" && row?.settlementStatus !== "REVIEW" : row?.exceptionResolution?.status === "RESOLVED";
    if (!row || identity !== pointer.caseId) {
      next.monitoringStatus = "SOURCE_REVIEW_REQUIRED";
      next.nextAttemptAt = Math.floor(t / 1e3) + 3600;
    } else if (closed) {
      next.status = "CLOSED";
      next.queuePartition = "ORDER_EXCEPTIONS_CLOSED";
      next.monitoringStatus = "CLOSED";
      next.nextAttemptAt = Math.floor(t / 1e3);
    } else {
      const phase = row.activePhase;
      try {
        if (!phase || !CASE_PRIORITIES.includes(phase.priority) || !row.casePolicySnapshot) throw Error("POLICY_REVIEW_REQUIRED");
        const expected = casePhase(phase.priority === "FINANCIAL" && phase.startedAt === row.guaranteeResolution?.retainedAt && row.guaranteeResolution?.state === "RETAINED" ? row.guaranteeResolution.slaPolicySnapshot : phase.priority === "CUSTODY" && phase.startedAt === row.handoverIssue?.reportedAt ? row.handoverIssue.slaPolicySnapshot : row.casePolicySnapshot, phase.priority, phase.startedAt);
        for (const field of ["priority", "startedAt", "responseDueAt", "escalationDueAt", "policyVersion"]) if (expected[field] !== phase[field]) throw Error("POLICY_REVIEW_REQUIRED");
        if (phase.respondedAt != null && (!Number.isFinite(Date.parse(phase.respondedAt)) || Date.parse(phase.respondedAt) < Date.parse(phase.startedAt) || Date.parse(phase.respondedAt) > t + 3e4)) throw Error("POLICY_REVIEW_REQUIRED");
        const phaseKey = quoteHash(expected).slice(0, 32), same = live.monitoringPhaseKey === phaseKey;
        next.monitoringPhaseKey = phaseKey;
        next.monitoringPhaseStartedAt = phase.startedAt;
        next.monitoringPriority = phase.priority;
        next.monitoringStatus = "MONITORING";
        const lateResponse = t >= Date.parse(phase.responseDueAt) && !phase.respondedAt, lateEscalation = t >= Date.parse(phase.escalationDueAt);
        next.responseAlertAt = same ? live.responseAlertAt ?? null : null;
        next.escalatedAt = same ? live.escalatedAt ?? null : null;
        for (const [kind, due] of [["RESPONSE", lateResponse], ["ESCALATION", lateEscalation]]) {
          const field = kind === "RESPONSE" ? "responseAlertAt" : "escalatedAt";
          if (!due || next[field]) continue;
          next[field] = at;
          const eventId = "SLA:" + quoteHash([pointer.caseId, phaseKey, kind]).slice(0, 48);
          operations.push({ Put: { TableName: "staging-AuditLog", Item: { datePartition: "date#" + at.slice(0, 10).replace(/-/g, ""), sk: at + "#" + eventId, logId: eventId, action: "ORDER_EXCEPTION_" + kind + "_OVERDUE", actorId: "ORDER_EXCEPTION_SLA_WORKER", actorKind: "SYSTEM", orderId: pointer.orderId, caseId: pointer.caseId, phase: phase.priority, phaseStartedAt: phase.startedAt, deadlineAt: kind === "RESPONSE" ? phase.responseDueAt : phase.escalationDueAt, createdAt: at, noFinancialEffect: true }, ConditionExpression: "attribute_not_exists(sk)" } });
        }
        const responseTime = Date.parse(phase.responseDueAt), escalationTime = Date.parse(phase.escalationDueAt);
        next.nextAttemptAt = Math.floor((!phase.respondedAt && responseTime > t ? responseTime : escalationTime > t ? escalationTime : t + 36e5) / 1e3);
      } catch {
        next.monitoringStatus = "POLICY_REVIEW_REQUIRED";
        next.nextAttemptAt = Math.floor(t / 1e3) + 3600;
      }
    }
    const { Key: _key, ...condition } = exactCheck(EVENTS, key, live).ConditionCheck;
    operations.push({ Put: { ...condition, Item: next } }, row ? exactCheck(HOLDS, ck, row) : { ConditionCheck: { TableName: HOLDS, Key: ck, ConditionExpression: "attribute_not_exists(orderId)" } });
    try {
      await db.send(new import_lib_dynamodb3.TransactWriteCommand({ TransactItems: operations }));
      return "updated";
    } catch (e) {
      if (e?.name === "TransactionCanceledException" || e?.name === "ConditionalCheckFailedException") return "stale";
      throw e;
    }
  }
  return async function tick() {
    let cursor;
    const counts = { scanned: 0, updated: 0, stale: 0, ignored: 0 };
    for (let page = 0; page < 4; page++) {
      const result = await db.send(new import_lib_dynamodb3.QueryCommand({ TableName: EVENTS, IndexName: "ByDue", KeyConditionExpression: "queuePartition=:open AND nextAttemptAt<=:now", ExpressionAttributeValues: { ":open": CASE_OPEN_PARTITION, ":now": Math.floor(now() / 1e3) }, ExclusiveStartKey: cursor, Limit: 25 }));
      for (const p of result.Items ?? []) {
        counts.scanned++;
        counts[await process2(p)]++;
      }
      cursor = result.LastEvaluatedKey;
      if (!cursor) break;
    }
    return counts;
  };
}
async function exceptionCaseSlaHandler(event) {
  if (process.env.STAGE !== "staging" || process.env.AWS_REGION !== "us-east-1" || process.env.EXCEPTION_CASE_SLA_MODE !== "REQUIRED" || !event || event.action !== "tick" || Object.keys(event).join(",") !== "action") throw Error("EXCEPTION_CASE_SLA_DISABLED");
  const db = import_lib_dynamodb3.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: "us-east-1" }), { marshallOptions: { removeUndefinedValues: true } });
  return createExceptionCaseSlaWorker({ db })();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createExceptionCaseSlaWorker,
  exceptionCaseSlaHandler
});
