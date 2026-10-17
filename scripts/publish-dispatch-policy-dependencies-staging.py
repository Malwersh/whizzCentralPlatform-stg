import boto3,json,hashlib,base64,zipfile,sys,os
from pathlib import Path
root=Path('/private/tmp/dispatch50-release-final');live=Path('/private/tmp/dispatch50-live');repo=Path.cwd();mode=sys.argv[1];assert mode in ['preflight','grant-retention','publish','verify','migrate-policy']
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda');iam=s.client('iam');db=s.resource('dynamodb');m=json.loads((root/'manifest.json').read_text());assert len(m['functions'])==9 and m['activation']==False
allow={'staging-wizz-staff-service','WizzUser-DeliveryQuotes-staging','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','staging-account-deletion-requests','staging-account-deletion-worker','staging-account-deletion-financial-expiry','staging-cod-integration'};assert {f['name'] for f in m['functions']}==allow
host_refs={p['function']:p for p in json.loads((root/'host-access-publication.json').read_text())} if (root/'host-access-publication.json').exists() else {}
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
digest=lambda env:hashlib.sha256(json.dumps(env,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def save(name,value):
 p=root/name;p.write_text(json.dumps(value,indent=2,default=str)+'\n');p.chmod(0o600)
def current(f,candidate=False):
 c=lam.get_function_configuration(FunctionName=f['name']);assert c['Role']==f['role'] and c['Handler']==f['handler'] and c['Runtime']==f['runtime'] and c['Timeout']==host_refs.get(f['name'],{}).get('timeout',f['timeout']),'CONFIGURATION_DRIFT'
 assert c['State']=='Active' and c['LastUpdateStatus']=='Successful','LAMBDA_UNSTABLE'
 assert digest(c.get('Environment',{}).get('Variables',{}))==host_refs.get(f['name'],{}).get('environmentDigest',f['environmentDigest']),'ENVIRONMENT_DRIFT'
 assert c['CodeSha256'] in ([f['codeSha256'],f['candidateCodeSha256']] if candidate else [f['codeSha256']]),'CODE_DRIFT'
 if c['CodeSha256']==f['codeSha256']:assert c['RevisionId']==f['revisionId'],'REVISION_DRIFT'
 for k,v in c.get('Environment',{}).get('Variables',{}).items():
  if k.startswith(('DISPATCH_','PINNED_')) and k.endswith('_MODE'):assert v=='OFF','GATE_ACTIVE'
 return c
proof=[]
for f in m['functions']:
 before=live/(f['name']+'.zip');after=root/(f['name']+'.candidate.zip');assert sha(before.read_bytes())==f['codeSha256'] and sha(after.read_bytes())==f['candidateCodeSha256'];assert before.read_bytes()==(root/(f['name']+'.rollback.zip')).read_bytes()
 with zipfile.ZipFile(before) as a,zipfile.ZipFile(after) as b:
  old=set(a.namelist());new=set(b.namelist());changed={n for n in old&new if a.read(n)!=b.read(n)};assert not old-new and new-old==set(f['addedFiles']) and changed==set(f['replacedFiles'])
  if f['name']=='staging-cod-integration':assert b.read('index.js').startswith(a.read('index.js'))
  proof.append({'name':f['name'],'unchangedEntries':len(old)-len(changed),'changed':sorted(changed),'added':sorted(new-old),'rollbackVerified':True})
 current(f,candidate=mode in ['publish','verify','migrate-policy'])
save('archives-verified.json',proof)
if mode=='preflight':print(json.dumps({'preflight':9,'activation':False}))
elif mode=='grant-retention':
 plans=json.loads(Path('/private/tmp/dispatch50-retention-iam-plan.json').read_text());done=[]
 for p in plans:
  assert p['function'] in ['staging-account-deletion-worker','staging-account-deletion-financial-expiry'] and p['policyName']=='DispatchReviewRetention50';assert p['role']==next(f['role'] for f in m['functions'] if f['name']==p['function'])
  assert all(st['Resource']=='arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff' for st in p['policy']['Statement'])
  for statement in p['policy']['Statement']:
   assert statement['Effect']=='Allow'
   actions=statement['Action'] if isinstance(statement['Action'],list) else [statement['Action']]
   if actions==['dynamodb:Scan']:
    assert p['function']=='staging-account-deletion-worker'
    assert statement['Condition']['StringEquals']=={'dynamodb:Select':'SPECIFIC_ATTRIBUTES'}
    assert set(statement['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes'])==set(['pk','sk','kind','schemaVersion','orderId','branchId','regionId','status','caseId','requestId','requestDigest','baseDigest','action','resultCode','executionId','receipt','createdAt','executedAt','actorId','actorVersion','legalHold','retentionHold','financialArchiveConfirmed','codFinancialEvidence','accountDeletionRequestId','financialRetainUntil'])
   else:
    assert set(actions)==set(['dynamodb:GetItem','dynamodb:ConditionCheckItem',('dynamodb:PutItem' if p['function'].endswith('-worker') else 'dynamodb:DeleteItem')])
    assert statement['Condition']=={'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['DISPATCH_REVIEW#*']}}
  role=p['role'].rsplit('/',1)[1]
  try:
   raw=iam.get_role_policy(RoleName=role,PolicyName=p['policyName'])['PolicyDocument'];assert raw==p['policy'],'EXISTING_POLICY_DIFFERS'
  except iam.exceptions.NoSuchEntityException:iam.put_role_policy(RoleName=role,PolicyName=p['policyName'],PolicyDocument=json.dumps(p['policy']))
  actual=iam.get_role_policy(RoleName=role,PolicyName=p['policyName'])['PolicyDocument'];assert actual==p['policy'];done.append({'function':p['function'],'role':p['role'],'policyName':p['policyName'],'policy':actual,'applied':True})
 save('iam-publication.json',done);print(json.dumps({'retentionPoliciesGranted':len(done),'walletPermissionsAdded':False}))
elif mode=='publish':
 assert len(json.loads((root/'iam-publication.json').read_text()))==2
 results=[]
 try:
  # Compatibility readers and retention precede the staff editor. All engine gates remain OFF.
  order=['WizzUser-DeliveryQuotes-staging','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','staging-account-deletion-requests','staging-account-deletion-worker','staging-account-deletion-financial-expiry','staging-cod-integration','staging-wizz-staff-service']
  for name in order:
   f=next(f for f in m['functions'] if f['name']==name);c=current(f,True)
   if c['CodeSha256']!=f['candidateCodeSha256']:
    r=lam.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=(root/(name+'.candidate.zip')).read_bytes(),Publish=False);assert r['CodeSha256']==f['candidateCodeSha256'];lam.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':90})
   c=current(f,True);assert c['CodeSha256']==f['candidateCodeSha256'];results.append({'name':name,'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'environmentUnchanged':True,'activation':False});save('publication.json',results);print(json.dumps(results[-1]),flush=True)
 finally:save('publication.json',results)
elif mode=='verify':
 for f in m['functions']:assert current(f,True)['CodeSha256']==f['candidateCodeSha256']
 save('verification.json',{'functions':9,'activation':False,'configurationMatchesReviewedPlan':True,'hostBindingsApplied':len(host_refs),'unrelatedEnvironmentPreserved':True});print(json.dumps({'verified':9,'activation':False}))
else:
 assert json.loads((root/'verification.json').read_text())['functions']==9
 assert json.loads((root/'frontend-publication.json').read_text())['status']=='SUCCEED'
 assert json.loads((root/'validator-compatibility.json').read_text())['readers']==4
 for f in m['functions']:assert current(f,True)['CodeSha256']==f['candidateCodeSha256']
 from boto3.dynamodb.types import TypeSerializer
 from datetime import datetime,timezone
 proposal=json.loads((repo/'docs/finance-dispatch-policy-transition-50.json').read_text());v=proposal['values'];table=db.Table('staging-PlatformStaff');key={'pk':'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS','sk':'CURRENT'};old=table.get_item(Key=key,ConsistentRead=True)['Item']
 if old.get('migrationBy')=='SYSTEM_RELEASE_50' and old['values']==v:save('policy-publication.json',{'version':int(old['version']),'replayed':True,'activation':False})
 else:
  assert old['version']==1 and 'dispatch' not in old['values'];assert all(old['values'][k]==v[k] for k in old['values']) and len(old['values'])==5
  save('policy-before.private.json',old);at=datetime.now(timezone.utc).isoformat();new={**key,'version':2,'policyVersion':'dispatch-schema-v2-release50','values':v,'migrationBy':'SYSTEM_RELEASE_50','migratedAt':at,'previousVersion':1,'effectiveFor':'NEW_REQUESTS'}
  audit={'pk':'AUDIT','sk':at+'#SYSTEM_RELEASE_50_DISPATCH_SCHEMA','actorId':'SYSTEM_RELEASE_50','action':'DELIVERY_OPERATIONS_SCHEMA_MIGRATED','beforeVersion':1,'afterVersion':2,'activation':False,'scalarLimitsChanged':False,'createdAt':at}
  ser=TypeSerializer();item=lambda x:{k:ser.serialize(y) for k,y in x.items()}
  tx=[{'Put':{'TableName':'staging-PlatformStaff','Item':item(new),'ConditionExpression':'#v=:v AND #values=:values','ExpressionAttributeNames':{'#v':'version','#values':'values'},'ExpressionAttributeValues':item({':v':1,':values':old['values']})}},{'Put':{'TableName':'staging-PlatformStaff','Item':item({**new,'sk':'VERSION#'+new['policyVersion']}),'ConditionExpression':'attribute_not_exists(sk)'}},{'Put':{'TableName':'staging-PlatformStaff','Item':item(audit),'ConditionExpression':'attribute_not_exists(sk)'}}]
  s.client('dynamodb').transact_write_items(TransactItems=tx,ClientRequestToken='dispatch-schema-v2-release50');fresh=table.get_item(Key=key,ConsistentRead=True)['Item'];assert fresh==new;save('policy-publication.json',{'version':2,'policyVersion':new['policyVersion'],'migrationBy':'SYSTEM_RELEASE_50','scalarLimitsChanged':False,'replayed':False,'activation':False});print(json.dumps({'policyVersion':2,'scalarLimitsChanged':False,'activation':False}))
