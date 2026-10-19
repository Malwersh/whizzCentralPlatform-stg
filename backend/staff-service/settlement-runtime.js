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
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// backend/staff-service/write-workflow.js
var require_write_workflow = __commonJS({
  "backend/staff-service/write-workflow.js"(exports2, module2) {
    "use strict";
    var direct = () => process.env.PLATFORM_ENVIRONMENT === "staging" && process.env.PLATFORM_WRITE_MODE === "DIRECT";
    var operator = (person) => direct() && person?.status === "ACTIVE" && (process.env.PLATFORM_DIRECT_OPERATOR_IDS || "").split(",").includes(person.employeeId);
    module2.exports = { direct, operator };
  }
});

// backend/staff-service/catalog.js
var require_catalog = __commonJS({
  "backend/staff-service/catalog.js"(exports2, module2) {
    "use strict";
    var ROLES = {
      commercial_viewer: ["commercial.read"],
      commercial_editor: ["commercial.read", "commercial.request", "commercial.funding.request"],
      commercial_approver: ["commercial.read", "commercial.approve", "commercial.funding.approve"],
      pricing_viewer: ["pricing.read", "pricing.simulate"],
      pricing_editor: ["pricing.read", "pricing.simulate", "pricing.request"],
      pricing_approver: ["pricing.read", "pricing.simulate", "pricing.approve"],
      merchant_staff_policy_manager: ["merchant_staff_policy.read", "merchant_staff_policy.manage"],
      settings_viewer: ["settings.read"],
      settings_manager: ["settings.read", "settings.change.request"],
      settings_approver: ["settings.read", "settings.change.approve"],
      staff_manager: ["staff.read", "staff.invite", "staff.change.request"],
      staff_approver: ["staff.read", "staff.change.approve"],
      customer_service: ["support.read", "support.reply", "customers.read", "orders.read"],
      support_supervisor: ["support.read", "support.reply", "support.assign", "support.close", "support.metrics", "customers.read", "orders.read"],
      driver_manager: ["drivers.read", "drivers.edit", "orders.read"],
      driver_reviewer: ["drivers.read", "drivers.documents.read", "drivers.review", "drivers.suspend"],
      merchant_manager: ["merchants.read", "merchants.edit", "products.read", "products.edit"],
      merchant_reviewer: ["merchants.read", "merchants.documents.read", "merchants.review", "merchants.suspend"],
      operations: ["orders.read", "orders.assign", "orders.cancel", "drivers.read", "merchants.read"],
      region_manager: ["regions.read", "regions.edit", "regions.activate"],
      promotions_manager: ["promotions.read", "promotions.create", "promotions.edit"],
      promotions_approver: ["promotions.read", "promotions.approve"],
      finance_viewer: ["finance.read"],
      finance_operator: ["finance.read", "finance.request", "finance.topup.review"],
      finance_approver: ["finance.read", "finance.approve"],
      finance_settings: ["finance.read", "finance.settings.request"],
      finance_settings_approver: ["finance.read", "finance.settings.approve"],
      auditor: ["audit.read", "reports.read", "audit.export"],
      platform_manager: ["dashboard.read", "reports.read", "drivers.read", "merchants.read", "customers.read", "orders.read", "regions.read", "promotions.read", "staff.read"]
    };
    var LABELS = { commercial_viewer: "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0627\u062A\u0641\u0627\u0642\u064A\u0627\u062A \u0648\u0627\u0644\u062A\u0645\u0648\u064A\u0644", commercial_editor: "\u0625\u0639\u062F\u0627\u062F \u0627\u0644\u0627\u062A\u0641\u0627\u0642\u064A\u0627\u062A \u0648\u0627\u0644\u062A\u0645\u0648\u064A\u0644", commercial_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0627\u062A\u0641\u0627\u0642\u064A\u0627\u062A \u0648\u0627\u0644\u062A\u0645\u0648\u064A\u0644", pricing_viewer: "\u0642\u0631\u0627\u0621\u0629 \u0648\u0645\u062D\u0627\u0643\u0627\u0629 \u0627\u0644\u062A\u0633\u0639\u064A\u0631", pricing_editor: "\u0625\u0639\u062F\u0627\u062F \u0642\u0648\u0627\u0639\u062F \u0627\u0644\u062A\u0633\u0639\u064A\u0631", pricing_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0648\u0646\u0634\u0631 \u0627\u0644\u062A\u0633\u0639\u064A\u0631", merchant_staff_policy_manager: "\u0625\u062F\u0627\u0631\u0629 \u0633\u064A\u0627\u0633\u0629 \u0635\u0644\u0627\u062D\u064A\u0627\u062A \u0645\u0648\u0638\u0641\u064A \u0627\u0644\u062A\u062C\u0627\u0631", settings_viewer: "\u0645\u0634\u0627\u0647\u062F \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A\u0629", settings_manager: "\u0627\u0642\u062A\u0631\u0627\u062D \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u062A\u0634\u063A\u064A\u0644\u064A\u0629", settings_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u062A\u0634\u063A\u064A\u0644\u064A\u0629", staff_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0648\u0638\u0641\u064A\u0646", staff_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A", customer_service: "\u062E\u062F\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621", support_supervisor: "\u0645\u0634\u0631\u0641 \u0627\u0644\u062F\u0639\u0645", driver_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0633\u0627\u0626\u0642\u064A\u0646", driver_reviewer: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0633\u0627\u0626\u0642\u064A\u0646", merchant_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u062A\u0627\u062C\u0631", merchant_reviewer: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0645\u062A\u0627\u062C\u0631", operations: "\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A", region_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0627\u0637\u0642", promotions_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0639\u0631\u0648\u0636", promotions_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0639\u0631\u0648\u0636", finance_viewer: "\u0645\u0634\u0627\u0647\u062F \u0645\u0627\u0644\u064A", finance_operator: "\u0639\u0645\u0644\u064A\u0627\u062A \u0645\u0627\u0644\u064A\u0629", finance_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0645\u0627\u0644\u064A", finance_settings: "\u0627\u0642\u062A\u0631\u0627\u062D \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0645\u0627\u0644\u064A\u0629", finance_settings_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0645\u0627\u0644\u064A\u0629", auditor: "\u0645\u062F\u0642\u0642", platform_manager: "\u0625\u0634\u0631\u0627\u0641 \u0627\u0644\u0645\u0646\u0635\u0629" };
    ROLES.bootstrap_admin = [...new Set(Object.values(ROLES).flat())];
    LABELS.bootstrap_admin = "\u0645\u062F\u064A\u0631 \u0627\u0644\u062A\u0623\u0633\u064A\u0633 \u0627\u0644\u062D\u0627\u0644\u064A";
    function effective(employee) {
      if (!employee || employee.status !== "ACTIVE") return [];
      if (require_write_workflow().operator?.(employee)) return [...ROLES.bootstrap_admin];
      return [...new Set((employee.roles || []).flatMap((role) => Object.hasOwn(ROLES, role) ? ROLES[role] : []))];
    }
    function allowed3(employee, permission, regionId) {
      if (!effective(employee).includes(permission)) return false;
      if (regionId === void 0) return true;
      return employee.scope?.allRegions === true || typeof regionId === "string" && employee.scope?.regionIds?.includes(regionId);
    }
    function validateAssignment(input) {
      if (!Array.isArray(input.roles) || input.roles.length < 1 || input.roles.length > 10 || input.roles.some((r) => !Object.hasOwn(ROLES, r) || r === "bootstrap_admin")) throw Error("INVALID_ROLES");
      if (!["ACTIVE", "SUSPENDED"].includes(input.status)) throw Error("INVALID_STATUS");
      if (!input.scope || typeof input.scope.allRegions !== "boolean" || !Array.isArray(input.scope.regionIds) || input.scope.regionIds.length > 100 || input.scope.regionIds.some((r) => typeof r !== "string" || r.length < 1 || r.length > 100)) throw Error("INVALID_SCOPE");
      if (!input.scope.allRegions && input.scope.regionIds.length === 0) throw Error("REGION_SCOPE_REQUIRED");
      if (!Number.isSafeInteger(input.approvalLimit) || input.approvalLimit < 0 || input.approvalLimit > 1e9) throw Error("INVALID_APPROVAL_LIMIT");
      if (input.roles.some((r) => ["commercial_viewer", "commercial_editor", "commercial_approver", "pricing_viewer", "pricing_editor", "pricing_approver", "merchant_staff_policy_manager", "settings_viewer", "settings_manager", "settings_approver", "staff_manager", "staff_approver", "finance_viewer", "finance_operator", "finance_approver", "finance_settings", "finance_settings_approver", "auditor"].includes(r)) && !input.scope.allRegions) throw Error("GLOBAL_ROLE_REQUIRES_GLOBAL_SCOPE");
      return { roles: [...new Set(input.roles)], status: input.status, scope: { allRegions: input.scope.allRegions, regionIds: [...new Set(input.scope.regionIds)] }, approvalLimit: input.approvalLimit };
    }
    module2.exports = { ROLES, LABELS, effective, allowed: allowed3, validateAssignment };
  }
});

