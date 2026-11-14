'use strict';
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {createHash}=require('node:crypto');
const S='staging-PlatformStaff',B='WhizzMerchants_Businesses',P='staging-MerchantPlatform',L='staging-AccountDeletion';
const fields=['pk','sk','ownerId','businessId','draftVersion','draftHash','eventId','status','createdAt','expiresAt','attempts','nextAttemptAt','leaseUntil','sentTokenHashes','id','kind','version','hash','businessIds','publishedVersion','subjectId','cognitoUserId','deletionRequestId','deletedAt','isDeleted','role','permissionSchema','grant'];
async function send(event,{db,getMessaging,tokensTable,cognito=new CognitoIdentityProviderClient({}),now=Date.now,dryRun=false}){
 if(!event||event.httpMethod||event.requestContext||event.action!=='commercial_notice'||!/^(?:DISCOUNT_FUNDING|DELIVERY_FUNDING)#[A-Za-z0-9_:#.-]{1,150}$/.test(event.pk||'')||!/^NOTICE#[1-9]\d*$/.test(event.sk||''))return {cancelled:true};
 const get=async(table,key)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true,ProjectionExpression:fields.map((_,i)=>'#f'+i).join(','),ExpressionAttributeNames:Object.fromEntries(fields.map((f,i)=>['#f'+i,f]))}))).Item;
 const notice=await get(S,{pk:event.pk,sk:event.sk});if(!notice||!['PENDING','RETRY'].includes(notice.status)||!notice.ownerId||!notice.businessId||!Array.isArray(notice.sentTokenHashes)||!Number.isFinite(Date.parse(notice.expiresAt))||Date.parse(notice.expiresAt)<=now())return {cancelled:true};
 const draft=await get(S,{pk:event.pk,sk:'DRAFT'}),branch=await get(B,{businessId:notice.businessId});
 if(!draft||draft.kind!==(event.pk.startsWith('DELIVERY_FUNDING#')?'DELIVERY':'FUNDING')||draft.hash!==notice.draftHash||draft.version!==notice.draftVersion||draft.publishedVersion||draft.ownerId!==notice.ownerId||!draft.businessIds?.includes(notice.businessId)||!branch||branch.ownerId!==notice.ownerId||branch.cognitoUserId!==notice.ownerId||branch.deletionRequestId||branch.deletedAt||branch.isDeleted)return {cancelled:true};
 if(await get(S,{pk:event.pk,sk:'CONSENT#'+notice.draftVersion}))return {cancelled:true};
 for(const pk of ['ACCOUNT_LIFECYCLE#MERCHANT#'+notice.ownerId,'BUSINESS_LIFECYCLE#MERCHANT#'+notice.businessId])if(await get(L,{pk,sk:'META'}))return {cancelled:true};
 const subjects=new Set([notice.ownerId]);let membersCursor;
 for(let page=0;page<5;page++){
  const q=await db.send(new QueryCommand({TableName:P,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':'BRANCH#'+notice.businessId,':prefix':'MEMBER#'},ProjectionExpression:fields.map((_,i)=>'#f'+i).join(','),ExpressionAttributeNames:Object.fromEntries(fields.map((f,i)=>['#f'+i,f])),ConsistentRead:true,Limit:100,...(membersCursor?{ExclusiveStartKey:membersCursor}:{})}));
  let policy;
  for(const member of q.Items||[]){if(member.permissionSchema===2&&!policy)policy=(await db.send(new GetCommand({TableName:S,Key:{pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'},ProjectionExpression:'#v, enabledPermissions',ExpressionAttributeNames:{'#v':'version'}}))).Item;
   if(require('../../staff-service/commercial-party').manager(member,branch,member.subjectId,policy)&&!await get(L,{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+member.subjectId,sk:'META'}))subjects.add(member.subjectId);
  }
  membersCursor=q.LastEvaluatedKey;if(!membersCursor)break;if(page===4)throw Error('MEMBER_LIST_INCOMPLETE');
 }
 const tokens=new Set(),subjectTokens=new Map();
 for(const subjectId of subjects){
  let identity;try{identity=await cognito.send(new AdminGetUserCommand({UserPoolId:'us-east-1_gtCR3ndzT',Username:subjectId}));}catch(e){if(e.name==='UserNotFoundException')continue;throw e;}
  if(!identity.Enabled||identity.UserStatus!=='CONFIRMED'||identity.UserAttributes?.find(a=>a.Name==='sub')?.Value!==subjectId)continue;
  let cursor;const selected=[];
  for(let page=0;page<20;page++){
   const r=await db.send(new QueryCommand({TableName:tokensTable,IndexName:'SubjectIdIndex',KeyConditionExpression:'subjectId=:sub',ExpressionAttributeValues:{':sub':subjectId},...(cursor?{ExclusiveStartKey:cursor}:{}),Limit:100}));
   for(const row of r.Items||[]){if(row.subjectId!==subjectId||row.app!=='merchant'||row.branchDeviceId||String(row.token||'').startsWith('BRANCH_DEVICE#')||typeof row.token!=='string'||!row.token||row.isDeleted||row.disabled||row.expiresAt&&Number(row.expiresAt)<=Math.floor(now()/1000))continue;const hash=createHash('sha256').update(row.token).digest('hex');if(!notice.sentTokenHashes.includes(hash)&&!tokens.has(row.token)){tokens.add(row.token);selected.push(row.token);}}
   cursor=r.LastEvaluatedKey;if(!cursor)break;if(page===19)throw Error('TOKEN_LIST_INCOMPLETE');
  }
  if(selected.length)subjectTokens.set(subjectId,selected);
 }
 if(dryRun)return {verified:true,targetCount:tokens.size,ownerOrManagerScoped:true,sharedDevicesExcluded:true};
 if(!tokens.size)return {noDevices:true};
 const messaging=await getMessaging(),sentTokenHashes=[],failureHashes=[],failureCodes=[];let delivered=0;
 for(const [subjectId,list] of subjectTokens)for(let i=0;i<list.length;i+=500){const group=list.slice(i,i+500),result=await messaging.sendEachForMulticast({tokens:group,notification:{title:draft.kind==='DELIVERY'?'عرض توصيل بانتظار موافقتك':'طلب مشاركة في خصم',body:draft.kind==='DELIVERY'?'أرسلت المنصة عرض توصيل. راجع الشروط؛ موافقتك تفعّله وفق مدته.':'لديك طلب مشاركة ينتظر موافقتك. افتح التطبيق لمراجعة الشروط.'},data:{type:'commercial_sharing_requested',action:'commercial_sharing_requested',subjectId,businessId:notice.businessId,sharingId:draft.id,requestKind:draft.kind,draftVersion:String(draft.version),eventId:notice.eventId,updatedAt:notice.createdAt},android:{priority:'high',collapseKey:notice.eventId,notification:{sound:'default'}},apns:{headers:{'apns-priority':'10','apns-push-type':'alert','apns-collapse-id':createHash('sha256').update(notice.eventId).digest('hex')},payload:{aps:{sound:'default'}}}});
  result.responses.forEach((r,index)=>{const hash=createHash('sha256').update(group[index]).digest('hex');if(r.success)delivered++;if(r.success||['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(r.error?.code))sentTokenHashes.push(hash);else {failureHashes.push(hash);failureCodes.push(/^messaging\/[a-z-]+$/.test(r.error?.code||'')?r.error.code:'PROVIDER_UNAVAILABLE');}});
 }
 return {complete:failureHashes.length===0&&delivered>0,sentTokenHashes,delivered,noDevices:delivered===0&&failureHashes.length===0,failureCodes:[...new Set(failureCodes)]};
}
module.exports={send,fields};
