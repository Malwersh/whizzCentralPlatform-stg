import { GetCommand, TransactWriteCommand, DynamoDBDocumentClient, GetCommandInput,
  TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { quoteHash as hash, quoteCanonical as stable, validDeliveryQuoteRecord } from './deliveryQuoteRecord';
import { createStagingDeliveryPricingContext } from './deliveryPricingContext';
import { createCoveredDeliveryRouter } from './roadRouting';

type DB = Pick<DynamoDBDocumentClient, 'send'>;
type Row = Record<string, any>;
type Check = NonNullable<NonNullable<TransactWriteCommandInput['TransactItems']>[number]['ConditionCheck']>;
export type QuoteCustomer = { userId: string; subjectId: string; condition: { ConditionCheck: Check } };
export class DeliveryQuoteError extends Error {
  constructor(public readonly code: 'INVALID_QUOTE_REQUEST' | 'CUSTOMER_UNAVAILABLE' | 'QUOTE_UNAVAILABLE' |
    'QUOTE_EXPIRED' | 'QUOTE_CONSUMED' | 'QUOTE_INVALIDATED' | 'QUOTE_REQUEST_CONFLICT' | 'QUOTE_REFERENCE_LIMIT') {
    super(code); this.name = 'DeliveryQuoteError';
  }
}
const fail = (code: DeliveryQuoteError['code']): never => { throw new DeliveryQuoteError(code); };
const TABLE = 'staging-DeliveryQuotes';
const PROFILE = 'WizzUser_users_staging';
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const key = (c: QuoteCustomer, requestId: string) => ({ pk: 'CUSTOMER#' + c.userId, sk: 'QUOTE#' + requestId });
const allowedTables = new Set(['WhizzMerchants_Businesses', 'WizzUser_addresses_staging', 'staging-PlatformStaff',
  'staging-MerchantPlatform', 'staging-AccountDeletion', 'WizzCentral_Regions', 'WizzCentral_RegionsDerived_staging']);

/** Capture only strongly read source attributes. GSI queries discover candidates, never authorize them.
 * Compare each projected path, including absence, without requiring legacy writers to increment versions.
 */
function readFences(db: DB) {
  const seen = new Map<string, { table: string; key: Row; paths: Map<string, { path: string[]; value?: any; present: boolean }> }>();
  let changed = false;
  const wrapped: DB = { send: (async (command: any) => {
    const result: any = await db.send(command);
    if (command instanceof GetCommand) {
      const q = command.input as GetCommandInput;
      if (!q.TableName || !allowedTables.has(q.TableName) || !q.Key || !q.ConsistentRead || !q.ProjectionExpression) return fail('QUOTE_REFERENCE_LIMIT');
      const tag = stable([q.TableName, q.Key]);
      let entry = seen.get(tag);
      if (!entry) { entry = { table: q.TableName, key: copy(q.Key), paths: new Map() }; seen.set(tag, entry); }
      for (const expression of q.ProjectionExpression.split(',')) {
        const path = expression.trim().split('.').map(p => q.ExpressionAttributeNames?.[p] ?? p);
        let value = result.Item; let present = true;
        for (const part of path) {
          if (!value || !Object.prototype.hasOwnProperty.call(value, part)) { present = false; break; }
          value = value[part];
        }
        const valueAtPath = { path, present, ...(present ? { value: copy(value) } : {}) };
        const prior = entry.paths.get(path.join('.'));
        if (prior && stable(prior) !== stable(valueAtPath)) changed = true;
        entry.paths.set(path.join('.'), valueAtPath);
      }
    }
    return result;
  }) as DB['send'] };
  return { db: wrapped, finish(): Check[] {
    if (changed) return fail('QUOTE_INVALIDATED');
    if (!['WhizzMerchants_Businesses', 'WizzUser_addresses_staging', 'staging-PlatformStaff',
      'staging-AccountDeletion', 'WizzCentral_Regions', 'WizzCentral_RegionsDerived_staging'].every(t =>
        [...seen.values()].some(e => e.table === t)) || seen.size > 90) return fail('QUOTE_REFERENCE_LIMIT');
    return [...seen.values()].map(entry => {
      const names: Record<string, string> = {}, values: Row = {};
      const clauses = [...entry.paths.values()].map((p, i) => {
        const expression = p.path.map((part, j) => { const n = `#a${i}_${j}`; names[n] = part; return n; }).join('.');
        if (!p.present) return `attribute_not_exists(${expression})`;
        values[`:v${i}`] = p.value;
        return `${expression} = :v${i}`;
      });
      const expression = clauses.join(' AND ');
      if (Buffer.byteLength(expression) > 4000) return fail('QUOTE_REFERENCE_LIMIT');
      return { TableName: entry.table, Key: entry.key, ConditionExpression: expression,
        ExpressionAttributeNames: names, ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}) };
    });
  } };
}