// backend/wallet-service/src/merchantSettlementAdminRuntime.ts
var merchantSettlementAdminRuntime_exports = {};
__export(merchantSettlementAdminRuntime_exports, {
  createMerchantSettlementAuthority: () => createMerchantSettlementAuthority,
  createMerchantSettlementScheduleWorkflow: () => createMerchantSettlementScheduleWorkflow
});
module.exports = __toCommonJS(merchantSettlementAdminRuntime_exports);

// backend/wallet-service/src/merchantSettlementAuthority.ts
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

// backend/wallet-service/src/merchantSettlementAuthority.ts
var { allowed } = require_catalog();
var fail = (code) => {
  throw Object.assign(Error(code), { code });
};
async function readMerchantDeletionFence(db, key2) {
  return (await db.send(new import_lib_dynamodb2.GetCommand({
    TableName: "staging-AccountDeletion",
    Key: key2,
    ConsistentRead: true,
    ProjectionExpression: "#pk,#sk",
    ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" }
  }))).Item || null;
}
function createMerchantSettlementAuthority(options) {
  const principal = detach(options.principal), now = options.now || Date.now;
  if (!principal || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(principal.employeeId) || !Number.isSafeInteger(principal.authTime) || principal.authTime < 0 || typeof principal.mfaEnrolled !== "boolean") return fail("SETTLEMENT_VERIFIED_PRINCIPAL_REQUIRED");
  return async (branchId, action) => {
    if (!quoteEntityIdValid(branchId) || !["READ", "CREATE"].includes(action)) return fail("INVALID_SETTLEMENT_AUTHORIZATION");
    const key2 = { pk: "EMPLOYEE#" + principal.employeeId, sk: "PROFILE" };
    const employee = await strongGet(options.db, "staging-PlatformStaff", key2);
    const age = Math.floor(now() / 1e3) - principal.authTime;
    if (!employee || employee.employeeId !== principal.employeeId || employee.status !== "ACTIVE" || !Number.isSafeInteger(employee.version) || employee.version < 1 || employee.deletionRequestId != null || employee.deletedAt != null || employee.isDeleted === true || employee.minimumAuthTime !== void 0 && (!Number.isSafeInteger(employee.minimumAuthTime) || employee.minimumAuthTime < 0) || (employee.minimumAuthTime || 0) > principal.authTime || age < -30 || employee.mfaRequired === true && !principal.mfaEnrolled) return fail("SETTLEMENT_EMPLOYEE_UNAVAILABLE");
    if (action === "CREATE" && age > 300) return fail("SETTLEMENT_REAUTH_REQUIRED");
    if (employee.scope?.allRegions !== true || !allowed(employee, "finance.read") || action === "CREATE" && !allowed(employee, "finance.request")) return fail("SETTLEMENT_PERMISSION_REQUIRED");
    const branch = await strongGet(options.db, "WhizzMerchants_Businesses", { businessId: branchId });
    if (!branch || branch.businessId !== branchId || branch.status !== "approved" || !quoteEntityIdValid(branch.ownerId) || branch.ownerId !== branch.cognitoUserId || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail("SETTLEMENT_BRANCH_UNAVAILABLE");
    for (const pk of ["BUSINESS_LIFECYCLE#MERCHANT#" + branchId, "ACCOUNT_LIFECYCLE#MERCHANT#" + branch.ownerId]) {
      if (await readMerchantDeletionFence(options.db, { pk, sk: "META" })) return fail("SETTLEMENT_BRANCH_UNAVAILABLE");
    }
    return {
      branchId,
      actorId: principal.employeeId,
      guards: [exactCheck("staging-PlatformStaff", key2, employee, [
        ...Object.keys(employee),
        "roles",
        "scope",
        "mfaRequired",
        "minimumAuthTime",
        "deletionRequestId",
        "deletedAt",
        "isDeleted"
      ])]
    };
  };
}

// backend/wallet-service/src/merchantSettlementScheduleWorkflow.ts
var import_lib_dynamodb3 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/merchantSettlementPeriod.ts
var DAY = 864e5;
var fail2 = () => {
  throw Error("INVALID_MERCHANT_SETTLEMENT_PERIOD");
};
var local = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Baghdad",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});
function parts(at) {
  return Object.fromEntries(local.formatToParts(new Date(at)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
}
function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail2();
  const time = Date.parse(value + "T00:00:00.000Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 2e3) return fail2();
  return time / DAY;
}
function date(value) {
  return new Date(value * DAY).toISOString().slice(0, 10);
}
function midnight(value) {
  const guess = value * DAY, p = parts(guess);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
  const at = guess - offset, checked = parts(at);
  if (Date.UTC(checked.year, checked.month - 1, checked.day) / DAY !== value || checked.hour || checked.minute || checked.second) return fail2();
  return new Date(at).toISOString();
}
function merchantSettlementPeriod(schedule, at) {
  if (!schedule || Object.keys(schedule).sort().join(",") !== "anchorLocalDate,frequency,schemaVersion,timezone,version" || schedule.schemaVersion !== 1 || !Number.isSafeInteger(schedule.version) || schedule.version < 1 || schedule.timezone !== "Asia/Baghdad" || !["WEEKLY", "FORTNIGHTLY", "MONTHLY"].includes(schedule.frequency) || typeof at !== "string" || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) return fail2();
  const anchor = day(schedule.anchorLocalDate), p = parts(Date.parse(at));
  const current = Date.UTC(p.year, p.month - 1, p.day) / DAY;
  let start, end;
  if (schedule.frequency === "MONTHLY") {
    const anchorDay = Number(schedule.anchorLocalDate.slice(8));
    const boundary = (month2) => {
      const daysInMonth = new Date(Date.UTC(p.year, month2 + 1, 0)).getUTCDate();
      return Date.UTC(p.year, month2, Math.min(anchorDay, daysInMonth)) / DAY;
    };
    let month = p.month - 1;
    if (current < boundary(month)) month--;
    start = boundary(month);
    end = boundary(month + 1);
  } else {
    const length = schedule.frequency === "WEEKLY" ? 7 : 14;
    start = anchor + Math.floor((current - anchor) / length) * length;
    end = start + length;
  }
  const from = midnight(start), until = midnight(end);
  if (!(from <= at && at < until)) return fail2();
  const content = {
    schemaVersion: 1,
    scheduleVersion: schedule.version,
    scheduleDigest: quoteHash(schedule),
    timezone: schedule.timezone,
    frequency: schedule.frequency,
    anchorLocalDate: schedule.anchorLocalDate,
    startLocalDate: date(start),
    endExclusiveLocalDate: date(end),
    fromUtc: from,
    untilExclusiveUtc: until,
    boundaryRule: "START_INCLUSIVE_END_EXCLUSIVE",
    monthEndRule: "CLAMP_TO_MONTH_END_PRESERVE_ORIGINAL_ANCHOR_DAY"
  };
  return { ...content, periodId: "MSP:" + quoteHash(content).slice(0, 48) };
}

// backend/wallet-service/src/merchantSettlementScheduleReader.ts
var fail3 = (code) => {
  throw Object.assign(Error(code), { code });
};
var instant = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function createMerchantSettlementScheduleReader(db) {
  return async (branchId, at) => {
    if (!quoteEntityIdValid(branchId) || !instant(at)) return fail3("INVALID_SETTLEMENT_SCHEDULE_SELECTION");
    const key2 = { pk: "BRANCH#" + branchId, sk: "SETTLEMENT_SCHEDULE#CURRENT" };
    const row = await strongGet(db, "staging-MerchantPlatform", key2);
    if (!row || row.enabled === false) return null;
    const { pk, sk, digest, ...body } = row;
    if (Object.keys(row).sort().join(",") !== "acceptedAt,acceptedBy,agreement,approvedAt,approvedBy,branchId,digest,effectiveFrom,effectiveTo,enabled,kind,ownerId,pk,schedule,schemaVersion,sk,status" || row.kind !== "MERCHANT_SETTLEMENT_SCHEDULE" || row.schemaVersion !== 1 || row.branchId !== branchId || row.enabled !== true || row.status !== "APPROVED" || quoteHash(body) !== digest || !quoteEntityIdValid(row.ownerId) || row.acceptedBy !== row.ownerId || !quoteEntityIdValid(row.approvedBy) || !instant(row.acceptedAt) || !instant(row.approvedAt) || !instant(row.effectiveFrom) || row.acceptedAt > row.effectiveFrom || row.approvedAt > row.effectiveFrom || row.effectiveTo !== null && (!instant(row.effectiveTo) || row.effectiveTo <= row.effectiveFrom) || !row.agreement || Object.keys(row.agreement).sort().join(",") !== "id,termsHash,version" || !quoteEntityIdValid(row.agreement.id) || !Number.isSafeInteger(row.agreement.version) || row.agreement.version < 1 || !/^[a-f0-9]{64}$/.test(row.agreement.termsHash || "")) return fail3("SETTLEMENT_SCHEDULE_APPROVAL_REQUIRED");
    const branch = await strongGet(db, "WhizzMerchants_Businesses", { businessId: branchId });
    if (!branch || branch.ownerId !== row.ownerId || branch.cognitoUserId !== row.ownerId || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail3("SETTLEMENT_SCHEDULE_OWNER_CHANGED");
    const period = merchantSettlementPeriod(row.schedule, at);
    if (period.fromUtc < row.effectiveFrom || row.effectiveTo !== null && period.untilExclusiveUtc > row.effectiveTo) return fail3("SETTLEMENT_HISTORICAL_SCHEDULE_REQUIRED");
    return {
      schedule: row.schedule,
      agreementBinding: row.agreement,
      guard: exactCheck("staging-MerchantPlatform", key2, row)
    };
  };
}

// backend/wallet-service/src/merchantSettlementScheduleWorkflow.ts
var { allowed: allowed2 } = require_catalog();
var P = "staging-MerchantPlatform";
var S = "staging-PlatformStaff";
var B = "WhizzMerchants_Businesses";
var D = "staging-AccountDeletion";
var fail4 = (code) => {
  throw Object.assign(Error(code), { code });
};
var uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
var iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
var same = (a, b) => quoteCanonical(a) === quoteCanonical(b);
var absent = (table, item) => ({ Put: { TableName: table, Item: item, ConditionExpression: "attribute_not_exists(pk)" } });
var key = (branchId, suffix) => ({ pk: "BRANCH#" + branchId, sk: "SETTLEMENT_SCHEDULE#" + suffix });
function createMerchantSettlementScheduleWorkflow(options) {
  const { db } = options, principal = detach(options.principal), clock = options.now || Date.now;
  const instant2 = () => new Date(clock()).toISOString();
  if (!principal || (principal.kind === "STAFF" ? !uuid(principal.employeeId) || !Number.isSafeInteger(principal.authTime) || principal.authTime < 0 || typeof principal.mfaEnrolled !== "boolean" : principal.kind !== "OWNER" || !quoteEntityIdValid(principal.subjectId))) return fail4("SCHEDULE_VERIFIED_PRINCIPAL_REQUIRED");
  async function staff(action) {
    if (principal.kind !== "STAFF") return fail4("SCHEDULE_PERMISSION_REQUIRED");
    const k = { pk: "EMPLOYEE#" + principal.employeeId, sk: "PROFILE" }, row = await strongGet(db, S, k);
    const age = Math.floor(clock() / 1e3) - principal.authTime;
    if (!row || row.employeeId !== principal.employeeId || row.status !== "ACTIVE" || !Number.isSafeInteger(row.version) || row.version < 1 || row.scope?.allRegions !== true || row.deletionRequestId != null || row.deletedAt != null || row.isDeleted === true || row.minimumAuthTime !== void 0 && (!Number.isSafeInteger(row.minimumAuthTime) || row.minimumAuthTime < 0) || (row.minimumAuthTime || 0) > principal.authTime || row.mfaRequired === true && !principal.mfaEnrolled || age < -30 || age > 300 || !allowed2(row, "finance.read") || !allowed2(row, action === "REQUEST" ? "finance.settings.request" : "finance.settings.approve")) return fail4("SCHEDULE_PERMISSION_REQUIRED");
    return { row, guard: exactCheck(S, k, row, [...Object.keys(row), "deletionRequestId", "deletedAt", "isDeleted", "minimumAuthTime", "mfaRequired"]) };
  }
  async function scope(branchId) {
    if (!quoteEntityIdValid(branchId)) return fail4("INVALID_SCHEDULE_REQUEST");
    const branch = await strongGet(db, B, { businessId: branchId });
    if (!branch || branch.businessId !== branchId || branch.status !== "approved" || !quoteEntityIdValid(branch.ownerId) || branch.ownerId !== branch.cognitoUserId || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail4("SCHEDULE_BRANCH_UNAVAILABLE");
    const guards = [exactCheck(B, { businessId: branchId }, branch)];
    for (const pk of ["BUSINESS_LIFECYCLE#MERCHANT#" + branchId, "ACCOUNT_LIFECYCLE#MERCHANT#" + branch.ownerId]) {
      const k = { pk, sk: "META" };
      if (await readMerchantDeletionFence(db, k)) return fail4("SCHEDULE_BRANCH_UNAVAILABLE");
      guards.push({ ConditionCheck: { TableName: D, Key: k, ConditionExpression: "attribute_not_exists(pk)" } });
    }
    return { branch, guards };
  }
  async function agreement(branch, reference, from, until) {
    if (!reference || Object.keys(reference).sort().join(",") !== "id,termsHash,version" || !quoteEntityIdValid(reference.id) || !Number.isSafeInteger(reference.version) || reference.version < 1 || !/^[a-f0-9]{64}$/.test(reference.termsHash || "") || branch.commercialAgreementId !== reference.id || branch.commercialAgreementVersion !== reference.version) return fail4("SCHEDULE_AGREEMENT_UNAVAILABLE");
    const pk = "COMMERCIAL_AGREEMENT#" + reference.id;
    const version = await strongGet(db, P, { pk, sk: "VERSION#" + reference.version });
    const current2 = await strongGet(db, P, { pk, sk: "CURRENT" });
    const acceptanceKey = { pk, sk: "ACCEPTANCE#" + reference.version }, acceptance = await strongGet(db, P, acceptanceKey);
    if (!version || version.termsHash !== reference.termsHash || !current2 || current2.version !== reference.version || current2.termsHash !== reference.termsHash || current2.status !== "ACTIVE" || version.schemaVersion !== 2 || version.terms?.status !== "ACTIVE" || version.terms?.merchantId !== branch.organizationId || version.terms?.branchId !== null && version.terms?.branchId !== branch.businessId || !iso(from) || !iso(version.terms?.effectiveFrom) || version.terms.effectiveFrom > from || version.terms.effectiveTo !== null && (!iso(version.terms.effectiveTo) || until === null || until > version.terms.effectiveTo) || !acceptance || acceptance.subjectId !== branch.ownerId || acceptance.status !== "ACCEPTED" || acceptance.termsHash !== reference.termsHash) return fail4("SCHEDULE_AGREEMENT_UNAVAILABLE");
    return [exactCheck(P, { pk, sk: version.sk }, version), exactCheck(P, { pk, sk: "CURRENT" }, current2), exactCheck(P, acceptanceKey, acceptance)];
  }
  async function current(branchId) {
    const k = key(branchId, "CURRENT"), row = await strongGet(db, P, k);
    if (row && !await createMerchantSettlementScheduleReader(db)(branchId, row.effectiveFrom)) return fail4("SCHEDULE_BASE_VERSION_CONFLICT");
    return { row, guard: row ? exactCheck(P, k, row) : { ConditionCheck: { TableName: P, Key: k, ConditionExpression: "attribute_not_exists(pk)" } } };
  }
  function boundary(schedule, from, until) {
    if (!iso(from) || from <= instant2() || until !== null && (!iso(until) || until <= from)) return fail4("SCHEDULE_FUTURE_BOUNDARY_REQUIRED");
    if (merchantSettlementPeriod(schedule, from).fromUtc !== from || until !== null && merchantSettlementPeriod(schedule, until).fromUtc !== until) return fail4("SCHEDULE_PERIOD_BOUNDARY_REQUIRED");
  }
  function checkProposal(row, branchId) {
    const { pk, sk, proposalDigest, status, acceptedBy, acceptedAt, approvedBy, approvedAt, ...body } = row;
    if (row.kind !== "MERCHANT_SETTLEMENT_SCHEDULE_PROPOSAL" || row.schemaVersion !== 1 || row.branchId !== branchId || !uuid(row.proposalId) || !same({ pk, sk }, key(branchId, "PROPOSAL#" + row.proposalId)) || quoteHash(body) !== proposalDigest || !["AWAITING_OWNER", "AWAITING_APPROVAL", "APPROVED"].includes(status) || !quoteEntityIdValid(row.ownerId) || !uuid(row.requestedBy) || !iso(row.createdAt) || status === "AWAITING_OWNER" && [acceptedBy, acceptedAt, approvedBy, approvedAt].some((v) => v !== void 0) || status !== "AWAITING_OWNER" && (acceptedBy !== row.ownerId || !iso(acceptedAt) || acceptedAt < row.createdAt) || status === "AWAITING_APPROVAL" && (approvedBy !== void 0 || approvedAt !== void 0) || status === "APPROVED" && (!uuid(approvedBy) || approvedBy === row.requestedBy || !iso(approvedAt) || approvedAt < acceptedAt)) return fail4("SCHEDULE_PROPOSAL_INVALID");
  }
  async function load(branchId, proposalId) {
    if (!uuid(proposalId)) return fail4("INVALID_SCHEDULE_REQUEST");
    const row = await strongGet(db, P, key(branchId, "PROPOSAL#" + proposalId));
    if (!row) return fail4("SCHEDULE_PROPOSAL_NOT_FOUND");
    checkProposal(row, branchId);
    return row;
  }
  const audit = (branchId, proposalId, action, actorId, digest) => absent(
    S,
    {
      pk: "SETTLEMENT_SCHEDULE_AUDIT#" + branchId,
      sk: proposalId + "#" + action,
      action,
      actorId,
      branchId,
      proposalId,
      digest,
      createdAt: instant2()
    }
  );
  async function commit(operations) {
    if (operations.length > 100 || Buffer.byteLength(JSON.stringify(operations)) > 1024 * 1024) return fail4("SCHEDULE_TRANSACTION_TOO_LARGE");
    try {
      await db.send(new import_lib_dynamodb3.TransactWriteCommand({ TransactItems: operations }));
    } catch {
      return fail4("SCHEDULE_CONFLICT_OR_UNKNOWN_OUTCOME_RETRY_SAME_PROPOSAL");
    }
  }
  return Object.freeze({
    async propose(value) {
      const input = detach(value);
      if (!input || Object.keys(input).sort().join(",") !== "agreement,baseVersion,branchId,effectiveFrom,effectiveTo,proposalId,schedule" || !uuid(input.proposalId) || !Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0 || input.baseVersion >= Number.MAX_SAFE_INTEGER) return fail4("INVALID_SCHEDULE_REQUEST");
      const actor = await staff("REQUEST"), { branch, guards } = await scope(input.branchId);
      const agreementGuards = await agreement(branch, input.agreement, input.effectiveFrom, input.effectiveTo);
      const old = await strongGet(db, P, key(input.branchId, "PROPOSAL#" + input.proposalId));
      if (old) {
        checkProposal(old, input.branchId);
        if (old.requestedBy !== actor.row.employeeId || old.requestHash !== quoteHash(input)) return fail4("SCHEDULE_PROPOSAL_CONFLICT");
        return { proposal: old, replayed: true };
      }
      if (!input.schedule || Object.keys(input.schedule).sort().join(",") !== "anchorLocalDate,frequency,timezone") return fail4("INVALID_SCHEDULE_REQUEST");
      const schedule = { ...input.schedule, schemaVersion: 1, version: input.baseVersion + 1 };
      boundary(schedule, input.effectiveFrom, input.effectiveTo);
      const live = await current(input.branchId);
      if ((live.row?.schedule?.version || 0) !== input.baseVersion || live.row && (live.row.enabled !== true || live.row.effectiveFrom >= instant2())) return fail4("SCHEDULE_BASE_VERSION_CONFLICT");
      if (live.row && merchantSettlementPeriod(live.row.schedule, input.effectiveFrom).fromUtc !== input.effectiveFrom) return fail4("SCHEDULE_PERIOD_BOUNDARY_REQUIRED");
      const body = {
        schemaVersion: 1,
        kind: "MERCHANT_SETTLEMENT_SCHEDULE_PROPOSAL",
        branchId: input.branchId,
        proposalId: input.proposalId,
        requestHash: quoteHash(input),
        baseVersion: input.baseVersion,
        schedule,
        ownerId: branch.ownerId,
        agreement: input.agreement,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        requestedBy: actor.row.employeeId,
        createdAt: instant2()
      };
      const proposal = { ...key(input.branchId, "PROPOSAL#" + input.proposalId), ...body, proposalDigest: quoteHash(body), status: "AWAITING_OWNER" };
      await commit([actor.guard, ...guards, ...agreementGuards, live.guard, absent(P, proposal), audit(input.branchId, input.proposalId, "SCHEDULE_PROPOSED", actor.row.employeeId, proposal.proposalDigest)]);
      return { proposal, replayed: false };
    },
    async consent(value) {
      const input = detach(value);
      if (!input || Object.keys(input).sort().join(",") !== "branchId,proposalDigest,proposalId" || principal.kind !== "OWNER") return fail4("SCHEDULE_OWNER_REQUIRED");
      const { branch, guards } = await scope(input.branchId);
      if (principal.subjectId !== branch.ownerId) return fail4("SCHEDULE_OWNER_REQUIRED");
      const row = await load(input.branchId, input.proposalId);
      if (row.ownerId !== branch.ownerId || row.proposalDigest !== input.proposalDigest) return fail4("SCHEDULE_PROPOSAL_CONFLICT");
      if (row.status !== "AWAITING_OWNER") {
        if (row.acceptedBy !== principal.subjectId || !iso(row.acceptedAt)) return fail4("SCHEDULE_PROPOSAL_CONFLICT");
        return { proposal: row, replayed: true };
      }
      boundary(row.schedule, row.effectiveFrom, row.effectiveTo);
      const agreementGuards = await agreement(branch, row.agreement, row.effectiveFrom, row.effectiveTo), live = await current(input.branchId);
      if ((live.row?.schedule?.version || 0) !== row.baseVersion) return fail4("SCHEDULE_BASE_VERSION_CONFLICT");
      const next = { ...row, status: "AWAITING_APPROVAL", acceptedBy: principal.subjectId, acceptedAt: instant2() };
      const { Key: _key, TableName: _table, ...proposalCondition } = exactCheck(P, key(input.branchId, "PROPOSAL#" + row.proposalId), row).ConditionCheck;
      await commit([...guards, ...agreementGuards, live.guard, { Put: { TableName: P, Item: next, ...proposalCondition } }, audit(input.branchId, row.proposalId, "SCHEDULE_OWNER_CONSENTED", principal.subjectId, row.proposalDigest)]);
      return { proposal: next, replayed: false };
    },
    async approve(value) {
      const input = detach(value);
      if (!input || Object.keys(input).sort().join(",") !== "branchId,proposalDigest,proposalId") return fail4("INVALID_SCHEDULE_REQUEST");
      const actor = await staff("APPROVE"), { branch, guards } = await scope(input.branchId), row = await load(input.branchId, input.proposalId);
      if (row.proposalDigest !== input.proposalDigest || row.ownerId !== branch.ownerId || row.acceptedBy !== branch.ownerId || !iso(row.acceptedAt) || actor.row.employeeId === row.requestedBy) return fail4("SCHEDULE_INDEPENDENT_APPROVAL_REQUIRED");
      if (row.status === "APPROVED") return { proposal: row, replayed: true };
      if (row.status !== "AWAITING_APPROVAL") return fail4("SCHEDULE_OWNER_CONSENT_REQUIRED");
      const requesterKey = { pk: "EMPLOYEE#" + row.requestedBy, sk: "PROFILE" };
      const requester = await strongGet(db, S, requesterKey);
      if (!requester || requester.employeeId !== row.requestedBy || requester.status !== "ACTIVE" || requester.scope?.allRegions !== true || requester.deletionRequestId != null || requester.deletedAt != null || requester.isDeleted === true || !allowed2(requester, "finance.settings.request") || !allowed2(requester, "finance.read")) return fail4("SCHEDULE_REQUESTER_PERMISSION_REVOKED");
      const requesterGuard = exactCheck(S, requesterKey, requester, [...Object.keys(requester), "deletionRequestId", "deletedAt", "isDeleted"]);
      boundary(row.schedule, row.effectiveFrom, row.effectiveTo);
      const live = await current(input.branchId), agreementGuards = await agreement(branch, row.agreement, row.effectiveFrom, row.effectiveTo);
      if ((live.row?.schedule?.version || 0) !== row.baseVersion) return fail4("SCHEDULE_BASE_VERSION_CONFLICT");
      if (live.row && (live.row.effectiveFrom >= instant2() || merchantSettlementPeriod(live.row.schedule, row.effectiveFrom).fromUtc !== row.effectiveFrom)) return fail4("SCHEDULE_PERIOD_BOUNDARY_REQUIRED");
      const body = {
        schemaVersion: 1,
        kind: "MERCHANT_SETTLEMENT_SCHEDULE",
        branchId: input.branchId,
        ownerId: branch.ownerId,
        enabled: true,
        status: "APPROVED",
        schedule: row.schedule,
        agreement: row.agreement,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        acceptedBy: row.acceptedBy,
        acceptedAt: row.acceptedAt,
        approvedBy: actor.row.employeeId,
        approvedAt: instant2()
      };
      const envelope = { ...key(input.branchId, "CURRENT"), ...body, digest: quoteHash(body) };
      const next = { ...row, status: "APPROVED", approvedBy: actor.row.employeeId, approvedAt: body.approvedAt };
      const condition = live.guard.ConditionCheck;
      const { Key: _a, TableName: _b, ...proposalCondition } = exactCheck(P, key(input.branchId, "PROPOSAL#" + row.proposalId), row).ConditionCheck;
      const { Key: _c, TableName: _d, ...currentCondition } = condition;
      await commit([
        actor.guard,
        requesterGuard,
        ...guards,
        ...agreementGuards,
        { Put: { TableName: P, Item: envelope, ...currentCondition } },
        absent(P, { ...envelope, ...key(input.branchId, "VERSION#" + row.schedule.version) }),
        ...live.row ? [absent(P, {
          ...key(input.branchId, "CLOSED#" + live.row.schedule.version),
          schemaVersion: 1,
          kind: "MERCHANT_SETTLEMENT_SCHEDULE_CLOSURE",
          branchId: input.branchId,
          version: live.row.schedule.version,
          sourceDigest: live.row.digest,
          untilExclusive: row.effectiveFrom,
          replacedByVersion: row.schedule.version,
          proposalId: row.proposalId,
          createdAt: body.approvedAt
        })] : [],
        { Put: { TableName: P, Item: next, ...proposalCondition } },
        audit(input.branchId, row.proposalId, "SCHEDULE_APPROVED", actor.row.employeeId, envelope.digest)
      ]);
      return { proposal: next, current: envelope, replayed: false };
    }
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createMerchantSettlementAuthority,
  createMerchantSettlementScheduleWorkflow
});
