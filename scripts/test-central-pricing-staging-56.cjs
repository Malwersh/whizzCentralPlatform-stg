'use strict';
// One disposable table with the real staff pk/sk schema; never the live staff table.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {DynamoDBClient,CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=require('../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,PutCommand}=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const service=require('../backend/staff-service/delivery-pricing');
async function main(){
 assert(process.argv.includes('--execute-synthetic')&&process.env.AWS_PROFILE==='Wizz_stg_UserApp');
 const low=new DynamoDBClient({region:'us-east-1'}),sts=new STSClient({region:'us-east-1'}),db=DynamoDBDocumentClient.from(low,{marshallOptions:{removeUndefinedValues:true}});
 const table='staging-pricing56-test-'+crypto.randomBytes(8).toString('hex');let created=false;const report={realDynamoDB:true,humanRowsRead:false,livePricingChanged:false,financialWrites:false};
 try{
  assert.equal((await sts.send(new GetCallerIdentityCommand({}))).Account,'699561669180');
  await low.send(new CreateTableCommand({TableName:table,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'pk',AttributeType:'S'},{AttributeName:'sk',AttributeType:'S'}],KeySchema:[{AttributeName:'pk',KeyType:'HASH'},{AttributeName:'sk',KeyType:'RANGE'}],Tags:[{Key:'Purpose',Value:'disposable-pricing56-verification'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});
  const actor=(id,roles)=>({employeeId:id,roles,version:1,status:'ACTIVE',scope:{allRegions:true,regionIds:[]}}),editor=actor('synthetic-editor',['pricing_editor','pricing_approver']),reviewer=actor('synthetic-reviewer',['pricing_approver']);
  for(const a of [editor,reviewer])await db.send(new PutCommand({TableName:table,Item:{...a,pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'}}));
  const ctx={db,table,enrolled:true,recent(){},claims:{},employee:async id=>(await db.send(new GetCommand({TableName:table,Key:{pk:'EMPLOYEE#'+id,sk:'PROFILE'},ConsistentRead:true}))).Item,
   guard:a=>({ConditionCheck:{TableName:table,Key:{pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'},ConditionExpression:'#v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':a.version,':s':'ACTIVE'}}}),
   audit:(id,action,before,after,uuid)=>({Put:{TableName:table,Item:{pk:'AUDIT',sk:uuid,actorId:id,action,before,after}}})};
  const m=n=>require('../backend/staff-service/pricing-runtime/money').parseIqd(String(n)),common={id:'synthetic',version:1,scope:{type:'GLOBAL',id:'GLOBAL'},priority:1,status:'DRAFT',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,rounding:'HALF_AWAY_FROM_ZERO',vehicleType:null,base:m(1000),minimum:m(0),maximum:m(20000),fallbackPolicyId:null,longDistance:{afterMeters:10000,flat:m(0),perKm:m(0)},peaks:[]};
  const values={deliveryRules:[{...common,perKm:m(500),tiers:[],coverage:{enabled:true,maxRoadMeters:30000,maxDurationSeconds:3600,supportedZoneIds:['synthetic-zone']}}],driverRules:[{...common,pickupPerKm:m(100),pickupIncludedMeters:1000,deliveryPerKm:m(200),perMinute:m(50)}]};
  const call=(a,suffix,body)=>service.route(ctx,a,'POST',service.PATH+suffix,body);
  const request={baseVersion:0,draftVersion:0,reason:'Synthetic test fixture only',values};
  assert.equal((await call(editor,'/draft',request)).status,'DRAFT_SAVED');report.atomicDraft=true;
  const publish={baseVersion:0,draftVersion:1,reason:'Synthetic independent review'};
  await assert.rejects(call(editor,'/publish',publish),/SELF_APPROVAL/);report.selfApprovalRejected=true;
  await db.send(new PutCommand({TableName:table,Item:{...editor,status:'SUSPENDED',pk:'EMPLOYEE#'+editor.employeeId,sk:'PROFILE'}}));await assert.rejects(call(reviewer,'/publish',publish),/REQUESTER_PERMISSION_REVOKED/);report.revokedRequesterRejected=true;
  await db.send(new PutCommand({TableName:table,Item:{...editor,pk:'EMPLOYEE#'+editor.employeeId,sk:'PROFILE'}}));
  assert.equal((await call(reviewer,'/publish',publish)).status,'PUBLISHED');report.independentPublication=true;
  await assert.rejects(call(reviewer,'/publish',publish),/VERSION_OR_STATE/);report.repeatedPublicationRejected=true;
  const leg={id:'synthetic',source:'ADMIN_SIMULATION',quality:'ROAD',fallbackPolicyId:null,distanceMeters:2000,durationSeconds:600,measuredAt:'2026-10-15T12:00:00.000Z',expiresAt:'2026-10-15T12:10:00.000Z'};
  const sim=await call(editor,'/simulate',{source:'CURRENT',version:1,at:leg.measuredAt,context:{branchId:'synthetic-branch',merchantId:'synthetic-merchant',zoneId:'synthetic-zone',cityId:'city',governorateId:'gov',vehicleType:'BIKE'},pickupRoute:leg,deliveryRoute:leg});assert.equal(sim.delivery.customerDeliveryFee.minorAmount,2000000);assert.equal(sim.driver.driverEarning.minorAmount,2500000);report.sameEngineSimulation=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:table}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:table});report.tableDeleted=true;}low.destroy();sts.destroy();fs.writeFileSync('/private/tmp/finance56/pricing-dynamodb.json',JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(JSON.stringify({error:e.name||'PRICING_TEST_FAILED',code:e.code}));process.exitCode=1;});
