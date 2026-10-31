"""Review and apply fixed Staging host permissions/bindings with ALL dispatch gates OFF."""
import boto3,json,hashlib,sys
from pathlib import Path
root=Path('/private/tmp/dispatch50-release-final');mode=sys.argv[1];assert mode in ['review','apply'];plans=json.loads((root/'host-access-plan.json').read_text());manifest=json.loads((root/'manifest.json').read_text());s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';iam=s.client('iam');lam=s.client('lambda');events=s.client('events');find={f['name']:f for f in manifest['functions']};reports=[]
def save(n,v):(root/n).write_text(json.dumps(v,indent=2,default=str)+'\n')
for p in plans:
 assert p['function'] in ['staging-cod-integration','WaveSystem_HandleWaveTimeout'];assert p['role']==find[p['function']]['role'];assert p['timeout']==60
 for st in p['policy']['Statement']:
  resources=st['Resource'] if isinstance(st['Resource'],list) else [st['Resource']];actions=st['Action'] if isinstance(st['Action'],list) else [st['Action']]
  assert all(r.startswith(('arn:aws:dynamodb:us-east-1:699561669180:table/','arn:aws:cognito-idp:us-east-1:699561669180:userpool/','arn:aws:lambda:us-east-1:699561669180:function:')) for r in resources)
  assert 'dynamodb:DeleteItem' not in actions and not any(r.rsplit('/',1)[-1] in ['staging-Wallets','staging-LedgerEntries'] for r in resources)
 binding=next(v for k,v in p['environment'].items() if k.endswith('RULE_ARN'));rule=events.describe_rule(Name=binding.rsplit('/',1)[1]);assert rule['Arn']==binding and rule.get('ScheduleExpression')=='rate(1 minute)';targets=events.list_targets_by_rule(Rule=rule['Name'])['Targets'];assert any(t['Arn']==f"arn:aws:lambda:us-east-1:699561669180:function:{p['function']}" for t in targets)
 c=lam.get_function_configuration(FunctionName=p['function']);assert c['CodeSha256']==find[p['function']]['candidateCodeSha256'] and c['Role']==p['role'] and c['LastUpdateStatus']=='Successful'
 env=c.get('Environment',{}).get('Variables',{});assert all(v=='OFF' for k,v in env.items() if k.startswith(('DISPATCH_','PINNED_')) and k.endswith('_MODE'))
 ctx=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':['CONTROL#DISPATCH_REVIEW_HOST']},{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']},{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':['pk','sk','kind','status']}]
 proofs=[]
 for table in ['staging-Wallets','staging-LedgerEntries']:
  result=iam.simulate_custom_policy(PolicyInputList=[json.dumps(p['policy'])],ActionNames=['dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem'],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/'+table],ContextEntries=ctx)['EvaluationResults'];assert all(r['EvalDecision']=='implicitDeny' for r in result);proofs.extend({'table':table,'action':r['EvalActionName'],'decision':r['EvalDecision']} for r in result)
 entry={'function':p['function'],'role':p['role'],'rule':{'arn':binding,'state':rule['State'],'schedule':rule['ScheduleExpression']},'policy':p['policy'],'moneyWritesDeniedInNewPolicy':proofs,'activation':False}
 if mode=='apply':
  assert (root/'host-access-review.json').exists();review=json.loads((root/'host-access-review.json').read_text());assert next(x['policy'] for x in review if x['function']==p['function'])==p['policy'];role=p['role'].rsplit('/',1)[1]
  try:assert iam.get_role_policy(RoleName=role,PolicyName=p['policyName'])['PolicyDocument']==p['policy']
  except iam.exceptions.NoSuchEntityException:iam.put_role_policy(RoleName=role,PolicyName=p['policyName'],PolicyDocument=json.dumps(p['policy']))
  assert iam.get_role_policy(RoleName=role,PolicyName=p['policyName'])['PolicyDocument']==p['policy'];backup=root/(p['function']+'.host-config-before.private.json');
  if not backup.exists():save(backup.name,c);backup.chmod(0o600)
  nextenv={**env,**p['environment']};assert all(nextenv[k]==v for k,v in env.items() if k not in p['environment']);
  lam.update_function_configuration(FunctionName=p['function'],RevisionId=c['RevisionId'],Timeout=60,Environment={'Variables':nextenv});lam.get_waiter('function_updated_v2').wait(FunctionName=p['function'],WaiterConfig={'Delay':2,'MaxAttempts':90});fresh=lam.get_function_configuration(FunctionName=p['function']);assert fresh['CodeSha256']==c['CodeSha256'] and fresh['Environment']['Variables']==nextenv and fresh['Timeout']==60
  assert events.describe_rule(Name=rule['Name'])['State']==rule['State'];entry.update({'policyApplied':True,'timeout':60,'onlyEnvironmentAdded':p['environment'],'environmentDigest':hashlib.sha256(json.dumps(nextenv,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'codeUnchanged':True,'revisionId':fresh['RevisionId']})
 reports.append(entry)
 if mode=='apply':save('host-access-publication.json',reports)
save('host-access-review.json' if mode=='review' else 'host-access-publication.json',reports);print(json.dumps({'hosts':len(reports),'mode':mode,'activation':False}))
