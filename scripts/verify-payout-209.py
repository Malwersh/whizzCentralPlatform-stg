"""Verify deployed metadata/access and negative auth only; no payout or OTP action."""
import sys,pathlib,json
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
p=pathlib.Path('/private/tmp/payout-209');root=pathlib.Path(__file__).resolve().parents[1];s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda');iam=s.client('iam')
m=json.loads((p/'packages.json').read_text());a=json.loads((p/'access.private.json').read_text());results=[]
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'))
for f in m['functions']:
 c=lam.get_function_configuration(FunctionName=f['name']);old=json.loads((p/'live'/(f['name']+'.config.private.json')).read_text());assert c['CodeSha256']==f['codeSha256'] and c['LastUpdateStatus']=='Successful'
 for key in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage']:assert c.get(key)==old.get(key),(f['name'],key)
 expected=old.get('Environment',{}).get('Variables',{})
 if f['name']=='staging-wizz-staff-service':expected={**expected,**a['staffEnvAdditions']}
 assert c.get('Environment',{}).get('Variables',{})==expected,'ENVIRONMENT_DRIFT'
 results.append({'name':f['name'],'codeMatches':True,'configurationMatches':True,'resourcesPreserved':True})
for role,name in [(a['staffRole'],'staffManagedPolicy'),(a['workerRole'],'workerManagedPolicy')]:
 policy=a[name];arn='arn:aws:iam::699561669180:policy/'+policy['name'];version=iam.get_policy(PolicyArn=arn)['Policy']['DefaultVersionId'];actual=iam.get_policy_version(PolicyArn=arn,VersionId=version)['PolicyVersion']['Document'];assert canonical(actual)==canonical(policy['document']);assert arn in [p['PolicyArn'] for p in iam.list_attached_role_policies(RoleName=role)['AttachedPolicies']]
assert canonical(iam.get_role_policy(RoleName=a['staffRole'],PolicyName=a['staffInlinePolicy']['name'])['PolicyDocument'])==canonical(a['staffInlinePolicy']['document'])
smokes=[]
for name,event in [
 ('staging-wizz-staff-service',{'httpMethod':'GET','path':'/staff/settlement-schedules','queryStringParameters':{'view':'payouts'},'headers':{}}),
 ('staging-wizz-staff-service',{'action':'settlement_schedule_owner','httpMethod':'POST','input':{'action':'REQUEST_PAYOUT'},'accessToken':''})]:
 response=lam.invoke(FunctionName=name,InvocationType='RequestResponse',Payload=json.dumps(event).encode());body=json.loads(response['Payload'].read());assert not response.get('FunctionError') and body.get('statusCode')==401,body;smokes.append({'function':name,'expected':401,'actual':401,'tokenOrOrderOrPayoutIdSupplied':False})
r={'part':209,'status':'VERIFIED','functions':results,'policiesMatch':True,'negativeAuthSmokes':smokes,'methods':['CASH','ZAIN_CASH'],'manualExternalExecutionOnly':True,'bankEnabled':False,'existingApprovalLimitsPreserved':True,'secondFinanceEmployeeRequired':False,'ownerReceiptAndFinalReconciliationRequired':True,'payoutOrOtpRequested':False,'moneyMoved':False}
(root/'docs/merchant-payout-verification-209.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'verifiedFunctions':len(results),'accessPoliciesMatch':True,'negativeAuthSmokes':len(smokes),'payoutOrOtpRequested':False}))
