'use strict';

const {GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const {execute}=require('./merchant-ownership-execution');
const {createLock}=require('./merchant-ownership-lock');
const withLock=createLock();
const executeWithLock=(ctx,actor,request,reason)=>withLock(ctx,actor,request,reason,execute);
const {preflight}=require('./merchant-ownership-preflight');
const {settlementDecision,settlementStatus}=require('./merchant-ownership-settlement');
const PLATFORM='staging-MerchantPlatform';
const BRANCHES='WhizzMerchants_Businesses';
const fail=(code,status)=>{throw Object.assign(new Error(code),{status});};
const activeStatuses=new Set(['AWAITING_RECIPIENT','AWAITING_REVIEW']);
const organizationPattern=/^[A-Za-z0-9_-]{1,128}$/;

function summary(row,now){
 return {
  requestId:row.requestId,organizationId:row.organizationId,
  status:activeStatuses.has(row.status)&&row.expiresAt<=now?'EXPIRED':row.status,
  version:row.version,branchIds:row.branchIds,expiresAt:row.expiresAt,
  agreementVersion:row.agreementVersion||null,
 };
}

async function branchDisplayName(db,Get,organizationId,businessId){
 const {Item}=await db.send(new Get({TableName:BRANCHES,Key:{businessId},
  ProjectionExpression:'organizationId,businessName,#name,branchName',ExpressionAttributeNames:{'#name':'name'}}));
 if(Item?.organizationId!==organizationId)return null;
 return Item.businessName||Item.name||Item.branchName||null;
}

async function activeRequests(db,Get,Scan,now,encodedCursor){
 let cursor;
 if(encodedCursor!==undefined){
  try{
   if(typeof encodedCursor!=='string'||encodedCursor.length>4096)throw Error();
   const key=JSON.parse(Buffer.from(encodedCursor,'base64url').toString());
   if(Object.keys(key).length!==2||typeof key.pk!=='string'||typeof key.sk!=='string'||
      !key.pk||!key.sk||key.pk.length>2048||key.sk.length>1024)throw Error();
   cursor={pk:key.pk,sk:key.sk};
  }catch(_){fail('INVALID_TRANSFER_CURSOR',400);}
 }
 const rows=[];
 for(let page=0;page<10;page++){
  const result=await db.send(new Scan({
   TableName:PLATFORM,Limit:100,ConsistentRead:true,ExclusiveStartKey:cursor,
   FilterExpression:'begins_with(pk,:organization) AND sk=:transfer AND #status IN (:waiting,:review) AND expiresAt>:now',
   ProjectionExpression:'pk,sk,requestId,organizationId,branchIds,#status,expiresAt,createdAt',
   ExpressionAttributeNames:{'#status':'status'},
   ExpressionAttributeValues:{':organization':'ORGANIZATION#',':transfer':'OWNERSHIP_TRANSFER',':waiting':'AWAITING_RECIPIENT',':review':'AWAITING_REVIEW',':now':now},
  }));
  const remaining=20-rows.length;
  const items=result.Items||[];
  rows.push(...items.slice(0,remaining));
  cursor=result.LastEvaluatedKey;
  if(items.length>remaining){
   const last=rows.at(-1);
   cursor={pk:last.pk,sk:last.sk};
  }
  if(!cursor||rows.length===20)break;
 }
 const requests=await Promise.all(rows.map(async row=>{
  const branchIds=Array.isArray(row.branchIds)?row.branchIds:[];
  const name=branchIds.length?await branchDisplayName(db,Get,row.organizationId,branchIds[0]):null;
  return {requestId:row.requestId,organizationId:row.organizationId,status:row.status,
   businessName:name||null,branchCount:branchIds.length,createdAt:row.createdAt};
 }));
 requests.sort((a,b)=>Number(b.status==='AWAITING_REVIEW')-Number(a.status==='AWAITING_REVIEW')||b.createdAt-a.createdAt);
 return {requests,nextCursor:cursor?Buffer.from(JSON.stringify(cursor)).toString('base64url'):null};
}

function createReview({Get=GetCommand,Scan=ScanCommand,Write=TransactWriteCommand,clock=Date.now,authorize=allowed,approve=executeWithLock,approveSettlement=settlementDecision,readPreflight=preflight,settlementEnabled=()=>process.env.PLATFORM_ENVIRONMENT==='staging',approvalEnabled=()=>process.env.PLATFORM_ENVIRONMENT==='staging'&&process.env.MERCHANT_OWNERSHIP_EXECUTION_ENABLED==='true'}={}){
 return async function review(ctx,actor,method,path,input={}){
  if(!authorize(actor,'merchants.review')||actor.scope?.allRegions!==true)fail('PERMISSION_REQUIRED',403);
  const query=method==='GET'?ctx.query||{}:input;
  if(method==='GET'&&path==='/staff/merchants/ownership-transfer'&&query.view==='active'){
   return activeRequests(ctx.db,Get,Scan,clock(),query.cursor);
  }
  const {organizationId,requestId}=query;
  if(typeof organizationId!=='string'||!organizationPattern.test(organizationId)||
     typeof requestId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId)){
   fail('INVALID_TRANSFER_REFERENCE',400);
  }
  const key={pk:'ORGANIZATION#'+organizationId,sk:'OWNERSHIP_TRANSFER'};
  const row=(await ctx.db.send(new Get({TableName:PLATFORM,Key:key,ConsistentRead:true}))).Item;
  if(!row||row.requestId!==requestId||row.organizationId!==organizationId)fail('TRANSFER_NOT_FOUND',404);
  const now=clock();
  const reviewable=row.status==='AWAITING_REVIEW'&&row.expiresAt>now;
  const executionAvailable=approvalEnabled();
  const authorized=executionAvailable&&authorize(actor,'finance.approve');
  const approving=path==='/staff/merchants/ownership-transfer/approve';
  const settling=path==='/staff/merchants/ownership-transfer/approve-settlement';
  const canSettle=settlementEnabled()&&authorize(actor,'finance.approve');
  if(method==='GET'&&path==='/staff/merchants/ownership-transfer'){
   const settlement=reviewable&&canSettle?await settlementStatus(ctx.db,row,now,Get):null;
   const branchNames=await Promise.all(row.branchIds.map(id=>branchDisplayName(ctx.db,Get,row.organizationId,id)));
   return {request:{...summary(row,now),branchNames},settlement,executionAvailable,canReject:reviewable,
    canApprove:reviewable&&authorized&&settlement?.status==='APPROVED',
    canPreflight:reviewable&&authorize(actor,'finance.approve'),
    canApproveSettlement:settlement?.status==='REVIEW_REQUIRED'};

  }
  if(method==='GET'&&path==='/staff/merchants/ownership-transfer/preflight'){
   if(!authorize(actor,'finance.approve'))fail('PERMISSION_REQUIRED',403);
   return readPreflight(ctx.db,row,now);
  }
  if(method!=='POST'||(!approving&&!settling&&path!=='/staff/merchants/ownership-transfer/reject'))fail('NOT_FOUND',404);
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<5||reason.length>500||Object.keys(input).some(field=>!['organizationId','requestId','baseVersion','reason'].includes(field))){
   fail('INVALID_TRANSFER_REVIEW',400);
  }
  if(row.status!=='AWAITING_REVIEW'||row.version!==input.baseVersion||row.expiresAt<=now){
   fail('VERSION_OR_STATE_CONFLICT',409);
  }
  if(approving||settling){
   if(approving&&!authorized||settling&&!canSettle)fail('TRANSFER_APPROVAL_UNAVAILABLE',403);
   const age=now-ctx.authenticatedAt*1000;
   const allowValidSession=process.env.PLATFORM_ENVIRONMENT==='staging'&&process.env.PLATFORM_SESSION_POLICY==='VALID_SESSION';
   if(!Number.isSafeInteger(ctx.authenticatedAt)||age < -5000||(!allowValidSession&&age>300000)){
    fail('REAUTH_REQUIRED',403);
   }
   if(settling){
    const settlement=await approveSettlement(ctx,actor,row,reason,now);
    return {request:summary(row,now),settlement,canReject:true,canApprove:authorized,canPreflight:true,canApproveSettlement:false};
   }
   const completed=await approve(ctx,actor,row,reason,now);
   return {request:summary(completed,now),canApprove:false,canReject:false};
  }
  const branches=row.branchIds;
  if(!Array.isArray(branches)||!branches.length||branches.length>97||
     new Set(branches).size!==branches.length||branches.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))){
   fail('INVALID_TRANSFER_SCOPE',409);
  }
  const next={...row,status:'REJECTED',version:row.version+1,rejectedAt:now,reviewerId:actor.employeeId};
  try{
   await ctx.db.send(new Write({TransactItems:[
    ctx.guard(actor),
    {Put:{
     TableName:PLATFORM,Item:next,
     ConditionExpression:'requestId=:request AND #v=:version AND #s=:pending AND expiresAt>:now',
     ExpressionAttributeNames:{'#v':'version','#s':'status'},
     ExpressionAttributeValues:{':request':requestId,':version':row.version,':pending':'AWAITING_REVIEW',':now':now},
    }},
    ...branches.map(businessId=>({Update:{
     TableName:BRANCHES,Key:{businessId},
     UpdateExpression:'REMOVE orderIntakeTransferRequestId, orderIntakeTransferExpiresAt',
     ConditionExpression:'orderIntakeTransferRequestId=:request',
     ExpressionAttributeValues:{':request':requestId},
    }})),
    ctx.audit(actor.employeeId,'MERCHANT_OWNERSHIP_TRANSFER_REJECTED',summary(row,now),{...summary(next,now),reason},requestId),
   ]}));
  }catch(error){
   if(error.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT',409);
   throw error;
  }
  return {request:summary(next,now),canReject:false};
 };
}

module.exports={route:createReview(),createReview};
