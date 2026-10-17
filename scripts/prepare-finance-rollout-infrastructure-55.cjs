'use strict';
const fs=require('node:fs');
const {plan}=require('./prepare-finance-rollout-access-54.cjs');
function template(inventory){
 const policies=plan(inventory),ids=['CreateOrderRolloutFence','StaffReviewRolloutRead','WalletNoticeRolloutRead','WavePushRolloutRead'];
 return {AWSTemplateFormatVersion:'2010-09-09',Description:'Staging scoped rollout identity reads and review fences. No money writes or activation.',
 Conditions:{StagingAccountAndRegion:{'Fn::And':[{'Fn::Equals':[{Ref:'AWS::AccountId'},'699561669180']},{'Fn::Equals':[{Ref:'AWS::Region'},'us-east-1']}] }},
 Resources:Object.fromEntries(policies.map((p,i)=>[ids[i],{Type:'AWS::IAM::Policy',Condition:'StagingAccountAndRegion',Properties:{PolicyName:p.policyName,PolicyDocument:p.policy,Roles:[p.role.split('/').pop()]}}]))};
}
module.exports={template};
if(require.main===module)fs.writeFileSync(process.argv[3],JSON.stringify(template(JSON.parse(fs.readFileSync(process.argv[2]))),null,2)+'\n');
