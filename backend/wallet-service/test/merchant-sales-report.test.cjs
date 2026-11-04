const test=require('node:test'),assert=require('node:assert/strict');
const {docClient}=require('../dist/db');
const {statementPeriod}=require('../dist/walletStatement');
const {aggregateSales,orderPrice,merchantSalesReport}=require('../dist/merchantSalesReport');
const period=()=>statementPeriod('2026-01-01','2026-01-02');
const order=(id='a')=>({PK:'ORDER#'+id,SK:'META',storeId:'b',createdAt:'2026-01-01T10:00:00.000Z',status:'delivered',currency:'IQD',createdBy:'wizzuser_app',total:11,subtotal:10,pricing:{goodsSubtotal:10000,deliveryFee:1500,serviceFee:0,packagingFee:0,tax:0,tip:0,rounding:0,discount:500,total:11000},customerPhone:'private'});
test('verified legacy source unit uses all equation components and both compatibility values',()=>{
 assert.deepEqual(orderPrice(order()),{goods:10000n,discount:500n,checkout:11000n});
 for(const change of [{total:11000},{subtotal:10000},{currency:'USD'},{createdBy:'other'},{pricing:{...order().pricing,total:12000}},{pricing:{...order().pricing,discount:-1}}])assert.equal(orderPrice({...order(),...change}),null);
});
test('cancelled and pending orders affect counts without inflating completed order sales',()=>{
 const r=aggregateSales([order(),{...order('cancel'),status:'cancelled'},{...order('pending'),status:'pending',pricing:{total:999999}}]);
 assert.equal(r.status,'AVAILABLE');assert.equal(r.orderCount,3);assert.equal(r.completedOrderCount,1);assert.equal(r.totalsSubunits.goods,10000);assert.equal(r.countsByStatus.cancelled,1);
});
test('unknown completed price suppresses every aggregate; values are never inferred from magnitude',()=>{
 const r=aggregateSales([order(),{...order('unknown'),total:11000}]);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.unclassifiedCompletedCount,1);assert.equal(r.totalsSubunits,undefined);
});
test('fractional dinars are added in integer subunits without rounding each order',()=>{
 const r=order();r.pricing.goodsSubtotal=10049;r.pricing.total=11049;
 const a=aggregateSales([r,r]);assert.equal(a.totalsSubunits.goods,20098);assert.equal(a.totalsSubunits.checkout,22098);
 assert.equal(aggregateSales([]).totalsSubunits.goods,0);
});
test('complete base-table scan covers old storeId records and empty pages before returning counts',async()=>{
 const calls=[];docClient.send=async c=>{calls.push(c);return calls.length===1?{Items:[],LastEvaluatedKey:{PK:'ORDER#x',SK:'META'}}:{Items:[order()]};};
 const r=await merchantSalesReport('b',period());assert.equal(r.complete,true);assert.equal(r.summary.orderCount,1);assert.equal(r.customerPhone,undefined);assert.equal(r.entries,undefined);assert.equal(calls[0].constructor.name,'ScanCommand');assert.equal(calls[0].input.ConsistentRead,true);assert.ok(!Object.values(calls[0].input.ExpressionAttributeNames).includes('customerPhone'));assert.equal(calls[1].input.ExclusiveStartKey.PK,'ORDER#x');
});
test('incomplete base scan, duplicate or foreign/conflicting branch records never release a report',async()=>{
 for(const mode of ['incomplete','duplicate','foreign','conflict','date','limit']){
  let calls=0;docClient.send=async()=>{calls++;const o=order();return mode==='incomplete'?{Items:[],LastEvaluatedKey:{PK:'ORDER#'+calls,SK:'META'}}:{Items:mode==='duplicate'?[o,o]:mode==='foreign'?[{...o,storeId:'foreign'}]:mode==='conflict'?[{...o,businessId:'foreign'}]:mode==='date'?[{...o,createdAt:'2026-01-03T00:00:00.000Z'}]:Array.from({length:501},(_,i)=>order(''+i))};};
  await assert.rejects(merchantSalesReport('b',period()));if(mode==='incomplete')assert.equal(calls,12);
 }
});
test('aggregate overflow suppresses totals while decimal IQD values remain exact',()=>{
 const r=order();r.pricing={goodsSubtotal:Number.MAX_SAFE_INTEGER,deliveryFee:0,serviceFee:0,packagingFee:0,tax:0,tip:0,rounding:0,discount:0,total:Number.MAX_SAFE_INTEGER};r.total=Math.round(Number.MAX_SAFE_INTEGER/1000);r.subtotal=r.total;
 const result=aggregateSales([r,r]);assert.equal(result.status,'UNAVAILABLE');assert.equal(result.reason,'UNSAFE_TOTAL');assert.equal(result.totalsSubunits,undefined);
});
test('sales CSV preserves exact IQD fractions and scope/basis without individual order data',()=>{
 const {exportSalesReport}=require('../dist/merchantSalesReport');
 const o=order();o.pricing.goodsSubtotal=10049;o.pricing.total=11049;
 const report={businessId:'b',period:period(),summary:aggregateSales([o]),consistency:'LIVE_BASE_TABLE_READ_NOT_ACCOUNTING_SNAPSHOT'};
 const r=exportSalesReport(report,'2026-01-03T01:00:00.000Z');
 assert.equal(r.filename,'branch-sales-report-2026-01-01-2026-01-02.csv');assert.ok(r.csv.startsWith('\ufeff'));assert.ok(r.csv.includes('"goods","10.049","10049"'));assert.ok(r.csv.includes('not collections, profit'));assert.ok(r.csv.includes('"businessId","b"'));assert.ok(!r.csv.includes('private'));assert.ok(!r.csv.includes('ORDER#'));
});
test('unclassified sales exports contain explicit unavailable status and counts, never invented monetary zeroes',()=>{
 const {exportSalesReport}=require('../dist/merchantSalesReport');
 const r=exportSalesReport({businessId:'b',period:period(),summary:aggregateSales([{...order(),currency:'USD'}]),consistency:'LIVE'});
 assert.ok(r.csv.includes('"summary_status","UNAVAILABLE"'));assert.ok(r.csv.includes('"unclassified_completed_count","1"'));assert.ok(!r.csv.includes('"amount_IQD"'));assert.ok(!r.csv.includes('"goods","0"'));
});
test('CSV text is neutralized and oversized exports fail before audit/release',()=>{
 const {exportSalesReport}=require('../dist/merchantSalesReport');
 let report={businessId:'=1',period:period(),summary:aggregateSales([{...order(),status:'=SUM(1)'}]),consistency:'LIVE'};
 let r=exportSalesReport(report);assert.ok(r.csv.includes('"\'=1"'));assert.ok(r.csv.includes('"\'=SUM(1)"'));
 report.consistency='x'.repeat(512001);assert.throws(()=>exportSalesReport(report),e=>e.code==='REPORT_TOO_LARGE');
});

test('commercial snapshot distinguishes organization merchantId from branch aliases without accepting a foreign branch',async()=>{
 const f=require('./helpers/commercial-source-fixture.cjs').fixture();const priced=await f.prepare();
 const row={...order('o1'),storeId:'b1',merchantId:'org',financialSnapshot:priced.financialSnapshot};
 docClient.send=async()=>({Items:[row]});
 assert.equal((await merchantSalesReport('b1',period())).summary.orderCount,1);
 row.financialSnapshot=structuredClone(row.financialSnapshot);row.financialSnapshot.snapshot.branchId='foreign';
 await assert.rejects(merchantSalesReport('b1',period()),e=>e.code==='SALES_DATA_UNAVAILABLE');
});
