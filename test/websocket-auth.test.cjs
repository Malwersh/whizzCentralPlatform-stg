const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('backend/src/handlers/websocket-connections.js','utf8');
function load(verify, overrides = {}){
 const env = {CENTRAL_PLATFORM_USER_POOL_ID:'us-east-1_Cp9YnOQWi',CENTRAL_PLATFORM_CLIENT_ID:'central-test-client',MERCHANTS_USER_POOL_ID:'us-east-1_gtCR3ndzT',MERCHANTS_CLIENT_ID:'4qabvh11nmghmf9fmc6e6ludd2',DRIVERS_USER_POOL_ID:'us-east-1_Mnrmklxro',DRIVERS_CLIENT_ID:'driver-test-client',...overrides};
 const sandbox={process:{env},console:{log(){},warn(){}},module:{exports:{}},require(name){
  if(name==='../utils/support-access')return require('../backend/src/utils/support-access');
  if(name==='aws-jwt-verify')return {CognitoJwtVerifier:{create:config=>({verify:token=>verify(token,config)})}};
  if(name==='@aws-sdk/lib-dynamodb')return {DynamoDBDocumentClient:{from:()=>({})}};
  return new Proxy({},{get:()=>class {}});
 }};
 vm.runInNewContext(source+'\nmodule.exports.reviewVerifyJwt=verifyJwt;',sandbox);return sandbox.module.exports.reviewVerifyJwt;
}
test('browser test tokens cannot bypass the Cognito verifier',async()=>{
 let calls=0;const verify=load(async()=>{calls++;throw Error('invalid signature');});
 for(const token of ['browser_agent_fake','browser_driver_fake'])await assert.rejects(()=>verify(token,'support'),/Invalid token/);
 assert.equal(calls,2);
});
test('merchant verification uses the staging phone pool and requires successful validation',async()=>{
 const verify=load(async(token,config)=>{assert.equal(config.userPoolId,'us-east-1_gtCR3ndzT');assert.equal(config.clientId,'4qabvh11nmghmf9fmc6e6ludd2');assert.equal(config.tokenUse,'id');return {sub:'verified-merchant'};});
 assert.equal((await verify('fixture','merchant')).sub,'verified-merchant');
});

test('customer auth fails closed until its pool is configured', async () => {
 const verify = load(async () => { throw Error('must not use another pool'); });
 await assert.rejects(() => verify('fixture', 'customer'), /Unsupported identity/);
});
test('customer access token is verified against only the configured customer app', async () => {
 const verify = load(async (token, config) => {
  assert.equal(config.userPoolId, 'us-east-1_Customers');
  assert.equal(config.clientId, 'customer-client');
  if(config.tokenUse === 'id') throw Error('access token');
  return {sub:'customer-1'};
 }, {CUSTOMERS_USER_POOL_ID:'us-east-1_Customers', CUSTOMERS_CLIENT_ID:'customer-client'});
 assert.equal((await verify('fixture','customer')).sub, 'customer-1');
});

test('missing driver pool configuration never falls back to a hardcoded app', async () => {
 const verify=load(async()=>{throw Error('unexpected verifier');},{DRIVERS_USER_POOL_ID:'',DRIVERS_CLIENT_ID:''});
 await assert.rejects(()=>verify('fixture','driver'),/Unsupported identity/);
});
