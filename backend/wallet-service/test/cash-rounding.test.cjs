const {test}=require('node:test');const assert=require('node:assert/strict');
const {calculateCashRounding:calc,verifyCashRoundingEvidence:verify}=require('../dist/cashRounding');
const {fromWholeIqd:m}=require('../dist/money');
const {prepareFullCashSettlement,prepareFullCashJournal}=require('../dist/fullCashSettlement');
const policy={schemaVersion:1,enabled:true,incrementIqd:250,mode:'UP',minimumServiceFeeIqd:250,minimumConflict:'NEXT_COLLECTIBLE_TOTAL'};
const run=(mode,total=14550,service=300,paymentMethod='COD',enabled=true)=>calc({policy:{...policy,mode,enabled},version:1,paymentMethod,customerTotal:m(total),baseServiceFee:m(service)});
test('complete invoice rounds once; signed adjustment is entirely service',()=>{
 for(const [mode,total,service,delta]of [['UP',14750,500,200],['DOWN',14500,250,-50],['NEAREST',14500,250,-50]]){const r=run(mode);assert.equal(r.customerTotal.minorAmount,total*1000);assert.equal(r.serviceFee.minorAmount,service*1000);assert.equal(r.adjustment.minorAmount,delta*1000);assert.deepEqual(verify(r),r);}
 assert.equal(run('UP',14650).serviceFee.minorAmount,400000);
});
test('hard service minimum overrides DOWN with next collectible total',()=>{const r=run('DOWN',14400);assert.equal(r.requestedCustomerTotal.minorAmount,14250000);assert.equal(r.customerTotal.minorAmount,14500000);assert.equal(r.serviceFee.minorAmount,400000);assert.equal(r.minimumOverride,true);});
test('disabled or non-cash payments remain exact, including service below cash minimum',()=>{for(const r of [run('UP',14550,300,'PREPAID'),run('UP',14550,300,'COD',false),run('DOWN',14250,0,'PREPAID')]){assert.equal(r.adjustment.minorAmount,0);assert.equal(r.applied,false);assert.equal(r.minimumOverride,false);}});
test('invariants across every invoice remainder and mode',()=>{for(const mode of ['UP','DOWN','NEAREST'])for(let n=0;n<500;n++){const r=run(mode,14250+n);assert.equal(r.customerTotal.minorAmount%250000,0);assert.ok(r.serviceFee.minorAmount>=250000);assert.equal(r.customerTotal.minorAmount-r.serviceFee.minorAmount,(14250+n-300)*1000);}});
test('settlement journals separately post base and signed adjustment without changing merchant or driver',()=>{for(const mode of ['UP','DOWN']){
 const r=run(mode);const base={allocationSchemaVersion:1,paymentMethod:'COD',goodsGross:m(12000),merchantGoodsDiscount:m(0),platformGoodsDiscount:m(0),merchantCommission:m(3000),serviceFee:r.serviceFee,customerDeliveryFee:m(2250),driverEarning:m(2750),driverTip:m(0),merchantOtherCharges:m(0),platformOtherCharges:m(0),thirdPartyOtherCharges:m(0)};
 const settlement=prepareFullCashSettlement({settlementSchemaVersion:1,base,deliveryFunding:null});const j=prepareFullCashJournal(settlement,r);
 assert.equal(j.debit.minorAmount,j.credit.minorAmount);assert.equal(settlement.allocation.merchantPayable.minorAmount,9000000);assert.equal(settlement.allocation.driverTotalEntitlement.minorAmount,2750000);
 assert.equal(j.lines.find(l=>l.account==='SERVICE_FEE_REVENUE').amount.minorAmount,300000);assert.equal(j.lines.find(l=>l.account==='CASH_ROUNDING_SERVICE_ADJUSTMENT').side,mode==='UP'?'CREDIT':'DEBIT');
}});
test('tampered evidence and mismatched invoice fail closed',()=>{const r=run('UP');assert.throws(()=>verify({...r,adjustment:m(0)}));assert.throws(()=>calc({policy:{...policy,minimumServiceFeeIqd:0},version:1,paymentMethod:'COD',customerTotal:m(1),baseServiceFee:m(0)}));});
