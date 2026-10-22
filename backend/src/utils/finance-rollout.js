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

// backend/wallet-service/src/financeRollout.ts
var financeRollout_exports = {};
__export(financeRollout_exports, {
  FinanceRolloutError: () => FinanceRolloutError,
  createFinanceRollout: () => createFinanceRollout,
  readFinanceRollout: () => readFinanceRollout
});
module.exports = __toCommonJS(financeRollout_exports);

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
var equal = (a, b) => quoteCanonical(a) === quoteCanonical(b);
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
  if (root.schemaVersion !== 2 || root.performanceMode !== "LEGACY_METRICS") return invalid();
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
var OPERATIONS_LIMITS = { quoteMaxPerCustomerPerMinute: [1, 120], driverOfferTtlSeconds: [1, 900], driverPositionMaxAgeSeconds: [1, 900], reassignmentWindowSeconds: [30, 900], maximumWaves: [1, 10] };
function validateOperationsValues(input) {
  const bad2 = (code = "INVALID_DISPATCH_SETTINGS") => {
    throw Object.assign(Error(code), { code, status: 400 });
  };
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).filter((k) => k !== "dispatch").sort().join(",") !== Object.keys(OPERATIONS_LIMITS).sort().join(",")) return bad2();
  const v = input;
  for (const k of Object.keys(OPERATIONS_LIMITS)) {
    const [min, max] = OPERATIONS_LIMITS[k];
    if (!Number.isSafeInteger(v[k]) || v[k] < min || v[k] > max) return bad2();
  }
  if (v.driverPositionMaxAgeSeconds < v.driverOfferTtlSeconds) return bad2("POSITION_WINDOW_TOO_SHORT");
  if (Object.prototype.hasOwnProperty.call(v, "dispatch")) {
    const dispatch = validateDispatchPolicy(v.dispatch), p = dispatch.profiles.FINANCIAL;
    if (p.offerTtlSeconds !== v.driverOfferTtlSeconds || p.positionMaxAgeSeconds !== v.driverPositionMaxAgeSeconds || p.reassignmentWindowSeconds !== v.reassignmentWindowSeconds || p.normalWaves.length !== v.maximumWaves) return bad2("DISPATCH_LIMITS_CONFLICT");
    return { ...v, dispatch };
  }
  return { ...v };
}
function validateOperationsSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== "values,version" || !Number.isSafeInteger(input.version) || input.version < 0) throw Error("DELIVERY_OPERATIONS_UNAVAILABLE");
  return { version: input.version, values: validateOperationsValues(input.values) };
}

// backend/wallet-service/src/dispatchCycle.ts
var bad = () => {
  throw Object.assign(Error("DISPATCH_CYCLE_CONFLICT"), { code: "DISPATCH_CYCLE_CONFLICT" });
};
var date = (value) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) return bad();
  return Date.parse(value);
};
function createDispatchCycle(input) {
  if (!input || Object.keys(input).filter((k) => k !== "keyVersion").sort().join(",") !== "assignmentId,engine,id,orderId,policy,startedAt" || Object.prototype.hasOwnProperty.call(input, "keyVersion") && input.keyVersion !== 2 || ![input.id, input.orderId, input.assignmentId].every(quoteEntityIdValid) || !["LEGACY", "FINANCIAL"].includes(input.engine)) return bad();
  const snapshot = validateOperationsSnapshot(input.policy);
  if (snapshot.version < 1 || !snapshot.values.dispatch) return bad();
  const dispatch = validateDispatchPolicy(snapshot.values.dispatch), profile = dispatch.profiles[input.engine], start = date(input.startedAt);
  const deadline = start + profile.totalDispatchSeconds * 1e3;
  if (!Number.isSafeInteger(deadline)) return bad();
  const body = { schemaVersion: 1, ...input.keyVersion === 2 ? { keyVersion: 2 } : {}, id: input.id, orderId: input.orderId, assignmentId: input.assignmentId, engine: input.engine, startedAt: input.startedAt, searchDeadline: new Date(deadline).toISOString(), policy: snapshot };
  return { ...detach(body), digest: quoteHash(body) };
}
function validateDispatchCycle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).filter((k) => k !== "keyVersion").sort().join(",") !== "assignmentId,digest,engine,id,orderId,policy,schemaVersion,searchDeadline,startedAt" || Object.prototype.hasOwnProperty.call(value, "keyVersion") && value.keyVersion !== 2 || value.schemaVersion !== 1) return bad();
  const rebuilt = createDispatchCycle({ id: value.id, orderId: value.orderId, assignmentId: value.assignmentId, engine: value.engine, startedAt: value.startedAt, policy: value.policy, ...value.keyVersion !== void 0 ? { keyVersion: value.keyVersion } : {} });
  if (rebuilt.digest !== value.digest || rebuilt.searchDeadline !== value.searchDeadline) return bad();
  return rebuilt;
}

