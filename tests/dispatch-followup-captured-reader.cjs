'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),cp=require('node:child_process'),assert=require('node:assert/strict');
const R=path.resolve(__dirname,'..'),zip=process.env.DEPLOYED_STAFF_ZIP;if(!zip)throw Error('DEPLOYED_STAFF_ZIP required');
const source=cp.execFileSync('unzip',['-p',zip,'_discount_review/central-staff/index.js'],{maxBuffer:12*1024*1024}).toString();
const start=source.indexOf('// backend/staff-service/dispatch-reviews.js\n'),end=source.indexOf('\n// backend/',start+60);assert(start>0&&end>start);
const factory=(factories)=>{let m;return ()=>{if(!m){m={exports:{}};Object.values(factories)[0](m.exports,m);}return m.exports;};};
const requireFromStaff=Module.createRequire(path.join(R,'backend/staff-service/index.js'));
const old=new Function('require','require_dist_cjs60','require_catalog','__name','__commonJS',source.slice(start,end)+'\nreturn require_dispatch_reviews();')(requireFromStaff,()=>requireFromStaff('@aws-sdk/lib-dynamodb'),()=>requireFromStaff('./catalog'),fn=>fn,factory);
const file=path.join(R,'backend/staff-service/test/dispatch-reviews.test.cjs'),fixtureSource=fs.readFileSync(file,'utf8').split("test('review details")[0];const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(fixtureSource+'\nmodule.exports={fixture};',file);
const current=requireFromStaff('./dispatch-reviews');
(async()=>{
 for(const variant of ['ready','cancelled','assigned','activeHold','financialSearch','newCycle']){
  const f=m.exports.fixture();if(variant==='cancelled')f.get('WizzOrders',{PK:'ORDER#o',SK:'META'}).status='cancelled';if(variant==='assigned')f.get('WizzOrders',{PK:'ORDER#o',SK:'META'}).driverId='d';if(variant==='activeHold')f.put('staging-Holds',{orderId:'o',sk:'HOLD'},{orderId:'o',sk:'HOLD',status:'ACTIVE'});if(variant==='financialSearch'){const j=f.get('WizzDispatchJobs_staging',{orderId:'o',SK:'METADATA'});j.financialDispatch=true;j.financialSearchVersion=1;delete j.dispatchReview;}if(variant==='newCycle')f.get('WizzDispatchJobs_staging',{orderId:'o',SK:'METADATA'}).dispatchCycle={id:'cycle2'};
  const selector={orderId:'o',source:'SEARCH'},a=await old.createReviewReader(f.ctx,f.actor).load(selector),b=await current.createReviewReader(f.ctx,f.actor).load(selector);
  assert.equal(a.baseDigest,b.baseDigest,variant);for(const k of ['caseId','canRequestRetry','canRequestCancel','canRequestReservationReview'])assert.equal(a.item[k],b.item[k],variant+' '+k);
 }
 console.log(JSON.stringify({status:'PASS',cases:6,deployedDecisionDigestPreserved:true,existingActionPermissionsPreserved:true}));
})();
