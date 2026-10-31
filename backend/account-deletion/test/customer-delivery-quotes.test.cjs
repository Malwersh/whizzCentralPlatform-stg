const {test}=require('node:test'),assert=require('node:assert/strict');
const {purge}=require('../customer-delivery-quotes');
function fixture(){
 const rows=Array.from({length:23},(_,i)=>({pk:'CUSTOMER#legacy',sk:'QUOTE#'+i,subjectId:'sub',digest:'digest'+i}));
 const foreign={pk:'CUSTOMER#other',sk:'QUOTE#foreign',subjectId:'other',digest:'other'};rows.push(foreign);
 const calls=[];let fail=false;
 const db={send:async c=>{calls.push(c.input);if(c.input.KeyConditionExpression){const mine=rows.filter(r=>r.pk===c.input.ExpressionAttributeValues[':pk']);return {Items:structuredClone(mine.slice(0,20)),...(mine.length>20?{LastEvaluatedKey:{pk:mine[19].pk,sk:mine[19].sk}}:{})};}
  if(fail)throw Error('lease lost or retention changed');
  for(const a of c.input.TransactItems)if(a.Delete){const i=rows.findIndex(r=>r.pk===a.Delete.Key.pk&&r.sk===a.Delete.Key.sk);rows.splice(i,1);}return {};}};
 const r={actorType:'CUSTOMER',scope:{kind:'ACCOUNT',id:'sub'},subjectId:'sub',requestId:'request',pk:'CUSTOMER#sub',sk:'REQUEST#request',leaseOwner:'worker',version:3};
 const job={subjectId:'sub',requestId:'request',profileIds:['legacy']};
 return {rows,calls,r,job,run:(extra={})=>purge({db,r,job,clock:()=> '2026-10-15T12:00:00.000Z',...extra}),fail:()=>{fail=true;}};
}
test('customer quote purge restarts at partition head, checks profile lock and lease, preserves other customer',async()=>{
 const f=fixture();await f.run();assert.equal(f.rows.length,1);assert.equal(f.rows[0].pk,'CUSTOMER#other');
 const tx=f.calls.filter(c=>c.TransactItems);assert.equal(tx.length,2);assert.equal(tx[0].TransactItems.length,22);
 for(const t of tx){assert.match(t.TransactItems[0].ConditionCheck.ConditionExpression,/leaseUntil/);assert.equal(t.TransactItems[0].ConditionCheck.ExpressionAttributeValues[':processing'],'PROCESSING');assert.deepEqual(t.TransactItems[1].ConditionCheck.Key,{userId:'legacy'});assert.equal(t.TransactItems[1].ConditionCheck.ExpressionAttributeValues[':request'],'request');for(const a of t.TransactItems.slice(2)){assert.match(a.Delete.ConditionExpression,/retentionHold/);assert.match(a.Delete.ConditionExpression,/#digest/);}}
 await f.run();assert.equal(f.calls.filter(c=>c.TransactItems).length,2);
});
test('retention hold blocks deletion and a late hold or lost lease fails the transaction',async()=>{
 const f=fixture();f.rows[0].retentionHold=true;await assert.rejects(f.run(),/DOCUMENTED_RETENTION_HOLD/);assert.equal(f.rows.length,24);assert.ok(!f.calls.some(c=>c.TransactItems));
 const g=fixture();g.fail();await assert.rejects(g.run(),/lease lost/);assert.equal(g.rows.length,24);
});
test('foreign identity, scope or partition cannot be purged',async()=>{
 const f=fixture();f.rows[0].subjectId='replacement';await assert.rejects(f.run(),/INVALID_CLEANUP_SCOPE/);assert.equal(f.rows.length,24);
 const g=fixture();g.r.scope.id='other';await assert.rejects(g.run(),/INVALID_CLEANUP_SCOPE/);assert.equal(g.calls.length,0);
});
test('bounded purge reports incomplete work; next call resumes remaining partition',async()=>{
 const f=fixture();await assert.rejects(f.run({maxPages:1}),/INVENTORY_INCOMPLETE/);assert.equal(f.rows.length,4);await f.run();assert.equal(f.rows.length,1);
});
test('consumed quotes are removed with personal data without touching their order',async()=>{
 const f=fixture();f.rows[0].consumption={orderId:'existing-order',requestId:'attempt',requestHash:'hash',consumedAt:'2026-10-15T12:00:00.000Z'};
 await f.run();assert.equal(f.rows.length,1);assert.ok(f.calls.filter(c=>c.TransactItems).every(c=>c.TransactItems.every(a=>!a.Delete||a.Delete.TableName==='staging-DeliveryQuotes')));
});

test('quota row is purged with customer under lease and holds without touching another partition',async()=>{
 const f=fixture();f.rows.unshift({pk:'CUSTOMER#legacy',sk:'RATE#DELIVERY_QUOTE',subjectId:'sub',digest:'quota',version:2,count:1});
 await f.run();assert.equal(f.rows.length,1);assert.equal(f.rows[0].pk,'CUSTOMER#other');
 const deletion=f.calls.flatMap(c=>c.TransactItems||[]).find(a=>a.Delete?.Key.sk==='RATE#DELIVERY_QUOTE').Delete;
 assert.equal(deletion.ExpressionAttributeValues[':digest'],'quota');assert.match(deletion.ConditionExpression,/subjectId=:sub/);
 const held=fixture();held.rows.unshift({pk:'CUSTOMER#legacy',sk:'RATE#DELIVERY_QUOTE',subjectId:'sub',digest:'quota',retentionHold:true});
 await assert.rejects(held.run(),e=>e.code==='DOCUMENTED_RETENTION_HOLD');
 const other=fixture();other.rows[0].sk='RATE#OTHER';await assert.rejects(other.run(),e=>e.code==='INVALID_CLEANUP_SCOPE');
});
