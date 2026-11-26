'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {DynamoDBClient,CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=require('../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,PutCommand,GetCommand,UpdateCommand}=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {input}=require('../backend/wallet-service/test/helpers/driver-offer-fixture.cjs');
const {prepareDriverOfferFinancialSnapshot,createStagingDriverOfferOrderReader}=require('../backend/wallet-service/dist/driverOfferOrderReader');
const policy=require('../backend/order-service/legacy-order-policy');
async function main(){
 assert(process.argv.includes('--execute-synthetic')&&process.env.AWS_PROFILE==='Wizz_stg_UserApp'&&process.env.AWS_REGION==='us-east-1');assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');
 const raw=new DynamoDBClient({region:'us-east-1'}),db=DynamoDBDocumentClient.from(raw),table='staging-cod29-readiness-'+crypto.randomBytes(8).toString('hex'),key={PK:'ORDER#order1',SK:'META'};let created=false;
 const result={scope:'REAL_DYNAMODB_ISOLATED_TABLE_CANONICAL_READER',financialActivation:'OFF',applicationTablesAccessed:false,humanDataAccess:false};
 try{
  await raw.send(new CreateTableCommand({TableName:table,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'PK',AttributeType:'S'},{AttributeName:'SK',AttributeType:'S'}],KeySchema:[{AttributeName:'PK',KeyType:'HASH'},{AttributeName:'SK',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:raw,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});
  const row={...key,orderId:'order1',storeId:'branch1',merchantId:'merchant1',status:'preparing',orderStatus:'confirmed',storeStatus:'branch1#preparing#b3',financialSnapshot:prepareDriverOfferFinancialSnapshot(input().order)};
  await db.send(new PutCommand({TableName:table,Item:row}));
  const read=async()=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
  const item={Update:{TableName:table,Key:key,UpdateExpression:'SET #status=:status, storeStatus=:storeStatus',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':status':'ready',':storeStatus':'branch1#ready#b3'}}};
  policy.fenceMerchantOrderOperation(item,await read());policy.canonicalFinancialPreparation(item,row);await db.send(new UpdateCommand(item.Update));const saved=await read();assert.equal(saved.status,'ready_for_pickup');assert.equal(saved.orderStatus,'ready_for_pickup');assert.equal(saved.storeStatus,'branch1#ready_for_pickup#b3');assert.deepEqual(saved.financialSnapshot,row.financialSnapshot);
  const reader=createStagingDriverOfferOrderReader({db:{async send(c){assert.equal(c.input.TableName,'WizzOrders');return db.send(new GetCommand({...c.input,TableName:table}));}}});const parsed=await reader.read({orderId:'order1',branchId:'branch1'});assert.deepEqual(parsed.snapshot,row.financialSnapshot.snapshot);result.canonicalReaderAccepted=true;result.snapshotUnchanged=true;
  // A ready write built before driver assignment must not overwrite that assignment.
  await db.send(new PutCommand({TableName:table,Item:{...row,status:'assigned',orderStatus:'assigned',driverId:'driver1',financialAcceptance:{schemaVersion:1}}}));await assert.rejects(db.send(new UpdateCommand(item.Update)),e=>e.name==='ConditionalCheckFailedException');assert.equal((await read()).status,'assigned');result.concurrentAssignmentProtected=true;
 }finally{if(created){await raw.send(new DeleteTableCommand({TableName:table}));await waitUntilTableNotExists({client:raw,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});result.tableDeleted=true;}fs.writeFileSync('/private/tmp/cod29-readiness-result.json',JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;});
