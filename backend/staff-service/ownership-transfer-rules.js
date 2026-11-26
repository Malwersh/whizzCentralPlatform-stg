'use strict';

const {createHash}=require('node:crypto');

const fail=code=>{throw Object.assign(new Error(code),{code});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const version=value=>Number.isSafeInteger(value)&&value>0;
const windowMs=48*60*60*1000;

// Reads must come from the live organization and its complete branch inventory.
function snapshot(organization,branches,ownerId){
 if(!organization||!id(organization.organizationId)||
    organization.subjectId!==ownerId||!version(organization.version)){
  fail('ORGANIZATION_OWNERSHIP_CHANGED');
 }
 if(!Array.isArray(branches)||!branches.length)fail('BRANCH_INVENTORY_REQUIRED');
 const branchIds=new Set();
 const records=branches.map(branch=>{
  if(!branch||!id(branch.businessId)||!id(branch.brandId)||
     branchIds.has(branch.businessId)||branch.organizationId!==organization.organizationId||
     branch.ownerId!==ownerId||branch.cognitoUserId!==ownerId||
     branch.status!=='approved'||branch.deletionRequestId||
     ['CLOSING','CLOSED','DELETED'].includes(branch.lifecycleStatus)||
     typeof branch.updatedAt!=='string'||!branch.updatedAt){
   fail('BRANCH_OWNERSHIP_CHANGED');
  }
  branchIds.add(branch.businessId);
  return [branch.businessId,branch.brandId,branch.updatedAt];
 }).sort(([left],[right])=>left.localeCompare(right,'en'));
 const digest=createHash('sha256')
  .update(JSON.stringify([organization.organizationId,organization.version,ownerId,records]))
  .digest('hex');
 return {digest,branchIds:records.map(([businessId])=>businessId)};
}

function verifiedSubject(actor){
 if(!actor||!id(actor.sub)||actor.reverified!==true)fail('RECENT_VERIFICATION_REQUIRED');
 return actor.sub;
}

function requireLive(request,now,status){
 if(!request||request.status!==status||!version(request.version))fail('TRANSFER_STATE_CHANGED');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(request.expiresAt)||now>=request.expiresAt){
  fail('TRANSFER_EXPIRED');
 }
}

function propose({actor,recipientId,requestId,organization,branches,now}){
 const ownerId=verifiedSubject(actor);
 if(!id(recipientId)||recipientId===ownerId||!id(requestId)||!Number.isSafeInteger(now)||now<0){
  fail('INVALID_TRANSFER_REQUEST');
 }
 const scope=snapshot(organization,branches,ownerId);
 return {
  requestId,organizationId:organization.organizationId,ownerId,recipientId,
  ...scope,status:'AWAITING_RECIPIENT',version:1,createdAt:now,expiresAt:now+windowMs,
 };
}

function accept({request,actor,expectedDigest,agreementVersion,now}){
 requireLive(request,now,'AWAITING_RECIPIENT');
 if(verifiedSubject(actor)!==request.recipientId)fail('TRANSFER_RECIPIENT_REQUIRED');
 if(expectedDigest!==request.digest||!id(agreementVersion))fail('TRANSFER_ACCEPTANCE_INVALID');
 return {...request,status:'AWAITING_REVIEW',version:request.version+1,acceptedAt:now,agreementVersion};
}

function cancel({request,actor,now}){
 if(!['AWAITING_RECIPIENT','AWAITING_REVIEW'].includes(request?.status)){
  fail('TRANSFER_STATE_CHANGED');
 }
 requireLive(request,now,request.status);
 if(verifiedSubject(actor)!==request.ownerId)fail('OWNER_REQUIRED');
 return {...request,status:'CANCELLED',version:request.version+1,cancelledAt:now};
}

function validateApproval({request,reviewer,organization,branches,finance,now}){
 requireLive(request,now,'AWAITING_REVIEW');
 const reviewerId=verifiedSubject(reviewer);
 if(reviewer.canReviewOwnership!==true||[request.ownerId,request.recipientId].includes(reviewerId)){
  fail('TRANSFER_REVIEWER_REQUIRED');
 }
 if(!Number.isSafeInteger(request.acceptedAt)||!id(request.agreementVersion)){
  fail('TRANSFER_ACCEPTANCE_INVALID');
 }
 const actual=snapshot(organization,branches,request.ownerId);
 if(actual.digest!==request.digest)fail('TRANSFER_SCOPE_CHANGED');
 if(!finance||finance.scopeDigest!==request.digest||
    finance.settlementOwnerId!==request.recipientId||
    finance.settlementDestinationApproved!==true||
    !Array.isArray(finance.branchChecks)||finance.branchChecks.length!==actual.branchIds.length){
  fail('TRANSFER_FINANCE_REVIEW_REQUIRED');
 }
 const byBranch=new Map(finance.branchChecks.map(check=>[check?.businessId,check]));
 for(const businessId of actual.branchIds){
  const check=byBranch.get(businessId);
  if(!check||check.availableBalance!==0||check.lockedBalance!==0||
     check.unsettledCount!==0||check.openOrdersCount!==0){
   fail('TRANSFER_FINANCIAL_BLOCKERS');
  }
 }
 return {requestId:request.requestId,requestVersion:request.version,reviewerId,scopeDigest:actual.digest};
}

module.exports={propose,accept,cancel,validateApproval};
