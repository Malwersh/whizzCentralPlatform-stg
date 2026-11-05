const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const access = require('../../backend/src/utils/support-access');
const {marshall} = require('@aws-sdk/util-dynamodb');
const source = fs.readFileSync('backend/src/handlers/websocket-connections.js', 'utf8');
const env = {CENTRAL_PLATFORM_USER_POOL_ID:'us-east-1_Cp9YnOQWi', CENTRAL_PLATFORM_CLIENT_ID:'central-test-client', MERCHANTS_USER_POOL_ID:'us-east-1_gtCR3ndzT', MERCHANTS_CLIENT_ID:'4qabvh11nmghmf9fmc6e6ludd2', DRIVERS_USER_POOL_ID:'us-east-1_Mnrmklxro', DRIVERS_CLIENT_ID:'driver-test-client',WEBSOCKET_CONNECTIONS_TABLE: 'connections', CHAT_SESSIONS_TABLE: 'sessions', CHAT_MESSAGES_TABLE: 'messages', SUPPORT_MESSAGE_RECEIPTS_TABLE: 'receipts', SUPPORT_ATTACHMENTS_TABLE: 'attachments', SUPPORT_BUSINESSES_TABLE: 'businesses', SUPPORT_MEMBERSHIPS_TABLE: 'memberships', SUPPORT_SETTINGS_TABLE: 'settings', SUPPORT_LIFECYCLE_TABLE: 'lifecycle', SUPPORT_CUSTOMER_ORDERS_TABLE: 'customerOrders', SUPPORT_CUSTOMER_PROFILES_TABLE: 'profiles'};
const claims = (sub, groups = []) => ({sub, exp: Math.floor(Date.now()/1000)+3600, 'cognito:groups': groups});
const trusted = (id, role, groups = role === 'agent' ? ['support_admin'] : []) =>
  ({connectionId: 'c1', ...access.principalFromClaims(claims(id, groups), role)});

