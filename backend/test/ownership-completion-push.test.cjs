'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {send}=require('../src/utils/ownership-invitation-push');
const requestId='12345678-1234-1234-1234-123456789abc';
const event={action:'ownership_completed',organizationId:'test-org',requestId};

function fixture(completed=true){
 const messages=[];
 const db={async send({input}){
  if(input.TableName==='staging-MerchantPlatform'){
   assert.equal(input.Key.sk,'OWNERSHIP_TRANSFER_AUDIT#'+requestId);
   return completed?{Item:{
    kind:'OWNERSHIP_TRANSFER_COMPLETED',organizationId:event.organizationId,requestId,
    previousOwnerId:'previous',newOwnerId:'new',
   }}:{};
  }
  if(input.TableName==='staging-AccountDeletion')return {};
  if(input.IndexName)return {Items:[
   {token:'device-'+input.ExpressionAttributeValues[':sub']},{token:'wrong-account'},{token:'shared-device'},
  ]};
  const token=input.Key.token;
  return {Item:{app:'merchant',subjectId:token.replace('device-',''),branchDeviceId:token==='shared-device'?'shared':undefined}};
 }};
 const getMessaging=async()=>({sendEachForMulticast:async message=>{
  messages.push(message);
  return {successCount:1,responses:[{success:true}]};
 }});
 return {messages,run:audience=>send({...event,audience},{db,getMessaging,tokensTable:'test-tokens'})};
}

test('completed transfer targets each owner independently with their own message',async()=>{
 const {messages,run}=fixture();
 await run('previous');
 await run('new');
 assert.deepEqual(messages.map(message=>message.tokens),[['device-previous'],['device-new']]);
 assert.deepEqual(messages.map(message=>message.data),[
  {type:'ownership_completed_previous'},{type:'ownership_completed_new'},
 ]);
 assert.notEqual(messages[0].notification.body,messages[1].notification.body);
});

test('without a committed transfer audit no completion push is sent',async()=>{
 const {messages,run}=fixture(false);
 assert.deepEqual(await run('new'),{skipped:true});
 assert.equal(messages.length,0);
});

test('an acceptance notice reads the current request and targets its owner only',async()=>{
 const messages=[];
 let status='AWAITING_RECIPIENT';
 const db={async send({input}){
  if(input.TableName==='staging-MerchantPlatform'){
   assert.equal(input.Key.sk,'OWNERSHIP_TRANSFER');
   assert.match(input.ProjectionExpression,/ownerId/);
   return {Item:{requestId,ownerId:'owner',status,expiresAt:2000}};
  }
  if(input.TableName==='staging-AccountDeletion')return {};
  if(input.IndexName){
   assert.equal(input.ExpressionAttributeValues[':sub'],'owner');
   return {Items:[{token:'owner-device'},{token:'recipient-device'}]};
  }
  return {Item:{app:'merchant',subjectId:input.Key.token.split('-')[0]}};
 }};
 const deps={db,tokensTable:'tokens',clock:()=>1000,getMessaging:async()=>({
  async sendEachForMulticast(message){messages.push(message);return {successCount:1,responses:[{success:true}]};},
 })};
 const accepted={action:'ownership_accepted',organizationId:event.organizationId,requestId};
 assert.deepEqual(await send(accepted,deps),{skipped:true});
 status='AWAITING_REVIEW';
 assert.deepEqual(await send(accepted,deps),{delivered:1});
 assert.deepEqual(messages.map(message=>[message.tokens,message.data]),[[['owner-device'],{type:'ownership_accepted'}]]);
});
