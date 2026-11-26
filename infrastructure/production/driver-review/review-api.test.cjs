'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReviewApi,TABLE,DRIVERS,REGIONS}=require('./review-api.cjs');
const {POLICY,PRODUCTION_SNAPSHOT_TABLE}=require('../../../backend/shared/driver-performance-snapshot');
class GetCommand{constructor(input){this.input=input;}}class ScanCommand extends GetCommand{}class TransactWriteCommand extends GetCommand{}class HeadObjectCommand extends GetCommand{}
const sub='11111111-1111-4111-8111-111111111111',driver='22222222-2222-4222-8222-222222222222',now=Date.parse('2026-11-16T12:00:00Z');
function fixture(reviewWritesEnabled=false){
 const actor={employeeId:sub,version:1,status:'ACTIVE',roles:['driver_reviewer'],scope:{allRegions:false,regionIds:['work']}};
 const profile={driverId:driver,status:'PENDING_REVIEW',registrationStatus:'PENDING_REVIEW',work_region_id:'work',governorate_id:'gov',vehicleType:'car',vehiclePlate:'123',registrationPaperUrl:`s3://wizz-production-driver-documents-746727375268-us-east-1/drivers/${driver}/paper.pdf`,drivingLicenseUrl:`s3://wizz-production-driver-documents-746727375268-us-east-1/drivers/${driver}/license.pdf`};
 const claims={iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_njh6vaNWj',client_id:'7924qedsr5m1j1bvc3c7va8egk',sub,token_use:'access',auth_time:now/1000-60,exp:now/1000+600};
 const live={Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:sub}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']};
 const rows=[{regionId:'iq',name:'Iraq',level:0,effective_is_active:1},{regionId:'gov',level:1,parent_id:'iq',effective_is_active:1},{regionId:'district',level:2,parent_id:'gov',effective_is_active:1},{regionId:'work',level:3,parent_id:'district',effective_is_active:1}];
 const writes=[],heads=[],signed=[],reads=[];let readCount=0;
 const f={actor,profile,claims,live,rows,writes,heads,signed,reads,failWrite:false,race:false,failVerify:false};
 f.run=createReviewApi({db:{send:async c=>{
 const i=c.input;if(c instanceof TransactWriteCommand){if(f.failWrite)throw Object.assign(Error(),{name:'TransactionCanceledException'});writes.push(i);return {};}
 reads.push(i);
 if(c instanceof ScanCommand)return {Items:f.directory||rows,...(f.cursor?{LastEvaluatedKey:f.cursor}:{})};
 if(i.TableName===TABLE)return {Item:actor};
 if(i.TableName===PRODUCTION_SNAPSHOT_TABLE)return {Item:i.Key.sk==='STATE'?f.snapshot:f.health};
 if(i.TableName==='wizz-production-AccountDeletion'){
  if(i.Key.sk.startsWith('ACTIVE#'))return {Item:f.deletion&&{requestId:f.deletion.requestId}};
  if(i.Key.sk.startsWith('REQUEST#'))return {Item:f.deletion};
  return {Item:f.closing?i.Key:undefined};
 }
 if(i.TableName===DRIVERS){readCount++;if(f.race&&readCount===2)return {Item:{...profile,work_region_id:'other'}};return {Item:profile};}return {};
 }},verifyAccessToken:async()=>{if(f.failVerify)throw Error();return claims;},liveIdentity:async()=>live,GetCommand,ScanCommand,TransactWriteCommand,HeadObjectCommand,s3:{send:async c=>{heads.push(c.input);return {VersionId:'version-one'};}},reviewWritesEnabled,signDocument:async (input,ttl)=>{signed.push({input,ttl});return 'https://private.example/signed';},now:()=>now});
 f.event=body=>({httpMethod:body?'POST':'GET',path:`/staff/drivers/${driver}/vehicles`,headers:{Authorization:'Bearer fixture'},...(body?{body:JSON.stringify(body)}:{})});return f;
}
test('invalid or expired admin token fails without reading driver',async()=>{for(const kind of ['verify','expiry','type']){const f=fixture();if(kind==='verify')f.failVerify=true;if(kind==='expiry')f.claims.exp=now/1000;if(kind==='type')f.claims.token_use='id';assert.equal((await f.run(f.event())).statusCode,401);assert.equal(f.writes.length,0);}});
test('disabled staff, revoked session, missing MFA and disabled Cognito user are denied',async()=>{for(const kind of ['staff','session','mfa','live']){const f=fixture();if(kind==='staff')f.actor.status='SUSPENDED';if(kind==='session')f.actor.minimumAuthTime=now/1000;if(kind==='mfa')f.live.UserMFASettingList=[];if(kind==='live')f.live.Enabled=false;assert.equal((await f.run(f.event())).statusCode,403);}});
test('scope and roles cannot be supplied in the body',async()=>{const f=fixture();f.actor.scope.regionIds=['other'];assert.equal((await f.run(f.event({action:'INITIALIZE',expectedVersion:0,roles:['bootstrap_admin']}))).statusCode,404);assert.equal(f.writes.length,0);});
test('review writes actor evidence, staff/lifecycle guards and no wallet operations atomically',async()=>{const f=fixture();const r=await f.run(f.event({action:'REVIEW_DOCUMENT',expectedVersion:0,documentKind:'drivingLicense',decision:'APPROVED',expiryDate:'2027-01-01',reason:'وثيقة واضحة ومطابقة'}));assert.equal(r.statusCode,200,r.body);assert.equal(f.heads.length,1);const ops=f.writes[0].TransactItems;assert.equal(ops.length,4);const item=ops.find(x=>x.Put).Put.Item;assert.equal(item.actorSnapshot.employeeId,sub);assert.equal(item.actorIdentityEvidence,'VERIFIED_STAFF_AT_ACTION');assert(ops.some(x=>x.ConditionCheck?.TableName==='wizz-production-AccountDeletion'));assert(!JSON.stringify(ops).includes('Wallet'));});
test('approved document must exist under exact driver private prefix',async()=>{const f=fixture();f.profile.drivingLicenseUrl='s3://other/drivers/'+driver+'/x.pdf';const r=await f.run(f.event({action:'REVIEW_DOCUMENT',expectedVersion:0,documentKind:'drivingLicense',decision:'APPROVED',noExpiry:true,reason:'راجعت الوثيقة'}));assert.equal(r.statusCode,400);assert.equal(f.writes.length,0);});
test('account approval rejects closed work region before any mutation',async()=>{const f=fixture();f.rows.at(-1).effective_is_active=0;assert.equal((await f.run(f.event({action:'REVIEW_ACCOUNT',expectedVersion:0,decision:'APPROVED',reason:'راجعت'}))).statusCode,409);assert.equal(f.writes.length,0);});
test('concurrent scope/profile changes and concurrent revocation fail closed',async()=>{const f=fixture();f.race=true;assert.equal((await f.run(f.event({action:'INITIALIZE',expectedVersion:0}))).statusCode,409);const g=fixture();g.failWrite=true;assert.equal((await g.run(g.event({action:'INITIALIZE',expectedVersion:0}))).statusCode,409);});
test('request cannot edit arbitrary profile fields through review',async()=>{const f=fixture();assert.equal((await f.run(f.event({action:'INITIALIZE',expectedVersion:0,isVerified:true}))).statusCode,400);assert.equal(f.writes.length,0);});

test('tokens from driver identity or another client cannot authorize staff review',async()=>{for(const field of ['iss','client_id']){const f=fixture();f.claims[field]='other';assert.equal((await f.run(f.event())).statusCode,401);}});
test('unactivated runtime does not initialize AWS or load JWT dependencies',async()=>{const old={...process.env};try{process.env.ENVIRONMENT='production';process.env.DRIVER_REVIEW_ENABLED='false';assert.equal((await require('./index.cjs').handler({})).statusCode,503);}finally{process.env=old;}});
test('valid account approval includes four region guards and never skips document approval',async()=>{const f=fixture(),m=require('./driver-vehicles-308');f.profile.nationalIdUrl=f.profile.drivingLicenseUrl.replace('license','national');const review=url=>({status:'APPROVED',documentUrl:url,expiresAt:'2027-01-01T21:00:00.000Z',reviewedBy:sub,reviewedAt:new Date(now).toISOString(),reason:'راجعت الوثيقة'});f.profile.personalDocumentReview={drivingLicense:review(f.profile.drivingLicenseUrl),nationalId:review(f.profile.nationalIdUrl)};const r=m.initialRegistry(f.profile);r.version=1;const v=r.items.legacy;v.review={...review(v.registrationUrl),fingerprint:m.fingerprint(v)};f.profile.vehicleRegistry=r;const result=await f.run(f.event({action:'REVIEW_ACCOUNT',expectedVersion:1,decision:'APPROVED',reason:'اكتملت مراجعة الوثائق والمركبة'}));assert.equal(result.statusCode,200,result.body);const ops=f.writes[0].TransactItems;assert.equal(ops.filter(x=>x.ConditionCheck?.TableName===REGIONS).length,4);assert.equal(JSON.parse(result.body).eligibility.eligible,true);assert.equal(f.heads.length,3);});

test('private viewer selects profile document only, audits and pins object version for sixty seconds',async()=>{const f=fixture(),e=f.event();e.path=e.path.replace('/vehicles','/documents/view');e.queryStringParameters={kind:'drivingLicense'};const r=await f.run(e);assert.equal(r.statusCode,200,r.body);assert.equal(f.signed[0].ttl,60);assert.equal(f.signed[0].input.VersionId,'version-one');assert.equal(f.signed[0].input.ResponseCacheControl,'no-store');assert.equal(f.writes[0].TransactItems.length,4);});
test('viewer refuses arbitrary URL, wrong scope and revocation race without signing',async()=>{for(const mode of ['url','scope','race']){const f=fixture(),e=f.event();e.path=e.path.replace('/vehicles','/documents/view');e.queryStringParameters={kind:'drivingLicense'};if(mode==='url')e.queryStringParameters.url='s3://other/key';if(mode==='scope')f.actor.scope.regionIds=['other'];if(mode==='race')f.failWrite=true;const r=await f.run(e);assert.equal(r.statusCode,{url:400,scope:404,race:409}[mode]);assert.equal(f.signed.length,0);}});
test('private viewer rejects another driver reference and unknown vehicle without signing',async()=>{for(const kind of ['foreign','unknown']){const f=fixture(),e=f.event();e.path=e.path.replace('/vehicles','/documents/view');e.queryStringParameters=kind==='unknown'?{kind:'registrationPaper',vehicleId:'missing'}:{kind:'drivingLicense'};if(kind==='foreign')f.profile.drivingLicenseUrl=f.profile.drivingLicenseUrl.replace(driver,'33333333-3333-4333-8333-333333333333');const r=await f.run(e);assert.equal(r.statusCode,404);assert.equal(f.signed.length,0);assert.equal(f.writes.length,0);}});
test('read-only staff permission cannot approve and removed profile cannot expose documents',async()=>{const f=fixture();f.actor.roles=['driver_manager'];assert.equal((await f.run(f.event({action:'INITIALIZE',expectedVersion:0}))).statusCode,403);const g=fixture();g.profile.isDeleted=true;const e=g.event();e.path=e.path.replace('/vehicles','/documents/view');e.queryStringParameters={kind:'drivingLicense'};assert.equal((await g.run(e)).statusCode,404);assert.equal(g.signed.length,0);});

test('directory enforces region, excludes deleted and unassigned profiles and strips private fields',async()=>{const f=fixture();f.directory=[{...f.profile,name:'آمن',drivingLicenseUrl:'secret',phoneNumber:'0780'}, {...f.profile,work_region_id:'other'}, {...f.profile,work_region_id:undefined}, {...f.profile,isDeleted:true}];const e={httpMethod:'GET',path:'/staff/drivers',headers:{Authorization:'Bearer fixture'}};const r=await f.run(e);assert.equal(r.statusCode,200,r.body);const b=JSON.parse(r.body);assert.equal(b.items.length,1);assert.equal(b.items[0].name,'آمن');assert(!r.body.includes('secret'));assert(!r.body.includes('drivingLicenseUrl'));assert.equal(f.writes.length,0);});
test('directory cursor is validated and continuation is returned without mutation',async()=>{const f=fixture();f.directory=[];f.cursor={driverId:driver};const e={httpMethod:'GET',path:'/staff/drivers',headers:{Authorization:'Bearer fixture'}};let r=await f.run(e);assert.equal(JSON.parse(r.body).nextCursor,Buffer.from(JSON.stringify(f.cursor)).toString('base64url'));for(const cursor of ['bad',Buffer.from(JSON.stringify({driverId:driver,other:'x'})).toString('base64url')]){r=await f.run({...e,queryStringParameters:{cursor}});assert.equal(r.statusCode,400);}assert.equal(f.writes.length,0);});
test('directory rejects insufficient permission and revoked sessions',async()=>{for(const mode of ['role','revoked','mfa']){const f=fixture();if(mode==='role')f.actor.roles=['finance_viewer'];if(mode==='revoked')f.actor.minimumAuthTime=now/1000;if(mode==='mfa')f.live.UserMFASettingList=[];assert.equal((await f.run({httpMethod:'GET',path:'/staff/drivers'})).statusCode,403);}});
test('read-only activation never enables review POST',async()=>{const old={...process.env};try{process.env.ENVIRONMENT='production';process.env.DRIVER_REVIEW_ENABLED='false';process.env.DRIVER_REVIEW_READ_ENABLED='true';assert.equal((await require('./index.cjs').handler({httpMethod:'POST'})).statusCode,503);}finally{process.env=old;}});

test('review capability stays disabled for read-only rollout',async()=>{const f=fixture();const r=await f.run(f.event());assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.body).capabilities,{review:false,suspend:false});});
test('review capability is derived from service activation and staff permissions',async()=>{const f=fixture(true);const r=await f.run(f.event());assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.body).capabilities,{review:true,suspend:true});});


