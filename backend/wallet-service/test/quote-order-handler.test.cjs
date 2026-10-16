const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/quote-order-handler-fixture.cjs');
test('actual local create-order uses live account guard, server zero fee and atomic consumption',async()=>{
 const f=await setup('REQUIRED',true),r=await f.invoke();assert.equal(r.statusCode,201,JSON.stringify(r.json));assert.equal(r.json.order.pricing.deliveryFee,0);assert.equal(r.json.order.pricing.total,3500000);
 assert.equal(r.json.order.distanceMeters,2100);assert.equal(r.json.order.deliveryQuote.kind,'DELIVERY_FEE_ONLY');assert.equal(f.orders.size,1);assert.equal(f.externalCalls,0);
});
test('handler retry bypasses active-order rejection and returns the saved order without replaying effects',async()=>{
 const f=await setup(),a=await f.invoke();assert.equal(a.statusCode,201,JSON.stringify(a.json));const queries=f.orderQueries;
 f.time+=300000;f.branch.ordersBlocked=true;f.policy.version++;
 const b=await f.invoke();assert.equal(b.statusCode,200,JSON.stringify(b.json));assert.equal(b.json.replayed,true);assert.equal(b.json.orderId,a.json.orderId);assert.equal(f.orderQueries,queries);assert.equal(f.orders.size,1);assert.equal(f.externalCalls,0);
});
test('handler required mode refuses missing/expired quotes, changed address and unknown request data',async()=>{
 const f=await setup();assert.equal((await f.invoke({quoteId:undefined})).statusCode,400);assert.equal((await f.invoke({idempotencyKey:undefined})).statusCode,400);
 const bad=await f.invoke({deliveryAddress:{id:'a1',latitude:32,longitude:44.457}});assert.equal(bad.json.code,'INVALID_QUOTE_ORDER');
 f.time+=120000;const expired=await f.invoke();assert.equal(expired.statusCode,409);assert.equal(expired.json.code,'QUOTE_EXPIRED');assert.equal(f.orders.size,0);
});
test('OFF and invalid configuration refuse quoted requests without falling back to client fee',async()=>{
 const f=await setup('OFF');const r=await f.invoke();assert.equal(r.json.message,'QUOTE_NOT_ENABLED');assert.equal(r.json.code,'QUOTE_NOT_ENABLED');assert.equal(f.orders.size,0);
 f.env.DELIVERY_QUOTE_MODE='MISTYPED';assert.equal((await f.invoke()).statusCode,503);
});
test('required mode enforces staging tables/pool and rejects guests before writing',async()=>{
 const f=await setup();f.env.USER_POOL_ID='other-pool';const wrong=await f.invoke();assert.ok([401,503].includes(wrong.statusCode));assert.equal(f.orders.size,0);
 const g=await setup();const guest=await g.invoke({userId:null});assert.equal(guest.json.code,'CUSTOMER_UNAVAILABLE');assert.equal(g.orders.size,0);
});
test('OFF mode preserves the existing unquoted path and does not consume a quote',async()=>{
 const f=await setup('OFF');const r=await f.invoke({quoteId:undefined});assert.equal(r.statusCode,201,JSON.stringify(r.json));assert.equal(r.json.order.pricing.deliveryFee,999999000);assert.equal(f.orders.size,1);assert.equal([...f.saved.values()][0].consumption,undefined);
});
test('new quoted confirmation still enforces the existing active-order restriction',async()=>{
 const f=await setup();f.orders.set('ORDER#previous|META',{orderId:'previous',userId:'u1',status:'pending',createdAt:'2026-10-15T11:00:00.000Z',storeName:'Synthetic'});
 const r=await f.invoke();assert.equal(r.statusCode,409,JSON.stringify(r.json));assert.equal(f.orderQueries,1);assert.equal(f.orders.size,1);assert.equal([...f.saved.values()][0].consumption,undefined);
});

test('discounted Quote atomically saves catalog fences and usage; replay never increments usage',async()=>{
 const f=await setup();f.discountRow={discountId:'d1',businessId:'b1',status:'active',type:'percentage',value:10,usage_count:0,usage_limit:1};
 const a=await f.invoke({discountId:'d1',discount:350});assert.equal(a.statusCode,201,JSON.stringify(a.json));
 assert.equal(a.json.order.pricing.discount,350000);assert.equal(f.discountRow.usage_count,1);assert.equal(f.discountUpdates,1);
 const tx=f.transactions.at(-1).TransactItems;
 assert.ok(tx.some(a=>a.ConditionCheck?.TableName==='WhizzMerchants_Products'));
 assert.ok(tx.some(a=>a.Update?.TableName==='WhizzMerchants_Discounts'));
 const b=await f.invoke({discountId:'d1',discount:350});assert.equal(b.statusCode,200,JSON.stringify(b.json));assert.equal(f.discountUpdates,1);
});
test('campaign withdrawal during order save aborts order, Quote consumption and usage together',async()=>{
 const f=await setup();f.discountRow={discountId:'d1',businessId:'b1',status:'active',type:'percentage',value:10,usage_count:0,usage_limit:1};
 f.beforeTransaction=()=>{f.discountRow.status='inactive';};
 const a=await f.invoke({discountId:'d1',discount:350});assert.equal(a.statusCode,409,JSON.stringify(a.json));
 assert.equal(f.orders.size,0);assert.equal(f.discountRow.usage_count,0);assert.equal([...f.saved.values()][0].consumption,undefined);
});
test('tampered item price and unavailable catalog cannot create a discounted order',async()=>{
 const f=await setup();f.discountRow={discountId:'d1',businessId:'b1',status:'active',type:'percentage',value:10,usage_count:0};
 const a=await f.invoke({discountId:'d1',items:[{id:'p1',price:1,quantity:1}]});assert.equal(a.statusCode,409,JSON.stringify(a.json));
 f.products.get('p1').isAvailable=false;assert.notEqual((await f.invoke({discountId:'d1',discount:350})).statusCode,201);assert.equal(f.orders.size,0);
});

