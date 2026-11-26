'use strict';
// Isolated DynamoDB contract test. Never targets an application table or human identity.
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {DynamoDBClient,CreateTableCommand,DeleteTableCommand,DescribeTableCommand}=require('../backend/staff-service/node_modules/@aws-sdk/client-dynamodb');
const sdk=require('../backend/staff-service/node_modules/@aws-sdk/lib-dynamodb');
const {service}=require('../backend/staff-service/commercial-management');
const table='staging-commercial-contract-test-60-'+randomUUID();
const raw=new DynamoDBClient({region:'us-east-1'}),db=sdk.DynamoDBDocumentClient.from(raw,{marshallOptions:{removeUndefinedValues:true}});
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses',D='WhizzMerchants_Discounts';
const mapKey=(t,k)=>({_testPk:t+'|'+(k.pk||k.businessId||k.discountId),_testSk:k.sk||'META'});
const itemKey=(t,r)=>mapKey(t,t===B?{businessId:r.businessId}:t===D?{discountId:r.discountId}:{pk:r.pk,sk:r.sk});
const clean=r=>r?Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('_test'))):r;
const put=async(t,r)=>db.send(new sdk.PutCommand({TableName:table,Item:{...r,...itemKey(t,r)}}));
const get=async(t,k)=>clean((await db.send(new sdk.GetCommand({TableName:table,Key:mapKey(t,k),ConsistentRead:true}))).Item);
let interfere=null;
const isolated={send:async c=>{const x=c.input;
 if(c instanceof sdk.GetCommand)return {Item:await get(x.TableName,x.Key)};
 if(c instanceof sdk.QueryCommand){const r=await db.send(new sdk.QueryCommand({TableName:table,KeyConditionExpression:'#p=:p AND begins_with(#s,:s)',ExpressionAttributeNames:{'#p':'_testPk','#s':'_testSk'},ExpressionAttributeValues:{':p':x.TableName+'|'+x.ExpressionAttributeValues[':pk'],':s':x.ExpressionAttributeValues[':p']},ConsistentRead:true,Limit:x.Limit,...(x.ExclusiveStartKey?{ExclusiveStartKey:x.ExclusiveStartKey}:{})}));return {Items:r.Items?.map(clean),LastEvaluatedKey:r.LastEvaluatedKey};}
 if(!(c instanceof sdk.TransactWriteCommand))throw Error('UNSUPPORTED_TEST_COMMAND');
 if(interfere){const fn=interfere;interfere=null;await fn();}
 const ops=x.TransactItems.map(op=>{const [kind,v]=Object.entries(op)[0],k=v.Key?mapKey(v.TableName,v.Key):null;return {[kind]:{...v,TableName:table,...(k?{Key:k}:{Item:{...v.Item,...itemKey(v.TableName,v.Item)}})}};});
 return db.send(new sdk.TransactWriteCommand({TransactItems:ops}));
}};
const staff=(id,role)=>({kind:'STAFF',actor:{employeeId:id,roles:[role],version:1,status:'ACTIVE',scope:{allRegions:true}}}),editor=staff('synthetic-editor','commercial_editor'),reviewer=staff('synthetic-reviewer','commercial_approver'),owner={kind:'OWNER',sub:'synthetic-owner'};
const ctx={enabled:true,db:isolated,enrolled:true,claims:{},recent:()=>{},employee:id=>get(S,{pk:'EMPLOYEE#'+id,sk:'PROFILE'}),guard:a=>({ConditionCheck:{TableName:S,Key:{pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'},ConditionExpression:'#v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':a.version,':s':'ACTIVE'}}}),audit:(actorId,action,before,after,id)=>({Put:{TableName:S,Item:{pk:'AUDIT',sk:id,actorId,action,before,after},ConditionExpression:'attribute_not_exists(pk)'}})};
const rounding={incrementIqd:1,mode:'HALF_AWAY_FROM_ZERO'},fixed={kind:'FIXED',basis:null,rate:null,fixed:{currency:'IQD',scale:1000,moneySchemaVersion:1,minorAmount:500000},rounding:'EXACT',finalRounding:rounding};
const save=(id)=>({businessId:'synthetic-branch',id,action:'SAVE_AGREEMENT',requestId:randomUUID(),draftVersion:0,baseVersion:0,businessIds:['synthetic-branch'],reason:'isolated contract test',values:{scope:'BRANCH',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,commission:{kind:'PERCENT',basis:'AFTER_MERCHANT_DISCOUNT',fixed:null,rate:{numerator:10,denominator:100},rounding:'HALF_AWAY_FROM_ZERO',finalRounding:rounding},serviceFee:fixed,allowedFundingPolicyIds:[]}});
const call=(who,input)=>service(ctx,who,'POST',input);
const decision=(body,r,action)=>({businessId:body.businessId,id:body.id,action,requestId:randomUUID(),draftVersion:r.draftVersion,baseVersion:0,hash:r.hash,...(action==='ACCEPT_AGREEMENT'?{}:{reason:'isolated independent approval'})});
async function wait(state){for(let n=0;n<60;n++){try{const r=await raw.send(new DescribeTableCommand({TableName:table}));if(state==='ACTIVE'&&r.Table.TableStatus==='ACTIVE')return;}catch(e){if(state==='DELETED'&&e.name==='ResourceNotFoundException')return;throw e;}await new Promise(r=>setTimeout(r,1000));}throw Error('TABLE_WAIT_TIMEOUT');}
(async()=>{const result={part:60,isolatedTable:table,applicationTableWrites:0,humanWrites:0,financialWrites:0};let created=false;
 try{
  await raw.send(new CreateTableCommand({TableName:table,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await wait('ACTIVE');
  for(const a of [editor,reviewer])await put(S,{pk:'EMPLOYEE#'+a.actor.employeeId,sk:'PROFILE',...a.actor});
  const branch={businessId:'synthetic-branch',ownerId:owner.sub,cognitoUserId:owner.sub,organizationId:'synthetic-org',status:'approved'};await put(B,branch);await put(P,{pk:'PERSON#'+owner.sub,sk:'ORGANIZATION#synthetic-org',subjectId:owner.sub,organizationId:'synthetic-org'});
  const body=save('agreement-one'),r=await call(editor,body);assert.equal((await call(editor,body)).replayed,true);result.idempotentDraft=true;
  await assert.rejects(call(reviewer,decision(body,r,'APPROVE_AGREEMENT')),/OWNER_ACCEPTANCE_REQUIRED/);
  await call(owner,decision(body,r,'ACCEPT_AGREEMENT'));assert.equal(await get(P,{pk:'COMMERCIAL_AGREEMENT#agreement-one',sk:'CURRENT'}),undefined);
  const out=await Promise.allSettled([call(reviewer,decision(body,r,'APPROVE_AGREEMENT')),call(reviewer,decision(body,r,'APPROVE_AGREEMENT'))]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);result.concurrentApprovalOnce=true;
  const published=await get(P,{pk:'COMMERCIAL_AGREEMENT#agreement-one',sk:'VERSION#1'});assert.equal(published.schemaVersion,2);assert.equal((await get(B,{businessId:branch.businessId})).commercialAgreementVersion,1);result.canonicalPublication=true;
  const second=save('agreement-two'),r2=await call(editor,second);interfere=()=>put(B,{...awaitBranch(),ownerId:'intruder'});
  function awaitBranch(){return {...branch,commercialAgreementId:'agreement-one',commercialAgreementVersion:1,commercialUpdatedAt:'2026-10-17T00:00:00.000Z'};}
  await assert.rejects(call(owner,decision(second,r2,'ACCEPT_AGREEMENT')),/VERSION_OR_STATE_CONFLICT/);assert.equal(await get(P,{pk:'COMMERCIAL_AGREEMENT#agreement-two',sk:'CONSENT#1'}),undefined);result.concurrentOwnershipFence=true;
  await put(B,awaitBranch());await put(D,{discountId:'synthetic-campaign',businessId:branch.businessId,version:2,status:'inactive'});
  const funding={businessId:branch.businessId,id:'funding-one',action:'SAVE_FUNDING',requestId:randomUUID(),draftVersion:0,baseVersion:0,businessIds:[branch.businessId],reason:'isolated funding test',values:{campaignId:'synthetic-campaign',campaignVersion:2,source:'MERCHANT',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:'2026-11-01T00:00:00.000Z',merchantNumerator:1,denominator:2,merchantShareFinalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}}};
  const f=await call(editor,funding);await call(reviewer,decision(funding,f,'APPROVE_FUNDING'));assert.equal((await get(D,{discountId:'synthetic-campaign'})).fundingPolicyVersion,1);assert.equal((await get(S,{pk:'DISCOUNT_FUNDING#funding-one',sk:'CURRENT'})).merchantNumerator,1);result.atomicCampaignPolicyBinding=true;
  const list=await service(ctx,owner,'GET',{businessId:branch.businessId});assert.equal(list.items.length,2);result.ownerReadProjection=true;
 }finally{if(created){await raw.send(new DeleteTableCommand({TableName:table}));await wait('DELETED');result.tableDeleted=true;}fs.writeFileSync('/private/tmp/finance60/dynamodb-test.json',JSON.stringify(result,null,2),{mode:0o600});}
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.name,e.message);process.exitCode=1;});
