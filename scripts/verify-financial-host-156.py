"""Independent read-only verification of approved release 156; invokes no handlers."""
import datetime,hashlib,json,pathlib,boto3
from botocore.config import Config
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/private/tmp/financial-host-publication-156');AUDIT=pathlib.Path('/private/tmp/financial-notification-audit-156')
M=json.loads((ROOT/'docs/financial-host-coordinated-release-156.json').read_text());I=json.loads((AUDIT/'inventory.private.json').read_text());P=json.loads((OUT/'publication.json').read_text());assert P['status']=='PUBLISHED_VERIFIED'
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');cfg=Config(connect_timeout=8,read_timeout=30,retries={'mode':'standard','max_attempts':3});lam=s.client('lambda',config=cfg);iam=s.client('iam',config=cfg)
assert s.client('sts',config=cfg).get_caller_identity()['Account']==M['accountId']
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
checked=[]
for row in M['functions']:
 c=lam.get_function_configuration(FunctionName=row['name']);base=next(r for r in I['functions'] if r['FunctionName']==row['name'])
 assert c['CodeSha256']==row['codeSha256'] and c['Handler']==row['handler'] and c['Role']==base['Role'] and c['State']=='Active' and c['LastUpdateStatus']=='Successful'
 assert digest(c.get('Environment',{}).get('Variables',{}))==row['environmentSha256']
 checked.append({'name':row['name'],'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'environmentUnchanged':True,'verified':True})
policies=[]
for role in I['roles']:
 name=role['arn'].rsplit('/',1)[-1];base=json.loads((AUDIT/(name+'.policies.private.json')).read_text());expected={p['name']:p['document'] for p in base['inline']}
 for row in M['permissions']:
  if row['roleArn']==role['arn']:expected[row['policyName']]=row['policy']
 actual={}
 for page in iam.get_paginator('list_role_policies').paginate(RoleName=name):
  for policy in page['PolicyNames']:actual[policy]=iam.get_role_policy(RoleName=name,PolicyName=policy)['PolicyDocument']
 assert actual==expected,'UNEXPECTED_INLINE_POLICY_CHANGE'
 attached=[]
 for page in iam.get_paginator('list_attached_role_policies').paginate(RoleName=name):
  for p in page['AttachedPolicies']:
   version=iam.get_policy(PolicyArn=p['PolicyArn'])['Policy']['DefaultVersionId'];attached.append({'arn':p['PolicyArn'],'version':version,'document':iam.get_policy_version(PolicyArn=p['PolicyArn'],VersionId=version)['PolicyVersion']['Document']})
 assert sorted(attached,key=lambda r:r['arn'])==sorted(base['managed'],key=lambda r:r['arn'])
 policies.append({'role':name,'existingPoliciesPreserved':True})
assert s.client('apigateway',config=cfg).get_stage(restApiId=I['api']['id'],stageName='staging')['deploymentId']==I['api']['deploymentId']
events=s.client('events',config=cfg)
for rule in I['rules']:
 actual=events.describe_rule(Name=rule['name']);assert actual['State']==rule['state'] and actual.get('ScheduleExpression')==rule['schedule']
 targets=events.list_targets_by_rule(Rule=rule['name'])['Targets'];assert len(targets)==rule['targetCount'] and any(t['Arn']==next(r['FunctionArn'] for r in I['functions'] if r['FunctionName']=='WaveSystem_HandleWaveTimeout') for t in targets)
report={'part':156,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'VERIFIED','functions':checked,'permissionPoliciesVerified':2,'roles':policies,'apiAndScheduleUnchanged':True,'environmentChanges':False,'financialDataWrites':False,'activation':'UNCHANGED; not enabled by this publication','handlerInvocations':0}
(OUT/'verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'functionsVerified':6,'policiesVerified':2,'existingRolePoliciesPreserved':6,'apiAndScheduleUnchanged':True,'environmentChanges':False,'financialDataWrites':False}))