function load({connection, session, failClose = false, recipients = [], business, membership, policy, locks = [], attachments = [], failPublish = false, order, profile, failQuery = false, failAfterCommit = false, closeBeforeCommit = false} = {}) {
  const records = new Map();
  if (order) records.set('customerOrders:ORDER#' + order.orderId + ':META', structuredClone(order));
  if (profile) records.set('profiles:' + profile.userId, structuredClone(profile));
  for (const row of attachments) records.set('attachments:' + row.attachmentId, structuredClone(row));
  if (connection) records.set('connections:c1', structuredClone(connection));
  if (session) records.set(`sessions:${session.sessionId}`, structuredClone(session));
  business = business || (session?.userType === 'merchant' ? {businessId: session.businessId || session.merchantId, ownerId: session.userId || session.merchantId, cognitoUserId: session.userId || session.merchantId} : null);
  if (business) records.set('businesses:' + business.businessId, structuredClone(business));
  if (membership) records.set('memberships:' + membership.pk + ':' + membership.sk, structuredClone(membership));
  if (policy) records.set('settings:' + policy.pk + ':' + policy.sk, structuredClone(policy));
  for (const pk of locks) records.set('lifecycle:' + pk + ':META', {pk, sk: 'META'});
  const commands = {}, writes = [], deliveries = [], logs = [], verified = [];
  for (const name of ['PutCommand','UpdateCommand','ScanCommand','DeleteCommand','GetCommand','QueryCommand','PostToConnectionCommand','TransactWriteCommand']) {
    commands[name] = class {constructor(input) {this.input = input; this.kind = name;}};
  }
  const messages = [], queries = [];
  const key = input => `${input.TableName}:${(input.Key?.PK ? input.Key.PK + ':' + input.Key.SK : null) || input.Key?.receiptId || input.Key?.messageKey || input.Key?.userId || input.Key?.attachmentId || input.Key?.connectionId || input.Key?.sessionId || input.Key?.businessId || (input.Key?.pk ? input.Key.pk + ':' + input.Key.sk : null) || input.Item?.connectionId || input.Item?.sessionId}`;
  const db = {async send(cmd) {
    const input = cmd.input;
    if (cmd.kind === 'TransactWriteCommand') {
      if (failPublish) throw Object.assign(Error('transaction rejected'), {name: 'TransactionCanceledException'});
      const staged = new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
      const newMessages = [];
      for (const operation of input.TransactItems) {
        if (operation.Put) {
          const put=operation.Put; marshall(put.Item);
          const storageKey=put.TableName+':'+(put.Item.receiptId || put.Item.messageKey);
          if (staged.has(storageKey)) throw Object.assign(Error('conditional put conflict'),{name:'TransactionCanceledException'});
          staged.set(storageKey,structuredClone(put.Item));
          if(put.TableName==='messages') newMessages.push(structuredClone(put.Item));
        } else if(operation.Update) {
          const update=operation.Update, row=staged.get(key(update)), values=update.ExpressionAttributeValues;
          if(update.TableName==='sessions') {
            if(!row || row.status==='closed' || closeBeforeCommit) throw Object.assign(Error('session closed'),{name:'TransactionCanceledException'});
            row.lastMessageAt=values[':now'];
            const counter=update.UpdateExpression.includes('ADD unreadAgent')?'unreadAgent':'unreadDriver';
            row[counter]=(row[counter]||0)+1;
          } else {
            if(!row || row.status!=='UPLOADED' || row.subjectId!==values[':sub'] || row.sessionId!==values[':sid'] || row.ttl<=values[':now']) throw Object.assign(Error('conditional attachment conflict'),{name:'TransactionCanceledException'});
            Object.assign(row,{status:'PUBLISHED',messageId:values[':mid'],messageKey:values[':key'],clientMessageId:values[':cid'],ttl:values[':ttl']});
          }
        } else throw Error('unsupported transaction operation');
      }
      records.clear(); for(const [k,v] of staged) records.set(k,v);
      messages.push(...newMessages); writes.push(cmd);
      if(failAfterCommit) {failAfterCommit=false;throw Error('response lost after committed transaction');}
      return {};
    }
    if (cmd.kind === 'GetCommand') return {Item: records.get(key(input))};
    if (cmd.kind === 'ScanCommand') return {Items: input.TableName === 'connections' ? recipients : [...records.entries()].filter(([k])=>k.startsWith('sessions:')).map(([,v])=>v)};
    if (cmd.kind === 'QueryCommand') { queries.push(input); if(failQuery) throw Error('query unavailable'); return {Items: messages.filter(m=>m.sessionId === input.ExpressionAttributeValues[':sid'])}; }
    if (cmd.kind === 'PutCommand') {
      marshall(input.Item); // Match DynamoDB's rejection of undefined fields, including nested values.
      if (input.ConditionExpression && records.has(key(input))) throw Error('ConditionalCheckFailedException');
      writes.push(cmd);
      if (input.TableName === 'messages') messages.push(structuredClone(input.Item));
      else records.set(key(input), structuredClone(input.Item));
      return {};
    }
    if (cmd.kind === 'UpdateCommand') {
      if (failClose && input.ExpressionAttributeValues?.[':status'] === 'closed') throw Error('close write rejected');
      writes.push(cmd);
      const row = records.get(key(input));
      if (row && input.ExpressionAttributeValues?.[':sid']) row.sessionId = input.ExpressionAttributeValues[':sid'];
      if (row && input.ExpressionAttributeValues?.[':status'] === 'closed') row.status = 'closed';
      return {};
    }
    writes.push(cmd); return {};
  }};
  const sandbox = {module: {exports: {}}, process: {env},
    console: Object.fromEntries(['log','error','warn'].map(k=>[k, (...args)=>logs.push(args.join(' '))])),
    require(name) {
      if (name === 'node:crypto') return require('node:crypto');
      if (name === '../utils/support-access') return access;
      if (name === '../utils/support-customer-order-access') {
        const module = {exports: {}};
        vm.runInNewContext(fs.readFileSync('backend/src/utils/support-customer-order-access.js','utf8'), {module, require: () => commands});
        return module.exports;
      }
      if (name === '../utils/support-attachments') {
        const module = {exports: {}};
        vm.runInNewContext(fs.readFileSync('backend/src/utils/support-attachments.js','utf8'), {module, Buffer, require: n => n === 'node:crypto' ? require(n) : commands});
        return module.exports;
      }
      if (name === '../utils/support-merchant-access') {
        const module = {exports: {}};
        vm.runInNewContext(fs.readFileSync('backend/src/utils/support-merchant-access.js', 'utf8'), {module, require: () => commands});
        return module.exports;
      }
      if (name === '@aws-sdk/client-dynamodb') return {DynamoDBClient: class {}};
      if (name === '@aws-sdk/lib-dynamodb') return {...commands, DynamoDBDocumentClient: {from: ()=>db}};
      if (name === '@aws-sdk/client-apigatewaymanagementapi') return {PostToConnectionCommand: commands.PostToConnectionCommand,
        ApiGatewayManagementApiClient: class {async send(cmd) { deliveries.push({connectionId: cmd.input.ConnectionId, ...JSON.parse(cmd.input.Data)}); }}};
      if (name === 'aws-jwt-verify') return {CognitoJwtVerifier: {create: config=>({async verify(token) {
        verified.push(config);
        if (token === 'driver-access' && config.tokenUse === 'access' && config.userPoolId === 'us-east-1_Mnrmklxro') return claims('driver-1');
        if (token === 'driver' && config.tokenUse === 'id' && config.userPoolId === 'us-east-1_Mnrmklxro') return claims('driver-1');
        if (token === 'merchant' && config.tokenUse === 'id' && config.userPoolId === 'us-east-1_gtCR3ndzT') return claims('merchant-1');
        if (token === 'central-no-role' && config.userPoolId === 'us-east-1_Cp9YnOQWi') return claims('staff-1');
        if (token === 'support' && config.userPoolId === 'us-east-1_Cp9YnOQWi') return claims('staff-1', ['support_admin']);
        throw Error('Invalid signature or token type');
      }})}};
      throw Error(`Unexpected import: ${name}`);
    }
  };
  vm.runInNewContext(source, sandbox);
  const invoke = (message, routeKey = '$default', extra = {}) => sandbox.module.exports.handler({
    requestContext: {connectionId: 'c1', apiId: 'local', stage: 'staging', routeKey},
    ...(message ? {body: typeof message === 'string' ? message : JSON.stringify(message)} : {}), ...extra
  });
  return {invoke, writes, deliveries, records, messages, logs, verified, queries};
}

