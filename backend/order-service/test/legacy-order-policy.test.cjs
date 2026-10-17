'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const p=require('../legacy-order-policy');
function update(target){return {Update:{UpdateExpression:'SET #status=:status',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':status':target},ConditionExpression:'owner=:owner'}};}
test('all current and archived financial markers, including null, block a legacy workflow',()=>{
 for(const field of p.FINANCIAL_FIELDS){assert.equal(p.isFinancialOrder({[field]:null}),true);assert.ok(p.LEGACY_ONLY.includes('attribute_not_exists('+field+')'));}
 assert.equal(p.isFinancialOrder({orderId:'legacy'}),false);
});
test('merchant preparation remains available before assignment and pins financial sources and current state in the same Update',()=>{
 const row={financialSnapshot:{digest:'frozen'},commercialPricing:{agreement:'one'},status:'pending'};const item=update('confirmed');
 p.fenceMerchantOrderOperation(item,row);assert.ok(item.Update.ConditionExpression.startsWith('(owner=:owner) AND '));
 assert.ok(Object.values(item.Update.ExpressionAttributeValues).some(v=>v===row.financialSnapshot));assert.ok(Object.values(item.Update.ExpressionAttributeValues).includes('pending'));
 for(const status of ['confirmed','preparing','ready'])assert.equal(p.preparationAllowed({...row,status},status),true);
});
test('merchant cannot complete/cancel/reject, roll back, write/delete a financial record or touch an assigned/returning/archived order',()=>{
 const row={financialSnapshot:{},status:'pending'};
 for(const status of ['delivered','completed','cancelled','rejected','on_the_way','returned'])assert.throws(()=>p.fenceMerchantOrderOperation(update(status),row),e=>e.statusCode===409);
 for(const patch of [{financialAcceptance:{}},{financialOutcome:null},{codFinancialEvidence:{}},{driverId:'d'},{returnCaseId:'return'},{holdStatus:'ACTIVE'},{deletionRequestId:'gone'},{status:'preparing'}])assert.throws(()=>p.fenceMerchantOrderOperation(update('confirmed'),{...row,...patch}),/WORKFLOW_REQUIRED/);
 for(const verb of ['Put','Delete'])assert.throws(()=>p.fenceMerchantOrderOperation({[verb]:{}},row),/WORKFLOW_REQUIRED/);
});
test('legacy merchant writes retain their existing condition and add financial evidence absence fences',()=>{
 const item=update('confirmed');p.fenceMerchantOrderOperation(item,{status:'pending'});assert.equal(item.Update.ConditionExpression,'(owner=:owner) AND '+p.LEGACY_ONLY);
});
test('completed and returned are terminal while return in progress and unknown states stay active',()=>{
 for(const status of ['completed','returned','DELIVERED','canceled_by_user','cancelled_by_store'])assert.equal(p.isTerminalOrderStatus(status),true);
 for(const status of ['returning','return_arrived','assigned','unknown',undefined])assert.equal(p.isTerminalOrderStatus(status),false);
});

test('financial ready synchronizes stored states and branch bucket while keeping immutable financial fences',()=>{
 const row={status:'preparing',orderStatus:'confirmed',financialSnapshot:{digest:'frozen'}};
 const item=update('ready');item.Update.ExpressionAttributeValues[':storeStatus']='branch#ready#b7';p.fenceMerchantOrderOperation(item,row);
 assert.equal(p.canonicalFinancialPreparation(item,row),'ready_for_pickup');assert.equal(item.Update.ExpressionAttributeValues[':status'],'ready_for_pickup');assert.equal(item.Update.ExpressionAttributeValues[':storeStatus'],'branch#ready_for_pickup#b7');assert.match(item.Update.UpdateExpression,/#lfCanonicalOrderStatus=:status/);
 assert.ok(Object.values(item.Update.ExpressionAttributeValues).includes('preparing'));assert.equal(row.status,'preparing');
});
test('legacy ready is unchanged and malformed financial branch index or duplicate status assignment fails closed',()=>{
 const legacy=update('ready'),original=structuredClone(legacy);assert.equal(p.canonicalFinancialPreparation(legacy,{status:'preparing'}),'ready');assert.deepEqual(legacy,original);
 for(const value of [undefined,'branch#delivered#b7','branch#ready#unbounded']){const item=update('ready');item.Update.ExpressionAttributeValues[':storeStatus']=value;assert.throws(()=>p.canonicalFinancialPreparation(item,{status:'preparing',financialSnapshot:{}}),/WORKFLOW_REQUIRED/);}
 const duplicate=update('ready');duplicate.Update.UpdateExpression+=', orderStatus=:other';assert.throws(()=>p.canonicalFinancialPreparation(duplicate,{status:'preparing',financialSnapshot:{}}),/WORKFLOW_REQUIRED/);
});
