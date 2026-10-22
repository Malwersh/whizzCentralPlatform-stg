const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./helpers/quote-order-handler-fixture.cjs');
const {parseIqd:m}=require('../dist/money'),{readDeliveryFundingPolicy:read}=require('../dist/deliveryFundingPolicy');
const get=(f,pk,sk)=>f.commercialRecords.get('staging-PlatformStaff|'+JSON.stringify({pk,sk}));
async function fixed(){const f=await setup();f.enableDeliveryPromotions('PLATFORM');f.env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';const p=structuredClone(get(f,'DELIVERY_FUNDING#delivery','CURRENT').policy);p.schemaVersion=2;delete p.limits;delete p.onUnavailable;p.customerRule={kind:'FIXED_TARIFF',amount:m('1500')};p.eligibility={regionIds:p.eligibility.regionIds,minimumGoods:m('7000')};p.commission={kind:'PERCENT',basis:'GOODS_GROSS',fixed:null,rate:{numerator:15,denominator:100},rounding:'TOWARD_ZERO',finalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}};for(const sk of ['CURRENT','VERSION#1']){const row=get(f,'DELIVERY_FUNDING#delivery',sk);row.policy=structuredClone(p);row.termsHash=read(p).termsHash;}f.body.items=[{id:'p1',price:3500,quantity:2}];return f;}
function benefit(kind){return {discountId:'benefit',version:1,status:'active',isActive:true,startDate:'2026-01-01T00:00:00.000Z',endDate:'2030-01-01T00:00:00.000Z',benefit:{schemaVersion:1,kind,amountIqd:kind==='FREE_DELIVERIES'?0:500,usesPerCustomer:kind==='GOODS_AMOUNT'?1:3,maximumPerOrderIqd:5000,minimumGoodsIqd:2000,maximumRoadMeters:10000,grantMode:'AUTO',audience:'ALL',branchIds:[],regionIds:[],customerIds:[],allowGoodsStacking:false}};}
for(const kind of ['NONE','GOODS_AMOUNT','FREE_DELIVERIES','DELIVERY_AMOUNT'])test('283 real order handler preserves agreement for '+kind,async()=>{
 const f=await fixed(),patch=kind==='NONE'?{}:{platformDiscountId:'benefit',...(kind==='GOODS_AMOUNT'?{discount:500}:{})};if(kind!=='NONE')f.promoRow=benefit(kind);
 const preview=await f.invoke({...patch,action:'preview_commercial'});assert.equal(preview.statusCode,200,JSON.stringify(preview.json));
 const c=preview.json.commercial;assert.equal(c.schemaVersion,3);assert.equal(c.deliveryAgreement.policyId,'delivery');assert.equal(c.deliveryFee.minorAmount,kind==='FREE_DELIVERIES'?0:kind==='DELIVERY_AMOUNT'?1000000:1500000);assert.equal(c.customerTotal.minorAmount,kind==='NONE'?9000000:kind==='FREE_DELIVERIES'?7500000:8500000);
 assert.equal(f.journey.has('BENEFIT_ORDER#'+require('./helpers/finance-rollout-fixture.cjs').orderId()+'|DELIVERY'),false);
 const consent={digest:c.digest,customerTotalMinor:c.customerTotal.minorAmount},result=await f.invoke({...patch,commercialConsent:consent});assert.equal(result.statusCode,201,JSON.stringify(result.json));
 const saved=[...f.orders.values()][0];assert.equal(saved.commercialPricing.calculation.commission.amount.minorAmount,1050000);assert.equal(saved.commercialPricing.deliveryAgreement.policyId,'delivery');assert.equal(saved.financialSnapshot.deliveryFunding.allocation.schemaVersion,['FREE_DELIVERIES','DELIVERY_AMOUNT'].includes(kind)?3:2);
 const replay=await f.invoke({...patch,commercialConsent:consent});assert.equal(replay.statusCode,200,JSON.stringify(replay.json));assert.equal(f.orders.size,1);
});
for(const origin of ['PLATFORM','MERCHANT','SHARED'])test('283 real handler reserves '+origin+' campaign over contract without changing commission',async()=>{
 const f=await fixed(),p=structuredClone(require('./helpers/delivery-promotion-fixture.cjs').fixture().policy);Object.assign(p,{id:'free-promo',merchantId:'org1',branchId:'b1',origin,effectiveFrom:'2026-10-01T00:00:00.000Z',customerRule:{kind:'FREE'},funding:origin==='SHARED'?{kind:'SHARED_RATIO',merchantNumerator:1,denominator:2,merchantCap:m('5000'),platformCap:m('5000')}:{kind:origin}});p.eligibility.minimumGoods=m('0');Object.assign(p.limits,{merchantPerOrder:m(origin==='PLATFORM'?'0':'5000'),platformPerOrder:m(origin==='MERCHANT'?'0':'5000'),merchantBudget:m(origin==='PLATFORM'?'0':'100000'),platformBudget:m(origin==='MERCHANT'?'0':'100000')});
 const record={...get(f,'DELIVERY_FUNDING#delivery','CURRENT'),id:p.id,policy:p,termsHash:read(p).termsHash};for(const sk of ['CURRENT','VERSION#1'])f.commercialRecords.set('staging-PlatformStaff|'+JSON.stringify({pk:'DELIVERY_FUNDING#'+p.id,sk}),{...record,pk:'DELIVERY_FUNDING#'+p.id,sk});
 const genesis=require('../dist/deliveryCampaignBudget').deliveryCampaignBudgetInitialization(p).Put.Item;f.commercialRecords.set('staging-PlatformStaff|'+JSON.stringify({pk:genesis.pk,sk:genesis.sk}),genesis);f.deliveryIndexes.push({...f.deliveryIndexes[0],sk:'COMMERCIAL#DELIVERY#'+p.id,recordPk:'DELIVERY_FUNDING#'+p.id});
 const preview=await f.invoke({action:'preview_commercial'});assert.equal(preview.statusCode,200,JSON.stringify(preview.json));const c=preview.json.commercial;assert.equal(c.customerTotal.minorAmount,7500000);assert.equal(c.deliveryAgreement.policyId,'delivery');
 const result=await f.invoke({commercialConsent:{digest:c.digest,customerTotalMinor:c.customerTotal.minorAmount}});assert.equal(result.statusCode,201,JSON.stringify(result.json));const order=[...f.orders.values()][0];assert.equal(order.commercialPricing.calculation.commission.amount.minorAmount,1050000);const funding=order.financialSnapshot.deliveryFunding;assert.equal(funding.components[1].allocation.subsidy.minorAmount,1500000);assert.equal(funding.components[1].allocation.merchantShare.minorAmount,origin==='MERCHANT'?1500000:origin==='SHARED'?750000:0);assert.ok(get(f,'DELIVERY_RESERVATION#'+order.orderId+'#PROMOTION','META'));
});

test('283 free agreement refuses an extra entitlement with no real saving and reserves nothing',async()=>{
 const f=await fixed();for(const sk of ['CURRENT','VERSION#1']){const r=get(f,'DELIVERY_FUNDING#delivery',sk);r.policy.customerRule={kind:'FREE'};r.termsHash=read(r.policy).termsHash;}f.promoRow=benefit('FREE_DELIVERIES');
 const result=await f.invoke({platformDiscountId:'benefit',action:'preview_commercial'});assert.equal(result.statusCode,409);assert.match(result.json.message,/BENEFIT_NO_SAVINGS/);assert.equal(f.orders.size,0);assert.ok(![...f.journey.values()].some(r=>r.pk.startsWith('BENEFIT_ORDER#')));
});

// Coordinated integration review: customer consent remains bound to composed pricing.
test('283 explicit deliveryBenefitId keeps agreement, driver tip and a single reservation on retry',async()=>{
 const f=await fixed();f.promoRow=benefit('DELIVERY_AMOUNT');const patch={deliveryBenefitId:'benefit',tip:500};
 const preview=await f.invoke({...patch,action:'preview_commercial'});assert.equal(preview.statusCode,200,JSON.stringify(preview.json));const c=preview.json.commercial;
 assert.equal(c.customerTotal.minorAmount,9000000);assert.equal(c.deliveryFee.minorAmount,1000000);assert.equal(c.driverTip.minorAmount,500000);
 const consent={digest:c.digest,customerTotalMinor:c.customerTotal.minorAmount};assert.equal((await f.invoke({...patch,commercialConsent:consent})).statusCode,201);
 const order=[...f.orders.values()][0];assert.equal(order.pricing.tip,500000);assert.equal(order.commercialPricing.calculation.commission.amount.minorAmount,1050000);assert.equal(order.financialSnapshot.deliveryFunding.allocation.schemaVersion,3);
 const counters=JSON.stringify([...f.journey]);assert.equal((await f.invoke({...patch,commercialConsent:consent})).statusCode,200);assert.equal(JSON.stringify([...f.journey]),counters);assert.equal(f.orders.size,1);
});
for(const changed of ['tip','basket','address'])test('283 composed preview cannot authorize changed '+changed,async()=>{
 const f=await fixed();f.promoRow=benefit('DELIVERY_AMOUNT');const patch={deliveryBenefitId:'benefit'};
 const preview=await f.invoke({...patch,action:'preview_commercial'});assert.equal(preview.statusCode,200);const c=preview.json.commercial;
 const changes=changed==='tip'?{tip:500}:changed==='basket'?{items:[{id:'p1',price:3500,quantity:3}]}:{deliveryAddress:{...f.body.deliveryAddress,latitude:31.926}};
 const r=await f.invoke({...patch,...changes,commercialConsent:{digest:c.digest,customerTotalMinor:c.customerTotal.minorAmount}});
 assert.equal(r.statusCode,409,JSON.stringify(r.json));assert.equal(f.orders.size,0);assert.equal(f.journey.size,0);assert.ok(![...f.commercialRecords.values()].some(x=>x.pk?.startsWith('DELIVERY_RESERVATION#')));
});
test('283 expired agreement invalidates earlier composed consent without reserving either component',async()=>{
 const f=await fixed();f.promoRow=benefit('DELIVERY_AMOUNT');const patch={deliveryBenefitId:'benefit'};const preview=await f.invoke({...patch,action:'preview_commercial'});assert.equal(preview.statusCode,200);const c=preview.json.commercial;
 for(const sk of ['CURRENT','VERSION#1']){const r=get(f,'DELIVERY_FUNDING#delivery',sk);r.policy.effectiveTo='2026-10-10T00:00:00.000Z';r.termsHash=read(r.policy).termsHash;}
 const r=await f.invoke({...patch,commercialConsent:{digest:c.digest,customerTotalMinor:c.customerTotal.minorAmount}});assert.equal(r.statusCode,409,JSON.stringify(r.json));assert.equal(f.orders.size,0);assert.equal(f.journey.size,0);
});
test('283 absent agreement preserves ordinary benefit pricing against the reference tariff',async()=>{
 const f=await fixed();f.promoRow=benefit('DELIVERY_AMOUNT');f.deliveryIndexes=[];
 const r=await f.invoke({deliveryBenefitId:'benefit',action:'preview_commercial'});assert.equal(r.statusCode,200,JSON.stringify(r.json));assert.equal(r.json.commercial.deliveryAgreement,undefined);assert.equal(r.json.commercial.deliveryFee.minorAmount,2500000);assert.equal(r.json.commercial.customerTotal.minorAmount,10000000);assert.equal(f.journey.size,0);
});
for(const change of ['ineligible','exhausted'])test('283 '+change+' benefit cannot commit an earlier composed consent',async()=>{
 const f=await fixed();f.promoRow=benefit('DELIVERY_AMOUNT');const patch={deliveryBenefitId:'benefit'};const preview=await f.invoke({...patch,action:'preview_commercial'});assert.equal(preview.statusCode,200);const c=preview.json.commercial;
 if(change==='ineligible')f.promoRow.benefit.customerIds=['another-customer'];
 else f.journey.set('USER#sub1|BENEFIT#benefit',{pk:'USER#sub1',sk:'BENEFIT#benefit',version:1,grantedUses:3,reservedUses:0,usedUses:3,revoked:false});
 const before=JSON.stringify([...f.journey]),r=await f.invoke({...patch,commercialConsent:{digest:c.digest,customerTotalMinor:c.customerTotal.minorAmount}});
 assert.equal(r.statusCode,409,JSON.stringify(r.json));assert.match(r.json.message,new RegExp(change==='ineligible'?'BENEFIT_NOT_ELIGIBLE':'BENEFIT_EXHAUSTED'));assert.equal(f.orders.size,0);assert.equal(JSON.stringify([...f.journey]),before);
});