for (const params of [
  {userType: 'support'}, {userType: 'driver'}, {userType: 'support', token: 'browser_agent_fake'},
  {userType: 'support', token: 'driver'}, {userType: 'support', token: 'central-no-role'},
  {userType: 'unknown', token: 'support'}
]) test(`connect rejects untrusted identity ${JSON.stringify(params)}`, async()=>{
  const h = load();
  const res = await h.invoke(null, '$connect', {queryStringParameters: params});
  assert.equal(res.statusCode, 401);
  assert.equal(h.writes.length, 0);
  assert.equal(h.deliveries.length, 0);
});

test('verified support identity ignores forged query agentId and logs no credentials', async()=>{
  const h = load();
  const res = await h.invoke(null, '$connect', {queryStringParameters: {userType: 'support', token: 'support', agentId: 'forged'}});
  assert.equal(res.statusCode, 200);
  assert.equal(h.records.get('connections:c1').userId, 'staff-1');
  assert.equal(h.records.get('connections:c1').authVersion, 2);
  assert.equal(h.records.get('connections:c1').token, undefined);
  assert.ok(!h.logs.some(line=>line.includes('token:') || line.includes('browser_agent_')));
});

test('native driver header access token is verified against the driver pool', async()=>{
  const h = load();
  assert.equal((await h.invoke(null, '$connect', {headers: {Authorization: 'Bearer driver-access'}})).statusCode, 200);
  assert.equal(h.records.get('connections:c1').userId, 'driver-1');
  assert.equal(h.verified.at(-1).tokenUse, 'access');
});

for (const connection of [
  {authenticated: true, userId: 'legacy', userType: 'agent'},
  {...trusted('driver-1','driver'), authExpiresAt: 1}
]) test('old or expired authentication cannot read sessions', async()=>{
  const h = load({connection});
  assert.equal((await h.invoke({type: 'sync_sessions'})).statusCode, 401);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.deliveries.map(d=>d.type), ['error']);
});

for (const type of ['chat_agent_connect','sync_sessions','join_channel']) test(`driver cannot escalate using ${type}`, async()=>{
  const h = load({connection: trusted('driver-1','driver')});
  assert.equal((await h.invoke({type, sessionId: 's1', agentId: 'staff-1'})).statusCode, 403);
  assert.equal(h.writes.length, 0);
});

for (const type of ['get_session_messages','chat_message','chat_typing','chat_session_close','chat_driver_connect']) {
  test(`foreign session is inaccessible through ${type}`, async()=>{
    const h = load({connection: trusted('driver-1','driver'), session: {sessionId: 's1', driverId: 'other-driver', userType: 'driver', status: 'active'}});
    assert.equal((await h.invoke({type, sessionId: 's1', messageText: 'hello'})).statusCode, 403);
    assert.equal(h.writes.length, 0);
    assert.equal(h.deliveries.some(d=>d.type !== 'error'), false);
  });
}

test('participant cannot forge senderType on its own session', async()=>{
  const h = load({connection: trusted('driver-1','driver'), session: {sessionId: 's1', driverId: 'driver-1', userType: 'driver', status: 'active'}});
  assert.equal((await h.invoke({type: 'chat_message', sessionId: 's1', senderType: 'agent', messageText: 'forged'})).statusCode, 403);
  assert.equal(h.writes.length, 0);
});

test('owner message is saved, correlated, and delivered only to authorized recipients', async()=>{
  const h = load({connection: trusted('merchant-1','merchant'), session: {sessionId: 's1', merchantId: 'merchant-1', userType: 'merchant', status: 'active'},
    recipients: [
      {...trusted('staff-1','agent'), connectionId: 'staff'},
      {...trusted('merchant-1','merchant'), connectionId: 'owner', sessionId: 's1'},
      {...trusted('intruder','merchant'), connectionId: 'intruder', sessionId: 's1'},
      {connectionId: 'legacy', authenticated: true, userType: 'agent'},
      {...trusted('expired','agent'), connectionId: 'expired', authExpiresAt: 1}
    ]});
  assert.equal((await h.invoke({type: 'chat_message', sessionId: 's1', messageText: 'private text', clientMessageId: 'reply-1'})).statusCode, 200);
  assert.equal(h.messages[0].senderType, 'merchant');
  assert.equal(h.messages[0].metadata.clientMessageId, 'reply-1');
  assert.deepEqual(h.deliveries.filter(d=>d.type==='chat_message').map(d=>d.connectionId).sort(), ['owner','staff']);
  assert.equal(h.deliveries.find(d=>d.type==='message_ack').clientMessageId, 'reply-1');
  assert.equal(h.deliveries.find(d=>d.type==='chat_message').message.clientMessageId, 'reply-1');
  assert.ok(!h.logs.some(line=>line.includes('private text')));
});

