'use strict';
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const {AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {merchantEvidence}=require('./merchant-evidence');
const {merchantBusinessLock}=require('./merchant-lock');
const {merchantBusinessCleanup}=require('./merchant-cleanup');
const {dynamoStore}=require('./store');
const {retentionSettings}=require('./settings');
const {coordinator}=require('./coordinator');
const {error}=require('./policy');
const {merchantAssets}=require('./merchant-assets');
const POOL='us-east-1_gtCR3ndzT';
const STEPS=['assets','personalData','financialArchive','memberships','walletClosure','profileClosure'];
function createMerchantBusinessWorker({db,cognito,s3,connections,requestTable='staging-AccountDeletion',archiveTable='staging-AccountDeletionFinancialArchive',verifiedMutationGuards=false,settings}){
 const store=dynamoStore({db,table:requestTable}),evidence=merchantEvidence({db});
 const lock=merchantBusinessLock({db,table:requestTable,verifiedMutationGuards}),cleanup=merchantBusinessCleanup({db,cognito,connections,requestTable,archiveTable});
 const assets=merchantAssets({db,s3});
 const config=settings||retentionSettings({db,table:'staging-PlatformStaff',approvedInventories:new Set(verifiedMutationGuards?['MERCHANT']:[])});
 const adapter={evidence,requiredSteps:()=>STEPS,async lock(r,e,policy){
  const user=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:r.subjectId}));
  const attrs=Object.fromEntries((user.UserAttributes||[]).map(a=>[a.Name,a.Value]));
  if(attrs.sub!==r.subjectId||!user.Enabled)throw error('IDENTITY_UNAVAILABLE');
  if(policy.locationRetentionDays!==0||policy.documentRetentionDays!==0||policy.supportRetentionDays!==0)throw error('RETENTION_ADAPTER_NOT_READY');
  if(!Number.isInteger(policy.financialRetentionYears)||policy.financialRetentionYears<1||policy.financialRetentionYears>30)throw error('RETENTION_POLICY_INVALID');
  const {Item:p}=await db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:r.scope.id},ConsistentRead:true}));
  if(!p||p.ownerId!==r.subjectId||p.cognitoUserId!==r.subjectId)throw error('OWNER_REQUIRED');
  if(p.legalHold||p.retentionHold)throw error('DOCUMENTED_RETENTION_HOLD');
  if(p.onboardingDraftId){const {Item:draft}=await db.send(new GetCommand({TableName:'staging-MerchantPlatform',Key:{pk:'PERSON#'+r.subjectId,sk:'DRAFT#'+p.onboardingDraftId},ConsistentRead:true}));if(!draft||draft.subjectId!==r.subjectId||draft.businessId!==p.businessId)throw error('ASSET_SCOPE_INVALID');}
  // External asset deletion must be inventoried rather than guessed from a URL.
  const assetInventory=await assets.inventory(p);
  return lock(r,e,{schema:1,requestId:r.requestId,subjectId:r.subjectId,assets:assetInventory,businessId:r.scope.id,ownedIds:[r.scope.id],pool:POOL,username:user.Username,phone:attrs.phone_number,profileIds:[r.scope.id],...(p.onboardingDraftId?{onboardingDraftId:p.onboardingDraftId}:{}),wallets:e.wallets,walletIds:e.wallets.map(w=>w.walletId),policyVersion:r.policyVersion,financialYears:policy.financialRetentionYears});
 },execute:async(step,r,job)=>{if(step!=='assets')return cleanup.execute(step,r,job);await require('./commercial-retention').commercialRetention({db,r,job,requestTable,archiveTable});await require('./merchant-staff-cleanup').purge({db,r,job,requestTable});await require('./merchant-business-changes').purge({db,r,job,requestTable});await assets.cleanup(r,job);if(job.onboardingDraftId)await require('./merchant-onboarding-assets').purge({db,s3,r,job,requestTable,draftId:job.onboardingDraftId});}};
 const service=coordinator({store,adapters:{MERCHANT:adapter},settings:config});
 return {async process(subjectId,requestId){
  if(!verifiedMutationGuards)throw error('MUTATION_GUARDS_NOT_VERIFIED');
  let r=await store.get({type:'MERCHANT',sub:subjectId},requestId);if(!r)throw error('REQUEST_NOT_FOUND');
  if(r.actorType!=='MERCHANT'||r.scope.kind!=='BUSINESS')throw error('INVALID_CLEANUP_SCOPE');
  if(r.status==='COMPLETED')return service.process({type:'MERCHANT',sub:subjectId},requestId);
  if(!r.job&&JSON.stringify(r.requiredSteps)!==JSON.stringify(STEPS)){
   if(Object.keys(await store.steps(r)).length||r.leaseOwner)throw error('REQUEST_SCHEMA_MIGRATION_REQUIRED');
   r=await store.update(r,{requiredSteps:STEPS,executionSchema:1});
  }
  let actor={type:'MERCHANT',sub:subjectId,username:r.job?.username};
  if(!r.job){const u=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:subjectId}));const attrs=Object.fromEntries((u.UserAttributes||[]).map(a=>[a.Name,a.Value]));if(attrs.sub!==subjectId)throw error('IDENTITY_GENERATION_CHANGED');actor={...actor,username:u.Username,attrs};}
  return service.process(actor,requestId);
 }};
}
module.exports={createMerchantBusinessWorker,STEPS};
