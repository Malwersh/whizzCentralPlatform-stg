'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./helpers/quote-order-handler-fixture.cjs');
test('authenticated quote preview and confirmation commit full-cash snapshot once without cash reservations',async()=>{
 const f=await setup();f.enableCommercial();f.env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';
 const p=await f.invoke({action:'preview_commercial'});assert.equal(p.statusCode,200,JSON.stringify(p.json));
 const consent={digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount};
 const r=await f.invoke({commercialConsent:consent});assert.equal(r.statusCode,201,JSON.stringify(r.json));
 const o=[...f.orders.values()][0];assert.equal(o.financialSnapshot.schemaVersion,3);
 assert.equal(o.commercialPricing.funding.state,'BUDGET_COMMITTED_WITH_ORDER');
 const rows=[...f.commercialRecords.values()];assert.equal(rows.filter(x=>x.kind==='FULL_CASH_FUNDING_COMMITMENT').length,1);
 assert.equal(rows.some(x=>['PROMOTION_FUNDING','DELIVERY_PROMOTION_FUNDING'].includes(x.sk)),false);
 const again=await f.invoke({commercialConsent:consent});assert.equal(again.statusCode,200,JSON.stringify(again.json));assert.equal(f.orders.size,1);
});
for(const source of ['MERCHANT','PLATFORM'])test('full cash '+source+' delivery offer reserves campaign budget, with no platform wallet hold',async()=>{
 const f=await setup();f.enableDeliveryPromotions(source);f.env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';
 const p=await f.invoke({action:'preview_commercial'});assert.equal(p.statusCode,200,JSON.stringify(p.json));
 const r=await f.invoke({commercialConsent:{digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount}});
 assert.equal(r.statusCode,201,JSON.stringify(r.json));const o=[...f.orders.values()][0];assert.equal(o.financialSnapshot.schemaVersion,3);assert.ok(o.financialSnapshot.deliveryFunding);
 assert.equal([...f.commercialRecords.values()].filter(x=>x.kind==='FULL_CASH_FUNDING_COMMITMENT').length,1);
 assert.equal([...f.commercialRecords.values()].some(x=>x.sk==='DELIVERY_PROMOTION_FUNDING'),false);
});
test('general quoted confirmation commits a fresh order outside historical exact scope with its budget commitment',async()=>{
 const f=await setup();f.enableCommercial();f.env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';f.env.FINANCE_GENERAL_RELEASE_MODE='REQUIRED';f.body.idempotencyKey='bbbbbbbb-1234-4123-8123-123456789abc';
 const p=await f.invoke({action:'preview_commercial'});assert.equal(p.statusCode,200,JSON.stringify(p.json));
 const r=await f.invoke({commercialConsent:{digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount}});
 assert.equal(r.statusCode,201,JSON.stringify(r.json));const o=[...f.orders.values()][0];assert.equal(o.financeRollout.scopeId,'GENERAL_STAGING_FULL_CASH_V1');assert.equal(o.financialSnapshot.schemaVersion,3);
});
test('shared goods funding commits finite campaign exposure and usage once without a platform cash hold',async()=>{
 const f=await setup();f.enableCommercial();f.env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';
 f.discountRow={valid_from:'2026-10-01T00:00:00.000Z',valid_to:'2026-11-01T00:00:00.000Z',discountId:'d1',businessId:'b1',version:1,status:'active',type:'fixedAmount',value:1000,usage_count:0,usage_limit:1,fundingPolicyId:'fp1',fundingPolicyVersion:1};
 const patch={discountId:'d1',discount:1000},p=await f.invoke({...patch,action:'preview_commercial'});assert.equal(p.statusCode,200,JSON.stringify(p.json));
 const consent={digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount};
 const r=await f.invoke({...patch,commercialConsent:consent});assert.equal(r.statusCode,201,JSON.stringify(r.json));
 const commitment=[...f.commercialRecords.values()].find(x=>x.kind==='FULL_CASH_FUNDING_COMMITMENT');assert.equal(commitment.goodsExposure.usageLimit,1);assert.equal(commitment.goodsExposure.platformAmount.minorAmount,500000);assert.equal(f.discountRow.usage_count,1);
 assert.equal((await f.invoke({...patch,commercialConsent:consent})).statusCode,200);assert.equal(f.discountRow.usage_count,1);
 assert.equal([...f.commercialRecords.values()].some(x=>x.sk==='PROMOTION_FUNDING'),false);
});
test('cash policy applies before consent and commits immutable audit with no wallet reservation',async()=>{
 const f=await setup();f.enableCommercial();f.env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';
 const key='staging-PlatformStaff|'+JSON.stringify({pk:'OPERATIONAL_SETTINGS#CASH_ROUNDING',sk:'CURRENT'});
 const policy={pk:'OPERATIONAL_SETTINGS#CASH_ROUNDING',sk:'CURRENT',version:1,values:{schemaVersion:1,enabled:true,incrementIqd:250,mode:'UP',minimumServiceFeeIqd:250,minimumConflict:'NEXT_COLLECTIBLE_TOTAL'}};
 f.commercialRecords.set(key,policy);
 const p=await f.invoke({action:'preview_commercial'});assert.equal(p.statusCode,200,JSON.stringify(p.json));
 const old={digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount};
 f.commercialRecords.set(key,{...policy,version:2});
 const stale=await f.invoke({commercialConsent:old});assert.equal(stale.statusCode,409);assert.equal(f.orders.size,0);
 const p2=await f.invoke({action:'preview_commercial'});assert.equal(p2.statusCode,200,JSON.stringify(p2.json));
 const r=await f.invoke({commercialConsent:{digest:p2.json.commercial.digest,customerTotalMinor:p2.json.commercial.customerTotal.minorAmount}});assert.equal(r.statusCode,201,JSON.stringify(r.json));
 const order=[...f.orders.values()][0],commitment=[...f.commercialRecords.values()].find(v=>v.kind==='FULL_CASH_FUNDING_COMMITMENT');
 assert.equal(order.commercialPricing.cashRounding.policy.version,2);assert.deepEqual(commitment.cashRounding,order.commercialPricing.cashRounding);assert.equal(order.pricing.total%250000,0);
});
test('required cash policy cannot disappear into an assumed legacy price',async()=>{const f=await setup();f.enableCommercial();f.env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';f.env.CASH_ROUNDING_POLICY_MODE='REQUIRED';const r=await f.invoke({action:'preview_commercial'});assert.equal(r.statusCode,409,JSON.stringify(r.json));assert.equal(r.json.code,'CASH_ROUNDING_POLICY_UNAVAILABLE');assert.equal(f.orders.size,0);});
for(const [mode,enabled,total,service]of [['UP',true,7000,500],['DOWN',true,6750,250],['UP',false,6800,300]])test('agreed service300 flows through real preview and commit: '+mode+'/'+enabled,async()=>{
 const f=await setup();f.enableCommercial();f.env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';f.env.CASH_ROUNDING_POLICY_MODE='REQUIRED';
 const {moneyFromMinor:m}=require('../dist/money'),{quoteHash}=require('../dist/deliveryQuoteRecord');
 const record=[...f.commercialRecords.values()].find(r=>r.terms?.id==='a1');const old=record.termsHash;record.terms.serviceFee.fixed=m(300000);const hash=quoteHash({terms:record.terms,otherCharges:record.otherCharges,allowedFundingPolicyIds:record.allowedFundingPolicyIds});for(const r of f.commercialRecords.values())if(r.termsHash===old)r.termsHash=hash;
 const key={pk:'OPERATIONAL_SETTINGS#CASH_ROUNDING',sk:'CURRENT'};f.commercialRecords.set('staging-PlatformStaff|'+JSON.stringify(key),{...key,version:1,values:{schemaVersion:1,enabled,incrementIqd:250,mode,minimumServiceFeeIqd:250,minimumConflict:'NEXT_COLLECTIBLE_TOTAL'}});
 const preview=await f.invoke({action:'preview_commercial'});assert.equal(preview.statusCode,200,JSON.stringify(preview.json));assert.equal(preview.json.commercial.serviceFee.minorAmount,service*1000);assert.equal(preview.json.commercial.customerTotal.minorAmount,total*1000);
 const r=await f.invoke({commercialConsent:{digest:preview.json.commercial.digest,customerTotalMinor:total*1000}});assert.equal(r.statusCode,201,JSON.stringify(r.json));const order=[...f.orders.values()][0];assert.equal(order.commercialPricing.cashRounding.baseServiceFee.minorAmount,300000);assert.equal(order.pricing.serviceFee,service*1000);assert.equal(order.pricing.total,total*1000);
});
for(const source of ['NONE','MERCHANT','PLATFORM'])test('prepared invoice remains valid for final metadata and same request ID: '+source,async()=>{
 const f=await setup();if(source==='NONE')f.enableCommercial();else f.enableDeliveryPromotions(source);f.env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';
 const p=await f.invoke({action:'preview_commercial',storeName:'Informational name',customerName:null,customerPhone:null,deliveryInstructions:null});assert.equal(p.statusCode,200,JSON.stringify(p.json));assert.equal(f.orders.size,0);
 const r=await f.invoke({storeName:'Current display name',customerName:'Synthetic',customerPhone:'synthetic',deliveryInstructions:'Current instructions',commercialConsent:{digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount}});
 assert.equal(r.statusCode,201,JSON.stringify(r.json));assert.equal(f.orders.size,1);
 assert.equal((await f.invoke({storeName:'Current display name',customerName:'Synthetic',customerPhone:'synthetic',deliveryInstructions:'Current instructions',commercialConsent:{digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount}})).statusCode,200);
 assert.equal(f.orders.size,1);
});
