"""Read back deployment metadata and reject an invalid financial invocation.

Never supplies an order, driver, token, scheduled trigger, or payment proof.
"""
import sys,pathlib,json,gzip,base64
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
p=pathlib.Path('/private/tmp/full-cash-208');s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180'
lam=s.client('lambda');iam=s.client('iam');m=json.loads((p/'packages/candidates.json').read_text());a=json.loads((p/'access/candidates.json').read_text());results=[]
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'))
for r in m['functions']:
 c=lam.get_function_configuration(FunctionName=r['name']);old=json.loads((p/'live'/(r['name']+'.config.private.json')).read_text())
 assert c['CodeSha256']==r['candidateCodeSha256'] and c['LastUpdateStatus']=='Successful'
 for k in ['Role','Handler','Runtime','MemorySize','Timeout','Architectures','VpcConfig','EphemeralStorage']:
  assert c.get(k)==old.get(k),'RESOURCE_DRIFT '+r['name']+' '+k
 expected=dict(old.get('Environment',{}).get('Variables',{}))
 if r['financialGeneralActivationRequired']:
  expected.update(FINANCE_GENERAL_RELEASE_MODE='REQUIRED',FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1')
  expected['FINANCE_ROLLOUT_CONFIG']='GZIP208:'+base64.b64encode(gzip.compress(expected['FINANCE_ROLLOUT_CONFIG'].encode(),mtime=0)).decode()
 assert c.get('Environment',{}).get('Variables',{})==expected,'ENVIRONMENT_DRIFT '+r['name']
 results.append({'name':r['name'],'codeMatches':True,'configurationMatches':True,'resourcesPreserved':True,'generalActivation':r['financialGeneralActivationRequired']})
for n,d in a['staffInlineUpdates'].items():assert canonical(iam.get_role_policy(RoleName=a['staffRole'],PolicyName=n)['PolicyDocument'])==canonical(d)
policy=a['acceptanceInlinePolicy'];assert canonical(iam.get_role_policy(RoleName=a['acceptanceRole'],PolicyName=policy['name'])['PolicyDocument'])==canonical(policy['document'])
arn='arn:aws:iam::699561669180:policy/'+a['staffManagedPolicy']['name'];v=iam.get_policy(PolicyArn=arn)['Policy']['DefaultVersionId']
assert canonical(iam.get_policy_version(PolicyArn=arn,VersionId=v)['PolicyVersion']['Document'])==canonical(a['staffManagedPolicy']['document'])
assert arn in [v['PolicyArn'] for v in iam.list_attached_role_policies(RoleName=a['staffRole'])['AttachedPolicies']]
response=lam.invoke(FunctionName='staging-driver-financial-accept',InvocationType='RequestResponse',Payload=b'{}')
body=json.loads(response['Payload'].read());assert not response.get('FunctionError') and body.get('statusCode')==409 and body.get('code')=='INVALID_FINANCIAL_ACCEPTANCE',body
smokes=[{'function':'staging-driver-financial-accept','statusCode':409,'purpose':'reject invalid envelope before order access'}]
for name,event,status in [
 ('staging-wizz-staff-service',{'httpMethod':'GET','path':'/staff/settlement-schedules','headers':{},'queryStringParameters':{}},401),
 ('WizzUser-CreateOrder-staging',{'httpMethod':'POST','resource':'/orders','path':'/orders','body':'{}','headers':{},'requestContext':{}},400)]:
 response=lam.invoke(FunctionName=name,InvocationType='RequestResponse',Payload=json.dumps(event).encode())
 body=json.loads(response['Payload'].read());assert not response.get('FunctionError') and body.get('statusCode')==status,body
 smokes.append({'function':name,'statusCode':status,'purpose':'reject missing authentication or required fields without an order'})
receipt={'part':208,'status':'VERIFIED','functions':results,'accessPoliciesMatch':True,'invalidFinancialInvocationRejectedBeforeOrderAccess':True,'negativeSmokes':smokes,'orderIdOrTokenSupplied':False,'financialOperationsRequested':False,'cardPaymentsEnabled':False}
path=pathlib.Path(__file__).resolve().parents[1]/'docs/full-cash-verification-208.json';path.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'verifiedFunctions':len(results),'generalActivation':sum(r['generalActivation'] for r in results),'accessPoliciesMatch':True,'invalidInvocationRejected':True}))
