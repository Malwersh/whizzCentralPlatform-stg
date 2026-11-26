'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createProductionDriverSearch}=require('../dist/productionDriverSearch');
const stateTime=Date.parse('2026-11-23T16:25:01.000Z');
const start='/driver/start-searching', stop='/driver/stop-searching', update='/driver/update-location';
const map='/driver/map-data', demand='/driver/demand-forecast', trips='/driver/trips';
const area={id:'zone',name:'المنطقة',districtId:'district',districtName:'القضاء',governorateId:'gov',governorateName:'المحافظة'};

function fixture({profile={},live={},closing=false,outside=false,conflict=false,disallowed=false,forecastReady=false,mapUnavailable=false,orders=[],timestamp=stateTime,forecastTime=timestamp,mapPolicy}={}) {
  const calls=[], writes=[];
  const db={send:async c=>{
    const input=c.input; calls.push(input);
    if(input.TransactItems) {
      writes.push(input.TransactItems);
      if(conflict) throw Object.assign(Error('race'),{name:'TransactionCanceledException'});
      return {};
    }
    if(input.TableName==='wizz-production-Drivers') return {Item:{driverId:'driver-one',status:'APPROVED',
      isActive:true,isVerified:true,home_region_id:'zone',work_region_id:'zone',...profile}};
    if(input.TableName==='wizz-production-AccountDeletion') return {Item:closing?input.Key:undefined};
    if(input.TableName==='wizz-production-DriverPerformanceSnapshots') return {};
    if(input.TableName==='wizz-production-PlatformStaff') return {Item:mapPolicy};
    if(input.TableName==='wizz-production-DriverLiveState') return {Item:{driverId:'driver-one',...live}};
    if(input.TableName==='wizz-production-Orders'){
      return input.Key?{Item:orders.find(row=>row.PK===input.Key.PK)}:{Items:orders};
    }
    if(input.TableName==='wizz-production-Merchants') {
      if(mapUnavailable) throw Error('TABLE_UNAVAILABLE');
      return {Items:[]};
    }
    if(input.TableName==='wizz-production-RegionNeighbors') return {Items:[]};
    if(input.TableName==='wizz-production-RegionsDerived' && input.Key.regionId==='zone') {
      return {Item:{regionId:'zone',name_ar:'المنطقة',level:3,effective_is_active:true}};
    }
    if(input.TableName==='wizz-production-DriverDemand') {
      if(!forecastReady) return {};
      const generatedAt=new Date(forecastTime).toISOString();
      if(input.Key.pk==='HEALTH#LIVE') return {Item:{completedAt:generatedAt}};
      return {Item:{dataset:'LIVE',timezone:'Asia/Baghdad',schemaVersion:1,generatedAt,
        days:Array.from({length:7},(_,offset)=>({
          date:new Date(forecastTime+offset*86400000).toISOString().split('T')[0],
          confidence:'INSUFFICIENT',slots:[],
        })),
      }};
    }
    assert.fail('wrong table');
  }};
  const handler=createProductionDriverSearch({db,now:()=>timestamp,locate:async()=>outside?null:area,
    checkRegion:async()=>({allowed:!disallowed,code:'DRIVER_WORK_REGION_NOT_ALLOWED',guards:[{
      ConditionCheck:{TableName:'wizz-production-Regions',Key:{regionId:'zone'},ConditionExpression:'attribute_exists(regionId)'},
    }]}),
    authenticate:async token=>{
      if(token!=='real.test.token')throw Object.assign(Error('denied'),{code:'UNAUTHORIZED'});
      return {subjectId:'driver-one'};
    },
  });
  const request=async(path,body={},headers={Authorization:'Bearer real.test.token'},stage='production')=>{
    const result=await handler({resource:path,httpMethod:['/driver/search-eligibility','/driver/performance',map,demand,trips,trips+'/{orderId}'].includes(path)?'GET':'POST',
      pathParameters:path===trips+'/{orderId}'?{orderId:body.orderId}:undefined,
      queryStringParameters:{rules:'4',...(path===map?{lat:String(body.lat),lng:String(body.lng)}:{})},
      requestContext:{stage},headers,body:JSON.stringify(body)});
    return {code:result.statusCode,...JSON.parse(result.body)};
  };
  return {request,calls,writes};
}
const point={lat:32.01,lng:44.33};
const stateChange=tx=> {
  const op=tx.find(item=>item.Update).Update, changes={};
  for(const pair of op.UpdateExpression.slice(4).split(', ')){
    const [name,value]=pair.split('=');
    changes[op.ExpressionAttributeNames[name]]=op.ExpressionAttributeValues[value];
  }
  return {op,changes};
};