// backend/wallet-service/src/financeDispatchRecovery.ts
async function financialRecoveryProof(db, env, orderId, now) {
  const fail2 = () => {
    throw Object.assign(Error("FINANCE_ROLLOUT_ADMISSION_CLOSED"), { code: "FINANCE_ROLLOUT_ADMISSION_CLOSED" });
  };
  let p;
  try {
    if (typeof env.FINANCE_DISPATCH_RECOVERY !== "string" || Buffer.byteLength(env.FINANCE_DISPATCH_RECOVERY) > 1500) return fail2();
    p = JSON.parse(env.FINANCE_DISPATCH_RECOVERY);
  } catch {
    return fail2();
  }
  if (!p || Object.keys(p).sort().join(",") !== "caseId,cycleId,expiresAt,orderId,requestId,schemaVersion" || p.schemaVersion !== 1 || p.orderId !== orderId || !/^[a-f0-9]{64}$/.test(p.caseId ?? "") || !/^[-a-f0-9]{36}$/i.test(p.requestId ?? "") || !Number.isSafeInteger(now) || !Number.isFinite(Date.parse(p.expiresAt)) || now >= Date.parse(p.expiresAt)) return fail2();
  const token = quoteHash({ caseId: p.caseId, requestId: p.requestId });
  if (p.cycleId !== "DC:" + token) return fail2();
  const jobKey = { orderId, SK: "METADATA" }, decisionKey = { pk: "DISPATCH_REVIEW#" + p.caseId, sk: "DECISION" }, job = await strongGet(db, "WizzDispatchJobs_staging", jobKey), decision = await strongGet(db, "staging-PlatformStaff", decisionKey);
  if (!job || !decision) return fail2();
  let cycle;
  try {
    cycle = validateDispatchCycle(job.dispatchCycle);
  } catch {
    return fail2();
  }
  if (cycle.engine !== "FINANCIAL" || cycle.keyVersion !== 2 || cycle.orderId !== orderId || cycle.id !== p.cycleId || cycle.assignmentId !== job.dispatchJobId || cycle.assignmentId !== "DISPATCH:" + token || job.financialDispatch !== true || cycle.searchDeadline !== p.expiresAt || now < Date.parse(cycle.startedAt) || Date.parse(cycle.searchDeadline) - Date.parse(cycle.startedAt) > 9e5 || !["searching", "assigned"].includes(job.status) || decision.kind !== "DISPATCH_REVIEW_DECISION" || decision.status !== "EXECUTED" || decision.action !== "RETRY_SEARCH" || decision.resultCode !== "SEARCH_RESTART_QUEUED" || decision.orderId !== orderId || decision.caseId !== p.caseId || decision.requestId !== p.requestId || decision.receipt?.cycleId !== cycle.id || decision.receipt?.assignmentId !== cycle.assignmentId || decision.receipt?.restartId !== job.dispatchRestart?.restartId || decision.legalHold === true || decision.retentionHold === true) return fail2();
  return [exactCheck("WizzDispatchJobs_staging", jobKey, job), exactCheck("staging-PlatformStaff", decisionKey, decision)];
}

