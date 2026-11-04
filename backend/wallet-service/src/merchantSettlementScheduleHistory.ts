import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { exactCheck, strongGet } from './driverFinancialTransaction';
import { createMerchantSettlementScheduleReader } from './merchantSettlementScheduleReader';
import { merchantSettlementPeriod } from './merchantSettlementPeriod';
import { quoteEntityIdValid } from './deliveryQuoteRecord';
const fail = (code: string): never => { throw Object.assign(Error(code), { code }); };

/** Bounded version inventory, never a table scan. A pin on CURRENT serializes
 * this selection against the only supported publisher. No period may straddle a
 * version cutover; prior envelopes remain immutable, including original dates. */
export function createMerchantSettlementScheduleHistoryReader(db: Pick<DynamoDBDocumentClient, 'send'>, maxPages = 10) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20) return fail('INVALID_SCHEDULE_HISTORY_LIMIT');
  return async (branchId: string, at?: string) => {
    if (!quoteEntityIdValid(branchId) || typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) return fail('INVALID_SETTLEMENT_SCHEDULE_SELECTION');
    const pk = 'BRANCH#' + branchId, currentKey = { pk, sk: 'SETTLEMENT_SCHEDULE#CURRENT' };
    const current = await strongGet(db, 'staging-MerchantPlatform', currentKey);
    if (!current || current.enabled === false) return null;
    await createMerchantSettlementScheduleReader(db)(branchId, current.effectiveFrom);
    const rows: Record<string, any>[] = []; let cursor: Record<string, any> | undefined;
    for (let page = 0; ; page++) {
      if (page >= maxPages) return fail('SETTLEMENT_SCHEDULE_HISTORY_INCOMPLETE');
      const out = await db.send(new QueryCommand({ TableName: 'staging-MerchantPlatform', ConsistentRead: true, Limit: 100,
        KeyConditionExpression: 'pk=:pk AND begins_with(sk,:prefix)', ExpressionAttributeValues: { ':pk': pk, ':prefix': 'SETTLEMENT_SCHEDULE#VERSION#' },
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) }));
      rows.push(...out.Items || []); cursor = out.LastEvaluatedKey; if (!cursor) break;
    }
    rows.sort((a, b) => a.schedule?.version - b.schedule?.version);
    if (!rows.length || rows.length !== current.schedule?.version || rows.some((r, i) => r.pk !== pk || r.sk !== 'SETTLEMENT_SCHEDULE#VERSION#' + (i + 1) ||
        r.branchId !== branchId || r.schedule?.version !== i + 1 || i > 0 && r.effectiveFrom <= rows[i - 1].effectiveFrom) ||
        rows.at(-1)?.digest !== current.digest) return fail('SETTLEMENT_SCHEDULE_HISTORY_INVALID');
    const selected = [...rows].reverse().find(r => r.effectiveFrom <= at);
    if (!selected) return fail('SETTLEMENT_HISTORICAL_SCHEDULE_REQUIRED');
    // Reuse the strict approved envelope/owner/period validator. Only the storage
    // key is adapted; all signed body fields remain byte-identical.
    const selectedDb = { send: async (command: any) => command.input.TableName === 'staging-MerchantPlatform' && command.input.Key?.sk === currentKey.sk
      ? { Item: { ...selected, sk: currentKey.sk } } : db.send(command) };
    const validated = await createMerchantSettlementScheduleReader(selectedDb as any)(branchId, at);
    if (!validated) return fail('SETTLEMENT_SCHEDULE_HISTORY_INVALID');
    const next = rows[selected.schedule.version], period = merchantSettlementPeriod(selected.schedule, at);
    const guards = [exactCheck('staging-MerchantPlatform', { pk, sk: selected.sk }, selected)];
    if (next) {
      const nextDb = { send: async (command: any) => command.input.TableName === 'staging-MerchantPlatform' && command.input.Key?.sk === currentKey.sk
        ? { Item: { ...next, sk: currentKey.sk } } : db.send(command) };
      await createMerchantSettlementScheduleReader(nextDb as any)(branchId, next.effectiveFrom);
      guards.push(exactCheck('staging-MerchantPlatform', { pk, sk: next.sk }, next));
      const closureKey = { pk, sk: 'SETTLEMENT_SCHEDULE#CLOSED#' + selected.schedule.version };
      const closure = await strongGet(db, 'staging-MerchantPlatform', closureKey);
      if (!closure || closure.kind !== 'MERCHANT_SETTLEMENT_SCHEDULE_CLOSURE' || closure.branchId !== branchId ||
          closure.version !== selected.schedule.version || closure.sourceDigest !== selected.digest || closure.replacedByVersion !== next.schedule.version ||
          closure.untilExclusive !== next.effectiveFrom || period.untilExclusiveUtc > closure.untilExclusive) return fail('SETTLEMENT_SCHEDULE_CUTOVER_INVALID');
      guards.push(exactCheck('staging-MerchantPlatform', closureKey, closure));
    }
    const after = await strongGet(db, 'staging-MerchantPlatform', currentKey);
    if (!after || after.digest !== current.digest || after.enabled !== true) return fail('SETTLEMENT_SCHEDULE_CHANGED');
    return { schedule: validated.schedule, agreementBinding: validated.agreementBinding,
      guard: exactCheck('staging-MerchantPlatform', currentKey, current), guards };
  };
}
