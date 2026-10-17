'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,FIELDS}=require('../commercial-options');
const {service}=require('../commercial-management');
const {fixture,editor,owner,staff}=require('./helpers/commercial-fixture.cjs');
test('options use projected paginated reads, isolate merchant branches and preserve versions without defaults',async()=>{
 const calls=[],db={send:async command=>{const x=command.input;calls.push(x);assert.equal(x.Select,'SPECIFIC_ATTRIBUTES');assert.deepEqual(Object.values(x.ExpressionAttributeNames),FIELDS);if(x.TableName==='WhizzMerchants_Discounts')return x.ExclusiveStartKey?{Items:[{discountId:'own',businessId:'branch',title:'عرض الفرع',version:2},{discountId:'foreign',businessId:'other',title:'أجنبي',version:1}]}:{Items:[],LastEvaluatedKey:{discountId:'cursor'}};return {Items:[{discountId:'platform',title:'عرض منصة',code:'SAVE',isActive:false},{discountId:'deleted',title:'محذوف',isDeleted:true}]};}};
 const options=await load(db,'branch');assert.equal(calls.length,3);assert.equal(options.length,2);assert.equal(options.find(o=>o.id==='own').version,2);assert.equal(options.find(o=>o.id==='platform').version,null);assert.equal(options.find(o=>o.id==='platform').status,'inactive');assert(options.every(o=>!('createdBy' in o)));
});
test('failed or incomplete reads return no partial option list',async()=>{await assert.rejects(load({send:async()=>{throw Error('denied');}},'branch'),/denied/);let pages=0;await assert.rejects(load({send:async()=>{pages++;return {Items:[],LastEvaluatedKey:{discountId:'cursor'}};}},'branch'),/TOO_LARGE/);assert.equal(pages,20);});
test('options require live staff permission, branch ownership fences and final verification; owner cannot use staff option view',async()=>{
 const input={businessId:'branch',view:'funding-options'},f=fixture();let reads=0;const send=f.ctx.db.send;f.ctx.db.send=async c=>{if(c.constructor.name==='ScanCommand'){reads++;return {Items:[]};}return send(c);};
 await assert.rejects(service(f.ctx,owner,'GET',input),/PERMISSION_REQUIRED/);await assert.rejects(service(f.ctx,staff('reader','operations'),'GET',input),/PERMISSION_REQUIRED/);assert.equal(reads,0);
 const result=await service(f.ctx,editor(),'GET',input);assert.deepEqual(result,{options:[],businessId:'branch'});assert.equal(reads,2);assert(f.commands.at(-1).input.TransactItems.every(t=>t.ConditionCheck));f.break();await assert.rejects(service(f.ctx,editor(),'GET',input),/VERSION_OR_STATE/);
});
