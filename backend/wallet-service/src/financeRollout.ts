import {financialRecoveryProof} from './financeDispatchRecovery';
import {composeDispatchTransaction} from './dispatchTransaction';
import {financialDispatchTables,isFinancialOrderProduction,walletNotificationTable} from './walletBindings';
import {checkoutTables,requiredQuoteReferences} from './checkoutTables';
import {
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { quoteHash, quoteCanonical } from "./deliveryQuoteRecord";
import {gunzipSync} from 'node:zlib';
type Row = Record<string, any>;
type DB = Pick<DynamoDBDocumentClient, "send">;
const {PRODUCTION_SNAPSHOT_TABLE}=require('../../driver-performance-projection/bindings');

export class FinanceRolloutError extends Error {
  readonly statusCode: number;
  constructor(public readonly code: string) {
    super(code);
    this.statusCode = code === "FINANCE_ROLLOUT_NOT_CONFIGURED" ? 503 : 403;
    this.name = "FinanceRolloutError";
  }
}
const fail = (code = "FINANCE_ROLLOUT_OUT_OF_SCOPE"): never => {
  throw new FinanceRolloutError(code);
};
const id = (v: any) =>
  typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(v);
function operation(command: any): string {
  if (command instanceof GetCommand) return "GetItem";
  if (command instanceof QueryCommand) return "Query";
  if (command instanceof ScanCommand) return "Scan";
  if (command instanceof TransactWriteCommand) return "TransactWriteItems";
  // The staff reader and wallet runtime carry separate installed SDK copies.
  // Smithy's operation schema survives bundling/name changes. Unknown/older
  // representations stay closed; never infer an operation from user input.
  const schema = command?.clientCommand?.schema;
  if (typeof command?.resolveMiddleware === "function" &&
      typeof command?.middlewareStack?.clone === "function" &&
      Array.isArray(schema) && schema[0] === 9 && schema[1] === "com.amazonaws.dynamodb" &&
      ["GetItem", "Query", "Scan", "TransactWriteItems"].includes(schema[2])) return schema[2];
  return fail();
}
function exact(v: any, fields: string[]) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(",") !== [...fields].sort().join(",")
  )
    fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
}
/** Explicit future order IDs, never prefixes or client enrollment. Missing config
 * is closed. DRAIN retains existing order processing after admission expires. */
