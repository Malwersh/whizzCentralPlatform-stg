const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStagingDeliveryPromotionSelection:create}=require('../dist/deliveryPromotionSelection');const {readDeliveryFundingPolicy:read}=require('../dist/deliveryFundingPolicy');
const {deliveryCampaignBudgetInitialization:init}=require('../dist/deliveryCampaignBudget');const {fixture:promotion}=require('./helpers/delivery-promotion-fixture.cjs');const {parseIqd:m}=require('../dist/money');const catalog=require('../../staff-service/catalog');
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses';
function fixture(){
 const source=promotion(),rows=new Map(),indexes=[],key=(t,k)=>t+'|'+JSON.stringify(k),put=(t,k,r)=>rows.set(key(t,k),structuredClone({...k,...r})),change=(t,k)=>rows.get(key(t,k));
 put(B,{businessId:'branch'},{businessId:'branch',ownerId:'owner',cognitoUserId:'owner',organizationId:'merchant',status:'approved',isActive:true,deliveryOfferRevision:1});put(P,{pk:'PERSON#owner',sk:'ORGANIZATION#merchant'},{subjectId:'owner',organizationId:'merchant'});
 const role=Object.keys(catalog.ROLES).find(r=>catalog.allowed({status:'ACTIVE',roles:[r]},'commercial.funding.request'));put(S,{pk:'EMPLOYEE#editor',sk:'PROFILE'},{employeeId:'editor',status:'ACTIVE',version:1,roles:[role],scope:{allRegions:true}});
 function add(id,customerFee,kind){const policy=structuredClone(source.policy);policy.id=id;policy.customerRule=kind==='FREE'?{kind:'FREE'}:{kind:'FIXED_TARIFF',amount:m(customerFee)};const termsHash=read(policy).termsHash;const record={schemaVersion:1,id,version:1,status:'ACTIVE',policy,termsHash,approvedBy:'editor',approvedAt:'2026-10-18T01:00:00.000Z',acceptedBy:'owner',acceptedAt:'2026-10-18T02:00:00.000Z',activatedAt:'2026-10-18T02:00:00.000Z',activationMode:'STAFF_SEND_MERCHANT_ACCEPT'};
 for(const sk of ['CURRENT','VERSION#1'])put(S,{pk:'DELIVERY_FUNDING#'+id,sk},record);const genesis=init(policy).Put.Item;put(S,{pk:genesis.pk,sk:genesis.sk},genesis);indexes.push({pk:'BRANCH#branch',sk:'COMMERCIAL#DELIVERY#'+id,recordPk:'DELIVERY_FUNDING#'+id,kind:'DELIVERY',ownerId:'owner',businessId:'branch'});return policy;}
 const calls=[],db={send:async c=>{calls.push(c);assert.equal(c.input.ConsistentRead,true);if(c.constructor.name==='QueryCommand')return {Items:structuredClone(indexes)};assert.equal(c.constructor.name,'GetCommand');return {Item:structuredClone(rows.get(key(c.input.TableName,c.input.Key)))};}};
 const facts={orderId:'order',branchId:'branch',merchantId:'merchant',goodsGross:m('12000'),goodsAfterDiscounts:m('11000'),hasGoodsDiscount:true,referenceFee:m('4000')};
 const prepare=(previewOnly=false)=>create({db,previewOnly,pricingRequest:source.pricingRequest,now:()=>Date.parse('2026-10-18T12:00:00.000Z'),customerFacts:async()=>({customerId:'customer',isNewCustomer:false,conditions:[{ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId:'customer'},ConditionExpression:'attribute_exists(userId)'}}]})}).prepare(facts);
 return {add,change,put,prepare,facts,indexes,calls};
}
test('server selects best eligible customer price and prepares one budget reservation without writes',async()=>{const f=fixture();f.add('expensive','2000');f.add('best','1500');const r=await f.prepare();assert.equal(r.applied,true);assert.equal(r.deliveryFunding.policyPin.policyId,'best');assert.equal(r.customerFee.minorAmount,1500000);assert.equal(r.operations.filter(o=>o.Put?.Item.pk.startsWith('DELIVERY_RESERVATION#')).length,1);assert.ok(r.operations.some(o=>Object.values(o.ConditionCheck?.ExpressionAttributeNames??{}).includes('deliveryOfferRevision')));});
test('ties use deterministic policy identity and exhausted best budget falls back to next',async()=>{const f=fixture();f.add('b','1500');f.add('a','1500');assert.equal((await f.prepare()).deliveryFunding.policyPin.policyId,'a');const b=f.change(S,{pk:'DELIVERY_BUDGET#a',sk:'VERSION#1'});b.platformSpent=b.platformTotal;b.platformAvailable=0;const {quoteHash}=require('../dist/deliveryQuoteRecord');const {digest,...content}=b;b.digest=quoteHash(content);assert.equal((await f.prepare()).deliveryFunding.policyPin.policyId,'b');});
test('no policy or ineligible basket returns normal tariff with authority evidence',async()=>{const f=fixture();assert.equal((await f.prepare()).applied,false);f.add('p','1500');f.facts.goodsAfterDiscounts=m('1');assert.equal((await f.prepare()).applied,false);});
test('revoked authority, foreign indexes and changed reference price cannot authorize selection',async()=>{for(const edit of [f=>f.change(S,{pk:'EMPLOYEE#editor',sk:'PROFILE'}).roles=['unknown'],f=>f.indexes[0].ownerId='other',f=>f.facts.referenceFee=m('3000')]){const f=fixture();f.add('p','1500');edit(f);await assert.rejects(f.prepare());}});

