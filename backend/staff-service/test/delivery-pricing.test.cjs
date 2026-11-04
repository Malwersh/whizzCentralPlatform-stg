'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const service=require('../delivery-pricing'),{validateAssignment}=require('../catalog');
const {parseIqd:m}=require('../pricing-runtime/money');
const actor=(id='editor',role='pricing_editor')=>({employeeId:id,roles:[role],version:1,status:'ACTIVE',scope:{allRegions:true}});
const now='2026-10-15T12:00:00.000Z';
const common=()=>({id:'test',version:1,scope:{type:'GLOBAL',id:'GLOBAL'},priority:1,status:'DRAFT',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,rounding:'HALF_AWAY_FROM_ZERO',vehicleType:null,base:m('1000'),minimum:m('0'),maximum:m('20000'),fallbackPolicyId:null,longDistance:{afterMeters:10000,flat:m('0'),perKm:m('0')},peaks:[]});
const bundle=()=>({deliveryRules:[{...common(),perKm:m('500'),tiers:[],coverage:{enabled:true,maxRoadMeters:30000,maxDurationSeconds:3600,supportedZoneIds:['zone']}}],driverRules:[{...common(),pickupPerKm:m('100'),pickupIncludedMeters:1000,deliveryPerKm:m('200'),perMinute:m('50')}]});
const request=()=>({baseVersion:0,draftVersion:0,reason:'إعداد أسعار الاختبار',values:bundle()});
function fixture(){
 const records=new Map(),commands=[];let revoked=false,broken=false;
 const ctx={table:'staff',enrolled:true,recent:()=>{},claims:{},employee:async()=>revoked?{...actor(),status:'SUSPENDED'}:actor(),
 guard:a=>({ConditionCheck:{TableName:'staff',Key:{pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'},ConditionExpression:'#v=:v AND #s=:a',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':a.version,':a':'ACTIVE'}}}),audit:(id,action,before,after,uuid)=>({Put:{TableName:'staff',Item:{pk:'AUDIT',sk:uuid,actorId:id,action,before,after}}})};
 ctx.db={send:async command=>{commands.push(command);const x=command.input;if(command.constructor.name==='GetCommand')return {Item:records.get(x.Key.sk)};if(command.constructor.name==='QueryCommand')return {Items:[],LastEvaluatedKey:{pk:service.PK,sk:'VERSION#000000000001'}};
 if(broken)throw Object.assign(Error('conflict'),{name:'TransactionCanceledException'});
 for(const op of x.TransactItems){if(op.Put?.Item.pk===service.PK)records.set(op.Put.Item.sk,structuredClone(op.Put.Item));}return {};}};
 return {ctx,records,commands,revoke:()=>revoked=true,break:()=>broken=true};
}
const call=(f,who,method,suffix='',body={})=>service.route(f.ctx,who,method,service.PATH+suffix,body);
test('dedicated global roles required, finance/merchants cannot write pricing',async()=>{
 for(const role of ['finance_settings','merchant_manager'])await assert.rejects(call(fixture(),actor('a',role),'GET'),/PERMISSION_REQUIRED/);
 await assert.rejects(call(fixture(),{...actor(),scope:{allRegions:false}},'GET'),/PERMISSION_REQUIRED/);
 assert.throws(()=>validateAssignment({roles:['pricing_editor'],status:'ACTIVE',scope:{allRegions:false,regionIds:['one']},approvalLimit:0}),/GLOBAL_ROLE/);
});
test('empty read explicit; no policy initialization or assumed rate',async()=>{const f=fixture(),r=await call(f,actor(),'GET');assert.equal(r.current,null);assert.equal(r.draft,null);assert.equal(f.commands.length,2);assert.ok(f.commands.every(c=>c.input.ConsistentRead));});
test('draft save atomically fences current, draft, actor and audit; no publication',async()=>{const f=fixture();const r=await call(f,actor(),'POST','/draft',request());assert.equal(r.status,'DRAFT_SAVED');assert.equal(f.records.has('CURRENT'),false);const tx=f.commands.at(-1).input.TransactItems;assert.equal(tx.length,4);assert.equal(tx[1].ConditionCheck.Key.sk,'CURRENT');assert.equal(tx[2].Put.ConditionExpression,'attribute_not_exists(pk)');assert.equal(tx[3].Put.Item.action,'PRICING_DRAFT_SAVED');});
test('MFA/recent validation, editor/approver separation, stale versions and unknown input',async()=>{
 const f=fixture();f.ctx.enrolled=false;await assert.rejects(call(f,actor(),'POST','/draft',request()),/ENROLLMENT/);f.ctx.enrolled=true;f.ctx.recent=()=>{throw Error('REAUTH_REQUIRED');};await assert.rejects(call(f,actor(),'POST','/draft',request()),/REAUTH/);f.ctx.recent=()=>{};
 await assert.rejects(call(f,actor('review','pricing_approver'),'POST','/draft',request()),/PERMISSION/);
 await call(f,actor(),'POST','/draft',request());await assert.rejects(call(f,actor(),'POST','/draft',request()),/VERSION_OR_STATE/);
 await assert.rejects(call(f,actor(),'POST','/draft',{...request(),draftVersion:1,extra:1}),/INVALID_PRICING_REQUEST/);
});
test('invalid or ambiguous rule set and client-published rules rejected before write',async()=>{
 for(const edit of [v=>v.deliveryRules.push({...v.deliveryRules[0],id:'other'}),v=>v.driverRules[0].base=m('-1'),v=>v.deliveryRules[0].status='PUBLISHED']){
 const f=fixture(),body=request();edit(body.values);await assert.rejects(call(f,actor(),'POST','/draft',body));assert.ok(!f.commands.some(c=>c.input.TransactItems));}
});
test('self approval forbidden even with combined roles',async()=>{const f=fixture(),a={...actor(),roles:['pricing_editor','pricing_approver']};await call(f,a,'POST','/draft',request());await assert.rejects(call(f,a,'POST','/publish',{baseVersion:0,draftVersion:1,reason:'اعتماد الاختبار'}),/SELF_APPROVAL/);});
test('publish rechecks requester and fences both staff/current/draft/version/audit atomically',async()=>{
 const f=fixture();await call(f,actor(),'POST','/draft',request());const r=await call(f,actor('review','pricing_approver'),'POST','/publish',{baseVersion:0,draftVersion:1,reason:'اعتماد الاختبار'});
 assert.equal(r.status,'PUBLISHED');assert.equal(r.policy.values.driverRules[0].status,'PUBLISHED');const tx=f.commands.at(-1).input.TransactItems;assert.equal(tx.length,6);assert.equal(tx[1].ConditionCheck.Key.pk,'EMPLOYEE#editor');assert.equal(tx[3].Put.ExpressionAttributeValues[':v'],1);assert.equal(tx[4].Put.Item.sk,'VERSION#000000000001');
 await assert.rejects(call(f,actor('review','pricing_approver'),'POST','/publish',{baseVersion:1,draftVersion:2,reason:'اعتماد مكرر'}),/VERSION_OR_STATE/);
});
test('revoked requester and failed transaction cannot publish',async()=>{
 const f=fixture();await call(f,actor(),'POST','/draft',request());f.revoke();await assert.rejects(call(f,actor('review','pricing_approver'),'POST','/publish',{baseVersion:0,draftVersion:1,reason:'اعتماد الاختبار'}),/REQUESTER_PERMISSION_REVOKED/);assert.equal(f.records.has('CURRENT'),false);
 const g=fixture();await call(g,actor(),'POST','/draft',request());g.break();await assert.rejects(call(g,actor('review','pricing_approver'),'POST','/publish',{baseVersion:0,draftVersion:1,reason:'اعتماد الاختبار'}));assert.equal(g.records.has('CURRENT'),false);
});
const simulation=()=>({source:'DRAFT',version:1,at:now,context:{branchId:'branch',merchantId:'merchant',zoneId:'zone',cityId:'city',governorateId:'governorate',vehicleType:'BIKE'},pickupRoute:leg(),deliveryRoute:leg()});
function leg(){return {id:'simulated',source:'ADMIN_SIMULATION',quality:'ROAD',fallbackPolicyId:null,distanceMeters:2000,durationSeconds:600,measuredAt:now,expiresAt:'2026-10-15T12:10:00.000Z'};}
test('simulation uses saved draft and identical engine, no writes or financial records',async()=>{
 const f=fixture();await call(f,actor(),'POST','/draft',request());f.commands.length=0;
 const r=await call(f,actor('viewer','pricing_viewer'),'POST','/simulate',simulation());assert.equal(r.delivery.customerDeliveryFee.minorAmount,2000000);assert.equal(r.driver.driverEarning.minorAmount,2500000);assert.equal(f.commands.length,1);assert.equal(f.records.get('DRAFT').values.deliveryRules[0].status,'DRAFT');
 await assert.rejects(call(f,actor(),'POST','/simulate',{...simulation(),version:2}),/VERSION_OR_STATE/);
 await assert.rejects(call(f,actor(),'POST','/simulate',{...simulation(),rules:bundle()}),/INVALID_PRICING_REQUEST/);
});
test('history cursor constrained to policy and version namespace',async()=>{
 const f=fixture();const r=await call(f,actor(),'GET','/history');assert.ok(r.nextCursor);assert.equal(f.commands.at(-1).input.Limit,10);
 for(const key of [{pk:'OTHER',sk:'VERSION#000000000001'},{pk:service.PK,sk:'DRAFT'}]){f.ctx.query={cursor:Buffer.from(JSON.stringify(key)).toString('base64url')};await assert.rejects(call(f,actor(),'GET','/history'),/INVALID_CURSOR/);}
});
module.exports={bundle,simulation};
test('published rule content immutable at same version; increment required for changes',async()=>{
 const f=fixture();await call(f,actor(),'POST','/draft',request());await call(f,actor('review','pricing_approver'),'POST','/publish',{baseVersion:0,draftVersion:1,reason:'اعتماد الاختبار'});
 const body={...request(),baseVersion:1,draftVersion:2};body.values.deliveryRules[0].base=m('1200');await assert.rejects(call(f,actor(),'POST','/draft',body),/RULE_VERSION_CONFLICT/);
 body.values.deliveryRules[0].version=2;await call(f,actor(),'POST','/draft',body);assert.equal(f.records.get('CURRENT').values.deliveryRules[0].base.minorAmount,1000000);assert.equal(f.records.get('DRAFT').values.deliveryRules[0].version,2);
});
