'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {proof}=require('./helpers/merchant-accrual-fixture.cjs');
const account=require('../../staff-service/merchant-account');
const filter={branchId:'branch1',fromLocalDate:'2026-10-01',throughLocalDate:'2026-10-31'};
async function setup(){
 const {f}=await proof({commission:10000});
 const db={send:async c=>{
  assert.ok(['GetCommand','QueryCommand'].includes(c.constructor.name),'read-only account');
  if(c.constructor.name==='GetCommand'){const sdk=require('@aws-sdk/lib-dynamodb');return f.db.send(new sdk.GetCommand(c.input));}
  const q=c.input,e=q.ExpressionAttributeValues;assert.equal(q.ConsistentRead,true);
  let items=[...f.rows].filter(([k,r])=>k.startsWith(q.TableName+'|')&&(e[':wallet']?r.walletId===e[':wallet']:r.pk===e[':pk'])&&r.sk>=e[':from']&&r.sk<=e[':until']).map(([,r])=>r).sort((a,b)=>a.sk.localeCompare(b.sk));
  if(q.ScanIndexForward===false)items.reverse();
  if(q.ExclusiveStartKey){const i=items.findIndex(r=>r.sk===q.ExclusiveStartKey.sk);assert.ok(i>=0);items=items.slice(i+1);}
  const page=items.slice(0,q.Limit),last=page.at(-1);return {Items:structuredClone(page),...(items.length>page.length?{LastEvaluatedKey:q.TableName==='staging-LedgerEntries'?{walletId:last.walletId,sk:last.sk}:{pk:last.pk,sk:last.sk}}:{})};
 }};
 return {f,db};
}
test('zero-net delivered order appears without fabricated ledger, money, or payout and preserves merchant privacy',async()=>{
 const {f,db}=await setup(),before=JSON.stringify([...f.rows]);
 const result=await account.read(db,filter,true);assert.equal(result.nextCursor,null);assert.equal(result.additionalCoverage,'INDEXED_ZERO_NET_COMPLETIONS');
 const r=result.items[0];assert.equal(result.items.length,1);assert.equal(r.kind,'ORDER_ACCRUAL');assert.equal(r.evidenceVerified,true);assert.equal(r.state,'NO_PAYOUT_REQUIRED');assert.equal(r.amounts.goodsGross.minorAmount,10000000);assert.equal(r.amounts.merchantCommission.minorAmount,10000000);assert.equal(r.amounts.merchantNet.minorAmount,0);assert.equal(r.amounts.driverWalletHold,undefined);assert.equal(r.payoutId,null);
 assert.equal([...f.rows].filter(([k,r])=>k.startsWith('staging-LedgerEntries|')&&r.walletId==='WALLET#MERCHANT#branch1').length,0);assert.equal(JSON.stringify([...f.rows]),before);
 const central=await account.read(db,filter,false);assert.ok(central.items[0].amounts.driverWalletHold);
});
test('positive completion is not duplicated by supplemental index, zero remains visible in a saved statement',async()=>{
 const {f,db}=await setup(),other=await proof({orderId:'order2'});for(const [k,r]of other.f.rows)if(!k.startsWith('staging-Wallets|'))f.put(k.split('|')[0],r);
 f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).settlementBatchId='MSB:'+'a'.repeat(48);
 const r=await account.read(db,filter,true);assert.equal(r.items.length,2);assert.equal(r.items.filter(x=>x.orderId==='order2').length,1);assert.equal(r.items.find(x=>x.orderId==='order1').state,'NO_PAYOUT_REQUIRED');assert.ok(r.items.every(x=>x.evidenceVerified));
});
test('forged zero source, broken evidence and missing readiness cannot silently enter totals',async()=>{
 const {f,db}=await setup();const index=[...f.rows.values()].find(x=>x.kind==='MERCHANT_ACCRUAL_INDEX_ENTRY');index.digest='bad';await assert.rejects(account.read(db,filter,true),/INDEX_INVALID/);
 const {f:g,db:d}=await setup();g.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).amount=1;const r=await account.read(d,filter,true);assert.equal(r.items[0].kind,'REVIEW_REQUIRED');assert.equal(r.items[0].amounts,undefined);
 g.get('staging-MerchantPlatform',{pk:'SYSTEM#MERCHANT_ACCRUAL_INDEX',sk:'COVERAGE'}).status='INCOMPLETE';await assert.rejects(account.read(d,filter,true),/INDEX_NOT_READY/);
});
test('index-only changes invalidate cursor and final page even when merchant wallet did not change',async()=>{
 const {f,db}=await setup();const original=db.send.bind(db);let inject=false;
 db.send=async c=>{const r=await original(c);if(c.constructor.name==='QueryCommand'&&c.input.TableName==='staging-LedgerEntries')r.LastEvaluatedKey={walletId:'WALLET#MERCHANT#branch1',sk:'ts#2026-10-20T00:00:00.000Z#LOCKED#fake'};if(inject&&c.constructor.name==='QueryCommand'){for(const h of f.rows.values())if(h.kind==='MERCHANT_ACCRUAL_INDEX_HEAD')h.revision++;inject=false;}return r;};
 const first=await account.read(db,filter,true);assert.ok(first.nextCursor);assert.equal(typeof first.sourceRevision,'string');
 const head=[...f.rows.values()].find(x=>x.kind==='MERCHANT_ACCRUAL_INDEX_HEAD'&&x.sk!=='HEAD');head.revision++;
 // Mutate every pinned day ancestor, so the relevant range must change.
 for(const h of f.rows.values())if(h.kind==='MERCHANT_ACCRUAL_INDEX_HEAD')h.revision++;
 await assert.rejects(account.read(db,{...filter,cursor:first.nextCursor},true),/ACCOUNT_CHANGED/);
 inject=true;await assert.rejects(account.read(db,filter,true),/ACCOUNT_CHANGED/);
});
test('bounded supplemental pages advance over positive entries without repeating financial movements',async()=>{
 const {f,db}=await setup(),{merchantAccrualIndexRow}=require('../dist/merchantAccrualIndex');
 const zero=[...f.rows.values()].find(r=>r.kind==='MERCHANT_ACCRUAL_INDEX_ENTRY');
 for(let i=0;i<13;i++)f.put('staging-MerchantPlatform',merchantAccrualIndexRow({branchId:'branch1',orderId:'positive'+String(i).padStart(2,'0'),operationId:'OP:'+i,deliveredAt:zero.deliveredAt,merchantNetIqd:1000,financialSchemaVersion:2}));
 const a=await account.read(db,filter,true);assert.equal(a.items.length,1);assert.ok(a.nextCursor);
 const b=await account.read(db,{...filter,cursor:a.nextCursor},true);assert.equal(b.items.length,0);assert.equal(b.nextCursor,null);assert.equal(b.sourceRevision,a.sourceRevision);
 await assert.rejects(account.read(db,{...filter,branchId:'foreign',cursor:a.nextCursor},true),/INVALID_CURSOR/);
});
