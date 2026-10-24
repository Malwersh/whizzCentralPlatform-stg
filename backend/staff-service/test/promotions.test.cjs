'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {route}=require('../promotions'),{revision}=require('../campaign-version');
const P='WizzCentral_Platform_Discounts',M='WhizzMerchants_Discounts',S='staging-PlatformStaff';
function fixture(){const rows=new Map(),writes=[],k=(t,key)=>t+'|'+JSON.stringify(key),put=(t,r)=>rows.set(k(t,t===P||t===M?{discountId:r.discountId}:t==='WhizzMerchants_Businesses'?{businessId:r.businessId}:{pk:r.pk,sk:r.sk}),structuredClone(r));let failed=false;
 const ctx={enrolled:true,now:()=> '2026-10-17T12:00:00.000Z',guard:a=>({ConditionCheck:{TableName:S,Key:{pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'},ConditionExpression:'attribute_exists(pk)'}}),audit:(actorId,action,before,after,id)=>({Put:{TableName:S,Item:{pk:'AUDIT',sk:'2026-10-17T12:00:00.000Z#'+id,actorId,action,before,after}}})};
 ctx.db={async send(c){const x=c.input;if(c.constructor.name==='GetCommand')return {Item:structuredClone(rows.get(k(x.TableName,x.Key)))};if(c.constructor.name==='ScanCommand')return {Items:[...rows.entries()].filter(([key])=>key.startsWith(x.TableName+'|')).map(([,value])=>structuredClone(value))};writes.push(x.TransactItems);const touched=x.TransactItems.map(o=>{const v=Object.values(o)[0];return k(v.TableName,v.Key||(v.TableName===P||v.TableName===M?{discountId:v.Item.discountId}:{pk:v.Item.pk,sk:v.Item.sk}));});assert.equal(new Set(touched).size,touched.length);if(failed)throw Object.assign(Error('conditional conflict'),{name:'TransactionCanceledException'});for(const o of x.TransactItems){if(o.Update?.Key.pk?.startsWith('OFFER_CODE#')){const q=o.Update,current=rows.get(k(q.TableName,q.Key));if(current&&current.offerId!==q.ExpressionAttributeValues[':id'])throw Object.assign(Error('code conflict'),{name:'TransactionCanceledException'});}}for(const o of x.TransactItems){if(o.Update?.Key.pk?.startsWith('OFFER_CODE#'))put(o.Update.TableName,{...o.Update.Key,offerId:o.Update.ExpressionAttributeValues[':id']});if(o.Put)put(o.Put.TableName,o.Put.Item);if(o.Delete)rows.delete(k(o.Delete.TableName,o.Delete.Key));}return {};}};
 const actor={employeeId:'staff',roles:['promotions_manager'],version:1,status:'ACTIVE',scope:{allRegions:true}},data={title:'Offer',code:'SAVE10',type:'percentage',value:10,minOrderAmount:0,validFrom:'2026-10-01T00:00:00.000Z',validTo:'2026-11-01T00:00:00.000Z',status:'active',isActive:true};
 const input={source:'PLATFORM',discountId:'promo',action:'CREATE',requestId:randomUUID(),values:data},call=b=>route(ctx,actor,'POST',b),get=(t,key)=>structuredClone(rows.get(k(t,key)));
 return {ctx,actor,data,input,call,get,put,writes,fail:()=>failed=true};}
test('shared platform campaign rejects edits and deletion without changing the approved source',async()=>{const f=fixture();await f.call(f.input);let r=f.get(P,{discountId:'promo'});f.put(P,{...r,fundingPolicyId:'policy',fundingPolicyVersion:1});r=f.get(P,{discountId:'promo'});for(const action of ['UPDATE','DELETE'])await assert.rejects(f.call({source:'PLATFORM',discountId:'promo',action,requestId:randomUUID(),baseRevision:revision(r),...(action==='UPDATE'?{values:{value:15}}:{})}),/SHARED_DISCOUNT/);assert.deepEqual(f.get(P,{discountId:'promo'}),r);});
test('state changes keep approved terms version and funding; expired/stale read cannot overwrite',async()=>{const f=fixture();await f.call(f.input);let r=f.get(P,{discountId:'promo'});f.put(P,{...r,fundingPolicyId:'p',fundingPolicyVersion:1});r=f.get(P,{discountId:'promo'});await f.call({source:'PLATFORM',discountId:'promo',action:'UPDATE',requestId:randomUUID(),baseRevision:revision(r),values:{status:'inactive',isActive:false}});const next=f.get(P,{discountId:'promo'});assert.equal(next.version,1);assert.equal(next.fundingPolicyId,'p');await assert.rejects(f.call({source:'PLATFORM',discountId:'promo',action:'UPDATE',requestId:randomUUID(),baseRevision:revision(r),values:{value:50}}),/VERSION_OR_STATE/);});
test('direct funding/version/counter assignment and unknown fields are rejected',async()=>{for(const extra of [{version:20},{fundingPolicyId:'evil'},{usage:999},{createdBy:'impersonated'},{commission:0}]){const f=fixture();await assert.rejects(f.call({...f.input,values:{...f.data,...extra}}),/FIELDS_INVALID/);assert.equal(f.writes.length,0);}});
test('legacy adoption preserves terms and usage but creates explicit version once',async()=>{const f=fixture(),old={...f.data,discountId:'promo',usage:7,currentUsage:7};f.put(P,old);const body={source:'PLATFORM',discountId:'promo',action:'ADOPT',requestId:randomUUID(),baseRevision:revision(old)};await f.call(body);assert.equal(f.get(P,{discountId:'promo'}).version,1);assert.equal(f.get(P,{discountId:'promo'}).usage,7);assert((await f.call(body)).replayed);});
test('read-only roles, inactive staff, missing MFA and foreign regions cannot write',async()=>{for(const mode of ['readonly','inactive','mfa','region']){const f=fixture();if(mode==='readonly')f.actor.roles=['platform_manager'];if(mode==='inactive')f.actor.status='SUSPENDED';if(mode==='mfa')f.ctx.enrolled=false;if(mode==='region')f.actor.scope={allRegions:false,regionIds:['one']};await assert.rejects(f.call(f.input),/PERMISSION|ENROLLMENT|REGION_SCOPE/);assert.equal(f.get(P,{discountId:'promo'}),undefined);}});
test('delete replay proves its scope and cannot resurrect a record or cross source tables',async()=>{const f=fixture();await f.call(f.input);const row=f.get(P,{discountId:'promo'}),body={source:'PLATFORM',discountId:'promo',action:'DELETE',requestId:randomUUID(),baseRevision:revision(row)};await f.call(body);assert.equal(f.get(P,{discountId:'promo'}),undefined);assert((await f.call(body)).replayed);await assert.rejects(f.call({...body,source:'MERCHANT'}),/REQUEST_ID_CONFLICT/);});
test('merchant modification is branch scoped, preserves usage and shares the same content version',async()=>{const f=fixture(),b={businessId:'branch',ownerId:'owner',cognitoUserId:'owner',regionId:'region'};f.put('WhizzMerchants_Businesses',b);const old={discountId:'d',businessId:'branch',title:'offer',description:'',type:'percentage',value:10,minimum_order_amount:0,valid_from:f.data.validFrom,valid_to:f.data.validTo,status:'active',usage_count:4};f.put(M,old);await f.call({source:'MERCHANT',discountId:'d',action:'UPDATE',requestId:randomUUID(),baseRevision:revision(old),values:{value:20}});assert.equal(f.get(M,{discountId:'d'}).version,1);assert.equal(f.get(M,{discountId:'d'}).usage_count,4);assert(f.writes.at(-1).some(x=>x.ConditionCheck?.Key.pk==='BUSINESS_LIFECYCLE#MERCHANT#branch'));});
test('audit failure or retention hold prevents the campaign write',async()=>{const f=fixture();f.fail();await assert.rejects(f.call(f.input),/VERSION_OR_STATE/);assert.equal(f.get(P,{discountId:'promo'}),undefined);const g=fixture();await g.call(g.input);let row=g.get(P,{discountId:'promo'});g.put(P,{...row,retentionHold:true});row=g.get(P,{discountId:'promo'});await assert.rejects(g.call({source:'PLATFORM',discountId:'promo',action:'DELETE',requestId:randomUUID(),baseRevision:revision(row)}),/RETENTION_HOLD/);assert(g.get(P,{discountId:'promo'}));});

test('simultaneous campaign creates cannot claim the same code',async()=>{
 const f=fixture();const results=await Promise.allSettled(['one','two'].map(discountId=>f.call({...f.input,discountId,requestId:randomUUID()})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
test('canonical writer accepts code-less fractional fixed offers and rejects unsupported targeting',async()=>{
 const f=fixture();await f.call({...f.input,values:{...f.data,code:'',type:'fixed',value:0.125}});
 assert.equal(f.get(P,{discountId:'promo'}).value,0.125);
 for(const patch of [{customerSegments:['not-a-segment']},{stackable:true},{targetSegments:['legacy']},{maxDiscountAmount:-1}]){
  const g=fixture();await assert.rejects(g.call({...g.input,values:{...g.data,...patch}}));
 }
});

test('campaign image create/read/edit/removal retains version fences and uses fresh signed URLs',async()=>{
 const f=fixture();let heads=0;
 f.ctx.assets={head:async()=>{heads++;return {ContentType:'image/jpeg',ContentLength:1000};},url:async key=>'https://signed.test/'+key};
 const imageKey='home-slideshow/staff/image.jpg';
 await f.call({...f.input,values:{...f.data,imageKey}});
 let row=f.get(P,{discountId:'promo'});assert.equal(row.imageKey,imageKey);assert.equal(heads,1);assert.equal(row.imageUrl,undefined);
 const read=await route(f.ctx,f.actor,'GET',{source:'PLATFORM',discountId:'promo'});assert.equal(read.campaign.imageKey,imageKey);assert.match(read.campaign.imageUrl,/signed.test/);
 await f.call({source:'PLATFORM',discountId:'promo',action:'UPDATE',requestId:randomUUID(),baseRevision:revision(row),values:{description:'Updated'}});
 row=f.get(P,{discountId:'promo'});assert.equal(row.imageKey,imageKey);assert.equal(heads,1);
 await f.call({source:'PLATFORM',discountId:'promo',action:'UPDATE',requestId:randomUUID(),baseRevision:revision(row),values:{imageKey:''}});
 assert.equal(f.get(P,{discountId:'promo'}).imageKey,'');
});
test('campaign image ownership, malformed paths and invalid metadata reject before writing',async()=>{
 for(const imageKey of ['https://evil.test/a.jpg','../image.jpg','home-slideshow/other/image.jpg',42]){
  const f=fixture();await assert.rejects(f.call({...f.input,values:{...f.data,imageKey}}),/CAMPAIGN_IMAGE/);assert.equal(f.writes.length,0);
 }
 const f=fixture();f.ctx.assets={head:async()=>({ContentType:'text/html',ContentLength:1000})};
 await assert.rejects(f.call({...f.input,values:{...f.data,imageKey:'home-slideshow/staff/image.jpg'}}),/CAMPAIGN_IMAGE/);assert.equal(f.writes.length,0);
});
