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
