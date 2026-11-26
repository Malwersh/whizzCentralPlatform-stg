const {test}=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../delivery-options');
const {fixture,editor}=require('./helpers/commercial-fixture.cjs');
const {service}=require('../commercial-management');
test('delivery region picker provides active named hierarchy and omits ambiguous or inactive zones',async()=>{
 const rows=[['country','ROOT',0,'العراق'],['gov','country',1,'بغداد'],['city','gov',2,'المركز'],['zone','city',3,'المنطقة']].map(([regionId,parent_id,level,name_ar])=>({regionId,parent_id,level,name_ar,is_active:1}));
 rows.push({regionId:'hidden',parent_id:'city',level:3,name_ar:'مغلق',is_active:0});
 const result=await load({send:async c=>{assert.equal(c.input.ConsistentRead,true);return {Items:rows};}});
 assert.deepEqual(result,[{id:'zone',label:'العراق — بغداد — المركز — المنطقة'}]);
});
test('delivery picker rejects incomplete pagination instead of presenting a partial list',async()=>{
 await assert.rejects(load({send:async()=>({Items:[],LastEvaluatedKey:{regionId:'next'}})}),/DELIVERY_REGIONS_INCOMPLETE/);
});
test('commercial capabilities and delivery options remain gated by server flag',async()=>{
 const f=fixture();let r=await service(f.ctx,editor(),'GET',{businessId:'branch'});assert.equal(r.can.deliveryEnabled,false);assert.equal(r.can.deliveryRequest,false);
 await assert.rejects(service(f.ctx,editor(),'GET',{businessId:'branch',view:'delivery-options'}),/DELIVERY_FUNDING_MANAGEMENT_DISABLED/);
 f.ctx.deliveryFundingEnabled=true;r=await service(f.ctx,editor(),'GET',{businessId:'branch'});assert.equal(r.can.deliveryRequest,true);
});