test('staff reads the current production snapshot within driver region scope only',async()=>{
 const f=fixture();
 f.actor.roles=['driver_manager'];
 const time=new Date(now).toISOString();
 f.snapshot={pk:'DRIVER#'+driver,sk:'STATE',driverId:driver,policyVersion:POLICY,schemaVersion:1,
  generation:1,builtGeneration:1,computedAt:time,validUntil:new Date(now+360000).toISOString(),
  snapshot:{acceptanceRate:.7,acceptance:{sampleSize:10},completionRate:1,completion:{sampleSize:7},
   customerRating:null,customerRatingCount:0,rejections:{windowComplete:true,consecutive:1}},detailsKey:'private'};
 f.health={policyVersion:POLICY,healthy:true,updatedAt:time};
 const event={...f.event(),path:'/staff/drivers/'+driver+'/performance'};
 const r=await f.run(event);
 assert.equal(r.statusCode,200,r.body);
 assert.deepEqual(JSON.parse(r.body),{status:'CURRENT',computedAt:time,acceptanceRate:.7,acceptanceSample:10,
  completionRate:1,completionSample:7,consecutiveDeclines:1,rating:null,ratingCount:0});
 assert.deepEqual(f.reads.filter(i=>i.TableName===PRODUCTION_SNAPSHOT_TABLE).map(i=>i.Key.sk).sort(),['HEALTH','STATE']);
 assert.equal(f.writes.length,0);
 f.actor.scope.regionIds=['outside'];
 assert.equal((await f.run(event)).statusCode,404);
 assert.equal(f.reads.filter(i=>i.TableName===PRODUCTION_SNAPSHOT_TABLE).length,2);
 f.actor.scope.regionIds=['work'];
 f.closing=true;
 assert.equal((await f.run(event)).statusCode,404);
});

