'use strict';

const { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('node:crypto');
const { allowed } = require('../driver-review/catalog');
const audit = require('../../../backend/staff-service/audit-trail');
const onboarding = require('../../../backend/staff-service/merchant-onboarding');
const { identities } = require('../wallet-identity-bindings.json');
const { controlBranch, controlView } = require('./control.cjs');
const { lifecycleRequests, lifecycleDecision } = require('./lifecycle.cjs');

const ROOT = '/staff/merchants';
const STAFF = 'wizz-production-PlatformStaff';
const tables = {
  platform: 'wizz-production-MerchantPlatform',
  businesses: 'wizz-production-Merchants',
  lifecycle: 'wizz-production-AccountDeletion',
};
const onboardingKey = 'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING';
const identifier = value => typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const queueId = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z#[a-f0-9-]{36}$/i.test(value) && value.length < 100;
const fail = (status, message) => Object.assign(new Error(message), { status });
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const decisions = new Set(['APPROVE', 'REJECT', 'NEEDS_INFORMATION']);

const routes = {
  [ROOT + '/directory']: 'GET',
  [ROOT + '/branch']: 'GET',
  [ROOT + '/applications']: 'GET',
  [ROOT + '/applications/review']: 'POST',
  [ROOT + '/application-asset']: 'GET',
  [ROOT + '/control']: 'POST',
  [ROOT + '/lifecycle']: 'GET',
  [ROOT + '/lifecycle/decision']: 'POST',
};
const read = async (db, TableName, Key) =>
  (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
const check = (TableName, Key, predicates, names, values) => ({
  ConditionCheck: { TableName, Key, ConditionExpression: predicates,
    ...(names && { ExpressionAttributeNames: names }), ...(values && { ExpressionAttributeValues: values }) },
});
const inRegion = (actor, permission, region) => typeof region === 'string' && allowed(actor, permission, region);
const visibleBranch = b => b && !b.isDeleted && !b.deletedAt && !b.deletionRequestId &&
  !['deleting', 'deleted'].includes(String(b.status || '').toLowerCase());

async function authorize(db, event, verifyAccess, liveIdentity, now, needsMerchantRead) {
  const auth = Object.entries(event.headers || {}).filter(([name]) => name.toLowerCase() === 'authorization');
  const token = auth.length === 1 && /^Bearer ([\w.-]{1,8192})$/i.exec(auth[0][1])?.[1];
  if (!token) throw fail(401, 'UNAUTHORIZED');
  let claims;
  try { claims = await verifyAccess(token); }
  catch { throw fail(401, 'UNAUTHORIZED'); }
  const { poolId, clientId } = identities.admin;
  if (claims?.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId ||
      claims.client_id !== clientId || claims.token_use !== 'access' || !uuid(claims.sub) || !claims.username ||
      !Number.isFinite(claims.exp) || claims.exp * 1000 <= now() ||
      !Number.isInteger(claims.auth_time) || claims.auth_time * 1000 > now()) throw fail(401, 'UNAUTHORIZED');
  const actor = await read(db, STAFF, { pk: 'EMPLOYEE#' + claims.sub, sk: 'PROFILE' });
  if (!actor || actor.employeeId !== claims.sub || actor.status !== 'ACTIVE' ||
      !Number.isSafeInteger(actor.version) || actor.version < 1 || actor.deletedAt != null ||
      actor.isDeleted === true || actor.deletionRequestId != null || (actor.minimumAuthTime || 0) > claims.auth_time ||
      (needsMerchantRead && !allowed(actor, 'merchants.read'))) {
    throw fail(403, 'PERMISSION_REQUIRED');
  }
  const live = await liveIdentity(claims);
  if (!live?.Enabled || live.UserStatus !== 'CONFIRMED' ||
      live.UserAttributes?.find(x => x.Name === 'sub')?.Value !== claims.sub ||
      !live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')) throw fail(403, 'ADMIN_MFA_REQUIRED');
  return actor;
}

function staffGuard(actor) {
  return check(STAFF, { pk: 'EMPLOYEE#' + actor.employeeId, sk: 'PROFILE' },
    '#v=:v AND #s=:active', { '#v': 'version', '#s': 'status' }, { ':v': actor.version, ':active': 'ACTIVE' });
}

function decodeCursor(raw, field, validate) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw fail(400, 'INVALID_CURSOR');
  const key = Buffer.from(raw, 'base64url').toString('utf8');
  if (!validate(key)) throw fail(400, 'INVALID_CURSOR');
  return { [field]: key };
}

const encodeCursor = (key, field) => key ? Buffer.from(key[field]).toString('base64url') : null;

function branchSummary(b) {
  return {
    businessId: b.businessId, name: b.businessName || b.name || 'فرع بلا اسم',
    type: b.businessTypeLabelAr || b.businessTypeId || b.businessType || '',
    region: b.address?.region || b.regionId, status: b.status, operatingStatus: b.operatingStatus,
    acceptingOrders: b.acceptingOrders === true, active: b.isActive === true, onboardingComplete: b.onboardingComplete === true,
    ordersBlocked: b.ordersBlocked === true, platformSuspended: b.platformSuspended === true,
  };
}

async function directory(db, actor, query) {
  if (Object.keys(query).some(key => key !== 'cursor')) throw fail(400, 'INVALID_QUERY');
  const page = await db.send(new ScanCommand({
    TableName: tables.businesses, Limit: 40, ConsistentRead: true,
    ExclusiveStartKey: decodeCursor(query.cursor, 'businessId', identifier),
    ProjectionExpression: 'businessId,businessName,#name,businessTypeLabelAr,businessTypeId,businessType,regionId,address,#status,operatingStatus,acceptingOrders,isActive,onboardingComplete,isDeleted,deletedAt,deletionRequestId,ordersBlocked,platformSuspended',
    ExpressionAttributeNames: { '#name': 'name', '#status': 'status' },
  }));
  return {
    items: (page.Items || []).filter(row => visibleBranch(row) && inRegion(actor, 'merchants.read', row.regionId)).map(branchSummary),
    nextCursor: encodeCursor(page.LastEvaluatedKey, 'businessId'),
  };
}

async function branchDetails(db, actor, query, now) {
  if (Object.keys(query).length !== 1 || !identifier(query.businessId)) throw fail(400, 'INVALID_QUERY');
  const b = await read(db, tables.businesses, { businessId: query.businessId });
  if (!visibleBranch(b) || !inRegion(actor, 'merchants.read', b.regionId)) throw fail(404, 'BRANCH_UNAVAILABLE');
  const menu = await read(db, tables.platform, { pk: 'BRANCH#' + b.businessId, sk: 'MENU_VERSION#ACTIVE' });
  let agreement = null;
  if (allowed(actor, 'commercial.read') && actor.scope?.allRegions === true) {
    agreement = { status: 'UNASSIGNED' };
    if (identifier(b.commercialAgreementId) && Number.isSafeInteger(b.commercialAgreementVersion)) {
      const pk = 'COMMERCIAL_AGREEMENT#' + b.commercialAgreementId;
      const [current, version, consent, approval] = await Promise.all([
        read(db, tables.platform, { pk, sk: 'CURRENT' }),
        read(db, tables.platform, { pk, sk: 'VERSION#' + b.commercialAgreementVersion }),
        read(db, tables.platform, { pk, sk: 'ACCEPTANCE#' + b.commercialAgreementVersion }),
        read(db, STAFF, { pk, sk: 'APPROVAL#' + b.commercialAgreementVersion }),
      ]);
      const terms = version?.terms;
      const bound = terms && typeof b.organizationId === 'string' && b.cognitoUserId === b.ownerId &&
        current?.status === 'ACTIVE' && current.version === b.commercialAgreementVersion &&
        /^[a-f0-9]{64}$/i.test(current.termsHash || '') && version?.termsHash === current.termsHash &&
        terms.id === b.commercialAgreementId && terms.version === current.version &&
        terms?.merchantId === b.organizationId && (terms.branchId === null || terms.branchId === b.businessId) &&
        terms.status === 'ACTIVE' && consent?.status === 'ACCEPTED' && consent.subjectId === b.ownerId &&
        approval?.status === 'APPROVED' && consent.termsHash === current.termsHash && approval.termsHash === current.termsHash &&
        approval.approvedAt === terms.approvedAt && consent.acceptedAt === terms.acceptedAt &&
        Date.parse(consent.acceptedAt) <= now() && Date.parse(approval.approvedAt) <= now();
      if (!bound || !Number.isFinite(Date.parse(terms.effectiveFrom)) ||
          (terms.effectiveTo !== null && !Number.isFinite(Date.parse(terms.effectiveTo)))) {
        agreement = { status: 'REVIEW_REQUIRED' };
      } else {
        const status = Date.parse(terms.effectiveFrom) > now() ? 'SCHEDULED'
          : terms.effectiveTo && Date.parse(terms.effectiveTo) <= now() ? 'EXPIRED' : 'ACTIVE';
        agreement = { status, version: current.version, effectiveFrom: terms.effectiveFrom, effectiveTo: terms.effectiveTo };
      }
    }
  }
  return { ...branchSummary(b), address: b.address?.fullAddress || '', menuPublished: Boolean(menu?.publishedVersion),
    agreement, control: controlView(actor, b, now()) };
}

async function queuePage(db, actor, query) {
  if (Object.keys(query).some(key => key !== 'cursor')) throw fail(400, 'INVALID_QUERY');
  const cursor = decodeCursor(query.cursor, 'sk', queueId);
  const page = await db.send(new QueryCommand({
    TableName: tables.platform, ConsistentRead: true,
    KeyConditionExpression: 'pk=:queue', ExpressionAttributeValues: { ':queue': 'REVIEW#MERCHANT' },
    ScanIndexForward: false, Limit: 30, ...(cursor && { ExclusiveStartKey: { pk: 'REVIEW#MERCHANT', ...cursor } }),
  }));
  const requests = await Promise.all((page.Items || []).filter(row =>
    row.status === 'SUBMITTED' && uuid(row.subjectId) && uuid(row.draftId) &&
    inRegion(actor, 'merchants.read', row.regionId)).map(async row => {
    const draft = await read(db, tables.platform, { pk: 'PERSON#' + row.subjectId, sk: 'DRAFT#' + row.draftId });
    if (draft?.reviewStatus !== 'SUBMITTED' || draft.version !== row.draftVersion ||
        draft.submission?.requestId !== row.requestId || draft.regionId !== row.regionId) return null;
    return {
      queueKey: row.sk, version: draft.version, name: draft.name, type: draft.businessTypeId,
      region: draft.regionNames?.at(-1) || row.regionId, address: draft.address,
      openingHours: draft.openingHours, submittedAt: draft.submission.submittedAt,
      termsVersion: draft.submission.agreement?.version,
      canReview: inRegion(actor, 'merchants.review', row.regionId),
      canReadDocuments: inRegion(actor, 'merchants.documents.read', row.regionId),
      documents: [draft.registrationCertificateAssetId && { kind: 'registration', id: draft.registrationCertificateAssetId },
        draft.businessPhotoAssetId && { kind: 'photo', id: draft.businessPhotoAssetId }].filter(Boolean),
    };
  }));
  return { items: requests.filter(Boolean), nextCursor: encodeCursor(page.LastEvaluatedKey, 'sk') };
}

async function currentAsset(db, draft, id) {
  const kind = id === draft.registrationCertificateAssetId ? 'REGISTRATION_CERTIFICATE'
    : id === draft.businessPhotoAssetId ? 'BUSINESS_PHOTO' : null;
  if (!kind || !uuid(id)) throw fail(404, 'ASSET_UNAVAILABLE');
  const key = { pk: 'PERSON#' + draft.subjectId, sk: 'ASSET#' + id };
  const asset = await read(db, tables.platform, key);
  if (asset?.status !== 'READY' || asset.assetId !== id || asset.kind !== kind ||
      asset.subjectId !== draft.subjectId || asset.draftId !== draft.draftId ||
      !/^[a-f0-9]{64}$/i.test(asset.sha256 || '') ||
      !['image/jpeg', 'image/png', 'application/pdf'].includes(asset.contentType) ||
      asset.key !== 'persons/' + draft.subjectId + '/drafts/' + draft.draftId + '/' + id) {
    throw fail(404, 'ASSET_UNAVAILABLE');
  }
  return { key, asset };
}

async function openDocument(db, actor, query, signDocument) {
  if (!queueId(query.queueKey) || !uuid(query.assetId) || Object.keys(query).length !== 2) throw fail(400, 'INVALID_QUERY');
  const queue = await read(db, tables.platform, { pk: 'REVIEW#MERCHANT', sk: query.queueKey });
  if (!queue || queue.status !== 'SUBMITTED' || !uuid(queue.subjectId) || !uuid(queue.draftId) ||
      !inRegion(actor, 'merchants.documents.read', queue.regionId)) throw fail(404, 'APPLICATION_UNAVAILABLE');
  const draft = await read(db, tables.platform, { pk: 'PERSON#' + queue.subjectId, sk: 'DRAFT#' + queue.draftId });
  if (draft?.reviewStatus !== 'SUBMITTED' || draft.version !== queue.draftVersion ||
      draft.submission?.requestId !== queue.requestId || draft.regionId !== queue.regionId) {
    throw fail(404, 'APPLICATION_UNAVAILABLE');
  }
  const { key, asset } = await currentAsset(db, draft, query.assetId);
  await db.send(new TransactWriteCommand({ TransactItems: [
    staffGuard(actor),
    check(tables.platform, key, '#s=:ready AND sha256=:hash', { '#s': 'status' }, { ':ready': 'READY', ':hash': asset.sha256 }),
    check(tables.platform, { pk: draft.pk, sk: draft.sk }, '#v=:v AND #s=:submitted',
      { '#v': 'version', '#s': 'reviewStatus' }, { ':v': draft.version, ':submitted': 'SUBMITTED' }),
    check(tables.lifecycle, { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + draft.subjectId, sk: 'META' }, 'attribute_not_exists(pk)'),
    audit.write(STAFF, actor, actor.employeeId, 'MERCHANT_APPLICATION_DOCUMENT_VIEWED', null,
      { requestId: queue.requestId, kind: asset.kind }, randomUUID()),
  ] }));
  return { url: await signDocument(asset), expiresIn: 60 };
}

async function reviewChecks(db, regions, draft, queue) {
  const accepted = draft.submission?.agreement;
  const pinned = await read(db, STAFF, { pk: onboardingKey, sk: 'VERSION#' + draft.configVersion });
  const submission = await read(db, tables.platform, { pk: draft.pk, sk: 'SUBMISSION#' + queue.requestId });
  if (!pinned?.values?.partnershipReady || accepted?.subjectId !== queue.subjectId ||
      !accepted?.acceptedAt || accepted.version !== pinned.values.termsVersion ||
      accepted.textAr !== pinned.values.termsTextAr || submission?.requestId !== queue.requestId ||
      submission.subjectId !== queue.subjectId || submission.draftId !== draft.draftId ||
      submission.agreement?.version !== accepted.version ||
      submission.agreement?.acceptedAt !== accepted.acceptedAt || draft.subjectId !== queue.subjectId ||
      draft.regionId !== queue.regionId || submission.draftVersion + 1 !== draft.version) {
    throw fail(409, 'SUBMISSION_EVIDENCE_REQUIRED');
  }
  const validated = await regions.validate(draft.regionPath, draft.latitude, draft.longitude);
  if (validated.regionId !== draft.regionId) throw fail(409, 'LOCATION_OUTSIDE_REGION');
  const documents = await Promise.all([draft.registrationCertificateAssetId, draft.businessPhotoAssetId]
    .filter(Boolean).map(id => currentAsset(db, draft, id)));
  return [
    check(STAFF, { pk: onboardingKey, sk: 'VERSION#' + draft.configVersion },
      'policyVersion=:version AND #values.termsVersion=:terms', { '#values': 'values' },
      { ':version': draft.configVersion, ':terms': accepted.version }),
    check(tables.platform, { pk: draft.pk, sk: 'SUBMISSION#' + queue.requestId },
      'requestId=:request AND draftVersion=:revision', null,
      { ':request': queue.requestId, ':revision': submission.draftVersion }),
    ...validated.checks, ...documents.map(({ key, asset }) =>
    check(tables.platform, key, '#s=:ready AND sha256=:hash', { '#s': 'status' }, { ':ready': 'READY', ':hash': asset.sha256 }))];
}

function createApi({ db, verifyAccess, liveIdentity, regions, signDocument, now = Date.now }) {
  return async event => {
    try {
      const route = event.path;
      if (event.requestContext?.stage !== 'production' || !Object.hasOwn(routes, route) ||
          routes[route] !== event.httpMethod) throw fail(404, 'NOT_FOUND');
      const lifecycle = route === ROOT + '/lifecycle';
      const actor = await authorize(db, event, verifyAccess, liveIdentity, now, !lifecycle);
      const q = event.queryStringParameters || {};
      if (lifecycle) return reply(200, await lifecycleRequests(db, actor, q, now()));
      if (route.endsWith('/directory')) return reply(200, await directory(db, actor, q));
      if (route.endsWith('/branch')) return reply(200, await branchDetails(db, actor, q, now));
      if (route.endsWith('/applications')) return reply(200, await queuePage(db, actor, q));
      if (route.endsWith('/application-asset')) return reply(200, await openDocument(db, actor, q, signDocument));
      const ownershipDecision = route === ROOT + '/lifecycle/decision';
      if (ownershipDecision || route.endsWith('/control')) {
        let input;
        try {
          if (Object.keys(q).length || event.isBase64Encoded || typeof event.body !== 'string' ||
              Buffer.byteLength(event.body) > 6000) throw Error();
          input = JSON.parse(event.body);
          if (!input || Array.isArray(input) || typeof input !== 'object') throw Error();
        } catch {
          throw fail(400, ownershipDecision ? 'INVALID_TRANSFER_REVIEW' : 'INVALID_CONTROL_REQUEST');
        }
        if (ownershipDecision) {
          return reply(200, await lifecycleDecision({ db, guard: staffGuard,
            audit: (id, action, before, after, key) => audit.write(STAFF, actor, id, action, before, after, key),
          }, actor, input, now));
        }
        return reply(200, await controlBranch(db, actor, input, now));
      }
      let input;
      try {
        if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 6000) throw Error();
        input = JSON.parse(event.body);
        if (!input || Array.isArray(input) || Object.keys(input).length !== 4 ||
            !queueId(input.queueKey) || !decisions.has(input.decision) || !Number.isSafeInteger(input.baseVersion) ||
            input.baseVersion < 1 || typeof input.reason !== 'string' || input.reason.trim().length < 5 ||
            input.reason.length > 1000) throw Error();
      } catch {
        throw fail(400, 'INVALID_REVIEW');
      }
      const result = await onboarding.route({
        db, table: STAFF, reviewTables: tables, guard: staffGuard,
        reviewChecks: (draft, queue) => reviewChecks(db, regions, draft, queue),
        audit: (id, action, before, after, key) => audit.write(STAFF, actor, id, action, before, after, key),
      }, actor, 'POST', route, input);
      return reply(200, result);
    } catch (error) {
      if (error.name === 'TransactionCanceledException') return reply(409, { error: 'VERSION_OR_STATE_CONFLICT' });
      if (!error.status) console.warn(JSON.stringify({ event: 'MERCHANT_DIRECTORY_FAILURE', name: error.name, requestId: event.requestContext?.requestId }));
      return reply(error.status || 503, { error: error.status ? error.message : 'MERCHANT_DIRECTORY_UNAVAILABLE' });
    }
  };
}

module.exports = { createApi, tables, routes };
