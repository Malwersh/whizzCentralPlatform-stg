"""Publish reviewed staging candidates, consumers before the order producer.

Uses private saved configurations as drift guards. Does not invoke financial
handlers, create orders, approve statements, or move money.
"""
import sys,json,pathlib,hashlib,base64,time,gzip
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session

p=pathlib.Path('/private/tmp/full-cash-208');root=pathlib.Path(__file__).resolve().parents[1]
manifest=json.loads((p/'packages/candidates.json').read_text())
access=json.loads((p/'access/candidates.json').read_text())
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180'
lam=s.client('lambda');iam=s.client('iam')
previous=json.loads((p/'deployment-attempt-1.json').read_text()) if (p/'deployment-attempt-1.json').exists() else {}
previous_codes={r['name']:r['codeSha256'] for r in previous.get('code',[])}
receipt={'part':208,'status':'PREFLIGHT','account':'699561669180','region':'us-east-1','code':[],'configuration':[],'access':[],'financialHandlersInvoked':False,'financialDataWritesPerformed':False,'cardPaymentsEnabled':False,'scopeStorageEncoding':'GZIP208: base64 gzip; original bytes and SHA256 restored before handler imports','previousAttempt':'All compatible code published; no activation; AWS rejected first oversized environment update'}
doc=root/'docs/full-cash-publication-208.json'
def save():doc.write_text(json.dumps(receipt,indent=2)+'\n')
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'))
def current(name):return lam.get_function_configuration(FunctionName=name)
def wait(name):lam.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':90})
def env_of(c):return c.get('Environment',{}).get('Variables',{})
def desired(c):
 e=dict(env_of(c));e.update(FINANCE_GENERAL_RELEASE_MODE='REQUIRED',FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1')
 e['FINANCE_ROLLOUT_CONFIG']='GZIP208:'+base64.b64encode(gzip.compress(e['FINANCE_ROLLOUT_CONFIG'].encode(),mtime=0)).decode()
 assert len(json.dumps(e,separators=(',',':')).encode())<=4096
 return e

# Check the entire release before the first mutation.
for r in manifest['functions']:
 old=json.loads((p/'live'/(r['name']+'.config.private.json')).read_text());now=current(r['name'])
 assert now['CodeSha256'] in {r['baseCodeSha256'],previous_codes.get(r['name'])},'LAMBDA_DRIFT '+r['name']
 assert env_of(now)==env_of(old),'ENVIRONMENT_DRIFT '+r['name']
 assert base64.b64encode(hashlib.sha256(pathlib.Path(r['candidate']).read_bytes()).digest()).decode()==r['candidateCodeSha256']
 if r['financialGeneralActivationRequired']:desired(old)
for name,policy in access['staffInlineUpdates'].items():
 old=json.loads((p/'live/staging-wizz-staff-service.role.private.json').read_text())['policies'][name]
 assert canonical(iam.get_role_policy(RoleName=access['staffRole'],PolicyName=name)['PolicyDocument']) in {canonical(old),canonical(policy)},'STAFF_IAM_DRIFT'
save()

# Preserve unchanged policies; add only the reviewed statement/journal grants.
for name,policy in access['staffInlineUpdates'].items():
 old=iam.get_role_policy(RoleName=access['staffRole'],PolicyName=name)['PolicyDocument']
 if canonical(old)==canonical(policy):continue
 iam.put_role_policy(RoleName=access['staffRole'],PolicyName=name,PolicyDocument=json.dumps(policy))
 receipt['access'].append({'role':access['staffRole'],'policy':name});save()
m=access['staffManagedPolicy'];arn='arn:aws:iam::699561669180:policy/'+m['name']
try:
 existing=iam.get_policy(PolicyArn=arn)['Policy']
 actual=iam.get_policy_version(PolicyArn=arn,VersionId=existing['DefaultVersionId'])['PolicyVersion']['Document']
 assert canonical(actual)==canonical(m['document']),'MANAGED_POLICY_DRIFT'
except iam.exceptions.NoSuchEntityException:
 iam.create_policy(PolicyName=m['name'],PolicyDocument=json.dumps(m['document']),Description='Part 208 saved merchant statement membership and audit only')
iam.attach_role_policy(RoleName=access['staffRole'],PolicyArn=arn)
receipt['access'].append({'role':access['staffRole'],'policy':arn});save()
a=access['acceptanceInlinePolicy']
iam.put_role_policy(RoleName=access['acceptanceRole'],PolicyName=a['name'],PolicyDocument=json.dumps(a['document']))
receipt['access'].append({'role':access['acceptanceRole'],'policy':a['name']});save()

# Every consumer gets compatible code before general admission is enabled.
producer='WizzUser-CreateOrder-staging'
ordered=sorted(manifest['functions'],key=lambda r:r['name']==producer)
for r in ordered:
 now=current(r['name']);assert now['CodeSha256'] in {r['baseCodeSha256'],previous_codes.get(r['name'])},'CODE_DRIFT '+r['name']
 if now['CodeSha256']!=r['candidateCodeSha256']:
  lam.update_function_code(FunctionName=r['name'],ZipFile=pathlib.Path(r['candidate']).read_bytes(),RevisionId=now['RevisionId'])
  wait(r['name'])
 now=current(r['name']);assert now['CodeSha256']==r['candidateCodeSha256']
 receipt['code'].append({'name':r['name'],'codeSha256':now['CodeSha256'],'changedFiles':r['changedFiles'],'otherEntriesIdentical':True});save()
 print('Code verified: '+r['name'],flush=True)
receipt['status']='COMPATIBLE_CODE_PUBLISHED';save()
for r in ordered:
 if not r['financialGeneralActivationRequired']:continue
 now=current(r['name']);old=json.loads((p/'live'/(r['name']+'.config.private.json')).read_text())
 assert now['CodeSha256']==r['candidateCodeSha256'] and env_of(now)==env_of(old),'CONFIG_DRIFT '+r['name']
 updated=desired(old)
 lam.update_function_configuration(FunctionName=r['name'],Environment={'Variables':updated},RevisionId=now['RevisionId'])
 wait(r['name']);now=current(r['name']);assert env_of(now)==updated
 decoded=gzip.decompress(base64.b64decode(env_of(now)['FINANCE_ROLLOUT_CONFIG'][8:])).decode();assert decoded==env_of(old)['FINANCE_ROLLOUT_CONFIG']
 receipt['configuration'].append({'name':r['name'],'generalReleaseMode':'REQUIRED','settlementModel':'FULL_CASH_AT_DELIVERY_V1','historicalScopesPreserved':True,'historicalScopeHashPreserved':env_of(now)['FINANCE_ROLLOUT_SHA256']==env_of(old)['FINANCE_ROLLOUT_SHA256']});save()
 print('Configuration verified: '+r['name'],flush=True)
receipt['status']='PUBLISHED_ENABLED_VERIFIED';save()
print('Part 208 backend release verified; no financial handler invoked.',flush=True)
