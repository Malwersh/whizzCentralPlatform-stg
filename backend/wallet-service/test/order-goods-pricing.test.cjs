const {test}=require('node:test');const assert=require('node:assert/strict');
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const {createStagingOrderGoodsPricing:create}=require('../dist/orderGoodsPricing');
const {parseIqd:m,formatIqd}=require('../dist/money');
function product(productId='p1',price=2500){return {productId,businessId:'branch1',name:'منتج',description:'',price,categoryId:'cat1',isAvailable:true,updatedAt:'same-time'};}
function selection(items=[{productId:'p1',quantity:2}]){return {branchId:'branch1',items};}
function setup(products=[product()],category={categoryId:'cat1',isActive:true},hook){const calls=[];const reader=create({db:{async send(c){calls.push(c);if(hook)await hook(c);return {Item:structuredClone(c.input.TableName==='WhizzMerchants_Categories'?category:products.find(p=>p.productId===c.input.Key.productId))};}}});return {...reader,calls};}
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
test('existing branch product IQD price is converted once and used with selected quantity',async()=>{
 const r=setup(),out=await r.price(selection());assert.equal(formatIqd(out.goodsGross),'5000');assert.deepEqual(out.lines[0].unitPrice,m('2500'));
 assert.equal(out.lines[0].unitPrice.minorAmount,2500000);assert.equal(out.performsWrites,false);assert.equal(out.completeFinancialSnapshot,false);
 assert.equal(out.requiresAtomicComposition,true);assert.equal(out.requiresBranchAndAccountGuards,true);
 assert.equal(r.calls.length,2);for(const c of r.calls){assert.ok(c instanceof GetCommand);assert.equal(c.input.ConsistentRead,true);assert.equal(c.input.IndexName,undefined);}
 assert.deepEqual(r.calls[0].input.Key,{productId:'p1'});assert.equal(r.calls[0].input.TableName,'WhizzMerchants_Products');
 assert.equal(out.name,undefined);assert.equal(out.lines[0].name,undefined);
});
test('decimal product prices preserve three decimals and never use binary multiplication rounding',async()=>{
 for(const price of [0.001,0.1,2500.125]){const out=await setup([product('p1',price)]).price(selection());assert.equal(out.goodsGross.minorAmount,m(String(price)).minorAmount*2);}
 for(const price of [0,-1,NaN,Infinity,'2500',0.0001,1000000001])await rejects(setup([product('p1',price)]).price(selection()),'GOODS_PRICING_UNSUPPORTED');
});
test('only server selectors are allowed; client prices, totals, modifiers and table selection fail before reads',async()=>{
 const r=setup();for(const input of [null,{...selection(),price:1},{...selection(),table:'other'},selection([{productId:'p1',quantity:2,unitPrice:1}]),selection([{productId:'p1',quantity:2,modifiers:[]}]),selection([{productId:'p1',quantity:2,total:1}])])await rejects(r.price(input),'INVALID_GOODS_SELECTION');assert.equal(r.calls.length,0);
});
test('all selectors are validated before I/O, with unique products and bounded integer quantities',async()=>{
 const r=setup();for(const items of [[],Array.from({length:41},(_,i)=>({productId:'p'+i,quantity:1})),[{productId:'p1',quantity:1},{productId:'p1',quantity:1}],[{productId:'p1',quantity:1},{productId:'bad/path',quantity:1}],...[0,-1,1.5,1001,'1'].map(quantity=>[{productId:'p1',quantity}])])await rejects(r.price(selection(items)),'INVALID_GOODS_SELECTION');assert.equal(r.calls.length,0);
});
test('missing, foreign and unavailable products never fall back to client prices or catalog defaults',async()=>{
 for(const p of [null,{...product(),businessId:'other'},{...product(),isAvailable:false},{...product(),isAvailable:undefined}])await rejects(setup(p?[p]:[]).price(selection()),'GOODS_UNAVAILABLE');
});
test('advanced and unknown product schemas are rejected rather than dropping stock or pricing constraints',async()=>{
 for(const patch of [{stock:10},{stock:null},{options:[]},{sizes:[]},{unit:'kg'},{salePrice:100},{modifiers:[]},{isDeleted:false},{futurePricing:{base:1}}])await rejects(setup([{...product(),...patch}]).price(selection()),'GOODS_PRICING_UNSUPPORTED');
});
test('shared category is read/fenced once for several products, with no duplicate transaction targets',async()=>{
 const out=await setup([product(),product('p2',1000)]).price(selection([{productId:'p1',quantity:2},{productId:'p2',quantity:3}]));
 assert.equal(formatIqd(out.goodsGross),'8000');assert.equal(out.conditions.length,3);
 assert.equal(new Set(out.conditions.map(c=>c.ConditionCheck.TableName+JSON.stringify(c.ConditionCheck.Key))).size,3);
});
test('inactive, foreign and missing categories block pricing, shared legacy category remains supported',async()=>{
 for(const c of [null,{categoryId:'cat1',isActive:false},{categoryId:'cat1',is_active:false},{categoryId:'cat1',businessId:'other'},{categoryId:'cat1',isActive:'true'}])await rejects(setup([product()],c).price(selection()),'GOODS_UNAVAILABLE');
 const out=await setup([product()],{categoryId:'cat1'}).price(selection());assert.equal(formatIqd(out.goodsGross),'5000');
});
test('conditions compare actual price/availability and absence of advanced schema fields even with unchanged timestamp',async()=>{
 const out=await setup().price(selection()),c=out.conditions[0].ConditionCheck;
 for(const f of ['price','businessId','categoryId','isAvailable','updatedAt']){const a=Object.keys(c.ExpressionAttributeNames).find(k=>c.ExpressionAttributeNames[k]===f);assert.ok(c.ConditionExpression.includes(a+' = :g'+a.slice(2)));}
 for(const f of ['stock','options','salePrice','deletedAt']){const a=Object.keys(c.ExpressionAttributeNames).find(k=>c.ExpressionAttributeNames[k]===f);assert.ok(c.ConditionExpression.includes(`attribute_not_exists(${a})`));}
 const priceAlias=Object.keys(c.ExpressionAttributeNames).find(k=>c.ExpressionAttributeNames[k]==='price');assert.equal(c.ExpressionAttributeValues[':g'+priceAlias.slice(2)],2500);
});
test('a storage failure for product or category returns no partial proposal and exposes no backend details',async()=>{
 for(const failAt of [1,2]){let count=0;const r=create({db:{async send(){if(++count===failAt)throw new Error('secret');return {Item:product()};}}});await rejects(r.price(selection()),'GOODS_PRICING_UNAVAILABLE');}
});
test('caller mutation during reads cannot change subsequent product/quantity/branch selectors',async()=>{
 const input=selection([{productId:'p1',quantity:2},{productId:'p2',quantity:3}]);let changed=false;
 const r=setup([product(),product('p2',1000)],{categoryId:'cat1'},async()=>{if(!changed){changed=true;input.branchId='other';input.items[1].productId='other';input.items[1].quantity=999;}});
 const out=await r.price(input);assert.equal(out.branchId,'branch1');assert.equal(formatIqd(out.goodsGross),'8000');assert.equal(out.lines[1].productId,'p2');
});
test('reordered selections keep the same financial fingerprint and safe subtotal limits reject overflow',async()=>{
 const r=setup([product(),product('p2',1000)]),a=[{productId:'p1',quantity:2},{productId:'p2',quantity:3}];
 assert.equal((await r.price(selection(a))).fingerprint,(await r.price(selection([...a].reverse()))).fingerprint);
 const products=Array.from({length:40},(_,i)=>product('p'+i,1000000000));await rejects(setup(products).price(selection(products.map(p=>({productId:p.productId,quantity:1000})))),'GOODS_PRICING_UNSUPPORTED');
});
