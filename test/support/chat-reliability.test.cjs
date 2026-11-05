const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadPage() {
  const html = fs.readFileSync('frontend/pages/support.html', 'utf8');
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('// Global variables'));
  const elements = new Map();
  for (const id of ['messageInput', 'chatFeedback', 'chatMessages']) {
    elements.set(id, {value: '', textContent: '', innerHTML: '', style: {}, addEventListener() {}, appendChild() {}});
  }
  const callbacks = [];
  const timers = new Map();
  let timerId = 0;
  const sandbox = {
    console: {log() {}, warn() {}, error() {}},
    document: {
      addEventListener(name, fn) { callbacks.push(fn); },
      getElementById(id) { return elements.get(id) || null; },
      createElement() { return {textContent: '', innerHTML: '', style: {}}; }
    },
    URL,
    URLSearchParams,
    location: {search: ""},
    WebSocket: {OPEN: 1, CLOSED: 3, CONNECTING: 0},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() {},
    WIZZCENTRAL_CONFIG: {AI_API_ENDPOINT: 'https://local.invalid/staging'},
    Notification: {permission: 'default', requestPermission() { throw Error('Unexpected prompt'); }}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  vm.runInContext("currentSessionId = 'session-1'; merchantSessions.set(currentSessionId, {id: currentSessionId, messages: []});", sandbox);
  const sent = [];
  sandbox.socket = {readyState: 1, send(data) { sent.push(JSON.parse(data)); }};
  vm.runInContext('merchantChatWS = socket', sandbox);
  return {sandbox, elements, timers, sent, callbacks, run: code => vm.runInContext(code, sandbox)};
}

test('disconnected send preserves draft and never appends a successful message', () => {
  const p = loadPage();
  p.elements.get('messageInput').value = 'رد الموظف';
  p.sandbox.socket.readyState = 3;
  assert.equal(p.sandbox.sendMessage(), false);
  assert.equal(p.elements.get('messageInput').value, 'رد الموظف');
  assert.equal(p.run("merchantSessions.get('session-1').messages.length"), 0);
  assert.match(p.elements.get('chatFeedback').textContent, /الاتصال/);
  assert.equal(p.sent.length, 0);
});

test('socket exceptions preserve the draft and transcript', () => {
  const p = loadPage();
  p.elements.get('messageInput').value = 'محاولة';
  p.sandbox.socket.send = () => {throw Error('socket closed');};
  assert.equal(p.sandbox.sendMessage(), false);
  assert.equal(p.elements.get('messageInput').value, 'محاولة');
  assert.equal(p.run("merchantSessions.get('session-1').messages.length"), 0);
});

test('each reply waits for its correlated server acknowledgement, including late acknowledgements', () => {
  const p = loadPage();
  p.elements.get('messageInput').value = 'الأول';
  assert.equal(p.sandbox.sendMessage(), true);
  p.elements.get('messageInput').value = 'الثاني';
  p.sandbox.sendMessage();
  const [first, second] = p.sent;
  assert.notEqual(first.clientMessageId, second.clientMessageId);
  p.sandbox.handleMerchantChatMessage({type: 'message_ack', sessionId: 'other', clientMessageId: first.clientMessageId});
  assert.equal(p.run("merchantSessions.get('session-1').messages[0].deliveryStatus"), 'pending');
  p.sandbox.handleMerchantChatMessage({type: 'message_ack', sessionId: 'session-1', messageId: 'legacy-unmatched'});
  assert.equal(p.run("merchantSessions.get('session-1').messages[0].deliveryStatus"), 'pending');
  for (const callback of [...p.timers.values()]) callback();
  assert.equal(p.run("merchantSessions.get('session-1').messages[0].deliveryStatus"), 'unknown');
  p.sandbox.handleMerchantChatMessage({type: 'message_ack', sessionId: 'session-1', clientMessageId: first.clientMessageId, messageId: 'server-1'});
  assert.equal(p.run("merchantSessions.get('session-1').messages[0].deliveryStatus"), 'accepted');
  assert.equal(p.run("merchantSessions.get('session-1').messages[0].id"), 'server-1');
  assert.equal(p.run("merchantSessions.get('session-1').messages[1].deliveryStatus"), 'unknown');
  assert.equal(p.sent.length, 2, 'timeouts never resend automatically');
});

