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

// backend/shared/driver-quality-proof-290.js
var require_driver_quality_proof_290 = __commonJS({
  "backend/shared/driver-quality-proof-290.js"(exports2, module2) {
    "use strict";
    var { createHash: createHash2 } = require("node:crypto");
    var uuid2 = (v) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
    var canonical = (v) => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
    var fingerprint = (o, r) => createHash2("sha256").update(canonical({ orderId: r.orderId, driverId: r.driverId, offerId: r.offerId, attempt: r.attempt, wave: r.wave, acceptedAt: o.financialReceipt.acceptedAt })).digest("hex");
    function validCase2(r, o, driverId) {
      return !!(r && o && r.kind === "DRIVER_QUALITY_REVIEW" && r.schemaVersion === 1 && r.dimension === "QUALITY_SAFETY" && r.actorKind === "STAFF" && r.driverId === driverId && Number.isSafeInteger(r.wave) && r.wave > 0 && Number.isSafeInteger(r.attempt) && r.attempt > 0 && uuid2(r.caseId) && r.sk === "DRIVER_QUALITY#" + r.caseId && Number.isSafeInteger(r.version) && r.version > 0 && ["OPEN", "APPEAL_OPEN", "RESOLVED"].includes(r.state) && Array.isArray(r.appeals) && Array.isArray(r.history) && Array.isArray(r.evidence) && o.kind === "FINANCIAL_DRIVER_OFFER" && o.schemaVersion === 2 && o.driverId === driverId && o.orderId === r.orderId && o.offerId === r.offerId && o.isWinner === true && o.responseStatus === "financial_accepted" && o.financialReceipt?.success === true && o.financialReceipt.orderId === r.orderId && o.financialReceipt.driverId === driverId && o.financialReceipt.offerId === r.offerId && o.financialReceipt.assignmentAttempt === r.attempt && r.sourceFingerprint === fingerprint(o, r));
    }
    function validDecision2(r, e) {
      return !!(r.decision && uuid2(r.decision.id) && e && e.kind === "DRIVER_QUALITY_REVIEW_EVENT" && e.schemaVersion === 1 && e.actorKind === "STAFF" && e.action === "DECIDE_DRIVER_QUALITY_REVIEW" && e.recordId === r.decision.id && e.caseId === r.caseId && e.orderId === r.orderId && e.driverId === r.driverId && e.offerId === r.offerId && e.attempt === r.attempt && e.sourceFingerprint === r.sourceFingerprint && e.decision?.id === r.decision.id && canonical(e.decision) === canonical(r.decision) && e.receipt?.success === true && e.receipt.caseId === r.caseId);
    }
    module2.exports = { uuid: uuid2, validCase: validCase2, validDecision: validDecision2 };
  }
});

