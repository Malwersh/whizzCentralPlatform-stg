'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {merchantOwnerFinancialGuard}=require('../dist/merchantOwnerFinancialGuard');
const {merchantGuards}=require('../dist/transferIdentity');
const {createMerchantFinancialSession}=require('../../staff-service/merchant-financial-session');
function fixture(){let time=Date.now(),code,phone='+9647800000000',subject='owner',deleted=false;const rows=new Map();
 const branch={businessId:'branch',ownerId:'owner',cognitoUserId:'owner',status:'approved',version:1};
 const input={branchId:'branch',deviceId:'device_12345678901234567890123'};
 const db={async send(c){const q=c.input;if(c.constructor.name==='GetCommand'){if(q.TableName==='WhizzMerchants_Businesses')return {Item:{...branch}};if(q.TableName==='staging-AccountDeletion')return {Item:deleted?{...q.Key}:undefined};return {Item:structuredClone(rows.get(JSON.stringify(q.Key)))};}
 for(const x of q.TransactItems||[])if(x.Put)rows.set(JSON.stringify({pk:x.Put.Item.pk,sk:x.Put.Item.sk}),structuredClone(x.Put.Item));return {};}};
 const service=createMerchantFinancialSession({db,now:()=>time,authorize:async()=>({subjectId:'owner',branchId:'branch',verifiedPhone:phone,fingerprint:createHash('sha256').update(JSON.stringify(['owner',phone,branch.ownerId,branch.version,branch.status])).digest('hex'),guards:[{ConditionCheck:{TableName:'WhizzMerchants_Businesses',Key:{businessId:'branch'}}}]}),otp:{secret:async()=> 's'.repeat(32),send:async(_,v)=>code=v}});
 const a={principalId:'owner',ownerId:'branch',type:'MERCHANT',walletId:'WALLET#MERCHANT#branch',isOwner:true};
 const options={db,now:()=>time,cognito:{send:async()=>({UserAttributes:[{Name:'sub',Value:subject},{Name:'phone_number',Value:phone},{Name:'phone_number_verified',Value:'true'}]})}};
 return {a,options,rows,branch,service,input,advance:s=>time+=s*1000,phoneChange:()=>phone='+9647800000001',foreignUser:()=>subject='another',deletion:()=>deleted=true,async headers(){const c=await service.start(input),s=await service.unlock({...input,challengeId:c.challengeId,code});return {Authorization:'Bearer verified-access-token','X-Financial-Session':JSON.stringify({deviceId:input.deviceId,token:s.token})};}};
}
test('wallet accepts the actual session issued by settlement service and preserves guards for writes',async()=>{
 delete process.env.MERCHANTS_TABLE;delete process.env.ACCOUNT_DELETION_TABLE;
 const f=fixture(),h=await f.headers(),guards=await merchantOwnerFinancialGuard(f.a,h,f.options);
 assert.equal(guards.length,4);assert.ok(guards.some(x=>x.ConditionCheck.Key.sk==='SESSION'));
 assert.deepEqual(merchantGuards({...f.a,ownerFinancialGuards:guards}),guards);
});
test('wallet rejects missing, malformed and foreign-device financial tokens',async()=>{
 const f=fixture(),h=await f.headers();
 for(const value of [undefined,'null','{}','[]',JSON.stringify({deviceId:'another_device_123456789012',token:JSON.parse(h['X-Financial-Session']).token})]){
  await assert.rejects(merchantOwnerFinancialGuard(f.a,{...h,'X-Financial-Session':value},f.options),{code:'PAYOUT_FINANCIAL_UNLOCK_REQUIRED'});
 }
});
test('expired session, phone change and live Cognito user mismatch invalidate wallet access',async()=>{
 for(const change of [f=>f.advance(300),f=>f.phoneChange(),f=>f.foreignUser()]){const f=fixture(),h=await f.headers();change(f);await assert.rejects(merchantOwnerFinancialGuard(f.a,h,f.options),{code:'PAYOUT_FINANCIAL_UNLOCK_REQUIRED'});}
});
test('ownership and deletion changes deny access even with a previously valid capability',async()=>{
 for(const change of [f=>f.branch.ownerId='new-owner',f=>f.deletion()]){const f=fixture(),h=await f.headers();change(f);await assert.rejects(merchantOwnerFinancialGuard(f.a,h,f.options),{code:'PAYOUT_FINANCIAL_UNLOCK_REQUIRED'});}
});
test('legacy staff grant cannot impersonate owner; dedicated staff PIN transport remains separate',async()=>{
 const f=fixture();await assert.rejects(merchantOwnerFinancialGuard({...f.a,isOwner:false},{},f.options),{code:'PAYOUT_FINANCIAL_UNLOCK_REQUIRED'});
});
