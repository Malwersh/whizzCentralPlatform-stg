'use strict';

const { GetCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { createExecution } = require('../../../backend/staff-service/merchant-ownership-execution');
const { createLock } = require('../../../backend/staff-service/merchant-ownership-lock');
const { enqueue } = require('../merchant-ownership/notice-record.cjs');
const { allowed } = require('../driver-review/catalog');
const { createPreflight } = require('../../../backend/staff-service/merchant-ownership-preflight');
const { createSettlementDecision, settlementStatus } = require('../../../backend/staff-service/merchant-ownership-settlement');

const production = name => 'wizz-production-' + name;
const tables = Object.fromEntries(Object.entries({
  platform: 'MerchantPlatform', businesses: 'Merchants', deletion: 'AccountDeletion',
  orders: 'Orders', holds: 'Holds', topups: 'TopupRequests', transfers: 'IdempotencyKeys', wallets: 'Wallets',
}).map(([key, name]) => [key, production(name)]));
const identifier = value => typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const waiting = new Set(['AWAITING_RECIPIENT', 'AWAITING_REVIEW']);
const deletionScopes = new Set(['ACCOUNT', 'BUSINESS', 'MEMBERSHIP']);
const deletionStates = new Set(['PENDING_SETTLEMENT', 'PENDING_EXTERNAL_ASSET', 'PENDING_POLICY', 'READY',
  'PROCESSING', 'RETRY_REQUIRED', 'COMPLETED', 'CANCELLED']);
const fail = (status, message) => Object.assign(Error(message), { status });
const read = async (db, TableName, Key, projection) =>
  (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true, ...projection }))).Item;
const branchProjection = {
  ProjectionExpression: 'businessId,businessName,#name,branchName,organizationId',
  ExpressionAttributeNames: { '#name': 'name' },
};
const applicableIds = row => Array.isArray(row?.branchIds) && row.branchIds.length > 0 &&
  row.branchIds.length <= 97 && row.branchIds.every(identifier) &&
  new Set(row.branchIds).size === row.branchIds.length;

async function branchName(db, businessId, organizationId) {
  const branch = await read(db, tables.businesses, { businessId }, branchProjection);
  if (!branch || (organizationId !== undefined && branch.organizationId !== organizationId)) return null;
  return branch.businessName || branch.name || branch.branchName || null;
}

function encodeCursor(key, kind) {
  return key ? Buffer.from(JSON.stringify({ kind, key })).toString('base64url') : null;
}

function decodeCursor(raw, kind) {
  if (raw === undefined) return;
  try {
    if (typeof raw !== 'string' || raw.length > 6000 || !/^[a-z0-9_-]+$/i.test(raw)) throw Error();
    const cursor = JSON.parse(Buffer.from(raw, 'base64url'));
    const key = cursor.key;
    if (cursor.kind !== kind || Object.keys(key).length !== 2) throw Error();
    if (typeof key.pk !== 'string' || !key.pk || key.pk.length > 2048 ||
        typeof key.sk !== 'string' || !key.sk || key.sk.length > 1024) throw Error();
    return key;
  } catch {
    throw fail(400, 'INVALID_CURSOR');
  }
}

function ownershipSummary(row, now) {
  return {
    kind: 'ownership', requestId: row.requestId, organizationId: row.organizationId,
    status: waiting.has(row.status) && row.expiresAt <= now ? 'EXPIRED' : row.status,
    createdAt: row.createdAt, expiresAt: row.expiresAt, branchCount: row.branchIds.length,
    agreementVersion: row.agreementVersion || null, completedAt: row.completedAt ?? null,
  };
}

function deletionSummary(row, name) {
  return {
    kind: 'closure', requestId: row.requestId, scope: row.scope.kind,
    businessId: row.scope.kind === 'BUSINESS' ? row.scope.id : undefined, name,
    status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    blockers: Array.isArray(row.blockers) ? row.blockers.filter(item => typeof item?.code === 'string').map(({ code, count, amount, action }) => ({ code, count, amount, action })) : null,
  };
}

