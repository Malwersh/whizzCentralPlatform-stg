"""Publish the reviewed payout code and bounded permissions to staging.

No handler is invoked, OTP sent, payout requested/approved, or money moved.
"""
import sys,pathlib,json,hashlib,base64
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
p=pathlib.Path('/private/tmp/payout-209');root=pathlib.Path(__file__).resolve().parents[1]
m=json.loads((p/'packages.json').read_text());a=json.loads((p/'access.private.json').read_text());s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180'
lam=s.client('lambda');iam=s.client('iam');doc=root/'docs/merchant-payout-publication-209.json'
r={'part':209,'status':'PREFLIGHT','account':'699561669180','region':'us-east-1','functions':[],'access':[],'existingRoutesReused':True,'manualMethods':['CASH','ZAIN_CASH'],'bankEnabled':False,'secondFinanceEmployeeRequired':False,'ownerReceiptAndFinalReconciliationRequired':True,'payoutCreatedOrApproved':False,'financialHandlerInvoked':False,'otpSent':False,'moneyMoved':False}
def save():doc.write_text(json.dumps(r,indent=2)+'\n')
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'))
def env(c):return c.get('Environment',{}).get('Variables',{})
configs={}
for row in m['functions']:
 c=lam.get_function_configuration(FunctionName=row['name']);old=json.loads((p/'live'/(row['name']+'.config.private.json')).read_text());assert c['RevisionId']==row['baseRevisionId'] and c['CodeSha256']==row['baseCodeSha256'],'CODE_DRIFT '+row['name'];assert env(c)==env(old),'ENVIRONMENT_DRIFT '+row['name']
 assert base64.b64encode(hashlib.sha256(pathlib.Path(row['candidate']).read_bytes()).digest()).decode()==row['codeSha256'];configs[row['name']]=old
before=json.loads((p/'live/staging-wizz-staff-service.role.private.json').read_text())['policies'][a['staffInlinePolicy']['name']]
assert canonical(iam.get_role_policy(RoleName=a['staffRole'],PolicyName=a['staffInlinePolicy']['name'])['PolicyDocument'])==canonical(before),'STAFF_POLICY_DRIFT'
e={**env(configs['staging-wizz-staff-service']),**a['staffEnvAdditions']};assert len(json.dumps(e,separators=(',',':')).encode())<=4096
assert json.loads((p/'access-simulation.json').read_text())['results'] and all(t['expected']==t['actual'] for t in json.loads((p/'access-simulation.json').read_text())['results'])
save()
for role,k in [(a['staffRole'],'staffManagedPolicy'),(a['workerRole'],'workerManagedPolicy')]:
 policy=a[k];arn='arn:aws:iam::699561669180:policy/'+policy['name']
 try:
  existing=iam.get_policy(PolicyArn=arn)['Policy'];actual=iam.get_policy_version(PolicyArn=arn,VersionId=existing['DefaultVersionId'])['PolicyVersion']['Document'];assert canonical(actual)==canonical(policy['document']),'EXISTING_POLICY_DRIFT'
 except iam.exceptions.NoSuchEntityException:iam.create_policy(PolicyName=policy['name'],PolicyDocument=json.dumps(policy['document']),Description='Part 209 merchant payout workflow or retention, restricted resource scopes')
 iam.attach_role_policy(RoleName=role,PolicyArn=arn);r['access'].append({'role':role,'policy':arn});save()
iam.put_role_policy(RoleName=a['staffRole'],PolicyName=a['staffInlinePolicy']['name'],PolicyDocument=json.dumps(a['staffInlinePolicy']['document']));r['access'].append({'role':a['staffRole'],'policy':a['staffInlinePolicy']['name'],'change':'named paid evidence fields only'});save()
for row in sorted(m['functions'],key=lambda f:f['name']=='staging-wizz-staff-service'):
 c=lam.get_function_configuration(FunctionName=row['name']);assert c['RevisionId']==row['baseRevisionId'] and c['CodeSha256']==row['baseCodeSha256'],'CODE_DRIFT '+row['name']
 lam.update_function_code(FunctionName=row['name'],ZipFile=pathlib.Path(row['candidate']).read_bytes(),RevisionId=c['RevisionId'])
 lam.get_waiter('function_updated_v2').wait(FunctionName=row['name'],WaiterConfig={'Delay':2,'MaxAttempts':90})
 c=lam.get_function_configuration(FunctionName=row['name']);assert c['CodeSha256']==row['codeSha256'];r['functions'].append({'name':row['name'],'codeSha256':c['CodeSha256'],'changedFiles':row['changedFiles'],'otherEntriesIdentical':True});save();print('Published and verified: '+row['name'],flush=True)
c=lam.get_function_configuration(FunctionName='staging-wizz-staff-service');assert env(c)==env(configs['staging-wizz-staff-service'])
lam.update_function_configuration(FunctionName='staging-wizz-staff-service',Environment={'Variables':e},RevisionId=c['RevisionId']);lam.get_waiter('function_updated_v2').wait(FunctionName='staging-wizz-staff-service',WaiterConfig={'Delay':2,'MaxAttempts':90})
c=lam.get_function_configuration(FunctionName='staging-wizz-staff-service');assert env(c)==e;r['otpProviderConfigured']=True;r['historicalScopeAndGeneralReleasePreserved']=all(env(c)[k]==env(configs['staging-wizz-staff-service'])[k] for k in ['FINANCE_ROLLOUT_CONFIG','FINANCE_ROLLOUT_SHA256','FINANCE_GENERAL_RELEASE_MODE','FINANCIAL_SETTLEMENT_MODEL']);r['status']='PUBLISHED_ACTIVE_VERIFIED';save();print('Payout code active on existing staging routes; no financial operation requested.',flush=True)