test('reconnecting preserves status, timestamps, auth and avoids a repeated new-session notification', async()=>{
  const session = {sessionId: 's1', merchantId: 'merchant-1', userType: 'merchant', status: 'active', createdAt: 'original'};
  const h = load({connection: trusted('merchant-1','merchant'), session});
  assert.equal((await h.invoke({type: 'chat_merchant_connect', sessionId: 's1', merchantId: 'merchant-1', merchantName: 'merchant'})).statusCode, 200);
  assert.deepEqual(h.records.get('sessions:s1'), session);
  assert.equal(h.records.get('connections:c1').authSubject, 'merchant-1');
  assert.equal(h.deliveries.some(d=>d.type==='new_chat_session'), false);
});

test('failed close never emits a final session_closed event', async()=>{
  const h = load({connection: trusted('staff-1','agent'), session: {sessionId: 's1', userId: 'driver-1', userType: 'driver', status: 'active'}, failClose: true});
  assert.equal((await h.invoke({type: 'chat_session_close', sessionId: 's1', closedByUserId: 'forged'})).statusCode, 500);
  assert.equal(h.deliveries.some(d=>d.type==='session_closed'), false);
  assert.equal(h.records.get('sessions:s1').status, 'active');
});

test('support join uses authorized history route', async()=>{
  const h = load({connection: trusted('staff-1','agent'), session: {sessionId: 's1', userId: 'driver-1', userType: 'driver'}});
  assert.equal((await h.invoke({type: 'join_channel', sessionId: 's1'})).statusCode, 200);
  assert.equal(h.records.get('connections:c1').sessionId, 's1');
  assert.equal(h.deliveries.at(-1).type, 'session_messages');
});

test('authenticate cannot switch identity or elevate a participant to support', async()=>{
  const h = load({connection: trusted('driver-1','driver')});
  assert.equal((await h.invoke({type: 'authenticate', userType: 'support', userId: 'staff-1', token: 'support'})).statusCode, 403);
  assert.equal(h.writes.length, 0);
  assert.equal(h.records.get('connections:c1').userType, 'driver');
});

const branch = {businessId: 'branch-42', ownerId: 'merchant-1', cognitoUserId: 'merchant-1', businessName: 'Verified business', status: 'approved'};
const manager = {pk: 'BRANCH#branch-42', sk: 'MEMBER#manager-1', businessId: 'branch-42',
  subjectId: 'manager-1', ownerId: 'merchant-1', role: 'BRANCH_MANAGER', status: 'ACTIVE', version: 1,
  permissionSchema: 2, grant: {roleId: 'BRANCH_MANAGER', branchIds: ['branch-42'], permissions: ['branch.read']}};
const policy = {pk: 'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS', sk: 'CURRENT', enabledPermissions: ['branch.read']};

test('merchant branch handshake binds verified subject separately from business ID', async()=>{
  const h = load({connection: trusted('merchant-1','merchant'), business: branch});
  const result = await h.invoke({type: 'chat_merchant_connect', businessId: 'branch-42', merchantId: 'branch-42', merchantName: 'forged name', sessionId: 'new-branch-session'});
  assert.equal(result.statusCode, 200);
  const session = h.records.get('sessions:new-branch-session');
  assert.equal(session.userId, 'merchant-1');
  assert.equal(session.merchantId, 'branch-42');
  assert.equal(session.businessId, 'branch-42');
  assert.equal(session.merchantName, 'Verified business');
  assert.equal(h.records.get('connections:c1').userId, 'merchant-1');
  assert.equal(h.records.get('connections:c1').businessId, 'branch-42');
});

for (const changed of [
  {ownerId: 'someone-else', cognitoUserId: 'someone-else'},
  {cognitoUserId: 'wrong-owner'}, {isDeleted: true}, {deletionRequestId: 'deleting'}, {lifecycleStatus: 'CLOSING'}
]) test(`invalid branch access rejects handshake before writes: ${JSON.stringify(changed)}`, async()=>{
  const h = load({connection: trusted('merchant-1','merchant'), business: {...branch, ...changed}});
  assert.equal((await h.invoke({type: 'chat_merchant_connect', businessId: 'branch-42', sessionId: 'new'})).statusCode, 403);
  assert.equal(h.writes.length, 0);
});

