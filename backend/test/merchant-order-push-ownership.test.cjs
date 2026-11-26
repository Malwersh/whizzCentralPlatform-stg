'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {merchantOrderTargets}=require('../src/utils/branch-device-push');

test('order push after transfer falls back to the current owner, excluding previous registrations',async()=>{
 const previous={token:'previous',subjectId:'old-owner',app:'merchant',businessId:'branch'};
 const paired={token:'BRANCH_DEVICE#device',subjectId:'BRANCH_DEVICE#device',app:'merchant',businessId:'branch',branchDeviceId:'device'};
 const current={token:'current',subjectId:'new-owner',app:'merchant'};
 const reassigned={token:'reassigned',subjectId:'new-owner',app:'merchant'};
 const db={async send({input}){
  if(input.TableName==='WhizzMerchants_Businesses')return {Item:{ownerId:'new-owner',cognitoUserId:'new-owner'}};
  if(input.IndexName==='BusinessIdIndex')return {Items:[previous,paired]};
  if(input.IndexName==='SubjectIdIndex'){
   assert.equal(input.ExpressionAttributeValues[':scope'],'new-owner');
   return {Items:[current,reassigned]};
  }
  assert.notEqual(input.Key.token,'previous');
  return {Item:input.Key.token===paired.token?paired:input.Key.token===current.token?current:{...reassigned,subjectId:'another-account'}};
 }};
 assert.deepEqual(await merchantOrderTargets(db,'push-tokens','branch'),{ownerId:'new-owner',items:[paired,current]});
});
