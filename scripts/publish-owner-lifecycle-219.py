"""Enable existing owner return/cancellation adapters in staging; three env keys only."""
import sys,json,pathlib,time,subprocess,urllib.request,urllib.error
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/lifecycle-219/live');name='order-receiver-regional-staging-unified-auth-v4-sam';s=session();l=s.client('lambda');iam=s.client('iam');assert s.client('sts').get_caller_identity()['Account']=='699561669180'
subprocess.run(['node','scripts/test-owner-lifecycle-entry-219.cjs'],cwd=root,check=True)
before=json.loads((p/(name+'.config.private.json')).read_text());live=l.get_function_configuration(FunctionName=name);assert live['CodeSha256']==before['CodeSha256'] and live['RevisionId']==before['RevisionId'],'LIVE_DRIFT'
target='arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept';decision=iam.simulate_principal_policy(PolicySourceArn=before['Role'],ActionNames=['lambda:InvokeFunction'],ResourceArns=[target])['EvaluationResults'][0]['EvalDecision'];assert decision=='allowed'
old=before.get('Environment',{}).get('Variables',{});delta={'FINANCIAL_COD_RETURNS_MODE':'REQUIRED','FINANCIAL_COD_ASSIGNMENTS_MODE':'REQUIRED','FINANCIAL_ACCEPT_FUNCTION_ARN':target};env={**old,**delta};size=sum(len(k.encode())+len(v.encode()) for k,v in env.items());assert size<4096
l.update_function_configuration(FunctionName=name,RevisionId=live['RevisionId'],Environment={'Variables':env})
for _ in range(90):
 after=l.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful' and after['Environment']['Variables']==env
for k in ['CodeSha256','Role','Runtime','Handler','Timeout','MemorySize','Architectures','VpcConfig','Layers']:assert before.get(k)==after.get(k),'CONFIG_DRIFT '+k
smokes=[]
for path,method in [('/auth/order-returns','GET'),('/auth/order-returns','POST'),('/auth/order-cancellation','POST')]:
 request=urllib.request.Request('https://ie7z8r4wc0.execute-api.us-east-1.amazonaws.com/staging'+path,method=method,headers={'Authorization':'INVALID_NEGATIVE_SMOKE','Content-Type':'application/json'},data=b'{}' if method=='POST' else None)
 try:r=urllib.request.urlopen(request,timeout=30);status=r.status
 except urllib.error.HTTPError as e:status=e.code
 assert status==401,(path,method,status);smokes.append({'path':path,'method':method,'unauthenticatedStatus':status})
r={'part':219,'status':'PUBLISHED_GENERAL_STAGING_ACTIVE','function':name,'codeSha256Preserved':after['CodeSha256'],'changedEnvironmentKeys':list(delta),'otherEnvironmentPreserved':True,'envBytesAfter':size,'existingBoundedInvokePermissionVerified':True,'permissionsChanged':False,'codeChanged':False,'apiAuthorizationChanged':False,'financialMutationsPerformed':False,'negativeGatewayAuthSmokes':smokes,'actualBundledAdapterTest':'Missing-config failure reproduced; corrected config passes owner-scoped delegation and rejects foreign owner/injected money','iac':'whizzMerchants-stg/backend/template.yaml: staging-only required gates'}
(root/'docs/owner-lifecycle-publication-219.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
