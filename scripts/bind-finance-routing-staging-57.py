"""Review/apply two exact-secret policies, then CAS-bind ARN without changing code or gates."""
import argparse, datetime, hashlib, json, pathlib, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path('/private/tmp/finance57')
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def closed(env):
 assert not env.get('FINANCE_ROLLOUT_CONFIG')
 assert env.get('DELIVERY_QUOTES_ENABLED','false')=='false'
 assert env.get('DELIVERY_QUOTE_MODE','OFF')=='OFF'
 assert all(v=='OFF' for k,v in env.items() if k.startswith(('FINANCIAL_','COMMERCIAL_')) and k.endswith('_MODE'))
def main(mode):
 import boto3
 s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180'
 cf=s.client('cloudformation');lam=s.client('lambda');iam=s.client('iam');inv=json.loads((OUT/'inventory.json').read_text());bindings=json.loads((ROOT/'backend/finance-routing-bindings.staging.json').read_text());template=json.loads((ROOT/'backend/finance-routing-access.staging.json').read_text());stack=bindings['accessOwnerStack'];assert inv['secretArn']==bindings['secretArn']
 assert len(template['Resources'])==2 and len(bindings['bindings'])==2
 def configurations(applied=False):
  result={}
  for f in inv['functions']:
   base=json.loads((OUT/(f['name']+'.config.private.json')).read_text());current=lam.get_function_configuration(FunctionName=f['name']);env=current.get('Environment',{}).get('Variables',{});closed(env)
   assert current['CodeSha256']==base['CodeSha256'] and current['LastUpdateStatus']=='Successful'
   for key in ['Role','Runtime','Handler','Timeout','MemorySize','Layers','VpcConfig','Architectures','TracingConfig','KMSKeyArn']:assert current.get(key)==base.get(key),key
   expected=dict(base.get('Environment',{}).get('Variables',{}))
   if applied:
    for b in bindings['bindings']:
     if b['functionName']==f['name']:expected[b['environmentKey']]=bindings['secretArn']
   assert env==expected,'ENVIRONMENT_DRIFT:'+f['name']
   if not applied:assert current['RevisionId']==base['RevisionId'],'REVISION_DRIFT'
   result[f['name']]=current
  return result
 if mode=='review':
  configs=configurations()
  for resource,binding in zip(template['Resources'].values(),bindings['bindings']):
   props=resource['Properties'];assert resource['Type']=='AWS::IAM::Policy';assert props['Roles']==[configs[binding['functionName']]['Role'].rsplit('/',1)[1]]
   assert props['PolicyDocument']=={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['secretsmanager:GetSecretValue'],'Resource':bindings['secretArn']}]}
   for action,arn,expected in [('secretsmanager:GetSecretValue',bindings['secretArn'],'allowed'),('secretsmanager:PutSecretValue',bindings['secretArn'],'implicitDeny'),('secretsmanager:GetSecretValue',bindings['secretArn']+'-foreign','implicitDeny')]:
    value=iam.simulate_custom_policy(PolicyInputList=[json.dumps(props['PolicyDocument'])],ActionNames=[action],ResourceArns=[arn])['EvaluationResults'][0]['EvalDecision'];assert value==expected
  result=cf.create_change_set(StackName=stack,ChangeSetName='routing57-exact-secret-reads',ChangeSetType='CREATE',TemplateBody=json.dumps(template),Capabilities=['CAPABILITY_NAMED_IAM'])
  (OUT/'routing-changeset.json').write_text(json.dumps({'changeSetArn':result['Id'],'templateDigest':digest(template)}));print(json.dumps({'changeSetCreated':True,'policiesApplied':False,'configurationChanged':False}));return
 state=json.loads((OUT/'routing-changeset.json').read_text());assert state['templateDigest']==digest(template)
 change=cf.describe_change_set(ChangeSetName=state['changeSetArn']);changes=change.get('Changes',[]);assert change['Status']=='CREATE_COMPLETE' and len(changes)==2
 assert all(x['ResourceChange']['Action']=='Add' and x['ResourceChange']['ResourceType']=='AWS::IAM::Policy' and x['ResourceChange']['LogicalResourceId'] in template['Resources'] for x in changes)
 if mode=='apply':
  configs=configurations();assert change['ExecutionStatus']=='AVAILABLE';cf.execute_change_set(ChangeSetName=state['changeSetArn']);cf.get_waiter('stack_create_complete').wait(StackName=stack,WaiterConfig={'Delay':3,'MaxAttempts':90})
  for b in bindings['bindings']:
   c=configs[b['functionName']];policy=next(r['Properties'] for r in template['Resources'].values() if r['Properties']['Roles']==[c['Role'].rsplit('/',1)[1]])
   assert iam.get_role_policy(RoleName=policy['Roles'][0],PolicyName=policy['PolicyName'])['PolicyDocument']==policy['PolicyDocument']
   for _ in range(20):
    evaluation=iam.simulate_principal_policy(PolicySourceArn=c['Role'],ActionNames=['secretsmanager:GetSecretValue'],ResourceArns=[bindings['secretArn']])['EvaluationResults'][0]['EvalDecision']
    if evaluation=='allowed':break
    time.sleep(2)
   assert evaluation=='allowed'
   live=lam.get_function_configuration(FunctionName=c['FunctionName']);assert live['RevisionId']==c['RevisionId'];env=dict(live.get('Environment',{}).get('Variables',{}));env[b['environmentKey']]=bindings['secretArn'];closed(env)
   lam.update_function_configuration(FunctionName=c['FunctionName'],RevisionId=live['RevisionId'],Environment={'Variables':env});lam.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':60})
   print(json.dumps({'bound':c['FunctionName'],'codeChanged':False,'gatesChanged':False}),flush=True)
 current=configurations(True)
 report={'part':57,'environment':'Staging','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'stackName':stack,'policyChanges':changes,'secretArn':bindings['secretArn'],'functions':[{'name':c['FunctionName'],'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'role':c['Role'],'gatesClosed':True,'secretBindingChanged':any(b['functionName']==c['FunctionName'] for b in bindings['bindings'])} for c in current.values()],'activationPerformed':False}
 (OUT/'routing-bindings-verification.json').write_text(json.dumps(report,indent=2));print(json.dumps({'verifiedFunctions':len(current),'boundFunctions':2,'activation':False}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['review','apply','verify']);main(p.parse_args().mode)
