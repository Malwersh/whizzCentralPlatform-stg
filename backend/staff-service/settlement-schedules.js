'use strict';
const {GetCommand,QueryCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const {createMerchantSettlementAuthority,createMerchantSettlementScheduleWorkflow,createMerchantStatementsAdmin,createMerchantPeriodCollection}=require('./settlement-runtime');
const {allowed}=require('./catalog');
const {operator}=require('./write-workflow');
const P='staging-MerchantPlatform',B='WhizzMerchants_Businesses',D='staging-AccountDeletion';
const fail=(code,status)=>{throw Object.assign(Error(code),{status});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
async function wrap(ctx,run){if(ctx.enabled!==true)fail('SETTLEMENT_SCHEDULE_ADMIN_DISABLED',503);try{return await run();}catch(e){if(e.status)throw e;const code=e.code||e.message;
 const status=/PERMISSION|OWNER_REQUIRED|PRINCIPAL|INDEPENDENT|EMPLOYEE|REAUTH/.test(code)?403:/NOT_FOUND/.test(code)?404:/CONFLICT|UNKNOWN_OUTCOME|CHANGED|REVOKED/.test(code)?409:/INVALID|BOUNDARY|CONSENT_REQUIRED|AGREEMENT_UNAVAILABLE|BASE_VERSION/.test(code)?400:503;
 fail(/^(?:PAYOUT_|SCHEDULE_|SETTLEMENT_|MERCHANT_PAYABLE_ALREADY_IN_SETTLEMENT$|MERCHANT_ACCRUAL_OUTSIDE_PERIOD$|INVALID_MERCHANT_(?:SETTLEMENT|OPENING)_PERIOD$)/.test(code)?code:'SETTLEMENT_SCHEDULE_UNAVAILABLE',status);
}}
async function get(db,table,key){return (await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true,...(table===D?{ProjectionExpression:'#pk,#sk',ExpressionAttributeNames:{'#pk':'pk','#sk':'sk'}}:{})}))).Item;}
async function branch(db,branchId){if(!id(branchId))fail('INVALID_SCHEDULE_REQUEST',400);const b=await get(db,B,{businessId:branchId});if(!b||b.ownerId!==b.cognitoUserId||b.status!=='approved'||b.deletedAt!=null||b.deletionRequestId!=null||b.isDeleted===true)fail('SCHEDULE_BRANCH_UNAVAILABLE',404);
 for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+b.ownerId])if(await get(db,D,{pk,sk:'META'}))fail('SCHEDULE_BRANCH_UNAVAILABLE',404);return b;}
