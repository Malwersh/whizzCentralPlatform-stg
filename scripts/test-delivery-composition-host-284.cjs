'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('../backend/wallet-service/node_modules/typescript'),{patch}=require('./patch-delivery-composition-host-284.cjs');
const dir=process.argv[2];if(!dir||!path.isAbsolute(dir))throw Error('Absolute artifact directory required');
const helper=require(path.join(dir,'delivery-agreement-runtime-284.js'));
const {parseIqd:m}=require('../backend/wallet-service/dist/money');
const {calculateStoreDeliveryAgreement}=require('../backend/wallet-service/dist/storeDeliveryAgreement');
const {calculatePolicyDeliveryFunding}=require('../backend/wallet-service/dist/deliveryFundingPolicy');
const {deliveryCampaignBudgetInitialization:init}=require('../backend/wallet-service/dist/deliveryCampaignBudget');
const {fixture}=require('../backend/wallet-service/test/helpers/delivery-promotion-fixture.cjs');
const policy={schemaVersion:2,id:'contract',version:1,merchantId:'merchant',branchId:'branch',origin:'PLATFORM',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:'2026-11-01T00:00:00.000Z',customerRule:{kind:'FIXED_TARIFF',amount:m('1500')},funding:{kind:'PLATFORM'},eligibility:{regionIds:['zone'],minimumGoods:m('7000')},commission:{kind:'PERCENT',basis:'GOODS_GROSS',fixed:null,rate:{numerator:15,denominator:100},rounding:'TOWARD_ZERO',finalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}}};
const campaign=fixture().policy;campaign.customerRule={kind:'FREE'};
const funding=helper.composeDeliveryFunding(calculateStoreDeliveryAgreement(policy,m('4000')),calculatePolicyDeliveryFunding(campaign,m('1500'),m('0')));
const base={allocationSchemaVersion:1,paymentMethod:'COD',goodsGross:m('7000'),merchantGoodsDiscount:m('0'),platformGoodsDiscount:m('0'),merchantCommission:m('1050'),serviceFee:m('500'),customerDeliveryFee:m('0'),driverEarning:m('2750'),driverTip:m('500'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')};
const value={allocationSchemaVersion:2,base,deliveryFunding:funding},expected=helper.allocateDeliveryFundedOrder(value);
function functions(source){const ast=ts.createSourceFile('host.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(ast.parseDiagnostics.length,0);const list=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.name)list.push({name:n.name.text,text:n.getText(ast)});ts.forEachChild(n,visit);}visit(ast);return list;}
function load(fn){const module={exports:{}};vm.runInNewContext(fn.text+'\nmodule.exports='+fn.name,{module,exports:module.exports,require:n=>{assert.ok(n.endsWith('delivery-agreement-runtime-284.js'));return helper;},__name:f=>f,console,Date});return module.exports;}
async function run(){let allocations=0,lifecycles=0,idempotentFiles=0;
for(const row of JSON.parse(fs.readFileSync(path.join(dir,'plans.json'))))for(const [file,target]of Object.entries(row.changes)){
 if(file==='delivery-agreement-runtime-284.js'||row.function==='WizzUser-CreateOrder-staging'&&file==='_discount_review/user-create-order/index.js')continue;
 const source=fs.readFileSync(target,'utf8'),relative=path.posix.relative(path.posix.dirname(file),'delivery-agreement-runtime-284.js');assert.equal(patch(source,relative.startsWith('.')?relative:'./'+relative).source,source);idempotentFiles++;
 for(const fn of functions(source)){
  if(!fn.text.includes('delivery-composition-284'))continue;
  if(/^allocateDeliveryFundedOrder\d*$/.test(fn.name)){assert.equal(JSON.stringify(load(fn)(value)),JSON.stringify(expected));allocations++;}
  if(/^createStagingDeliveryCampaignBudget\d*$/.test(fn.name)){
   const rows=new Map(),key=(t,k)=>t+'|'+k.pk+'|'+k.sk,db={send:async c=>({Item:structuredClone(rows.get(key(c.input.TableName,c.input.Key)))})},apply=ops=>{for(const o of ops)if(o.Put)rows.set(key(o.Put.TableName,o.Put.Item),structuredClone(o.Put.Item));};
   apply([init(campaign)]);const now=()=>Date.parse('2026-10-19T00:00:00.000Z');
   const normal=helper.createStagingDeliveryCampaignBudget({db,now});apply((await normal.reserve({orderId:'order',customerId:'customer',policy,referenceFee:m('4000'),customerFee:m('1500')})).operations);
   apply((await helper.createStagingDeliveryCampaignBudget({db,now,reservationNamespace:'PROMOTION'}).reserve({orderId:'order',customerId:'customer',policy:campaign,referenceFee:m('1500'),customerFee:m('0')})).operations);
   const live=load(fn)({db,now}),before=JSON.stringify([...rows]),plan=await live.settle({orderId:'order',outcome:'CAPTURED',expectedFunding:funding});assert.equal(JSON.stringify([...rows]),before);assert.equal(plan.operations.length,4);apply(plan.operations);assert.equal((await live.settle({orderId:'order',outcome:'CAPTURED',expectedFunding:funding})).replayed,true);lifecycles++;
  }
 }
}
const result={status:'PASS',actualHostAllocationFactories:allocations,actualHostLifecycleFactories:lifecycles,idempotentFiles,businessDataModified:false};assert.ok(allocations>10&&lifecycles>10);fs.writeFileSync(path.join(dir,'host-tests.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
run().catch(e=>{console.error(e);process.exitCode=1;});
