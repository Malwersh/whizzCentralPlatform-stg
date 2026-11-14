'use strict';
// Explicit manual integration test. Uses isolated fixture keys, never application accounts.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,PutCommand,GetCommand,QueryCommand,DeleteCommand}=require('@aws-sdk/lib-dynamodb');
const {dynamoStore}=require('../store');
(async()=>{
 const profile='Wizz_stg_UserApp';const identity=JSON.parse(execFileSync('aws',['sts','get-caller-identity','--profile',profile],{encoding:'utf8'}));assert.equal(identity.Account,'699561669180');
 const v=JSON.parse(execFileSync('aws',['configure','export-credentials','--profile',profile,'--format','process'],{encoding:'utf8'}));
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1',credentials:{accessKeyId:v.AccessKeyId,secretAccessKey:v.SecretAccessKey,sessionToken:v.SessionToken}}));
 const table='staging-AccountDeletion',sub='FIXTURE_'+randomUUID(),id=randomUUID(),pk='SUBJECT#CUSTOMER#'+sub,actor={type:'CUSTOMER',sub};
 const record={pk,sk:'REQUEST#'+id,requestId:id,subjectId:sub,actorType:'CUSTOMER',status:'PROCESSING',scope:{kind:'ACCOUNT',id:sub},version:1,job:{fixture:true},requiredSteps:['data'],testFixture:true};
 let count=0;const time=Math.floor(Date.now()/1000),a=dynamoStore({table,db,clock:()=>time}),b=dynamoStore({table,db,clock:()=>time+200});
 await db.send(new PutCommand({TableName:table,Item:record,ConditionExpression:'attribute_not_exists(pk)'}));
 try{
  const locked=await a.acquireLease(record);assert.equal(locked.version,2);count++;
  await assert.rejects(a.acquireLease(record));count++;
  const renewed=await a.renewLease(locked);assert.equal(renewed.version,3);count++;
  await a.completeStep(renewed,'data',new Date().toISOString());assert.equal((await a.steps(renewed)).data.status,'COMPLETED');count++;
  const takeover=await b.acquireLease(renewed);assert.notEqual(takeover.leaseOwner,renewed.leaseOwner);
  await assert.rejects(a.completeStep(renewed,'data',new Date().toISOString()));count++;
  await a.releaseLease(renewed);const current=await b.get(actor,id);assert.equal(current.leaseOwner,takeover.leaseOwner);count++;
  await b.releaseLease(current);assert.equal((await b.get(actor,id)).leaseOwner,undefined);count++;
  console.log(JSON.stringify({integration:'real DynamoDB request storage',passed:count,applicationAccountsModified:0}));
 }finally{
  const rows=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':pk},ConsistentRead:true}));
  for(const row of rows.Items||[]){assert.equal(row.pk,pk);await db.send(new DeleteCommand({TableName:table,Key:{pk:row.pk,sk:row.sk}}));}
 }
})().catch(e=>{console.error('Staging storage integration failed:',e.name);process.exitCode=1;});