const validTransfer = row => uuid(row.requestId) && identifier(row.organizationId) &&
  row.pk === 'ORGANIZATION#' + row.organizationId && row.sk === 'OWNERSHIP_TRANSFER' &&
  applicableIds(row) && Number.isSafeInteger(row.expiresAt);

const validClosure = row => row.actorType === 'MERCHANT' && row.pk?.startsWith('SUBJECT#MERCHANT#') && uuid(row.requestId) &&
  row.sk === 'REQUEST#' + row.requestId && deletionScopes.has(row.scope?.kind) &&
  (row.scope.kind !== 'BUSINESS' || identifier(row.scope.id)) && deletionStates.has(row.status);

async function list(db, kind, query, now) {
  let cursor = decodeCursor(query.cursor, kind);
  const ownership = kind === 'ownership';
  const scan = ownership ? {
    TableName: tables.platform,
    FilterExpression: 'begins_with(pk,:owner) AND sk=:record AND #s IN (:invited,:review) AND expiresAt>:now',
    ProjectionExpression: 'pk,sk,requestId,organizationId,branchIds,#s,expiresAt,createdAt,agreementVersion',
    ExpressionAttributeValues: {
      ':owner': 'ORGANIZATION#', ':record': 'OWNERSHIP_TRANSFER', ':invited': 'AWAITING_RECIPIENT',
      ':review': 'AWAITING_REVIEW', ':now': now,
    },
    ExpressionAttributeNames: { '#s': 'status' },
  } : {
    TableName: tables.deletion,
    FilterExpression: 'begins_with(pk,:merchant) AND begins_with(sk,:record) AND actorType=:actor',
    ProjectionExpression: 'pk,sk,requestId,actorType,#scope,#s,blockers,createdAt,updatedAt',
    ExpressionAttributeValues: { ':merchant': 'SUBJECT#MERCHANT#', ':record': 'REQUEST#', ':actor': 'MERCHANT' },
    ExpressionAttributeNames: { '#scope': 'scope', '#s': 'status' },
  };
  const rows = [];
  for (let page = 0; page < 10; page++) {
    const result = await db.send(new ScanCommand({
      ...scan, Limit: 100, ConsistentRead: true, ExclusiveStartKey: cursor,
    }));
    const matches = (result.Items || []).filter(ownership ? validTransfer : validClosure);
    const available = 20 - rows.length;
    rows.push(...matches.slice(0, available));
    cursor = matches.length > available
      ? { pk: rows.at(-1).pk, sk: rows.at(-1).sk }
      : result.LastEvaluatedKey;
    if (!cursor || rows.length === 20) break;
  }
  const items = await Promise.all(rows.map(async row => {
    if (ownership) {
      return { ...ownershipSummary(row, now), name: await branchName(db, row.branchIds[0], row.organizationId) };
    }
    const name = row.scope.kind === 'BUSINESS' ? await branchName(db, row.scope.id) : null;
    return deletionSummary(row, name);
  }));
  const recency = item => Number(item.updatedAt || item.createdAt) || Date.parse(item.updatedAt || item.createdAt) || 0;
  items.sort((a, b) => Number(b.status === 'AWAITING_REVIEW') - Number(a.status === 'AWAITING_REVIEW') ||
    recency(b) - recency(a));
  return { items, nextCursor: encodeCursor(cursor, kind) };
}

const preflight = createPreflight({ tables, production: true });
const execute = createExecution({
  environment: 'production', tables,
  completionWrites(request, now) {
    const notice = { ...request, expiresAt: now + 48 * 60 * 60 * 1000 };
    return ['ownership_completed_previous', 'ownership_completed_new'].map(action => enqueue(notice, action, now));
  },
});
const approveDestination = createSettlementDecision({ table: tables.platform });
const canReviewOwnership = actor => actor.scope?.allRegions === true && allowed(actor, 'merchants.review');
const participant = (row, actor) => [row.ownerId, row.recipientId].includes(actor.employeeId);

