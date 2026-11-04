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
    for (let key4 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key4) && key4 !== except)
        __defProp(to, key4, { get: () => from[key4], enumerable: !(desc = __getOwnPropDesc(from, key4)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// backend/staff-service/write-workflow.js
var require_write_workflow = __commonJS({
  "backend/staff-service/write-workflow.js"(exports2, module2) {
    "use strict";
    var direct = () => process.env.PLATFORM_ENVIRONMENT === "staging" && process.env.PLATFORM_WRITE_MODE === "DIRECT";
    var operator2 = (person) => direct() && person?.status === "ACTIVE" && (process.env.PLATFORM_DIRECT_OPERATOR_IDS || "").split(",").includes(person.employeeId);
    module2.exports = { direct, operator: operator2 };
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
    var LABELS2 = { commercial_viewer: "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0627\u062A\u0641\u0627\u0642\u064A\u0627\u062A \u0648\u0627\u0644\u062A\u0645\u0648\u064A\u0644", commercial_editor: "\u0625\u0639\u062F\u0627\u062F \u0627\u0644\u0627\u062A\u0641\u0627\u0642\u064A\u0627\u062A \u0648\u0627\u0644\u062A\u0645\u0648\u064A\u0644", commercial_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0627\u062A\u0641\u0627\u0642\u064A\u0627\u062A \u0648\u0627\u0644\u062A\u0645\u0648\u064A\u0644", pricing_viewer: "\u0642\u0631\u0627\u0621\u0629 \u0648\u0645\u062D\u0627\u0643\u0627\u0629 \u0627\u0644\u062A\u0633\u0639\u064A\u0631", pricing_editor: "\u0625\u0639\u062F\u0627\u062F \u0642\u0648\u0627\u0639\u062F \u0627\u0644\u062A\u0633\u0639\u064A\u0631", pricing_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0648\u0646\u0634\u0631 \u0627\u0644\u062A\u0633\u0639\u064A\u0631", merchant_staff_policy_manager: "\u0625\u062F\u0627\u0631\u0629 \u0633\u064A\u0627\u0633\u0629 \u0635\u0644\u0627\u062D\u064A\u0627\u062A \u0645\u0648\u0638\u0641\u064A \u0627\u0644\u062A\u062C\u0627\u0631", settings_viewer: "\u0645\u0634\u0627\u0647\u062F \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A\u0629", settings_manager: "\u0627\u0642\u062A\u0631\u0627\u062D \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u062A\u0634\u063A\u064A\u0644\u064A\u0629", settings_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u062A\u0634\u063A\u064A\u0644\u064A\u0629", staff_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0648\u0638\u0641\u064A\u0646", staff_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A", customer_service: "\u062E\u062F\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621", support_supervisor: "\u0645\u0634\u0631\u0641 \u0627\u0644\u062F\u0639\u0645", driver_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0633\u0627\u0626\u0642\u064A\u0646", driver_reviewer: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0633\u0627\u0626\u0642\u064A\u0646", merchant_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u062A\u0627\u062C\u0631", merchant_reviewer: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0645\u062A\u0627\u062C\u0631", operations: "\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A", region_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0627\u0637\u0642", promotions_manager: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0639\u0631\u0648\u0636", promotions_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0639\u0631\u0648\u0636", finance_viewer: "\u0645\u0634\u0627\u0647\u062F \u0645\u0627\u0644\u064A", finance_operator: "\u0639\u0645\u0644\u064A\u0627\u062A \u0645\u0627\u0644\u064A\u0629", finance_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0645\u0627\u0644\u064A", finance_settings: "\u0627\u0642\u062A\u0631\u0627\u062D \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0645\u0627\u0644\u064A\u0629", finance_settings_approver: "\u0627\u0639\u062A\u0645\u0627\u062F \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0645\u0627\u0644\u064A\u0629", auditor: "\u0645\u062F\u0642\u0642", platform_manager: "\u0625\u0634\u0631\u0627\u0641 \u0627\u0644\u0645\u0646\u0635\u0629" };
    ROLES.bootstrap_admin = [...new Set(Object.values(ROLES).flat())];
    LABELS2.bootstrap_admin = "\u0645\u062F\u064A\u0631 \u0627\u0644\u062A\u0623\u0633\u064A\u0633 \u0627\u0644\u062D\u0627\u0644\u064A";
    function effective(employee2) {
      if (!employee2 || employee2.status !== "ACTIVE") return [];
      if (require_write_workflow().operator?.(employee2)) return [...ROLES.bootstrap_admin];
      return [...new Set((employee2.roles || []).flatMap((role) => Object.hasOwn(ROLES, role) ? ROLES[role] : []))];
    }
    function allowed6(employee2, permission, regionId) {
      if (!effective(employee2).includes(permission)) return false;
      if (regionId === void 0) return true;
      return employee2.scope?.allRegions === true || typeof regionId === "string" && employee2.scope?.regionIds?.includes(regionId);
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
    module2.exports = { ROLES, LABELS: LABELS2, effective, allowed: allowed6, validateAssignment };
  }
});

// backend/wallet-service/merchant-runtime/merchant-platform/branch-device-security.js
var require_branch_device_security = __commonJS({
  "backend/wallet-service/merchant-runtime/merchant-platform/branch-device-security.js"(exports2, module2) {
    "use strict";
    var { randomBytes, scryptSync, timingSafeEqual: timingSafeEqual2, createHash: createHash2 } = require("node:crypto");
    var fail26 = (code, status = 403) => {
      throw Object.assign(Error(code), { status });
    };
    var hash = (value) => createHash2("sha256").update(value).digest("hex");
    var secret = () => randomBytes(32).toString("base64url");
    function digestPin(pin, salt) {
      if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) fail26("INVALID_PIN", 400);
      return scryptSync(pin, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
    }
    function pinRecord(pin) {
      const salt = secret();
      return { salt, digest: digestPin(pin, salt) };
    }
    function checkPin(pin, record) {
      const candidate = digestPin(pin, record.salt);
      return timingSafeEqual2(Buffer.from(candidate, "hex"), Buffer.from(record.digest, "hex"));
    }
    function checkSecret(token, digest) {
      return typeof token === "string" && token.length < 1024 && typeof digest === "string" && hash(token) === digest;
    }
    function activeDevice(d, token, now) {
      if (!d || d.status !== "ACTIVE" || d.expiresAt <= now || !checkSecret(token, d.tokenHash)) fail26("DEVICE_REVOKED", 401);
      return d;
    }
    function activeSession(s, token, d, m, now) {
      if (!s || s.status !== "ACTIVE" || s.expiresAt <= now || s.deviceId !== d.deviceId || s.deviceVersion !== d.version || s.businessId !== d.businessId || !checkSecret(token, s.tokenHash)) fail26("SESSION_REVOKED", 401);
      if (!m || m.status !== "ACTIVE" || m.version !== s.membershipVersion || m.subjectId !== s.subjectId || m.businessId !== d.businessId || m.ownerId !== d.ownerId) fail26("MEMBERSHIP_REVOKED", 403);
      return s;
    }
    module2.exports = { fail: fail26, hash, secret, pinRecord, checkPin, checkSecret, activeDevice, activeSession };
  }
});

// backend/wallet-service/merchant-runtime/merchant-platform/staff-permission-policy.js
var require_staff_permission_policy = __commonJS({
  "backend/wallet-service/merchant-runtime/merchant-platform/staff-permission-policy.js"(exports2, module2) {
    "use strict";
    var fail26 = (code) => {
      throw Object.assign(new Error(code), { code });
    };
    var OWNER_ONLY = /* @__PURE__ */ new Set([
      "ownership.transfer",
      "business.close",
      "settlements.manage",
      "person.delete"
    ]);
    var validId = (value) => typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(value);
    function ids(values) {
      if (!Array.isArray(values) || values.some((v) => !validId(v)) || new Set(values).size !== values.length) fail26("INVALID_PERMISSION_LIST");
      return [...values];
    }
    function version(value) {
      if (!Number.isSafeInteger(value) || value < 1) fail26("INVALID_VERSION");
      return value;
    }
    function registryMap(registry) {
      if (!Array.isArray(registry)) fail26("CAPABILITIES_UNAVAILABLE");
      const map = /* @__PURE__ */ new Map();
      for (const entry of registry) {
        if (!entry || !validId(entry.id) || map.has(entry.id) || typeof entry.implemented !== "boolean") fail26("INVALID_CAPABILITY");
        map.set(entry.id, { ...entry, requires: ids(entry.requires || []) });
      }
      for (const entry of map.values()) {
        for (const id3 of entry.requires) if (!map.has(id3) || id3 === entry.id) fail26("INVALID_DEPENDENCY");
      }
      const visiting = /* @__PURE__ */ new Set(), visited = /* @__PURE__ */ new Set();
      function visit(id3) {
        if (visiting.has(id3)) fail26("INVALID_DEPENDENCY");
        if (visited.has(id3)) return;
        visiting.add(id3);
        for (const dependency of map.get(id3).requires) visit(dependency);
        visiting.delete(id3);
        visited.add(id3);
      }
      for (const id3 of map.keys()) visit(id3);
      return map;
    }
    function validatePolicy(policy, registry) {
      const map = registryMap(registry);
      if (!policy) fail26("POLICY_UNAVAILABLE");
      version(policy.version);
      const enabled = ids(policy.enabledPermissions);
      for (const id3 of enabled) {
        const capability = map.get(id3);
        if (!capability || capability.implemented !== true || OWNER_ONLY.has(id3) || capability.delegable !== true) fail26("PERMISSION_NOT_DELEGABLE");
        for (const dependency of capability.requires) if (!enabled.includes(dependency)) fail26("DEPENDENCY_REQUIRED");
      }
      if (!Array.isArray(policy.roles)) fail26("INVALID_ROLES");
      const seen = /* @__PURE__ */ new Set();
      for (const role of policy.roles) {
        if (!role || !validId(role.id) || role.id === "OWNER" || seen.has(role.id) || !Number.isSafeInteger(role.version) || role.version < 1 || typeof role.enabled !== "boolean" || typeof role.nameAr !== "string" || !role.nameAr.trim() || role.nameAr.length > 100) fail26("INVALID_ROLE");
        seen.add(role.id);
        const defaults = ids(role.permissions);
        for (const id3 of defaults) {
          if (!map.has(id3) || OWNER_ONLY.has(id3) || map.get(id3).delegable !== true || map.get(id3).implemented !== true) fail26("PERMISSION_NOT_DELEGABLE");
          for (const dependency of map.get(id3).requires) if (!defaults.includes(dependency)) fail26("DEPENDENCY_REQUIRED");
        }
      }
      return map;
    }
    function effectivePermissions(grant, policy, registry, branchId) {
      const map = validatePolicy(policy, registry);
      if (grant?.status !== "ACTIVE" || !Array.isArray(grant.branchIds) || !grant.branchIds.includes(branchId)) return [];
      version(grant.version);
      const selected = ids(grant.permissions);
      const effective = new Set(selected.filter((id3) => map.get(id3)?.implemented === true && map.get(id3)?.delegable === true && !OWNER_ONLY.has(id3) && policy.enabledPermissions.includes(id3)));
      let changed = true;
      while (changed) {
        changed = false;
        for (const id3 of effective) if (map.get(id3).requires.some((dep) => !effective.has(dep))) {
          effective.delete(id3);
          changed = true;
        }
      }
      return [...effective].sort();
    }
    function snapshotGrant({ policy, registry, roleId, selectedPermissions, branchIds, expectedPolicyVersion }) {
      const map = validatePolicy(policy, registry);
      if (policy.version !== expectedPolicyVersion) fail26("POLICY_VERSION_CONFLICT");
      const role = policy.roles.find((r) => r.id === roleId && r.enabled);
      if (!role) fail26("ROLE_UNAVAILABLE");
      const permissions = ids(selectedPermissions === void 0 ? role.permissions : selectedPermissions);
      for (const id3 of permissions) {
        if (!policy.enabledPermissions.includes(id3) || !map.get(id3)?.implemented || !map.get(id3)?.delegable || OWNER_ONLY.has(id3)) fail26("PERMISSION_UNAVAILABLE");
        for (const dependency of map.get(id3).requires) if (!permissions.includes(dependency)) fail26("DEPENDENCY_REQUIRED");
      }
      if (!Array.isArray(branchIds) || !branchIds.length || branchIds.some((b) => typeof b !== "string" || !b.trim()) || new Set(branchIds).size !== branchIds.length) fail26("BRANCH_SCOPE_REQUIRED");
      return {
        roleId,
        roleNameAr: role.nameAr,
        roleVersion: role.version,
        policyVersion: policy.version,
        permissions: permissions.sort(),
        branchIds: [...branchIds]
      };
    }
    function assertDelegation({ actor, targetSubjectId, requested, policy, registry }) {
      if (!actor?.subjectId || actor.subjectId === targetSubjectId) fail26("SELF_GRANT_FORBIDDEN");
      if (!requested?.branchIds?.length) fail26("BRANCH_SCOPE_REQUIRED");
      ids(requested.permissions);
      const map = validatePolicy(policy, registry);
      for (const permission of requested.permissions) {
        if (!map.has(permission) || !policy.enabledPermissions.includes(permission) || !map.get(permission).implemented || !map.get(permission).delegable || OWNER_ONLY.has(permission)) fail26("PERMISSION_UNAVAILABLE");
        for (const dependency of map.get(permission).requires) if (!requested.permissions.includes(dependency)) fail26("DEPENDENCY_REQUIRED");
      }
      for (const branchId of requested.branchIds) {
        const allowed6 = new Set(effectivePermissions(actor, policy, registry, branchId));
        if (!allowed6.has("staff.grants.write")) fail26("PERMISSION_REQUIRED");
        for (const permission of requested.permissions) if (!allowed6.has(permission)) fail26("PRIVILEGE_ESCALATION");
      }
      return true;
    }
    module2.exports = { validatePolicy, snapshotGrant, effectivePermissions, assertDelegation };
  }
});

// backend/wallet-service/merchant-runtime/merchant-platform/staff-capabilities.js
var require_staff_capabilities = __commonJS({
  "backend/wallet-service/merchant-runtime/merchant-platform/staff-capabilities.js"(exports2, module2) {
    "use strict";
    var groups = { orders: ["read", "accept", "reject", "prepare", "ready"], branch: ["read", "status.write", "description.write", "photo.write", "instructions.write", "phone.change", "changes.request"], menu: ["read", "create", "edit", "delete", "price.write", "availability.write", "categories.write", "options.write", "images.write", "publish"], import: ["template.read", "upload", "preview", "commit", "publish", "results.read"], discounts: ["read", "create", "edit", "activate", "delete"], notifications: ["read"], hours: ["read", "write"], reports: ["operations.read", "sales.read", "finance.read", "export"], wallet: ["balance.read", "transactions.read", "settlements.read", "export"], finance: ["payout.request", "payout.receive", "transfer", "approve"], staff: ["read", "invite", "grants.write", "revoke"], device: ["read", "pair", "revoke"] };
    var ready = /* @__PURE__ */ new Set(["wallet.settlements.read", "reports.finance.read", "finance.payout.request", "finance.payout.receive", "finance.transfer", "discounts.read", "discounts.create", "discounts.edit", "discounts.activate", "discounts.delete", "branch.status.write", "branch.read", "orders.read", "orders.accept", "orders.reject", "orders.prepare", "orders.ready", "menu.read", "menu.create", "menu.delete", "menu.edit", "menu.price.write", "menu.availability.write", "hours.read", "hours.write", "wallet.balance.read", "wallet.transactions.read", "wallet.export", "reports.sales.read", "reports.export"]);
    var dependencies = { "wallet.transactions.read": ["wallet.balance.read"], "wallet.settlements.read": ["wallet.balance.read", "wallet.transactions.read", "reports.finance.read"], "reports.finance.read": ["wallet.balance.read", "wallet.transactions.read"], "finance.payout.request": ["wallet.settlements.read"], "finance.payout.receive": ["wallet.settlements.read"], "finance.transfer": ["wallet.balance.read", "wallet.transactions.read"], "discounts.create": ["discounts.read"], "discounts.edit": ["discounts.read"], "discounts.activate": ["discounts.read"], "discounts.delete": ["discounts.read"], "reports.export": ["reports.sales.read"], "wallet.export": ["wallet.transactions.read"], "menu.create": ["menu.read"], "menu.delete": ["menu.read"], "hours.write": ["hours.read"], "menu.edit": ["menu.read"], "menu.price.write": ["menu.read"], "menu.availability.write": ["menu.read"] };
    var REGISTRY = Object.freeze(Object.entries(groups).flatMap(([group, actions]) => actions.map((action) => {
      const id3 = group + "." + action;
      return Object.freeze({ id: id3, group, implemented: ready.has(id3), delegable: true, requires: Object.freeze(id3 === "branch.read" ? [] : ["branch.read", ...dependencies[id3] || (group === "orders" && id3 !== "orders.read" ? ["orders.read"] : [])]), implementationState: ready.has(id3) ? "LOCAL_POLICY_GUARD" : "AWAITING_POLICY_GUARD" });
    })));
    var definitions = [
      { id: "BRANCH_MANAGER", nameAr: "\u0645\u062F\u064A\u0631", nameEn: "Manager", description: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A \u0648\u0627\u0644\u0645\u0646\u062A\u062C\u0627\u062A \u0648\u0627\u0644\u0645\u0627\u0644\u064A\u0629 \u0627\u0644\u0645\u0646\u0641\u0630\u0629 \u062D\u0627\u0644\u064A\u064B\u0627\u060C \u0636\u0645\u0646 \u0627\u0644\u0645\u0646\u062D \u0627\u0644\u0635\u0631\u064A\u062D\u0629. \u0644\u0627 \u064A\u0634\u0645\u0644 \u0627\u0639\u062A\u0645\u0627\u062F \u0623\u0645\u0648\u0627\u0644 \u0627\u0644\u0645\u0646\u0635\u0629 \u0623\u0648 \u0625\u062C\u0631\u0627\u0621\u0627\u062A \u0627\u0644\u0645\u0644\u0643\u064A\u0629.", target: REGISTRY.filter((c) => ready.has(c.id) && c.id !== "finance.transfer").map((c) => c.id) },
      { id: "FINANCIAL_EMPLOYEE", nameAr: "\u0645\u0648\u0638\u0641 \u0645\u0627\u0644\u064A", nameEn: "Financial employee", description: "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u0643\u0634\u0648\u0641 \u0648\u0637\u0644\u0628 \u0635\u0631\u0641 \u0627\u0644\u0645\u0633\u062A\u062D\u0642\u0627\u062A \u0648\u062A\u0623\u0643\u064A\u062F \u0627\u0633\u062A\u0644\u0627\u0645\u0647\u0627. \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0635\u0631\u0641 \u0648\u0627\u0644\u0645\u0637\u0627\u0628\u0642\u0629 \u0645\u0646 \u0627\u062E\u062A\u0635\u0627\u0635 \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0646\u0635\u0629\u061B \u0627\u0644\u062A\u062D\u0648\u064A\u0644\u0627\u062A \u062A\u0641\u0648\u064A\u0636 \u0645\u0633\u062A\u0642\u0644.", target: REGISTRY.filter((c) => ready.has(c.id) && c.id !== "finance.transfer" && (["wallet", "finance", "reports"].includes(c.group) || c.id === "branch.read")).map((c) => c.id) },
      { id: "OPERATIONAL_EMPLOYEE", nameAr: "\u0645\u0648\u0638\u0641 \u062A\u0634\u063A\u064A\u0644\u064A", nameEn: "Operational employee", description: "\u0642\u0628\u0648\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0648\u0631\u0641\u0636\u0647\u0627 \u0648\u062A\u062D\u062F\u064A\u062B \u062C\u0645\u064A\u0639 \u062D\u0627\u0644\u0627\u062A\u0647\u0627 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A\u0629 \u0627\u0644\u0645\u062A\u0627\u062D\u0629\u060C \u062F\u0648\u0646 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0646\u062A\u062C\u0627\u062A \u0623\u0648 \u062A\u0639\u062F\u064A\u0644\u0647\u0627 \u0623\u0648 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u0627\u0644\u064A\u0629.", target: ["branch.read", "orders.read", "orders.accept", "orders.reject", "orders.prepare", "orders.ready"] }
    ];
    function rolePresets() {
      return definitions.map((d) => {
        const pendingPermissions = d.target.filter((id3) => !ready.has(id3));
        return { id: d.id, version: 1, nameAr: d.nameAr, nameEn: d.nameEn, description: d.description + (pendingPermissions.length ? " \u0647\u0630\u0627 \u0627\u0644\u062F\u0648\u0631 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644 \u0628\u0639\u062F \u0641\u064A \u0645\u0633\u0627\u0631 \u062C\u0647\u0627\u0632 \u0627\u0644\u0645\u0648\u0638\u0641\u060C \u0648\u0644\u0627 \u064A\u062A\u0627\u062D \u0644\u0644\u062A\u0639\u064A\u064A\u0646 \u062D\u062A\u0649 \u0627\u0643\u062A\u0645\u0627\u0644 \u0639\u0645\u0644\u064A\u0627\u062A\u0647." : ""), order: definitions.indexOf(d), enabled: pendingPermissions.length === 0, permissions: d.target.filter((id3) => ready.has(id3)), pendingPermissions };
      });
    }
    module2.exports = { REGISTRY, rolePresets };
  }
});

// backend/wallet-service/merchant-runtime/merchant-platform/staff-legacy-grants.js
var require_staff_legacy_grants = __commonJS({
  "backend/wallet-service/merchant-runtime/merchant-platform/staff-legacy-grants.js"(exports2, module2) {
    "use strict";
    var { createHash: createHash2 } = require("node:crypto");
    var roles = { MANAGER: ["branch.read", "branch.hours.write", "menu.read", "menu.write", "menu.import", "orders.read", "orders.manage"], RECEPTION: ["branch.read", "menu.read", "orders.read", "orders.manage"], FINANCE: ["branch.read", "finance.read"], REPORT_READER: ["branch.read", "reports.read"] };
    var extras = /* @__PURE__ */ new Set(["branch.description.write", "branch.photo.write", "branch.instructions.write", "branch.phone.change", "staff.manage"]);
    var mapping = { "branch.read": ["branch.read", "hours.read"], "branch.hours.write": ["hours.write"], "menu.read": ["menu.read"], "menu.write": ["menu.edit", "menu.price.write", "menu.availability.write"], "orders.read": ["orders.read"], "orders.manage": ["orders.accept", "orders.reject", "orders.prepare", "orders.ready"] };
    var fail26 = (code) => {
      throw Object.assign(Error(code), { code });
    };
    function snapshot(row3, policy) {
      require_staff_permission_policy().validatePolicy(policy, require_staff_capabilities().REGISTRY);
      if (row3.permissionSchema !== void 0 || !Object.hasOwn(roles, row3.role) || !Array.isArray(row3.extraPermissions) || row3.extraPermissions.some((p) => !extras.has(p)) || typeof row3.businessId !== "string" || !row3.businessId || typeof row3.ownerId !== "string" || !row3.ownerId || row3.pk !== "BRANCH#" + row3.businessId || !Number.isSafeInteger(row3.version) || row3.version < 1) fail26("LEGACY_GRANT_REVIEW_REQUIRED");
      if (typeof row3.sk !== "string" || !row3.sk.startsWith("MEMBER#") && !row3.sk.startsWith("INVITE#") || row3.sk.startsWith("MEMBER#") && (typeof row3.subjectId !== "string" || !row3.subjectId || row3.sk !== "MEMBER#" + row3.subjectId) || row3.sk.startsWith("INVITE#") && (!Number.isSafeInteger(row3.expiresAt) || row3.expiresAt <= 0)) fail26("LEGACY_GRANT_REVIEW_REQUIRED");
      const source = [.../* @__PURE__ */ new Set([...roles[row3.role], ...row3.extraPermissions])].sort();
      const permissions = [...new Set(source.flatMap((p) => mapping[p] || []))].sort();
      return { permissionSchema: 2, role: "LEGACY_" + row3.role, extraPermissions: [], grant: { roleId: "LEGACY_" + row3.role, roleNameAr: { MANAGER: "\u0645\u062F\u064A\u0631 \u0627\u0644\u0641\u0631\u0639", RECEPTION: "\u0627\u0633\u062A\u0642\u0628\u0627\u0644", FINANCE: "\u0645\u0627\u0644\u064A \u2014 \u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637", REPORT_READER: "\u0642\u0627\u0631\u0626 \u0627\u0644\u062A\u0642\u0627\u0631\u064A\u0631" }[row3.role], roleVersion: 1, policyVersion: policy.version, branchIds: [row3.businessId], permissions }, legacyGrant: { mappingVersion: 1, role: row3.role, permissions: source, deferredPermissions: source.filter((p) => !mapping[p]), sourceVersion: row3.version, sourceHash: createHash2("sha256").update(JSON.stringify({ pk: row3.pk, sk: row3.sk, businessId: row3.businessId, ownerId: row3.ownerId, role: row3.role, permissions: source, version: row3.version })).digest("hex") } };
    }
    function plan(rows, policy, { now = Date.now() / 1e3 } = {}) {
      require_staff_permission_policy().validatePolicy(policy, require_staff_capabilities().REGISTRY);
      if (!Array.isArray(rows)) fail26("ITEMS_ARRAY_REQUIRED");
      const updates = [], review = [], counts = { members: 0, invitations: 0, alreadyExplicit: 0, skipped: 0 };
      for (const row3 of rows) {
        if (!row3?.sk?.startsWith("MEMBER#") && !row3?.sk?.startsWith("INVITE#")) {
          counts.skipped++;
          continue;
        }
        if (row3.permissionSchema === 2) {
          counts.alreadyExplicit++;
          continue;
        }
        if (row3.sk.startsWith("INVITE#") && row3.status === "PENDING" && row3.expiresAt <= now) {
          counts.skipped++;
          continue;
        }
        if (row3.sk.startsWith("MEMBER#") && row3.status !== "ACTIVE" || row3.sk.startsWith("INVITE#") && row3.status !== "PENDING") {
          counts.skipped++;
          continue;
        }
        try {
          const converted = snapshot(row3, policy);
          updates.push({ key: { pk: row3.pk, sk: row3.sk }, baseVersion: row3.version, ownerId: row3.ownerId, businessId: row3.businessId, expectedStatus: row3.status, set: { ...converted, version: row3.version + 1 } });
          counts[row3.sk.startsWith("MEMBER#") ? "members" : "invitations"]++;
        } catch (e) {
          review.push({ key: { pk: row3.pk, sk: row3.sk }, reason: e.code || "LEGACY_GRANT_REVIEW_REQUIRED" });
        }
      }
      return { mappingVersion: 1, policyVersion: policy.version, counts, updates, review };
    }
    function transaction(entry, current, policy, { timestamp: timestamp2 = (/* @__PURE__ */ new Date()).toISOString() } = {}) {
      if (!current || entry.key.pk !== current.pk || entry.key.sk !== current.sk || entry.baseVersion !== current.version || entry.ownerId !== current.ownerId || entry.businessId !== current.businessId || entry.expectedStatus !== current.status || !["ACTIVE", "PENDING"].includes(current.status)) fail26("MIGRATION_SOURCE_CHANGED");
      const converted = snapshot(current, policy);
      const now = Math.floor(new Date(timestamp2).getTime() / 1e3);
      if (!Number.isSafeInteger(now) || current.status === "PENDING" && current.expiresAt <= now) fail26("MIGRATION_SOURCE_CHANGED");
      if (entry.set?.legacyGrant?.sourceHash !== converted.legacyGrant.sourceHash || entry.set?.grant?.policyVersion !== policy.version) fail26("MIGRATION_SOURCE_CHANGED");
      const item = { ...current, ...converted, version: current.version + 1, updatedAt: timestamp2 };
      const fence = (pk3) => ({ ConditionCheck: { TableName: "staging-AccountDeletion", Key: { pk: pk3, sk: "META" }, ConditionExpression: "attribute_not_exists(pk)" } });
      return [
        fence("BUSINESS_LIFECYCLE#MERCHANT#" + current.businessId),
        fence("ACCOUNT_LIFECYCLE#MERCHANT#" + current.ownerId),
        ...current.sk.startsWith("MEMBER#") ? [fence("ACCOUNT_LIFECYCLE#MERCHANT#" + current.subjectId)] : [],
        { ConditionCheck: { TableName: "WhizzMerchants_Businesses", Key: { businessId: current.businessId }, ConditionExpression: "ownerId=:owner AND cognitoUserId=:owner AND attribute_not_exists(deletionRequestId)", ExpressionAttributeValues: { ":owner": current.ownerId } } },
        { ConditionCheck: { TableName: "staging-PlatformStaff", Key: { pk: "OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS", sk: "CURRENT" }, ConditionExpression: "#v=:v", ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": policy.version } } },
        { Put: { TableName: "staging-MerchantPlatform", Item: item, ConditionExpression: "#v=:v AND #s=:s AND attribute_not_exists(permissionSchema)" + (current.status === "PENDING" ? " AND expiresAt>:now" : ""), ExpressionAttributeNames: { "#v": "version", "#s": "status" }, ExpressionAttributeValues: { ":v": current.version, ":s": current.status, ...current.status === "PENDING" ? { ":now": now } : {} } } },
        { Put: { TableName: "staging-MerchantPlatform", Item: { pk: current.pk, sk: "STAFF_AUDIT#MIGRATION#" + converted.legacyGrant.sourceHash, ownerId: current.ownerId, businessId: current.businessId, actorId: "SYSTEM_MIGRATION", subjectId: current.subjectId || null, action: "MIGRATE_EXPLICIT_GRANT", createdAt: timestamp2, policyVersion: policy.version, before: { role: current.role, permissions: converted.legacyGrant.permissions }, after: converted.grant }, ConditionExpression: "attribute_not_exists(pk)" } }
      ];
    }
    module2.exports = { snapshot, plan, transaction };
  }
});

// backend/wallet-service/merchant-runtime/functions/auth/staff_policy_access.js
var require_staff_policy_access = __commonJS({
  "backend/wallet-service/merchant-runtime/functions/auth/staff_policy_access.js"(exports2, module2) {
    "use strict";
    var { GetCommand: GetCommand8 } = require("@aws-sdk/lib-dynamodb");
    var contract = require_staff_permission_policy();
    var { REGISTRY } = require_staff_capabilities();
    var TABLE = "staging-PlatformStaff";
    var KEY = { pk: "OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS", sk: "CURRENT" };
    var fail26 = (code, status = 403) => {
      throw Object.assign(Error(code), { status });
    };
    async function read(db) {
      let row3;
      try {
        row3 = (await db.send(new GetCommand8({ TableName: TABLE, Key: KEY, ConsistentRead: true, ProjectionExpression: "#v, enabledPermissions, #roles", ExpressionAttributeNames: { "#v": "version", "#roles": "roles" } }))).Item;
        contract.validatePolicy(row3, REGISTRY);
      } catch (_) {
        fail26("STAFF_POLICY_UNAVAILABLE", 503);
      }
      return row3;
    }
    function fence(policy) {
      return { ConditionCheck: { TableName: TABLE, Key: KEY, ConditionExpression: "#v=:v", ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": policy.version } } };
    }
    function selection(input, policy, businessId) {
      if (!input || Object.keys(input).some((k) => !["roleId", "expectedPolicyVersion"].includes(k))) fail26("INVALID_STAFF_GRANT", 400);
      let grant;
      try {
        grant = contract.snapshotGrant({ policy, registry: REGISTRY, ...input, branchIds: [businessId] });
      } catch (e) {
        fail26(e.code || "INVALID_STAFF_GRANT", e.code === "POLICY_VERSION_CONFLICT" ? 409 : 400);
      }
      if (!grant.permissions.includes("branch.read")) fail26("BRANCH_READ_REQUIRED", 400);
      const actions = ["orders.accept", "orders.reject", "orders.prepare", "orders.ready"];
      if (actions.some((id3) => grant.permissions.includes(id3)) && !actions.every((id3) => grant.permissions.includes(id3))) fail26("ROLE_ORDER_BUNDLE_REQUIRED", 400);
      return { permissionSchema: 2, role: grant.roleId, extraPermissions: [], grant };
    }
    var centralMode = () => {
      const mode = process.env.MERCHANT_STAFF_PERMISSION_MODE || "LEGACY";
      if (!["LEGACY", "CENTRAL"].includes(mode)) fail26("STAFF_PERMISSION_MODE_INVALID", 503);
      return mode === "CENTRAL";
    };
    function requireExplicit(action, input) {
      if (centralMode() && ["invite", "update"].includes(action) && input === void 0) fail26("EXPLICIT_STAFF_GRANT_REQUIRED", 409);
    }
    function legacy(row3, policy) {
      try {
        return require_staff_legacy_grants().snapshot(row3, policy);
      } catch (_) {
        fail26("LEGACY_GRANT_REVIEW_REQUIRED", 409);
      }
    }
    async function employee2(db, m, businessId) {
      let policy;
      const central = centralMode();
      if (m.permissionSchema === void 0) {
        if (!central) return null;
        policy = await read(db);
        m = { ...m, ...legacy(m, policy) };
      }
      if (m.permissionSchema !== 2 || !m.grant || m.role !== m.grant.roleId || m.grant.branchIds?.length !== 1 || m.grant.branchIds[0] !== businessId || m.businessId !== businessId) fail26("INVALID_STAFF_GRANT");
      policy = policy || await read(db);
      let permissions;
      try {
        permissions = contract.effectivePermissions({ ...m.grant, status: m.status, version: m.version }, policy, REGISTRY, businessId);
      } catch (_) {
        fail26("INVALID_STAFF_GRANT");
      }
      return { policy, permissions, fence: fence(policy), membership: m };
    }
    function validateInvitation(grant, policy, businessId) {
      let checked;
      try {
        checked = contract.snapshotGrant({ policy, registry: REGISTRY, roleId: grant?.roleId, selectedPermissions: grant?.permissions, branchIds: [businessId], expectedPolicyVersion: grant?.policyVersion });
      } catch (e) {
        fail26(e.code || "INVALID_STAFF_GRANT", 409);
      }
      if (checked.roleVersion !== grant.roleVersion) fail26("POLICY_VERSION_CONFLICT", 409);
    }
    function publicPolicy(policy) {
      return { version: policy.version, enabledPermissions: policy.enabledPermissions, roles: policy.roles.filter((r) => r.enabled), capabilities: REGISTRY };
    }
    module2.exports = { read, fence, selection, validateInvitation, employee: employee2, publicPolicy, centralMode, requireExplicit, legacy };
  }
});

// backend/wallet-service/merchant-runtime/functions/shared/notification-sound-policy.js
var require_notification_sound_policy = __commonJS({
  "backend/wallet-service/merchant-runtime/functions/shared/notification-sound-policy.js"(exports2, module2) {
    "use strict";
    var { GetCommand: GetCommand8 } = require("@aws-sdk/lib-dynamodb");
    async function read(db) {
      const row3 = (await db.send(new GetCommand8({ TableName: "staging-PlatformStaff", Key: { pk: "OPERATIONAL_SETTINGS#ORDER_RECEPTION", sk: "CURRENT" }, ConsistentRead: true }))).Item;
      const catalog = [];
      for (const id3 of new Set(Object.values(row3?.values ?? {}))) {
        if (typeof id3 === "string" && /^custom_[a-f0-9]{64}$/.test(id3)) {
          const asset = (await db.send(new GetCommand8({ TableName: "staging-PlatformStaff", Key: { pk: "OPERATIONAL_SETTINGS#ORDER_RECEPTION", sk: "SOUND#" + id3 }, ConsistentRead: true }))).Item;
          if (asset) catalog.push({ id: asset.id, label: asset.label, file: asset.file, audio: asset.audio, sha256: asset.sha256, durationSeconds: asset.durationSeconds });
        }
      }
      return { catalog, version: row3?.version ?? 0, values: row3?.values ?? { merchantAcceptanceSeconds: 300, merchantReminderSeconds: 45, merchantNewOrder: "merchant_original", driverNewOffer: "driver_original", driverGoOnline: "online_chime" } };
    }
    module2.exports = { read };
  }
});

// backend/wallet-service/merchant-runtime/functions/auth/branch_device_settlements.js
var require_branch_device_settlements = __commonJS({
  "backend/wallet-service/merchant-runtime/functions/auth/branch_device_settlements.js"(exports2, module2) {
    "use strict";
    var { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
    var fail26 = (code, status = 403) => {
      throw Object.assign(Error(code), { status });
    };
    async function route2(event, input, client2 = new LambdaClient({ region: "us-east-1" })) {
      if (process.env.SETTLEMENT_SCHEDULE_ADMIN_ENABLED !== "true") fail26("SETTLEMENT_SCHEDULE_ADMIN_DISABLED", 503);
      if (Object.keys(input).sort().join(",") !== "action,httpMethod,input" || input.action !== "settlements" || !["GET", "POST"].includes(input.httpMethod) || !input.input || Array.isArray(input.input) || typeof input.input !== "object") fail26("PAYOUT_INVALID_REQUEST", 400);
      const deviceToken = (event.headers?.Authorization || event.headers?.authorization || "").replace(/^Bearer /, ""), staffSession = event.headers?.["X-Staff-Session"] || event.headers?.["x-staff-session"];
      if (!deviceToken || typeof staffSession !== "string") fail26("SESSION_REVOKED", 401);
      const response = await client2.send(new InvokeCommand({ FunctionName: "arn:aws:lambda:us-east-1:699561669180:function:staging-wizz-staff-service", InvocationType: "RequestResponse", Payload: Buffer.from(JSON.stringify({ action: "merchant_device_payout", deviceToken, staffSession, httpMethod: input.httpMethod, input: input.input })) }));
      if (response.FunctionError) fail26("PAYOUT_UNAVAILABLE", 503);
      let data;
      try {
        data = JSON.parse(Buffer.from(response.Payload).toString());
      } catch {
        fail26("PAYOUT_UNAVAILABLE", 503);
      }
      if (data.statusCode !== 200) fail26(typeof data.code === "string" && /^(PAYOUT_|PERMISSION_|MEMBERSHIP_|DEVICE_|SESSION_|STAFF_|ACCOUNT_|BUSINESS_|SETTLEMENT_)/.test(data.code) ? data.code : "PAYOUT_UNAVAILABLE", [400, 401, 403, 404, 409, 503].includes(data.statusCode) ? data.statusCode : 503);
      return data.result;
    }
    module2.exports = { route: route2 };
  }
});

// backend/wallet-service/merchant-runtime/functions/shared/campaign-version.js
var require_campaign_version = __commonJS({
  "backend/wallet-service/merchant-runtime/functions/shared/campaign-version.js"(exports2, module2) {
    "use strict";
    var { createHash: createHash2 } = require("node:crypto");
    var transient = /* @__PURE__ */ new Set(["version", "status", "isActive", "autoActivate", "updatedAt", "updated_at", "createdAt", "created_at", "createdBy", "updatedBy", "usage", "currentUsage", "usage_count", "usageCount", "fundingPolicyId", "fundingPolicyVersion", "revision"]);
    var pinned = ["version", "fundingPolicyId", "fundingPolicyVersion", "legalHold", "retentionHold", "isDeleted", "deletedAt", "deletionStatus"];
    var stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
    var digest = (v) => createHash2("sha256").update(JSON.stringify(stable(v))).digest("hex");
    var fail26 = (code) => {
      throw Object.assign(Error(code), { status: 409, statusCode: 409 });
    };
    function validVersion(row3) {
      if (row3.version !== void 0 && (!Number.isSafeInteger(row3.version) || row3.version < 1)) fail26("CAMPAIGN_VERSION_INVALID");
      return row3.version;
    }
    function revision(row3) {
      return digest(row3);
    }
    function versioned(before, after) {
      const next2 = { ...after };
      if (!before) {
        next2.version = 1;
        delete next2.fundingPolicyId;
        delete next2.fundingPolicyVersion;
        return next2;
      }
      if (before.discountId !== after.discountId || before.businessId !== after.businessId) fail26("CAMPAIGN_SCOPE_INVALID");
      const previous = validVersion(before), terms = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !transient.has(k)));
      const changed = digest(terms(before)) !== digest(terms(after));
      if (changed && previous === Number.MAX_SAFE_INTEGER) fail26("CAMPAIGN_VERSION_EXHAUSTED");
      next2.version = previous === void 0 ? 1 : previous + (changed ? 1 : 0);
      if (changed || previous === void 0) {
        delete next2.fundingPolicyId;
        delete next2.fundingPolicyVersion;
      } else for (const k of ["fundingPolicyId", "fundingPolicyVersion"]) {
        if (before[k] === void 0) delete next2[k];
        else next2[k] = before[k];
      }
      return next2;
    }
    function fence(row3, prefix = "cv") {
      const names = {}, values = {}, parts2 = [];
      for (const [i, k] of [.../* @__PURE__ */ new Set([...Object.keys(row3), ...pinned])].entries()) {
        const n = "#" + prefix + i, v = ":" + prefix + i;
        names[n] = k;
        if (row3[k] === void 0) parts2.push("attribute_not_exists(" + n + ")");
        else {
          values[v] = row3[k];
          parts2.push(n + "=" + v);
        }
      }
      const ConditionExpression = parts2.join(" AND ");
      if (Buffer.byteLength(ConditionExpression) > 3900) fail26("CAMPAIGN_RECORD_TOO_LARGE");
      return { ConditionExpression, ExpressionAttributeNames: names, ...Object.keys(values).length ? { ExpressionAttributeValues: values } : {} };
    }
    function appendCondition(base, op) {
      if (!op.ConditionExpression) return base;
      const condition = op.ConditionExpression, tokens = new Set(condition.match(/[#:]\w+/g) || []), names = Object.fromEntries(Object.entries(op.ExpressionAttributeNames || {}).filter(([k]) => tokens.has(k))), values = Object.fromEntries(Object.entries(op.ExpressionAttributeValues || {}).filter(([k]) => tokens.has(k)));
      const mergedNames = { ...base.ExpressionAttributeNames, ...names }, mergedValues = { ...base.ExpressionAttributeValues, ...values };
      return { ConditionExpression: "(" + base.ConditionExpression + ") AND (" + condition + ")", ...Object.keys(mergedNames).length ? { ExpressionAttributeNames: mergedNames } : {}, ...Object.keys(mergedValues).length ? { ExpressionAttributeValues: mergedValues } : {} };
    }
    function applySet(row3, op) {
      if (!/^SET\s+/i.test(op.UpdateExpression || "") || /\b(REMOVE|ADD|DELETE)\b/.test(op.UpdateExpression)) fail26("CAMPAIGN_WRITE_UNSUPPORTED");
      const next2 = { ...row3 }, field = (s) => s.startsWith("#") ? op.ExpressionAttributeNames?.[s] : s, value = (s) => {
        if (!Object.prototype.hasOwnProperty.call(op.ExpressionAttributeValues || {}, s)) fail26("CAMPAIGN_WRITE_UNSUPPORTED");
        return op.ExpressionAttributeValues[s];
      };
      for (const expression of op.UpdateExpression.replace(/^SET\s+/i, "").split(",")) {
        const m = /^\s*([#\w]+)\s*=\s*(:\w+|[#\w]+\s*\+\s*:\w+)\s*$/.exec(expression);
        if (!m) fail26("CAMPAIGN_WRITE_UNSUPPORTED");
        const k = field(m[1]);
        if (!k || ["version", "fundingPolicyId", "fundingPolicyVersion", "discountId", "businessId"].includes(k)) fail26("CAMPAIGN_WRITE_FORBIDDEN");
        if (m[2].startsWith(":")) next2[k] = value(m[2]);
        else {
          const [a, b] = m[2].split("+").map((s) => s.trim()), n = row3[field(a)] + value(b);
          if (!Number.isSafeInteger(n) || n < 0) fail26("CAMPAIGN_COUNTER_INVALID");
          next2[k] = n;
        }
      }
      return next2;
    }
    async function ownerOperation(raw, item, businessId, sdk) {
      const op = item.Put || item.Update || item.Delete;
      if (!op || op.TableName !== "WhizzMerchants_Discounts") return item;
      if (item.Put) {
        if (op.Item.businessId !== businessId) fail26("CAMPAIGN_SCOPE_INVALID");
        if (["version", "fundingPolicyId", "fundingPolicyVersion"].some((k) => op.Item[k] !== void 0)) fail26("CAMPAIGN_WRITE_FORBIDDEN");
        return { Put: { TableName: op.TableName, Item: versioned(null, op.Item), ...appendCondition({ ConditionExpression: "attribute_not_exists(discountId)" }, op) } };
      }
      const row3 = (await raw.send(new sdk.GetCommand({ TableName: op.TableName, Key: op.Key, ConsistentRead: true }))).Item;
      if (!row3 || row3.businessId !== businessId) fail26("CAMPAIGN_UNAVAILABLE");
      validVersion(row3);
      if (sdk.expectedRevision !== void 0 && sdk.expectedRevision !== revision(row3)) fail26("VERSION_OR_STATE_CONFLICT");
      if (row3.legalHold === true || row3.retentionHold === true) fail26("CAMPAIGN_RETENTION_HOLD");
      const condition = appendCondition(fence(row3), op);
      if (item.Delete) return { Delete: { TableName: op.TableName, Key: op.Key, ...condition } };
      return { Put: { TableName: op.TableName, Item: versioned(row3, applySet(row3, op)), ...condition } };
    }
    module2.exports = { versioned, validVersion, revision, fence, digest, ownerOperation };
  }
});

// backend/wallet-service/merchant-runtime/functions/auth/branch_device_discounts.js
var require_branch_device_discounts = __commonJS({
  "backend/wallet-service/merchant-runtime/functions/auth/branch_device_discounts.js"(exports2, module2) {
    "use strict";
    var { GetCommand: GetCommand8, ScanCommand: ScanCommand3, TransactWriteCommand: TransactWriteCommand7 } = require("@aws-sdk/lib-dynamodb");
    var { createHash: createHash2, randomUUID } = require("node:crypto");
    var { versioned } = require_campaign_version();
    var D2 = "WhizzMerchants_Discounts";
    var T5 = "staging-MerchantPlatform";
    var FIELDS = ["discountId", "businessId", "title", "description", "type", "value", "applicability", "minimum_order_amount", "valid_from", "valid_to", "status", "usage_count", "usage_limit", "updated_at", "created_at", "applicable_item_ids", "applicable_category_ids", "conditional_rule", "conditional_parameters", "version", "fundingPolicyId", "fundingPolicyVersion", "legalHold", "retentionHold"];
    var fail26 = (code, status = 400) => {
      throw Object.assign(Error(code), { status });
    };
    var pick = (r) => Object.fromEntries(FIELDS.filter((k) => r[k] !== void 0).map((k) => [k, r[k]]));
    var digest = (r) => createHash2("sha256").update(JSON.stringify(r)).digest("hex");
    var revision = (r) => digest(pick(r));
    var simple = (r) => ["percentage", "fixedAmount"].includes(r.type) && r.applicability === "allItems" && !(r.applicable_item_ids?.length || r.applicable_category_ids?.length || r.conditional_rule || Object.keys(r.conditional_parameters || {}).length);
    var view = (r) => ({ ...Object.fromEntries(FIELDS.filter((k) => !["conditional_parameters", "applicable_item_ids", "applicable_category_ids", "legalHold", "retentionHold"].includes(k) && r[k] !== void 0).map((k) => [k, r[k]])), revision: revision(r), editable: editable(r) });
    var get = async (db, table, key4) => (await db.send(new GetCommand8({ TableName: table, Key: key4, ConsistentRead: true }))).Item;
    async function prove(db, guards) {
      try {
        await db.send(new TransactWriteCommand7({ TransactItems: guards }));
      } catch (e) {
        if (e.name === "TransactionCanceledException") fail26("VERSION_OR_STATE_CONFLICT", 409);
        throw e;
      }
    }
    function validate(data) {
      if (typeof data.title !== "string" || !data.title.trim() || data.title.length > 150 || typeof data.description !== "string" || data.description.length > 2e3 || !["percentage", "fixedAmount"].includes(data.type)) fail26("INVALID_DISCOUNT");
      if (!Number.isFinite(data.value) || data.value <= 0 || (data.type === "percentage" ? data.value > 100 : !Number.isSafeInteger(data.value) || data.value > 1e9)) fail26("INVALID_DISCOUNT");
      if (!Number.isSafeInteger(data.minimum_order_amount) || data.minimum_order_amount < 0 || data.minimum_order_amount > 1e9) fail26("INVALID_DISCOUNT");
      if ([data.valid_from, data.valid_to].some((v) => {
        if (typeof v !== "string" || v.length > 30 || !Number.isFinite(Date.parse(v))) return true;
        const day3 = /^(\d{4})-(\d{2})-(\d{2})T/.exec(v);
        if (!day3) return true;
        const date2 = /* @__PURE__ */ new Date(day3[1] + "-" + day3[2] + "-" + day3[3] + "T00:00:00.000Z");
        return !Number.isFinite(date2.getTime()) || date2.toISOString().slice(0, 10) !== v.slice(0, 10);
      }) || Date.parse(data.valid_to) <= Date.parse(data.valid_from)) fail26("INVALID_DISCOUNT");
    }
    function editable(row3) {
      try {
        validate(row3);
        return simple(row3);
      } catch (_) {
        return false;
      }
    }
    function fence(row3) {
      const names = {}, values = {}, parts2 = [];
      FIELDS.forEach((k, i) => {
        const n = "#old" + i;
        names[n] = k;
        if (row3[k] === void 0) parts2.push("attribute_not_exists(" + n + ")");
        else {
          values[":old" + i] = row3[k];
          parts2.push(n + "=:old" + i);
        }
      });
      return { TableName: D2, Key: { discountId: row3.discountId }, ConditionExpression: parts2.join(" AND "), ExpressionAttributeNames: names, ExpressionAttributeValues: values };
    }
    async function execute(db, { b, d, s, m, authorization, common: common2 }, input) {
      const action = input.action, needed = { discounts_list: "discounts.read", discounts_create: "discounts.create", discounts_update: "discounts.edit", discounts_status: "discounts.activate", discounts_delete: "discounts.delete" }[action];
      if (!needed || !authorization?.permissions.includes(needed) || !authorization.permissions.includes("discounts.read")) fail26("PERMISSION_REQUIRED", 403);
      const allowed6 = action === "discounts_list" ? ["action", "cursor"] : ["action", "requestId", ...action === "discounts_create" ? ["data"] : ["discountId", "baseRevision", ...action === "discounts_update" ? ["data"] : action === "discounts_status" ? ["active"] : []]];
      if (Object.keys(input).some((k) => !allowed6.includes(k))) fail26("INVALID_DISCOUNT");
      await prove(db, common2);
      if (action === "discounts_list") {
        let cursor;
        if (input.cursor) {
          try {
            if (typeof input.cursor !== "string" || input.cursor.length > 1024) throw Error();
            const parsed = JSON.parse(Buffer.from(input.cursor, "base64url"));
            if (Object.keys(parsed).sort().join(",") !== "businessId,discountId" || parsed.businessId !== b.businessId || typeof parsed.discountId !== "string" || !/^[\w-]{1,150}$/.test(parsed.discountId)) throw Error();
            cursor = { discountId: parsed.discountId };
          } catch (_) {
            fail26("INVALID_CURSOR");
          }
        }
        const names = Object.fromEntries(FIELDS.map((k, i) => ["#f" + i, k]));
        const page = await db.send(new ScanCommand3({ TableName: D2, FilterExpression: "businessId=:b", ExpressionAttributeValues: { ":b": b.businessId }, ProjectionExpression: Object.keys(names).join(","), ExpressionAttributeNames: names, ConsistentRead: true, Limit: 50, ...cursor ? { ExclusiveStartKey: cursor } : {} }));
        await prove(db, common2);
        return { discounts: (page.Items || []).filter((r) => r.businessId === b.businessId).map(view), nextCursor: page.LastEvaluatedKey ? Buffer.from(JSON.stringify({ businessId: b.businessId, discountId: page.LastEvaluatedKey.discountId })).toString("base64url") : null };
      }
      if (typeof input.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)) fail26("REQUEST_ID_REQUIRED");
      if (action !== "discounts_create" && (typeof input.discountId !== "string" || !/^[\w-]{1,150}$/.test(input.discountId) || typeof input.baseRevision !== "string")) fail26("INVALID_DISCOUNT");
      let data;
      if (["discounts_create", "discounts_update"].includes(action)) {
        const v = input.data;
        if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some((k) => !["title", "description", "type", "value", "minimumOrderAmount", "validFrom", "validTo"].includes(k))) fail26("INVALID_DISCOUNT");
        data = { title: typeof v.title === "string" ? v.title.trim() : v.title, description: v.description ?? "", type: v.type, value: v.value, minimum_order_amount: v.minimumOrderAmount ?? 0, valid_from: v.validFrom, valid_to: v.validTo };
        validate(data);
      }
      if (action === "discounts_status" && typeof input.active !== "boolean") fail26("INVALID_DISCOUNT");
      const content = { action, discountId: input.discountId || null, baseRevision: input.baseRevision || null, data: data || null, active: input.active ?? null }, fingerprint = digest(content), key4 = { pk: "BRANCH#" + b.businessId, sk: "DISCOUNT_REQUEST#" + input.requestId };
      async function replay() {
        const marker = await get(db, T5, key4);
        if (!marker) return null;
        if (marker.ownerId !== b.ownerId || marker.fingerprint !== fingerprint) fail26("REQUEST_ID_CONFLICT", 409);
        await prove(db, common2);
        return { success: true, discountId: marker.discountId, replayed: true };
      }
      const previous = await replay();
      if (previous) return previous;
      const id3 = action === "discounts_create" ? randomUUID() : input.discountId, now = (/* @__PURE__ */ new Date()).toISOString();
      const row3 = action === "discounts_create" ? null : await get(db, D2, { discountId: id3 });
      if (action !== "discounts_create" && (!row3 || row3.businessId !== b.businessId)) fail26("DISCOUNT_UNAVAILABLE", 404);
      if (row3 && (row3.legalHold === true || row3.retentionHold === true)) fail26("CAMPAIGN_RETENTION_HOLD", 409);
      if (row3 && revision(row3) !== input.baseRevision) fail26("VERSION_OR_STATE_CONFLICT", 409);
      if (row3 && !simple(row3)) fail26("DISCOUNT_UNSUPPORTED", 409);
      if (action === "discounts_status" && input.active) validate(row3);
      if ((action === "discounts_create" || action === "discounts_update") && Date.parse(data.valid_to) <= Date.now() || action === "discounts_status" && input.active && Date.parse(row3.valid_to) <= Date.now()) fail26("DISCOUNT_EXPIRED", 409);
      let after = action === "discounts_delete" ? null : row3 ? { ...row3, ...data || {}, ...action === "discounts_status" ? { status: input.active ? "active" : "inactive" } : {}, updated_at: now } : { discountId: id3, id: id3, businessId: b.businessId, ...data, applicability: "allItems", applicable_item_ids: [], applicable_category_ids: [], conditional_rule: null, conditional_parameters: {}, usage_limit: null, usage_count: 0, status: "inactive", created_at: now, updated_at: now };
      after = after ? versioned(row3, after) : null;
      const adopt = !!row3 && row3.version === void 0;
      const changed = !row3 || after === null || Object.keys(data || { status: after.status }).some((k) => row3[k] !== after[k]);
      let write;
      if (!row3) write = { Put: { TableName: D2, Item: after, ConditionExpression: "attribute_not_exists(discountId)" } };
      else if (action === "discounts_delete") write = { Delete: fence(row3) };
      else if (!changed && !adopt) write = { ConditionCheck: fence(row3) };
      else {
        const op = fence(row3), patch = { ...data || { status: after.status }, updated_at: now, version: after.version };
        op.UpdateExpression = "SET " + Object.entries(patch).map(([k, v], i) => {
          op.ExpressionAttributeNames["#set" + i] = k;
          op.ExpressionAttributeValues[":set" + i] = v;
          return "#set" + i + "=:set" + i;
        }).join(",");
        const removed = ["fundingPolicyId", "fundingPolicyVersion"].filter((k) => row3[k] !== void 0 && after[k] === void 0);
        if (removed.length) op.UpdateExpression += " REMOVE " + removed.map((k, i) => {
          op.ExpressionAttributeNames["#remove" + i] = k;
          return "#remove" + i;
        }).join(",");
        write = { Update: op };
      }
      const eventAction = { discounts_create: "DISCOUNT_CREATED", discounts_update: "DISCOUNT_UPDATED", discounts_status: "DISCOUNT_STATUS_CHANGED", discounts_delete: "DISCOUNT_DELETED" }[action];
      const audit = { pk: key4.pk, sk: "STAFF_AUDIT#OPERATIONS#" + now + "#" + randomUUID(), ownerId: b.ownerId, businessId: b.businessId, actorId: s.subjectId, actorName: m.displayName || "", roleName: m.grant?.roleNameAr || m.role, deviceId: d.deviceId, sessionId: s.sessionId, permissionVersion: m.version, policyVersion: authorization.policy.version, action: eventAction, entityId: id3, createdAt: now, result: "SUCCEEDED", before: row3 ? view(row3) : null, after: after ? view(after) : null };
      try {
        await db.send(new TransactWriteCommand7({ TransactItems: [...common2, write, { Put: { TableName: T5, Item: { ...key4, ownerId: b.ownerId, businessId: b.businessId, discountId: id3, fingerprint, createdAt: now }, ConditionExpression: "attribute_not_exists(pk)" } }, ...changed ? [{ Put: { TableName: T5, Item: audit, ConditionExpression: "attribute_not_exists(pk)" } }] : []] }));
      } catch (e) {
        if (e.name !== "TransactionCanceledException") throw e;
        const repeated = await replay();
        if (repeated) return repeated;
        fail26("VERSION_OR_STATE_CONFLICT", 409);
      }
      return { success: true, discountId: id3, unchanged: !changed };
    }
    module2.exports = { execute, revision };
  }
});

// backend/wallet-service/merchant-runtime/functions/shared/merchant-response-policy.js
var require_merchant_response_policy = __commonJS({
  "backend/wallet-service/merchant-runtime/functions/shared/merchant-response-policy.js"(exports2, module2) {
    "use strict";
    var fail26 = (code, status = 400) => {
      throw Object.assign(Error(code), { code, status });
    };
    var instant4 = (v) => {
      const n = Date.parse(v);
      if (!Number.isFinite(n)) fail26("INVALID_ORDER_TIME");
      return n;
    };
    function settings(value) {
      const v = value ?? {};
      if (v.schemaVersion !== void 0 && v.schemaVersion !== 1) fail26("INVALID_RECEPTION_SETTINGS");
      const prep = v.defaultPreparationMinutes ?? 20;
      if (!Number.isInteger(prep) || prep < 5 || prep > 120 || v.autoAccept !== void 0 && typeof v.autoAccept !== "boolean") fail26("INVALID_RECEPTION_SETTINGS");
      return { schemaVersion: 1, acceptanceSeconds: 300, defaultPreparationMinutes: prep, autoAccept: v.autoAccept === true };
    }
    function pendingFields(order, branch, platform) {
      const seconds = platform?.values?.merchantAcceptanceSeconds ?? 300;
      if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 1800) fail26("INVALID_PLATFORM_ACCEPTANCE_TIME");
      const p = { ...settings(branch?.orderReceptionSettings), acceptanceSeconds: seconds, platformPolicyVersion: platform?.version ?? 0 }, created = instant4(order.createdAt);
      return { merchantAcceptanceDeadlineAt: new Date(created + p.acceptanceSeconds * 1e3).toISOString(), merchantResponsePolicy: p };
    }
    function deadline(order) {
      return order.merchantAcceptanceDeadlineAt ?? new Date(instant4(order.createdAt) + 3e5).toISOString();
    }
    function preparationMinutes(value) {
      if (!Number.isInteger(value) || value < 5 || value > 120) fail26("INVALID_PREPARATION_TIME");
      return value;
    }
    function acceptanceFields(order, minutes, now) {
      const at = instant4(now);
      minutes = preparationMinutes(minutes);
      if (order.status !== "pending") fail26("ORDER_ALREADY_HANDLED", 409);
      if (at >= instant4(deadline(order))) fail26("MERCHANT_RESPONSE_EXPIRED", 409);
      const ready = at + minutes * 6e4, seconds = order.deliveryQuote?.route?.durationSeconds;
      const fields2 = { estimatedPreparationTime: minutes, estimatedReadyAt: new Date(ready).toISOString(), merchantRespondedAt: now, merchantAcceptanceDeadlineAt: deadline(order) };
      if (Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400) {
        const earliest = ready + seconds * 1e3;
        Object.assign(fields2, { estimatedDeliveryTime: new Date(earliest).toISOString(), deliveryEstimate: { schemaVersion: 1, basis: "PREPARATION_AND_SAVED_ROUTE", updatedAt: now, preparationMinutes: minutes, deliverySeconds: seconds, earliestAt: new Date(earliest).toISOString(), latestAt: new Date(earliest + 3e5).toISOString(), driverWaitIncluded: false } });
      }
      return fields2;
    }
    function applyAcceptance(operation, order, minutes, now) {
      const fields2 = acceptanceFields(order, minutes, now);
      operation.ExpressionAttributeNames = { ...operation.ExpressionAttributeNames, "#mrStatus": "status", "#mrDeadline": "merchantAcceptanceDeadlineAt" };
      operation.ExpressionAttributeValues = { ...operation.ExpressionAttributeValues, ":mrPending": "pending", ":mrNow": now };
      let fence = "#mrStatus=:mrPending";
      if (order.merchantAcceptanceDeadlineAt) {
        operation.ExpressionAttributeValues[":mrDeadline"] = order.merchantAcceptanceDeadlineAt;
        fence += " AND #mrDeadline=:mrDeadline AND #mrDeadline>:mrNow";
      } else {
        fence += " AND attribute_not_exists(#mrDeadline)";
      }
      operation.ConditionExpression = (operation.ConditionExpression ? "(" + operation.ConditionExpression + ") AND " : "") + fence;
      const expanded = (operation.UpdateExpression ?? "").replace(/#[A-Za-z0-9_]+/g, (k) => operation.ExpressionAttributeNames[k] ?? k);
      for (const [i, [key4, value]] of Object.entries(fields2).entries()) {
        if (new RegExp("\\b" + key4 + "\\s*=").test(expanded)) continue;
        operation.ExpressionAttributeNames["#mr" + i] = key4;
        operation.ExpressionAttributeValues[":mr" + i] = value;
        operation.UpdateExpression += ", #mr" + i + "=:mr" + i;
      }
      return operation;
    }
    module2.exports = { settings, pendingFields, deadline, preparationMinutes, acceptanceFields, applyAcceptance };
  }
});

// backend/wallet-service/merchant-runtime/functions/shared/order-reception.js
var require_order_reception = __commonJS({
  "backend/wallet-service/merchant-runtime/functions/shared/order-reception.js"(exports2, module2) {
    "use strict";
    var { createHash: createHash2, randomUUID } = require("node:crypto");
    var { UpdateCommand: UpdateCommand2, GetCommand: GetCommand8, TransactWriteCommand: TransactWriteCommand7 } = require("@aws-sdk/lib-dynamodb");
    var policy = require_merchant_response_policy();
    var B3 = "WhizzMerchants_Businesses";
    var E = "staging-WalletLifecycle";
    var A = "staging-MerchantPlatform";
    var fail26 = (code, status = 400) => {
      throw Object.assign(Error(code), { code, status });
    };
    function minimumOrder(b) {
      const v = b.minimum_order;
      if (v == null || v === 0) return null;
      if (!Number.isSafeInteger(v) || v < 0 || v > 1e9) fail26("INVALID_MINIMUM_ORDER");
      return v;
    }
    function projection(b) {
      return { minimumOrderAmountIqd: minimumOrder(b), settings: policy.settings(b.orderReceptionSettings), pausedUntil: b.ordersPausedUntil ?? null, pauseId: b.orderPauseId ?? null, acceptingOrders: b.acceptingOrders === true, lastStatusUpdate: b.lastStatusUpdate ?? null };
    }
    var revision = (b) => createHash2("sha256").update(JSON.stringify(projection(b))).digest("hex");
    function view(b, canEdit) {
      return { businessId: b.businessId, minimumOrderAmountIqd: minimumOrder(b), enabled: process.env.MERCHANT_RESPONSE_MODE === "REQUIRED", settings: policy.settings(b.orderReceptionSettings), pausedUntil: b.ordersPausedUntil ?? null, acceptingOrders: b.acceptingOrders === true, revision: revision(b), canEdit };
    }
    async function execute(db, b, actor, common2, input, canEdit = true) {
      if (!b || !actor.subjectId || b.ownerId !== actor.ownerId || b.cognitoUserId !== actor.ownerId || b.deletionRequestId) fail26("BUSINESS_UNAVAILABLE", 403);
      if (input.action === "read_order_reception") {
        if (common2.length) await db.send(new TransactWriteCommand7({ TransactItems: common2 }));
        return { ...view(b, canEdit), notificationPolicy: await require_notification_sound_policy().read(db) };
      }
      if (!canEdit) fail26("PERMISSION_REQUIRED", 403);
      if (process.env.MERCHANT_RESPONSE_MODE !== "REQUIRED") fail26("RECEPTION_NOT_ENABLED", 503);
      const allowed6 = input.action === "pause_orders" ? ["action", "minutes", "baseRevision"] : ["action", "settings", "baseRevision"];
      if (!["pause_orders", "set_order_reception"].includes(input.action) || Object.keys(input).some((k) => !allowed6.includes(k))) fail26("INVALID_RECEPTION_REQUEST");
      if (input.baseRevision !== revision(b)) fail26("VERSION_OR_STATE_CONFLICT", 409);
      const at = (/* @__PURE__ */ new Date()).toISOString(), id3 = randomUUID(), values = { ":owner": actor.ownerId, ":at": at, ":actor": actor.subjectId };
      const names = { "#owner": "ownerId", "#cognito": "cognitoUserId" };
      let condition = "#owner=:owner AND #cognito=:owner AND attribute_not_exists(deletionRequestId)";
      for (const [i, k] of ["orderReceptionSettings", "ordersPausedUntil", "orderPauseId", "acceptingOrders", "lastStatusUpdate", "minimum_order"].entries()) {
        names["#r" + i] = k;
        if (b[k] === void 0) condition += " AND attribute_not_exists(#r" + i + ")";
        else {
          condition += " AND #r" + i + "=:r" + i;
          values[":r" + i] = b[k];
        }
      }
      let update = "SET orderReceptionUpdatedAt=:at, orderReceptionUpdatedBy=:actor", after = {};
      const extra = [];
      if (input.action === "set_order_reception") {
        if (!input.settings || Object.keys(input.settings).some((k) => !["autoAccept", "defaultPreparationMinutes", "minimumOrderAmountIqd"].includes(k))) fail26("INVALID_RECEPTION_REQUEST");
        if (typeof input.settings.autoAccept !== "boolean" || !Number.isInteger(input.settings.defaultPreparationMinutes) || input.settings.defaultPreparationMinutes < 5 || input.settings.defaultPreparationMinutes > 120) fail26("INVALID_RECEPTION_REQUEST");
        const minimum2 = Object.prototype.hasOwnProperty.call(input.settings, "minimumOrderAmountIqd") ? minimumOrder({ minimum_order: input.settings.minimumOrderAmountIqd }) : minimumOrder(b);
        after.minimum_order = minimum2;
        values[":minimum"] = minimum2;
        update += ", minimum_order=:minimum";
        after.orderReceptionSettings = policy.settings(input.settings);
        values[":settings"] = after.orderReceptionSettings;
        update += ", orderReceptionSettings=:settings";
      } else {
        if (![15, 30, 60].includes(input.minutes)) fail26("INVALID_PAUSE_DURATION");
        if (b.acceptingOrders !== true) fail26("BRANCH_ALREADY_OFFLINE", 409);
        update += ", lastStatusUpdate=:at, statusUpdatedBy=:actor";
        after = { acceptingOrders: false, onlineStatus: "offline", operatingStatus: "PAUSED", ordersPausedUntil: new Date(Date.now() + input.minutes * 6e4).toISOString(), orderPauseId: id3 };
        for (const [i, [k, v]] of Object.entries(after).entries()) {
          names["#p" + i] = k;
          values[":p" + i] = v;
          update += ", #p" + i + "=:p" + i;
        }
        extra.push({ Put: { TableName: E, Item: { operationId: "MERCHANT_RESUME#" + b.businessId + "#" + id3, kind: "MERCHANT_RESUME", branchId: b.businessId, ownerId: b.ownerId, pauseId: id3, pausedAt: at, status: "PENDING", queuePartition: "MERCHANT_RESPONSE", nextAttemptAt: Math.ceil(Date.parse(after.ordersPausedUntil) / 1e3), createdAt: at }, ConditionExpression: "attribute_not_exists(operationId)" } });
      }
      const guards = common2.filter((g) => !(g.ConditionCheck?.TableName === B3 && g.ConditionCheck.Key.businessId === b.businessId));
      await db.send(new TransactWriteCommand7({ TransactItems: [...guards, { Update: { TableName: B3, Key: { businessId: b.businessId }, UpdateExpression: update, ConditionExpression: condition, ExpressionAttributeNames: names, ExpressionAttributeValues: values } }, ...extra, { Put: { TableName: A, Item: { pk: "BRANCH#" + b.businessId, sk: "STAFF_AUDIT#RECEPTION#" + at + "#" + id3, businessId: b.businessId, ownerId: b.ownerId, actorId: actor.subjectId, actorName: actor.name ?? "", roleName: actor.role ?? "", action: input.action === "pause_orders" ? "ORDERS_PAUSED" : "ORDER_RECEPTION_SETTINGS_CHANGED", createdAt: at, result: "SUCCEEDED", before: projection(b), after }, ConditionExpression: "attribute_not_exists(pk)" } }] }));
      return view({ ...b, ...after, ...input.action === "pause_orders" ? { lastStatusUpdate: at } : {} }, canEdit);
    }
    module2.exports = { execute, revision, view };
  }
});

// backend/wallet-service/merchant-runtime/functions/auth/branch_device_status.js
var require_branch_device_status = __commonJS({
  "backend/wallet-service/merchant-runtime/functions/auth/branch_device_status.js"(exports2, module2) {
    "use strict";
    var { createHash: createHash2, randomUUID } = require("node:crypto");
    var devices2 = require_branch_devices();
    var B3 = "WhizzMerchants_Businesses";
    var T5 = "staging-MerchantPlatform";
    var fields2 = ["acceptingOrders", "onlineStatus", "operatingStatus", "lastStatusUpdate", "ordersPausedUntil", "orderPauseId"];
    var project = (b) => Object.fromEntries(fields2.filter((k) => b[k] !== void 0).map((k) => [k, b[k]]));
    var revision = (b) => createHash2("sha256").update(JSON.stringify(project(b))).digest("hex");
    var fail26 = (code, status = 403) => {
      throw Object.assign(Error(code), { status });
    };
    async function execute(db, { b, d, s, m, authorization, common: common2 }, input) {
      const write = input.action === "set_status";
      const allowed6 = write ? ["action", "acceptingOrders", "baseRevision"] : ["action"];
      if (Object.keys(input).some((k) => !allowed6.includes(k))) fail26("INVALID_STATUS_REQUEST", 400);
      if (write && !authorization?.permissions.includes("branch.status.write")) fail26("PERMISSION_REQUIRED");
      if (!write && !(authorization?.permissions.includes("branch.read") || !authorization)) fail26("PERMISSION_REQUIRED");
      const view = () => ({ businessId: b.businessId, ...project(b), acceptingOrders: b.acceptingOrders === true, revision: revision(b) });
      if (!write) {
        await devices2.tx(db, common2);
        return view();
      }
      if (typeof input.acceptingOrders !== "boolean" || typeof input.baseRevision !== "string") fail26("INVALID_STATUS_REQUEST", 400);
      if (input.baseRevision !== revision(b)) fail26("VERSION_OR_STATE_CONFLICT", 409);
      const accepting = input.acceptingOrders;
      if (accepting && !(b.isActive === true && (!b.onboardingSchemaVersion || b.onboardingComplete === true) && b.platformSuspended !== true && b.ordersBlocked !== true)) fail26("BRANCH_NOT_READY", 409);
      const now = (/* @__PURE__ */ new Date()).toISOString(), names = { "#review": "status" }, values = { ":owner": b.ownerId, ":approved": b.status, ":accepting": accepting, ":online": accepting ? "online" : "offline", ":operating": accepting ? "AVAILABLE" : "OFFLINE", ":now": now, ":actor": s.subjectId, ":source": "branch_employee" };
      let condition = "ownerId=:owner AND cognitoUserId=:owner AND #review=:approved AND attribute_not_exists(deletionRequestId)";
      for (const [i, key4] of fields2.entries()) {
        const name = "#before" + i;
        names[name] = key4;
        if (b[key4] === void 0) condition += " AND attribute_not_exists(" + name + ")";
        else {
          const value = ":before" + i;
          values[value] = b[key4];
          condition += " AND " + name + "=" + value;
        }
      }
      if (accepting) {
        condition += " AND isActive=:yes AND (attribute_not_exists(onboardingSchemaVersion) OR onboardingComplete=:yes) AND (attribute_not_exists(platformSuspended) OR platformSuspended=:no) AND (attribute_not_exists(ordersBlocked) OR ordersBlocked=:no)";
        values[":yes"] = true;
        values[":no"] = false;
      }
      const after = { acceptingOrders: accepting, onlineStatus: accepting ? "online" : "offline", operatingStatus: accepting ? "AVAILABLE" : "OFFLINE", lastStatusUpdate: now };
      const audit = { pk: "BRANCH#" + b.businessId, sk: "STAFF_AUDIT#OPERATIONS#" + now + "#" + randomUUID(), businessId: b.businessId, ownerId: b.ownerId, actorId: s.subjectId, actorName: m.displayName || "", roleName: m.grant?.roleNameAr || m.role, deviceId: d.deviceId, sessionId: s.sessionId, permissionVersion: m.version, policyVersion: authorization.policy.version, action: "BRANCH_STATUS_CHANGED", entityId: b.businessId, result: "SUCCEEDED", createdAt: now, before: project(b), after };
      const guards = common2.filter((op) => !(op.ConditionCheck?.TableName === B3 && op.ConditionCheck?.Key.businessId === b.businessId));
      await devices2.tx(db, [...guards, { Update: { TableName: B3, Key: { businessId: b.businessId }, UpdateExpression: "SET acceptingOrders=:accepting, onlineStatus=:online, operatingStatus=:operating, lastStatusUpdate=:now, statusUpdatedBy=:actor, statusSource=:source REMOVE ordersPausedUntil, orderPauseId", ConditionExpression: condition, ExpressionAttributeNames: names, ExpressionAttributeValues: values } }, { Put: { TableName: T5, Item: audit, ConditionExpression: "attribute_not_exists(pk)" } }]);
      return { businessId: b.businessId, ...after, revision: revision(after) };
    }
    module2.exports = { execute, revision };
  }
});

// backend/wallet-service/merchant-runtime/merchant-platform/domain.js
var require_domain = __commonJS({
  "backend/wallet-service/merchant-runtime/merchant-platform/domain.js"(exports2, module2) {
    "use strict";
    var fail26 = (code) => {
      throw Object.assign(Error(code), { code });
    };
    var text3 = (v, max, required = true) => {
      if (v == null && !required) return null;
      if (typeof v !== "string" || v.trim().length > max || required && !v.trim()) fail26("INVALID_TEXT");
      return v.trim();
    };
    var ROLES = Object.freeze({ OWNER: ["branch.read", "branch.hours.write", "branch.description.write", "branch.photo.write", "branch.instructions.write", "branch.phone.change", "branch.manage", "menu.read", "menu.write", "menu.import", "orders.read", "orders.manage", "device.manage", "staff.manage", "finance.read", "reports.read", "business.close"], MANAGER: ["branch.read", "branch.hours.write", "menu.read", "menu.write", "menu.import", "orders.read", "orders.manage"], RECEPTION: ["branch.read", "menu.read", "orders.read", "orders.manage"], FINANCE: ["branch.read", "finance.read"], REPORT_READER: ["branch.read", "reports.read"] });
    function phone2(v) {
      const n = String(v ?? "").replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 1632).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 1776).replace(/[\s()-]/g, "");
      if (/^07\d{9}$/.test(n)) return "+964" + n.slice(1);
      if (/^\+?9647\d{9}$/.test(n)) return "+" + n.replace(/^\+/, "");
      fail26("INVALID_PHONE");
    }
    function person(input) {
      return { name: text3(input.name, 100), phone: phone2(input.phone), termsVersion: text3(input.termsVersion, 40) };
    }
    function branchDraft(input, policy) {
      if (!policy || !Array.isArray(policy.types)) fail26("ONBOARDING_SETTINGS_UNAVAILABLE");
      const type = policy.types.find((t) => t.id === input.businessType);
      if (!type || !["FOOD", "RETAIL"].includes(type.model)) fail26("INVALID_BUSINESS_TYPE");
      const fields2 = type.fields;
      if (!Array.isArray(fields2)) fail26("ONBOARDING_SETTINGS_UNAVAILABLE");
      for (const f of fields2) {
        const value = input[f.id];
        if (!f.visible && value != null) fail26("HIDDEN_FIELD");
        if (f.required && (value == null || typeof value === "string" && !value.trim())) fail26("REQUIRED_FIELD");
      }
      const latitude = input.latitude, longitude = input.longitude;
      if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) fail26("INVALID_LOCATION");
      return { name: text3(input.name, 150), businessType: input.businessType, address: text3(input.address, 500), latitude, longitude, contactPhone: phone2(input.contactPhone), description: input.description == null ? null : text3(input.description, 2e3), registrationCertificateAssetId: input.registrationCertificateAssetId == null ? null : text3(input.registrationCertificateAssetId, 150), reviewStatus: "DRAFT", operatingStatus: "OFFLINE", version: 1 };
    }
    function eligible(branch) {
      return !!branch && branch.reviewStatus === "APPROVED" && !branch.deletionRequestId && branch.lifecycleStatus !== "CLOSING" && branch.lifecycleStatus !== "CLOSED";
    }
    function permissions(membership, policy, registry, branchId) {
      if (membership?.permissionSchema !== void 0) {
        if (membership.permissionSchema !== 2 || !membership.grant) fail26("INVALID_STAFF_GRANT");
        return require_staff_permission_policy().effectivePermissions({ ...membership.grant, status: membership.status, version: membership.version }, policy, registry, branchId);
      }
      if (membership?.status !== "ACTIVE") return [];
      if (!ROLES[membership.role]) fail26("INVALID_ROLE");
      const defaults = ROLES[membership.role];
      return [.../* @__PURE__ */ new Set([...defaults, ...membership.extraPermissions || []])];
    }
    function authorize({ subjectId, membership, branchId, permission, session, device, policy, registry, now = Date.now() / 1e3 }) {
      if (!subjectId || membership?.subjectId !== subjectId || membership?.status !== "ACTIVE" || !Number.isSafeInteger(membership.version)) fail26("MEMBERSHIP_REQUIRED");
      if (!Array.isArray(membership.branchIds) || !membership.branchIds.includes(branchId)) fail26("BRANCH_SCOPE_REQUIRED");
      if (session?.subjectId !== subjectId || session.membershipId !== membership.membershipId || session.membershipVersion !== membership.version || session.branchId !== branchId || !Number.isFinite(session.expiresAt) || session.expiresAt <= now) fail26("SESSION_REVOKED");
      if (device?.status !== "ACTIVE" || device.branchId !== branchId || device.deviceId !== session.deviceId || device.version !== session.deviceVersion) fail26("DEVICE_REVOKED");
      if (!permissions(membership, policy, registry, branchId).includes(permission)) fail26("PERMISSION_REQUIRED");
      return true;
    }
    function delegate(actor, requested) {
      const owned = new Set(permissions(actor));
      if (!owned.has("staff.manage")) fail26("PERMISSION_REQUIRED");
      if (requested.role === "OWNER") fail26("OWNERSHIP_TRANSFER_REQUIRED");
      for (const b of requested.branchIds || []) if (!actor.branchIds?.includes(b)) fail26("BRANCH_SCOPE_REQUIRED");
      for (const p of permissions({ ...requested, status: "ACTIVE" })) if (!owned.has(p)) fail26("PRIVILEGE_ESCALATION");
      return true;
    }
    function priceIQD(value, { allowZero = false } = {}) {
      if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1e9) fail26("INVALID_PRICE");
      return value;
    }
    function quote(item, selections) {
      if (!item || item.status !== "PUBLISHED" || item.isAvailable !== true) fail26("ITEM_UNAVAILABLE");
      let total = priceIQD(item.price);
      if (!Array.isArray(selections)) fail26("INVALID_SELECTION");
      const groups = item.optionGroups || [], chosen = /* @__PURE__ */ new Map();
      if (!Array.isArray(groups)) fail26("INVALID_OPTION_GROUP");
      const ids = /* @__PURE__ */ new Set();
      for (const g of groups) {
        if (typeof g.id !== "string" || ids.has(g.id) || !Array.isArray(g.options)) fail26("INVALID_OPTION_GROUP");
        ids.add(g.id);
        const optionIds = /* @__PURE__ */ new Set();
        for (const o of g.options) {
          if (typeof o.id !== "string" || optionIds.has(o.id)) fail26("INVALID_OPTION_GROUP");
          optionIds.add(o.id);
        }
      }
      for (const selection of selections) {
        if (!selection || typeof selection.groupId !== "string" || typeof selection.optionId !== "string") fail26("INVALID_SELECTION");
        const key4 = selection.groupId + ":" + selection.optionId;
        if (chosen.has(key4)) fail26("DUPLICATE_OPTION");
        chosen.set(key4, selection);
      }
      const consumed = /* @__PURE__ */ new Set();
      const snapshot = [];
      for (const group of groups) {
        if (!Number.isSafeInteger(group.min) || !Number.isSafeInteger(group.max) || group.min < 0 || group.max < group.min) fail26("INVALID_OPTION_GROUP");
        let count = 0;
        for (const option of group.options || []) {
          const key4 = group.id + ":" + option.id;
          if (!chosen.has(key4)) continue;
          const q = chosen.get(key4).quantity ?? 1;
          if (!Number.isSafeInteger(q) || q < 1 || q > (option.maxQuantity ?? 1) || option.isAvailable !== true) fail26("INVALID_OPTION");
          count += q;
          total += priceIQD(option.price, { allowZero: true }) * q;
          consumed.add(key4);
          snapshot.push({ groupId: group.id, optionId: option.id, name: option.name, quantity: q, unitPrice: option.price });
        }
        if (count < group.min || count > group.max) fail26("OPTION_LIMIT");
      }
      if (consumed.size !== chosen.size) fail26("FOREIGN_OPTION");
      if (!Number.isSafeInteger(total) || total > 1e9) fail26("INVALID_PRICE");
      return { itemId: item.id, menuVersion: item.menuVersion, name: item.name, unitPrice: item.price, options: snapshot, total };
    }
    function assertSubmissionAllowed(policy, typeId, regionId) {
      const t = policy?.types?.find((t2) => t2.id === typeId);
      if (!t || t.registrationOpen !== true || !Array.isArray(t.regions) || t.regions.length && !t.regions.includes(regionId)) fail26("REGISTRATION_CLOSED");
      return true;
    }
    module2.exports = { assertSubmissionAllowed, ROLES, phone: phone2, person, branchDraft, eligible, permissions, authorize, delegate, priceIQD, quote };
  }
});

// backend/wallet-service/merchant-runtime/merchant-platform/branch-profile-policy.js
var require_branch_profile_policy = __commonJS({
  "backend/wallet-service/merchant-runtime/merchant-platform/branch-profile-policy.js"(exports2, module2) {
    "use strict";
    var { authorize, permissions } = require_domain();
    var fail26 = (code) => {
      throw Object.assign(Error(code), { code });
    };
    var OPTIONAL = ["branch.description.write", "branch.photo.write", "branch.instructions.write", "branch.phone.change", "staff.manage"];
    var OWNER_ONLY = ["branch.name.request", "branch.location.request", "branch.setup.complete", "business.close", "ownership.transfer", "settlements.manage"];
    function capabilities(context2) {
      authorize({ ...context2, permission: "branch.read" });
      const m = context2.membership;
      const owner = m.role === "OWNER", granted = permissions(m, context2.policy, context2.registry, context2.branchId);
      if (m.permissionSchema === 2) return { read: true, readSettlements: granted.includes("wallet.settlements.read"), requestPayout: granted.includes("finance.payout.request"), receivePayout: granted.includes("finance.payout.receive"), transferFunds: granted.includes("finance.transfer"), readDiscounts: granted.includes("discounts.read"), createDiscounts: granted.includes("discounts.create"), editDiscounts: granted.includes("discounts.edit"), activateDiscounts: granted.includes("discounts.activate"), deleteDiscounts: granted.includes("discounts.delete"), editStatus: granted.includes("branch.status.write"), readWalletBalance: granted.includes("wallet.balance.read"), readWalletTransactions: granted.includes("wallet.transactions.read"), exportWallet: granted.includes("wallet.export"), readSalesReports: granted.includes("reports.sales.read"), exportSalesReports: granted.includes("reports.export") && granted.includes("reports.sales.read"), readOrders: granted.includes("orders.read"), readMenu: granted.includes("menu.read"), createProduct: granted.includes("menu.create"), deleteProduct: granted.includes("menu.delete"), readHours: granted.includes("hours.read"), editProductInfo: granted.includes("menu.edit"), editProductPrice: granted.includes("menu.price.write"), editProductAvailability: granted.includes("menu.availability.write"), editMenu: ["menu.edit", "menu.price.write", "menu.availability.write"].some((p) => granted.includes(p)), editHours: granted.includes("hours.write"), editDescription: false, editPhoto: false, editInstructions: false, changePhone: false, requestName: false, requestLocation: false, completeSetup: false, close: false, manageStaff: false };
      return {
        read: true,
        editMenu: granted.includes("menu.write"),
        editHours: granted.includes("branch.hours.write"),
        editDescription: owner || (m.extraPermissions || []).includes("branch.description.write"),
        editPhoto: owner || (m.extraPermissions || []).includes("branch.photo.write"),
        editInstructions: owner || (m.extraPermissions || []).includes("branch.instructions.write"),
        changePhone: owner || (m.extraPermissions || []).includes("branch.phone.change"),
        requestName: owner,
        requestLocation: owner,
        completeSetup: owner,
        close: owner,
        manageStaff: owner || (m.extraPermissions || []).includes("staff.manage")
      };
    }
    function view(branch, context2) {
      if (!branch || branch.businessId !== context2.branchId || branch.deletionRequestId) fail26("BRANCH_UNAVAILABLE");
      const rights = capabilities(context2);
      const fields2 = ["businessId", "businessName", "name", "businessTypeId", "businessType", "businessTypeLabelAr", "description", "website", "businessPhotoUrl", "phoneNumber", "address", "regionId", "regionPath", "status", "reviewStatus", "isActive", "acceptingOrders", "operatingStatus", "platformSuspended", "updatedAt"];
      return { business: Object.fromEntries(fields2.filter((k) => branch[k] !== void 0).map((k) => [k, branch[k]])), capabilities: rights };
    }
    function assertAction(context2, action) {
      const c = capabilities(context2);
      const keys = { description: "editDescription", photo: "editPhoto", instructions: "editInstructions", phone: "changePhone", name: "requestName", location: "requestLocation", hours: "editHours", menu: "editMenu", staff: "manageStaff", completeSetup: "completeSetup", close: "close" };
      if (!keys[action] || !c[keys[action]]) fail26("PERMISSION_REQUIRED");
      return true;
    }
    function assertOptionalGrant(permission) {
      if (!OPTIONAL.includes(permission) || OWNER_ONLY.includes(permission)) fail26("NON_DELEGABLE_PERMISSION");
      return true;
    }
    module2.exports = { capabilities, view, assertAction, assertOptionalGrant };
  }
});

// backend/wallet-service/merchant-runtime/functions/auth/branch_devices.js
var require_branch_devices = __commonJS({
  "backend/wallet-service/merchant-runtime/functions/auth/branch_devices.js"(exports2, module2) {
    "use strict";
    var { GetCommand: GetCommand8, QueryCommand: QueryCommand8, TransactWriteCommand: TransactWriteCommand7 } = require("@aws-sdk/lib-dynamodb");
    var { randomUUID, randomInt: randomInt2 } = require("node:crypto");
    var sec = require_branch_device_security();
    var policyAccess = require_staff_policy_access();
    var T5 = "staging-MerchantPlatform";
    var B3 = "WhizzMerchants_Businesses";
    var D2 = "staging-AccountDeletion";
    var now = () => Math.floor(Date.now() / 1e3);
    var get = async (db, t, k) => (await db.send(new GetCommand8({ TableName: t, Key: k, ConsistentRead: true }))).Item;
    async function rows(db, pk3, prefix) {
      let cursor;
      const all = [];
      do {
        const r = await db.send(new QueryCommand8({ TableName: T5, KeyConditionExpression: "pk=:pk AND begins_with(sk,:sk)", ExpressionAttributeValues: { ":pk": pk3, ":sk": prefix }, ConsistentRead: true, ExclusiveStartKey: cursor }));
        all.push(...r.Items || []);
        cursor = r.LastEvaluatedKey;
      } while (cursor);
      return all;
    }
    var fence = (pk3) => ({ ConditionCheck: { TableName: D2, Key: { pk: pk3, sk: "META" }, ConditionExpression: "attribute_not_exists(pk)" } });
    var put4 = (r, old) => ({ Put: { TableName: T5, Item: r, ConditionExpression: old ? "#v=:v" : "attribute_not_exists(pk)", ...old ? { ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": old.version } } : {} } });
    var check = (r, extra = "", values = {}) => ({ ConditionCheck: { TableName: T5, Key: { pk: r.pk, sk: r.sk }, ConditionExpression: "#v=:v" + extra, ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":v": r.version, ...values } } });
    async function tx(db, items) {
      try {
        await db.send(new TransactWriteCommand7({ TransactItems: items }));
      } catch (e) {
        if (e.name === "TransactionCanceledException") sec.fail("VERSION_OR_STATE_CONFLICT", 409);
        throw e;
      }
    }
    async function branch(db, id3) {
      if (typeof id3 !== "string" || !/^[\w-]{1,150}$/.test(id3)) sec.fail("INVALID_BUSINESS_ID", 400);
      const b = await get(db, B3, { businessId: id3 });
      if (!b || b.ownerId !== b.cognitoUserId || !b.ownerId || b.deletionRequestId || String(b.status).toLowerCase() !== "approved") sec.fail("BUSINESS_UNAVAILABLE");
      for (const pk3 of ["BUSINESS_LIFECYCLE#MERCHANT#" + id3, "ACCOUNT_LIFECYCLE#MERCHANT#" + b.ownerId]) if (await get(db, D2, { pk: pk3, sk: "META" })) sec.fail("BUSINESS_UNAVAILABLE");
      return b;
    }
    var guards = (b) => [fence("BUSINESS_LIFECYCLE#MERCHANT#" + b.businessId), fence("ACCOUNT_LIFECYCLE#MERCHANT#" + b.ownerId), { ConditionCheck: { TableName: B3, Key: { businessId: b.businessId }, ConditionExpression: "ownerId=:o AND cognitoUserId=:o AND attribute_not_exists(deletionRequestId) AND #s=:s", ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":o": b.ownerId, ":s": b.status } } }];
    var publicDevice = (d) => ({ deviceId: d.deviceId, name: d.name, status: d.status, version: d.version, expiresAt: d.expiresAt, createdAt: d.createdAt });
    var audit = (b, actor, action, id3 = randomUUID()) => ({ pk: "BRANCH#" + b.businessId, sk: "DEVICE_AUDIT#" + id3, businessId: b.businessId, ownerId: b.ownerId, actorId: actor, action, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
    async function management({ db, sub, identity }, event, input) {
      const id3 = event.httpMethod === "GET" ? event.queryStringParameters?.businessId : input.businessId, b = await branch(db, id3), pk3 = "BRANCH#" + id3;
      if (await get(db, D2, { pk: "ACCOUNT_LIFECYCLE#MERCHANT#" + sub, sk: "META" })) sec.fail("ACCOUNT_CLOSING");
      const common2 = [...guards(b), ...sub !== b.ownerId ? [fence("ACCOUNT_LIFECYCLE#MERCHANT#" + sub)] : []];
      if (event.httpMethod === "GET") {
        if (sub !== b.ownerId) sec.fail("OWNER_REQUIRED");
        return { devices: (await rows(db, pk3, "DEVICE#")).map(publicDevice) };
      }
      if (event.httpMethod !== "POST") sec.fail("INVALID_DEVICE_REQUEST", 400);
      if (Object.keys(input).some((k) => !["action", "businessId", "name", "deviceId", "baseVersion", "pairingCode", "pin", "deviceToken"].includes(k))) sec.fail("INVALID_DEVICE_REQUEST", 400);
      const fresh = () => {
        const t = identity?.claims?.auth_time;
        if (!Number.isFinite(t) || t > now() + 60 || now() - t > 300) sec.fail("RECENT_SIGN_IN_REQUIRED", 401);
      };
      if (input.action === "create_pairing") {
        if (sub !== b.ownerId) sec.fail("OWNER_REQUIRED");
        fresh();
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name || name.length > 60) sec.fail("INVALID_DEVICE_NAME", 400);
        const code = String(randomInt2(0, 1e8)).padStart(8, "0"), key4 = { pk: pk3, sk: "PAIRING" }, old = await get(db, T5, key4);
        const r = { ...key4, businessId: id3, ownerId: b.ownerId, name, codeHash: sec.hash(code), status: "PENDING", version: (old?.version || 0) + 1, attempts: 0, expiresAt: now() + 300 };
        await tx(db, [...common2, put4(r, old), put4(audit(b, sub, "CREATE_PAIRING"))]);
        return { pairingCode: code, expiresAt: r.expiresAt };
      }
      if (input.action === "claim_pairing") {
        fresh();
        if (typeof input.pairingCode !== "string" || !/^\d{8}$/.test(input.pairingCode)) sec.fail("INVALID_PAIRING_CODE", 400);
        if (sub !== b.ownerId) {
          const m = await get(db, T5, { pk: pk3, sk: "MEMBER#" + sub });
          if (m?.status !== "ACTIVE" || m.ownerId !== b.ownerId) sec.fail("MEMBERSHIP_REQUIRED");
          common2.push(check(m));
        }
        const p = await get(db, T5, { pk: pk3, sk: "PAIRING" });
        if (!p || p.status !== "PENDING" || p.expiresAt <= now() || p.attempts >= 5) sec.fail("PAIRING_EXPIRED", 409);
        if (sec.hash(input.pairingCode) !== p.codeHash) {
          await tx(db, [...common2, put4({ ...p, attempts: p.attempts + 1, version: p.version + 1 }, p)]);
          sec.fail("INVALID_PAIRING_CODE", 400);
        }
        const deviceId = randomUUID(), token = sec.secret(), d = { pk: pk3, sk: "DEVICE#" + deviceId, businessId: id3, ownerId: b.ownerId, deviceId, name: p.name, status: "ACTIVE", version: 1, tokenHash: sec.hash(token), expiresAt: now() + 30 * 86400, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
        await tx(db, [...common2, put4({ ...p, status: "USED", version: p.version + 1 }, p), put4(d), put4(audit(b, sub, "PAIR_DEVICE"))]);
        return { device: publicDevice(d), businessId: id3, businessName: b.businessName || b.name, deviceToken: id3 + ":" + deviceId + ":" + token };
      }
      if (input.action === "revoke_device") {
        if (sub !== b.ownerId) sec.fail("OWNER_REQUIRED");
        const d = await get(db, T5, { pk: pk3, sk: "DEVICE#" + input.deviceId });
        if (!d || d.ownerId !== b.ownerId || d.version !== input.baseVersion) sec.fail("VERSION_OR_STATE_CONFLICT", 409);
        await tx(db, [...common2, put4({ ...d, status: "REVOKED", version: d.version + 1 }, d), put4(audit(b, sub, "REVOKE_DEVICE"))]);
        return { success: true };
      }
      if (input.action === "set_pin") {
        fresh();
        const access = await reception(db, input.deviceToken);
        if (access.b.businessId !== id3) sec.fail("DEVICE_SCOPE_REQUIRED");
        const m = await get(db, T5, { pk: pk3, sk: "MEMBER#" + sub });
        if (m?.status !== "ACTIVE" || m.ownerId !== b.ownerId) sec.fail("MEMBERSHIP_REQUIRED");
        const key4 = { pk: pk3, sk: "PIN#" + sub }, old = await get(db, T5, key4), profile = await get(db, T5, { pk: "PERSON#" + sub, sk: "PROFILE" });
        if (!profile) sec.fail("PERSON_PROFILE_REQUIRED", 409);
        const r = { ...key4, businessId: id3, ownerId: b.ownerId, subjectId: sub, ...sec.pinRecord(input.pin), membershipVersion: m.version, attempts: 0, status: "ACTIVE", version: (old?.version || 0) + 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
        await tx(db, [...common2, check(m), check(access.d), put4(r, old), put4(audit(b, sub, "SET_PIN"))]);
        return { success: true };
      }
      sec.fail("UNKNOWN_ACTION", 400);
    }
    function parseDevice(token) {
      if (typeof token !== "string" || token.length > 512) sec.fail("DEVICE_REVOKED", 401);
      const parts2 = token.split(":");
      if (parts2.length !== 3 || !/^[\w-]{1,150}$/.test(parts2[0]) || !/^[a-f0-9-]{36}$/.test(parts2[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts2[2])) sec.fail("DEVICE_REVOKED", 401);
      return parts2;
    }
    async function reception(db, token) {
      const [bid, did, secret] = parseDevice(token), b = await branch(db, bid), d = await get(db, T5, { pk: "BRANCH#" + bid, sk: "DEVICE#" + did });
      sec.activeDevice(d, secret, now());
      if (d.ownerId !== b.ownerId || d.businessId !== bid) sec.fail("DEVICE_REVOKED", 401);
      return { b, d };
    }
    async function runtime(db, event, input) {
      const token = (event.headers?.Authorization || event.headers?.authorization || "").replace(/^Bearer /, ""), { b, d } = await reception(db, token), pk3 = d.pk;
      const common2 = [...guards(b), check(d, " AND #state=:active AND expiresAt>:now", { ":active": "ACTIVE", ":now": now() })];
      common2.at(-1).ConditionCheck.ExpressionAttributeNames["#state"] = "status";
      if (event.httpMethod !== "POST") sec.fail("INVALID_DEVICE_REQUEST", 400);
      if (input.action === "register_push") {
        if (typeof input.pushToken !== "string" || input.pushToken.length < 20 || input.pushToken.length > 4096 || !["ios", "android"].includes(input.platform)) sec.fail("INVALID_PUSH_TOKEN", 400);
        const key4 = { pk: pk3, sk: "DEVICE_PUSH#" + d.deviceId }, old = await get(db, T5, key4);
        const binding = { ...key4, businessId: b.businessId, ownerId: b.ownerId, deviceId: d.deviceId, deviceVersion: d.version, tokenHash: sec.hash(input.pushToken), version: (old?.version || 0) + 1 };
        const item = { token: "BRANCH_DEVICE#" + d.deviceId, fcmToken: input.pushToken, soundEnabled: input.soundEnabled !== false, soundReady: Array.isArray(input.soundReady) ? input.soundReady.filter((v) => typeof v === "string" && /^(custom_[a-f0-9]{64}|[a-z_]{1,40})$/.test(v)).slice(0, 30) : [], subjectId: "BRANCH_DEVICE#" + d.deviceId, app: "merchant", platform: input.platform, businessId: b.businessId, branchDeviceId: d.deviceId, branchDeviceVersion: d.version, env: "staging", updatedAt: (/* @__PURE__ */ new Date()).toISOString(), ttl: d.expiresAt };
        await tx(db, [...common2, put4(binding, old), { Put: { TableName: "WizzCentral_PushDeviceTokens_staging", Item: item } }]);
        return { success: true, notificationPolicy: await require_notification_sound_policy().read(db) };
      }
      if (input.action === "disconnect") {
        const next2 = { ...d, status: "REVOKED", version: d.version + 1 };
        await tx(db, [...common2.filter((x) => x.ConditionCheck?.Key.sk !== d.sk), put4(next2, d), put4(audit(b, null, "DISCONNECT_DEVICE"))]);
        return { success: true };
      }
      if (input.action === "reception") {
        const staff = [];
        for (const m2 of await rows(db, pk3, "MEMBER#")) {
          if (m2.status !== "ACTIVE" || m2.ownerId !== b.ownerId) continue;
          if (await get(db, D2, { pk: "ACCOUNT_LIFECYCLE#MERCHANT#" + m2.subjectId, sk: "META" })) continue;
          const p = await get(db, T5, { pk: pk3, sk: "PIN#" + m2.subjectId });
          staff.push({ subjectId: m2.subjectId, displayName: m2.displayName, role: m2.role, pinReady: p?.status === "ACTIVE" && p.membershipVersion === m2.version && p.attempts < 5 });
        }
        await tx(db, [...common2.filter((x) => x.ConditionCheck?.Key.sk !== d.sk), put4({ ...d, lastSeenAt: now() }, d)]);
        const push = await get(db, T5, { pk: pk3, sk: "DEVICE_PUSH#" + d.deviceId });
        return { businessName: b.businessName || b.name, device: publicDevice(d), staff, pushRegistered: push?.deviceVersion === d.version };
      }
      if (input.action === "unlock") {
        const sub = input.subjectId;
        if (typeof sub !== "string" || sub.length > 100) sec.fail("INVALID_STAFF_REQUEST", 400);
        const m2 = await get(db, T5, { pk: pk3, sk: "MEMBER#" + sub }), p = await get(db, T5, { pk: pk3, sk: "PIN#" + sub });
        if (m2?.status !== "ACTIVE" || m2.ownerId !== b.ownerId) sec.fail("MEMBERSHIP_REVOKED");
        if (!p || p.status !== "ACTIVE" || p.membershipVersion !== m2.version || p.attempts >= 5) sec.fail("PIN_RESET_REQUIRED", 409);
        const authorization2 = await policyAccess.employee(db, m2, b.businessId);
        if (authorization2) {
          if (!authorization2.permissions.includes("branch.read")) sec.fail("PERMISSION_REQUIRED");
          common2.push(authorization2.fence);
        }
        common2.push(fence("ACCOUNT_LIFECYCLE#MERCHANT#" + sub), check(m2));
        if (!sec.checkPin(input.pin, p)) {
          await tx(db, [...common2, put4({ ...p, attempts: p.attempts + 1, version: p.version + 1 }, p)]);
          sec.fail("INVALID_PIN", 400);
        }
        const id3 = randomUUID(), secret = sec.secret(), s2 = { pk: pk3, sk: "STAFF_SESSION#" + id3, sessionId: id3, businessId: b.businessId, ownerId: b.ownerId, subjectId: sub, membershipId: m2.membershipId, membershipVersion: m2.version, pinVersion: p.version + 1, deviceId: d.deviceId, deviceVersion: d.version, tokenHash: sec.hash(secret), expiresAt: now() + 120, maxExpiresAt: now() + 8 * 3600, status: "ACTIVE", version: 1 };
        await tx(db, [...common2, put4({ ...p, attempts: 0, version: p.version + 1 }, p), put4(s2), put4(audit(b, sub, "UNLOCK"))]);
        return { staffSession: id3 + ":" + secret, expiresAt: s2.expiresAt };
      }
      if (input.action === "settlements") return require_branch_device_settlements().route(event, input);
      const { s, m, authorization, common: staffGuards } = await employeeAccess(db, event, { b, d });
      common2.push(...staffGuards);
      if (["discounts_list", "discounts_create", "discounts_update", "discounts_status", "discounts_delete"].includes(input.action)) return require_branch_device_discounts().execute(db, { b, d, s, m, authorization, common: common2 }, input);
      if (["read_order_reception", "set_order_reception", "pause_orders"].includes(input.action)) return require_order_reception().execute(db, b, { subjectId: s.subjectId, ownerId: b.ownerId, name: m.displayName, role: m.role }, common2, input, authorization?.permissions.includes("branch.status.write") === true);
      if (["read_status", "set_status"].includes(input.action)) return require_branch_device_status().execute(db, { b, d, s, m, authorization, common: common2 }, input);
      if (input.action === "touch") {
        const next2 = { ...s, expiresAt: Math.min(now() + 120, s.maxExpiresAt || s.expiresAt), version: s.version + 1 };
        await tx(db, [...common2.filter((x) => x.ConditionCheck?.Key.sk !== s.sk), put4(next2, s)]);
        return { expiresAt: next2.expiresAt };
      }
      if (input.action === "lock") {
        await tx(db, [...common2.filter((x) => x.ConditionCheck?.Key.sk !== s.sk), put4({ ...s, status: "LOCKED", version: s.version + 1 }, s)]);
        return { success: true };
      }
      if (input.action === "profile") {
        const membership = { ...m, branchIds: [m.businessId] }, session = { ...s, branchId: s.businessId }, device = { ...d, branchId: d.businessId };
        const result = require_branch_profile_policy().view(b, { subjectId: s.subjectId, membership, session, device, branchId: b.businessId, policy: authorization?.policy, registry: authorization ? require_staff_capabilities().REGISTRY : void 0 });
        await tx(db, common2);
        return { ...result, staff: { subjectId: s.subjectId, displayName: m.displayName, role: m.role, ...authorization ? { permissionSchema: 2, permissions: authorization.permissions, policyVersion: authorization.policy.version } : {} }, expiresAt: s.expiresAt };
      }
      sec.fail("UNKNOWN_ACTION", 400);
    }
    async function employeeAccess(db, event, { b, d }) {
      const pk3 = d.pk, common2 = [];
      const st = event.headers?.["X-Staff-Session"] || event.headers?.["x-staff-session"];
      if (typeof st !== "string" || !/^[-a-f0-9]{36}:[\w-]{43}$/.test(st)) sec.fail("SESSION_REVOKED", 401);
      const [sid, ss] = st.split(":");
      const s = await get(db, T5, { pk: pk3, sk: "STAFF_SESSION#" + sid }), m = s && await get(db, T5, { pk: pk3, sk: "MEMBER#" + s.subjectId });
      sec.activeSession(s, ss, d, m, now());
      if (await get(db, D2, { pk: "ACCOUNT_LIFECYCLE#MERCHANT#" + s.subjectId, sk: "META" })) sec.fail("ACCOUNT_CLOSING");
      const pin = await get(db, T5, { pk: pk3, sk: "PIN#" + s.subjectId });
      if (!pin || pin.membershipVersion !== m.version || pin.version !== s.pinVersion) sec.fail("SESSION_REVOKED", 401);
      common2.push(fence("ACCOUNT_LIFECYCLE#MERCHANT#" + s.subjectId), check(m), check(pin), check(s, " AND expiresAt>:now", { ":now": now() }));
      const authorization = await policyAccess.employee(db, m, b.businessId);
      if (authorization) common2.push(authorization.fence);
      return { s, m: authorization?.membership || m, common: common2, authorization };
    }
    async function authorizer(db, event) {
      try {
        const { d } = await reception(db, (event.authorizationToken || "").replace(/^Bearer /, ""));
        return { principalId: d.deviceId, policyDocument: { Version: "2012-10-17", Statement: [{ Action: "execute-api:Invoke", Effect: "Allow", Resource: event.methodArn }] } };
      } catch (_) {
        throw Error("Unauthorized");
      }
    }
    module2.exports = { management, runtime, authorizer, reception, employeeAccess, guards, check, tx };
  }
});

// backend/wallet-service/src/merchantSettlementAdminRuntime.ts
var merchantSettlementAdminRuntime_exports = {};
__export(merchantSettlementAdminRuntime_exports, {
  assembleMerchantSettlementPreview: () => assembleMerchantSettlementPreview,
  cashAccountingDeduplicate: () => cashAccountingDeduplicate,
  createMerchantDevicePayoutAuthority: () => createMerchantDevicePayoutAuthority,
  createMerchantOpeningScheduleReader: () => createMerchantOpeningScheduleReader,
  createMerchantPayoutApi: () => createMerchantPayoutApi,
  createMerchantPeriodCollection: () => createMerchantPeriodCollection,
  createMerchantSettlementAuthority: () => createMerchantSettlementAuthority,
  createMerchantSettlementBatchService: () => createMerchantSettlementBatchService,
  createMerchantSettlementScheduleHistoryReader: () => createMerchantSettlementScheduleHistoryReader,
  createMerchantSettlementScheduleWorkflow: () => createMerchantSettlementScheduleWorkflow,
  createMerchantStatementsAdmin: () => createMerchantStatementsAdmin,
  merchantOffCyclePeriod: () => merchantOffCyclePeriod,
  merchantOpeningPeriod: () => merchantOpeningPeriod,
  merchantSettlementPeriod: () => merchantSettlementPeriod,
  merchantSettlementPermission: () => merchantSettlementPermission,
  readMerchantAccrualEvidence: () => readMerchantAccrualEvidence,
  verifyMerchantPayoutJournal: () => verifyMerchantPayoutJournal
});
module.exports = __toCommonJS(merchantSettlementAdminRuntime_exports);

// backend/wallet-service/src/merchantSettlementAuthority.ts
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
function bounded(value) {
  if (value > MAX || value < -MAX) throw new MoneyError("MONEY_OVERFLOW");
  return Number(value);
}
function moneyFromMinor(minorAmount) {
  return Object.freeze({ currency: "IQD", scale: 1e3, moneySchemaVersion: 1, minorAmount: integer(minorAmount) === 0 ? 0 : minorAmount });
}
function readMoney(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MoneyError("INVALID_MONEY");
  const row3 = value;
  if (row3.currency !== "IQD" || row3.scale !== 1e3 || row3.moneySchemaVersion !== 1) throw new MoneyError("UNSUPPORTED_MONEY_SCHEMA");
  if (Object.keys(row3).some((key4) => !["currency", "scale", "moneySchemaVersion", "minorAmount"].includes(key4))) throw new MoneyError("INVALID_MONEY");
  return moneyFromMinor(integer(row3.minorAmount));
}
function toWholeIqdExact(value) {
  const amount4 = readMoney(value).minorAmount;
  if (amount4 % 1e3 !== 0) throw new MoneyError("PRECISION_LOSS");
  return amount4 / 1e3;
}
function addMoney(...values) {
  return moneyFromMinor(bounded(values.reduce((sum, value) => sum + BigInt(readMoney(value).minorAmount), 0n)));
}
function subtractMoney(left, right) {
  return moneyFromMinor(bounded(BigInt(readMoney(left).minorAmount) - BigInt(readMoney(right).minorAmount)));
}
function readWholeIqdRounding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MoneyError("INVALID_ROUNDING");
  const r = value;
  if (Object.keys(r).sort().join(",") !== "incrementIqd,mode" || typeof r.incrementIqd !== "number" || !Number.isSafeInteger(r.incrementIqd) || r.incrementIqd < 1 || r.incrementIqd > Math.floor(Number.MAX_SAFE_INTEGER / 1e3) || !["EXACT", "TOWARD_ZERO", "HALF_AWAY_FROM_ZERO"].includes(r.mode)) throw new MoneyError("INVALID_ROUNDING");
  return Object.freeze({ incrementIqd: r.incrementIqd, mode: r.mode });
}
function quantizeWholeIqd(value, policy) {
  const p = readWholeIqdRounding(policy), amount4 = BigInt(readMoney(value).minorAmount), step = BigInt(p.incrementIqd) * 1000n;
  let units = amount4 / step;
  const remainder = amount4 % step;
  if (remainder !== 0n) {
    if (p.mode === "EXACT") throw new MoneyError("PRECISION_LOSS");
    const absolute = remainder < 0n ? -remainder : remainder;
    if (p.mode === "HALF_AWAY_FROM_ZERO" && absolute * 2n >= step) units += amount4 < 0n ? -1n : 1n;
  }
  return moneyFromMinor(bounded(units * step));
}
function multiplyMoney(value, numerator, denominator, rounding) {
  const amount4 = BigInt(readMoney(value).minorAmount);
  if (integer(numerator) < 0 || integer(denominator) <= 0) throw new MoneyError("INVALID_MONEY");
  if (!["EXACT", "TOWARD_ZERO", "HALF_AWAY_FROM_ZERO"].includes(rounding)) throw new MoneyError("INVALID_ROUNDING");
  const product = amount4 * BigInt(numerator), divisor = BigInt(denominator);
  let quotient = product / divisor;
  const remainder = product % divisor;
  if (remainder !== 0n) {
    if (rounding === "EXACT") throw new MoneyError("PRECISION_LOSS");
    const absolute = remainder < 0n ? -remainder : remainder;
    if (rounding === "HALF_AWAY_FROM_ZERO" && absolute * 2n >= divisor) quotient += product < 0n ? -1n : 1n;
  }
  return moneyFromMinor(bounded(quotient));
}

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
function exactCheck(TableName, Key, saved, fields2 = Object.keys(saved)) {
  const names = {}, values = {}, conditions = [];
  fields2.forEach((field, i) => {
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
function updateChecked(check, UpdateExpression, names, values) {
  const c = check.ConditionCheck;
  return { Update: {
    ...c,
    UpdateExpression,
    ExpressionAttributeNames: { ...c.ExpressionAttributeNames, ...names },
    ExpressionAttributeValues: { ...c.ExpressionAttributeValues, ...values }
  } };
}

// backend/wallet-service/src/merchantSettlementAuthority.ts
var { allowed } = require_catalog();
var fail = (code) => {
  throw Object.assign(Error(code), { code });
};
async function readMerchantDeletionFence(db, key4) {
  return (await db.send(new import_lib_dynamodb2.GetCommand({
    TableName: "staging-AccountDeletion",
    Key: key4,
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
    const key4 = { pk: "EMPLOYEE#" + principal.employeeId, sk: "PROFILE" };
    const employee2 = await strongGet(options.db, "staging-PlatformStaff", key4);
    const age = Math.floor(now() / 1e3) - principal.authTime;
    if (!employee2 || employee2.employeeId !== principal.employeeId || employee2.status !== "ACTIVE" || !Number.isSafeInteger(employee2.version) || employee2.version < 1 || employee2.deletionRequestId != null || employee2.deletedAt != null || employee2.isDeleted === true || employee2.minimumAuthTime !== void 0 && (!Number.isSafeInteger(employee2.minimumAuthTime) || employee2.minimumAuthTime < 0) || (employee2.minimumAuthTime || 0) > principal.authTime || age < -30 || employee2.mfaRequired === true && !principal.mfaEnrolled) return fail("SETTLEMENT_EMPLOYEE_UNAVAILABLE");
    if (action === "CREATE" && age > 300 && !(process.env.PLATFORM_ENVIRONMENT === "staging" && process.env.PLATFORM_SESSION_POLICY === "VALID_SESSION")) return fail("SETTLEMENT_REAUTH_REQUIRED");
    if (employee2.scope?.allRegions !== true || !allowed(employee2, "finance.read") || action === "CREATE" && !allowed(employee2, "finance.request")) return fail("SETTLEMENT_PERMISSION_REQUIRED");
    if (options.companyCashbook === true && branchId === "COMPANY_CASHBOOK") return { branchId, actorId: principal.employeeId, guards: [exactCheck("staging-PlatformStaff", key4, employee2, [...Object.keys(employee2), "roles", "scope", "mfaRequired", "minimumAuthTime", "deletionRequestId", "deletedAt", "isDeleted"])] };
    const branch = await strongGet(options.db, "WhizzMerchants_Businesses", { businessId: branchId });
    if (!branch || branch.businessId !== branchId || branch.status !== "approved" || !quoteEntityIdValid(branch.ownerId) || branch.ownerId !== branch.cognitoUserId || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail("SETTLEMENT_BRANCH_UNAVAILABLE");
    for (const pk3 of ["BUSINESS_LIFECYCLE#MERCHANT#" + branchId, "ACCOUNT_LIFECYCLE#MERCHANT#" + branch.ownerId]) {
      if (await readMerchantDeletionFence(options.db, { pk: pk3, sk: "META" })) return fail("SETTLEMENT_BRANCH_UNAVAILABLE");
    }
    return {
      branchId,
      actorId: principal.employeeId,
      guards: [exactCheck("staging-PlatformStaff", key4, employee2, [
        ...Object.keys(employee2),
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
  const time2 = Date.parse(value + "T00:00:00.000Z");
  if (!Number.isFinite(time2) || new Date(time2).toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 2e3) return fail2();
  return time2 / DAY;
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
    const key4 = { pk: "BRANCH#" + branchId, sk: "SETTLEMENT_SCHEDULE#CURRENT" };
    const row3 = await strongGet(db, "staging-MerchantPlatform", key4);
    if (!row3 || row3.enabled === false) return null;
    const { pk: pk3, sk, digest, ...body } = row3;
    if (Object.keys(row3).sort().join(",") !== "acceptedAt,acceptedBy,agreement,approvedAt,approvedBy,branchId,digest,effectiveFrom,effectiveTo,enabled,kind,ownerId,pk,schedule,schemaVersion,sk,status" || row3.kind !== "MERCHANT_SETTLEMENT_SCHEDULE" || row3.schemaVersion !== 1 || row3.branchId !== branchId || row3.enabled !== true || row3.status !== "APPROVED" || quoteHash(body) !== digest || !quoteEntityIdValid(row3.ownerId) || row3.acceptedBy !== row3.ownerId || !quoteEntityIdValid(row3.approvedBy) || !instant(row3.acceptedAt) || !instant(row3.approvedAt) || !instant(row3.effectiveFrom) || row3.acceptedAt > row3.effectiveFrom || row3.approvedAt > row3.effectiveFrom || row3.effectiveTo !== null && (!instant(row3.effectiveTo) || row3.effectiveTo <= row3.effectiveFrom) || !row3.agreement || Object.keys(row3.agreement).sort().join(",") !== "id,termsHash,version" || !quoteEntityIdValid(row3.agreement.id) || !Number.isSafeInteger(row3.agreement.version) || row3.agreement.version < 1 || !/^[a-f0-9]{64}$/.test(row3.agreement.termsHash || "")) return fail3("SETTLEMENT_SCHEDULE_APPROVAL_REQUIRED");
    const branch = await strongGet(db, "WhizzMerchants_Businesses", { businessId: branchId });
    if (!branch || branch.ownerId !== row3.ownerId || branch.cognitoUserId !== row3.ownerId || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail3("SETTLEMENT_SCHEDULE_OWNER_CHANGED");
    const period = merchantSettlementPeriod(row3.schedule, at);
    if (period.fromUtc < row3.effectiveFrom || row3.effectiveTo !== null && period.untilExclusiveUtc > row3.effectiveTo) return fail3("SETTLEMENT_HISTORICAL_SCHEDULE_REQUIRED");
    return {
      schedule: row3.schedule,
      agreementBinding: row3.agreement,
      guard: exactCheck("staging-MerchantPlatform", key4, row3)
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
var employeeId = (v) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
var iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
var same = (a, b) => quoteCanonical(a) === quoteCanonical(b);
var absent = (table, item) => ({ Put: { TableName: table, Item: item, ConditionExpression: "attribute_not_exists(pk)" } });
var key = (branchId, suffix) => ({ pk: "BRANCH#" + branchId, sk: "SETTLEMENT_SCHEDULE#" + suffix });
function createMerchantSettlementScheduleWorkflow(options) {
  const { db } = options, principal = detach(options.principal), clock = options.now || Date.now;
  const instant4 = () => new Date(clock()).toISOString();
  if (!principal || (principal.kind === "STAFF" ? !employeeId(principal.employeeId) || !Number.isSafeInteger(principal.authTime) || principal.authTime < 0 || typeof principal.mfaEnrolled !== "boolean" : principal.kind !== "OWNER" || !quoteEntityIdValid(principal.subjectId))) return fail4("SCHEDULE_VERIFIED_PRINCIPAL_REQUIRED");
  async function staff(action) {
    if (principal.kind !== "STAFF") return fail4("SCHEDULE_PERMISSION_REQUIRED");
    const k = { pk: "EMPLOYEE#" + principal.employeeId, sk: "PROFILE" }, row3 = await strongGet(db, S, k);
    const age = Math.floor(clock() / 1e3) - principal.authTime;
    if (age > 300 && !(process.env.PLATFORM_ENVIRONMENT === "staging" && process.env.PLATFORM_SESSION_POLICY === "VALID_SESSION")) return fail4("SCHEDULE_REAUTH_REQUIRED");
    if (!row3 || row3.employeeId !== principal.employeeId || row3.status !== "ACTIVE" || !Number.isSafeInteger(row3.version) || row3.version < 1 || row3.scope?.allRegions !== true || row3.deletionRequestId != null || row3.deletedAt != null || row3.isDeleted === true || row3.minimumAuthTime !== void 0 && (!Number.isSafeInteger(row3.minimumAuthTime) || row3.minimumAuthTime < 0) || (row3.minimumAuthTime || 0) > principal.authTime || row3.mfaRequired === true && !principal.mfaEnrolled || age < -30 || !allowed2(row3, "finance.read") || !allowed2(row3, action === "REQUEST" ? "finance.settings.request" : "finance.settings.approve")) return fail4("SCHEDULE_PERMISSION_REQUIRED");
    return { row: row3, guard: exactCheck(S, k, row3, [...Object.keys(row3), "deletionRequestId", "deletedAt", "isDeleted", "minimumAuthTime", "mfaRequired"]) };
  }
  async function scope2(branchId) {
    if (!quoteEntityIdValid(branchId)) return fail4("INVALID_SCHEDULE_REQUEST");
    const branch = await strongGet(db, B, { businessId: branchId });
    if (!branch || branch.businessId !== branchId || branch.status !== "approved" || !quoteEntityIdValid(branch.ownerId) || branch.ownerId !== branch.cognitoUserId || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail4("SCHEDULE_BRANCH_UNAVAILABLE");
    const guards = [exactCheck(B, { businessId: branchId }, branch)];
    for (const pk3 of ["BUSINESS_LIFECYCLE#MERCHANT#" + branchId, "ACCOUNT_LIFECYCLE#MERCHANT#" + branch.ownerId]) {
      const k = { pk: pk3, sk: "META" };
      if (await readMerchantDeletionFence(db, k)) return fail4("SCHEDULE_BRANCH_UNAVAILABLE");
      guards.push({ ConditionCheck: { TableName: D, Key: k, ConditionExpression: "attribute_not_exists(pk)" } });
    }
    return { branch, guards };
  }
  async function agreement(branch, reference2, from, until) {
    if (!reference2 || Object.keys(reference2).sort().join(",") !== "id,termsHash,version" || !quoteEntityIdValid(reference2.id) || !Number.isSafeInteger(reference2.version) || reference2.version < 1 || !/^[a-f0-9]{64}$/.test(reference2.termsHash || "") || branch.commercialAgreementId !== reference2.id || branch.commercialAgreementVersion !== reference2.version) return fail4("SCHEDULE_AGREEMENT_UNAVAILABLE");
    const pk3 = "COMMERCIAL_AGREEMENT#" + reference2.id;
    const version = await strongGet(db, P, { pk: pk3, sk: "VERSION#" + reference2.version });
    const current2 = await strongGet(db, P, { pk: pk3, sk: "CURRENT" });
    const acceptanceKey = { pk: pk3, sk: "ACCEPTANCE#" + reference2.version }, acceptance = await strongGet(db, P, acceptanceKey);
    if (!version || version.termsHash !== reference2.termsHash || !current2 || current2.version !== reference2.version || current2.termsHash !== reference2.termsHash || current2.status !== "ACTIVE" || version.schemaVersion !== 2 || version.terms?.status !== "ACTIVE" || version.terms?.merchantId !== branch.organizationId || version.terms?.branchId !== null && version.terms?.branchId !== branch.businessId || !iso(from) || !iso(version.terms?.effectiveFrom) || version.terms.effectiveFrom > from || version.terms.effectiveTo !== null && (!iso(version.terms.effectiveTo) || until === null || until > version.terms.effectiveTo) || !acceptance || acceptance.subjectId !== branch.ownerId || acceptance.status !== "ACCEPTED" || acceptance.termsHash !== reference2.termsHash) return fail4("SCHEDULE_AGREEMENT_UNAVAILABLE");
    return [exactCheck(P, { pk: pk3, sk: version.sk }, version), exactCheck(P, { pk: pk3, sk: "CURRENT" }, current2), exactCheck(P, acceptanceKey, acceptance)];
  }
  async function current(branchId) {
    const k = key(branchId, "CURRENT"), row3 = await strongGet(db, P, k);
    if (row3 && !await createMerchantSettlementScheduleReader(db)(branchId, row3.effectiveFrom)) return fail4("SCHEDULE_BASE_VERSION_CONFLICT");
    return { row: row3, guard: row3 ? exactCheck(P, k, row3) : { ConditionCheck: { TableName: P, Key: k, ConditionExpression: "attribute_not_exists(pk)" } } };
  }
  function boundary(schedule, from, until) {
    if (!iso(from) || from <= instant4() || until !== null && (!iso(until) || until <= from)) return fail4("SCHEDULE_FUTURE_BOUNDARY_REQUIRED");
    if (merchantSettlementPeriod(schedule, from).fromUtc !== from || until !== null && merchantSettlementPeriod(schedule, until).fromUtc !== until) return fail4("SCHEDULE_PERIOD_BOUNDARY_REQUIRED");
  }
  function checkProposal(row3, branchId) {
    const { pk: pk3, sk, proposalDigest, status, acceptedBy, acceptedAt, approvedBy, approvedAt, ...body } = row3;
    if (row3.kind !== "MERCHANT_SETTLEMENT_SCHEDULE_PROPOSAL" || row3.schemaVersion !== 1 || row3.branchId !== branchId || !uuid(row3.proposalId) || !same({ pk: pk3, sk }, key(branchId, "PROPOSAL#" + row3.proposalId)) || quoteHash(body) !== proposalDigest || !["AWAITING_OWNER", "AWAITING_APPROVAL", "APPROVED"].includes(status) || row3.approvalPolicy !== void 0 && !["SINGLE_ADMIN", "INDEPENDENT"].includes(row3.approvalPolicy) || !quoteEntityIdValid(row3.ownerId) || !employeeId(row3.requestedBy) || !iso(row3.createdAt) || status === "AWAITING_OWNER" && [acceptedBy, acceptedAt, approvedBy, approvedAt].some((v) => v !== void 0) || status !== "AWAITING_OWNER" && (acceptedBy !== row3.ownerId || !iso(acceptedAt) || acceptedAt < row3.createdAt) || status === "AWAITING_APPROVAL" && (approvedBy !== void 0 || approvedAt !== void 0) || status === "APPROVED" && (!employeeId(approvedBy) || approvedBy === row3.requestedBy && row3.approvalPolicy !== "SINGLE_ADMIN" || !iso(approvedAt) || approvedAt < acceptedAt)) return fail4("SCHEDULE_PROPOSAL_INVALID");
  }
  async function load(branchId, proposalId) {
    if (!uuid(proposalId)) return fail4("INVALID_SCHEDULE_REQUEST");
    const row3 = await strongGet(db, P, key(branchId, "PROPOSAL#" + proposalId));
    if (!row3) return fail4("SCHEDULE_PROPOSAL_NOT_FOUND");
    checkProposal(row3, branchId);
    return row3;
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
      createdAt: instant4()
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
      const actor = await staff("REQUEST"), { branch, guards } = await scope2(input.branchId);
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
      if ((live.row?.schedule?.version || 0) !== input.baseVersion || live.row && (live.row.enabled !== true || live.row.effectiveFrom >= instant4())) return fail4("SCHEDULE_BASE_VERSION_CONFLICT");
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
        approvalPolicy: options.allowSameStaffApproval === true ? "SINGLE_ADMIN" : "INDEPENDENT",
        requestedBy: actor.row.employeeId,
        createdAt: instant4()
      };
      const proposal = { ...key(input.branchId, "PROPOSAL#" + input.proposalId), ...body, proposalDigest: quoteHash(body), status: "AWAITING_OWNER" };
      await commit([actor.guard, ...guards, ...agreementGuards, live.guard, absent(P, proposal), audit(input.branchId, input.proposalId, "SCHEDULE_PROPOSED", actor.row.employeeId, proposal.proposalDigest)]);
      return { proposal, replayed: false };
    },
    async consent(value) {
      const input = detach(value);
      if (!input || Object.keys(input).sort().join(",") !== "branchId,proposalDigest,proposalId" || principal.kind !== "OWNER") return fail4("SCHEDULE_OWNER_REQUIRED");
      const { branch, guards } = await scope2(input.branchId);
      if (principal.subjectId !== branch.ownerId) return fail4("SCHEDULE_OWNER_REQUIRED");
      const row3 = await load(input.branchId, input.proposalId);
      if (row3.ownerId !== branch.ownerId || row3.proposalDigest !== input.proposalDigest) return fail4("SCHEDULE_PROPOSAL_CONFLICT");
      if (row3.status !== "AWAITING_OWNER") {
        if (row3.acceptedBy !== principal.subjectId || !iso(row3.acceptedAt)) return fail4("SCHEDULE_PROPOSAL_CONFLICT");
        return { proposal: row3, replayed: true };
      }
      boundary(row3.schedule, row3.effectiveFrom, row3.effectiveTo);
      const agreementGuards = await agreement(branch, row3.agreement, row3.effectiveFrom, row3.effectiveTo), live = await current(input.branchId);
      if ((live.row?.schedule?.version || 0) !== row3.baseVersion) return fail4("SCHEDULE_BASE_VERSION_CONFLICT");
      const next2 = { ...row3, status: "AWAITING_APPROVAL", acceptedBy: principal.subjectId, acceptedAt: instant4() };
      const { Key: _key, TableName: _table, ...proposalCondition } = exactCheck(P, key(input.branchId, "PROPOSAL#" + row3.proposalId), row3).ConditionCheck;
      await commit([...guards, ...agreementGuards, live.guard, { Put: { TableName: P, Item: next2, ...proposalCondition } }, audit(input.branchId, row3.proposalId, "SCHEDULE_OWNER_CONSENTED", principal.subjectId, row3.proposalDigest)]);
      return { proposal: next2, replayed: false };
    },
    async approve(value) {
      const input = detach(value);
      if (!input || Object.keys(input).sort().join(",") !== "branchId,proposalDigest,proposalId") return fail4("INVALID_SCHEDULE_REQUEST");
      const actor = await staff("APPROVE"), { branch, guards } = await scope2(input.branchId), row3 = await load(input.branchId, input.proposalId);
      if (row3.proposalDigest !== input.proposalDigest || row3.ownerId !== branch.ownerId || row3.acceptedBy !== branch.ownerId || !iso(row3.acceptedAt) || actor.row.employeeId === row3.requestedBy && !(row3.approvalPolicy === "SINGLE_ADMIN" && options.allowSameStaffApproval === true)) return fail4("SCHEDULE_INDEPENDENT_APPROVAL_REQUIRED");
      if (row3.status === "APPROVED") return { proposal: row3, replayed: true };
      if (row3.status !== "AWAITING_APPROVAL") return fail4("SCHEDULE_OWNER_CONSENT_REQUIRED");
      const requesterKey = { pk: "EMPLOYEE#" + row3.requestedBy, sk: "PROFILE" };
      const requester = await strongGet(db, S, requesterKey);
      if (!requester || requester.employeeId !== row3.requestedBy || requester.status !== "ACTIVE" || requester.scope?.allRegions !== true || requester.deletionRequestId != null || requester.deletedAt != null || requester.isDeleted === true || !allowed2(requester, "finance.settings.request") || !allowed2(requester, "finance.read")) return fail4("SCHEDULE_REQUESTER_PERMISSION_REVOKED");
      const requesterGuard = exactCheck(S, requesterKey, requester, [...Object.keys(requester), "deletionRequestId", "deletedAt", "isDeleted"]);
      boundary(row3.schedule, row3.effectiveFrom, row3.effectiveTo);
      const live = await current(input.branchId), agreementGuards = await agreement(branch, row3.agreement, row3.effectiveFrom, row3.effectiveTo);
      if ((live.row?.schedule?.version || 0) !== row3.baseVersion) return fail4("SCHEDULE_BASE_VERSION_CONFLICT");
      if (live.row && (live.row.effectiveFrom >= instant4() || merchantSettlementPeriod(live.row.schedule, row3.effectiveFrom).fromUtc !== row3.effectiveFrom)) return fail4("SCHEDULE_PERIOD_BOUNDARY_REQUIRED");
      const body = {
        schemaVersion: 1,
        kind: "MERCHANT_SETTLEMENT_SCHEDULE",
        branchId: input.branchId,
        ownerId: branch.ownerId,
        enabled: true,
        status: "APPROVED",
        schedule: row3.schedule,
        agreement: row3.agreement,
        effectiveFrom: row3.effectiveFrom,
        effectiveTo: row3.effectiveTo,
        acceptedBy: row3.acceptedBy,
        acceptedAt: row3.acceptedAt,
        approvedBy: actor.row.employeeId,
        approvedAt: instant4()
      };
      const envelope = { ...key(input.branchId, "CURRENT"), ...body, digest: quoteHash(body) };
      const next2 = { ...row3, status: "APPROVED", approvedBy: actor.row.employeeId, approvedAt: body.approvedAt };
      const condition = live.guard.ConditionCheck;
      const { Key: _a, TableName: _b, ...proposalCondition } = exactCheck(P, key(input.branchId, "PROPOSAL#" + row3.proposalId), row3).ConditionCheck;
      const { Key: _c, TableName: _d, ...currentCondition } = condition;
      await commit([
        actor.guard,
        ...actor.row.employeeId === row3.requestedBy ? [] : [requesterGuard],
        ...guards,
        ...agreementGuards,
        { Put: { TableName: P, Item: envelope, ...currentCondition } },
        absent(P, { ...envelope, ...key(input.branchId, "VERSION#" + row3.schedule.version) }),
        ...live.row ? [absent(P, {
          ...key(input.branchId, "CLOSED#" + live.row.schedule.version),
          schemaVersion: 1,
          kind: "MERCHANT_SETTLEMENT_SCHEDULE_CLOSURE",
          branchId: input.branchId,
          version: live.row.schedule.version,
          sourceDigest: live.row.digest,
          untilExclusive: row3.effectiveFrom,
          replacedByVersion: row3.schedule.version,
          proposalId: row3.proposalId,
          createdAt: body.approvedAt
        })] : [],
        { Put: { TableName: P, Item: next2, ...proposalCondition } },
        audit(input.branchId, row3.proposalId, "SCHEDULE_APPROVED", actor.row.employeeId, envelope.digest)
      ]);
      return { proposal: next2, current: envelope, replayed: false };
    }
  });
}

// backend/wallet-service/src/merchantSettlementPreview.ts
var import_lib_dynamodb9 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/deliveryPricing.ts
var PricingError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "PricingError";
  }
};
function fail5() {
  throw new PricingError("INVALID_PRICING");
}
function row(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail5();
  const r = value;
  if (Object.keys(r).some((k) => !keys.includes(k)) || keys.some((k) => !Object.prototype.hasOwnProperty.call(r, k))) return fail5();
  return r;
}
function ruleRow(value, keys) {
  return row(value, [...keys, ...value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "finalRounding") ? ["finalRounding"] : []]);
}
function roundingPolicy(r) {
  if (!Object.prototype.hasOwnProperty.call(r, "finalRounding")) return void 0;
  try {
    return readWholeIqdRounding(r.finalRounding);
  } catch {
    return fail5();
  }
}
function roundingLimits(policy, minimum2, maximum) {
  if (policy && [minimum2, maximum].some((m) => BigInt(m.minorAmount) % (BigInt(policy.incrementIqd) * 1000n) !== 0n)) return fail5();
}
function text(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,150}$/.test(value)) return fail5();
  return value;
}
function integer2(value, min = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) return fail5();
  return value;
}
function amount(value) {
  const m = readMoney(value);
  if (m.minorAmount < 0) return fail5();
  return m;
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail5();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return fail5();
  return ms;
}
var zero = moneyFromMinor(0);
var scopeTypes = ["GLOBAL", "GOVERNORATE", "CITY", "ZONE", "MERCHANT", "BRANCH"];
function scope(value) {
  const s = row(value, ["type", "id"]);
  if (!scopeTypes.includes(s.type)) return fail5();
  const id3 = text(s.id);
  if (s.type === "GLOBAL" && id3 !== "GLOBAL") return fail5();
  return { type: s.type, id: id3 };
}
function context(value) {
  const c = row(value, ["branchId", "merchantId", "zoneId", "cityId", "governorateId", "vehicleType"]);
  return { branchId: text(c.branchId), merchantId: text(c.merchantId), zoneId: text(c.zoneId), cityId: text(c.cityId), governorateId: text(c.governorateId), vehicleType: text(c.vehicleType) };
}
function common(r) {
  const version = integer2(r.version, 1), s = scope(r.scope), priority = integer2(r.priority);
  if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(r.status)) return fail5();
  const start = timestamp(r.effectiveFrom), end = r.effectiveTo === null ? Infinity : timestamp(r.effectiveTo);
  if (end <= start) return fail5();
  const rounding = r.rounding;
  if (!["EXACT", "TOWARD_ZERO", "HALF_AWAY_FROM_ZERO"].includes(rounding)) return fail5();
  if (r.vehicleType !== null) text(r.vehicleType);
  return { id: text(r.id), version, scope: s, priority, status: r.status, start, end, rounding, vehicleType: r.vehicleType, finalRounding: roundingPolicy(r) };
}
var commonKeys = ["id", "version", "scope", "priority", "status", "effectiveFrom", "effectiveTo", "rounding", "vehicleType"];
function surcharge(value) {
  const s = row(value, ["afterMeters", "flat", "perKm"]);
  return { afterMeters: integer2(s.afterMeters), flat: amount(s.flat), perKm: amount(s.perKm) };
}
function peaks(value) {
  if (!Array.isArray(value) || value.length > 100) return fail5();
  const list = value.map((v) => {
    const p = row(v, ["id", "from", "to", "amount"]);
    const start = timestamp(p.from), end = timestamp(p.to);
    if (end <= start) return fail5();
    return { id: text(p.id), start, end, amount: amount(p.amount) };
  }).sort((a, b) => a.start - b.start);
  if (new Set(list.map((p) => p.id)).size !== list.length || list.some((p, i) => i > 0 && p.start < list[i - 1].end)) return fail5();
  return list;
}
function compensationRule(value) {
  const r = ruleRow(value, [...commonKeys, "base", "pickupPerKm", "pickupIncludedMeters", "deliveryPerKm", "perMinute", "longDistance", "peaks", "minimum", "maximum", "fallbackPolicyId"]);
  const c = common(r), minimum2 = amount(r.minimum), maximum = amount(r.maximum);
  if (maximum.minorAmount < minimum2.minorAmount) return fail5();
  roundingLimits(c.finalRounding, minimum2, maximum);
  if (r.fallbackPolicyId !== null) text(r.fallbackPolicyId);
  return {
    ...c,
    base: amount(r.base),
    pickupPerKm: amount(r.pickupPerKm),
    pickupIncludedMeters: integer2(r.pickupIncludedMeters),
    deliveryPerKm: amount(r.deliveryPerKm),
    perMinute: amount(r.perMinute),
    longDistance: surcharge(r.longDistance),
    peaks: peaks(r.peaks),
    minimum: minimum2,
    maximum,
    fallbackPolicyId: r.fallbackPolicyId
  };
}
function select(rules, c, at) {
  const ids = { GLOBAL: "GLOBAL", GOVERNORATE: c.governorateId, CITY: c.cityId, ZONE: c.zoneId, MERCHANT: c.merchantId, BRANCH: c.branchId };
  const matches = rules.filter((r) => r.status === "PUBLISHED" && r.start <= at && at < r.end && ids[r.scope.type] === r.scope.id && (r.vehicleType === null || r.vehicleType === c.vehicleType));
  matches.sort((a, b) => scopeTypes.indexOf(b.scope.type) - scopeTypes.indexOf(a.scope.type) || b.priority - a.priority);
  if (!matches.length) throw new PricingError("NO_PRICING_RULE");
  if (matches[1] && matches[0].scope.type === matches[1].scope.type && matches[0].priority === matches[1].priority) throw new PricingError("AMBIGUOUS_PRICING_RULE");
  return matches[0];
}
function readRules(values, parse) {
  if (!Array.isArray(values) || values.length > 1e3) return fail5();
  const rules = values.map(parse);
  const identities = values.map((v) => `${v.id}:${v.version}`);
  if (new Set(identities).size !== identities.length) return fail5();
  return rules;
}
function route(value, at, fallbackPolicyId) {
  const r = row(value, ["id", "source", "quality", "fallbackPolicyId", "distanceMeters", "durationSeconds", "measuredAt", "expiresAt"]);
  const measuredAt = timestamp(r.measuredAt), expiresAt = timestamp(r.expiresAt);
  text(r.id);
  text(r.source);
  if (measuredAt > at || expiresAt <= at || expiresAt <= measuredAt) throw new PricingError("ROUTE_UNAVAILABLE");
  if (r.quality !== "ROAD" && r.quality !== "ESTIMATED") return fail5();
  if (r.quality === "ROAD" && r.fallbackPolicyId !== null) return fail5();
  if (r.quality === "ESTIMATED" && (fallbackPolicyId === null || text(r.fallbackPolicyId) !== fallbackPolicyId)) throw new PricingError("ROUTE_UNAVAILABLE");
  return Object.freeze({
    id: r.id,
    source: r.source,
    quality: r.quality,
    fallbackPolicyId: r.fallbackPolicyId,
    distanceMeters: integer2(r.distanceMeters),
    durationSeconds: integer2(r.durationSeconds),
    measuredAt: r.measuredAt,
    expiresAt: r.expiresAt
  });
}
function scaled(m, count, units, rounding) {
  return multiplyMoney(m, count, units, rounding);
}
function longPay(s, meters, rounding) {
  return meters > s.afterMeters ? addMoney(s.flat, scaled(s.perKm, meters - s.afterMeters, 1e3, rounding)) : zero;
}
function peakPay(list, at) {
  return list.find((p) => p.start <= at && at < p.end)?.amount ?? zero;
}
function clamp(m, min, max) {
  return m.minorAmount < min.minorAmount ? min : m.minorAmount > max.minorAmount ? max : m;
}
function reference(r) {
  return Object.freeze({ id: r.id, version: r.version, scope: Object.freeze({ ...r.scope }) });
}
function calculateDriverEarning(value) {
  const input = row(value, ["schemaVersion", "at", "context", "rules", "pickupRoute", "deliveryRoute"]);
  if (input.schemaVersion !== 1) return fail5();
  const at = timestamp(input.at), c = context(input.context), r = select(readRules(input.rules, compensationRule), c, at);
  const pickupRoute = route(input.pickupRoute, at, r.fallbackPolicyId), deliveryRoute = route(input.deliveryRoute, at, r.fallbackPolicyId);
  const pickup = scaled(r.pickupPerKm, Math.max(0, pickupRoute.distanceMeters - r.pickupIncludedMeters), 1e3, r.rounding);
  const delivery = scaled(r.deliveryPerKm, deliveryRoute.distanceMeters, 1e3, r.rounding);
  const seconds = BigInt(pickupRoute.durationSeconds) + BigInt(deliveryRoute.durationSeconds);
  const meters = BigInt(pickupRoute.distanceMeters) + BigInt(deliveryRoute.distanceMeters);
  if (seconds > BigInt(Number.MAX_SAFE_INTEGER) || meters > BigInt(Number.MAX_SAFE_INTEGER)) return fail5();
  const time2 = scaled(r.perMinute, Number(seconds), 60, r.rounding);
  const longDistance = longPay(r.longDistance, deliveryRoute.distanceMeters, r.rounding), peak = peakPay(r.peaks, at);
  const beforeLimits = addMoney(r.base, pickup, delivery, time2, longDistance, peak);
  const boundedEarning = clamp(beforeLimits, r.minimum, r.maximum);
  const driverEarning = r.finalRounding ? quantizeWholeIqd(boundedEarning, r.finalRounding) : boundedEarning;
  return Object.freeze({
    engineVersion: "DRIVER_COMPENSATION_V1",
    basis: "CALCULATION_PROPOSAL",
    rule: reference(r),
    pickupRoute,
    deliveryRoute,
    totalDistanceMeters: Number(meters),
    totalDurationSeconds: Number(seconds),
    components: Object.freeze({ base: r.base, pickup, delivery, time: time2, longDistance, peak, beforeLimits, limitAdjustment: subtractMoney(boundedEarning, beforeLimits), ...r.finalRounding ? { finalRounding: r.finalRounding, finalRoundingAdjustment: subtractMoney(driverEarning, boundedEarning) } : {} }),
    driverEarning
  });
}

// backend/wallet-service/src/orderAllocation.ts
var AllocationError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "AllocationError";
  }
};
var fields = ["goodsGross", "merchantGoodsDiscount", "platformGoodsDiscount", "merchantCommission", "serviceFee", "customerDeliveryFee", "driverEarning", "driverTip", "merchantOtherCharges", "platformOtherCharges", "thirdPartyOtherCharges"];
function allocateOrder(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AllocationError("INVALID_ALLOCATION");
  const raw = value;
  if (raw.allocationSchemaVersion !== 1 || !["COD", "PREPAID"].includes(raw.paymentMethod) || Object.keys(raw).some((key4) => !["allocationSchemaVersion", "paymentMethod", ...fields].includes(key4))) throw new AllocationError("INVALID_ALLOCATION");
  const amounts = {};
  for (const field of fields) {
    amounts[field] = readMoney(raw[field]);
    if (amounts[field].minorAmount < 0) throw new AllocationError("NEGATIVE_COMPONENT");
  }
  const a = amounts, zero2 = moneyFromMinor(0);
  const merchantGoodsEntitlement = subtractMoney(a.goodsGross, a.merchantGoodsDiscount);
  const customerGoodsPayment = subtractMoney(merchantGoodsEntitlement, a.platformGoodsDiscount);
  if (merchantGoodsEntitlement.minorAmount < 0 || customerGoodsPayment.minorAmount < 0) throw new AllocationError("EXCESS_GOODS_DISCOUNT");
  if (a.merchantCommission.minorAmount > merchantGoodsEntitlement.minorAmount) throw new AllocationError("EXCESS_COMMISSION");
  const merchantPayable = addMoney(subtractMoney(merchantGoodsEntitlement, a.merchantCommission), a.merchantOtherCharges);
  const customerTotal = addMoney(
    customerGoodsPayment,
    a.serviceFee,
    a.customerDeliveryFee,
    a.driverTip,
    a.merchantOtherCharges,
    a.platformOtherCharges,
    a.thirdPartyOtherCharges
  );
  const deliveryMargin = subtractMoney(a.customerDeliveryFee, a.driverEarning);
  const deliverySurplus = deliveryMargin.minorAmount > 0 ? deliveryMargin : zero2;
  const deliverySubsidy = deliveryMargin.minorAmount < 0 ? subtractMoney(zero2, deliveryMargin) : zero2;
  const platformNetContribution = addMoney(
    a.merchantCommission,
    a.serviceFee,
    a.platformOtherCharges,
    deliveryMargin,
    subtractMoney(zero2, a.platformGoodsDiscount)
  );
  const driverTotalEntitlement = addMoney(a.driverEarning, a.driverTip);
  const cod = raw.paymentMethod === "COD";
  const driverWalletHold = cod ? addMoney(
    customerGoodsPayment,
    a.serviceFee,
    deliverySurplus,
    a.merchantOtherCharges,
    a.platformOtherCharges,
    a.thirdPartyOtherCharges
  ) : zero2;
  const driverCashRetained = cod ? subtractMoney(customerTotal, driverWalletHold) : zero2;
  const driverCashTipRetained = cod ? a.driverTip : zero2;
  const driverCashEarningRetained = cod ? subtractMoney(driverCashRetained, a.driverTip) : zero2;
  const driverWalletEarningCredit = cod ? deliverySubsidy : a.driverEarning;
  const driverWalletTipCredit = cod ? zero2 : a.driverTip;
  const driverWalletCreditTotal = addMoney(driverWalletEarningCredit, driverWalletTipCredit);
  const platformCollection = cod ? driverWalletHold : customerTotal;
  const platformFundsAfterDriverCredit = subtractMoney(platformCollection, driverWalletCreditTotal);
  const platformSubsidy = addMoney(deliverySubsidy, a.platformGoodsDiscount);
  return Object.freeze({
    ruleVersion: "ORDER_ALLOCATION_V1",
    basis: "SUCCESSFUL_DELIVERY_PROPOSAL",
    paymentMethod: raw.paymentMethod,
    customerGoodsPayment,
    customerTotal,
    merchantGoodsEntitlement,
    merchantPayable,
    merchantCommission: a.merchantCommission,
    thirdPartyPayable: a.thirdPartyOtherCharges,
    driverEarningEntitlement: a.driverEarning,
    driverTipEntitlement: a.driverTip,
    driverTotalEntitlement,
    deliveryMargin,
    deliverySurplus,
    deliverySubsidy,
    platformGoodsDiscountFunding: a.platformGoodsDiscount,
    platformSubsidy,
    platformNetContribution,
    driverWalletHold,
    driverCashRetained,
    driverCashEarningRetained,
    driverCashTipRetained,
    driverWalletEarningCredit,
    driverWalletTipCredit,
    driverWalletCreditTotal,
    platformCollection,
    platformFundsAfterDriverCredit
  });
}

// backend/wallet-service/src/driverOffer.ts
var DriverOfferError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DriverOfferError";
  }
};
var fail6 = (code = "INVALID_DRIVER_OFFER") => {
  throw new DriverOfferError(code);
};
function row2(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail6();
  const r = value;
  if (Object.keys(r).sort().join(",") !== [...keys].sort().join(",")) return fail6();
  return r;
}
function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,150}$/.test(value)) return fail6();
  return value;
}
function integer3(value, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return fail6();
  return value;
}
function time(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail6();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return fail6();
  return ms;
}
function point(value) {
  const p = row2(value, ["latitude", "longitude"]);
  if (typeof p.latitude !== "number" || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || typeof p.longitude !== "number" || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) return fail6();
  return { latitude: p.latitude, longitude: p.longitude };
}
var equal2 = (a, b) => quoteCanonical(a) === quoteCanonical(b);
function boundRoute(value) {
  const r = row2(value, ["schemaVersion", "origin", "destination", "profile", "normalization", "route"]);
  if (r.schemaVersion !== 1 || !["driving", "driving-traffic"].includes(r.profile) || r.normalization !== "CEIL_METERS_SECONDS_V1") return fail6();
  if (r.route?.quality !== "ROAD" || r.route.fallbackPolicyId !== null || r.route.source !== "MAPBOX_DIRECTIONS_V5") return fail6();
  return { ...r, origin: point(r.origin), destination: point(r.destination) };
}
function validateDriverOfferOrderSnapshot(value) {
  const o = row2(value, [
    "snapshotId",
    "revision",
    "orderId",
    "branchId",
    "merchantId",
    "zoneId",
    "cityId",
    "governorateId",
    "branchPoint",
    "customerPoint",
    "confirmedCustomerTotal",
    "allocation",
    "paymentEvidence"
  ]);
  for (const field of ["snapshotId", "orderId", "branchId", "merchantId", "zoneId", "cityId", "governorateId"]) id(o[field]);
  integer3(o.revision);
  const a = row2(o.allocation, [
    "allocationSchemaVersion",
    "paymentMethod",
    "goodsGross",
    "merchantGoodsDiscount",
    "platformGoodsDiscount",
    "merchantCommission",
    "serviceFee",
    "customerDeliveryFee",
    "driverTip",
    "merchantOtherCharges",
    "platformOtherCharges",
    "thirdPartyOtherCharges"
  ]);
  const allocation = allocateOrder({ ...a, driverEarning: moneyFromMinor(0) });
  const total = readMoney(o.confirmedCustomerTotal);
  if (!equal2(total, allocation.customerTotal)) return fail6();
  if (a.paymentMethod === "PREPAID") {
    const payment = row2(o.paymentEvidence, ["reference", "verifiedAt", "amount"]);
    id(payment.reference);
    time(payment.verifiedAt);
    if (!equal2(readMoney(payment.amount), total)) return fail6();
  } else if (o.paymentEvidence !== null) return fail6();
  return { ...o, branchPoint: point(o.branchPoint), customerPoint: point(o.customerPoint), confirmedCustomerTotal: total };
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
var copy = (value) => JSON.parse(JSON.stringify(value));
function buildDriverOffer(value) {
  const input = row2(value, ["schemaVersion", "offerId", "assignment", "driver", "order", "policy", "pickupRoute", "deliveryRoute", "at", "ttlSeconds"]);
  if (input.schemaVersion !== 1 || Buffer.byteLength(JSON.stringify(input)) > 2e5) return fail6();
  const source = copy(input), at = time(source.at), ttl = integer3(source.ttlSeconds, 1, 900);
  id(source.offerId);
  const assignment = row2(source.assignment, ["id", "version", "expiresAt"]);
  id(assignment.id);
  integer3(assignment.version);
  const driver = row2(source.driver, ["id", "subjectId", "vehicleType", "positionVersion", "point", "observedAt", "expiresAt"]);
  for (const name of ["id", "subjectId", "vehicleType"]) id(driver[name]);
  integer3(driver.positionVersion);
  if (time(driver.observedAt) > at || time(driver.expiresAt) <= at) return fail6("DRIVER_OFFER_EXPIRED");
  const order = validateDriverOfferOrderSnapshot(source.order), policy = row2(source.policy, ["version", "rules"]);
  integer3(policy.version);
  if (order.paymentEvidence && time(order.paymentEvidence.verifiedAt) > at) return fail6();
  const pickupRoute = boundRoute(source.pickupRoute), deliveryRoute = boundRoute(source.deliveryRoute);
  if (pickupRoute.profile !== deliveryRoute.profile || !equal2(point(driver.point), pickupRoute.origin) || !equal2(pickupRoute.destination, order.branchPoint) || !equal2(deliveryRoute.origin, order.branchPoint) || !equal2(deliveryRoute.destination, order.customerPoint)) return fail6("DRIVER_OFFER_SCOPE_MISMATCH");
  const context2 = {
    branchId: order.branchId,
    merchantId: order.merchantId,
    zoneId: order.zoneId,
    cityId: order.cityId,
    governorateId: order.governorateId,
    vehicleType: driver.vehicleType
  };
  const calculation = calculateDriverEarning({
    schemaVersion: 1,
    at: source.at,
    context: context2,
    rules: policy.rules,
    pickupRoute: pickupRoute.route,
    deliveryRoute: deliveryRoute.route
  });
  const selectedRule = policy.rules.find((r) => r.id === calculation.rule.id && r.version === calculation.rule.version);
  const expiresAt = Math.min(
    at + ttl * 1e3,
    time(assignment.expiresAt),
    time(driver.expiresAt),
    time(pickupRoute.route.expiresAt),
    time(deliveryRoute.route.expiresAt),
    selectedRule.effectiveTo === null ? Infinity : time(selectedRule.effectiveTo)
  );
  if (expiresAt <= at) return fail6("DRIVER_OFFER_EXPIRED");
  const allocation = allocateOrder({ ...order.allocation, driverEarning: calculation.driverEarning });
  if (!equal2(allocation.customerTotal, order.confirmedCustomerTotal)) return fail6();
  const content = {
    schemaVersion: 1,
    kind: "DRIVER_OFFER_PROPOSAL",
    offerId: source.offerId,
    createdAt: source.at,
    expiresAt: new Date(expiresAt).toISOString(),
    driverId: driver.id,
    driverSubjectId: driver.subjectId,
    orderId: order.orderId,
    branchId: order.branchId,
    assignmentId: assignment.id,
    assignmentVersion: assignment.version,
    snapshotId: order.snapshotId,
    orderRevision: order.revision,
    snapshotHash: quoteHash(order),
    policyVersion: policy.version,
    ruleHash: quoteHash(selectedRule),
    calculation,
    allocation,
    source
  };
  return freeze({ ...content, digest: quoteHash(content) });
}
function storedOffer(value) {
  try {
    const offered = value, rebuilt = buildDriverOffer(offered?.source);
    if (!equal2(rebuilt, offered)) return fail6();
    return rebuilt;
  } catch {
    return fail6();
  }
}
function driverOfferView(value, driverId, subjectId, at) {
  const offer = storedOffer(value), ms = time(at);
  if (offer.driverId !== id(driverId) || offer.driverSubjectId !== id(subjectId)) return fail6("DRIVER_OFFER_SCOPE_MISMATCH");
  if (ms < time(offer.createdAt) || ms >= time(offer.expiresAt)) return fail6("DRIVER_OFFER_EXPIRED");
  const a = offer.allocation, c = offer.calculation;
  return freeze(copy({
    schemaVersion: 1,
    kind: offer.kind,
    offerId: offer.offerId,
    offerDigest: offer.digest,
    waveNumber: offer.assignmentVersion,
    orderId: offer.orderId,
    branchId: offer.branchId,
    createdAt: offer.createdAt,
    expiresAt: offer.expiresAt,
    pickupLocation: offer.source.order.branchPoint,
    deliveryZoneId: offer.source.order.zoneId,
    paymentMethod: a.paymentMethod,
    pickupDistanceMeters: c.pickupRoute.distanceMeters,
    pickupDurationSeconds: c.pickupRoute.durationSeconds,
    deliveryDistanceMeters: c.deliveryRoute.distanceMeters,
    deliveryDurationSeconds: c.deliveryRoute.durationSeconds,
    totalDistanceMeters: c.totalDistanceMeters,
    totalDurationSeconds: c.totalDurationSeconds,
    earningComponents: {
      base: c.components.base,
      pickup: c.components.pickup,
      delivery: c.components.delivery,
      time: c.components.time,
      longDistance: c.components.longDistance,
      peak: c.components.peak,
      limitAdjustment: c.components.limitAdjustment
    },
    driverEarning: c.driverEarning,
    driverTip: a.driverTipEntitlement,
    driverTotalEntitlement: a.driverTotalEntitlement,
    customerCashToCollect: a.paymentMethod === "COD" ? a.customerTotal : moneyFromMinor(0),
    driverWalletHold: a.driverWalletHold,
    driverCashRetained: a.driverCashRetained,
    laterWalletEarningCredit: a.driverWalletEarningCredit,
    laterWalletTipCredit: a.driverWalletTipCredit,
    walletCreditsRequireConfirmedCompletionAndFunding: true
  }));
}
function prepareDriverOfferAcceptance(value) {
  const input = row2(value, ["offer", "offerId", "driverId", "subjectId", "assignmentId", "assignmentVersion", "order", "at", "policy"]);
  const offer = storedOffer(input.offer);
  driverOfferView(offer, id(input.driverId), id(input.subjectId), input.at);
  if (offer.offerId !== id(input.offerId) || offer.assignmentId !== id(input.assignmentId) || offer.assignmentVersion !== integer3(input.assignmentVersion)) return fail6("DRIVER_OFFER_SCOPE_MISMATCH");
  const currentOrder = validateDriverOfferOrderSnapshot(input.order);
  if (quoteHash(currentOrder) !== offer.snapshotHash) return fail6("DRIVER_OFFER_SNAPSHOT_CHANGED");
  if (currentOrder.paymentEvidence && time(currentOrder.paymentEvidence.verifiedAt) > time(input.at)) return fail6();
  const policy = row2(input.policy, ["version", "enabledRuleVersions"]);
  integer3(policy.version);
  if (policy.version < offer.policyVersion || !Array.isArray(policy.enabledRuleVersions) || policy.enabledRuleVersions.length > 1e3) return fail6("DRIVER_OFFER_RULE_DISABLED");
  const enabled = policy.enabledRuleVersions.map((v) => {
    const r = row2(v, ["id", "version", "hash"]);
    id(r.id);
    integer3(r.version);
    if (typeof r.hash !== "string" || !/^[a-f0-9]{64}$/.test(r.hash)) return fail6();
    return r;
  });
  if (new Set(enabled.map((r) => r.id + ":" + r.version)).size !== enabled.length) return fail6();
  if (!enabled.some((r) => r.id === offer.calculation.rule.id && r.version === offer.calculation.rule.version && r.hash === offer.ruleHash)) return fail6("DRIVER_OFFER_RULE_DISABLED");
  const a = offer.allocation;
  let walletAmounts;
  try {
    walletAmounts = {
      acceptanceHoldIqd: toWholeIqdExact(a.driverWalletHold),
      completionEarningCreditIqd: toWholeIqdExact(a.driverWalletEarningCredit),
      completionTipCreditIqd: toWholeIqdExact(a.driverWalletTipCredit)
    };
  } catch {
    return fail6("DRIVER_OFFER_WALLET_PRECISION_UNSUPPORTED");
  }
  return freeze(copy({
    kind: "DRIVER_OFFER_ACCEPTANCE_PLAN",
    performsWrites: false,
    expected: {
      offerId: offer.offerId,
      digest: offer.digest,
      responseStatus: "pending",
      assignmentId: offer.assignmentId,
      assignmentVersion: offer.assignmentVersion,
      orderId: offer.orderId,
      orderRevision: offer.orderRevision,
      snapshotHash: offer.snapshotHash,
      driverId: offer.driverId,
      driverSubjectId: offer.driverSubjectId,
      policyVersion: policy.version,
      expiresAt: offer.expiresAt
    },
    acceptedTerms: {
      schemaVersion: 1,
      offerId: offer.offerId,
      offerDigest: offer.digest,
      rule: offer.calculation.rule,
      ruleHash: offer.ruleHash,
      offeredPolicyVersion: offer.policyVersion,
      acceptedAt: input.at,
      paymentMethod: a.paymentMethod,
      customerTotal: a.customerTotal,
      customerDeliveryFee: currentOrder.allocation.customerDeliveryFee,
      driverEarning: a.driverEarningEntitlement,
      driverTip: a.driverTipEntitlement,
      driverWalletHold: a.driverWalletHold,
      allocation: a,
      calculation: offer.calculation
    },
    legacyWalletAmounts: walletAmounts,
    financialWriterAndFundingChecksRequired: true
  }));
}

// backend/wallet-service/src/deliveryFundedAllocation.ts
var DeliveryFundedAllocationError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DeliveryFundedAllocationError";
  }
};
var fail7 = (code = "INVALID_DELIVERY_FUNDED_ALLOCATION") => {
  throw new DeliveryFundedAllocationError(code);
};
function exact(v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== [...keys].sort().join(",")) return fail7();
  return v;
}
function amount2(v) {
  const m = readMoney(v);
  if (m.minorAmount < 0) return fail7();
  return m;
}
var positive = (m) => m.minorAmount > 0 ? m : moneyFromMinor(0);
function allocateDeliveryFundedOrder(value) {
// platformBenefitFinancialCompatibility
if(typeof value?.deliveryFunding?.policyPin?.policyId==='string'&&value.deliveryFunding.policyPin.policyId.startsWith('PLATFORM_BENEFIT#'))return require("./financial-compatibility.js").allocateDeliveryFundedOrder(value);

  try {
    const r = exact(value, ["allocationSchemaVersion", "base", "deliveryFunding"]);
    if (r.allocationSchemaVersion !== 2) return fail7();
    const funding = exact(r.deliveryFunding, ["policyPin", "allocation"]), pin = exact(funding.policyPin, ["policyId", "version", "termsHash"]);
    if (!quoteEntityIdValid(pin.policyId) || !Number.isSafeInteger(pin.version) || pin.version < 1 || typeof pin.termsHash !== "string" || !/^[a-f0-9]{64}$/.test(pin.termsHash)) return fail7();
    const a = exact(funding.allocation, ["schemaVersion", "referenceFee", "customerFee", "subsidy", "merchantShare", "platformShare"]);
    if (![1, 2].includes(a.schemaVersion)) return fail7();
    const referenceFee = amount2(a.referenceFee), customerFee = amount2(a.customerFee), subsidy = amount2(a.subsidy), merchantShare = amount2(a.merchantShare), platformShare = amount2(a.platformShare);
    if ((a.schemaVersion === 2 ? Math.max(0, referenceFee.minorAmount - customerFee.minorAmount) : subtractMoney(referenceFee, customerFee).minorAmount) !== subsidy.minorAmount || addMoney(merchantShare, platformShare).minorAmount !== subsidy.minorAmount) return fail7("DELIVERY_FUNDING_MISMATCH");
    const base = allocateOrder(r.base);
    if (readMoney(r.base.customerDeliveryFee).minorAmount !== customerFee.minorAmount) return fail7("DELIVERY_FUNDING_MISMATCH");
    const merchantPayable = subtractMoney(base.merchantPayable, merchantShare);
    if (merchantPayable.minorAmount < 0) return fail7("MERCHANT_DELIVERY_SUPPORT_EXCEEDS_PAYABLE");
    const baselineDeliveryMargin = subtractMoney(a.schemaVersion === 2 ? addMoney(customerFee, subsidy) : referenceFee, base.driverEarningEntitlement);
    const deliveryNetContribution = subtractMoney(baselineDeliveryMargin, platformShare);
    const platformNetContribution = addMoney(base.platformNetContribution, merchantShare);
    const sum = addMoney(merchantPayable, base.driverTotalEntitlement, base.thirdPartyPayable, platformNetContribution);
    if (sum.minorAmount !== base.customerTotal.minorAmount) return fail7("DELIVERY_ALLOCATION_UNBALANCED");
    const netDeliverySubsidy = positive(subtractMoney(base.deliverySubsidy, merchantShare));
    const retained = { policyId: pin.policyId, version: pin.version, termsHash: pin.termsHash };
    return Object.freeze({
      ...base,
      ruleVersion: "ORDER_ALLOCATION_V2_DELIVERY_FUNDING",
      merchantPayableBeforeDeliverySupport: base.merchantPayable,
      merchantPayable,
      merchantDeliverySupport: merchantShare,
      platformDeliveryPromotionFunding: platformShare,
      platformPromotionCashReservation: addMoney(base.platformGoodsDiscountFunding, platformShare),
      referenceDeliveryFee: referenceFee,
      customerDeliveryFee: customerFee,
      deliveryPromotionSubsidy: subsidy,
      baselineDeliveryMargin,
      platformBaselineDeliverySubsidy: positive(subtractMoney(moneyFromMinor(0), baselineDeliveryMargin)),
      deliveryNetContribution,
      grossDeliveryShortfall: base.deliverySubsidy,
      deliverySubsidy: netDeliverySubsidy,
      platformSubsidy: addMoney(netDeliverySubsidy, base.platformGoodsDiscountFunding),
      platformNetContribution,
      deliveryFundingPin: Object.freeze(retained)
    });
  } catch (e) {
    if (e instanceof DeliveryFundedAllocationError) throw e;
    return fail7();
  }
}

// backend/wallet-service/src/fullCashSettlement.ts
var FULL_CASH_SETTLEMENT_MODEL = "FULL_CASH_AT_DELIVERY_V1";
var FullCashSettlementError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "FullCashSettlementError";
  }
};
var fail8 = (code = "INVALID_FULL_CASH_SETTLEMENT") => {
  throw new FullCashSettlementError(code);
};
var clone = (value) => JSON.parse(JSON.stringify(value));
function freeze2(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze2);
    Object.freeze(value);
  }
  return value;
}
var positive2 = (value) => value.minorAmount > 0 ? value : moneyFromMinor(0);
var minimum = (a, b) => moneyFromMinor(Math.min(a.minorAmount, b.minorAmount));
function prepareFullCashSettlement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "base,deliveryFunding,settlementSchemaVersion") return fail8();
  const source = clone(value);
  if (source.settlementSchemaVersion !== 1) return fail8();
  const economic = source.deliveryFunding === null ? allocateOrder(source.base) : allocateDeliveryFundedOrder({ allocationSchemaVersion: 2, base: source.base, deliveryFunding: source.deliveryFunding });
  const cod = economic.paymentMethod === "COD", zero2 = moneyFromMinor(0);
  const driverCashRetained = cod ? minimum(economic.customerTotal, economic.driverTotalEntitlement) : zero2;
  const driverWalletHold = cod ? positive2(subtractMoney(economic.customerTotal, economic.driverTotalEntitlement)) : zero2;
  const driverWalletCreditTotal = subtractMoney(economic.driverTotalEntitlement, driverCashRetained);
  const driverCashTipRetained = cod ? minimum(economic.driverTipEntitlement, driverCashRetained) : zero2;
  const driverWalletTipCredit = subtractMoney(economic.driverTipEntitlement, driverCashTipRetained);
  const platformCollection = cod ? driverWalletHold : economic.customerTotal;
  const allocation = {
    ...economic,
    ruleVersion: "ORDER_ALLOCATION_V3_FULL_CASH",
    driverCashRetained,
    driverWalletHold,
    driverWalletCreditTotal,
    driverCashTipRetained,
    driverWalletTipCredit,
    driverCashEarningRetained: subtractMoney(driverCashRetained, driverCashTipRetained),
    driverWalletEarningCredit: subtractMoney(driverWalletCreditTotal, driverWalletTipCredit),
    platformCollection,
    platformFundsAfterDriverCredit: subtractMoney(platformCollection, driverWalletCreditTotal)
  };
  if (quoteCanonical(addMoney(
    allocation.merchantPayable,
    allocation.driverTotalEntitlement,
    allocation.thirdPartyPayable,
    allocation.platformNetContribution
  )) !== quoteCanonical(allocation.customerTotal) || quoteCanonical(addMoney(allocation.driverCashRetained, allocation.driverWalletCreditTotal)) !== quoteCanonical(allocation.driverTotalEntitlement) || quoteCanonical(subtractMoney(platformCollection, driverWalletCreditTotal)) !== quoteCanonical(addMoney(allocation.merchantPayable, allocation.thirdPartyPayable, allocation.platformNetContribution))) return fail8("FULL_CASH_CONSERVATION_FAILED");
  const content = {
    schemaVersion: 3,
    kind: "FULL_CASH_SETTLEMENT_ALLOCATION",
    settlementModel: FULL_CASH_SETTLEMENT_MODEL,
    source,
    allocation
  };
  return freeze2({ ...content, digest: quoteHash(content) });
}
function verifyFullCashSettlement(value) {
  const saved = value;
  const rebuilt = prepareFullCashSettlement(saved?.source);
  if (quoteCanonical(saved) !== quoteCanonical(rebuilt)) return fail8("FULL_CASH_SETTLEMENT_CHANGED");
  return rebuilt;
}
function prepareFullCashJournal(value) {
  const proposal = verifyFullCashSettlement(value), a = proposal.allocation, source = proposal.source;
  const delivery = source.deliveryFunding !== null;
  const goodsFunding = readMoney(a.platformGoodsDiscountFunding);
  const deliveryFunding = delivery ? readMoney(a.platformDeliveryPromotionFunding) : moneyFromMinor(0);
  const baselineMargin = delivery ? readMoney(a.baselineDeliveryMargin) : readMoney(a.deliveryMargin);
  const lines = [];
  function post(account, side, value2) {
    const amount4 = readMoney(value2);
    if (amount4.minorAmount < 0) return fail8("FULL_CASH_NEGATIVE_POSTING");
    if (amount4.minorAmount) lines.push({ account, side, amount: amount4 });
  }
  post(a.paymentMethod === "COD" ? "DRIVER_PREPAID_COLLATERAL" : "PAYMENT_PROVIDER_CLEARING", "DEBIT", a.platformCollection);
  post("MERCHANT_PAYABLE", "CREDIT", a.merchantPayable);
  post("DRIVER_WALLET_PAYABLE", "CREDIT", a.driverWalletCreditTotal);
  post("THIRD_PARTY_PAYABLE", "CREDIT", a.thirdPartyPayable);
  post("MERCHANT_COMMISSION_REVENUE", "CREDIT", a.merchantCommission);
  post("SERVICE_FEE_REVENUE", "CREDIT", readMoney(source.base.serviceFee));
  post("PLATFORM_OTHER_REVENUE", "CREDIT", readMoney(source.base.platformOtherCharges));
  post("PLATFORM_GOODS_PROMOTION_EXPENSE", "DEBIT", goodsFunding);
  post("PLATFORM_DELIVERY_PROMOTION_EXPENSE", "DEBIT", deliveryFunding);
  post(
    baselineMargin.minorAmount < 0 ? "BASE_DELIVERY_SUBSIDY_EXPENSE" : "BASE_DELIVERY_MARGIN_REVENUE",
    baselineMargin.minorAmount < 0 ? "DEBIT" : "CREDIT",
    moneyFromMinor(Math.abs(baselineMargin.minorAmount))
  );
  const debit = addMoney(...lines.filter((l) => l.side === "DEBIT").map((l) => l.amount));
  const credit = addMoney(...lines.filter((l) => l.side === "CREDIT").map((l) => l.amount));
  if (debit.minorAmount !== credit.minorAmount) return fail8("FULL_CASH_JOURNAL_UNBALANCED");
  const content = {
    schemaVersion: 1,
    kind: "FULL_CASH_POSTING_PROPOSAL",
    settlementModel: proposal.settlementModel,
    allocationDigest: proposal.digest,
    paymentMethod: a.paymentMethod,
    lines,
    debit,
    credit,
    funding: {
      platformGoodsPromotion: goodsFunding,
      platformDeliveryPromotion: deliveryFunding,
      merchantDeliverySupport: delivery ? readMoney(a.merchantDeliverySupport) : moneyFromMinor(0),
      platformNetContribution: a.platformNetContribution,
      platformNetFundingObligation: positive2(subtractMoney(moneyFromMinor(0), a.platformNetContribution)),
      driverWalletCreditDueAtCompletion: a.driverWalletCreditTotal
    },
    canPost: false,
    paymentVerified: false,
    walletMutationPerformed: false
  };
  return freeze2({ ...content, digest: quoteHash(content) });
}

// backend/wallet-service/src/fullCashOffer.ts
var fail9 = (code = "INVALID_FULL_CASH_OFFER") => {
  throw Object.assign(Error(code), { code });
};
var copy2 = (v) => JSON.parse(JSON.stringify(v));
var same2 = (a, b) => quoteCanonical(a) === quoteCanonical(b);
function freeze3(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze3);
    Object.freeze(v);
  }
  return v;
}
function exact2(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) return fail9();
  return value;
}
function prepareFullCashOrderSnapshot(value) {
  const r = exact2(value, ["order", "deliveryFunding"]), order = validateDriverOfferOrderSnapshot(copy2(r.order));
  prepareFullCashSettlement({
    settlementSchemaVersion: 1,
    base: { ...order.allocation, driverEarning: moneyFromMinor(0) },
    deliveryFunding: r.deliveryFunding
  });
  const body = {
    schemaVersion: 3,
    kind: "ORDER_FULL_CASH_SNAPSHOT",
    settlementModel: FULL_CASH_SETTLEMENT_MODEL,
    order,
    deliveryFunding: copy2(r.deliveryFunding)
  };
  return freeze3({ ...body, digest: quoteHash(body) });
}
function buildFullCashOffer(value) {
  const r = exact2(value, ["schemaVersion", "base", "deliveryFunding"]);
  if (r.schemaVersion !== 3) return fail9();
  const baseOffer = buildDriverOffer(r.base);
  if (baseOffer.allocation.paymentMethod !== "COD") return fail9("FULL_CASH_VERIFIED_PAYMENT_READER_REQUIRED");
  const snapshot = prepareFullCashOrderSnapshot({ order: baseOffer.source.order, deliveryFunding: r.deliveryFunding });
  const settlement = prepareFullCashSettlement({
    settlementSchemaVersion: 1,
    base: { ...baseOffer.source.order.allocation, driverEarning: baseOffer.calculation.driverEarning },
    deliveryFunding: snapshot.deliveryFunding
  });
  const body = {
    schemaVersion: 3,
    kind: "DRIVER_FULL_CASH_OFFER",
    settlementModel: FULL_CASH_SETTLEMENT_MODEL,
    baseOffer,
    financialSnapshot: snapshot,
    settlement
  };
  return freeze3({ ...body, digest: quoteHash(body) });
}
function verifyFullCashOffer(value) {
  const r = exact2(value, ["schemaVersion", "kind", "settlementModel", "baseOffer", "financialSnapshot", "settlement", "digest"]);
  const rebuilt = buildFullCashOffer({ schemaVersion: 3, base: r.baseOffer?.source, deliveryFunding: r.financialSnapshot?.deliveryFunding });
  if (!same2(rebuilt, r)) return fail9("FULL_CASH_OFFER_CHANGED");
  verifyFullCashSettlement(rebuilt.settlement);
  return rebuilt;
}
function fullCashOfferView(value, driverId, subjectId, at) {
  const offered = verifyFullCashOffer(value), view = driverOfferView(offered.baseOffer, driverId, subjectId, at);
  const a = offered.settlement.allocation;
  return freeze3({
    ...view,
    schemaVersion: 3,
    kind: offered.kind,
    settlementModel: offered.settlementModel,
    offerDigest: offered.digest,
    driverWalletHold: a.driverWalletHold,
    driverCashRetained: a.driverCashRetained,
    laterWalletEarningCredit: a.driverWalletEarningCredit,
    laterWalletTipCredit: a.driverWalletTipCredit,
    collectionRequired: true,
    customerCashToCollect: a.customerTotal
  });
}
function prepareFullCashOfferAcceptance(value) {
  const r = exact2(value, ["offer", "offerId", "driverId", "subjectId", "assignmentId", "assignmentVersion", "order", "deliveryFunding", "at", "policy"]);
  const offered = verifyFullCashOffer(r.offer);
  fullCashOfferView(offered, r.driverId, r.subjectId, r.at);
  const snapshot = prepareFullCashOrderSnapshot({ order: r.order, deliveryFunding: r.deliveryFunding });
  if (!same2(snapshot, offered.financialSnapshot)) return fail9("FULL_CASH_SNAPSHOT_CHANGED");
  const { deliveryFunding: _funding, ...base } = r;
  const old = prepareDriverOfferAcceptance({ ...base, offer: offered.baseOffer });
  const a = offered.settlement.allocation;
  let walletAmounts;
  try {
    walletAmounts = {
      acceptanceHoldIqd: toWholeIqdExact(a.driverWalletHold),
      completionEarningCreditIqd: toWholeIqdExact(a.driverWalletEarningCredit),
      completionTipCreditIqd: toWholeIqdExact(a.driverWalletTipCredit)
    };
  } catch {
    return fail9("FULL_CASH_WALLET_PRECISION_UNSUPPORTED");
  }
  return freeze3(copy2({
    ...old,
    kind: "FULL_CASH_ACCEPTANCE_PLAN",
    expected: { ...old.expected, digest: offered.digest, snapshotHash: snapshot.digest, settlementModel: offered.settlementModel },
    acceptedTerms: {
      ...old.acceptedTerms,
      schemaVersion: 3,
      settlementModel: offered.settlementModel,
      offerDigest: offered.digest,
      financialSnapshotDigest: snapshot.digest,
      settlementDigest: offered.settlement.digest,
      deliveryFunding: snapshot.deliveryFunding,
      allocation: a,
      driverWalletHold: a.driverWalletHold
    },
    legacyWalletAmounts: walletAmounts,
    requiresFullCashLifecycle: true,
    performsWrites: false
  }));
}
function verifyFullCashAssignment(order, saved, subjectId) {
  const offered = verifyFullCashOffer(saved?.financialOffer), b = offered.baseOffer, terms = order?.financialAcceptance;
  if (!terms || terms.schemaVersion !== 3 || terms.settlementModel !== FULL_CASH_SETTLEMENT_MODEL || saved.responseStatus !== "financial_accepted" || saved.isWinner !== true || order.driverId !== b.driverId || b.driverSubjectId !== subjectId || order.orderId !== b.orderId || order.assignmentWaveNumber !== b.assignmentVersion || saved.waveNumber !== b.assignmentVersion || !same2(terms, saved.acceptedTerms) || !same2(order.financialSnapshot, offered.financialSnapshot) || order.merchantId !== b.source.order.merchantId || ![order.storeId, order.businessId].some((v) => v === b.branchId) || [order.storeId, order.businessId].some((v) => v !== void 0 && v !== b.branchId)) return fail9("FULL_CASH_ASSIGNMENT_CONFLICT");
  const prepared = prepareFullCashOfferAcceptance({
    offer: offered,
    offerId: b.offerId,
    driverId: b.driverId,
    subjectId,
    assignmentId: b.assignmentId,
    assignmentVersion: b.assignmentVersion,
    order: b.source.order,
    deliveryFunding: offered.financialSnapshot.deliveryFunding,
    at: terms.acceptedAt,
    policy: { version: b.policyVersion, enabledRuleVersions: [{ id: b.calculation.rule.id, version: b.calculation.rule.version, hash: b.ruleHash }] }
  });
  if (!same2(prepared.acceptedTerms, terms)) return fail9("FULL_CASH_ASSIGNMENT_CONFLICT");
  return offered;
}

// backend/wallet-service/src/deliveryFundedOffer.ts
var DeliveryFundedOfferError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DeliveryFundedOfferError";
  }
};
var fail10 = (code = "INVALID_DELIVERY_FUNDED_OFFER") => {
  throw new DeliveryFundedOfferError(code);
};
var copy3 = (v) => JSON.parse(JSON.stringify(v));
var same3 = (a, b) => quoteCanonical(a) === quoteCanonical(b);
function exact3(v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== [...keys].sort().join(",")) return fail10();
  return v;
}
function freeze4(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze4);
    Object.freeze(v);
  }
  return v;
}
function prepareDeliveryFundedFinancialSnapshot(value) {
  const r = exact3(value, ["order", "deliveryFunding"]), order = validateDriverOfferOrderSnapshot(copy3(r.order));
  allocateDeliveryFundedOrder({ allocationSchemaVersion: 2, base: { ...order.allocation, driverEarning: moneyFromMinor(0) }, deliveryFunding: r.deliveryFunding });
  const content = { schemaVersion: 2, kind: "ORDER_DELIVERY_FUNDED_SNAPSHOT", order, deliveryFunding: copy3(r.deliveryFunding) };
  return freeze4({ ...content, digest: quoteHash(content) });
}
function buildDeliveryFundedOffer(value) {
  const r = exact3(value, ["schemaVersion", "base", "deliveryFunding"]);
  if (r.schemaVersion !== 2) return fail10();
  const baseOffer = buildDriverOffer(r.base), snapshot = prepareDeliveryFundedFinancialSnapshot({ order: baseOffer.source.order, deliveryFunding: r.deliveryFunding });
  const allocation = allocateDeliveryFundedOrder({ allocationSchemaVersion: 2, base: { ...baseOffer.source.order.allocation, driverEarning: baseOffer.calculation.driverEarning }, deliveryFunding: snapshot.deliveryFunding });
  const content = { schemaVersion: 2, kind: "DRIVER_DELIVERY_FUNDED_OFFER", baseOffer, financialSnapshot: snapshot, allocation };
  return freeze4({ ...content, digest: quoteHash(content) });
}
function stored(value) {
  const r = exact3(value, ["schemaVersion", "kind", "baseOffer", "financialSnapshot", "allocation", "digest"]);
  const rebuilt = buildDeliveryFundedOffer({ schemaVersion: 2, base: r.baseOffer?.source, deliveryFunding: r.financialSnapshot?.deliveryFunding });
  if (!same3(rebuilt, r)) return fail10("DELIVERY_FUNDED_OFFER_CHANGED");
  return rebuilt;
}
function deliveryFundedOfferView(value, driverId, subjectId, at) {
  const offer = stored(value), view = driverOfferView(offer.baseOffer, driverId, subjectId, at);
  return freeze4({ ...view, schemaVersion: 2, kind: offer.kind, offerDigest: offer.digest });
}
function prepareDeliveryFundedOfferAcceptance(value) {
  const r = exact3(value, ["offer", "offerId", "driverId", "subjectId", "assignmentId", "assignmentVersion", "order", "deliveryFunding", "at", "policy"]), offer = stored(r.offer);
  deliveryFundedOfferView(offer, r.driverId, r.subjectId, r.at);
  const snapshot = prepareDeliveryFundedFinancialSnapshot({ order: r.order, deliveryFunding: r.deliveryFunding });
  if (!same3(snapshot, offer.financialSnapshot)) return fail10("DELIVERY_FUNDED_SNAPSHOT_CHANGED");
  const { deliveryFunding: _funding, ...legacy } = r;
  const plan = prepareDriverOfferAcceptance({ ...legacy, offer: offer.baseOffer });
  return freeze4(copy3({
    ...plan,
    kind: "DELIVERY_FUNDED_OFFER_ACCEPTANCE_PLAN",
    expected: { ...plan.expected, digest: offer.digest, snapshotHash: snapshot.digest },
    acceptedTerms: { ...plan.acceptedTerms, schemaVersion: 2, offerDigest: offer.digest, allocation: offer.allocation, deliveryFunding: snapshot.deliveryFunding, financialSnapshotDigest: snapshot.digest },
    requiresDeliveryFundingLifecycle: true
  }));
}
function verifyDeliveryFundedAssignment(order, saved, subjectId) {
  const offer = stored(saved?.financialOffer), b = offer.baseOffer, terms = order.financialAcceptance;
  if (!terms || terms.schemaVersion !== 2 || terms.paymentMethod !== "COD" || saved.responseStatus !== "financial_accepted" || saved.isWinner !== true || order.driverId !== b.driverId || subjectId !== b.driverSubjectId || order.orderId !== b.orderId || order.assignmentWaveNumber !== b.assignmentVersion || saved.waveNumber !== b.assignmentVersion || !same3(terms, saved.acceptedTerms) || !same3(order.financialSnapshot, offer.financialSnapshot) || order.merchantId !== b.source.order.merchantId || ![order.storeId, order.businessId].some((v) => v === b.branchId) || [order.storeId, order.businessId].some((v) => v !== void 0 && v !== b.branchId)) return fail10("DELIVERY_FUNDED_ASSIGNMENT_CONFLICT");
  const plan = prepareDeliveryFundedOfferAcceptance({ offer, offerId: b.offerId, driverId: b.driverId, subjectId, assignmentId: b.assignmentId, assignmentVersion: b.assignmentVersion, order: b.source.order, deliveryFunding: offer.financialSnapshot.deliveryFunding, at: terms.acceptedAt, policy: { version: b.policyVersion, enabledRuleVersions: [{ id: b.calculation.rule.id, version: b.calculation.rule.version, hash: b.ruleHash }] } });
  if (!same3(plan.acceptedTerms, terms)) return fail10("DELIVERY_FUNDED_ASSIGNMENT_CONFLICT");
  return offer;
}

// backend/wallet-service/src/driverOfferOrderReader.ts
var import_lib_dynamodb4 = require("@aws-sdk/lib-dynamodb");
var copy4 = (v) => JSON.parse(JSON.stringify(v));
var DriverOfferOrderReadError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DriverOfferOrderReadError";
  }
};
function fail11(code) {
  throw new DriverOfferOrderReadError(code);
}
function prepareDriverOfferFinancialSnapshot(value) {
  try {
    const snapshot = copy4(validateDriverOfferOrderSnapshot(value));
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 1e5) return fail11("DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED");
    const content = { schemaVersion: 1, kind: "ORDER_FINANCIAL_SNAPSHOT", snapshot };
    return { ...content, digest: quoteHash(content) };
  } catch {
    return fail11("DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED");
  }
}

// backend/wallet-service/src/financialAssignment.ts
function verifyFinancialAssignment(order, saved, subjectId) {
  const bad = () => {
    throw Error("FINANCIAL_ASSIGNMENT_CONFLICT");
  };
  const terms = order.financialAcceptance;
  if (!terms || terms.schemaVersion !== 1 || terms.paymentMethod !== "COD" || !Number.isSafeInteger(order.assignmentWaveNumber)) return bad();
  const offer = buildDriverOffer(saved?.financialOffer?.source);
  if (!saved || saved.responseStatus !== "financial_accepted" || saved.isWinner !== true || !equal(offer, saved.financialOffer) || offer.driverId !== order.driverId || offer.driverSubjectId !== subjectId || offer.orderId !== order.orderId || saved.waveNumber !== order.assignmentWaveNumber || offer.assignmentVersion !== order.assignmentWaveNumber || !equal(terms, saved.acceptedTerms) || terms.offerDigest !== offer.digest || !equal(terms.allocation, offer.allocation) || !equal(order.financialSnapshot, prepareDriverOfferFinancialSnapshot(offer.source.order))) return bad();
  const expected = prepareDriverOfferAcceptance({
    offer,
    offerId: offer.offerId,
    driverId: offer.driverId,
    subjectId,
    assignmentId: offer.assignmentId,
    assignmentVersion: offer.assignmentVersion,
    order: offer.source.order,
    at: terms.acceptedAt,
    policy: { version: offer.policyVersion, enabledRuleVersions: [{ id: offer.calculation.rule.id, version: offer.calculation.rule.version, hash: offer.ruleHash }] }
  });
  if (!equal(expected.acceptedTerms, terms)) return bad();
  if (![order.storeId, order.businessId].some((v) => v === offer.branchId) || [order.storeId, order.businessId].some((v) => v !== void 0 && v !== offer.branchId) || order.merchantId !== offer.source.order.merchantId) return bad();
  return offer;
}

// backend/wallet-service/src/exceptionMerchantAccrual.ts
var fail12 = () => {
  throw Error("EXCEPTION_MERCHANT_ACCRUAL_INVALID");
};
function deriveExceptionMerchantAccrual(input) {
  const { branchId, order, acceptedOffer, outcome: j, payable: p } = input, orderId = order.orderId;
  if (order.status !== "returned" || order.orderStatus !== "returned" || !order.returnTaskCompletedAt && !(order.returnStatus === "CONFIRMED" && order.returnedAt) || order.storeId !== branchId || order.deletedAt != null || order.deletionRequestId != null || order.isDeleted === true || order.cashCollected === true || Number(order.cashCollectedAmount ?? 0) !== 0 || j.kind !== "ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL" || j.orderId !== orderId || j.branchId !== branchId || j.state !== "POSTED" || j.sk !== "EXCEPTION_ENTITLEMENTS" || !j.subjectId) return fail12();
  let digest;
  if (order.financialAcceptance.schemaVersion === 3) digest = verifyFullCashAssignment(order, acceptedOffer, j.subjectId).digest;
  else if (order.financialAcceptance.schemaVersion === 2) digest = verifyDeliveryFundedAssignment(order, acceptedOffer, j.subjectId).digest;
  else digest = verifyFinancialAssignment(order, acceptedOffer, j.subjectId).digest;
  const { digest: journalDigest, ...body } = j;
  if (journalDigest !== quoteHash(body) || j.offerDigest !== digest || !equal(j.agreement, order.commercialPricing?.agreement) || j.merchantCompensationIqd <= 0 || !Number.isSafeInteger(j.merchantCompensationIqd) || !Number.isFinite(Date.parse(j.createdAt))) return fail12();
  if (p.kind !== "MERCHANT_EXCEPTION_PAYABLE" || p.financialSchemaVersion !== 5 || p.orderId !== orderId || p.sk !== "MERCHANT_PAYABLE" || p.walletId !== "WALLET#MERCHANT#" + branchId || p.branchId !== branchId || p.status !== "LOCKED_PENDING_SETTLEMENT" || p.amount !== j.merchantCompensationIqd || p.operationId !== j.operationId || p.journalDigest !== journalDigest || p.createdAt !== j.createdAt || !equal(p.agreement, j.agreement)) return fail12();
  const F = j.driverFareIqd, M = j.merchantCompensationIqd, B3 = j.merchantFundingIqd;
  if (![F, M, B3, j.platformFundingIqd].every((x) => Number.isSafeInteger(x) && x >= 0) || j.platformFundingIqd !== F + M - B3 || !Array.isArray(j.walletLines)) return fail12();
  const expected = new Map([["WALLET#DRIVER#" + order.driverId + "|AVAILABLE", F], ["WALLET#MERCHANT#" + branchId + "|AVAILABLE", -B3], ["WALLET#MERCHANT#" + branchId + "|LOCKED", M]].filter(([, v]) => v !== 0));
  for (const line of j.walletLines) {
    const key4 = line.walletId + "|" + line.balanceType;
    if (!expected.has(key4) || expected.get(key4) !== line.delta || line.balanceAfter - line.balanceBefore !== line.delta || line.balanceAfter < 0) return fail12();
    expected.delete(key4);
  }
  if (expected.size || j.settlementModel !== "EXCEPTION_ACCRUAL_GL_V1" || j.platformNetIqd !== -F - M + B3 || j.walletLines.reduce((n, l) => n + BigInt(l.delta), 0n) + BigInt(j.platformNetIqd) !== 0n) return fail12();
  const accountingLines = [{ account: "DRIVER_FARE_EXPENSE", side: "DEBIT", amount: F }, { account: "MERCHANT_COMPENSATION_EXPENSE", side: "DEBIT", amount: M }, { account: "MERCHANT_FUNDING_RECOVERY", side: "CREDIT", amount: B3 }, { account: "DRIVER_WALLET_PAYABLE", side: "CREDIT", amount: F }, { account: "MERCHANT_WALLET_PAYABLE", side: "CREDIT", amount: M }, { account: "MERCHANT_WALLET_PAYABLE", side: "DEBIT", amount: B3 }].filter((l) => l.amount);
  if (!equal(j.accountingLines, accountingLines) || j.debit !== F + M + B3 || j.credit !== j.debit) return fail12();
  const amounts = Object.fromEntries(["goodsGross", "merchantFundedDiscount", "platformFundedDiscount", "merchantGoodsEntitlement", "merchantCommission", "merchantOtherCharges", "customerGoodsPayment", "customerServiceFee", "customerDeliveryFee", "driverEarning", "driverTip", "platformOtherCharges", "customerTotal", "platformNetContribution"].map((k) => [k, moneyFromMinor(0)]));
  amounts.merchantNet = moneyFromMinor(j.merchantCompensationIqd * 1e3);
  amounts.merchantExceptionCompensation = amounts.merchantNet;
  for (const m of Object.values(amounts)) toWholeIqdExact(readMoney(m));
  const content = { schemaVersion: 5, kind: "MERCHANT_EXCEPTION_ACCRUAL", accrualId: "MACC:" + quoteHash({ branchId, orderId, operationId: j.operationId }).slice(0, 48), branchId, orderId, operationId: j.operationId, deliveredAt: j.createdAt, accruedAt: j.createdAt, currency: "IQD", status: "LOCKED_PENDING_SETTLEMENT", agreement: j.agreement, amounts, sourceDigests: { outcome: quoteHash(j), payable: quoteHash(p), acceptedOffer: digest }, payoutAuthorized: false, walletMutationPerformed: false };
  return { ...content, digest: quoteHash(content) };
}

// backend/wallet-service/src/merchantSettlementAccrual.ts
var amountFields = [
  "goodsGross",
  "merchantFundedDiscount",
  "platformFundedDiscount",
  "merchantGoodsEntitlement",
  "merchantCommission",
  "merchantOtherCharges",
  "merchantNet",
  "customerGoodsPayment",
  "customerServiceFee",
  "customerDeliveryFee",
  "driverEarning",
  "driverTip",
  "platformOtherCharges",
  "platformNetContribution",
  "customerTotal"
];
var deliveryAmountFields = ["merchantDeliverySupport", "platformDeliveryPromotionFunding", "referenceDeliveryFee", "deliveryPromotionSubsidy", "baselineDeliveryMargin", "deliveryNetContribution"];
var MerchantAccrualError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "MerchantAccrualError";
  }
};
var fail13 = (code = "MERCHANT_ACCRUAL_PROOF_REQUIRED") => {
  throw new MerchantAccrualError(code);
};
var same4 = (a, b) => quoteCanonical(a) === quoteCanonical(b);
function whole(value) {
  try {
    return toWholeIqdExact(readMoney(value));
  } catch {
    return fail13();
  }
}
function integer4(value, signed = false) {
  if (!Number.isSafeInteger(value) || !signed && Number(value) < 0) return fail13();
  return value;
}
function instant2(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return fail13();
  return value;
}
function deriveMerchantCodAccrual(input) { return require("./cash-adjudication-read-278.js").deriveMerchantCodAccrual(input); }
function summarizeMerchantAccruals(branchId, accruals) { return require("./cash-adjudication-read-278.js").summarizeMerchantAccruals(branchId,accruals); }
function deliveryReportingAmounts(row3) { return require("./cash-adjudication-read-278.js").merchantAccrualReportingAmounts(row3); }

// backend/wallet-service/src/db.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb5 = require("@aws-sdk/lib-dynamodb");
var client = new import_client_dynamodb.DynamoDBClient({
  region: process.env.AWS_REGION || "me-south-1"
});
var docClient = import_lib_dynamodb5.DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true
  },
  unmarshallOptions: {
    wrapNumbers: false
    // ✅ Important: Keep numbers as native JS numbers (not BigInt)
  }
});
var TABLES = {
  WALLETS: process.env.WALLETS_TABLE || "dev-Wallets",
  LEDGER: process.env.LEDGER_TABLE || "dev-LedgerEntries",
  HOLDS: process.env.HOLDS_TABLE || "dev-Holds",
  TOPUP_REQUESTS: process.env.TOPUP_REQUESTS_TABLE || "dev-TopupRequests",
  AUDIT_LOG: process.env.AUDIT_LOG_TABLE || "dev-AuditLog",
  IDEMPOTENCY_KEYS: process.env.IDEMPOTENCY_KEYS_TABLE || "dev-IdempotencyKeys"
};

// backend/wallet-service/src/fundingService.ts
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");
var s3 = new import_client_s3.S3Client({});
var bucket = process.env.FUNDING_RECEIPTS_BUCKET || "";

// backend/wallet-service/src/cashboxAccounting.ts
var import_lib_dynamodb6 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/merchantCashbox.ts
var cashboxDirectory = "MERCHANT_CASHBOXES#GLOBAL";
var cashboxKey = (code) => ({ pk: cashboxDirectory, sk: "BOX#" + code });
var cashboxCode = (v) => typeof v === "string" && /^[A-Z][A-Z0-9-]{2,39}$/.test(v);
var cashVoucherNumber = (p) => "CPV-" + new Date(Date.parse(p.createdAt) + 108e5).toISOString().slice(0, 10).replace(/-/g, "") + "-" + quoteHash({ payoutId: p.payoutId }).slice(0, 24).toUpperCase();
var cashMovementKey = (p) => ({ pk: "MERCHANT_CASHBOX#" + p.sourceAccount, sk: "VOUCHER#" + p.executionRecordedAt + "#" + p.payoutId });
function validateCashbox(v) {
  if (!cashboxCode(v.code) || !["ACTIVE", "INACTIVE"].includes(v.status) || ["name", "custodian", "location"].some((k) => typeof v[k] !== "string" || v[k].trim().length < 2 || v[k].length > 120) || typeof v.reason !== "string" || v.reason.trim().length < 5 || v.reason.length > 500) throw Object.assign(Error("PAYOUT_CASHBOX_INVALID"), { code: "PAYOUT_CASHBOX_INVALID" });
}

// backend/wallet-service/src/cashboxAccounting.ts
var { allowed: allowed3, LABELS } = require_catalog();
var { operator } = require_write_workflow();
var T = "staging-MerchantPlatform";
var S2 = "staging-PlatformStaff";
var MAX2 = Math.floor(Number.MAX_SAFE_INTEGER / 1e3);
var fail14 = (code) => {
  throw Object.assign(Error(code), { code });
};
var uuid2 = (v) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
var cashpk = (code) => "MERCHANT_CASHBOX#" + code;
var cashBalanceKey = (code) => ({ pk: cashpk(code), sk: "BALANCE" });
var amount3 = (n, zero2 = false) => Number.isSafeInteger(n) && n >= (zero2 ? 0 : 1) && n <= MAX2;
var text2 = (n, min = 5, max = 500) => typeof n === "string" && n.trim().length >= min && n.length <= max;
var exact4 = (v, keys) => Object.keys(v).sort().join(",") === keys.sort().join(",");
var seal = (v) => ({ ...v, digest: quoteHash(v) });
function put(row3, old) {
  if (!old) return { Put: { TableName: T, Item: row3, ConditionExpression: "attribute_not_exists(pk)" } };
  const { Key, ...rest } = exactCheck(T, { pk: row3.pk, sk: row3.sk }, old).ConditionCheck;
  return { Put: { ...rest, Item: row3 } };
}
function cashAccountingDeduplicate(ops) {
  const seen = /* @__PURE__ */ new Map(), out = [];
  for (const op of ops) {
    const [kind, q] = Object.entries(op)[0], k = q.Key || (q.Item?.pk ? { pk: q.Item.pk, sk: q.Item.sk } : q.Item?.walletId ? { walletId: q.Item.walletId, sk: q.Item.sk } : q.Item?.datePartition ? { datePartition: q.Item.datePartition, sk: q.Item.sk } : q.Item?.orderId ? { orderId: q.Item.orderId, sk: q.Item.sk } : { businessId: q.Item?.businessId });
    const identity = q.TableName + "|" + JSON.stringify(Object.fromEntries(Object.entries(k).sort()));
    const prior = seen.get(identity);
    if (prior) {
      if (kind !== "ConditionCheck" || !prior.ConditionCheck) return fail14("PAYOUT_CASH_DUPLICATE_TARGET");
      if (equal(prior, op)) continue;
      const target = prior.ConditionCheck;
      let expression = q.ConditionExpression;
      const names = {}, values = {};
      const prefix = "#g" + out.length + "x" + Object.keys(target.ExpressionAttributeNames || {}).length + "_", vp = ":g" + out.length + "x" + Object.keys(target.ExpressionAttributeValues || {}).length + "_";
      for (const [key4, value] of Object.entries(q.ExpressionAttributeNames || {})) {
        const next2 = prefix + key4.slice(1);
        expression = expression.replace(new RegExp(key4 + "(?![A-Za-z0-9_])", "g"), next2);
        names[next2] = value;
      }
      for (const [key4, value] of Object.entries(q.ExpressionAttributeValues || {})) {
        const next2 = vp + key4.slice(1);
        expression = expression.replace(new RegExp(key4 + "(?![A-Za-z0-9_])", "g"), next2);
        values[next2] = value;
      }
      target.ConditionExpression = "(" + target.ConditionExpression + ") AND (" + expression + ")";
      target.ExpressionAttributeNames = { ...target.ExpressionAttributeNames, ...names };
      if (Object.keys(values).length) target.ExpressionAttributeValues = { ...target.ExpressionAttributeValues, ...values };
      continue;
    }
    const copy5 = JSON.parse(JSON.stringify(op));
    seen.set(identity, copy5);
    out.push(copy5);
  }
  return out;
}
async function employee(db, employeeId2, requestPermission = true) {
  const e = await strongGet(db, S2, { pk: "EMPLOYEE#" + employeeId2, sk: "PROFILE" });
  if (!e || e.employeeId !== employeeId2 || e.status !== "ACTIVE" || !Number.isSafeInteger(e.version) || e.version < 1 || e.deletedAt != null || e.deletionRequestId != null || e.isDeleted === true || requestPermission && !allowed3(e, "finance.request")) return fail14("PAYOUT_CASH_CUSTODIAN_UNAVAILABLE");
  return e;
}
var custodySnapshot = (e) => ({ employeeId: e.employeeId, name: cashEmployeeName(e), version: e.version, authorityFingerprint: quoteHash({ status: e.status, roles: e.roles, scope: e.scope || null, minimumAuthTime: e.minimumAuthTime || 0, mfaRequired: e.mfaRequired === true, deletedAt: e.deletedAt || null, deletionRequestId: e.deletionRequestId || null, isDeleted: e.isDeleted === true }) });
var presentOperation = (r) => ({ operationId: r.operationId, request: r.request, status: r.status, version: r.version, requestedBy: r.requestedBy, requestedAt: r.requestedAt, postedBy: r.postedBy || null, postedAt: r.postedAt || null, journalId: r.journalId || null, cancelledBy: r.cancelledBy || null, cancelledAt: r.cancelledAt || null, cancellationReason: r.cancellationReason || null, custodianOverrideReason: r.custodianOverrideReason || null, sk: r.sk });
async function cashboxCustodian(db, employeeId2) {
  if (!uuid2(employeeId2)) return fail14("PAYOUT_CASH_CUSTODIAN_REQUIRED");
  return employee(db, employeeId2, false);
}
var cashEmployeeName = (e) => e.fullName || e.displayName || e.name || e.employeeId;
var cashEmployeeGuard = (e) => exactCheck(S2, { pk: "EMPLOYEE#" + e.employeeId, sk: "PROFILE" }, e);
function validateCashBalance(row3, code) {
  if (!row3 || row3.kind !== "CASHBOX_BALANCE" || row3.code !== code || row3.initialized !== true || !amount3(row3.balanceIqd, true) || !Number.isSafeInteger(row3.version) || row3.version < 1 || !row3.lastJournalId || !/^[a-f0-9]{64}$/.test(row3.lastJournalDigest || "")) return fail14("PAYOUT_CASH_OPENING_REQUIRED");
  return row3;
}
async function readCashBalance(db, code) {
  const b = validateCashBalance(await strongGet(db, T, cashBalanceKey(code)), code), j = await strongGet(db, T, { pk: cashpk(code), sk: "LEDGER#" + b.lastJournalAt + "#" + b.lastJournalId });
  if (!j || j.digest !== b.lastJournalDigest || j.balanceAfterIqd !== b.balanceIqd || j.code !== code || j.journalId !== b.lastJournalId || j.at !== b.lastJournalAt) return fail14("PAYOUT_CASH_BALANCE_PROOF_INVALID");
  const { digest, ...content } = j;
  if (quoteHash(content) !== digest) return fail14("PAYOUT_CASH_BALANCE_PROOF_INVALID");
  if (b.pendingCountId) {
    const c = await strongGet(db, T, { pk: cashpk(code), sk: "COUNT#" + b.pendingCountId });
    if (!c || c.status !== "DIFFERENCE_PENDING" || c.balanceVersion !== b.version || c.bookIqd !== b.balanceIqd || c.countedIqd - c.bookIqd !== c.differenceIqd || b.lastCountId !== b.pendingCountId) return fail14("PAYOUT_CASH_BALANCE_PROOF_INVALID");
  }
  return b;
}
function ledger(code, before, delta, at, journalId, actorId, details) {
  const next2 = (before?.balanceIqd || 0) + delta;
  if (next2 < 0) return fail14("PAYOUT_CASH_INSUFFICIENT");
  if (!amount3(next2, true)) return fail14("PAYOUT_CASH_LIMIT_EXCEEDED");
  const row3 = seal({ pk: cashpk(code), sk: "LEDGER#" + at + "#" + journalId, kind: "CASHBOX_LEDGER_ENTRY", schemaVersion: 1, currency: "IQD", unit: "WHOLE_IQD", journalId, code, at, actorId, deltaIqd: delta, balanceBeforeIqd: before?.balanceIqd || 0, balanceAfterIqd: next2, previousJournalId: before?.lastJournalId || null, previousJournalDigest: before?.lastJournalDigest || null, ...details, retentionClass: "FINANCIAL_SETTLEMENT" });
  const balance = { ...cashBalanceKey(code), kind: "CASHBOX_BALANCE", code, initialized: true, currency: "IQD", version: (before?.version || 0) + 1, balanceIqd: next2, lastJournalId: journalId, lastJournalAt: at, lastJournalDigest: row3.digest, updatedAt: at, ...before?.pendingCountId ? { pendingCountId: before.pendingCountId } : {}, ...before?.lastCountId ? { lastCountId: before.lastCountId } : {} };
  return { row: row3, balance };
}
async function cashPayoutPosting(db, payout, actorId, at, returning = false, overrideReason) {
  const deliveryProof = returning ? await verifyCashPayoutPosting(db, payout) : null;
  const box = await strongGet(db, T, cashboxKey(payout.sourceAccount));
  if (!box || box.kind !== "MERCHANT_CASHBOX" || !returning && box.status !== "ACTIVE") return fail14("PAYOUT_CASHBOX_UNAVAILABLE");
  const actor = await employee(db, actorId), custodian = await employee(db, box.custodianEmployeeId, false);
  if (!returning && actorId !== custodian.employeeId && !operator(actor)) return fail14("PAYOUT_CASH_CUSTODIAN_REQUIRED");
  if (!returning && actorId !== custodian.employeeId && !text2(overrideReason)) return fail14("PAYOUT_CASH_OVERRIDE_REASON_REQUIRED");
  const before = await readCashBalance(db, box.code);
  if (before.pendingCountId) return fail14("PAYOUT_CASH_COUNT_UNRESOLVED");
  const delta = (returning ? 1 : -1) * (payout.amount.minorAmount / 1e3), journalId = "CASH-PAYOUT-" + quoteHash({ payoutId: payout.payoutId, returning }).slice(0, 40);
  const l = ledger(box.code, before, delta, at, journalId, actorId, { category: returning ? "MERCHANT_PAYOUT_RETURN" : "MERCHANT_PAYOUT_DELIVERY", payoutId: payout.payoutId, batchId: payout.batchId, branchId: payout.branchId, voucherNumber: payout.externalReference, cashboxSnapshot: payout.cashbox, reference: returning ? payout.failureReference : payout.externalReference, reason: returning ? payout.failureReason : "\u062A\u0633\u0644\u064A\u0645 \u0645\u0633\u062A\u062D\u0642\u0627\u062A \u0645\u0637\u0639\u0645", overrideReason: overrideReason || null, lines: returning ? [{ account: "CASHBOX_ASSET", code: box.code, side: "DEBIT", amountIqd: delta }, { account: "MERCHANT_DISBURSEMENT_CLEARING", side: "CREDIT", amountIqd: delta }] : [{ account: "MERCHANT_DISBURSEMENT_CLEARING", side: "DEBIT", amountIqd: -delta }, { account: "CASHBOX_ASSET", code: box.code, side: "CREDIT", amountIqd: -delta }] });
  return { journalId, ops: [...deliveryProof ? [exactCheck(T, { pk: deliveryProof.pk, sk: deliveryProof.sk }, deliveryProof)] : [], put(l.row), put(l.balance, before), exactCheck(T, cashboxKey(box.code), box), cashEmployeeGuard(actor), cashEmployeeGuard(custodian)] };
}
async function verifyCashPayoutPosting(db, p) {
  if (!p.cashLedgerJournalId) return;
  const code = p.sourceAccount, at = p.executionRecordedAt, j = await strongGet(db, T, { pk: cashpk(code), sk: "LEDGER#" + at + "#" + p.cashLedgerJournalId });
  if (!j || j.payoutId !== p.payoutId || j.deltaIqd !== -p.amount.minorAmount / 1e3 || j.code !== code || j.voucherNumber !== p.externalReference || !equal(j.cashboxSnapshot, p.cashbox)) return fail14("PAYOUT_CASH_BALANCE_PROOF_INVALID");
  const { digest, ...body } = j;
  if (quoteHash(body) !== digest) return fail14("PAYOUT_CASH_BALANCE_PROOF_INVALID");
  return j;
}
function createCashboxAccountingService(options) {
  const { db, now } = options, get = (k) => strongGet(db, T, k);
  async function auth(branch, action, n = 0) {
    const a = await options.authorize(branch, action, n);
    if (a.owner) return fail14("PAYOUT_PERMISSION_REQUIRED");
    return a;
  }
  async function loadBox(code, active = true) {
    if (!cashboxCode(code)) return fail14("PAYOUT_CASHBOX_INVALID");
    const b = await get(cashboxKey(code));
    if (!b || b.kind !== "MERCHANT_CASHBOX" || active && b.status !== "ACTIVE") return fail14("PAYOUT_CASHBOX_UNAVAILABLE");
    return b;
  }
  async function snapshots(codes, opening = false, active = true) {
    const out = [];
    for (const code of codes) {
      const box = await loadBox(code, active);
      const raw = await get(cashBalanceKey(code));
      if (opening && raw) return fail14("PAYOUT_CASH_ALREADY_OPENED");
      const balance = opening ? null : await readCashBalance(db, code);
      if (balance?.pendingCountId) return fail14("PAYOUT_CASH_COUNT_UNRESOLVED");
      out.push({ code, box, balance });
    }
    return out;
  }
  async function proposal(v) {
    const common2 = ["action", "branchId", "code", "requestId", "type", "amountIqd", "reference", "reason", "counterparty"];
    const extra = { OPENING: ["custodianEmployeeId"], RECEIPT: ["account"], EXPENSE: ["account"], TRANSFER: ["targetCode"], COUNT: [], ADJUSTMENT: ["countId"], VOID_COUNT: ["countId"], HANDOVER: ["custodianEmployeeId"], REVERSAL: ["journalId", "originalAt"] };
    if (!extra[v.type] || !exact4(v, [...common2, ...extra[v.type]]) || !uuid2(v.requestId) || !cashboxCode(v.code) || !amount3(v.amountIqd, ["OPENING", "COUNT", "HANDOVER", "ADJUSTMENT", "VOID_COUNT", "REVERSAL"].includes(v.type)) || !text2(v.reference, 4, 120) || !text2(v.reason) || !text2(v.counterparty, 2, 120)) return fail14("PAYOUT_CASH_OPERATION_INVALID");
    if (["RECEIPT", "EXPENSE"].includes(v.type) && !(v.type === "RECEIPT" ? ["COMPANY_BANK", "COMPANY_ZAIN_CASH", "OTHER_RECEIPT"] : ["OPERATING_EXPENSE", "COMPANY_BANK", "COMPANY_ZAIN_CASH", "OTHER_DISBURSEMENT"]).includes(v.account)) return fail14("PAYOUT_CASH_OPERATION_INVALID");
    if (v.type === "TRANSFER" && (!cashboxCode(v.targetCode) || v.targetCode === v.code)) return fail14("PAYOUT_CASH_OPERATION_INVALID");
    const a = await auth(v.branchId, "STAFF"), at = new Date(now()).toISOString(), operationId = "CFO:" + quoteHash({ actorId: a.actorId, code: v.code, requestId: v.requestId }).slice(0, 40), k = { pk: cashpk(v.code), sk: "OP#" + operationId }, old = await get(k), requestDigest = quoteHash(v);
    if (old) {
      if (old.requestDigest !== requestDigest || old.requestedBy !== a.actorId) return fail14("PAYOUT_REQUEST_ID_CONFLICT");
      return { operation: presentOperation(old), replayed: true };
    }
    let pins, count = null, original = null;
    if (["ADJUSTMENT", "VOID_COUNT"].includes(v.type)) {
      const box = await loadBox(v.code, false), balance = await readCashBalance(db, v.code);
      if (balance.pendingCountId !== v.countId) return fail14("PAYOUT_CASH_COUNT_UNRESOLVED");
      count = await get({ pk: cashpk(v.code), sk: "COUNT#" + v.countId });
      if (!count || count.status !== "DIFFERENCE_PENDING" || count.balanceVersion !== balance.version || v.amountIqd !== (v.type === "VOID_COUNT" ? 0 : Math.abs(count.differenceIqd))) return fail14("PAYOUT_CASH_OPERATION_INVALID");
      pins = [{ code: v.code, box, balance }];
    } else if (v.type === "REVERSAL") {
      if (typeof v.journalId !== "string" || typeof v.originalAt !== "string") return fail14("PAYOUT_CASH_OPERATION_INVALID");
      original = await get({ pk: cashpk(v.code), sk: "LEDGER#" + v.originalAt + "#" + v.journalId });
      if (!original || !["RECEIPT", "EXPENSE", "TRANSFER"].includes(original.category) || !Array.isArray(original.assetChanges) || original.assetChanges.length < 1 || original.assetChanges.length > 2 || original.assetChanges[0].code !== v.code || original.code !== v.code || v.amountIqd !== Math.max(...original.assetChanges.map((x) => Math.abs(x.deltaIqd)))) return fail14("PAYOUT_CASH_OPERATION_INVALID");
      const { digest, ...originalContent } = original;
      if (quoteHash(originalContent) !== digest) return fail14("PAYOUT_CASH_BALANCE_PROOF_INVALID");
      if (await get({ pk: cashpk(v.code), sk: "REVERSED#" + v.journalId })) return fail14("PAYOUT_CASH_ALREADY_REVERSED");
      pins = await snapshots(original.assetChanges.map((x) => x.code));
    } else pins = await snapshots(v.type === "TRANSFER" ? [v.code, v.targetCode] : [v.code], v.type === "OPENING", !["COUNT", "HANDOVER"].includes(v.type));
    for (const pin of pins) {
      if (pin.balance && !["COUNT", "ADJUSTMENT", "VOID_COUNT", "HANDOVER"].includes(v.type)) pin.custodianProfile = custodySnapshot(await employee(db, pin.box.custodianEmployeeId, false));
    }
    if (v.type !== "OPENING" && pins[0].box.custodianEmployeeId !== a.actorId) {
      const actor = await employee(db, a.actorId);
      if (!operator(actor) && !(["COUNT", "ADJUSTMENT", "VOID_COUNT", "HANDOVER"].includes(v.type) && allowed3(actor, "finance.approve"))) return fail14("PAYOUT_CASH_CUSTODIAN_REQUIRED");
    }
    let custodian = null;
    if (["OPENING", "HANDOVER"].includes(v.type)) {
      custodian = custodySnapshot(await cashboxCustodian(db, v.custodianEmployeeId));
      if (v.type === "HANDOVER" && (v.amountIqd !== pins[0].balance.balanceIqd || pins[0].box.custodianEmployeeId === v.custodianEmployeeId)) return fail14("PAYOUT_CASH_HANDOVER_COUNT_REQUIRED");
    }
    const row3 = { ...k, kind: "CASHBOX_OPERATION", schemaVersion: 1, operationId, status: "PENDING_APPROVAL", requestDigest, request: { ...v }, pins, count, original, custodian, requestedBy: a.actorId, requestedAt: at, custodianOverrideReason: pins[0].box.custodianEmployeeId !== a.actorId ? v.reason : null, version: 1, retentionClass: "FINANCIAL_SETTLEMENT" };
    await options.commit(v.branchId, "STAFF", a, [put(row3)]);
    return { operation: presentOperation(row3) };
  }
  async function post(v, cancel = false) {
    if (!exact4(v, ["action", "branchId", "code", "operationId", "version", "requestId", ...cancel ? ["reason"] : ["confirmedPhysicalOperation"]]) || !uuid2(v.requestId) || !cashboxCode(v.code) || typeof v.operationId !== "string" || !/^CFO:[a-f0-9]{40}$/.test(v.operationId) || !Number.isSafeInteger(v.version) || (cancel ? !text2(v.reason) : v.confirmedPhysicalOperation !== true)) return fail14("PAYOUT_CASH_OPERATION_INVALID");
    const k = { pk: cashpk(v.code), sk: "OP#" + v.operationId }, row3 = await get(k);
    if (!row3 || row3.kind !== "CASHBOX_OPERATION" || row3.request.branchId !== v.branchId) return fail14("PAYOUT_CASH_OPERATION_INVALID");
    const n = ["COUNT", "VOID_COUNT"].includes(row3.request.type) ? 0 : row3.request.type === "ADJUSTMENT" ? Math.abs(row3.count.differenceIqd) : row3.request.amountIqd, a = await auth(v.branchId, cancel ? "STAFF" : "APPROVE", n), eventKey = { pk: cashpk(v.code), sk: "ACTION#" + v.requestId }, old = await get(eventKey);
    if (old) {
      if (old.requestDigest !== quoteHash(v) || old.actorId !== a.actorId) return fail14("PAYOUT_REQUEST_ID_CONFLICT");
      return { operation: presentOperation(await get(k)), replayed: true };
    }
    if (row3.status !== "PENDING_APPROVAL" || row3.version !== v.version) return fail14("PAYOUT_CASH_OPERATION_CHANGED");
    const requester = cancel ? null : await employee(db, row3.requestedBy), approver = await employee(db, a.actorId);
    if (cancel && a.actorId !== row3.requestedBy && !allowed3(approver, "finance.approve")) return fail14("PAYOUT_PERMISSION_REQUIRED");
    if (!cancel && a.actorId === row3.requestedBy && !operator(approver)) return fail14("PAYOUT_CASH_INDEPENDENT_APPROVAL_REQUIRED");
    const at = new Date(now()).toISOString(), ops = requester ? [cashEmployeeGuard(requester)] : [], r = row3.request, type = r.type, changes = [], lines = [], journalId = "CJ:" + quoteHash({ operationId: row3.operationId }).slice(0, 40);
    if (!cancel) {
      const proofKey = { pk: "MERCHANT_CASHBOX#PROOFS", sk: "PROOF#" + quoteHash({ scope: ["COMPANY_BANK", "COMPANY_ZAIN_CASH"].includes(r.account) ? r.account : r.code, type: r.type, reference: r.reference.trim().toUpperCase() }) };
      if (await get(proofKey)) return fail14("PAYOUT_CASH_REFERENCE_ALREADY_USED");
      ops.push(put({ ...proofKey, kind: "CASHBOX_EXTERNAL_PROOF_CLAIM", operationId: row3.operationId, code: r.code, type: r.type, reference: r.reference.trim(), at, actorId: a.actorId, retentionClass: "FINANCIAL_SETTLEMENT" }));
      for (const pin of row3.pins) {
        const box = await loadBox(pin.code, !["COUNT", "ADJUSTMENT", "VOID_COUNT", "HANDOVER"].includes(type));
        const raw = await get(cashBalanceKey(pin.code));
        if (!equal(box, pin.box) || !equal(raw, pin.balance)) return fail14("PAYOUT_CASH_OPERATION_STALE");
        ops.push(exactCheck(T, cashboxKey(pin.code), box));
        if (pin.balance) {
          await readCashBalance(db, pin.code);
          if (pin.custodianProfile) {
            const custodian = await employee(db, pin.box.custodianEmployeeId, false);
            if (!equal(custodySnapshot(custodian), pin.custodianProfile)) return fail14("PAYOUT_CASH_OPERATION_STALE");
            ops.push(cashEmployeeGuard(custodian));
          }
        }
      }
      if (["OPENING", "HANDOVER"].includes(type)) {
        const e = await cashboxCustodian(db, r.custodianEmployeeId);
        if (!equal(custodySnapshot(e), row3.custodian)) return fail14("PAYOUT_CASH_OPERATION_STALE");
        ops.push(cashEmployeeGuard(e));
      }
      if (["OPENING", "RECEIPT"].includes(type)) changes.push({ code: r.code, deltaIqd: n });
      if (type === "EXPENSE") changes.push({ code: r.code, deltaIqd: -n });
      if (type === "TRANSFER") changes.push({ code: r.code, deltaIqd: -n }, { code: r.targetCode, deltaIqd: n });
      if (type === "ADJUSTMENT") changes.push({ code: r.code, deltaIqd: row3.count.differenceIqd });
      if (type === "REVERSAL") for (const x of row3.original.assetChanges) changes.push({ code: x.code, deltaIqd: -x.deltaIqd });
      if (["COUNT", "VOID_COUNT", "HANDOVER"].includes(type)) changes.push({ code: r.code, deltaIqd: 0 });
      if (type === "OPENING" || type === "RECEIPT") lines.push({ account: "CASHBOX_ASSET", code: r.code, side: "DEBIT", amountIqd: n }, { account: type === "OPENING" ? "OPENING_EQUITY" : r.account, side: "CREDIT", amountIqd: n });
      if (type === "EXPENSE") lines.push({ account: r.account, side: "DEBIT", amountIqd: n }, { account: "CASHBOX_ASSET", code: r.code, side: "CREDIT", amountIqd: n });
      if (type === "TRANSFER") lines.push({ account: "CASHBOX_ASSET", code: r.targetCode, side: "DEBIT", amountIqd: n }, { account: "CASHBOX_ASSET", code: r.code, side: "CREDIT", amountIqd: n });
      if (type === "ADJUSTMENT") {
        const positive3 = row3.count.differenceIqd > 0;
        lines.push({ account: positive3 ? "CASHBOX_ASSET" : "CASH_SHORTAGE_EXPENSE", ...positive3 ? { code: r.code } : {}, side: "DEBIT", amountIqd: n }, { account: positive3 ? "CASH_OVERAGE_INCOME" : "CASHBOX_ASSET", ...!positive3 ? { code: r.code } : {}, side: "CREDIT", amountIqd: n });
      }
      if (type === "REVERSAL") for (const l of row3.original.lines) lines.push({ ...l, side: l.side === "DEBIT" ? "CREDIT" : "DEBIT" });
      if (lines.reduce((s, l) => s + (l.side === "DEBIT" ? l.amountIqd : -l.amountIqd), 0) !== 0) return fail14("PAYOUT_CASH_UNBALANCED");
      for (const change of changes) {
        const pin = row3.pins.find((p) => p.code === change.code), l = ledger(change.code, pin.balance, change.deltaIqd, at, journalId, a.actorId, { category: type, operationId: row3.operationId, reference: r.reference, reason: r.reason, counterparty: r.counterparty, assetChanges: changes, lines, cashboxSnapshot: pin.box, requestedBy: row3.requestedBy, requestedAt: row3.requestedAt, custodyTo: ["OPENING", "HANDOVER"].includes(type) ? { employeeId: r.custodianEmployeeId, name: row3.custodian.name } : null });
        if (type === "COUNT") {
          const difference = r.amountIqd - pin.balance.balanceIqd, count = { pk: cashpk(r.code), sk: "COUNT#" + row3.operationId, kind: "CASHBOX_COUNT", countId: row3.operationId, status: difference ? "DIFFERENCE_PENDING" : "MATCHED", countedIqd: r.amountIqd, bookIqd: pin.balance.balanceIqd, differenceIqd: difference, balanceVersion: l.balance.version, cashboxSnapshot: pin.box, actorId: a.actorId, requestedBy: row3.requestedBy, submittedAt: row3.requestedAt, approvedAt: at, at, reference: r.reference, reason: r.reason, retentionClass: "FINANCIAL_SETTLEMENT" };
          l.balance.lastCountId = row3.operationId;
          if (difference) l.balance.pendingCountId = row3.operationId;
          ops.push(put(count));
        }
        if (["ADJUSTMENT", "VOID_COUNT"].includes(type)) {
          const count = await get({ pk: row3.count.pk, sk: row3.count.sk });
          if (!equal(count, row3.count)) return fail14("PAYOUT_CASH_OPERATION_STALE");
          delete l.balance.pendingCountId;
          ops.push(put({ ...count, status: type === "VOID_COUNT" ? "VOIDED" : "RESOLVED", resolvedBy: a.actorId, resolvedAt: at, adjustmentJournalId: journalId, adjustmentReason: r.reason }, count || void 0));
        }
        ops.push(put(l.row), put(l.balance, pin.balance || void 0));
      }
      if (["OPENING", "HANDOVER"].includes(type)) {
        const box = row3.pins[0].box;
        ops.splice(ops.findIndex((op) => op.ConditionCheck?.TableName === T && equal(op.ConditionCheck?.Key, cashboxKey(box.code))), 1);
        ops.push(put({ ...box, custodianEmployeeId: r.custodianEmployeeId, custodian: cashEmployeeName(row3.custodian), version: box.version + 1, updatedAt: at, updatedBy: a.actorId, lastCustodyJournalId: journalId }, box));
      }
      if (type === "REVERSAL") {
        const original = await get({ pk: row3.original.pk, sk: row3.original.sk });
        if (!original || !equal(original, row3.original)) return fail14("PAYOUT_CASH_OPERATION_STALE");
        ops.push(exactCheck(T, { pk: original.pk, sk: original.sk }, original), put({ pk: cashpk(r.code), sk: "REVERSED#" + r.journalId, kind: "CASHBOX_REVERSAL_LINK", originalJournalId: r.journalId, journalId, at, actorId: a.actorId, retentionClass: "FINANCIAL_SETTLEMENT" }));
      }
    }
    const next2 = { ...row3, status: cancel ? "CANCELLED" : "POSTED", version: row3.version + 1, ...cancel ? { cancelledBy: a.actorId, cancelledAt: at, cancellationReason: v.reason } : { postedBy: a.actorId, postedAt: at, journalId } };
    ops.push(put(next2, row3), put({ ...eventKey, kind: "CASHBOX_OPERATION_EVENT", operationId: row3.operationId, action: v.action, requestDigest: quoteHash(v), actorId: a.actorId, at, from: row3.status, to: next2.status, reason: cancel ? v.reason : r.reason, retentionClass: "FINANCIAL_SETTLEMENT" }));
    try {
      await options.commit(v.branchId, cancel ? "STAFF" : "APPROVE", a, cashAccountingDeduplicate(ops), n);
    } catch (e) {
      const saved = await get(eventKey);
      if (saved?.requestDigest === quoteHash(v) && saved.actorId === a.actorId) return { operation: presentOperation(await get(k)), replayed: true };
      throw e;
    }
    return { operation: presentOperation(next2) };
  }
  return {
    act: (v) => v.action === "REQUEST_CASH_OPERATION" ? proposal(v) : post(v, v.action === "CANCEL_CASH_OPERATION"),
    async account(v) {
      if (!exact4(v, ["branchId", "code"])) return fail14("PAYOUT_CASH_OPERATION_INVALID");
      const a = await auth(v.branchId, "READ"), box = await loadBox(v.code, false), raw = await get(cashBalanceKey(v.code)), balance = raw ? await readCashBalance(db, v.code) : null, count = balance?.pendingCountId ? await get({ pk: cashpk(v.code), sk: "COUNT#" + balance.pendingCountId }) : null;
      if (!equal(a, await auth(v.branchId, "READ"))) return fail14("PAYOUT_AUTHORIZATION_CHANGED");
      return { cashbox: box, balance, pendingCount: count, currency: "IQD", generatedAt: new Date(now()).toISOString() };
    },
    async list(v) {
      if (Object.keys(v).some((k) => !["branchId", "code", "view", "cursor"].includes(k)) || !cashboxCode(v.code) || !["cash-operations", "cash-ledger", "cash-counts"].includes(v.view)) return fail14("PAYOUT_CASH_OPERATION_INVALID");
      const a = await auth(v.branchId, "READ"), prefix = { "cash-operations": "OP#", "cash-ledger": "LEDGER#", "cash-counts": "COUNT#" }[v.view];
      let cursor;
      if (v.cursor) {
        try {
          cursor = JSON.parse(Buffer.from(v.cursor, "base64url").toString());
          if (!exact4(cursor, ["pk", "sk"]) || cursor.pk !== cashpk(v.code) || typeof cursor.sk !== "string" || !cursor.sk.startsWith(prefix) || cursor.sk.length > 200) throw Error();
        } catch {
          return fail14("PAYOUT_INVALID_CURSOR");
        }
      }
      const out = await db.send(new import_lib_dynamodb6.QueryCommand({ TableName: T, ConsistentRead: true, Limit: 25, ScanIndexForward: false, KeyConditionExpression: "pk=:pk AND begins_with(sk,:prefix)", ExpressionAttributeValues: { ":pk": cashpk(v.code), ":prefix": prefix }, ...cursor ? { ExclusiveStartKey: cursor } : {} }));
      if (!equal(a, await auth(v.branchId, "READ"))) return fail14("PAYOUT_AUTHORIZATION_CHANGED");
      if (v.view === "cash-ledger") for (const row3 of out.Items || []) {
        const { digest, ...content } = row3;
        if (row3.kind !== "CASHBOX_LEDGER_ENTRY" || !Array.isArray(row3.lines) || quoteHash(content) !== digest || row3.balanceAfterIqd - row3.balanceBeforeIqd !== row3.deltaIqd || row3.lines.reduce((n, l) => n + (l.side === "DEBIT" ? l.amountIqd : -l.amountIqd), 0) !== 0) return fail14("PAYOUT_CASH_BALANCE_PROOF_INVALID");
      }
      return { items: v.view === "cash-operations" ? (out.Items || []).map(presentOperation) : out.Items || [], nextCursor: out.LastEvaluatedKey ? Buffer.from(JSON.stringify(out.LastEvaluatedKey)).toString("base64url") : null, coverage: "CURRENT_PAGE", generatedAt: new Date(now()).toISOString() };
    },
    async custodians(v) {
      if (Object.keys(v).some((k) => !["branchId", "cursor"].includes(k))) return fail14("PAYOUT_CASH_OPERATION_INVALID");
      const a = await auth(v.branchId, "READ");
      let cursor;
      if (v.cursor) {
        try {
          cursor = JSON.parse(Buffer.from(v.cursor, "base64url").toString());
          if (!exact4(cursor, ["pk", "sk"]) || typeof cursor.pk !== "string" || typeof cursor.sk !== "string" || cursor.pk.length > 180 || cursor.sk.length > 180) throw Error();
        } catch {
          return fail14("PAYOUT_INVALID_CURSOR");
        }
      }
      const out = await db.send(new import_lib_dynamodb6.ScanCommand({ TableName: S2, ConsistentRead: true, Limit: 100, ProjectionExpression: "pk,sk,employeeId,#n,fullName,displayName,#s,#r,#v,deletionRequestId,deletedAt,isDeleted", ExpressionAttributeNames: { "#n": "name", "#s": "status", "#r": "roles", "#v": "version" }, ...cursor ? { ExclusiveStartKey: cursor } : {} }));
      if (!equal(a, await auth(v.branchId, "READ"))) return fail14("PAYOUT_AUTHORIZATION_CHANGED");
      return { items: (out.Items || []).filter((e) => e.sk === "PROFILE" && e.pk === "EMPLOYEE#" + e.employeeId && uuid2(e.employeeId) && Number.isSafeInteger(e.version) && e.version >= 1 && e.status === "ACTIVE" && e.deletedAt == null && e.deletionRequestId == null && e.isDeleted !== true).map((e) => ({ employeeId: e.employeeId, name: [e.fullName, e.displayName, e.name].find((n) => typeof n === "string" && n.trim() && !n.includes("@") && !uuid2(n)) || "\u0627\u0644\u0627\u0633\u0645 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644", jobTitle: (e.roles || []).map((role) => role === "bootstrap_admin" ? "\u0645\u062F\u064A\u0631 \u0627\u0644\u0646\u0638\u0627\u0645" : LABELS[role]).filter(Boolean).join("\u060C ") || "\u0645\u0648\u0638\u0641 \u0625\u062F\u0627\u0631\u064A", canRequestFinance: allowed3(e, "finance.request") })), nextCursor: out.LastEvaluatedKey ? Buffer.from(JSON.stringify(out.LastEvaluatedKey)).toString("base64url") : null };
    }
  };
}

// backend/wallet-service/src/merchantPayout.ts
var import_lib_dynamodb8 = require("@aws-sdk/lib-dynamodb");
var import_node_crypto2 = require("node:crypto");

// backend/wallet-service/src/merchantStatementApproval.ts
var import_lib_dynamodb7 = require("@aws-sdk/lib-dynamodb");
var T2 = "staging-MerchantPlatform";
var fail15 = (code = "SETTLEMENT_APPROVAL_UNAVAILABLE") => {
  throw Object.assign(Error(code), { code });
};
var key2 = (branchId, batchId) => ({ pk: "MERCHANT_SETTLEMENT#" + branchId, sk: "APPROVAL#" + batchId });
async function readMerchantStatementApproval(db, branchId, batchId, batchDigest) {
  const row3 = await strongGet(db, T2, key2(branchId, batchId));
  if (!row3) return null;
  const { pk: pk3, sk, digest, ...body } = row3;
  if (!equal({ pk: pk3, sk }, key2(branchId, batchId)) || quoteHash(body) !== digest || row3.kind !== "MERCHANT_STATEMENT_APPROVAL" || row3.schemaVersion !== 1 || row3.branchId !== branchId || row3.batchId !== batchId || row3.batchDigest !== batchDigest || row3.status !== "APPROVED_NOT_PAID" || row3.approvalPolicy !== "SINGLE_ADMIN" || row3.payoutAuthorized !== false || row3.walletMutationPerformed !== false || !quoteEntityIdValid(row3.approvedBy) || !Number.isFinite(Date.parse(row3.approvedAt))) return fail15("SETTLEMENT_APPROVAL_PROOF_INVALID");
  return row3;
}
function createMerchantStatementApproval(options) {
  const { db } = options, now = options.now ?? Date.now;
  return async (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || !["batchDigest,batchId,branchId", "batchDigest,batchId,branchId,confirmOffCycle"].includes(Object.keys(value).sort().join(","))) return fail15("INVALID_SETTLEMENT_APPROVAL_REQUEST");
    const v = value;
    if (!quoteEntityIdValid(v.branchId) || !/^MSB:[a-f0-9]{48}$/.test(v.batchId) || !/^[a-f0-9]{64}$/.test(v.batchDigest)) return fail15("INVALID_SETTLEMENT_APPROVAL_REQUEST");
    const actor = await options.authorize(v.branchId), saved = await options.readBatch({ branchId: v.branchId, batchId: v.batchId });
    if (saved.header.period?.kind === "MERCHANT_OFF_CYCLE_PERIOD") {
      if (v.confirmOffCycle !== true) return fail15("SETTLEMENT_OFF_CYCLE_CONFIRMATION_REQUIRED");
      const employee2 = await strongGet(db, "staging-PlatformStaff", { pk: "EMPLOYEE#" + actor.actorId, sk: "PROFILE" });
      if (!employee2 || !Number.isSafeInteger(employee2.approvalLimit) || employee2.approvalLimit < toWholeIqdExact(readMoney(saved.header.summary.amounts.merchantNet))) return fail15("SETTLEMENT_APPROVAL_LIMIT");
      if (!equal(actor, await options.authorize(v.branchId))) return fail15("SETTLEMENT_AUTHORIZATION_CHANGED");
    }
    if (saved.header.period?.kind !== "MERCHANT_OFF_CYCLE_PERIOD" && v.confirmOffCycle !== void 0) return fail15("INVALID_SETTLEMENT_APPROVAL_REQUEST");
    if (saved.header.batchDigest !== v.batchDigest) return fail15("SETTLEMENT_PREVIEW_CHANGED");
    const prior = await readMerchantStatementApproval(db, v.branchId, v.batchId, v.batchDigest);
    if (prior) return { approval: prior, replayed: true };
    const branchKey = { businessId: v.branchId }, branch = await strongGet(db, "WhizzMerchants_Businesses", branchKey);
    if (!branch || branch.ownerId !== branch.cognitoUserId || branch.status !== "approved" || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail15("SETTLEMENT_BRANCH_UNAVAILABLE");
    const operations = [...actor.guards, exactCheck(T2, { pk: saved.header.pk, sk: saved.header.sk }, saved.header), exactCheck("WhizzMerchants_Businesses", branchKey, branch)];
    for (const pk3 of ["BUSINESS_LIFECYCLE#MERCHANT#" + v.branchId, "ACCOUNT_LIFECYCLE#MERCHANT#" + branch.ownerId]) {
      const k = { pk: pk3, sk: "META" };
      if (await strongGet(db, "staging-AccountDeletion", k)) return fail15("SETTLEMENT_BRANCH_UNAVAILABLE");
      operations.push({ ConditionCheck: { TableName: "staging-AccountDeletion", Key: k, ConditionExpression: "attribute_not_exists(pk)" } });
    }
    for (const line of saved.lines) {
      const k = { orderId: line.orderId, sk: "MERCHANT_PAYABLE" }, payable = await strongGet(db, "staging-Holds", k);
      if (!payable || payable.status !== "LOCKED_PENDING_SETTLEMENT" || payable.settlementBatchId !== v.batchId || payable.settlementLineDigest !== line.lineDigest || payable.branchId !== v.branchId) return fail15("SETTLEMENT_SOURCE_CHANGED_OR_ALREADY_CLAIMED");
      operations.push(exactCheck(T2, { pk: line.pk, sk: line.sk }, line), exactCheck("staging-Holds", k, payable));
    }
    const at = new Date(now()).toISOString(), body = { schemaVersion: 1, kind: "MERCHANT_STATEMENT_APPROVAL", branchId: v.branchId, batchId: v.batchId, batchDigest: v.batchDigest, status: "APPROVED_NOT_PAID", approvalPolicy: "SINGLE_ADMIN", approvedBy: actor.actorId, approvedAt: at, payoutAuthorized: false, walletMutationPerformed: false, retentionClass: "FINANCIAL_SETTLEMENT" }, approval = { ...key2(v.branchId, v.batchId), ...body, digest: quoteHash(body) };
    operations.push({ Put: { TableName: T2, Item: approval, ConditionExpression: "attribute_not_exists(pk)" } }, { Put: { TableName: "staging-AuditLog", Item: { datePartition: "date#" + at.slice(0, 10).replace(/-/g, ""), sk: at + "#" + v.batchId + "#APPROVED", action: "MERCHANT_STATEMENT_APPROVED", actorId: actor.actorId, branchId: v.branchId, batchId: v.batchId, batchDigest: v.batchDigest, createdAt: at }, ConditionExpression: "attribute_not_exists(sk)" } });
    if (!equal(actor, await options.authorize(v.branchId))) return fail15("SETTLEMENT_AUTHORIZATION_CHANGED");
    try {
      await db.send(new import_lib_dynamodb7.TransactWriteCommand({ TransactItems: operations, ClientRequestToken: quoteHash(operations).slice(0, 36) }));
    } catch (error) {
      const committed = await readMerchantStatementApproval(db, v.branchId, v.batchId, v.batchDigest);
      if (committed && equal(actor, await options.authorize(v.branchId))) return { approval: committed, replayed: true };
      throw error;
    }
    return { approval, replayed: false };
  };
}

// backend/wallet-service/src/merchantPayout.ts
var P2 = "staging-MerchantPlatform";
var B2 = "WhizzMerchants_Businesses";
var H = "staging-Holds";
var W = "staging-Wallets";
var L = "staging-LedgerEntries";
function fail16(code = "PAYOUT_CONFLICT") {
  throw Object.assign(Error(code), { code });
}
var id2 = (v) => quoteEntityIdValid(v);
var uuid3 = (v) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
var pk = (branchId) => "MERCHANT_PAYOUT#" + branchId;
var key3 = (branchId, sk) => ({ pk: pk(branchId), sk });
var destinationKey = (branchId, ownerId) => ({ pk: "MERCHANT_PAYOUT_DESTINATION#" + branchId, sk: "OWNER#" + ownerId });
var phone = (v) => {
  let n = typeof v === "string" ? v.replace(/[\s()-]/g, "") : "";
  if (/^07\d{9}$/.test(n)) n = "+964" + n.slice(1);
  if (/^9647\d{9}$/.test(n)) n = "+" + n;
  if (!/^\+9647\d{9}$/.test(n)) return fail16("PAYOUT_INVALID_PHONE");
  return n;
};
var masked = (v) => "\u2022\u2022\u2022\u2022" + v.slice(-4);
function put2(table, row3, prior) {
  if (!prior) return { Put: { TableName: table, Item: row3, ConditionExpression: "attribute_not_exists(#key)", ExpressionAttributeNames: { "#key": table === H ? "orderId" : table === L || table === "staging-AuditLog" ? "sk" : table === W ? "walletId" : "pk" } } };
  const { Key: _key, ...q } = exactCheck(table, table === H ? { orderId: row3.orderId, sk: row3.sk } : table === W ? { walletId: row3.walletId, sk: row3.sk } : { pk: row3.pk, sk: row3.sk }, prior).ConditionCheck;
  return { Put: { ...q, Item: row3 } };
}
function setFields(check, fields2) {
  const names = {}, values = {};
  const assignments = Object.entries(fields2).map(([k, v], i) => {
    names["#u" + i] = k;
    values[":u" + i] = v;
    return "#u" + i + "=:u" + i;
  });
  return updateChecked(check, "SET " + assignments.join(","), names, values);
}
function seal2(body) {
  return { ...body, digest: quoteHash(body) };
}
function validSeal(row3) {
  const { digest, ...body } = row3 || {};
  return typeof digest === "string" && digest === quoteHash(body);
}
function verifyMerchantPayoutJournal(row3, branchId, payable) {
  if (!validSeal(row3) || row3.kind !== "MERCHANT_PAYOUT_PAID_JOURNAL" || row3.schemaVersion !== 1 || row3.status !== "PAID" || row3.branchId !== branchId || row3.payoutId !== payable.paidPayoutId || row3.paidAt !== payable.paidAt || row3.batchId !== payable.settlementBatchId || row3.pk !== "MERCHANT_PAYOUT_PAID#" + row3.payoutId || row3.sk !== "META" || !["CASH", "ZAIN_CASH"].includes(row3.method)) return fail16("PAYOUT_PAID_PROOF_INVALID");
  const amount4 = toWholeIqdExact(readMoney(row3.amount));
  if (!Number.isSafeInteger(amount4) || amount4 <= 0 || !Number.isSafeInteger(row3.executionFee) || row3.executionFee < 0 || !Number.isSafeInteger(amount4 + row3.executionFee) || row3.method === "CASH" && row3.executionFee !== 0 || row3.debit !== amount4 + row3.executionFee || row3.credit !== amount4 + row3.executionFee || !Array.isArray(row3.orderLines) || new Set(row3.orderLines.map((l) => l.orderId)).size !== row3.orderLines.length || row3.orderLines.reduce((s, l) => s + l.amount, 0) !== amount4 || !row3.orderLines.some((l) => l.orderId === payable.orderId && l.amount === payable.amount && l.lineDigest === payable.settlementLineDigest) || row3.receiptOwnerId !== row3.ownerId || !row3.externalReference || !row3.sourceAccount || !row3.reconciledBy || !equal(row3.lines, [{ account: "MERCHANT_PAYABLE", side: "DEBIT", amount: amount4 }, ...row3.executionFee ? [{ account: "PAYOUT_FEE_EXPENSE", side: "DEBIT", amount: row3.executionFee }] : [], { account: row3.method === "CASH" ? row3.cashLedgerJournalId ? "MERCHANT_DISBURSEMENT_CLEARING" : "CASH_DISBURSEMENT" : "ZAIN_CASH_DISBURSEMENT", side: "CREDIT", amount: amount4 + row3.executionFee }])) return fail16("PAYOUT_PAID_PROOF_INVALID");
  return row3;
}
async function readMerchantStatementPayment(db, saved, ownerId) {
  const h = saved.header, claim = await strongGet(db, P2, key3(h.branchId, "BATCH#" + h.batchId));
  if (claim?.status !== "PAID") return claim;
  if (claim.kind !== "MERCHANT_PAYOUT_CLAIM" || claim.branchId !== h.branchId || claim.batchId !== h.batchId || !/^MPO:[a-f0-9]{48}$/.test(claim.payoutId || "") || !equal(claim.amount, h.summary.amounts.merchantNet)) return fail16("PAYOUT_PAID_PROOF_INVALID");
  const journal = await strongGet(db, P2, { pk: "MERCHANT_PAYOUT_PAID#" + claim.payoutId, sk: "META" });
  if (journal?.cashLedgerJournalId) await verifyCashPayoutPosting(db, journal);
  if (!journal || journal.batchDigest !== h.batchDigest || journal.ownerId !== ownerId || journal.paidAt !== claim.paidAt || !equal(journal.amount, h.summary.amounts.merchantNet) || journal.orderLines?.length !== saved.lines.length) return fail16("PAYOUT_PAID_PROOF_INVALID");
  for (const line of saved.lines) {
    const payable = await strongGet(db, H, { orderId: line.orderId, sk: "MERCHANT_PAYABLE" });
    if (!payable || payable.branchId !== h.branchId || payable.orderId !== line.orderId || payable.status !== "PAID" || payable.paidPayoutId !== claim.payoutId || payable.settlementBatchId !== h.batchId || payable.settlementLineDigest !== line.lineDigest || payable.amount !== toWholeIqdExact(readMoney(line.accrual.amounts.merchantNet))) return fail16("PAYOUT_PAID_PROOF_INVALID");
    verifyMerchantPayoutJournal(journal, h.branchId, payable);
  }
  return claim;
}
function createMerchantPayoutService(options) {
  const { db } = options, now = options.now ?? Date.now, get = (k) => strongGet(db, P2, k);
  const publicRow = (r) => ({ payoutId: r.payoutId, batchId: r.batchId, batchDigest: r.batchDigest, branchId: r.branchId, amount: r.amount, method: r.method, destination: r.destinationMasked, recipientName: r.receiptActor?.name || r.recipientName || "\u0645\u0627\u0644\u0643 \u0627\u0644\u0645\u0637\u0639\u0645", requestActor: r.requestActor || null, receiptActor: r.receiptActor || null, recipientRoleLabel: r.receiptActor?.roleLabel || r.requestActor?.roleLabel || "\u0645\u0627\u0644\u0643", recipientBusinessName: r.receiptActor?.businessName || r.requestActor?.businessName || null, recipientAccountId: r.ownerId, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, version: r.version, executionFee: r.executionFee ?? null, sourceDebited: r.sourceDebited ?? null, externalReference: r.externalReference || null, sourceAccount: r.sourceAccount || null, cashbox: r.cashbox || null, cashVoucherNumber: r.method === "CASH" ? r.cashVoucherNumber || cashVoucherNumber(r) : null, executionRecordedBy: r.executionRecordedBy || null, executionRecordedAt: r.executionRecordedAt || null, paidAt: r.paidAt || null, ownerReceiptAt: r.ownerReceiptAt || null, nonReceiptAt: r.nonReceiptAt || null, failureReference: r.failureReference || null, failureReason: r.failureReason || null, reviewReason: r.reviewReason || null });
  async function context2(branchId, action, amount4 = 0) {
    if (branchId === "COMPANY_CASHBOOK" && action !== "OWNER" && options.companyCashAuthority) {
      const a2 = await options.companyCashAuthority(action, amount4);
      if (a2.owner || a2.merchantStaff) return fail16("PAYOUT_PERMISSION_REQUIRED");
      return { ...a2, ownerId: "COMPANY_CASHBOOK" };
    }
    if (!id2(branchId)) return fail16("PAYOUT_INVALID_REQUEST");
    const a = await options.authorize(branchId, action, amount4), branch = await strongGet(db, B2, { businessId: branchId });
    if (!branch || branch.status !== "approved" || !id2(branch.ownerId) || branch.ownerId !== branch.cognitoUserId || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true || a.owner && a.actorId !== branch.ownerId || action === "OWNER" && !a.owner && !a.merchantStaff || ["STAFF", "APPROVE"].includes(action) && (a.owner || a.merchantStaff)) return fail16("PAYOUT_PERMISSION_REQUIRED");
    if (a.merchantStaff && a.ownerId !== branch.ownerId) return fail16("PAYOUT_OWNER_CHANGED");
    const guards = [...a.guards.filter((g) => !(g.ConditionCheck?.TableName === B2 && g.ConditionCheck?.Key?.businessId === branchId)), exactCheck(B2, { businessId: branchId }, branch)];
    for (const k of ["BUSINESS_LIFECYCLE#MERCHANT#" + branchId, "ACCOUNT_LIFECYCLE#MERCHANT#" + branch.ownerId]) {
      const d = { pk: k, sk: "META" };
      if (await readMerchantDeletionFence(db, d)) return fail16("PAYOUT_PARTY_UNAVAILABLE");
      guards.push({ ConditionCheck: { TableName: "staging-AccountDeletion", Key: d, ConditionExpression: "attribute_not_exists(pk)" } });
    }
    return { ...a, ownerId: branch.ownerId, businessName: branch.businessName || branch.name || null, guards };
  }
  async function verifyPaidPayout(row3, ownerId) {
    if (row3.status !== "PAID") return;
    await verifyCashPayoutPosting(db, row3);
    if (row3.cashbox) {
      const movement = await get(cashMovementKey(row3));
      if (!movement || movement.status !== "PAID" || movement.payoutId !== row3.payoutId || !equal(movement.amount, row3.amount) || !equal(movement.cashbox, row3.cashbox)) return fail16("PAYOUT_CASHBOX_REGISTER_PROOF_INVALID");
    }
    const saved = await options.readBatch(row3.branchId, row3.batchId), claim = await readMerchantStatementPayment(db, saved, ownerId);
    if (!claim || claim.status !== "PAID" || claim.payoutId !== row3.payoutId) return fail16("PAYOUT_PAID_PROOF_INVALID");
    const journal = await get({ pk: "MERCHANT_PAYOUT_PAID#" + row3.payoutId, sk: "META" });
    if (!journal || ["branchId", "batchId", "batchDigest", "payoutId", "ownerId", "amount", "method", "paidAt", "externalReference", "sourceAccount", "ownerReceiptAt", "cashLedgerJournalId", "receiptActor"].some((k) => !equal(row3[k], journal[k])) || (row3.executionFee ?? 0) !== journal.executionFee) return fail16("PAYOUT_PAID_PROOF_INVALID");
  }
  const authoritySnapshot = (a) => a.merchantStaff ? { ...a, guards: a.guards.map((g) => {
    const c = g.ConditionCheck;
    if (!c?.ExpressionAttributeValues) return g;
    return { ConditionCheck: { ...c, ExpressionAttributeValues: Object.fromEntries(Object.entries(c.ExpressionAttributeValues).map(([k, v]) => [k, k === ":now" || /^:g[0-9]+x[0-9]+_now$/.test(k) ? "FRESH_EXPIRY_CHECK" : v])) } };
  }) } : a;
  async function write(branchId, action, a, operations, amount4 = 0) {
    const after = await context2(branchId, action, amount4);
    if (!equal(authoritySnapshot(a), authoritySnapshot(after))) return fail16("PAYOUT_AUTHORIZATION_CHANGED");
    if (operations.length + after.guards.length > 100 || Buffer.byteLength(JSON.stringify(operations)) > 25e5) return fail16("PAYOUT_LIMIT_EXCEEDED");
    if (after.merchantStaff && after.merchantIdentity) {
      const at = new Date(now()).toISOString();
      operations.push(put2(P2, { pk: "BRANCH#" + branchId, sk: "STAFF_AUDIT#SETTLEMENT#" + at + "#" + quoteHash(operations).slice(0, 40), kind: "MERCHANT_STAFF_SETTLEMENT_ACTION", businessId: branchId, ownerId: after.ownerId, actorId: after.actorId, actorName: after.merchantIdentity.name, roleName: after.merchantIdentity.roleLabel, roleId: after.merchantIdentity.role, membershipVersion: after.merchantIdentity.membershipVersion, policyVersion: after.merchantIdentity.policyVersion, deviceId: after.merchantIdentity.deviceId, action: operations.find((o) => o.Put?.Item?.kind === "MERCHANT_PAYOUT_EVENT")?.Put.Item.action || operations.find((o) => o.Put?.TableName === "staging-AuditLog")?.Put.Item.action || "PAYOUT_" + action, createdAt: at, result: "SUCCEEDED" }));
    }
    await db.send(new import_lib_dynamodb8.TransactWriteCommand({ TransactItems: cashAccountingDeduplicate([...after.guards, ...operations]), ClientRequestToken: quoteHash(operations).slice(0, 36) }));
  }
  const audit = (branchId, payoutId, actorId, action, requestId) => put2("staging-AuditLog", { datePartition: "date#" + new Date(now()).toISOString().slice(0, 10).replace(/-/g, ""), sk: "PAYOUT#" + payoutId + "#" + requestId, action: "MERCHANT_PAYOUT_" + action, branchId, payoutId, actorId, createdAt: new Date(now()).toISOString() });
  async function batch(branchId, batchId) {
    const b = await options.readBatch(branchId, batchId);
    const approval = await readMerchantStatementApproval(db, branchId, batchId, b.header.batchDigest);
    if (!approval) return fail16("PAYOUT_STATEMENT_APPROVAL_REQUIRED");
    if (b.lines.length < 1 || b.lines.length > 10) return fail16("PAYOUT_LIMIT_EXCEEDED");
    const amount4 = toWholeIqdExact(readMoney(b.header.summary.amounts.merchantNet));
    if (amount4 <= 0) return fail16("PAYOUT_POSITIVE_AMOUNT_REQUIRED");
    return { ...b, approval, amount: amount4 };
  }
  async function request(v) {
    if (!["CASH", "ZAIN_CASH"].includes(v.method) || !uuid3(v.requestId) || !/^MSB:[a-f0-9]{48}$/.test(v.batchId || "") || !/^[a-f0-9]{64}$/.test(v.batchDigest || "") || Object.keys(v).some((k2) => !["action", "branchId", "requestId", "batchId", "batchDigest", "method", "destinationProofId"].includes(k2)) || v.method === "CASH" && v.destinationProofId) return fail16("PAYOUT_INVALID_REQUEST");
    const a = await context2(v.branchId, "OWNER"), payoutId = "MPO:" + quoteHash({ branchId: v.branchId, ownerId: a.actorId, requestId: v.requestId }).slice(0, 48), k = key3(v.branchId, payoutId), digest = quoteHash(v), prior = await get(k);
    if (prior) {
      if (prior.requestDigest !== digest || prior.ownerId !== a.ownerId) return fail16("PAYOUT_REQUEST_ID_CONFLICT");
      return { payout: publicRow(prior), replayed: true };
    }
    const b = await batch(v.branchId, v.batchId);
    if (b.header.batchDigest !== v.batchDigest) return fail16("PAYOUT_STATEMENT_CHANGED");
    const claimKey = key3(v.branchId, "BATCH#" + v.batchId), claim = await get(claimKey);
    if (claim && !["CANCELLED", "FAILED_NOT_PAID"].includes(claim.status)) return fail16("PAYOUT_STATEMENT_ALREADY_CLAIMED");
    const proofKey = destinationKey(v.branchId, a.ownerId), proof = v.method === "ZAIN_CASH" ? await get(proofKey) : null;
    if (v.method === "ZAIN_CASH" && (!proof || proof.proofId !== v.destinationProofId || proof.status !== "VERIFIED" || proof.ownerId !== a.ownerId || proof.expiresAt <= now() / 1e3)) return fail16("PAYOUT_DESTINATION_VERIFICATION_REQUIRED");
    const recipientKey = { pk: "PERSON#" + a.actorId, sk: "PROFILE" }, recipient = (await db.send(new import_lib_dynamodb8.GetCommand({ TableName: P2, Key: recipientKey, ConsistentRead: true, ProjectionExpression: "#p,#s,#n,#v", ExpressionAttributeNames: { "#p": "pk", "#s": "sk", "#n": "name", "#v": "version" } }))).Item;
    const at = new Date(now()).toISOString(), row3 = { ...k, schemaVersion: 1, kind: "MERCHANT_PAYOUT", payoutId, branchId: v.branchId, ownerId: a.ownerId, requestActor: a.merchantIdentity || { subjectId: a.actorId, name: typeof recipient?.name === "string" ? recipient.name : "\u0645\u0627\u0644\u0643 \u0627\u0644\u0645\u0637\u0639\u0645", role: "OWNER", roleLabel: "\u0645\u0627\u0644\u0643", businessId: v.branchId, businessName: a.businessName, ownerId: a.ownerId }, recipientName: typeof recipient?.name === "string" ? recipient.name.slice(0, 120) : "\u0645\u0627\u0644\u0643 \u0627\u0644\u0645\u0637\u0639\u0645", batchId: v.batchId, batchDigest: v.batchDigest, amount: b.header.summary.amounts.merchantNet, method: v.method, destinationMasked: proof ? masked(proof.phone) : "\u0645\u0627\u0644\u0643 \u0627\u0644\u0645\u0637\u0639\u0645", requestDigest: digest, status: "UNDER_REVIEW", version: 1, createdAt: at, updatedAt: at, retentionClass: "FINANCIAL_SETTLEMENT" };
    const operations = [put2(P2, row3), put2(P2, { ...claimKey, kind: "MERCHANT_PAYOUT_CLAIM", branchId: v.branchId, batchId: v.batchId, payoutId, status: "ACTIVE", amount: row3.amount }, claim || void 0), exactCheck(P2, { pk: b.header.pk, sk: b.header.sk }, b.header), exactCheck(P2, { pk: b.approval.pk, sk: b.approval.sk }, b.approval), audit(v.branchId, payoutId, a.actorId, "REQUESTED", v.requestId)];
    if (recipient) operations.push(exactCheck(P2, recipientKey, recipient));
    for (const line of b.lines) {
      const q = { orderId: line.orderId, sk: "MERCHANT_PAYABLE" }, payable = await strongGet(db, H, q);
      if (!payable || payable.status !== "LOCKED_PENDING_SETTLEMENT" || payable.branchId !== v.branchId || payable.amount !== toWholeIqdExact(readMoney(line.accrual.amounts.merchantNet)) || payable.settlementBatchId !== v.batchId || payable.settlementLineDigest !== line.lineDigest) return fail16("PAYOUT_PAYABLE_CHANGED");
      operations.push(exactCheck(H, q, payable), exactCheck(P2, { pk: line.pk, sk: line.sk }, line));
    }
    if (proof) operations.push(put2(P2, { ...key3(v.branchId, "PRIVATE#" + payoutId), kind: "MERCHANT_PAYOUT_DESTINATION", branchId: v.branchId, payoutId, ownerId: a.ownerId, phone: proof.phone, verifiedAt: proof.verifiedAt, proofId: proof.proofId, retentionClass: "FINANCIAL_SETTLEMENT" }), put2(P2, { ...proof, status: "CONSUMED", payoutId, version: proof.version + 1 }, proof));
    try {
      await write(v.branchId, "OWNER", a, operations);
    } catch (e) {
      const saved = await get(k);
      if (saved?.requestDigest === digest) return { payout: publicRow(saved), replayed: true };
      throw e;
    }
    return { payout: publicRow(row3) };
  }
  async function destination(v) {
    if (Object.keys(v).some((k2) => !["action", "branchId", "requestId", "phone", "proofId", "code"].includes(k2))) return fail16("PAYOUT_INVALID_REQUEST");
    const a = await context2(v.branchId, "OWNER");
    if (!options.otp) return fail16("PAYOUT_DESTINATION_SERVICE_UNAVAILABLE");
    const k = destinationKey(v.branchId, a.actorId), old = await get(k), secret = await options.otp.secret();
    const hash = (proofId, code) => (0, import_node_crypto2.createHmac)("sha256", secret).update("merchant-payout-destination\0" + v.branchId + "\0" + a.actorId + "\0" + proofId + "\0" + code).digest("hex");
    if (v.action === "START_PAYOUT_DESTINATION") {
      const n = phone(v.phone);
      if (!uuid3(v.requestId)) return fail16("PAYOUT_INVALID_REQUEST");
      if (old && old.requestId === v.requestId) {
        if (old.phone !== n) return fail16("PAYOUT_REQUEST_ID_CONFLICT");
        return { proofId: old.proofId, status: old.status, destination: masked(n) };
      }
      if (old && (old.lastSentAt > now() - 6e4 || old.rateWindow > now() - 36e5 && old.sendCount >= 5)) return fail16("PAYOUT_DESTINATION_RATE_LIMIT");
      const proofId = "MPD:" + quoteHash({ ownerId: a.actorId, branchId: v.branchId, requestId: v.requestId }).slice(0, 48), code = String((0, import_node_crypto2.randomInt)(1e6)).padStart(6, "0");
      const row4 = { ...k, kind: "MERCHANT_PAYOUT_DESTINATION_CHALLENGE", branchId: v.branchId, ownerId: a.actorId, requestId: v.requestId, proofId, phone: n, codeHash: hash(proofId, code), attempts: 0, status: "CODE_SENT", expiresAt: Math.floor(now() / 1e3) + 300, lastSentAt: now(), rateWindow: old && old.rateWindow > now() - 36e5 ? old.rateWindow : now(), sendCount: old && old.rateWindow > now() - 36e5 ? old.sendCount + 1 : 1, version: (old?.version || 0) + 1 };
      await write(v.branchId, "OWNER", a, [put2(P2, row4, old || void 0)]);
      await options.otp.send(n, code);
      return { proofId, destination: masked(n), status: "CODE_SENT" };
    }
    if (!old || old.ownerId !== a.actorId || old.proofId !== v.proofId || old.expiresAt <= now() / 1e3 || old.status !== "VERIFIED" && old.attempts >= 5 || !/^\d{6}$/.test(v.code || "")) return fail16("PAYOUT_DESTINATION_EXPIRED");
    if (old.status === "VERIFIED") return { proofId: old.proofId, status: "VERIFIED", destination: masked(old.phone) };
    if (old.status !== "CODE_SENT") return fail16("PAYOUT_DESTINATION_EXPIRED");
    const ok = (0, import_node_crypto2.timingSafeEqual)(Buffer.from(old.codeHash, "hex"), Buffer.from(hash(old.proofId, v.code), "hex"));
    const row3 = { ...old, attempts: old.attempts + 1, version: old.version + 1, ...ok ? { status: "VERIFIED", verifiedAt: new Date(now()).toISOString(), expiresAt: Math.floor(now() / 1e3) + 600 } : {} };
    await write(v.branchId, "OWNER", a, [put2(P2, row3, old)]);
    if (!ok) return fail16("PAYOUT_INVALID_CODE");
    return { proofId: old.proofId, status: "VERIFIED", destination: masked(old.phone) };
  }
  async function transition(v) {
    const actions = { APPROVE_PAYOUT: ["UNDER_REVIEW", "APPROVED", "APPROVE"], BEGIN_PAYOUT: ["APPROVED", "PROCESSING", "STAFF"], RECORD_PAYOUT_EXECUTION: [["PROCESSING", "RECONCILIATION_REQUIRED"], "AWAITING_RECEIPT", "STAFF"], REOPEN_PAYOUT_RECEIPT: [["RECONCILIATION_REQUIRED", "NON_RECEIPT_CONFIRMED"], "AWAITING_RECEIPT", "APPROVE"], ACK_PAYOUT_RECEIPT: ["AWAITING_RECEIPT", "RECEIPT_CONFIRMED", "OWNER"], RECONCILE_PAYOUT: ["RECEIPT_CONFIRMED", "PAID", "APPROVE"], ACK_PAYOUT_NOT_RECEIVED: ["RECONCILIATION_REQUIRED", "NON_RECEIPT_CONFIRMED", "OWNER"], RESOLVE_PAYOUT_NOT_PAID: ["NON_RECEIPT_CONFIRMED", "FAILED_NOT_PAID", "APPROVE"], CANCEL_PAYOUT: [["UNDER_REVIEW", "APPROVED"], "CANCELLED", "OWNER"], REPORT_PAYOUT_PROBLEM: [["PROCESSING", "AWAITING_RECEIPT", "RECEIPT_CONFIRMED"], "RECONCILIATION_REQUIRED", "OWNER"] };
    const rule = actions[v.action];
    if (!rule || !uuid3(v.requestId) || !/^MPO:[a-f0-9]{48}$/.test(v.payoutId || "") || Object.keys(v).some((k2) => !["action", "branchId", "requestId", "payoutId", "version", "externalReference", "sourceAccount", "actualAmount", "destinationConfirmed", "receivedAmount", "accepted", "reason", "failureReference", "confirmedNoDebit", "executionFee", "cashboxId", "cashboxOverrideReason"].includes(k2))) return fail16("PAYOUT_INVALID_REQUEST");
    const k = key3(v.branchId, v.payoutId), row3 = await get(k);
    if (!row3 || row3.kind !== "MERCHANT_PAYOUT" || row3.branchId !== v.branchId) return fail16("PAYOUT_UNAVAILABLE");
    const amount4 = toWholeIqdExact(readMoney(row3.amount)), a = await context2(v.branchId, rule[2], amount4 + (row3.executionFee || 0));
    if (row3.ownerId !== a.ownerId) return fail16("PAYOUT_OWNER_CHANGED");
    const eventKey = key3(v.branchId, "EVENT#" + v.payoutId + "#" + v.requestId), eventDigest = quoteHash(v), previous = await get(eventKey);
    if (previous) {
      if (previous.requestDigest !== eventDigest || previous.actorId !== a.actorId) return fail16("PAYOUT_REQUEST_ID_CONFLICT");
      return { payout: publicRow(row3), replayed: true };
    }
    if (!Number.isSafeInteger(row3.version) || row3.version < 1 || row3.version >= Number.MAX_SAFE_INTEGER || row3.version !== v.version || !(Array.isArray(rule[0]) ? rule[0] : [rule[0]]).includes(row3.status)) return fail16("PAYOUT_STATE_CHANGED");
    const at = new Date(now()).toISOString(), next2 = { ...row3, status: rule[1], version: row3.version + 1, updatedAt: at }, ops = [];
    if (v.action === "APPROVE_PAYOUT") {
      const b = await batch(v.branchId, row3.batchId);
      if (b.header.batchDigest !== row3.batchDigest || b.amount !== amount4) return fail16("PAYOUT_STATEMENT_CHANGED");
      next2.approvedBy = a.actorId;
      next2.approvedAt = at;
      ops.push(exactCheck(P2, { pk: b.approval.pk, sk: b.approval.sk }, b.approval));
    }
    if (v.action === "BEGIN_PAYOUT") {
      next2.executedBy = a.actorId;
      next2.executionStartedAt = at;
      if (row3.method === "CASH") next2.cashVoucherNumber = cashVoucherNumber(row3);
    }
    if (v.action === "RECORD_PAYOUT_EXECUTION") {
      if (row3.externalReference) return fail16("PAYOUT_EXECUTION_ALREADY_RECORDED");
      if (v.actualAmount !== amount4 || v.destinationConfirmed !== true) return fail16("PAYOUT_EXECUTION_PROOF_REQUIRED");
      const fee = v.executionFee ?? 0;
      if (!Number.isSafeInteger(fee) || fee < 0 || !Number.isSafeInteger(amount4 + fee) || row3.method === "CASH" && fee !== 0) return fail16("PAYOUT_EXECUTION_PROOF_REQUIRED");
      next2.executionFee = fee;
      next2.sourceDebited = amount4 + fee;
      next2.executionRecordedAt = at;
      if (row3.method === "CASH") {
        if (!cashboxCode(v.cashboxId) || v.externalReference !== void 0 || v.sourceAccount !== void 0) return fail16("PAYOUT_REGISTERED_CASHBOX_REQUIRED");
        const box = await get(cashboxKey(v.cashboxId));
        if (!box || box.kind !== "MERCHANT_CASHBOX" || box.status !== "ACTIVE" || box.code !== v.cashboxId || !Number.isSafeInteger(box.version)) return fail16("PAYOUT_CASHBOX_UNAVAILABLE");
        next2.sourceAccount = box.code;
        next2.externalReference = cashVoucherNumber(row3);
        next2.cashVoucherNumber = next2.externalReference;
        next2.cashbox = { code: box.code, name: box.name, custodian: box.custodian, location: box.location, version: box.version, custodianEmployeeId: box.custodianEmployeeId };
        const posting = await cashPayoutPosting(db, next2, a.actorId, at, false, v.cashboxOverrideReason);
        next2.cashLedgerJournalId = posting.journalId;
        ops.push(...posting.ops);
        ops.push(exactCheck(P2, cashboxKey(box.code), box), put2(P2, { ...cashMovementKey(next2), kind: "MERCHANT_CASH_DISBURSEMENT", schemaVersion: 1, version: 1, branchId: row3.branchId, payoutId: row3.payoutId, batchId: row3.batchId, batchDigest: row3.batchDigest, voucherNumber: next2.externalReference, cashbox: next2.cashbox, ownerId: row3.ownerId, recipientName: row3.recipientName, amount: row3.amount, status: "AWAITING_RECEIPT", executedBy: a.actorId, executedAt: at, updatedAt: at, retentionClass: "FINANCIAL_SETTLEMENT" }));
      } else {
        if (v.cashboxId !== void 0 || typeof v.externalReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$/.test(v.externalReference) || typeof v.sourceAccount !== "string" || !/^[A-Za-z][A-Za-z0-9._:/-]{2,79}$/.test(v.sourceAccount)) return fail16("PAYOUT_EXECUTION_PROOF_REQUIRED");
        next2.externalReference = v.externalReference.toUpperCase();
        next2.sourceAccount = v.sourceAccount.toUpperCase();
      }
      next2.executionRecordedBy = a.actorId;
      next2.executionRecordedAt = at;
      ops.push(put2(P2, { pk: "MERCHANT_PAYOUT_REFERENCE#" + quoteHash({ method: row3.method, source: row3.method === "CASH" ? next2.sourceAccount : "ZAIN_CASH", reference: next2.externalReference }), sk: "META", kind: "MERCHANT_PAYOUT_REFERENCE", branchId: v.branchId, payoutId: row3.payoutId, method: row3.method, externalReference: next2.externalReference, sourceAccount: next2.sourceAccount, createdAt: at, retentionClass: "FINANCIAL_SETTLEMENT" }));
    }
    if (v.action === "ACK_PAYOUT_RECEIPT") {
      if (v.accepted !== true || v.receivedAmount !== amount4) return fail16("PAYOUT_RECEIPT_AMOUNT_MISMATCH");
      next2.receiptOwnerId = row3.ownerId;
      next2.ownerReceiptAt = at;
      if (a.merchantIdentity) next2.receiptActor = { ...a.merchantIdentity, confirmedAt: at };
      else {
        const recipientKey = { pk: "PERSON#" + a.actorId, sk: "PROFILE" }, person = (await db.send(new import_lib_dynamodb8.GetCommand({ TableName: P2, Key: recipientKey, ConsistentRead: true, ProjectionExpression: "pk,sk,#name,#version", ExpressionAttributeNames: { "#name": "name", "#version": "version" } }))).Item;
        const name = person?.name || (!row3.requestActor || row3.requestActor.subjectId === a.actorId ? row3.recipientName : null);
        if (typeof name !== "string" || !name.trim()) return fail16("PAYOUT_RECIPIENT_PROFILE_REQUIRED");
        if (person) ops.push(exactCheck(P2, recipientKey, person));
        next2.receiptActor = { subjectId: a.actorId, name, role: "OWNER", roleLabel: "\u0645\u0627\u0644\u0643", businessId: v.branchId, businessName: a.businessName, ownerId: row3.ownerId, confirmedAt: at };
      }
    }
    if (v.action === "REPORT_PAYOUT_PROBLEM") {
      if (typeof v.reason !== "string" || v.reason.trim().length < 5 || v.reason.length > 300) return fail16("PAYOUT_REVIEW_REASON_REQUIRED");
      next2.reviewReason = v.reason.trim();
      next2.reviewRaisedAt = at;
    }
    if (v.action === "REOPEN_PAYOUT_RECEIPT") {
      if (!row3.externalReference || !row3.sourceAccount || typeof v.reason !== "string" || v.reason.trim().length < 5 || v.reason.length > 300) return fail16("PAYOUT_REVIEW_REASON_REQUIRED");
      next2.reviewResolution = v.reason.trim();
      next2.reviewResolvedBy = a.actorId;
      delete next2.ownerReceiptAt;
      delete next2.receiptOwnerId;
      delete next2.receiptActor;
    }
    if (v.action === "ACK_PAYOUT_NOT_RECEIVED") {
      if (v.accepted !== true || v.receivedAmount !== 0) return fail16("PAYOUT_NON_RECEIPT_REQUIRED");
      next2.nonReceiptOwnerId = row3.ownerId;
      if (a.merchantIdentity) next2.nonReceiptActor = a.merchantIdentity;
      next2.nonReceiptAt = at;
    }
    if (v.action === "RESOLVE_PAYOUT_NOT_PAID") {
      if (row3.nonReceiptOwnerId !== row3.ownerId || !row3.nonReceiptAt || v.confirmedNoDebit !== true || v.actualAmount !== 0 || typeof v.failureReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$/.test(v.failureReference) || typeof v.sourceAccount !== "string" || !/^[A-Za-z][A-Za-z0-9._:/-]{2,79}$/.test(v.sourceAccount) || row3.sourceAccount && row3.sourceAccount !== v.sourceAccount.toUpperCase() || typeof v.reason !== "string" || v.reason.trim().length < 5 || v.reason.length > 300) return fail16("PAYOUT_FINAL_FAILURE_PROOF_REQUIRED");
      next2.failureReference = v.failureReference.toUpperCase();
      next2.failureSource = v.sourceAccount.toUpperCase();
      next2.failureReason = v.reason.trim();
      next2.failureResolvedBy = a.actorId;
      next2.failureResolvedAt = at;
    }
    const claimKey = key3(v.branchId, "BATCH#" + row3.batchId), claim = await get(claimKey);
    if (!claim || claim.payoutId !== row3.payoutId || claim.status !== "ACTIVE") return fail16("PAYOUT_CLAIM_CHANGED");
    if (["CANCEL_PAYOUT", "RESOLVE_PAYOUT_NOT_PAID"].includes(v.action)) ops.push(put2(P2, { ...claim, status: next2.status }, claim));
    else if (v.action === "RECONCILE_PAYOUT") {
      if (row3.cashLedgerJournalId) {
        const proof = await verifyCashPayoutPosting(db, row3);
        if (proof) ops.push(exactCheck(P2, { pk: proof.pk, sk: proof.sk }, proof));
      }
      if (row3.receiptActor && (row3.receiptActor.ownerId !== row3.ownerId || row3.receiptActor.businessId !== v.branchId || !row3.receiptActor.subjectId || !row3.receiptActor.name || !row3.receiptActor.roleLabel)) return fail16("PAYOUT_RECEIPT_REQUIRED");
      if (row3.receiptOwnerId !== row3.ownerId || !row3.ownerReceiptAt || !row3.externalReference || !row3.sourceAccount) return fail16("PAYOUT_RECEIPT_REQUIRED");
      const b = await batch(v.branchId, row3.batchId);
      if (b.header.batchDigest !== row3.batchDigest || b.amount !== amount4) return fail16("PAYOUT_STATEMENT_CHANGED");
      const walletKey = { walletId: "WALLET#MERCHANT#" + v.branchId, sk: "META" }, w = await strongGet(db, W, walletKey);
      if (!w || w.ownerId !== v.branchId || w.ownerType !== "MERCHANT" || w.currency !== "IQD" || w.status !== "ACTIVE" || w.deletionRequestId != null || w.deletedAt != null || w.isDeleted === true || !Number.isSafeInteger(w.lockedBalance) || w.lockedBalance < amount4 || !Number.isSafeInteger(w.availableBalance) || w.availableBalance < 0 || !Number.isSafeInteger(w.version) || w.version < 1 || w.version >= Number.MAX_SAFE_INTEGER) return fail16("PAYOUT_LIABILITY_UNAVAILABLE");
      const orderLines = [];
      for (const line of b.lines) {
        const q = { orderId: line.orderId, sk: "MERCHANT_PAYABLE" }, payable = await strongGet(db, H, q);
        const value = toWholeIqdExact(readMoney(line.accrual.amounts.merchantNet));
        if (!payable || payable.status !== "LOCKED_PENDING_SETTLEMENT" || payable.branchId !== v.branchId || payable.amount !== value || payable.settlementBatchId !== row3.batchId || payable.settlementLineDigest !== line.lineDigest) return fail16("PAYOUT_PAYABLE_CHANGED");
        orderLines.push({ orderId: line.orderId, amount: value, lineDigest: line.lineDigest });
        ops.push(setFields(exactCheck(H, q, payable), { status: "PAID", paidPayoutId: row3.payoutId, paidAt: at }), exactCheck(P2, { pk: line.pk, sk: line.sk }, line));
      }
      if (orderLines.reduce((s, l) => s + l.amount, 0) !== amount4) return fail16("PAYOUT_TOTAL_MISMATCH");
      next2.paidAt = at;
      next2.reconciledBy = a.actorId;
      ops.push(setFields(exactCheck(W, walletKey, w, [...Object.keys(w), "deletionRequestId", "deletedAt", "isDeleted"]), { lockedBalance: w.lockedBalance - amount4, version: w.version + 1, updatedAt: at }), put2(P2, { ...claim, status: "PAID", paidAt: at }, claim), exactCheck(P2, { pk: b.header.pk, sk: b.header.sk }, b.header), exactCheck(P2, { pk: b.approval.pk, sk: b.approval.sk }, b.approval));
      const journal = seal2({ pk: "MERCHANT_PAYOUT_PAID#" + row3.payoutId, sk: "META", schemaVersion: 1, kind: "MERCHANT_PAYOUT_PAID_JOURNAL", status: "PAID", branchId: v.branchId, payoutId: row3.payoutId, batchId: row3.batchId, batchDigest: row3.batchDigest, ownerId: row3.ownerId, receiptOwnerId: row3.receiptOwnerId, ownerReceiptAt: row3.ownerReceiptAt, ...row3.receiptActor ? { receiptActor: row3.receiptActor } : {}, amount: row3.amount, method: row3.method, externalReference: row3.externalReference, sourceAccount: row3.sourceAccount, ...row3.cashbox ? { cashbox: row3.cashbox, cashVoucherNumber: row3.cashVoucherNumber } : {}, ...row3.cashLedgerJournalId ? { cashLedgerJournalId: row3.cashLedgerJournalId, executionRecordedAt: row3.executionRecordedAt } : {}, paidAt: at, reconciledBy: a.actorId, orderLines, executionFee: row3.executionFee ?? 0, debit: amount4 + (row3.executionFee || 0), credit: amount4 + (row3.executionFee || 0), lines: [{ account: "MERCHANT_PAYABLE", side: "DEBIT", amount: amount4 }, ...row3.executionFee ? [{ account: "PAYOUT_FEE_EXPENSE", side: "DEBIT", amount: row3.executionFee }] : [], { account: row3.method === "CASH" ? row3.cashLedgerJournalId ? "MERCHANT_DISBURSEMENT_CLEARING" : "CASH_DISBURSEMENT" : "ZAIN_CASH_DISBURSEMENT", side: "CREDIT", amount: amount4 + (row3.executionFee || 0) }], retentionClass: "FINANCIAL_SETTLEMENT" });
      ops.push(put2(P2, journal), put2(L, { walletId: w.walletId, sk: "ts#" + at + "#PAYOUT#" + row3.payoutId, transactionId: row3.payoutId, type: "DEBIT", category: "MERCHANT_PAYOUT_PAID", amount: -amount4, balanceBefore: w.lockedBalance, balanceAfter: w.lockedBalance - amount4, relatedEntityId: row3.payoutId, relatedEntityType: "MERCHANT_PAYOUT", createdAt: at, metadata: { branchId: v.branchId, payoutId: row3.payoutId, balanceType: "LOCKED", journalDigest: journal.digest } }));
    } else ops.push(exactCheck(P2, claimKey, claim));
    if (v.action === "RESOLVE_PAYOUT_NOT_PAID" && row3.cashLedgerJournalId) {
      const posting = await cashPayoutPosting(db, { ...row3, ...next2 }, a.actorId, at, true);
      next2.cashReturnJournalId = posting.journalId;
      ops.push(...posting.ops);
    }
    if (row3.method === "CASH" && row3.cashbox && row3.externalReference && ["ACK_PAYOUT_RECEIPT", "REPORT_PAYOUT_PROBLEM", "ACK_PAYOUT_NOT_RECEIVED", "REOPEN_PAYOUT_RECEIPT", "RESOLVE_PAYOUT_NOT_PAID", "RECONCILE_PAYOUT"].includes(v.action)) {
      const movement = await get(cashMovementKey(row3));
      if (!movement || movement.payoutId !== row3.payoutId || movement.voucherNumber !== row3.externalReference || !equal(movement.amount, row3.amount) || !equal(movement.cashbox, row3.cashbox)) return fail16("PAYOUT_CASHBOX_REGISTER_PROOF_INVALID");
      ops.push(put2(P2, { ...movement, status: next2.status, version: movement.version + 1, updatedAt: at, updatedBy: a.actorId, ...next2.paidAt ? { paidAt: next2.paidAt } : {}, ...next2.failureReference ? { failureReference: next2.failureReference, failureReason: next2.failureReason } : {} }, movement));
    }
    ops.push(put2(P2, next2, row3), put2(P2, { ...eventKey, kind: "MERCHANT_PAYOUT_EVENT", branchId: v.branchId, payoutId: row3.payoutId, actorId: a.actorId, action: v.action, ...a.merchantIdentity ? { merchantActor: a.merchantIdentity } : {}, requestDigest: eventDigest, from: row3.status, to: next2.status, createdAt: at, retentionClass: "FINANCIAL_SETTLEMENT" }), audit(v.branchId, row3.payoutId, a.actorId, v.action, v.requestId));
    try {
      await write(v.branchId, rule[2], a, ops, amount4 + (row3.executionFee || 0));
    } catch (e) {
      const committed = await get(eventKey);
      if (committed?.requestDigest === eventDigest && committed.actorId === a.actorId) {
        const saved = await get(k);
        if (!saved) return fail16("PAYOUT_OUTCOME_UNKNOWN_RETRY_SAME_REQUEST");
        return { payout: publicRow(saved), replayed: true };
      }
      throw e;
    }
    return { payout: publicRow(next2) };
  }
  async function cashboxAct(v) {
    if (Object.keys(v).sort().join(",") !== (v.action === "CREATE_CASHBOX" ? "action,branchId,code,custodianEmployeeId,location,name,reason,requestId,status" : "action,branchId,code,custodianEmployeeId,location,name,reason,requestId,status,version") || !uuid3(v.requestId)) return fail16("PAYOUT_CASHBOX_INVALID");
    const a = await context2(v.branchId, "APPROVE");
    const assigned = await cashboxCustodian(db, v.custodianEmployeeId);
    validateCashbox({ ...v, custodian: cashEmployeeName(assigned) });
    const k = cashboxKey(v.code), prior = await get(k), event = { pk: "MERCHANT_CASHBOX#" + v.code, sk: "EVENT#" + v.requestId }, digest = quoteHash(v), old = await get(event);
    if (old) {
      if (old.requestDigest !== digest || old.actorId !== a.actorId) return fail16("PAYOUT_REQUEST_ID_CONFLICT");
      return { cashbox: prior, replayed: true };
    }
    if (v.action === "CREATE_CASHBOX" ? !!prior : !prior || prior.version !== v.version) return fail16("PAYOUT_CASHBOX_CHANGED");
    if (prior && prior.custodianEmployeeId !== v.custodianEmployeeId && await get(cashBalanceKey(v.code))) return fail16("PAYOUT_CASH_HANDOVER_REQUIRED");
    const at = new Date(now()).toISOString(), box = { ...k, kind: "MERCHANT_CASHBOX", schemaVersion: 1, code: v.code, name: v.name.trim(), custodian: cashEmployeeName(assigned), custodianEmployeeId: assigned.employeeId, location: v.location.trim(), status: v.status, version: (prior?.version || 0) + 1, createdAt: prior?.createdAt || at, createdBy: prior?.createdBy || a.actorId, updatedAt: at, updatedBy: a.actorId, retentionClass: "FINANCIAL_SETTLEMENT" };
    await write(v.branchId, "APPROVE", a, [cashEmployeeGuard(assigned), put2(P2, box, prior || void 0), put2(P2, { ...event, kind: "MERCHANT_CASHBOX_EVENT", requestDigest: digest, actorId: a.actorId, action: v.action, reason: v.reason.trim(), before: prior || null, after: box, createdAt: at, retentionClass: "FINANCIAL_SETTLEMENT" }), audit(v.branchId, v.code, a.actorId, v.action, v.requestId)]);
    return { cashbox: box };
  }
  const accounting = createCashboxAccountingService({ db, now, authorize: context2, commit: (branch, action, a, ops, n) => write(branch, action, a, ops, n) });
  return {
    async merchantContext(v) {
      if (Object.keys(v).join(",") !== "branchId") return fail16("PAYOUT_INVALID_REQUEST");
      const a = await context2(v.branchId, "READ");
      if (!a.merchantStaff) return fail16("PAYOUT_PERMISSION_REQUIRED");
      const proof = await get(destinationKey(v.branchId, a.ownerId)), destination2 = proof?.status === "VERIFIED" && proof.ownerId === a.ownerId && proof.expiresAt > now() / 1e3 ? { proofId: proof.proofId, maskedPhone: masked(proof.phone) } : null;
      await context2(v.branchId, "READ");
      return { actor: a.merchantIdentity, can: { request: a.permissions?.includes("finance.payout.request") === true, receive: a.permissions?.includes("finance.payout.receive") === true }, methods: destination2 ? ["CASH", "ZAIN_CASH"] : ["CASH"], destination: destination2 };
    },
    cashAccount: accounting.account,
    cashList: accounting.list,
    cashCustodians: accounting.custodians,
    async cashboxes(v) {
      if (Object.keys(v).some((k) => !["branchId", "cursor"].includes(k))) return fail16("PAYOUT_INVALID_REQUEST");
      const a = await context2(v.branchId, "READ");
      if (a.owner || a.merchantStaff) return fail16("PAYOUT_PERMISSION_REQUIRED");
      let cursor;
      if (v.cursor) {
        try {
          cursor = JSON.parse(Buffer.from(v.cursor, "base64url").toString());
          if (cursor.pk !== cashboxDirectory || !/^BOX#[A-Z][A-Z0-9-]{2,39}$/.test(cursor.sk) || Object.keys(cursor).sort().join(",") !== "pk,sk") throw Error();
        } catch {
          return fail16("PAYOUT_INVALID_CURSOR");
        }
      }
      const out = await db.send(new import_lib_dynamodb8.QueryCommand({ TableName: P2, ConsistentRead: true, Limit: 25, KeyConditionExpression: "pk=:pk AND begins_with(sk,:prefix)", ExpressionAttributeValues: { ":pk": cashboxDirectory, ":prefix": "BOX#" }, ...cursor ? { ExclusiveStartKey: cursor } : {} }));
      if (!equal(a, await context2(v.branchId, "READ"))) return fail16("PAYOUT_AUTHORIZATION_CHANGED");
      return { items: out.Items || [], nextCursor: out.LastEvaluatedKey ? Buffer.from(JSON.stringify(out.LastEvaluatedKey)).toString("base64url") : null };
    },
    async cashboxRegister(v) {
      if (Object.keys(v).some((k) => !["branchId", "code", "cursor"].includes(k)) || !cashboxCode(v.code)) return fail16("PAYOUT_INVALID_REQUEST");
      const a = await context2(v.branchId, "READ");
      if (a.owner || a.merchantStaff) return fail16("PAYOUT_PERMISSION_REQUIRED");
      const box = await get(cashboxKey(v.code));
      if (!box) return fail16("PAYOUT_CASHBOX_UNAVAILABLE");
      let cursor;
      if (v.cursor) {
        try {
          cursor = JSON.parse(Buffer.from(v.cursor, "base64url").toString());
          if (cursor.pk !== "MERCHANT_CASHBOX#" + v.code || typeof cursor.sk !== "string" || !cursor.sk.startsWith("VOUCHER#") || cursor.sk.length > 150 || Object.keys(cursor).sort().join(",") !== "pk,sk") throw Error();
        } catch {
          return fail16("PAYOUT_INVALID_CURSOR");
        }
      }
      const out = await db.send(new import_lib_dynamodb8.QueryCommand({ TableName: P2, ConsistentRead: true, Limit: 25, ScanIndexForward: false, KeyConditionExpression: "pk=:pk AND begins_with(sk,:prefix)", ExpressionAttributeValues: { ":pk": "MERCHANT_CASHBOX#" + v.code, ":prefix": "VOUCHER#" }, ...cursor ? { ExclusiveStartKey: cursor } : {} }));
      if (!equal(a, await context2(v.branchId, "READ"))) return fail16("PAYOUT_AUTHORIZATION_CHANGED");
      return { cashbox: box, items: out.Items || [], coverage: "CURRENT_PAGE_MERCHANT_DISBURSEMENTS_ONLY", generatedAt: new Date(now()).toISOString(), nextCursor: out.LastEvaluatedKey ? Buffer.from(JSON.stringify(out.LastEvaluatedKey)).toString("base64url") : null };
    },
    async account(v) {
      const before = await context2(v?.branchId, "READ");
      if (!options.readAccount) return fail16("PAYOUT_ACCOUNT_UNAVAILABLE");
      const result = await options.readAccount(v);
      if (!equal(before, await context2(v.branchId, "READ"))) return fail16("PAYOUT_AUTHORIZATION_CHANGED");
      return result;
    },
    async list(v) {
      if (Object.keys(v).some((k) => !["branchId", "cursor"].includes(k))) return fail16("PAYOUT_INVALID_REQUEST");
      await context2(v.branchId, "READ");
      let cursor;
      if (v.cursor) {
        try {
          const c = JSON.parse(Buffer.from(v.cursor, "base64url").toString());
          if (c.pk !== pk(v.branchId) || !/^MPO:[a-f0-9]{48}$/.test(c.sk) || Object.keys(c).sort().join(",") !== "pk,sk") return fail16("PAYOUT_INVALID_CURSOR");
          cursor = c;
        } catch {
          return fail16("PAYOUT_INVALID_CURSOR");
        }
      }
      const q = await db.send(new import_lib_dynamodb8.QueryCommand({ TableName: P2, ConsistentRead: true, KeyConditionExpression: "pk=:pk AND begins_with(sk,:prefix)", ExpressionAttributeValues: { ":pk": pk(v.branchId), ":prefix": "MPO:" }, ScanIndexForward: false, Limit: 20, ...cursor ? { ExclusiveStartKey: cursor } : {} }));
      const after = await context2(v.branchId, "READ");
      for (const row3 of q.Items || []) await verifyPaidPayout(row3, after.ownerId);
      await context2(v.branchId, "READ");
      return { items: (q.Items || []).map(publicRow), nextCursor: q.LastEvaluatedKey ? Buffer.from(JSON.stringify(q.LastEvaluatedKey)).toString("base64url") : null };
    },
    async statement(v) {
      if (!v || Object.keys(v).sort().join(",") !== "batchId,branchId" || !/^MSB:[a-f0-9]{48}$/.test(v.batchId || "")) return fail16("PAYOUT_INVALID_REQUEST");
      const before = await context2(v.branchId, "READ"), saved = await options.readBatch(v.branchId, v.batchId);
      const approval = await readMerchantStatementApproval(db, v.branchId, v.batchId, saved.header.batchDigest);
      const fields2 = ["merchantExceptionCompensation", "goodsGross", "merchantFundedDiscount", "platformFundedDiscount", "merchantGoodsEntitlement", "merchantCommission", "merchantOtherCharges", "merchantDeliverySupport", "merchantNet"];
      const amounts = (row3) => Object.fromEntries(fields2.filter((k) => row3[k] !== void 0).map((k) => [k, row3[k]]));
      const claim = await readMerchantStatementPayment(db, saved, before.ownerId);
      if (!equal(before, await context2(v.branchId, "READ"))) return fail16("PAYOUT_AUTHORIZATION_CHANGED");
      const printLines = [];
      for (const line of saved.lines) {
        const order = (await db.send(new import_lib_dynamodb8.GetCommand({ TableName: "WizzOrders", Key: { PK: "ORDER#" + line.orderId, SK: "META" }, ConsistentRead: true, ProjectionExpression: "orderId,orderNumber" }))).Item;
        printLines.push({ orderId: line.orderId, orderNumber: order && order.orderId === line.orderId && typeof order.orderNumber === "string" ? order.orderNumber : null, ...line.accrual.schemaVersion === 5 ? { sourceKind: line.accrual.kind } : {}, deliveredAt: line.accrual.deliveredAt, amounts: amounts(line.accrual.amounts) });
      }
      if (!equal(before, await context2(v.branchId, "READ"))) return fail16("PAYOUT_AUTHORIZATION_CHANGED");
      return {
        branchId: v.branchId,
        batchId: v.batchId,
        batchDigest: saved.header.batchDigest,
        period: saved.header.period,
        createdAt: saved.header.createdAt,
        approved: !!approval,
        paymentStatus: claim?.status === "PAID" ? "PAID" : "UNPAID",
        payoutId: claim?.payoutId || null,
        summary: { accrualCount: saved.header.summary.accrualCount, amounts: amounts(saved.header.summary.amounts) },
        lines: printLines,
        coverage: "COMPLETE_SAVED_STATEMENT",
        timeZone: "Asia/Baghdad",
        generatedAt: new Date(now()).toISOString(),
        walletMutationPerformed: false
      };
    },
    async statements(branchId, cursor) {
      const before = await context2(branchId, "READ"), result = await options.listBatches(branchId, cursor), items = [];
      for (const h of result.items || []) {
        const a = await readMerchantStatementApproval(db, branchId, h.batchId, h.batchDigest);
        let claim = await get(key3(branchId, "BATCH#" + h.batchId));
        if (claim?.status === "PAID") claim = await readMerchantStatementPayment(db, await options.readBatch(branchId, h.batchId), before.ownerId);
        items.push({ ...h, approved: !!a, payoutStatus: claim?.status || null, payoutId: claim?.payoutId || null });
      }
      if (!equal(before, await context2(branchId, "READ"))) return fail16("PAYOUT_AUTHORIZATION_CHANGED");
      return { ...result, items };
    },
    async details(v) {
      if (!/^MPO:[a-f0-9]{48}$/.test(v.payoutId || "") || Object.keys(v).sort().join(",") !== "branchId,payoutId") return fail16("PAYOUT_INVALID_REQUEST");
      const a = await context2(v.branchId, "READ"), r = await get(key3(v.branchId, v.payoutId));
      if (!r || r.ownerId !== a.ownerId) return fail16("PAYOUT_UNAVAILABLE");
      await verifyPaidPayout(r, a.ownerId);
      const result = { payout: publicRow(r), generatedAt: new Date(now()).toISOString(), timeZone: "Asia/Baghdad" };
      if (!a.owner && !a.merchantStaff) {
        const personName = async (id3) => {
          if (!id3) return null;
          if (id3 === r.cashbox?.custodianEmployeeId) return r.cashbox.custodian;
          const person = await strongGet(db, "staging-PlatformStaff", { pk: "EMPLOYEE#" + id3, sk: "PROFILE" });
          const name = person?.fullName || person?.displayName || person?.name;
          return typeof name === "string" && !name.includes("@") ? name : null;
        };
        const cash = r.cashLedgerJournalId ? await verifyCashPayoutPosting(db, r) : null, recipientBranch = await strongGet(db, B2, { businessId: v.branchId });
        if (!recipientBranch || recipientBranch.ownerId !== r.ownerId || recipientBranch?.cognitoUserId !== r.ownerId || r.ownerReceiptAt && r.receiptOwnerId !== r.ownerId) return fail16("PAYOUT_PAID_PROOF_INVALID");
        const recipientIdentity = { name: r.receiptActor?.name || r.recipientName || null, role: r.receiptActor?.role || "OWNER", roleLabel: r.receiptActor?.roleLabel || "\u0645\u0627\u0644\u0643", businessName: r.receiptActor?.businessName || recipientBranch.businessName || recipientBranch.name || null, identityBasis: r.receiptActor && r.receiptActor.role !== "OWNER" ? "VERIFIED_STAFF_RECEIPT" : r.ownerReceiptAt ? "VERIFIED_OWNER_RECEIPT" : "VERIFIED_OWNER_REQUEST" };
        result.printIdentity = { recipientIdentity, reference: r.method === "CASH" ? r.cashVoucherNumber || cashVoucherNumber(r) : "PSR-" + r.payoutId.slice(4).toUpperCase(), executionRecordedName: await personName(r.executionRecordedBy), reconciledName: await personName(r.reconciledBy), nameBasis: "CUSTODY_SNAPSHOT_OR_CURRENT_STAFF_PROFILE", ...cash ? { cashBeforeIqd: cash.balanceBeforeIqd, cashAfterIqd: cash.balanceAfterIqd } : {} };
      }
      if (!a.owner && !a.merchantStaff && r.method === "ZAIN_CASH" && ["PROCESSING", "AWAITING_RECEIPT", "RECEIPT_CONFIRMED", "RECONCILIATION_REQUIRED"].includes(r.status)) {
        await context2(v.branchId, "STAFF", toWholeIqdExact(readMoney(r.amount)));
        const privateRow = await get(key3(v.branchId, "PRIVATE#" + r.payoutId));
        if (!privateRow || privateRow.ownerId !== r.ownerId || privateRow.payoutId !== r.payoutId) return fail16("PAYOUT_DESTINATION_UNAVAILABLE");
        result.executionDestination = privateRow.phone;
      }
      await context2(v.branchId, "READ");
      return result;
    },
    async act(v) {
      if (v && ["REQUEST_CASH_OPERATION", "POST_CASH_OPERATION", "CANCEL_CASH_OPERATION"].includes(v.action)) return accounting.act(v);
      if (v && ["CREATE_CASHBOX", "UPDATE_CASHBOX"].includes(v.action)) return cashboxAct(v);
      if (!v || typeof v !== "object" || Array.isArray(v)) return fail16("PAYOUT_INVALID_REQUEST");
      if (v.action === "REQUEST_PAYOUT") return request(v);
      if (["START_PAYOUT_DESTINATION", "VERIFY_PAYOUT_DESTINATION"].includes(v.action)) return destination(v);
      return transition(v);
    }
  };
}

// backend/wallet-service/src/merchantSettlementPreview.ts
var fail17 = (code = "MERCHANT_SETTLEMENT_PREVIEW_UNAVAILABLE") => {
  throw Object.assign(Error(code), { code });
};
async function readMerchantAccrualEvidence(db, branchId, orderId) { return require("./cash-adjudication-read-278.js").readMerchantAccrualEvidence(db,branchId,orderId); }
function assembleMerchantSettlementPreview(branchId, period, accruals) {
  for (const accrual of accruals) {
    if (accrual.deliveredAt < period.fromUtc || accrual.deliveredAt >= period.untilExclusiveUtc) return fail17("MERCHANT_ACCRUAL_OUTSIDE_PERIOD");
  }
  const summary = summarizeMerchantAccruals(branchId, accruals);
  const content = {
    schemaVersion: 1,
    kind: "MERCHANT_SETTLEMENT_SELECTION_PREVIEW",
    branchId,
    period,
    accruals,
    summary,
    coverage: "EXPLICIT_ORDER_SELECTION_ONLY",
    consistency: "STRONG_ITEM_READS_NOT_ATOMIC_ACCOUNTING_SNAPSHOT",
    canReserve: false,
    canPay: false,
    walletMutationPerformed: false
  };
  return { ...content, previewId: "MSV:" + quoteHash(content).slice(0, 48) };
}

// backend/wallet-service/src/merchantOffCyclePeriod.ts
var fail18 = () => {
  throw Object.assign(Error("SETTLEMENT_OFF_CYCLE_INVALID"), { code: "SETTLEMENT_OFF_CYCLE_INVALID" });
};
function merchantOffCyclePeriod(schedule, fromLocalDate, throughLocalDate, cutoffUtc, reason) {
  if (typeof cutoffUtc !== "string" || !Number.isFinite(Date.parse(cutoffUtc)) || new Date(cutoffUtc).toISOString() !== cutoffUtc || typeof reason !== "string" || reason.trim().length < 10 || reason.length > 1e3) return fail18();
  const day3 = (v) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + "T00:00:00.000Z")) || (/* @__PURE__ */ new Date(v + "T00:00:00.000Z")).toISOString().slice(0, 10) !== v || v < "2000-01-01") return fail18();
    return Date.parse(v + "T00:00:00.000Z");
  };
  const from = day3(fromLocalDate), through = day3(throughLocalDate), today = new Date(Date.parse(cutoffUtc) + 108e5).toISOString().slice(0, 10);
  if (from > through || through - from > 365 * 864e5 || throughLocalDate > today) return fail18();
  merchantSettlementPeriod(schedule, cutoffUtc);
  const fromUtc = new Date(from - 108e5).toISOString(), requestedUntilUtc = new Date(through + 864e5 - 108e5).toISOString(), untilExclusiveUtc = requestedUntilUtc < cutoffUtc ? requestedUntilUtc : cutoffUtc;
  if (fromUtc >= untilExclusiveUtc) return fail18();
  const content = { schemaVersion: 1, kind: "MERCHANT_OFF_CYCLE_PERIOD", scheduleVersion: schedule.version, scheduleDigest: quoteHash(schedule), schedule, timezone: "Asia/Baghdad", startLocalDate: fromLocalDate, throughLocalDate, endExclusiveLocalDate: new Date(through + 864e5).toISOString().slice(0, 10), fromUtc, untilExclusiveUtc, cutoffUtc, requestedUntilUtc, reason: reason.trim(), boundaryRule: "START_INCLUSIVE_END_EXCLUSIVE", cutoffRule: "SERVER_SNAPSHOT_NO_FUTURE_ACCRUALS", recurringScheduleChanged: false };
  return { ...content, periodId: "MOF:" + quoteHash(content).slice(0, 48) };
}

// backend/wallet-service/src/merchantOpeningPeriod.ts
function merchantOpeningPeriod(schedule, fromLocalDate, cutoffUtc) {
  const cutoff = cutoffUtc ?? new Date(Date.parse(schedule.anchorLocalDate + "T00:00:00.000Z") - 108e5).toISOString();
  const anchor = merchantSettlementPeriod(schedule, cutoff);
  if (anchor.fromUtc !== cutoff) throw Error("INVALID_MERCHANT_OPENING_PERIOD");
  if (typeof fromLocalDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fromLocalDate) || fromLocalDate < "2000-01-01" || fromLocalDate >= anchor.startLocalDate) throw Error("INVALID_MERCHANT_OPENING_PERIOD");
  const probe = merchantSettlementPeriod({ ...schedule, anchorLocalDate: fromLocalDate, frequency: "WEEKLY" }, new Date(Date.parse(fromLocalDate + "T00:00:00.000Z") - 108e5).toISOString());
  if (probe.startLocalDate !== fromLocalDate) throw Error("INVALID_MERCHANT_OPENING_PERIOD");
  const content = { schemaVersion: 1, kind: "MERCHANT_OPENING_PERIOD", scheduleVersion: schedule.version, scheduleDigest: quoteHash(schedule), schedule, timezone: "Asia/Baghdad", startLocalDate: fromLocalDate, endExclusiveLocalDate: anchor.startLocalDate, fromUtc: probe.fromUtc, untilExclusiveUtc: anchor.fromUtc, boundaryRule: "START_INCLUSIVE_END_EXCLUSIVE" };
  return { ...content, periodId: "MOP:" + quoteHash(content).slice(0, 48) };
}

// backend/wallet-service/src/merchantSettlementBatch.ts
var import_lib_dynamodb10 = require("@aws-sdk/lib-dynamodb");
var T3 = {
  records: "staging-MerchantPlatform",
  holds: "staging-Holds",
  orders: "WizzOrders",
  offers: "WaveOffers_staging",
  branches: "WhizzMerchants_Businesses",
  deletion: "staging-AccountDeletion",
  audit: "staging-AuditLog"
};
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
var BATCH = /^MSB:[a-f0-9]{48}$/;
var PREVIEW = /^MSV:[a-f0-9]{48}$/;
var claims = ["settlementBatchId", "settlementLineDigest", "settlementClaimedAt"];
var orderFields = [
  "PK",
  "SK",
  "orderId",
  "storeId",
  "businessId",
  "merchantId",
  "driverId",
  "status",
  "orderStatus",
  "cashCollected",
  "cashCollectedAmount",
  "deliveredAt",
  "financialSnapshot",
  "financialAcceptance",
  "financialOutcome",
  "commercialPricing",
  "assignmentWaveNumber",
  "assignmentAttemptCounter",
  "returnStatus",
  "returnCaseId",
  "cancellationStatus",
  "cancellationRequestId",
  "deletedAt",
  "deletionRequestId",
  "deletionStatus",
  "isDeleted",
  "rev",
  "revision",
  "version"
];
var MerchantSettlementBatchError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "MerchantSettlementBatchError";
  }
};
var fail19 = (code = "MERCHANT_SETTLEMENT_BATCH_UNAVAILABLE") => {
  throw new MerchantSettlementBatchError(code);
};
var same5 = (a, b) => quoteCanonical(a) === quoteCanonical(b);
function instant3(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return fail19("INVALID_SETTLEMENT_TIME");
  return value;
}
function scheduleKey(branchId) {
  return { pk: "BRANCH#" + branchId, sk: "SETTLEMENT_SCHEDULE#CURRENT" };
}
function partition(branchId) {
  return "MERCHANT_SETTLEMENT#" + branchId;
}
function batchKey(branchId, batchId, createdAt) {
  return { pk: partition(branchId), sk: "BATCH#" + createdAt + "#" + batchId };
}
function lookupKey(branchId, batchId) {
  return { pk: partition(branchId), sk: "INDEX#" + batchId };
}
function lineKey(branchId, batchId, orderId) {
  return { pk: partition(branchId), sk: "LINE#" + batchId + "#" + orderId };
}
function markerKey(branchId, requestId) {
  return { pk: "BRANCH#" + branchId, sk: "SETTLEMENT_REQUEST#" + requestId };
}
function absent2(TableName, Key, field) {
  return { Put: { TableName, Item: Key, ConditionExpression: `attribute_not_exists(${field})` } };
}
function guardValid(guard) {
  const g = guard?.ConditionCheck;
  return g && Object.keys(guard).length === 1 && [T3.records, "staging-PlatformStaff", T3.branches, T3.deletion].includes(g.TableName) && g.Key && Object.keys(g.Key).length > 0 && typeof g.ConditionExpression === "string" && g.ConditionExpression.length > 0;
}
function uniqueOperations(operations) {
  const seen = /* @__PURE__ */ new Set();
  for (const op of operations) {
    const value = op.ConditionCheck || op.Update || op.Put;
    if (!value) return fail19("INVALID_SETTLEMENT_TRANSACTION");
    const key4 = op.Put ? value.TableName === T3.audit ? { datePartition: value.Item.datePartition, sk: value.Item.sk } : { pk: value.Item.pk, sk: value.Item.sk } : value.Key;
    const identity = quoteCanonical([value.TableName, key4]);
    if (seen.has(identity)) return fail19("DUPLICATE_SETTLEMENT_GUARD_TARGET");
    seen.add(identity);
  }
  if (operations.length > 100 || Buffer.byteLength(JSON.stringify(operations)) > 2 * 1024 * 1024) return fail19("SETTLEMENT_TRANSACTION_TOO_LARGE");
}
function createMerchantSettlementBatchService(options) {
  const { db } = options;
  const now = options.now || Date.now;
  async function authority(branchId, action) {
    const a = detach(await options.authorizeBranch(branchId, action));
    if (!a || a.branchId !== branchId || !quoteEntityIdValid(a.actorId) || !Array.isArray(a.guards) || !a.guards.length || a.guards.length > 12 || a.guards.some((g) => !guardValid(g))) return fail19("SETTLEMENT_AUTHORIZATION_REQUIRED");
    return a;
  }
  async function stored2(branchId, batchId) {
    const lookup = await strongGet(db, T3.records, lookupKey(branchId, batchId));
    if (!lookup) return fail19("SETTLEMENT_BATCH_NOT_FOUND");
    if (lookup.kind !== "MERCHANT_SETTLEMENT_LOOKUP" || lookup.schemaVersion !== 1 || lookup.branchId !== branchId || lookup.batchId !== batchId || !same5(batchKey(branchId, batchId, instant3(lookup.createdAt)), { pk: lookup.pk, sk: lookup.headerSk })) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
    const key4 = { pk: lookup.pk, sk: lookup.headerSk }, header = await strongGet(db, T3.records, key4);
    if (!header) return fail19("SETTLEMENT_BATCH_NOT_FOUND");
    validateHeader(branchId, header);
    if (header.batchId !== batchId || header.batchDigest !== lookup.batchDigest) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
    const lines = [], seen = /* @__PURE__ */ new Set();
    for (const reference2 of header.lineDigests) {
      if (!quoteEntityIdValid(reference2.orderId) || seen.has(reference2.orderId)) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
      seen.add(reference2.orderId);
      const expectedKey = lineKey(branchId, batchId, reference2.orderId);
      const line = await strongGet(db, T3.records, expectedKey);
      if (!line) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
      const { pk: linePk, sk: lineSk, lineDigest, ...lineContent } = line;
      if (linePk !== expectedKey.pk || lineSk !== expectedKey.sk || line.kind !== "MERCHANT_SETTLEMENT_LINE" || line.schemaVersion !== 1 || line.batchId !== batchId || line.branchId !== branchId || line.orderId !== reference2.orderId || line.accrual?.orderId !== line.orderId || line.accrual?.branchId !== branchId || lineDigest !== reference2.digest || quoteHash(lineContent) !== lineDigest) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
      lines.push(line);
    }
    if (!same5(summarizeMerchantAccruals(branchId, lines.map((l) => l.accrual)), header.summary)) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
    return { header, lines };
  }
  function validateHeader(branchId, header) {
    const { pk: pk3, sk, batchDigest, ...content } = header;
    const period = header.period;
    if (!BATCH.test(header.batchId || "") || !same5({ pk: pk3, sk }, batchKey(branchId, header.batchId, instant3(header.createdAt))) || header.kind !== "MERCHANT_SETTLEMENT_BATCH" || header.schemaVersion !== 1 || header.branchId !== branchId || header.status !== "FROZEN_PENDING_REVIEW" || header.payoutAuthorized !== false || header.walletMutationPerformed !== false || !UUID.test(header.requestId || "") || header.batchId !== "MSB:" + quoteHash({ branchId, requestId: header.requestId }).slice(0, 48) || !quoteEntityIdValid(header.createdBy) || !PREVIEW.test(header.previewId || "") || header.coverage !== "EXPLICIT_ORDER_SELECTION_ONLY" || quoteHash(content) !== batchDigest || !Array.isArray(header.lineDigests) || !header.lineDigests.length || header.lineDigests.length > 15 || header.lineCount !== header.lineDigests.length || !period || header.createdAt < period.untilExclusiveUtc || period.kind === "MERCHANT_OFF_CYCLE_PERIOD" && header.createdAt < period.cutoffUtc || header.summary?.accrualCount !== header.lineCount || header.summary?.branchId !== branchId) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
    const expectedPeriod = period.kind === "MERCHANT_OFF_CYCLE_PERIOD" ? merchantOffCyclePeriod(period.schedule, period.startLocalDate, period.throughLocalDate, period.cutoffUtc, period.reason) : period.kind === "MERCHANT_OPENING_PERIOD" ? merchantOpeningPeriod(period.schedule, period.startLocalDate, period.untilExclusiveUtc) : merchantSettlementPeriod({
      schemaVersion: 1,
      version: period.scheduleVersion,
      timezone: period.timezone,
      frequency: period.frequency,
      anchorLocalDate: period.anchorLocalDate
    }, period.fromUtc);
    if (!same5(period, expectedPeriod)) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
    const seen = /* @__PURE__ */ new Set();
    for (const line of header.lineDigests) {
      if (!quoteEntityIdValid(line.orderId) || !/^[a-f0-9]{64}$/.test(line.digest || "") || seen.has(line.orderId)) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
      seen.add(line.orderId);
    }
  }
  async function replay(request, hash, actor) {
    const row3 = await strongGet(db, T3.records, markerKey(request.branchId, request.requestId));
    if (!row3) return null;
    if (row3.kind !== "MERCHANT_SETTLEMENT_REQUEST" || row3.schemaVersion !== 1 || row3.status !== "COMMITTED" || row3.branchId !== request.branchId || row3.requestId !== request.requestId || row3.requestHash !== hash || row3.actorId !== actor.actorId || row3.batchId !== "MSB:" + quoteHash({ branchId: request.branchId, requestId: request.requestId }).slice(0, 48)) return fail19("SETTLEMENT_REQUEST_CONFLICT");
    const saved = await stored2(request.branchId, row3.batchId);
    if (saved.header.batchDigest !== row3.batchDigest || saved.header.requestHash !== hash || saved.header.createdBy !== actor.actorId) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
    const current = await authority(request.branchId, "CREATE");
    if (current.actorId !== actor.actorId) return fail19("SETTLEMENT_AUTHORIZATION_CHANGED");
    return { ...saved, replayed: true };
  }
  return Object.freeze({
    async create(value) {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== (value.kind === "OFF_CYCLE" ? "at,branchId,fromLocalDate,kind,orderIds,previewId,reason,requestId,throughLocalDate" : value.kind === "OPENING" ? "at,branchId,fromLocalDate,kind,orderIds,previewId,requestId" : "at,branchId,orderIds,previewId,requestId")) return fail19("INVALID_SETTLEMENT_BATCH_REQUEST");
      const request = detach(value);
      if (!quoteEntityIdValid(request.branchId) || !UUID.test(request.requestId || "") || !PREVIEW.test(request.previewId || "") || !Array.isArray(request.orderIds) || !request.orderIds.length || request.orderIds.length > 15 || request.orderIds.some((v) => !quoteEntityIdValid(v)) || new Set(request.orderIds).size !== request.orderIds.length) return fail19("INVALID_SETTLEMENT_BATCH_REQUEST");
      instant3(request.at);
      request.orderIds.sort();
      const requestHash = quoteHash(request), actor = await authority(request.branchId, "CREATE");
      const prior = await replay(request, requestHash, actor);
      if (prior) return prior;
      const opening = request.kind === "OPENING";
      const schedule = detach(await (opening ? options.readOpeningSchedule?.(request.branchId) : options.readSchedule(request.branchId, request.at)));
      if (!schedule || !guardValid(schedule.guard) || schedule.guard.ConditionCheck.TableName !== T3.records || !same5(schedule.guard.ConditionCheck.Key, scheduleKey(request.branchId)) || schedule.guards !== void 0 && (!Array.isArray(schedule.guards) || schedule.guards.length > 4 || schedule.guards.some((g) => !guardValid(g)))) return fail19("SETTLEMENT_SCHEDULE_GUARD_REQUIRED");
      const period = request.kind === "OFF_CYCLE" ? merchantOffCyclePeriod(schedule.schedule, request.fromLocalDate, request.throughLocalDate, request.at, request.reason) : opening ? merchantOpeningPeriod(schedule.schedule, request.fromLocalDate, schedule.openingCutoff) : merchantSettlementPeriod(schedule.schedule, request.at);
      if (opening && request.at !== period.untilExclusiveUtc) return fail19("INVALID_SETTLEMENT_BATCH_REQUEST");
      const timestamp2 = instant3(new Date(now()).toISOString());
      if (request.kind === "OFF_CYCLE" && timestamp2 < request.at) return fail19("SETTLEMENT_OFF_CYCLE_INVALID");
      if (timestamp2 < period.untilExclusiveUtc) return fail19("SETTLEMENT_PERIOD_STILL_OPEN");
      const branch = await strongGet(db, T3.branches, { businessId: request.branchId });
      if (!branch || !quoteEntityIdValid(branch.ownerId) || branch.cognitoUserId !== branch.ownerId || branch.status !== "approved" || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail19("SETTLEMENT_BRANCH_UNAVAILABLE");
      const evidence = [];
      for (const orderId of request.orderIds) {
        const source = await readMerchantAccrualEvidence(db, request.branchId, orderId);
        if (claims.some((k) => Object.prototype.hasOwnProperty.call(source.payable, k))) return fail19("MERCHANT_PAYABLE_ALREADY_IN_SETTLEMENT");
        if (schedule.agreementBinding && !same5(source.accrual.agreement, schedule.agreementBinding)) return fail19("SETTLEMENT_AGREEMENT_SCHEDULE_MISMATCH");
        if (source.order.merchantId !== branch.organizationId) return fail19("SETTLEMENT_BRANCH_UNAVAILABLE");
        evidence.push(source);
      }
      const preview = assembleMerchantSettlementPreview(request.branchId, period, evidence.map((e) => e.accrual));
      if (preview.previewId !== request.previewId) return fail19("SETTLEMENT_PREVIEW_CHANGED");
      const batchId = "MSB:" + quoteHash({ branchId: request.branchId, requestId: request.requestId }).slice(0, 48);
      const key4 = batchKey(request.branchId, batchId, timestamp2);
      const lines = evidence.map((source) => {
        const line = {
          schemaVersion: 1,
          kind: "MERCHANT_SETTLEMENT_LINE",
          batchId,
          branchId: request.branchId,
          orderId: source.accrual.orderId,
          accrual: source.accrual
        };
        return { ...lineKey(request.branchId, batchId, line.orderId), ...line, lineDigest: quoteHash(line) };
      });
      const content = {
        schemaVersion: 1,
        kind: "MERCHANT_SETTLEMENT_BATCH",
        batchId,
        branchId: request.branchId,
        requestId: request.requestId,
        requestHash,
        previewId: preview.previewId,
        period,
        summary: preview.summary,
        lineCount: lines.length,
        lineDigests: lines.map((l) => ({ orderId: l.orderId, digest: l.lineDigest })),
        status: "FROZEN_PENDING_REVIEW",
        coverage: "EXPLICIT_ORDER_SELECTION_ONLY",
        createdAt: timestamp2,
        createdBy: actor.actorId,
        payoutAuthorized: false,
        walletMutationPerformed: false,
        retentionClass: "FINANCIAL_SETTLEMENT"
      };
      const header = { ...key4, ...content, batchDigest: quoteHash(content) };
      const operations = [
        ...actor.guards,
        schedule.guard,
        ...schedule.guards || [],
        exactCheck(
          T3.branches,
          { businessId: request.branchId },
          branch,
          ["businessId", "ownerId", "cognitoUserId", "organizationId", "status", "deletionRequestId", "deletedAt", "isDeleted"]
        )
      ];
      for (const pk3 of ["BUSINESS_LIFECYCLE#MERCHANT#" + request.branchId, "ACCOUNT_LIFECYCLE#MERCHANT#" + branch.ownerId]) {
        operations.push({ ConditionCheck: { TableName: T3.deletion, Key: { pk: pk3, sk: "META" }, ConditionExpression: "attribute_not_exists(pk)" } });
      }
      for (const [index, source] of evidence.entries()) {
        const orderId = source.accrual.orderId;
        if(source.cashAdjudicationJournal)operations.push(exactCheck(T3.holds,{orderId,sk:"CASH_ADJUDICATION_JOURNAL"},source.cashAdjudicationJournal));
        if (source.accountingJournal) operations.push(exactCheck(T3.records, { pk: "FULL_CASH_JOURNAL#" + orderId, sk: "META" }, source.accountingJournal));
        operations.push(
          exactCheck(T3.orders, { PK: "ORDER#" + orderId, SK: "META" }, source.order, orderFields),
          exactCheck(T3.offers, { orderId, SK: `FINANCIAL#${source.order.driverId}#WAVE#${source.order.assignmentWaveNumber}` }, source.acceptedOffer),
          exactCheck(T3.holds, source.outcomeKey, source.outcome),
          updateChecked(
            exactCheck(T3.holds, { orderId, sk: "MERCHANT_PAYABLE" }, source.payable, [...Object.keys(source.payable), ...claims]),
            "SET #batch=:batch,#line=:line,#claimed=:claimed",
            { "#batch": "settlementBatchId", "#line": "settlementLineDigest", "#claimed": "settlementClaimedAt" },
            { ":batch": batchId, ":line": lines[index].lineDigest, ":claimed": timestamp2 }
          ),
          { Put: { ...absent2(T3.records, lines[index], "pk").Put } }
        );
      }
      operations.push(
        { Put: { ...absent2(T3.records, header, "pk").Put } },
        { Put: { ...absent2(T3.records, {
          ...lookupKey(request.branchId, batchId),
          kind: "MERCHANT_SETTLEMENT_LOOKUP",
          schemaVersion: 1,
          branchId: request.branchId,
          batchId,
          headerSk: header.sk,
          batchDigest: header.batchDigest,
          createdAt: timestamp2,
          retentionClass: "FINANCIAL_SETTLEMENT"
        }, "pk").Put } },
        { Put: { ...absent2(T3.records, {
          ...markerKey(request.branchId, request.requestId),
          schemaVersion: 1,
          kind: "MERCHANT_SETTLEMENT_REQUEST",
          status: "COMMITTED",
          requestId: request.requestId,
          branchId: request.branchId,
          actorId: actor.actorId,
          requestHash,
          batchId,
          batchDigest: header.batchDigest,
          createdAt: timestamp2,
          retentionClass: "FINANCIAL_SETTLEMENT"
        }, "pk").Put } },
        { Put: { TableName: T3.audit, Item: {
          datePartition: "date#" + timestamp2.slice(0, 10).replace(/-/g, ""),
          sk: timestamp2 + "#" + batchId + "#MERCHANT_SETTLEMENT_FROZEN",
          action: "MERCHANT_SETTLEMENT_FROZEN",
          actorId: actor.actorId,
          branchId: request.branchId,
          batchId,
          batchDigest: header.batchDigest,
          requestId: request.requestId,
          createdAt: timestamp2,
          lineCount: lines.length,
          walletChanged: false,
          payoutAuthorized: false
        }, ConditionExpression: "attribute_not_exists(sk)" } }
      );
      if (options.onPrepare) {
        const extra = await options.onPrepare({ header, lines });
        if (!Array.isArray(extra) || extra.length > 3 || extra.some((op) => {
          const p = op.Put;
          return Object.keys(op).join(",") !== "Put" || p?.TableName !== T3.records || p.Item?.pk !== "MERCHANT_COLLECTION#" + request.branchId || p.Item?.branchId !== request.branchId || !["MERCHANT_PERIOD_COLLECTION", "MERCHANT_COLLECTION_PART"].includes(p.Item?.kind);
        })) return fail19("INVALID_SETTLEMENT_COLLECTION_OPERATIONS");
        operations.push(...extra);
      }
      uniqueOperations(operations);
      try {
        await db.send(new import_lib_dynamodb10.TransactWriteCommand({ TransactItems: operations }));
      } catch (error) {
        let committed;
        try {
          committed = await replay(request, requestHash, actor);
        } catch (readError) {
          if (readError instanceof MerchantSettlementBatchError) throw readError;
          return fail19("SETTLEMENT_OUTCOME_UNKNOWN_RETRY_SAME_REQUEST");
        }
        if (committed) return committed;
        await authority(request.branchId, "CREATE");
        if (["ValidationException", "AccessDeniedException", "ResourceNotFoundException"].includes(error?.name)) return fail19("SETTLEMENT_CONFIGURATION_UNAVAILABLE");
        return fail19(error?.name === "TransactionCanceledException" ? "SETTLEMENT_SOURCE_CHANGED_OR_ALREADY_CLAIMED" : "SETTLEMENT_OUTCOME_UNKNOWN_RETRY_SAME_REQUEST");
      }
      return { header, lines, replayed: false };
    },
    async read(value) {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "batchId,branchId") return fail19("INVALID_SETTLEMENT_BATCH_REQUEST");
      const request = detach(value);
      if (!quoteEntityIdValid(request.branchId) || !BATCH.test(request.batchId || "")) return fail19("INVALID_SETTLEMENT_BATCH_REQUEST");
      const before = await authority(request.branchId, "READ");
      const saved = await stored2(request.branchId, request.batchId);
      if ((await authority(request.branchId, "READ")).actorId !== before.actorId) return fail19("SETTLEMENT_AUTHORIZATION_CHANGED");
      return saved;
    },
    async list(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return fail19("INVALID_SETTLEMENT_BATCH_REQUEST");
      const request = detach(value);
      if (Object.keys(request).sort().join(",") !== (request.cursor === void 0 ? "branchId,limit" : "branchId,cursor,limit") || !quoteEntityIdValid(request.branchId) || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 50) return fail19("INVALID_SETTLEMENT_BATCH_REQUEST");
      const a = await authority(request.branchId, "READ");
      const validKey = (key4) => key4 && Object.keys(key4).sort().join(",") === "pk,sk" && key4.pk === partition(request.branchId) && typeof key4.sk === "string" && /^BATCH#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#MSB:[a-f0-9]{48}$/.test(key4.sk);
      let cursor;
      if (request.cursor !== void 0) {
        try {
          if (typeof request.cursor !== "string" || request.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(request.cursor)) return fail19("INVALID_SETTLEMENT_CURSOR");
          const parsed = JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8"));
          if (Object.keys(parsed).sort().join(",") !== "branchId,key,schemaVersion" || parsed.schemaVersion !== 1 || parsed.branchId !== request.branchId || !validKey(parsed.key)) return fail19("INVALID_SETTLEMENT_CURSOR");
          cursor = parsed.key;
        } catch {
          return fail19("INVALID_SETTLEMENT_CURSOR");
        }
      }
      const page = await db.send(new import_lib_dynamodb10.QueryCommand({
        TableName: T3.records,
        KeyConditionExpression: "pk=:pk AND begins_with(sk,:prefix)",
        ExpressionAttributeValues: { ":pk": partition(request.branchId), ":prefix": "BATCH#" },
        Limit: request.limit,
        ScanIndexForward: false,
        ConsistentRead: true,
        ...cursor ? { ExclusiveStartKey: cursor } : {}
      }));
      const rows = page.Items || [];
      if (rows.length > request.limit) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
      const seen = /* @__PURE__ */ new Set();
      for (const row3 of rows) {
        validateHeader(request.branchId, row3);
        if (seen.has(row3.batchId)) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
        seen.add(row3.batchId);
      }
      const next2 = page.LastEvaluatedKey;
      if (next2 && !validKey(next2)) return fail19("SETTLEMENT_BATCH_PROOF_INVALID");
      if ((await authority(request.branchId, "READ")).actorId !== a.actorId) return fail19("SETTLEMENT_AUTHORIZATION_CHANGED");
      const items = rows.map((row3) => ({
        batchId: row3.batchId,
        batchDigest: row3.batchDigest,
        branchId: row3.branchId,
        status: row3.status,
        createdAt: row3.createdAt,
        createdBy: row3.createdBy,
        period: row3.period,
        lineCount: row3.lineCount,
        summary: row3.summary,
        coverage: row3.coverage,
        payoutAuthorized: false
      }));
      return {
        items,
        coverage: "PAGE_OF_SAVED_STATEMENTS_ONLY",
        nextCursor: next2 ? Buffer.from(JSON.stringify({ schemaVersion: 1, branchId: request.branchId, key: next2 })).toString("base64url") : null
      };
    }
  });
}

// backend/wallet-service/src/merchantSettlementScheduleHistory.ts
var import_lib_dynamodb11 = require("@aws-sdk/lib-dynamodb");
var fail20 = (code) => {
  throw Object.assign(Error(code), { code });
};
function createMerchantSettlementScheduleHistoryReader(db, maxPages = 10) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20) return fail20("INVALID_SCHEDULE_HISTORY_LIMIT");
  return async (branchId, at) => {
    if (!quoteEntityIdValid(branchId) || typeof at !== "string" || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) return fail20("INVALID_SETTLEMENT_SCHEDULE_SELECTION");
    const pk3 = "BRANCH#" + branchId, currentKey = { pk: pk3, sk: "SETTLEMENT_SCHEDULE#CURRENT" };
    const current = await strongGet(db, "staging-MerchantPlatform", currentKey);
    if (!current || current.enabled === false) return null;
    await createMerchantSettlementScheduleReader(db)(branchId, current.effectiveFrom);
    const rows = [];
    let cursor;
    for (let page = 0; ; page++) {
      if (page >= maxPages) return fail20("SETTLEMENT_SCHEDULE_HISTORY_INCOMPLETE");
      const out = await db.send(new import_lib_dynamodb11.QueryCommand({
        TableName: "staging-MerchantPlatform",
        ConsistentRead: true,
        Limit: 100,
        KeyConditionExpression: "pk=:pk AND begins_with(sk,:prefix)",
        ExpressionAttributeValues: { ":pk": pk3, ":prefix": "SETTLEMENT_SCHEDULE#VERSION#" },
        ...cursor ? { ExclusiveStartKey: cursor } : {}
      }));
      rows.push(...out.Items || []);
      cursor = out.LastEvaluatedKey;
      if (!cursor) break;
    }
    rows.sort((a, b) => a.schedule?.version - b.schedule?.version);
    if (!rows.length || rows.length !== current.schedule?.version || rows.some((r, i) => r.pk !== pk3 || r.sk !== "SETTLEMENT_SCHEDULE#VERSION#" + (i + 1) || r.branchId !== branchId || r.schedule?.version !== i + 1 || i > 0 && r.effectiveFrom <= rows[i - 1].effectiveFrom) || rows.at(-1)?.digest !== current.digest) return fail20("SETTLEMENT_SCHEDULE_HISTORY_INVALID");
    const selected = [...rows].reverse().find((r) => r.effectiveFrom <= at);
    if (!selected) return fail20("SETTLEMENT_HISTORICAL_SCHEDULE_REQUIRED");
    const selectedDb = { send: async (command) => command.input.TableName === "staging-MerchantPlatform" && command.input.Key?.sk === currentKey.sk ? { Item: { ...selected, sk: currentKey.sk } } : db.send(command) };
    const validated = await createMerchantSettlementScheduleReader(selectedDb)(branchId, at);
    if (!validated) return fail20("SETTLEMENT_SCHEDULE_HISTORY_INVALID");
    const next2 = rows[selected.schedule.version], period = merchantSettlementPeriod(selected.schedule, at);
    const guards = [exactCheck("staging-MerchantPlatform", { pk: pk3, sk: selected.sk }, selected)];
    if (next2) {
      const nextDb = { send: async (command) => command.input.TableName === "staging-MerchantPlatform" && command.input.Key?.sk === currentKey.sk ? { Item: { ...next2, sk: currentKey.sk } } : db.send(command) };
      await createMerchantSettlementScheduleReader(nextDb)(branchId, next2.effectiveFrom);
      guards.push(exactCheck("staging-MerchantPlatform", { pk: pk3, sk: next2.sk }, next2));
      const closureKey = { pk: pk3, sk: "SETTLEMENT_SCHEDULE#CLOSED#" + selected.schedule.version };
      const closure = await strongGet(db, "staging-MerchantPlatform", closureKey);
      if (!closure || closure.kind !== "MERCHANT_SETTLEMENT_SCHEDULE_CLOSURE" || closure.branchId !== branchId || closure.version !== selected.schedule.version || closure.sourceDigest !== selected.digest || closure.replacedByVersion !== next2.schedule.version || closure.untilExclusive !== next2.effectiveFrom || period.untilExclusiveUtc > closure.untilExclusive) return fail20("SETTLEMENT_SCHEDULE_CUTOVER_INVALID");
      guards.push(exactCheck("staging-MerchantPlatform", closureKey, closure));
    }
    const after = await strongGet(db, "staging-MerchantPlatform", currentKey);
    if (!after || after.digest !== current.digest || after.enabled !== true) return fail20("SETTLEMENT_SCHEDULE_CHANGED");
    return {
      schedule: validated.schedule,
      agreementBinding: validated.agreementBinding,
      guard: exactCheck("staging-MerchantPlatform", currentKey, current),
      guards
    };
  };
}

// backend/wallet-service/src/merchantOpeningScheduleReader.ts
function createMerchantOpeningScheduleReader(db) {
  return async (branchId) => {
    if (!quoteEntityIdValid(branchId)) throw Error("INVALID_SETTLEMENT_SCHEDULE_SELECTION");
    const table = "staging-MerchantPlatform", pk3 = "BRANCH#" + branchId, currentKey = { pk: pk3, sk: "SETTLEMENT_SCHEDULE#CURRENT" };
    const current = await strongGet(db, table, currentKey);
    if (!current) return null;
    if (!await createMerchantSettlementScheduleReader(db)(branchId, current.effectiveFrom)) return null;
    const firstKey = { pk: pk3, sk: "SETTLEMENT_SCHEDULE#VERSION#1" }, first = await strongGet(db, table, firstKey);
    if (!first || first.schedule?.version !== 1 || first.branchId !== branchId || first.effectiveFrom > current.effectiveFrom) throw Error("SETTLEMENT_SCHEDULE_HISTORY_INVALID");
    const adapter = { send: async (command) => command.input.TableName === table && equal(command.input.Key, currentKey) ? { Item: { ...first, sk: currentKey.sk } } : db.send(command) };
    const original = await createMerchantSettlementScheduleReader(adapter)(branchId, first.effectiveFrom);
    if (!original || current.schedule.version === 1 && first.digest !== current.digest) throw Error("SETTLEMENT_SCHEDULE_HISTORY_INVALID");
    const after = await strongGet(db, table, currentKey);
    if (!equal(current, after)) throw Error("SETTLEMENT_SCHEDULE_CHANGED");
    return { schedule: original.schedule, openingCutoff: first.effectiveFrom, guard: exactCheck(table, currentKey, current), guards: [exactCheck(table, firstKey, first)] };
  };
}

// backend/wallet-service/src/merchantStatementsAdmin.ts
var { allowed: allowed4 } = require_catalog();
var fail21 = (code = "INVALID_SETTLEMENT_BATCH_REQUEST") => {
  throw Object.assign(Error(code), { code });
};
function createMerchantStatementsAdmin(options) {
  const { db } = options, now = options.now ?? Date.now, authorize = createMerchantSettlementAuthority(options), readSchedule = createMerchantSettlementScheduleHistoryReader(db), readOpeningSchedule = createMerchantOpeningScheduleReader(db);
  const batches = createMerchantSettlementBatchService({ db, authorizeBranch: authorize, readSchedule, readOpeningSchedule, now });
  const approve = createMerchantStatementApproval({ db, now, readBatch: batches.read, authorize: async (branchId) => {
    const before = await authorize(branchId, "CREATE"), employee2 = await strongGet(db, "staging-PlatformStaff", { pk: "EMPLOYEE#" + options.principal.employeeId, sk: "PROFILE" });
    if (!employee2 || !allowed4(employee2, "finance.approve")) return fail21("SETTLEMENT_PERMISSION_REQUIRED");
    if (!equal(before, await authorize(branchId, "CREATE"))) return fail21("SETTLEMENT_AUTHORIZATION_CHANGED");
    return before;
  } });
  return {
    approve,
    create: (body) => batches.create(body),
    async list(body) {
      const result = await batches.list(body);
      const items = [];
      for (const item of result.items) {
        const approval = await readMerchantStatementApproval(db, item.branchId, item.batchId, item.batchDigest);
        let claim = await strongGet(db, "staging-MerchantPlatform", { pk: "MERCHANT_PAYOUT#" + item.branchId, sk: "BATCH#" + item.batchId });
        if (claim?.status === "PAID") {
          const branch = await strongGet(db, "WhizzMerchants_Businesses", { businessId: item.branchId });
          claim = await readMerchantStatementPayment(db, await batches.read({ branchId: item.branchId, batchId: item.batchId }), branch?.ownerId);
        }
        items.push({ ...item, approvalStatus: approval?.status ?? "PENDING_REVIEW", paymentStatus: claim?.status === "PAID" ? "PAID" : "UNPAID", payoutId: claim?.payoutId || null });
      }
      await authorize(body.branchId, "READ");
      return { ...result, items };
    },
    async read(body) {
      const result = await batches.read(body);
      const approval = await readMerchantStatementApproval(db, result.header.branchId, result.header.batchId, result.header.batchDigest);
      await authorize(result.header.branchId, "READ");
      return { ...result, approval };
    },
    async preview(body) {
      if (!body || typeof body !== "object" || Array.isArray(body)) return fail21();
      const v = body, opening = v.kind === "OPENING", offCycle = v.kind === "OFF_CYCLE", cutoff = new Date(now()).toISOString();
      if (Object.keys(v).sort().join(",") !== (offCycle ? "branchId,kind,orderIds,reason" : opening ? "branchId,fromLocalDate,kind,orderIds" : "at,branchId,orderIds") || !quoteEntityIdValid(v.branchId) || !Array.isArray(v.orderIds) || !v.orderIds.length || v.orderIds.length > 10 || v.orderIds.some((id3) => !quoteEntityIdValid(id3)) || new Set(v.orderIds).size !== v.orderIds.length) return fail21();
      const actor = await authorize(v.branchId, "READ"), source = await (opening ? readOpeningSchedule(v.branchId) : readSchedule(v.branchId, offCycle ? cutoff : v.at));
      if (!source) return fail21("SETTLEMENT_SCHEDULE_APPROVAL_REQUIRED");
      let period = opening ? merchantOpeningPeriod(source.schedule, v.fromLocalDate, source.openingCutoff) : merchantSettlementPeriod(source.schedule, offCycle ? cutoff : v.at);
      const accruals = [];
      for (const id3 of v.orderIds) {
        const proof = await readMerchantAccrualEvidence(db, v.branchId, id3);
        if (["settlementBatchId", "settlementLineDigest", "settlementClaimedAt"].some((k) => Object.prototype.hasOwnProperty.call(proof.payable, k))) return fail21("MERCHANT_PAYABLE_ALREADY_IN_SETTLEMENT");
        if (!opening && "agreementBinding" in source && source.agreementBinding && !equal(proof.accrual.agreement, source.agreementBinding)) return fail21("SETTLEMENT_AGREEMENT_SCHEDULE_MISMATCH");
        accruals.push(proof.accrual);
      }
      if (offCycle) {
        const earliest = accruals.map((a) => a.deliveredAt).sort()[0], local2 = (at) => new Date(Date.parse(at) + 108e5).toISOString().slice(0, 10);
        period = merchantOffCyclePeriod(source.schedule, local2(earliest), local2(cutoff), cutoff, v.reason);
      }
      const preview = assembleMerchantSettlementPreview(v.branchId, period, accruals);
      if ((await authorize(v.branchId, "READ")).actorId !== actor.actorId) return fail21("SETTLEMENT_AUTHORIZATION_CHANGED");
      return { ...preview, periodClosed: new Date(now()).toISOString() >= period.untilExclusiveUtc, request: { branchId: v.branchId, at: offCycle ? cutoff : opening ? period.untilExclusiveUtc : v.at, orderIds: [...v.orderIds].sort(), previewId: preview.previewId, ...offCycle ? { kind: "OFF_CYCLE", fromLocalDate: period.startLocalDate, throughLocalDate: period.throughLocalDate, reason: v.reason.trim() } : opening ? { kind: "OPENING", fromLocalDate: v.fromLocalDate } : {} } };
    }
  };
}

// backend/wallet-service/src/merchantPayoutApi.ts
var { allowed: allowed5 } = require_catalog();
var fail22 = (code) => {
  throw Object.assign(Error(code), { code });
};
function createMerchantPayoutApi(options) {
  if ([options.staff, options.owner, options.merchantStaff].filter(Boolean).length !== 1) return fail22("PAYOUT_VERIFIED_PRINCIPAL_REQUIRED");
  const { db } = options, now = options.now ?? Date.now, staffAuthority = options.staff ? createMerchantSettlementAuthority({ db, principal: options.staff, now }) : null;
  const companyAuthority = options.staff ? createMerchantSettlementAuthority({ db, principal: options.staff, now, companyCashbook: true }) : null;
  const authorize = async (branchId, action, amount4) => {
    if (options.merchantStaff) return options.merchantStaff.authorize(branchId, action);
    if (options.owner) {
      const o = options.owner;
      await o.revalidate();
      const age = Math.floor(now() / 1e3) - o.authTime;
      if (!Number.isSafeInteger(o.authTime) || age < -30 || action !== "READ" && age > 300 && !(process.env.PLATFORM_ENVIRONMENT === "staging" && process.env.PLATFORM_SESSION_POLICY === "VALID_SESSION")) return fail22("PAYOUT_REAUTH_REQUIRED");
      if (["STAFF", "APPROVE"].includes(action)) return fail22("PAYOUT_PERMISSION_REQUIRED");
      const branch = await strongGet(db, "WhizzMerchants_Businesses", { businessId: branchId });
      if (branch?.ownerId !== o.subjectId || branch?.cognitoUserId !== o.subjectId) return fail22("PAYOUT_OWNER_REQUIRED");
      return { actorId: o.subjectId, owner: true, guards: [exactCheck("WhizzMerchants_Businesses", { businessId: branchId }, branch)] };
    }
    if (action === "OWNER") return fail22("PAYOUT_OWNER_REQUIRED");
    const a = await (branchId === "COMPANY_CASHBOOK" ? companyAuthority : staffAuthority)(branchId, action === "READ" ? "READ" : "CREATE");
    if (action === "APPROVE") {
      const e = await strongGet(db, "staging-PlatformStaff", { pk: "EMPLOYEE#" + a.actorId, sk: "PROFILE" });
      if (!e || !allowed5(e, "finance.approve") || !Number.isSafeInteger(e.approvalLimit) || e.approvalLimit < amount4) return fail22("PAYOUT_APPROVAL_LIMIT_OR_PERMISSION_REQUIRED");
      if (!equal(a, await (branchId === "COMPANY_CASHBOOK" ? companyAuthority : staffAuthority)(branchId, "CREATE"))) return fail22("PAYOUT_AUTHORIZATION_CHANGED");
    }
    return { actorId: a.actorId, owner: false, guards: a.guards };
  };
  const batches = createMerchantSettlementBatchService({ db, now, authorizeBranch: async (branchId, action) => {
    if (action !== "READ") return fail22("PAYOUT_PERMISSION_REQUIRED");
    const a = await authorize(branchId, "READ", 0);
    return { branchId, actorId: a.actorId, guards: a.guards };
  }, readSchedule: async () => null });
  return createMerchantPayoutService({ db, now, authorize, ...options.staff ? { companyCashAuthority: (action, amount4 = 0) => authorize("COMPANY_CASHBOOK", action, amount4) } : {}, readAccount: options.readAccount, otp: options.otp, readBatch: (branchId, batchId) => batches.read({ branchId, batchId }), listBatches: (branchId, cursor) => batches.list({ branchId, limit: 20, ...cursor ? { cursor } : {} }) });
}

// backend/wallet-service/src/merchantPeriodCollection.ts
var import_lib_dynamodb13 = require("@aws-sdk/lib-dynamodb");

// backend/wallet-service/src/merchantAccrualIndex.ts
var import_lib_dynamodb12 = require("@aws-sdk/lib-dynamodb");
var MERCHANT_ACCRUAL_INDEX_TABLE = "staging-MerchantPlatform";
var merchantAccrualPartition = (branchId) => "MERCHANT_ACCRUAL#" + branchId;
var fail23 = (code = "SETTLEMENT_ACCRUAL_INDEX_INVALID") => {
  throw Object.assign(Error(code), { code });
};
var iso2 = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function merchantAccrualIndexRow(v) {
  if (Object.keys(v).sort().join(",") !== "branchId,deliveredAt,financialSchemaVersion,merchantNetIqd,operationId,orderId") return fail23();
  if (![v.branchId, v.orderId, v.operationId].every(quoteEntityIdValid) || !iso2(v.deliveredAt) || !Number.isSafeInteger(v.merchantNetIqd) || v.merchantNetIqd < 0 || ![2, 3, 4, 5].includes(v.financialSchemaVersion)) return fail23();
  const content = { schemaVersion: 1, kind: "MERCHANT_ACCRUAL_INDEX_ENTRY", ...v, retentionClass: "FINANCIAL_SETTLEMENT" };
  return { pk: merchantAccrualPartition(v.branchId), sk: "DELIVERED#" + v.deliveredAt + "#" + v.orderId, ...content, digest: quoteHash(content) };
}
function validateMerchantAccrualIndexRow(row3, branchId) {
  if (!row3 || row3.branchId !== branchId || !equal(row3, merchantAccrualIndexRow({ branchId: row3.branchId, orderId: row3.orderId, operationId: row3.operationId, deliveredAt: row3.deliveredAt, merchantNetIqd: row3.merchantNetIqd, financialSchemaVersion: row3.financialSchemaVersion }))) return fail23();
  return row3;
}
function validateMerchantAccrualIndexHead(row3, branchId, sk = "HEAD") {
  if (row3 === null) return null;
  if (!row3 || Object.keys(row3).sort().join(",") !== "branchId,kind,pk,retentionClass,revision,schemaVersion,sk,updatedAt" || row3.pk !== merchantAccrualPartition(branchId) || row3.sk !== sk || row3.branchId !== branchId || row3.kind !== "MERCHANT_ACCRUAL_INDEX_HEAD" || row3.schemaVersion !== 1 || row3.retentionClass !== "FINANCIAL_SETTLEMENT" || !Number.isSafeInteger(row3.revision) || row3.revision < 1 || row3.revision >= Number.MAX_SAFE_INTEGER || !iso2(row3.updatedAt)) return fail23();
  return row3;
}
var DAY2 = 864e5;
var DEPTH = 9;
var SPAN = 4 ** DEPTH;
function day2(at) {
  if (!iso2(at)) return fail23();
  const n = Math.floor((Date.parse(at) + 108e5) / DAY2);
  if (n < 0 || n >= SPAN) return fail23("SETTLEMENT_ACCRUAL_INDEX_DATE_UNSUPPORTED");
  return n;
}
var node = (level, slot) => level === 0 ? "HEAD" : "NODE#" + level + "#" + slot;
function merchantAccrualRangeNodes(fromUtc, untilExclusiveUtc) {
  if (!iso2(fromUtc) || !iso2(untilExclusiveUtc) || fromUtc >= untilExclusiveUtc) return fail23();
  const first = day2(fromUtc), last = day2(new Date(Date.parse(untilExclusiveUtc) - 1).toISOString()), nodes = [];
  function visit(level, slot, start, size) {
    if (start > last || start + size <= first) return;
    if (first <= start && start + size - 1 <= last) {
      nodes.push(node(level, slot));
      return;
    }
    for (let c = 0; c < 4; c++) visit(level + 1, slot * 4 + c, start + c * size / 4, size / 4);
  }
  visit(0, 0, 0, SPAN);
  if (nodes.length > 54) return fail23();
  return nodes;
}
async function readMerchantAccrualRange(db, branchId, fromUtc, untilExclusiveUtc) {
  if (!quoteEntityIdValid(branchId)) return fail23();
  return Promise.all(merchantAccrualRangeNodes(fromUtc, untilExclusiveUtc).map(async (sk) => {
    const key4 = { pk: merchantAccrualPartition(branchId), sk }, row3 = validateMerchantAccrualIndexHead(await strongGet(db, MERCHANT_ACCRUAL_INDEX_TABLE, key4), branchId, sk);
    return { key: key4, row: row3 };
  }));
}
function merchantAccrualRangeGuards(pins) {
  return pins.map((p) => p.row ? exactCheck(MERCHANT_ACCRUAL_INDEX_TABLE, p.key, p.row) : { ConditionCheck: { TableName: MERCHANT_ACCRUAL_INDEX_TABLE, Key: p.key, ConditionExpression: "attribute_not_exists(pk)" } });
}
async function readMerchantAccrualIndexPage(db, v) {
  if (!quoteEntityIdValid(v.branchId) || !iso2(v.fromUtc) || !iso2(v.untilExclusiveUtc) || v.fromUtc >= v.untilExclusiveUtc) return fail23();
  const pk3 = merchantAccrualPartition(v.branchId), validKey = (k) => k && Object.keys(k).sort().join(",") === "pk,sk" && k.pk === pk3 && typeof k.sk === "string" && k.sk.startsWith("DELIVERED#") && k.sk >= "DELIVERED#" + v.fromUtc && k.sk < "DELIVERED#" + v.untilExclusiveUtc;
  if (v.key && !validKey(v.key)) return fail23("SETTLEMENT_ACCRUAL_INDEX_CURSOR_INVALID");
  const page = await db.send(new import_lib_dynamodb12.QueryCommand({ TableName: MERCHANT_ACCRUAL_INDEX_TABLE, ConsistentRead: true, KeyConditionExpression: "pk=:pk AND sk BETWEEN :from AND :until", ExpressionAttributeValues: { ":pk": pk3, ":from": "DELIVERED#" + v.fromUtc, ":until": "DELIVERED#" + v.untilExclusiveUtc }, Limit: 10, ScanIndexForward: true, ...v.key ? { ExclusiveStartKey: v.key } : {} }));
  const seen = /* @__PURE__ */ new Set();
  for (const row3 of page.Items || []) {
    validateMerchantAccrualIndexRow(row3, v.branchId);
    if (!validKey({ pk: row3.pk, sk: row3.sk }) || seen.has(row3.orderId)) return fail23();
    seen.add(row3.orderId);
  }
  if (page.LastEvaluatedKey && !validKey(page.LastEvaluatedKey)) return fail23();
  return { items: page.Items || [], nextKey: page.LastEvaluatedKey || null };
}

// backend/wallet-service/src/merchantPeriodCollection.ts
var T4 = "staging-MerchantPlatform";
var UUID2 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
var ID = /^MCG:[a-f0-9]{48}$/;
var MERCHANT_ACCRUAL_COVERAGE_KEY = { pk: "SYSTEM#MERCHANT_ACCRUAL_INDEX", sk: "COVERAGE" };
var fail24 = (code = "SETTLEMENT_COLLECTION_INVALID") => {
  throw Object.assign(Error(code), { code });
};
var pk2 = (branchId) => "MERCHANT_COLLECTION#" + branchId;
var rootKey = (branchId, collectionId) => ({ pk: pk2(branchId), sk: "COLLECTION#" + collectionId });
var pageKey = (r, index, prefix = "PAGE") => ({ pk: pk2(r.branchId), sk: prefix + "#" + r.collectionId + "#" + String(index).padStart(12, "0") });
var seal3 = (body) => ({ ...body, digest: quoteHash(body) });
var validSeal2 = (row3) => {
  const { digest, ...body } = row3 || {};
  return typeof digest === "string" && quoteHash(body) === digest;
};
function put3(row3, prior) {
  if (!prior) return { Put: { TableName: T4, Item: row3, ConditionExpression: "attribute_not_exists(pk)" } };
  const { Key: _key, ...q } = exactCheck(T4, { pk: row3.pk, sk: row3.sk }, prior).ConditionCheck;
  return { Put: { ...q, Item: row3 } };
}
function next(r, fields2) {
  const { digest: _digest, ...body } = r;
  return seal3({ ...body, ...fields2, version: r.version + 1 });
}
function totals(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const m = readMoney(v), n = BigInt(out[k]?.minorAmount ?? 0) + BigInt(m.minorAmount);
    if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) return fail24("SETTLEMENT_COLLECTION_PRECISION_UNSUPPORTED");
    out[k] = { ...m, minorAmount: Number(n) };
  }
  return out;
}
function childRequestId(r) {
  const h = quoteHash([r.branchId, r.collectionId, r.freezePage]);
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-8" + h.slice(17, 20) + "-" + h.slice(20, 32);
}
function createMerchantPeriodCollection(options) {
  const { db } = options, now = options.now ?? Date.now, authorize = createMerchantSettlementAuthority(options), history = createMerchantSettlementScheduleHistoryReader(db), opening = createMerchantOpeningScheduleReader(db);
  const stamp = () => new Date(now()).toISOString();
  async function evidence(branchId, orderId) {
    const p = await readMerchantAccrualEvidence(db, branchId, orderId);
    const { settlementBatchId: _batch, settlementLineDigest: _line, settlementClaimedAt: _claimed, paidAt: _paid, paidPayoutId: _payout, ...original } = p.payable;
    return { ...p, accrual: deriveMerchantCodAccrual({ branchId, order: p.order, outcome: p.outcome, acceptedOffer: p.acceptedOffer, payable: { ...original, status: "LOCKED_PENDING_SETTLEMENT" }, accountingJournal: p.accountingJournal, cashAdjudicationJournal:p.cashAdjudicationJournal }) };
  }
  async function coverage() {
    const c = await strongGet(db, T4, MERCHANT_ACCRUAL_COVERAGE_KEY);
    if (!c || c.kind !== "MERCHANT_ACCRUAL_INDEX_COVERAGE" || c.schemaVersion !== 1 || c.status !== "COMPLETE" || !validSeal2(c)) return fail24("SETTLEMENT_ACCRUAL_INDEX_NOT_READY");
    return c;
  }
  function validate(r, branchId, collectionId) {
    if (!r || !validSeal2(r) || r.pk !== pk2(branchId) || r.sk !== "COLLECTION#" + collectionId || r.branchId !== branchId || r.collectionId !== collectionId || r.kind !== "MERCHANT_PERIOD_COLLECTION" || r.schemaVersion !== 1 || !Number.isSafeInteger(r.version) || r.version < 1 || !["DISCOVERING", "READY", "FREEZING", "FROZEN"].includes(r.status) || !Number.isSafeInteger(r.pageCount) || r.pageCount < 0 || !Number.isSafeInteger(r.freezePage) || r.freezePage < 0 || r.freezePage > r.pageCount || !Array.isArray(r.rangePins) || r.rangePins.length > 54) return fail24("SETTLEMENT_COLLECTION_PROOF_INVALID");
    return r;
  }
  async function sourceChanged(r) {
    return !equal(await readMerchantAccrualRange(db, r.branchId, r.period.fromUtc, r.period.untilExclusiveUtc), r.rangePins);
  }
  async function load(v, action) {
    if (!v || !quoteEntityIdValid(v.branchId) || !ID.test(v.collectionId || "")) return fail24();
    const actor = await authorize(v.branchId, action), r = validate(await strongGet(db, T4, rootKey(v.branchId, v.collectionId)), v.branchId, v.collectionId);
    return { actor, r };
  }
  async function schedule(v) {
    const source = v.kind === "OPENING" ? await opening(v.branchId) : await history(v.branchId, v.at);
    if (!source) return fail24("SETTLEMENT_SCHEDULE_APPROVAL_REQUIRED");
    const period = v.kind === "OPENING" ? merchantOpeningPeriod(source.schedule, v.fromLocalDate, source.openingCutoff) : v.kind === "OFF_CYCLE" ? merchantOffCyclePeriod(source.schedule, v.fromLocalDate, v.throughLocalDate, v.at, v.reason) : merchantSettlementPeriod(source.schedule, v.at);
    return { source, period };
  }
  function publicRoot(r) {
    const { rangePins, coverageProof, scheduleGuards, requestHash, pk: _pk, sk: _sk, ...out } = r;
    return { ...out, coverage: r.status === "FROZEN" ? "COMPLETE_FROZEN_PERIOD_COLLECTION" : r.status === "READY" || r.status === "FREEZING" ? "COMPLETE_PERIOD_PREVIEW" : "PARTIAL_DISCOVERY", generatedAt: stamp(), walletMutationPerformed: false, payoutAuthorized: false };
  }
  async function commit(r, actor, operations, pinRange = true) {
    const current = await authorize(r.branchId, "CREATE");
    if (!equal(current, actor)) return fail24("SETTLEMENT_AUTHORIZATION_CHANGED");
    const branch = await strongGet(db, "WhizzMerchants_Businesses", { businessId: r.branchId });
    if (!branch) return fail24("SETTLEMENT_BRANCH_UNAVAILABLE");
    const guards = [...current.guards, ...pinRange ? merchantAccrualRangeGuards(r.rangePins) : [], exactCheck(T4, MERCHANT_ACCRUAL_COVERAGE_KEY, r.coverageProof), ...r.scheduleGuards, exactCheck("WhizzMerchants_Businesses", { businessId: r.branchId }, branch)];
    for (const key4 of ["BUSINESS_LIFECYCLE#MERCHANT#" + r.branchId, "ACCOUNT_LIFECYCLE#MERCHANT#" + branch.ownerId]) guards.push({ ConditionCheck: { TableName: "staging-AccountDeletion", Key: { pk: key4, sk: "META" }, ConditionExpression: "attribute_not_exists(pk)" } });
    const tx = [...guards, ...operations];
    const identities = tx.map((op) => {
      const p = op.Put ?? op.ConditionCheck;
      return quoteHash([p.TableName, op.Put ? { pk: p.Item.pk, sk: p.Item.sk } : p.Key]);
    });
    if (tx.length > 100 || new Set(identities).size !== identities.length || Buffer.byteLength(JSON.stringify(tx)) > 25e5) return fail24("SETTLEMENT_COLLECTION_TRANSACTION_INVALID");
    try {
      await db.send(new import_lib_dynamodb13.TransactWriteCommand({ TransactItems: tx }));
    } catch (e) {
      if (["AccessDeniedException", "ValidationException", "ResourceNotFoundException"].includes(e?.name)) return fail24("SETTLEMENT_CONFIGURATION_UNAVAILABLE");
      return fail24("SETTLEMENT_COLLECTION_CHANGED_RELOAD");
    }
  }
  return {
    async start(v) {
      const op = v?.kind === "OPENING", off = v?.kind === "OFF_CYCLE";
      if (!v || Object.keys(v).sort().join(",") !== (off ? "branchId,fromLocalDate,kind,reason,requestId,throughLocalDate" : op ? "branchId,fromLocalDate,kind,requestId" : "at,branchId,requestId") || !quoteEntityIdValid(v.branchId) || !UUID2.test(v.requestId || "")) return fail24();
      const actor = await authorize(v.branchId, "CREATE"), id3 = "MCG:" + quoteHash({ branchId: v.branchId, requestId: v.requestId }).slice(0, 48), key4 = rootKey(v.branchId, id3), hash = quoteHash(v), old = await strongGet(db, T4, key4);
      if (old) {
        validate(old, v.branchId, id3);
        if (old.requestHash !== hash || old.createdBy !== actor.actorId) return fail24("SETTLEMENT_COLLECTION_REQUEST_CONFLICT");
        await authorize(v.branchId, "READ");
        return { collection: publicRoot(old), replayed: true };
      }
      const selection = off ? { kind: "OFF_CYCLE", fromLocalDate: v.fromLocalDate, throughLocalDate: v.throughLocalDate, reason: v.reason, at: stamp() } : op ? { kind: "OPENING", fromLocalDate: v.fromLocalDate } : { at: v.at };
      const { source, period } = await schedule({ ...v, ...selection });
      if (stamp() < period.untilExclusiveUtc) return fail24("SETTLEMENT_PERIOD_STILL_OPEN");
      const proof = await coverage(), pins = await readMerchantAccrualRange(db, v.branchId, period.fromUtc, period.untilExclusiveUtc);
      const r = seal3({ ...key4, kind: "MERCHANT_PERIOD_COLLECTION", schemaVersion: 1, branchId: v.branchId, collectionId: id3, requestId: v.requestId, requestHash: hash, createdBy: actor.actorId, createdAt: stamp(), updatedAt: stamp(), version: 1, lastActorId: actor.actorId, status: "DISCOVERING", period, selection, rangePins: pins, coverageProof: proof, scheduleGuards: [source.guard, ...source.guards || []], cursor: null, pageCount: 0, freezePage: 0, orderCount: 0, claimedCount: 0, unclaimedCount: 0, zeroNetCount: 0, createdBatchCount: 0, includedNewCount: 0, includedExistingCount: 0, newBatchNetMinor: 0, amounts: {}, ...off ? { unclaimedAmounts: {} } : {}, manifestDigest: quoteHash([]), retentionClass: "FINANCIAL_SETTLEMENT", walletMutationPerformed: false, payoutAuthorized: false });
      try {
        await commit(r, actor, [put3(r), put3(seal3({ pk: pk2(r.branchId), sk: "LIST#" + r.createdAt + "#" + id3, kind: "MERCHANT_COLLECTION_LOOKUP", schemaVersion: 1, branchId: r.branchId, collectionId: id3, createdAt: r.createdAt, retentionClass: "FINANCIAL_SETTLEMENT" }))]);
      } catch (e) {
        const saved = await strongGet(db, T4, key4);
        if (saved && saved.requestHash === hash && saved.createdBy === actor.actorId) return { collection: publicRoot(validate(saved, v.branchId, id3)), replayed: true };
        throw e;
      }
      return { collection: publicRoot(r), replayed: false };
    },
    async advance(v) {
      if (!v || Object.keys(v).sort().join(",") !== "branchId,collectionId,version" || !Number.isSafeInteger(v.version)) return fail24();
      const { r, actor } = await load(v, "CREATE");
      if (v.version !== r.version || ["READY", "FROZEN"].includes(r.status)) return { collection: publicRoot(r), replayed: true };
      if (r.status === "DISCOVERING") {
        const page = await readMerchantAccrualIndexPage(db, { branchId: r.branchId, fromUtc: r.period.fromUtc, untilExclusiveUtc: r.period.untilExclusiveUtc, ...r.cursor ? { key: r.cursor } : {} });
        const lines = [];
        for (const indexed of page.items) {
          const p3 = await evidence(r.branchId, indexed.orderId), a = p3.accrual;
          if (a.operationId !== indexed.operationId || a.deliveredAt !== indexed.deliveredAt || a.amounts.merchantNet.minorAmount !== indexed.merchantNetIqd * 1e3 || p3.payable.financialSchemaVersion !== indexed.financialSchemaVersion) return fail24("SETTLEMENT_COLLECTION_SOURCE_INVALID");
          if (a.deliveredAt < r.period.fromUtc || a.deliveredAt >= r.period.untilExclusiveUtc) return fail24("MERCHANT_ACCRUAL_OUTSIDE_PERIOD");
          lines.push({ orderId: a.orderId, accrual: a, statementId: p3.payable.settlementBatchId || null });
        }
        const summary = summarizeMerchantAccruals(r.branchId, lines.map((l) => l.accrual)), p2 = seal3({ ...pageKey(r, r.pageCount), kind: "MERCHANT_COLLECTION_PAGE", schemaVersion: 1, branchId: r.branchId, collectionId: r.collectionId, index: r.pageCount, createdBy: actor.actorId, createdAt: stamp(), previousDigest: r.manifestDigest, lines, summary, retentionClass: "FINANCIAL_SETTLEMENT" });
        const n2 = next(r, { lastActorId: actor.actorId, cursor: page.nextKey, pageCount: r.pageCount + 1, status: page.nextKey ? "DISCOVERING" : "READY", updatedAt: stamp(), orderCount: r.orderCount + lines.length, claimedCount: r.claimedCount + lines.filter((l) => l.statementId).length, unclaimedCount: r.unclaimedCount + lines.filter((l) => !l.statementId).length, zeroNetCount: r.zeroNetCount + lines.filter((l) => l.accrual.amounts.merchantNet.minorAmount === 0).length, amounts: totals(r.amounts, summary.amounts), ...r.selection.kind === "OFF_CYCLE" ? { unclaimedAmounts: totals(r.unclaimedAmounts || {}, summarizeMerchantAccruals(r.branchId, lines.filter((l) => !l.statementId).map((l) => l.accrual)).amounts) } : {}, manifestDigest: p2.digest });
        await commit(r, actor, [put3(p2), put3(n2, r)]);
        return { collection: publicRoot(n2) };
      }
      if (r.freezePage === r.pageCount) {
        const n2 = next(r, { lastActorId: actor.actorId, status: "FROZEN", updatedAt: stamp(), frozenAt: stamp() });
        await commit(r, actor, [put3(n2, r)]);
        return { collection: publicRoot(n2) };
      }
      const p = await strongGet(db, T4, pageKey(r, r.freezePage));
      if (!p || !validSeal2(p) || p.kind !== "MERCHANT_COLLECTION_PAGE" || p.collectionId !== r.collectionId || p.index !== r.freezePage || !Array.isArray(p.lines) || p.lines.length > 10) return fail24("SETTLEMENT_COLLECTION_PROOF_INVALID");
      const available = [], existing = /* @__PURE__ */ new Set(), savedBatches = /* @__PURE__ */ new Map();
      const reader = createMerchantSettlementBatchService({ db, now, authorizeBranch: authorize, readSchedule: history, readOpeningSchedule: opening });
      for (const line of p.lines) {
        const source = await evidence(r.branchId, line.orderId);
        if (!equal(source.accrual, line.accrual)) return fail24("SETTLEMENT_COLLECTION_SOURCE_INVALID");
        if (source.payable.settlementBatchId) {
          const id3 = source.payable.settlementBatchId;
          if (!savedBatches.has(id3)) savedBatches.set(id3, await reader.read({ branchId: r.branchId, batchId: id3 }));
          const saved2 = savedBatches.get(id3), member = saved2.lines.find((l) => l.orderId === line.orderId);
          if (!member || member.lineDigest !== source.payable.settlementLineDigest || !equal(member.accrual, source.accrual)) return fail24("SETTLEMENT_COLLECTION_MEMBERSHIP_INVALID");
          existing.add(id3);
        } else available.push(source.accrual);
      }
      const part = (h) => seal3({ ...pageKey(r, r.freezePage, "PART"), kind: "MERCHANT_COLLECTION_PART", schemaVersion: 1, branchId: r.branchId, collectionId: r.collectionId, index: r.freezePage, createdBy: actor.actorId, createdAt: stamp(), pageDigest: p.digest, createdBatchId: h?.batchId ?? null, createdBatchDigest: h?.batchDigest ?? null, createdBatchNet: h?.summary.amounts.merchantNet ?? null, existingBatchIds: [...existing].sort(), retentionClass: "FINANCIAL_SETTLEMENT" });
      const added = available.reduce((n2, a) => n2 + BigInt(a.amounts.merchantNet.minorAmount), 0n) + BigInt(r.newBatchNetMinor);
      if (added > BigInt(Number.MAX_SAFE_INTEGER)) return fail24("SETTLEMENT_COLLECTION_PRECISION_UNSUPPORTED");
      const n = next(r, { lastActorId: actor.actorId, freezePage: r.freezePage + 1, createdBatchCount: r.createdBatchCount + (available.length ? 1 : 0), includedNewCount: r.includedNewCount + available.length, includedExistingCount: r.includedExistingCount + p.lines.length - available.length, newBatchNetMinor: Number(added), updatedAt: stamp() });
      if (!available.length) {
        await commit(r, actor, [put3(part()), put3(n, r)]);
        return { collection: publicRoot(n) };
      }
      const preview = assembleMerchantSettlementPreview(r.branchId, r.period, available), batches = createMerchantSettlementBatchService({ db, now, authorizeBranch: authorize, readSchedule: history, readOpeningSchedule: opening, onPrepare: async (saved2) => {
        if (!equal(saved2.header.period, r.period)) return fail24("SETTLEMENT_COLLECTION_SOURCE_INVALID");
        return [put3(part(saved2.header)), put3(n, r)];
      } });
      const result = await batches.create({ branchId: r.branchId, at: r.selection.kind === "OPENING" ? r.period.untilExclusiveUtc : r.selection.at, orderIds: available.map((a) => a.orderId), previewId: preview.previewId, requestId: childRequestId(r), ...["OPENING", "OFF_CYCLE"].includes(r.selection.kind) ? r.selection : {} });
      const saved = await load({ branchId: r.branchId, collectionId: r.collectionId }, "READ");
      return { collection: publicRoot(saved.r), batchId: result.header.batchId, replayed: result.replayed };
    },
    async freeze(v) {
      if (!v || Object.keys(v).sort().join(",") !== "branchId,collectionId,version" || !Number.isSafeInteger(v.version)) return fail24();
      const { r, actor } = await load(v, "CREATE");
      if (v.version !== r.version || r.status !== "READY") return { collection: publicRoot(r), replayed: true };
      const n = next(r, { lastActorId: actor.actorId, status: "FREEZING", updatedAt: stamp() });
      await commit(r, actor, [put3(n, r)]);
      return { collection: publicRoot(n) };
    },
    async read(v) {
      if (!v || Object.keys(v).sort().join(",") !== "branchId,collectionId") return fail24();
      const { r } = await load(v, "READ");
      await authorize(r.branchId, "READ");
      return { collection: { ...publicRoot(r), sourceChanged: r.status === "FROZEN" ? false : await sourceChanged(r) } };
    },
    async list(v) {
      if (!v || Object.keys(v).sort().join(",") !== "branchId" || !quoteEntityIdValid(v.branchId)) return fail24();
      await authorize(v.branchId, "READ");
      const q = await db.send(new import_lib_dynamodb13.QueryCommand({ TableName: T4, ConsistentRead: true, KeyConditionExpression: "pk=:pk AND begins_with(sk,:prefix)", ExpressionAttributeValues: { ":pk": pk2(v.branchId), ":prefix": "LIST#" }, Limit: 20, ScanIndexForward: false }));
      const items = [];
      for (const entry of q.Items || []) {
        if (!validSeal2(entry) || entry.kind !== "MERCHANT_COLLECTION_LOOKUP" || entry.branchId !== v.branchId || entry.sk !== "LIST#" + entry.createdAt + "#" + entry.collectionId) return fail24("SETTLEMENT_COLLECTION_PROOF_INVALID");
        const root = validate(await strongGet(db, T4, rootKey(v.branchId, entry.collectionId)), v.branchId, entry.collectionId);
        if (root.createdAt !== entry.createdAt) return fail24("SETTLEMENT_COLLECTION_PROOF_INVALID");
        items.push(publicRoot(root));
      }
      await authorize(v.branchId, "READ");
      return { items, moreAvailable: !!q.LastEvaluatedKey };
    },
    async parts(v) {
      if (!v || Object.keys(v).some((k) => !["branchId", "collectionId", "cursor"].includes(k))) return fail24();
      const { r } = await load(v, "READ");
      let start;
      if (v.cursor) {
        try {
          start = JSON.parse(Buffer.from(v.cursor, "base64url").toString());
          if (start.pk !== pk2(r.branchId) || typeof start.sk !== "string" || !start.sk.startsWith("PART#" + r.collectionId + "#") || Object.keys(start).sort().join(",") !== "pk,sk") return fail24();
        } catch {
          return fail24();
        }
      }
      const q = await db.send(new import_lib_dynamodb13.QueryCommand({ TableName: T4, ConsistentRead: true, KeyConditionExpression: "pk=:pk AND begins_with(sk,:prefix)", ExpressionAttributeValues: { ":pk": pk2(r.branchId), ":prefix": "PART#" + r.collectionId + "#" }, Limit: 20, ...start ? { ExclusiveStartKey: start } : {} }));
      for (const p of q.Items || []) if (!validSeal2(p) || p.kind !== "MERCHANT_COLLECTION_PART" || p.collectionId !== r.collectionId || p.branchId !== r.branchId) return fail24("SETTLEMENT_COLLECTION_PROOF_INVALID");
      await authorize(r.branchId, "READ");
      return { items: q.Items || [], nextCursor: q.LastEvaluatedKey ? Buffer.from(JSON.stringify(q.LastEvaluatedKey)).toString("base64url") : null, collection: publicRoot(r) };
    }
  };
}

// backend/wallet-service/src/merchantPayoutDeviceAuthority.ts
var import_lib_dynamodb14 = require("@aws-sdk/lib-dynamodb");
var devices = require_branch_devices();
var fail25 = (code, status = 403) => {
  throw Object.assign(Error(code), { code, status });
};
var merchantSettlementPermission = (method, input) => {
  if (method === "GET") return input.view === "merchant-account" ? "reports.finance.read" : ["payouts", "payout", "payout-statements", "payout-statement", "payout-context"].includes(input.view) ? "wallet.settlements.read" : fail25("PAYOUT_PERMISSION_REQUIRED");
  if (method !== "POST") return fail25("PAYOUT_PERMISSION_REQUIRED");
  if (["REQUEST_PAYOUT", "CANCEL_PAYOUT"].includes(input.action)) return "finance.payout.request";
  if (["ACK_PAYOUT_RECEIPT", "ACK_PAYOUT_NOT_RECEIVED", "REPORT_PAYOUT_PROBLEM"].includes(input.action)) return "finance.payout.receive";
  return fail25("PAYOUT_OWNER_REQUIRED");
};
function createMerchantDevicePayoutAuthority(options) {
  const { db } = options, now = options.now || Date.now, required = merchantSettlementPermission(options.method, options.input);
  const runtimeDb = { send: (command) => {
    const q = command.input;
    if (!q?.Key || !["staging-MerchantPlatform", "staging-AccountDeletion", "WhizzMerchants_Businesses"].includes(q.TableName)) return db.send(command);
    const fields2 = q.TableName === "staging-AccountDeletion" ? ["pk", "sk"] : q.TableName === "WhizzMerchants_Businesses" ? ["businessId", "ownerId", "cognitoUserId", "status", "deletionRequestId", "deletedAt", "isDeleted", "businessName", "name"] : ["pk", "sk", "businessId", "ownerId", "subjectId", "membershipId", "displayName", "role", "status", "version", "permissionSchema", "extraPermissions", "grant", "deviceId", "deviceVersion", "sessionId", "membershipVersion", "pinVersion", "tokenHash", "expiresAt", "maxExpiresAt", "deletionRequestId", "deletedAt", "isDeleted"];
    const names = Object.fromEntries(fields2.map((field, n) => ["#p" + n, field]));
    return db.send(new import_lib_dynamodb14.GetCommand({ ...q, ProjectionExpression: Object.keys(names).join(","), ExpressionAttributeNames: names }));
  } };
  return async (branchId, action) => {
    if (!["READ", "OWNER"].includes(action)) return fail25("PAYOUT_PERMISSION_REQUIRED");
    const event = { headers: { Authorization: "Bearer " + options.deviceToken, "X-Staff-Session": options.staffSession } }, access = await devices.reception(runtimeDb, options.deviceToken), { b, d } = access;
    if (b.businessId !== branchId || options.input.branchId !== branchId) return fail25("PAYOUT_BRANCH_SCOPE_REQUIRED");
    const staff = await devices.employeeAccess(runtimeDb, event, access), { s, m, authorization } = staff;
    if (m.permissionSchema !== 2 || !authorization || s.ownerId !== b.ownerId) return fail25("PAYOUT_EXPLICIT_STAFF_GRANT_REQUIRED");
    if (!authorization.permissions.includes(required) || !authorization.permissions.includes("branch.read")) return fail25("PAYOUT_PERMISSION_REQUIRED");
    const epoch = Math.floor(now() / 1e3);
    if (!Number.isSafeInteger(s.maxExpiresAt) || s.maxExpiresAt <= epoch) return fail25("SESSION_REVOKED", 401);
    const pin = (await runtimeDb.send(new import_lib_dynamodb14.GetCommand({ TableName: "staging-MerchantPlatform", Key: { pk: "BRANCH#" + b.businessId, sk: "PIN#" + s.subjectId }, ConsistentRead: true }))).Item;
    if (!pin || pin.status !== "ACTIVE") return fail25("SESSION_REVOKED", 401);
    const person = (await db.send(new import_lib_dynamodb14.GetCommand({ TableName: "staging-MerchantPlatform", Key: { pk: "PERSON#" + s.subjectId, sk: "PROFILE" }, ConsistentRead: true, ProjectionExpression: "pk,sk,subjectId,#name,#version", ExpressionAttributeNames: { "#name": "name", "#version": "version" } }))).Item;
    if (!person || person.subjectId !== s.subjectId || typeof person.name !== "string" || !person.name.trim()) return fail25("PAYOUT_RECIPIENT_PROFILE_REQUIRED");
    const guards = [...devices.guards(b), ...staff.common, exactCheck("staging-MerchantPlatform", { pk: pin.pk, sk: pin.sk }, pin), exactCheck("staging-MerchantPlatform", { pk: d.pk, sk: d.sk }, d), exactCheck("staging-MerchantPlatform", { pk: s.pk, sk: s.sk }, s), exactCheck("staging-MerchantPlatform", { pk: m.pk, sk: m.sk }, m), exactCheck("staging-MerchantPlatform", { pk: person.pk, sk: person.sk }, person)];
    return { actorId: s.subjectId, owner: false, merchantStaff: true, ownerId: b.ownerId, guards: cashAccountingDeduplicate(guards), merchantIdentity: { subjectId: s.subjectId, name: person.name, role: m.grant.roleId, roleLabel: m.grant.roleNameAr, businessId: b.businessId, businessName: b.businessName || b.name, ownerId: b.ownerId, membershipId: m.membershipId, membershipVersion: m.version, policyVersion: authorization.policy.version, roleVersion: m.grant.roleVersion, deviceId: d.deviceId }, permissions: authorization.permissions };
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  assembleMerchantSettlementPreview,
  cashAccountingDeduplicate,
  createMerchantDevicePayoutAuthority,
  createMerchantOpeningScheduleReader,
  createMerchantPayoutApi,
  createMerchantPeriodCollection,
  createMerchantSettlementAuthority,
  createMerchantSettlementBatchService,
  createMerchantSettlementScheduleHistoryReader,
  createMerchantSettlementScheduleWorkflow,
  createMerchantStatementsAdmin,
  merchantOffCyclePeriod,
  merchantOpeningPeriod,
  merchantSettlementPeriod,
  merchantSettlementPermission,
  readMerchantAccrualEvidence,
  verifyMerchantPayoutJournal
});
