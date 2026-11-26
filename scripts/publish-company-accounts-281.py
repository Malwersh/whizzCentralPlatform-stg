"""Publish reviewed company accounts UI/API with a projected read-only policy."""
import sys,pathlib,json,zipfile,urllib.request,time,hashlib,base64
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/company-accounts-281');prepared=json.loads((p/'prepared.json').read_text());assert prepared['status']=='PREPARED'
assert 'fail 0' in pathlib.Path('/private/tmp/company-staff-all-281.log').read_text()
assert 'fail 0' in pathlib.Path('/private/tmp/company-bundle-tests-281.log').read_text()
assert pathlib.Path('/private/tmp/company-browser-281.log').read_text().count('PASS:')==2
assert json.loads((r/'docs/company-accounts-preflight-281.json').read_text())['status']=='PASS'
s=session();l=s.client('lambda');a=s.client('amplify');iam=s.client('iam');policy=json.loads((r/'docs/company-accounts-read-policy-281.json').read_text());role=prepared['staffRole'].split('/')[-1]
# Prove intended projections are allowed and out-of-scope attributes denied.
attrs=policy['Statement'][0]['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes']
ctx=lambda values:[{'ContextKeyName':'dynamodb:Attributes','ContextKeyValues':values,'ContextKeyType':'stringList'},{'ContextKeyName':'dynamodb:Select','ContextKeyValues':['SPECIFIC_ATTRIBUTES'],'ContextKeyType':'string'}]
for values,expected in [(attrs,'allowed'),(attrs+['passwordHash'],'implicitDeny')]:
 sim=iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy)],ActionNames=['dynamodb:Scan'],ResourceArns=policy['Statement'][0]['Resource'],ContextEntries=ctx(values))
 assert all(x['EvalDecision']==expected for x in sim['EvaluationResults']),sim
orderctx=ctx(policy['Statement'][1]['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes'])+[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyValues':['ORDER#test'],'ContextKeyType':'stringList'}]
sim=iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy)],ActionNames=['dynamodb:BatchGetItem'],ResourceArns=[policy['Statement'][1]['Resource']],ContextEntries=orderctx);assert all(x['EvalDecision']=='allowed' for x in sim['EvaluationResults']),sim
assert l.get_function_configuration(FunctionName='staging-wizz-staff-service')['CodeSha256']==prepared['baseStaffCodeSha256']
args={'appId':'d2vmebm1e1n95m','branchName':'staging'};assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==prepared['baseHostingJobId']
arn='arn:aws:iam::699561669180:policy/staging-company-accounts-read-281'
try:
 v=iam.get_policy(PolicyArn=arn)['Policy']['DefaultVersionId'];existing=iam.get_policy_version(PolicyArn=arn,VersionId=v)['PolicyVersion']['Document'];assert existing==policy
except iam.exceptions.NoSuchEntityException:iam.create_policy(PolicyName='staging-company-accounts-read-281',PolicyDocument=json.dumps(policy),Description='Projected read-only company accounting sources; no money mutation privileges')
iam.attach_role_policy(RoleName=role,PolicyArn=arn)
record={**prepared,'status':'PUBLISHING','readPolicyArn':arn,'iamProjectionTests':'PASS','businessDataModified':False};doc=r/'docs/company-accounts-publication-281.json';doc.write_text(json.dumps(record,indent=2)+'\n')
l.update_function_code(FunctionName='staging-wizz-staff-service',ZipFile=(p/'staff-candidate.zip').read_bytes());l.get_waiter('function_updated_v2').wait(FunctionName='staging-wizz-staff-service');deployed=l.get_function_configuration(FunctionName='staging-wizz-staff-service');assert deployed['CodeSha256']==base64.b64encode(hashlib.sha256((p/'staff-candidate.zip').read_bytes()).digest()).decode();record['deployedStaffCodeSha256']=deployed['CodeSha256'];doc.write_text(json.dumps(record,indent=2)+'\n');print('Staff API code and scoped read policy published.',flush=True)
# Negative HTTP smoke must reject unauthenticated callers before any report read.
resp=l.invoke(FunctionName='staging-wizz-staff-service',Payload=json.dumps({'httpMethod':'GET','path':'/staff/company-accounts','headers':{},'queryStringParameters':{'from':'2026-10-01','through':'2026-10-22'}}).encode());body=json.loads(resp['Payload'].read());assert not resp.get('FunctionError') and body.get('statusCode')==401,body
u=a.create_deployment(**args);record['hostingJobId']=u['jobId'];doc.write_text(json.dumps(record,indent=2)+'\n');urllib.request.urlopen(urllib.request.Request(u['zipUploadUrl'],data=(p/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=u['jobId']);print('Started hosting '+u['jobId'],flush=True)
for _ in range(100):
 state=a.get_job(**args,jobId=u['jobId'])['job']['summary']['status']
 if state in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert state=='SUCCEED',state
with zipfile.ZipFile(p/'hosting-candidate.zip') as candidate:
 for n in prepared['hostingFiles']:
  raw=candidate.read(n)
  for attempt in range(6):
   actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?verify=281-'+str(attempt),timeout=30).read()
   if actual==raw:break
   time.sleep(3)
  assert actual==raw,n
record['status']='PUBLISHED_VERIFIED';record['unauthenticatedReadRejected']=True;record['allHostedBytesVerified']=True;doc.write_text(json.dumps(record,indent=2)+'\n');print('PASS: deployed company accounts UI/API bytes and authorization smoke verified.',flush=True)
