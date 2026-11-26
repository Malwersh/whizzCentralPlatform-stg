'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createService}=require('./branch-drafts.cjs');
class Command{constructor(input){this.input=input;}}
const tables={platform:'wizz-production-MerchantPlatform',policy:'wizz-production-PlatformStaff',lifecycle:'wizz-production-AccountDeletion'};
const options={sdk:{GetCommand:Command,QueryCommand:Command,TransactWriteCommand:Command},regions:{validate:async()=>{throw Error('not expected');}},tables};
test('rejects missing or staging bindings',()=>{for(const value of [undefined,'staging-MerchantPlatform','WizzCentral_Regions'])assert.throws(()=>createService({...options,tables:{...tables,platform:value}}),/PRODUCTION_TABLE_REQUIRED/);});
test('requires separate tables and region validation',()=>{assert.throws(()=>createService({...options,tables:{...tables,policy:tables.platform}}),/DISTINCT_TABLES/);assert.throws(()=>createService({...options,regions:{}}),/REGION_VALIDATOR/);});
test('lists only authenticated subject drafts across pages',async()=>{const calls=[];const db={send:async c=>{calls.push(c.input);return calls.length===1?{Items:[{draftId:'one'}],LastEvaluatedKey:{pk:'next'}}:{Items:[{draftId:'two'}]};}};const result=await createService(options).route({db,sub:'owner'}, {path:'/auth/branch-drafts',httpMethod:'GET'},{});assert.equal(result.items.length,2);assert.ok(calls.every(c=>c.TableName===tables.platform&&c.ExpressionAttributeValues[':pk']==='PERSON#owner'&&c.ConsistentRead));assert.deepEqual(calls[1].ExclusiveStartKey,{pk:'next'});});
test('cannot create branch without personal profile',async()=>{await assert.rejects(()=>createService(options).route({db:{send:async()=>({})},sub:'owner'},{path:'/auth/branch-drafts',httpMethod:'POST'},{name:'branch'}),/PROFILE_REQUIRED/);});
test('cannot submit another subject draft',async()=>{const draftId='12345678-1234-1234-1234-123456789abc';await assert.rejects(()=>createService(options).route({db:{send:async()=>({Item:{subjectId:'other'}})},sub:'owner'},{path:'/auth/branch-drafts/submit',httpMethod:'POST'},{draftId,baseVersion:1}),/DRAFT_NOT_FOUND/);});
test('rejects overlapping opening periods',()=>{const hours=Array.from({length:7},(_,day)=>({day,closed:true,periods:[]}));hours[0]={day:0,closed:false,periods:[{open:'10:00',close:'15:00'},{open:'14:00',close:'16:00'}]};assert.throws(()=>createService(options).hours(hours),/INVALID_HOURS/);});
test('creates offline draft with lifecycle fence and no business or wallet activation',async()=>{
 const writes=[];const db={send:async c=>{const q=c.input;if(q.TransactItems){writes.push(q.TransactItems);return {};}
 if(q.Key?.sk==='PROFILE')return {Item:{subjectId:'owner',phoneNumber:'+9647800868280'}};
 if(q.Key?.sk==='CURRENT')return {Item:{policyVersion:1,values:{types:[{id:'restaurant',model:'FOOD'}]}}};return {};}};
 const {draft}=await createService(options).route({db,sub:'owner',phone:v=>v},{path:'/auth/branch-drafts',httpMethod:'POST'},{name:'مطعم',businessTypeId:'restaurant'});
 assert.equal(draft.reviewStatus,'DRAFT');assert.equal(draft.operatingStatus,'OFFLINE');assert.equal(draft.version,1);
 assert.equal(writes[0][0].ConditionCheck.TableName,tables.lifecycle);assert.equal(writes[0].length,2);assert.equal(writes[0][1].Put.TableName,tables.platform);
});
test('submission stores a review snapshot and checks production region versions atomically',async()=>{
 const draftId='12345678-1234-1234-1234-123456789abc';const openingHours=Array.from({length:7},(_,day)=>({day,closed:day!==0,periods:day===0?[{open:'09:00',close:'18:00'}]:[]}));
 const old={pk:'PERSON#owner',sk:'DRAFT#'+draftId,draftId,subjectId:'owner',organizationId:draftId,brandId:draftId,model:'FOOD',address:'حي',contactPhone:'+9647800868280',openingHours,version:1,reviewStatus:'DRAFT',configVersion:2,businessTypeId:'restaurant',businessPhotoAssetId:draftId,regionPath:['iq','gov','district','leaf'],latitude:32,longitude:44};
 let transaction;const check={ConditionCheck:{TableName:'wizz-production-Regions',Key:{regionId:'leaf'},ConditionExpression:'version=:v',ExpressionAttributeValues:{':v':3}}};
 const db={send:async c=>{const q=c.input;if(q.TransactItems){transaction=q.TransactItems;return {};}
 if(q.Key.sk==='ASSET#'+draftId)return {Item:{assetId:draftId,subjectId:'owner',draftId,kind:'BUSINESS_PHOTO',status:'READY',sha256:'a'.repeat(64)}};if(q.Key.sk===old.sk)return {Item:old};if(q.Key.sk==='CURRENT')return {Item:{policyVersion:2,values:{types:[{id:'restaurant',registrationOpen:true,regions:['leaf']}]}}};if(q.Key.sk==='VERSION#2')return {Item:{values:{partnershipReady:true,termsVersion:'terms-1',termsTextAr:'الشروط'}}};return {};}};
 const core=createService({...options,regions:{validate:async()=>({regionId:'leaf',regionNames:['العراق','محافظة','قضاء','ناحية'],checks:[check]})}});
 const result=await core.route({db,sub:'owner'},{path:'/auth/branch-drafts/submit',httpMethod:'POST'},{draftId,baseVersion:1,agreementVersion:'terms-1'});
 assert.equal(result.draft.reviewStatus,'SUBMITTED');assert.equal(result.draft.version,2);assert.ok(transaction.includes(check));assert.equal(transaction.length,7);const assetCheck=transaction.find(x=>x.ConditionCheck?.Key?.sk==='ASSET#'+draftId).ConditionCheck;assert.equal(assetCheck.ExpressionAttributeValues[':hash'],'a'.repeat(64));assert.equal(assetCheck.ExpressionAttributeValues[':sub'],'owner');assert.match(assetCheck.ConditionExpression,/sha256=:hash/);
 assert.ok(transaction.filter(x=>x.Put).every(x=>x.Put.TableName===tables.platform));assert.ok(!JSON.stringify(transaction).includes('WALLET#'));
});

