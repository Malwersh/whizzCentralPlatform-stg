'use strict';

const { coordinator } = require('../../../backend/account-deletion/coordinator');
const { customerLock } = require('../../../backend/account-deletion/customer-lock');
const { error } = require('../../../backend/account-deletion/policy');
const { retentionSettings } = require('../../../backend/account-deletion/settings');
const { dynamoStore } = require('../../../backend/account-deletion/store');
const { createEvidence, tables } = require('./evidence.cjs');
const { purgeCustomerApplicationData } = require('./customer-application-data.cjs');
const { purgeCustomerSupport } = require('./customer-support.cjs');
const { createCustomerOrderCleanup } = require('./customer-order-archive.cjs');
const { closeCustomerWallet } = require('./customer-wallet.cjs');
const { captureCustomerIdentity, createCustomerIdentityCleanup, customerSteps } = require('./customer-identity.cjs');

const environment = 'production';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function createCustomerDeletionWorker({
  db, cognito, s3, socket, settlement, orderCleanup = settlement && createCustomerOrderCleanup(settlement), verifiedMutationGuards = false, deliveryFundingArchiveEnabled = false, clock = Date.now,
}) {
  const seconds = () => Math.floor(clock() / 1000);
  const timestamp = () => new Date(clock()).toISOString();
  const store = dynamoStore({ db, table: tables.deletion, environment, clock: seconds });
  const identity = createCustomerIdentityCleanup({ db, cognito, clock });
  const evidence = createEvidence({ db, deliveryFundingArchiveEnabled });
  const lock = customerLock({ db, table: tables.deletion, environment, clock: seconds, verifiedMutationGuards });
  const settings = retentionSettings({
    db, table: tables.staff, environment, approvedInventories: new Set(['CUSTOMER']),
  });
  const handlers = {
    disableIdentity: ({ request, job }) => identity.disable(request, job),
    personalData: purgeCustomerApplicationData,
    supportData: purgeCustomerSupport,
    async financialArchive(args) {
      if (deliveryFundingArchiveEnabled) {
        const { request: r, job } = args;
        const inventory = await require('../../../backend/account-deletion/customer-delivery-funding-inventory').inventory({
          db, subjectIds: [job.subjectId], table: tables.staff,
        });
        if (inventory.blockers.some(item => item.code !== 'DELIVERY_FUNDING_RETENTION_REVIEW')) {
          throw error('DELIVERY_FUNDING_RETENTION_REVIEW');
        }
        await require('../../../backend/account-deletion/customer-delivery-funding-archive').archive({
          db, r, job, sourceKeys: inventory.keys, clock: timestamp, environment,
        });
      }
      return orderCleanup.archive(args);
    },
    orderPersonalData: args => orderCleanup.redact(args),
    verificationData: ({ request, job }) => identity.purgeVerification(request, job),
    walletClosure: closeCustomerWallet,
    identityClosure: ({ request, job }) => identity.finish(request, job),
  };
  const service = coordinator({ store, settings, clock: timestamp, adapters: {
    CUSTOMER: {
      evidence,
      async lock(request, facts, policy) {
        const { subjectId, requestId, policyVersion } = request;
        await orderCleanup.preflight?.({ db, request });
        const captured = await captureCustomerIdentity({ db, cognito, subjectId, profileIds: facts.profileIds });
        return lock(request, facts, {
          requestId, subjectId, policyVersion, identity: captured,
          financialYears: policy.financialRetentionYears,
          profileIds: facts.profileIds, wallets: facts.wallets, walletIds: facts.walletIds,
        });
      },
      execute(step, request, job) {
        if (!Object.hasOwn(handlers, step)) throw error('INVALID_CLEANUP_STEP');
        return handlers[step]({ db, s3, socket, request, job, clock });
      },
    },
  } });

  return async function process(subjectId, requestId) {
    if (!verifiedMutationGuards || typeof orderCleanup?.archive !== 'function' ||
        typeof orderCleanup?.redact !== 'function' || !s3 || !socket) throw error('WORKER_NOT_ENABLED');
    if (!uuid.test(subjectId) || !uuid.test(requestId)) throw error('INVALID_CLEANUP_SCOPE');
    const actor = { type: 'CUSTOMER', sub: subjectId };
    const request = await store.get(actor, requestId);
    if (!request) throw error('REQUEST_NOT_FOUND');
    if (request.actorType !== actor.type || request.subjectId !== subjectId ||
        request.scope?.kind !== 'ACCOUNT' || request.scope.id !== subjectId ||
        !Array.isArray(request.requiredSteps) || request.requiredSteps.length !== customerSteps.length ||
        !customerSteps.every((step, index) => step === request.requiredSteps[index])) {
      throw error('INVALID_CLEANUP_SCOPE');
    }
    return service.process(actor, requestId);
  };
}

module.exports = { createCustomerDeletionWorker };
