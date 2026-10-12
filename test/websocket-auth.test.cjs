const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('backend/src/handlers/websocket-connections.js','utf8');
function load(verify){
 const sandbox={process:{env:{}},console:{log(){},warn(){}},module:{exports:{}},require(name){
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
