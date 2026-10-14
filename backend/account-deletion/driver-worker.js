'use strict';
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const {AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {driverEvidence}=require('./driver-evidence');
const {driverLock}=require('./driver-lock');
const {driverCleanup,BUCKET}=require('./driver-cleanup');
const {dynamoStore}=require('./store');
const {retentionSettings}=require('./settings');
const {coordinator}=require('./coordinator');
const {error}=require('./policy');
const POOL='us-east-1_RGTqUXF5C';
const STEPS=['disableIdentity','externalWrites','documents','personalData','financialArchive','walletClosure','profileClosure','identityClosure'];
function createDriverWorker({db,cognito,s3,connections,requestTable='staging-AccountDeletion',archiveTable='staging-AccountDeletionFinancialArchive',verifiedMutationGuards=false,settings}){
 const store=dynamoStore({db,table:requestTable}),evidence=driverEvidence({db});
 const lock=driverLock({db,table:requestTable,verifiedMutationGuards}),cleanup=driverCleanup({db,cognito,s3,connections,requestTable,archiveTable});
 const config=settings||retentionSettings({db,table:'staging-PlatformStaff',approvedInventories:new Set(verifiedMutationGuards?['DRIVER']:[])});
 const adapter={evidence,requiredSteps:()=>STEPS,async lock(r,e,policy){
  const user=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:r.subjectId}));
  const attrs=Object.fromEntries((user.UserAttributes||[]).map(a=>[a.Name,a.Value]));
  if(attrs.sub!==r.subjectId||!user.Enabled)throw error('IDENTITY_UNAVAILABLE');
  if(policy.locationRetentionDays!==0||policy.documentRetentionDays!==0||policy.supportRetentionDays!==0)throw error('RETENTION_ADAPTER_NOT_READY');
  if(!Number.isInteger(policy.financialRetentionYears)||policy.financialRetentionYears<1||policy.financialRetentionYears>30)throw error('RETENTION_POLICY_INVALID');
  for(const id of e.profileIds){
   const {Item:p}=await db.send(new GetCommand({TableName:'WhizzDrivers_staging',Key:{driverId:id},ConsistentRead:true}));
   if(!p)throw error('PROFILE_NOT_FOUND');
   if(p.legalHold===true||p.retentionHold===true)throw error('DOCUMENTED_RETENTION_HOLD');
   const prefix='s3://'+BUCKET+'/drivers/'+id+'/';
   for(const f of ['drivingLicenseUrl','registrationPaperUrl','nationalIdUrl','profileImage','profileImageUrl','photoUrl','avatarUrl'])if(p[f]&&!String(p[f]).startsWith(prefix))throw error('ASSET_INVENTORY_REQUIRED');
  }
  return lock(r,e,{schema:1,requestId:r.requestId,subjectId:r.subjectId,pool:POOL,username:user.Username,phone:attrs.phone_number,profileIds:e.profileIds,wallets:e.wallets,walletIds:e.wallets.map(w=>w.walletId),policyVersion:r.policyVersion,financialYears:policy.financialRetentionYears});
 },execute:cleanup.execute};
 const service=coordinator({store,adapters:{DRIVER:adapter},settings:config});
 return {async process(subjectId,requestId){
  if(!verifiedMutationGuards)throw error('MUTATION_GUARDS_NOT_VERIFIED');
  let r=await store.get({type:'DRIVER',sub:subjectId},requestId);if(!r)throw error('REQUEST_NOT_FOUND');
  if(r.actorType!=='DRIVER'||r.scope.kind!=='ACCOUNT'||r.scope.id!==subjectId)throw error('INVALID_CLEANUP_SCOPE');
  if(r.status==='COMPLETED')return service.process({type:'DRIVER',sub:subjectId},requestId);
  if(!r.job&&JSON.stringify(r.requiredSteps)!==JSON.stringify(STEPS)){
   if(Object.keys(await store.steps(r)).length||r.leaseOwner)throw error('REQUEST_SCHEMA_MIGRATION_REQUIRED');
   r=await store.update(r,{requiredSteps:STEPS,executionSchema:1});
  }
  let actor={type:'DRIVER',sub:subjectId,username:r.job?.username};
  if(!r.job){const u=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:subjectId}));const attrs=Object.fromEntries((u.UserAttributes||[]).map(a=>[a.Name,a.Value]));if(attrs.sub!==subjectId)throw error('IDENTITY_GENERATION_CHANGED');actor={...actor,username:u.Username,attrs};}
  return service.process(actor,requestId);
 }};
}
module.exports={createDriverWorker,STEPS};
