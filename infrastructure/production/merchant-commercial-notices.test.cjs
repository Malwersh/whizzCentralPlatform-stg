'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHandler} = require('./merchant-commercial-notices.cjs');
const {identities} = require('./wallet-identity-bindings.json');
const {notice,outboxNotice,pendingStatus} = require('../../backend/staff-service/commercial-notices');

const account = '746727375268';
const region = 'us-east-1';
const stream = `arn:aws:dynamodb:${region}:${account}:table/wizz-production-WalletNotifications/stream/2026-11-25T12:00:00.000`;
const scheduled = {source:'aws.events',account,region,'detail-type':'Scheduled Event',
  resources:[`arn:aws:events:${region}:${account}:rule/wizz-production-merchant-commercial-notices`]};
const context = {getRemainingTimeInMillis:()=>55000};
const table = name => 'wizz-production-'+name;

function fixture() {
  let clock = Date.parse('2026-11-25T12:00:00.000Z'), failManager = false, consent = false;
  const draft = {pk:'DISCOUNT_FUNDING#share',id:'share',kind:'FUNDING',version:1,hash:'h',
    ownerId:'owner',organizationId:'org',businessIds:['branch'],createdAt:new Date(clock).toISOString(),
    values:{effectiveTo:'2026-12-02T00:00:00.000Z'}};
  const branch = {businessId:'branch',ownerId:'owner',cognitoUserId:'owner',organizationId:'org',status:'approved'};
  const membership = {pk:'BRANCH#branch',sk:'MEMBER#manager',ownerId:'owner',
    businessId:'branch',subjectId:'manager',role:'BRANCH_MANAGER',permissionSchema:2,version:1,status:'ACTIVE',
    grant:{roleId:'BRANCH_MANAGER',branchIds:['branch'],permissions:['branch.read']}};
  const policy = {version:1,enabledPermissions:['branch.read']};
  const registration = (token,subjectId,fields={})=>({token,subjectId,app:'merchant',
    env:'production',ttl:Math.floor(clock/1000)+3600,...fields});
  const devices = [
    registration('owner-phone','owner'), registration('manager-phone','manager'),
    registration('BRANCH_DEVICE#tablet','owner',{branchDeviceId:'tablet'}),
    registration('foreign-app','owner',{app:'user'}), registration('old-phone','owner',{ttl:0}),
    registration('staging-phone','owner',{env:'staging'}), registration('disabled-phone','owner',{disabled:true}),
    registration('moved-phone','owner'),
  ];
  const live = new Map(devices.map(row=>[row.token,{...row}]));
  live.get('moved-phone').subjectId='someone-else';
  const messages=[], commands=[], row = outboxNotice(draft,table('WalletNotifications')).Put.Item;
  const event = {Records:[{eventSource:'aws:dynamodb',eventSourceARN:stream,eventName:'INSERT',
    dynamodb:{SequenceNumber:'1',Keys:{eventId:{S:row.eventId}}}}]};
  const db = {async send(command) {
    const x=command.input, values=x.ExpressionAttributeValues;
    assert.ok(x.TableName.startsWith('wizz-production-'));
    commands.push(command);
    if (command.constructor.name==='UpdateCommand') {
      assert.equal(x.TableName,table('WalletNotifications'));
      assert.equal(x.Key.eventId,row.eventId);
      if (x.ReturnValues) {
        if (row.deliveryStatus!==values[':pending']||row.nextAttemptAt>values[':now']||
            row.leaseUntil>values[':now']) throw Object.assign(Error(),{name:'ConditionalCheckFailedException'});
        row.leaseOwner=values[':owner'];row.leaseUntil=values[':until'];row.attempts++;
        return {Attributes:structuredClone(row)};
      }
      assert.equal(row.leaseOwner,values[':owner']);
      if (values[':hashes']) {
        row.deliveredAny=values[':delivered'];
        row.processedTokenHashes=new Set([...(row.processedTokenHashes??[]),...values[':hashes']]);
      } else {
        row.nextAttemptAt=values[':next'];row.deliveryStatus=values[':status'];
        row.ttl=values[':ttl'];delete row.leaseUntil;delete row.leaseOwner;
      }
      return {};
    }
    if (command.constructor.name==='QueryCommand'){
      if (x.TableName===table('WalletNotifications')) {
        assert.equal(x.IndexName,'PendingDelivery');
        assert.equal(values[':pending'],pendingStatus);
        return {Items:row.deliveryStatus===pendingStatus&&row.nextAttemptAt<=values[':now']?[{eventId:row.eventId}]:[]};
      }
      if (x.TableName===table('PushDeviceTokens')) {
        assert.equal(x.IndexName,'SubjectIdIndex');
        return {Items:devices.filter(device=>device.subjectId===values[':sub'])};
      }
      assert.equal(x.TableName,table('MerchantPlatform'));
      assert.equal(values[':pk'],'BRANCH#branch');
      return {Items:[membership]};
    }
    assert.equal(command.constructor.name,'GetCommand');
    assert.equal(x.ConsistentRead,true);
    if (x.TableName===table('Merchants')) return {Item:branch};
    if (x.TableName===table('PushDeviceTokens')) return {Item:live.get(x.Key.token)};
    if (x.TableName===table('MerchantPlatform')) return {Item:membership};
    if (x.TableName===table('AccountDeletion')) return {};
    assert.equal(x.TableName,table('PlatformStaff'));
    if (x.Key.sk==='CURRENT') return {Item:policy};
    if (x.Key.sk==='NOTICE#1') return {Item:notice(draft)};
    if (x.Key.sk==='DRAFT') return {Item:draft};
    return {Item:consent?{hash:draft.hash}:undefined};
  }};
  const handler = createHandler({db,stream,clock:()=>clock,cognito:{async send(command) {
    assert.equal(command.input.UserPoolId,identities.merchant.poolId);
    return {Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:command.input.Username}]};
  }},messaging:async()=>({async sendEachForMulticast(message) {
    messages.push(message);
    return {responses:message.tokens.map(token=>token==='manager-phone'&&failManager
      ? {success:false,error:{code:'messaging/server-unavailable'}} : {success:true})};
  }})});
  return {handler,event,row,messages,commands,branch,membership,policy,
    consent:()=>{consent=true;}, failManager:value=>{failManager=value;},
    retry:()=>{clock=(row.nextAttemptAt+1)*1000;}};
}

