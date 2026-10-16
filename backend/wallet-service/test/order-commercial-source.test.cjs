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
test('funding is explicit and cannot be inferred from campaign source or role',async()=>{
 const f=fixture();f.funded();delete f.input.discount.campaign.fundingPolicyId;await reject(f);
 const g=fixture();g.funded();g.change('staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'}).merchantId='other';await reject(g);
});
test('insufficient, suspended, foreign or imprecise platform funding cannot create a reservation',async()=>{
 for(const patch of [{availableBalance:499},{status:'SUSPENDED'},{ownerType:'DRIVER'},{availableBalance:1000.5}]){const f=fixture();f.funded();Object.assign(f.change('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}),patch);await reject(f,'DISCOUNT_FUNDING_UNAVAILABLE');}
 const f=fixture();f.funded();f.input.discount.snapshot.amount=1000001;await reject(f,'FUNDING_WALLET_PRECISION_UNSUPPORTED');
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

test('commercial expiry is bounded by funding policy even when delivery Quote lasts longer',async()=>{
 const f=fixture();f.funded();f.change('staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'}).effectiveTo='2026-10-15T12:01:00.000Z';
 assert.equal((await f.prepare()).expiresAt,'2026-10-15T12:01:00.000Z');
});
