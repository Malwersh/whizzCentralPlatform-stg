"""Pinned staging release 156. Default is read-only; --apply requires the recorded user approval."""
import base64, concurrent.futures, datetime, hashlib, json, os, pathlib, sys, time
import boto3
from botocore.config import Config

ROOT=pathlib.Path(__file__).resolve().parents[1]
ART=pathlib.Path('/private/tmp/financial-notification-release-156')
AUDIT=pathlib.Path('/private/tmp/financial-notification-audit-156')
OUT=pathlib.Path('/private/tmp/financial-host-publication-156');OUT.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(OUT,0o700)
raw=(ROOT/'docs/financial-host-coordinated-release-156.json').read_bytes()
PIN='5bdd0cb1ba2acd79f01b18f0bec5752339e7979139b5d3e03a04b9b6965fe1b0'
assert hashlib.sha256(raw).hexdigest()==PIN,'MANIFEST_CHANGED'
M=json.loads(raw);inventory=json.loads((AUDIT/'inventory.private.json').read_text());baseline={r['FunctionName']:r for r in inventory['functions']}
apply=sys.argv[1:]==['--apply'];assert not sys.argv[1:] or apply,'INVALID_MODE'
session=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');cfg=Config(connect_timeout=8,read_timeout=60,retries={'mode':'standard','max_attempts':3})
lam=session.client('lambda',config=cfg);iam=session.client('iam',config=cfg);api=session.client('apigateway',config=cfg);events=session.client('events',config=cfg)
assert session.client('sts',config=cfg).get_caller_identity()['Account']==M['accountId']
def save(name,value):
 p=OUT/name;p.write_text(json.dumps(value,indent=2,default=str)+'\n');os.chmod(p,0o600)
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def current_policies(arn):
 role=arn.rsplit('/',1)[-1];value={'arn':arn,'inline':[],'managed':[]}
 for page in iam.get_paginator('list_role_policies').paginate(RoleName=role):
  for name in page['PolicyNames']:value['inline'].append({'name':name,'document':iam.get_role_policy(RoleName=role,PolicyName=name)['PolicyDocument']})
 for page in iam.get_paginator('list_attached_role_policies').paginate(RoleName=role):
  for row in page['AttachedPolicies']:
   version=iam.get_policy(PolicyArn=row['PolicyArn'])['Policy']['DefaultVersionId'];value['managed'].append({'arn':row['PolicyArn'],'version':version,'document':iam.get_policy_version(PolicyArn=row['PolicyArn'],VersionId=version)['PolicyVersion']['Document']})
 return value
def normalize(value):
 return {**value,'inline':sorted(value['inline'],key=lambda r:r['name']),'managed':sorted(value['managed'],key=lambda r:r['arn'])}
def check_function(row):
 c=lam.get_function_configuration(FunctionName=row['name']);old=baseline[row['name']]
 assert c['RevisionId']==row['baseRevisionId'] and c['CodeSha256']==row['baseCodeSha256'] and c['Handler']==row['handler'] and c['Role']==old['Role'],'FUNCTION_DRIFT '+row['name']
 assert digest(c.get('Environment',{}).get('Variables',{}))==row['environmentSha256'],'ENVIRONMENT_DRIFT '+row['name']
 assert c['State']=='Active' and c.get('LastUpdateStatus')=='Successful','FUNCTION_NOT_READY'
 payload=(ART/row['candidate']).read_bytes();assert base64.b64encode(hashlib.sha256(payload).digest()).decode()==row['codeSha256'],'ARTIFACT_CHANGED'
 return {'name':row['name'],'clean':True}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:checked=list(pool.map(check_function,M['functions']))
for role in inventory['roles']:
 path=AUDIT/(role['arn'].rsplit('/',1)[-1]+'.policies.private.json');old=json.loads(path.read_text());actual=current_policies(role['arn'])
 assert normalize(actual)==normalize(old),'ROLE_POLICY_DRIFT'
 meta=iam.get_role(RoleName=role['arn'].rsplit('/',1)[-1])['Role'];assert meta.get('PermissionsBoundary')==role.get('permissionsBoundary') and meta['AssumeRolePolicyDocument']==role['trust'],'ROLE_TRUST_DRIFT'
for row in M['permissions']:
 assert hashlib.sha256((AUDIT/(row['roleArn'].rsplit('/',1)[-1]+'.policies.private.json')).read_bytes()).hexdigest()==row['baselineRolePolicySnapshotSha256']
 assert row['policyName'] not in [p['name'] for p in current_policies(row['roleArn'])['inline']],'POLICY_NAME_ALREADY_EXISTS'
