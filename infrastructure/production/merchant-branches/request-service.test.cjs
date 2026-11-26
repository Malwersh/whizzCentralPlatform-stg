'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createRequestService,TABLES}=require('./request-service.cjs');
class Command{constructor(input){this.input=input;}}
const identity={sub:'owner',user:{Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'owner'},{Name:'phone_number_verified',Value:'true'},{Name:'phone_number',Value:'+9647800868280'}]}};
function service({authenticate=async()=>identity,closing=false}={}){const calls=[];return {calls,run:createRequestService({authenticate,sdk:{GetCommand:Command,QueryCommand:Command,TransactWriteCommand:Command},regions:{validate:async()=>{},list:async()=>({items:[]})},db:{send:async c=>{calls.push(c.input);return c.input.TableName===TABLES.lifecycle?{Item:closing?{}:undefined}:{Items:[]};}}})};}
test('authentication failure performs no database read',async()=>{const s=service({authenticate:async()=>{throw Error('UNAUTHORIZED');}});await assert.rejects(()=>s.run({}),/UNAUTHORIZED/);assert.equal(s.calls.length,0);});
test('closing account cannot list drafts',async()=>{const s=service({closing:true});await assert.rejects(()=>s.run({path:'/auth/branch-drafts',httpMethod:'GET'}),/ACCOUNT_CLOSING/);assert.equal(s.calls.length,1);});
test('unknown route cannot fall through into draft listing',async()=>{const s=service();await assert.rejects(()=>s.run({path:'/auth/branch-drafts/unknown',httpMethod:'GET'}),/NOT_FOUND/);assert.equal(s.calls.length,0);});
test('lists drafts after live lifecycle check',async()=>{const s=service();assert.deepEqual(await s.run({path:'/auth/branch-drafts',httpMethod:'GET'}),{items:[]});assert.equal(s.calls[0].TableName,TABLES.lifecycle);assert.equal(s.calls[1].TableName,TABLES.platform);});
test('invalid JSON and non-object bodies are rejected before writes',async()=>{for(const body of ['{','[]','null']){const s=service();await assert.rejects(()=>s.run({path:'/auth/branch-drafts',httpMethod:'POST',body}),/INVALID_/);assert.equal(s.calls.length,1);}});
test('unverified phone cannot access branches',async()=>{const user=structuredClone(identity);user.user.UserAttributes[1].Value='false';const s=service({authenticate:async()=>user});await assert.rejects(()=>s.run({path:'/auth/branch-drafts',httpMethod:'GET'}),/VERIFIED_PHONE/);assert.equal(s.calls.length,0);});
test('owned branch route uses verified subject and owner index',async()=>{const s=service();assert.deepEqual(await s.run({path:'/auth/user-businesses',httpMethod:'GET',queryStringParameters:{ownerId:'another'}}),{success:true,businesses:[]});assert.equal(s.calls[1].IndexName,'ownerId-index');assert.equal(s.calls[1].ExpressionAttributeValues[':owner'],'owner');});
test('closing account cannot query owned branches',async()=>{const s=service({closing:true});await assert.rejects(()=>s.run({path:'/auth/user-businesses',httpMethod:'GET'}),/ACCOUNT_CLOSING/);assert.equal(s.calls.length,1);});

test('region catalog requires a live account',async()=>{const s=service({closing:true});await assert.rejects(()=>s.run({path:'/auth/branch-drafts/regions',httpMethod:'GET'}),/ACCOUNT_CLOSING/);assert.equal(s.calls.length,1);});
test('region catalog is available after verified identity check',async()=>{const s=service();assert.deepEqual(await s.run({path:'/auth/branch-drafts/regions',httpMethod:'GET'}),{items:[]});assert.equal(s.calls.length,1);});
