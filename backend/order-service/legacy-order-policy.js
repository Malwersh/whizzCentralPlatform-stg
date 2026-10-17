'use strict';
// Shared transition fence. Presence, including null, keeps archived/malformed financial evidence protected.
const FINANCIAL_FIELDS=Object.freeze(['financialSnapshot','commercialPricing','financialAcceptance','financialOutcome','codFinancialEvidence']);
const LEGACY_ONLY=FINANCIAL_FIELDS.map(k=>'attribute_not_exists('+k+')').join(' AND ');
const owns=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
const isFinancialOrder=o=>FINANCIAL_FIELDS.some(k=>owns(o,k));
const isTerminalOrderStatus=value=>typeof value==='string'&&(['delivered','completed','returned','cancelled','canceled','failed','expired','rejected'].includes(value.toLowerCase())||/^(canceled|cancelled)_by_/.test(value.toLowerCase()));
function workflowRequired(){return Object.assign(Error('FINANCIAL_ORDER_WORKFLOW_REQUIRED'),{code:'FINANCIAL_ORDER_WORKFLOW_REQUIRED',statusCode:409,status:409});}
function addCondition(operation,condition){operation.ConditionExpression=(operation.ConditionExpression?'('+operation.ConditionExpression+') AND ':'')+condition;return operation;}
function preparationAllowed(record,target){
 const graph={pending:['confirmed'],confirmed:['preparing','in_kitchen','ready','ready_for_pickup'],preparing:['ready','ready_for_pickup'],in_kitchen:['ready','ready_for_pickup'],ready:['ready_for_pickup'],ready_for_pickup:[]};
 return owns(record,'financialSnapshot')&&record.financialSnapshot!=null&&!['financialOutcome','codFinancialEvidence'].some(k=>owns(record,k))&&
 record.holdId==null&&!['ACTIVE','SETTLED','CAPTURED'].includes(record.holdStatus)&&record.deletionRequestId==null&&record.deletedAt==null&&record.isDeleted!==true&&
 ['financialAcceptance','driverId','assignedDriverId','returnCaseId','returnStatus','cancellationRequestId','cancellationStatus'].every(k=>record[k]==null)&&
 Array.isArray(graph[record.status])&&(record.status===target||graph[record.status].includes(target));
}
// Caller provides an already branch-scoped strongly consistent record. Applied to Update itself, never a separate ConditionCheck.
function fenceMerchantOrderOperation(item,record){
 const op=item.Update||item.Put||item.Delete||item.ConditionCheck;
 if(!isFinancialOrder(record))return addCondition(op,LEGACY_ONLY);
 const target=op.ExpressionAttributeValues?.[':status'];
 if(!item.Update||!preparationAllowed(record,target))throw workflowRequired();
 // Prevent a concurrent accept/return/completion or reassignment from turning this into a stale preparation write.
 const fields=['status','orderStatus',...FINANCIAL_FIELDS,'driverId','assignedDriverId','assignmentAttemptCounter','holdId','holdStatus','returnCaseId','returnStatus','cancellationRequestId','cancellationStatus','deletionRequestId','deletedAt','isDeleted'];
 op.ExpressionAttributeNames={...op.ExpressionAttributeNames};op.ExpressionAttributeValues={...op.ExpressionAttributeValues};
 const conditions=fields.map((k,i)=>{const n='#lf'+i;op.ExpressionAttributeNames[n]=k;if(!owns(record,k))return 'attribute_not_exists('+n+')';const v=':lf'+i;op.ExpressionAttributeValues[v]=record[k];return n+'='+v;});
 return addCondition(op,conditions.join(' AND '));
}
// Normalize only financial preparation. The UI action remains "ready"; the stored dispatch contract is canonical.
function canonicalFinancialPreparation(item,record){
 const op=item.Update,target=op?.ExpressionAttributeValues?.[':status'];
 if(!isFinancialOrder(record))return target;
 if(!op||!preparationAllowed(record,target))throw workflowRequired();
 const canonical=['ready','ready_for_pickup'].includes(target)?'ready_for_pickup':target;
 if(!/^SET\s/i.test(op.UpdateExpression)||/\b(?:REMOVE|ADD|DELETE)\b/.test(op.UpdateExpression))throw workflowRequired();
 const expanded=op.UpdateExpression.replace(/#[A-Za-z0-9_]+/g,k=>op.ExpressionAttributeNames?.[k]||k);
 if(/\borderStatus\s*=/.test(expanded)){
  if(!/\borderStatus\s*=\s*:status\b/.test(expanded))throw workflowRequired();
 }else{
  if(op.ExpressionAttributeNames?.['#lfCanonicalOrderStatus']&&op.ExpressionAttributeNames['#lfCanonicalOrderStatus']!=='orderStatus')throw workflowRequired();
  op.ExpressionAttributeNames={...op.ExpressionAttributeNames,'#lfCanonicalOrderStatus':'orderStatus'};
  op.UpdateExpression+=', #lfCanonicalOrderStatus=:status';
 }
 if(canonical==='ready_for_pickup'){
  const key=op.ExpressionAttributeValues[':storeStatus'];
  if(typeof key!=='string'||!/#(?:ready|ready_for_pickup)#b[0-9]$/.test(key))throw workflowRequired();
  op.ExpressionAttributeValues[':storeStatus']=key.replace(/#(?:ready|ready_for_pickup)#(b[0-9])$/,'#ready_for_pickup#$1');
 }
 op.ExpressionAttributeValues[':status']=canonical;
 return canonical;
}
function driverProgressFence(target){
 const graph={heading_to_store:['assigned','accepted'],arrived_at_store:['heading_to_store'],picked_up:['arrived_at_store'],heading_to_customer:['picked_up'],arrived_at_customer:['heading_to_customer']};
 if(!graph[target])throw workflowRequired();
 const values={':lfSchema':1,':lfNull':null,':lfNotDeleted':false};
 const previous=graph[target].map((v,i)=>{values[':lfPrev'+i]=v;return ':lfPrev'+i;});
 const absent=['returnCaseId','returnStatus','cancellationRequestId','cancellationStatus'].map(k=>'(attribute_not_exists('+k+') OR '+k+'=:lfNull)').join(' AND ');
 return {values,condition:'('+LEGACY_ONLY+') OR (attribute_exists(financialSnapshot) AND financialAcceptance.schemaVersion=:lfSchema AND attribute_not_exists(financialOutcome) AND attribute_not_exists(codFinancialEvidence) AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(isDeleted) OR isDeleted=:lfNotDeleted) AND '+absent+' AND #status IN ('+previous.concat(':status').join(',')+'))'};
}
function customerStatusFilter(kind){
 if(!['active','completed'].includes(kind))throw Error('INVALID_STATUS_FILTER');
 const states=['delivered','completed','returned','cancelled','canceled','failed','expired','rejected'];
 const values={':lfCancelPrefix':'canceled_by_',':lfCancelledPrefix':'cancelled_by_'};
 const refs=states.map((s,i)=>{values[':lfTerminal'+i]=s;return ':lfTerminal'+i;});
 const terminal='(#lfFilterStatus IN ('+refs.join(',')+') OR begins_with(#lfFilterStatus,:lfCancelPrefix) OR begins_with(#lfFilterStatus,:lfCancelledPrefix))';
 return {expression:kind==='completed'?terminal:'(attribute_not_exists(#lfFilterStatus) OR NOT '+terminal+')',names:{'#lfFilterStatus':'status'},values};
}
module.exports={FINANCIAL_FIELDS,LEGACY_ONLY,isFinancialOrder,isTerminalOrderStatus,workflowRequired,preparationAllowed,fenceMerchantOrderOperation,canonicalFinancialPreparation,driverProgressFence,customerStatusFilter};