test('history retains merchant/customer identity and distinct repeated messages', () => {
  const p = loadPage();
  p.sandbox.handleMerchantChatMessage({type: 'session_messages', sessionId: 'session-1', messages: [
    {messageId: 'm1', senderType: 'merchant', senderName: 'المتجر', text: 'مرحبا'},
    {messageId: 'm2', senderType: 'customer', senderName: 'الزبون', text: 'سؤال'}
  ]});
  assert.equal(p.run("merchantSessions.get('session-1').messages.find(m=>m.id==='m1').senderType"), 'merchant');
  assert.equal(p.run("merchantSessions.get('session-1').messages.find(m=>m.id==='m2').senderName"), 'الزبون');
  for (const messageId of ['unique-1', 'unique-2', 'unique-2']) {
    p.sandbox.handleMerchantChatMessage({type: 'chat_message', sessionId: 'session-1', messageId, senderType: 'merchant', text: 'نفس النص'});
  }
  assert.equal(p.run("merchantSessions.get('session-1').messages.length"), 4);
});

test('history reconciles an unconfirmed reply without duplicating it', () => {
  const p = loadPage();
  p.elements.get('messageInput').value = 'reply saved before connection dropped';
  p.sandbox.sendMessage();
  const clientMessageId = p.sent[0].clientMessageId;
  for (const callback of [...p.timers.values()]) callback();
  p.sandbox.handleMerchantChatMessage({type: 'session_messages', sessionId: 'session-1', messages: [{
    messageId: 'persisted-1', senderType: 'agent', text: 'reply saved before connection dropped',
    metadata: {clientMessageId}
  }]});
  assert.equal(p.run("merchantSessions.get('session-1').messages.length"), 1);
  assert.equal(p.run("merchantSessions.get('session-1').messages[0].deliveryStatus"), 'accepted');
  assert.equal(p.run("merchantSessions.get('session-1').messages[0].id"), 'persisted-1');
});

test('closing waits for server confirmation and cannot close while offline', () => {
  const p = loadPage();
  p.sandbox.socket.readyState = 3;
  assert.equal(p.sandbox.endChatSession(), false);
  assert.equal(p.sent.length, 0);
  p.sandbox.socket.readyState = 1;
  assert.equal(p.sandbox.endChatSession(), true);
  assert.equal(p.run("merchantSessions.has('session-1')"), true);
  p.sandbox.handleMerchantChatMessage({type: 'session_closed', sessionId: 'session-1'});
  assert.equal(p.run("merchantSessions.has('session-1')"), false);
  assert.equal(p.run("closedSessions.has('session-1')"), true);
});

test('page startup does not prompt for notification permission', () => {
  const p = loadPage();
  // Exercise DOMContentLoaded callbacks with network and unrelated legacy UI stubbed.
  p.sandbox.initializeMerchantChatSystem = () => {};
  for (const callback of p.callbacks) callback();
});

function loadHandler({failStore = false} = {}) {
  const dbCommands = [], deliveries = [];
  class Command { constructor(input) { this.input = input; } }
  const names = ['PutCommand','GetCommand','UpdateCommand','QueryCommand','DeleteCommand'];
  const commands = Object.fromEntries(names.map(name => [name, class extends Command {}]));
  const db = {async send(command) {
    dbCommands.push(command);
    if (command instanceof commands.GetCommand) return {Item: {sessionId: 'session-1', status: 'active', userId: 'user-1'}};
    if (command instanceof commands.QueryCommand) return {Items: []};
    if (failStore && command instanceof commands.PutCommand) throw Error('storage failed');
    return {};
  }};
  const sandbox = {exports: {}, process: {env: {AWS_REGION: 'us-east-1'}}, console: {log() {}, warn() {}, error() {}},
    require(name) {
      if (name === '@aws-sdk/client-dynamodb') return {DynamoDBClient: class {}};
      if (name === '@aws-sdk/lib-dynamodb') return {...commands, DynamoDBDocumentClient: {from: () => db}};
      if (name === '@aws-sdk/client-apigatewaymanagementapi') return {
        PostToConnectionCommand: Command,
        ApiGatewayManagementApiClient: class {async send(command) { deliveries.push(JSON.parse(command.input.Data)); }}
      };
      throw Error(name);
    }
  };
  vm.runInNewContext(fs.readFileSync('backend/src/handlers/chat-websocket-handler.js', 'utf8'), sandbox);
  return {handler: sandbox.exports.handler, dbCommands, deliveries, commands};
}