/** Local internal service. No HTTP, order writer, balance mutation or driver offer.
 * authenticateCustomer must return the live account guard's profile ConditionCheck.
 * createRouter MUST construct the covered router with the supplied instrumented DB.
 */
export function createStagingDeliveryQuotes(options: {
  db: DB; authenticateCustomer: () => Promise<QuoteCustomer>;
  beforeCalculate?: (customer: QuoteCustomer, selection: {branchId:string;addressId:string;requestId:string}) => Promise<void>;
  createRouter: (db: DB) => ReturnType<typeof createCoveredDeliveryRouter>; now?: () => number;
}) {
  const { db } = options, now = options.now ?? Date.now;
  async function customer(): Promise<QuoteCustomer> {
    try {
      const c = await options.authenticateCustomer(), check = c?.condition?.ConditionCheck;
      if (!c || !validId(c.userId) || c.userId === 'guest' || !validId(c.subjectId) ||
          check?.TableName !== PROFILE || stable(check.Key) !== stable({ userId: c.userId }) ||
          !check.ConditionExpression) return fail('CUSTOMER_UNAVAILABLE');
      return copy(c);
    } catch { return fail('CUSTOMER_UNAVAILABLE'); }
  }
  async function load(c: QuoteCustomer, requestId: string): Promise<Row | undefined> {
    try { return (await db.send(new GetCommand({ TableName: TABLE, Key: key(c, requestId), ConsistentRead: true }))).Item; }
    catch { return fail('QUOTE_UNAVAILABLE'); }
  }
  function publicQuote(row: Row) {
    return copy({ schemaVersion: 1, kind: 'DELIVERY_FEE_ONLY', quoteId: row.requestId, branchId: row.branchId,
      addressId: row.addressId, createdAt: row.createdAt, expiresAt: row.expiresAt, policyVersion: row.policyVersion,
      customerDeliveryFee: row.calculation.customerDeliveryFee, components: row.calculation.components,
      rule: row.calculation.rule, route: row.calculation.deliveryRoute });
  }
  async function deliver(c: QuoteCustomer, row: Row) {
    if (row.subjectId !== c.subjectId || row.pk !== key(c, row.requestId).pk || row.sk !== key(c, row.requestId).sk) return fail('QUOTE_UNAVAILABLE');
    if (!validDeliveryQuoteRecord(row)) return fail('QUOTE_UNAVAILABLE');
    if (row.consumption !== undefined) return fail('QUOTE_CONSUMED');
    const ms = now();
    if (ms < Date.parse(row.createdAt) || ms >= Date.parse(row.expiresAt)) return fail('QUOTE_EXPIRED');
    const fresh = await customer();
    if (fresh.userId !== c.userId || fresh.subjectId !== c.subjectId) return fail('CUSTOMER_UNAVAILABLE');
    try {
      await db.send(new TransactWriteCommand({ TransactItems: [fresh.condition,
        ...row.fences.map((ConditionCheck: Check) => ({ ConditionCheck })),
        { ConditionCheck: { TableName: TABLE, Key: key(c, row.requestId), ConditionExpression: '#digest = :digest AND attribute_not_exists(consumption)',
          ExpressionAttributeNames: { '#digest': 'digest' }, ExpressionAttributeValues: { ':digest': row.digest } } }] }));
    } catch (e: any) {
      if (e.name === 'TransactionCanceledException' || e.name === 'ConditionalCheckFailedException') return fail('QUOTE_INVALIDATED');
      return fail('QUOTE_UNAVAILABLE');
    }
    if (now() >= Date.parse(row.expiresAt) || now() < ms) return fail('QUOTE_EXPIRED');
    return publicQuote(row);
  }
  return Object.freeze({
    async create(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_QUOTE_REQUEST');
      const r = input as Row;
      if (Object.keys(r).sort().join(',') !== 'addressId,branchId,requestId' || !validId(r.branchId) || !validId(r.addressId) || !uuid(r.requestId)) return fail('INVALID_QUOTE_REQUEST');
      const branchId = r.branchId, addressId = r.addressId, requestId = r.requestId.toLowerCase();
      const c = await customer(), requestHash = hash({ branchId, addressId });
      const existing = await load(c, requestId);
      if (existing) {
        if (existing.requestHash !== requestHash) return fail('QUOTE_REQUEST_CONFLICT');
        return deliver(c, existing);
      }
      await options.beforeCalculate?.(c,{branchId,addressId,requestId});
      const capture = readFences(db);
      const context = createStagingDeliveryPricingContext({ db: capture.db, router: options.createRouter(capture.db), now,
        authenticateCustomer: async () => {
          const fresh = await customer();
          if (fresh.userId !== c.userId || fresh.subjectId !== c.subjectId) return fail('CUSTOMER_UNAVAILABLE');
          return fresh;
        } });
      const result = await context.calculate({ branchId, addressId });
      const fences = capture.finish(), created = now(), calculated = Date.parse(result.at);
      // A rule ceasing to apply also ends this initial quote; peaks are fixed at the calculation time.
      const policy = fences.find(f => f.TableName === 'staging-PlatformStaff');
      const bundle = Object.values(policy?.ExpressionAttributeValues ?? {}).find((v: any) => v?.deliveryRules) as Row | undefined;
      const rule = bundle?.deliveryRules.find((v: Row) => v.id === result.calculation.rule.id && v.version === result.calculation.rule.version);
      if (!rule) return fail('QUOTE_INVALIDATED');
      const expires = Math.min(calculated + 120000, Date.parse(result.binding.route.expiresAt),
        rule.effectiveTo === null ? Infinity : Date.parse(rule.effectiveTo));
      if (!Number.isFinite(created) || created < calculated || created >= expires) return fail('QUOTE_EXPIRED');
      const row: Row = { ...key(c, requestId), schemaVersion: 1, requestId, requestHash, subjectId: c.subjectId,
        branchId, addressId, createdAt: new Date(created).toISOString(), expiresAt: new Date(expires).toISOString(),
        pricingContext:result.context, pricingAt:result.at, policyVersion: result.policyVersion, referenceVersion: result.referenceVersion, binding: result.binding,
        calculation: result.calculation, fences };
      row.digest = hash(row);
      // One item, no TTL: expired IDs remain reserved until account deletion. No expiry-based resurrection.
      if (Buffer.byteLength(JSON.stringify(row)) > 300000) return fail('QUOTE_REFERENCE_LIMIT');
      const fresh = await customer();
      if (fresh.userId !== c.userId || fresh.subjectId !== c.subjectId) return fail('CUSTOMER_UNAVAILABLE');
      try {
        await db.send(new TransactWriteCommand({ TransactItems: [fresh.condition, ...fences.map(ConditionCheck => ({ ConditionCheck })),
          { Put: { TableName: TABLE, Item: row, ConditionExpression: 'attribute_not_exists(pk)' } }] }));
      } catch (e: any) {
        // Covers simultaneous creates and a committed write whose acknowledgement was lost.
        const winner = await load(c, requestId);
        if (winner) {
          if (winner.requestHash !== requestHash) return fail('QUOTE_REQUEST_CONFLICT');
          return deliver(c, winner);
        }
        if (e.name === 'TransactionCanceledException' || e.name === 'ConditionalCheckFailedException') return fail('QUOTE_INVALIDATED');
        return fail('QUOTE_UNAVAILABLE');
      }
      return deliver(c, row);
    },
    async get(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'quoteId' || !uuid((input as Row).quoteId)) return fail('INVALID_QUOTE_REQUEST');
      const c = await customer(), row = await load(c, (input as Row).quoteId.toLowerCase());
      if (!row) return fail('QUOTE_UNAVAILABLE');
      return deliver(c, row);
    }
  });
}