test('campaign amount changed after customer preview requires explicit revalidation',async()=>{
 const f=await setup();f.discountRow={discountId:'d1',businessId:'b1',status:'active',type:'percentage',value:20,usage_count:0};
 const r=await f.invoke({discountId:'d1',discount:350});assert.equal(r.statusCode,409);assert.equal(r.json.message,'DISCOUNT_PREVIEW_CHANGED');assert.equal(f.orders.size,0);
});
test('commercial preview performs no writes; consent commits immutable snapshot with approved fees',async()=>{
 const f=await setup();f.enableCommercial();
 const before=f.transactions.length,p=await f.invoke({action:'preview_commercial'});
 assert.equal(p.statusCode,200,JSON.stringify(p.json));assert.equal(f.transactions.length,before);assert.equal(f.orders.size,0);
 assert.equal(p.json.commercial.customerTotal.minorAmount,7100000);
 const consent={digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount};
 const r=await f.invoke({commercialConsent:consent});assert.equal(r.statusCode,201,JSON.stringify(r.json));
 assert.equal(r.json.order.pricing.serviceFee,500000);assert.equal([...f.orders.values()][0].financialSnapshot.snapshot.confirmedCustomerTotal.minorAmount,7100000);assert.equal(r.json.order.financialSnapshot,undefined);assert.equal(r.json.order.commercialPricing,undefined);
 assert.equal(r.json.order.merchantId,'org1');
 assert.equal((await f.invoke({commercialConsent:consent})).statusCode,200);
});
test('commercial order requires explicit consent and changes to agreement invalidate approval',async()=>{
 const f=await setup();f.enableCommercial();assert.equal((await f.invoke()).statusCode,409);assert.equal(f.orders.size,0);
 const p=await f.invoke({action:'preview_commercial'});
 const approval=[...f.commercialRecords.values()].find(r=>r.sk==='APPROVAL#1');approval.status='REVOKED';
 const r=await f.invoke({commercialConsent:{digest:p.json.commercial.digest,customerTotalMinor:7100000}});
 assert.equal(r.statusCode,409);assert.equal(f.orders.size,0);
});
test('funding, ledger, usage and order share a transaction; replay after response loss does not reserve twice',async()=>{
 const f=await setup();f.enableCommercial();f.discountRow={discountId:'d1',businessId:'b1',version:1,status:'active',type:'fixedAmount',value:1000,
  usage_count:0,usage_limit:1,fundingPolicyId:'fp1',fundingPolicyVersion:1};
 const patch={discountId:'d1',discount:1000};
 const p=await f.invoke({...patch,action:'preview_commercial'});assert.equal(p.statusCode,200,JSON.stringify(p.json));
 const consent={digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount};
 f.loseResponse=true;
 const r=await f.invoke({...patch,commercialConsent:consent});assert.equal(r.statusCode,200,JSON.stringify(r.json));
 const w=f.extraLookup('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'});
 assert.equal(w.availableBalance,9500);assert.equal(w.lockedBalance,500);assert.equal(f.discountRow.usage_count,1);
 assert.equal([...f.commercialRecords.values()].filter(x=>x.sk==='PROMOTION_FUNDING').length,1);
 const b=await f.invoke({...patch,commercialConsent:consent});assert.equal(b.statusCode,200,JSON.stringify(b.json));assert.equal(w.availableBalance,9500);
});
test('wallet or approval changed between read and commit aborts all funding and order writes',async()=>{
 for(const kind of ['wallet','approval']){
 const f=await setup();f.enableCommercial();f.discountRow={discountId:'d1',businessId:'b1',version:1,status:'active',type:'fixedAmount',value:1000,usage_count:0,fundingPolicyId:'fp1',fundingPolicyVersion:1};
 const patch={discountId:'d1',discount:1000};const p=await f.invoke({...patch,action:'preview_commercial'});
 f.beforeTransaction=()=>{if(kind==='wallet')f.extraLookup('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).version++;
 else [...f.commercialRecords.values()].find(x=>x.sk==='APPROVAL#1').status='REVOKED';};
 const r=await f.invoke({...patch,commercialConsent:{digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount}});
 assert.equal(r.statusCode,409,JSON.stringify(r.json));assert.equal(f.orders.size,0);assert.equal(f.discountRow.usage_count,0);
 assert.equal(f.extraLookup('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).lockedBalance,0);
 assert.equal([...f.commercialRecords.values()].filter(x=>x.sk==='PROMOTION_FUNDING').length,0);
 }
});
