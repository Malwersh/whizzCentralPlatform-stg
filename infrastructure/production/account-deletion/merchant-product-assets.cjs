'use strict';

const { GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { DeleteObjectsCommand, ListObjectVersionsCommand } = require('@aws-sdk/client-s3');
const { error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');

const bucket = 'wizz-production-merchant-catalog-api-746727375268';
const owner = '746727375268';
const products = 'wizz-production-Products';
const retainedDiscounts = 'wizz-production-MerchantDiscounts';
const globalProducts = 'wizz-production-GlobalProducts';
const imagePath = /^merchants\/[\w-]{1,150}\/product-images\/[\w-]{1,150}\.(jpg|jpeg|png|gif|webp)$/i;
const imageFields = ['image', 'images', 'imageUrl', 'imageUrls', 'photoUrl', 'photo', 'photoUrls', 'picture', 'thumbnailUrl'];

function strings(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

function imageKey(value, mediaOrigin) {
  if (imagePath.test(value)) return value;
  if (value.startsWith('/media/') && imagePath.test(value.slice(7))) return value.slice(7);
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  if ([bucket + '.s3.us-east-1.amazonaws.com', bucket + '.s3.amazonaws.com'].includes(url.host) &&
      imagePath.test(url.pathname.slice(1))) return url.pathname.slice(1);
  if (mediaOrigin && url.origin === mediaOrigin && url.pathname.includes('/media/')) {
    const key = url.pathname.split('/media/')[1];
    if (imagePath.test(key)) return key;
  }
  return null;
}

async function inventoryMerchantProductAssets({ db, s3, branchId, mediaOrigin, maxPages = 100 }) {
  if (!/^[\w-]{1,150}$/.test(branchId || '')) throw error('ASSET_SCOPE_INVALID');
  const prefix = 'merchants/' + branchId + '/product-images/';
  const sharedKeys = new Set();
  const legacyReferences = new Set();
  for (const TableName of [products, globalProducts, retainedDiscounts, tables.branches]) {
    let cursor, pages = 0;
    do {
      const result = await db.send(new ScanCommand({ TableName, ConsistentRead: true, Limit: 200, ExclusiveStartKey: cursor }));
      for (const row of result.Items || []) {
        const belongsToBranch = [products, tables.branches].includes(TableName) && row.businessId === branchId;
        const values = belongsToBranch
          ? [...imageFields, 'businessPhotoUrl', 'businessPhoto', 'logoUrl', 'licenseUrl', 'identityUrl',
            'healthCertificateUrl', 'ownerPhotoUrl'].flatMap(field => strings(row[field]))
          : strings(row);
        for (const value of values) {
          const key = imageKey(value, mediaOrigin);
          if (!belongsToBranch && key?.startsWith(prefix)) sharedKeys.add(key);
          if (belongsToBranch && !key && /^(https?:\/\/|s3:\/\/)/i.test(value)) legacyReferences.add(value);
        }
      }
      cursor = result.LastEvaluatedKey;
      if (++pages >= maxPages && cursor) throw error('INVENTORY_INCOMPLETE');
    } while (cursor);
  }

  const exclusive = [], shared = [];
  let KeyMarker, VersionIdMarker;
  for (let page = 0; page < maxPages; page++) {
    const result = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, ExpectedBucketOwner: owner,
      Prefix: prefix, KeyMarker, VersionIdMarker }));
    for (const { Key, VersionId } of [...result.Versions || [], ...result.DeleteMarkers || []]) {
      if (!Key?.startsWith(prefix) || !imagePath.test(Key) || typeof VersionId !== 'string') throw error('ASSET_SCOPE_INVALID');
      (sharedKeys.has(Key) ? shared : exclusive).push({ Key, VersionId });
    }
    if (!result.IsTruncated) return { exclusive, shared, legacyReferenceCount: legacyReferences.size };
    if (!result.NextKeyMarker || result.NextKeyMarker === KeyMarker && result.NextVersionIdMarker === VersionIdMarker) {
      throw error('INVENTORY_INCOMPLETE');
    }
    ({ NextKeyMarker: KeyMarker, NextVersionIdMarker: VersionIdMarker } = result);
  }
  throw error('INVENTORY_INCOMPLETE');
}

async function purgeMerchantProductAssets({ db, s3, request, mediaOrigin, clock = Date.now }) {
  const { pk, sk, scope, subjectId, requestId, leaseOwner, version, job } = request;
  const branchId = scope?.id;
  if (request.actorType !== 'MERCHANT' || scope?.kind !== 'BUSINESS' || !branchId ||
      pk !== 'SUBJECT#MERCHANT#' + subjectId || sk !== 'REQUEST#' + requestId ||
      request.status !== 'PROCESSING' || !leaseOwner || job?.businessId !== branchId ||
      job.subjectId !== subjectId || job.requestId !== requestId) throw error('INVALID_CLEANUP_SCOPE');

  async function verifyClosing() {
    const get = async (TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
    const [current, marker, branch] = await Promise.all([
      get(tables.deletion, { pk, sk }),
      get(tables.deletion, { pk: 'BUSINESS_LIFECYCLE#MERCHANT#' + branchId, sk: 'META' }),
      get(tables.branches, { businessId: branchId }),
    ]);
    if (current?.leaseOwner !== leaseOwner || current.version !== version || current.status !== 'PROCESSING' ||
        current.leaseUntil <= Math.floor(clock() / 1000)) throw error('LEASE_LOST');
    if (marker?.requestId !== requestId || marker.subjectId !== subjectId || marker.state !== 'CLOSING' ||
        branch?.cognitoUserId !== subjectId || branch.ownerId !== subjectId || branch.deletionRequestId !== requestId) {
      throw error('INVALID_CLEANUP_SCOPE');
    }
    if (branch.legalHold || branch.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
  }

  await verifyClosing();
  const uploads = await db.send(new QueryCommand({
    TableName: tables.deletion, ConsistentRead: true, KeyConditionExpression: 'pk=:owner',
    ExpressionAttributeValues: { ':owner': 'ACCOUNT_OPERATION#MERCHANT#' + subjectId },
  }));
  const now = Math.floor(clock() / 1000);
  if (uploads.LastEvaluatedKey || (uploads.Items || []).some(row =>
    (row.businessId == null || row.businessId === branchId) &&
    (!Number.isSafeInteger(row.expiresAt) || row.expiresAt > now))) throw error('EXTERNAL_WRITES_IN_PROGRESS');

  const inventory = await inventoryMerchantProductAssets({ db, s3, branchId, mediaOrigin });
  if (inventory.legacyReferenceCount) throw error('ASSET_INVENTORY_REQUIRED');
  for (let offset = 0; offset < inventory.exclusive.length; offset += 1000) {
    await verifyClosing();
    const response = await s3.send(new DeleteObjectsCommand({
      Bucket: bucket, ExpectedBucketOwner: owner,
      Delete: { Objects: inventory.exclusive.slice(offset, offset + 1000), Quiet: true },
    }));
    if (response.Errors?.length) throw error('ASSET_DELETE_RETRY_REQUIRED');
  }
}

module.exports = { inventoryMerchantProductAssets, purgeMerchantProductAssets };