// backend/wallet-service/src/driverQualityDriverRuntime.ts
var driverQualityDriverRuntime_exports = {};
__export(driverQualityDriverRuntime_exports, {
  createDriverQualityAppeal: () => createDriverQualityAppeal,
  handler: () => handler
});
module.exports = __toCommonJS(driverQualityDriverRuntime_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");
var import_client_cognito_identity_provider2 = require("@aws-sdk/client-cognito-identity-provider");

// backend/wallet-service/src/driverQualityAppeal.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/financialIdentity.ts
var import_client_cognito_identity_provider = require("@aws-sdk/client-cognito-identity-provider");
var pools = { STAFF: "us-east-1_wz7vwZZxz", CUSTOMER: "us-east-1_TpyyrVkEE", DRIVER: "us-east-1_RGTqUXF5C", MERCHANT_OWNER: "us-east-1_gtCR3ndzT" };
async function authenticateFinancialIdentity(cognito, accessToken, kind) {
  const bad = () => {
    throw Object.assign(Error("UNAUTHORIZED"), { code: "UNAUTHORIZED" });
  };
  const pool = pools[kind];
  if (!pool || typeof accessToken !== "string" || accessToken.length > 16e3) return bad();
  let claims;
  try {
    claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
  } catch {
    return bad();
  }
  if (claims.iss !== "https://cognito-idp.us-east-1.amazonaws.com/" + pool || claims.token_use !== "access") return bad();
  const user = await cognito.send(new import_client_cognito_identity_provider.GetUserCommand({ AccessToken: accessToken })), attrs = user.UserAttributes ?? [];
  const sub = attrs.find((a) => a.Name === "sub")?.Value;
  if (!sub || sub !== claims.sub || attrs.filter((a) => a.Name === "sub").length !== 1 || !user.Username || kind === "DRIVER" && user.Username !== sub) return bad();
  const live = await cognito.send(new import_client_cognito_identity_provider.AdminGetUserCommand({ UserPoolId: pool, Username: user.Username }));
  if (live.Enabled !== true || live.UserStatus !== "CONFIRMED" || live.Username !== user.Username || live.UserAttributes?.filter((a) => a.Name === "sub").length !== 1 || live.UserAttributes?.find((a) => a.Name === "sub")?.Value !== sub) return bad();
  if (kind === "STAFF" && !live.UserMFASettingList?.includes("SOFTWARE_TOKEN_MFA")) return bad();
  return { kind, subjectId: sub };
}

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

// backend/wallet-service/src/driverQualityAppeal.ts
var { uuid, validCase, validDecision } = require_driver_quality_proof_290();
var fail = (code = "DRIVER_QUALITY_REVIEW_CONFLICT") => {
  throw Object.assign(Error(code), { code });
};
function createDriverQualityAppeal(options) {
  const { db, authenticate } = options, now = options.now ?? Date.now;
  return async (v) => {
    if (!v || Object.keys(v).sort().join(",") !== "action,expectedVersion,idempotencyKey,incidentId,orderId,reason" || v.action !== "APPEAL" || !quoteEntityIdValid(v.orderId) || !uuid(v.incidentId) || !uuid(v.idempotencyKey) || !Number.isSafeInteger(v.expectedVersion) || v.expectedVersion < 1 || typeof v.reason !== "string" || v.reason.trim().length < 5 || v.reason.length > 1e3) return fail("INVALID_DRIVER_QUALITY_REVIEW");
    const actor = await authenticate();
    if (actor.kind !== "DRIVER" || !quoteEntityIdValid(actor.subjectId)) return fail("UNAUTHORIZED");
    const pk = { driverId: actor.subjectId }, profile = await strongGet(db, "WhizzDrivers_staging", pk);
    if (!profile || profile.driverId !== actor.subjectId || profile.isDeleted === true || profile.deletedAt != null || profile.deletionRequestId != null) return fail("UNAUTHORIZED");
    const ck = { orderId: v.orderId, sk: "DRIVER_QUALITY#" + v.incidentId }, row = await strongGet(db, "staging-Holds", ck);
    if (!row || row.driverId !== actor.subjectId) return fail("DRIVER_QUALITY_CASE_UNAVAILABLE");
    const offer = await strongGet(db, "WaveOffers_staging", { orderId: v.orderId, SK: "FINANCIAL#" + actor.subjectId + "#WAVE#" + row.wave });
    if (!validCase(row, offer, actor.subjectId)) return fail("DRIVER_QUALITY_CASE_UNAVAILABLE");
    const ek = { orderId: v.orderId, sk: "QUALITY_REVIEW_EVENT#" + v.idempotencyKey }, digest = quoteHash({ ...v, actorId: actor.subjectId }), prior = await strongGet(db, "staging-Holds", ek);
    if (prior) {
      if (prior.requestDigest !== digest || prior.actorKind !== "DRIVER" || prior.actorId !== actor.subjectId) return fail();
      return { ...prior.receipt, replayed: true };
    }
    const decisionEvent = row.decision?.id && uuid(row.decision.id) ? await strongGet(db, "staging-Holds", { orderId: v.orderId, sk: "QUALITY_REVIEW_EVENT#" + row.decision.id }) : null;
    if (row.version !== v.expectedVersion || row.state !== "RESOLVED" || row.decision?.value !== "SUBSTANTIATED" || !validDecision(row, decisionEvent) || row.appeals.some((a) => a.status === "OPEN")) return fail("DRIVER_QUALITY_APPEAL_CONFLICT");
    if (row.history.length >= 100 || row.appeals.length >= 30) return fail("DRIVER_QUALITY_REVIEW_LIMIT");
    const at = new Date(now()).toISOString(), appeal = { id: v.idempotencyKey, status: "OPEN", againstDecisionId: row.decision.id, reference: "\u0627\u0639\u062A\u0631\u0627\u0636 \u0645\u0631\u0633\u0644 \u0645\u0646 \u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u0633\u0627\u0626\u0642", reason: v.reason.trim(), createdAt: at, recordedBy: actor.subjectId, reportedByParty: "DRIVER" };
    const next = { ...row, version: row.version + 1, state: "APPEAL_OPEN", updatedAt: at, appeals: [...row.appeals, appeal], history: [...row.history, { id: v.idempotencyKey, action: "SUBMIT_DRIVER_QUALITY_APPEAL", reason: v.reason.trim(), createdAt: at, actorId: actor.subjectId, decision: row.decision.value }] };
    if (Buffer.byteLength(JSON.stringify(next)) > 28e4) return fail("DRIVER_QUALITY_REVIEW_LIMIT");
    const receipt = { success: true, caseId: row.caseId, version: next.version, financialPosting: false, eligibilityEffect: "NONE", ratingEffect: "NONE" }, event = { ...ek, kind: "DRIVER_QUALITY_REVIEW_EVENT", schemaVersion: 1, recordId: v.idempotencyKey, caseId: row.caseId, orderId: v.orderId, driverId: actor.subjectId, offerId: row.offerId, attempt: row.attempt, sourceFingerprint: row.sourceFingerprint, action: "SUBMIT_DRIVER_QUALITY_APPEAL", actorKind: "DRIVER", actorId: actor.subjectId, requestDigest: digest, createdAt: at, receipt, financialPosting: false };
    const { Key: _key, ...fence } = exactCheck("staging-Holds", ck, row).ConditionCheck;
    const index = await exceptionCaseIndexOperation(db, { caseId: row.caseId, orderId: v.orderId, caseKey: ck.sk, caseType: "DRIVER_QUALITY_REVIEW", state: "APPEAL_OPEN", open: true, at, branchId: row.branchId || offer.branchId });
    if (!equal(actor, await authenticate())) return fail("UNAUTHORIZED");
    try {
      await db.send(new import_lib_dynamodb2.TransactWriteCommand({ TransactItems: [exactCheck("WhizzDrivers_staging", pk, profile), exactCheck("WaveOffers_staging", { orderId: v.orderId, SK: "FINANCIAL#" + actor.subjectId + "#WAVE#" + row.wave }, offer), exactCheck("staging-Holds", { orderId: v.orderId, sk: "QUALITY_REVIEW_EVENT#" + row.decision.id }, decisionEvent), { ConditionCheck: { TableName: "staging-AccountDeletion", Key: { pk: "ACCOUNT_LIFECYCLE#DRIVER#" + actor.subjectId, sk: "META" }, ConditionExpression: "attribute_not_exists(pk)" } }, index, { Put: { ...fence, Item: next } }, { Put: { TableName: "staging-Holds", Item: event, ConditionExpression: "attribute_not_exists(orderId)" } }, { Put: { TableName: "staging-AuditLog", Item: { datePartition: "date#" + at.slice(0, 10).replace(/-/g, ""), sk: at + "#" + v.idempotencyKey, logId: v.idempotencyKey, action: "SUBMIT_DRIVER_QUALITY_APPEAL", caseId: row.caseId, orderId: v.orderId, actorKind: "DRIVER", actorId: actor.subjectId, createdAt: at, financialPosting: false }, ConditionExpression: "attribute_not_exists(sk)" } }] }));
    } catch (error) {
      const saved = await strongGet(db, "staging-Holds", ek);
      if (saved?.requestDigest === digest && saved.actorId === actor.subjectId) return { ...saved.receipt, replayed: true };
      throw error;
    }
    return receipt;
  };
}
function createAuthenticatedDriverQualityAppeal(options) {
  return createDriverQualityAppeal({ db: options.db, authenticate: () => authenticateFinancialIdentity(options.cognito, options.accessToken, "DRIVER") });
}

// backend/wallet-service/src/driverQualityDriverRuntime.ts
async function handler(event) {
  try {
    if (!event || Object.keys(event).sort().join(",") !== "accessToken,action,body" || event.action !== "driver_quality_case" || typeof event.accessToken !== "string") return { statusCode: 400, code: "INVALID_DRIVER_QUALITY_REVIEW" };
    const db = import_lib_dynamodb3.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: "us-east-1" }), { marshallOptions: { removeUndefinedValues: true } }), cognito = new import_client_cognito_identity_provider2.CognitoIdentityProviderClient({ region: "us-east-1" });
    return { statusCode: 200, result: await createAuthenticatedDriverQualityAppeal({ db, cognito, accessToken: event.accessToken })(event.body) };
  } catch (error) {
    const codes = ["UNAUTHORIZED", "INVALID_DRIVER_QUALITY_REVIEW", "DRIVER_QUALITY_REVIEW_CONFLICT", "DRIVER_QUALITY_CASE_UNAVAILABLE", "DRIVER_QUALITY_APPEAL_CONFLICT", "DRIVER_QUALITY_REVIEW_LIMIT"];
    return { statusCode: error?.code === "UNAUTHORIZED" ? 403 : 409, code: codes.includes(error?.code) ? error.code : "QUALITY_APPEAL_UNAVAILABLE" };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createDriverQualityAppeal,
  handler
});