export function readFinanceRollout(env: Row = process.env) {
  try {
    let raw = env.FINANCE_ROLLOUT_CONFIG;
    // Native support also keeps ordinary source builds compatible with the
    // compressed historical environment, independently of deployment wrappers.
    if(typeof raw==='string'&&raw.startsWith('GZIP208:')){
      const encoded=raw.slice(8);
      if(encoded.length>16384||! /^[A-Za-z0-9+/]+={0,2}$/.test(encoded))fail('FINANCE_ROLLOUT_NOT_CONFIGURED');
      const bytes=Buffer.from(encoded,'base64');
      if(bytes.toString('base64')!==encoded)fail('FINANCE_ROLLOUT_NOT_CONFIGURED');
      raw=gunzipSync(bytes,{maxOutputLength:12000}).toString('utf8');
    }
    if (typeof raw !== "string" || Buffer.byteLength(raw) > 12000)
      fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
    const c = JSON.parse(raw);
    const production = isFinancialOrderProduction(env);
    const generalProduction = production && env.FINANCE_GENERAL_RELEASE_MODE === 'REQUIRED' &&
      env.FINANCIAL_SETTLEMENT_MODEL === 'FULL_CASH_AT_DELIVERY_V1';
    exact(c, ["schemaVersion", "accountId", "region", "scopes"]);
    if (
      c.schemaVersion !== 1 ||
      c.accountId !== (production ? "746727375268" : "699561669180") ||
      c.region !== "us-east-1" ||
      env.AWS_REGION !== "us-east-1" ||
      (!production && ((env.STAGE ?? env.ENVIRONMENT) !== "staging" ||
        (env.STAGE !== undefined && env.STAGE !== "staging") ||
        (env.ENVIRONMENT !== undefined && env.ENVIRONMENT !== "staging"))) ||
      !Array.isArray(c.scopes) ||
      (!c.scopes.length && !generalProduction) ||
      // Match the already deployed archival reader: retain up to eight exact
      // historical scopes. This does not enroll or admit any new test order.
      c.scopes.length > 8 ||
      env.FINANCE_ROLLOUT_SHA256 !== quoteHash(c)
    )
      fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
    const scopes = new Set(),
      orders = new Set();
    for (const s of c.scopes) {
      exact(s, ["id", "version", "mode", "admitUntil", "orders", "drivers"]);
      if (
        !id(s.id) ||
        scopes.has(s.id + "#" + s.version) ||
        !Number.isSafeInteger(s.version) ||
        s.version < 1 ||
        !["SCOPED", "DRAIN"].includes(s.mode) ||
        typeof s.admitUntil !== "string" ||
        !Number.isFinite(Date.parse(s.admitUntil)) ||
        new Date(s.admitUntil).toISOString() !== s.admitUntil ||
        !Array.isArray(s.orders) ||
        !s.orders.length ||
        s.orders.length > 10 ||
        !Array.isArray(s.drivers) ||
        !s.drivers.length ||
        s.drivers.length > 10
      )
        fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
      scopes.add(s.id + "#" + s.version);
      const drivers = new Set(),
        subjects = new Set();
      for (const d of s.drivers) {
        exact(d, ["driverId", "subjectId"]);
        if (
          !id(d.driverId) ||
          !id(d.subjectId) ||
          drivers.has(d.driverId) ||
          subjects.has(d.subjectId)
        )
          fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
        drivers.add(d.driverId);
        subjects.add(d.subjectId);
      }
      for (const o of s.orders) {
        exact(o, ["orderId", "branchId", "customerSubjectId"]);
        if (
          ![o.orderId, o.branchId, o.customerSubjectId].every(id) ||
          orders.has(o.orderId)
        )
          fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
        orders.add(o.orderId);
      }
    }
    return c as {
      scopes: {
        id: string;
        version: number;
        mode: string;
        admitUntil: string;
        orders: {
          orderId: string;
          branchId: string;
          customerSubjectId: string;
        }[];
        drivers: { driverId: string; subjectId: string }[];
      }[];
    };
  } catch (e) {
    if (e instanceof FinanceRolloutError) throw e;
    return fail("FINANCE_ROLLOUT_NOT_CONFIGURED");
  }
}
/** Supplement, never replace, authentication and existing financial guards. */
export function createFinanceRollout(options: {
  db: DB;
  env?: Row;
  now?: () => number;
  checkout?: boolean;
  merchantResponse?: boolean;
  dispatch?: boolean;
  completion?: boolean;
  cancellationCompensation?: boolean;
  returns?: boolean;
  cashReview?: boolean;
}) {
  const { db } = options,
    config = readFinanceRollout(options.env),
    now = options.now ?? Date.now;
  const env=options.env??process.env;
  const production=isFinancialOrderProduction(env);
  const tables=financialDispatchTables(env);
  const allowedTables=production ? new Set(Object.values(tables)) : null;
  const checkout=production&&options.checkout ? checkoutTables(env) : null;
  const responseTables=production&&options.merchantResponse ? checkoutTables(env) : null;
  const dispatchTables=production&&options.dispatch ? checkoutTables(env) : null;
  const cancellationCompensation = production && options.cancellationCompensation === true;
  const returns = production && options.returns === true;
  const cashReview = production && options.cashReview === true;
  const returnNoticeTable=returns ? walletNotificationTable(env) : null;
  const completionTable=production&&(options.completion || cancellationCompensation || returns) ? checkoutTables(env).platform : null;
  if (completionTable && allowedTables!.has(completionTable)) fail('FINANCE_ROLLOUT_NOT_CONFIGURED');
  const dispatchRegions=new Set(dispatchTables
    ? [dispatchTables.regions,dispatchTables.derived,dispatchTables.neighbors] : []);
  const dispatchReadOnly=new Set(dispatchTables
    ? [...dispatchRegions,'wizz-production-OrderConnections',
       ...(env.DRIVER_PERFORMANCE_TABLE===PRODUCTION_SNAPSHOT_TABLE
         ? [env.DRIVER_PERFORMANCE_TABLE] : [])] : []);
  const checkoutReferences=new Set(checkout ? [
    ...requiredQuoteReferences(checkout),checkout.platform,checkout.customers,checkout.products,checkout.categories,checkout.neighbors,
    checkout.merchantDiscounts,checkout.platformDiscounts
  ] : []);
  if(checkout && (tables.quotes!==checkout.quotes || tables.orders!==checkout.orders ||
      tables.branch!==checkout.branches || tables.deletion!==checkout.deletion ||
      tables.staff!==checkout.policy || tables.holds!==checkout.holds ||
      tables.offerJourney!==checkout.journey || tables.jobs!==checkout.dispatchJobs ||
      tables.lifecycle!==checkout.lifecycle || tables.ledger!==checkout.ledger || tables.audit!==checkout.audit))fail('FINANCE_ROLLOUT_NOT_CONFIGURED');
  const checkoutMutation = (item: Row) => !!checkout && (
    (item.Update && [checkout.products, checkout.merchantDiscounts, checkout.platformDiscounts].includes(item.Update.TableName)) ||
    (item.Put?.TableName === checkout.platform &&
      item.Put.Item?.pk === 'BRANCH#' + item.Put.Item?.businessId &&
      item.Put.Item?.sk === 'INVENTORY_RESERVATION#' + item.Put.Item?.orderId)
  );
  const responseDiscountTables=new Set(responseTables?[responseTables.merchantDiscounts,responseTables.platformDiscounts]:[]);
  const responseDiscountOperation = (item:Row) =>
    (item.ConditionCheck?.Key?.discountId && responseDiscountTables.has(item.ConditionCheck.TableName)) ||
    (item.Put?.Item?.discountId && responseDiscountTables.has(item.Put.TableName));
  const generalScopeId=production ? 'GENERAL_PRODUCTION_FULL_CASH_V1' : 'GENERAL_STAGING_FULL_CASH_V1';
  if(!['OFF','REQUIRED'].includes(env.FINANCE_GENERAL_RELEASE_MODE??'OFF'))fail('FINANCE_ROLLOUT_NOT_CONFIGURED');
  const general=env.FINANCE_GENERAL_RELEASE_MODE==='REQUIRED';
  if(general&&env.FINANCIAL_SETTLEMENT_MODEL!=='FULL_CASH_AT_DELIVERY_V1')fail('FINANCE_ROLLOUT_NOT_CONFIGURED');
  type Selection={scope:ReturnType<typeof readFinanceRollout>['scopes'][number];order:ReturnType<typeof readFinanceRollout>['scopes'][number]['orders'][number]};
  const generalScopes=new Map<string,Selection>();
  async function registerGeneral(row:Row,creating=false){
    const oid=row?.orderId,branch=row?.storeId??row?.businessId;
    if(!id(oid)||row.PK!=='ORDER#'+oid||row.SK!=='META'||!id(branch)||!id(row.userSub)||[row.storeId,row.businessId].some(v=>v!==undefined&&v!==branch)||row.deletionRequestId!=null||row.deletedAt!=null||row.isDeleted===true)fail();
    const historical=config.scopes.find(scope=>scope.orders.some(o=>o.orderId===oid));
    if(creating){
      if(!admission||admission.branchId!==branch||admission.subjectId!==row.userSub||row.financialSnapshot?.schemaVersion!==3||row.financialSnapshot?.settlementModel!=='FULL_CASH_AT_DELIVERY_V1')fail();
      const branchRow=(await db.send(new GetCommand({TableName:tables.branch,Key:{businessId:branch},ConsistentRead:true}))).Item;
      if(!branchRow||branchRow.businessId!==branch||branchRow.status!=='approved'||branchRow.ownerId!==branchRow.cognitoUserId||branchRow.deletionRequestId!=null||branchRow.deletedAt!=null||branchRow.isDeleted===true)fail();
    }else if(!historical&&(row.financeRollout?.schemaVersion!==2||row.financeRollout.scopeId!==generalScopeId))fail();
    if(historical)return;
    const member={orderId:oid,branchId:branch,customerSubjectId:row.userSub};
    generalScopes.set(oid,{scope:{id:generalScopeId,version:1,mode:'GENERAL',admitUntil:'9999-12-31T23:59:59.999Z',orders:[member],drivers:[]},order:member});
  }

  const freeze = (v: any): any => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  freeze(config);
  const recoveryActive=new Set<string>();
  const bindings = new Map<string, string>(),
    orders = new Map<string, Row>();
  let admission: { branchId: string; subjectId: string } | undefined;
  let activeOrder: string | undefined;
  const link = (table: string, key: Row) => quoteCanonical([table, key]);
  function selection(orderId: string):Selection {
    if(generalScopes.has(orderId))return generalScopes.get(orderId)!;
    const scope = config.scopes.find((s) =>
      s.orders.some((o) => o.orderId === orderId),
    );
    if (!scope) return fail();
    return { scope, order: scope.orders.find((o) => o.orderId === orderId)! };
  }
  function open(s: ReturnType<typeof selection>["scope"]) {
    if(general&&s.mode==='GENERAL')return;
    if (
      s.mode !== "SCOPED" ||
      !Number.isSafeInteger(now()) ||
      now() >= Date.parse(s.admitUntil)
    )
      fail("FINANCE_ROLLOUT_ADMISSION_CLOSED");
  }
  async function openExisting(orderId:string){
    if(general&&selection(orderId).scope.mode==='GENERAL')return [];
    const selected=selection(orderId),saved=orders.get(orderId);
    if(selected.scope.mode==='SCOPED'&&Number.isSafeInteger(now())&&now()<Date.parse(selected.scope.admitUntil))return [];
    // The original membership pin is mandatory; recovery cannot enroll an order.
    if(!saved?.financeRollout||quoteCanonical(saved.financeRollout)!==quoteCanonical(pin(selected.scope)))fail();
    const guards=await financialRecoveryProof(db,options.env??process.env,orderId,now());recoveryActive.add(orderId);return guards;
  }
  function customer(branchId: string, subjectId: string) {
    if (!id(branchId) || !id(subjectId) || !Number.isSafeInteger(now())) fail();
    if(general){admission={branchId,subjectId};return config.scopes;}
    const matches = config.scopes.filter((s) =>
      s.orders.some(
        (o) => o.branchId === branchId && o.customerSubjectId === subjectId,
      ),
    );
    if (!matches.length) fail();
    admission = { branchId, subjectId };
    return matches;
  }
  function admit(branchId: string, subjectId: string) {
    const matches = customer(branchId, subjectId);
    if(general)return;
    if (
      !matches.some(
        (s) => s.mode === "SCOPED" && now() < Date.parse(s.admitUntil),
      )
    )
      fail("FINANCE_ROLLOUT_ADMISSION_CLOSED");
  }

  function driver(orderId: string, driverId: string, subjectId?: string) {
    if(general&&selection(orderId).scope.mode==='GENERAL'){if(!id(driverId)||(subjectId!==undefined&&!id(subjectId)))fail();return;}
    if (
      !selection(orderId).scope.drivers.some(
        (d) =>
          d.driverId === driverId &&
          (subjectId === undefined || d.subjectId === subjectId),
      )
    )
      fail();
  }
  function subject(orderId: string, subjectId: string) {
    if(general&&selection(orderId).scope.mode==='GENERAL'){if(!id(subjectId))fail();return;}
    if (!selection(orderId).scope.drivers.some(d => d.subjectId === subjectId)) fail();
  }
  function pin(s: ReturnType<typeof selection>["scope"]) {
    if(s.mode==='GENERAL')return {schemaVersion:2,scopeId:s.id,version:s.version,digest:quoteHash({release:s.id,version:s.version,orders:s.orders})};
    return {
      schemaVersion: 1,
      scopeId: s.id,
      version: s.version,
      digest: quoteHash({
        id: s.id,
        version: s.version,
        orders: s.orders,
        drivers: s.drivers,
      }),
    };
  }
  function validate(row: Row, orderId: string) {
    const s = selection(orderId),
      o = s.order;
    if (
      !row ||
      row.orderId !== orderId ||
      row.PK !== "ORDER#" + orderId ||
      row.SK !== "META" ||
      row.userSub !== o.customerSubjectId ||
      !(row.storeId === o.branchId || row.businessId === o.branchId) ||
      [row.storeId, row.businessId].some(
        (v) => v !== undefined && v !== o.branchId,
      )
    )
      fail();
    if (
      row.financeRollout !== undefined &&
      quoteCanonical(row.financeRollout) !== quoteCanonical(pin(s.scope))
    )
      fail();
    checkDrivers(orderId, row);
    orders.set(orderId, JSON.parse(JSON.stringify(row)));
    activeOrder = orderId;
    return s;
  }
  async function order(
    orderId: string,
    intent: "ADMIT" | "OFFER" | "SEND" | "NOTIFY" | "DRAIN" = "DRAIN",
  ) {
    if(!general)selection(orderId);

    const r = await db.send(
      new GetCommand({
        TableName: tables.orders,
        Key: { PK: "ORDER#" + orderId, SK: "META" },
        ConsistentRead: true,
        ProjectionExpression:
        general?"PK,SK,orderId,userSub,storeId,businessId,financeRollout,driverId,assignedDriverId,deletionRequestId,deletedAt,isDeleted":"PK,SK,orderId,userSub,storeId,businessId,financeRollout,driverId,assignedDriverId",
      }),
    );
    if(general)await registerGeneral(r.Item??{});
    const s=selection(orderId);
    validate(r.Item ?? {}, orderId);
    if (!["DRAIN", "NOTIFY"].includes(intent)) await openExisting(orderId);
    if (["SEND", "NOTIFY"].includes(intent) && !r.Item?.financeRollout) fail();
    return s;
  }
  function orderId(row: Row | undefined): string | undefined {
    if (!row) return;
    const pk =
      typeof row.PK === "string" && row.PK.startsWith("ORDER#")
        ? row.PK.slice(6)
        : undefined;
    if (row.orderId !== undefined && pk !== undefined && row.orderId !== pk)
      fail();
    return typeof row.orderId === "string"
      ? row.orderId
      : (pk ??
          (typeof row.metadata?.orderId === "string"
            ? row.metadata.orderId
            : undefined));
  }
  function checkDrivers(oid: string, row: Row) {
    const branch = selection(oid).order.branchId;
    for (const k of ["branchId", "businessId", "storeId", "restaurantId"])
      if (row[k] != null && row[k] !== branch) fail();
    for (const k of ["driverId", "assignedDriverId", "dispatchDriverId", "financialDriverId"])
      if (row[k] != null) driver(oid, row[k]);
    if (row.driverSubjectId != null) driver(oid, row.driverId, row.driverSubjectId);
    if (row.financialOffer) {
      const fullCash = general || (production && env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1');
      const envelope=row.financialOffer,offer=[2,3].includes(envelope.schemaVersion)?envelope.baseOffer:envelope;
      if(!(fullCash?[1,2,3]:[1,2]).includes(envelope.schemaVersion)||!offer||offer.schemaVersion!==1||!id(offer.driverId)||!id(offer.driverSubjectId)||offer.orderId!==oid||offer.branchId!==branch||row.driverId!=null&&row.driverId!==offer.driverId)fail();
      driver(oid,offer.driverId,offer.driverSubjectId);
    }
    if (Array.isArray(row.driverIds))
      for (const d of row.driverIds) driver(oid, d);
  }
  function fence(oid: string) {
    const row = orders.get(oid);
    if (!row) return fail();
    const names: Row = {},
      values: Row = {},
      clauses: string[] = [];
    for (const [i, k] of [
      "orderId",
      "userSub",
      "storeId",
      "businessId",
      "financeRollout", "driverId", "assignedDriverId",
    ].entries()) {
      names["#roll" + i] = k;
      if (row[k] === undefined)
        clauses.push("attribute_not_exists(#roll" + i + ")");
      else {
        values[":roll" + i] = row[k];
        clauses.push("#roll" + i + "=:roll" + i);
      }
    }
    return {
      TableName: tables.orders,
      Key: { PK: row.PK, SK: row.SK },
      ConditionExpression: clauses.join(" AND "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    };
  }
  const cursor = (op: Row) =>
    (op.TableName === tables.jobs &&
      (op.Item ?? op.Key)?.orderId === "SYSTEM#DISPATCH_HOST" &&
      ((op.Item ?? op.Key)?.SK === "CURSOR#LEGACY" ||
        ((options.env ?? process.env).DISPATCH_FINANCIAL_HOST_MODE === "REQUIRED" &&
          (op.Item ?? op.Key)?.SK === "CURSOR#FINANCIAL"))) ||
    (op.TableName === tables.staff &&
      (op.Item ?? op.Key)?.pk === "CONTROL#DISPATCH_REVIEW_HOST" &&
      (op.Item ?? op.Key)?.sk === "CURSOR");
  function scopedCompletionRecord(op: Row, mutation: boolean) {
    if (!completionTable || op.TableName !== completionTable || !activeOrder) return false;
    const selected = selection(activeOrder).order;
    const record = mutation ? op.Item : op.Key;
    if (!record || typeof record.sk !== 'string') return false;
    if (record.pk === 'FULL_CASH_JOURNAL#' + activeOrder && record.sk === 'META') {
      if (!mutation) return cashReview;
      return options.completion === true && record.kind === 'FULL_CASH_ACCOUNTING_JOURNAL' &&
        record.orderId === activeOrder && record.branchId === selected.branchId;
    }
    if (record.pk !== 'MERCHANT_ACCRUAL#' + selected.branchId) return false;
    const head = record.sk === 'HEAD' || /^NODE#[1-9]#\d+$/.test(record.sk);
    if (!mutation) return head;
    if (record.branchId !== selected.branchId) return false;
    return head ? record.kind === 'MERCHANT_ACCRUAL_INDEX_HEAD' :
      record.kind === 'MERCHANT_ACCRUAL_INDEX_ENTRY' &&
      (options.completion === true || record.financialSchemaVersion === 5) &&
        record.orderId === activeOrder && record.sk === 'DELIVERED#' + record.deliveredAt + '#' + activeOrder;
  }
  function cancellationPayoutProof(op: Row) {
    return (cancellationCompensation || returns) && op.TableName === completionTable && activeOrder &&
      op.Key?.sk === 'META' && /^MERCHANT_PAYOUT_PAID#MPO:[a-f0-9]{48}$/.test(op.Key?.pk);
  }
  function returnConsent(op: Row, mutation: boolean) {
    if (!returns || op.TableName !== completionTable || !activeOrder) return false;
    const branchId = selection(activeOrder).order.branchId;
    const record = mutation ? op.Item : op.Key;
    return record?.pk === 'RETURN_ACCEPTANCE#' + branchId && record.sk === 'CURRENT' &&
      (!mutation || record.kind === 'RETURN_ACCEPTANCE_POLICY' && record.branchId === branchId);
  }
  function refundCashbox(op:Row,mutation:boolean){
    if (!cashReview || op.TableName!==completionTable || !activeOrder) return false;
    const row=mutation?op.Item:op.Key;
    if (!row || !/^MERCHANT_CASHBOX#[A-Z][A-Z0-9-]{2,39}$/.test(row.pk) || typeof row.sk!=='string') return false;
    if (!mutation) return ['META','BALANCE'].includes(row.sk) || /^(LEDGER|COUNT)#/.test(row.sk);
    if (row.pk!=='MERCHANT_CASHBOX#'+row.code) return false;
    return row.sk==='BALANCE'&&row.kind==='CASHBOX_BALANCE' ||
      row.sk.startsWith('LEDGER#')&&row.kind==='CASHBOX_LEDGER_ENTRY'&&row.category==='CUSTOMER_REFUND'&&row.orderId===activeOrder;
  }
  function returnNotice(op:Row) {
    if (!returnNoticeTable || op.TableName!==returnNoticeTable || !activeOrder) return false;
    const row=op.Item, scope=selection(activeOrder).order;
    if (!row || row.orderId!==activeOrder || row.branchId!==scope.branchId ||
        ![row.driverId,row.financialDriverId,row.financialSubjectId].every(id) ||
        row.deliveryStatus!=='PENDING' || row.nextAttemptAt!==0 || row.attempts!==0) return false;
    if (row.recipientApp==='driver' && row.driverId!==row.financialSubjectId) return false;
    if (row.type==='driver_return_task_updated') return row.recipientApp==='driver' &&
      /^RETURN_TASK_NOTICE#[a-f0-9]{64}$/.test(row.eventId) && id(row.returnId);
    return (row.recipientApp==='driver' && row.type==='driver_exception_financial_updated' ||
            row.recipientApp==='merchant' && row.type==='merchant_exception_financial_updated') &&
      /^EXCEPTION_FINANCIAL_NOTICE#[a-f0-9]{64}$/.test(row.eventId) && id(row.caseId);
  }
  const scoped: DB = {
    send: (async (command: any) => {
      const q = command.input as Row;
      const opType = operation(command);
      if (opType === "TransactWriteItems") {
        let items = structuredClone(q.TransactItems);
        if (allowedTables && items.some((item: Row) => {
          const table=(item.ConditionCheck ?? item.Put ?? item.Update ?? item.Delete)?.TableName;
          return !allowedTables.has(table) && !(item.ConditionCheck && (checkoutReferences.has(table)||dispatchRegions.has(table)||cancellationPayoutProof(item.ConditionCheck)||returnConsent(item.ConditionCheck,false)||refundCashbox(item.ConditionCheck,false)||cashReview&&scopedCompletionRecord(item.ConditionCheck,false))) && !checkoutMutation(item) && !responseDiscountOperation(item) &&
            !(item.Put && (scopedCompletionRecord(item.Put, true)||returnConsent(item.Put,true)||returnNotice(item.Put)||refundCashbox(item.Put,true)));
        })) fail();
        const recoveryGuards:Row[]=[];
        const ids = new Set<string>();

        let quoteOnly = false,
          newOrder = false;
        for (const a of items) {
          const op = a.ConditionCheck ?? a.Put ?? a.Update ?? a.Delete;
          if (!op) fail();
          const oid =
            orderId(op.Key ?? op.Item) ??
            (op.Key ? bindings.get(link(op.TableName, op.Key)) : undefined);
          if (oid && oid !== "SYSTEM#DISPATCH_HOST") {
            if(general&&!generalScopes.has(oid)&&!config.scopes.some(s=>s.orders.some(o=>o.orderId===oid))){if(a.Put&&op.TableName===tables.orders)await registerGeneral(op.Item,true);else await order(oid);}
            selection(oid);
            ids.add(oid);
            if (a.Put && returnNotice(op)) driver(oid,op.Item.financialDriverId,op.Item.financialSubjectId);
            else checkDrivers(oid, op.Item ?? {});
            if (
              a.Put &&
              (op.TableName === tables.offers ||
                (op.TableName === tables.jobs &&
                  (op.Item.SK === "METADATA" ||
                    [
                      "DISPATCH_WAVE",
                      "FINANCIAL_WAVE",
                      "DISPATCH_RESTART_START",
                    ].includes(op.Item.kind))))
            )
              {if(!orders.has(oid))await order(oid);await openExisting(oid);}
            if (op.TableName === tables.orders && a.Put) {
              const s = validate(op.Item, oid);
              open(s.scope);
              op.Item.financeRollout = pin(s.scope);
              newOrder = true;
            }
          }
          if (a.Put && op.TableName === tables.quotes) {
            if (
              !admission ||
              op.Item.branchId !== admission.branchId ||
              op.Item.subjectId !== admission.subjectId
            )
              fail();
            admit(op.Item.branchId, op.Item.subjectId);
            quoteOnly = true;
          }
        }
        if (ids.size > 1 || (!newOrder && items.some(checkoutMutation))) fail();
        if (completionTable && items.some((x:Row)=>x.Put?.TableName===completionTable || cancellationPayoutProof(x.ConditionCheck ?? {})) &&
            (newOrder || ids.size !== 1 || !items.some((x:Row)=>{
              const orderOperation = x.Update ?? (cancellationCompensation || returns || cashReview ? x.ConditionCheck : null);
              return orderOperation?.TableName === tables.orders && orderId(orderOperation.Key) === activeOrder;
            }))) fail();
        if (items.some(responseDiscountOperation) && (newOrder || ids.size !== 1 ||
            !items.some((a:Row)=>a.Update?.TableName===tables.orders) ||
            !items.some((a:Row)=>(a.Update??a.Put)?.TableName===tables.lifecycle))) fail();
        for(const oid of ids)if(recoveryActive.has(oid))recoveryGuards.push(...await openExisting(oid));
        if (ids.size === 1 && !newOrder) {
          const oid = [...ids][0];
          if (!orders.has(oid)) await order(oid);
          const f = fence(oid),
            a = items.find((a: Row) => {
              const op = a.ConditionCheck ?? a.Update ?? a.Put ?? a.Delete;
              return (
                op.TableName === tables.orders &&
                orderId(op.Key ?? op.Item) === oid
              );
            });
          if (a) {
            let op = a.ConditionCheck ?? a.Update ?? a.Put ?? a.Delete;
            if (
              Object.keys(op.ExpressionAttributeNames ?? {}).some((k) =>
                k.startsWith("#roll"),
              ) ||
              Object.keys(op.ExpressionAttributeValues ?? {}).some((k) =>
                k.startsWith(":roll"),
              )
            )
              fail();
            op.ConditionExpression = op.ConditionExpression
              ? "(" +
                op.ConditionExpression +
                ") AND (" +
                f.ConditionExpression +
                ")"
              : f.ConditionExpression;
            op.ExpressionAttributeNames = {
              ...op.ExpressionAttributeNames,
              ...f.ExpressionAttributeNames,
            };
            op.ExpressionAttributeValues = {
              ...op.ExpressionAttributeValues,
              ...f.ExpressionAttributeValues,
            };
          } else items.push({ ConditionCheck: f });
          if (!orders.get(oid)!.financeRollout) {
            open(selection(oid).scope);
            // A read or a late receipt is not an enrollment operation. Legacy
            // enrollment happens only with creation of the initial pinned job.
            if (!items.some((x: Row) => x.Put?.TableName === tables.jobs &&
                x.Put.Item?.orderId === oid && x.Put.Item?.SK === "METADATA")) fail();
            const target = items.find((x: Row) => {
              const op = x.ConditionCheck ?? x.Update ?? x.Put ?? x.Delete;
              return (
                op.TableName === tables.orders &&
                orderId(op.Key ?? op.Item) === oid
              );
            });
            // Atomic enrollment shares the existing order operation and all its guards.
            if (target.Delete) fail();
            if (target.ConditionCheck) {
              target.Update = {
                ...target.ConditionCheck,
                UpdateExpression: "SET #rollPin=:rollPin",
              };
              delete target.ConditionCheck;
            } else if (target.Update) {
              target.Update.UpdateExpression = /^SET\s/.test(
                target.Update.UpdateExpression,
              )
                ? target.Update.UpdateExpression.replace(
                    /^SET\s/,
                    "SET #rollPin=:rollPin, ",
                  )
                : "SET #rollPin=:rollPin " + target.Update.UpdateExpression;
            }
            const op = target.Update;
            op.ExpressionAttributeNames = {
              ...op.ExpressionAttributeNames,
              "#rollPin": "financeRollout",
            };
            op.ExpressionAttributeValues = {
              ...op.ExpressionAttributeValues,
              ":rollPin": pin(selection(oid).scope),
            };
          }
        } else if (!ids.size) {
          if (
            !quoteOnly &&
            !items.every(
              (a: Row) =>
                (a.ConditionCheck &&
                  (admission !== undefined || cursor(a.ConditionCheck))) ||
                cursor(a.Put ?? a.Update ?? {}),
            )
          )
            fail();
          if (
            quoteOnly &&
            items.some(
              (a: Row) =>
                !a.ConditionCheck &&
                a.Put?.TableName !== tables.quotes,
            )
          )
            fail();
        }
        if (
          items.length > 100 ||
          items.some(
            (a: Row) =>
              Buffer.byteLength(
                (a.ConditionCheck ?? a.Update ?? a.Put ?? a.Delete)
                  .ConditionExpression ?? "",
              ) > 4000,
          )
        )
          fail();
        if(recoveryGuards.length)items=composeDispatchTransaction(items,recoveryGuards,[tables.jobs,tables.offers]);
        return db.send(
          new TransactWriteCommand({ ...q, TransactItems: items }),
        );
      }
      if (allowedTables && !allowedTables.has(q.TableName) &&
          !(opType==='GetItem' && (checkoutReferences.has(q.TableName) || dispatchReadOnly.has(q.TableName) ||
            (q.Key?.discountId && responseDiscountTables.has(q.TableName)) || scopedCompletionRecord(q, false) || cancellationPayoutProof(q) || returnConsent(q,false) || refundCashbox(q,false))) &&
          !(opType==='Query' && checkout && (
            (checkout.index===q.TableName && q.IndexName==='h3-index') ||
            (checkout.platform===q.TableName && !q.IndexName && q.ExpressionAttributeValues?.[':pk']==='BRANCH#'+admission?.branchId &&
              q.ExpressionAttributeValues?.[':prefix']==='COMMERCIAL#DELIVERY#') ||
            (checkout.platformDiscounts===q.TableName && q.IndexName==='code-index')
          ))) fail();
      const oid = orderId(q.Key);
      if (oid && oid !== "SYSTEM#DISPATCH_HOST" && !general) selection(oid);
      const result: any = await db.send(command);
      if (opType === "GetItem" && result.Item) {
        const row = result.Item;
        if (q.TableName === tables.quotes)
          customer(row.branchId, row.subjectId);
        const found = orderId(row) ?? oid;
        if (found && found !== "SYSTEM#DISPATCH_HOST") {
          bindings.set(link(q.TableName, q.Key), found);
          if(general&&!generalScopes.has(found)&&!config.scopes.some(s=>s.orders.some(o=>o.orderId===found))){if(q.TableName===tables.orders&&!q.ProjectionExpression)await registerGeneral(row);else await order(found);}
          selection(found);
          if (q.TableName === tables.orders) {
            if (q.ProjectionExpression) await order(found);
            else validate(row, found);
          } else {
            if (!orders.has(found)) await order(found);
            checkDrivers(found, row);
          }
        }
      }
      if (
        (opType === "Query" || opType === "Scan") &&
        [tables.live, tables.driver].includes(
          q.TableName,
        ) &&
        Array.isArray(result.Items)
      ) {
        // Runtime workers process orders sequentially. The final transaction and
        // sender still check the exact order/driver pair independently.
        if(general)return result;
        const selectedOrder = activeOrder ?? fail();
        const allowed = new Set(
          selection(selectedOrder).scope.drivers.map((d) => d.driverId),
        );
        return {
          ...result,
          Items: result.Items.filter((r: Row) => allowed.has(r.driverId)),
        };
      }
      return result;
    }) as DB["send"],
  };
  return {
    db: scoped,
    admit,
    customer,
    order,
    driver,
    subject,
    config,
    containsOrder: (oid: string, row?:Row) =>
      (general&&id(oid)&&(row?.financialSnapshot!=null||row?.commercialPricing!=null))||config.scopes.some((s) => s.orders.some((o) => o.orderId === oid)),
  };
}
