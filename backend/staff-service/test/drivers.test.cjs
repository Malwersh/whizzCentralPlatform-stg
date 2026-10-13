const {test}=require('node:test');const assert=require('node:assert/strict');const {route,visible,inScope}=require('../drivers');
const actor={employeeId:'a',version:1,status:'ACTIVE',roles:['driver_manager'],scope:{allRegions:false,regionIds:['r1']}};
test('driver scope rejects unassigned and missing regions',()=>{assert.equal(inScope(actor,{work_region_id:'r1'}),true);assert.equal(inScope(actor,{work_region_id:'r2'}),false);assert.equal(inScope(actor,{}),false);});
test('driver lists exclude documents and authentication material',()=>{assert.deepEqual(visible({driverId:'x',name:'n',fcmToken:'secret',nationalId:'private',drivingLicense:'private'}),{driverId:'x',name:'n'});});
test('list filters on server, not browser',async()=>{const db={send:async()=>({Items:[{driverId:'1',work_region_id:'r1'},{driverId:'2',work_region_id:'r2'}]})};assert.equal((await route({db,driversTable:'d'},actor,'GET','/staff/drivers')).items.length,1);});
test('read-only reviewer cannot edit',async()=>{await assert.rejects(route({}, {...actor,roles:['driver_reviewer']},'POST','/staff/drivers/edit',{}),/PERMISSION_REQUIRED/);});
test('manager cannot inject approval status',async()=>{const db={send:async()=>({Item:{driverId:'d',work_region_id:'r1'}})};await assert.rejects(route({db,driversTable:'d'},actor,'POST','/staff/drivers/edit',{driverId:'d',values:{name:'n',home_address_text:'h',status:'APPROVED'}}),/FIELD_NOT_ALLOWED/);});
test('manager cannot edit a driver outside scope',async()=>{const db={send:async()=>({Item:{driverId:'d',work_region_id:'r2'}})};await assert.rejects(route({db,driversTable:'d'},actor,'POST','/staff/drivers/edit',{driverId:'d'}),/DRIVER_UNAVAILABLE/);});
test('editing commits staff guard, driver version guard, and audit atomically',async()=>{
 const before={driverId:'d',work_region_id:'r1',updatedAt:'old'};
 const base=[{regionId:'country',level:0,effective_is_active:1},{regionId:'gov',level:1,parent_id:'country',name:'G',effective_is_active:1},{regionId:'district',level:2,parent_id:'gov',name:'D',effective_is_active:1},{regionId:'r1',level:3,parent_id:'district',name:'R',effective_is_active:1}];let transaction;
 const db={send:async c=>{if(c.constructor.name==='GetCommand')return {Item:before};if(c.constructor.name==='ScanCommand')return {Items:c.input.TableName==='regions'?base:[]};transaction=c.input;return {};}};
 const guard={ConditionCheck:{version:1}},audit={Put:{audit:true}};
 assert.deepEqual(await route({db,driversTable:'drivers',regionsTable:'regions',derivedTable:'derived',guard:()=>guard,audit:()=>audit,id:()=> 'event'},actor,'POST','/staff/drivers/edit',{driverId:'d',expectedUpdatedAt:'old',values:{name:'New',vehicleType:'car',governorate_id:'gov',work_region_id:'r1',home_address_text:'landmark'}}),{updated:true});
 assert.equal(transaction.TransactItems[0],guard);assert.equal(transaction.TransactItems[2],audit);assert.match(transaction.TransactItems[1].Update.ConditionExpression,/#updatedAt = :old/);assert.equal(transaction.TransactItems[1].Update.ExpressionAttributeValues[':old'],'old');
});
