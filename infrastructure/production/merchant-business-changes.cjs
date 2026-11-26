'use strict';

const {GetCommand, QueryCommand, TransactWriteCommand} = require('@aws-sdk/lib-dynamodb');
const {allowed} = require('../../backend/staff-service/catalog');
const {exact} = require('../../backend/staff-service/dispatch-followup-core');
const audit = require('../../backend/staff-service/audit-trail');
const domain = require('../../backend/staff-service/business-change-review');

const tables = Object.freeze({
  platform: 'wizz-production-MerchantPlatform', businesses: 'wizz-production-Merchants',
  staff: 'wizz-production-PlatformStaff', lifecycle: 'wizz-production-AccountDeletion',
});
const queuePk = 'REVIEW#MERCHANT';
const pattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const validBusiness = value => typeof value === 'string' && /^[\w-]{1,150}$/.test(value);
const fail = (code, status = 400) => { throw Object.assign(Error(code), {code, status}); };
const openBranch = branch => branch?.status === 'approved' && !branch.isDeleted && !branch.deletedAt &&
  !branch.deletionRequestId && !branch.orderIntakeDeletionRequestId && !['CLOSING', 'CLOSED'].includes(branch.lifecycleStatus);
const ownerOf = (branch, sub) => openBranch(branch) && sub === branch.ownerId && sub === branch.cognitoUserId;
const key = (pk, sk) => ({pk, sk});
const queueKey = id => key(queuePk, 'CHANGE#' + id);
const requestKey = (sub, id) => key('PERSON#' + sub, 'CHANGE#' + id);
const expected = (input, fields) =>
  input && Object.keys(input).sort().join(',') === fields;
const ownerVersion = branch => branch.updatedAt ?? null;
const addressText = address => typeof address === 'string' ? address : address?.fullAddress ??
  [address?.street, address?.neighborhood].filter(Boolean).join('، ');

