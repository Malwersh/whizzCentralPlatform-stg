'use strict';
const {createHash}=require('node:crypto');
const {GetCommand,ScanCommand,PutCommand,UpdateCommand}=require('@aws-sdk/lib-dynamodb');
const {eligibility,customerState,regionAncestors}=require('./campaign-push-eligibility');
const STAFF='staging-PlatformStaff',OFFERS='WizzCentral_Platform_Discounts';
async function scan(db,TableName,extra={}){
 const items=[];let cursor;
 do{const page=await db.send(new ScanCommand({TableName,...extra,ExclusiveStartKey:cursor}));items.push(...(page.Items||[]));cursor=page.LastEvaluatedKey;}while(cursor);
 return items;
}
function createWorker({db,messaging,clock=()=>Date.now(),eligible=eligibility,customer=customerState,ancestors=regionAncestors}){
 return async function run(jobId){
  if(typeof jobId!=='string'||!/^[a-f0-9]{64}$/.test(jobId))throw Error('INVALID_CAMPAIGN_PUSH_JOB');
  const Key={pk:'CAMPAIGN_PUSH#'+jobId,sk:'META'};
  const job=(await db.send(new GetCommand({TableName:STAFF,Key,ConsistentRead:true}))).Item;
  if(!job||job.status!=='QUEUED')return;
  const campaign=(await db.send(new GetCommand({TableName:OFFERS,Key:{discountId:job.discountId},ConsistentRead:true}))).Item;
  async function finish(status,counts={}){await db.send(new UpdateCommand({TableName:STAFF,Key,UpdateExpression:'SET #s=:s, resultCounts=:counts, completedAt=:at',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':status,':counts':counts,':at':new Date(clock()).toISOString()}}));}
  const live=()=>campaign&&!campaign.isDeleted&&!campaign.deletedAt&&(!(campaign.usageLimit??campaign.limit)||Math.max(campaign.usage||0,campaign.currentUsage||0)<(campaign.usageLimit??campaign.limit))&&campaign.version===job.campaignVersion&&campaign.status==='active'&&campaign.isActive!==false&&Date.parse(campaign.validFrom||campaign.startDate)<=clock()&&Date.parse(campaign.validTo||campaign.endDate)>clock();
  if(!live()){await finish('CANCELLED');return;}
  // Fetch the complete audience before claiming delivery, so registry errors do not send to a partial audience.
  const tokens=(await scan(db,process.env.PUSH_TOKENS_TABLE,{FilterExpression:'#app=:app',ExpressionAttributeNames:{'#app':'app'},ExpressionAttributeValues:{':app':'user'}})).filter(r=>r.app==='user'&&typeof r.token==='string'&&r.token&&typeof r.subjectId==='string');
  const profiles=await scan(db,'WizzUser_users_staging'),addresses=campaign.targetRegionIds?.length?await scan(db,'WizzUser_addresses_staging'):[];
  const bySubject=new Map();for(const p of profiles)for(const id of [p.userId,p.cognitoSub])if(id)bySubject.set(id,p);
  const eligibleSubjects=new Map(),recipients=new Map(),excludedSubjectsByReason={};
  const exclude=reason=>{excludedSubjectsByReason[reason]=(excludedSubjectsByReason[reason]||0)+1;};
  for(const record of tokens){
   if(!eligibleSubjects.has(record.subjectId)){
    const profile=bySubject.get(record.subjectId),guest=record.subjectId.startsWith('GUEST_');let allowed=false;
    if(profile&&!require('./customer-notification-preferences-448').allowed(profile,'promotion')){exclude('CUSTOMER_PROMOTIONS_DISABLED');eligibleSubjects.set(record.subjectId,false);continue;}
    if(guest||profile&&profile.isActive!==false&&!profile.deletionRequestId&&!profile.deletedAt){
     const identity=guest?undefined:{sub:record.subjectId,userId:profile.userId,profile};
     let regionIds=[];
     const address=addresses.find(a=>a.userId===profile?.userId&&(a.isDefault===true||a.isDefault==='true')&&!a.deletedAt);
     if(address?.regionId)regionIds=await ancestors(db,address.regionId);
     try{await eligible(db,campaign,{identity,customer:await customer(db,identity),regionIds,source:'platform'});allowed=true;}
     catch(e){if(!e.status&&!e.statusCode)throw e;if(['OFFER_HISTORY_UNAVAILABLE'].includes(e.message))throw e;exclude(e.message);}
    }
    if(!guest&&!profile)exclude('NO_MATCHING_USER_PROFILE');
    eligibleSubjects.set(record.subjectId,allowed);
   }
   if(eligibleSubjects.get(record.subjectId))recipients.set(record.token,record);
  }
  // Re-read before dispatch: an edited/paused campaign must not send an old announcement.
  const fresh=(await db.send(new GetCommand({TableName:OFFERS,Key:{discountId:job.discountId},ConsistentRead:true}))).Item;
  if(!fresh||fresh.version!==job.campaignVersion||fresh.status!=='active'||fresh.isActive===false){await finish('CANCELLED');return;}
  if(!recipients.size){await finish('NO_RECIPIENTS',{targeted:0,sent:0,failed:0,excludedSubjectsByReason});return;}
  try{await db.send(new UpdateCommand({TableName:STAFF,Key,UpdateExpression:'SET #s=:sending',ConditionExpression:'#s=:queued',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':sending':'SENDING',':queued':'QUEUED'}}));}
  catch(e){if(e.name==='ConditionalCheckFailedException')return;throw e;}
  let sent=0,failed=0,preferenceSkipped=0;const failuresByCode={};
  try{
   const sender=recipients.size?await messaging():null;
   for(const [token,record] of recipients){
    const recipientProfile=bySubject.get(record.subjectId);
    if(recipientProfile&&!require('./customer-notification-preferences-448').allowed(await require('./customer-notification-preferences-448').read(db,recipientProfile.userId),'promotion')){preferenceSkipped++;exclude('CUSTOMER_PROMOTIONS_DISABLED');continue;}
    if(Date.parse(campaign.validTo||campaign.endDate)<=clock())break;
    const eventId = await require('../utils/customer-inbox').record(db, {
      subjectId: record.subjectId, eventKey: jobId, type:'campaign_offer', title:job.title, body:job.body, campaignId:campaign.discountId,
    });
    const tokenKey={pk:'CAMPAIGN_PUSH#'+jobId,sk:'TOKEN#'+createHash('sha256').update(token).digest('hex')};
    try{await db.send(new PutCommand({TableName:STAFF,Item:{...tokenKey,status:'ATTEMPTED',ttl:Math.floor(clock()/1000)+30*86400},ConditionExpression:'attribute_not_exists(pk) OR #s=:rejected',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':rejected':'REJECTED'}}));}
    catch(e){if(e.name==='ConditionalCheckFailedException')continue;throw e;}
    try{await sender.send({token,notification:{title:job.title,body:job.body},data:{eventId,subjectId:record.subjectId,type:'campaign_offer',campaignId:campaign.discountId,code:campaign.code||'',campaignVersion:String(campaign.version)},android:{priority:'high',notification:{tag:jobId}},apns:{headers:{'apns-collapse-id':jobId.slice(0,48)},payload:{aps:{sound:'default'}}}});sent++;}
    catch(e){
     failed++;const code=e.code||e.name;failuresByCode[code]=(failuresByCode[code]||0)+1;
     console.warn('Campaign customer push failed',{jobId,code});
     if(['messaging/third-party-auth-error','messaging/invalid-apns-credentials'].includes(code)){
      // FCM explicitly rejected these sends. Only these token attempts may be retried.
      await db.send(new UpdateCommand({TableName:STAFF,Key:tokenKey,UpdateExpression:'SET #s=:rejected, failureCode=:code',ConditionExpression:'#s=:attempted',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':rejected':'REJECTED',':attempted':'ATTEMPTED',':code':code}}));
     }
    }
   }
   await finish(failed?(sent?'PARTIAL':'FAILED'):(!sent&&preferenceSkipped===recipients.size?'NO_RECIPIENTS':'SENT'),{targeted:recipients.size-preferenceSkipped,sent,failed,excludedSubjectsByReason,failuresByCode});
  }catch(e){await finish('FAILED',{targeted:recipients.size,sent,failed,excludedSubjectsByReason,failuresByCode});throw e;}
 };
}
module.exports={createWorker};
