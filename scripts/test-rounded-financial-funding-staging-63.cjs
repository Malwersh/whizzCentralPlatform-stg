'use strict';
// Exercise the canonical commercial source against real, isolated DynamoDB. Never remap to application tables.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const sdk=require('../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb');
const doc=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {fixture}=require('../backend/wallet-service/test/helpers/commercial-source-fixture.cjs');
const {createStagingCommercialSource}={createStagingCommercialSource:require('./test-financial-reader-candidates-63.cjs').writer.createStagingCommercialSource};
const keys={WhizzMerchants_Businesses:['businessId'],WhizzMerchants_Products:['productId'],WhizzMerchants_Categories:['categoryId'],WizzCentral_Regions:['regionId'],'staging-MerchantPlatform':['pk','sk'],'staging-PlatformStaff':['pk','sk'],'staging-Wallets':['walletId','sk'],'staging-Holds':['orderId','sk'],'staging-AuditLog':['logId','sk'],'staging-LedgerEntries':['walletId','sk'],WizzOrders:['PK','SK']};
function identity(table,key){assert(keys[table],'UNREVIEWED_LOGICAL_TABLE');assert.deepEqual(Object.keys(key).sort(),[...keys[table]].sort());return keys[table].map(k=>[k,key[k]]);}
async function main(){
 assert(process.argv.includes('--execute-synthetic')&&!process.env.AWS_PROFILE&&!!process.env.AWS_ACCESS_KEY_ID&&process.env.AWS_REGION==='us-east-1');assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');
 const raw=new sdk.DynamoDBClient({region:'us-east-1'}),db=doc.DynamoDBDocumentClient.from(raw),table='staging-finance63-funding-'+crypto.randomBytes(8).toString('hex');let created=false;
 const report={scope:'REAL_DYNAMODB_ISOLATED_CANDIDATE_SCHEMA2_ROUNDED_FUNDING',applicationTablesAccessed:false,humanFundsChanged:false,financialActivation:'OFF',results:[]};
 try{
  await raw.send(new sdk.CreateTableCommand({TableName:table,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'testPk',AttributeType:'S'},{AttributeName:'testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'testPk',KeyType:'HASH'},{AttributeName:'testSk',KeyType:'RANGE'}]}));created=true;await sdk.waitUntilTableExists({client:raw,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});
  for(const scenario of ['duplicate','approval-withdrawn','wallet-changed','funding-changed','insufficient']){
   const keyFor=(logical,key)=>({testPk:scenario+'|'+logical,testSk:JSON.stringify(identity(logical,key))});
   const originalKey=(logical,row)=>Object.fromEntries(keys[logical].map(k=>[k,row[k]]));
   const put=async(logical,row)=>db.send(new doc.PutCommand({TableName:table,Item:{...row,...keyFor(logical,originalKey(logical,row))}}));
   const get=async(logical,key)=>{const x=(await db.send(new doc.GetCommand({TableName:table,Key:keyFor(logical,key),ConsistentRead:true}))).Item;if(x){delete x.testPk;delete x.testSk;}return x;};
   const f=fixture();f.funded();
   const {quoteHash}=require('../backend/wallet-service/dist/deliveryQuoteRecord');
   const policy=f.change('staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'}),agreement=f.change('staging-MerchantPlatform',{pk:'COMMERCIAL_AGREEMENT#a1',sk:'VERSION#1'});
   Object.assign(policy,{schemaVersion:2,merchantNumerator:1,denominator:3,merchantShareFinalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}});
   agreement.schemaVersion=2;agreement.fundingPolicySnapshots=[{id:'fp1',version:1,digest:quoteHash(policy)}];
   agreement.terms.commission={kind:'PERCENT',basis:'AFTER_MERCHANT_DISCOUNT',fixed:null,rate:{numerator:10,denominator:100},rounding:'HALF_AWAY_FROM_ZERO',finalRounding:{incrementIqd:1,mode:'HALF_AWAY_FROM_ZERO'}};
   agreement.termsHash=quoteHash({terms:agreement.terms,otherCharges:agreement.otherCharges,allowedFundingPolicyIds:agreement.allowedFundingPolicyIds,fundingPolicySnapshots:agreement.fundingPolicySnapshots});
   for(const [table,sk]of [['staging-MerchantPlatform','CURRENT'],['staging-MerchantPlatform','ACCEPTANCE#1'],['staging-PlatformStaff','APPROVAL#1']])f.change(table,{pk:agreement.pk,sk}).termsHash=agreement.termsHash;
   f.change('WhizzMerchants_Products',{productId:'p1'}).price=3499;f.input.quote.deliveryFeeMinor=2750000;f.input.tip={currency:'IQD',scale:1000,moneySchemaVersion:1,minorAmount:750000};
   for(const [ref,row] of f.records){const logical=ref.slice(0,ref.indexOf('|'));await put(logical,row);}
   const source=createStagingCommercialSource({now:()=>Date.parse('2026-10-15T12:00:01.000Z'),db:{async send(c){assert(c.constructor.name==='GetCommand'&&c.input.ConsistentRead===true);assert(c.input.ConsistentRead);return {Item:await get(c.input.TableName,c.input.Key)};}}});
   const walletKey={walletId:'WALLET#PLATFORM',sk:'META'},orderKey={PK:'ORDER#o1',SK:'META'};
   if(scenario==='insufficient'){
    await put('staging-Wallets',{...await get('staging-Wallets',walletKey),availableBalance:666});
    await assert.rejects(source.prepare(f.input),e=>e.code==='DISCOUNT_FUNDING_UNAVAILABLE');assert.equal((await get('staging-Wallets',walletKey)).lockedBalance,0);report.results.push({scenario,rejectedBeforePlan:true});continue;
   }
   const plan=await source.prepare(f.input);assert.equal(plan.funding.amount.minorAmount,667000);
   const allocation=require('./test-financial-reader-candidates-63.cjs').writer.allocateOrder({...plan.calculation.allocationInput,driverEarning:{currency:'IQD',scale:1000,moneySchemaVersion:1,minorAmount:2250000}});
   assert.equal(plan.calculation.customerTotal.minorAmount,6499000);assert.equal(allocation.merchantPayable.minorAmount,2849000);assert.equal(allocation.merchantCommission.minorAmount,317000);assert.equal(allocation.driverTotalEntitlement.minorAmount,3000000);assert.equal(allocation.driverWalletTipCredit.minorAmount,0);assert.equal(allocation.platformNetContribution.minorAmount,650000);
   const mapOperation=entry=>{const [kind]=Object.keys(entry),op=entry[kind];assert(['Put','Update','ConditionCheck'].includes(kind));const logical=op.TableName;
    if(kind==='Put')return {Put:{...op,TableName:table,Item:{...op.Item,...keyFor(logical,originalKey(logical,op.Item))}}};
    return {[kind]:{...op,TableName:table,Key:keyFor(logical,op.Key)}};};
   // The order absence fence shares the reservation transaction, as required by the canonical source contract.
   const operations=plan.operations.map(mapOperation);operations.push({Put:{TableName:table,Item:{...orderKey,...keyFor('WizzOrders',orderKey),financialSnapshot:plan.financialSnapshot,consentDigest:plan.digest},ConditionExpression:'attribute_not_exists(testPk)'}});
   const commit=()=>db.send(new doc.TransactWriteCommand({TransactItems:operations}));
   if(scenario==='duplicate'){
    const outcomes=await Promise.allSettled([commit(),commit()]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(outcomes.filter(x=>x.status==='rejected').map(x=>({name:x.reason.name,message:x.reason.message,reasons:x.reason.CancellationReasons?.map(r=>({Code:r.Code,Message:r.Message}))}))));const rejected=outcomes.find(x=>x.status==='rejected');assert.equal(rejected.reason.name,'TransactionCanceledException');
    const wallet=await get('staging-Wallets',walletKey);assert.equal(wallet.availableBalance,9333);assert.equal(wallet.lockedBalance,667);assert.equal(wallet.version,2);
    assert.equal((await get('staging-Holds',{orderId:'o1',sk:'PROMOTION_FUNDING'})).amount,667);assert.deepEqual((await get('WizzOrders',orderKey)).financialSnapshot,plan.financialSnapshot);
    const rows=(await db.send(new doc.QueryCommand({TableName:table,KeyConditionExpression:'testPk=:pk',ExpressionAttributeValues:{':pk':scenario+'|staging-LedgerEntries'},ConsistentRead:true}))).Items;assert.equal(rows.length,2);assert.equal(rows.reduce((s,r)=>s+r.amount,0),0);
    const audits=(await db.send(new doc.QueryCommand({TableName:table,KeyConditionExpression:'testPk=:pk',ExpressionAttributeValues:{':pk':scenario+'|staging-AuditLog'},ConsistentRead:true}))).Items;assert.equal(audits.length,1);
    report.results.push({scenario,successfulCommits:1,reservationCount:1,ledgerEntries:2,auditEvents:1,snapshotUnchanged:true});
   }else{
    if(scenario==='approval-withdrawn'){const k={pk:'COMMERCIAL_AGREEMENT#a1',sk:'APPROVAL#1'};await put('staging-PlatformStaff',{...await get('staging-PlatformStaff',k),status:'WITHDRAWN'});}
    else if(scenario==='funding-changed'){const k={pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'};await put('staging-PlatformStaff',{...await get('staging-PlatformStaff',k),version:2});}
    else await put('staging-Wallets',{...await get('staging-Wallets',walletKey),version:2,availableBalance:9000});
    await assert.rejects(commit(),e=>e.name==='TransactionCanceledException');assert.equal(await get('WizzOrders',orderKey),undefined);assert.equal(await get('staging-Holds',{orderId:'o1',sk:'PROMOTION_FUNDING'}),undefined);assert.equal((await get('staging-Wallets',walletKey)).lockedBalance,0);report.results.push({scenario,entireTransactionRejected:true,noOrderOrReservation:true});
   }
  }
 }finally{
  if(created){await raw.send(new sdk.DeleteTableCommand({TableName:table}));await sdk.waitUntilTableNotExists({client:raw,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});report.tableDeleted=true;}raw.destroy();fs.writeFileSync('/private/tmp/finance63/dynamodb-result.json',JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;});
