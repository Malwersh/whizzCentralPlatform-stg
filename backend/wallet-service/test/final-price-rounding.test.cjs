const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseIqd:m,formatIqd,quantizeWholeIqd:q,toWholeIqdExact,readWholeIqdRounding}=require('../dist/money');
const pricing=require('../dist/deliveryPricing');
const {calculateOrderCommercialPricing}=require('../dist/orderCommercialPricing');
const {fixture}=require('./helpers/commercial-source-fixture.cjs');
const {input:offerInput}=require('./helpers/driver-offer-fixture.cjs');
const {buildDriverOffer,prepareDriverOfferAcceptance}=require('../dist/driverOffer');
const {quoteHash}=require('../dist/deliveryQuoteRecord');
const policy={incrementIqd:250,mode:'HALF_AWAY_FROM_ZERO'};
const at='2026-10-15T12:00:00.000Z';
const common={id:'rounding',version:1,scope:{type:'GLOBAL',id:'GLOBAL'},priority:1,status:'PUBLISHED',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,rounding:'HALF_AWAY_FROM_ZERO',vehicleType:null,base:m('1000'),minimum:m('1500'),maximum:m('8000'),fallbackPolicyId:null,longDistance:{afterMeters:10000,flat:m('0'),perKm:m('0')},peaks:[]};
const delivery=()=>({...common,id:'delivery',minimum:m('2000'),maximum:m('6000'),perKm:m('500'),tiers:[],coverage:{enabled:true,maxRoadMeters:10000,maxDurationSeconds:1800,supportedZoneIds:['zone']}});
const driver=()=>({...common,id:'driver',pickupPerKm:m('250'),pickupIncludedMeters:1000,deliveryPerKm:m('400'),perMinute:m('0')});
const context={branchId:'b1',merchantId:'org',zoneId:'zone',cityId:'city',governorateId:'gov',vehicleType:'BIKE'};
const leg=distanceMeters=>({id:'route',source:'ADMIN_SIMULATION',quality:'ROAD',fallbackPolicyId:null,distanceMeters,durationSeconds:300,measuredAt:at,expiresAt:'2026-10-15T12:02:00.000Z'});
test('whole-IQD quantization handles exact halves, negative adjustments, truncation and overflow without floating-point money',()=>{
 assert.equal(formatIqd(q(m('2125'),policy)),'2250');assert.equal(formatIqd(q(m('2124.999'),policy)),'2000');assert.equal(formatIqd(q(m('-2125'),policy)),'-2250');assert.equal(formatIqd(q(m('-2125'),{...policy,mode:'TOWARD_ZERO'})),'-2000');
 assert.throws(()=>q(m('2125'),{...policy,mode:'EXACT'}),e=>e.code==='PRECISION_LOSS');
 for(const bad of [null,{incrementIqd:0,mode:'EXACT'},{incrementIqd:0.5,mode:'EXACT'},{...policy,extra:true},{incrementIqd:1,mode:'UNKNOWN'}])assert.throws(()=>readWholeIqdRounding(bad));
 assert.throws(()=>q(m('9007199254740.991'),policy),e=>e.code==='MONEY_OVERFLOW');
});
test('legacy rules preserve fractional results; explicit policy quantizes before a quote/offer can be hashed',()=>{
 const input={schemaVersion:1,at,context,rules:[delivery()],deliveryRoute:leg(3331),discount:null};
 assert.equal(formatIqd(pricing.calculateDeliveryFee(input).customerDeliveryFee),'2665.5');input.rules[0].finalRounding=policy;
 const d=pricing.calculateDeliveryFee(input);assert.equal(toWholeIqdExact(d.customerDeliveryFee),2750);assert.equal(formatIqd(d.components.finalRoundingAdjustment),'84.5');assert.equal(formatIqd(d.components.limitAdjustment),'0');
 const r=driver(),base={schemaVersion:1,at,context,rules:[r],pickupRoute:leg(700),deliveryRoute:leg(3331)};
 assert.equal(formatIqd(pricing.calculateDriverEarning(base).driverEarning),'2332.4');r.finalRounding=policy;assert.equal(toWholeIqdExact(pricing.calculateDriverEarning(base).driverEarning),2250);
});
test('central rules reject invalid or unaligned final rounding; aligned delivery discounts preserve their exact funding',()=>{
 for(const change of [r=>r.finalRounding=null,r=>r.finalRounding={incrementIqd:0,mode:'EXACT'},r=>{r.finalRounding=policy;r.minimum=m('2001');}]){const r=delivery();change(r);assert.throws(()=>pricing.validatePricingRules({deliveryRules:[r],driverRules:[]}));}
 const r={...delivery(),finalRounding:policy},input={schemaVersion:1,at,context,rules:[r],deliveryRoute:leg(3331),discount:{id:'d',fundingParty:'PLATFORM',amount:m('500')}};
 const result=pricing.calculateDeliveryFee(input);assert.equal(formatIqd(result.customerDeliveryFee),'2250');assert.equal(formatIqd(result.discountFundingAmount),'500');
 input.discount.amount=m('100');assert.throws(()=>pricing.calculateDeliveryFee(input),e=>e.code==='INVALID_PRICING');
});
test('per-merchant agreement rounds commission before commercial digest/snapshot; old agreement stays unchanged',async()=>{
 const f=fixture();f.change('WhizzMerchants_Products',{productId:'p1'}).price=3499;
 const record=f.change('staging-MerchantPlatform',{pk:'COMMERCIAL_AGREEMENT#a1',sk:'VERSION#1'});
 record.terms.commission={kind:'PERCENT',basis:'AFTER_MERCHANT_DISCOUNT',fixed:null,rate:{numerator:10,denominator:100},rounding:'HALF_AWAY_FROM_ZERO'};
 const input={schemaVersion:1,at,branchId:'b1',merchantId:'org',goodsGross:m('3499'),agreement:record.terms,goodsDiscounts:[],paymentMethod:'COD',customerDeliveryFee:m('2000'),driverTip:m('0'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')};
 const old=calculateOrderCommercialPricing(input);assert.equal(formatIqd(old.commission.amount),'349.9');
 record.terms.commission.finalRounding={incrementIqd:1,mode:'HALF_AWAY_FROM_ZERO'};const next=calculateOrderCommercialPricing(input);assert.equal(formatIqd(next.commission.amount),'350');assert.equal(toWholeIqdExact(next.merchantPayableOnSuccessfulDelivery),3149);assert.notEqual(next.digest,old.digest);assert.equal(formatIqd(old.commission.amount),'349.9');
 record.termsHash=quoteHash({terms:record.terms,otherCharges:record.otherCharges,allowedFundingPolicyIds:record.allowedFundingPolicyIds});
 for(const [table,sk]of [['staging-MerchantPlatform','CURRENT'],['staging-MerchantPlatform','ACCEPTANCE#1'],['staging-PlatformStaff','APPROVAL#1']])f.change(table,{pk:'COMMERCIAL_AGREEMENT#a1',sk}).termsHash=record.termsHash;
 const sourcePlan=await f.prepare();assert.equal(toWholeIqdExact(sourcePlan.calculation.merchantPayableOnSuccessfulDelivery),3149);
 assert(sourcePlan.operations.some(op=>op.ConditionCheck?.ExpressionAttributeValues&&Object.values(op.ConditionCheck.ExpressionAttributeValues).some(v=>v?.commission?.finalRounding?.incrementIqd===1)));
});
test('schema-2 funding rounds merchant share toward zero in whole IQD and assigns the exact remainder to the platform',async()=>{
 const f=fixture();f.funded();const p=f.change('staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'});p.schemaVersion=2;p.merchantNumerator=1;p.denominator=3;p.merchantShareFinalRounding={incrementIqd:1,mode:'TOWARD_ZERO'};
 const result=await f.prepare();assert.equal(formatIqd(result.calculation.goodsDiscounts[0].merchantShare),'333');assert.equal(formatIqd(result.calculation.goodsDiscounts[0].platformShare),'667');assert.equal(result.funding.amount.minorAmount,667000);
 p.merchantShareFinalRounding.mode='HALF_AWAY_FROM_ZERO';await assert.rejects(f.prepare());
});
test('an accepted driver offer retains its quantized wage after a later centrally configured increment changes',()=>{
 const i=offerInput('1000');Object.assign(i.policy.rules[0],{deliveryPerKm:m('400'),finalRounding:policy});i.deliveryRoute.route.distanceMeters=3331;
 const offer=buildDriverOffer(i),amount=offer.calculation.driverEarning.minorAmount;
 const acceptance={offer,offerId:offer.offerId,driverId:offer.driverId,subjectId:offer.driverSubjectId,assignmentId:offer.assignmentId,assignmentVersion:offer.assignmentVersion,order:structuredClone(offer.source.order),at:'2026-10-15T12:00:30.000Z',policy:{version:2,enabledRuleVersions:[{id:offer.calculation.rule.id,version:offer.calculation.rule.version,hash:offer.ruleHash}]}};
 const saved=prepareDriverOfferAcceptance(acceptance);i.policy.rules[0].finalRounding={incrementIqd:500,mode:'HALF_AWAY_FROM_ZERO'};
 assert.equal(saved.acceptedTerms.driverEarning.minorAmount,amount);assert.equal(saved.acceptedTerms.driverEarning.minorAmount%250000,0);assert.deepEqual(prepareDriverOfferAcceptance(acceptance).acceptedTerms,saved.acceptedTerms);
});
