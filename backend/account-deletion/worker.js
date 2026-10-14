'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {ApiGatewayManagementApiClient}=require('@aws-sdk/client-apigatewaymanagementapi');
const {customerEvidence}=require('./customer-evidence');
const {customerLock}=require('./customer-lock');
const {customerCleanup}=require('./customer-cleanup');
const {dynamoStore}=require('./store');
const {retentionSettings}=require('./settings');
const {coordinator}=require('./coordinator');
const {error}=require('./policy');
const STEPS=['disableIdentity','personalData','financialArchive','walletClosure','profileClosure','identityClosure'];
const POOL='us-east-1_TpyyrVkEE';
function createWorker({db,cognito,connections,requestTable='staging-AccountDeletion',archiveTable='staging-AccountDeletionFinancialArchive',verifiedMutationGuards=false,settings}){
 const store=dynamoStore({db,table:requestTable}),evidence=customerEvidence({db});
 const lock=customerLock({db,table:requestTable,verifiedMutationGuards});
 const cleanup=customerCleanup({db,cognito,connections,requestTable,archiveTable});
 const config=settings||retentionSettings({db,table:'staging-PlatformStaff',approvedInventories:new Set(verifiedMutationGuards?['CUSTOMER']:[])});
 const adapter={evidence,requiredSteps:()=>STEPS,async lock(r,e,policy){
  const user=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:r.subjectId}));
  const attrs=Object.fromEntries((user.UserAttributes||[]).map(a=>[a.Name,a.Value]));
  if(attrs.sub!==r.subjectId||user.Username!==r.subjectId||!user.Enabled)throw error('IDENTITY_UNAVAILABLE');
  if(policy.locationRetentionDays!==0||policy.documentRetentionDays!==0||policy.supportRetentionDays!==0)throw error('RETENTION_ADAPTER_NOT_READY');
  if(!Number.isInteger(policy.financialRetentionYears)||policy.financialRetentionYears<1||policy.financialRetentionYears>30)throw error('RETENTION_POLICY_INVALID');
  for(const id of e.profileIds){const {Item:p}=await db.send(new GetCommand({TableName:'WizzUser_users_staging',Key:{userId:id},ConsistentRead:true}));if(!p)throw error('PROFILE_NOT_FOUND');if(['profileImage','profileImageUrl','photoUrl','avatarUrl'].some(k=>p[k]))throw error('ASSET_INVENTORY_REQUIRED');if(p.legalHold===true||p.retentionHold===true)throw error('DOCUMENTED_RETENTION_HOLD');}
  const manifest={schema:1,requestId:r.requestId,subjectId:r.subjectId,pool:POOL,username:user.Username,phone:attrs.phone_number,email:attrs.email_verified==='true'?attrs.email:undefined,profileIds:e.profileIds,wallets:e.wallets,walletIds:e.wallets.map(w=>w.walletId),policyVersion:r.policyVersion,financialYears:policy.financialRetentionYears};
  return lock(r,e,manifest);
 },execute:cleanup.execute};
 const service=coordinator({store,adapters:{CUSTOMER:adapter},settings:config});
 return {async process(subjectId,requestId){
  if(!verifiedMutationGuards)throw error('MUTATION_GUARDS_NOT_VERIFIED');
  let r=await store.get({type:'CUSTOMER',sub:subjectId},requestId);if(!r)throw error('REQUEST_NOT_FOUND');
  if(r.actorType!=='CUSTOMER'||r.scope.kind!=='ACCOUNT'||r.scope.id!==subjectId)throw error('INVALID_CLEANUP_SCOPE');
  if(r.status==='COMPLETED')return service.process({type:'CUSTOMER',sub:subjectId},requestId);
  if(!r.job&&JSON.stringify(r.requiredSteps)!==JSON.stringify(STEPS)){
   if(Object.keys(await store.steps(r)).length||r.leaseOwner)throw error('REQUEST_SCHEMA_MIGRATION_REQUIRED');
   r=await store.update(r,{requiredSteps:STEPS,executionSchema:1});
  }
  let actor={type:'CUSTOMER',sub:subjectId,username:r.job?.username};
  if(!r.job){const u=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:subjectId}));const attrs=Object.fromEntries((u.UserAttributes||[]).map(a=>[a.Name,a.Value]));if(attrs.sub!==subjectId)throw error('IDENTITY_GENERATION_CHANGED');actor={...actor,username:u.Username,attrs};}
  return service.process(actor,requestId);
 }};
}
exports.createWorker=createWorker;
exports.STEPS=STEPS;
exports.handler=async (event,context)=>{
 if(process.env.ENVIRONMENT!=='staging')throw error('WORKER_NOT_ENABLED');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),cognito=new CognitoIdentityProviderClient({});
 const connections=new ApiGatewayManagementApiClient({endpoint:'https://igcrhwc84c.execute-api.us-east-1.amazonaws.com/staging'});
 const enabledTypes=['CUSTOMER','DRIVER','MERCHANT'].filter(type=>process.env[({CUSTOMER:'MUTATION_GUARDS_VERIFIED',DRIVER:'DRIVER_MUTATION_GUARDS_VERIFIED',MERCHANT:'MERCHANT_MUTATION_GUARDS_VERIFIED'})[type]]==='true');
 async function processRequest(row){
  if(!enabledTypes.includes(row.actorType)||!row.subjectId||!row.requestId)throw error('WORKER_NOT_ENABLED');
  const config={db,cognito,connections,verifiedMutationGuards:true,requestTable:process.env.DELETION_TABLE,archiveTable:process.env.ARCHIVE_TABLE};
  if(row.actorType==='CUSTOMER')return createWorker(config).process(row.subjectId,row.requestId);
  const {S3Client}=require('@aws-sdk/client-s3');
  if(row.actorType==='DRIVER')return require('./driver-worker').createDriverWorker({...config,s3:new S3Client({})}).process(row.subjectId,row.requestId);
  const r=await require('./store').dynamoStore({db,table:process.env.DELETION_TABLE}).get({type:'MERCHANT',sub:row.subjectId},row.requestId);
  if(!r)throw error('REQUEST_NOT_FOUND');
  if(r.scope.kind!=='BUSINESS')return require('./merchant-personal-worker').createMerchantPersonalWorker(config).process(row.subjectId,row.requestId);
  return require('./merchant-worker').createMerchantBusinessWorker({...config,s3:new S3Client({})}).process(row.subjectId,row.requestId);
 }
 if(event.subjectId||event.requestId)return processRequest({...event,actorType:event.actorType||'CUSTOMER'});
 if(process.env.AUTOMATIC_EXECUTION_ENABLED!=='true')throw error('WORKER_NOT_ENABLED');
 return require('./scheduler').runDeletionSweep({db,table:process.env.DELETION_TABLE,enabledTypes,processRequest,remainingTime:()=>context?.getRemainingTimeInMillis?.()||300000,onError:info=>console.error('Deletion worker request failed',info)});

};
