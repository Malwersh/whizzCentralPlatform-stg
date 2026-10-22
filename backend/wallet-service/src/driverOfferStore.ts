import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { resolveFinancialOffer, versionedFinancialOfferView } from './financialOfferVersion';
import { createStagingDriverOfferOrderReader } from './driverOfferOrderReader';
import { quoteCanonical, quoteHash } from './deliveryQuoteRecord';

type Row = Record<string, any>;
type Check = { ConditionCheck: Row };
const TABLE = 'WaveOffers_staging';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export class DriverOfferStoreError extends Error {
  constructor(public readonly code: 'INVALID_DRIVER_OFFER_SAVE' | 'DRIVER_OFFER_SAVE_CONFLICT' |
    'DRIVER_OFFER_SAVE_UNAVAILABLE' | 'DRIVER_OFFER_POSITION_CONFLICT' | 'DRIVER_OFFER_NOT_AVAILABLE') {
    super(code); this.name = 'DriverOfferStoreError';
  }
}
function fail(code: DriverOfferStoreError['code']): never { throw new DriverOfferStoreError(code); }
function exact(value: unknown, keys: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) return fail('INVALID_DRIVER_OFFER_SAVE');
  return value as Row;
}
function wave(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1000) return fail('INVALID_DRIVER_OFFER_SAVE');
  return value;
}
function timestamp(now: () => number): string {
  const at = now();
  if (!Number.isSafeInteger(at)) return fail('DRIVER_OFFER_SAVE_UNAVAILABLE');
  return new Date(at).toISOString();
}
function key(orderId: string, driverId: string, waveNumber: number) {
  // Legacy acceptance addresses driverId#WAVE#n. Never expose a new financial offer at that key.
  return { orderId, SK: `FINANCIAL#${driverId}#WAVE#${waveNumber}` };
}
const same = (a: unknown, b: unknown) => quoteCanonical(a) === quoteCanonical(b);
function guard(value: unknown, table: string, keys: string[]): Check {
  const outer = exact(value, ['ConditionCheck']), c = outer.ConditionCheck;
  const allowed = ['TableName', 'Key', 'ConditionExpression', 'ExpressionAttributeNames', 'ExpressionAttributeValues'];
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(k => !allowed.includes(k))) return fail('INVALID_DRIVER_OFFER_SAVE');
  if (c.TableName !== table || typeof c.ConditionExpression !== 'string' || !c.ConditionExpression.trim() ||
      Buffer.byteLength(c.ConditionExpression) > 3900) return fail('INVALID_DRIVER_OFFER_SAVE');
  exact(c.Key, keys);
  if (Object.values(c.Key).some(v => typeof v !== 'string' || !v.length || v.length > 500)) return fail('INVALID_DRIVER_OFFER_SAVE');
  for (const map of [c.ExpressionAttributeNames, c.ExpressionAttributeValues]) {
    if (map !== undefined && (!map || typeof map !== 'object' || Array.isArray(map))) return fail('INVALID_DRIVER_OFFER_SAVE');
  }
  return copy(value as Check);
}
/** Server-internal persistence adapter. The trusted caller must READ and fence assignment, driver
 * approval/identity, live position, published policy and deletion locks; checks are not authentication.
 * This adapter supplies the strong order read/fence itself. It is deliberately NOT wired to StartWave,
 * an HTTP endpoint, notifications, legacy acceptance or a wallet writer. No default/omitted guards.
 */
