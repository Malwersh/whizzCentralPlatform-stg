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

// backend/wallet-service/src/merchantAccountIndexRuntime.ts
var merchantAccountIndexRuntime_exports = {};
__export(merchantAccountIndexRuntime_exports, {
  quoteHash: () => quoteHash,
  readMerchantAccrualIndexPage: () => readMerchantAccrualIndexPage,
  readMerchantAccrualRange: () => readMerchantAccrualRange
});
module.exports = __toCommonJS(merchantAccountIndexRuntime_exports);

// backend/wallet-service/src/merchantAccrualIndex.ts
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
var detach = (v) => JSON.parse(JSON.stringify(v));
var equal = (a, b) => quoteCanonical(a) === quoteCanonical(b);
async function strongGet(db, TableName, Key) {
  return detach((await db.send(new import_lib_dynamodb.GetCommand({ TableName, Key, ConsistentRead: true }))).Item ?? null);
}

// backend/wallet-service/src/merchantAccrualIndex.ts
var MERCHANT_ACCRUAL_INDEX_TABLE = "staging-MerchantPlatform";
var merchantAccrualPartition = (branchId) => "MERCHANT_ACCRUAL#" + branchId;
var fail = (code = "SETTLEMENT_ACCRUAL_INDEX_INVALID") => {
  throw Object.assign(Error(code), { code });
};
var iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function merchantAccrualIndexRow(v) {
  if (Object.keys(v).sort().join(",") !== "branchId,deliveredAt,financialSchemaVersion,merchantNetIqd,operationId,orderId") return fail();
  if (![v.branchId, v.orderId, v.operationId].every(quoteEntityIdValid) || !iso(v.deliveredAt) || !Number.isSafeInteger(v.merchantNetIqd) || v.merchantNetIqd < 0 || ![2, 3, 4, 5].includes(v.financialSchemaVersion)) return fail();
  const content = { schemaVersion: 1, kind: "MERCHANT_ACCRUAL_INDEX_ENTRY", ...v, retentionClass: "FINANCIAL_SETTLEMENT" };
  return { pk: merchantAccrualPartition(v.branchId), sk: "DELIVERED#" + v.deliveredAt + "#" + v.orderId, ...content, digest: quoteHash(content) };
}
function validateMerchantAccrualIndexRow(row, branchId) {
  if (!row || row.branchId !== branchId || !equal(row, merchantAccrualIndexRow({ branchId: row.branchId, orderId: row.orderId, operationId: row.operationId, deliveredAt: row.deliveredAt, merchantNetIqd: row.merchantNetIqd, financialSchemaVersion: row.financialSchemaVersion }))) return fail();
  return row;
}
function validateMerchantAccrualIndexHead(row, branchId, sk = "HEAD") {
  if (row === null) return null;
  if (!row || Object.keys(row).sort().join(",") !== "branchId,kind,pk,retentionClass,revision,schemaVersion,sk,updatedAt" || row.pk !== merchantAccrualPartition(branchId) || row.sk !== sk || row.branchId !== branchId || row.kind !== "MERCHANT_ACCRUAL_INDEX_HEAD" || row.schemaVersion !== 1 || row.retentionClass !== "FINANCIAL_SETTLEMENT" || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision >= Number.MAX_SAFE_INTEGER || !iso(row.updatedAt)) return fail();
  return row;
}
var DAY = 864e5;
var DEPTH = 9;
var SPAN = 4 ** DEPTH;
function day(at) {
  if (!iso(at)) return fail();
  const n = Math.floor((Date.parse(at) + 108e5) / DAY);
  if (n < 0 || n >= SPAN) return fail("SETTLEMENT_ACCRUAL_INDEX_DATE_UNSUPPORTED");
  return n;
}
var node = (level, slot) => level === 0 ? "HEAD" : "NODE#" + level + "#" + slot;
function merchantAccrualRangeNodes(fromUtc, untilExclusiveUtc) {
  if (!iso(fromUtc) || !iso(untilExclusiveUtc) || fromUtc >= untilExclusiveUtc) return fail();
  const first = day(fromUtc), last = day(new Date(Date.parse(untilExclusiveUtc) - 1).toISOString()), nodes = [];
  function visit(level, slot, start, size) {
    if (start > last || start + size <= first) return;
    if (first <= start && start + size - 1 <= last) {
      nodes.push(node(level, slot));
      return;
    }
    for (let c = 0; c < 4; c++) visit(level + 1, slot * 4 + c, start + c * size / 4, size / 4);
  }
  visit(0, 0, 0, SPAN);
  if (nodes.length > 54) return fail();
  return nodes;
}
async function readMerchantAccrualRange(db, branchId, fromUtc, untilExclusiveUtc) {
  if (!quoteEntityIdValid(branchId)) return fail();
  return Promise.all(merchantAccrualRangeNodes(fromUtc, untilExclusiveUtc).map(async (sk) => {
    const key = { pk: merchantAccrualPartition(branchId), sk }, row = validateMerchantAccrualIndexHead(await strongGet(db, MERCHANT_ACCRUAL_INDEX_TABLE, key), branchId, sk);
    return { key, row };
  }));
}
async function readMerchantAccrualIndexPage(db, v) {
  if (!quoteEntityIdValid(v.branchId) || !iso(v.fromUtc) || !iso(v.untilExclusiveUtc) || v.fromUtc >= v.untilExclusiveUtc) return fail();
  const pk = merchantAccrualPartition(v.branchId), validKey = (k) => k && Object.keys(k).sort().join(",") === "pk,sk" && k.pk === pk && typeof k.sk === "string" && k.sk.startsWith("DELIVERED#") && k.sk >= "DELIVERED#" + v.fromUtc && k.sk < "DELIVERED#" + v.untilExclusiveUtc;
  if (v.key && !validKey(v.key)) return fail("SETTLEMENT_ACCRUAL_INDEX_CURSOR_INVALID");
  const page = await db.send(new import_lib_dynamodb2.QueryCommand({ TableName: MERCHANT_ACCRUAL_INDEX_TABLE, ConsistentRead: true, KeyConditionExpression: "pk=:pk AND sk BETWEEN :from AND :until", ExpressionAttributeValues: { ":pk": pk, ":from": "DELIVERED#" + v.fromUtc, ":until": "DELIVERED#" + v.untilExclusiveUtc }, Limit: 10, ScanIndexForward: true, ...v.key ? { ExclusiveStartKey: v.key } : {} }));
  const seen = /* @__PURE__ */ new Set();
  for (const row of page.Items || []) {
    validateMerchantAccrualIndexRow(row, v.branchId);
    if (!validKey({ pk: row.pk, sk: row.sk }) || seen.has(row.orderId)) return fail();
    seen.add(row.orderId);
  }
  if (page.LastEvaluatedKey && !validKey(page.LastEvaluatedKey)) return fail();
  return { items: page.Items || [], nextKey: page.LastEvaluatedKey || null };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  quoteHash,
  readMerchantAccrualIndexPage,
  readMerchantAccrualRange
});
