import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { detach, exactCheck, strongGet } from './driverFinancialTransaction';
import { readMerchantDeletionFence } from './merchantSettlementAuthority';
import { createMerchantSettlementScheduleReader } from './merchantSettlementScheduleReader';
import { merchantSettlementPeriod, MerchantSettlementSchedule } from './merchantSettlementPeriod';
import { quoteCanonical, quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
const { allowed } = require('../../staff-service/catalog');
type Row = Record<string, any>;
const P = 'staging-MerchantPlatform', S = 'staging-PlatformStaff', B = 'WhizzMerchants_Businesses', D = 'staging-AccountDeletion';
const fail = (code: string): never => { throw Object.assign(Error(code), { code }); };
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const employeeId = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const same = (a: unknown, b: unknown) => quoteCanonical(a) === quoteCanonical(b);
const absent = (table: string, item: Row) => ({ Put: { TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' } });
const key = (branchId: string, suffix: string) => ({ pk: 'BRANCH#' + branchId, sk: 'SETTLEMENT_SCHEDULE#' + suffix });
export type SchedulePrincipal = { kind: 'STAFF'; employeeId: string; authTime: number; mfaEnrolled: boolean } |
  { kind: 'OWNER'; subjectId: string };

/** Internal, not routed. Principal is supplied by verified platform/merchant JWT
 * adapters with live Cognito checks. Owner consent remains mandatory. The verified staging operator may approve
 * their own proposal when its immutable approval policy permits it.
 * No wallet, payable membership or existing frozen statement is modified. */
export function createMerchantSettlementScheduleWorkflow(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>; principal: SchedulePrincipal; now?: () => number; allowSameStaffApproval?: boolean;
}) {
  const { db } = options, principal = detach(options.principal), clock = options.now || Date.now;
  const instant = () => new Date(clock()).toISOString();
  if (!principal || (principal.kind === 'STAFF' ? !employeeId(principal.employeeId) || !Number.isSafeInteger(principal.authTime) ||
      principal.authTime < 0 || typeof principal.mfaEnrolled !== 'boolean' : principal.kind !== 'OWNER' || !quoteEntityIdValid(principal.subjectId))) return fail('SCHEDULE_VERIFIED_PRINCIPAL_REQUIRED');
  async function staff(action: 'REQUEST' | 'APPROVE') {
    if (principal.kind !== 'STAFF') return fail('SCHEDULE_PERMISSION_REQUIRED');
    const k = { pk: 'EMPLOYEE#' + principal.employeeId, sk: 'PROFILE' }, row = await strongGet(db, S, k);
    const age = Math.floor(clock() / 1000) - principal.authTime;
    // Honor the staff API's verified-session policy; JWT expiry and live revocation remain enforced.
    if (age > 300 && !(process.env.PLATFORM_ENVIRONMENT === 'staging' && process.env.PLATFORM_SESSION_POLICY === 'VALID_SESSION')) return fail('SCHEDULE_REAUTH_REQUIRED');
    if (!row || row.employeeId !== principal.employeeId || row.status !== 'ACTIVE' || !Number.isSafeInteger(row.version) || row.version < 1 ||
        row.scope?.allRegions !== true || row.deletionRequestId != null || row.deletedAt != null || row.isDeleted === true ||
        (row.minimumAuthTime !== undefined && (!Number.isSafeInteger(row.minimumAuthTime) || row.minimumAuthTime < 0)) ||
        (row.minimumAuthTime || 0) > principal.authTime || row.mfaRequired === true && !principal.mfaEnrolled || age < -30 ||
        !allowed(row, 'finance.read') || !allowed(row, action === 'REQUEST' ? 'finance.settings.request' : 'finance.settings.approve')) return fail('SCHEDULE_PERMISSION_REQUIRED');
    return { row, guard: exactCheck(S, k, row, [...Object.keys(row), 'deletionRequestId', 'deletedAt', 'isDeleted', 'minimumAuthTime', 'mfaRequired']) };
  }
  async function scope(branchId: string) {
    if (!quoteEntityIdValid(branchId)) return fail('INVALID_SCHEDULE_REQUEST');
    const branch = await strongGet(db, B, { businessId: branchId });
    if (!branch || branch.businessId !== branchId || branch.status !== 'approved' || !quoteEntityIdValid(branch.ownerId) ||
        branch.ownerId !== branch.cognitoUserId || branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail('SCHEDULE_BRANCH_UNAVAILABLE');
    const guards: Row[] = [exactCheck(B, { businessId: branchId }, branch)];
    for (const pk of ['BUSINESS_LIFECYCLE#MERCHANT#' + branchId, 'ACCOUNT_LIFECYCLE#MERCHANT#' + branch.ownerId]) {
      const k = { pk, sk: 'META' };
      if (await readMerchantDeletionFence(db, k)) return fail('SCHEDULE_BRANCH_UNAVAILABLE');
      guards.push({ ConditionCheck: { TableName: D, Key: k, ConditionExpression: 'attribute_not_exists(pk)' } });
    }
    return { branch, guards };
  }
  async function agreement(branch: Row, reference: Row, from: string, until: string | null) {
    if (!reference || Object.keys(reference).sort().join(',') !== 'id,termsHash,version' || !quoteEntityIdValid(reference.id) ||
        !Number.isSafeInteger(reference.version) || reference.version < 1 || !/^[a-f0-9]{64}$/.test(reference.termsHash || '') ||
        branch.commercialAgreementId !== reference.id || branch.commercialAgreementVersion !== reference.version) return fail('SCHEDULE_AGREEMENT_UNAVAILABLE');
    const pk = 'COMMERCIAL_AGREEMENT#' + reference.id;
    const version = await strongGet(db, P, { pk, sk: 'VERSION#' + reference.version });
    const current = await strongGet(db, P, { pk, sk: 'CURRENT' });
    const acceptanceKey = { pk, sk: 'ACCEPTANCE#' + reference.version }, acceptance = await strongGet(db, P, acceptanceKey);
    if (!version || version.termsHash !== reference.termsHash || !current || current.version !== reference.version ||
        current.termsHash !== reference.termsHash || current.status !== 'ACTIVE' ||
        version.schemaVersion !== 2 || version.terms?.status !== 'ACTIVE' || version.terms?.merchantId !== branch.organizationId ||
        (version.terms?.branchId !== null && version.terms?.branchId !== branch.businessId) ||
        !iso(from) || !iso(version.terms?.effectiveFrom) || version.terms.effectiveFrom > from ||
        (version.terms.effectiveTo !== null && (!iso(version.terms.effectiveTo) || until === null || until > version.terms.effectiveTo)) ||
        !acceptance || acceptance.subjectId !== branch.ownerId || acceptance.status !== 'ACCEPTED' || acceptance.termsHash !== reference.termsHash) return fail('SCHEDULE_AGREEMENT_UNAVAILABLE');
    return [exactCheck(P, { pk, sk: version.sk }, version), exactCheck(P, { pk, sk: 'CURRENT' }, current), exactCheck(P, acceptanceKey, acceptance)];
  }
  async function current(branchId: string) {
    const k = key(branchId, 'CURRENT'), row = await strongGet(db, P, k);
    if (row && !await createMerchantSettlementScheduleReader(db)(branchId, row.effectiveFrom)) return fail('SCHEDULE_BASE_VERSION_CONFLICT');
    return { row, guard: row ? exactCheck(P, k, row) : { ConditionCheck: { TableName: P, Key: k, ConditionExpression: 'attribute_not_exists(pk)' } } };
  }
  function boundary(schedule: MerchantSettlementSchedule, from: string, until: string | null) {
    if (!iso(from) || from <= instant() || until !== null && (!iso(until) || until <= from)) return fail('SCHEDULE_FUTURE_BOUNDARY_REQUIRED');
    if (merchantSettlementPeriod(schedule, from).fromUtc !== from ||
        until !== null && merchantSettlementPeriod(schedule, until).fromUtc !== until) return fail('SCHEDULE_PERIOD_BOUNDARY_REQUIRED');
  }
  function checkProposal(row: Row, branchId: string) {
    const { pk, sk, proposalDigest, status, acceptedBy, acceptedAt, approvedBy, approvedAt, ...body } = row;
    if (row.kind !== 'MERCHANT_SETTLEMENT_SCHEDULE_PROPOSAL' || row.schemaVersion !== 1 || row.branchId !== branchId ||
        !uuid(row.proposalId) || !same({ pk, sk }, key(branchId, 'PROPOSAL#' + row.proposalId)) ||
        quoteHash(body) !== proposalDigest || !['AWAITING_OWNER', 'AWAITING_APPROVAL', 'APPROVED'].includes(status) ||
        (row.approvalPolicy !== undefined && !['SINGLE_ADMIN', 'INDEPENDENT'].includes(row.approvalPolicy)) ||
        !quoteEntityIdValid(row.ownerId) || !employeeId(row.requestedBy) || !iso(row.createdAt) ||
        (status === 'AWAITING_OWNER' && [acceptedBy, acceptedAt, approvedBy, approvedAt].some(v => v !== undefined)) ||
        (status !== 'AWAITING_OWNER' && (acceptedBy !== row.ownerId || !iso(acceptedAt) || acceptedAt < row.createdAt)) ||
        (status === 'AWAITING_APPROVAL' && (approvedBy !== undefined || approvedAt !== undefined)) ||
        (status === 'APPROVED' && (!employeeId(approvedBy) || approvedBy === row.requestedBy && row.approvalPolicy !== 'SINGLE_ADMIN' || !iso(approvedAt) || approvedAt < acceptedAt))) return fail('SCHEDULE_PROPOSAL_INVALID');
  }
  async function load(branchId: string, proposalId: string) {
    if (!uuid(proposalId)) return fail('INVALID_SCHEDULE_REQUEST');
    const row = await strongGet(db, P, key(branchId, 'PROPOSAL#' + proposalId));
    if (!row) return fail('SCHEDULE_PROPOSAL_NOT_FOUND');
    checkProposal(row, branchId); return row;
  }
  const audit = (branchId: string, proposalId: string, action: string, actorId: string, digest: string) => absent(S,
    { pk: 'SETTLEMENT_SCHEDULE_AUDIT#' + branchId, sk: proposalId + '#' + action,
      action, actorId, branchId, proposalId, digest, createdAt: instant() });
  async function commit(operations: Row[]) {
    if (operations.length > 100 || Buffer.byteLength(JSON.stringify(operations)) > 1024 * 1024) return fail('SCHEDULE_TRANSACTION_TOO_LARGE');
    try { await db.send(new TransactWriteCommand({ TransactItems: operations as any })); }
    catch { return fail('SCHEDULE_CONFLICT_OR_UNKNOWN_OUTCOME_RETRY_SAME_PROPOSAL'); }
  }
  return Object.freeze({
    async propose(value: unknown) {
      const input = detach(value) as Row;
      if (!input || Object.keys(input).sort().join(',') !== 'agreement,baseVersion,branchId,effectiveFrom,effectiveTo,proposalId,schedule' ||
          !uuid(input.proposalId) || !Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0 || input.baseVersion >= Number.MAX_SAFE_INTEGER) return fail('INVALID_SCHEDULE_REQUEST');
      const actor = await staff('REQUEST'), { branch, guards } = await scope(input.branchId);
      const agreementGuards = await agreement(branch, input.agreement, input.effectiveFrom, input.effectiveTo);
      const old = await strongGet(db, P, key(input.branchId, 'PROPOSAL#' + input.proposalId));
      if (old) {
        checkProposal(old, input.branchId);
        if (old.requestedBy !== actor.row.employeeId || old.requestHash !== quoteHash(input)) return fail('SCHEDULE_PROPOSAL_CONFLICT');
        return { proposal: old, replayed: true };
      }
      if (!input.schedule || Object.keys(input.schedule).sort().join(',') !== 'anchorLocalDate,frequency,timezone') return fail('INVALID_SCHEDULE_REQUEST');
      const schedule = { ...input.schedule, schemaVersion: 1, version: input.baseVersion + 1 } as MerchantSettlementSchedule;
      boundary(schedule, input.effectiveFrom, input.effectiveTo);
      const live = await current(input.branchId);
      if ((live.row?.schedule?.version || 0) !== input.baseVersion || live.row && (live.row.enabled !== true || live.row.effectiveFrom >= instant())) return fail('SCHEDULE_BASE_VERSION_CONFLICT');
      if (live.row && merchantSettlementPeriod(live.row.schedule, input.effectiveFrom).fromUtc !== input.effectiveFrom) return fail('SCHEDULE_PERIOD_BOUNDARY_REQUIRED');
      const body = { schemaVersion: 1, kind: 'MERCHANT_SETTLEMENT_SCHEDULE_PROPOSAL', branchId: input.branchId,
        proposalId: input.proposalId, requestHash: quoteHash(input), baseVersion: input.baseVersion, schedule,
        ownerId: branch.ownerId, agreement: input.agreement, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
        approvalPolicy: options.allowSameStaffApproval === true ? 'SINGLE_ADMIN' : 'INDEPENDENT',
        requestedBy: actor.row.employeeId, createdAt: instant() };
      const proposal = { ...key(input.branchId, 'PROPOSAL#' + input.proposalId), ...body, proposalDigest: quoteHash(body), status: 'AWAITING_OWNER' };
      await commit([actor.guard, ...guards, ...agreementGuards, live.guard, absent(P, proposal), audit(input.branchId, input.proposalId, 'SCHEDULE_PROPOSED', actor.row.employeeId, proposal.proposalDigest)]);
      return { proposal, replayed: false };
    },
    async consent(value: unknown) {
      const input = detach(value) as Row;
      if (!input || Object.keys(input).sort().join(',') !== 'branchId,proposalDigest,proposalId' || principal.kind !== 'OWNER') return fail('SCHEDULE_OWNER_REQUIRED');
      const { branch, guards } = await scope(input.branchId);
      if (principal.subjectId !== branch.ownerId) return fail('SCHEDULE_OWNER_REQUIRED');
      const row = await load(input.branchId, input.proposalId);
      if (row.ownerId !== branch.ownerId || row.proposalDigest !== input.proposalDigest) return fail('SCHEDULE_PROPOSAL_CONFLICT');
      if (row.status !== 'AWAITING_OWNER') {
        if (row.acceptedBy !== principal.subjectId || !iso(row.acceptedAt)) return fail('SCHEDULE_PROPOSAL_CONFLICT');
        return { proposal: row, replayed: true };
      }
      boundary(row.schedule, row.effectiveFrom, row.effectiveTo);
      const agreementGuards = await agreement(branch, row.agreement, row.effectiveFrom, row.effectiveTo), live = await current(input.branchId);
      if ((live.row?.schedule?.version || 0) !== row.baseVersion) return fail('SCHEDULE_BASE_VERSION_CONFLICT');
      const next = { ...row, status: 'AWAITING_APPROVAL', acceptedBy: principal.subjectId, acceptedAt: instant() };
      const { Key: _key, TableName: _table, ...proposalCondition } = exactCheck(P, key(input.branchId, 'PROPOSAL#' + row.proposalId), row).ConditionCheck;
      await commit([...guards, ...agreementGuards, live.guard, { Put: { TableName: P, Item: next, ...proposalCondition } }, audit(input.branchId, row.proposalId, 'SCHEDULE_OWNER_CONSENTED', principal.subjectId, row.proposalDigest)]);
      return { proposal: next, replayed: false };
    },
    async approve(value: unknown) {
      const input = detach(value) as Row;
      if (!input || Object.keys(input).sort().join(',') !== 'branchId,proposalDigest,proposalId') return fail('INVALID_SCHEDULE_REQUEST');
      const actor = await staff('APPROVE'), { branch, guards } = await scope(input.branchId), row = await load(input.branchId, input.proposalId);
      if (row.proposalDigest !== input.proposalDigest || row.ownerId !== branch.ownerId || row.acceptedBy !== branch.ownerId || !iso(row.acceptedAt) ||
          actor.row.employeeId === row.requestedBy && !(row.approvalPolicy === 'SINGLE_ADMIN' && options.allowSameStaffApproval === true)) return fail('SCHEDULE_INDEPENDENT_APPROVAL_REQUIRED');
      if (row.status === 'APPROVED') return { proposal: row, replayed: true };
      if (row.status !== 'AWAITING_APPROVAL') return fail('SCHEDULE_OWNER_CONSENT_REQUIRED');
      const requesterKey = { pk: 'EMPLOYEE#' + row.requestedBy, sk: 'PROFILE' };
      const requester = await strongGet(db, S, requesterKey);
      if (!requester || requester.employeeId !== row.requestedBy || requester.status !== 'ACTIVE' || requester.scope?.allRegions !== true ||
          requester.deletionRequestId != null || requester.deletedAt != null || requester.isDeleted === true ||
          !allowed(requester, 'finance.settings.request') || !allowed(requester, 'finance.read')) return fail('SCHEDULE_REQUESTER_PERMISSION_REVOKED');
      const requesterGuard = exactCheck(S, requesterKey, requester, [...Object.keys(requester), 'deletionRequestId', 'deletedAt', 'isDeleted']);
      boundary(row.schedule, row.effectiveFrom, row.effectiveTo);
      const live = await current(input.branchId), agreementGuards = await agreement(branch, row.agreement, row.effectiveFrom, row.effectiveTo);
      if ((live.row?.schedule?.version || 0) !== row.baseVersion) return fail('SCHEDULE_BASE_VERSION_CONFLICT');
      if (live.row && (live.row.effectiveFrom >= instant() || merchantSettlementPeriod(live.row.schedule, row.effectiveFrom).fromUtc !== row.effectiveFrom)) return fail('SCHEDULE_PERIOD_BOUNDARY_REQUIRED');
      const body = { schemaVersion: 1, kind: 'MERCHANT_SETTLEMENT_SCHEDULE', branchId: input.branchId, ownerId: branch.ownerId,
        enabled: true, status: 'APPROVED', schedule: row.schedule, agreement: row.agreement, effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo, acceptedBy: row.acceptedBy, acceptedAt: row.acceptedAt,
        approvedBy: actor.row.employeeId, approvedAt: instant() };
      const envelope = { ...key(input.branchId, 'CURRENT'), ...body, digest: quoteHash(body) };
      const next = { ...row, status: 'APPROVED', approvedBy: actor.row.employeeId, approvedAt: body.approvedAt };
      const condition = live.guard.ConditionCheck;
      const { Key: _a, TableName: _b, ...proposalCondition } = exactCheck(P, key(input.branchId, 'PROPOSAL#' + row.proposalId), row).ConditionCheck;
      const { Key: _c, TableName: _d, ...currentCondition } = condition;
      await commit([actor.guard, ...(actor.row.employeeId === row.requestedBy ? [] : [requesterGuard]), ...guards, ...agreementGuards,
        { Put: { TableName: P, Item: envelope, ...currentCondition } },
        absent(P, { ...envelope, ...key(input.branchId, 'VERSION#' + row.schedule.version) }),
        ...(live.row ? [absent(P, { ...key(input.branchId, 'CLOSED#' + live.row.schedule.version), schemaVersion: 1,
          kind: 'MERCHANT_SETTLEMENT_SCHEDULE_CLOSURE', branchId: input.branchId, version: live.row.schedule.version,
          sourceDigest: live.row.digest, untilExclusive: row.effectiveFrom, replacedByVersion: row.schedule.version,
          proposalId: row.proposalId, createdAt: body.approvedAt })] : []),
        { Put: { TableName: P, Item: next, ...proposalCondition } }, audit(input.branchId, row.proposalId, 'SCHEDULE_APPROVED', actor.row.employeeId, envelope.digest)]);
      return { proposal: next, current: envelope, replayed: false };
    },
  });
}
