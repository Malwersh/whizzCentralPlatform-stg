'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {handle}=require('../commercial-owner');
const event=()=>({action:'commercial_owner',accessToken:'test-not-a-token',httpMethod:'GET',input:{businessId:'branch'}});
const context=()=>({enabled:true,verify:async()=>({sub:'owner',auth_time:Math.floor(Date.now()/1000)}),cognito:{send:async()=>({UserAttributes:[{Name:'sub',Value:'owner'},{Name:'phone_number_verified',Value:'true'}]})},db:{send:async()=>({})}});
test('disabled owner route does not validate or forward credentials',async()=>{const c=context();c.enabled=false;c.verify=()=>{throw Error('must not run');};assert.equal((await handle(c,event())).code,'COMMERCIAL_MANAGEMENT_DISABLED');});
test('forged principal, unverified phone and expired token cannot reach commercial storage',async()=>{
 for(const mode of ['sub','phone','token']){const c=context();c.db.send=()=>{throw Error('storage must not be reached');};if(mode==='token')c.verify=async()=>{throw Error('expired');};else c.cognito.send=async()=>({UserAttributes:[{Name:'sub',Value:mode==='sub'?'other':'owner'},{Name:'phone_number_verified',Value:mode==='phone'?'false':'true'}]});assert.equal((await handle(c,event())).code,'UNAUTHORIZED');}
});
test('valid live session is not rejected solely for old sign-in time; branch authorization still applies',async()=>{const c=context();c.verify=async()=>({sub:'owner',auth_time:1});assert.equal((await handle(c,{...event(),httpMethod:'POST'})).code,'BUSINESS_UNAVAILABLE');assert.equal((await handle(c,event())).code,'BUSINESS_UNAVAILABLE');});
test('revoked live session still fails even if JWT verification succeeds',async()=>{const c=context();c.cognito.send=async()=>{throw Error('revoked');};c.db.send=()=>{throw Error('must not reach storage');};assert.equal((await handle(c,{...event(),httpMethod:'POST'})).code,'UNAUTHORIZED');});
test('unexpected envelope fields and methods rejected',async()=>{for(const e of [{...event(),subjectId:'owner'},{...event(),httpMethod:'DELETE'}])assert.equal((await handle(context(),e)).code,'INVALID_COMMERCIAL_REQUEST');});

test('settlement consent envelope uses the same live access-token identity checks',async()=>{
 const {fixture}=require('../../wallet-service/test/helpers/merchant-settlement-schedule-fixture.cjs');const f=fixture();
 const c={...context(),db:f.db,verify:async()=>({sub:'owner1'}),cognito:{send:async()=>({UserAttributes:[{Name:'sub',Value:'owner1'},{Name:'phone_number_verified',Value:'true'}]})}};
 const e={...event(),action:'settlement_schedule_owner',input:{branchId:'branch1'}};const result=await handle(c,e);assert.equal(result.statusCode,200);assert.deepEqual(result.result.proposals,[]);
 c.cognito.send=async()=>({UserAttributes:[{Name:'sub',Value:'different'},{Name:'phone_number_verified',Value:'true'}]});assert.equal((await handle(c,e)).statusCode,401);
});