async function readTransfer(db, { organizationId, requestId }) {
  const row = await read(db, tables.platform, { pk: 'ORGANIZATION#' + organizationId, sk: 'OWNERSHIP_TRANSFER' });
  if (!row || !validTransfer(row) || row.requestId !== requestId || row.organizationId !== organizationId) {
    throw fail(404, 'TRANSFER_NOT_FOUND');
  }
  return row;
}

async function lifecycleRequests(db, actor, query, now, { readPreflight = preflight } = {}) {
  const ownership = canReviewOwnership(actor);
  const closure = actor.scope?.allRegions === true && (allowed(actor, 'audit.read') || allowed(actor, 'finance.read'));
  if (!ownership && !closure) throw fail(403, 'PERMISSION_REQUIRED');
  if (!Object.keys(query).length) {
    const kind = ownership ? 'ownership' : 'closure';
    return { available: { ownership, closure }, kind, ...await list(db, kind, {}, now) };
  }
  if (query.kind === 'closure' || query.kind === 'ownership') {
    if (Object.keys(query).some(key => key !== 'kind' && key !== 'cursor')) throw fail(400, 'INVALID_QUERY');
    if (query.kind === 'closure' ? !closure : !ownership) throw fail(403, 'PERMISSION_REQUIRED');
    return { available: { ownership, closure }, kind: query.kind, ...await list(db, query.kind, query, now) };
  }
  if (Object.keys(query).length !== 2 || !uuid(query.requestId) || !identifier(query.organizationId)) {
    throw fail(400, 'INVALID_QUERY');
  }
  if (!ownership) throw fail(403, 'PERMISSION_REQUIRED');
  const row = await readTransfer(db, query);
  const request = ownershipSummary(row, now);
  const branches = await Promise.all(row.branchIds.map(async businessId => ({
    businessId, name: await branchName(db, businessId, row.organizationId),
  })));
  const canReject = request.status === 'AWAITING_REVIEW' && !participant(row, actor);
  const canCheck = allowed(actor, 'finance.approve');
  const decisionContext = { baseVersion: row.version, canReject, canCheck };
  if (request.status !== 'AWAITING_REVIEW' || !canCheck) {
    return { request, branches, checkedAt: null, ...decisionContext };
  }
  const settlement = await settlementStatus(db, row, now, GetCommand, tables.platform, true);
  let result;
  let checkError;
  try {
    result = await readPreflight(db, row, now);
  } catch (error) {
    checkError = error.message === 'TRANSFER_INVENTORY_INCOMPLETE'
      ? 'TRANSFER_INVENTORY_INCOMPLETE' : 'TRANSFER_CHECK_UNAVAILABLE';
  }
  const code = {
    VERIFICATION_REQUIRED: 'TRANSFER_DESTINATION_VERIFICATION_REQUIRED',
    REVIEW_REQUIRED: 'TRANSFER_SETTLEMENT_APPROVAL_REQUIRED',
  }[settlement.status];
  const blockersByBranch = new Map(result?.branches.map(branch => [branch.businessId, branch.blockers]));
  return {
    request, branches: branches.map(branch => ({ ...branch, blockers: blockersByBranch.get(branch.businessId) })),
    ...decisionContext, settlement: settlement.status, maskedPhone: settlement.maskedPhone,
    checkedAt: result?.checkedAt ?? null, blockers: code ? [{ code }] : [], checkError,
    canApprove: !participant(row, actor) && settlement.status === 'APPROVED' &&
      result?.branches.length === row.branchIds.length && result.branches.every(branch => branch.blockers.length === 0),
    canApproveSettlement: !participant(row, actor) && settlement.status === 'REVIEW_REQUIRED',
    settlementEvidence: settlement.status === 'REVIEW_REQUIRED' ? {
      profileVersion: settlement.profileVersion, proofVersion: settlement.proofVersion,
    } : undefined,
  };
}

const positiveVersion = value => Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;