test('authorized branch manager can start a private support session', async()=>{
  const h = load({connection: trusted('manager-1','merchant'), business: branch, membership: manager, policy});
  assert.equal((await h.invoke({type: 'chat_merchant_connect', businessId: 'branch-42', sessionId: 'manager-session'})).statusCode, 200);
  assert.equal(h.records.get('sessions:manager-session').userId, 'manager-1');
  assert.equal(h.records.get('sessions:manager-session').businessId, 'branch-42');
});

for (const changed of [
  {status: 'REVOKED'}, {deletionRequestId: 'removing-member'}, {ownerId: 'old-owner'}, {version: 0},
  {grant: {...manager.grant, branchIds: ['other-branch']}},
  {grant: {...manager.grant, permissions: []}}
]) test(`manager authorization rejects stale or out-of-scope grant: ${JSON.stringify(changed)}`, async()=>{
  const h = load({connection: trusted('manager-1','merchant'), business: branch, membership: {...manager, ...changed}, policy});
  assert.equal((await h.invoke({type: 'chat_merchant_connect', businessId: 'branch-42', sessionId: 'new'})).statusCode, 403);
  assert.equal(h.writes.length, 0);
});

test('disabled branch.read permission blocks a manager even with an active membership', async()=>{
  const h = load({connection: trusted('manager-1','merchant'), business: branch, membership: manager, policy: {...policy, enabledPermissions: []}});
  assert.equal((await h.invoke({type: 'chat_merchant_connect', businessId: 'branch-42', sessionId: 'new'})).statusCode, 403);
  assert.equal(h.writes.length, 0);
});

test('membership is rechecked on each history request after revocation', async()=>{
  const h = load({connection: trusted('manager-1','merchant'), business: branch, membership: manager, policy,
    session: {sessionId: 's1', userId: 'manager-1', merchantId: 'branch-42', businessId: 'branch-42', userType: 'merchant', status: 'active'}});
  assert.equal((await h.invoke({type: 'get_session_messages', sessionId: 's1'})).statusCode, 200);
  h.records.get('memberships:BRANCH#branch-42:MEMBER#manager-1').status = 'REVOKED';
  h.deliveries.length = 0;
  assert.equal((await h.invoke({type: 'get_session_messages', sessionId: 's1'})).statusCode, 403);
  assert.equal(h.deliveries.some(m=>m.type === 'session_messages'), false);
});

test('revoked manager does not receive new broadcasts from support', async()=>{
  const h = load({connection: trusted('staff-1','agent'), business: branch, membership: {...manager, status: 'REVOKED'}, policy,
    session: {sessionId: 's1', userId: 'manager-1', merchantId: 'branch-42', businessId: 'branch-42', userType: 'merchant', status: 'active'},
    recipients: [{...trusted('manager-1','merchant'), connectionId: 'manager-socket', sessionId: 's1'}, {...trusted('staff-1','agent'), connectionId: 'staff'}]});
  assert.equal((await h.invoke({type: 'chat_message', sessionId: 's1', messageText: 'private reply'})).statusCode, 200);
  assert.deepEqual(h.deliveries.filter(m=>m.type==='chat_message').map(m=>m.connectionId), ['staff']);
});

test('owner can contact support while suspended but cannot bypass an account lifecycle lock', async()=>{
  const h = load({connection: trusted('merchant-1','merchant'), business: {...branch, status: 'suspended'}});
  assert.equal((await h.invoke({type: 'chat_merchant_connect', businessId: 'branch-42', sessionId: 'support-suspended'})).statusCode, 200);
  const locked = load({connection: trusted('merchant-1','merchant'), business: branch, locks: ['ACCOUNT_LIFECYCLE#MERCHANT#merchant-1']});
  assert.equal((await locked.invoke({type: 'chat_merchant_connect', businessId: 'branch-42', sessionId: 'new'})).statusCode, 403);
  assert.equal(locked.writes.length, 0);
});

test('matching business ownership alone cannot take over another staff member conversation', async()=>{
  const h = load({connection: trusted('merchant-1','merchant'), business: branch,
    session: {sessionId: 'manager-session', userId: 'manager-1', businessId: 'branch-42', merchantId: 'branch-42', userType: 'merchant'}});
  assert.equal((await h.invoke({type: 'get_session_messages', sessionId: 'manager-session'})).statusCode, 403);
  assert.equal(h.writes.length, 0);
});


test('a malformed string permission list cannot grant manager access', async()=>{
  const h = load({connection: trusted('manager-1','merchant'), business: branch, membership: manager,
    policy: {...policy, enabledPermissions: 'not_branch.read'}});
  assert.equal((await h.invoke({type: 'chat_merchant_connect', businessId: 'branch-42', sessionId: 'new'})).statusCode, 403);
  assert.equal(h.writes.length, 0);
});

