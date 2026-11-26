'use strict';

const { error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');

function productionExecutionChecks(actorType, request, job, now) {
  const { subjectId, requestId, pk, sk, version, leaseOwner } = request;
  if (!['CUSTOMER','DRIVER'].includes(actorType) || request.actorType !== actorType || request.status !== 'PROCESSING' ||
      request.scope?.kind !== 'ACCOUNT' || request.scope.id !== subjectId ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subjectId) ||
      pk !== 'SUBJECT#' + actorType + '#' + subjectId || sk !== 'REQUEST#' + requestId ||
      !leaseOwner || !Number.isSafeInteger(version) ||
      job?.requestId !== requestId || job.subjectId !== subjectId ||
      !Array.isArray(job.profileIds) || job.profileIds.some(id => id !== subjectId) || (actorType==='DRIVER' && job.profileIds.length!==1)) {
    throw error('INVALID_CLEANUP_SCOPE');
  }

  return [
    { ConditionCheck: {
      TableName: tables.deletion, Key: { pk, sk },
      ConditionExpression: '#version=:version AND #status=:processing AND leaseOwner=:lease AND leaseUntil>:now',
      ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
      ExpressionAttributeValues: {
        ':version': version, ':processing': 'PROCESSING', ':lease': leaseOwner, ':now': Math.floor(now / 1000),
      },
    } },
    { ConditionCheck: {
      TableName: tables.deletion, Key: { pk: 'ACCOUNT_LIFECYCLE#' + actorType + '#' + subjectId, sk: 'META' },
      ConditionExpression: 'requestId=:request AND #state=:closing',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: { ':request': requestId, ':closing': 'CLOSING' },
    } },
  ];
}

const customerExecutionChecks = (request, job, now) => productionExecutionChecks('CUSTOMER', request, job, now);
const driverExecutionChecks = (request, job, now) => productionExecutionChecks('DRIVER', request, job, now);

module.exports = { customerExecutionChecks, driverExecutionChecks };