async function list(db,branchId){let cursor;const rows=[];for(let page=0;page<10;page++){const out=await db.send(new QueryCommand({TableName:P,ConsistentRead:true,Limit:100,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':'BRANCH#'+branchId,':prefix':'SETTLEMENT_SCHEDULE#'},...(cursor?{ExclusiveStartKey:cursor}:{})}));rows.push(...out.Items||[]);cursor=out.LastEvaluatedKey;if(!cursor)return rows;}fail('SCHEDULE_HISTORY_INCOMPLETE',503);}
const present=row=>{if(!row)return null;const {pk,sk,requestHash,...body}=row;return body;};
async function branches(ctx,actor,method,input){return wrap(ctx,async()=>{
 if(method!=='GET'||Object.keys(input||{}).length)fail('INVALID_SCHEDULE_REQUEST',400);
 const authorize=async()=>{const employee=await get(ctx.db,'staging-PlatformStaff',{pk:'EMPLOYEE#'+actor.employeeId,sk:'PROFILE'});
  if(!Number.isSafeInteger(ctx.claims?.auth_time)||ctx.claims.auth_time<0||ctx.claims.auth_time>Math.floor(Date.now()/1000)+30||!employee||!Number.isSafeInteger(employee.version)||employee.version<1||employee.minimumAuthTime!==undefined&&(!Number.isSafeInteger(employee.minimumAuthTime)||employee.minimumAuthTime<0)||employee.employeeId!==actor.employeeId||employee.status!=='ACTIVE'||employee.scope?.allRegions!==true||!allowed(employee,'finance.read')||employee.deletionRequestId!=null||employee.deletedAt!=null||employee.isDeleted===true||employee.mfaRequired===true&&ctx.enrolled!==true||(employee.minimumAuthTime||0)>(ctx.claims?.auth_time||0))fail('SETTLEMENT_PERMISSION_REQUIRED',403);
  return employee;
 };
 await authorize();const items=[];let cursor;const seen=new Set();
 for(let page=0;page<20;page++){
  const out=await ctx.db.send(new ScanCommand({TableName:B,ConsistentRead:true,Select:'SPECIFIC_ATTRIBUTES',Limit:100,ProjectionExpression:'businessId,businessName,#name,#status,deletionRequestId,deletedAt,isDeleted',ExpressionAttributeNames:{'#name':'name','#status':'status'},...(cursor?{ExclusiveStartKey:cursor}:{})}));
  for(const b of out.Items||[]){if(!id(b.businessId)||b.status!=='approved'||b.deletionRequestId!=null||b.deletedAt!=null||b.isDeleted===true)continue;if(seen.has(b.businessId))fail('SCHEDULE_BRANCH_LIST_CHANGED',409);seen.add(b.businessId);items.push({businessId:b.businessId,businessName:b.businessName||b.name||b.businessId});}
  cursor=out.LastEvaluatedKey;if(!cursor){await authorize();return {items};}
 }
 fail('SCHEDULE_BRANCH_INVENTORY_INCOMPLETE',503);
});}
async function staff(ctx,actor,method,input){return wrap(ctx,async()=>{
 const principal={kind:'STAFF',employeeId:actor.employeeId,authTime:ctx.claims?.auth_time,mfaEnrolled:ctx.enrolled===true};
 const authorize=createMerchantSettlementAuthority({db:ctx.db,principal}),workflow=createMerchantSettlementScheduleWorkflow({db:ctx.db,principal,allowSameStaffApproval:operator(actor)});
 if(require('./merchant-payouts').matches(method,input))return require('./merchant-payouts').route(ctx,{staff:principal},method,input);
 const collections=()=>createMerchantPeriodCollection({db:require('./settlement-orders').projectEvidenceDb(ctx.db),principal});
 const statements=()=>createMerchantStatementsAdmin({db:require('./settlement-orders').projectEvidenceDb(ctx.db),principal});
 if(method==='GET'){
  if(['period-collections','period-collection','period-collection-parts'].includes(input?.view)){const {view,...body}=input;return collections()[view==='period-collections'?'list':view==='period-collection'?'read':'parts'](body);}
  if(input?.view==='batches'){const {view,...body}=input;if(typeof body.limit!=='string'||! /^[1-9][0-9]?$/.test(body.limit))fail('INVALID_SCHEDULE_REQUEST',400);return statements().list({...body,limit:Number(body.limit)});}
  if(input?.view==='batch'){const {view,...body}=input;return statements().read(body);}
  if(input?.view==='orders'){await authorize(input.branchId,'READ');await branch(ctx.db,input.branchId);const result=await require('./settlement-orders').read(ctx.db,input);await authorize(input.branchId,'READ');return result;}
  if(!input||Object.keys(input).sort().join(',')!=='branchId')fail('INVALID_SCHEDULE_REQUEST',400);
  await authorize(input.branchId,'READ');const b=await branch(ctx.db,input.branchId),rows=await list(ctx.db,input.branchId);
  const ref=b.commercialAgreementId?await get(ctx.db,P,{pk:'COMMERCIAL_AGREEMENT#'+b.commercialAgreementId,sk:'CURRENT'}):null;
  await authorize(input.branchId,'READ');
  return {branchId:input.branchId,current:present(rows.find(r=>r.sk==='SETTLEMENT_SCHEDULE#CURRENT')),
   proposals:rows.filter(r=>r.kind==='MERCHANT_SETTLEMENT_SCHEDULE_PROPOSAL').map(present).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),
   versions:rows.filter(r=>r.sk.startsWith('SETTLEMENT_SCHEDULE#VERSION#')).map(present).sort((a,b)=>b.schedule.version-a.schedule.version),
   agreement:ref&&ref.status==='ACTIVE'&&ref.version===b.commercialAgreementVersion?{id:b.commercialAgreementId,version:ref.version,termsHash:ref.termsHash}:null,
   can:{request:allowed(actor,'finance.settings.request'),approve:allowed(actor,'finance.settings.approve')},actorId:actor.employeeId,sameStaffApprovalAllowed:operator(actor)};
 }
 if(method!=='POST'||!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_SCHEDULE_REQUEST',400);
 const {action,...body}=input;const collectionActions={START_PERIOD_COLLECTION:'start',ADVANCE_PERIOD_COLLECTION:'advance',FREEZE_PERIOD_COLLECTION:'freeze'};if(Object.prototype.hasOwnProperty.call(collectionActions,action))return collections()[collectionActions[action]](body);if(action==='APPROVE_STATEMENT')return statements().approve(body);if(action==='PREVIEW_STATEMENT')return statements().preview(body);if(action==='CREATE_STATEMENT')return statements().create(body);if(action==='PROPOSE')return workflow.propose(body);if(action==='APPROVE')return workflow.approve(body);fail('INVALID_SCHEDULE_REQUEST',400);
});}
async function owner(ctx,subjectId,method,input,verifiedOwner){return wrap(ctx,async()=>{
 if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_SCHEDULE_REQUEST',400);
 if(require('./merchant-payouts').matches(method,input)){if(!verifiedOwner)fail('PAYOUT_VERIFIED_PRINCIPAL_REQUIRED',403);return require('./merchant-payouts').route(ctx,{owner:verifiedOwner},method,input);}
 const b=await branch(ctx.db,input.branchId);if(subjectId!==b.ownerId)fail('SCHEDULE_OWNER_REQUIRED',403);
 if(method==='GET'){
  if(Object.keys(input).sort().join(',')!=='branchId')fail('INVALID_SCHEDULE_REQUEST',400);
  const rows=await list(ctx.db,input.branchId);const after=await branch(ctx.db,input.branchId);if(after.ownerId!==subjectId)fail('SCHEDULE_OWNER_REQUIRED',403);
  return {current:present(rows.find(r=>r.sk==='SETTLEMENT_SCHEDULE#CURRENT')),proposals:rows.filter(r=>r.kind==='MERCHANT_SETTLEMENT_SCHEDULE_PROPOSAL').map(present)};
 }
 const {action,...body}=input;if(method!=='POST'||action!=='CONSENT')fail('INVALID_SCHEDULE_REQUEST',400);
 return createMerchantSettlementScheduleWorkflow({db:ctx.db,principal:{kind:'OWNER',subjectId}}).consent(body);
});}
module.exports={staff,owner,branches};