const upload = {attachmentId: '11111111-1111-4111-8111-111111111111', sessionId: 's1', subjectId: 'merchant-1', userType: 'merchant', status: 'UPLOADED', ttl: Math.floor(Date.now()/1000)+3600, contentType: 'image/png', size: 100};
const merchantSession = {sessionId: 's1', userId: 'merchant-1', merchantId: 'merchant-1', userType: 'merchant', status: 'active'};
test('image reference and message are published atomically and retries acknowledge the same message', async()=>{
  const h = load({connection: trusted('merchant-1','merchant'), session: merchantSession, attachments: [upload]});
  const message = {type: 'chat_message', sessionId: 's1', messageText: 'image caption', clientMessageId: 'image-client-1', attachmentId: upload.attachmentId};
  assert.equal((await h.invoke(message)).statusCode, 200);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].attachment.attachmentId, upload.attachmentId);
  assert.equal(h.records.get('attachments:' + upload.attachmentId).status, 'PUBLISHED');
  assert.equal((await h.invoke(message)).statusCode, 200);
  assert.equal(h.messages.length, 1);
  assert.equal(h.deliveries.filter(d=>d.type==='message_ack').at(-1).messageId, h.messages[0].messageId);
});
for (const changed of [{subjectId:'other'}, {sessionId:'other'}, {status:'PENDING'}, {ttl:1}]) test('invalid attachment reference cannot be published: '+JSON.stringify(changed), async()=>{
  const h = load({connection: trusted('merchant-1','merchant'), session: merchantSession, attachments: [{...upload,...changed}]});
  assert.ok((await h.invoke({type:'chat_message',sessionId:'s1',messageText:'image',clientMessageId:'c1',attachmentId:upload.attachmentId})).statusCode >= 400);
  assert.equal(h.messages.length, 0);
});
test('failed image transaction emits no acknowledgement or image message', async()=>{
  const h = load({connection: trusted('merchant-1','merchant'), session: merchantSession, attachments: [upload], failPublish:true});
  await h.invoke({type:'chat_message',sessionId:'s1',messageText:'image',clientMessageId:'c1',attachmentId:upload.attachmentId});
  assert.equal(h.messages.length, 0);
  assert.equal(h.deliveries.some(d=>d.type==='message_ack'||d.type==='chat_message'), false);
  assert.equal(h.records.get('attachments:'+upload.attachmentId).status,'UPLOADED');
});
test('external image URLs cannot bypass protected attachments', async()=>{
  const h = load({connection: trusted('merchant-1','merchant'), session: merchantSession});
  assert.equal((await h.invoke({type:'chat_message',sessionId:'s1',messageText:'image',imageUrl:'https://external.invalid/private.png'})).statusCode,400);
  assert.equal(h.messages.length,0);
});

test('customer creates a session bound to verified identity and reconnect preserves it', async () => {
 const h = load({connection: trusted('customer-1','customer')});
 const message = {action:'chat_customer_connect',sessionId:'customer-session',customerName:'زبون'};
 assert.equal((await h.invoke(message)).statusCode,200);
 const row = h.records.get('sessions:customer-session');
 assert.equal(row.userType,'customer');
 assert.equal(row.customerId,'customer-1');
 assert.equal(row.userId,'customer-1');
 assert.equal(row.source,'wizzuser_app');
 assert.equal((await h.invoke(message)).statusCode,200);
 assert.equal(h.writes.filter(w=>w.kind==='PutCommand' && w.input.TableName==='sessions').length,1);
});
for (const role of ['driver','merchant']) test(role+' cannot create customer sessions', async () => {
 const h = load({connection:trusted('account-1',role)});
 assert.equal((await h.invoke({action:'chat_customer_connect',sessionId:'customer-session'})).statusCode,403);
 assert.equal(h.records.has('sessions:customer-session'),false);
});
test('customer cannot claim another customer identity or session', async () => {
 const h = load({connection:trusted('customer-1','customer'),session:{sessionId:'s1',userType:'customer',userId:'other',status:'active'}});
 assert.equal((await h.invoke({action:'chat_customer_connect',sessionId:'new',customerId:'other'})).statusCode,403);
 assert.equal((await h.invoke({action:'chat_customer_connect',sessionId:'s1'})).statusCode,403);
});

