'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createService,verifiedUser,ACK_VERSION}=require('./personal-profile.cjs');
const legal=require('../../../backend/shared/customer-legal-contract-344');
const sub='11111111-1111-4111-8111-111111111111';
const user={Enabled:true,UserStatus:'CONFIRMED',UserAttributes:Object.entries({sub,name:'مالك المطعم',phone_number:'+9647800868280',phone_number_verified:'true'}).map(([Name,Value])=>({Name,Value}))};
class Command{constructor(input){this.input=input;}}
function setup(){let saved,closing=false,conflict=false;const calls=[];
 const values=legal.defaults('MERCHANT'),publishedAt='2026-11-17T00:00:00.000Z',bundle={schemaVersion:1,revision:1,publishedAt,...values};
 const row={pk:legal.pkFor('MERCHANT'),sk:'CURRENT',status:'PUBLISHED',version:1,publishedAt,values,digest:legal.hash(bundle)};
 const db={send:async c=>{const i=c.input;calls.push(i);if(i.TransactItems){if(conflict)throw Object.assign(Error(),{name:'TransactionCanceledException'});saved=i.TransactItems[2].Put.Item;return{};}return {Item:i.TableName.endsWith('AccountDeletion')?(closing?{}:undefined):i.TableName.endsWith('PlatformStaff')?row:saved};}};
 const run=createService({db,GetCommand:Command,TransactWriteCommand:Command,authenticate:async()=>({sub,user})});
 const input={acknowledgementVersion:ACK_VERSION,legalAccepted:true,legalAcceptance:{revision:1,digest:row.digest}};
 const event={path:'/auth/person-profile',httpMethod:'POST',body:JSON.stringify(input)};
 return {run,event,input,calls,setClosing:()=>closing=true,setConflict:()=>conflict=true};}
test('creates consent-pinned personal profile without branch or wallet writes',async()=>{const s=setup(),r=await s.run(s.event);assert.equal(r.profile.phoneNumber,'+9647800868280');const tx=s.calls.find(x=>x.TransactItems).TransactItems;assert.equal(tx.length,3);assert.equal(tx[0].ConditionCheck.TableName,'wizz-production-PlatformStaff');assert.equal(tx[1].ConditionCheck.TableName,'wizz-production-AccountDeletion');assert.equal(tx[2].Put.ConditionExpression,'attribute_not_exists(pk)');assert.equal(r.profile.legalAcceptance.documentSnapshot.audience,'MERCHANT');assert.ok(!s.calls.some(x=>JSON.stringify(x).match(/staging|Wallets|APPROVED/)));});
test('retry preserves original profile without another write',async()=>{const s=setup(),a=await s.run(s.event),b=await s.run(s.event);assert.deepEqual(a,b);assert.equal(s.calls.filter(x=>x.TransactItems).length,1);});
test('closing account cannot create profile',async()=>{const s=setup();s.setClosing();await assert.rejects(s.run(s.event),{code:'ACCOUNT_CLOSING'});assert.ok(!s.calls.some(x=>x.TransactItems));});
test('rejects stale consent',async()=>{const s=setup();s.input.legalAcceptance.revision=2;s.event.body=JSON.stringify(s.input);await assert.rejects(s.run(s.event),{code:'LEGAL_VERSION_CHANGED'});});
test('rejects approval or branch fields',async()=>{const s=setup();s.event.body=JSON.stringify({...s.input,status:'APPROVED'});await assert.rejects(s.run(s.event),{code:'ACKNOWLEDGEMENT_REQUIRED'});});
test('transaction conflict never blindly overwrites',async()=>{const s=setup();s.setConflict();await assert.rejects(s.run(s.event),{code:'VERSION_OR_STATE_CONFLICT'});assert.equal(s.calls.filter(x=>x.TransactItems).length,1);});
for(const [name,change]of [['disabled',u=>u.Enabled=false],['unconfirmed',u=>u.UserStatus='UNCONFIRMED'],['foreign identity',u=>u.UserAttributes[0].Value='other'],['unverified phone',u=>u.UserAttributes.find(a=>a.Name==='phone_number_verified').Value='false'],['foreign phone',u=>u.UserAttributes.find(a=>a.Name==='phone_number').Value='+14025555555']])test('rejects '+name,()=>{const u=structuredClone(user);change(u);assert.throws(()=>verifiedUser(u,sub),{code:'VERIFIED_PHONE_IDENTITY_REQUIRED'});});
