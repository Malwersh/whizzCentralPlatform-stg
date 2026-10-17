'use strict';
// Disposable table only. No access to application tables, Cognito, ledger, notifications or feature flags.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {DynamoDBClient,CreateTableCommand,DeleteTableCommand,DescribeTableCommand,waitUntilTableExists,waitUntilTableNotExists}=require('../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,PutCommand,GetCommand,UpdateCommand,ScanCommand}=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const p=require('../backend/order-service/legacy-order-policy');
async function main(){
 assert(process.argv.includes('--execute-synthetic')&&process.env.AWS_PROFILE==='Wizz_stg_UserApp'&&process.env.AWS_REGION==='us-east-1','EXPLICIT_SYNTHETIC_STAGING_EXECUTION_REQUIRED');
 const account=(await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account;assert.equal(account,'699561669180');
 const raw=new DynamoDBClient({region:'us-east-1'}),db=DynamoDBDocumentClient.from(raw,{marshallOptions:{removeUndefinedValues:true}}),table='staging-cod28-fences-'+crypto.randomBytes(8).toString('hex');let created=false,deleted=false;
 const out={account,region:'us-east-1',scope:'REAL_DYNAMODB_CONDITIONS_DISPOSABLE_TABLE',applicationTablesAccessed:false,humanDataAccess:false,checks:[]};
 const put=row=>db.send(new PutCommand({TableName:table,Item:{pk:'order',...row}}));
 const get=async()=>(await db.send(new GetCommand({TableName:table,Key:{pk:'order'},ConsistentRead:true}))).Item;
 const update=op=>db.send(new UpdateCommand({TableName:table,Key:{pk:'order'},...op}));
 const rejected=async promise=>assert.rejects(promise,e=>e.name==='ConditionalCheckFailedException');
 try{
  await raw.send(new CreateTableCommand({TableName:table,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'pk',AttributeType:'S'}],KeySchema:[{AttributeName:'pk',KeyType:'HASH'}]}));created=true;await waitUntilTableExists({client:raw,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});
  const legacy={UpdateExpression:'SET #status=:status',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':status':'delivered'},ConditionExpression:p.LEGACY_ONLY};
  await put({status:'picked_up'});await update(legacy);assert.equal((await get()).status,'delivered');out.checks.push('LEGACY_UNCHANGED');
  for(const marker of p.FINANCIAL_FIELDS){await put({status:'picked_up',[marker]:null});await rejected(update(legacy));assert.equal((await get()).status,'picked_up');}out.checks.push('ALL_MARKERS_INCLUDING_NULL_BLOCK_LEGACY_WRITE');
  const row={status:'pending',orderStatus:'pending',financialSnapshot:{version:1,digest:'synthetic'},commercialPricing:{agreement:{id:'fixture'}},financialAcceptance:null};
  await put(row);const item={Update:{UpdateExpression:'SET #status=:status',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':status':'confirmed'}}};p.fenceMerchantOrderOperation(item,await get());await update(item.Update);assert.equal((await get()).status,'confirmed');out.checks.push('MERCHANT_PREPARATION_ALLOWED');
  const late={Update:{UpdateExpression:'SET #status=:status',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':status':'ready'}}};p.fenceMerchantOrderOperation(late,await get());
  await put({...row,status:'assigned',orderStatus:'assigned',driverId:'fixture-driver',financialAcceptance:{schemaVersion:1}});await rejected(update(late.Update));assert.equal((await get()).status,'assigned');out.checks.push('CONCURRENT_ACCEPT_BLOCKS_STALE_MERCHANT_PREPARATION');
  const progress=target=>{const f=p.driverProgressFence(target);return {UpdateExpression:'SET #status=:status, orderStatus=:status',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':status':target,':driverId':'fixture-driver',...f.values},ConditionExpression:'driverId=:driverId AND ('+f.condition+')'};};
  for(const target of ['heading_to_store','arrived_at_store','picked_up','heading_to_customer','arrived_at_customer'])await update(progress(target));assert.equal((await get()).status,'arrived_at_customer');out.checks.push('ALL_FIVE_FINANCIAL_PROGRESS_STEPS');
  await put({...row,status:'returning',driverId:'fixture-driver',financialAcceptance:{schemaVersion:1},returnCaseId:'fixture-return'});await rejected(update(progress('heading_to_customer')));out.checks.push('RETURN_BLOCKS_STALE_DRIVER_PROGRESS');
  await put({status:'delivered',driverId:'fixture-driver',financialOutcome:'fixture-outcome'});await rejected(update(progress('heading_to_store')));await rejected(update(legacy));out.checks.push('ARCHIVED_OUTCOME_CANNOT_REOPEN');
  await put({...row,status:'picked_up',driverId:'fixture-driver',financialAcceptance:{schemaVersion:1}});
  const cancel={UpdateExpression:'SET #status=:cancelled, financialOutcome=:outcome',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':cancelled':'cancelled',':prior':'picked_up',':outcome':'fixture-outcome'},ConditionExpression:'#status=:prior AND attribute_not_exists(financialOutcome)'};
  const race=await Promise.allSettled([update(progress('heading_to_customer')),update(cancel)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.ok(race.filter(r=>r.status==='rejected').every(r=>r.reason.name==='ConditionalCheckFailedException'));out.checks.push('PROGRESS_VS_TERMINAL_CAS_ONE_WINNER');
  const terminal=['delivered','completed','returned','canceled_by_user','cancelled_by_driver'],active=['returning','return_arrived','assigned','unknown'];
  for(const status of terminal.concat(active))await db.send(new PutCommand({TableName:table,Item:{pk:'history#'+status,status}}));
  await db.send(new PutCommand({TableName:table,Item:{pk:'history#missing'}}));
  for(const kind of ['active','completed']){const f=p.customerStatusFilter(kind);const result=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,FilterExpression:'begins_with(pk,:historyPrefix) AND '+f.expression,ExpressionAttributeNames:f.names,ExpressionAttributeValues:{...f.values,':historyPrefix':'history#'}}));assert.equal(result.Count,kind==='completed'?terminal.length:active.length+1);}
  out.checks.push('CUSTOMER_FILTERS_INCLUDE_RETURNED_AND_KEEP_UNKNOWN_AND_RETURNING_ACTIVE');

 }finally{if(created){await raw.send(new DeleteTableCommand({TableName:table}));await waitUntilTableNotExists({client:raw,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});deleted=true;}out.tableDeleted=deleted;fs.writeFileSync('/private/tmp/cod28-fences-result.json',JSON.stringify(out,null,2)+'\n');}
 assert(deleted);console.log(JSON.stringify(out));
}
main().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;});
