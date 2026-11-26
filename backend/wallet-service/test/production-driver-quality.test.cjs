'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const ready=require('./helpers/full-cash-lifecycle-matrix-fixture.cjs');
const {createProductionDriverQuality}=require('../dist/productionDriverQuality');
const {buildTimingPlan}=require('../../shared/driver-performance-timing-273');
const uuid=n=>String(n).padStart(8,'0')+'-1234-4123-8123-123456789abc';
const names={
  WALLETS_TABLE:['Wallets','staging-Wallets'],LEDGER_TABLE:['LedgerEntries','staging-LedgerEntries'],
  HOLDS_TABLE:['Holds','staging-Holds'],TOPUP_REQUESTS_TABLE:['TopupRequests','staging-TopupRequests'],
  AUDIT_LOG_TABLE:['AuditLog','staging-AuditLog'],IDEMPOTENCY_KEYS_TABLE:['IdempotencyKeys','staging-IdempotencyKeys'],
  ORDERS_TABLE:['Orders','WizzOrders'],WALLET_LIFECYCLE_TABLE:['WalletLifecycle','staging-WalletLifecycle'],
  STAFF_TABLE:['PlatformStaff','staging-PlatformStaff'],OFFER_JOURNEY_TABLE:['OfferJourney','staging-WizzOfferJourney'],
  DISPATCH_JOBS_TABLE:['DispatchJobs','WizzDispatchJobs_staging'],DRIVER_LIVE_STATE_TABLE:['DriverLiveState','WizzDriverLiveState_staging'],
  WAVE_OFFERS_TABLE:['WaveOffers','WaveOffers_staging'],DELIVERY_QUOTES_TABLE:['DeliveryQuotes','staging-DeliveryQuotes'],
  DRIVERS_TABLE:['Drivers','WhizzDrivers_staging'],MERCHANTS_TABLE:['Merchants','WhizzMerchants_Businesses'],
  ACCOUNT_DELETION_TABLE:['AccountDeletion','staging-AccountDeletion'],
  RATINGS_TABLE:['OrderRatings','whizz-order-ratings-staging'],
};
const staffRoute='/staff/drivers/{driverId}/quality', readRoute='/driver/quality-incidents', appealRoute=readRoute+'/appeal';
const signedFixture='test.'+Buffer.from(JSON.stringify({auth_time:1796000000})).toString('base64url')+'.signature';
const fixedTime=1796000020000;
const incidentId=uuid(800);

