#!/usr/bin/env node
'use strict';
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module'),path=require('node:path');
const req=createRequire(path.resolve(__dirname,'../backend/account-deletion/package.json'));
const {DynamoDBClient}=req('@aws-sdk/client-dynamodb'),{DynamoDBDocumentClient,ScanCommand}=req('@aws-sdk/lib-dynamodb');
const {gate,assertQuarantine}=require('../backend/account-deletion/restore-gate');
async function main(){
 const table=process.argv[2];assertQuarantine(table);
 const profile=process.env.AWS_PROFILE||'Wizz_stg_UserApp';
 const account=execFileSync('aws',['sts','get-caller-identity','--profile',profile,'--query','Account','--output','text'],{encoding:'utf8'}).trim();if(account!=='699561669180')throw Error('ENVIRONMENT_NOT_ALLOWED');
 process.env.AWS_PROFILE=profile;
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}));
 async function rows(name){let all=[],cursor,pages=0;do{if(++pages>1000)throw Error('RESTORE_INVENTORY_INCOMPLETE');const r=await db.send(new ScanCommand({TableName:name,ConsistentRead:true,ExclusiveStartKey:cursor}));all.push(...r.Items||[]);cursor=r.LastEvaluatedKey;}while(cursor);return all;}
 const journal=await rows('staging-AccountDeletion'),staff=await rows('staging-PlatformStaff'),restored=await rows(table);
 const result=gate({table,rows:restored,journal,staff});console.log(JSON.stringify({table,...result}));if(!result.passed)process.exitCode=2;
}
main().catch(e=>{console.error(JSON.stringify({passed:false,error:e.code||e.name||'RESTORE_FAILED'}));process.exitCode=1;});
