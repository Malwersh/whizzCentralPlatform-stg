'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.REGION_PRODUCTION_TEST_ROOT;
if(!root)throw Error('REGION_PRODUCTION_TEST_ROOT must point to unpacked production artifact');
const m=require(path.join(root,'model.js'));
const {registrationOptions}=require('./driver-profile/registration-regions');
const {createRegionApi}=require('./region-management/region-api.cjs');
const {fixture}=require(path.join(root,'test/fixture.cjs'));
const T=require(path.join(root,'repository.js')).TABLES;
test('published projection feeds registration and account review with the same hierarchy',()=>{
 const f=fixture(),rows=[...f.rows.values()].filter(r=>r.geometry);rows[0].name='Iraq';rows[0].name_ar='العراق';
 const projection=rows.map(r=>m.derive(r,rows,{},new Date().toISOString()));
 const options=registrationOptions(projection);assert.equal(options.regions.length,1);assert.equal(options.regions[0].regionId,'a');
 rows[2].is_active=false;assert.equal(registrationOptions(rows.map(r=>m.derive(r,rows,{},new Date().toISOString()))).regions.length,0);
});
test('preparing projection cannot expose a region to driver registration',()=>{
 const f=fixture(),rows=[...f.rows.values()].filter(r=>r.geometry);rows[0].name='Iraq';rows[0].name_ar='العراق';rows[3].is_active=false;rows[3]._regionPublication='preparing';
 assert.equal(registrationOptions(rows.map(r=>m.derive(r,rows,{},new Date().toISOString()))).regions.length,0);
});
test('an active admin session can save a draft before completing fresh authentication for publication',async()=>{
 const f=fixture();f.actor.roles=['region_manager'];f.put('staff',{pk:'EMPLOYEE#admin',sk:'PROFILE',...f.actor});
 const db={send(command){
  const items=command.input.TransactItems?.flatMap(Object.values)??[command.input];
  for(const item of items)if(item.TableName==='wizz-production-PlatformStaff')item.TableName='staff';
  return f.ctx.db.send(command);
 }};
 const claims={iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_njh6vaNWj',client_id:'7924qedsr5m1j1bvc3c7va8egk',token_use:'access',sub:'admin',auth_time:Math.floor(f.ctx.now()/1000)-600,exp:Math.floor(f.ctx.now()/1000)+3600};
 const api=createRegionApi({db,sdk:f.ctx.sdk,enabled:true,writesEnabled:true,readersReady:true,now:f.ctx.now,verifyAccessToken:async()=>claims,liveIdentity:async()=>({Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'admin'}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']}),route:(ctx,...args)=>require(path.join(root,'service.js')).route({...ctx,enqueue:f.ctx.enqueue},...args)});
 const call=async(action,body,status=200)=>{const r=await api({httpMethod:action?'POST':'GET',path:'/staff/regions/manage'+(action?'/'+action:''),headers:{Authorization:'Bearer fixture'},...(action?{body:JSON.stringify(body)}:{})});assert.equal(r.statusCode,status,r.body);return JSON.parse(r.body);};
 let c=await call();const region=m.editable(f.region('b',3,'district',f.square(44.01,31)));delete region.version;
 await call('draft',{region,catalogDigest:c.digest,expectedDraftVersion:0,reason:'اختبار معزول للحفظ والنشر'});assert.equal(f.get(T.base,{regionId:'b'}),undefined);
 c=await call();assert.equal(c.drafts[0].region.regionId,'b');
 const publish={catalogDigest:c.digest,drafts:c.drafts.map(d=>({regionId:d.region.regionId,version:d.version})),requestId:'production_contract',reason:'اختبار معزول للنشر الصحيح'};
 assert.equal((await call('publish',publish,403)).error,'REAUTH_REQUIRED');
 claims.auth_time=Math.floor(f.ctx.now()/1000);
 const result=await call('publish',publish);
 assert.equal((await f.drain(result.job.jobId)).status,'PUBLISHED');assert.equal(f.get(T.derived,{regionId:'b'}).effective_is_active,1);
});