test('performance reports missing data and rejects filter and write attempts',async()=>{
 const f=fixture(),event={...f.event(),path:'/staff/drivers/'+driver+'/performance'};
 const r=await f.run(event);
 assert.equal(r.statusCode,200);
 const result=JSON.parse(r.body);
 assert.equal(result.status,'UNAVAILABLE');
 assert.equal(result.acceptanceRate,null);
 assert.equal(result.completionRate,null);
 assert.equal((await f.run({...event,httpMethod:'POST'})).statusCode,404);
 assert.equal((await f.run({...event,queryStringParameters:{driverId:'wrong'}})).statusCode,400);
 assert.equal(f.writes.length,0);
});

test('driver account tracking exposes only status and blocker codes to scoped staff',async()=>{
 const f=fixture(),event=f.event();
 event.path=event.path.replace('/vehicles','/account-deletion');
 assert.deepEqual(JSON.parse((await f.run(event)).body),{request:null});
 f.deletion={requestId:sub,actorType:'DRIVER',subjectId:driver,scope:{kind:'ACCOUNT',id:driver},
  status:'PENDING_POLICY',updatedAt:now,blockers:[{code:'QUALITY_CASE_REVIEW_REQUIRED',notes:'private'}],
  verification:{challengeId:'private'}};
 const result=await f.run(event);
 assert.equal(result.statusCode,200,result.body);
 assert.deepEqual(JSON.parse(result.body),{request:{
  requestId:sub,status:'PENDING_POLICY',updatedAt:now,blockers:['QUALITY_CASE_REVIEW_REQUIRED'],
 }});
 assert.equal(f.writes.length,0);
 assert.equal((await f.run({...event,httpMethod:'POST'})).statusCode,404);
 f.actor.scope.regionIds=['other'];
 assert.equal((await f.run(event)).statusCode,404);
 const race=fixture();
 race.deletion=f.deletion;race.race=true;
 assert.equal((await race.run(event)).statusCode,404);
});
