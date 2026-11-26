'use strict';

const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { AdminGetUserCommand, AdminDisableUserCommand, AdminUserGlobalSignOutCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { driverLock } = require('../../../backend/account-deletion/driver-lock');
const { coordinator } = require('../../../backend/account-deletion/coordinator');
const { dynamoStore } = require('../../../backend/account-deletion/store');
const { retentionSettings } = require('../../../backend/account-deletion/settings');
const { error } = require('../../../backend/account-deletion/policy');
const { identities } = require('../wallet-identity-bindings.json');
const { tables } = require('./evidence.cjs');
const { purgeDriverApplicationData } = require('./driver-application-data.cjs');
const { createDriverDeletionEvidence, reviewDriverLinkedRecords, purgeDriverPerformance } = require('./driver-linked-data.cjs');
const { createDriverDocumentCleanup } = require('./driver-documents.cjs');
const { driverExecutionChecks } = require('./customer-execution-scope.cjs');
const { createDriverOfferCleanup } = require('./driver-offer-cleanup.cjs');
const { redactDriverOrderContact } = require('./driver-order-contact.cjs');
const { archiveDriverWalletRecords } = require('./driver-wallet-archive.cjs');
const { purgeDriverRegistration } = require('./driver-registration-cleanup.cjs');
const { createDriverFinalization } = require('./driver-finalization.cjs');
const { closeDriverWallet } = require('./customer-wallet.cjs');

const environment = 'production';
const poolId = identities.driver.poolId;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const { driverSteps } = require('./driver-steps.cjs');

async function readDriverIdentity(cognito, subjectId) {
  const result = await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: subjectId }));
  const attrs = result.UserAttributes ?? [];
  const subject = attrs.filter(item => item.Name === 'sub');
  if (result.Username !== subjectId || subject.length !== 1 || subject[0].Value !== subjectId ||
      typeof result.Enabled !== 'boolean' || result.UserStatus !== 'CONFIRMED') {
    throw error('DRIVER_IDENTITY_CHANGED');
  }
  const phones=attrs.filter(item=>item.Name==='phone_number');
  const verified=attrs.filter(item=>item.Name==='phone_number_verified');
  if (phones.length!==1 || !/^\+9647\d{9}$/.test(phones[0].Value) ||
      verified.length!==1 || verified[0].Value!=='true') throw error('DRIVER_IDENTITY_CHANGED');
  return { username: subjectId, phone:phones[0].Value, enabled: result.Enabled };
}

async function disableDriverIdentity({ db, cognito, request, job, clock = Date.now }) {
  if (job?.pool !== poolId || job?.username !== request.subjectId) throw error('DRIVER_IDENTITY_CHANGED');
  const verifyLease = () => db.send(new TransactWriteCommand({
    TransactItems: driverExecutionChecks(request, job, clock()),
  }));
  await verifyLease();
  const identity = await readDriverIdentity(cognito, request.subjectId);
  if (identity.phone !== job.phone) throw error('DRIVER_IDENTITY_CHANGED');
  const target = { UserPoolId: poolId, Username: identity.username };
  if (identity.enabled) {
    await verifyLease();
    await cognito.send(new AdminDisableUserCommand(target));
  }
  await verifyLease();
  await cognito.send(new AdminUserGlobalSignOutCommand(target));
}

function createDriverDeletionWorker({ db, cognito, s3, orderSocket, settlement, verifiedMutationGuards = false, verifiedEnrollmentGuards = false, clock = Date.now }) {
  const seconds = () => Math.floor(clock() / 1000);
  const timestamp = () => new Date(clock()).toISOString();
  const store = dynamoStore({ db, table: tables.deletion, environment, clock: seconds });
  const lock = driverLock({ db, table: tables.deletion, verifiedMutationGuards, environment, clock: seconds });
  const offers = settlement && createDriverOfferCleanup(settlement);
  const documents = createDriverDocumentCleanup({ db, s3, clock });
  const settings = retentionSettings({ db, table: tables.staff, environment, approvedInventories: new Set(['DRIVER']) });
  const finalization = createDriverFinalization({ db, cognito, poolId, driverSteps, readIdentity:readDriverIdentity, clock });
  const handlers = {
    disableIdentity: disableDriverIdentity,
    externalWrites: ({ request, job }) => documents.waitForWrites(request, job),
    documents: ({ request, job }) => documents.purge(request, job),
    walletClosure: closeDriverWallet,
    personalData: purgeDriverApplicationData,
    async profileClosure(args) {
      await finalization.profileClosure(args);
      await purgeDriverPerformance(args);
    },
    identityClosure: args => finalization.identityClosure({...args,enrollmentGuard:purgeDriverRegistration}),
    async financialArchive(args) {
      await archiveDriverWalletRecords(args);
      await redactDriverOrderContact(args);
      await offers.redact(args);
      await reviewDriverLinkedRecords(args);
    },
  };
  const service = coordinator({ store, settings, clock: timestamp, adapters: {
    DRIVER: {
      evidence: createDriverDeletionEvidence({ db, clock }),
      async lock(request, facts, policy) {
        const identity = await readDriverIdentity(cognito, request.subjectId);
        if (!identity.enabled) throw error('IDENTITY_UNAVAILABLE');
        await offers.preflight({ db, request });
        await reviewDriverLinkedRecords({ db, request });
        return lock(request, facts, {
          requestId: request.requestId, subjectId: request.subjectId, policyVersion: request.policyVersion,
          pool: poolId, username: identity.username, phone: identity.phone, financialYears: policy.financialRetentionYears,
          profileIds: facts.profileIds, wallets: facts.wallets, walletIds: facts.walletIds,
        });
      },
      execute(step, request, job) {
        const args = { db, cognito, s3, orderSocket, request, job, clock };
        if (Object.hasOwn(handlers, step)) return handlers[step](args);
        throw error('INVALID_CLEANUP_STEP');
      },
    },
  } });

  return async function processDriver(subjectId, requestId) {
    if (!verifiedMutationGuards || !verifiedEnrollmentGuards || !s3 || !offers || !orderSocket) throw error('WORKER_NOT_ENABLED');
    if (!uuid.test(subjectId) || !uuid.test(requestId)) throw error('INVALID_CLEANUP_SCOPE');
    const actor = { type: 'DRIVER', sub: subjectId };
    const request = await store.get(actor, requestId);
    if (!request) throw error('REQUEST_NOT_FOUND');
    if (request.actorType !== actor.type || request.subjectId !== subjectId ||
        request.scope?.kind !== 'ACCOUNT' || request.scope.id !== subjectId ||
        !Array.isArray(request.requiredSteps) || request.requiredSteps.length !== driverSteps.length ||
        !driverSteps.every((step, index) => step === request.requiredSteps[index])) {
      throw error('INVALID_CLEANUP_SCOPE');
    }
    return service.process(actor, requestId);
  };
}

module.exports = { createDriverDeletionWorker, disableDriverIdentity, driverSteps };
