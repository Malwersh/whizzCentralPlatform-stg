const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createStagingDeliveryPricingContext}=require('../dist/deliveryPricingContext');
const {createStagingDeliveryRouting}=require('../dist/regionCoverage');
const {parseIqd:m}=require('../dist/money');
const at=Date.parse('2026-10-15T12:00:00.000Z');
const point={latitude:31.925,longitude:44.457};
const rule=(scope={type:'GLOBAL',id:'GLOBAL'},base='1000')=>({id:'r-'+scope.type,version:1,scope,priority:1,status:'PUBLISHED',
 effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,rounding:'HALF_AWAY_FROM_ZERO',vehicleType:null,
 base:m(base),perKm:m('1000'),tiers:[],longDistance:{afterMeters:5000,flat:m('0'),perKm:m('0')},peaks:[],
 minimum:m('0'),maximum:m('10000'),coverage:{enabled:true,maxRoadMeters:10000,maxDurationSeconds:3600,supportedZoneIds:['zone']},fallbackPolicyId:null});
function fixture(){
 const levels=['country','governorate','district','zone'];
 const regions=new Map(levels.map((regionId,level)=>[regionId,{regionId,level,parent_id:level?levels[level-1]:'ROOT',is_active:1,
  ...(level===3?{geometry:{type:'Polygon',coordinates:[[[44.4,31.9],[44.5,31.9],[44.5,32],[44.4,32],[44.4,31.9]]]}}:{})}]));
 const branch={businessId:'b1',branchId:'b1',ownerId:'owner1',cognitoUserId:'owner1',organizationId:'org1',...point,address:{...point},
  regionId:'zone',regionPath:levels,status:'approved',isActive:true,onboardingSchemaVersion:2,onboardingComplete:true,acceptingOrders:true};
 const address={addressId:'a1',userId:'u1',...point};
 const policy={pk:'OPERATIONAL_SETTINGS#DELIVERY_PRICING',sk:'CURRENT',version:3,values:{deliveryRules:[rule()],driverRules:[]}};
 const organization={organizationId:'org1',subjectId:'owner1',version:1};
 const state={branch,address,policy,organization,regions,calls:[],providerCalls:0,authCalls:0,
  authenticate:async()=>({userId:'u1',subjectId:'sub1'}),afterProvider:()=>{},failTable:null,deleted:false};
 const db={send:async cmd=>{
  const q=cmd.input;state.calls.push(q);
  if(q.TableName===state.failTable)throw Error('sensitive SDK data');
  let item;
  switch(q.TableName){
   case 'WizzCentral_RegionIndex_staging':return {Items:[{h3_cell:q.ExpressionAttributeValues[':cell'],regionId:'zone'}]};
   case 'WizzCentral_Regions':item=regions.get(q.Key.regionId);break;
   case 'WizzCentral_RegionsDerived_staging':item={regionId:q.Key.regionId,effective_is_active:1};break;
   case 'WhizzMerchants_Businesses':item=state.branch;break;
   case 'WizzUser_addresses_staging':item=state.address;break;
   case 'staging-PlatformStaff':item=state.policy;break;
   case 'staging-MerchantPlatform':item=state.organization;break;
   case 'staging-AccountDeletion':item=state.deleted?{pk:q.Key.pk}:undefined;break;
   default:throw Error('unexpected table');
  }
  return {Item:item&&structuredClone(item)};
 }};
 const router=createStagingDeliveryRouting({db,getAccessToken:async()=>'test',profile:'driving',ttlSeconds:120,timeoutMs:1000,now:()=>at,
  fetchImpl:async()=>{state.providerCalls++;state.afterProvider();return new Response(JSON.stringify({code:'Ok',routes:[{distance:2100,duration:300}]}));}});
 state.service=createStagingDeliveryPricingContext({db,router,authenticateCustomer:async()=>{state.authCalls++;return state.authenticate();},now:()=>at});
 state.calculate=()=>state.service.calculate({branchId:'b1',addressId:'a1'});
 return state;
}
const reject=(p,code)=>assert.rejects(p,e=>e.code===code&&e.message===code);
test('saved address, branch and CURRENT policy compose the real engine with reference evidence',async()=>{
 const f=fixture(),r=await f.calculate();
 assert.equal(r.calculation.customerDeliveryFee.minorAmount,3100000);assert.equal(r.policyVersion,3);
 assert.deepEqual(r.context,{branchId:'b1',merchantId:'org1',zoneId:'zone',cityId:'UNBOUND_CITY',governorateId:'governorate',vehicleType:'UNASSIGNED'});
 assert.match(r.referenceVersion,/^[a-f0-9]{64}$/);assert.equal(f.authCalls,2);assert.equal(f.providerCalls,1);
 assert.ok(!JSON.stringify(r).includes('owner1')&&!JSON.stringify(r).includes('sub1'));
 assert.ok(f.calls.filter(c=>c.Key).every(c=>c.ConsistentRead&&c.ProjectionExpression));
 assert.ok(f.calls.every(c=>!c.UpdateExpression&&!c.Item&&!c.TransactItems));
 assert.ok(f.calls.filter(c=>c.TableName==='staging-PlatformStaff').every(c=>c.Key.sk==='CURRENT'));
});
test('input cannot inject identity, coordinates, prices, routes or scope before authentication',async()=>{
 const f=fixture();
 for(const extra of [{userId:'victim'},{latitude:1},{rules:[]},{context:{}},{route:{}},{discount:{}},{vehicleType:'CAR'}])
  await reject(f.service.calculate({branchId:'b1',addressId:'a1',...extra}),'INVALID_PRICING_REQUEST');
 assert.equal(f.authCalls,0);assert.equal(f.calls.length,0);
});
test('missing or foreign saved address is unavailable before provider call',async()=>{
 for(const value of [undefined,{addressId:'a1',userId:'foreign',...point},{addressId:'other',userId:'u1',...point},{addressId:'a1',userId:'u1',...point,deletionRequestId:null}]){
  const f=fixture();f.address=value;await reject(f.calculate(),'ADDRESS_UNAVAILABLE');assert.equal(f.providerCalls,0);
 }
});
test('branch eligibility mirrors conservative create-order guard and checks ownership binding',async()=>{
 for(const patch of [{status:'pending'},{isActive:false},{onboardingComplete:false},{acceptingOrders:false},
  {platformSuspended:true},{ordersBlocked:true},{ordersBlocked:null},{deletionRequestId:null},{cognitoUserId:'other'},{branchId:'other'}]){
  const f=fixture();Object.assign(f.branch,patch);await reject(f.calculate(),'BRANCH_UNAVAILABLE');assert.equal(f.providerCalls,0);
 }
 const f=fixture();f.deleted=true;await reject(f.calculate(),'BRANCH_UNAVAILABLE');assert.equal(f.providerCalls,0);
});
test('conflicting or nonnumeric coordinates never silently choose a different source',async()=>{
 const f=fixture();f.branch.address.longitude=45;await reject(f.calculate(),'BRANCH_UNAVAILABLE');assert.equal(f.providerCalls,0);
 const g=fixture();g.address.latitude='31.925';await reject(g.calculate(),'PRICING_REFERENCE_UNAVAILABLE');assert.equal(g.providerCalls,0);
});
test('CURRENT must exist, have valid published rules and positive version; no draft fallback',async()=>{
 for(const mutate of [f=>{f.policy=undefined;},f=>{f.policy.version=0;},f=>{f.policy.values.deliveryRules[0].status='DRAFT';},
  f=>{f.policy.values.deliveryRules=[];},f=>{f.policy.values.deliveryRules[0].base={};}]){
  const f=fixture();mutate(f);await reject(f.calculate(),'PRICING_UNAVAILABLE');assert.equal(f.providerCalls,0);
 }
});
test('verified organization enables MERCHANT scope; legacy branches never infer it from owner or branch',async()=>{
 const f=fixture();f.policy.values.deliveryRules.push(rule({type:'MERCHANT',id:'org1'},'2000'));
 assert.equal((await f.calculate()).calculation.customerDeliveryFee.minorAmount,4100000);
 delete f.branch.organizationId;f.organization=undefined;
 f.policy.values.deliveryRules.push({...rule({type:'MERCHANT',id:'b1'},'3000'),id:'r-legacy'});
 assert.equal((await f.calculate()).calculation.customerDeliveryFee.minorAmount,3100000);
 const g=fixture();g.organization.subjectId='foreign';await reject(g.calculate(),'BRANCH_UNAVAILABLE');assert.equal(g.providerCalls,0);
});
test('policy, location, owner or address change with unchanged version/updatedAt invalidates result',async()=>{
 for(const change of [f=>{f.policy.values.deliveryRules[0].base=m('1500');},f=>{f.address.longitude=44.458;},
  f=>{f.branch.ownerId='owner2';f.branch.cognitoUserId='owner2';f.branch.organizationId=undefined;},
  f=>{f.branch.latitude=31.926;f.branch.address.latitude=31.926;}]){
  const f=fixture();f.afterProvider=()=>change(f);await reject(f.calculate(),'PRICING_CONTEXT_CHANGED');
 }
});
test('account loss or identity switch after provider prevents a result',async()=>{
 const f=fixture();f.afterProvider=()=>{f.authenticate=async()=>{throw Error('revoked');};};await reject(f.calculate(),'CUSTOMER_UNAVAILABLE');
 const g=fixture();g.afterProvider=()=>{g.authenticate=async()=>({userId:'u1',subjectId:'other'});};await reject(g.calculate(),'PRICING_CONTEXT_CHANGED');
});
test('region reference mismatch and policy read failure fail closed',async()=>{
 const f=fixture();f.branch.regionPath=['country','governorate','district','foreign'];await reject(f.calculate(),'BRANCH_UNAVAILABLE');
 const g=fixture();g.failTable='staging-PlatformStaff';await reject(g.calculate(),'PRICING_REFERENCE_UNAVAILABLE');assert.equal(g.providerCalls,0);
});
test('district reference is never silently treated as CITY pricing scope',async()=>{
 const f=fixture();f.policy.values.deliveryRules.push(rule({type:'CITY',id:'district'},'8000'));
 assert.equal((await f.calculate()).calculation.customerDeliveryFee.minorAmount,3100000);
 f.policy.values.deliveryRules=[rule({type:'CITY',id:'UNBOUND_CITY'},'8000')];
 await reject(f.calculate(),'NO_PRICING_RULE');
});
test('authentication failures and guest identity cannot read a saved address',async()=>{
 for(const authenticate of [async()=>{throw Error('token expired');},async()=>({userId:'guest',subjectId:'s1'}),async()=>null]){
  const f=fixture();f.authenticate=authenticate;await reject(f.calculate(),'CUSTOMER_UNAVAILABLE');assert.equal(f.calls.length,0);
 }
});