for (const senderType of ['agent', 'driver', 'merchant', 'customer']) {
  test(`backend saves ${senderType} message and acknowledges its client ID`, async () => {
    const h = loadHandler();
    const result = await h.handler({requestContext: {connectionId: 'c1', routeKey: 'chat_message', stage: 'staging', domainName: 'test.invalid'},
      body: JSON.stringify({sessionId: 'session-1', senderType, messageText: 'hello', clientMessageId: 'client-1'})});
    assert.equal(result.statusCode, 200);
    const stored = h.dbCommands.find(c=>c instanceof h.commands.PutCommand).input.Item;
    assert.equal(stored.metadata.clientMessageId, 'client-1');
    const ack = h.deliveries.find(d=>d.type === 'message_ack');
    assert.equal(ack.clientMessageId, 'client-1');
    assert.equal(ack.messageId, stored.messageId);
    const update = h.dbCommands.find(c => c instanceof h.commands.UpdateCommand && c.input.Key.sessionId);
    assert.match(update.input.UpdateExpression, senderType === 'agent' ? /unreadDriver/ : /unreadAgent/);
  });
}

test('backend never acknowledges a failed message save', async () => {
  const h = loadHandler({failStore: true});
  const result = await h.handler({requestContext: {connectionId: 'c1', routeKey: 'chat_message', stage: 'staging', domainName: 'test.invalid'},
    body: JSON.stringify({sessionId: 'session-1', senderType: 'agent', messageText: 'hello'})});
  assert.equal(result.statusCode, 500);
  assert.equal(h.deliveries.some(d=>d.type === 'message_ack'), false);
});

test('support connection renews the session and supplies a real token with support role', async () => {
  const p = loadPage();
  let refreshed = false, socketUrl;
  p.sandbox.Auth = {async ensureSession() {refreshed = true;}, getToken(key) {assert.equal(key, 'idToken'); return 'verified-token-fixture';}};
  p.sandbox.WIZZCENTRAL_CONFIG.WEBSOCKET = {LIVE_CHAT_URL: 'wss://local.invalid/staging'};
  p.sandbox.WebSocket = class {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    constructor(url) {assert.equal(refreshed, true); socketUrl = new URL(url); this.readyState = 0;}
  };
  p.run('merchantChatWS = null');
  await p.sandbox.initializeMerchantChatSystem();
  assert.equal(socketUrl.searchParams.get('token'), 'verified-token-fixture');
  assert.equal(socketUrl.searchParams.get('userType'), 'support');
});

test('support does not open a socket when session renewal fails', async () => {
  const p = loadPage();
  p.sandbox.Auth = {async ensureSession() {throw Error('expired');}};
  p.sandbox.WIZZCENTRAL_CONFIG.WEBSOCKET = {LIVE_CHAT_URL: 'wss://local.invalid/staging'};
  p.sandbox.WebSocket = class {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    constructor() {throw Error('must not connect');}
  };
  p.run('merchantChatWS = null');
  await p.sandbox.initializeMerchantChatSystem();
  assert.equal(p.run('merchantChatWS'), null);
  assert.match(p.elements.get('chatFeedback').textContent, /تسجيل الدخول/);
});

test('a saved server echo before its acknowledgement does not duplicate the local reply', () => {
  const p = loadPage();
  p.elements.get('messageInput').value = 'confirmed reply';
  p.sandbox.sendMessage();
  const clientMessageId = p.sent[0].clientMessageId;
  p.sandbox.handleMerchantChatMessage({type: 'chat_message', sessionId: 'session-1', message: {
    messageId: 'server-echo', clientMessageId, sessionId: 'session-1', senderType: 'agent', text: 'confirmed reply'
  }});
  p.sandbox.handleMerchantChatMessage({type: 'message_ack', clientMessageId, sessionId: 'session-1', messageId: 'server-echo'});
  assert.equal(p.run("merchantSessions.get('session-1').messages.length"), 1);
  assert.equal(p.run("merchantSessions.get('session-1').messages[0].id"), 'server-echo');
  assert.equal(p.run("merchantSessions.get('session-1').messages[0].deliveryStatus"), 'accepted');
});

test('customer and merchant session labels are preserved in support inbox', () => {
  const p = loadPage();
  assert.equal(p.sandbox.sessionDisplayName({userType:'customer',payload:{customerName:'زبون تجريبي'}}),'زبون تجريبي');
  assert.equal(p.sandbox.sessionDisplayName({userType:'customer'}),'زبون');
  assert.equal(p.sandbox.sessionDisplayName({userType:'merchant',merchantName:'متجر تجريبي'}),'متجر تجريبي');
});
