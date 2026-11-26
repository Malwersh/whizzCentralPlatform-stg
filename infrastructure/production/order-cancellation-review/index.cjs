'use strict';

const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { createExceptionStaffAuthority } = require('../../../backend/wallet-service/src/exceptionStaffAuthority');
const { createExceptionCaseAdministration } = require('../../../backend/wallet-service/src/exceptionCaseAdministration');
const { createFinanceRollout } = require('../../../backend/wallet-service/src/financeRollout');
const { createCancellationCompensation } = require('../../../backend/wallet-service/src/cancellationCompensation');
const { quoteEntityIdValid } = require('../../../backend/wallet-service/src/deliveryQuoteRecord');
const { createCancellationQueue, validateCancellationReviewAction } = require('../../../backend/wallet-service/src/productionCancellationReview');

const PATH = '/staff/order-cancellation';
const caseKeys = new Set(['CUSTOMER_CANCELLATION', 'MERCHANT_CANCELLATION']);
const compensationActions = new Set(['APPROVE', 'EXECUTE', 'CLOSE']);
const clientErrors = new Map([
  [400, ['INVALID_CURSOR', 'INVALID_EXCEPTION_SELECTOR', 'INVALID_EXCEPTION_CASE_ACTION', 'INVALID_CANCEL_COMPENSATION']],
  [401, ['UNAUTHORIZED', 'NotAuthorizedException']],
  [403, ['EXCEPTION_PERMISSION_REQUIRED', 'EXCEPTION_EMPLOYEE_UNAVAILABLE', 'EXCEPTION_APPROVAL_LIMIT', 'FORBIDDEN']],
  [409, [
    'EXCEPTION_CASE_CONFLICT', 'EXCEPTION_CASE_ACTION_NOT_ALLOWED', 'EXCEPTION_CASE_UNAVAILABLE',
    'CANCELLATION_RETAINED_PROOF_REQUIRED', 'CANCELLATION_AFTER_PICKUP_OR_TERMINAL',
    'CANCELLATION_ASSIGNED_REVIEW_REQUIRED', 'FINANCE_ROLLOUT_OUT_OF_SCOPE',
    'COD_ASSIGNMENT_CONFLICT', 'COD_ASSIGNMENT_UNAVAILABLE', 'CANCELLATION_CONFLICT',
    'ConditionalCheckFailedException', 'TransactionCanceledException',
    'CANCEL_COMPENSATION_UNAVAILABLE', 'CANCEL_COMPENSATION_RELEASE_REQUIRED',
    'CANCEL_COMPENSATION_SOURCE_REQUIRED', 'CANCEL_COMPENSATION_AGREEMENT_REQUIRED',
    'CANCEL_COMPENSATION_AMOUNTS_INVALID', 'CANCEL_COMPENSATION_MERCHANT_FUNDING_PROOF_REQUIRED',
    'CANCEL_COMPENSATION_APPROVAL_REQUIRED', 'CANCEL_COMPENSATION_CONFLICT',
    'CANCEL_COMPENSATION_PAYOUT_PENDING', 'CANCEL_COMPENSATION_APPEAL_PENDING',
    'CANCEL_COMPENSATION_WORK_REMAINS', 'CORRECTION_CASE_WORK_REMAINS',
    'EXCEPTION_INSUFFICIENT_AVAILABLE_BALANCE', 'EXCEPTION_WALLET_UNAVAILABLE',
    'PAYOUT_PAID_PROOF_INVALID',
  ]],
]);
const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
const reply = (statusCode, value) => ({statusCode, headers, body: JSON.stringify(value)});
const error = (status, code) => reply(status, {error: code});

function createHandler({ db, cognito, now = Date.now }) {
  return async event => {
    if (process.env.ENVIRONMENT !== 'production' || event.requestContext?.stage !== 'production' ||
        event.resource !== PATH) return error(404, 'NOT_FOUND');
    if (!['GET', 'POST'].includes(event.httpMethod)) return error(405, 'METHOD_NOT_ALLOWED');
    const source = Object.entries(event.headers ?? {}).filter(([name]) => name.toLowerCase() === 'authorization');
    const accessToken = source.length === 1 && typeof source[0][1] === 'string'
      ? /^Bearer (\S{1,16000})$/i.exec(source[0][1])?.[1] : undefined;
    if (!accessToken) return error(401, 'UNAUTHORIZED');

    try {
      const authority = createExceptionStaffAuthority({db, cognito, accessToken});
      const actor = await authority.authenticate();
      const query = event.queryStringParameters ?? {};
      const compensation = query.view === 'compensation';
      let input;
      if (event.httpMethod === 'POST') {
        if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 10000) {
          return error(400, compensation ? 'INVALID_CANCEL_COMPENSATION' : 'INVALID_EXCEPTION_CASE_ACTION');
        }
        try { input = JSON.parse(event.body); }
        catch { return error(400, compensation ? 'INVALID_CANCEL_COMPENSATION' : 'INVALID_EXCEPTION_CASE_ACTION'); }
      }
      if (compensation) {
        const read = event.httpMethod === 'GET';
        if (Object.values(event.multiValueQueryStringParameters ?? {}).some(values => values.length !== 1) ||
            Object.keys(query).sort().join(',') !== (read ? 'caseKey,orderId,view' : 'view')) {
          return error(400, 'INVALID_CANCEL_COMPENSATION');
        }
        if (read) input = {action: 'READ', orderId: query.orderId, caseKey: query.caseKey};
        if (!input || !quoteEntityIdValid(input.orderId) || !caseKeys.has(input.caseKey) ||
            (!read && !compensationActions.has(input.action))) return error(400, 'INVALID_CANCEL_COMPENSATION');
        if (read) await authority.readCash(actor);
        else await authority.financial(actor, 0);

        const rollout = createFinanceRollout({db, cancellationCompensation: true});
        await rollout.order(input.orderId, 'DRAIN');
        return reply(200, await createCancellationCompensation({db: rollout.db, authority, now})(input));
      }
      if (event.httpMethod === 'GET') {
        const {employee} = await authority.read(actor);
        return reply(200, await createCancellationQueue(db).list(query, employee));
      }

      validateCancellationReviewAction(input);
      await authority.operate(actor);
      const rollout = createFinanceRollout({db});
      await rollout.order(input.orderId, 'DRAIN');
      const decide = createExceptionCaseAdministration({
        db: rollout.db, authority, enableFullCash: true, enableDeliveryFunding: true,
      });
      const receipt = await decide(input);
      return reply(200, {
        success: true, orderId: receipt.orderId, caseId: receipt.caseId, action: input.action,
      });
    } catch (cause) {
      for (const [status, accepted] of clientErrors) {
        const code = [cause?.code, cause?.name, cause?.message].find(value => accepted.includes(value));
        if (!code) continue;
        if (status === 401) return error(401, 'UNAUTHORIZED');
        if (['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(code)) {
          return error(409, 'EXCEPTION_CASE_CONFLICT');
        }
        return error(status, code);
      }
      console.error('Cancellation review unavailable', cause?.name);
      return error(503, 'EXCEPTION_REVIEW_UNAVAILABLE');
    }
  };
}

const options = {region: 'us-east-1', maxAttempts: 2};
const db = DynamoDBDocumentClient.from(new DynamoDBClient(options), {
  marshallOptions: {removeUndefinedValues: true},
});
module.exports = {handler: createHandler({db, cognito: new CognitoIdentityProviderClient(options)}), createHandler};