test('production invitation sends to the owner and authorized manager on personal devices only',async()=>{
  const f=fixture();
  assert.deepEqual(await f.handler(f.event,context),{batchItemFailures:[]});
  assert.equal(f.row.deliveryStatus,'SENT');
  assert.deepEqual(f.messages.map(m=>m.tokens),[['owner-phone'],['manager-phone']]);
  assert.deepEqual(f.messages.map(m=>m.data.subjectId),['owner','manager']);
  for (const message of f.messages) {
    assert.deepEqual(Object.keys(message.data).sort(),
      ['action','businessId','draftVersion','eventId','requestKind','sharingId','subjectId','type','updatedAt']);
    assert.equal(message.data.action,'commercial_sharing_requested');
    assert.equal(message.data.sharingId,'share');
  }
  await f.handler(f.event,context);
  assert.equal(f.messages.length,2);
});

test('scheduled recovery retries the failed recipient without resending to delivered recipients',async()=>{
  const f=fixture();
  f.failManager(true);
  await f.handler(f.event,context);
  assert.equal(f.row.deliveryStatus,pendingStatus);
  assert.equal(f.row.processedTokenHashes.size,1);
  await f.handler(scheduled,context);
  assert.equal(f.messages.length,2);
  f.retry();f.failManager(false);
  await f.handler(scheduled,context);
  assert.equal(f.row.deliveryStatus,'SENT');
  assert.deepEqual(f.messages.map(m=>m.tokens),[['owner-phone'],['manager-phone'],['manager-phone']]);
});

test('already accepted and transferred requests are suppressed and revoked managers receive nothing',async()=>{
  for (const change of [f=>f.consent(),f=>{f.branch.ownerId='new-owner';},f=>{f.branch.status='suspended';}]) {
    const f=fixture();change(f);
    await f.handler(f.event,context);
    assert.equal(f.messages.length,0);
    assert.equal(f.row.deliveryStatus,'SUPPRESSED');
  }
  for (const change of [f=>{f.membership.status='REVOKED';},f=>{f.policy.enabledPermissions=[];}]) {
    const f=fixture();change(f);
    await f.handler(f.event,context);
    assert.deepEqual(f.messages.map(m=>m.tokens),[['owner-phone']]);
  }
});

test('other accounts, unrelated events and stale stream images cannot reach invitation processing',async()=>{
  const f=fixture();
  await assert.rejects(f.handler({...scheduled,account:'699561669180'},context),/INVALID_COMMERCIAL_NOTICE_TRIGGER/);
  await assert.rejects(f.handler({httpMethod:'POST',action:'send'},context),/INVALID_COMMERCIAL_NOTICE_TRIGGER/);
  await f.handler({Records:[{...f.event.Records[0],eventName:'MODIFY'}]},context);
  await f.handler({Records:[{...f.event.Records[0],dynamodb:{SequenceNumber:'2',Keys:{eventId:{S:'MERCHANT_PAYOUT_NOTICE#other'}}}}]},context);
  assert.equal(f.commands.length,0);
});
