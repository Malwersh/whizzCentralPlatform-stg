const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const calls = [];
const command = name => class { constructor(input) {this.input=input;this.name=name;} };
let stored;
const fakeDb = {send: async c => {calls.push(c);if(c.name==='GetCommand')return {Item:stored};if(c.name==='TransactWriteCommand')stored=structuredClone(c.input.TransactItems[2].Put.Item);return {};}};
const fakeSecrets = {send: async () => ({SecretString: JSON.stringify({apiKey:'test',hmacKey:'test-key'})})};
Module._load = function(name, ...args) {
  if(name==='@aws-sdk/client-dynamodb') return {DynamoDBClient:class{}};
  if(name==='@aws-sdk/lib-dynamodb') return {DynamoDBDocumentClient:{from:()=>fakeDb},...Object.fromEntries(['GetCommand','UpdateCommand','TransactWriteCommand'].map(n=>[n,command(n)]))};
  if(name==='@aws-sdk/client-secrets-manager') return {SecretsManagerClient:class {send(c){return fakeSecrets.send(c);}},GetSecretValueCommand:command('GetSecretValueCommand')};
  return originalLoad.call(this,name,...args);
};
const saved = {...process.env};
process.env.ENVIRONMENT='production';process.env.OTP_ENABLED='false';process.env.USER_POOL_ID='us-east-1_2sKZ4fGbZ';process.env.OTP_TABLE='wizz-production-MerchantOtpSessions';process.env.USER_POOL_CLIENT_ID='5l8ng11uudg146crop63926svq';process.env.OTP_SECRET_ARN='arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/merchant/otp-AbCd12';
const runtime = require('./index');
Module._load=originalLoad;
test('disabled production OTP cannot issue tokens or read/write challenge state', async()=>{
  await assert.rejects(runtime.handler({callerContext:{clientId:'5l8ng11uudg146crop63926svq'},userPoolId:'us-east-1_2sKZ4fGbZ',userName:'merchant',triggerSource:'DefineAuthChallenge_Authentication',request:{session:[]},response:{}}));assert.equal(calls.length,0);
});
test('adapter sends once and uses atomic reservation and conditional consumption',async()=>{
  process.env.OTP_ENABLED='true';
  const oldFetch=global.fetch;let delivered;
  global.fetch=async(url,request)=>{delivered=JSON.parse(request.body);return {ok:true};};
  try {
    const e=await runtime.handler({callerContext:{clientId:'5l8ng11uudg146crop63926svq'},userPoolId:'us-east-1_2sKZ4fGbZ',userName:'merchant',triggerSource:'CreateAuthChallenge_Authentication',request:{userAttributes:{phone_number:'+9647800868280'},session:[]},response:{}});
    const transaction=calls.find(c=>c.name==='TransactWriteCommand').input.TransactItems;
    assert.equal(transaction.length,3);
    assert.ok(transaction[0].Update.Key.id.startsWith('COOLDOWN#us-east-1_2sKZ4fGbZ#'));
    assert.ok(transaction[1].Update.Key.id.startsWith('DAILY#us-east-1_2sKZ4fGbZ#'));
    assert.equal(transaction[2].Put.Item.id,e.response.privateChallengeParameters.id);
    assert.equal(JSON.stringify(transaction).includes(delivered.verificationCode),false);
    const checked=await runtime.handler({callerContext:{clientId:'5l8ng11uudg146crop63926svq'},userPoolId:'us-east-1_2sKZ4fGbZ',userName:'merchant',triggerSource:'VerifyAuthChallengeResponse_Authentication',request:{privateChallengeParameters:e.response.privateChallengeParameters,challengeAnswer:delivered.verificationCode},response:{}});
    assert.equal(checked.response.answerCorrect,true);
    const consume=calls.find(c=>c.name==='UpdateCommand').input;
    assert.match(consume.ConditionExpression,/attempts = :seen/);
    assert.equal(consume.ExpressionAttributeValues[':seen'],0);
    assert.equal(consume.ExpressionAttributeValues[':subject'],'merchant');
    assert.equal(consume.ExpressionAttributeValues[':digest'],stored.digest);
  } finally {global.fetch=oldFetch;}
});
test.after(()=>{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);});
