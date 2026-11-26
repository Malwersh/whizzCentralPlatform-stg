const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/dispatch-legacy-source-fixture.cjs');
const {readLegacyOrderAmounts,buildLegacySourcePush,buildLegacySourceMessage}=require('../dist/dispatchLegacySource');
const {buildLegacyOfferRow}=require('../../../lambda/WaveSystem_StartWave/legacy-offer-contract');
const {orderPrice}=require('../dist/merchantSalesReport');
test('proven source pins whole IQD, goods-only reservation and one cash tip across stored offer and both messages',async()=>{
 const f=await setup();await f.run();const o=f.offer(),m=f.sent[0].message,p=buildLegacySourcePush(m);
 assert.equal(o.holdRequiredAmount,10000);assert.equal(o.baseDeliveryFee,3000);assert.equal(o.tipAmount,1500);assert.equal(o.estimatedEarningsAtOffer,4500);assert.equal(o.ttl,undefined);
 assert.equal(m.offer.orderTotal,14500);assert.equal(m.offer.tip,1500);assert.equal(m.offer.moneyUnit,'IQD_WHOLE');assert.equal(m.cycleId,m.offer.dispatchCycleId);assert.equal(m.eventId,o.offerId);
 for(const field of ['orderTotal','tip','deliveryFee','estimatedEarnings','holdRequiredAmount','sentAt','expiresAt'])assert.equal(p[field],m.offer[field]);
 assert.equal(m.offer.items[0].name,'وجبة اختبار');assert.equal(m.offer.items[0].price,10000);assert.equal(m.offer.distanceBasis,'HAVERSINE_BRANCH_TO_CUSTOMER');assert(!JSON.stringify(m).includes('PRIVATE'));assert(!JSON.stringify(m).includes('customerPhone'));
 assert(orderPrice(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'})));f.reserve();const before=structuredClone(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}));await f.respond();assert.equal((await f.respond()).replayed,true);assert.deepEqual(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}),before);
});
test('exact zero delivery is preserved, without changing the old unmarked formatter fallback',async()=>{
 const f=await setup({fee:0,tip:0});await f.run();assert.equal(f.offer().baseDeliveryFee,0);assert.equal(f.sent[0].message.offer.estimatedEarnings,0);
 assert(buildLegacyOfferRow({orderId:'o',dispatchJobId:'j',deliveryFee:0,orderTotal:10000,distanceKm:1},{driverId:'d',distance:1},1,{at:new Date(f.time).toISOString(),ttlSeconds:90}).baseDeliveryFee>0);
});
test('100000 whole IQD is never divided using magnitude and item modifier totals are proven',async()=>{
 const f=await setup({goods:100000,mutate:(f,o)=>{o.items=[{itemId:'item1',name:'وجبة',quantity:2,unitPrice:49000000,modifiers:[{name:'إضافة',price:1000000}]}];}});await f.run();assert.equal(f.sent[0].message.offer.orderTotal,104500);assert.equal(f.sent[0].message.offer.items[0].price,49000);
});
test('unknown units, inconsistent compatibility, other charges, discounts, prepayment and financial markers are rejected before an offer exists',async()=>{
 const changes=[o=>o.createdBy='other',o=>o.total++,o=>o.pricing.total++,o=>o.currency='USD',o=>o.paymentMethod='card',o=>{o.pricing.serviceFee=1000;o.pricing.total+=1000;o.total++;},o=>{o.pricing.discount=1000;o.pricing.total-=1000;o.total--;},o=>{o.pricing.goodsSubtotal++;o.pricing.total++;},o=>o.items[0].unitPrice--];
 for(const change of changes){const f=await setup({mutate:(f,o)=>change(o)});await assert.rejects(f.run(),/LEGACY_SOURCE_REVIEW_REQUIRED/);assert.equal(f.offer(),undefined);assert.equal(f.sent.length,0);}
});
test('financial field presence is rejected by the shared price source',async()=>{const f=await setup();const o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});assert.throws(()=>readLegacyOrderAmounts({...o,financialSnapshot:null}),/LEGACY_SOURCE_REVIEW_REQUIRED/);});
test('missing real pickup, customer point, item details or unsafe images never acquire fabricated defaults',async()=>{
 for(const mutate of [(f,o)=>delete f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).latitude,(f,o)=>delete o.deliveryAddress.lat,(f,o)=>o.items[0].imageUrl='http://unsafe.test/a',(f,o)=>o.items[0].modifiers=null]){const f=await setup({mutate});await assert.rejects(f.run(),/LEGACY_SOURCE_REVIEW_REQUIRED/);assert.equal(f.offer(),undefined);}
});
test('source branch or live location changing at preparation atomically rejects the offer',async()=>{
 for(const target of ['branch','live']){const f=await setup(),send=f.db.send;let changed=false;f.db.send=async c=>{if(!changed&&c.input.TransactItems?.some(x=>x.Put?.TableName==='WaveOffers_staging')){changed=true;if(target==='branch')f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).address='changed';else f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).lat=32;}return send(c);};await assert.rejects(f.run());assert.equal(f.offer(),undefined);assert.equal(f.sent.length,0);}
});
test('lost send ACK resumes the exact stored message, without repricing or extending expiry',async()=>{
 const f=await setup(),send=f.executor;let fail=true;const {createStagingLegacyWaveExecutor}=require('../dist/dispatchLegacy');let prepared=0;
 const e=createStagingLegacyWaveExecutor({db:f.db,now:()=>f.time,selectDrivers:async()=>['driver1'],prepareOffer:async x=>{prepared++;return f.source.prepare(x);},message:f.source.message,sendOffer:async(id,message)=>{f.sent.push({id,message});if(fail){fail=false;throw Error('ACK lost');}}});
 const run=owner=>e.run({orderId:'order1',assignmentId:'dispatch1',owner,leaseSeconds:10});await assert.rejects(run('one'),/ACK lost/);f.time+=10000;await run('two');assert.equal(prepared,1);assert.deepEqual(f.sent[0].message,f.sent[1].message);
});
test('changed order terms or a tampered presentation cannot be resent or accepted',async()=>{
 for(const kind of ['order','presentation','branch']){const f=await setup();await f.run();f.reserve();if(kind==='order')f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).pricing.tip++;else if(kind==='branch')f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).latitude=33;else f.offer().legacyPresentation.customerAddress='tampered';await assert.rejects(f.respond());assert.equal(f.job().status,'searching');}
});
test('oversized presentation fails explicitly; push is only a projection from the stored source message',async()=>{
 const f=await setup();await f.run();const offer=structuredClone(f.offer());offer.legacyPresentation.items=Array.from({length:100},()=>({notes:'x'.repeat(500)}));const {quoteHash}=require('../dist/deliveryQuoteRecord');offer.legacyPresentationDigest=quoteHash(offer.legacyPresentation);assert.throws(()=>buildLegacySourceMessage({job:f.job(),offer}),/LEGACY_SOURCE_REVIEW_REQUIRED/);assert.throws(()=>buildLegacySourcePush({...f.sent[0].message,cycleId:'wrong'}),/LEGACY_SOURCE_REVIEW_REQUIRED/);
});

