const {test}=require('node:test');const assert=require('node:assert/strict');
const v=require('../../shared/driver-vehicles-308');
class GetCommand{constructor(input){this.input=input;}}
class TransactWriteCommand{constructor(input){this.input=input;}}
const now=Date.parse('2026-10-25T15:00:00.000Z');const driverId='d',bucket='bucket';
function fixture(){
 const profile={driverId,name:'D',status:'APPROVED',registrationStatus:'APPROVED',isActive:true,work_region_id:'r',vehicleType:'car',vehiclePlate:'old',registrationPaperUrl:'s3://bucket/drivers/d/old',drivingLicenseUrl:'s3://bucket/drivers/d/license',nationalIdUrl:'s3://bucket/drivers/d/id'};
 const live={driverId,status:'offline',isActive:false,isSearching:false,activeOrdersCount:0};let hook;
 const table={drivers:profile,live};const events=[];
 const db={send:async c=>{
  if(c instanceof GetCommand)return {Item:structuredClone(table[c.input.TableName])};
  const ops=c.input.TransactItems;
  if(hook){const h=hook;hook=null;h(table);}
  for(const op of ops){const x=op.ConditionCheck||op.Update;if(!x)continue;const row=table[x.TableName]||{};for(const term of x.ConditionExpression.split(' AND ')){
   let m=term.match(/^attribute_not_exists\((#[\w]+)\)$/);if(m){if(row[x.ExpressionAttributeNames[m[1]]]!==undefined)throw Object.assign(Error('race'),{name:'TransactionCanceledException'});continue;}
   m=term.match(/^(#[\w]+)=(:[\w]+)$/);if(!m)throw Error('unsupported '+term);
   assert.ok(x.ExpressionAttributeNames[m[1]]);if(JSON.stringify(row[x.ExpressionAttributeNames[m[1]]])!==JSON.stringify(x.ExpressionAttributeValues[m[2]]))throw Object.assign(Error('race'),{name:'TransactionCanceledException'});
  }}
  for(const op of ops){const x=op.Update;if(!x)continue;for(const set of x.UpdateExpression.slice(4).split(',')){const [k,val]=set.split('=').map(x=>x.trim());table[x.TableName][x.ExpressionAttributeNames[k]]=structuredClone(x.ExpressionAttributeValues[val]);}}
  events.push(ops);return {};
 }};
 const ctx={db,GetCommand,TransactWriteCommand,driversTable:'drivers',liveTable:'live',bucket,now:()=>now,id:()=> 'event'};
 const run=(action,data={},staff=false)=>v.operation(ctx,{driverId,actorId:staff?'admin':driverId,staff,body:{action,expectedVersion:table.drivers.vehicleRegistry?.version??0,...data}});
 return {table,ctx,run,events,race:fn=>hook=fn};
}
const data=(id='new')=>({id,type:'motorcycle',plateNumber:id,make:'Honda',model:'',color:'black',registrationUrl:'s3://bucket/drivers/d/vehicles/'+id+'/doc'});
async function ready(f){
 await f.run('INITIALIZE',{vehicle:{...data('legacy'),type:'car',plateNumber:'old',registrationUrl:f.table.drivers.registrationPaperUrl}},true);
 for(const documentKind of ['drivingLicense','nationalId'])await f.run('REVIEW_DOCUMENT',{documentKind,decision:'APPROVED',noExpiry:true,reason:'الوثيقة المقدمة لا تتضمن انتهاء صلاحية'},true);
 await f.run('REVIEW',{vehicleId:'legacy',decision:'APPROVED',expiryDate:'2027-01-01',reason:'تمت مطابقة المركبة والسنوية'},true);
 await f.run('SELECT',{vehicleId:'legacy'});
}
test('existing approval is never fabricated as vehicle/document approval',async()=>{const f=fixture();const r=await v.operation(f.ctx,{driverId});assert.equal(r.initialized,false);assert.equal(r.eligibility.eligible,false);assert.equal(r.vehicles[0].effectiveStatus,'PENDING_REVIEW');assert.equal(f.events.length,0);});
test('complete reviewed transition preserves two vehicles and selecting only one',async()=>{const f=fixture();await ready(f);assert.equal(v.eligibility(f.table.drivers,now).eligible,true);await f.run('ADD',{vehicle:data()});assert.equal(v.eligibility(f.table.drivers,now).eligible,true);await assert.rejects(f.run('SELECT',{vehicleId:'new'}),/ACTIVE_VEHICLE_NOT_APPROVED/);await f.run('REVIEW',{vehicleId:'new',decision:'APPROVED',expiryDate:'2027-01-01',reason:'سنوية مطابقة'},true);await f.run('SELECT',{vehicleId:'new'});assert.equal(f.table.drivers.vehicleType,'motorcycle');assert.equal(f.table.drivers.vehiclePlate,'new');assert.equal(f.table.drivers.vehicleRegistry.activeId,'new');assert.equal(Object.keys(f.table.drivers.vehicleRegistry.items).length,2);});
test('different vehicle is pending without invalidating current approved vehicle',async()=>{const f=fixture();await ready(f);await f.run('ADD',{vehicle:data()});assert.equal(v.eligibility(f.table.drivers,now).eligible,true);assert.equal(f.table.drivers.vehicleRegistry.items.new.review,null);});
test('switch and removal cannot occur online or during a live order',async()=>{for(const changes of [{isActive:true},{isSearching:true},{currentOrderId:'order'},{activeOrdersCount:1},{status:'busy'}]){const f=fixture();await ready(f);Object.assign(f.table.live,changes);for(const action of ['SELECT','REMOVE'])await assert.rejects(f.run(action,{vehicleId:'legacy'}),/VEHICLE_CHANGE_REQUIRES_OFFLINE/);}});
test('race with online entry or assignment is rejected atomically',async()=>{for(const change of [t=>t.live.currentOrderId='order',t=>t.live.isSearching=true,t=>t.drivers.vehicleRegistry.version++]){const f=fixture();await ready(f);f.race(change);await assert.rejects(f.run('REMOVE',{vehicleId:'legacy'}),/VEHICLE_VERSION_CONFLICT/);assert.equal(f.table.drivers.vehicleRegistry.items.legacy.removedAt,undefined);}});
test('removal archives the vehicle and clears active references without deleting history',async()=>{const f=fixture();await ready(f);await f.run('REMOVE',{vehicleId:'legacy'});assert.ok(f.table.drivers.vehicleRegistry.items.legacy.removedAt);assert.equal(f.table.drivers.vehicleRegistry.activeId,null);assert.equal(f.table.drivers.vehiclePlate,null);assert.equal(v.eligibility(f.table.drivers,now).eligible,false);await assert.rejects(f.run('SELECT',{vehicleId:'legacy'}),/VEHICLE_NOT_FOUND/);});
test('renewal invalidates approval and requires offline for the selected vehicle',async()=>{const f=fixture();await ready(f);f.table.live.isActive=true;await assert.rejects(f.run('UPDATE',{vehicle:{...data('legacy'),registrationUrl:'s3://bucket/drivers/d/vehicles/legacy/renewal'}}),/VEHICLE_CHANGE_REQUIRES_OFFLINE/);f.table.live.isActive=false;await f.run('UPDATE',{vehicle:{...data('legacy'),registrationUrl:'s3://bucket/drivers/d/vehicles/legacy/renewal'}});assert.equal(f.table.drivers.vehicleRegistry.items.legacy.review,null);assert.equal(v.eligibility(f.table.drivers,now).eligible,false);});
test('replacement of personal document invalidates only its exact reviewed evidence',async()=>{const f=fixture();await ready(f);f.table.drivers.drivingLicenseUrl='s3://bucket/drivers/d/new-license';assert.equal(v.eligibility(f.table.drivers,now).code,'DRIVER_DOCUMENT_REVIEW_REQUIRED');});
test('expiry boundary follows Baghdad last valid day; approval with unknown expiry is explicit',()=>{const end=v.expiresAt('2026-10-25',false,'');assert.equal(end,'2026-10-25T21:00:00.000Z');assert.throws(()=>v.expiresAt('2026-02-30',false,''),/INVALID/);assert.throws(()=>v.expiresAt(null,true,''),/REASON_REQUIRED/);const r={status:'APPROVED',documentUrl:'u',reviewedBy:'a',reviewedAt:'t',expiresAt:end};assert.equal(v.reviewValid(r,'u',Date.parse(end)-1),true);assert.equal(v.reviewValid(r,'u',Date.parse(end)),false);});
test('driver cannot inject review decision or choose document owned by someone else',async()=>{const f=fixture();await assert.rejects(f.run('REVIEW',{vehicleId:'legacy'}),/FORBIDDEN/);await assert.rejects(f.run('ADD',{vehicle:{...data(),review:{status:'APPROVED'}}}),/DATA_INVALID/);await assert.rejects(f.run('ADD',{vehicle:{...data(),registrationUrl:'s3://bucket/drivers/other/x'}}),/DATA_INVALID/);await assert.rejects(f.run('ADD',{vehicle:{...data(),registrationUrl:'s3://other/drivers/d/x'}}),/DATA_INVALID/);});
test('approval races with document updates are fenced, no lost review',async()=>{const f=fixture();await ready(f);await f.run('ADD',{vehicle:data()});f.race(t=>t.drivers.drivingLicenseUrl='changed');await assert.rejects(f.run('REVIEW',{vehicleId:'new',decision:'APPROVED',expiryDate:'2027-01-01',reason:'review'},true),/VERSION_CONFLICT/);assert.equal(f.table.drivers.vehicleRegistry.items.new.review,null);});
test('public driver view excludes private storage references',async()=>{const f=fixture();await ready(f);const r=await v.operation(f.ctx,{driverId});assert.equal(JSON.stringify(r).includes('s3://'),false);});
test('no vehicle or personal document can be approved through driver action names',async()=>{const f=fixture();for(const action of ['INITIALIZE','REVIEW_ACCOUNT','REVIEW_DOCUMENT'])await assert.rejects(f.run(action,{decision:'APPROVED'}),/FORBIDDEN/);});
test('new driver account approval requires reviewed personal documents and a reviewed vehicle',async()=>{const f=fixture();f.table.drivers.status=f.table.drivers.registrationStatus='PENDING_REVIEW';await assert.rejects(f.run('REVIEW_ACCOUNT',{decision:'APPROVED',reason:'اعتماد'},true),/INCOMPLETE/);await ready(f).catch(e=>{assert.match(e.message,/ACCOUNT_NOT_APPROVED/)});await f.run('REVIEW_ACCOUNT',{decision:'APPROVED',reason:'اكتملت المراجعة'},true);await f.run('SELECT',{vehicleId:'legacy'});assert.equal(v.eligibility(f.table.drivers,now).eligible,true);});
test('every change preserves before/after review evidence and never truncates the previous history',async()=>{const f=fixture();await ready(f);const old=f.table.drivers.vehicleRegistry.events.length;await f.run('REVIEW',{vehicleId:'legacy',decision:'REJECTED',reason:'المستند غير واضح'},true);const r=f.table.drivers.vehicleRegistry;assert.equal(r.events.length,old+1);assert.equal(r.events.at(-1).before.vehicle.review.status,'APPROVED');assert.equal(r.events.at(-1).after.vehicle.review.status,'REJECTED');assert.equal(v.eligibility(f.table.drivers,now).eligible,false);});
test('expired document cannot be approved and updates cannot borrow another vehicle image',async()=>{const f=fixture();await ready(f);await assert.rejects(f.run('REVIEW',{vehicleId:'legacy',decision:'APPROVED',expiryDate:'2020-01-01',reason:'expired'},true),/ALREADY_EXPIRED/);await assert.rejects(f.run('ADD',{vehicle:{...data(),registrationUrl:'s3://bucket/drivers/d/vehicles/another/doc'}}),/VEHICLE_MISMATCH/);});
test('stale retries cannot create duplicate vehicles or overwrite a later decision',async()=>{const f=fixture();await ready(f);const version=f.table.drivers.vehicleRegistry.version;await f.run('ADD',{vehicle:data()});await assert.rejects(v.operation(f.ctx,{driverId,actorId:driverId,body:{action:'ADD',expectedVersion:version,vehicle:data()}}),/VERSION_CONFLICT/);assert.equal(Object.keys(f.table.drivers.vehicleRegistry.items).length,2);});
test('account suspension excludes new work without removing selected vehicle evidence',async()=>{const f=fixture();await ready(f);await f.run('REVIEW_ACCOUNT',{decision:'SUSPENDED',reason:'مراجعة إدارية'},true);assert.equal(v.eligibility(f.table.drivers,now).code,'DRIVER_ACCOUNT_NOT_APPROVED');assert.equal(f.table.drivers.vehicleRegistry.activeId,'legacy');});
test('malformed operational flags and empty deletion markers cannot appear eligible',async()=>{const f=fixture();await ready(f);for(const patch of [{isActive:null},{isDeleted:null},{isSuspended:0},{isBanned:'false'},{deletedAt:''},{deletionRequestId:''}])assert.equal(v.eligibility({...f.table.drivers,...patch},now).eligible,false);});
test('explicit account reapproval clears suspension but never silently clears a ban',async()=>{const f=fixture();await ready(f);await f.run('REVIEW_ACCOUNT',{decision:'SUSPENDED',reason:'review'},true);await f.run('REVIEW_ACCOUNT',{decision:'APPROVED',reason:'تمت مراجعة الإيقاف'},true);assert.equal(v.eligibility(f.table.drivers,now).eligible,true);f.table.drivers.isBanned=true;await assert.rejects(f.run('REVIEW_ACCOUNT',{decision:'APPROVED',reason:'review'},true),/ACCOUNT_NOT_APPROVED/);});
test('sole reviewed vehicle becomes default atomically without approving account or personal documents',async()=>{
 const f=fixture();f.table.drivers.status=f.table.drivers.registrationStatus='PENDING_REVIEW';
 await f.run('INITIALIZE',{},true);
 const result=await f.run('REVIEW',{vehicleId:'legacy',decision:'APPROVED',noExpiry:true,reason:'مطابقة'},true);
 assert.equal(result.activeId,'legacy');assert.equal(f.table.drivers.vehicleOperational.activeId,'legacy');
 assert.equal(f.table.drivers.status,'PENDING_REVIEW');assert.equal(result.eligibility.eligible,false);
 assert.equal(f.table.drivers.vehicleRegistry.events.at(-1).defaultVehicleId,'legacy');
});
test('second approval never replaces the selected vehicle, including a pending or expired selection',async()=>{
 const f=fixture();await ready(f);await f.run('ADD',{vehicle:data()});
 f.table.drivers.vehicleRegistry.items.legacy.review.expiresAt='2020-01-01T00:00:00Z';
 await f.run('REVIEW',{vehicleId:'new',decision:'APPROVED',noExpiry:true,reason:'مطابقة'},true);
 assert.equal(f.table.drivers.vehicleRegistry.activeId,'legacy');assert.equal(f.table.drivers.vehiclePlate,'old');
 await assert.rejects(f.run('SELECT_DEFAULT'),/DEFAULT_NOT_APPLICABLE/);
});
test('default backfill only selects a sole approved vehicle and is fenced against concurrent additions',async()=>{
 const f=fixture();await ready(f);f.table.drivers.vehicleRegistry.activeId=null;
 const version=f.table.drivers.vehicleRegistry.version;
 f.race(t=>{t.drivers.vehicleRegistry.items.new={...data(),review:null};t.drivers.vehicleRegistry.version++;});
 await assert.rejects(f.run('SELECT_DEFAULT'),/VERSION_CONFLICT/);
 assert.equal(f.table.drivers.vehicleRegistry.activeId,null);
 delete f.table.drivers.vehicleRegistry.items.new;
 const result=await f.run('SELECT_DEFAULT');assert.equal(result.activeId,'legacy');
 assert.equal(result.version,version+2);
 await assert.rejects(f.run('SELECT_DEFAULT'),/DEFAULT_NOT_APPLICABLE/);
});
test('pending sole vehicle and multiple vehicles with no selection cannot use default selection',async()=>{
 const f=fixture();await f.run('INITIALIZE',{},true);await assert.rejects(f.run('SELECT_DEFAULT'),/DEFAULT_NOT_APPLICABLE/);
 await ready(fixture());
 await f.run('ADD',{vehicle:data()});
 await f.run('REVIEW',{vehicleId:'new',decision:'APPROVED',noExpiry:true,reason:'مطابقة'},true);
 assert.equal(f.table.drivers.vehicleRegistry.activeId,null);
 await assert.rejects(f.run('SELECT_DEFAULT'),/DEFAULT_NOT_APPLICABLE/);
});
