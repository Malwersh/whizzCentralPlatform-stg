'use strict';
// Exercise the canonical commercial source against real, isolated DynamoDB. Never remap to application tables.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const sdk=require('../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb');
const doc=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {fixture}=require('../backend/wallet-service/test/helpers/commercial-source-fixture.cjs');
const {createStagingCommercialSource}=require('../backend/wallet-service/dist/orderCommercialSource');
const keys={WhizzMerchants_Businesses:['businessId'],WhizzMerchants_Products:['productId'],WhizzMerchants_Categories:['categoryId'],WizzCentral_Regions:['regionId'],'staging-MerchantPlatform':['pk','sk'],'staging-PlatformStaff':['pk','sk'],'staging-Wallets':['walletId','sk'],'staging-Holds':['orderId','sk'],'staging-AuditLog':['logId','sk'],'staging-LedgerEntries':['walletId','sk'],WizzOrders:['PK','SK']};
function identity(table,key){assert(keys[table],'UNREVIEWED_LOGICAL_TABLE');assert.deepEqual(Object.keys(key).sort(),[...keys[table]].sort());return keys[table].map(k=>[k,key[k]]);}
async function main(){
 assert(process.argv.includes('--execute-synthetic')&&process.env.AWS_PROFILE==='Wizz_stg_UserApp'&&process.env.AWS_REGION==='us-east-1');assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');
 const raw=new sdk.DynamoDBClient({region:'us-east-1'}),db=doc.DynamoDBDocumentClient.from(raw),table='staging-cod30-funding-'+crypto.randomBytes(8).toString('hex');let created=false;
 const report={scope:'REAL_DYNAMODB_ISOLATED_CANONICAL_COMMERCIAL_FUNDING',applicationTablesAccessed:false,humanFundsChanged:false,financialActivation:'OFF',results:[]};
 try{
  await raw.send(new sdk.CreateTableCommand({TableName:table,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'testPk',AttributeType:'S'},{AttributeName:'testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'testPk',KeyType:'HASH'},{AttributeName:'testSk',KeyType:'RANGE'}]}));created=true;await sdk.waitUntilTableExists({client:raw,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});
  for(const scenario of ['duplicate','approval-withdrawn','wallet-changed','insufficient']){
   const keyFor=(logical,key)=>({testPk:scenario+'|'+logical,testSk:JSON.stringify(identity(logical,key))});
   const originalKey=(logical,row)=>Object.fromEntries(keys[logical].map(k=>[k,row[k]]));
   const put=async(logical,row)=>db.send(new doc.PutCommand({TableName:table,Item:{...row,...keyFor(logical,originalKey(logical,row))}}));
   const get=async(logical,key)=>{const x=(await db.send(new doc.GetCommand({TableName:table,Key:keyFor(logical,key),ConsistentRead:true}))).Item;if(x){delete x.testPk;delete x.testSk;}return x;};
   const f=fixture();f.funded();for(const [ref,row] of f.records){const logical=ref.slice(0,ref.indexOf('|'));await put(logical,row);}
   const source=createStagingCommercialSource({now:()=>Date.parse('2026-10-15T12:00:01.000Z'),db:{async send(c){assert(c instanceof doc.GetCommand);assert(c.input.ConsistentRead);return {Item:await get(c.input.TableName,c.input.Key)};}}});
   const walletKey={walletId:'WALLET#PLATFORM',sk:'META'},orderKey={PK:'ORDER#o1',SK:'META'};
   if(scenario==='insufficient'){
    await put('staging-Wallets',{...await get('staging-Wallets',walletKey),availableBalance:499});
    await assert.rejects(source.prepare(f.input),e=>e.code==='DISCOUNT_FUNDING_UNAVAILABLE');assert.equal((await get('staging-Wallets',walletKey)).lockedBalance,0);report.results.push({scenario,rejectedBeforePlan:true});continue;
   }
   const plan=await source.prepare(f.input);assert.equal(plan.funding.amount.minorAmount,500000);
   const mapOperation=entry=>{const [kind]=Object.keys(entry),op=entry[kind];assert(['Put','Update','ConditionCheck'].includes(kind));const logical=op.TableName;
    if(kind==='Put')return {Put:{...op,TableName:table,Item:{...op.Item,...keyFor(logical,originalKey(logical,op.Item))}}};
    return {[kind]:{...op,TableName:table,Key:keyFor(logical,op.Key)}};};
   // The order absence fence shares the reservation transaction, as required by the canonical source contract.
   const operations=plan.operations.map(mapOperation);operations.push({Put:{TableName:table,Item:{...orderKey,...keyFor('WizzOrders',orderKey),financialSnapshot:plan.financialSnapshot,consentDigest:plan.digest},ConditionExpression:'attribute_not_exists(testPk)'}});
   const commit=()=>db.send(new doc.TransactWriteCommand({TransactItems:operations}));
   if(scenario==='duplicate'){
    const outcomes=await Promise.allSettled([commit(),commit()]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(outcomes.filter(x=>x.status==='rejected').map(x=>({name:x.reason.name,message:x.reason.message,reasons:x.reason.CancellationReasons?.map(r=>({Code:r.Code,Message:r.Message}))}))));const rejected=outcomes.find(x=>x.status==='rejected');assert.equal(rejected.reason.name,'TransactionCanceledException');
    const wallet=await get('staging-Wallets',walletKey);assert.equal(wallet.availableBalance,9500);assert.equal(wallet.lockedBalance,500);assert.equal(wallet.version,2);
    assert.equal((await get('staging-Holds',{orderId:'o1',sk:'PROMOTION_FUNDING'})).amount,500);assert.deepEqual((await get('WizzOrders',orderKey)).financialSnapshot,plan.financialSnapshot);
    const rows=(await db.send(new doc.QueryCommand({TableName:table,KeyConditionExpression:'testPk=:pk',ExpressionAttributeValues:{':pk':scenario+'|staging-LedgerEntries'},ConsistentRead:true}))).Items;assert.equal(rows.length,2);assert.equal(rows.reduce((s,r)=>s+r.amount,0),0);
    const audits=(await db.send(new doc.QueryCommand({TableName:table,KeyConditionExpression:'testPk=:pk',ExpressionAttributeValues:{':pk':scenario+'|staging-AuditLog'},ConsistentRead:true}))).Items;assert.equal(audits.length,1);
    report.results.push({scenario,successfulCommits:1,reservationCount:1,ledgerEntries:2,auditEvents:1,snapshotUnchanged:true});
   }else{
    if(scenario==='approval-withdrawn'){const k={pk:'COMMERCIAL_AGREEMENT#a1',sk:'APPROVAL#1'};await put('staging-PlatformStaff',{...await get('staging-PlatformStaff',k),status:'WITHDRAWN'});}
    else await put('staging-Wallets',{...await get('staging-Wallets',walletKey),version:2,availableBalance:9000});
    await assert.rejects(commit(),e=>e.name==='TransactionCanceledException');assert.equal(await get('WizzOrders',orderKey),undefined);assert.equal(await get('staging-Holds',{orderId:'o1',sk:'PROMOTION_FUNDING'}),undefined);assert.equal((await get('staging-Wallets',walletKey)).lockedBalance,0);report.results.push({scenario,entireTransactionRejected:true,noOrderOrReservation:true});
   }
  }
 }finally{
  if(created){await raw.send(new sdk.DeleteTableCommand({TableName:table}));await sdk.waitUntilTableNotExists({client:raw,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});report.tableDeleted=true;}raw.destroy();fs.writeFileSync('/private/tmp/cod30-funding-result.json',JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;});