export function createStagingDriverOfferStore(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>; now?: () => number;enableDeliveryFunding?:boolean;enableFullCash?:boolean;
}) {
  const { db } = options, now = options.now ?? Date.now;
  const reader = createStagingDriverOfferOrderReader({ db,enableDeliveryFunding:options.enableDeliveryFunding,enableFullCash:options.enableFullCash });
  async function load(k: Row): Promise<Row | undefined> {
    try { return (await db.send(new GetCommand({ TableName: TABLE, Key: k, ConsistentRead: true }))).Item; }
    catch { return fail('DRIVER_OFFER_SAVE_UNAVAILABLE'); }
  }
  function receipt(saved: Row, proposed: Row, replayed: boolean) {
    if (!same(saved, proposed)) return fail('DRIVER_OFFER_SAVE_CONFLICT');
    return { kind: 'DRIVER_OFFER_SAVED', offerId: saved.offerId, digest: saved.financialOffer.digest,
      expiresAt: saved.expiresAt, replayed, acceptanceAndWalletWriteRequired: true };
  }
  return Object.freeze({
    async save(value: unknown) {
      const input = copy(exact(value, ['offer', 'waveNumber', 'guards']));
      const offer = resolveFinancialOffer(input.offer,options.enableDeliveryFunding,options.enableFullCash);
      if (!same(offer.versionedOffer, input.offer)) return fail('INVALID_DRIVER_OFFER_SAVE');
      const waveNumber = wave(input.waveNumber), k = key(offer.orderId, offer.driverId, waveNumber);
      const g = exact(input.guards, ['assignment', 'driver', 'position', 'policy', 'branch', 'deletions']);
      const checks = [guard(g.assignment, 'WizzDispatchJobs_staging', ['orderId', 'SK']),
        guard(g.driver, 'WhizzDrivers_staging', ['driverId']),
        guard(g.position, 'WizzDriverLiveState_staging', ['driverId']),
        guard(g.policy, 'staging-PlatformStaff', ['pk', 'sk']),
        guard(g.branch, 'WhizzMerchants_Businesses', ['businessId'])];
      if (checks[4].ConditionCheck.Key.businessId !== offer.branchId || checks[0].ConditionCheck.Key.orderId !== offer.orderId || checks[0].ConditionCheck.Key.SK !== 'METADATA' ||
          checks[1].ConditionCheck.Key.driverId !== offer.driverId || checks[2].ConditionCheck.Key.driverId !== offer.driverId ||
          !Array.isArray(g.deletions) || !g.deletions.length || g.deletions.length > 20) return fail('INVALID_DRIVER_OFFER_SAVE');
      checks.push(...g.deletions.map((v: unknown) => guard(v, 'staging-AccountDeletion', ['pk', 'sk'])));
      const proposed = { ...k, schemaVersion: 2, kind: 'FINANCIAL_DRIVER_OFFER', offerId: offer.offerId,
        driverId: offer.driverId, waveNumber, dispatchJobId: offer.assignmentId,
        responseStatus: 'financial_pending', isWinner: false, sentAt: offer.createdAt,
        expiresAt: offer.expiresAt, financialOffer: offer.versionedOffer };
      if (Buffer.byteLength(JSON.stringify(proposed)) > 300000) return fail('INVALID_DRIVER_OFFER_SAVE');
      // Never recreate an existing row, including one accepted/expired/declined by a future writer.
      const existing = await load(k);
      if (existing) return receipt(existing, proposed, true);
      const current = await reader.read({ orderId: offer.orderId, branchId: offer.branchId });
      if (current.snapshotHash !== offer.snapshotHash) return fail('DRIVER_OFFER_SAVE_CONFLICT');
      const transaction = [...checks, ...(current.releaseCondition?[current.releaseCondition]:[]), current.condition, { Put: { TableName: TABLE, Item: proposed,
        ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'orderId' } } }];
      const identities = transaction.map((operation: Row) => {
        const c = operation.ConditionCheck ?? operation.Put;
        return c.TableName + ':' + quoteCanonical(operation.Put ? k : c.Key);
      });
      if (new Set(identities).size !== identities.length || Buffer.byteLength(JSON.stringify(transaction)) > 3500000) return fail('INVALID_DRIVER_OFFER_SAVE');
      // Guard external reads/routing latency as well as the proposal's own timestamp.
      versionedFinancialOfferView(offer, offer.driverId, offer.driverSubjectId, timestamp(now),options.enableDeliveryFunding,options.enableFullCash);
      try {
        await db.send(new TransactWriteCommand({ TransactItems: transaction as any,
          ClientRequestToken: quoteHash({ k, digest: offer.digest, guards: transaction }).slice(0, 36) }));
      } catch (error: any) {
        console.error('DRIVER_OFFER_STORE_TRANSACTION_FAILED', {code:error?.name??'Unknown',message:['ValidationException','AccessDeniedException'].includes(error?.name)?String(error.message).slice(0,1800):undefined,reasons:(error?.CancellationReasons??[]).map((r:any)=>r.Code??'None')});
        // A lost response can follow a committed write. Exact immutable receipt wins over expiry/retry.
        const saved = await load(k);
        if (saved) return receipt(saved, proposed, true);
        const reasons=error?.CancellationReasons;
        if(error?.name==='TransactionCanceledException'&&Array.isArray(reasons)&&reasons[2]?.Code==='ConditionalCheckFailed'&&reasons.every((r:any,i:number)=>i===2||!r.Code||r.Code==='None'))return fail('DRIVER_OFFER_POSITION_CONFLICT');
        if (['TransactionCanceledException', 'ConditionalCheckFailedException', 'IdempotentParameterMismatchException'].includes(error?.name)) return fail('DRIVER_OFFER_SAVE_CONFLICT');
        return fail('DRIVER_OFFER_SAVE_UNAVAILABLE');
      }
      return receipt(proposed, proposed, false);
    },
    /** Caller must supply authenticated live identity; string selectors alone do not authenticate it. */
    async view(value: unknown) {
      const input = exact(value, ['orderId', 'driverId', 'subjectId', 'waveNumber']);
      for (const field of ['orderId', 'driverId', 'subjectId']) {
        if (typeof input[field] !== 'string' || !/^[A-Za-z0-9_.:-]{1,150}$/.test(input[field])) return fail('DRIVER_OFFER_NOT_AVAILABLE');
      }
      const selected = copy(input), k = key(selected.orderId, selected.driverId, wave(selected.waveNumber));
      const saved = await load(k);
      const currentOffer=saved?resolveFinancialOffer(saved.financialOffer,options.enableDeliveryFunding,options.enableFullCash):null;
      if (!saved || saved.kind !== 'FINANCIAL_DRIVER_OFFER' || saved.schemaVersion !== 2 ||
          saved.responseStatus !== 'financial_pending' || saved.isWinner !== false ||
          !same({ orderId: saved.orderId, SK: saved.SK }, k) || saved.waveNumber !== selected.waveNumber ||
          saved.driverId !== selected.driverId || saved.offerId !== currentOffer?.offerId ||
          currentOffer?.orderId !== selected.orderId || saved.expiresAt !== currentOffer?.expiresAt) return fail('DRIVER_OFFER_NOT_AVAILABLE');
      return versionedFinancialOfferView(saved.financialOffer, selected.driverId, selected.subjectId, timestamp(now),options.enableDeliveryFunding,options.enableFullCash);
    }
  });
}