const customerOrder = {orderId:'order-42',userId:'profile-1',userSub:'customer-1',status:'delivered'};
const customerProfile = {userId:'profile-1',cognitoSub:'customer-1',isActive:true};
test('customer order context is bound only after authoritative ownership reads', async () => {
 const h=load({connection:trusted('customer-1','customer'),order:customerOrder,profile:customerProfile});
 assert.equal((await h.invoke({action:'chat_customer_connect',sessionId:'order-chat',orderId:'order-42'})).statusCode,200);
 assert.equal(h.records.get('sessions:order-chat').orderId,'order-42');
 h.records.get('customerOrders:ORDER#order-42:META').userSub='other';
 assert.equal((await h.invoke({action:'chat_message',sessionId:'order-chat',messageText:'test',clientMessageId:'c1'})).statusCode,403);
 assert.equal(h.messages.length,0);
});
for(const change of [{userSub:'other'}, {isGuestOrder:true}, {deletedAt:'2026-10-23'}, {userId:'missing'}]) test('invalid order context is rejected '+JSON.stringify(change),async()=>{
 const h=load({connection:trusted('customer-1','customer'),order:{...customerOrder,...change},profile:customerProfile});
 assert.equal((await h.invoke({action:'chat_customer_connect',sessionId:'order-chat',orderId:'order-42'})).statusCode,403);
 assert.equal(h.records.has('sessions:order-chat'),false);
});
test('an existing general conversation cannot be silently reassigned to an order',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:{sessionId:'s1',userType:'customer',userId:'customer-1',status:'active'},order:customerOrder,profile:customerProfile});
 assert.equal((await h.invoke({action:'chat_customer_connect',sessionId:'s1',orderId:'order-42'})).statusCode,403);
});

test('revoked order ownership blocks customer broadcasts while agent can save reply', async () => {
 const customer={...trusted('customer-1','customer'),connectionId:'customer-conn',sessionId:'s1'};
 const h=load({connection:trusted('staff-1','agent'),session:{sessionId:'s1',userType:'customer',userId:'customer-1',orderId:'order-42',status:'active'},order:{...customerOrder,userSub:'other'},profile:customerProfile,recipients:[customer]});
 assert.equal((await h.invoke({action:'chat_message',sessionId:'s1',messageText:'reply',clientMessageId:'agent-1'})).statusCode,200);
 assert.equal(h.messages.length,1);
 assert.equal(h.deliveries.filter(d=>d.connectionId==='customer-conn').length,0);
});
for (const profile of [{...customerProfile,isActive:false},{...customerProfile,cognitoSub:'other'},{...customerProfile,deletionRequestId:'delete-1'}]) test('invalid customer profile blocks order-linked support '+JSON.stringify(profile),async()=>{
 const h=load({connection:trusted('customer-1','customer'),order:customerOrder,profile});
 assert.equal((await h.invoke({action:'chat_customer_connect',sessionId:'order-chat',orderId:'order-42'})).statusCode,403);
});

test('history cursor stays in authorized session and response echoes request identity',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:{sessionId:'s1',userType:'customer',userId:'customer-1',status:'active'}});
 assert.equal((await h.invoke({action:'get_session_messages',sessionId:'s1',cursor:'old-key',limit:999,requestId:'history-1'})).statusCode,200);
 assert.equal(h.queries[0].ExclusiveStartKey.sessionId,'s1');
 assert.equal(h.queries[0].ExclusiveStartKey.messageKey,'old-key');
 assert.equal(h.queries[0].Limit,100);
 assert.equal(h.deliveries.find(d=>d.type==='session_messages').requestId,'history-1');
});
test('history query failure returns a correlated recoverable error',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:{sessionId:'s1',userType:'customer',userId:'customer-1',status:'active'},failQuery:true});
 await h.invoke({action:'get_session_messages',sessionId:'s1',requestId:'history-1'});
 assert.equal(h.deliveries.find(d=>d.type==='history_error').requestId,'history-1');
 assert.equal(h.deliveries.some(d=>d.type==='error'),false);
});
for(const cursor of [{sessionId:'other'},'x'.repeat(501),'']) test('malformed history cursor is rejected '+typeof cursor,async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:{sessionId:'s1',userType:'customer',userId:'customer-1',status:'active'}});
 assert.equal((await h.invoke({action:'get_session_messages',sessionId:'s1',cursor})).statusCode,400); assert.equal(h.queries.length,0);
});

