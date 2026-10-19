const {test}=require('node:test'),assert=require('node:assert/strict');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createStagingDriverOfferContext}=require('../dist/driverOfferContext');
const {createStagingDriverFinancialWave}=require('../dist/driverFinancialWave');
const {createStagingDriverOfferAcceptance}=require('../dist/driverOfferAcceptance');
const {prepareDriverOfferFinancialSnapshot:envelope}=require('../dist/driverOfferOrderReader');
const {input,at,route}=require('./helpers/driver-offer-fixture.cjs');
const {quoteCanonical}=require('../dist/deliveryQuoteRecord');
const clone=structuredClone;
const {setup}=require('./helpers/driver-financial-fixture.cjs');
test('wave persists both offers, advances once, emits allowlisted exact terms and acknowledges delivery',async()=>{
 const f=setup();await f.run();assert.equal(f.sent.length,2);
 assert.equal(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}).currentWaveNumber,1);
 assert.deepEqual(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1'}).delivered,['driver1','driver2']);
 assert.equal(f.sent[0].message.offer.driverWalletHold.minorAmount,10500000);
 for(const secret of ['driverSubjectId','source','policyVersion','allocation','merchantCommission'])assert.equal(f.sent[0].message.offer[secret],undefined);
 await f.run();assert.equal(f.sent.length,2);
});
test('send failure retains durable proposal and reuses same event instead of repricing on resume',async()=>{
 const f=setup();f.failSend=true;await assert.rejects(f.run());
 const offer=f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).financialOffer;
 f.failSend=false;f.time+=1000;await f.run();assert.equal(f.sent[0].message.eventId,offer.offerId);assert.equal(f.sent[0].message.offer.offerDigest,offer.digest);
});
test('acceptance atomically assigns order/job/driver, locks H, writes two ledger rows and audit without crediting E or tip',async()=>{
 const f=setup();await f.run();const r=await f.accept();assert.equal(r.holdAmount,10500);
 const wallet=f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'});assert.equal(wallet.availableBalance,9500);assert.equal(wallet.lockedBalance,10500);
 const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});assert.equal(order.status,'assigned');assert.equal(order.driverId,'driver1');assert.equal(order.financialAcceptance.driverTip.minorAmount,1000000);
 const hold=f.get('staging-Holds',{orderId:'order1',sk:'HOLD'});assert.equal(hold.financialSchemaVersion,2);assert.equal(hold.expiresAt,undefined);
 const ledger=[...f.rows.entries()].filter(([k])=>k.startsWith('staging-LedgerEntries|')).map(([,r])=>r);assert.equal(ledger.length,2);assert.equal(ledger.reduce((sum,r)=>sum+r.amount,0),0);
 assert.equal(f.get('staging-WalletLifecycle',{operationId:r.holdId}).status,'REVIEW_REQUIRED');
});
test('two drivers accepting concurrently produce one winner and one hold',async()=>{
 const f=setup();await f.run();const result=await Promise.allSettled([f.accept('driver1'),f.accept('driver2')]);assert.equal(result.filter(v=>v.status==='fulfilled').length,1);
 const wallets=['driver1','driver2'].map(d=>f.get('staging-Wallets',{walletId:'WALLET#DRIVER#'+d,sk:'META'}));assert.equal(wallets.reduce((n,w)=>n+w.lockedBalance,0),10500);
});
test('lost acknowledgement and replay after expiry return original receipt without another debit',async()=>{
 const f=setup();await f.run();f.loseAcceptance=true;const first=await f.accept();assert.equal(first.replayed,true);
 f.time+=3600000;const next=await f.accept();assert.equal(next.holdId,first.holdId);assert.equal(next.replayed,true);
 assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).version,2);
});
test('insufficient balance, fractional H and existing hold do not assign or write money',async()=>{
 for(const kind of ['balance','hold','fraction']){
  const f=setup(kind==='fraction'?'2500.001':'3000');await f.run();
  if(kind==='balance')f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).availableBalance=100;
  if(kind==='hold')f.put('staging-Holds',{orderId:'order1',sk:'HOLD',status:'RELEASED',holdId:'old'});
  await assert.rejects(f.accept());assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'ready_for_pickup');
  assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).lockedBalance,0);
 }
});
test('policy revocation, driver/branch/deletion races and audit failure roll back assignment and debit',async()=>{
 for(const mutation of ['policy','driver','branch','delete','audit']){
  const f=setup();await f.run();f.beforeCommit=tx=>{
   if(!tx.some(o=>o.Put?.Item.action==='FINANCIAL_DRIVER_OFFER_ACCEPTED'))return;
   if(mutation==='policy')f.get('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#DELIVERY_PRICING',sk:'CURRENT'}).version++;
   if(mutation==='driver')f.get('WhizzDrivers_staging',{driverId:'driver1'}).status='SUSPENDED';
   if(mutation==='branch')f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).ownerId='other';
   if(mutation==='delete')f.put('staging-AccountDeletion',{pk:'ACCOUNT_LIFECYCLE#DRIVER#driver1',sk:'META'});
   if(mutation==='audit'){const q=tx.find(o=>o.Put?.Item.action==='FINANCIAL_DRIVER_OFFER_ACCEPTED').Put;f.put(q.TableName,q.Item);}
  };
  await assert.rejects(f.accept());assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'ready_for_pickup');assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).lockedBalance,0);
 }
});
test('client hold/identity injection is rejected; expired waves cannot accept, and timeout cannot undo a winner',async()=>{
 const f=setup();await f.run();await assert.rejects(f.accept('driver1',{holdAmount:1}));
 f.time+=61000;const expired=await f.wave.expire('order1',1);assert.equal(expired.expired,true);await assert.rejects(f.accept());
 const g=setup();await g.run();await g.accept();g.time+=61000;assert.equal((await g.wave.expire('order1',1)).assigned,true);
});
test('zero candidates advance an empty wave without creating offers or wallet mutations',async()=>{
 const f=setup();await f.run([]);assert.equal(f.sent.length,0);assert.equal((await f.wave.expire('order1',1)).expired,true);
 assert.ok(![...f.rows.keys()].some(k=>k.startsWith('staging-Holds|')));
});
test('atomic H follows each COD earning case; later earning is not credited during acceptance',async()=>{
 for(const [earning,hold] of [['2500',11000],['4000',10500]]){
  const f=setup(earning);await f.run();const r=await f.accept();assert.equal(r.holdAmount,hold);
  const wallet=f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'});assert.equal(wallet.availableBalance,20000-hold);assert.equal(wallet.lockedBalance,hold);
 }
});
test('zero-H COD requires an active wallet but does not create a hold or ledger debit',async()=>{
 const f=setup();const s=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).financialSnapshot.snapshot;
 const m=require('../dist/money').parseIqd;s.allocation.goodsGross=m('0');s.allocation.serviceFee=m('0');s.confirmedCustomerTotal=m('4000');
 f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).financialSnapshot=envelope(s);
 await f.run();const r=await f.accept();assert.equal(r.holdAmount,0);assert.equal(r.holdId,null);assert.equal(r.holdStatus,'NOT_REQUIRED');
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}),undefined);assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).version,1);
});