test('production route bindings carry a case through staff review, driver appeal and staff resolution',async () => {
  const f=await ready();
  f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).orderNumber='ORD1792497600000';
  f.get('WhizzDrivers_staging',{driverId:'driver1'}).work_region_id='region1';
  f.put('staging-PlatformStaff',{pk:'EMPLOYEE#staff1',sk:'PROFILE',employeeId:'staff1',status:'ACTIVE',version:1,
    name:'مراجع الاختبار',roles:['driver_reviewer'],scope:{allRegions:false,regionIds:['region1']}});
  const env={ENVIRONMENT:'production',AWS_REGION:'us-east-1', ...Object.fromEntries(
    Object.entries(names).map(([key,[name]])=>[key,'wizz-production-'+name]))};
  const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
  const allowedPuts=new Set(['wizz-production-Holds','wizz-production-WalletLifecycle','wizz-production-AuditLog']);
  const stagingName=Object.fromEntries(Object.values(names).map(([name,staging])=>['wizz-production-'+name,staging]));
  const routeAuth=[];
  let performanceReview=false;
  const db={async send(command){
    const input=command.input,name=input.TableName;
    if(command.constructor.name==='QueryCommand'){
      const stub=stagingName[name];
      assert.ok(stub,'production table binding');
      const rows=[...f.rows.entries()].filter(([key])=>key.startsWith(stub+'|')).map(([,row])=>row);
      if (name==='wizz-production-Orders') return {Items:rows.filter(r=>r.orderNumber===input.ExpressionAttributeValues[':number'])};
      if (name==='wizz-production-WaveOffers') return {Items:rows.filter(r=>r.driverId===input.ExpressionAttributeValues[':driver'])};
      if (name==='wizz-production-Holds') return {Items:rows.filter(r=>r.orderId===input.ExpressionAttributeValues[':order']&&r.sk.startsWith('DRIVER_QUALITY#'))};
      assert.fail('Unexpected quality query: '+name);
    }
    if (input.TransactItems){
      for(const op of input.TransactItems){
        const part=op.Put||op.ConditionCheck||op.Update;
        assert.ok(part&&stagingName[part.TableName],'only environment-bound quality transaction operations');
        if(op.Put) assert.ok(allowedPuts.has(part.TableName),'quality must not modify money, driver profiles or orders');
        if(op.Update){
          assert.equal(performanceReview,true);
          assert.ok(['wizz-production-OrderRatings','wizz-production-Drivers'].includes(part.TableName));
        }
        part.TableName=stagingName[part.TableName];
      }
    }else{
      assert.ok(stagingName[name]);
      input.TableName=stagingName[name];
    }
    return f.db.send(command);
  }};
  let selectedDriver='driver1';
  Object.assign(process.env,env);
  try{
    const handler=createProductionDriverQuality(db,async(token,kind)=>{
      assert.equal(token,signedFixture);
      routeAuth.push(kind);
      return {kind,subjectId:kind==='STAFF'?'staff1':selectedDriver};
    },()=>fixedTime);
    const request=async(resource,body,driverId='driver1',authorization=true)=>{
      const result=await handler({resource,requestContext:{stage:'production'},pathParameters:{driverId},
        httpMethod:body?'POST':'GET',headers:authorization?{Authorization:'Bearer '+signedFixture}:{},body:JSON.stringify(body)});
      return {http:result.statusCode,...JSON.parse(result.body)};
    };
    assert.equal((await request(readRoute,undefined,'driver1',false)).http,401);
    assert.equal((await request(staffRoute,undefined,'driver2')).http,403);
    assert.deepEqual((await request(readRoute)).items,[]);
    const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
    let n=1;
    const row=()=>f.get('staging-Holds',{orderId:'order1',sk:'DRIVER_QUALITY#'+incidentId});
    const staffAction=(action,extras={},driverId='driver1')=>request(staffRoute,{
      action,orderId:'ORD1792497600000',attempt:order.assignmentAttemptCounter,incidentId,
      ...(action.startsWith('READ')?{}:{reason:'سبب الإجراء الموثق',idempotencyKey:uuid(n++),
        expectedVersion:row()?.version??0,...(row()?{caseId:incidentId}:{})}),...extras,
    },driverId);
    assert.equal((await staffAction('READ_DRIVER_QUALITY_REVIEW')).item.review,null);
    assert.equal((await staffAction('OPEN_DRIVER_QUALITY_REVIEW',{severity:'HIGH',category:'ROAD_SAFETY'})).http,200);
    const first=await staffAction('ADD_DRIVER_QUALITY_EVIDENCE',{reportedByParty:'CUSTOMER',reference:'إفادة العميل'});
    const second=await staffAction('ADD_DRIVER_QUALITY_EVIDENCE',{reportedByParty:'EXTERNAL',reference:'شاهد مستقل'});
    assert.equal(first.http,200);assert.equal(second.http,200);
    const evidenceIds=row().evidence.map(x=>x.id);
    assert.equal((await staffAction('DECIDE_DRIVER_QUALITY_REVIEW',{
      decision:'SUBSTANTIATED',evidenceIds,supersedesDecisionId:null,
    })).http,200);
    const own=await request(readRoute);
    assert.equal(own.items[0].canAppeal,true);
    assert.equal(JSON.stringify(own).includes('شاهد مستقل'),false);
    const appeal={action:'APPEAL',orderId:'order1',incidentId,expectedVersion:row().version,
      idempotencyKey:uuid(990),reason:'أطلب إعادة النظر في القرار'};
    selectedDriver='driver2';
    assert.equal((await request(appealRoute,appeal)).http,404);
    assert.deepEqual((await request(readRoute)).items,[]);
    selectedDriver='driver1';
    assert.equal((await request(appealRoute,appeal)).http,200);
    assert.equal((await request(appealRoute,appeal)).replayed,true);
    const staff=await request(staffRoute);
    assert.equal(staff.items[0].appealOpen,true);
    assert.equal(staff.capabilities.review,true);
    assert.equal((await staffAction('CLOSE_DRIVER_QUALITY_APPEAL',{resolution:'UPHELD',evidenceIds,appealId:appeal.idempotencyKey})).http,200);
    assert.equal((await request(readRoute)).items[0].appealOpen,false);
    assert.equal(row().appeals[0].status,'CLOSED');
    assert.ok(routeAuth.includes('STAFF'));assert.ok(routeAuth.includes('DRIVER'));

    performanceReview=true;
    const offer=[...f.rows.values()].find(entry=>entry.kind==='FINANCIAL_DRIVER_OFFER'&&entry.isWinner);
    const acceptedAt=offer.financialReceipt.acceptedAt;
    const at=seconds=>new Date(Date.parse(acceptedAt)+seconds*1000).toISOString();
    offer.performanceTiming=buildTimingPlan({orderId:order.orderId,driverId:order.driverId,offerId:offer.offerId,
      attempt:order.assignmentAttemptCounter,acceptedAt,pickupSeconds:60,deliverySeconds:60});
    Object.assign(order,{status:'delivered',walletFinancialStatus:'SETTLED',financialOutcome:'SETTLED',
      arrivedAtStoreAt:at(10),pickedUpAt:at(30),arrivedAtCustomerAt:at(600),deliveredAt:at(610),userSub:'customer1'});
    const timing={orderId:order.orderNumber,attempt:order.assignmentAttemptCounter};
    const timingRead={...timing,action:'READ_DRIVER_TIMING_REVIEW'};
    assert.equal((await request(staffRoute,timingRead)).item.reviewable,true);
    const write={expectedVersion:0,reason:'سبب الإجراء الموثق'};
    assert.equal((await request(staffRoute,{...timing,...write,action:'OPEN_DRIVER_TIMING_REVIEW',idempotencyKey:uuid(n++)})).http,200);
    assert.equal((await request(staffRoute,timingRead)).item.review.state,'OPEN');

    const ratingTable='whizz-order-ratings-staging',ratingKey={pk:'ORDER#order1'};
    const original={...ratingKey,orderId:'order1',subjectId:'customer1',driverId:'driver1',merchantId:order.storeId,
      merchantStars:5,driverStars:3,comment:'التقييم الأصلي',createdAt:at(620)};
    f.put(ratingTable,original);
    f.put(ratingTable,{pk:'DRIVER#driver1',count:1,sum:3,average:3,version:1});
    Object.assign(f.get('WhizzDrivers_staging',{driverId:'driver1'}),{customerRatingCount:1,customerRatingSum:3,customerRating:3});
    const ratingRead={orderId:order.orderNumber,action:'READ_DRIVER_RATING_REVIEW'};
    const reviewer=f.get('staging-PlatformStaff',{pk:'EMPLOYEE#staff1',sk:'PROFILE'});
    f.get('WhizzDrivers_staging',{driverId:'driver2'}).work_region_id='region2';
    reviewer.scope.regionIds.push('region2');
    assert.equal((await request(staffRoute,ratingRead,'driver2')).http,404);
    reviewer.roles=['driver_manager'];
    assert.equal((await request(staffRoute,ratingRead)).capabilities.review,false);
    const ratingOpen={...ratingRead,...write,action:'OPEN_DRIVER_RATING_REVIEW',idempotencyKey:uuid(n++)};
    assert.equal((await request(staffRoute,ratingOpen)).http,403);
    reviewer.roles=['driver_reviewer'];
    assert.equal((await request(staffRoute,ratingOpen)).http,200);
    assert.equal((await request(staffRoute,ratingOpen)).replayed,true);
    assert.equal((await request(staffRoute,ratingRead)).item.rating.included,false);
    assert.equal(f.get(ratingTable,{pk:'DRIVER#driver1'}).average,null);
    const {driverModeration,...unchanged}=f.get(ratingTable,ratingKey);
    assert.equal(driverModeration.state,'OPEN');
    assert.deepEqual(unchanged,original);
  }finally{
    for(const [key,value] of Object.entries(saved))value===undefined?delete process.env[key]:process.env[key]=value;
  }
});
