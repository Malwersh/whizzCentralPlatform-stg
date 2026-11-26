'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createDriverDeletionWorker, disableDriverIdentity } = require('./driver-worker.cjs');
const { closeDriverWallet } = require('./customer-wallet.cjs');
const { identities } = require('../wallet-identity-bindings.json');
const subjectId = '12345678-0000-4000-8000-000000000071';
const requestId = '12345678-0000-4000-8000-000000000072';
const walletId = 'WALLET#DRIVER#' + subjectId;
const request = {
  actorType:'DRIVER', status:'PROCESSING', subjectId, requestId, scope:{kind:'ACCOUNT',id:subjectId},
  pk:'SUBJECT#DRIVER#'+subjectId, sk:'REQUEST#'+requestId, version:2, leaseOwner:'worker',
};
const job = {
  subjectId, requestId, profileIds:[subjectId], username:subjectId, pool:identities.driver.poolId, phone:'+9647800000000',
  wallets:[{walletId,source:'CORE'}],
};

test('identity closure first disables and signs out the actual driver subject and resumes sign-out if already disabled',async()=>{
  let enabled=true;
  const actions=[];
  const db={async send({input}) {
    assert.equal(input.TransactItems[1].ConditionCheck.Key.pk,'ACCOUNT_LIFECYCLE#DRIVER#'+subjectId);
    return {};
  }};
  const cognito={async send(command) {
    assert.deepEqual(command.input,{UserPoolId:identities.driver.poolId,Username:subjectId});
    const name=command.constructor.name;
    if(name==='AdminGetUserCommand') return {Username:subjectId,Enabled:enabled,UserStatus:'CONFIRMED',
      UserAttributes:[{Name:'sub',Value:subjectId},{Name:'phone_number',Value:job.phone},{Name:'phone_number_verified',Value:'true'}]};
    actions.push(name);
    if(name==='AdminDisableUserCommand') enabled=false;
    return {};
  }};
  await disableDriverIdentity({db,cognito,request,job});
  await disableDriverIdentity({db,cognito,request,job});
  assert.deepEqual(actions,['AdminDisableUserCommand','AdminUserGlobalSignOutCommand','AdminUserGlobalSignOutCommand']);
});

test('identity changes or an invalid lease prevent Cognito mutation',async()=>{
  let reads=0;
  const cognito={async send(command) {
    assert.equal(command.constructor.name,'AdminGetUserCommand');
    reads++;
    return {Username:subjectId,Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'foreign'}]};
  }};
  await assert.rejects(disableDriverIdentity({db:{send:async()=>({})},cognito,request,job}),{code:'DRIVER_IDENTITY_CHANGED'});
  assert.equal(reads,1);
  await assert.rejects(disableDriverIdentity({db:{send:async()=>{throw Error('lease lost');}},cognito,request,job}),/lease lost/);
  assert.equal(reads,1);
});

test('the production driver wallet closes only while its zero balances and owner still match',async()=>{
  let wallet={walletId,sk:'META',ownerId:subjectId,ownerType:'DRIVER',availableBalance:1,lockedBalance:0,
    currency:'IQD',deletionRequestId:requestId,version:3,status:'SUSPENDED'};
  const writes=[];
  const db={async send({input}) {
    if(input.TransactItems){writes.push(input.TransactItems);return {};}
    assert.equal(input.TableName,'wizz-production-Wallets');
    return {Item:wallet};
  }};
  const run=()=>closeDriverWallet({db,request,job});
  await assert.rejects(run(),{code:'WALLET_CLOSURE_BLOCKED'});
  assert.equal(writes.length,0);
  wallet={...wallet,availableBalance:0};
  await run();
  assert.equal(writes[0][1].ConditionCheck.Key.pk,'ACCOUNT_LIFECYCLE#DRIVER#'+subjectId);
  assert.equal(writes[0][2].Update.ExpressionAttributeValues[':closed'],'CLOSED');
});

test('the production driver worker stops before locking when cleanup adapters are incomplete',async()=>{
  const db={send:()=>assert.fail('no database operation is authorized')};
  const run=createDriverDeletionWorker({db,s3:{},verifiedMutationGuards:true});
  await assert.rejects(run(subjectId,requestId),{code:'WORKER_NOT_ENABLED'});
});
