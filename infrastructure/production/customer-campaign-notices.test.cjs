'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHandler}=require('./customer-campaign-notices.cjs');
const {production,pending,jobIdFor}=require('../../backend/staff-service/campaign-notifications');

const account='746727375268',region='us-east-1';
const stream=`arn:aws:dynamodb:${region}:${account}:table/wizz-production-WalletNotifications/stream/2026-11-25T12:00:00.000`;
const name='wizz-production-customer-campaign-notices';
const scheduled={source:'aws.events',account,region,'detail-type':'Scheduled Event',
  resources:[`arn:aws:events:${region}:${account}:rule/${name}`]};
const context={getRemainingTimeInMillis:()=>55000};

function fixture() {
  let now=Date.parse('2026-11-25T12:00:00Z'), failCode, drift=false;
  const subject=n=>String(n).repeat(8)+'-aaaa-4bbb-8ccc-'+String(n).repeat(12);
  const yes=subject(1),no=subject(2),other=subject(3),legacy=subject(4),accountClosed=subject(5);
  const campaign={discountId:'sale',version:2,status:'active',isActive:true,usageLimit:20,code:'CODE',
    validFrom:'2026-11-25T11:00:00Z',validTo:'2026-11-25T22:00:00Z',targetRegionIds:['hira']};
  function profile(id,consent,flag=consent){return {userId:id,cognitoSub:id,isActive:true,
    ...(consent===undefined?{}:{marketing_consent:consent}),
    ...(flag===undefined?{}:{notification_settings:{promotion_notifications:flag}})};}
  const people=new Map([[yes,profile(yes,true)],[no,profile(no,false,true)],[other,profile(other,true)],
    [legacy,profile(legacy)],[accountClosed,profile(accountClosed,true)]]);
  function device(token,subjectId,env='production'){return {token,subjectId,env,app:'user',ttl:Math.floor(now/1000)+3600};}
  const tokens=[device('good',yes),device('declined',no),device('other-region',other),device('unset',legacy),
    device('closed',accountClosed),device('wrong-env',yes,'staging'),device('moved',yes)];
  const registered=new Map(tokens.map(r=>[r.token,{...r}]));
  registered.get('moved').subjectId=other;
  const jobId=jobIdFor(campaign),job={...production.key(jobId),jobId,discountId:'sale',campaignVersion:2,
    status:'QUEUED',deliveryStatus:pending,title:'خصم',body:'عرض متاح'};
  const attempts=new Map(),inbox=new Map(),messages=[],calls=[];
  const db={async send(c){
    const x=c.input,v=x.ExpressionAttributeValues,t=x.TableName;
    if(t)assert.ok(t.startsWith('wizz-production-'),t);
    calls.push(c);
    switch(c.constructor.name){
    case 'GetCommand':
      if(t===production.offers)return {Item:{...campaign,...(drift?{version:3}:{})}};
      if(t.endsWith('Customers'))return {Item:people.get(x.Key.userId)};
      if(t.endsWith('PushDeviceTokens'))return {Item:registered.get(x.Key.token)};
      if(t.endsWith('Addresses'))return {Item:{addressId:x.Key.addressId,userId:x.Key.addressId,isDefault:'true',
        regionId:x.Key.addressId===other?'other':'hira'}};
      if(t.endsWith('AccountDeletion'))return x.Key.pk.endsWith(accountClosed)?{Item:{pk:x.Key.pk}}:{};
      return {Item:attempts.get(x.Key.eventId)};
    case 'ScanCommand':
      assert.equal(t,'wizz-production-PushDeviceTokens');
      return {Items:tokens.slice(tokens.findIndex(r=>r.token===x.ExclusiveStartKey?.token)+1)};
    case 'QueryCommand':
      if(t.endsWith('Addresses'))return {Items:[{addressId:v[':user']}]};
      return {Items:job.deliveryStatus===pending?[{eventId:job.eventId}]:[]};
    case 'TransactWriteCommand': {
      const [lifecycle,consent,{Put}]=x.TransactItems;
      assert.ok(lifecycle.ConditionCheck.Key.pk.endsWith(yes));
      assert.match(consent.ConditionCheck.ConditionExpression,/#notificationSnapshot = :notificationSnapshot/);
      attempts.set(Put.Item.eventId,{...Put.Item});return {};
    }
    case 'PutCommand':
      assert.equal(x.Item.deliveryStatus,'STORED');inbox.set(x.Item.eventId,x.Item);return {};
    case 'UpdateCommand':
      if(x.Key.eventId!==job.eventId){
        Object.assign(attempts.get(x.Key.eventId),{status:v[':status'],failureCode:v[':code']});return {};
      }
      if(x.ReturnValues){
        if(job.deliveryStatus!==pending || job.leaseOwner)
          throw Object.assign(Error(),{name:'ConditionalCheckFailedException'});
        job.leaseOwner=v[':owner'];
        return {Attributes:structuredClone(job)};
      }
      assert.equal(v[':owner'],job.leaseOwner);
      delete job.leaseOwner;
      if(v[':finished']){job.deliveryStatus=v[':finished'];job.resultCounts=v[':counts'];}
      else{job.scanCursor=v[':cursor'];job.progress=v[':counts'];}
      job.status=v[':status'];return {};
    default:throw Error(c.constructor.name);
    }
  }};
  const journey={regionAncestors:async(db,region)=>[region],customerState:async()=>null,
    eligibility:async(db,offer,ctx)=>{
      if(!ctx.regionIds.includes('hira'))throw Object.assign(Error('OFFER_WRONG_REGION'),{status:409});
      return {merchants:[]};
    }};
  const handler=createHandler({db,stream,journey,clock:()=>now,messaging:async()=>({send:async message=>{
    messages.push(message);
    if(failCode)throw Object.assign(Error(),{code:failCode});
  }})});
  return {handler,job,campaign,attempts,inbox,messages,calls,
    disable:()=>people.set(yes,profile(yes,false)),moveVersion:()=>{drift=true;},
    fail:code=>{failCode=code;},yes};
}
test('production only targets valid opted-in devices and writes the deep-link inbox once',async()=>{
  const f=fixture();
  assert.deepEqual(await f.handler(scheduled,context),{batchItemFailures:[]});
  assert.deepEqual(f.messages.map(m=>m.token),['good']);
  assert.deepEqual([...f.inbox.values()].map(row=>row.driverId),[f.yes]);
  assert.equal(f.messages[0].data.campaignId,'sale');
  assert.equal(f.messages[0].data.eventId,[...f.inbox.keys()][0]);
  assert.equal(f.job.status,'SENT');
  await f.handler(scheduled,context);
  assert.equal(f.messages.length,1);
});
test('opt-out and stale versions suppress dispatch without reading another account',async()=>{
  const declined=fixture();declined.disable();
  await declined.handler(scheduled,context);
  assert.equal(declined.job.status,'NO_RECIPIENTS');
  assert.equal(declined.messages.length,0);
  const stale=fixture();stale.moveVersion();
  await stale.handler(scheduled,context);
  assert.equal(stale.job.status,'CANCELLED');
  assert.equal(stale.calls.some(c=>c.constructor.name==='ScanCommand'),false);
  await assert.rejects(stale.handler({httpMethod:'POST'},context),/INVALID_CUSTOMER_CAMPAIGN_TRIGGER/);
});
test('explicitly rejected Apple deliveries can retry without creating a duplicate inbox record',async()=>{
  const f=fixture();f.fail('messaging/third-party-auth-error');
  await f.handler(scheduled,context);
  assert.equal(f.job.status,'FAILED');
  assert.equal(f.job.resultCounts.failuresByCode['messaging/third-party-auth-error'],1);
  Object.assign(f.job,{status:'QUEUED',deliveryStatus:pending,retriedAt:'2026-11-25T12:02:00Z'});
  f.fail(undefined);
  await f.handler(scheduled,context);
  assert.equal(f.messages.length,2);
  assert.equal(f.inbox.size,1);
  assert.equal(f.job.status,'SENT');
});
