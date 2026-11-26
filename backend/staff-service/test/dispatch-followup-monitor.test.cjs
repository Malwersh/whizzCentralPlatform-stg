'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{isDeepStrictEqual:eq}=require('node:util');
const {createMonitor}=require('../dispatch-followup-monitor'),F=require('../dispatch-followup'),{hash}=require('../dispatch-reviews');
function fixture(){
 const tables=new Map(),writes=[];let beforeCommit;
 const key=(t,k)=>t+'|'+JSON.stringify(k),put=(t,k,v)=>tables.set(key(t,k),structuredClone(v)),get=(t,k)=>tables.get(key(t,k));
 const job={orderId:'o',SK:'METADATA',status:'no_driver_available',restaurantId:'b',dispatchJobId:'j',dispatchCycle:{id:'c'},dispatchReview:{reviewStatus:'REQUIRED',observedAt:'2026-10-28T18:00:00Z'}},order={PK:'ORDER#o',SK:'META',orderId:'o',storeId:'b',status:'ready_for_pickup'},branch={businessId:'b',regionId:'r',ownerId:'owner'};
 put('WizzDispatchJobs_staging',{orderId:'o',SK:'METADATA'},job);put('WizzOrders',{PK:order.PK,SK:order.SK},order);put('WhizzMerchants_Businesses',{businessId:'b'},branch);
 function check(c){if(!c.ConditionExpression)return true;const row=get(c.TableName,c.Key||{pk:c.Item.pk,sk:c.Item.sk});return c.ConditionExpression.split(' AND ').every(t=>{const absent=t.match(/^attribute_not_exists\(([^)]+)\)$/);if(absent)return row?.[c.ExpressionAttributeNames?.[absent[1]]??absent[1]]===undefined;const match=t.match(/^(#[\w]+)\s*=\s*(:[\w]+)$/);assert(match,t);return eq(row?.[c.ExpressionAttributeNames[match[1]]],c.ExpressionAttributeValues[match[2]]);});}
 const db={send:async cmd=>{const i=cmd.input;if(cmd.constructor.name==='GetCommand')return {Item:structuredClone(get(i.TableName,i.Key))};if(cmd.constructor.name==='QueryCommand'){const list=[...tables.entries()].filter(([k])=>k.startsWith(i.TableName+'|')).map(([,v])=>structuredClone(v)).filter(v=>i.TableName==='WizzDispatchJobs_staging'?v.SK==='METADATA'&&v.status==='no_driver_available':v.pk==='DISPATCH_FOLLOWUP_INBOX#OPEN');return {Items:list};}assert.equal(cmd.constructor.name,'TransactWriteCommand');if(beforeCommit){beforeCommit();beforeCommit=null;}if(i.TransactItems.some(x=>!check(x.ConditionCheck||x.Put||x.Delete)))throw Object.assign(Error(),{name:'TransactionCanceledException'});writes.push(i.TransactItems);for(const x of i.TransactItems)if(x.Put)put(x.Put.TableName,{pk:x.Put.Item.pk,sk:x.Put.Item.sk},x.Put.Item);for(const x of i.TransactItems)if(x.Delete)tables.delete(key(x.Delete.TableName,x.Delete.Key));return {};}};
 let time=Date.parse('2026-10-28T18:01:00Z');return {put,get,writes,db,job:()=>get('WizzDispatchJobs_staging',{orderId:'o',SK:'METADATA'}),order:()=>get('WizzOrders',{PK:'ORDER#o',SK:'META'}),monitor:createMonitor({db,now:()=>time}),advance:minutes=>time+=minutes*60000,race:fn=>beforeCommit=fn,caseId:hash({orderId:'o',source:'SEARCH',cycle:'c'})};
}
test('discovery persists one operational notice; replay is quiet and no financial table is written',async()=>{const f=fixture();assert.equal((await f.monitor.observe('o')).saved,true);const row=f.get('staging-PlatformStaff',F.key(f.caseId));assert.equal(row.reviewDueAt,'2026-10-28T18:05:00.000Z');assert.equal(row.ownerId,null);assert.equal((await f.monitor.observe('o')).unchanged,true);assert.equal(f.writes.length,1);assert(f.writes.flat().filter(x=>x.Put).every(x=>x.Put.TableName==='staging-PlatformStaff'));});
test('deadline escalates once; claim and changed settings cannot extend a saved deadline',async()=>{const f=fixture();await f.monitor.observe('o');const key=F.key(f.caseId),row=f.get('staging-PlatformStaff',key);f.put('staging-PlatformStaff',key,{...row,ownerId:'e',ownerName:'موظف',version:2});f.put('staging-PlatformStaff',{pk:F.PK,sk:'CURRENT'},{pk:F.PK,sk:'CURRENT',version:2,values:{reviewMinutes:20,escalationMinutes:30}});f.advance(15);await f.monitor.observe('o');const after=f.get('staging-PlatformStaff',key);assert(after.escalatedAt);assert.equal(after.reviewDueAt,row.reviewDueAt);assert.equal(after.ownerId,'e');assert.equal((await f.monitor.observe('o')).unchanged,true);});
test('cancelled assigned and restarted orders resolve notices only after source proof',async()=>{for(const state of ['cancelled','assigned','restarted','completed']){const f=fixture();await f.monitor.observe('o');if(state==='cancelled')f.order().status='cancelled';if(state==='assigned')f.order().driverId='d';if(state==='restarted'){f.job().status='searching';f.job().dispatchCycle={id:'new'};}if(state==='completed')f.order().status='delivered';await f.monitor.observe('o',f.caseId);const row=f.get('staging-PlatformStaff',F.key(f.caseId));assert.equal(row.status,'RESOLVED');assert(row.resolvedAt);assert(f.writes.flat().filter(x=>x.Put).every(x=>x.Put.TableName==='staging-PlatformStaff'));}});
test('a cancellation race prevents a new open notice; delete fences suppress exposure',async()=>{const f=fixture();f.race(()=>{f.order().status='cancelled';});assert.equal((await f.monitor.observe('o')).conflict,true);assert.equal(f.get('staging-PlatformStaff',F.key(f.caseId)),undefined);const g=fixture();g.put('staging-AccountDeletion',{pk:'BUSINESS_LIFECYCLE#MERCHANT#b',sk:'META'},{pk:'BUSINESS_LIFECYCLE#MERCHANT#b',sk:'META'});assert.equal((await g.monitor.observe('o')).skipped,true);});
test('a later cycle cannot reuse the earlier owner; review settings validate bounded timings',async()=>{const f=fixture();await f.monitor.observe('o');const row=f.get('staging-PlatformStaff',F.key(f.caseId));row.ownerId='e';f.job().dispatchCycle={id:'new'};await f.monitor.observe('o');const next=f.get('staging-PlatformStaff',F.key(hash({orderId:'o',source:'SEARCH',cycle:'new'})));assert.equal(next.ownerId,null);await f.monitor.observe('o',f.caseId);assert.equal(f.get('staging-PlatformStaff',F.key(f.caseId)).status,'RESOLVED');for(const bad of [{reviewMinutes:0,escalationMinutes:15},{reviewMinutes:15,escalationMinutes:5},{reviewMinutes:5,escalationMinutes:500}])assert.throws(()=>F.validate(bad));});
test('scheduled discovery checkpoint finishes without changing orders or dispatch jobs',async()=>{const f=fixture();const old=structuredClone(f.order()),job=structuredClone(f.job());const result=await f.monitor.tick('timer-1');assert(result.saved>=1);assert.deepEqual(f.order(),old);assert.deepEqual(f.job(),job);assert.equal(f.get('staging-PlatformStaff',{pk:'CONTROL#DISPATCH_FOLLOWUP_HOST',sk:'CURSOR'}).leaseUntil,0);});
test('monitor escalation cannot overwrite a concurrently claimed owner',async()=>{const f=fixture();await f.monitor.observe('o');f.advance(16);f.race(()=>{const row=f.get('staging-PlatformStaff',F.key(f.caseId));row.ownerId='operator';row.ownerName='موظف التشغيل';row.version++;});assert.equal((await f.monitor.observe('o')).conflict,true);assert.equal(f.get('staging-PlatformStaff',F.key(f.caseId)).ownerId,'operator');await f.monitor.observe('o');assert.equal(f.get('staging-PlatformStaff',F.key(f.caseId)).ownerId,'operator');});
test('a queued or failed restart keeps its original owner/deadline until a durable STARTED acknowledgement',async()=>{
 const f=fixture();await f.monitor.observe('o');const key=F.key(f.caseId),original=f.get('staging-PlatformStaff',key);original.ownerId='e';const deadline=original.reviewDueAt,id='DRS:'+'a'.repeat(48),job=f.job();job.status='searching';job.dispatchCycle={id:'new'};job.dispatchJobId='new-assignment';job.dispatchRestart={restartId:id};const restartKey={orderId:'o',SK:'DISPATCH_RESTART#'+id};f.put('WizzDispatchJobs_staging',restartKey,{...restartKey,kind:'DISPATCH_RESTART_START',restartId:id,caseId:f.caseId,branchId:'b',previousCycleId:'c',cycleId:'new',assignmentId:'new-assignment',state:'PENDING'});
 await f.monitor.observe('o',f.caseId);assert.equal(f.get('staging-PlatformStaff',key).status,'OPEN');assert.equal(f.get('staging-PlatformStaff',key).ownerId,'e');assert.equal(f.get('staging-PlatformStaff',key).reviewDueAt,deadline);
 f.get('WizzDispatchJobs_staging',restartKey).state='NEEDS_REVIEW';await f.monitor.observe('o',f.caseId);assert.equal(f.get('staging-PlatformStaff',key).status,'OPEN');assert.equal(f.get('staging-PlatformStaff',key).restartState,'NEEDS_REVIEW');
 f.get('WizzDispatchJobs_staging',restartKey).state='STARTED';await f.monitor.observe('o',f.caseId);assert.equal(f.get('staging-PlatformStaff',key).status,'RESOLVED');assert.equal(f.get('staging-PlatformStaff',require('../dispatch-followup-core').inboxKey(f.caseId)),undefined);
});

test('production discovery, scoped inbox, handling and policy use only operational records',async()=>{
 const {createStaffFollowup,productionOrder}=require('../../wallet-service/dist/productionDispatchFollowup');
 const rowTables=Object.fromEntries(['staff','jobs','orders','branch','deletion','holds']
   .map(name=>[name,'wizz-production-'+name]));
 const memory=new Map(), writes=[];
 const state={time:Date.parse('2026-11-26T12:00:00Z')};
 const ids={orders:['PK','SK'],branch:['businessId'],jobs:['orderId','SK'],staff:['pk','sk'],deletion:['pk','sk'],holds:['orderId','sk']};
 const storageKey=(table,row)=>table+'|'+JSON.stringify(ids[table.slice('wizz-production-'.length)].map(key=>row[key]));
 const save=(table,row)=>memory.set(storageKey(table,row),structuredClone(row));
 const read=(table,key)=>memory.get(storageKey(table,key));
 const matches=(op)=>{
   if(!op.ConditionExpression)return true;
   const row=read(op.TableName,op.Key??op.Item);
   return op.ConditionExpression.split(' AND ').every(clause=>{
    const [,key]=clause.match(/^attribute_not_exists\(([^)]+)\)$/)||[];
    if(key)return row?.[op.ExpressionAttributeNames?.[key]??key]===undefined;
    const [,name,value]=clause.match(/^(#[\w]+)\s*=\s*(:[\w]+)$/)||[];
    assert(name,clause);
    return eq(row?.[op.ExpressionAttributeNames[name]],op.ExpressionAttributeValues[value]);
   });
 };
 const db={async send(command){
   const q=command.input;
   if(command.constructor.name==='GetCommand'){
    const item=structuredClone(read(q.TableName,q.Key));
    if(!item||!q.ProjectionExpression)return {Item:item};
    const keys=q.ProjectionExpression.split(',').map(key=>q.ExpressionAttributeNames[key.trim()]??key.trim());
    return {Item:Object.fromEntries(keys.filter(key=>key in item).map(key=>[key,item[key]]))};
   }
   if(command.constructor.name==='QueryCommand'){
    const rows=[...memory].filter(([key])=>key.startsWith(q.TableName+'|')).map(([,value])=>structuredClone(value));
    if(q.IndexName){
     assert.equal(q.IndexName,'DispatchReviewStatus340');
     return {Items:rows.filter(row=>row.status==='no_driver_available'&&row.SK==='METADATA')};
    }
    return {Items:rows.filter(row=>q.TableName===rowTables.staff?row.pk===q.ExpressionAttributeValues[':inbox']:
      row.orderId===q.ExpressionAttributeValues[':id']&&row.SK.startsWith(q.ExpressionAttributeValues[':prefix']))};
   }
   assert.equal(command.constructor.name,'TransactWriteCommand');
   const tx=q.TransactItems;
   if(!tx.every(row=>matches(row.ConditionCheck??row.Put??row.Delete)))
    throw Object.assign(Error('conflict'),{name:'TransactionCanceledException'});
   for(const action of tx){
    const mutation=action.Put??action.Delete;
    if(!mutation)continue;
    assert.equal(mutation.TableName,rowTables.staff);
    if(action.Put)save(mutation.TableName,mutation.Item);
    else memory.delete(storageKey(mutation.TableName,mutation.Key));
    writes.push(mutation);
   }
   return {};
 }};
 const {quoteHash}=require('../../wallet-service/dist/deliveryQuoteRecord');
 const release='GENERAL_PRODUCTION_FULL_CASH_V1';
 const caseId=hash({orderId:'prod-order',source:'SEARCH',cycle:'production-cycle'});
 const order={PK:'ORDER#prod-order',SK:'META',orderId:'prod-order',orderNumber:'ORD1234567890',
   status:'ready_for_pickup',storeId:'branch1',userSub:'customer1',
   financeRollout:{schemaVersion:2,scopeId:release,version:1,digest:quoteHash({release,version:1,
     orders:[{orderId:'prod-order',branchId:'branch1',customerSubjectId:'customer1'}]})}};
 const job={orderId:'prod-order',SK:'METADATA',status:'no_driver_available',restaurantId:'branch1',
   dispatchJobId:'job-before',dispatchCycle:{id:'production-cycle'},financialDispatch:true,
   dispatchReview:{reviewStatus:'REQUIRED',observedAt:'2026-11-26T12:00:00Z'}};
 const branch={businessId:'branch1',businessName:'فرع الاختبار',regionId:'r1',ownerId:'owner',cognitoUserId:'owner'};
 save(rowTables.orders,order);
 save(rowTables.jobs,job);
 save(rowTables.branch,branch);
 const regional={pk:'EMPLOYEE#op',sk:'PROFILE',employeeId:'op',version:1,status:'ACTIVE',displayName:'مسؤول المتابعة',
   roles:['operations'],scope:{allRegions:false,regionIds:['r1']}};
 const foreign={...regional,pk:'EMPLOYEE#other',employeeId:'other',scope:{allRegions:false,regionIds:['r2']}};
 const admin={...regional,pk:'EMPLOYEE#admin',employeeId:'admin',scope:{allRegions:true},roles:['settings_manager']};
 for(const profile of [regional,foreign,admin])save(rowTables.staff,profile);
 let employee=regional;
 const guard=()=>F.exact(rowTables.staff,{pk:employee.pk,sk:employee.sk},employee);
 const profile=async()=>({employee,guard:guard()});
 const authority={authenticate:async permission=>{
  if(permission==='SETTINGS'&&employee!==admin)throw Object.assign(Error('denied'),{status:403});
  if(permission==='FOLLOWUP'&&employee===admin)throw Object.assign(Error('denied'),{status:403});
  return {kind:'STAFF',subjectId:employee.employeeId};
 },followup:profile,settings:profile};
 const api=createStaffFollowup({db,authority,tables:rowTables,now:()=>state.time});
 const monitor=createMonitor({db,tables:rowTables,productionOrder,now:()=>state.time});
 assert.equal((await monitor.tick('production-schedule')).saved,1);
 let [item]=(await api({action:'LIST',cursor:null})).items;
 assert.equal(item.orderNumber,order.orderNumber);
 assert.equal(item.caseId,caseId);
 assert.equal(item.followup.canClaim,true);
 assert.equal(item.followup.reviewDueAt,'2026-11-26T12:05:00.000Z');
 employee=foreign;
 assert.deepEqual((await api({action:'LIST',cursor:null})).items,[]);
 await assert.rejects(api({action:'CLAIM',orderId:order.orderId,caseId,baseVersion:item.followup.version,
  note:'خارج النطاق',requestId:'11111111-1111-4111-8111-111111111111'}),/REVIEW_UNAVAILABLE/);
 employee=regional;
 const claim={action:'CLAIM',orderId:order.orderId,caseId,baseVersion:item.followup.version,
  note:'متابعة الفرع قبل التصعيد',requestId:'11111111-1111-4111-8111-111111111111'};
 assert.equal((await api(claim)).saved,true);
 assert.equal((await api(claim)).saved,true);
 [item]=(await api({action:'LIST',cursor:null})).items;
 assert.equal(item.followup.ownerName,'مسؤول المتابعة');
 assert.equal(item.followup.canRelease,true);
 assert.equal(writes.filter(write=>write.Item?.action==='DISPATCH_FOLLOWUP_CLAIM').length,1);
 await assert.rejects(api({action:'READ_POLICY'}),/denied/);
 employee=admin;
 assert.equal((await api({action:'READ_POLICY'})).policy.version,0);
 const updated={action:'SAVE_POLICY',baseVersion:0,reason:'ضبط مهلة المتابعة',
  values:{reviewMinutes:10,escalationMinutes:25},requestId:'22222222-2222-4222-8222-222222222222'};
 assert.equal((await api(updated)).policy.escalationMinutes,25);
 assert.equal((await api(updated)).saved,true);
 employee=regional;
 state.time+=16*60000;
 await monitor.tick('production-escalation');
 [item]=(await api({action:'LIST',cursor:null})).items;
 assert.equal(item.followup.escalated,true);
 assert.equal(item.followup.escalationDueAt,'2026-11-26T12:15:00.000Z');
 assert.deepEqual(read(rowTables.orders,order),order);
 assert.deepEqual(read(rowTables.jobs,job),job);
 const restartId='DRS:'+'a'.repeat(48);
 const replacement={...job,dispatchJobId:'job-after',dispatchCycle:{id:'replacement-cycle'},
   dispatchRestart:{restartId}};
 const restart={orderId:order.orderId,SK:'DISPATCH_RESTART#'+restartId,kind:'DISPATCH_RESTART_START',
   restartId,caseId,branchId:branch.businessId,cycleId:'replacement-cycle',previousCycleId:'production-cycle',
   assignmentId:replacement.dispatchJobId,state:'NEEDS_REVIEW'};
 save(rowTables.jobs,replacement);
 save(rowTables.jobs,restart);
 await monitor.tick('failed-replacement');
 const stillOpen=(await api({action:'LIST',cursor:null})).items;
 assert.equal(stillOpen.length,1);
 assert.equal(stillOpen[0].caseId,caseId);
 assert.equal(stillOpen[0].followup.restartState,'NEEDS_REVIEW');
 assert.equal(stillOpen[0].followup.escalationDueAt,item.followup.escalationDueAt);
 restart.state='STARTED';
 replacement.status='searching';
 save(rowTables.jobs,restart);
 save(rowTables.jobs,replacement);
 await monitor.tick('confirmed-replacement');
 assert.deepEqual((await api({action:'LIST',cursor:null})).items,[]);

});
