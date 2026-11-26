'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMerchantPosApi } = require('./api.cjs');

function fixture() {
  const endpoint = 'https://pos.example.org/webhook';
  const data = { owner: 'owner', closing: false, writes: [], requests: [] };
  const db = { async send(command) {
    const { TableName, TransactItems } = command.input;
    if (TransactItems) {
      data.writes.push(TransactItems);
      data.saved = TransactItems.at(-1).Put.Item;
      return {};
    }
    if (TableName.endsWith('-Merchants')) return { Item: { ownerId: data.owner, cognitoUserId: data.owner, status: 'approved' } };
    if (TableName.endsWith('-AccountDeletion')) return data.closing ? { Item: {} } : {};
    return { Item: data.saved };
  } };
  const api = createMerchantPosApi({ db, authenticate: async event => ({ sub: event.actor }),
    approvedEndpoints: [endpoint], request: async (...args) => { data.requests.push(args); return { ok: true }; } });
  const call = async (method, input, actor = 'owner', test = false) => {
    const reply = await api({ httpMethod: method, requestContext: { stage: 'production' }, actor,
      path: '/businesses/shop/pos-settings' + (test ? '/test-connection' : ''), body: JSON.stringify(input) });
    return [reply.statusCode, JSON.parse(reply.body)];
  };
  return { call, data, endpoint };
}
test('settings are owner-scoped, credentials are never returned, and closure is fenced atomically', async () => {
  const {call,data,endpoint}=fixture();
  assert.equal((await call('PUT',{enabled:true,apiEndpoint:endpoint,apiKey:'secret'}))[0],200);
  assert.equal(data.saved.apiKey,'secret');
  const [status,settings]=await call('GET');
  assert.equal(status,200);
  assert.equal(settings.apiKey,'');
  assert.equal(settings.apiKeyConfigured,true);
  assert.equal(data.writes[0].filter(entry=>entry.ConditionCheck).length,3);
  assert.equal((await call('GET',undefined,'foreign'))[0],404);
  data.closing=true;
  assert.equal((await call('PUT',{enabled:false}))[0],409);
  assert.equal(data.writes.length,1);
});
test('connection probe uses the approved endpoint and does not reuse credentials after transfer', async () => {
  const {call,data,endpoint}=fixture();
  assert.equal((await call('POST',{apiEndpoint:'https://other.example.org/'},'owner',true))[0],403);
  await call('PUT',{enabled:true,apiEndpoint:endpoint,apiKey:'old-secret'});
  const [status,result]=await call('POST',{},'owner',true);
  assert.equal(status,200);
  assert.equal(result.success,true);
  assert.equal(data.requests[0][1].redirect,'error');
  data.owner='new-owner';
  assert.equal((await call('POST',{apiEndpoint:endpoint},'new-owner',true))[0],400);
  assert.equal((await call('PUT',{enabled:true,apiEndpoint:endpoint,apiKey:'new-secret'},'new-owner'))[0],200);
  assert.equal(data.saved.ownerId,'new-owner');
  assert.equal(data.requests.length,1);
});