test('verified driver starts in the permitted geometry and cannot impersonate another driver',async()=>{
  const f=fixture({live:{connectionId:'socket-1'}});
  const r=await f.request(start,{...point,driverId:'other'});
  assert.equal(r.code,200);
  assert.equal(r.data.current_work_region.id,'zone');
  const {op,changes}=stateChange(f.writes[0]);
  assert.deepEqual(op.Key,{driverId:'driver-one'});
  assert.equal(changes.status,'available');
  assert.equal(changes.isSearching,true);
  assert.equal(changes.connectionId,undefined);
  assert.equal(f.writes[0].some(i=>i.ConditionCheck?.TableName==='wizz-production-Regions'),true);
});

test('refresh outside the permitted area stops search atomically and tells the app',async()=>{
  const f=fixture({live:{status:'available',isActive:true,isSearching:true},disallowed:true});
  const r=await f.request(update,point);
  assert.equal(r.code,'DRIVER_WORK_REGION_NOT_ALLOWED');
  assert.equal(r.searching_stopped,true);
  const {changes}=stateChange(f.writes[0]);
  assert.equal(changes.status,'offline');
  assert.equal(changes.isSearching,false);
  assert.equal(changes.isActive,false);
});

test('stop preserves a delivery in progress and repeats safely for offline drivers',async()=>{
  const active=fixture({live:{status:'busy',currentOrderId:'order-1',activeOrdersCount:1}});
  assert.equal((await active.request(stop)).code,'ACTIVE_ORDER');
  assert.equal(active.writes.length,0);
  const f=fixture({live:{status:'available',isSearching:true,currentWaveOfferId:'offer-1'}});
  const r=await f.request(stop);
  assert.equal(r.success,true);
  assert.equal(r.data.hadPendingOffer,true);
  assert.deepEqual(stateChange(f.writes[0]).changes,
    {lastUpdated:new Date(stateTime).toISOString(),status:'offline',isSearching:false,isActive:false,
      searchStoppedAt:new Date(stateTime).toISOString(),currentWaveOfferId:null,stopReason:'manual_stop'});
  const stopped=fixture({live:{status:'offline',isSearching:false}});
  assert.equal((await stopped.request(stop)).success,true);
  assert.equal(stopped.writes.length,0);
});

test('location for an assigned order is scoped and stale positions cannot overwrite newer ones',async()=>{
  const observation={...point,accuracy:2,heading:0,observedAt:new Date(stateTime-1000).toISOString()};
  const live={status:'busy',currentOrderId:'order-1',activeOrdersCount:1};
  const valid=fixture({live});
  assert.equal((await valid.request(update,{...observation,orderId:'order-1'})).success,true);
  assert.equal(stateChange(valid.writes[0]).changes.tripLocation438.orderId,'order-1');
  const other=fixture({live});
  assert.equal((await other.request(update,{...observation,orderId:'order-2'})).success,true);
  assert.equal(stateChange(other.writes[0]).changes.tripLocation438,undefined);
  const stale=fixture({live:{...live,locationUpdatedAt:new Date(stateTime+500).toISOString()}});
  assert.equal((await stale.request(update,point)).code,'STATE_CHANGED');
  assert.equal(stale.writes.length,0);
});

test('unapproved, closing, out of coverage, invalid and staging requests fail without writes',async()=>{
  for(const [options,path,body,headers,stage,code] of [
    [{profile:{isVerified:false}},start,point,undefined,undefined,'DRIVER_NOT_VERIFIED'],
    [{closing:true},start,point,undefined,undefined,'ACCOUNT_CLOSING'],
    [{outside:true},start,point,undefined,undefined,'OUTSIDE_SERVICE_AREA'],
    [{},start,{lat:101,lng:44},undefined,undefined,'INVALID_REQUEST'],
    [{},start,point,{},undefined,'AUTH_REQUIRED'],
    [{},start,point,undefined,'staging','NOT_FOUND'],
    [{},start,point,{Authorization:'Bearer real.test.token',authorization:'Bearer another.test.token'},undefined,'AUTH_REQUIRED'],
  ]) {
    const f=fixture(options);
    assert.equal((await f.request(path,body,headers,stage)).code,code);
    assert.equal(f.writes.length,0);
  }
  const eligibility=fixture({profile:{isVerified:false}});
  assert.deepEqual((await eligibility.request('/driver/search-eligibility')).data,{isVerified:false});
});

test('a changed assignment or permission yields a retryable conflict',async()=>{
  const f=fixture({conflict:true});
  assert.equal((await f.request(start,point)).code,'STATE_CHANGED');
});


