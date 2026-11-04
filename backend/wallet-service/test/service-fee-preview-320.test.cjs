const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/commercial-source-fixture.cjs');
const {serviceFeePreview320:preview}=require('../dist/serviceFeePreview320');
const {quoteHash}=require('../dist/deliveryQuoteRecord');
function setup(){const f=fixture();const db={async send(c){assert.equal(c.constructor.name,'GetCommand');assert.equal(c.input.ConsistentRead,true);return {Item:structuredClone(f.records.get(c.input.TableName+'|'+JSON.stringify(c.input.Key)))};}};return{f,db,run:()=>preview(db,{branchId:'b1'},Date.parse('2026-10-15T12:00:00.000Z'))};}
test('fixed base fee reads accepted approved terms without address, routing, products or mutations',async()=>{const s=setup(),r=await s.run();assert.equal(r.kind,'SERVICE_FEE_PREVIEW');assert.equal(r.baseServiceFee.minorAmount,500000);assert.equal(r.informationalOnly,true);assert.equal(r.requiresFinalConfirmation,true);});
test('pending approval, suspension and wrong branch cannot publish a base fee',async()=>{for(const change of [s=>s.f.change('WhizzMerchants_Businesses',{businessId:'b1'}).platformSuspended=true,s=>s.f.change('staging-PlatformStaff',{pk:'COMMERCIAL_AGREEMENT#a1',sk:'APPROVAL#1'}).status='PENDING']){const s=setup();change(s);await assert.rejects(s.run());}});
test('malformed public input never starts database reads',async()=>{await assert.rejects(preview({send(){throw Error('must not read');}},{branchId:'b1',addressId:'x'}));});