test('required registration certificate cannot be bypassed at submission',async()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 const old={subjectId:'owner',organizationId:id,brandId:id,model:'FOOD',address:'حي',contactPhone:'+9647800868280',openingHours:[{closed:false,periods:[{}]}],version:1,reviewStatus:'DRAFT',configVersion:2,businessTypeId:'RESTAURANT',regionPath:['iq','gov','district','leaf']};
 const db={send:async c=>{const q=c.input;assert.ok(!q.TransactItems,'must not write incomplete submission');if(q.Key.sk==='DRAFT#'+id)return {Item:old};if(q.Key.sk==='CURRENT')return {Item:{policyVersion:2,values:{types:[{id:'RESTAURANT',registrationOpen:true,regions:[],fields:[{id:'registrationCertificateAssetId',required:true}]}]}}};if(q.Key.sk==='VERSION#2')return {Item:{values:{partnershipReady:true,termsVersion:'v1'}}};return {};}};
 await assert.rejects(()=>createService(options).route({db,sub:'owner'},{path:'/auth/branch-drafts/submit',httpMethod:'POST'},{draftId:id,baseVersion:1,agreementVersion:'v1'}),/REGISTRATION_CERTIFICATE_REQUIRED/);
});

 test('new centrally configured activity retains its exact identifier and configuration version',async()=>{
 const activity='TYPE_A44A23E0D37A4A38B70B74508D1EF64C';let transaction;
 const db={send:async c=>{const q=c.input;if(q.TransactItems){transaction=q.TransactItems;return {};}
 if(q.Key.sk==='PROFILE')return {Item:{phoneNumber:'+9647800868280'}};
 if(q.Key.sk==='CURRENT')return {Item:{policyVersion:2,values:{types:[{id:activity,model:'FOOD',registrationOpen:false}]}}};return {};}};
 const {draft}=await createService(options).route({db,sub:'owner',phone:v=>v},{path:'/auth/branch-drafts',httpMethod:'POST'},{name:'مقهى',businessTypeId:activity});
 assert.equal(draft.businessTypeId,activity);assert.equal(draft.configVersion,2);assert.equal(draft.model,'FOOD');assert.equal(draft.operatingStatus,'OFFLINE');assert.equal(transaction.length,2);
 });
 test('draft agreement reads its pinned version instead of silently replacing it with current terms',async()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 const db={send:async c=>{const sk=c.input.Key.sk;return {Item:sk==='DRAFT#'+id?{configVersion:2}:sk==='VERSION#2'?{values:{termsVersion:'accepted-version',termsTextAr:'النص المحفوظ',partnershipReady:true}}:{policyVersion:3,values:{termsVersion:'new-version'}}};}};
 const result=await createService(options).route({db,sub:'owner'},{path:'/auth/branch-drafts/config',httpMethod:'GET',queryStringParameters:{draftId:id}},{});
 assert.equal(result.agreementVersion,'accepted-version');assert.equal(result.agreementTextAr,'النص المحفوظ');assert.equal(result.currentConfigVersion,3);assert.equal(result.updateAvailable,true);
 });
test('current configuration uses approved policy and preserves closed registration',async()=>{
 const types=[{id:'COFFEE',model:'FOOD',registrationOpen:false,fields:[]}];
 const db={send:async c=>{assert.equal(c.input.TableName,tables.policy);assert.equal(c.input.ConsistentRead,true);return {Item:{policyVersion:2,values:{types,termsVersion:'v1',termsTextAr:'اتفاقية'}}};}};
 const result=await createService(options).route({db,sub:'owner'},{path:'/auth/branch-drafts/config',httpMethod:'GET'},{});
 assert.equal(result.version,2);assert.equal(result.configVersion,'2');assert.deepEqual(result.types,types);
});
test('missing current configuration fails closed',async()=>{
 await assert.rejects(()=>createService(options).route({db:{send:async()=>({})},sub:'owner'},{path:'/auth/branch-drafts/config',httpMethod:'GET'},{}),/CONFIG_UNAVAILABLE/);
});
