import boto3,json,os
from pathlib import Path
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';iam=s.client('iam');inv=json.loads(Path('/private/tmp/dispatch50-live/inventory.json').read_text());by={f['name']:f for f in inv['functions']};resource='arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff'
fields=['pk','sk','kind','schemaVersion','orderId','branchId','regionId','status','caseId','requestId','requestDigest','baseDigest','action','resultCode','executionId','receipt','createdAt','executedAt','actorId','actorVersion','legalHold','retentionHold','financialArchiveConfirmed','codFinancialEvidence','accountDeletionRequestId','financialRetainUntil']
plans=[]
for name,actions in [('staging-account-deletion-worker',['dynamodb:GetItem','dynamodb:PutItem','dynamodb:ConditionCheckItem']),('staging-account-deletion-financial-expiry',['dynamodb:GetItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'])]:
 statements=[{'Effect':'Allow','Action':actions,'Resource':resource,'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['DISPATCH_REVIEW#*']}}}]
 if name.endswith('-worker'):statements.insert(0,{'Effect':'Allow','Action':'dynamodb:Scan','Resource':resource,'Condition':{'StringEquals':{'dynamodb:Select':'SPECIFIC_ATTRIBUTES'},'ForAllValues:StringEquals':{'dynamodb:Attributes':fields}}})
 p={'function':name,'role':by[name]['role'],'policyName':'DispatchReviewRetention50','policy':{'Version':'2012-10-17','Statement':statements},'applied':False};plans.append(p)
 checks=[]
 for action in actions+(['dynamodb:Scan'] if name.endswith('-worker') else []):
  ctx=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':['DISPATCH_REVIEW#'+'a'*64]},{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']},{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':fields}]
  result=iam.simulate_principal_policy(PolicySourceArn=p['role'],ActionNames=[action],ResourceArns=[resource],ContextEntries=ctx)['EvaluationResults'][0];checks.append({'action':action,'decision':result['EvalDecision'],'missingContext':result.get('MissingContextValues',[])})
 p['currentEffectiveChecks']=checks
 # Proposed-policy scope proofs: allow retained decision key, reject employee mutation and broad scans.
 cases=[('decision',actions[0],'DISPATCH_REVIEW#'+'a'*64,fields,'SPECIFIC_ATTRIBUTES'),('foreign_employee',actions[-1],'EMPLOYEE#fixture',fields,'SPECIFIC_ATTRIBUTES')]
 if name.endswith('-worker'):cases.extend([('restricted_scan','dynamodb:Scan','DISPATCH_REVIEW#'+'a'*64,fields,'SPECIFIC_ATTRIBUTES'),('secret_scan','dynamodb:Scan','DISPATCH_REVIEW#'+'a'*64,['pk','sk','pinHash'],'SPECIFIC_ATTRIBUTES'),('all_scan','dynamodb:Scan','DISPATCH_REVIEW#'+'a'*64,fields,'ALL_ATTRIBUTES')])
 proofs=[]
 for label,action,key,attrs,select in cases:
  result=iam.simulate_custom_policy(PolicyInputList=[json.dumps(p['policy'])],ActionNames=[action],ResourceArns=[resource],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]},{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':[select]},{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':attrs}])['EvaluationResults'][0]
  assert result['EvalDecision']==('allowed' if label in ['decision','restricted_scan'] else 'implicitDeny')
  proofs.append({'case':label,'decision':result['EvalDecision']})
 p['scopeSimulation']=proofs
out=Path('/private/tmp/dispatch50-retention-iam-plan.json');out.write_text(json.dumps(plans,indent=2)+'\n');out.chmod(0o600);print(json.dumps([{'function':p['function'],'checks':p['currentEffectiveChecks'],'scopeProofs':p['scopeSimulation']} for p in plans]))
