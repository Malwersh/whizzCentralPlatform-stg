'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const policy=require('../../order-service/legacy-order-policy');
const {input}=require('./helpers/driver-offer-fixture.cjs');
const {prepareDriverOfferFinancialSnapshot,createStagingDriverOfferOrderReader}=require('../dist/driverOfferOrderReader');
function fixture(){return {PK:'ORDER#order1',SK:'META',orderId:'order1',storeId:'branch1',merchantId:'merchant1',status:'preparing',orderStatus:'confirmed',storeStatus:'branch1#preparing#b3',financialSnapshot:prepareDriverOfferFinancialSnapshot(input().order)};}
test('existing merchant ready action produces exactly the financial dispatch reader contract without repricing',async()=>{
 const row=fixture(),before=structuredClone(row.financialSnapshot),op={Update:{UpdateExpression:'SET #status=:status, storeStatus=:storeStatus',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':status':'ready',':storeStatus':'branch1#ready#b3'}}};
 policy.fenceMerchantOrderOperation(op,row);policy.canonicalFinancialPreparation(op,row);
 row.status=op.Update.ExpressionAttributeValues[':status'];row.orderStatus=row.status;row.storeStatus=op.Update.ExpressionAttributeValues[':storeStatus'];
 const result=await createStagingDriverOfferOrderReader({db:{async send(){return {Item:row};}}}).read({orderId:'order1',branchId:'branch1'});
 assert.equal(row.status,'ready_for_pickup');assert.equal(row.orderStatus,'ready_for_pickup');assert.equal(row.storeStatus,'branch1#ready_for_pickup#b3');assert.deepEqual(row.financialSnapshot,before);assert.deepEqual(result.snapshot,before.snapshot);
});
test('readiness cannot bypass an assignment, return or terminal outcome and legacy ready is unchanged',()=>{
 for(const patch of [{driverId:'driver1'},{financialAcceptance:{schemaVersion:1}},{returnStatus:'RETURNING'},{financialOutcome:'done'}]){
  const row={...fixture(),...patch};assert.throws(()=>policy.fenceMerchantOrderOperation({Update:{ExpressionAttributeValues:{':status':'ready'}}},row),/WORKFLOW_REQUIRED/);
 }
 const op={Update:{UpdateExpression:'SET #status=:status',ExpressionAttributeValues:{':status':'ready'}}};policy.canonicalFinancialPreparation(op,{status:'preparing'});assert.equal(op.Update.ExpressionAttributeValues[':status'],'ready');
});
