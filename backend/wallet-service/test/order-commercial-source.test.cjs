const {test}=require('node:test'),assert=require('node:assert/strict');
const at='2026-10-15T12:00:00.000Z';
const {fixture}=require('./helpers/commercial-source-fixture.cjs');
const reject=(f,code)=>assert.rejects(f.prepare(),e=>!code||e.code===code);
test('strong agreement selection requires explicit branch pointer and distinct acceptance/approval sources',async()=>{
 const f=fixture(),r=await f.prepare();assert.equal(r.calculation.customerTotal.minorAmount,5000000);
 assert.equal(r.financialSnapshot.snapshot.merchantId,'org');assert.equal(r.financialSnapshot.snapshot.zoneId,'zone');assert.equal(r.funding.holdId,null);
 assert.ok(r.operations.some(x=>x.ConditionCheck?.TableName==='staging-PlatformStaff'));assert.ok(f.calls.every(x=>x.input.ConsistentRead));
 assert.ok(!r.operations.some(x=>x.Update||x.Put));
});
test('platform contribution reserves existing funds and records hold, two ledger entries and audit atomically',async()=>{
 const f=fixture();f.funded();const r=await f.prepare();assert.equal(r.funding.amount.minorAmount,500000);
 assert.equal(r.calculation.allocationInput.merchantGoodsDiscount.minorAmount,500000);
 const update=r.operations.find(x=>x.Update).Update;assert.equal(update.ExpressionAttributeValues[':available'],9500);
 assert.equal(update.ExpressionAttributeValues[':locked'],500);
 assert.equal(r.operations.filter(x=>x.Put?.TableName==='staging-LedgerEntries').length,2);
 assert.ok(r.operations.some(x=>x.Put?.Item.sk==='PROMOTION_FUNDING'));assert.ok(r.operations.some(x=>x.Put?.TableName==='staging-AuditLog'));
 assert.equal(f.change('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).availableBalance,10000); // plan has no side effects
});
test('customer consent digest is stable across preview/confirmation but changes with commercial prices',async()=>{
 const f=fixture(),a=await f.prepare(),b=await f.prepare();assert.equal(a.digest,b.digest);
 f.change('WhizzMerchants_Products',{productId:'p1'}).price=3600;assert.notEqual((await f.prepare()).digest,a.digest);
});
test('missing pointer, original agreement, acceptance or independent approval never become implicit zero commission',async()=>{
 for(const sk of ['VERSION#1','ACCEPTANCE#1','APPROVAL#1','CURRENT']){const f=fixture();f.records.delete((sk.startsWith('APPROVAL')?'staging-PlatformStaff':'staging-MerchantPlatform')+'|'+JSON.stringify({pk:'COMMERCIAL_AGREEMENT#a1',sk}));await reject(f);}
 const f=fixture();delete f.change('WhizzMerchants_Businesses',{businessId:'b1'}).commercialAgreementId;await reject(f);
});
test('wrong owner acceptance, stale approval and withdrawn current version fail closed',async()=>{
 for(const [table,sk,field,value] of [['staging-MerchantPlatform','ACCEPTANCE#1','subjectId','other'],['staging-PlatformStaff','APPROVAL#1','termsHash','bad'],['staging-MerchantPlatform','CURRENT','status','WITHDRAWN']]){
 const f=fixture();f.change(table,{pk:'COMMERCIAL_AGREEMENT#a1',sk})[field]=value;await reject(f);}
});
test('source funding is automatic without a sharing contract, and foreign sharing cannot be used',async()=>{
 const f=fixture();f.funded();f.records.delete('staging-MerchantPlatform|'+JSON.stringify({pk:'BRANCH#b1',sk:'COMMERCIAL_SHARING#MERCHANT#d1'}));delete f.input.discount.campaign.fundingPolicyId;
 const r=await f.prepare();assert.equal(r.funding.amount.minorAmount,0);assert.equal(r.calculation.allocationInput.merchantGoodsDiscount.minorAmount,1000000);
 f.input.discount.snapshot.source='PLATFORM';const p=await f.prepare();assert.equal(p.funding.amount.minorAmount,1000000);assert.equal(p.calculation.allocationInput.merchantGoodsDiscount.minorAmount,0);
 const g=fixture();g.funded();g.change('staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'}).merchantId='other';await reject(g);
});
test('insufficient, suspended, foreign or imprecise platform funding cannot create a reservation',async()=>{
 for(const patch of [{availableBalance:499},{status:'SUSPENDED'},{ownerType:'DRIVER'},{availableBalance:1000.5}]){const f=fixture();f.funded();Object.assign(f.change('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}),patch);await reject(f,'DISCOUNT_FUNDING_UNAVAILABLE');}
 const f=fixture();f.funded();f.input.discount.snapshot.amount=1000001;await assert.rejects(f.prepare());
});
test('delivery discounts and unknown agreements cannot enter goods allocation',async()=>{
 const f=fixture();f.funded();f.input.discount.snapshot.target='DELIVERY';await reject(f,'COMMERCIAL_DISCOUNT_UNSUPPORTED');
 const g=fixture();g.change('staging-MerchantPlatform',{pk:'COMMERCIAL_AGREEMENT#a1',sk:'VERSION#1'}).extra=true;await reject(g);
});
test('expired Quote and wrong region source cannot produce a financial snapshot',async()=>{
 const f=fixture();f.input.quote.expiresAt=at;await reject(f,'COMMERCIAL_QUOTE_EXPIRED');
 const g=fixture();g.change('WizzCentral_Regions',{regionId:'zone'}).is_active=false;await reject(g);
});
module.exports={fixture};

test('commercial expiry follows campaign duration, and a changed campaign reverts to source-funded default',async()=>{
 const f=fixture();f.funded();f.input.discount.campaign.valid_to='2026-10-15T12:01:00.000Z';
 const r=await f.prepare();assert.equal(r.expiresAt,'2026-10-15T12:01:00.000Z');assert.equal(r.funding.amount.minorAmount,0);
 const g=fixture();g.funded();g.input.discount.snapshot.version=2;g.input.discount.campaign.version=2;assert.equal((await g.prepare()).funding.amount.minorAmount,0);
});
test('sharing consent is independent from agreement funding lists, but pins owner, scope and exact policy digest',async()=>{
 const {quoteHash}=require('../dist/deliveryQuoteRecord');const f=fixture();f.funded();
 const key={pk:'COMMERCIAL_AGREEMENT#a1',sk:'VERSION#1'},record=f.change('staging-MerchantPlatform',key);record.schemaVersion=2;record.allowedFundingPolicyIds=[];record.fundingPolicySnapshots=[];
 record.termsHash=quoteHash({terms:record.terms,otherCharges:record.otherCharges,allowedFundingPolicyIds:[],fundingPolicySnapshots:[]});
 for(const [table,sk]of [['staging-MerchantPlatform','CURRENT'],['staging-MerchantPlatform','ACCEPTANCE#1'],['staging-PlatformStaff','APPROVAL#1']])f.change(table,{pk:key.pk,sk}).termsHash=record.termsHash;
 assert.equal((await f.prepare()).funding.amount.minorAmount,500000);const p=f.change('staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'});p.merchantNumerator=0;await reject(f);p.merchantNumerator=1;p.acceptedBy='other';f.bind();await reject(f);
});

test('manager-signed sharing uses the actual signer and pins active branch membership',async()=>{const f=fixture();f.funded();const policy=f.change('staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'});policy.acceptedBy='manager';f.put('staging-MerchantPlatform',{pk:'BRANCH#b1',sk:'MEMBER#manager'},{ownerId:'owner',subjectId:'manager',businessId:'b1',role:'MANAGER',status:'ACTIVE',version:1});f.bind();const r=await f.prepare();assert.ok(r.operations.some(x=>x.ConditionCheck?.Key?.sk==='MEMBER#manager'));});
test('foreign or revoked manager signature cannot authorize sharing funding',async()=>{for(const change of [{ownerId:'other'},{status:'REVOKED'},{role:'RECEPTION'}]){const f=fixture();f.funded();f.change('staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'}).acceptedBy='manager';f.put('staging-MerchantPlatform',{pk:'BRANCH#b1',sk:'MEMBER#manager'},{ownerId:'owner',subjectId:'manager',businessId:'b1',role:'MANAGER',status:'ACTIVE',version:1,...change});f.bind();await assert.rejects(f.prepare(),/DISCOUNT_FUNDING_UNAUTHORIZED/);}});

test('branch minimum uses catalog gross before discounts, with no platform fallback',async()=>{
 for(const minimum of [undefined,null,0,3500]){const f=fixture();if(minimum!==undefined)f.change('WhizzMerchants_Businesses',{businessId:'b1'}).minimum_order=minimum;await f.prepare();}
 const f=fixture();f.change('WhizzMerchants_Businesses',{businessId:'b1'}).minimum_order=3501;await reject(f,'MINIMUM_ORDER_NOT_MET');
 const g=fixture();g.funded();g.change('WhizzMerchants_Businesses',{businessId:'b1'}).minimum_order=3500;await g.prepare();
});
test('confirmation fences minimum presence and value against concurrent restaurant edits',async()=>{
 for(const value of [undefined,3500]){const f=fixture();if(value!==undefined)f.change('WhizzMerchants_Businesses',{businessId:'b1'}).minimum_order=value;
 const condition=(await f.prepare()).branchCondition.ConditionCheck;const name=Object.keys(condition.ExpressionAttributeNames).find(k=>condition.ExpressionAttributeNames[k]==='minimum_order');assert.ok(name);
 if(value===undefined)assert.ok(condition.ConditionExpression.includes('attribute_not_exists('+name+')'));
 else assert.ok(Object.values(condition.ExpressionAttributeValues).includes(value));
 }
});

test('dated delivery agreement overrides minimum and commission and preserves tip without campaign allowance',async()=>{
 const {createStagingCommercialSource:create}=require('../dist/orderCommercialSource'),{parseIqd:m}=require('../dist/money');
 for(const percent of [5,15]){const f=fixture('org','owner',opts=>create({...opts,deliveryPromotion:{prepare:async facts=>({applied:true,agreement:true,minimumOrderAmountIqd:3000,commission:{kind:'PERCENT',basis:'GOODS_GROSS',fixed:null,rate:{numerator:percent,denominator:100},rounding:'TOWARD_ZERO',finalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}},customerFee:m('1500'),validUntil:'2026-10-15T13:00:00.000Z',deliveryFunding:{policyPin:{policyId:'contract',version:1,termsHash:'a'.repeat(64)},allocation:{schemaVersion:2,referenceFee:m('1000'),customerFee:m('1500'),subsidy:m('0'),merchantShare:m('0'),platformShare:m('0')}},operations:[]})}}));
 f.change('WhizzMerchants_Businesses',{businessId:'b1'}).minimum_order=4000;f.input.tip=m('1000');const r=await f.prepare();assert.equal(r.calculation.commission.amount.minorAmount,3500*percent/100*1000);assert.equal(r.calculation.allocationInput.driverTip.minorAmount,1000000);assert.equal(r.calculation.allocationInput.customerDeliveryFee.minorAmount,1500000);assert.equal(r.financialSnapshot.schemaVersion,2);
 }
});
