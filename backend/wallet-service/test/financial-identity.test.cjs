const {test}=require('node:test'),assert=require('node:assert/strict');
const {authenticateFinancialIdentity:auth}=require('../dist/financialIdentity');
const token=(pool='us-east-1_RGTqUXF5C',sub='driver1')=>'x.'+Buffer.from(JSON.stringify({iss:'https://cognito-idp.us-east-1.amazonaws.com/'+pool,sub,token_use:'access'})).toString('base64url')+'.x';
function client(sub='driver1',username=sub){const calls=[];return {calls,async send(c){calls.push(c.input);return c.input.AccessToken?{Username:username,UserAttributes:[{Name:'sub',Value:sub}]}:{Enabled:true,UserStatus:'CONFIRMED',Username:username,UserAttributes:[{Name:'sub',Value:sub}]};}};}
test('financial auth validates live original token and pins driver versus merchant pool',async()=>{
 const c=client();assert.deepEqual(await auth(c,token(),'DRIVER'),{kind:'DRIVER',subjectId:'driver1'});assert.equal(c.calls[1].UserPoolId,'us-east-1_RGTqUXF5C');
 const merchant=client('owner1','+9647800000000');assert.deepEqual(await auth(merchant,token('us-east-1_gtCR3ndzT','owner1'),'MERCHANT_OWNER'),{kind:'MERCHANT_OWNER',subjectId:'owner1'});assert.equal(merchant.calls[1].Username,'+9647800000000');
 const foreign=client();await assert.rejects(auth(foreign,token(),'MERCHANT_OWNER'),/UNAUTHORIZED/);assert.equal(foreign.calls.length,0);
});
test('decoded claims alone, disabled identity and mismatching live attributes never authenticate',async()=>{
 await assert.rejects(auth({async send(){throw Error('NotAuthorizedException');}},token(),'DRIVER'));
 await assert.rejects(auth(client('other'),token(),'DRIVER'),/UNAUTHORIZED/);
 const c=client();const send=c.send;c.send=async function(cmd){const r=await send.call(c,cmd);if(!cmd.input.AccessToken)r.Enabled=false;return r;};await assert.rejects(auth(c,token(),'DRIVER'),/UNAUTHORIZED/);
});
test('return runtime is disabled by default and a driver token cannot select merchant confirmation',async()=>{
 const {financialAcceptanceHandler}=require('../dist/driverFinancialRuntime'),old={...process.env};
 try{Object.assign(process.env,require('./helpers/finance-rollout-fixture.cjs').scopeEnv());process.env.FINANCIAL_DISPATCH_MODE='REQUIRED';process.env.STAGE='staging';process.env.AWS_REGION='us-east-1';process.env.FINANCIAL_OFFER_TTL_SECONDS='60';process.env.FINANCIAL_POSITION_MAX_AGE_SECONDS='120';
  delete process.env.FINANCIAL_COD_RETURNS_MODE;
  assert.equal((await financialAcceptanceHandler({action:'confirm_return',body:{},accessToken:token()})).code,'COD_RETURNS_DISABLED');
  process.env.FINANCIAL_COD_RETURNS_MODE='REQUIRED';
  const body={branchId:'branch1',orderId:'order1',offerId:'offer1',attempt:1,returnId:'ret1',expectedVersion:2,allItemsReceived:true,condition:'INTACT',driverResponsibility:'NONE',cashCollected:false};
  assert.equal((await financialAcceptanceHandler({action:'confirm_return',body,accessToken:token()})).statusCode,401);
 }finally{process.env=old;}
});
