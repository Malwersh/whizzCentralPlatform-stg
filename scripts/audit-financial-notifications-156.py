"""Capture current staging code, execution policies, deployed API and periodic rule. Read-only."""
import base64, concurrent.futures, datetime, hashlib, json, os, pathlib, sys, urllib.request
import boto3
from botocore.config import Config

OUT=pathlib.Path(sys.argv[1]);OUT.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(OUT,0o700)
session=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1')
config=Config(connect_timeout=8,read_timeout=30,retries={'max_attempts':3,'mode':'standard'})
clients={name:session.client(name,config=config) for name in ['sts','lambda','iam','apigateway','events']}
assert clients['sts'].get_caller_identity()['Account']=='699561669180'
names=['WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','DriversApi-staging','wizzcentral-notifications-staging-pushSendWaveOffer']
flags=['DISPATCH_CYCLE_MODE','DISPATCH_LEGACY_HOST_MODE','DISPATCH_FINANCIAL_HOST_MODE','FINANCIAL_DISPATCH_MODE','FINANCIAL_DELIVERY_FUNDING_MODE','PINNED_LEGACY_PUSH_MODE','PINNED_FINANCIAL_PUSH_MODE','FINANCIAL_ACCEPT_FUNCTION_ARN','PUSH_TOKENS_TABLE','DISPATCH_HOST_ACCOUNT_ID','PINNED_DISPATCH_ACCOUNT_ID','DISPATCH_HOST_RULE_ARN','DELIVERY_OPERATIONS_MODE']
def save(name,data):
 p=OUT/name;p.write_text(json.dumps(data,indent=2,default=str)+'\n');os.chmod(p,0o600)
def capture(name):
 value=clients['lambda'].get_function(FunctionName=name);c=value['Configuration'];env=c.get('Environment',{}).get('Variables',{})
 assert env.get('STAGE',env.get('ENVIRONMENT')) in ['staging','stg'] or name.endswith('-staging'), 'AMBIGUOUS_STAGE'
 raw=urllib.request.urlopen(value['Code']['Location'],timeout=60).read();assert base64.b64encode(hashlib.sha256(raw).digest()).decode()==c['CodeSha256']
 p=OUT/(name+'.zip');p.write_bytes(raw);os.chmod(p,0o600)
 row={k:c[k] for k in ['FunctionName','FunctionArn','Role','Handler','Runtime','RevisionId','CodeSha256','Timeout','MemorySize']}
 row['flags']={k:env.get(k,'ABSENT') for k in flags};row['routingSecretArn']=env.get('FINANCIAL_ROUTING_SECRET_ARN');row['hasNotificationTransport']=bool(env.get('NOTIFICATIONS_API_BASE') and env.get('NOTIFICATIONS_INTERNAL_KEY'))
 # The configuration digest detects drift without storing raw credentials/env.
 row['environmentSha256']=hashlib.sha256(json.dumps(env,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 save(name+'.summary.private.json',row);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(capture,names))
iam=clients['iam'];role_reports=[]
usage=[]
for page in clients['lambda'].get_paginator('list_functions').paginate():usage.extend({'name':f['FunctionName'],'role':f['Role']} for f in page['Functions'])
for arn in sorted({r['Role'] for r in rows}):
 role=arn.rsplit('/',1)[-1];policies={'arn':arn,'inline':[],'managed':[]}
 for page in iam.get_paginator('list_role_policies').paginate(RoleName=role):
  for name in page['PolicyNames']:policies['inline'].append({'name':name,'document':iam.get_role_policy(RoleName=role,PolicyName=name)['PolicyDocument']})
 for page in iam.get_paginator('list_attached_role_policies').paginate(RoleName=role):
  for policy in page['AttachedPolicies']:
   version=iam.get_policy(PolicyArn=policy['PolicyArn'])['Policy']['DefaultVersionId'];policies['managed'].append({'arn':policy['PolicyArn'],'version':version,'document':iam.get_policy_version(PolicyArn=policy['PolicyArn'],VersionId=version)['PolicyVersion']['Document']})
 save(role+'.policies.private.json',policies)
 meta=iam.get_role(RoleName=role)['Role'];role_reports.append({'arn':arn,'functions':[f['name'] for f in usage if f['role']==arn],'permissionsBoundary':meta.get('PermissionsBoundary'),'trust':meta['AssumeRolePolicyDocument']})
api=clients['apigateway'];stage=api.get_stage(restApiId='6ogrj6so22',stageName='staging');export=api.get_export(restApiId='6ogrj6so22',stageName='staging',exportType='oas30',parameters={'extensions':'integrations'})
definition=json.loads(export['body'].read());save('driver-api-deployed.private.json',definition)
paths={path:methods for path,methods in definition['paths'].items() if 'driver' in path or '{proxy+}' in path};save('driver-api-paths.private.json',paths)
timeout=next(r for r in rows if r['FunctionName']=='WaveSystem_HandleWaveTimeout');rules=[]
for name in clients['events'].list_rule_names_by_target(TargetArn=timeout['FunctionArn'])['RuleNames']:
 rule=clients['events'].describe_rule(Name=name);targets=clients['events'].list_targets_by_rule(Rule=name)['Targets'];rules.append({'name':name,'arn':rule['Arn'],'state':rule['State'],'schedule':rule.get('ScheduleExpression'),'targetCount':len(targets),'timeoutTarget':any(t['Arn']==timeout['FunctionArn'] for t in targets)})
report={'part':156,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True,'applied':False,'functions':rows,'roles':role_reports,'api':{'id':'6ogrj6so22','stage':'staging','deploymentId':stage['deploymentId'],'relevantPaths':list(paths)},'rules':rules}
save('inventory.private.json',report)
print(json.dumps({'capturedFunctions':len(rows),'roles':len(role_reports),'deployedApiPaths':list(paths),'rules':rules,'applied':False}))
