const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const template=JSON.parse(fs.readFileSync(path.join(__dirname,'../phone-triggers.template.json'),'utf8'));
for (const role of ['Customer','Driver','Merchant']) {
 test(role+' prepared bundle blocks disabled and foreign-pool authentication before I/O',async()=>{
  let io=0;
  class Client {send(){io++;throw Error('Unexpected I/O');}}
  const sdk=new Proxy({}, {get:(_,name)=>name==='DynamoDBDocumentClient'?{from:()=>new Client()}:class extends Client{constructor(input){super();this.input=input;}}});
  const context={exports:{},process:{env:{ENVIRONMENT:'production',OTP_ENABLED:'false',USER_POOL_ID:'production-pool',OTP_TABLE:'production-table',OTP_SECRET_ARN:'production-secret'}},
    require:name=>name.startsWith('@aws-sdk/')?sdk:require(name),Buffer,fetch:()=>{io++;throw Error('Unexpected HTTP');},AbortSignal};
  vm.runInNewContext(role==='Merchant'?fs.readFileSync(path.join(__dirname,'merchant-trigger-bundle.js'),'utf8'):template.Resources[role+'ChallengeFunction'].Properties.Code.ZipFile,context);
  const event={userPoolId:'production-pool',userName:'merchant',triggerSource:'DefineAuthChallenge_Authentication',request:{session:[]},response:{}};
  await assert.rejects(context.exports.handler(event),/OTP configuration unavailable/);
  context.process.env.OTP_ENABLED='true';
  await assert.rejects(context.exports.handler({...event,userPoolId:'foreign-pool'}),/OTP configuration unavailable/);
  assert.equal(io,0);
 });
}