function createBusinessChanges({db, regions, now = Date.now}) {
  async function get(TableName, Key) {
    return (await db.send(new GetCommand({TableName, Key, ConsistentRead: true}))).Item;
  }
  function lifecycles(sub, id) {
    return ['ACCOUNT_LIFECYCLE#MERCHANT#' + sub, 'BUSINESS_LIFECYCLE#MERCHANT#' + id]
      .map(pk => key(pk, 'META'));
  }
  const fences = (sub, id) => lifecycles(sub, id).map(Key => ({
    ConditionCheck: {TableName: tables.lifecycle, Key, ConditionExpression: 'attribute_not_exists(pk)'},
  }));
  const branchFence = (branch, kind) => exact(tables.businesses, {businessId: branch.businessId}, branch,
    ['ownerId', 'cognitoUserId', 'status', 'updatedAt', 'deletedAt', 'isDeleted', 'deletionRequestId', 'orderIntakeDeletionRequestId', 'lifecycleStatus',
      ...(kind === 'NAME' ? ['businessName', 'name'] : ['address', 'regionPath', 'regionId', 'latitude', 'longitude'])]);
  const staffFence = actor => exact(tables.staff, key('EMPLOYEE#' + actor.employeeId, 'PROFILE'), actor,
    ['version', 'roles', 'scope', 'minimumAuthTime', 'status', 'deletedAt', 'isDeleted', 'deletionRequestId']);

  async function write(TransactItems) {
    try {
      await db.send(new TransactWriteCommand({TransactItems}));
    } catch (error) {
      if (error.name === 'TransactionCanceledException') fail('VERSION_OR_STATE_CONFLICT', 409);
      throw error;
    }
  }

  function changePage(pk, last, limit) {
    return db.send(new QueryCommand({
      TableName: tables.platform, ConsistentRead: true, Limit: limit,
      KeyConditionExpression: 'pk=:pk AND begins_with(sk,:prefix)',
      ExpressionAttributeValues: {':pk': pk, ':prefix': 'CHANGE#'}, ExclusiveStartKey: last,
    }));
  }

  async function owner(sub, method, query, input) {
    const id = method === 'GET' ? query.businessId : input?.businessId;
    if (!validBusiness(id)) fail('INVALID_BUSINESS_ID');
    const [branch, ...state] = await Promise.all([
      get(tables.businesses, {businessId: id}), ...lifecycles(sub, id).map(k => get(tables.lifecycle, k)),
    ]);
    if (!ownerOf(branch, sub)) fail('BUSINESS_UNAVAILABLE', 404);
    if (state.some(Boolean)) fail('BUSINESS_CLOSING', 409);
    if (method === 'GET') {
      if (!expected(query, 'businessId')) fail('INVALID_QUERY');
      let cursor;
      const items = [];
      do {
        const page = await changePage('PERSON#' + sub, cursor, 100);
        items.push(...(page.Items ?? []).filter(row => row.businessId === id && row.subjectId === sub));
        cursor = page.LastEvaluatedKey;
      } while (cursor);
      return {
        items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        baseUpdatedAt: ownerVersion(branch),
        settings: {address: addressText(branch.address), regionPath: branch.regionPath ?? [],
          latitude: branch.latitude ?? branch.address?.latitude ?? null,
          longitude: branch.longitude ?? branch.address?.longitude ?? null, locationVersion: ownerVersion(branch)},
      };
    }
    if (Object.keys(query).length || !expected(input, 'baseUpdatedAt,businessId,kind,proposed,reason,requestId') ||
        typeof input.reason !== 'string' || input.reason.trim().length < 5) fail('INVALID_CHANGE_REQUEST');
    const timestamp = new Date(now()).toISOString();
    const proposed = domain.propose({
      business: branch, subjectId: sub, kind: input.kind, proposed: input.proposed,
      requestId: input.requestId, reason: input.reason, now: timestamp,
    });
    const request = {...proposed, pk: 'PERSON#' + sub, regionId: branch.regionId ?? null};
    const previous = await get(tables.platform, requestKey(sub, request.requestId));
    if (previous) {
      if (previous.businessId !== id || previous.kind !== request.kind || previous.reason !== request.reason ||
          JSON.stringify(previous.proposed) !== JSON.stringify(request.proposed)) fail('REQUEST_ID_CONFLICT', 409);
      return {request: previous};
    }
    if (ownerVersion(branch) !== input.baseUpdatedAt) fail('CHANGE_BASE_CONFLICT', 409);
    const validated = request.kind === 'LOCATION'
      ? await regions.validate(request.proposed.regionPath, request.proposed.latitude, request.proposed.longitude) : null;
    const queue = {...request, pk: queuePk, requestPk: request.pk};
    if (validated) queue.regionNames = validated.regionNames;
    await write([
      ...fences(sub, id), branchFence(branch, request.kind), ...(validated?.checks ?? []),
      ...[request, queue].map(Item => ({
        Put: {TableName: tables.platform, Item, ConditionExpression: 'attribute_not_exists(pk)'},
      })),
    ]);
    return {request};
  }

  const inScope = (actor, right, branch, request) => allowed(actor, right, branch.regionId ?? null) &&
    (request.kind !== 'LOCATION' || allowed(actor, right, request.proposed.regionPath[3]));

  async function pair(queue) {
    if (!queue || !pattern.test(queue.subjectId ?? '') || !validBusiness(queue.businessId) ||
        !pattern.test(queue.requestId ?? '') || queue.sk !== 'CHANGE#' + queue.requestId ||
        queue.requestPk !== 'PERSON#' + queue.subjectId) return null;
    const [request, branch] = await Promise.all([
      get(tables.platform, requestKey(queue.subjectId, queue.requestId)),
      get(tables.businesses, {businessId: queue.businessId}),
    ]);
    if (!request || request.requestId !== queue.requestId || !['NAME', 'LOCATION'].includes(request.kind) ||
        request.businessId !== queue.businessId || request.subjectId !== queue.subjectId ||
        request.version !== queue.version || request.status !== queue.status || !ownerOf(branch, request.subjectId)) return null;
    return {request, branch};
  }

  async function staff(actor, method, query, input) {
    if (!allowed(actor, 'merchants.read')) fail('PERMISSION_REQUIRED', 403);
    if (method === 'GET') {
      if (Object.keys(query).some(k => k !== 'cursor') || (query.cursor !== undefined && !pattern.test(query.cursor))) {
        fail('INVALID_QUERY');
      }
      const page = await changePage(queuePk, query.cursor ? queueKey(query.cursor) : undefined, 20);
      const rows = await Promise.all((page.Items ?? []).filter(row => row.status === 'PENDING').map(async q => {
        const match = await pair(q);
        if (!match || !inScope(actor, 'merchants.read', match.branch, match.request)) return null;
        const {request, branch} = match;
        return {requestId: request.requestId, version: request.version, kind: request.kind,
          businessName: branch.businessName ?? branch.name ?? '', createdAt: request.createdAt, reason: request.reason,
          previous: request.kind === 'NAME' ? request.base.businessName : addressText(request.base.address),
          proposed: request.proposed, regionNames: q.regionNames ?? [],
          canReview: inScope(actor, 'merchants.review', branch, request)};
      }));
      return {items: rows.filter(Boolean), nextCursor: page.LastEvaluatedKey?.sk?.slice(7) ?? null};
    }
    if (!allowed(actor, 'merchants.review')) fail('PERMISSION_REQUIRED', 403);
    if (Object.keys(query).length || !expected(input, 'baseVersion,decision,reason,requestId') ||
        !pattern.test(input.requestId ?? '') || !Number.isSafeInteger(input.baseVersion) || input.baseVersion < 1 ||
        !['APPROVE', 'REJECT'].includes(input.decision) || typeof input.reason !== 'string' ||
        input.reason.trim().length < 5 || input.reason.length > 1000) fail('INVALID_REVIEW');
    const queue = await get(tables.platform, queueKey(input.requestId));
    const match = await pair(queue);
    if (!match || !inScope(actor, 'merchants.review', match.branch, match.request)) fail('REQUEST_UNAVAILABLE', 404);
    const {request, branch} = match;
    const reason = input.reason.trim();
    const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (request.status === status && request.version === input.baseVersion + 1 &&
        request.actorId === actor.employeeId && request.decisionReason === reason) return {saved: true, status};
    if (request.version !== input.baseVersion || request.status !== 'PENDING') fail('VERSION_OR_STATE_CONFLICT', 409);
    let validatedLocation;
    if (request.kind === 'LOCATION' && input.decision === 'APPROVE') {
      const p = request.proposed;
      const region = await regions.validate(p.regionPath, p.latitude, p.longitude);
      const [country, city, district, area] = region.regionNames;
      validatedLocation = {...region, regionPath: p.regionPath, countryId: p.regionPath[0],
        governorateId: p.regionPath[1], districtId: p.regionPath[2], latitude: p.latitude, longitude: p.longitude,
        address: {fullAddress: p.address, latitude: p.latitude, longitude: p.longitude, country, city, district, region: area}};
    }
    const timestamp = new Date(now()).toISOString();
    const plan = domain.decide({business: branch, request, decision: input.decision, actorId: actor.employeeId,
      reason, now: timestamp, validatedLocation, tables});
    const change = plan.TransactItems.find(item => item.Update);
    if (change) {
      const {ConditionCheck: condition} = branchFence(branch, request.kind);
      change.Update.ConditionExpression = condition.ConditionExpression;
      Object.assign(change.Update.ExpressionAttributeNames, condition.ExpressionAttributeNames);
      delete change.Update.ExpressionAttributeNames['#status'];
      for (const attribute of [':approved', ':owner', ':baseUpdatedAt']) delete change.Update.ExpressionAttributeValues[attribute];
      Object.assign(change.Update.ExpressionAttributeValues, condition.ExpressionAttributeValues);
    }
    await write([
      staffFence(actor), ...fences(request.subjectId, branch.businessId), ...plan.TransactItems,
      ...(!change ? [branchFence(branch, request.kind)] : []),
      {Put: {TableName: tables.platform, Item: {...plan.request, pk: queuePk, requestPk: request.pk},
        ConditionExpression: '#s=:pending AND #v=:v', ExpressionAttributeNames: {'#s': 'status', '#v': 'version'},
        ExpressionAttributeValues: {':pending': 'PENDING', ':v': queue.version}}},
      audit.write(tables.staff, actor, actor.employeeId, 'MERCHANT_CHANGE_' + input.decision,
        {businessId: branch.businessId, requestId: request.requestId, kind: request.kind, status: request.status},
        {status, reason}, request.requestId + '#' + plan.request.version),
    ]);
    return {saved: true, status};
  }
  return {owner, staff};
}

module.exports = {createBusinessChanges};
