"""Deploy reviewed additive device-transfer closure. No transfers, OTP or grants."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,urllib.request
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/finance-device-closure-213');baseline=pathlib.Path('/private/tmp/finance-closure-213')
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180'
c=s.client('cloudformation');lam=s.client('lambda');api=s.client('apigateway');doc=root/'docs/device-transfer-closure-213.json';r=json.loads(doc.read_text());assert r['status']=='PREPARED_ADDITIVE_REVIEWED' and not r['executed']
old=json.loads((baseline/'authorizer-base-config.private.json').read_text());current=lam.get_function_configuration(FunctionName=old['FunctionName']);assert current['RevisionId']==old['RevisionId'] and current['CodeSha256']==old['CodeSha256']
template=json.loads((p/'template.json').read_text());assert current['Role'].rsplit('/',1)[1]==template['Parameters']['WalletAuthorizerRoleName']['Default']
assert hashlib.sha256((p/'device-transfers.zip').read_bytes()).hexdigest()==r['packageSha256']
q=c.describe_change_set(StackName=r['stack'],ChangeSetName=r['changeSetId']);assert q['Status']=='CREATE_COMPLETE' and q['ExecutionStatus']=='AVAILABLE';assert len(q['Changes'])==33 and all(v['ResourceChange']['Action']=='Add' for v in q['Changes'])
def save():doc.write_text(json.dumps(r,indent=2)+'\n')
c.execute_change_set(StackName=r['stack'],ChangeSetName=r['changeSetId']);r.update(status='DEPLOYING',executed=True);save();print('Deploying reviewed current-source stack',flush=True)
for _ in range(180):
 status=c.describe_stacks(StackName=r['stack'])['Stacks'][0]['StackStatus']
 if status not in ['CREATE_IN_PROGRESS','REVIEW_IN_PROGRESS']:break
 time.sleep(2)
assert status=='CREATE_COMPLETE',status
function=lam.get_function_configuration(FunctionName='staging-merchant-device-transfers');assert function['LastUpdateStatus']=='Successful'
assert function['CodeSha256']==base64.b64encode(hashlib.sha256((p/'device-transfers.zip').read_bytes()).digest()).decode()
# Consumers and invoke permission exist before enabling the exact authorizer delegate.
with zipfile.ZipFile(baseline/'authorizer-base.zip') as oldzip:
 with zipfile.ZipFile(p/'authorizer-candidate.zip','w',zipfile.ZIP_DEFLATED) as newzip:
  for entry in oldzip.infolist():newzip.writestr(copy.copy(entry),(root/'backend/wallet-service/authorizer_lambda/authorizer.py').read_bytes() if entry.filename=='authorizer.py' else oldzip.read(entry.filename))
 with zipfile.ZipFile(p/'authorizer-candidate.zip') as newzip:assert all(newzip.read(n)==oldzip.read(n) for n in oldzip.namelist() if n!='authorizer.py')
current=lam.get_function_configuration(FunctionName=old['FunctionName']);assert current['RevisionId']==old['RevisionId'] and current['CodeSha256']==old['CodeSha256']
lam.update_function_code(FunctionName=old['FunctionName'],RevisionId=current['RevisionId'],ZipFile=(p/'authorizer-candidate.zip').read_bytes());lam.get_waiter('function_updated_v2').wait(FunctionName=old['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':60})
current=lam.get_function_configuration(FunctionName=old['FunctionName']);env=dict(current['Environment']['Variables']);env['MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION']=function['FunctionArn'];lam.update_function_configuration(FunctionName=old['FunctionName'],RevisionId=current['RevisionId'],Environment={'Variables':env});lam.get_waiter('function_updated_v2').wait(FunctionName=old['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':60})
after=lam.get_function_configuration(FunctionName=old['FunctionName']);assert after['Environment']['Variables']==env
for k in ['Role','Runtime','Handler','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage']:assert after.get(k)==old.get(k),k
beforeResources=json.loads((p/'api-before.private.json').read_text());afterResources=api.get_resources(restApiId='z14s5f8oxh',limit=500)['items'];byid={v['id']:v for v in afterResources}
assert all(byid.get(v['id'])==v for v in beforeResources),'EXISTING_API_RESOURCE_DRIFT'
routes=[v for v in afterResources if v.get('path','').startswith('/wallet/branch-device/transfers/') and v.get('resourceMethods')];assert len(routes)==8
for path,method in [('context','GET'),('recipient','GET'),('history','GET'),('status','GET'),('otp/send','POST'),('otp/verify','POST'),('request','POST'),('cancel','POST')]:
 resource=next(v for v in routes if v['path']=='/wallet/branch-device/transfers/'+path);m=api.get_method(restApiId='z14s5f8oxh',resourceId=resource['id'],httpMethod=method);assert m['authorizationType']=='CUSTOM' and m['authorizerId']=='2bqq12' and function['FunctionArn'] in m['methodIntegration']['uri']
result=lam.invoke(FunctionName=function['FunctionName'],Payload=json.dumps({'path':'/wallet/branch-device/transfers/context','httpMethod':'GET','headers':{}}).encode());body=json.loads(result['Payload'].read());assert not result.get('FunctionError') and body['statusCode']==401
r.update(status='PUBLISHED_VERIFIED',functionName=function['FunctionName'],functionCodeSha256=function['CodeSha256'],authorizerCodeSha256=after['CodeSha256'],authorizerOtherFilesAndConfigPreserved=True,existingApiResourcesPreserved=True,exactRoutesVerified=8,negativeAuthSmoke=401,humanPermissionGrantsChanged=False,financialOperationsRequested=False,otpSent=False,realTransferAcceptance='NOT_PERFORMED')
save();print(json.dumps({k:r[k] for k in ['status','functionName','exactRoutesVerified','negativeAuthSmoke','financialOperationsRequested','otpSent']}),flush=True)
