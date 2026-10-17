'use strict';
// Proposal only. This module has no AWS client and never attaches policies.
const fs=require('node:fs');
const arn='arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders';
const identity=['PK','SK','orderId','userSub','storeId','businessId','financeRollout','driverId','assignedDriverId'];
const review=['PK','SK','orderId','storeId','businessId','status','orderStatus','driverId','assignedDriverId','pickedUpAt','deliveredAt','completedAt','financialOutcome','financialRelease','returnCaseId','returnStatus','cashCollected','cashCollectedAmount','cancellationRequestId','cancellationStatus','deletionRequestId','deletionStatus','deletedAt','isDeleted','dispatchReviewOutcome'];
function projectedRead(attributes){return {Effect:'Allow',Action:['dynamodb:GetItem'],Resource:arn,Condition:{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ORDER#*']},'ForAllValues:StringEquals':{'dynamodb:Attributes':attributes},Null:{'dynamodb:Attributes':'false'}}};}
function fence(){return {Effect:'Allow',Action:['dynamodb:ConditionCheckItem'],Resource:arn,Condition:{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ORDER#*']}}};}
function reviewDependencies(){
 const resource=t=>'arn:aws:dynamodb:us-east-1:699561669180:table/'+t;
 const projected=(t,attributes,actions=['dynamodb:GetItem'])=>({Effect:'Allow',Action:actions,Resource:resource(t),Condition:{'ForAllValues:StringEquals':{'dynamodb:Attributes':attributes},Null:{'dynamodb:Attributes':'false'}}});
 const jobs=['orderId','SK','kind','status','state','restaurantId','dispatchJobId','dispatchCycle','dispatchReview','financialDispatch','financialSearchVersion','noDriverReason','attemptId','cycleId','branchId','version','reason','updatedAt','createdAt','dispatchReviewOutcome'];
 return [projected('WizzDispatchJobs_staging',jobs),
  {...projected('WizzDispatchJobs_staging',jobs,['dynamodb:Query','dynamodb:Scan']),Condition:{...projected('WizzDispatchJobs_staging',jobs).Condition,StringEquals:{'dynamodb:Select':'SPECIFIC_ATTRIBUTES'}}},
  projected('staging-Holds',['orderId','sk','holdId','status','version','updatedAt']),
  {Effect:'Allow',Action:['dynamodb:GetItem'],Resource:resource('staging-AccountDeletion'),Condition:{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*']},'ForAllValues:StringEquals':{'dynamodb:Attributes':['pk','sk']},Null:{'dynamodb:Attributes':'false'}}},
  {Effect:'Allow',Action:['dynamodb:ConditionCheckItem'],Resource:['WizzDispatchJobs_staging','staging-Holds','WhizzMerchants_Businesses'].map(resource)}];
}
function plan(inventory){
 if(inventory.account!=='699561669180'||inventory.region!=='us-east-1')throw Error('STAGING_REQUIRED');
 return ['WizzUser-CreateOrder-staging','staging-wizz-staff-service','staging-wizz-wallet-notification-worker','wizzcentral-notifications-staging-pushSendWaveOffer'].map(name=>{
  const row=inventory.functions.filter(f=>f.name===name);if(row.length!==1||!row[0].role.startsWith('arn:aws:iam::699561669180:role/'))throw Error('ROLE_REQUIRED');
  const statements=name==='WizzUser-CreateOrder-staging'?[fence()]:name==='staging-wizz-staff-service'?[projectedRead([...new Set([...identity,...review])]),fence(),...reviewDependencies()]:[projectedRead(identity)];
  return {name,role:row[0].role,baseCodeSha256:row[0].codeSha256,policyName:'FinanceRolloutIdentity54',proposedOnly:true,policy:{Version:'2012-10-17',Statement:statements}};
 });
}
module.exports={plan,identity,review};
if(require.main===module){const result=plan(JSON.parse(fs.readFileSync(process.argv[2])));fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({proposals:result.length,IAMChanged:false}));}
