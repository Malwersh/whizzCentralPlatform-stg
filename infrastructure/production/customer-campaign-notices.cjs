'use strict';

const {createHash,randomUUID}=require('node:crypto');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,PutCommand,QueryCommand,ScanCommand,UpdateCommand,TransactWriteCommand}=
  require('@aws-sdk/lib-dynamodb');
const {production,pending,jobIdFor}=require('../../backend/staff-service/campaign-notifications');
const {promotionConsent,fenceNotificationSnapshot}=require('../../backend/src/handlers/customer-promotion-consent-449');
const {build:customerInbox}=require('../../backend/src/utils/customer-inbox');
const {firebaseBinding}=require('../../backend/src/utils/notification-provider-bindings');
const {getMessaging}=require('../../backend/src/utils/firebase');

const account='746727375268',region='us-east-1',name='wizz-production-customer-campaign-notices';
const schedule=`arn:aws:events:${region}:${account}:rule/${name}`;
const {jobs:outbox,offers}=production;
const table=name=>'wizz-production-'+name;
const devices=table('PushDeviceTokens'),profiles=table('Customers'),addresses=table('Addresses');
const deletion=table('AccountDeletion'),merchants=table('Merchants');
const streamPattern=/^arn:aws:dynamodb:us-east-1:746727375268:table\/wizz-production-WalletNotifications\/stream\/[\w.:-]+$/;
const validSubject=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const explicitlyRejected=new Set(['messaging/third-party-auth-error','messaging/invalid-apns-credentials']);
const lifeKey=subject=>({pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+subject,sk:'META'});
const active=(campaign,job,at)=>campaign && !campaign.benefit && !campaign.deletedAt && !campaign.isDeleted &&
  campaign.version===job.campaignVersion && campaign.status==='active' && campaign.isActive!==false &&
  Date.parse(campaign.validFrom||campaign.startDate)<=at && Date.parse(campaign.validTo||campaign.endDate)>at &&
  (!(campaign.usageLimit??campaign.limit) || Math.max(campaign.usage??0,campaign.currentUsage??0,
    campaign.usageCount??0,campaign.usage_count??0)<(campaign.usageLimit??campaign.limit));