test('accepted receipt still replays after the retention projection removes presentation and locations',async()=>{const f=await setup();await f.run();f.reserve();await f.respond();const {codEvidence}=require('../../account-deletion/cod-retention');const o=f.offer(),kept=codEvidence(o);f.put('WaveOffers_staging',{orderId:o.orderId,SK:o.SK,...kept});assert.equal(f.offer().legacyPresentation,undefined);assert.equal((await f.respond()).replayed,true);});

test('oversized push and full item bodies are refused before storing an offer',async()=>{for(const mutate of [(f,o)=>{o.deliveryAddress.fullAddress='ع'.repeat(1000);f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).address='ع'.repeat(1000);},(f,o)=>{o.items=Array.from({length:50},(_,i)=>({itemId:'item'+i,name:'وجبة',unitPrice:200000,quantity:1,modifiers:[],notes:'ع'.repeat(500)}));}]){const f=await setup({mutate});await assert.rejects(f.run(),/LEGACY_SOURCE_REVIEW_REQUIRED/);assert.equal(f.offer(),undefined);assert.equal(f.sent.length,0);}});
test('trusted runner wires the existing candidate selector to the authoritative source and message',async()=>{
 const f=await setup(),send=f.db.send,{QueryCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
 for(const driverId of ['driver1','driver2'])Object.assign(f.get('WizzDriverLiveState_staging',{driverId}),{current_work_region_id:'zone1',allowed_region_ids:['zone1'],allowed_region_ids_priority0:['zone1'],metricsSnapshot_totalTrips:0});
 f.db.send=async c=>c instanceof QueryCommand||c instanceof ScanCommand?{Items:[{driverId:'driver2'},{driverId:'driver1'}]}:send(c);
 const {createStagingPinnedLegacyRunner}=require('../dist/dispatchCoordinatorRuntime');
 const e=createStagingPinnedLegacyRunner({db:f.db,now:()=>f.time,sendOffer:async(id,message)=>f.sent.push({id,message})});
 await e.run({orderId:'order1',assignmentId:'dispatch1',owner:'worker',leaseSeconds:10});assert.deepEqual(f.sent.map(x=>x.id),['driver1','driver2']);assert.equal(f.sent[0].message.offer.moneyUnit,'IQD_WHOLE');
});
