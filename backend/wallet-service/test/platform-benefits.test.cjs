const {test}=require('node:test'),assert=require('node:assert/strict');
const {readPlatformBenefit,preparePlatformBenefit,platformBenefitBalance,settlePlatformBenefit,platformBenefitEligibility,BENEFIT_TABLE}=require('../dist/platformBenefits');
const base=()=>({schemaVersion:1,kind:'FREE_DELIVERIES',amountIqd:0,usesPerCustomer:3,maximumPerOrderIqd:5000,minimumGoodsIqd:2000,maximumRoadMeters:10000,grantMode:'AUTO',audience:'ALL',branchIds:[],regionIds:['region'],customerIds:[],allowGoodsStacking:false});
const campaign=(benefit=base())=>({discountId:'benefit',version:1,status:'active',isActive:true,startDate:'2026-01-01T00:00:00.000Z',endDate:'2030-01-01T00:00:00.000Z',benefit});
const facts=(branchId='branch-a')=>({sub:'customer',branchId,regionIds:['region'],goodsMinor:10000000,roadMeters:2000,firstOrder:false,newCustomer:false,vip:false,inactive:false});
function memory(c=campaign()){
 const rows=new Map(),key=x=>(x.pk??x.PK)+'|'+(x.sk??x.SK);
 const db={async send(command){return {Item:structuredClone(rows.get(key(command.input.Key)))};}};
 const apply=operations=>{for(const o of operations){const p=o.Put;if(!p)continue;const before=rows.get(key(p.Item));if(p.ConditionExpression==='attribute_not_exists(pk)')assert.equal(before,undefined,'conditional conflict');else assert.equal(before?.version,p.ExpressionAttributeValues[':v'],'conditional conflict');}for(const o of operations)if(o.Put)rows.set(key(o.Put.Item),structuredClone(o.Put.Item));};
 return {db,apply,rows};
}
test('free deliveries share one counter across branches and preview never reserves',async()=>{
 const c=campaign(),m=memory(c);
 const preview=await preparePlatformBenefit(m.db,{campaign:c,facts:facts(),referenceDeliveryMinor:1500000,preview:true});assert.equal(preview.operations.length,0);assert.equal(preview.customerFee.minorAmount,0);
 for(let i=0;i<3;i++)m.apply((await preparePlatformBenefit(m.db,{campaign:c,facts:facts('branch-'+i),referenceDeliveryMinor:1500000,orderId:'order-'+i})).operations);
 assert.equal((await platformBenefitBalance(m.db,c,'customer')).remaining,0);await assert.rejects(preparePlatformBenefit(m.db,{campaign:c,facts:facts('branch-z'),referenceDeliveryMinor:1500000,orderId:'order-4'}),/EXHAUSTED/);
});
test('pending cancellation restores use; accepted cancellation keeps use',async()=>{
 for(const keepUse of [false,true]){const c=campaign(),m=memory(c);m.apply((await preparePlatformBenefit(m.db,{campaign:c,facts:facts(),referenceDeliveryMinor:1500000,orderId:'order'})).operations);m.apply((await settlePlatformBenefit(m.db,{orderId:'order',target:'DELIVERY',outcome:'RELEASED',keepUse})).operations);const balance=await platformBenefitBalance(m.db,c,'customer');assert.equal(balance.remaining,keepUse?2:3);assert.equal((await settlePlatformBenefit(m.db,{orderId:'order',target:'DELIVERY',outcome:'RELEASED',keepUse})).replayed,true);}
});
test('completion commits once and later campaign versions cannot reset usage',async()=>{
 const c=campaign(),m=memory(c);m.apply((await preparePlatformBenefit(m.db,{campaign:c,facts:facts(),referenceDeliveryMinor:1500000,orderId:'order'})).operations);m.apply((await settlePlatformBenefit(m.db,{orderId:'order',target:'DELIVERY',outcome:'CAPTURED'})).operations);const balance=await platformBenefitBalance(m.db,{...c,version:2},'customer');assert.equal(balance.used,1);assert.equal(balance.remaining,2);
});
test('concurrent last-use preparations cannot both commit',async()=>{
 const c=campaign({...base(),usesPerCustomer:1}),m=memory(c);const [a,b]=await Promise.all(['order-a','order-b'].map(orderId=>preparePlatformBenefit(m.db,{campaign:c,facts:facts(),referenceDeliveryMinor:1500000,orderId})));m.apply(a.operations);assert.throws(()=>m.apply(b.operations),/conditional conflict/);
});
test('7000 IQD goods voucher is one-use and never becomes wallet credit',async()=>{
 const c=campaign({...base(),kind:'GOODS_AMOUNT',amountIqd:7000,maximumPerOrderIqd:7000,usesPerCustomer:1}),m=memory(c);const r=await preparePlatformBenefit(m.db,{campaign:c,facts:facts(),orderId:'order'});assert.equal(r.amountMinor,7000000);assert.equal(r.deliveryFunding,null);assert.equal(r.target,'GOODS');assert.equal(r.operations.every(x=>x.Put.TableName===BENEFIT_TABLE),true);m.apply(r.operations);assert.equal((await platformBenefitBalance(m.db,c,'customer')).remaining,0);
});
test('caps, zero saving, targeting and direct entitlement fail closed',async()=>{
 for(const [change,reference,error] of [[{},0,/NO_SAVINGS/],[{},6000000,/CAP_EXCEEDED/],[{grantMode:'DIRECT'},1500000,/EXHAUSTED/],[{maximumPerOrderIqd:1000},1500000,/CAP_EXCEEDED/]]){const c=campaign({...base(),...change}),m=memory(c);await assert.rejects(preparePlatformBenefit(m.db,{campaign:c,facts:facts(),referenceDeliveryMinor:reference,orderId:'order'}),error);assert.equal((await platformBenefitBalance(m.db,c,'customer')).reserved,0);}
 assert.equal(platformBenefitEligibility(campaign({...base(),customerIds:['other']}),facts()),'BENEFIT_NOT_ELIGIBLE');assert.equal(platformBenefitEligibility({...campaign({...base(),customerIds:['other']}),endDate:'2020-01-01T00:00:00.000Z'},facts()),'BENEFIT_NOT_ELIGIBLE');assert.throws(()=>readPlatformBenefit({...base(),amountIqd:100}),/DENOMINATION/);assert.throws(()=>readPlatformBenefit({...base(),kind:'GOODS_AMOUNT',amountIqd:1000}),/INVALID/);
});

