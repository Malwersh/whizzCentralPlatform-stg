'use strict';
// Existing test campaigns gain an explicit content version; no value, usage, status or financial binding is assigned.
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {DynamoDBClient,ScanCommand}=require('@aws-sdk/client-dynamodb'),sdk=require('@aws-sdk/lib-dynamodb');
const {digest,fence}=require('../backend/src/utils/campaign-version');
const path='/private/tmp/finance62/',tables=['WhizzMerchants_Discounts','WizzCentral_Platform_Discounts'],raw=new DynamoDBClient({region:'us-east-1'}),db=sdk.DynamoDBDocumentClient.from(raw,{marshallOptions:{removeUndefinedValues:true}});
const plain=v=>v===null||['string','boolean','number'].includes(typeof v)||Array.isArray(v)&&v.every(plain)||v&&Object.getPrototypeOf(v)===Object.prototype&&Object.values(v).every(plain);
const get=async(t,k)=>(await db.send(new sdk.GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
const reason=r=>r.version!==undefined?(Number.isSafeInteger(r.version)&&r.version>0?'ALREADY_VERSIONED':'INVALID_VERSION'):r.legalHold===true||r.retentionHold===true?'RETENTION_HOLD':r.fundingPolicyId!==undefined||r.fundingPolicyVersion!==undefined?'UNVERSIONED_FUNDING_BINDING':!plain(r)?'UNSUPPORTED_RECORD_TYPE':typeof r.discountId!=='string'||!r.discountId?'INVALID_KEY':'ELIGIBLE';
async function rows(t){let all=[],cursor;for(let i=0;i<100;i++){const p=await db.send(new sdk.ScanCommand({TableName:t,ConsistentRead:true,Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));all.push(...p.Items||[]);cursor=p.LastEvaluatedKey;if(!cursor)return all;}throw Error('CAMPAIGN_INVENTORY_INCOMPLETE');}
(async()=>{assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');const mode=process.argv[2];assert(['inventory','apply','verify'].includes(mode));if(mode==='inventory'){
 assert(!fs.existsSync(path+'campaign-inventory.private.json'),'INVENTORY_EXISTS');const source=[];for(const table of tables)for(const row of await rows(table))source.push({table,discountId:row.discountId,reason:reason(row),...(plain(row)?{row,sourceDigest:digest(row)}:{})});fs.writeFileSync(path+'campaign-inventory.private.json',JSON.stringify({part:62,atUtc:new Date().toISOString(),source},null,2),{mode:0o600});console.log(JSON.stringify({campaigns:source.length,counts:source.reduce((a,r)=>(a[r.reason]=(a[r.reason]||0)+1,a),{})}));return;}
 const publication=JSON.parse(fs.readFileSync(path+'publication.json'));assert(publication.browserWritesClosed&&publication.verifiedAtUtc&&publication.activationPerformed===false);const plan=JSON.parse(fs.readFileSync(path+'campaign-inventory.private.json'));assert(plan.source.every(x=>tables.includes(x.table)));
 const report=fs.existsSync(path+'campaign-adoption.json')?JSON.parse(fs.readFileSync(path+'campaign-adoption.json')):{part:62,environment:'Staging',systemActor:'SYSTEM_RELEASE_62',applicationBalanceWrites:0,fieldsWritten:['version'],rows:[]};
 if(mode==='apply')for(const original of plan.source){
  if(report.rows.some(x=>x.table===original.table&&x.discountId===original.discountId))continue;
  const row=await get(original.table,{discountId:original.discountId});let status=row?reason(row):'REMOVED';
  if(status==='ELIGIBLE'){
   const auditId=randomUUID(),createdAt=new Date().toISOString(),sourceDigest=digest(row),next={...row,version:1};
   await db.send(new sdk.TransactWriteCommand({ClientRequestToken:auditId,TransactItems:[{Update:{TableName:original.table,Key:{discountId:row.discountId},...fence(row),UpdateExpression:'SET #adoptVersion=:adoptVersion',ExpressionAttributeNames:{...fence(row).ExpressionAttributeNames,'#adoptVersion':'version'},ExpressionAttributeValues:{...fence(row).ExpressionAttributeValues,':adoptVersion':1}}},{Put:{TableName:'staging-PlatformStaff',Item:{pk:'AUDIT',sk:createdAt+'#'+auditId,actorId:'SYSTEM_RELEASE_62',action:'CAMPAIGN_VERSION_ADOPTED',before:{table:original.table,discountId:row.discountId,sourceDigest},after:{version:1,sourceDigest:digest(next)}},ConditionExpression:'attribute_not_exists(pk)'}}]}));status='ADOPTED';
  }
  report.rows.push({table:original.table,discountId:original.discountId,status});fs.writeFileSync(path+'campaign-adoption.json',JSON.stringify(report,null,2),{mode:0o600});
 }
 if(mode==='verify'){
  const all=[];for(const table of tables)for(const row of await rows(table))all.push({table,discountId:row.discountId,status:reason(row)});report.verification={atUtc:new Date().toISOString(),counts:all.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),unversioned:all.filter(x=>x.status!=='ALREADY_VERSIONED'),total:all.length};fs.writeFileSync(path+'campaign-adoption.json',JSON.stringify(report,null,2),{mode:0o600});
 }
 console.log(JSON.stringify({adoptionStatuses:report.rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),verification:report.verification||null,applicationBalanceWrites:0}));
})().catch(e=>{console.error(e.name,e.message);process.exitCode=1;});