// backend/wallet-service/src/dispatchTransaction.ts
function conjunction(value) {
  if (/\b(?:OR|BETWEEN|NOT)\b/.test(value)) return null;
  let text = value.trim();
  while (text.startsWith("(")) {
    let depth2 = 0, end = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") depth2++;
      if (text[i] === ")" && --depth2 === 0) {
        end = i;
        break;
      }
    }
    if (end !== text.length - 1) break;
    text = text.slice(1, -1).trim();
  }
  let depth = 0, start = 0;
  const parts = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    if (depth < 0) return null;
    if (depth === 0 && text.slice(i, i + 5) === " AND ") {
      const sub = conjunction(text.slice(start, i));
      if (!sub) return null;
      parts.push(...sub);
      start = i + 5;
      i += 4;
    }
  }
  if (depth !== 0) return null;
  if (start) {
    const sub = conjunction(text.slice(start));
    return sub ? [...parts, ...sub] : null;
  }
  return text ? [text] : null;
}
function atomIdentity(term, check) {
  const field = (token) => token.startsWith("#") ? check.ExpressionAttributeNames?.[token] : token;
  const absence = term.match(/^attribute_(not_)?exists\(\s*(#[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s*\)$/);
  if (absence) {
    const name = field(absence[2]);
    return typeof name === "string" ? quoteCanonical([absence[1] ? "absent" : "present", name]) : null;
  }
  const equality = term.match(/^(#[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)$/);
  if (!equality || typeof field(equality[1]) !== "string" || !Object.prototype.hasOwnProperty.call(check.ExpressionAttributeValues ?? {}, equality[2])) return null;
  return quoteCanonical(["equal", field(equality[1]), check.ExpressionAttributeValues[equality[2]]]);
}
function composeDispatchTransaction(operations, guards) {
  const result = detach(operations);
  for (const guard of detach(guards)) {
    if (!guard.ConditionCheck) throw Error("INVALID_DISPATCH_FENCE");
    const g = guard.ConditionCheck;
    const existing = result.find((op) => {
      const q2 = op.ConditionCheck ?? op.Update ?? op.Delete;
      return q2?.TableName === g.TableName && equal(q2.Key, g.Key);
    });
    if (!existing) {
      if (result.some((op) => op.Put?.TableName === g.TableName && Object.entries(g.Key).every(([k, v]) => equal(op.Put.Item[k], v)))) throw Error("DISPATCH_FENCE_ON_INSERT");
      result.push(guard);
      continue;
    }
    const q = existing.ConditionCheck ?? existing.Update ?? existing.Delete;
    let expression = g.ConditionExpression;
    const prior = conjunction(q.ConditionExpression ?? ""), incoming = conjunction(expression);
    if (prior && incoming) {
      const seen = new Set(prior.map((t) => atomIdentity(t, q)).filter(Boolean));
      const retained = incoming.filter((t) => {
        const identity = atomIdentity(t, g);
        if (identity && seen.has(identity)) return false;
        if (identity) seen.add(identity);
        return true;
      });
      if (!retained.length) continue;
      expression = retained.join(" AND ");
    }
    const referenced = new Set(expression.match(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g) ?? []);
    const names = {}, values = {};
    let n = 0;
    const used = /* @__PURE__ */ new Set([...Object.keys(q.ExpressionAttributeNames ?? {}), ...Object.keys(q.ExpressionAttributeValues ?? {})]);
    const replacements = {};
    for (const [map, prefix, out] of [[g.ExpressionAttributeNames, "#", names], [g.ExpressionAttributeValues, ":", values]]) {
      for (const [token, value] of Object.entries(map ?? {})) {
        if (!referenced.has(token)) continue;
        let next;
        do {
          next = prefix + "d" + n++;
        } while (used.has(next));
        used.add(next);
        replacements[token] = next;
        out[next] = value;
      }
    }
    expression = expression.replace(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g, (t) => replacements[t] ?? t);
    q.ConditionExpression = [q.ConditionExpression, expression].filter(Boolean).map((e) => /\bOR\b/.test(e) ? "(" + e + ")" : e).join(" AND ");
    q.ExpressionAttributeNames = { ...q.ExpressionAttributeNames, ...names };
    q.ExpressionAttributeValues = { ...q.ExpressionAttributeValues, ...values };
    if (!Object.keys(q.ExpressionAttributeNames).length) delete q.ExpressionAttributeNames;
    if (!Object.keys(q.ExpressionAttributeValues).length) delete q.ExpressionAttributeValues;
    if (Buffer.byteLength(q.ConditionExpression) > 3900) throw Error("DISPATCH_FENCE_TOO_LARGE");
  }
  const ids = result.map((op) => {
    const q = op.Put ?? op.Update ?? op.Delete ?? op.ConditionCheck;
    const key = q.Key ?? (["WizzDispatchJobs_staging", "WaveOffers_staging"].includes(q.TableName) ? { orderId: q.Item.orderId, SK: q.Item.SK } : q.Item);
    return q.TableName + ":" + quoteCanonical(key);
  });
  if (new Set(ids).size !== ids.length || result.length > 100 || Buffer.byteLength(JSON.stringify(result)) > 35e5) throw Error("DISPATCH_TRANSACTION_TOO_LARGE");
  return result;
}

// backend/wallet-service/src/financeRollout.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_node_zlib = require("node:zlib");
var FinanceRolloutError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.statusCode = code === "FINANCE_ROLLOUT_NOT_CONFIGURED" ? 503 : 403;
    this.name = "FinanceRolloutError";
  }
};
var fail = (code = "FINANCE_ROLLOUT_OUT_OF_SCOPE") => {
  throw new FinanceRolloutError(code);
};
var id = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(v);
function operation(command) {
  if (command instanceof import_lib_dynamodb2.GetCommand) return "GetItem";
  if (command instanceof import_lib_dynamodb2.QueryCommand) return "Query";
  if (command instanceof import_lib_dynamodb2.ScanCommand) return "Scan";
  if (command instanceof import_lib_dynamodb2.TransactWriteCommand) return "TransactWriteItems";
  const schema = command?.clientCommand?.schema;
  if (typeof command?.resolveMiddleware === "function" && typeof command?.middlewareStack?.clone === "function" && Array.isArray(schema) && schema[0] === 9 && schema[1] === "com.amazonaws.dynamodb" && ["GetItem", "Query", "Scan", "TransactWriteItems"].includes(schema[2])) return schema[2];
  return fail();
}
function exact(v, fields) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== [...fields].sort().join(","))
    fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
}
function readFinanceRollout(env = process.env) {
  try {
    let raw = env.FINANCE_ROLLOUT_CONFIG;
    if (typeof raw === "string" && raw.startsWith("GZIP208:")) {
      const encoded = raw.slice(8);
      if (encoded.length > 16384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded) fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
      raw = (0, import_node_zlib.gunzipSync)(bytes, { maxOutputLength: 12e3 }).toString("utf8");
    }
    if (typeof raw !== "string" || Buffer.byteLength(raw) > 12e3)
      fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
    const c = JSON.parse(raw);
    exact(c, ["schemaVersion", "accountId", "region", "scopes"]);
    if (c.schemaVersion !== 1 || c.accountId !== "699561669180" || c.region !== "us-east-1" || env.AWS_REGION !== "us-east-1" || (env.STAGE ?? env.ENVIRONMENT) !== "staging" || env.STAGE !== void 0 && env.STAGE !== "staging" || env.ENVIRONMENT !== void 0 && env.ENVIRONMENT !== "staging" || !Array.isArray(c.scopes) || !c.scopes.length || // Match the already deployed archival reader: retain up to eight exact
    // historical scopes. This does not enroll or admit any new test order.
    c.scopes.length > 8 || env.FINANCE_ROLLOUT_SHA256 !== quoteHash(c))
      fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
    const scopes = /* @__PURE__ */ new Set(), orders = /* @__PURE__ */ new Set();
    for (const s of c.scopes) {
      exact(s, ["id", "version", "mode", "admitUntil", "orders", "drivers"]);
      if (!id(s.id) || scopes.has(s.id + "#" + s.version) || !Number.isSafeInteger(s.version) || s.version < 1 || !["SCOPED", "DRAIN"].includes(s.mode) || typeof s.admitUntil !== "string" || !Number.isFinite(Date.parse(s.admitUntil)) || new Date(s.admitUntil).toISOString() !== s.admitUntil || !Array.isArray(s.orders) || !s.orders.length || s.orders.length > 10 || !Array.isArray(s.drivers) || !s.drivers.length || s.drivers.length > 10)
        fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
      scopes.add(s.id + "#" + s.version);
      const drivers = /* @__PURE__ */ new Set(), subjects = /* @__PURE__ */ new Set();
      for (const d of s.drivers) {
        exact(d, ["driverId", "subjectId"]);
        if (!id(d.driverId) || !id(d.subjectId) || drivers.has(d.driverId) || subjects.has(d.subjectId))
          fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
        drivers.add(d.driverId);
        subjects.add(d.subjectId);
      }
      for (const o of s.orders) {
        exact(o, ["orderId", "branchId", "customerSubjectId"]);
        if (![o.orderId, o.branchId, o.customerSubjectId].every(id) || orders.has(o.orderId))
          fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
        orders.add(o.orderId);
      }
    }
    return c;
  } catch (e) {
    if (e instanceof FinanceRolloutError) throw e;
    return fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
  }
}
function createFinanceRollout(options) {
  const { db } = options, config = readFinanceRollout(options.env), now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  if (!["OFF", "REQUIRED"].includes(env.FINANCE_GENERAL_RELEASE_MODE ?? "OFF")) fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
  const general = env.FINANCE_GENERAL_RELEASE_MODE === "REQUIRED";
  if (general && env.FINANCIAL_SETTLEMENT_MODEL !== "FULL_CASH_AT_DELIVERY_V1") fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
  const generalScopes = /* @__PURE__ */ new Map();
  async function registerGeneral(row, creating = false) {
    const oid = row?.orderId, branch = row?.storeId ?? row?.businessId;
    if (!id(oid) || row.PK !== "ORDER#" + oid || row.SK !== "META" || !id(branch) || !id(row.userSub) || [row.storeId, row.businessId].some((v) => v !== void 0 && v !== branch) || row.deletionRequestId != null || row.deletedAt != null || row.isDeleted === true) fail();
    const historical = config.scopes.find((scope) => scope.orders.some((o) => o.orderId === oid));
    if (creating) {
      if (!admission || admission.branchId !== branch || admission.subjectId !== row.userSub || row.financialSnapshot?.schemaVersion !== 3 || row.financialSnapshot?.settlementModel !== "FULL_CASH_AT_DELIVERY_V1") fail();
      const branchRow = (await db.send(new import_lib_dynamodb2.GetCommand({ TableName: "WhizzMerchants_Businesses", Key: { businessId: branch }, ConsistentRead: true }))).Item;
      if (!branchRow || branchRow.businessId !== branch || branchRow.status !== "approved" || branchRow.ownerId !== branchRow.cognitoUserId || branchRow.deletionRequestId != null || branchRow.deletedAt != null || branchRow.isDeleted === true) fail();
    } else if (!historical && (row.financeRollout?.schemaVersion !== 2 || row.financeRollout.scopeId !== "GENERAL_STAGING_FULL_CASH_V1")) fail();
    if (historical) return;
    const member = { orderId: oid, branchId: branch, customerSubjectId: row.userSub };
    generalScopes.set(oid, { scope: { id: "GENERAL_STAGING_FULL_CASH_V1", version: 1, mode: "GENERAL", admitUntil: "9999-12-31T23:59:59.999Z", orders: [member], drivers: [] }, order: member });
  }
  const freeze = (v) => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  freeze(config);
  const recoveryActive = /* @__PURE__ */ new Set();
  const bindings = /* @__PURE__ */ new Map(), orders = /* @__PURE__ */ new Map();
  let admission;
  let activeOrder;
  const link = (table, key) => quoteCanonical([table, key]);
  function selection(orderId2) {
    if (generalScopes.has(orderId2)) return generalScopes.get(orderId2);
    const scope = config.scopes.find(
      (s) => s.orders.some((o) => o.orderId === orderId2)
    );
    if (!scope) return fail();
    return { scope, order: scope.orders.find((o) => o.orderId === orderId2) };
  }
  function open(s) {
    if (general && s.mode === "GENERAL") return;
    if (s.mode !== "SCOPED" || !Number.isSafeInteger(now()) || now() >= Date.parse(s.admitUntil))
      fail("FINANCE_ROLLOUT_ADMISSION_CLOSED");
  }
  async function openExisting(orderId2) {
    if (general && selection(orderId2).scope.mode === "GENERAL") return [];
    const selected = selection(orderId2), saved = orders.get(orderId2);
    if (selected.scope.mode === "SCOPED" && Number.isSafeInteger(now()) && now() < Date.parse(selected.scope.admitUntil)) return [];
    if (!saved?.financeRollout || quoteCanonical(saved.financeRollout) !== quoteCanonical(pin(selected.scope))) fail();
    const guards = await financialRecoveryProof(db, options.env ?? process.env, orderId2, now());
    recoveryActive.add(orderId2);
    return guards;
  }
  function customer(branchId, subjectId) {
    if (!id(branchId) || !id(subjectId) || !Number.isSafeInteger(now())) fail();
    if (general) {
      admission = { branchId, subjectId };
      return config.scopes;
    }
    const matches = config.scopes.filter(
      (s) => s.orders.some(
        (o) => o.branchId === branchId && o.customerSubjectId === subjectId
      )
    );
    if (!matches.length) fail();
    admission = { branchId, subjectId };
    return matches;
  }
  function admit(branchId, subjectId) {
    const matches = customer(branchId, subjectId);
    if (general) return;
    if (!matches.some(
      (s) => s.mode === "SCOPED" && now() < Date.parse(s.admitUntil)
    ))
      fail("FINANCE_ROLLOUT_ADMISSION_CLOSED");
  }
  function driver(orderId2, driverId, subjectId) {
    if (general && selection(orderId2).scope.mode === "GENERAL") {
      if (!id(driverId) || subjectId !== void 0 && !id(subjectId)) fail();
      return;
    }
    if (!selection(orderId2).scope.drivers.some(
      (d) => d.driverId === driverId && (subjectId === void 0 || d.subjectId === subjectId)
    ))
      fail();
  }
  function subject(orderId2, subjectId) {
    if (general && selection(orderId2).scope.mode === "GENERAL") {
      if (!id(subjectId)) fail();
      return;
    }
    if (!selection(orderId2).scope.drivers.some((d) => d.subjectId === subjectId)) fail();
  }
  function pin(s) {
    if (s.mode === "GENERAL") return { schemaVersion: 2, scopeId: s.id, version: s.version, digest: quoteHash({ release: s.id, version: s.version, orders: s.orders }) };
    return {
      schemaVersion: 1,
      scopeId: s.id,
      version: s.version,
      digest: quoteHash({
        id: s.id,
        version: s.version,
        orders: s.orders,
        drivers: s.drivers
      })
    };
  }
  function validate(row, orderId2) {
    const s = selection(orderId2), o = s.order;
    if (!row || row.orderId !== orderId2 || row.PK !== "ORDER#" + orderId2 || row.SK !== "META" || row.userSub !== o.customerSubjectId || !(row.storeId === o.branchId || row.businessId === o.branchId) || [row.storeId, row.businessId].some(
      (v) => v !== void 0 && v !== o.branchId
    ))
      fail();
    if (row.financeRollout !== void 0 && quoteCanonical(row.financeRollout) !== quoteCanonical(pin(s.scope)))
      fail();
    checkDrivers(orderId2, row);
    orders.set(orderId2, JSON.parse(JSON.stringify(row)));
    activeOrder = orderId2;
    return s;
  }
  async function order(orderId2, intent = "DRAIN") {
    if (!general) selection(orderId2);
    const r = await db.send(
      new import_lib_dynamodb2.GetCommand({
        TableName: "WizzOrders",
        Key: { PK: "ORDER#" + orderId2, SK: "META" },
        ConsistentRead: true,
        ProjectionExpression: general ? "PK,SK,orderId,userSub,storeId,businessId,financeRollout,driverId,assignedDriverId,deletionRequestId,deletedAt,isDeleted" : "PK,SK,orderId,userSub,storeId,businessId,financeRollout,driverId,assignedDriverId"
      })
    );
    if (general) await registerGeneral(r.Item ?? {});
    const s = selection(orderId2);
    validate(r.Item ?? {}, orderId2);
    if (!["DRAIN", "NOTIFY"].includes(intent)) await openExisting(orderId2);
    if (["SEND", "NOTIFY"].includes(intent) && !r.Item?.financeRollout) fail();
    return s;
  }
  function orderId(row) {
    if (!row) return;
    const pk = typeof row.PK === "string" && row.PK.startsWith("ORDER#") ? row.PK.slice(6) : void 0;
    if (row.orderId !== void 0 && pk !== void 0 && row.orderId !== pk)
      fail();
    return typeof row.orderId === "string" ? row.orderId : pk ?? (typeof row.metadata?.orderId === "string" ? row.metadata.orderId : void 0);
  }
  function checkDrivers(oid, row) {
    const branch = selection(oid).order.branchId;
    for (const k of ["branchId", "businessId", "storeId", "restaurantId"])
      if (row[k] != null && row[k] !== branch) fail();
    for (const k of ["driverId", "assignedDriverId", "dispatchDriverId", "financialDriverId"])
      if (row[k] != null) driver(oid, row[k]);
    if (row.driverSubjectId != null) driver(oid, row.driverId, row.driverSubjectId);
    if (row.financialOffer) {
      const envelope = row.financialOffer, offer = [2, 3].includes(envelope.schemaVersion) ? envelope.baseOffer : envelope;
      if (!(general ? [1, 2, 3] : [1, 2]).includes(envelope.schemaVersion) || !offer || offer.schemaVersion !== 1 || !id(offer.driverId) || !id(offer.driverSubjectId) || offer.orderId !== oid || offer.branchId !== branch || row.driverId != null && row.driverId !== offer.driverId) fail();
      driver(oid, offer.driverId, offer.driverSubjectId);
    }
    if (Array.isArray(row.driverIds))
      for (const d of row.driverIds) driver(oid, d);
  }
  function fence(oid) {
    const row = orders.get(oid);
    if (!row) return fail();
    const names = {}, values = {}, clauses = [];
    for (const [i, k] of [
      "orderId",
      "userSub",
      "storeId",
      "businessId",
      "financeRollout",
      "driverId",
      "assignedDriverId"
    ].entries()) {
      names["#roll" + i] = k;
      if (row[k] === void 0)
        clauses.push("attribute_not_exists(#roll" + i + ")");
      else {
        values[":roll" + i] = row[k];
        clauses.push("#roll" + i + "=:roll" + i);
      }
    }
    return {
      TableName: "WizzOrders",
      Key: { PK: row.PK, SK: row.SK },
      ConditionExpression: clauses.join(" AND "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    };
  }
  const cursor = (op) => op.TableName === "WizzDispatchJobs_staging" && (op.Item ?? op.Key)?.orderId === "SYSTEM#DISPATCH_HOST" && ((op.Item ?? op.Key)?.SK === "CURSOR#LEGACY" || (options.env ?? process.env).DISPATCH_FINANCIAL_HOST_MODE === "REQUIRED" && (op.Item ?? op.Key)?.SK === "CURSOR#FINANCIAL") || op.TableName === "staging-PlatformStaff" && (op.Item ?? op.Key)?.pk === "CONTROL#DISPATCH_REVIEW_HOST" && (op.Item ?? op.Key)?.sk === "CURSOR";
  const scoped = {
    send: (async (command) => {
      const q = command.input;
      const opType = operation(command);
      if (opType === "TransactWriteItems") {
        let items = JSON.parse(JSON.stringify(q.TransactItems));
        const recoveryGuards = [];
        const ids = /* @__PURE__ */ new Set();
        let quoteOnly = false, newOrder = false;
        for (const a of items) {
          const op = a.ConditionCheck ?? a.Put ?? a.Update ?? a.Delete;
          if (!op) fail();
          const oid2 = orderId(op.Key ?? op.Item) ?? (op.Key ? bindings.get(link(op.TableName, op.Key)) : void 0);
          if (oid2 && oid2 !== "SYSTEM#DISPATCH_HOST") {
            if (general && !generalScopes.has(oid2) && !config.scopes.some((s) => s.orders.some((o) => o.orderId === oid2))) {
              if (a.Put && op.TableName === "WizzOrders") await registerGeneral(op.Item, true);
              else await order(oid2);
            }
            selection(oid2);
            ids.add(oid2);
            checkDrivers(oid2, op.Item ?? {});
            if (a.Put && (op.TableName === "WaveOffers_staging" || op.TableName === "WizzDispatchJobs_staging" && (op.Item.SK === "METADATA" || [
              "DISPATCH_WAVE",
              "FINANCIAL_WAVE",
              "DISPATCH_RESTART_START"
            ].includes(op.Item.kind)))) {
              if (!orders.has(oid2)) await order(oid2);
              await openExisting(oid2);
            }
            if (op.TableName === "WizzOrders" && a.Put) {
              const s = validate(op.Item, oid2);
              open(s.scope);
              op.Item.financeRollout = pin(s.scope);
              newOrder = true;
            }
          }
          if (a.Put && op.TableName === "staging-DeliveryQuotes") {
            if (!admission || op.Item.branchId !== admission.branchId || op.Item.subjectId !== admission.subjectId)
              fail();
            admit(op.Item.branchId, op.Item.subjectId);
            quoteOnly = true;
          }
        }
        if (ids.size > 1) fail();
        for (const oid2 of ids) if (recoveryActive.has(oid2)) recoveryGuards.push(...await openExisting(oid2));
        if (ids.size === 1 && !newOrder) {
          const oid2 = [...ids][0];
          if (!orders.has(oid2)) await order(oid2);
          const f = fence(oid2), a = items.find((a2) => {
            const op = a2.ConditionCheck ?? a2.Update ?? a2.Put ?? a2.Delete;
            return op.TableName === "WizzOrders" && orderId(op.Key ?? op.Item) === oid2;
          });
          if (a) {
            let op = a.ConditionCheck ?? a.Update ?? a.Put ?? a.Delete;
            if (Object.keys(op.ExpressionAttributeNames ?? {}).some(
              (k) => k.startsWith("#roll")
            ) || Object.keys(op.ExpressionAttributeValues ?? {}).some(
              (k) => k.startsWith(":roll")
            ))
              fail();
            op.ConditionExpression = op.ConditionExpression ? "(" + op.ConditionExpression + ") AND (" + f.ConditionExpression + ")" : f.ConditionExpression;
            op.ExpressionAttributeNames = {
              ...op.ExpressionAttributeNames,
              ...f.ExpressionAttributeNames
            };
            op.ExpressionAttributeValues = {
              ...op.ExpressionAttributeValues,
              ...f.ExpressionAttributeValues
            };
          } else items.push({ ConditionCheck: f });
          if (!orders.get(oid2).financeRollout) {
            open(selection(oid2).scope);
            if (!items.some((x) => x.Put?.TableName === "WizzDispatchJobs_staging" && x.Put.Item?.orderId === oid2 && x.Put.Item?.SK === "METADATA")) fail();
            const target = items.find((x) => {
              const op2 = x.ConditionCheck ?? x.Update ?? x.Put ?? x.Delete;
              return op2.TableName === "WizzOrders" && orderId(op2.Key ?? op2.Item) === oid2;
            });
            if (target.Delete) fail();
            if (target.ConditionCheck) {
              target.Update = {
                ...target.ConditionCheck,
                UpdateExpression: "SET #rollPin=:rollPin"
              };
              delete target.ConditionCheck;
            } else if (target.Update) {
              target.Update.UpdateExpression = /^SET\s/.test(
                target.Update.UpdateExpression
              ) ? target.Update.UpdateExpression.replace(
                /^SET\s/,
                "SET #rollPin=:rollPin, "
              ) : "SET #rollPin=:rollPin " + target.Update.UpdateExpression;
            }
            const op = target.Update;
            op.ExpressionAttributeNames = {
              ...op.ExpressionAttributeNames,
              "#rollPin": "financeRollout"
            };
            op.ExpressionAttributeValues = {
              ...op.ExpressionAttributeValues,
              ":rollPin": pin(selection(oid2).scope)
            };
          }
        } else if (!ids.size) {
          if (!quoteOnly && !items.every(
            (a) => a.ConditionCheck && (admission !== void 0 || cursor(a.ConditionCheck)) || cursor(a.Put ?? a.Update ?? {})
          ))
            fail();
          if (quoteOnly && items.some(
            (a) => !a.ConditionCheck && a.Put?.TableName !== "staging-DeliveryQuotes"
          ))
            fail();
        }
        if (items.length > 100 || items.some(
          (a) => Buffer.byteLength(
            (a.ConditionCheck ?? a.Update ?? a.Put ?? a.Delete).ConditionExpression ?? ""
          ) > 4e3
        ))
          fail();
        if (recoveryGuards.length) items = composeDispatchTransaction(items, recoveryGuards);
        return db.send(
          new import_lib_dynamodb2.TransactWriteCommand({ ...q, TransactItems: items })
        );
      }
      const oid = orderId(q.Key);
      if (oid && oid !== "SYSTEM#DISPATCH_HOST" && !general) selection(oid);
      const result = await db.send(command);
      if (opType === "GetItem" && result.Item) {
        const row = result.Item;
        if (q.TableName === "staging-DeliveryQuotes")
          customer(row.branchId, row.subjectId);
        const found = orderId(row) ?? oid;
        if (found && found !== "SYSTEM#DISPATCH_HOST") {
          bindings.set(link(q.TableName, q.Key), found);
          if (general && !generalScopes.has(found) && !config.scopes.some((s) => s.orders.some((o) => o.orderId === found))) {
            if (q.TableName === "WizzOrders" && !q.ProjectionExpression) await registerGeneral(row);
            else await order(found);
          }
          selection(found);
          if (q.TableName === "WizzOrders") {
            if (q.ProjectionExpression) await order(found);
            else validate(row, found);
          } else {
            if (!orders.has(found)) await order(found);
            checkDrivers(found, row);
          }
        }
      }
      if ((opType === "Query" || opType === "Scan") && ["WizzDriverLiveState_staging", "WhizzDrivers_staging"].includes(
        q.TableName
      ) && Array.isArray(result.Items)) {
        if (general) return result;
        const selectedOrder = activeOrder ?? fail();
        const allowed = new Set(
          selection(selectedOrder).scope.drivers.map((d) => d.driverId)
        );
        return {
          ...result,
          Items: result.Items.filter((r) => allowed.has(r.driverId))
        };
      }
      return result;
    })
  };
  return {
    db: scoped,
    admit,
    customer,
    order,
    driver,
    subject,
    config,
    containsOrder: (oid, row) => general && id(oid) && (row?.financialSnapshot != null || row?.commercialPricing != null) || config.scopes.some((s) => s.orders.some((o) => o.orderId === oid))
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FinanceRolloutError,
  createFinanceRollout,
  readFinanceRollout
});
