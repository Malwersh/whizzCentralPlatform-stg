'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {identity,uploadInput,createApi}=require('./profile-api.cjs');const legal=require('./customer-legal-contract-344');
const sub='34d8e408-1021-7076-6055-7325644f97cb',bucket='wizz-production-driver-documents-746727375268-us-east-1';
const claims={sub,iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_5sUT54eCB',aud:'59to4hbat3lv2fvosa49afu0gi',token_use:'id',exp:Math.floor(Date.now()/1000)+300};
const event=(method,path,body)=>({httpMethod:method,path,body:JSON.stringify(body),requestContext:{authorizer:{claims}}});
function harness({closing=false,patch={},race=false,legalRow}={}){
 const calls=[];class Cmd{constructor(input){this.input=input;}}
 const values=legal.defaults('DRIVER'),row={pk:'OPERATIONAL_SETTINGS#DRIVER_LEGAL',sk:'CURRENT',status:'PUBLISHED',version:1,publishedAt:'2026-11-16T00:00:00Z',values};row.digest=legal.hash({schemaVersion:1,revision:1,publishedAt:row.publishedAt,...values});
 const p={driverId:sub,status:'PENDING_PROFILE',phoneNumber:'+9647800000000',updatedAt:'original',...patch};
 const regions=[{regionId:'iq',level:0,name:'Iraq',effective_is_active:1},{regionId:'g',level:1,parent_id:'iq',name:'Najaf',effective_is_active:1},{regionId:'d',level:2,parent_id:'g',name:'District',effective_is_active:1},{regionId:'r',level:3,parent_id:'d',name:'Area',effective_is_active:1}];
 const db={send:async c=>{const i=c.input;calls.push(i);if(i.TransactItems){if(race)throw Object.assign(Error('race'),{name:'TransactionCanceledException'});return {};}
 if(i.TableName==='wizz-production-Drivers')return {Item:closing?{...p,deletionRequestId:'delete'}:p};if(i.TableName==='wizz-production-PlatformStaff')return {Item:legalRow===undefined?row:legalRow};return {Items:regions};}};
 const api=createApi({db,s3:{send:async c=>{calls.push(c.input);return {};}},GetCommand:Cmd,ScanCommand:Cmd,TransactWriteCommand:Cmd,PutObjectCommand:Cmd,HeadObjectCommand:Cmd,beginUpload:async()=>{calls.push({beginUpload:true});return async()=>calls.push({finishUpload:true});},withContext:async(s,fn)=>fn()});
 const body={profileSchemaVersion:2,name:'محمد',home_address_text:'الحي',vehiclePlate:'123',vehicleType:'car',governorate_id:'g',work_region_id:'r',legalAccepted:true,legalAcceptance:{revision:1,digest:row.digest},...Object.fromEntries(['drivingLicenseUrl','nationalIdUrl','registrationPaperUrl'].map(k=>[k,'s3://'+bucket+'/drivers/'+sub+'/'+k+'.png']))};
 return {api,calls,body};
}
test('identity requires exact production pool client token type and nonexpired claims',()=>{assert.equal(identity(event('GET','/driver/me')),sub);for(const patch of [{aud:'other'},{iss:'other'},{token_use:'access'},{exp:0},{sub:'bad'}])assert.throws(()=>identity({requestContext:{authorizer:{claims:{...claims,...patch}}}}));});
test('accepts a future API Gateway UTC expiration and rejects an expired or malformed date',()=>{
 const expires=new Date(Date.now()+300000);
 const rfcDate=expires.toUTCString();
 const utcDate=rfcDate.replace(/^(\w+)?, (\d+) (\w+) (\d+) (\S+) GMT$/, '$1 $3 $2 $5 UTC $4');
 for(const exp of [String(claims.exp),rfcDate,utcDate,expires.toISOString()]){
  assert.equal(identity({requestContext:{authorizer:{claims:{...claims,exp}}}}),sub);
 }
 for(const exp of [new Date(Date.now()-300000).toUTCString(),'unparseable',undefined]){
  assert.throws(()=>identity({requestContext:{authorizer:{claims:{...claims,exp}}}}));
 }
});
test('the first lookup after phone verification returns the pending profile without writing',async()=>{
 const h=harness();
 const response=await h.api(event('GET','/driver/me'));
 assert.equal(response.statusCode,200);
 assert.equal(JSON.parse(response.body).data.status,'PENDING_PROFILE');
 assert.deepEqual(h.calls,[{TableName:'wizz-production-Drivers',Key:{driverId:sub},ConsistentRead:true}]);
});
test('valid full submission pins legal version and enters review without altering phone or approval',async()=>{const h=harness();const r=await h.api(event('PUT','/driver/me',h.body));assert.equal(r.statusCode,200);const tx=h.calls.find(x=>x.TransactItems).TransactItems;assert.equal(tx[0].ConditionCheck.TableName,'wizz-production-AccountDeletion');assert.equal(tx[1].ConditionCheck.TableName,'wizz-production-PlatformStaff');const regionChecks=tx.slice(2,6).map(row=>row.ConditionCheck);assert.deepEqual(regionChecks.map(check=>check.Key.regionId),['iq','g','d','r']);assert(regionChecks.every(check=>check.TableName==='wizz-production-RegionsDerived'&&check.ConditionExpression.includes('attribute_not_exists(#pending)')));const p=tx[6].Put.Item;assert.equal(p.status,'PENDING_REVIEW');assert.equal(p.isVerified,false);assert.equal(p.phoneNumber,'+9647800000000');assert.equal(p.legalAcceptance.subjectId,sub);assert.ok(tx[6].Put.ConditionExpression);});
test('caller cannot supply approval flags another identity or change phone',async()=>{for(const field of ['driverId','status','isVerified','phoneNumber']){const h=harness();const r=await h.api(event('PUT','/driver/me',{...h.body,[field]:'forged'}));assert.equal(r.statusCode,400);assert.ok(!h.calls.some(x=>x.TransactItems));}});
test('foreign document or wrong region cannot complete registration',async()=>{for(const patch of [{nationalIdUrl:'s3://'+bucket+'/drivers/other/doc.png'},{governorate_id:'other'}]){const h=harness();const r=await h.api(event('PUT','/driver/me',{...h.body,...patch}));assert.equal(r.statusCode,400);assert.ok(!h.calls.some(x=>x.TransactItems));}});
test('approved or closing profiles cannot be overwritten through onboarding',async()=>{for(const options of [{closing:true},{patch:{registrationStatus:'APPROVED'}}]){const h=harness(options);assert.equal((await h.api(event('PUT','/driver/me',h.body))).statusCode,409);assert.ok(!h.calls.some(x=>x.TransactItems));}});
test('concurrent profile change returns conflict',async()=>{const h=harness({race:true});assert.equal((await h.api(event('PUT','/driver/me',h.body))).statusCode,409);});
test('file type and size checked before upload; metadata alone cannot disguise bytes',()=>{const good={documentType:'national_id',contentType:'application/pdf',fileData:Buffer.from('%PDF-1.7 example').toString('base64')};assert.ok(uploadInput(good).bytes);assert.throws(()=>uploadInput({...good,contentType:'image/png'}));assert.throws(()=>uploadInput({...good,fileData:'bad'}));});
test('document upload registers lifecycle operation before S3 then finishes operation',async()=>{const h=harness();const r=await h.api(event('POST','/driver/documents/upload',{documentType:'national_id',contentType:'application/pdf',fileData:Buffer.from('%PDF-1.7 example').toString('base64')}));assert.equal(r.statusCode,200);assert.ok(h.calls.findIndex(x=>x.beginUpload)<h.calls.findIndex(x=>x.Bucket));assert.ok(h.calls.at(-1).finishUpload);assert.ok(JSON.parse(r.body).documentUrl.startsWith('s3://'+bucket+'/drivers/'+sub+'/'));});
test('production profile API stays disabled before AWS initialization',async()=>{process.env.ENVIRONMENT='production';process.env.PROFILE_API_ENABLED='false';assert.equal((await require('./index.cjs').handler({})).statusCode,503);});

test('onboarding uploads cannot replace reviewed or restricted driver documents',async()=>{
 for(const patch of [{status:'APPROVED'},{registrationStatus:'VERIFIED'},{status:'SUSPENDED'},{isSuspended:true},{isBanned:true},{status:'REJECTED'},{vehicleRegistry:{items:{}}}]){
  const h=harness({patch});
  const r=await h.api(event('POST','/driver/documents/upload',{documentType:'national_id',contentType:'application/pdf',fileData:Buffer.from('%PDF-1.7 example').toString('base64')}));
  assert.equal(r.statusCode,409);assert.equal(JSON.parse(r.body).code,'USE_REVIEWED_PROFILE_MANAGEMENT');
  assert.ok(!h.calls.some(x=>x.Bucket||x.beginUpload||x.TransactItems));
 }
});
test('closing driver cannot upload new documents',async()=>{
 const h=harness({closing:true});const r=await h.api(event('POST','/driver/documents/upload',{}));
 assert.equal(r.statusCode,409);assert.ok(!h.calls.some(x=>x.Bucket||x.beginUpload||x.TransactItems));
});

test('unpublished driver policy prevents submission without profile writes',async()=>{
 const h=harness({legalRow:null});const r=await h.api(event('PUT','/driver/me',h.body));
 assert.equal(r.statusCode,503);assert.equal(JSON.parse(r.body).code,'LEGAL_DOCUMENTS_UNAVAILABLE');
 assert.ok(!h.calls.some(x=>x.TransactItems));
});
test('stale or forged policy consent never writes the profile',async()=>{
 for(const legalAcceptance of [{revision:0,digest:'old'},{revision:1,digest:'forged'},{}]){
  const h=harness();const r=await h.api(event('PUT','/driver/me',{...h.body,legalAcceptance}));
  assert.equal(r.statusCode,409);assert.equal(JSON.parse(r.body).code,'LEGAL_VERSION_CHANGED');
  assert.ok(!h.calls.some(x=>x.TransactItems));
 }
});
test('another audience policy cannot satisfy driver consent',async()=>{
 const values=legal.defaults('CUSTOMER'),publishedAt='2026-11-16T00:00:00Z';
 const row={pk:'OPERATIONAL_SETTINGS#CUSTOMER_LEGAL',sk:'CURRENT',status:'PUBLISHED',version:1,publishedAt,values};
 row.digest=legal.hash({schemaVersion:1,revision:1,publishedAt,...values});
 const h=harness({legalRow:row});const r=await h.api(event('PUT','/driver/me',{...h.body,legalAcceptance:{revision:1,digest:row.digest}}));
 assert.equal(r.statusCode,503);assert.ok(!h.calls.some(x=>x.TransactItems));
});

test('drivers can read their own vehicles while suspended without receiving private registration URLs',async()=>{
 const h=harness({patch:{status:'SUSPENDED',vehicleType:'car',vehiclePlate:'123',registrationPaperUrl:'s3://'+bucket+'/drivers/'+sub+'/registration_paper/a.png'}});
 const response=await h.api(event('GET','/driver/vehicles'));
 const data=JSON.parse(response.body);
 assert.equal(response.statusCode,200);assert.equal(data.vehicles.length,1);
 assert.equal(data.vehicles[0].registrationUrl,undefined);
 assert.equal(data.eligibility.code,'DRIVER_ACCOUNT_NOT_APPROVED');
 assert.deepEqual(h.calls[0].Key,{driverId:sub});
 assert.ok(!h.calls.some(x=>x.TransactItems));
});
test('drivers cannot approve their own account through vehicle management',async()=>{
 const h=harness();
 const response=await h.api(event('POST','/driver/vehicles',{action:'REVIEW_ACCOUNT',decision:'APPROVED',expectedVersion:0}));
 assert.equal(response.statusCode,403);assert.ok(!h.calls.some(x=>x.TransactItems));
});
test('vehicle upload reserves a private registration path before the vehicle is created',async()=>{
 const h=harness({patch:{status:'APPROVED'}});
 const pdf={documentType:'registration_paper',contentType:'application/pdf',fileData:Buffer.from('%PDF-1.7 example').toString('base64'),vehicleId:'new-vehicle'};
 const response=await h.api(event('POST','/driver/vehicles/documents',pdf));
 assert.equal(response.statusCode,200);
 assert.ok(JSON.parse(response.body).documentUrl.startsWith('s3://'+bucket+'/drivers/'+sub+'/vehicles/new-vehicle/'));
 assert.ok(!h.calls.some(x=>x.TransactItems));
});
test('new personal document uses the lifecycle fence without overwriting the account decision',async()=>{
 const h=harness({patch:{status:'SUSPENDED'}});
 const response=await h.api(event('POST','/driver/vehicles/documents',{documentType:'national_id',contentType:'application/pdf',fileData:Buffer.from('%PDF-1.7 example').toString('base64')}));
 assert.equal(response.statusCode,200);
 const [lifecycle,change]=h.calls.find(x=>x.TransactItems).TransactItems;
 assert.equal(lifecycle.ConditionCheck.TableName,'wizz-production-AccountDeletion');
 assert.equal(change.Update.ExpressionAttributeNames['#doc'],'nationalIdUrl');
 assert.equal(change.Update.UpdateExpression,'SET #doc = :url, #time = :time');
});

test('renewing the active vehicle pins its new registration and waits for fresh review',async()=>{
 const previous='s3://'+bucket+'/drivers/'+sub+'/vehicles/vehicle/old.png';
 const replacement='s3://'+bucket+'/drivers/'+sub+'/vehicles/vehicle/new.png';
 const h=harness({patch:{status:'APPROVED',vehicleType:'car',vehiclePlate:'123',registrationPaperUrl:previous,
  vehicleRegistry:{schemaVersion:1,version:1,activeId:'vehicle',events:[],items:{vehicle:{id:'vehicle',type:'car',plateNumber:'123',registrationUrl:previous}}}}});
 const response=await h.api(event('POST','/driver/vehicles',{action:'UPDATE',expectedVersion:1,vehicle:{id:'vehicle',type:'car',plateNumber:'123',registrationUrl:replacement}}));
 assert.equal(response.statusCode,200,response.body);
 const result=JSON.parse(response.body);
 assert.equal(result.vehicles[0].effectiveStatus,'PENDING_REVIEW');
 assert.equal(result.eligibility.code,'ACTIVE_VEHICLE_NOT_APPROVED');
 const ops=h.calls.find(x=>x.TransactItems).TransactItems;
 assert.ok(ops.some(x=>x.ConditionCheck?.TableName==='wizz-production-DriverLiveState'));
 assert.equal(ops.find(x=>x.Update).Update.ExpressionAttributeValues[':cregistrationPaperUrl'],replacement);
});
