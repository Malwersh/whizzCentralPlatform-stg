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

// backend/wallet-service/src/financeRollout.ts
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
  if (command instanceof import_lib_dynamodb.GetCommand) return "GetItem";
  if (command instanceof import_lib_dynamodb.QueryCommand) return "Query";
  if (command instanceof import_lib_dynamodb.ScanCommand) return "Scan";
  if (command instanceof import_lib_dynamodb.TransactWriteCommand) return "TransactWriteItems";
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
    const raw = env.FINANCE_ROLLOUT_CONFIG;
    if (typeof raw !== "string" || Buffer.byteLength(raw) > 12e3)
      fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
    const c = JSON.parse(raw);
    exact(c, ["schemaVersion", "accountId", "region", "scopes"]);
    if (c.schemaVersion !== 1 || c.accountId !== "699561669180" || c.region !== "us-east-1" || env.AWS_REGION !== "us-east-1" || (env.STAGE ?? env.ENVIRONMENT) !== "staging" || env.STAGE !== void 0 && env.STAGE !== "staging" || env.ENVIRONMENT !== void 0 && env.ENVIRONMENT !== "staging" || !Array.isArray(c.scopes) || !c.scopes.length || c.scopes.length > 4 || env.FINANCE_ROLLOUT_SHA256 !== quoteHash(c))
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
  const freeze = (v) => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  freeze(config);
  const bindings = /* @__PURE__ */ new Map(), orders = /* @__PURE__ */ new Map();
  let admission;
  let activeOrder;
  const link = (table, key) => quoteCanonical([table, key]);
  function selection(orderId2) {
    const scope = config.scopes.find(
      (s) => s.orders.some((o) => o.orderId === orderId2)
    );
    if (!scope) return fail();
    return { scope, order: scope.orders.find((o) => o.orderId === orderId2) };
  }
  function open(s) {
    if (s.mode !== "SCOPED" || !Number.isSafeInteger(now()) || now() >= Date.parse(s.admitUntil))
      fail("FINANCE_ROLLOUT_ADMISSION_CLOSED");
  }
  function customer(branchId, subjectId) {
    if (!id(branchId) || !id(subjectId) || !Number.isSafeInteger(now())) fail();
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
    if (!matches.some(
      (s) => s.mode === "SCOPED" && now() < Date.parse(s.admitUntil)
    ))
      fail("FINANCE_ROLLOUT_ADMISSION_CLOSED");
  }
  function driver(orderId2, driverId, subjectId) {
    if (!selection(orderId2).scope.drivers.some(
      (d) => d.driverId === driverId && (subjectId === void 0 || d.subjectId === subjectId)
    ))
      fail();
  }
  function subject(orderId2, subjectId) {
    if (!selection(orderId2).scope.drivers.some((d) => d.subjectId === subjectId)) fail();
  }
  function pin(s) {
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
    const s = selection(orderId2);
    if (!["DRAIN", "NOTIFY"].includes(intent)) open(s.scope);
    const r = await db.send(
      new import_lib_dynamodb.GetCommand({
        TableName: "WizzOrders",
        Key: { PK: "ORDER#" + orderId2, SK: "META" },
        ConsistentRead: true,
        ProjectionExpression: "PK,SK,orderId,userSub,storeId,businessId,financeRollout,driverId,assignedDriverId"
      })
    );
    validate(r.Item ?? {}, orderId2);
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
    if (row.financialOffer) driver(oid, row.financialOffer.driverId, row.financialOffer.driverSubjectId);
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
  const cursor = (op) => op.TableName === "WizzDispatchJobs_staging" && (op.Item ?? op.Key)?.orderId === "SYSTEM#DISPATCH_HOST" && (op.Item ?? op.Key)?.SK === "CURSOR#LEGACY" || op.TableName === "staging-PlatformStaff" && (op.Item ?? op.Key)?.pk === "CONTROL#DISPATCH_REVIEW_HOST" && (op.Item ?? op.Key)?.sk === "CURSOR";
  const scoped = {
    send: (async (command) => {
      const q = command.input;
      const opType = operation(command);
      if (opType === "TransactWriteItems") {
        const items = JSON.parse(JSON.stringify(q.TransactItems)), ids = /* @__PURE__ */ new Set();
        let quoteOnly = false, newOrder = false;
        for (const a of items) {
          const op = a.ConditionCheck ?? a.Put ?? a.Update ?? a.Delete;
          if (!op) fail();
          const oid2 = orderId(op.Key ?? op.Item) ?? (op.Key ? bindings.get(link(op.TableName, op.Key)) : void 0);
          if (oid2 && oid2 !== "SYSTEM#DISPATCH_HOST") {
            selection(oid2);
            ids.add(oid2);
            checkDrivers(oid2, op.Item ?? {});
            if (a.Put && (op.TableName === "WaveOffers_staging" || op.TableName === "WizzDispatchJobs_staging" && (op.Item.SK === "METADATA" || [
              "DISPATCH_WAVE",
              "FINANCIAL_WAVE",
              "DISPATCH_RESTART_START"
            ].includes(op.Item.kind))))
              open(selection(oid2).scope);
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
        return db.send(
          new import_lib_dynamodb.TransactWriteCommand({ ...q, TransactItems: items })
        );
      }
      const oid = orderId(q.Key);
      if (oid && oid !== "SYSTEM#DISPATCH_HOST") selection(oid);
      const result = await db.send(command);
      if (opType === "GetItem" && result.Item) {
        const row = result.Item;
        if (q.TableName === "staging-DeliveryQuotes")
          customer(row.branchId, row.subjectId);
        const found = orderId(row) ?? oid;
        if (found && found !== "SYSTEM#DISPATCH_HOST") {
          bindings.set(link(q.TableName, q.Key), found);
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
    containsOrder: (oid) => config.scopes.some((s) => s.orders.some((o) => o.orderId === oid))
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FinanceRolloutError,
  createFinanceRollout,
  readFinanceRollout
});
