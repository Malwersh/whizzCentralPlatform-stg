'use strict';

const { GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { coordinator } = require('../../../backend/account-deletion/coordinator');
const { dynamoStore } = require('../../../backend/account-deletion/store');
const { retentionSettings } = require('../../../backend/account-deletion/settings');
const { eligible, runDeletionSweep } = require('../../../backend/account-deletion/scheduler');
const { error } = require('../../../backend/account-deletion/policy');
const { purge: purgeMemberships } = require('../../../backend/account-deletion/merchant-staff-cleanup');
const { purge: purgeOnboardingAssets } = require('../../../backend/account-deletion/merchant-onboarding-assets');
const { createEvidence, tables } = require('./evidence.cjs');
const { finalizeMerchantBranch } = require('./merchant-branch-finalization.cjs');
const { lockMerchantBranch } = require('./merchant-branch-lock.cjs');
const { redactMerchantBranchOrder } = require('./merchant-branch-order.cjs');
const { lockMerchantOwner } = require('./merchant-owner-lock.cjs');
const { closeMerchantOwnerIdentity } = require('./merchant-owner-identity.cjs');
const { purgeMerchantOwnerProfile } = require('./merchant-owner-profile.cjs');
const { purgeMerchantProductAssets } = require('./merchant-product-assets.cjs');
const { purgeMerchantDependentRecords } = require('./merchant-dependent-records.cjs');
const { merchantSteps } = require('./merchant-steps.cjs');

const environment = 'production';
const enabledTypes = new Set(['MERCHANT']);
const production = { environment, requestTable: tables.deletion };

function createMerchantDeletionWorker({ db, s3, cognito, settlement, mediaOrigin,
  verifiedMutationGuards = false, verifiedEnrollmentGuards = false, clock = Date.now }) {
  const timestamp = () => new Date(clock()).toISOString();
  const store = dynamoStore({ db, table: tables.deletion, environment, clock: () => Math.floor(clock() / 1000) });
  const evidence = createEvidence({ db, clock });
  const settings = retentionSettings({ db, table: tables.staff, environment, approvedInventories: enabledTypes });
  const get = async (TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;

  async function branchOrders(request) {
    let cursor;
    for (let page = 0; page < 100; page++) {
      const result = await db.send(new ScanCommand({
        TableName: tables.orders, ConsistentRead: true, Limit: 200, ExclusiveStartKey: cursor,
        FilterExpression: 'SK=:meta AND (storeId=:branch OR businessId=:branch OR restaurantId=:branch)',
        ExpressionAttributeValues: { ':meta': 'META', ':branch': request.scope.id },
      }));
      for (const row of result.Items || []) {
        await redactMerchantBranchOrder({ db, settlement, request, orderId: row.orderId, clock });
      }
      cursor = result.LastEvaluatedKey;
      if (!cursor) return;
    }
    throw error('INVENTORY_INCOMPLETE');
  }

  const service = coordinator({ store, settings, clock: timestamp, adapters: {
    MERCHANT: {
      evidence,
      async lock(request, facts, policy) {
        if (request.scope.kind === 'ACCOUNT') return lockMerchantOwner({ db, cognito, request, facts, policy, clock });
        const branch = await get(tables.branches, { businessId: request.scope.id });
        return lockMerchantBranch({ db, request, evidence: facts, clock, manifest: {
          subjectId: request.subjectId, requestId: request.requestId, businessId: request.scope.id,
          policyVersion: policy.retentionPolicyVersion, draftId: branch?.onboardingDraftId,
        } });
      },
      async execute(step, request, job) {
        const assets = { db, s3, r: request, job, ...production, now: clock };
        const staff = { db, r: request, job, ...production, clock };
        const args = { db, s3, cognito, settlement, request, job, clock };
        switch (step) {
          case 'branchAssets':
            await purgeMerchantProductAssets({ ...args, mediaOrigin });
            if (job.draftId) await purgeOnboardingAssets({ ...assets, draftId: job.draftId });
            return;
          case 'branchMemberships':
          case 'memberships':
            return purgeMemberships({ ...staff, phoneNumber: job.phone });
          case 'branchOrders':
            return branchOrders(request);
          case 'branchData':
            return purgeMerchantDependentRecords(args);
          case 'branchClosure':
            return finalizeMerchantBranch(args);
          case 'personalData':
            await purgeOnboardingAssets(assets);
            await purgeMerchantDependentRecords(args);
            return purgeMerchantOwnerProfile(args);
          case 'disableIdentity':
          case 'identityClosure': {
            const facts = await evidence({ type: 'MERCHANT', sub: request.subjectId }, request.scope);
            if (facts.ownedBusinesses.length || facts.profileRetentionReview) throw error('SETTLEMENT_REQUIRED');
            return closeMerchantOwnerIdentity({ ...args, step });
          }
          default:
            throw error('INVALID_CLEANUP_STEP');
        }
      },
    },
  } });

  function assertReady() {
    if (!verifiedMutationGuards || !verifiedEnrollmentGuards || !s3 || !cognito ||
        typeof settlement?.readMerchantAccrualEvidence !== 'function') throw error('WORKER_NOT_ENABLED');
  }
  async function process(request) {
    assertReady();
    if (!eligible(request, enabledTypes)) throw error('INVALID_CLEANUP_SCOPE');
    const actor = { type: 'MERCHANT', sub: request.subjectId };
    const current = await store.get(actor, request.requestId);
    if (current?.status === 'COMPLETED') return service.process(actor, request.requestId);
    const steps = current?.scope && merchantSteps(current.scope);
    if (!current || !eligible(current, enabledTypes) || !steps?.length ||
        JSON.stringify(steps) !== JSON.stringify(current.requiredSteps)) throw error('INVALID_CLEANUP_SCOPE');
    return service.process(actor, request.requestId);
  }
  return {
    process,
    sweep(remainingTime) {
      assertReady();
      return runDeletionSweep({ db, table: tables.deletion, environment, enabledTypes, processRequest: process, remainingTime });
    },
  };
}

module.exports = { createMerchantDeletionWorker };