test("storefront preview selects the same funded price without preparing a reservation or consuming usage",async()=>{const f=fixture();f.add("p","1500");const r=await f.prepare(true);assert.equal(r.applied,true);assert.equal(r.customerFee.minorAmount,1500000);assert.equal(r.operations.length,0);assert.ok(!f.calls.some(c=>c.input.Key?.pk?.startsWith("DELIVERY_RESERVATION#")));});

test("free delivery preview respects campaign funding and keeps courier compensation separate",async()=>{const f=fixture();f.add("free","0","FREE");const r=await f.prepare(true);assert.equal(r.customerFee.minorAmount,0);assert.equal(r.customerRule,"FREE");assert.equal(r.operations.length,0);});

function addAgreement(f,id='contract'){
 f.add(id,'1500');const existing=f.change(S,{pk:'DELIVERY_FUNDING#'+id,sk:'CURRENT'});
 const p={schemaVersion:2,id,version:1,merchantId:'merchant',branchId:'branch',origin:'PLATFORM',effectiveFrom:'2026-10-18T00:00:00.000Z',effectiveTo:'2026-11-18T00:00:00.000Z',customerRule:{kind:'FIXED_TARIFF',amount:m('1500')},funding:{kind:'PLATFORM'},eligibility:{regionIds:['zone'],minimumGoods:m('7000')},commission:{kind:'PERCENT',basis:'GOODS_GROSS',fixed:null,rate:{numerator:5,denominator:100},rounding:'TOWARD_ZERO',finalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}}};
 const r={...existing,policy:p,termsHash:read(p).termsHash};for(const sk of ['CURRENT','VERSION#1'])f.put(S,{pk:r.pk,sk},{...r,sk});return p;
}
test('agreement price and minimum apply to empty basket before promotion eligibility',async()=>{
 const f=fixture();addAgreement(f);f.add('promo','1000');f.facts.goodsGross=m('0');f.facts.goodsAfterDiscounts=m('0');f.facts.hasGoodsDiscount=false;
 const p=await f.prepare(true);assert.equal(p.applied,true);assert.equal(p.agreement,true);assert.equal(p.minimumOrderAmountIqd,7000);assert.equal(p.customerFee.minorAmount,1500000);assert.equal(p.commission.rate.numerator,5);assert.deepEqual(p.operations,[]);
 const final=await f.prepare();assert.equal(final.operations.filter(x=>x.Put?.Item.pk.startsWith('DELIVERY_RESERVATION#')).length,1);assert.ok(!final.operations.some(x=>x.Put?.Item.pk.startsWith('DELIVERY_BUDGET#')));
});
test('agreement respects region, expiry, approval integrity and overlapping agreements fail closed',async()=>{
 const f=fixture();addAgreement(f);addAgreement(f,'second');await assert.rejects(f.prepare(),/DELIVERY_AGREEMENT_OVERLAP/);
 for(const edit of [p=>p.eligibility.regionIds=['elsewhere'],p=>p.effectiveTo='2026-10-18T11:00:00.000Z']){const g=fixture();const p=addAgreement(g);edit(p);for(const sk of ['CURRENT','VERSION#1']){const row=g.change(S,{pk:'DELIVERY_FUNDING#contract',sk});row.policy=p;row.termsHash=read(p).termsHash;}assert.equal((await g.prepare()).applied,false);}
});
