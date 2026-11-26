'use strict';

const outbox = 'wizz-production-WalletNotifications';
const pending = 'OWNERSHIP_PENDING';
const prefix = 'OWNERSHIP_NOTICE#';
const actions = new Set(['ownership_invitation', 'ownership_accepted', 'ownership_completed_previous', 'ownership_completed_new']);
const eventId = (requestId, action) => prefix + requestId + '#' + action;

function enqueue(request, action, now) {
  const { requestId, organizationId, expiresAt } = request;
  if (!actions.has(action)) throw Error('INVALID_OWNERSHIP_NOTICE');
  return { Put: {
    TableName: outbox,
    Item: { eventId: eventId(requestId, action), requestId, organizationId, action,
      type: action, recipientApp: 'merchant', deliveryStatus: pending,
      attempts: 0, createdAt: now, expiresAt, nextAttemptAt: Math.floor(now / 1000),
      ttl: Math.ceil(Math.max(now, expiresAt) / 1000) + 30 * 86400 },
    ConditionExpression: 'attribute_not_exists(eventId)',
  } };
}

module.exports = { outbox, pending, prefix, eventId, enqueue, actions };
