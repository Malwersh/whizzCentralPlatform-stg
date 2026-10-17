import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';

export const COD_INTEGRATION_QUEUE = 'COD_INTEGRATION';
export const COD_EVENT_KINDS = ['COD_ACCEPTANCE_OUTBOX', 'COD_COMPLETION_OUTBOX', 'COD_RETURN_OUTBOX', 'COD_CANCEL_OUTBOX', 'COD_UNASSIGN_OUTBOX'] as const;
export type CodEventKind = typeof COD_EVENT_KINDS[number];
export type CodIntegrationInput = {
  kind: CodEventKind; financialOperationId: string; orderId: string; driverId: string;
  subjectId: string; branchId: string; offerId: string; attempt: number; waveNumber: number; createdAt: string;
};

/** Written in the financial transaction. This queue is never consumed by the legacy hold worker. */
export function codIntegrationEvent(input: CodIntegrationInput) {
  if (!COD_EVENT_KINDS.includes(input.kind) ||
      ![input.financialOperationId, input.orderId, input.driverId, input.subjectId, input.branchId, input.offerId].every(quoteEntityIdValid) ||
      !Number.isSafeInteger(input.waveNumber) || input.waveNumber < 1 || input.waveNumber > 1000 ||
      !Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 1000 ||
      !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt) {
    throw Error('INVALID_COD_INTEGRATION_EVENT');
  }
  return { Put: { TableName: 'staging-WalletLifecycle', Item: {
    ...input, operationId: input.financialOperationId + ':EVENT', integrationSchemaVersion: 1,
    status: 'PENDING_INTEGRATION', queuePartition: COD_INTEGRATION_QUEUE, nextAttemptAt: 0, integrationAttempts: 0
  }, ConditionExpression: 'attribute_not_exists(operationId)' } };
}

export function codAcceptanceOperation(orderId: string, offerId: string, attempt: number) {
  return 'CDA:' + quoteHash({ orderId, offerId, attempt }).slice(0, 48);
}
