const test = require('node:test');
const assert = require('node:assert/strict');
const {pendingCod} = require('../cod-retention');
const {ScanCommand} = require('@aws-sdk/lib-dynamodb');

function dbFor(rows) {
  return {async send(command) {
    assert.ok(command instanceof ScanCommand, 'inventory must remain read only');
    return {Items: command.input.TableName === 'staging-Holds' ? rows : []};
  }};
}
for (const [state, expected] of [
  ['OPEN', 'POST_DELIVERY_COMPLAINT_PENDING'],
  ['CLOSED', 'POST_DELIVERY_CASE_RETENTION_REVIEW'],
]) {
  test(`${state} complaint blocks owner cleanup even without its order`, async () => {
    const db = dbFor([
      {kind:'CUSTOMER_POST_DELIVERY_CASE', customerId:'owner', orderId:'missing', caseId:'mine', state},
      {kind:'CUSTOMER_POST_DELIVERY_CASE', customerId:'other', orderId:'other-order', caseId:'theirs', state},
      {kind:'OTHER', customerId:'owner', caseId:'unrelated', state},
    ]);
    const result = await pendingCod({db, customerIds:['owner']});
    assert.deepEqual(result, [{orderId:'missing', operationId:'mine', status:expected}]);
  });
}
test('customer identity is explicit and does not broaden driver ownership', async () => {
  const db = dbFor([{kind:'CUSTOMER_POST_DELIVERY_CASE', customerId:'owner', orderId:'missing', caseId:'mine', state:'OPEN'}]);
  assert.deepEqual(await pendingCod({db, driverIds:['owner']}), []);
  assert.equal((await pendingCod({db, orderIds:['missing']})).length, 1);
});