const customerSessionForReceipts = {sessionId:'s1',userType:'customer',userId:'customer-1',status:'active'};
const textFrame = {action:'chat_message',sessionId:'s1',messageText:'one saved message',clientMessageId:'text-id-1'};
test('repeated text ID acknowledges original message and increments unread only once',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:customerSessionForReceipts});
 await h.invoke(textFrame); await h.invoke(textFrame);
 assert.equal(h.messages.length,1); assert.equal(h.records.get('sessions:s1').unreadAgent,1);
 const acks=h.deliveries.filter(d=>d.type==='message_ack'); assert.equal(acks.length,2); assert.equal(acks[0].messageId,acks[1].messageId);
});
test('concurrent copies commit one message and resolve the loser through the receipt',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:customerSessionForReceipts});
 const results=await Promise.all([h.invoke(textFrame),h.invoke(textFrame)]);
 assert.ok(results.every(r=>r.statusCode===200)); assert.equal(h.messages.length,1);
 assert.equal(h.records.get('sessions:s1').unreadAgent,1);
 assert.equal(h.deliveries.filter(d=>d.type==='message_ack').length,2);
});
test('message ID reused with changed text is rejected without a second save',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:customerSessionForReceipts});
 await h.invoke(textFrame);
 assert.equal((await h.invoke({...textFrame,messageText:'different'})).statusCode,409);
 assert.equal(h.messages.length,1); assert.equal(h.records.get('sessions:s1').unreadAgent,1);
});
test('uncertain committed transaction is acknowledged using a consistent receipt read',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:customerSessionForReceipts,failAfterCommit:true});
 assert.equal((await h.invoke(textFrame)).statusCode,200); assert.equal(h.messages.length,1);
 assert.equal(h.deliveries.filter(d=>d.type==='message_ack').length,1);
});
test('session closure during commit prevents message, receipt and unread changes',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:customerSessionForReceipts,closeBeforeCommit:true});
 await h.invoke(textFrame);
 assert.equal(h.messages.length,0); assert.equal([...h.records.keys()].some(k=>k.startsWith('receipts:')),false);
 assert.equal(h.records.get('sessions:s1').unreadAgent,undefined);
 assert.equal(h.deliveries.some(d=>d.type==='message_ack'),false);
});
test('same client ID is scoped to the verified sender',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:customerSessionForReceipts});
 await h.invoke(textFrame); h.records.set('connections:c1',trusted('staff-1','agent'));
 await h.invoke({...textFrame,messageText:'agent reply'});
 assert.equal(h.messages.length,2); assert.equal(h.records.get('sessions:s1').unreadDriver,1);
});
test('image publication retry also enforces immutable text and receipt identity',async()=>{
 const h=load({connection:trusted('merchant-1','merchant'),session:merchantSession,attachments:[upload]});
 const frame={action:'chat_message',sessionId:'s1',messageText:'caption',clientMessageId:'image-id',attachmentId:upload.attachmentId};
 await h.invoke(frame); await h.invoke(frame);
 assert.equal(h.messages.length,1); assert.equal(h.records.get('sessions:s1').unreadAgent,1);
 assert.equal((await h.invoke({...frame,messageText:'changed caption'})).statusCode,409);
});
test('concurrent image publication saves one reference and both callers receive the saved ID',async()=>{
 const h=load({connection:trusted('merchant-1','merchant'),session:merchantSession,attachments:[upload]});
 const frame={action:'chat_message',sessionId:'s1',messageText:'caption',clientMessageId:'same-image',attachmentId:upload.attachmentId};
 const results=await Promise.all([h.invoke(frame),h.invoke(frame)]);
 assert.ok(results.every(r=>r.statusCode===200));assert.equal(h.messages.length,1);
 assert.equal(new Set(h.deliveries.filter(d=>d.type==='message_ack').map(d=>d.messageId)).size,1);
});

test('expired receipt cannot acknowledge or create a duplicate message',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:customerSessionForReceipts});
 await h.invoke(textFrame);
 const receipt=[...h.records.entries()].find(([k])=>k.startsWith('receipts:'))[1]; receipt.ttl=1;
 assert.equal((await h.invoke(textFrame)).statusCode,409); assert.equal(h.messages.length,1);
 assert.equal(h.deliveries.filter(d=>d.type==='message_ack').length,1);
});
test('corrupted receipt cannot emit an acknowledgement without saved message identity',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:customerSessionForReceipts});
 await h.invoke(textFrame);
 const receipt=[...h.records.entries()].find(([k])=>k.startsWith('receipts:'))[1]; delete receipt.messageId;
 assert.equal((await h.invoke(textFrame)).statusCode,503); assert.equal(h.messages.length,1);
 assert.equal(h.deliveries.filter(d=>d.type==='message_ack').length,1);
});
test('same client message ID in two owned sessions remains independent',async()=>{
 const h=load({connection:trusted('customer-1','customer'),session:customerSessionForReceipts});
 h.records.set('sessions:s2',{...customerSessionForReceipts,sessionId:'s2'});
 await h.invoke(textFrame); await h.invoke({...textFrame,sessionId:'s2'});
 assert.equal(h.messages.length,2);
 assert.equal([...h.records.keys()].filter(k=>k.startsWith('receipts:')).length,2);
});

test('driver handshake binds verified subject without a caller profile ID', async () => {
 const h=load({connection:trusted('driver-1','driver')});
 assert.equal((await h.invoke({action:'chat_driver_connect',sessionId:'driver-chat',driverName:'  عبدالله  '})).statusCode,200);
 const row=h.records.get('sessions:driver-chat');
 assert.equal(row.driverId,'driver-1');assert.equal(row.userId,'driver-1');assert.equal(row.driverName,'عبدالله');
 assert.equal(h.deliveries.find(d=>d.type==='chat_session_created').sessionId,'driver-chat');
});
test('driver display metadata cannot inject objects into the support inbox', async () => {
 const h=load({connection:trusted('driver-1','driver')});
 assert.equal((await h.invoke({action:'chat_driver_connect',sessionId:'driver-chat',driverName:{malformed:true},driverPhone:['unexpected']})).statusCode,200);
 const row=h.records.get('sessions:driver-chat');assert.equal(row.driverName,'سائق');assert.equal(row.driverPhone,'');
});