async function lifecycleDecision(ctx, actor, input, now) {
  if (!canReviewOwnership(actor)) throw fail(403, 'PERMISSION_REQUIRED');
  const approving = input.decision === 'APPROVE_SETTLEMENT';
  const completing = input.decision === 'APPROVE';
  const fields = ['decision', 'organizationId', 'requestId', 'baseVersion', 'reason',
    ...(approving ? ['profileVersion', 'proofVersion'] : [])];
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if ((!completing && !approving && input.decision !== 'REJECT') || Object.keys(input).length !== fields.length ||
      Object.keys(input).some(key => !fields.includes(key)) || !identifier(input.organizationId) || !uuid(input.requestId) ||
      !positiveVersion(input.baseVersion) || reason.length < 5 || reason.length > 500 ||
      (approving && (!positiveVersion(input.profileVersion) || !positiveVersion(input.proofVersion)))) {
    throw fail(400, 'INVALID_TRANSFER_REVIEW');
  }
  if ((approving || completing) && !allowed(actor, 'finance.approve')) throw fail(403, 'PERMISSION_REQUIRED');
  const row = await readTransfer(ctx.db, input);
  if (participant(row, actor)) throw fail(403, 'PERMISSION_REQUIRED');
  if (completing && row.status === 'COMPLETED' && row.version === input.baseVersion + 1) {
    return { status: 'COMPLETED' };
  }
  if (row.status !== 'AWAITING_REVIEW' || row.version !== input.baseVersion || row.expiresAt <= now()) {
    throw fail(409, 'VERSION_OR_STATE_CONFLICT');
  }

  if (approving) {
    const settlement = await approveDestination(ctx, actor, row, reason, now(), input);
    return { status: 'AWAITING_REVIEW', settlement: settlement.status };
  }

  if (completing) {
    try {
      await createLock({ tables, clock: now })(ctx, actor, row, reason, execute);
    } catch (error) {
      if (['TRANSFER_SCOPE_EXCEEDS_TRANSACTION_LIMIT', 'TRANSFER_BRAND_INVENTORY_REQUIRED',
        'TRANSFER_PLATFORM_SCOPE_CHANGED', 'TRANSFER_SCOPE_CHANGED', 'BRANCH_OWNERSHIP_CHANGED',
        'ORGANIZATION_OWNERSHIP_CHANGED', 'TRANSFER_EXPIRED', 'TRANSFER_STATE_CHANGED'].includes(error.code)) {
        throw fail(409, error.code);
      }
      throw error;
    }
    return { status: 'COMPLETED' };
  }

  const rejectedAt = now();
  const values = { ':request': row.requestId };
  await ctx.db.send(new TransactWriteCommand({ TransactItems: [
    ctx.guard(actor),
    { Update: {
      TableName: tables.platform, Key: { pk: row.pk, sk: row.sk },
      UpdateExpression: 'SET #s=:rejected, #v=:next, reviewerId=:actor, rejectedAt=:now',
      ConditionExpression: 'requestId=:request AND #s=:pending AND #v=:version AND expiresAt>:now',
      ExpressionAttributeNames: { '#s': 'status', '#v': 'version' },
      ExpressionAttributeValues: { ...values, ':pending': 'AWAITING_REVIEW', ':version': row.version,
        ':rejected': 'REJECTED', ':next': row.version + 1, ':actor': actor.employeeId, ':now': rejectedAt },
    } },
    ...row.branchIds.map(businessId => ({ Update: {
      TableName: tables.businesses, Key: { businessId },
      UpdateExpression: 'REMOVE orderIntakeTransferRequestId, orderIntakeTransferExpiresAt',
      ConditionExpression: 'orderIntakeTransferRequestId=:request AND orderIntakeTransferExpiresAt=:expires',
      ExpressionAttributeValues: { ...values, ':expires': row.expiresAt },
    } })),
    ctx.audit(actor.employeeId, 'MERCHANT_OWNERSHIP_TRANSFER_REJECTED', ownershipSummary(row, rejectedAt),
      { ...ownershipSummary({ ...row, status: 'REJECTED' }, rejectedAt), reason }, row.requestId),
  ] }));
  return { status: 'REJECTED' };
}

module.exports = { lifecycleRequests, lifecycleDecision };
