const {test}=require('node:test'),assert=require('node:assert/strict');
const {authenticateFinancialIdentity:auth}=require('../dist/financialIdentity');
const token=(pool='us-east-1_RGTqUXF5C',sub='driver1',claims={})=>'x.'+Buffer.from(JSON.stringify({iss:'https://cognito-idp.us-east-1.amazonaws.com/'+pool,sub,token_use:'access',...claims})).toString('base64url')+'.x';
const {identities} = require('../../../infrastructure/production/wallet-identity-bindings.json');
const production = {STAGE:'production',AWS_REGION:'us-east-1'};
for (const [role, binding] of Object.entries(identities)) {
 production[role.toUpperCase() + '_USER_POOL_ID'] = binding.poolId;
 production[role.toUpperCase() + '_CLIENT_ID'] = binding.clientId;
}
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
test('production binds all four Cognito roles and uses the stable driver subject', async () => {
 const roles = {STAFF:'admin',CUSTOMER:'customer',DRIVER:'driver',MERCHANT_OWNER:'merchant'};
 for (const [kind, role] of Object.entries(roles)) {
  const binding = identities[role], subject = role + '-subject';
  const user = client(subject, kind === 'DRIVER' ? '+9647800000000' : subject);
  const send = user.send;
  user.send = async command => {
   const response = await send.call(user, command);
   if (kind === 'STAFF') response.UserMFASettingList = ['SOFTWARE_TOKEN_MFA'];
   return response;
  };
  const original = token(binding.poolId, subject, {client_id:binding.clientId});
  assert.deepEqual(await auth(user, original, kind, production), {kind, subjectId:subject});
  assert.deepEqual(user.calls, [{AccessToken:original}, {UserPoolId:binding.poolId, Username:kind === 'DRIVER' ? '+9647800000000' : subject}]);
 }
});
test('production rejects staging issuers, wrong app clients and incomplete bindings before Cognito I/O', async () => {
 const identity = identities.driver, user = client();
 const correct = token(identity.poolId, 'driver1', {client_id:identity.clientId});
 for (const wrong of [
  token('us-east-1_RGTqUXF5C', 'driver1', {client_id:identity.clientId}),
  token(identity.poolId, 'driver1', {client_id:identities.customer.clientId}),
  token(identity.poolId, 'driver1', {client_id:identity.clientId, token_use:'id'}),
 ]) await assert.rejects(auth(user, wrong, 'DRIVER', production), /UNAUTHORIZED/);
 for (const env of [
  {...production, DRIVER_CLIENT_ID:undefined},
  {...production, MERCHANT_USER_POOL_ID:identity.poolId},
  {...production, DRIVER_USER_POOL_ID:'us-east-1_RGTqUXF5C'},
  {...production, ENVIRONMENT:'staging'},
 ]) await assert.rejects(auth(user, correct, 'DRIVER', env), /NOT_CONFIGURED/);
 assert.equal(user.calls.length, 0);
});
test('production still requires a confirmed live subject and staff MFA', async () => {
 const driver = identities.driver;
 const live = client('driver1', '+9647800000000');
 const send = live.send;
 live.send = async command => {
  const response = await send.call(live, command);
  if (command.input.UserPoolId) response.UserAttributes = [{Name:'sub',Value:'different-subject'}];
  return response;
 };
 await assert.rejects(auth(live, token(driver.poolId, 'driver1', {client_id:driver.clientId}), 'DRIVER', production), /UNAUTHORIZED/);
 const admin = identities.admin;
 await assert.rejects(auth(client('admin1'), token(admin.poolId, 'admin1', {client_id:admin.clientId}), 'STAFF', production), /UNAUTHORIZED/);
});
test('production host stays closed by default and excludes unmigrated financial actions', async () => {
 const {financialAcceptanceHandler} = require('../dist/driverFinancialRuntime');
 const previous = process.env;
 try {
  process.env = {...production, FINANCIAL_DISPATCH_MODE:'REQUIRED',
   FINANCIAL_SETTLEMENT_MODEL:'FULL_CASH_AT_DELIVERY_V1'};
  const read = {action:'read_customer_cancellation',body:{orderId:'order1'},accessToken:'invalid'};
  assert.deepEqual(await financialAcceptanceHandler(read), {statusCode:503,code:'FINANCIAL_DISPATCH_DISABLED'});
  process.env.FINANCIAL_ORDER_HOST_MODE = 'SCOPED';
  for (const action of ['accept','complete_cod','validate_push_reference','driver_cash_payout','staff_order_management']) {
   assert.deepEqual(await financialAcceptanceHandler({...read,action}), {statusCode:503,code:'FINANCIAL_DISPATCH_DISABLED'});
  }
  process.env.FINANCE_GENERAL_RELEASE_MODE = 'REQUIRED';
  assert.deepEqual(await financialAcceptanceHandler(read), {statusCode:503,code:'FINANCIAL_DISPATCH_DISABLED'});
 } finally {
  process.env = previous;
 }
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
