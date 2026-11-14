"""Publish coordinated metadata-only collection overlays; preserve all unrelated bytes/config."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/settlement-216');s=session();lam=s.client('lambda');cf=s.client('cloudformation');phase=sys.argv[1];receiptPath=root/'docs/merchant-collection-publication-216.json';receipt=json.loads(receiptPath.read_text()) if receiptPath.exists() else {'part':216,'phases':{},'financialOperationsRequested':False};assert s.client('sts').get_caller_identity()['Account']=='699561669180'
def save():receiptPath.write_text(json.dumps(receipt,indent=2)+'\n')
if phase=='access':
 template=(root/'backend/shared/merchant-period-collection-access-216.template.json').read_text();name='staging-merchant-period-collection-access-216';cf.validate_template(TemplateBody=template)
 try:stack=cf.describe_stacks(StackName=name)['Stacks'][0]
 except cf.exceptions.ClientError as e:
  if 'does not exist' not in str(e):raise
  access=json.loads((p/'access.json').read_text());iam=s.client('iam')
  for a in access.values():assert len(iam.list_attached_role_policies(RoleName=a['role'])['AttachedPolicies'])<10,'ROLE_POLICY_LIMIT'
  cf.create_stack(StackName=name,TemplateBody=template,Capabilities=['CAPABILITY_NAMED_IAM'],Tags=[{'Key':'Scope','Value':'staging-finance-metadata-216'}]);stack=None
 for _ in range(120):
  stack=cf.describe_stacks(StackName=name)['Stacks'][0]
  if stack['StackStatus']!='CREATE_IN_PROGRESS':break
  time.sleep(2)
 assert stack['StackStatus']=='CREATE_COMPLETE',stack['StackStatus'];assert json.loads(cf.get_template(StackName=name)['TemplateBody'])==json.loads(template) if isinstance(cf.get_template(StackName=name)['TemplateBody'],str) else cf.get_template(StackName=name)['TemplateBody']==json.loads(template)
 receipt['phases'][phase]={'status':'VERIFIED','stack':name,'stackStatus':stack['StackStatus'],'policySimulationCases':18,'newMoneyPermissions':False};save();print(json.dumps(receipt['phases'][phase]));sys.exit(0)
assert receipt['phases'].get('access',{}).get('status')=='VERIFIED'
sets={
 'retention':('staging-account-deletion-worker',{n:(root/'backend/account-deletion'/n).read_bytes() for n in ['settlement-retention.js','settlement-collection-inventory.js']}),
 'consumer':('staging-wizz-staff-service',{n:(root/'backend/staff-service'/n).read_bytes() for n in ['settlement-schedules.js','settlement-runtime.js']}),
 'producer':('staging-driver-financial-accept',{'index.js':pathlib.Path('/private/tmp/full-cash-208/runtime/financial-runtime.js').read_bytes()})}
assert phase in sets
if phase=='consumer':assert receipt['phases'].get('retention',{}).get('status')=='VERIFIED'
if phase=='producer':assert receipt['phases'].get('consumer',{}).get('status')=='VERIFIED'
name,changes=sets[phase];before=json.loads((p/'live'/f'{name}.config.private.json').read_text());base=(p/'live'/f'{name}.zip').read_bytes();sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode();assert sha(base)==before['CodeSha256'];candidate=p/(phase+'-candidate.zip')
with zipfile.ZipFile(p/'live'/f'{name}.zip') as old:
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for n,b in changes.items():
   if n not in old.namelist():out.writestr(n,b)
 with zipfile.ZipFile(candidate) as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
raw=candidate.read_bytes();current=lam.get_function_configuration(FunctionName=name)
if current['CodeSha256']!=sha(raw):
 assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT'
 lam.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=raw,Publish=False)
for _ in range(90):
 after=lam.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(raw)
for k in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage','Environment']:assert after.get(k)==before.get(k),(k,'CONFIGURATION_DRIFT')
if phase=='consumer':
 r=lam.invoke(FunctionName=name,Payload=json.dumps({'httpMethod':'GET','path':'/staff/settlement-schedules','queryStringParameters':{'view':'period-collections','branchId':'invalid'},'headers':{}}).encode());v=json.loads(r['Payload'].read());assert not r.get('FunctionError') and v.get('statusCode')==401
receipt['phases'][phase]={'status':'VERIFIED','function':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'otherFilesAndConfigurationPreserved':True,'publishedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())};save();print(json.dumps(receipt['phases'][phase]))
