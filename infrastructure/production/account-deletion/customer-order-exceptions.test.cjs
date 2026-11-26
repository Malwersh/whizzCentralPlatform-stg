'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCustomerOrderCleanup } = require('./customer-order-archive.cjs');
const { quoteHash } = require('../../../backend/wallet-service/dist/deliveryQuoteRecord');
const { verifyZeroMerchantException } = require('../../../backend/wallet-service/dist/merchantSettlementPreview');
const { financialRecord } = require('../../../backend/account-deletion/customer-cleanup');
const { tables } = require('./evidence.cjs');

for (const status of ['cancelled', 'returned']) {
  test(status + ' offer cleanup requires closed case evidence and a verified paid accrual', async () => {
    const subjectId = '12345678-0000-4000-8000-000000000032';
    const order = {
      PK: 'ORDER#order1', SK: 'META', orderId: 'order1', storeId: 'branch1',
      userSub: subjectId, status, orderStatus: status, financialOutcome: 'operation1',
      ...(status === 'returned' ? { returnCaseId: 'return1' } : {}),
    };
    const closure = {
      orderId: order.orderId, caseId: 'case1',
      financialClosure: { actorId: 'staff1', closedAt: '2026-11-26T08:00:00.000Z' },
      ...(status === 'cancelled'
        ? { sk: 'CUSTOMER_CANCELLATION', kind: 'CUSTOMER_CANCELLATION', state: 'CANCELLED', settlementStatus: 'RESOLVED' }
        : { sk: 'RETURN#1', kind: 'COD_RETURN_CASE', returnId: 'return1',
          taskCompletion: { returnId: 'return1' }, exceptionResolution: { status: 'RESOLVED' } }),
    };
    const offer = {
      orderId: order.orderId, SK: 'FINANCIAL#driver1#WAVE#1',
      financialOffer: { source: { order: { customerPoint: { latitude: 1, longitude: 2 } } } },
    };
    let holdRows = [closure];
    let payableStatus = 'PAID';
    let settlementReads = 0;
    let journal, transaction;
    const requestId = 'request1', clock = () => Date.parse('2026-11-26T08:00:00Z');
    const request = { subjectId, requestId, actorType: 'CUSTOMER', status: 'PROCESSING',
      pk: 'SUBJECT#CUSTOMER#' + subjectId, sk: 'REQUEST#' + requestId,
      scope: { kind: 'ACCOUNT', id: subjectId }, leaseOwner: 'worker', version: 1 };
    const job = { subjectId, requestId, profileIds: [subjectId], policyVersion: 'policy1', financialYears: 7 };
    const archive = { ...financialRecord(order, 'order', job, new Date(clock()).toISOString()),
      sourceTable: tables.orders, sourceKey: { PK: order.PK, SK: order.SK } };
    const db = { async send({ input }) {
      if (input.TransactItems) {
        transaction = input.TransactItems;
        return {};
      }
      assert.equal(input.ConsistentRead, true);
      if (input.Key?.pk === 'REQUEST#' + requestId) return { Item: archive };
      if (input.Key) return { Item: input.Key.sk === 'MERCHANT_PAYABLE'
        ? payableStatus && { status: payableStatus } : journal };
      const Items = {
        [tables.orders]: [order], [tables.offers]: [offer], [tables.holds]: holdRows,
      }[input.TableName];
      assert.ok(Items);
      return { Items };
    } };
    const cleanup = createCustomerOrderCleanup({
      verifyZeroMerchantException,
      preserveMerchantSettlementEvidence: () => assert.fail('preflight must not write'),
      async readMerchantAccrualEvidence(readerDb, branchId, orderId) {
        assert.equal(readerDb, db);
        assert.equal(branchId, order.storeId);
        assert.equal(orderId, order.orderId);
        settlementReads++;
        return { payable: { status: payableStatus } };
      },
    });
    const check = () => cleanup.preflight({ db, request: { subjectId } });
    holdRows = [{ ...closure, correctionReview: { status: 'PENDING' } }];
    await assert.rejects(check(), { code: 'ORDER_EXCEPTION_CLOSURE_REQUIRED' });
    assert.equal(settlementReads, 0);
    holdRows = [{ ...closure, financialClosure: undefined }];
    await assert.rejects(check(), { code: 'ORDER_EXCEPTION_CLOSURE_REQUIRED' });
    holdRows = [closure];
    payableStatus = 'LOCKED_PENDING_SETTLEMENT';
    await assert.rejects(check(), { code: 'ORDER_EXCEPTION_CLOSURE_REQUIRED' });
    payableStatus = 'PAID';
    await check();
    assert.equal(settlementReads, 2);
    payableStatus = undefined;
    await assert.rejects(check(), { code: 'ORDER_EXCEPTION_CLOSURE_REQUIRED' });
    const body = {
      orderId: order.orderId, sk: 'EXCEPTION_ENTITLEMENTS', kind: 'ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL',
      state: 'POSTED', branchId: order.storeId, caseId: closure.caseId, operationId: 'exception1',
      merchantCompensationIqd: 0,
      ...(status === 'cancelled' ? { cancellationCompensation: { cancellationOperationId: order.financialOutcome } } : {}),
    };
    journal = { ...body, digest: quoteHash(body) };
    closure.entitlementsPosted = { operationId: journal.operationId, journalDigest: journal.digest, merchantCompensationIqd: 0 };
    if (status === 'cancelled') closure.merchantCompensation = { paymentStatus: 'ZERO_APPROVED' };
    else closure.exceptionResolution.merchantCompensation = { paymentStatus: 'ZERO_APPROVED' };
    await check();
    journal.merchantCompensationIqd = 1;
    await assert.rejects(check(), { code: 'ORDER_EXCEPTION_CLOSURE_REQUIRED' });
    assert.equal(settlementReads, 2);

    journal.merchantCompensationIqd = 0;
    await cleanup.redact({ db, request, job, clock });
    assert.ok(transaction.some(item => item.ConditionCheck?.Key.sk === closure.sk));
    assert.ok(transaction.some(item => item.ConditionCheck?.Key.sk === journal.sk));
    assert.ok(transaction.some(item => item.ConditionCheck?.Key.sk === 'MERCHANT_PAYABLE' &&
      item.ConditionCheck.ConditionExpression === 'attribute_not_exists(orderId)'));
    assert.ok(transaction.some(item => item.Update?.TableName === tables.orders));
    assert.ok(transaction.some(item => item.Update?.TableName === tables.offers));

  });
}
