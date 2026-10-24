'use strict';
// Shared server contract. Acceptance time and preparation time are separate.
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const instant=v=>{const n=Date.parse(v);if(!Number.isFinite(n))fail('INVALID_ORDER_TIME');return n;};
function settings(value){
 const v=value??{};
 if(v.schemaVersion!==undefined&&v.schemaVersion!==1)fail('INVALID_RECEPTION_SETTINGS');
 const prep=v.defaultPreparationMinutes??20;
 if(!Number.isInteger(prep)||prep<5||prep>120||v.autoAccept!==undefined&&typeof v.autoAccept!=='boolean')fail('INVALID_RECEPTION_SETTINGS');
 return {schemaVersion:1,acceptanceSeconds:300,defaultPreparationMinutes:prep,autoAccept:v.autoAccept===true};
}
function pendingFields(order,branch,platform){
 const seconds=platform?.values?.merchantAcceptanceSeconds??300;
 if(!Number.isSafeInteger(seconds)||seconds<60||seconds>1800)fail('INVALID_PLATFORM_ACCEPTANCE_TIME');
 const p={...settings(branch?.orderReceptionSettings),acceptanceSeconds:seconds,platformPolicyVersion:platform?.version??0},created=instant(order.createdAt);
 return {merchantAcceptanceDeadlineAt:new Date(created+p.acceptanceSeconds*1000).toISOString(),merchantResponsePolicy:p};
}
function deadline(order){return order.merchantAcceptanceDeadlineAt??new Date(instant(order.createdAt)+300000).toISOString();}
function preparationMinutes(value){if(!Number.isInteger(value)||value<5||value>120)fail('INVALID_PREPARATION_TIME');return value;}
function acceptanceFields(order,minutes,now){
 const at=instant(now);minutes=preparationMinutes(minutes);
 if(order.status!=='pending')fail('ORDER_ALREADY_HANDLED',409);
 if(at>=instant(deadline(order)))fail('MERCHANT_RESPONSE_EXPIRED',409);
 const ready=at+minutes*60000,seconds=order.deliveryQuote?.route?.durationSeconds;
 const fields={estimatedPreparationTime:minutes,estimatedReadyAt:new Date(ready).toISOString(),merchantRespondedAt:now,merchantAcceptanceDeadlineAt:deadline(order)};
 // Route time is from the saved server quote. Do not fabricate an ETA when it is absent.
 if(Number.isSafeInteger(seconds)&&seconds>0&&seconds<=86400){
  const earliest=ready+seconds*1000;
  Object.assign(fields,{estimatedDeliveryTime:new Date(earliest).toISOString(),deliveryEstimate:{schemaVersion:1,basis:'PREPARATION_AND_SAVED_ROUTE',updatedAt:now,preparationMinutes:minutes,deliverySeconds:seconds,earliestAt:new Date(earliest).toISOString(),latestAt:new Date(earliest+300000).toISOString(),driverWaitIncluded:false}});
 }
 return fields;
}
function applyAcceptance(operation,order,minutes,now){
 const fields=acceptanceFields(order,minutes,now);
 operation.ExpressionAttributeNames={...operation.ExpressionAttributeNames,'#mrStatus':'status','#mrDeadline':'merchantAcceptanceDeadlineAt'};
 operation.ExpressionAttributeValues={...operation.ExpressionAttributeValues,':mrPending':'pending',':mrNow':now};
 let fence='#mrStatus=:mrPending';
 if(order.merchantAcceptanceDeadlineAt){operation.ExpressionAttributeValues[':mrDeadline']=order.merchantAcceptanceDeadlineAt;fence+=' AND #mrDeadline=:mrDeadline AND #mrDeadline>:mrNow';}
 else {fence+=' AND attribute_not_exists(#mrDeadline)';}
 // A second operator cannot overwrite an accepted preparation time.
 operation.ConditionExpression=(operation.ConditionExpression?'('+operation.ConditionExpression+') AND ':'')+fence;
 const expanded=(operation.UpdateExpression??'').replace(/#[A-Za-z0-9_]+/g,k=>operation.ExpressionAttributeNames[k]??k);
 for(const [i,[key,value]] of Object.entries(fields).entries()){
  if(new RegExp('\\b'+key+'\\s*=').test(expanded))continue;
  operation.ExpressionAttributeNames['#mr'+i]=key;operation.ExpressionAttributeValues[':mr'+i]=value;
  operation.UpdateExpression+=', #mr'+i+'=:mr'+i;
 }
 return operation;
}
module.exports={settings,pendingFields,deadline,preparationMinutes,acceptanceFields,applyAcceptance};
