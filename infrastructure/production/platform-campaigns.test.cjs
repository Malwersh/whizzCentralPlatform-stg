'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {join}=require('node:path');
const {createHandler,offerTables}=require(join(process.env.WIZZ_CAMPAIGNS_BUILD,'admin.cjs'));
const {identities:{admin}}=require('./wallet-identity-bindings.json');

const at=Date.now(), employee='11111111-1111-4111-8111-111111111111';
const time=delta=>new Date(at+delta).toISOString();
const source='campaign',id='campaign-fixture',apiId='aaaaaaaaaa';
const input={operation:'save',source,id,baseRevision:null,title:'حملة اختبار',description:'الخصم على الأصناف',
  code:'SAVE10',type:'percentage',value:10,minimumOrder:0,maximumSavings:1500,startAt:time(-3600000),
  endAt:time(3600000),status:'draft',audience:['all'],merchantIds:[],regionIds:[],itemIds:[],categoryIds:[],
  applicability:'allItems',campaignType:'promotional',firstOrderOnly:false,singleUse:false,perCustomerLimit:null,usageLimit:20};

function fixture(roles=['promotions_manager','promotions_approver']) {
  const calls=[], writes=[], images=new Map();
  const media={
    put:async (key,body)=>{images.set(key,body);},
    url:async key=>'https://example.test/'+key,
    head:async key=>images.has(key)?{ContentType:key.endsWith('.gif')?'image/gif':'image/jpeg',
      ContentLength:images.get(key).length}:null,
  };
  let offer;
  const jobs=new Map();
  const db={send:async command=>{
    const data=command.input;
    calls.push(data);
    if (data.TableName) assert.match(data.TableName,/^wizz-production-/);
    if(command.constructor.name==='GetCommand'){
      if (data.TableName===offerTables.lock.staff && data.Key.pk==='EMPLOYEE#'+employee)
        return {Item:{employeeId:employee,scope:{allRegions:true},status:'ACTIVE',version:1,roles}};
      if(data.TableName==='wizz-production-WalletNotifications')return {Item:jobs.get(data.Key.eventId)};
      if(data.TableName===offerTables.sources.campaign)return {Item:structuredClone(offer)};
      return {};
    }
    if(command.constructor.name==='ScanCommand'){
      if(data.TableName===offerTables.lock.staff){
        assert.equal(data.Select,'SPECIFIC_ATTRIBUTES');
        assert.match(data.ProjectionExpression,/schemaVersion/);
      }
      return {Items:data.TableName===offerTables.sources.campaign && offer ? [structuredClone(offer)] : []};
    }
    if(command.constructor.name==='TransactWriteCommand'){
      writes.push(data.TransactItems);
      const job=data.TransactItems.find(item=>item.Put?.TableName==='wizz-production-WalletNotifications')?.Put.Item;
      if(job){jobs.set(job.eventId,job);return {};}
      const op=data.TransactItems.find(item=>item.Update?.TableName===offerTables.sources.campaign).Update;
      offer={...offer,...op.Key};
      for(const pair of op.UpdateExpression.slice(4).split(', ')){
        const [field,value]=pair.split('=');
        offer[op.ExpressionAttributeNames[field]]=op.ExpressionAttributeValues[value];
      }
      return {};
    }
    throw Error(command.constructor.name);
  }};
  const handler=createHandler({db,media,apiId,now:()=>at,verifyStaff:async()=>({
    sub:employee,username:'staff',iss:'https://cognito-idp.us-east-1.amazonaws.com/'+admin.poolId,
    client_id:admin.clientId,token_use:'access',exp:Math.floor(at/1000)+600,auth_time:Math.floor(at/1000)-3600,
  }),getStaff:async Username=>({Username,Enabled:true,UserStatus:'CONFIRMED',
    UserAttributes:[{Name:'sub',Value:employee}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']})});
  const call=async body=>{
    const result=await handler({resource:'/staff/offers',requestContext:{apiId,stage:'production'},
      httpMethod:body?'POST':'GET',headers:{Authorization:'Bearer staff-token'},body:body?JSON.stringify(body):undefined});
    return {status:result.statusCode,body:JSON.parse(result.body)};
  };
  return {call,writes,calls,images,offer:()=>offer};
}

test('production draft, publication and pause preserve a versioned code and record an audit entry',async()=>{
  const f=fixture();
  const draft=await f.call(input);
  assert.equal(draft.status,200,JSON.stringify(draft));
  assert.equal(f.offer().status,'draft');
  assert.equal(f.offer().version,1);
  const tx=f.writes[0];
  assert(tx.some(op=>op.Update?.Key.pk==='OFFER_CODE#SAVE10'));
  assert(tx.some(op=>op.Put?.Item.action==='OFFER_SAVED'));
  const [row]=(await f.call()).body.offers;
  assert.equal(row.maximumSavings,1500);
  const published=await f.call({operation:'status',source,id,baseRevision:row.revision,status:'active'});
  assert.equal(published.status,200,JSON.stringify(published));
  assert.equal(f.offer().status,'active');
  assert.equal(f.offer().version,1);
  const [live]=(await f.call()).body.offers;
  const pause=await f.call({operation:'status',source,id,baseRevision:live.revision,status:'paused'});
  assert.equal(pause.status,200);
  assert.equal(f.offer().isActive,false);
});

test('unbounded campaign cannot be published and discount manager needs approval permission',async()=>{
  const f=fixture();
  assert.equal((await f.call({...input,usageLimit:0})).status,200);
  const [draft]=(await f.call()).body.offers;
  const publish={operation:'status',source,id,baseRevision:draft.revision,status:'active'};
  assert.deepEqual(await f.call(publish),{status:400,body:{error:'CAMPAIGN_FINITE_GOODS_REQUIRED'}});
  assert.equal(f.writes.length,1);
  const manager=fixture(['promotions_manager']);
  await manager.call(input);
  const [saved]=(await manager.call()).body.offers;
  assert.equal((await manager.call({...publish,baseRevision:saved.revision})).status,403);
});


test('uploads a private campaign image and atomically saves or removes the owned storage key',async()=>{
  const f=fixture();
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const upload=await f.call({operation:'upload-image',image:gif.toString('base64'),contentType:'image/gif'});
  assert.equal(upload.status,200,JSON.stringify(upload));
  assert.match(upload.body.imageKey,/^home-slideshow\/campaigns-[a-f0-9]{64}\/[a-f0-9-]{36}\.gif$/);
  assert.deepEqual(f.images.get(upload.body.imageKey),gif);
  assert.equal((await f.call({...input,imageKey:'https://example.test/image.gif'})).status,400);
  assert.equal((await f.call({...input,imageKey:upload.body.imageKey.replace(/campaigns-[a-f0-9]{64}/,
    'campaigns-'+'a'.repeat(64))})).status,403);
  assert.equal((await f.call({...input,imageKey:upload.body.imageKey.replace(/\.gif$/,'.jpg')})).status,400);
  assert.equal(f.writes.length,0);
  assert.equal((await f.call({...input,imageKey:upload.body.imageKey})).status,200);
  const [ready]=(await f.call()).body.offers;
  assert.equal(ready.imageUrl,upload.body.imageUrl);
  assert.equal((await f.call({...input,imageKey:'',baseRevision:ready.revision})).status,200);
  assert.equal((await f.call()).body.offers[0].imageUrl,'');
  assert.equal((await f.call({operation:'upload-image',image:'aGVsbG8=',contentType:'image/gif'})).status,400);
  const reader=fixture(['promotions_viewer']);
  assert.equal((await reader.call({operation:'upload-image',image:gif.toString('base64'),contentType:'image/gif'})).status,403);
});


test('staff explicitly queues one current published campaign and can read its state without a second job',async()=>{
  const f=fixture();
  await f.call(input);
  const off=(await f.call()).body.offers[0];
  const request={action:'NOTIFY',discountId:id,source:'PLATFORM',baseRevision:off.revision};
  assert.equal((await f.call(request)).status,409);
  assert.equal((await f.call({operation:'status',source,id,baseRevision:off.revision,status:'active'})).status,200);
  request.baseRevision=(await f.call()).body.offers[0].revision;
  assert.equal((await f.call({...request,baseRevision:off.revision})).status,409);
  assert.equal((await f.call(request)).body.notificationStatus,'QUEUED');
  assert.equal((await f.call(request)).body.notificationStatus,'QUEUED');
  const result=await f.call({action:'NOTIFY_STATUS',discountId:id,source:'PLATFORM'});
  assert.equal(result.body.notificationStatus,'QUEUED');
  const jobs=f.writes.flat().filter(op=>op.Put?.TableName==='wizz-production-WalletNotifications');
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].Put.Item.deliveryStatus,'CAMPAIGN_PENDING');
  assert.equal(jobs[0].Put.Item.driveId,undefined);
});
