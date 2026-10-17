const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync('lambda/WaveSystem_CreateDispatchJob/index.js','utf8');
const helpers=source.slice(source.indexOf('function toNumber('),source.indexOf('\n}',source.indexOf('function normalizeMoneyToIqd('))+2);
const start=source.indexOf('  const rawTotal = toNumber(order.total ??');const end=source.indexOf('\n\n  const dispatchJob',start);
function read(order){const ctx={order};vm.runInNewContext(helpers+'\n'+source.slice(start,end)+'\nthis.result=[normalizedOrderTotal,normalizedHoldRequiredAmount,normalizedDeliveryFee];',ctx);return Array.from(ctx.result);}
test('dispatch uses verified scale including zero and sub-dinar fees',()=>{
 for(const fee of [0,1000,2500000,2500125])assert.deepEqual(read({currency:'IQD',createdBy:'wizzuser_app',deliveryFee:9999,pricing:{total:3500000+fee,goodsSubtotal:3500000,deliveryFee:fee}}),[3500+fee/1000,3500,fee/1000]);
});
test('legacy direct IQD is not inferred from magnitude',()=>assert.deepEqual(read({total:2500000,subtotal:2497500,deliveryFee:2500}),[2500000,2497500,2500]));
