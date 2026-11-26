'use strict';

const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { driverPhoneClosureKey } = require('../../../backend/account-deletion/driver-phone-binding');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');
const { driverExecutionChecks } = require('./customer-execution-scope.cjs');

function createDriverFinalization({ db, cognito, poolId, driverSteps, readIdentity, clock = Date.now }) {
  const get = async (TableName, Key) =>
    (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;

  async function completedSteps(request, steps) {
    return Promise.all(steps.map(async step => {
      const Key = { pk:request.pk, sk:'STEP#'+request.requestId+'#'+step };
      const item = await get(tables.deletion, Key);
      if (item?.step !== step || item.requestId !== request.requestId || item.status !== 'COMPLETED') {
        throw error('CLEANUP_INCOMPLETE');
      }
      return { ConditionCheck:{ TableName:tables.deletion, Key,
        ...exact({step,requestId:request.requestId,status:'COMPLETED'}) } };
    }));
  }

  async function walletGuard(request, job) {
    const walletId = 'WALLET#DRIVER#'+request.subjectId;
    const Key = { walletId, sk:'META' };
    const wallet = await get(tables.wallets, Key);
    if (!Array.isArray(job.wallets) || job.wallets.length !== Number(Boolean(wallet)) ||
        job.wallets.some(item => item.walletId !== walletId || item.source !== 'CORE') ||
        wallet && (wallet.ownerId !== request.subjectId || wallet.ownerType !== 'DRIVER' ||
          wallet.status !== 'CLOSED' || wallet.currency !== 'IQD' || wallet.deletionRequestId !== request.requestId ||
          wallet.availableBalance !== 0 || wallet.lockedBalance !== 0 || wallet.legalHold || wallet.retentionHold)) {
      throw error('WALLET_CLOSURE_BLOCKED');
    }
    return { ConditionCheck:{ TableName:tables.wallets, Key,
      ...(wallet ? exact(wallet) : {ConditionExpression:'attribute_not_exists(walletId)'}) } };
  }

  async function profileClosure({ request, job }) {
    const checks = driverExecutionChecks(request,job,clock());
    const steps = await completedSteps(request,driverSteps.slice(0,driverSteps.indexOf('profileClosure')));
    const wallet = await walletGuard(request,job);
    const Key = { driverId:request.subjectId };
    const profile = await get(tables.driver,Key);
    if (profile && (profile.driverId !== request.subjectId || profile.cognitoSub !== request.subjectId ||
        profile.deletionRequestId !== request.requestId || profile.legalHold || profile.retentionHold)) {
      throw error('PROFILE_GENERATION_CHANGED');
    }
    const markerKey={pk:request.pk,sk:'DRIVER_PROFILE_REMOVED#'+request.requestId};
    const marker=await get(tables.deletion,markerKey);
    if (marker?.requestId===request.requestId && marker.subjectId===request.subjectId && !profile) return;
    if (!profile || marker) throw error('PROFILE_GENERATION_CHANGED');
    await db.send(new TransactWriteCommand({ TransactItems:[
      ...checks, ...steps, wallet,
      { Delete:{ TableName:tables.driver, Key, ...exact(profile) } },
      { Put:{ TableName:tables.deletion, Item:{...markerKey,requestId:request.requestId,subjectId:request.subjectId},
        ConditionExpression:'attribute_not_exists(pk)' } },
    ] }));
  }

  async function identityClosure({ request, job, enrollmentGuard }) {
    if (job?.pool!==poolId || job.username!==request.subjectId || typeof enrollmentGuard !== 'function') {
      throw error('DRIVER_ENROLLMENT_CLEANUP_REQUIRED');
    }
    const checks = driverExecutionChecks(request,job,clock());
    const completionKey={pk:request.pk,sk:'DRIVER_IDENTITY_REMOVED#'+request.requestId};
    const completed=await get(tables.deletion,completionKey);
    if (completed) {
      if (completed.subjectId!==request.subjectId || completed.requestId!==request.requestId) {
        throw error('DRIVER_IDENTITY_CHANGED');
      }
      return;
    }
    const steps = await completedSteps(request,driverSteps.filter(step=>step!=='identityClosure'));
    const wallet = await walletGuard(request,job);
    const profileKey = { driverId:request.subjectId };
    const Key = { pk:request.pk, sk:'DRIVER_PROFILE_REMOVED#'+request.requestId };
    const profileMarker = await get(tables.deletion,Key);
    if (profileMarker?.subjectId!==request.subjectId || profileMarker.requestId!==request.requestId) {
      throw error('PROFILE_GENERATION_CHANGED');
    }
    const enrollment = await enrollmentGuard({db,request,job,clock});
    if (!Array.isArray(enrollment) || !enrollment.length || enrollment.some(op=>!op?.ConditionCheck)) {
      throw error('DRIVER_ENROLLMENT_CLEANUP_REQUIRED');
    }
    let identity;
    try {
      identity = await readIdentity(cognito,request.subjectId);
    } catch (cause) {
      if (cause.name!=='UserNotFoundException') throw cause;
    }
    if (identity && identity.phone!==job.phone) throw error('DRIVER_IDENTITY_CHANGED');
    if (identity?.enabled) throw error('DRIVER_IDENTITY_STILL_ENABLED');
    const phoneKey=driverPhoneClosureKey(job.phone);
    const release=enrollment.find(op=>op.ConditionCheck.TableName===tables.deletion &&
      op.ConditionCheck.Key.pk===phoneKey.pk && op.ConditionCheck.Key.sk===phoneKey.sk);
    if (!release) throw error('DRIVER_ENROLLMENT_CLEANUP_REQUIRED');
    const finalGuards=[
      ...steps,wallet,
      { ConditionCheck:{TableName:tables.driver,Key:profileKey,ConditionExpression:'attribute_not_exists(driverId)'} },
      { ConditionCheck:{TableName:tables.deletion,Key,...exact(profileMarker)} },
    ];
    await db.send(new TransactWriteCommand({ TransactItems:[
      ...checks,...finalGuards,...enrollment,
    ] }));
    if (identity) await cognito.send(new AdminDeleteUserCommand({UserPoolId:poolId,Username:identity.username}));
    await db.send(new TransactWriteCommand({ TransactItems:[
      ...driverExecutionChecks(request,job,clock()),...finalGuards,
      { Delete:release.ConditionCheck },
      { Put:{TableName:tables.deletion,Item:{...completionKey,subjectId:request.subjectId,requestId:request.requestId},
        ConditionExpression:'attribute_not_exists(pk)'} },
    ] }));
  }

  return {profileClosure,identityClosure};
}

module.exports = {createDriverFinalization};
