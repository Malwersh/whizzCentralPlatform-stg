import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createCodFlowContext } from './codFlowContext';
import { createFinanceRollout } from './financeRollout';
import { createFullCashCompletion } from './fullCashCompletion';
import { exactCheck, strongGet, updateChecked, financialTransactionToken, FinancialRow as Row } from './driverFinancialTransaction';
import { toWholeIqdExact } from './money';
import { financialDispatchTables } from './walletBindings';

const transitions = {
  'start-heading': { from: ['assigned', 'accepted'], to: 'heading_to_store', timestamp: 'startHeadingToStoreAt' },
  'arrive-store': { from: ['heading_to_store'], to: 'arrived_at_store', timestamp: 'arrivedAtStoreAt' },
  pickup: { from: ['arrived_at_store'], to: 'picked_up', timestamp: 'pickedUpAt' },
  'start-heading-to-customer': { from: ['picked_up'], to: 'heading_to_customer', timestamp: 'startHeadingToCustomerAt' },
  'arrive-customer': { from: ['heading_to_customer'], to: 'arrived_at_customer', timestamp: 'arrivedAtCustomerAt' },
};

type Actor = { driverId: string; subjectId: string };
export type TripAction = keyof typeof transitions | 'deliver';

export function isTripAction(value: unknown): value is TripAction {
  return typeof value === 'string' && (value === 'deliver' || Object.prototype.hasOwnProperty.call(transitions, value));
}

export function createProductionDriverTrip({ db: raw, readOrder, now = Date.now }: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  readOrder: (driverId: string, orderId: string) => Promise<Row>;
  now?: () => number;
}) {
  return async (action: TripAction, orderId: string, input: Row, actor: Actor, verify: () => Promise<Actor>) => {
    const tables = financialDispatchTables();
    const rollout = createFinanceRollout({ db: raw, completion: action === 'deliver' });
    await rollout.order(orderId, 'DRAIN');
    rollout.driver(orderId, actor.driverId, actor.subjectId);
    const db = rollout.db;
    const order = await strongGet(db, tables.orders, { PK: 'ORDER#' + orderId, SK: 'META' });
    if (!order || order.driverId !== actor.driverId ||
        (order.assignedDriverId != null && order.assignedDriverId !== actor.driverId)) throw Error('ORDER_NOT_FOUND');
    const terms = order.financialAcceptance;
    if (order.financialSnapshot?.schemaVersion !== 3 || terms?.schemaVersion !== 3 ||
        terms.settlementModel !== 'FULL_CASH_AT_DELIVERY_V1') throw Error('ACTIVE_ASSIGNMENT_CHANGED');

    if (action === 'deliver') {
      if (Object.keys(input).some(key => !['cashCollected', 'cashAmount', 'deliveryNotes'].includes(key)) ||
          input.cashCollected !== true ||
          (input.deliveryNotes !== undefined && (typeof input.deliveryNotes !== 'string' || input.deliveryNotes.length > 500)) ||
          (input.cashAmount !== undefined && input.cashAmount !== toWholeIqdExact(terms.allocation.customerTotal))) {
        throw Error('COD_CASH_CONFIRMATION_MISMATCH');
      }
      if (!['arrived_at_customer', 'delivered'].includes(order.status)) throw Error('ACTIVE_ASSIGNMENT_CHANGED');
      return createFullCashCompletion({ db, enabled: true, authenticateDriver: verify, now })
        .complete({ orderId, cashCollected: true });
    }
    if (Object.keys(input).length) throw Error('INVALID_TRIP_UPDATE');
    const step = transitions[action];
    const load = createCodFlowContext({
      db, now, enableDeliveryFunding: true, enableFullCash: true,
      authenticate: async () => ({ kind: 'DRIVER', subjectId: (await verify()).subjectId }),
    });
    const c = await load({ orderId, offerId: terms.offerId, attempt: order.assignmentAttemptCounter }, 'DRIVER');
    if (c.order.driverId !== actor.driverId || c.order.orderStatus !== c.order.status ||
        !['APPROVED', 'VERIFIED'].includes(c.driver.status) || c.driver.isBanned || c.driver.isSuspended ||
        ['financialOutcome', 'codFinancialEvidence', 'cancellationRequestId', 'cancellationStatus', 'returnCaseId', 'returnStatus']
          .some(field => c.order[field] != null)) throw Error('ACTIVE_ASSIGNMENT_CHANGED');
    if (c.order.status === step.to) return readOrder(actor.driverId, orderId);
    if (!step.from.includes(c.order.status)) throw Error('ACTIVE_ASSIGNMENT_CHANGED');

    const liveKey = { driverId: actor.driverId };
    const live = await strongGet(db, tables.live, liveKey);
    if (live?.currentOrderId !== orderId || live.activeOrdersCount !== 1) throw Error('ACTIVE_ASSIGNMENT_CHANGED');
    const fields = ['orderId', 'storeId', 'businessId', 'status', 'orderStatus', 'driverId', 'assignedDriverId',
      'financialAcceptance', 'financialOutcome', 'codFinancialEvidence', 'assignmentAttemptCounter',
      'cancellationRequestId', 'cancellationStatus', 'returnCaseId', 'returnStatus', 'deletionRequestId',
      'deletionStatus', 'isDeleted', 'deletedAt', step.timestamp];
    const checked = exactCheck(tables.orders, c.key, c.order, fields);
    const ops = [...c.guards, exactCheck(tables.live, liveKey, live, ['currentOrderId', 'activeOrdersCount']),
      updateChecked(checked,
        'SET #status=:next, orderStatus=:next, updatedAt=:at, #stepAt=:stepAt',
        { '#status': 'status', '#stepAt': step.timestamp }, { ':next': step.to, ':at': c.timestamp, ':stepAt': c.order[step.timestamp] ?? c.timestamp })];
    try {
      await db.send(new TransactWriteCommand({
        TransactItems: ops as any, ClientRequestToken: financialTransactionToken(ops),
      }));
    } catch (error: any) {
      if (error.name !== 'TransactionCanceledException') throw error;
      const saved = await readOrder(actor.driverId, orderId);
      if (saved.status === step.to && saved.financialAssignment?.offerId === terms.offerId &&
          saved.financialAssignment.attempt === order.assignmentAttemptCounter) return saved;
      throw Error('ACTIVE_ASSIGNMENT_CHANGED');
    }
    return readOrder(actor.driverId, orderId);
  };
}
