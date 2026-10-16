const test=require('node:test'),assert=require('node:assert/strict');
const {createWorker}=require('../notification-worker');
process.env.WALLET_NOTIFICATIONS_TABLE='events';process.env.PUSH_TOKENS_TABLE='tokens';
const item=()=>({eventId:'TOPUP#APPROVED',driverId:'driver',topupId:'TOPUP',type:'wallet_topup_approved',amount:50000,title:'Approved',body:'Balance updated',createdAt:new Date(1700000000000).toISOString(),attempts:1});
function fixture(records,{failure,delivered=[]}={}){
 const writes=[],sends=[];
 const client={send:async command=>{
  const input=command.input;writes.push(input);
  if(command.constructor.name==='UpdateCommand' && input.ReturnValues)return {Attributes:{...item(),deliveredTokenHashes:new Set(delivered)}};
  if(command.constructor.name==='QueryCommand')return {Items:records};
  return {};
 }};
 const worker=createWorker(client,async()=>({send:async message=>{sends.push(message);if(failure)throw failure;}}),()=>1700000000000);
 return {worker,writes,sends};
}
test('only driver devices receive wallet data; completed tokens are persisted before marking SENT',async()=>{
 const f=fixture([{app:'driver',token:'driver-token'},{app:'merchant',token:'other-token'}]);
 await f.worker.processEvent('event');assert.equal(f.sends.length,1);assert.equal(f.sends[0].data.action,'open_wallet');
 assert.equal(f.writes.filter(x=>x.UpdateExpression?.includes('ADD deliveredTokenHashes')).length,1);
 assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'SENT');
});
test('no registered device and transient errors schedule a retry without losing inbox data',async()=>{
 for(const f of [fixture([]),fixture([{app:'driver',token:'token'}],{failure:{code:'messaging/server-unavailable'}})]){
  await f.worker.processEvent('event');assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'PENDING');assert.ok(f.writes.at(-1).ExpressionAttributeValues[':next']>1700000000);
 }
});
test('successful tokens are not sent again on retry',async()=>{
 const hash=require('crypto').createHash('sha256').update('token').digest('hex');
 const f=fixture([{app:'driver',token:'token'}],{delivered:[hash]});await f.worker.processEvent('event');assert.equal(f.sends.length,0);assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'SENT');
});
test('invalid device tokens are removed; finance event remains in the inbox',async()=>{
 const f=fixture([{app:'driver',token:'token'}],{failure:{code:'messaging/registration-token-not-registered'}});await f.worker.processEvent('event');assert.ok(f.writes.some(x=>x.TableName==='tokens' && x.Key?.token==='token'));assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'UNDELIVERABLE');
});
test('a competing lease prevents a second sender',async()=>{
 let calls=0;const worker=createWorker({send:async()=>{throw {name:'ConditionalCheckFailedException'};}},async()=>{calls++;});await worker.processEvent('event');assert.equal(calls,0);
});
test('rejection creates a separate deterministic notification without crediting the wallet',async()=>{
 const {walletNotification}=require('../dist/walletNotifications');const result=walletNotification({...item(),topupId:'TOPUP'},'REJECTED',new Date().toISOString());assert.equal(result.Put.Item.eventId,'TOPUP#REJECTED');assert.equal(result.Put.Item.deliveryStatus,'PENDING');assert.equal(result.Put.ConditionExpression,'attribute_not_exists(eventId)');
});
