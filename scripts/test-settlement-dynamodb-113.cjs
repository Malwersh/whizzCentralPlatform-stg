'use strict';
// Real DynamoDB conditions in one disposable table; no production application
// table is read or written. Logical table names are mapped to isolated keys.
const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),{randomUUID}=require('node:crypto');
const raw=require('../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb');
const sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const {createMerchantSettlementScheduleWorkflow:create}=require('../backend/wallet-service/dist/merchantSettlementScheduleWorkflow');
const {createMerchantSettlementScheduleHistoryReader:history}=require('../backend/wallet-service/dist/merchantSettlementScheduleHistory');
const {settlementRetention}=require('../backend/account-deletion/settlement-retention');
const {fixture}=require('../backend/wallet-service/test/helpers/merchant-settlement-schedule-fixture.cjs');
const directory='/private/tmp/finance113',table='staging-settlement-validation-113-'+randomUUID();
const credentials=JSON.parse(cp.execFileSync('aws',['configure','export-credentials','--profile','Wizz_stg_UserApp','--format','process'],{stdio:['ignore','pipe','pipe']}));
const client=new raw.DynamoDBClient({region:'us-east-1',credentials:{accessKeyId:credentials.AccessKeyId,secretAccessKey:credentials.SecretAccessKey,sessionToken:credentials.SessionToken}});
const document=sdk.DynamoDBDocumentClient.from(client,{marshallOptions:{removeUndefinedValues:true}});
const S='staging-PlatformStaff',P='staging-MerchantPlatform',B='WhizzMerchants_Businesses',D='staging-AccountDeletion';
const maker='11111111-1111-4111-8111-111111111111',reviewer='22222222-2222-4222-8222-222222222222';
const physical=(name,key)=>({__pk:name+'|'+String(key.pk??key.businessId??key.orderId??key.operationId??key.walletId),__sk:String(key.sk??key.SK??'_')});
const itemKey=(name,row)=>name===B?{businessId:row.businessId}:{pk:row.pk,sk:row.sk};
const strip=row=>{if(!row)return undefined;const {__pk,__sk,...rest}=row;return rest;};
const db={async send(command){const q=command.input,name=command.constructor.name;
 if(name==='GetCommand'){const out=await document.send(new sdk.GetCommand({...q,TableName:table,Key:physical(q.TableName,q.Key)}));return {Item:strip(out.Item)};}
 if(name==='QueryCommand'){const pk=q.ExpressionAttributeValues[':pk'],prefix=q.ExpressionAttributeValues[':prefix'];const out=await document.send(new sdk.QueryCommand({TableName:table,ConsistentRead:true,Limit:q.Limit||100,KeyConditionExpression:'#p=:p'+(prefix?' AND begins_with(#s,:s)':''),ExpressionAttributeNames:{'#p':'__pk',...(prefix?{'#s':'__sk'}:{})},ExpressionAttributeValues:{':p':q.TableName+'|'+pk,...(prefix?{':s':prefix}:{})},...(q.ExclusiveStartKey?{ExclusiveStartKey:q.ExclusiveStartKey}:{})}));return {Items:out.Items?.map(strip),LastEvaluatedKey:out.LastEvaluatedKey};}
 if(name==='TransactWriteCommand'){const operations=q.TransactItems.map(op=>{if(op.Put){const p=op.Put;return {Put:{...p,TableName:table,Item:{...p.Item,...physical(p.TableName,itemKey(p.TableName,p.Item))}}};}if(op.ConditionCheck){const c=op.ConditionCheck;return {ConditionCheck:{...c,TableName:table,Key:physical(c.TableName,c.Key)}};}throw Error('UNSUPPORTED_TEST_OPERATION');});return document.send(new sdk.TransactWriteCommand({TransactItems:operations}));}
 throw Error('UNSUPPORTED_TEST_COMMAND');
}};
const put=(name,row)=>document.send(new sdk.PutCommand({TableName:table,Item:{...row,...physical(name,itemKey(name,row))}}));
async function main(){let created=false;const proof={table,existingApplicationTablesTouched:false,balancesChanged:false,awsIamChanged:false};
 try{
  await client.send(new raw.CreateTableCommand({TableName:table,BillingMode:'PAY_PER_REQUEST',KeySchema:[{AttributeName:'__pk',KeyType:'HASH'},{AttributeName:'__sk',KeyType:'RANGE'}],AttributeDefinitions:[{AttributeName:'__pk',AttributeType:'S'},{AttributeName:'__sk',AttributeType:'S'}]}));created=true;
  await raw.waitUntilTableExists({client,maxWaitTime:45,minDelay:1,maxDelay:2},{TableName:table});
  const f=fixture();for(const [key,row]of f.rows)await put(key.split('|')[0],row);
  let clock=Date.now();const staff=id=>create({db,principal:{kind:'STAFF',employeeId:id,authTime:Math.floor(clock/1000),mfaEnrolled:true},now:()=>clock});const owner=create({db,principal:{kind:'OWNER',subjectId:'owner1'},now:()=>clock});
  const body=f.input({effectiveFrom:'2030-10-02T21:00:00.000Z',schedule:{timezone:'Asia/Baghdad',frequency:'WEEKLY',anchorLocalDate:'2030-10-03'}});
  const proposed=await staff(maker).propose(body),decision={branchId:'branch1',proposalId:body.proposalId,proposalDigest:proposed.proposal.proposalDigest};
  await owner.consent(decision);const approved=await staff(reviewer).approve(decision);assert.equal(approved.current.schedule.version,1);assert.equal((await staff(reviewer).approve(decision)).replayed,true);proof.proposalConsentApprovalAndReplay=true;
  assert.equal((await history(db)('branch1','2030-10-04T12:00:00.000Z')).schedule.version,1);proof.actualVersionQueryAndProjection=true;
  // Competing proposals approved against one live base must produce exactly one
  // publication. The loser cannot partially write its version/current/audit.
  clock=Date.parse('2030-10-04T12:00:00.000Z');
  const next=()=>f.input({baseVersion:1,effectiveFrom:'2030-10-09T21:00:00.000Z',schedule:{timezone:'Asia/Baghdad',frequency:'WEEKLY',anchorLocalDate:'2030-10-03'}});
  const choices=[];for(const input of [next(),next()]){const p=await staff(maker).propose(input);const d={branchId:'branch1',proposalId:input.proposalId,proposalDigest:p.proposal.proposalDigest};await owner.consent(d);choices.push(d);}
  const outcomes=await Promise.allSettled(choices.map(v=>staff(reviewer).approve(v)));assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);proof.concurrentApprovalsSingleWinner=true;
  assert.equal((await history(db)('branch1','2030-10-04T12:00:00.000Z')).schedule.version,1);assert.equal((await history(db)('branch1','2030-10-10T12:00:00.000Z')).schedule.version,2);proof.historicalCutoverPreservesVersion=true;
  const requestId=randomUUID(),r={pk:'SUBJECT#MERCHANT#owner1',sk:'REQUEST#'+requestId,requestId,subjectId:'owner1',actorType:'MERCHANT',scope:{kind:'BUSINESS',id:'branch1'},status:'PROCESSING',version:2,leaseOwner:'validation-worker',leaseUntil:Math.floor(clock/1000)+600};
  const b=(await db.send(new sdk.GetCommand({TableName:B,Key:{businessId:'branch1'}}))).Item;
  await put(B,{...b,deletionRequestId:requestId});await put(D,r);await put(D,{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch1',sk:'META',requestId,subjectId:'owner1',businessId:'branch1'});
  const job={requestId,subjectId:'owner1',businessId:'branch1',financialYears:7,policyVersion:3};const run=()=>settlementRetention({db,r,job,clock:()=>new Date(clock).toISOString()});
  const archived=await run();assert(archived.archived>=12);assert.equal((await run()).archived,0);proof.immutableArchivesAndRetry=true;proof.archivedRecords=archived.archived;
 }finally{
  if(created){await client.send(new raw.DeleteTableCommand({TableName:table}));await raw.waitUntilTableNotExists({client,maxWaitTime:45,minDelay:1,maxDelay:2},{TableName:table});proof.temporaryTableDeleted=true;}
  fs.writeFileSync(directory+'/dynamodb-verification.json',JSON.stringify(proof,null,2),{mode:0o600});
 }
 console.log(JSON.stringify(proof));
}
main().catch(e=>{console.error(JSON.stringify({verificationPassed:false,name:e.name,code:e.code||e.message}));process.exitCode=1;});