test('declining a financial offer never touches the wallet and cannot later win; timeout tolerates declined records',async()=>{
 const f=setup();await f.run();assert.equal((await f.decline()).declined,true);assert.equal((await f.decline()).declined,true);
 await assert.rejects(f.accept());assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).version,1);
 f.time+=61000;assert.equal((await f.wave.expire('order1',1)).expired,true);
});

test('deployed older context still includes canonical preparation in assigned ETA and fences its race',async()=>{
 const {createStagingDriverOfferAcceptance:create}=require('../dist/driverOfferAcceptance');
 for(const race of [false,true]){
  const f=setup();const o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});o.estimatedReadyAt=new Date(f.time+20*60000).toISOString();await f.run();
  const legacy={...f.context,async checkAcceptance(input){const r=await f.context.checkAcceptance(input);delete r.order.estimatedReadyAt;return r;}};
  const engine=create({db:f.db,context:legacy,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})});
  const input={orderId:'order1',waveNumber:1,offerId:f.sent[0].message.offer.offerId};
  if(race){f.beforeCommit=()=>{o.estimatedReadyAt=new Date(f.time+30*60000).toISOString();};await assert.rejects(engine.accept(input));assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).lockedBalance,0);}
  else {await engine.accept(input);const assigned=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});assert(Date.parse(assigned.estimatedDeliveryTime)>Date.parse(o.estimatedReadyAt));assert.equal(assigned.deliveryEstimate.driverWaitIncluded,true);}
 }
});
