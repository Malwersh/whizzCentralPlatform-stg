'use strict';
const {GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {AdminDisableUserCommand,AdminUserGlobalSignOutCommand,AdminDeleteUserCommand,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {DeleteConnectionCommand}=require('@aws-sdk/client-apigatewaymanagementapi');
const {error}=require('./policy');
const POOL='us-east-1_TpyyrVkEE';
const PERSONAL=[
 ['WizzUser_addresses_staging',['addressId'],['userId']],
 ['WizzUser_favorites_staging',['favoriteId'],['userId']],
 ['WizzUser_websocket_connections_staging',['connectionId'],['userId']],
 ['WizzUser_websocket_subscriptions_staging',['subscriptionId'],['userId']],
 ['WizzCentral_PushDeviceTokens_staging',['token'],['subjectId'],'app'],
 ['staging-WalletNotifications',['eventId'],['driverId'],'recipientApp'],
 ['chat-sessions-staging',['sessionId'],['driverId','userId','customerId']],
];
const ORDER_PII=['userId','userSub','customerId','userId_gsi','customerName','customerPhone','customerEmail','customerInfo','customer','deliveryAddress','deliveryInstructions','specialInstructions','notes','guestToken','customerLatitude','customerLongitude','deliveryLatitude','deliveryLongitude','customerLocation','orderTimeline'];
const TERMINAL=new Set(['delivered','completed','rejected','refunded','cancelled','canceled','canceled_by_user','canceled_by_customer','canceled_by_store','canceled_by_restaurant','canceled_by_driver','canceled_by_system']);
function financialRecord(row,kind,job,now){
 if(!Number.isInteger(job.financialYears)||job.financialYears<1||job.financialYears>30)throw error('RETENTION_POLICY_INVALID');
 const fields=kind==='order'?['orderId','storeId','businessId','status','paymentMethod','paymentStatus','totalAmount','subtotal','total','deliveryFee','tax','discount','currency','pricing','createdAt','deliveredAt','completedAt','canceledAt']:
 ['transactionId','walletId','orderId','type','category','amount','currency','balanceBefore','balanceAfter','status','createdAt','timestamp','relatedEntityId','transferId','sourceWalletId','recipientWalletId','requestedBy','approvedBy','action','reference','payTabsRef','acquirerRRN','respCode','completedAt','topupId','method','transferReference','evidenceRef','createdById','approvedById','rejectedById','provider','state','paymentId','requestId','confirmedAt','balance'];
 const data={};for(const field of fields)if(row[field]!==undefined)data[field]=row[field];
 if(data.pricing){const pricing={};for(const k of ['subtotal','total','deliveryFee','tax','discount','currency'])if(data.pricing[k]!==undefined)pricing[k]=data.pricing[k];data.pricing=pricing;}
 if(kind.startsWith('sandbox_'))data.environment='sandbox';
 if(kind==='sandbox_balance'&&!Number.isSafeInteger(data.balance))throw error('FINANCIAL_RECORD_INVALID');
 if(!['order','audit','sandbox_reference','sandbox_balance'].includes(kind)&&!Number.isSafeInteger(data.amount))throw error('FINANCIAL_RECORD_INVALID');
 let sourceTime=[row.createdAt,row.timestamp].find(v=>v!==undefined&&v!==null&&v!==''&&v!==0&&v!=='0')??now;
 if(typeof sourceTime==='string')sourceTime=sourceTime.trim()||now;
 if(!['number','string'].includes(typeof sourceTime))throw error('FINANCIAL_RECORD_INVALID');
 if(typeof sourceTime==='number'||(typeof sourceTime==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(sourceTime))){
  const numeric=Number(sourceTime);if(!Number.isFinite(numeric)||numeric<0)throw error('FINANCIAL_RECORD_INVALID');
  // Historic sources use both Unix seconds and epoch milliseconds.
  sourceTime=numeric===0?now:numeric<100000000000?numeric*1000:numeric;
 }
 const created=new Date(sourceTime);
 if(!Number.isFinite(created.getTime()))throw error('FINANCIAL_RECORD_INVALID');
 created.setUTCFullYear(created.getUTCFullYear()+job.financialYears);
 return {requestId:job.requestId,subjectAlias:'DELETED#'+job.requestId,policyVersion:job.policyVersion,kind,data,archivedAt:now,expiresAt:Math.floor(created.getTime()/1000)};
}
function customerCleanup({db,cognito,connections,requestTable,archiveTable,clock=()=>new Date().toISOString(),maxPages=100,
 actorType='CUSTOMER',pool=POOL,personalTables=PERSONAL,profileTable='WizzUser_users_staging',profileKey='userId',orderPii=ORDER_PII,financialTables,
 authTables=['WizzUser_phone_auth_staging','WizzUser_phone_link_staging'],temporaryTables=['WizzUser_temp_users_staging','WizzUser_password_reset_tokens_staging']}){
 if(requestTable!=='staging-AccountDeletion'||archiveTable!=='staging-AccountDeletionFinancialArchive')throw error('INVALID_STAGING_TABLE');
 if(!((actorType==='CUSTOMER'&&pool===POOL&&profileTable==='WizzUser_users_staging'&&profileKey==='userId')||(actorType==='DRIVER'&&pool==='us-east-1_RGTqUXF5C'&&profileTable==='WhizzDrivers_staging'&&profileKey==='driverId')||(actorType==='MERCHANT'&&pool==='us-east-1_gtCR3ndzT'&&profileTable==='WhizzMerchants_Businesses'&&profileKey==='businessId')))throw error('INVALID_CLEANUP_CONFIGURATION');
 async function rows(table){let all=[],cursor,count=0;do{const r=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,ExclusiveStartKey:cursor}));all.push(...r.Items||[]);cursor=r.LastEvaluatedKey;if(++count>=maxPages&&cursor)throw error('INVENTORY_INCOMPLETE');}while(cursor);return all;}
 async function get(table,key){return (await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;}
 function fence(r){return {ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner = :owner AND leaseUntil > :now AND #v = :v AND #s = :processing',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':owner':r.leaseOwner,':now':Math.floor(new Date(clock()).getTime()/1000),':v':r.version,':processing':'PROCESSING'}}};}
 function condition(row,fields){const names={},values={},parts=[];for(const [i,field] of [...new Set([...fields,'legalHold','retentionHold'])].entries()){if(row[field]!==undefined){names['#c'+i]=field;values[':c'+i]=row[field];parts.push('#c'+i+' = :c'+i);}else if(['legalHold','retentionHold','financialRetainUntil','financialArchiveConfirmed','accountDeletionRequestId'].includes(field)){names['#c'+i]=field;parts.push('attribute_not_exists(#c'+i+')');}}if(!Object.keys(values).length)throw error('OWNERSHIP_GUARD_REQUIRED');return {ConditionExpression:parts.join(' AND '),ExpressionAttributeNames:names,ExpressionAttributeValues:values};}
 async function remove(r,table,key,row,ownerFields){
  await db.send(new TransactWriteCommand({TransactItems:[fence(r),{Delete:{TableName:table,Key:key,...condition(row,[...Object.keys(key),...ownerFields,...['createdAt','expiresAt','sessionId','sub','cognitoSub','deletionRequestId'].filter(k=>row[k]!==undefined)])}}]}));
 }
 const ids=job=>job.ownedIds||[job.subjectId,...job.profileIds];
 async function personal(r,job){
  for(const [table,keys,owners,appField] of personalTables){
   for(const row of await rows(table)){
    const owner=owners.find(k=>ids(job).includes(row[k]));if(!owner||(appField&&row[appField]!==({CUSTOMER:'user',DRIVER:'driver',MERCHANT:'merchant'})[actorType]))continue;
    if(row.legalHold===true||row.retentionHold===true)throw error('DOCUMENTED_RETENTION_HOLD');
    if(table==='WizzUser_websocket_connections_staging'){
     if(!connections)throw error('CONNECTION_REVOCATION_REQUIRED');
     await identityLease(r);
     try{await connections.send(new DeleteConnectionCommand({ConnectionId:row.connectionId}));}catch(e){if(e.name!=='GoneException'&&e.$metadata?.httpStatusCode!==410)throw e;}
    }
    if(table==='chat-sessions-staging'){
     for(const message of await rows('chat-messages-staging'))if(message.sessionId===row.sessionId)await remove(r,'chat-messages-staging',{sessionId:message.sessionId,messageKey:message.messageKey},message,['sessionId']);
    }
    const key=Object.fromEntries(keys.map(k=>[k,row[k]]));if(Object.values(key).some(v=>typeof v!=='string'||!v))throw error('INVENTORY_INVALID');
    await remove(r,table,key,row,[owner,...(appField?[appField]:[])]);
   }
  }
  // Phone-only counters shared by all accounts are deliberately excluded. Scoped
  // challenge/provision/link records are removed before Cognito frees the phone.
  for(const table of authTables)for(const row of await rows(table)){
   const owner=['sub','subjectId'].find(k=>row[k]===job.subjectId);
   const login=row.username===job.username||row.username===job.phone;
   const challenge=row.phone===job.phone&&['customer-phone-otp','phone-link'].includes(row.purpose);
   const pointer=[`PROVISION#${job.phone}`,`ACTIVE#${job.phone}`,`LOGIN#${job.username}`,`ACTIVE#${job.subjectId}`].includes(row.id);
   if(owner||login||challenge||pointer)await remove(r,table,{id:row.id},row,[...(owner?[owner]:[]),...(login?['username']:[]),...(challenge?['phone','purpose']:[])]);
  }
  for(const table of temporaryTables)for(const row of await rows(table)){
   const owner=['userId','cognitoSub'].find(k=>ids(job).includes(row[k]));
   const email=job.email&&['email','identifier'].find(k=>row[k]===job.email);
   if(!owner&&!email)continue;
   const k=table.includes('temp_users')?'tempUserId':'identifier';await remove(r,table,{[k]:row[k]},row,[owner||email]);
  }
  for(const row of await rows('staging-IdempotencyKeys')){
   if(!ids(job).includes(job.subjectId)||typeof row.idempotencyKey!=='string'||!row.idempotencyKey.startsWith('TRANSFER_VERIFY#'))continue;
   const owned=row.principalId===job.subjectId;
   const pointer=[`TRANSFER_VERIFY#ACTIVE#${job.subjectId}`,`TRANSFER_VERIFY#COOLDOWN#${job.subjectId}`].includes(row.idempotencyKey)||(/^TRANSFER_VERIFY#DAILY#\d+#/.test(row.idempotencyKey)&&row.idempotencyKey.endsWith('#'+job.subjectId));
   if(!owned&&!pointer)continue;
   await remove(r,'staging-IdempotencyKeys',{idempotencyKey:row.idempotencyKey,sk:row.sk},row,[...(owned?['principalId']:[]),...['challengeId','digest','fingerprint'].filter(k=>row[k]!==undefined)]);
  }
 }
 async function financial(r,job){
  const specs=financialTables||[['WizzOrders',{keys:['PK','SK'],owners:['userId','customerId','userSub'],kind:'order'}],['staging-LedgerEntries',{keys:['walletId','sk'],owners:['walletId'],kind:'ledger'}],['WizzUser_transactions_staging',{keys:['transactionId'],owners:['userId','walletId'],kind:'payment'}],['staging-IdempotencyKeys',{keys:['idempotencyKey','sk'],owners:['sourceWalletId','recipientWalletId','requestedBy'],kind:'transfer'}],['staging-AuditLog',{keys:['datePartition','sk'],owners:['sourceWalletId','recipientWalletId','walletId','actorId'],kind:'audit'}]];
  for(const [table,spec] of specs)for(const row of await rows(table)){
   const owner=spec.owners.find(k=>[...ids(job),...job.walletIds].includes(row[k]))||(spec.ownerPrefix&&ids(job).some(id=>row.pk===spec.ownerPrefix+id)?'pk':undefined);
   if(!owner||row.accountDeletionRequestId===job.requestId)continue;
   if(row.legalHold===true||row.retentionHold===true)throw error('DOCUMENTED_RETENTION_HOLD');
   if(spec.kind==='order'&&!TERMINAL.has(String(row.status||'').toLowerCase()))throw error('ACTIVE_ORDER_AFTER_LOCK');
   const kind=spec.kind==='sandbox'?(row.sk==='BALANCE'?'sandbox_balance':row.sk.startsWith('PAYMENT#')?'sandbox_payment':row.sk.startsWith('LEDGER#')?'sandbox_ledger':'sandbox_reference'):spec.kind;
   const now=clock(),archive=financialRecord(row,kind,job,now);
   const key=Object.fromEntries(spec.keys.map(k=>[k,row[k]]));
   archive.sourceTable=table;archive.sourceKey=key;
   const archiveKey={pk:'REQUEST#'+job.requestId,sk:kind.toUpperCase()+'#'+JSON.stringify(key)};
   const previous=await get(archiveTable,archiveKey);
   if(previous&&JSON.stringify(previous.data)!==JSON.stringify(archive.data))throw error('ARCHIVE_CONFLICT');
   const removeFields=spec.kind==='order'?orderPii.filter(k=>row[k]!==undefined):['description','metadata','reason','note','fundingSnapshot','rejectionReason','checkoutUrl','userId','name','phone','email','customerName','customerPhone','customerEmail','respMessage','failureReason'].filter(k=>row[k]!==undefined);
   const names={'#request':'accountDeletionRequestId','#until':'financialRetainUntil','#confirmed':'financialArchiveConfirmed'},values={':request':job.requestId,':until':Math.max(archive.expiresAt,Number.isSafeInteger(row.financialRetainUntil)?row.financialRetainUntil:0),':confirmed':true};
   removeFields.forEach((field,i)=>names['#p'+i]=field);
   const guard=condition(row,[...spec.keys,owner,'financialRetainUntil','financialArchiveConfirmed','accountDeletionRequestId',...['status','amount','updatedAt'].filter(k=>row[k]!==undefined)]);
   const write={Update:{TableName:table,Key:key,UpdateExpression:'SET #request = :request, #until = :until, #confirmed = :confirmed'+(removeFields.length?' REMOVE '+removeFields.map((_,i)=>'#p'+i).join(', '):''),ConditionExpression:guard.ConditionExpression,ExpressionAttributeNames:{...guard.ExpressionAttributeNames,...names},ExpressionAttributeValues:{...guard.ExpressionAttributeValues,...values}}};
   await db.send(new TransactWriteCommand({TransactItems:[fence(r),...(previous?[]:[{Put:{TableName:archiveTable,Item:{...archiveKey,...archive},ConditionExpression:'attribute_not_exists(pk)'}}]),write]}));
  }
 }
 async function wallets(r,job){
  for(const snapshot of job.wallets){const core=snapshot.source==='CORE',table=core?'staging-Wallets':'WizzUser_wallets_staging',key=core?{walletId:snapshot.walletId,sk:'META'}:{walletId:snapshot.walletId};const w=await get(table,key);if(!w)throw error('WALLET_NOT_FOUND');if(w.status==='CLOSED'&&w.deletionRequestId===job.requestId)continue;
   const balance=core?'availableBalance':'balance';if(w[balance]!==0||(core&&w.lockedBalance!==0)||w.deletionRequestId!==job.requestId)throw error('WALLET_CLOSURE_BLOCKED');
   await db.send(new TransactWriteCommand({TransactItems:[fence(r),{Update:{TableName:table,Key:key,UpdateExpression:'SET #status = :closed',ConditionExpression:'deletionRequestId = :request AND #balance = :zero AND #status = :suspended'+(core?' AND lockedBalance = :zero':''),ExpressionAttributeNames:{'#status':'status','#balance':balance},ExpressionAttributeValues:{':closed':'CLOSED',':request':job.requestId,':zero':0,':suspended':'SUSPENDED'}}}]}));
  }
 }
 async function identityLease(r){
  const current=await get(requestTable,{pk:r.pk,sk:r.sk});
  if(current?.leaseOwner!==r.leaseOwner||current?.version!==r.version||current?.leaseUntil<=Math.floor(new Date(clock()).getTime()/1000))throw error('LEASE_LOST');
 }
 async function identity(command,r,job){
  await identityLease(r);
  // Use the immutable Cognito subject, never a recyclable phone/email alias.
  try{const u=await cognito.send(new AdminGetUserCommand({UserPoolId:pool,Username:job.subjectId}));if(!(u.UserAttributes||[]).some(a=>a.Name==='sub'&&a.Value===job.subjectId))throw error('IDENTITY_GENERATION_CHANGED');await cognito.send(new command({UserPoolId:pool,Username:job.subjectId}));}catch(e){if(e.name!=='UserNotFoundException')throw e;}
 }
 return {async execute(step,r,job){
  if(r.actorType!==actorType||!r.leaseOwner||!Number.isSafeInteger(r.version)||job.subjectId!==r.subjectId||job.requestId!==r.requestId||job.pool!==pool)throw error('INVALID_CLEANUP_SCOPE');
  if(step==='disableIdentity'){await identity(AdminDisableUserCommand,r,job);await identity(AdminUserGlobalSignOutCommand,r,job);return;}
  if(step==='personalData')return personal(r,job);
  if(step==='financialArchive')return financial(r,job);
  if(step==='walletClosure')return wallets(r,job);
  if(step==='profileClosure'){for(const id of job.profileIds){const row=await get(profileTable,{[profileKey]:id});if(!row)continue;if(row.deletionRequestId!==job.requestId)throw error('PROFILE_GENERATION_CHANGED');if(actorType==='CUSTOMER'&&['profileImage','profileImageUrl','photoUrl','avatarUrl'].some(k=>row[k]))throw error('ASSET_INVENTORY_REQUIRED');await remove(r,profileTable,{[profileKey]:id},row,['deletionRequestId','cognitoSub','cognitoUsername']);}return;}
  if(step==='identityClosure'){await identity(AdminDeleteUserCommand,r,job);return;}
  throw error('INVALID_CLEANUP_STEP');
 }};
}
module.exports={customerCleanup,financialRecord,ORDER_PII,PERSONAL};
