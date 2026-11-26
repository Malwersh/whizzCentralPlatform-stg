"""Read/simulation only; no worker invocation or writes."""
import boto3,json
from pathlib import Path
from botocore.config import Config
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';iam=s.client('iam',config=Config(retries={'max_attempts':10,'mode':'standard'}));root=Path('/private/tmp/dispatch50-release-final');plans=json.loads((root/'host-access-plan.json').read_text());checks=[]
for p in plans:
 role=p['role'].rsplit('/',1)[1];assert iam.get_role_policy(RoleName=role,PolicyName=p['policyName'])['PolicyDocument']==p['policy']
 for st in p['policy']['Statement']:
  attrs=st.get('Condition',{}).get('ForAllValues:StringEquals',{}).get('dynamodb:Attributes',['pk','sk','kind','status']);keys=st.get('Condition',{}).get('ForAllValues:StringLike',{}).get('dynamodb:LeadingKeys',['order1']);keys=[k.replace('*','synthetic') for k in keys]
  actions=st['Action'] if isinstance(st['Action'],list) else [st['Action']];resources=st['Resource'] if isinstance(st['Resource'],list) else [st['Resource']]
  results=iam.simulate_principal_policy(PolicySourceArn=p['role'],ActionNames=actions,ResourceArns=resources,ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':keys},{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']},{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':attrs},{'ContextKeyName':'s3:prefix','ContextKeyType':'stringList','ContextKeyValues':['synthetic-unused-context']}])['EvaluationResults']
  for e in results:
   per=e.get('ResourceSpecificResults',[])
   if per:
    for r in per:
     assert r['EvalResourceDecision']=='allowed' and not r.get('MissingContextValues'),(p['function'],e['EvalActionName'],r['EvalResourceName'],r['EvalResourceDecision']);checks.append({'function':p['function'],'action':e['EvalActionName'],'resource':r['EvalResourceName'],'decision':'allowed'})
   else:
    assert e['EvalDecision']=='allowed' and not e.get('MissingContextValues');checks.append({'function':p['function'],'action':e['EvalActionName'],'resource':e.get('EvalResourceName'),'decision':'allowed'})
p=root/'host-iam-effective.json';p.write_text(json.dumps({'checks':checks,'allAllowed':True,'activation':False},indent=2)+'\n');print(json.dumps({'effectiveHostPermissionChecks':len(checks),'allAllowed':True,'activation':False}))
