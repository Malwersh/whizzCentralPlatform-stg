'use strict';
// Server-side policy shared by the application-specific adapters.
// No client-provided balance, ownership, or verification flag is trusted.
const TYPES=new Set(['CUSTOMER','DRIVER','MERCHANT','STAFF']);
const error=code=>Object.assign(new Error(code),{code});
function target(actor,scope){
 if(!actor?.sub||!TYPES.has(actor.type))throw error('UNAUTHORIZED');
 if(!scope||!['ACCOUNT','BUSINESS','MEMBERSHIP'].includes(scope.kind))throw error('INVALID_SCOPE');
 if(actor.type!=='MERCHANT'&&scope.kind!=='ACCOUNT')throw error('INVALID_SCOPE');
 if(scope.kind==='ACCOUNT')return {kind:'ACCOUNT',id:actor.sub,type:actor.type};
 const businessId=scope.businessId ?? (scope.type===actor.type?scope.id:undefined);
 if(scope.businessId&&scope.id&&scope.businessId!==scope.id)throw error('INVALID_SCOPE');
 if(typeof businessId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(businessId))throw error('INVALID_SCOPE');
 return {kind:scope.kind,id:businessId,type:actor.type};
}
function blockers(actor,scope,evidence){
 if(!evidence||evidence.complete!==true)throw error('EVIDENCE_UNAVAILABLE');
 const issues=[];
 if(scope.kind==='BUSINESS'&&!evidence.isOwner)throw error('OWNER_REQUIRED');
 if(scope.kind==='MEMBERSHIP'&&evidence.isOwner)throw error('OWNERSHIP_TRANSFER_REQUIRED');
 if(scope.kind==='MEMBERSHIP'&&!evidence.isMember)throw error('MEMBERSHIP_REQUIRED');
 if(scope.kind==='ACCOUNT'&&actor.type==='MERCHANT'&&evidence.ownedBusinesses?.length)issues.push({code:'OWNED_BUSINESSES',action:'TRANSFER_OR_CLOSE_BUSINESSES'});
 if(actor.type==='STAFF'&&evidence.lastRequiredAdministrator)issues.push({code:'ADMIN_HANDOVER',action:'ASSIGN_SUCCESSOR'});
 if(evidence.activeOrders?.length)issues.push({code:'ACTIVE_ORDERS',action:actor.type==='DRIVER'?'FINISH_OR_REASSIGN':'RESOLVE_ORDERS'});
 if(evidence.pendingTransfers?.length)issues.push({code:'PENDING_TRANSFERS',action:'RESOLVE_TRANSFERS'});
 if(evidence.externalAssets?.length)issues.push({code:'EXTERNAL_ASSET_ACCESS_REQUIRED',action:'VERIFY_LEGACY_STORAGE_ACCESS'});
 if(evidence.pendingPayments?.length)issues.push({code:'PENDING_PAYMENTS',action:'RESOLVE_PAYMENTS'});
 if(evidence.activeHolds?.length)issues.push({code:'ACTIVE_HOLDS',action:'RESOLVE_ORDER_HOLDS'});
 for(const wallet of evidence.wallets||[]){
  if(!Number.isSafeInteger(wallet.available)||!Number.isSafeInteger(wallet.locked))throw error('EVIDENCE_UNAVAILABLE');
  if(wallet.available!==0)issues.push({code:wallet.available<0?'AMOUNT_DUE':'REFUND_REQUIRED',walletId:wallet.walletId,amount:wallet.available,action:'FINANCIAL_SETTLEMENT'});
  if(wallet.locked!==0)issues.push({code:'LOCKED_BALANCE',walletId:wallet.walletId,amount:wallet.locked,action:'RESOLVE_ORDER_HOLDS'});
 }
 return issues;
}
function decision(issues,settings){
 if(issues.length&&issues.every(i=>i.code==='EXTERNAL_ASSET_ACCESS_REQUIRED'))return 'PENDING_EXTERNAL_ASSET';
 if(issues.length)return 'PENDING_SETTLEMENT';
 if(!settings?.inventoryApproved||!settings?.retentionPolicyVersion)return 'PENDING_POLICY';
 return 'READY'; // No mandatory cooling-off period.
}
function canFinish(request,steps){
 return request.status==='PROCESSING'&&request.requiredSteps.every(step=>steps[step]?.status==='COMPLETED');
}
function receipt(request){
 return {requestId:request.requestId,scope:request.scope,status:request.status,blockers:request.blockers||[],policyVersion:request.policyVersion,createdAt:request.createdAt,updatedAt:request.updatedAt};
}
module.exports={target,blockers,decision,canFinish,receipt,error};
