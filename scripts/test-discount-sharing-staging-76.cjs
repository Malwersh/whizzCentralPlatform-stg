'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {isolatedDynamo}=require('./lib/isolated-dynamo.cjs');const {service,hash}=require('../backend/staff-service/commercial-management');
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses',C='WizzCentral_Platform_Discounts';
(async()=>{const isolated=await isolatedDynamo('staging-discount-sharing-test-'+Date.now());try{
 const {db,put,get}=isolated;process.env.PLATFORM_ENVIRONMENT='staging';process.env.PLATFORM_WRITE_MODE='DIRECT';process.env.PLATFORM_DIRECT_OPERATOR_IDS='synthetic-editor';
 const actor={employeeId:'synthetic-editor',status:'ACTIVE',version:1,roles:['commercial_editor'],scope:{allRegions:true,regionIds:[]}};
 await put(S,{pk:'EMPLOYEE#'+actor.employeeId,sk:'PROFILE',...actor});await put(P,{pk:'PERSON#synthetic-owner',sk:'ORGANIZATION#synthetic-org',organizationId:'synthetic-org',subjectId:'synthetic-owner'});
 for(const businessId of ['synthetic-one','synthetic-two'])await put(B,{businessId,ownerId:'synthetic-owner',cognitoUserId:'synthetic-owner',organizationId:'synthetic-org',status:'approved'});
 const now=new Date().toISOString(),end=new Date(Date.now()+86400000).toISOString();const campaign={discountId:'synthetic-campaign',title:'Synthetic',version:1,startDate:now,endDate:end,status:'active'};await put(C,campaign);
 const guard=a=>({ConditionCheck:{TableName:S,Key:{pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'},ConditionExpression:'#v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':a.version,':s':'ACTIVE'}}});
 const ctx={db,enabled:true,enrolled:true,recent:()=>{},claims:{},employee:async id=>get(S,{pk:'EMPLOYEE#'+id,sk:'PROFILE'}),guard,audit:(id,action,before,after,requestId)=>({Put:{TableName:S,Item:{pk:'AUDIT',sk:new Date().toISOString()+'#'+requestId,actorId:id,action,before,after},ConditionExpression:'attribute_not_exists(pk)'}})};
 const saved=[];
 for(const branch of ['synthetic-one','synthetic-two']){const body={businessId:branch,action:'SAVE_FUNDING',id:'synthetic-share-'+branch,requestId:randomUUID(),draftVersion:0,baseVersion:0,businessIds:[branch],reason:'Synthetic sharing verification',values:{campaignId:campaign.discountId,campaignVersion:1,source:'PLATFORM',effectiveFrom:now,effectiveTo:end,merchantNumerator:30,denominator:100,merchantShareFinalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}}};
 const r=await service(ctx,{kind:'STAFF',actor},'POST',body);assert.equal(await get(S,{pk:'DISCOUNT_FUNDING#'+body.id,sk:'CURRENT'}),undefined);saved.push({body,r});}
 for(const {body,r}of saved){const input={businessId:body.businessId,action:'ACCEPT_FUNDING',id:body.id,requestId:randomUUID(),draftVersion:r.draftVersion,baseVersion:0,hash:r.hash};assert.equal((await service(ctx,{kind:'OWNER',sub:'synthetic-owner'},'POST',input)).publishedVersion,1);assert.equal((await service(ctx,{kind:'OWNER',sub:'synthetic-owner'},'POST',input)).publishedVersion,1);const policy=await get(S,{pk:'DISCOUNT_FUNDING#'+body.id,sk:'CURRENT'}),binding=await get(P,{pk:'BRANCH#'+body.businessId,sk:'COMMERCIAL_SHARING#PLATFORM#'+campaign.discountId});assert.equal(binding.policyDigest,hash(policy));assert.equal(policy.acceptedBy,'synthetic-owner');}
 assert.deepEqual(await get(C,{discountId:campaign.discountId}),campaign);
 // The same application transaction must abort on live revocation between reading and committing.
 const body={...saved[0].body,id:'synthetic-revoked',requestId:randomUUID()};isolated.interfere(async()=>put(S,{pk:'EMPLOYEE#'+actor.employeeId,sk:'PROFILE',...actor,status:'SUSPENDED',version:2}));await assert.rejects(service(ctx,{kind:'STAFF',actor},'POST',body),/VERSION_OR_STATE_CONFLICT/);assert.equal(await get(S,{pk:'DISCOUNT_FUNDING#synthetic-revoked',sk:'DRAFT'}),undefined);
 console.log(JSON.stringify({passed:true,realDynamoTransactions:true,twoBranchesOnePlatformCampaign:true,ownerConsentRequired:true,stableRetry:true,campaignUnmodified:true,revocationAbortsEntireSave:true,table:isolated.table}));
}finally{await isolated.close();}})().catch(e=>{console.error(e.name,e.message);process.exitCode=1;});
