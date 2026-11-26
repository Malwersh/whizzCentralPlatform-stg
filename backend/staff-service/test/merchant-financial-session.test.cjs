'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantFinancialSession}=require('../merchant-financial-session');
function fixture(){
 let time=1000000000,code,denied=false,fingerprint='owner-and-phone-version-1',sendFails=false;
 const rows=new Map(),key=r=>JSON.stringify([r.pk,r.sk]);
 const db={async send(c){if(c.constructor.name==='GetCommand')return {Item:structuredClone(rows.get(key(c.input.Key)))};
  const puts=c.input.TransactItems.filter(x=>x.Put).map(x=>x.Put);
  for(const p of puts){const old=rows.get(key(p.Item));if(p.ConditionExpression==='attribute_not_exists(pk)'?!!old:old?.version!==p.ExpressionAttributeValues[':version'])throw Error('ConditionalCheckFailed');}
  for(const p of puts)rows.set(key(p.Item),structuredClone(p.Item));return {};
 }};
 const input={branchId:'branch-1',deviceId:'device_12345678901234567890123'};
 const api=createMerchantFinancialSession({db,now:()=>time,authorize:async branchId=>{if(denied)throw Error('REVOKED');return {subjectId:'owner-1',branchId,verifiedPhone:'+9647800000000',fingerprint,guards:[{ConditionCheck:{TableName:'Branches',Key:{id:branchId}}}]};},otp:{secret:async()=> 's'.repeat(32),send:async(_,v)=>{code=v;if(sendFails)throw Error('timeout');}}});
 return {api,input,rows,code:()=>code,advance:seconds=>time+=seconds*1000,revoke:()=>denied=true,changeIdentity:()=>fingerprint='owner-and-phone-version-2',failDelivery:()=>sendFails=true};
}
async function opened(f){const c=await f.api.start(f.input);return f.api.unlock({...f.input,challengeId:c.challengeId,code:f.code()});}
test('owner verification creates a five-minute device and branch scoped hashed session',async()=>{
 const f=fixture(),s=await opened(f),a=await f.api.check({...f.input,token:s.token});assert.equal(a.branchId,'branch-1');assert.equal(a.guards.length,2);
 const saved=JSON.stringify([...f.rows.values()]);assert.ok(!saved.includes(s.token));assert.ok(!saved.includes('"code":'));assert.ok(!saved.includes('+964'));
 await assert.rejects(f.api.check({...f.input,deviceId:'different_device_12345678901234',token:s.token}),{code:'FINANCIAL_UNLOCK_REQUIRED'});
 await assert.rejects(f.api.check({...f.input,branchId:'branch-2',token:s.token}),{code:'FINANCIAL_UNLOCK_REQUIRED'});
 f.advance(300);await assert.rejects(f.api.check({...f.input,token:s.token}),{code:'FINANCIAL_UNLOCK_REQUIRED'});
});
test('wrong codes exhaust attempts and cannot be replayed',async()=>{
 const f=fixture(),c=await f.api.start(f.input),bad=f.code()==='000000'?'000001':'000000';
 for(let i=0;i<5;i++)await assert.rejects(f.api.unlock({...f.input,challengeId:c.challengeId,code:bad}),{code:'FINANCIAL_INVALID_CODE'});
 await assert.rejects(f.api.unlock({...f.input,challengeId:c.challengeId,code:f.code()}),{code:'FINANCIAL_CHALLENGE_EXPIRED'});
});
test('consumed challenges and old session tokens cannot unlock again',async()=>{
 const f=fixture(),c=await f.api.start(f.input),s=await f.api.unlock({...f.input,challengeId:c.challengeId,code:f.code()});
 await assert.rejects(f.api.unlock({...f.input,challengeId:c.challengeId,code:f.code()}),{code:'FINANCIAL_CHALLENGE_EXPIRED'});
 await f.api.lock({...f.input,token:s.token});await assert.rejects(f.api.check({...f.input,token:s.token}),{code:'FINANCIAL_UNLOCK_REQUIRED'});
});
test('revoked ownership or changed identity invalidates an existing session',async()=>{
 const f=fixture(),s=await opened(f);f.changeIdentity();await assert.rejects(f.api.check({...f.input,token:s.token}),{code:'FINANCIAL_UNLOCK_REQUIRED'});
 f.revoke();await assert.rejects(f.api.check({...f.input,token:s.token}),/REVOKED/);
});
test('resending is rate limited with a persisted hourly ceiling',async()=>{
 const f=fixture();await f.api.start(f.input);await assert.rejects(f.api.start(f.input),{code:'FINANCIAL_RATE_LIMIT'});
 for(let i=1;i<5;i++){f.advance(60);await f.api.start(f.input);}f.advance(60);await assert.rejects(f.api.start(f.input),{code:'FINANCIAL_RATE_LIMIT'});
 f.advance(3600);assert.ok((await f.api.start(f.input)).challengeId);
});
test('uncertain OTP delivery does not reveal code or discard a delivered challenge',async()=>{
 const f=fixture();f.failDelivery();const c=await f.api.start(f.input);assert.equal(c.delivery,'UNCONFIRMED');assert.equal(c.code,undefined);
 assert.ok((await f.api.unlock({...f.input,challengeId:c.challengeId,code:f.code()})).token);
});
test('parallel challenge verification issues only one session',async()=>{
 const f=fixture(),c=await f.api.start(f.input),input={...f.input,challengeId:c.challengeId,code:f.code()};
 const out=await Promise.allSettled([f.api.unlock(input),f.api.unlock(input)]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);
});

test('OTP limit cannot be bypassed with another device or branch',async()=>{const f=fixture();await f.api.start(f.input);await assert.rejects(f.api.start({...f.input,branchId:'branch-2',deviceId:'different_device_12345678901234'}),{code:'FINANCIAL_RATE_LIMIT'});});

test('a delayed lock cannot revoke a newer verified session',async()=>{const f=fixture(),old=await opened(f);f.advance(60);const current=await opened(f);await assert.rejects(f.api.lock({...f.input,token:old.token}),{code:'FINANCIAL_UNLOCK_REQUIRED'});assert.ok(await f.api.check({...f.input,token:current.token}));});

test('new capabilities carry explicit cleanup ownership without exposing phone or token',async()=>{const f=fixture();await opened(f);for(const row of f.rows.values()){assert.equal(row.subjectId,'owner-1');if(row.sk!=='OTP')assert.equal(row.branchId,'branch-1');assert.equal(row.phoneNumber,undefined);assert.equal(row.token,undefined);}});