test('performance reads the signed-in driver snapshot in production and preserves unknown rates',async()=>{
  const f=fixture();
  const result=await f.request('/driver/performance');
  assert.equal(result.code,200);
  assert.equal(result.rulesVersion,'OBSERVED_DRIVER_PERFORMANCE_V4');
  assert.equal(result.acceptanceRate,null);
  assert.deepEqual(f.calls.filter(x=>x.TableName==='wizz-production-DriverPerformanceSnapshots').map(x=>x.Key),[
    {pk:'DRIVER#driver-one',sk:'STATE'},{pk:'CONTROL',sk:'HEALTH'},
  ]);
  assert.equal(f.writes.length,0);
});


test('a covered point with no approved stores returns a successful empty map',async()=>{
  const f=fixture();
  const result=await f.request(map,point);
  assert.equal(result.code,200);
  assert.equal(result.current_work_region.id,'zone');
  assert.deepEqual(result.nearby_stores,[]);
  assert.equal(result.summary.total_stores,0);
  assert.ok(f.calls.some(call=>call.TableName==='wizz-production-Merchants'));
  assert.equal(f.writes.length,0);
});

test('map exposes the approved production map configuration',async()=>{
 const values={...require('../../shared/driver-map-settings-329').DEFAULTS,heatEnabled:false,refreshSeconds:60};
 const f=fixture({mapPolicy:{version:4,values}});
 const mapData=await f.request(map,point);
 assert.deepEqual(mapData.map_tools,{...values,version:4});
 assert.ok(f.calls.some(call=>call.TableName==='wizz-production-PlatformStaff'&&call.Key.pk==='OPERATIONAL_SETTINGS#DRIVER_MAP_TOOLS'));
});

test('map coverage, authentication and service errors remain distinct from empty stores',async()=>{
  const outside=fixture({outside:true});
  assert.equal((await outside.request(map,point)).code,'OUTSIDE_SERVICE_AREA');
  assert.ok(!outside.calls.some(call=>call.TableName==='wizz-production-Merchants'));
  const anonymous=fixture();
  assert.equal((await anonymous.request(map,point,{})).code,'AUTH_REQUIRED');
  assert.equal(anonymous.calls.length,0);
  const result=await fixture({mapUnavailable:true}).request(map,point);
  assert.equal(result.success,false);
  assert.equal(result.nearby_stores,undefined);
});

test('the approved driver gets the reason for unavailable demand without invented forecasts',async()=>{
  const fresh=await fixture({forecastReady:true}).request(demand);
  assert.equal(fresh.code,200);
  assert.equal(fresh.state,'INSUFFICIENT');
  assert.equal(fresh.isTestData,false);
  assert.ok(fresh.days.every(day=>day.slots.length===0));
  assert.equal((await fixture().request(demand)).state,'UPDATING');
  assert.equal((await fixture({profile:{work_region_id:null,home_region_id:null}}).request(demand)).state,'NO_REGION');
});


test('a verified driver sees only their own completed history and precise empty state',async()=>{
  const empty=fixture();
  assert.deepEqual(await empty.request(trips),{
    code:200,success:true,trips:[],count:0,hasMore:false,nextToken:null,
  });
  const makeOrder=(id,driverId,status)=>({PK:'ORDER#'+id,SK:'META',orderId:id,driverId,status,driverEarnings:1200});
  const f=fixture({orders:[makeOrder('mine','driver-one','delivered'),
    makeOrder('other','driver-two','delivered'),makeOrder('active','driver-one','assigned')]});
  const result=await f.request(trips);
  assert.deepEqual(result.trips.map(trip=>[trip.orderId,trip.driverEarnings]),[['mine',1200]]);
  assert.equal((await f.request(trips+'/{orderId}',{orderId:'other'})).code,'TRIP_UNAVAILABLE');
  assert.equal((await f.request(trips+'/{orderId}',{orderId:'active'})).code,'TRIP_UNAVAILABLE');
  assert.equal((await f.request(trips+'/{orderId}',{orderId:'mine'})).trip.orderId,'mine');
  assert.equal((await f.request(trips,{},{})).code,'AUTH_REQUIRED');
});

test('verified insufficient demand survives the daily rollover without inventing a seventh day',async()=>{
  const f=fixture({forecastReady:true,timestamp:Date.parse('2026-11-25T21:10:00Z'),
    forecastTime:Date.parse('2026-11-25T20:45:00Z')});
  const result=await f.request(demand);
  assert.equal(result.state,'INSUFFICIENT');
  assert.equal(result.days.length,6);
  assert.equal(result.days[0].date,'2026-11-26');
  assert.ok(result.days.every(day=>day.slots.length===0));
});
