'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createService}=require('./service.cjs'),{prepareInitialConfig}=require('./config.cjs');
class C{constructor(input){this.input=input;}}
const actor={employeeId:'owner',scope:{allRegions:true}};
const base=()=>prepareInitialConfig({policyVersion:'12345678-1234-1234-1234-123456789abc',actorId:'owner',now:'2026-11-17T00:00:00Z'}).TransactItems[0].Put.Item;
function setup(current=null,permission=true){let tx;const ctx={db:{send:async c=>{if(c.input.TransactItems){tx=c.input;return {};}return {Item:current};}},allowed:()=>permission,guard:()=>({ConditionCheck:{actor:true}}),audit:()=>({Put:{audit:true}})};return {ctx,route:createService({GetCommand:C,TransactWriteCommand:C}),tx:()=>tx};}
const path='/staff/merchants/onboarding';
test('missing configuration can be read without silently initializing',async()=>{const s=setup();assert.equal((await s.route(s.ctx,actor,'GET',path)).current,null);assert.equal(s.tx(),undefined);});
test('initialization is audited, guarded, closed and atomic',async()=>{const s=setup();const result=await s.route(s.ctx,actor,'POST',path+'/initialize',{reason:'تهيئة الإنتاج'});assert.equal(result.current.values.partnershipReady,false);assert.equal(s.tx().TransactItems.length,4);});
test('initialization never overwrites existing config',async()=>{const s=setup(base());await assert.rejects(()=>s.route(s.ctx,actor,'POST',path+'/initialize',{reason:'تهيئة الإنتاج'}),/ALREADY_INITIALIZED/);assert.equal(s.tx(),undefined);});
test('save records immutable revision and rejects stale version',async()=>{const current=base(),s=setup(current);await assert.rejects(()=>s.route(s.ctx,actor,'POST',path+'/save',{reason:'تحديث الإعدادات',baseVersion:0,values:current.values}),/VERSION_OR_STATE_CONFLICT/);const r=await s.route(s.ctx,actor,'POST',path+'/save',{reason:'تحديث الإعدادات',baseVersion:1,values:current.values});assert.equal(r.current.version,2);assert.equal(s.tx().TransactItems[1].Put.ExpressionAttributeValues[':v'],1);});
test('opening registration requires approved agreement',async()=>{const current=base(),s=setup(current),values=structuredClone(current.values);values.types[0].registrationOpen=true;await assert.rejects(()=>s.route(s.ctx,actor,'POST',path+'/save',{reason:'فتح التسجيل',baseVersion:1,values}),/PARTNERSHIP_AGREEMENT_REQUIRED/);assert.equal(s.tx(),undefined);});
test('agreement text changes require new version',async()=>{const current=base(),s=setup(current),values={...current.values,termsTextAr:'نص اتفاقية جديد خاص بالإنتاج'};await assert.rejects(()=>s.route(s.ctx,actor,'POST',path+'/save',{reason:'تحديث الاتفاقية',baseVersion:1,values}),/NEW_AGREEMENT_VERSION_REQUIRED/);});
test('permission and reason are required before writes',async()=>{const s=setup(null,false);await assert.rejects(()=>s.route(s.ctx,actor,'POST',path+'/initialize',{reason:'تهيئة الإنتاج'}),/PERMISSION_REQUIRED/);assert.equal(s.tx(),undefined);});
