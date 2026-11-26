'use strict';

const { GetCommand, QueryCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { ListObjectVersionsCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { driverExecutionChecks } = require('./customer-execution-scope.cjs');
const { tables } = require('./evidence.cjs');

const bucket = 'wizz-production-driver-documents-746727375268-us-east-1';
const bucketScope = { Bucket: bucket, ExpectedBucketOwner: '746727375268' };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const assetFields = ['drivingLicenseUrl', 'registrationPaperUrl', 'nationalIdUrl',
  'profileImage', 'profileImageUrl', 'photoUrl', 'avatarUrl'];

function createDriverDocumentCleanup({ db, s3, clock = Date.now, maxPages = 100 }) {
  async function guard(request, job) {
    const { subjectId, requestId } = request;
    if (!uuid.test(requestId)) throw error('INVALID_CLEANUP_SCOPE');
    const checks = driverExecutionChecks(request, job, clock());
    const key = { driverId: subjectId };
    const { Item: profile } = await db.send(new GetCommand({
      TableName: tables.driver, Key: key, ConsistentRead: true,
    }));
    if (!profile || profile.driverId !== subjectId || profile.cognitoSub !== subjectId ||
        profile.deletionRequestId !== requestId) throw error('PROFILE_GENERATION_CHANGED');
    if (profile.legalHold || profile.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');

    const prefix = 'drivers/' + subjectId + '/';
    const prefixUrl = 's3://' + bucket + '/' + prefix;
    const references = assetFields.map(field => profile[field]);
    for (const registry of [profile.vehicleRegistry, profile.vehicleOperational]) {
      if (registry?.items) references.push(...Object.values(registry.items).map(item => item?.registrationUrl));
    }
    if (references.some(url => url && (typeof url !== 'string' || !url.startsWith(prefixUrl) ||
        url.length <= prefixUrl.length))) throw error('ASSET_INVENTORY_REQUIRED');

    const profileFields = ['driverId', 'cognitoSub', 'deletionRequestId', 'vehicleRegistry',
      'vehicleOperational', ...assetFields];
    const profileSnapshot = Object.fromEntries(profileFields.map(field => [field, profile[field]]));
    await db.send(new TransactWriteCommand({ TransactItems: [
      ...checks,
      { ConditionCheck: { TableName: tables.driver, Key: key, ...exact(profileSnapshot) } },
    ] }));
    return prefix;
  }

  async function waitForWrites(request, job) {
    const prefix = await guard(request, job);
    const pk = 'ACCOUNT_OPERATION#DRIVER#' + job.subjectId;
    let cursor;
    for (let page = 0; page < maxPages; page++) {
      const result = await db.send(new QueryCommand({
        TableName: tables.deletion, ConsistentRead: true, Limit: 100, ExclusiveStartKey: cursor,
        KeyConditionExpression: 'pk=:pk', ExpressionAttributeValues: { ':pk': pk },
      }));
      if ((result.Items ?? []).some(row => row.pk !== pk || row.subjectId !== job.subjectId ||
          !Number.isSafeInteger(row.expiresAt) || row.expiresAt > Math.floor(clock()/1000))) {
        throw error('EXTERNAL_WRITES_IN_PROGRESS');
      }
      cursor = result.LastEvaluatedKey;
      if (!cursor) return prefix;
    }
    throw error('ASSET_INVENTORY_INCOMPLETE');
  }

  async function purge(request, job) {
    const prefix = await waitForWrites(request, job);
    for (let page = 0; page < maxPages; page++) {
      await guard(request, job);
      const result = await s3.send(new ListObjectVersionsCommand({
        ...bucketScope, Prefix: prefix, MaxKeys: 1000,
      }));
      const objects = [...(result.Versions ?? []), ...(result.DeleteMarkers ?? [])]
        .map(row => ({ Key: row.Key, VersionId: row.VersionId }));
      if (objects.some(row => !row.Key?.startsWith(prefix) || typeof row.VersionId !== 'string' || !row.VersionId)) {
        throw error('ASSET_SCOPE_INVALID');
      }
      if (!objects.length) {
        if (result.IsTruncated) throw error('ASSET_INVENTORY_INCOMPLETE');
        const remaining = await s3.send(new ListObjectsV2Command({ ...bucketScope, Prefix: prefix, MaxKeys: 1 }));
        if (remaining.KeyCount || remaining.Contents?.length) throw error('ASSET_DELETE_RETRY_REQUIRED');
        return;
      }
      await guard(request, job);
      const deleted = await s3.send(new DeleteObjectsCommand({
        ...bucketScope, Delete: { Objects: objects, Quiet: true },
      }));
      if (deleted.Errors?.length) throw error('ASSET_DELETE_RETRY_REQUIRED');
    }
    throw error('ASSET_INVENTORY_INCOMPLETE');
  }

  return { waitForWrites, purge };
}

module.exports = { createDriverDocumentCleanup };
