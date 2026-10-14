const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('delayed wave acceptance cannot assign an order after driver lifecycle closes',async()=>{
 const root=path.resolve(__dirname,'../../../lambda/WaveSystem_HandleDriverAccept');
 const commands={};for(const name of ['GetCommand','UpdateCommand','TransactWriteCommand','QueryCommand']){const C=class{constructor(input){this.input=input;}};Object.defineProperty(C,'name',{value:name});commands[name]=C;}
 const writes=[];const raw={send:async command=>{
  if(command.constructor.name==='GetCommand')return {Item:command.input.TableName==='WhizzDrivers_staging'?{driverId:'driver',status:'APPROVED'}:{orderId:'order',responseStatus:'pending'}};
  writes.push(command);throw Object.assign(Error('Lifecycle closed'),{name:'TransactionCanceledException'});
 }};
 const lifecycle={exports:{}};
 vm.runInNewContext(fs.readFileSync(root+'/driver-lifecycle.js','utf8'),{module:lifecycle,require:n=>n==='@aws-sdk/lib-dynamodb'?commands:require(n)});
 const exports={};const env={DRIVERS_TABLE:'WhizzDrivers_staging',DISPATCH_JOBS_TABLE:'WizzDispatchJobs_staging',WAVE_OFFERS_TABLE:'WaveOffers_staging',DRIVER_LIVE_STATE_TABLE:'WizzDriverLiveState_staging',ORDERS_TABLE:'WizzOrders'};
 vm.runInNewContext(fs.readFileSync(root+'/index.js','utf8'),{exports,process:{env},console:{log(){},error(){},warn(){}},require:n=>n==='./driver_eligibility'?{isDriverApproved:p=>p.status==='APPROVED'}:n==='./driver-lifecycle'?lifecycle.exports:n==='@aws-sdk/client-dynamodb'?{DynamoDBClient:class{}}:n==='@aws-sdk/lib-dynamodb'?{...commands,DynamoDBDocumentClient:{from:()=>raw}}:{ApiGatewayManagementApiClient:class{},PostToConnectionCommand:class{}}});
 const r=await exports.handler({body:JSON.stringify({offerId:'OFFER_order_driver_W1',driverId:'driver',orderId:'order'})});
 assert.equal(r.statusCode,500);assert.equal(writes.length,1);
 const tx=writes[0].input.TransactItems;assert.equal(tx[0].ConditionCheck.Key.pk,'ACCOUNT_LIFECYCLE#DRIVER#driver');assert.equal(tx[1].Update.TableName,'WaveOffers_staging');assert.match(tx[1].Update.ConditionExpression,/responseStatus/);
});