uses=[]
for page in lam.get_paginator('list_functions').paginate():uses.extend({'name':f['FunctionName'],'role':f['Role']} for f in page['Functions'])
for row in M['permissions']:assert sorted(f['name'] for f in uses if f['role']==row['roleArn'])==sorted(row['functions']),'ROLE_USAGE_DRIFT'
assert api.get_stage(restApiId=inventory['api']['id'],stageName='staging')['deploymentId']==inventory['api']['deploymentId'],'API_DEPLOYMENT_DRIFT'
for rule in inventory['rules']:
 actual=events.describe_rule(Name=rule['name']);targets=events.list_targets_by_rule(Rule=rule['name'])['Targets']
 assert actual['State']==rule['state'] and actual.get('ScheduleExpression')==rule['schedule'] and len(targets)==rule['targetCount'] and any(t['Arn']==baseline['WaveSystem_HandleWaveTimeout']['FunctionArn'] for t in targets),'SCHEDULER_DRIFT'
preflight={'part':156,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'clean':True,'functions':checked,'rolesChecked':6,'permissionRoleUseChecked':2,'apiAndScheduleUnchanged':True,'applied':False};save('preflight.json',preflight)
print(json.dumps({'preflight':'PASS','functions':6,'roles':6,'apiAndScheduleUnchanged':True,'applyRequested':apply}),flush=True)
if not apply:sys.exit(0)
assert not (OUT/'publication.json').exists(),'PUBLICATION_ALREADY_STARTED_REVIEW_JOURNAL'
proof={'part':156,'manifestSha256':PIN,'permissions':[],'functions':[],'status':'STARTING','environmentChanges':False,'financialDataWrites':False,'apiChanges':False,'scheduleChanges':False};save('publication.json',proof)
try:
 for row in M['permissions']:
  role=row['roleArn'].rsplit('/',1)[-1];step={'role':role,'policyName':row['policyName'],'status':'APPLYING'};proof['permissions'].append(step);save('publication.json',proof)
  iam.put_role_policy(RoleName=role,PolicyName=row['policyName'],PolicyDocument=json.dumps(row['policy']))
  assert iam.get_role_policy(RoleName=role,PolicyName=row['policyName'])['PolicyDocument']==row['policy']
  step['status']='VERIFIED';save('publication.json',proof);print(json.dumps({'permissionVerified':row['policyName']}),flush=True)
 order=['staging-driver-financial-accept','wizzcentral-notifications-staging-pushSendWaveOffer','DriversApi-staging','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WaveSystem_CreateDispatchJob']
 for name in order:
  row=next(r for r in M['functions'] if r['name']==name);check_function(row);before=lam.get_function_configuration(FunctionName=name)
  step={'name':name,'status':'APPLYING','baseRevisionId':before['RevisionId'],'baseCodeSha256':before['CodeSha256']};proof['functions'].append(step);save('publication.json',proof)
  lam.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=(ART/row['candidate']).read_bytes(),Publish=False)
  for attempt in range(60):
   after=lam.get_function_configuration(FunctionName=name)
   if after.get('LastUpdateStatus')=='Successful':break
   assert after.get('LastUpdateStatus')!='Failed','LAMBDA_UPDATE_FAILED';time.sleep(2)
  assert after.get('LastUpdateStatus')=='Successful' and after['CodeSha256']==row['codeSha256'] and after['Handler']==row['handler'] and after['Role']==before['Role'] and digest(after.get('Environment',{}).get('Variables',{}))==row['environmentSha256'],'POST_UPDATE_MISMATCH'
  for key in ['Runtime','Timeout','MemorySize','Architectures']:assert after.get(key)==before.get(key),'RUNTIME_CONFIGURATION_CHANGED'
  step.update(status='VERIFIED',revisionId=after['RevisionId'],codeSha256=after['CodeSha256'],environmentUnchanged=True);save('publication.json',proof);print(json.dumps({'functionVerified':name}),flush=True)
 proof['status']='PUBLISHED_VERIFIED';save('publication.json',proof)
 print(json.dumps({'permissionsVerified':2,'functionsVerified':6,'environmentChanges':False,'financialDataWrites':False}),flush=True)
except Exception:
 proof['status']='STOPPED_REVIEW_REQUIRED';save('publication.json',proof);raise
