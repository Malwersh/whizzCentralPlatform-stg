const test = require('node:test');
const assert = require('node:assert/strict');
const {runtimeTargets} = require('../dist/runtimeTargets');
const configured = ENVIRONMENT => ({ENVIRONMENT,
 WEBSOCKET_CONNECTIONS_TABLE:'wizz-production-order-connections',
 ORDER_WEBSOCKET_API_ID:'abcdefghij',
 WEBSOCKET_ENDPOINT:'https://abcdefghij.execute-api.us-east-1.amazonaws.com/production',
 CREATE_DISPATCH_JOB_LAMBDA:'arn:aws:lambda:us-east-1:746727375268:function:wizz-production-dispatch'});
test('staging runtime targets preserve existing defaults and overrides',()=>{
 assert.equal(runtimeTargets({}).dispatch,'WaveSystem_CreateDispatchJob');
 assert.equal(runtimeTargets({WEBSOCKET_ENDPOINT:'https://configured'}).endpoint,'https://configured');
});
for(const stage of ['prod','production']){
 test(stage+' requires all runtime bindings',()=>{
  for(const key of Object.keys(configured(stage)).filter(k=>k!=='ENVIRONMENT')){
   const env=configured(stage);delete env[key];assert.throws(()=>runtimeTargets(env),/PRODUCTION_RUNTIME_TARGET_NOT_CONFIGURED/);
  }
 });
 test(stage+' rejects legacy or mismatched realtime endpoints',()=>{
  for(const WEBSOCKET_ENDPOINT of ['https://igcrhwc84c.execute-api.us-east-1.amazonaws.com/staging',
   'https://abcdefghij.execute-api.us-east-1.amazonaws.com/production?x=1',
   'https://abcdefghij.execute-api.us-west-2.amazonaws.com/production']){
   assert.throws(()=>runtimeTargets({...configured(stage),WEBSOCKET_ENDPOINT}));
  }
  assert.throws(()=>runtimeTargets({...configured(stage),WEBSOCKET_CONNECTIONS_TABLE:'staging-connections'}));
 });
 test(stage+' rejects foreign dispatch account and accepts explicit production targets',()=>{
  const env=configured(stage);
  assert.equal(runtimeTargets(env).dispatch,env.CREATE_DISPATCH_JOB_LAMBDA);
  assert.throws(()=>runtimeTargets({...env,CREATE_DISPATCH_JOB_LAMBDA:env.CREATE_DISPATCH_JOB_LAMBDA.replace('746727375268','699561669180')}));
  assert.throws(()=>runtimeTargets({...env,CREATE_DISPATCH_JOB_LAMBDA:'WaveSystem_CreateDispatchJob'}));
 });
}