test('existing delivery settlement bridge uses the benefit ledger and keeps accepted usage',async()=>{
 const {createStagingDeliveryCampaignBudget}=require('../dist/deliveryCampaignBudget');
 const {retainPlannedEvidence}=require('../dist/driverFinancialTransaction');
 for(const accepted of [false,true]){
  const c=campaign(),m=memory(c),prepared=await preparePlatformBenefit(m.db,{campaign:c,facts:facts(),referenceDeliveryMinor:1500000,orderId:'order'});m.apply(prepared.operations);
  m.rows.set('ORDER#order|META',{PK:'ORDER#order',SK:'META',orderId:'order',status:accepted?'confirmed':'pending',platformBenefitReceipt:prepared.receipt});
  const before=JSON.stringify([...m.rows]);const result=await createStagingDeliveryCampaignBudget({db:m.db}).settle({orderId:'order',outcome:'RELEASED',expectedFunding:prepared.deliveryFunding});
  assert.equal(JSON.stringify([...m.rows]),before);assert.equal(retainPlannedEvidence(result.operations).every(o=>o.ConditionCheck),true);
  m.apply(result.operations);const balance=await platformBenefitBalance(m.db,c,'customer');assert.equal(balance.remaining,accepted?2:3);
 }
});
test('settlement bridge refuses a foreign receipt without writes',async()=>{
 const {createStagingDeliveryCampaignBudget}=require('../dist/deliveryCampaignBudget');const c=campaign(),m=memory(c),prepared=await preparePlatformBenefit(m.db,{campaign:c,facts:facts(),referenceDeliveryMinor:1500000,orderId:'order'});m.apply(prepared.operations);m.rows.set('ORDER#order|META',{orderId:'order',status:'pending',platformBenefitReceipt:{...prepared.receipt,campaignId:'foreign'}});await assert.rejects(createStagingDeliveryCampaignBudget({db:m.db}).settle({orderId:'order',outcome:'RELEASED',expectedFunding:prepared.deliveryFunding}));assert.equal((await platformBenefitBalance(m.db,c,'customer')).reserved,1);
});

test('campaign budgets are not part of the benefit contract',()=>{assert.throws(()=>readPlatformBenefit({...base(),budgetIqd:30000}),/INVALID/);});
