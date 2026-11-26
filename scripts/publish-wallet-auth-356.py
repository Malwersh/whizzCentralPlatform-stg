from pathlib import Path
import subprocess,json,hashlib,base64,time,urllib.request,urllib.error
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/wallet-auth-356';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def wait(name):
 for _ in range(90):
  c=aws('lambda','get-function-configuration','--function-name',name)
  if c['LastUpdateStatus']=='Successful':return c
  assert c['LastUpdateStatus']!='Failed';time.sleep(1)
 raise RuntimeError('Lambda update pending')
assert aws('sts','get-caller-identity')['Account']=='699561669180';assert len(json.loads((P/'api-parity-proof.json').read_text()))==141;assert 'pass 68' in Path('/tmp/auth356-unit.log').read_text();assert '\nOK\n' in Path('/tmp/auth356-authorizer.log').read_text()
manifest=json.loads((P/'manifest.private.json').read_text())
for m in manifest:
 c=aws('lambda','get-function-configuration','--function-name',m['name']);assert c['RevisionId']==m['revisionId'] and c['CodeSha256']==m['beforeSha256'];assert base64.b64encode(hashlib.sha256(Path(m['candidate']).read_bytes()).digest()).decode()==m['candidateSha256']
resources=json.loads((P/'resources.private.json').read_text())['items'];rid=next(v['id'] for v in resources if v['path']=='/wallet/create');current=aws('apigateway','get-method','--rest-api-id','z14s5f8oxh','--resource-id',rid,'--http-method','POST');assert current['authorizationType']=='NONE'
dest=R/'docs/wallet-authorization-publication-356.json';r={'part':356,'scope':'staging','status':'PUBLISHING','functions':[],'financialRecordsWritten':0,'balanceChanges':False,'apiMethodsParityBefore':141}
def save():dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
save()
# Close the public endpoint first. Existing signed trigger still works through the old handler during the transition.
aws('apigateway','update-method','--rest-api-id','z14s5f8oxh','--resource-id',rid,'--http-method','POST','--patch-operations',json.dumps([{'op':'replace','path':'/authorizationType','value':'AWS_IAM'}]));deployment=aws('apigateway','create-deployment','--rest-api-id','z14s5f8oxh','--stage-name','staging','--description','356 Require signed IAM for wallet provisioning');r['api']={'deploymentId':deployment['id'],'path':'POST /wallet/create','authorization':'AWS_IAM'};save();print('Published IAM-only wallet creation method',flush=True)
role=json.loads((P/'staging-wizz-wallet-creation-trigger-config.private.json').read_text())['Role'];pool=json.loads((P/'staging-wizz-wallet-authorizer-config.private.json').read_text())['Environment']['Variables']['DRIVER_USER_POOL_ID']
fields=['Runtime','Handler','Role','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig','EphemeralStorage','FileSystemConfigs','DeadLetterConfig']
for m in manifest:
 old=json.loads((P/(m['name']+'-config.private.json')).read_text());env=dict(old['Environment']['Variables']);env.update({'WALLET_CREATION_CALLER_ROLE_ARN':role} if m['name'].endswith('service') else {'DRIVER_USER_POOL_ID':pool});env.pop('WALLET_TRIGGER_SECRET',None)
 c=aws('lambda','get-function-configuration','--function-name',m['name']);assert c['CodeSha256']==m['beforeSha256'] and c['RevisionId']==m['revisionId']
 aws('lambda','update-function-configuration','--function-name',m['name'],'--revision-id',c['RevisionId'],'--environment',json.dumps({'Variables':env}));c=wait(m['name']);assert c['Environment']['Variables']==env
 aws('lambda','update-function-code','--function-name',m['name'],'--revision-id',c['RevisionId'],'--zip-file','fileb://'+m['candidate']);c=wait(m['name']);assert c['CodeSha256']==m['candidateSha256'] and all(c.get(k)==old.get(k) for k in fields) and c['Environment']['Variables']==env
 r['functions'].append({'name':m['name'],'sha256':c['CodeSha256'],'changedFiles':m['changedFiles'],'unrelatedEntriesPreserved':True,'configurationPreservedExceptExplicitAuthBindings':True});save();print('Published verified',m['name'],flush=True)
# Negative-only live smoke: empty body cannot create a wallet even if a gateway regression existed.
url='https://z14s5f8oxh.execute-api.us-east-1.amazonaws.com/staging/wallet/create';proof=[]
for label,headers in [('anonymous',{}),('untrusted-header',{'x-trigger-secret':'invalid-test-value'})]:
 for attempt in range(10):
  try:
   response=urllib.request.urlopen(urllib.request.Request(url,data=b'{}',headers={'Content-Type':'application/json',**headers}),timeout=15);status=response.status
  except urllib.error.HTTPError as e:status=e.code
  if status==403:break
  time.sleep(2)
 assert status==403,(label,status);proof.append({'case':label,'status':status,'body':'empty object; no financial mutation'})
current=aws('apigateway','get-method','--rest-api-id','z14s5f8oxh','--resource-id',rid,'--http-method','POST');assert current['authorizationType']=='AWS_IAM';r['liveNegativeChecks']=proof;r['status']='PUBLISHED_STAGING_VERIFIED_POSITIVE_SIGNUP_ACCEPTANCE_QUEUED';save();print('PASS IAM-only route rejects anonymous and header-only requests; no financial data written')