function createHandler({db,messaging,stream,clock=Date.now,journey}) {
  const seconds=()=>Math.floor(clock()/1000);
  const read=async(TableName,Key,ProjectionExpression)=>(await db.send(new GetCommand({
    TableName,Key,ConsistentRead:true,...(ProjectionExpression?{ProjectionExpression}:{}),
  }))).Item;
  async function profileFor(subject) {
    const [profile,blocked]=await Promise.all([read(profiles,{userId:subject},'userId,cognitoSub,isActive,isDeleted,deletedAt,deletionRequestId,notification_settings,marketing_consent,createdAt,isVip'),read(deletion,lifeKey(subject))]);
    return !blocked && profile?.cognitoSub===subject && profile.isActive!==false && !profile.isDeleted &&
      !profile.deletedAt && !profile.deletionRequestId && promotionConsent(profile) ? profile : null;
  }
  async function customerRegions(subject,j) {
    const res=await db.send(new QueryCommand({TableName:addresses,IndexName:'userId-isDefault-index',
      KeyConditionExpression:'userId=:user AND isDefault=:current',
      ExpressionAttributeValues:{':user':subject,':current':'true'},ProjectionExpression:'addressId',Limit:5}));
    for(const candidate of res.Items??[]){
      const current=await read(addresses,{addressId:candidate.addressId},'addressId,userId,isDefault,deletedAt,isDeleted,regionId');
      if(current?.userId===subject && [true,'true'].includes(current.isDefault) &&
          !current.deletedAt && !current.isDeleted && current.regionId)
        return j.regionAncestors(db,current.regionId);
    }
    return [];
  }
  async function selection(row,campaign,j) {
    const subject=row.subjectId;
    if(typeof subject!=='string' || !validSubject.test(subject) || typeof row.token!=='string' || !row.token ||
       row.app!=='user' || row.env!=='production' || row.isDeleted || row.disabled ||
       !Number.isFinite(row.ttl) || row.ttl<=seconds()) return null;
    const profile=await profileFor(subject);
    if(!profile) return null;
    const targeted=Boolean(campaign.targetRegionIds?.length || campaign.targetRestaurants?.length ||
      campaign.allowedBusinessIds?.length || campaign.businessIds?.length || campaign.businessId);
    const regionIds=targeted?await customerRegions(subject,j):[];
    const identity={sub:subject,userId:subject,profile};
    let terms;
    try {
      terms=await j.eligibility(db,campaign,{identity,customer:await j.customerState(db,identity),regionIds,source:'platform',preview:true});
    }catch(error){
      if((error.statusCode===409||error.status===409) && error.message!=='OFFER_HISTORY_UNAVAILABLE')return null;
      throw error;
    }
    if(terms.merchants.length){
      const rows=await Promise.all(terms.merchants.map(businessId=>read(merchants,{businessId})));
      if(!rows.some(b=>b?.isActive===true && b.status==='approved' && !b.isDeleted && !b.deletedAt &&
         !b.platformSuspended && !b.deletionRequestId && (!b.regionId||regionIds.includes(b.regionId))))return null;
    }
    const current=await read(devices,{token:row.token});
    if(current?.subjectId!==subject || current.app!=='user' || current.env!=='production' || current.disabled ||
       current.isDeleted || !Number.isFinite(current.ttl) || current.ttl<=seconds())return null;
    return profileFor(subject);
  }
  async function deliver(job,row,campaign,j) {
    const Key={eventId:'CAMPAIGN_PUSH_TOKEN#'+createHash('sha256').update(JSON.stringify([job.jobId,row.token])).digest('hex')};
    const earlier=await read(outbox,Key);
    if(earlier && !(earlier.status==='REJECTED'&&job.retriedAt&&earlier.retriedAt!==job.retriedAt))
      return earlier.status==='SENT'?'SENT':earlier.failureCode||'DELIVERY_UNKNOWN';
    const profile=await selection(row,campaign,j);
    if(!profile)return null;
    if(!active(await read(offers,{discountId:job.discountId}),job,clock()))return 'STOP';
    const sender=await messaging();
    const subjectId=row.subjectId;
    const condition={
      TableName:profiles,Key:{userId:subjectId},
      ConditionExpression:'cognitoSub=:sub AND (attribute_not_exists(isActive) OR isActive<>:false) AND (attribute_not_exists(isDeleted) OR isDeleted<>:true) AND (attribute_not_exists(deletedAt) OR attribute_type(deletedAt,:nil)) AND (attribute_not_exists(deletionRequestId) OR attribute_type(deletionRequestId,:nil))',
      ExpressionAttributeNames:{'#consent':'marketing_consent'},
      ExpressionAttributeValues:{':sub':subjectId,':false':false,':true':true,':nil':'NULL'},
    };
    if(Object.hasOwn(profile,'marketing_consent')){
      condition.ConditionExpression+=' AND #consent=:consent';
      condition.ExpressionAttributeValues[':consent']=profile.marketing_consent;
    }else condition.ConditionExpression+=' AND attribute_not_exists(#consent)';
    fenceNotificationSnapshot(condition,profile);
    const attempt={TableName:outbox,Item:{...Key,status:'ATTEMPTED',...(job.retriedAt?{retriedAt:job.retriedAt}:{}),
      ttl:seconds()+30*86400},ConditionExpression:'attribute_not_exists(eventId)'};
    if(earlier)Object.assign(attempt,{ConditionExpression:'#status=:rejected AND (attribute_not_exists(retriedAt) OR retriedAt<>:retry)',
      ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':rejected':'REJECTED',':retry':job.retriedAt}});
    try {
      await db.send(new TransactWriteCommand({TransactItems:[
        {ConditionCheck:{TableName:deletion,Key:lifeKey(subjectId),ConditionExpression:'attribute_not_exists(pk)'}},
        {ConditionCheck:condition},{Put:attempt},
      ]}));
    }catch(error){
      if(error.name==='TransactionCanceledException')return null;
      throw error;
    }
    const item=customerInbox({subjectId,eventKey:job.jobId,type:'campaign_offer',title:job.title,body:job.body,
      campaignId:job.discountId,at:new Date(clock()).toISOString()});
    try{await db.send(new PutCommand({TableName:outbox,Item:item,ConditionExpression:'attribute_not_exists(eventId)'}));}
    catch(error){if(error.name!=='ConditionalCheckFailedException')throw error;}
    let outcome='SENT';
    try{
      await sender.send({token:row.token,notification:{title:job.title,body:job.body},
        data:{eventId:item.eventId,subjectId,type:'campaign_offer',campaignId:job.discountId,
          code:campaign.code||'',campaignVersion:String(job.campaignVersion)},
        android:{priority:'high',notification:{tag:job.jobId}},
        apns:{headers:{'apns-collapse-id':job.jobId.slice(0,48)},payload:{aps:{sound:'default'}}}});
    }catch(error){outcome=/^messaging\/[a-z-]+$/.test(error.code??'')?error.code:'DELIVERY_UNKNOWN';}
    const failed=outcome!=='SENT';
    await db.send(new UpdateCommand({TableName:outbox,Key,UpdateExpression:'SET #status=:status'+(failed?', failureCode=:code':''),
      ConditionExpression:'#status=:attempted',ExpressionAttributeNames:{'#status':'status'},
      ExpressionAttributeValues:{':attempted':'ATTEMPTED',':status':failed?(explicitlyRejected.has(outcome)?'REJECTED':'FAILED'):'SENT',
        ...(failed?{':code':outcome}:{})}}));
    return outcome;
  }

  async function run(eventId,context) {
    if(!/^CAMPAIGN_PUSH#[a-f0-9]{64}$/.test(eventId??''))return;
    const Key={eventId},owner=randomUUID(),at=seconds();
    let job;
    try{
      job=(await db.send(new UpdateCommand({TableName:outbox,Key,ReturnValues:'ALL_NEW',
        UpdateExpression:'SET leaseOwner=:owner,leaseUntil=:lease,#state=:sending',
        ConditionExpression:'deliveryStatus=:pending AND nextAttemptAt<=:now AND (attribute_not_exists(leaseUntil) OR leaseUntil<=:now) AND #type=:type',
        ExpressionAttributeNames:{'#type':'type','#state':'status'},
        ExpressionAttributeValues:{':owner':owner,':lease':at+120,':sending':'SENDING',':pending':pending,
          ':now':at,':type':'campaign_push_job'}}))).Attributes;
    }catch(error){if(error.name==='ConditionalCheckFailedException')return;throw error;}
    const counts=job.progress??{targeted:0,sent:0,failed:0,failuresByCode:{}};
    let cursor=job.scanCursor??null;
    async function update(status,waiting){
      await db.send(new UpdateCommand({TableName:outbox,Key,ConditionExpression:'leaseOwner=:owner',
        UpdateExpression:waiting
          ? 'SET #state=:status,nextAttemptAt=:next,progress=:counts,scanCursor=:cursor REMOVE leaseOwner,leaseUntil'
          : 'SET #state=:status,deliveryStatus=:finished,resultCounts=:counts,completedAt=:time,#ttl=:ttl REMOVE leaseOwner,leaseUntil,progress,scanCursor',
        ExpressionAttributeNames:{'#state':'status',...(!waiting?{'#ttl':'ttl'}:{})},
        ExpressionAttributeValues:{':owner':owner,':status':status,':counts':counts,...(waiting?
          {':next':seconds()+15,':cursor':cursor}:{':finished':'STORED',':time':new Date(clock()).toISOString(),':ttl':seconds()+30*86400})}}));
    }
    const campaign=await read(offers,{discountId:job.discountId});
    if(!active(campaign,job,clock()) || production.key(jobIdFor(campaign)).eventId!==eventId){
      await update('CANCELLED',false);return;
    }
    const engine=journey??require('./offer-eligibility.cjs');
    // Checkpoint after each page. Token attempt records fence a repeated page after a lost response.
    for(let page=0;page<5;page++){
      const res=await db.send(new ScanCommand({TableName:devices,Limit:20,ConsistentRead:true,Select:'SPECIFIC_ATTRIBUTES',
        ExclusiveStartKey:cursor??undefined,ProjectionExpression:'#token,subjectId,app,env,#ttl,isDeleted,disabled',
        ExpressionAttributeNames:{'#token':'token','#ttl':'ttl'}}));
      for(const row of res.Items??[]){
        if(context.getRemainingTimeInMillis()<12000){await update('QUEUED',true);return;}
        if(row.app==='user'&&row.env==='production'&&typeof row.token==='string'){
          const outcome=await deliver(job,row,campaign,engine);
          if(outcome==='STOP'){await update('CANCELLED',false);return;}
          if(outcome){
            counts.targeted++;
            if(outcome==='SENT')counts.sent++;
            else{
              counts.failed++;
              counts.failuresByCode[outcome]=(counts.failuresByCode[outcome]??0)+1;
            }
          }
        }
        cursor={token:row.token};
      }
      cursor=res.LastEvaluatedKey??null;
      if(!cursor){
        await update(counts.failed?(counts.sent?'PARTIAL':'FAILED'):counts.sent?'SENT':'NO_RECIPIENTS',false);
        return;
      }
    }
    await update('QUEUED',true);
  }

  return async(event,context)=>{
    const scheduled=event?.source==='aws.events' && event.account===account && event.region===region &&
      event['detail-type']==='Scheduled Event' && Array.isArray(event.resources) && event.resources.includes(schedule);
    const streamed=Array.isArray(event?.Records)&&event.Records.length>0&&event.Records.length<=5&&event.Records.every(row=>
      row.eventSource==='aws:dynamodb'&&row.eventSourceARN===stream&&typeof row.dynamodb?.SequenceNumber==='string');
    if(!scheduled&&!streamed)throw Error('INVALID_CUSTOMER_CAMPAIGN_TRIGGER');
    if(scheduled){
      const res=await db.send(new QueryCommand({TableName:outbox,IndexName:'PendingDelivery',Limit:10,
        KeyConditionExpression:'deliveryStatus=:pending AND nextAttemptAt<=:now',ProjectionExpression:'eventId',
        ExpressionAttributeValues:{':pending':pending,':now':seconds()}}));
      for(const row of res.Items??[]){
        if(context.getRemainingTimeInMillis()<15000)break;
        try{await run(row.eventId,context);}catch(error){console.warn('Campaign recovery retry',{name:error.name});}
      }
      return {batchItemFailures:[]};
    }
    const failures=[];
    for(const row of event.Records){
      if(row.eventName!=='INSERT')continue;
      try {
        if(context.getRemainingTimeInMillis()<15000)throw Error('CAMPAIGN_TIME_BUDGET');
        await run(row.dynamodb.Keys?.eventId?.S,context);
      }catch(error){console.warn('Campaign notice batch retry',{name:error.name});
        failures.push({itemIdentifier:row.dynamodb.SequenceNumber});}
    }
    return {batchItemFailures:failures};
  };
}

const db=DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}));
module.exports={createHandler,handler(event,context){
  const stream=process.env.CAMPAIGN_NOTICE_STREAM_ARN;
  if(process.env.STAGE!=='production'||process.env.AWS_REGION!==region||!streamPattern.test(stream??''))
    throw Error('CUSTOMER_CAMPAIGN_NOTICES_NOT_CONFIGURED');
  firebaseBinding();
  return createHandler({db,stream,messaging:getMessaging})(event,context);
}};
