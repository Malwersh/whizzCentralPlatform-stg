const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(item, env = {PUSH_TOKENS_TABLE:'test'}, pool) {
 const reads = [], writes = [];
 const names = ['GetCommand','DeleteCommand','PutCommand','TransactWriteCommand'];
 const commands = Object.fromEntries(names.map(n => [n, {[n]: class {
  constructor(input) {this.input = input;}
 }}[n]]));
 let changed = false;
 const db = {async send(command) {
  if (command instanceof commands.GetCommand) {reads.push(command.input); return {Item:item};}
  writes.push(command.input);
  if (changed) throw Object.assign(Error('race'), {name:'ConditionalCheckFailedException'});
  return {};
 }};
 const module = {exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/handlers/push-tokens.js'),'utf8'), {
  module, exports:module.exports, Buffer, process:{env}, console:{error(){}},
  require(name) {
   if (name.includes('lib-dynamodb')) return {...commands,DynamoDBDocumentClient:{from:()=>db}};
   if (name.includes('client-dynamodb')) return {DynamoDBClient:class{}};
   if (name.includes('jwt-multi')) return {verifyJwtMulti:async()=>({payload:{sub:'owner'},pool})};
   if (name.endsWith('notification-provider-bindings')) return require('../src/utils/notification-provider-bindings');
   if (name.endsWith('/http')) return require('../src/utils/http');
   throw Error(name);
  }
 });
 const event = body => ({httpMethod:'POST',body:JSON.stringify(body)});
 return {
  reads, writes, race:()=>changed=true,
  run:()=>module.exports.unregister(event({token:'device',app:'driver'})),
  register: body=>module.exports.register(event({token:'device',platform:'ios',...body}))
 };
}
test('unregister atomically pins both owner and app, including an idempotent missing device',async()=>{for(const item of [undefined,{subjectId:'owner',app:'driver'}]){const f=fixture(item);assert.equal((await f.run()).statusCode,200);assert.match(f.writes[0].ConditionExpression,/#subject = :subject AND #app = :app/);assert.equal(f.writes[0].ExpressionAttributeValues[':subject'],'owner');}});
test('foreign app or owner cannot unregister another device',async()=>{for(const item of [{subjectId:'other',app:'driver'},{subjectId:'owner',app:'merchant'}]){const f=fixture(item);assert.equal((await f.run()).statusCode,403);assert.equal(f.writes.length,0);}});
test('ownership change after read is denied without pretending success',async()=>{const f=fixture({subjectId:'owner',app:'driver'});f.race();assert.equal((await f.run()).statusCode,403);});

const production = {STAGE:'production',AWS_REGION:'us-east-1',PUSH_TOKENS_TABLE:'wizz-production-PushDeviceTokens'};
test('production registration fences the current merchant and its branch in the same transaction',async()=>{
 const f=fixture(undefined,production,'merchants');
 assert.equal((await f.register({app:'merchant',businessId:'branch1'})).statusCode,200);
 const [owner,branch,merchant,item]=f.writes[0].TransactItems;
 assert.equal(owner.ConditionCheck.Key.pk,'ACCOUNT_LIFECYCLE#MERCHANT#owner');
 assert.equal(branch.ConditionCheck.Key.pk,'BUSINESS_LIFECYCLE#MERCHANT#branch1');
 assert.equal(merchant.ConditionCheck.TableName,'wizz-production-Merchants');
 assert.match(merchant.ConditionCheck.ConditionExpression,/ownerId = :subject/);
 assert.equal(item.Put.TableName,production.PUSH_TOKENS_TABLE);
 assert.equal(item.Put.Item.env,'production');
 assert.match(item.Put.ConditionExpression,/#subject = :subject AND #app = :app/);
});

test('wrong pool, non-production table and oversized token cause no production writes',async()=>{
 const otherPool=fixture(undefined,production,'users');
 assert.equal((await otherPool.run()).statusCode,403);
 assert.equal((await otherPool.register({app:'driver'})).statusCode,403);
 assert.equal(otherPool.reads.length,0);
 assert.equal(otherPool.writes.length,0);
 const wrongTable=fixture(undefined,{...production,PUSH_TOKENS_TABLE:'WizzCentral_PushDeviceTokens_staging'},'drivers');
 assert.equal((await wrongTable.register({app:'driver'})).statusCode,500);
 assert.equal(wrongTable.writes.length,0);
 const correct=fixture(undefined,production,'drivers');
 assert.equal((await correct.register({app:'driver',token:'x'.repeat(2049)})).statusCode,400);
 assert.equal(correct.writes.length,0);
});
