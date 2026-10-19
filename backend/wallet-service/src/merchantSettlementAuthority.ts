import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { detach, exactCheck, strongGet } from './driverFinancialTransaction';
import { quoteEntityIdValid } from './deliveryQuoteRecord';
import type { SettlementBatchAuthority } from './merchantSettlementBatch';
const { allowed } = require('../../staff-service/catalog');
const fail = (code: string): never => { throw Object.assign(Error(code), { code }); };

/** Existence-only lifecycle read; matches the deployed role's attribute scope. */
export async function readMerchantDeletionFence(db: Pick<DynamoDBDocumentClient, 'send'>, key: { pk: string; sk: string }) {
  return (await db.send(new GetCommand({ TableName: 'staging-AccountDeletion', Key: key, ConsistentRead: true,
    ProjectionExpression: '#pk,#sk', ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' } }))).Item || null;
}

/** Internal adapter. Principal MUST come from the platform JWT verifier and live
 * Cognito/MFA checks, never request JSON. CREATE freezes a statement only. */
export function createMerchantSettlementAuthority(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  principal: { employeeId: string; authTime: number; mfaEnrolled: boolean };
  now?: () => number;
}) {
  const principal = detach(options.principal), now = options.now || Date.now;
  if (!principal || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(principal.employeeId) ||
      !Number.isSafeInteger(principal.authTime) || principal.authTime < 0 || typeof principal.mfaEnrolled !== 'boolean') return fail('SETTLEMENT_VERIFIED_PRINCIPAL_REQUIRED');
  return async (branchId: string, action: 'READ' | 'CREATE'): Promise<SettlementBatchAuthority> => {
    if (!quoteEntityIdValid(branchId) || !['READ', 'CREATE'].includes(action)) return fail('INVALID_SETTLEMENT_AUTHORIZATION');
    const key = { pk: 'EMPLOYEE#' + principal.employeeId, sk: 'PROFILE' };
    const employee = await strongGet(options.db, 'staging-PlatformStaff', key);
    const age = Math.floor(now() / 1000) - principal.authTime;
    if (!employee || employee.employeeId !== principal.employeeId || employee.status !== 'ACTIVE' ||
        !Number.isSafeInteger(employee.version) || employee.version < 1 || employee.deletionRequestId != null ||
        employee.deletedAt != null || employee.isDeleted === true ||
        (employee.minimumAuthTime !== undefined && (!Number.isSafeInteger(employee.minimumAuthTime) || employee.minimumAuthTime < 0)) ||
        (employee.minimumAuthTime || 0) > principal.authTime || age < -30 ||
        (employee.mfaRequired === true && !principal.mfaEnrolled)) return fail('SETTLEMENT_EMPLOYEE_UNAVAILABLE');
    if (action === 'CREATE' && age > 300) return fail('SETTLEMENT_REAUTH_REQUIRED');
    if (employee.scope?.allRegions !== true || !allowed(employee, 'finance.read') ||
        (action === 'CREATE' && !allowed(employee, 'finance.request'))) return fail('SETTLEMENT_PERMISSION_REQUIRED');
    const branch = await strongGet(options.db, 'WhizzMerchants_Businesses', { businessId: branchId });
    if (!branch || branch.businessId !== branchId || branch.status !== 'approved' ||
        !quoteEntityIdValid(branch.ownerId) || branch.ownerId !== branch.cognitoUserId ||
        branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail('SETTLEMENT_BRANCH_UNAVAILABLE');
    for (const pk of ['BUSINESS_LIFECYCLE#MERCHANT#' + branchId, 'ACCOUNT_LIFECYCLE#MERCHANT#' + branch.ownerId]) {
      if (await readMerchantDeletionFence(options.db, { pk, sk: 'META' })) return fail('SETTLEMENT_BRANCH_UNAVAILABLE');
    }
    // Branch/deletion guards belong to the batch writer, avoiding duplicate
    // DynamoDB targets. Pin all profile authority fields, including absent ones.
    return { branchId, actorId: principal.employeeId,
      guards: [exactCheck('staging-PlatformStaff', key, employee, [...Object.keys(employee),
        'roles', 'scope', 'mfaRequired', 'minimumAuthTime', 'deletionRequestId', 'deletedAt', 'isDeleted'])] };
  };
}
