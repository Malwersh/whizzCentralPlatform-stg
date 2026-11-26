const {test}=require('node:test'),assert=require('node:assert/strict');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const create=process.env.ELIGIBILITY_CONTEXT_RUNTIME?require(process.env.ELIGIBILITY_CONTEXT_RUNTIME).__eligibilityContext:require('../dist/driverOfferContext').createStagingDriverOfferContext;
const {createStagingDriverOfferStore:store}=require('../dist/driverOfferStore');
const {prepareDriverOfferFinancialSnapshot:envelope}=require('../dist/driverOfferOrderReader');
const {input,at,route}=require('./helpers/driver-offer-fixture.cjs');
const clone=structuredClone,request={orderId:'order1',branchId:'branch1',driverId:'driver1',waveNumber:1,offerId:'offer1'};
const rejected=(p,code)=>assert.rejects(p,e=>!code||e.code===code);
function setup(){
 const source=input(),calls=[],locks=new Map();let clock=Date.parse(at),saved;
 const f={calls,locks,source,identity:{Enabled:true,Username:'driver-sub',UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'driver-sub'}]},
  rows:{WizzOrders:{PK:'ORDER#order1',SK:'META',orderId:'order1',storeId:'branch1',merchantId:'merchant1',status:'ready_for_pickup',financialSnapshot:envelope(source.order)},
  WizzDispatchJobs_staging:{orderId:'order1',SK:'METADATA',dispatchJobId:'dispatch1',restaurantId:'branch1',status:'searching',currentWaveNumber:0,expiresAt:source.assignment.expiresAt},
  WhizzDrivers_staging:{driverId:'driver1',cognitoSub:'driver-sub',status:'APPROVED',vehicleType:'BIKE',phone:'PRIVATE'},
  WizzDriverLiveState_staging:{driverId:'driver1',status:'available',isActive:true,isSearching:true,lat:31.91,lng:44.45,locationUpdatedAt:at},
  'staging-PlatformStaff':{pk:'OPERATIONAL_SETTINGS#DELIVERY_PRICING',sk:'CURRENT',version:1,values:{deliveryRules:[],driverRules:source.policy.rules}},
  WhizzMerchants_Businesses:{businessId:'branch1',ownerId:'owner1',cognitoUserId:'owner1',organizationId:'merchant1',status:'approved'}},
  afterRoute:()=>{},failTable:null,routeCalls:0,identityCalls:0,get saved(){return saved;},set time(v){clock=v;}};
 const db={async send(c){calls.push(c);
  if(c instanceof GetCommand){
   const q=c.input;if(q.TableName===f.failTable)throw Error('private details');
   if(q.TableName==='WaveOffers_staging')return {Item:clone(saved)};
   const row=q.TableName==='staging-AccountDeletion'?locks.get(q.Key.pk):f.rows[q.TableName];
   const fields=Object.values(q.ExpressionAttributeNames);
   return {Item:row?clone(Object.fromEntries(Object.entries(row).filter(([k])=>fields.includes(k)))):undefined};
  }
  assert.ok(c instanceof TransactWriteCommand);
  // Interpret generated equality/absence predicates against the live rows before writing anything.
  for(const op of c.input.TransactItems){if(!op.ConditionCheck)continue;const q=op.ConditionCheck;
   const row=q.TableName==='staging-AccountDeletion'?locks.get(q.Key.pk):f.rows[q.TableName];
   let ok=true;
   if(q.ConditionExpression==='attribute_not_exists(pk)')ok=!row;
   else for(const [alias,field] of Object.entries(q.ExpressionAttributeNames)){
    const token=':v'+alias.slice(2);
    if(Object.hasOwn(q.ExpressionAttributeValues,token))ok&&=JSON.stringify(row?.[field])===JSON.stringify(q.ExpressionAttributeValues[token]);
    else ok&&=row?.[field]===undefined;
   }
   if(!ok){const e=Error('condition rejected');e.name='TransactionCanceledException';throw e;}
  }
  if(saved){const e=Error('duplicate');e.name='TransactionCanceledException';throw e;}
  saved=clone(c.input.TransactItems.find(o=>o.Put).Put.Item);return {};
 }};
 const cognito={async send(c){assert.ok(c instanceof AdminGetUserCommand);assert.equal(c.input.UserPoolId,'us-east-1_RGTqUXF5C');assert.equal(c.input.Username,'driver-sub');f.identityCalls++;return clone(f.identity);}};
 const router={async getRoute(origin,destination){f.routeCalls++;f.afterRoute();return route('route'+f.routeCalls,origin,destination);}};
 f.service=create({db,cognito,router,positionMaxAgeSeconds:120,offerTtlSeconds:60,now:()=>clock});
 f.store=store({db,now:()=>clock});f.prepare=()=>f.service.prepare(request);return f;
}
test('fixed source reads produce a savable offer and bound routes without client economics',async()=>{
 const f=setup(),r=await f.prepare();assert.equal(f.routeCalls,2);assert.equal(f.identityCalls,2);
 assert.equal(r.offer.assignmentVersion,1);assert.equal(r.offer.source.driver.positionVersion,Date.parse(at));
 assert.equal(r.offer.allocation.customerTotal.minorAmount,14500000);
 assert.equal(r.guards.deletions.length,4);assert.equal(r.guards.branch.ConditionCheck.Key.businessId,'branch1');
 assert.ok(f.calls.every(c=>c instanceof GetCommand&&c.input.ConsistentRead&&c.input.ProjectionExpression));
 assert.ok(!JSON.stringify(r).includes('PRIVATE'));
 const saved=await f.store.save(r);assert.equal(saved.replayed,false);assert.equal(f.saved.financialOffer.digest,r.offer.digest);
});
test('selectors reject caller identity, route, rule, position or financial injection before reads',async()=>{
 const f=setup();for(const extra of [{subjectId:'other'},{route:{}},{rules:[]},{lat:31},{offer:{}},{waveNumber:0},{orderId:'../other'}])await rejected(f.service.prepare({...request,...extra}),'INVALID_DRIVER_OFFER_CONTEXT');
 assert.equal(f.calls.length,0);
});
test('foreign, advanced, assigned or expired dispatch jobs cannot issue an offer',async()=>{
 for(const patch of [{restaurantId:'other'},{orderId:'other'},{currentWaveNumber:1},{status:'assigned'},{driverId:'other'},{expiresAt:at},{expiresAt:'bad'},{dispatchJobId:null}]){
  const f=setup();Object.assign(f.rows.WizzDispatchJobs_staging,patch);await rejected(f.prepare(),'DRIVER_OFFER_ASSIGNMENT_UNAVAILABLE');assert.equal(f.routeCalls,0);
 }
});
test('driver approval and live Cognito identity fail closed',async()=>{
 for(const patch of [{status:'ACTIVE'},{status:'SUSPENDED'},{registrationStatus:'REJECTED'},{isBanned:true},{isDeleted:true},{deletionRequestId:'delete'},{vehicleType:null}]){
  const f=setup();Object.assign(f.rows.WhizzDrivers_staging,patch);await rejected(f.prepare(),'DRIVER_OFFER_DRIVER_UNAVAILABLE');
 }
 for(const patch of [{Enabled:false},{UserStatus:'UNCONFIRMED'},{Username:'other'},{UserAttributes:[{Name:'sub',Value:'other'}]}]){
  const f=setup();Object.assign(f.identity,patch);await rejected(f.prepare(),'DRIVER_OFFER_DRIVER_UNAVAILABLE');assert.equal(f.routeCalls,0);
 }
});
test('an explicitly disabled profile cannot issue or accept an offer, and disabling after preparation invalidates its guard',async()=>{
 for(const flag of [false,null,0,'true']){const f=setup();f.rows.WhizzDrivers_staging.isActive=flag;await rejected(f.prepare(),'DRIVER_OFFER_DRIVER_UNAVAILABLE');assert.equal(f.routeCalls,0);}
 const f=setup(),r=await f.prepare();f.rows.WhizzDrivers_staging.isActive=false;await assert.rejects(f.store.save(r));assert.equal(f.saved,undefined);
});
test('busy, stale, future, malformed and out-of-range positions are rejected',async()=>{
 for(const patch of [{status:'busy'},{isSearching:false},{isActive:false},{currentOrderId:'other'},{activeOrdersCount:1},{lat:91},{lng:'44'},
  {locationUpdatedAt:'2026-10-15T11:58:00.000Z'},{locationUpdatedAt:'2026-10-15T12:00:01.000Z'},{locationUpdatedAt:'bad'}]){
  const f=setup();Object.assign(f.rows.WizzDriverLiveState_staging,patch);await rejected(f.prepare(),'DRIVER_OFFER_POSITION_UNAVAILABLE');assert.equal(f.routeCalls,0);
 }
});
test('ownership, deletion and policy source restrictions are checked before provider calls',async()=>{
 for(const patch of [{ownerId:'other'},{organizationId:'other'},{status:'closed'},{isDeleted:true}]){const f=setup();Object.assign(f.rows.WhizzMerchants_Businesses,patch);await rejected(f.prepare(),'DRIVER_OFFER_BRANCH_UNAVAILABLE');}
 for(const key of ['ACCOUNT_LIFECYCLE#DRIVER#driver1','ACCOUNT_LIFECYCLE#DRIVER#driver-sub','ACCOUNT_LIFECYCLE#MERCHANT#owner1','BUSINESS_LIFECYCLE#MERCHANT#branch1']){
  const f=setup();f.locks.set(key,{pk:key,sk:'META'});await rejected(f.prepare(),'DRIVER_OFFER_REFERENCE_UNAVAILABLE');assert.equal(f.routeCalls,0);
 }
 for(const mutate of [p=>p.version=0,p=>p.values.driverRules=[],p=>p.values.driverRules[0].status='DRAFT',p=>p.pk='other']){
  const f=setup();mutate(f.rows['staging-PlatformStaff']);await rejected(f.prepare(),'DRIVER_OFFER_POLICY_UNAVAILABLE');
 }
});
test('every source race is rejected atomically at persistence, including same-timestamp location change',async()=>{
 for(const mutate of [f=>f.rows.WizzDispatchJobs_staging.currentWaveNumber++,f=>f.rows.WhizzDrivers_staging.status='SUSPENDED',
  f=>f.rows.WizzDriverLiveState_staging.lat=32,f=>f.rows['staging-PlatformStaff'].version++,
  f=>f.rows.WhizzMerchants_Businesses.ownerId='other',f=>f.locks.set('ACCOUNT_LIFECYCLE#DRIVER#driver-sub',{pk:'ACCOUNT_LIFECYCLE#DRIVER#driver-sub',sk:'META'}),
  f=>f.rows.WizzOrders.financialSnapshot.snapshot.revision++]){
  const f=setup(),r=await f.prepare();mutate(f);await assert.rejects(f.store.save(r));assert.equal(f.saved,undefined);
 }
});
test('provider delay cannot outlive position and identity is rechecked after routing',async()=>{
 const f=setup();f.afterRoute=()=>{f.time=Date.parse(at)+120000;};await rejected(f.prepare(),'DRIVER_OFFER_EXPIRED');
 const g=setup();g.afterRoute=()=>{g.identity.Enabled=false;};await rejected(g.prepare(),'DRIVER_OFFER_DRIVER_UNAVAILABLE');
});
test('a temporary stop of NEW orders does not cancel dispatch of an existing prepared order',async()=>{
 const f=setup();Object.assign(f.rows.WhizzMerchants_Businesses,{acceptingOrders:false,ordersBlocked:true,isActive:false});
 const r=await f.prepare();assert.equal(r.offer.orderId,'order1');
});
test('reference failures never use delivery-fee fallback or partial source results',async()=>{
 const f=setup();f.failTable='staging-PlatformStaff';await rejected(f.prepare(),'DRIVER_OFFER_REFERENCE_UNAVAILABLE');assert.equal(f.routeCalls,0);
});
function reviewedVehicle(f){
 const m=require('../../shared/driver-vehicles-308'),p=f.rows.WhizzDrivers_staging;
 Object.assign(p,{vehicleType:'car',vehiclePlate:'308',work_region_id:'zone1',registrationPaperUrl:'s3://bucket/drivers/driver1/registration',drivingLicenseUrl:'s3://bucket/drivers/driver1/license',nationalIdUrl:'s3://bucket/drivers/driver1/id'});
 const review=url=>({status:'APPROVED',documentUrl:url,reviewedBy:'admin',reviewedAt:at,expiresAt:'2027-01-01T21:00:00.000Z',reason:'verified'});
 const v={id:'vehicle',type:'car',plateNumber:'308',make:'',model:'',color:'',registrationUrl:p.registrationPaperUrl};v.review={...review(v.registrationUrl),fingerprint:m.fingerprint(v)};
 p.vehicleRegistry={schemaVersion:1,version:1,activeId:v.id,items:{vehicle:v},events:[]};p.vehicleOperational=p.vehicleRegistry;p.personalDocumentReview={drivingLicense:review(p.drivingLicenseUrl),nationalId:review(p.nationalIdUrl)};
 return p;
}
test('reviewed vehicle identity is pinned into the issued offer and profile guard',async()=>{
 const f=setup();reviewedVehicle(f);const r=await f.prepare();await f.store.save(r);
 assert.equal(f.saved.driverVehicleSnapshot.id,'vehicle');assert.equal(f.saved.driverVehicleSnapshot.plateNumber,'308');
 assert.ok(Object.values(r.guards.driver.ConditionCheck.ExpressionAttributeNames).includes('vehicleOperational'));
});
test('unapproved vehicle, replaced document or expired evidence cannot prepare an offer',async()=>{
 for(const change of [p=>p.vehicleRegistry.items.vehicle.review.status='REJECTED',p=>p.drivingLicenseUrl='replaced',p=>p.personalDocumentReview.drivingLicense.expiresAt=at]){
  const f=setup(),p=reviewedVehicle(f);change(p);await rejected(f.prepare(),'DRIVER_OFFER_DRIVER_UNAVAILABLE');assert.equal(f.routeCalls,0);
 }
});
test('offer cannot survive a vehicle switch after preparation even with unchanged location',async()=>{
 const f=setup(),p=reviewedVehicle(f),r=await f.prepare();p.vehicleRegistry.activeId='another';await assert.rejects(f.store.save(r));assert.equal(f.saved,undefined);
});
test('offer deadline is bounded by reviewed document expiry',async()=>{
 const f=setup(),p=reviewedVehicle(f);p.personalDocumentReview.drivingLicense.expiresAt='2026-10-15T12:00:30.000Z';
 const r=await f.prepare();assert.ok(Date.parse(r.offer.expiresAt)<=Date.parse(p.personalDocumentReview.drivingLicense.expiresAt));
});
test('strict cutover cannot accept an old account approval as vehicle review',async()=>{
 const old=process.env.DRIVER_VEHICLE_REGISTRY_ENFORCE;process.env.DRIVER_VEHICLE_REGISTRY_ENFORCE='true';
 try{const f=setup();await rejected(f.prepare(),'DRIVER_OFFER_DRIVER_UNAVAILABLE');assert.equal(f.routeCalls,0);}finally{if(old===undefined)delete process.env.DRIVER_VEHICLE_REGISTRY_ENFORCE;else process.env.DRIVER_VEHICLE_REGISTRY_ENFORCE=old;}
});
