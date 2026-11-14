const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../dist/money');
const minor = m.moneyFromMinor;
const fails = (fn, code) => assert.throws(fn, e => e instanceof m.MoneyError && e.code === code);

test('money wire contract round trips with explicit IQD scale and version', () => {
 const value = minor(3500125);
 assert.deepEqual(JSON.parse(JSON.stringify(value)), {currency:'IQD',scale:1000,moneySchemaVersion:1,minorAmount:3500125});
 assert.deepEqual(m.readMoney(JSON.parse(JSON.stringify(value))), value);
 assert.equal(Object.isFrozen(value), true);
 assert.equal(Object.is(minor(-0).minorAmount, -0), false);
});
test('missing or incompatible units cannot be inferred from size', () => {
 for (const value of [{minorAmount:100000}, {...minor(1),scale:1}, {...minor(1),currency:'USD'}, {...minor(1),moneySchemaVersion:2}, {...minor(1),amount:10}]) {
  assert.throws(() => m.readMoney(value), m.MoneyError);
 }
 for (const value of [null, [], '1000', 1000]) fails(() => m.readMoney(value), 'INVALID_MONEY');
});
test('unsafe, fractional and coercible minor amounts are refused', () => {
 for (const value of [NaN, Infinity, -Infinity, 1.1, Number.MAX_SAFE_INTEGER+1, '1000', null, true]) fails(() => minor(value), 'INVALID_MONEY');
});
test('decimal input retains thousandths and exact Arabic price values without floating point', () => {
 for (const [input, expected, formatted] of [['3500.125',3500125,'3500.125'],['0.001',1,'0.001'],['10.010',10010,'10.01'],['-0.005',-5,'-0.005'],['-0',0,'0'],['0',0,'0']]) {
  const result = m.parseIqd(input);
  assert.equal(result.minorAmount, expected);
  assert.equal(m.formatIqd(result), formatted);
 }
});
test('decimal boundary rejects lossy precision and ambiguous formatting', () => {
 for (const text of ['0.0001','1e3','1,000','١٠',' 10','10 ','+10','01','1.','.5','--1','',10,{},'9'.repeat(100)]) fails(() => m.parseIqd(text), 'INVALID_MONEY');
});
test('maximum supported signed amounts format and parse exactly', () => {
 for (const amount of [Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER]) assert.equal(m.parseIqd(m.formatIqd(minor(amount))).minorAmount, amount);
 fails(() => m.parseIqd('9007199254740.992'), 'MONEY_OVERFLOW');
 fails(() => m.parseIqd('-9007199254740.992'), 'MONEY_OVERFLOW');
});
test('whole IQD bridge requires explicit conversion and rejects fractional legacy writes', () => {
 assert.equal(m.fromWholeIqd(3500).minorAmount, 3500000);
 assert.equal(m.toWholeIqdExact(m.fromWholeIqd(3500)),3500);
 assert.equal(m.toWholeIqdExact(minor(-2000)),-2);
 fails(() => m.toWholeIqdExact(minor(3500125)), 'PRECISION_LOSS');
 fails(() => m.fromWholeIqd(1.5), 'INVALID_MONEY');
 fails(() => m.fromWholeIqd(Number.MAX_SAFE_INTEGER), 'MONEY_OVERFLOW');
});
test('addition and subtraction use exact intermediates and reject unsafe final totals', () => {
 const max = minor(Number.MAX_SAFE_INTEGER);
 assert.equal(m.addMoney(max, minor(1), minor(-1)).minorAmount, max.minorAmount);
 assert.equal(m.addMoney().minorAmount,0);
 assert.equal(m.subtractMoney(minor(1001),minor(1000)).minorAmount,1);
 fails(() => m.addMoney(max,minor(1)), 'MONEY_OVERFLOW');
 fails(() => m.subtractMoney(max,minor(-1)), 'MONEY_OVERFLOW');
 fails(() => m.addMoney(minor(1),{...minor(1),scale:1}), 'UNSUPPORTED_MONEY_SCHEMA');
});
test('rational commission retains exact intermediate products beyond number precision', () => {
 const max = minor(Number.MAX_SAFE_INTEGER);
 assert.equal(m.multiplyMoney(max,9999,9999,'EXACT').minorAmount,max.minorAmount);
 assert.equal(m.multiplyMoney(m.parseIqd('10000'),125,10000,'EXACT').minorAmount,125000);
 fails(() => m.multiplyMoney(max,2,1,'EXACT'),'MONEY_OVERFLOW');
});
test('rounding is explicit and symmetric for reversals including half ties', () => {
 for (const [amount,expected] of [[5,3],[-5,-3],[4,2],[-4,-2],[1,1],[-1,-1]]) {
  assert.equal(m.multiplyMoney(minor(amount),1,2,'HALF_AWAY_FROM_ZERO').minorAmount,expected);
 }
 assert.equal(m.multiplyMoney(minor(-5),1,2,'TOWARD_ZERO').minorAmount,-2);
 fails(() => m.multiplyMoney(minor(5),1,2,'EXACT'),'PRECISION_LOSS');
 fails(() => m.multiplyMoney(minor(4),1,2,undefined),'INVALID_ROUNDING');
});
test('invalid rates cannot introduce infinity, coercion or implicit defaults', () => {
 for (const [n,d] of [[-1,2],[1,0],[1,-2],[1.5,2],[1,NaN],['1',2]]) fails(() => m.multiplyMoney(minor(1),n,d,'EXACT'),'INVALID_MONEY');
 assert.equal(m.multiplyMoney(minor(10),0,1,'EXACT').minorAmount,0);
});
test('decimal and whole bridges round trip across representative price and signed adjustment ranges', () => {
 for(let i=-10000;i<=10000;i+=37) {
  const value=minor(i);
  assert.deepEqual(m.parseIqd(m.formatIqd(value)),value);
  assert.equal(m.toWholeIqdExact(m.fromWholeIqd(i)),i);
  assert.equal(m.addMoney(value,m.subtractMoney(minor(0),value)).minorAmount,0);
 }
});

test('ceiling cash denomination is exact, signed and bounded',()=>{
 const policy={incrementIqd:250,mode:'CEILING'};
 for(const [input,want] of [['0','0'],['0.001','250'],['1100','1250'],['1250','1250'],['1250.001','1500'],['-1100','-1000']]){
  assert.deepEqual(m.quantizeWholeIqd(m.parseIqd(input),policy),m.parseIqd(want));
 }
 assert.throws(()=>m.quantizeWholeIqd(minor(Number.MAX_SAFE_INTEGER),policy),m.MoneyError);
});
