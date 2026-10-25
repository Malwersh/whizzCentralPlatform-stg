// Captured deployed reader module after the 2026-10-25 repair. No live data.
var require_order_exception_cases = __commonJS({
  "backend/staff-service/order-exception-cases.js"(exports2, module2) {
    "use strict";
    var { GetCommand: GetCommand2, QueryCommand, ScanCommand: ScanCommand2 } = require_dist_cjs60();
    var PATH = "/staff/order-exceptions";
    var HOLDS = "staging-Holds";
    var ORDERS = "WizzOrders";
    var LIFECYCLE = "staging-WalletLifecycle";
    var id = /* @__PURE__ */ __name((v7) => typeof v7 === "string" && /^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v7), "id");
    var fail2 = /* @__PURE__ */ __name((code, status = 409) => Object.assign(Error(code), { status }), "fail");
    function project(order, row, financial) {
      const r7 = row.exceptionResolution, base = row.kind === "CUSTOMER_CASH_REVIEW_CASE" ? { caseId: row.caseId, type: "CUSTOMER_CASH_REVIEW", status: row.state, reason: "\u0645\u0631\u0627\u062C\u0639\u0629 \u0645\u0628\u0644\u063A \u0627\u0644\u062F\u0641\u0639 \u0648\u0631\u062F \u0623\u0645\u0648\u0627\u0644 \u0627\u0644\u0632\u0628\u0648\u0646", responsibility: "UNDETERMINED", customerCash: financial ? { reports: row.reports || [], collectionVerification: row.collectionVerification || null, refunds: row.refunds?.refunds || [], shortfallDecision: row.shortfallDecision || null, adjudication: row.adjudication || null, contactAttempts: row.contactAttempts || [] } : null } : ["CUSTOMER_CANCELLATION", "MERCHANT_CANCELLATION"].includes(row.kind) ? { caseId: row.caseId, type: row.kind, status: row.financialClosure ? "RESOLVED" : row.settlementStatus === "REVIEW" ? "SETTLEMENT_PENDING" : row.state, commercialCancellationState: row.state, linkedCaseId: row.linkedCaseId || null, reason: row.reason, responsibility: row.responsibility || "UNDETERMINED", merchantRetentionProof: row.merchantRetentionProof || null } : r7 ? { caseId: r7.caseId, type: r7.type, status: r7.status, reason: r7.allegedReason, responsibility: r7.responsibility, custody: r7.custody, returnStatus: row.status, returnItems: row.itemManifest ? { manifest: row.itemManifest, receipt: row.itemReceipt || null, origin: row.itemCustodyOrigin || null, plan: row.itemCustodyPlan || null, execution: row.itemExecution || null, recipients: row.itemRecipients || {} } : null, branchReadiness: row.branchReadiness || null, disposition: row.disposition || null, automaticReturnAssessment: row.automaticReturnAssessment || null, handoverIssue: row.handoverIssue || null, returnInstructions: row.returnInstructions || null, returnReceipt: row.confirmedAt ? { allItemsReceived: row.allItemsReceived, condition: row.condition, driverResponsibility: row.driverResponsibility, confirmedAt: row.confirmedAt } : null, taskCompletion: row.taskCompletion || null } : row.kind === "COD_RETURN_CASE" ? { caseId: "LEGACY:" + row.returnId, type: "LEGACY_DELIVERY_EXCEPTION", status: "LEGACY_POLICY_REVIEW", reason: row.reason, responsibility: "UNDETERMINED", custody: { state: row.status === "CONFIRMED" ? "RETURNED_TO_MERCHANT" : row.status, verified: row.status === "CONFIRMED" }, requiresExplicitPolicyReview: true } : null;
      if (!base) return null;
      const phase = row.activePhase, now = Date.now(), response2 = phase && !phase.respondedAt && Date.parse(phase.responseDueAt) < now, escalated = phase && Date.parse(phase.escalationDueAt) < now;
      return { ...base, orderId: order.orderId, orderNumber: order.orderNumber || order.orderNumber_gsi || order.orderId, branchId: order.storeId, branchName: order.storeName || order.restaurantName || "\u0645\u062A\u062C\u0631 \u0627\u0644\u0637\u0644\u0628", orderStatus: order.status, caseKey: row.sk, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt || row.completedAt || row.createdAt, activeResponsibilityFindingId: row.activeResponsibilityFindingId || null, driverPerformanceDecisions: row.driverPerformanceDecisions || [], caseAppeals: row.caseAppeals || [], appealReviewRequired: row.appealReviewRequired || null, priority: phase?.priority || "CUSTODY", sla: phase ? { ...phase, responseOverdue: !!response2, escalationOverdue: !!escalated } : null, policyVersion: row.policyVersion || r7?.policyVersion, casePolicyVersion: row.casePolicySnapshot?.policyVersion || null, evidenceIds: row.evidenceIds || [], evidenceRequest: row.evidenceRequest || null, ...financial ? { exceptionFinancials: { entitlementDecision: row.entitlementDecision || null, entitlementsPosted: row.entitlementsPosted || null, guaranteeDecision: row.guaranteeDecision || null, guaranteeResolution: row.guaranteeResolution || null, financialClosure: row.financialClosure || null }, guaranteeBalance: row.guaranteeResolution || { original: order.holdAmount ?? 0, released: order.holdStatus === "RELEASED" ? order.holdAmount ?? 0 : 0, captured: 0, remaining: order.holdStatus === "ACTIVE" ? order.holdAmount ?? 0 : 0 }, financialModel: order.financialSnapshot?.schemaVersion === 3 ? "FULL_CASH" : "LEGACY", guaranteeReview: row.guaranteeReview || null, holdStatus: order.holdStatus || null, holdAmount: order.holdAmount ?? null, driverFare: r7?.driverOriginalFare || row.driverFare || { status: "REVIEW" }, returnExtraFare: r7?.driverReturnExtraFare || { amount: 0, status: "NOT_APPLICABLE" }, merchantCompensation: r7?.merchantCompensation || row.merchantCompensation || { status: "REVIEW" }, customerFee: row.customerFee ?? 0, cash: r7?.cash || { state: "UNPAID", actuallyCollected: 0, actuallyRefunded: 0 } } : {} };
    }
    __name(project, "project");
    async function route(ctx, actor, method, path, input = {}) {
      if (actor.scope?.allRegions !== true || !ctx.allowed(actor, "orders.read") && !ctx.allowed(actor, "finance.read")) throw fail2("PERMISSION_REQUIRED", 403);
      const financial = ctx.allowed(actor, "finance.read"), get3 = /* @__PURE__ */ __name(async (table2, key2) => (await ctx.db.send(new GetCommand2({ TableName: table2, Key: key2, ConsistentRead: true }))).Item, "get");
      const resolveOrder = /* @__PURE__ */ __name(async (value) => {
        if (!id(value)) throw fail2("INVALID_EXCEPTION_SELECTOR", 400);
        if (!/^ORD[0-9]{10,20}$/i.test(value)) return value;
        const config = ctx.publicOrderIndex || require_order_number_index_232();
        const r7 = await ctx.db.send(new QueryCommand({ TableName: ORDERS, IndexName: config.indexName, KeyConditionExpression: "#number=:number", ExpressionAttributeNames: { "#number": config.partitionKey }, ExpressionAttributeValues: { ":number": value.toUpperCase() }, Limit: 2 }));
        const found = (r7.Items || []).filter((x7) => x7.SK === "META" && typeof x7.PK === "string" && x7.PK.startsWith("ORDER#"));
        if (found.length !== 1) throw fail2(found.length ? "ORDER_NUMBER_AMBIGUOUS" : "EXCEPTION_CASE_UNAVAILABLE");
        const resolved = found[0].orderId || found[0].PK.slice(6), verified = await get3(ORDERS, { PK: "ORDER#" + resolved, SK: "META" });
        if (!verified || verified.orderId !== resolved || verified[config.partitionKey] !== value.toUpperCase()) throw fail2("EXCEPTION_CASE_UNAVAILABLE");
        return resolved;
      }, "resolveOrder");
      const readCase = /* @__PURE__ */ __name(async (orderId, caseKey) => {
        orderId = await resolveOrder(orderId);
        if (!id(orderId) || !["CUSTOMER_CANCELLATION", "MERCHANT_CANCELLATION", "CUSTOMER_CASH_REVIEW"].includes(caseKey) && !/^RETURN#[1-9][0-9]{0,2}$/.test(caseKey || "")) throw fail2("INVALID_EXCEPTION_SELECTOR", 400);
        const [order, row] = await Promise.all([get3(ORDERS, { PK: "ORDER#" + orderId, SK: "META" }), get3(HOLDS, { orderId, sk: caseKey })]);
        if (!order || !row || order.orderId !== orderId || row.orderId !== orderId) throw fail2("EXCEPTION_CASE_UNAVAILABLE");
        return { order, row };
      }, "readCase");
      if (method === "GET" && path === PATH + "/custodians") {
        if (!ctx.allowed(actor, "orders.cancel") && !ctx.allowed(actor, "finance.approve")) throw fail2("PERMISSION_REQUIRED", 403);
        const out = [];
        let cursor3, pages = 0;
        do {
          const result = await ctx.db.send(new ScanCommand2({ TableName: "staging-PlatformStaff", ConsistentRead: true, Limit: 100, ExclusiveStartKey: cursor3, FilterExpression: "begins_with(pk,:prefix) AND sk=:profile", ExpressionAttributeValues: { ":prefix": "EMPLOYEE#", ":profile": "PROFILE" } }));
          for (const e7 of result.Items || []) if (e7.pk === "EMPLOYEE#" + e7.employeeId && e7.status === "ACTIVE" && e7.scope?.allRegions === true && e7.deletedAt == null && e7.deletionRequestId == null && e7.isDeleted !== true && (ctx.allowed(e7, "orders.cancel") || ctx.allowed(e7, "finance.approve"))) out.push({ employeeId: e7.employeeId, name: [e7.fullName, e7.displayName, e7.name].find((n7) => typeof n7 === "string" && n7.trim() && !n7.includes("@")) || "\u0627\u0644\u0627\u0633\u0645 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644", jobTitle: e7.jobTitle || (e7.roles || []).map((r7) => require_catalog().LABELS[r7]).filter(Boolean).join("\u060C ") || "\u0645\u0648\u0638\u0641 \u0625\u062F\u0627\u0631\u064A" });
          cursor3 = result.LastEvaluatedKey;
          if (++pages > 50 || out.length > 500) throw fail2("CUSTODIANS_INCOMPLETE", 503);
        } while (cursor3);
        return { items: out };
      }
      if (method === "GET" && path === PATH) {
        const q7 = ctx.query || {};
        if (q7.orderId) {
          const resolved = await resolveOrder(q7.orderId);
          const order = await get3(ORDERS, { PK: "ORDER#" + resolved, SK: "META" });
          if (!order) throw fail2("EXCEPTION_CASE_UNAVAILABLE");
          const rows = [];
          let cursor4;
          do {
            const result2 = await ctx.db.send(new QueryCommand({ TableName: HOLDS, KeyConditionExpression: "orderId=:order", ExpressionAttributeValues: { ":order": resolved }, ConsistentRead: true, ExclusiveStartKey: cursor4, Limit: 100 }));
            rows.push(...result2.Items || []);
            cursor4 = result2.LastEvaluatedKey;
            if (rows.length > 1e3) throw fail2("EXCEPTION_HISTORY_TOO_LARGE", 503);
          } while (cursor4);
          return { items: rows.map((r7) => project(order, r7, financial)).filter(Boolean), source: "ORDER_LOOKUP", serverNow: (/* @__PURE__ */ new Date()).toISOString(), canOperate: ctx.allowed(actor, "orders.cancel") || ctx.allowed(actor, "finance.approve") };
        }
        let cursor3;
        if (q7.cursor) {
          try {
            if (q7.cursor.length > 3e3) throw Error();
            const c7 = JSON.parse(Buffer.from(q7.cursor, "base64url").toString());
            if (c7.actorId !== actor.employeeId || c7.version !== actor.version || c7.key?.queuePartition !== "ORDER_EXCEPTIONS_OPEN" || !id(c7.key?.operationId) || !Number.isFinite(c7.key?.nextAttemptAt) || Object.keys(c7.key).sort().join(",") !== "nextAttemptAt,operationId,queuePartition") throw Error();
            cursor3 = c7.key;
          } catch {
            throw fail2("INVALID_CURSOR", 400);
          }
        }
        const result = await ctx.db.send(new QueryCommand({ TableName: LIFECYCLE, IndexName: "ByDue", KeyConditionExpression: "queuePartition=:queue", ExpressionAttributeValues: { ":queue": "ORDER_EXCEPTIONS_OPEN" }, Limit: 25, ExclusiveStartKey: cursor3 })), items = [];
        for (const pointer of result.Items || []) {
          if (pointer.kind !== "ORDER_EXCEPTION_CASE_POINTER" || !id(pointer.orderId)) continue;
          try {
            const c7 = await readCase(pointer.orderId, pointer.caseKey), view = project(c7.order, c7.row, financial);
            if (view) items.push(view);
          } catch (e7) {
            if (!["EXCEPTION_CASE_UNAVAILABLE", "INVALID_EXCEPTION_SELECTOR"].includes(e7.message)) throw e7;
            items.push({ caseId: pointer.caseId, orderId: pointer.orderId, orderNumber: pointer.orderId, caseKey: pointer.caseKey, type: "INDEX_REVIEW", status: "REFERENCE_REVIEW", orderStatus: "UNKNOWN", version: pointer.version, createdAt: pointer.createdAt });
          }
        }
        return { items, nextCursor: result.LastEvaluatedKey ? Buffer.from(JSON.stringify({ actorId: actor.employeeId, version: actor.version, key: result.LastEvaluatedKey })).toString("base64url") : null, serverNow: (/* @__PURE__ */ new Date()).toISOString(), canOperate: ctx.allowed(actor, "orders.cancel") || ctx.allowed(actor, "finance.approve") };
      }
      if (method === "GET" && path === PATH + "/detail") {
        const q7 = ctx.query || {}, c7 = await readCase(q7.orderId, q7.caseKey), item = project(c7.order, c7.row, financial);
        if (!item) throw fail2("EXCEPTION_CASE_UNAVAILABLE");
        const events = [], performanceAssignments = [];
        let cursor3, pages = 0;
        do {
          const r7 = await ctx.db.send(new QueryCommand({ TableName: HOLDS, KeyConditionExpression: "orderId=:order", ExpressionAttributeValues: { ":order": c7.order.orderId }, ExclusiveStartKey: cursor3, ConsistentRead: true, Limit: 100 }));
          for(const a of r7.Items||[])if(a.kind==='COD_ASSIGNMENT_RELEASE'&&a.orderId===c7.order.orderId&&typeof a.driverId==='string'&&typeof a.offerId==='string'&&Number.isSafeInteger(a.attempt))performanceAssignments.push({driverId:a.driverId,offerId:a.offerId,attempt:a.attempt,outcome:a.outcome,reportedReason:a.driverReportedReason||null});
          events.push(...(r7.Items || []).filter((x7) => x7.caseId === item.caseId && ["ORDER_EXCEPTION_EVIDENCE", "ORDER_EXCEPTION_DECISION", "ORDER_EXCEPTION_CASE_EVENT", "ORDER_EXCEPTION_FINDING", "DRIVER_PERFORMANCE_DECISION_EVENT"].includes(x7.kind)));
          cursor3 = r7.LastEvaluatedKey;
          if (events.length > 500 || ++pages > 10) throw fail2("EXCEPTION_HISTORY_TOO_LARGE", 503);
        } while (cursor3);
        if(c7.order.driverId&&c7.order.financialAcceptance?.offerId&&Number.isSafeInteger(c7.order.assignmentAttemptCounter)&&['cancelled','canceled','returned'].includes(c7.order.status)&&!performanceAssignments.some(a=>a.offerId===c7.order.financialAcceptance.offerId))performanceAssignments.push({driverId:c7.order.driverId,offerId:c7.order.financialAcceptance.offerId,attempt:c7.order.assignmentAttemptCounter,outcome:c7.order.status.toUpperCase(),reportedReason:null});
        item.performanceAssignments=performanceAssignments;
        if (financial && c7.row.entitlementsPosted?.merchantCompensationIqd) {
          const payable = await get3(HOLDS, { orderId: c7.order.orderId, sk: "MERCHANT_PAYABLE" });
          if (payable && payable.operationId === c7.row.entitlementsPosted.operationId && payable.amount === c7.row.entitlementsPosted.merchantCompensationIqd) {
            item.merchantSettlement = { status: payable.status, batchId: payable.settlementBatchId || null, payoutId: payable.paidPayoutId || null, paidAt: payable.paidAt || null };
          }
          if (payable?.status === "PAID") {
            const paid = await get3("staging-MerchantPlatform", { pk: "MERCHANT_PAYOUT_PAID#" + payable.paidPayoutId, sk: "META" });
            require_settlement_runtime().verifyMerchantPayoutJournal(paid, c7.order.storeId, payable);
            item.merchantCompensation = { ...item.merchantCompensation, paymentStatus: "PAID", paidAt: payable.paidAt };
          }
        }
        const monitoring = item.requiresExplicitPolicyReview ? null : await get3(LIFECYCLE, { operationId: "EXCEPTION_CASE#" + item.caseId });
        return { item, ...c7.row.kind === "CUSTOMER_CASH_REVIEW_CASE" ? { cashPermissions: { operate: ctx.allowed(actor, "orders.cancel") || ctx.allowed(actor, "finance.approve"), approve: ctx.allowed(actor, "finance.approve"), execute: ctx.allowed(actor, "finance.request") } } : {}, canReleaseGuarantee: ctx.allowed(actor, "finance.approve"), events: financial ? events : events.map((e7) => Object.fromEntries(["kind", "caseId", "evidenceId", "type", "actorId", "actorKind", "action", "reason", "createdAt", "proof", "findingId", "allocations", "evidenceIds", "supersedesFindingId", "decisionStatus", "noAutomaticCharge", "plan", "driverId", "offerId", "attempt", "decisionId", "decision", "supersedesDecisionId"].filter((k7) => e7[k7] !== void 0).map((k7) => [k7, e7[k7]]))), monitoring: monitoring && monitoring.monitoringPhaseStartedAt === c7.row.activePhase?.startedAt && monitoring.monitoringPriority === c7.row.activePhase?.priority ? { responseAlertAt: monitoring.responseAlertAt || null, escalatedAt: monitoring.escalatedAt || null, status: monitoring.monitoringStatus || null } : null, serverNow: (/* @__PURE__ */ new Date()).toISOString() };
      }
      if (method === "POST" && path === PATH + "/actions") {
        if (!ctx.enrolled) throw fail2("ENROLLMENT_REQUIRED", 403);
        ctx.recent(ctx.claims);
        const cashExecution = input.caseKey === "CUSTOMER_CASH_REVIEW" && ["EXECUTE_CUSTOMER_REFUND", "EXECUTE_CASH_ADJUDICATION"].includes(input.action) && ctx.allowed(actor, "finance.request");
        if (!ctx.allowed(actor, "orders.cancel") && !ctx.allowed(actor, "finance.approve") && !cashExecution) throw fail2("PERMISSION_REQUIRED", 403);
        return require_order_exception_case_client().invoke(ctx.accessToken, input.caseKey === "CUSTOMER_CASH_REVIEW" && input.action === "OPEN_CASH_REVIEW" ? { ...input, orderId: await resolveOrder(input.orderId) } : input);
      }
      throw fail2("NOT_FOUND", 404);
    }
    __name(route, "route");
    module2.exports = { route, project, PATH };
  }
});
