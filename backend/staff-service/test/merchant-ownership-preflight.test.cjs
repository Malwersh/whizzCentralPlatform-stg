'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {createPreflight}=require('../merchant-ownership-preflight');

class Get{constructor(input){this.input=input;}}
class Query{constructor(input){this.input=input;}}
class Scan{constructor(input){this.input=input;}}
const now=1800000000000;
const request={
 requestId:'transfer',organizationId:'org',ownerId:'owner',
 status:'AWAITING_REVIEW',branchIds:['branch'],expiresAt:now+60000,
};
function fixture({incomplete=false}={}){
 const calls=[];
 const walletId='WALLET#MERCHANT#branch';
 const db={async send(command){
  const input=command.input;
  calls.push(input);
  if(command instanceof Scan){
   const rows={
    WizzOrders:[
     {storeId:'branch',status:'preparing'},
     {storeId:'branch',status:'delivered'},
     {storeId:'other-branch',status:'pending'},
    ],
    'staging-Holds':[{walletId,status:'ACTIVE'}],
    'staging-TopupRequests':[{walletId,status:'PENDING_APPROVAL'}],
    'staging-IdempotencyKeys':[{idempotencyKey:'MERCHANT_FINANCE#branch#member',ownerId:'owner',enabled:true}],
   };
   return {Items:rows[input.TableName],...(incomplete?{LastEvaluatedKey:{PK:'more'}}:{})};
  }
  if(command instanceof Query){
   const rows={
    'BRANCH#branch':[{sk:'DEVICE#existing',ownerId:'owner',status:'ACTIVE'}],
    'MERCHANT_PAYOUT#branch':[{sk:'PAYOUT#existing',kind:'MERCHANT_PAYOUT',status:'PENDING_APPROVAL'}],
    'MERCHANT_CORRECTIONS#branch':[],
   };
   return {Items:rows[input.ExpressionAttributeValues[':pk']]};
  }
  if(command instanceof Get){
   return {Item:input.Key.businessId?{
    businessId:'branch',businessName:'مطعم',ownerId:'owner',cognitoUserId:'owner',organizationId:'org',
    orderIntakeTransferRequestId:'transfer',orderIntakeTransferExpiresAt:request.expiresAt,
   }:{walletId,ownerId:'branch',ownerType:'MERCHANT',availableBalance:12000,lockedBalance:0}};
  }
  assert.fail('Preflight must only read');
 }};
 return {calls,run:createPreflight({Get,Query,Scan,maxPages:2}).bind(null,db,request,now)};
}

test('reports only affected-branch blockers and returns financial amounts rather than source records',async()=>{
 const {calls,run}=fixture();
 const result=await run();
 assert.equal(result.branches[0].name,'مطعم');
 const evidence=result.branches[0].blockers;
 assert.deepEqual(evidence.find(item=>item.code==='ACTIVE_ORDERS'),{code:'ACTIVE_ORDERS',count:1});
 assert.deepEqual(evidence.find(item=>item.code==='WALLET_BALANCE'),{code:'WALLET_BALANCE',amount:12000});
 for(const code of ['ACTIVE_HOLDS','PENDING_TOPUPS','ACTIVE_FINANCIAL_GRANTS','ACTIVE_DEVICES','PENDING_PAYOUTS']){
  assert.ok(evidence.some(item=>item.code===code));
 }
 assert.ok(calls.every(input=>input.ConsistentRead===true&&input.ProjectionExpression));
 assert.equal(JSON.stringify(result).includes('member'),false);
});

test('incomplete pagination refuses to return a clear result',async()=>{
 await assert.rejects(fixture({incomplete:true}).run(),/TRANSFER_INVENTORY_INCOMPLETE/);
});
