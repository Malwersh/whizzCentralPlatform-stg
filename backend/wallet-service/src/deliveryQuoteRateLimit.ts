import { GetCommand, TransactWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { QuoteCustomer } from './deliveryQuote';
import { quoteHash } from './deliveryQuoteRecord';

const TABLE = 'staging-DeliveryQuotes';
const SK = 'RATE#DELIVERY_QUOTE';
const WINDOW_MS = 60000;
type Row = Record<string, any>;
export class DeliveryQuoteRateError extends Error {
  constructor(public readonly code: 'QUOTE_RATE_LIMITED' | 'QUOTE_RATE_UNAVAILABLE', public readonly retryAfterSeconds?: number) {
    super(code); this.name = 'DeliveryQuoteRateError';
  }
}
const unavailable = (): never => { throw new DeliveryQuoteRateError('QUOTE_RATE_UNAVAILABLE'); };
const digest = (row: Row) => quoteHash({ pk: row.pk, sk: row.sk, schemaVersion: row.schemaVersion,
  subjectId: row.subjectId, windowStart: row.windowStart, count: row.count, version: row.version });

/** One bounded row per authenticated customer profile. Reservation precedes any new road request.
 * Fixed UTC minute windows may admit two windows' quotas around a boundary. Lost acknowledgements
 * spend quota but never authorize routing: cost protection fails closed, with no compensating writes.
 */
export function createStagingDeliveryQuoteRateLimiter(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>; maxPerMinute: number; now?: () => number;
}) {
  if (!Number.isSafeInteger(options.maxPerMinute) || options.maxPerMinute < 1 || options.maxPerMinute > 120) return unavailable();
  const now = options.now ?? Date.now;
  return Object.freeze({ async reserve(customer: QuoteCustomer): Promise<void> {
    const condition = customer?.condition?.ConditionCheck;
    if (!customer || !/^[A-Za-z0-9_.:-]{1,150}$/.test(customer.userId) || customer.userId === 'guest' ||
        !/^[A-Za-z0-9_.:-]{1,150}$/.test(customer.subjectId) || condition?.TableName !== 'WizzUser_users_staging' ||
        Object.keys(condition.Key ?? {}).join(',') !== 'userId' || condition.Key?.userId !== customer.userId ||
        !condition.ConditionExpression) return unavailable();
    const key = { pk: 'CUSTOMER#' + customer.userId, sk: SK };
    for (let attempt = 0; attempt < 3; attempt++) {
      const ms = now();
      if (!Number.isSafeInteger(ms) || ms < 0) return unavailable();
      const windowStart = Math.floor(ms / WINDOW_MS) * WINDOW_MS;
      let old: Row | undefined;
      try { old = (await options.db.send(new GetCommand({ TableName: TABLE, Key: key, ConsistentRead: true }))).Item; }
      catch { return unavailable(); }
      if (old && (old.pk !== key.pk || old.sk !== SK || old.subjectId !== customer.subjectId || old.schemaVersion !== 1 ||
          !Number.isSafeInteger(old.windowStart) || old.windowStart < 0 || old.windowStart % WINDOW_MS !== 0 || old.windowStart > windowStart ||
          !Number.isSafeInteger(old.count) || old.count < 1 || old.count > 120 || !Number.isSafeInteger(old.version) || old.version < 1 ||
          old.version >= Number.MAX_SAFE_INTEGER || old.digest !== digest(old) || old.legalHold || old.retentionHold)) return unavailable();
      const count = old?.windowStart === windowStart ? old.count : 0;
      if (count >= options.maxPerMinute) throw new DeliveryQuoteRateError('QUOTE_RATE_LIMITED', Math.max(1, Math.ceil((windowStart + WINDOW_MS - ms) / 1000)));
      const row: Row = { ...key, schemaVersion: 1, subjectId: customer.subjectId, windowStart, count: count + 1, version: (old?.version ?? 0) + 1 };
      row.digest = digest(row);
      try {
        await options.db.send(new TransactWriteCommand({ TransactItems: [customer.condition, { Put: {
          TableName: TABLE, Item: row,
          ConditionExpression: old
            ? '#digest=:digest AND #version=:version AND subjectId=:sub AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)'
            : 'attribute_not_exists(pk)',
          ...(old ? { ExpressionAttributeNames: { '#digest': 'digest', '#version': 'version' },
            ExpressionAttributeValues: { ':digest': old.digest, ':version': old.version, ':sub': customer.subjectId, ':no': false } } : {})
        } }] }));
        // A reservation that crossed its window, or a backwards clock, must not start routing.
        const end = now();
        if (!Number.isSafeInteger(end) || end < ms || end >= windowStart + WINDOW_MS) return unavailable();
        return;
      } catch (e: any) {
        // Retry only a proven quota-row CAS conflict. Unknown/network/other guard failures stay closed.
        const reasons = e.CancellationReasons;
        if (e.name === 'TransactionCanceledException' && Array.isArray(reasons) && reasons.length === 2 &&
            reasons[0]?.Code === 'None' && reasons[1]?.Code === 'ConditionalCheckFailed') continue;
        return unavailable();
      }
    }
    return unavailable();
  } });
}
