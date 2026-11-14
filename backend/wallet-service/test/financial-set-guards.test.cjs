const {test}=require('node:test');const assert=require('node:assert/strict');
const {strongGet,exactCheck,financialTransactionToken}=require('../dist/driverFinancialTransaction');
const {marshall}=require('@aws-sdk/util-dynamodb');
test('strong financial reads and exact guards preserve DynamoDB string sets as SS',async()=>{
 const original={PK:'ORDER#o',SK:'META',deliveryProofIds:new Set(['proof-a']),deliveryProofs:[{proofId:'proof-a'}]};
 const row=await strongGet({send:async()=>({Item:original})},'orders',{PK:original.PK,SK:original.SK});
 assert.ok(row.deliveryProofIds instanceof Set);assert.notEqual(row.deliveryProofIds,original.deliveryProofIds);
 const check=exactCheck('orders',{PK:original.PK,SK:original.SK},row).ConditionCheck;
 const alias=Object.entries(check.ExpressionAttributeNames).find(([,v])=>v==='deliveryProofIds')[0];
 const key=':v'+alias.slice(2),value=check.ExpressionAttributeValues[key];
 assert.ok(value instanceof Set);assert.deepEqual(marshall({value}).value,{SS:['proof-a']});
 value.add('probe');assert.deepEqual([...original.deliveryProofIds],['proof-a']);
});
test('transaction tokens distinguish changed proof sets and maps and ignore set insertion order',()=>{
 const ops=ids=>[{ConditionCheck:{TableName:'orders',ExpressionAttributeValues:{':proofs':ids}}}];
 assert.equal(financialTransactionToken(ops(new Set(['a','b']))),financialTransactionToken(ops(new Set(['b','a']))));
 assert.notEqual(financialTransactionToken(ops(new Set(['a']))),financialTransactionToken(ops(new Set(['b']))));
 assert.notEqual(financialTransactionToken(ops(new Set(['a']))),financialTransactionToken(ops({})));
 assert.equal(financialTransactionToken(ops(new Set(['a']))).length,36);
});
