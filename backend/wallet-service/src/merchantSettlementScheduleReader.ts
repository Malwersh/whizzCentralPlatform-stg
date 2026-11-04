import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { exactCheck, strongGet } from './driverFinancialTransaction';
import { merchantSettlementPeriod } from './merchantSettlementPeriod';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
const fail = (code: string): never => { throw Object.assign(Error(code), { code }); };
const instant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;

/** Read only. No default, implied merchant consent or policy publication. A future
 * approved publisher must write this exact envelope and archive prior versions.
 * Current policy cannot be used to reinterpret an earlier/different agreement. */
export function createMerchantSettlementScheduleReader(db: Pick<DynamoDBDocumentClient, 'send'>) {
  return async (branchId: string, at?: string) => {
    if (!quoteEntityIdValid(branchId) || !instant(at)) return fail('INVALID_SETTLEMENT_SCHEDULE_SELECTION');
    const key = { pk: 'BRANCH#' + branchId, sk: 'SETTLEMENT_SCHEDULE#CURRENT' };
    const row = await strongGet(db, 'staging-MerchantPlatform', key);
    if (!row || row.enabled === false) return null;
    const { pk, sk, digest, ...body } = row;
    if (Object.keys(row).sort().join(',') !== 'acceptedAt,acceptedBy,agreement,approvedAt,approvedBy,branchId,digest,effectiveFrom,effectiveTo,enabled,kind,ownerId,pk,schedule,schemaVersion,sk,status' ||
        row.kind !== 'MERCHANT_SETTLEMENT_SCHEDULE' || row.schemaVersion !== 1 || row.branchId !== branchId ||
        row.enabled !== true || row.status !== 'APPROVED' || quoteHash(body) !== digest ||
        !quoteEntityIdValid(row.ownerId) || row.acceptedBy !== row.ownerId || !quoteEntityIdValid(row.approvedBy) ||
        !instant(row.acceptedAt) || !instant(row.approvedAt) || !instant(row.effectiveFrom) ||
        row.acceptedAt > row.effectiveFrom || row.approvedAt > row.effectiveFrom ||
        (row.effectiveTo !== null && (!instant(row.effectiveTo) || row.effectiveTo <= row.effectiveFrom)) ||
        !row.agreement || Object.keys(row.agreement).sort().join(',') !== 'id,termsHash,version' ||
        !quoteEntityIdValid(row.agreement.id) || !Number.isSafeInteger(row.agreement.version) || row.agreement.version < 1 ||
        !/^[a-f0-9]{64}$/.test(row.agreement.termsHash || '')) return fail('SETTLEMENT_SCHEDULE_APPROVAL_REQUIRED');
    const branch = await strongGet(db, 'WhizzMerchants_Businesses', { businessId: branchId });
    if (!branch || branch.ownerId !== row.ownerId || branch.cognitoUserId !== row.ownerId ||
        branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail('SETTLEMENT_SCHEDULE_OWNER_CHANGED');
    const period = merchantSettlementPeriod(row.schedule, at);
    if (period.fromUtc < row.effectiveFrom || row.effectiveTo !== null && period.untilExclusiveUtc > row.effectiveTo) return fail('SETTLEMENT_HISTORICAL_SCHEDULE_REQUIRED');
    return { schedule: row.schedule, agreementBinding: row.agreement,
      guard: exactCheck('staging-MerchantPlatform', key, row) };
  };
}
