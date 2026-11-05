const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/delivery-quote-fixture.cjs');
const {createStagingStorefrontPreview,createStagingStorefrontRoute}=require('../dist/storefrontPreview');
const {createStagingDeliveryRouting}=require('../dist/regionCoverage');
function setup(){const f=fixture(),send=f.db.send;f.db.send=async c=>{if(c.input.TableName==='staging-MerchantPlatform'&&c.constructor.name==='QueryCommand')return {Items:[]};if(c.input.TableName==='staging-WizzOfferJourney')return {};return send(c);};f.branch.orderReceptionSettings={schemaVersion:1,defaultPreparationMinutes:15};let rate=0;const createRouter=db=>createStagingDeliveryRouting({db,getAccessToken:async()=>'test',profile:'driving',ttlSeconds:120,timeoutMs:1000,now:()=>f.time,fetchImpl:async()=>new Response(JSON.stringify({code:'Ok',routes:[{distance:2100,duration:300}]}))});f.route=(patch={})=>createStagingStorefrontRoute({db:f.db,authenticateCustomer:f.auth,now:()=>f.time,createRouter,beforeCalculate:async()=>{rate++;}}).preview({branchId:'b1',addressId:'a1',...patch});f.preview=(patch={})=>createStagingStorefrontPreview({db:f.db,authenticateCustomer:f.auth,now:()=>f.time,createRouter,beforeCalculate:async()=>{rate++;}}).preview({branchId:'b1',addressId:'a1',items:[],hasGoodsDiscount:false,...patch});f.rate=()=>rate;return f;}
test('preview uses saved road and branch preparation, not driver positions, and creates no financial records',async()=>{const f=setup(),r=await f.preview();assert.equal(r.customerDeliveryFee.minorAmount,3100000);assert.equal(r.preparationMinutes,15);assert.equal(r.roadDistanceMeters,2100);assert.deepEqual(r.arrivalMinutes,{minimum:20,maximum:25});assert.equal(f.transactions.length,0);assert.equal(f.saved.size,0);assert.equal(f.rate(),1);assert(!JSON.stringify(r).includes('owner1'));assert(!f.calls.some(c=>c.TableName.includes('Driver')));});
test('missing preparation is unknown, never an invented ETA',async()=>{const f=setup();delete f.branch.orderReceptionSettings;const r=await f.preview();assert.equal(r.preparationMinutes,null);assert.equal(r.arrivalMinutes,null);});
test('body cannot choose prices, location or preparation and foreign saved addresses fail',async()=>{const f=setup();await assert.rejects(f.preview({preparationMinutes:1}),/INVALID_STOREFRONT_REQUEST/);assert.equal(f.rate(),0);f.address.userId='other';await assert.rejects(f.preview(),/ADDRESS_UNAVAILABLE/);assert.equal(f.saved.size,0);});
test('configured minimum is returned for browsing without rejecting an empty basket; unset remains null',async()=>{
 const f=setup();assert.equal((await f.preview()).minimumOrderAmountIqd,null);
 f.branch.minimum_order=1500;const r=await f.preview();assert.equal(r.minimumOrderAmountIqd,1500);assert.equal(r.minimumOrderMet,false);assert.equal(r.remainingToMinimumIqd,1500);assert.equal(f.saved.size,0);
 f.branch.minimum_order=0;assert.equal((await f.preview()).minimumOrderAmountIqd,null);
});

test('route facts remain available without a financial policy and never imply a delivery fee',async()=>{
 const f=setup();f.policy=undefined;const r=await f.route();
 assert.equal(r.kind,'STOREFRONT_ROUTE');assert.equal(r.pricingAvailable,false);
 assert.equal(r.roadDistanceMeters,2100);assert.deepEqual(r.arrivalMinutes,{minimum:20,maximum:25});
 assert(!Object.hasOwn(r,'customerDeliveryFee'));assert(!Object.hasOwn(r,'quoteId'));
 assert(!f.calls.some(c=>c.TableName==='staging-PlatformStaff'));
 assert.equal(f.transactions.length,0);assert.equal(f.saved.size,0);
});
test('route facts require owned addresses, active branches, complete input and valid coverage',async()=>{
 const f=setup();await assert.rejects(f.route({latitude:31}),/INVALID_STOREFRONT_REQUEST/);
 f.address.userId='other';await assert.rejects(f.route(),/ADDRESS_UNAVAILABLE/);
 f.address.userId='u1';f.branch.isActive=false;await assert.rejects(f.route(),/BRANCH_UNAVAILABLE/);
 assert.equal(f.transactions.length,0);
});
test('generic base pricing applies to another branch without a branch-specific rule',async()=>{
 const f=setup();f.branch.businessId='b2';f.branch.branchId='b2';
 const r=await f.preview({branchId:'b2'});
 assert.equal(r.branchId,'b2');assert.equal(r.customerDeliveryFee.minorAmount,3100000);
});
