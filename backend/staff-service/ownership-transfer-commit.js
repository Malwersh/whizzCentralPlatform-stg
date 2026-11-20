'use strict';

const {validateApproval}=require('./ownership-transfer-rules');

const fail=code=>{throw Object.assign(new Error(code),{code});};
const bindings=Object.freeze({
 staging:{platform:'staging-MerchantPlatform',branches:'WhizzMerchants_Businesses',lifecycle:'staging-AccountDeletion'},
 production:{platform:'wizz-production-MerchantPlatform',branches:'wizz-production-Merchants',lifecycle:'wizz-production-AccountDeletion'},
});

// The caller must hold a verified organization-wide mutation fence. The same
// transaction must assert the fence and the financial and access inventories.
function planCommit({environment,request,reviewer,organization,brands,branches,finance,recipient,fence,now}){
 if(!Object.hasOwn(bindings,environment))fail('TRANSFER_ENVIRONMENT_NOT_CONFIGURED');
 const tables=bindings[environment];
 const approval=validateApproval({request,reviewer,organization,branches,finance,now});
 if(!fence||fence.organizationId!==request.organizationId||fence.requestId!==request.requestId||
    fence.scopeDigest!==request.digest||!Number.isSafeInteger(fence.version)||fence.version<1||
    !Array.isArray(fence.guards)||!fence.guards.length){
  fail('TRANSFER_MUTATION_FENCE_REQUIRED');
 }
 const validGuardTable=table=>typeof table==='string'&&(environment==='production'
  ? table.startsWith('wizz-production-')
  : table.startsWith('staging-')||table===tables.branches||table==='WizzOrders');
 if(fence.guards.some(guard=>{
  const operations=Object.entries(guard??{});
  return operations.length!==1||
   !['ConditionCheck','Update','Put','Delete'].includes(operations[0][0])||
   !validGuardTable(operations[0][1]?.TableName);
 }))fail('TRANSFER_MUTATION_FENCE_INVALID');
 if(recipient?.subjectId!==request.recipientId||typeof recipient.name!=='string'||
    !recipient.name.trim()||recipient.name.length>150||
    (recipient.email!=null&&(typeof recipient.email!=='string'||recipient.email.length>254))){
  fail('TRANSFER_RECIPIENT_PROFILE_REQUIRED');
 }
 const ownerKey='PERSON#'+request.ownerId;
 const recipientKey='PERSON#'+request.recipientId;
 const orgKey='ORGANIZATION#'+request.organizationId;
 const wantedBrands=new Set(branches.map(branch=>branch.brandId));
 if(!Array.isArray(brands)||!brands.length||
    brands.some(brand=>!brand||typeof brand.brandId!=='string')||
    new Set(brands.map(brand=>brand.brandId)).size!==brands.length||
    [...wantedBrands].some(brandId=>!brands.some(brand=>brand.brandId===brandId))){
  fail('TRANSFER_BRAND_INVENTORY_REQUIRED');
 }
 const unchanged=(table,pk)=>({ConditionCheck:{
  TableName:table,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)',
 }});
 const items=[
  unchanged(tables.lifecycle,'ACCOUNT_LIFECYCLE#MERCHANT#'+request.ownerId),
  unchanged(tables.lifecycle,'ACCOUNT_LIFECYCLE#MERCHANT#'+request.recipientId),
  {[fence.leaseId?'Delete':'ConditionCheck']:{
   TableName:tables.platform,Key:{pk:orgKey,sk:'OWNERSHIP_TRANSFER_FENCE'},
   ConditionExpression:'requestId=:request AND scopeDigest=:digest AND #v=:version AND #s=:frozen AND expiresAt>:now'+(fence.leaseId?' AND leaseId=:lease':''),
   ExpressionAttributeNames:{'#v':'version','#s':'status'},
   ExpressionAttributeValues:{':request':request.requestId,':digest':request.digest,':version':fence.version,':frozen':'FROZEN',':now':now,...(fence.leaseId?{':lease':fence.leaseId}:{})},
  }},
  ...fence.guards,
 ];
 const stamp=new Date(now).toISOString();
 function move(row,sk){
  if(row.pk!==ownerKey||row.sk!==sk||row.subjectId!==request.ownerId||
     row.organizationId!==request.organizationId||!Number.isSafeInteger(row.version)||row.version<1){
   fail('TRANSFER_PLATFORM_SCOPE_CHANGED');
  }
  items.push(
   {Delete:{
    TableName:tables.platform,Key:{pk:ownerKey,sk},
    ConditionExpression:'subjectId=:owner AND organizationId=:org AND #v=:version',
    ExpressionAttributeNames:{'#v':'version'},
    ExpressionAttributeValues:{':owner':request.ownerId,':org':request.organizationId,':version':row.version},
   }},
   {Put:{
    TableName:tables.platform,Item:{...row,pk:recipientKey,subjectId:request.recipientId,version:row.version+1,updatedAt:stamp},
    ConditionExpression:'attribute_not_exists(pk)',
   }},
  );
 }
 move(organization,orgKey);
 for(const brand of brands)move(brand,'BRAND#'+brand.brandId);
 for(const branch of branches){
  items.push(
   fence.leaseId?{Delete:{
    TableName:tables.lifecycle,Key:{pk:'BUSINESS_LIFECYCLE#MERCHANT#'+branch.businessId,sk:'META'},
    ConditionExpression:'leaseId=:lease AND requestId=:request AND expiresAt>:now',
    ExpressionAttributeValues:{':lease':fence.leaseId,':request':request.requestId,':now':Math.floor(now/1000)},
   }}:unchanged(tables.lifecycle,'BUSINESS_LIFECYCLE#MERCHANT#'+branch.businessId),
   {Update:{
    TableName:tables.branches,Key:{businessId:branch.businessId},
    ConditionExpression:'ownerId=:owner AND cognitoUserId=:owner AND organizationId=:org AND brandId=:brand AND updatedAt=:base AND #status=:approved AND orderIntakeTransferRequestId=:request AND orderIntakeTransferExpiresAt>:commitTime AND attribute_not_exists(orderIntakeDeletionRequestId) AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(isDeleted) OR isDeleted=:false)',
    UpdateExpression:'SET ownerId=:recipient, cognitoUserId=:recipient, ownerName=:name, updatedAt=:now, #v=if_not_exists(#v,:zero)+:one'+
      (recipient.email?', email=:email':'')+' REMOVE orderIntakeTransferRequestId, orderIntakeTransferExpiresAt'+(recipient.email?'':', email'),
    ExpressionAttributeNames:{'#status':'status','#v':'version'},
    ExpressionAttributeValues:{
     ':owner':request.ownerId,':recipient':request.recipientId,':org':request.organizationId,':request':request.requestId,':commitTime':now,
     ':brand':branch.brandId,':base':branch.updatedAt,':approved':'approved',':false':false,
     ':name':recipient.name,':now':stamp,':zero':0,':one':1,...(recipient.email?{':email':recipient.email}:{}),
    },
   }},
  );
 }
 items.push(
  {Update:{
   TableName:tables.platform,Key:{pk:orgKey,sk:'OWNERSHIP_TRANSFER'},
   ConditionExpression:'requestId=:request AND #status=:pending AND #v=:version AND digest=:digest',
   UpdateExpression:'SET #status=:completed, #v=:next, completedAt=:now, reviewerId=:reviewer',
   ExpressionAttributeNames:{'#status':'status','#v':'version'},
   ExpressionAttributeValues:{
    ':request':approval.requestId,':pending':'AWAITING_REVIEW',':version':approval.requestVersion,
    ':digest':approval.scopeDigest,':completed':'COMPLETED',':next':approval.requestVersion+1,
    ':now':now,':reviewer':approval.reviewerId,
   },
  }},
  {Put:{
   TableName:tables.platform,
   Item:{
    pk:orgKey,sk:'OWNERSHIP_TRANSFER_AUDIT#'+request.requestId,kind:'OWNERSHIP_TRANSFER_COMPLETED',
    requestId:request.requestId,organizationId:request.organizationId,
    previousOwnerId:request.ownerId,newOwnerId:request.recipientId,reviewerId:approval.reviewerId,
    scopeDigest:approval.scopeDigest,branchIds:branches.map(branch=>branch.businessId),completedAt:now,
   },
   ConditionExpression:'attribute_not_exists(pk)',
  }},
 );
 if(items.length>100)fail('TRANSFER_SCOPE_EXCEEDS_TRANSACTION_LIMIT');
 return {TransactItems:items};
}

module.exports={planCommit};
