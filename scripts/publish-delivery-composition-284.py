"""Code-only coordinated staging publication. No IAM/config/business-data writes."""
import pathlib,sys,json,time,hashlib,base64,datetime
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/delivery-284');doc=root/'docs/delivery-composition-publication-284.json'
packages=json.loads((p/'packages.json').read_text());assert len(packages)==13
assert json.loads((p/'host-tests.json').read_text())['status']=='PASS'
assert json.loads((p/'iam-workloads.json').read_text())['status']=='PASS'
for label,count in [('financial',422),('staff',344),('user',40),('merchant',33)]:
 log=pathlib.Path('/private/tmp/delivery-284-'+label+'.log').read_text();assert 'fail 0'in log and ('tests '+str(count))in log,label
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda')
fields=['Role','Handler','Runtime','Timeout','MemorySize','Environment','Layers','Architectures','VpcConfig','KMSKeyArn','FileSystemConfigs','EphemeralStorage','TracingConfig']
def settings(c):return {k:c.get(k)for k in fields}
def wait(name):
 for _ in range(90):
  c=l.get_function_configuration(FunctionName=name)
  if c.get('LastUpdateStatus')=='Successful'and c.get('State')=='Active':return c
  if c.get('LastUpdateStatus')=='Failed':raise RuntimeError('LAMBDA_UPDATE_FAILED:'+name)
  time.sleep(1)
 raise RuntimeError('LAMBDA_UPDATE_TIMEOUT:'+name)
# Freeze every source revision before any mutation. Admission is published last.
for r in packages:
 c=l.get_function_configuration(FunctionName=r['function']);base=json.loads((p/(r['function']+'-config.private.json')).read_text())
 assert c['CodeSha256']==r['baseCodeSha256']and c['RevisionId']==r['baseRevisionId'],r['function']+' changed since review'
 assert settings(c)==settings(base),r['function']+' settings changed since review'
 assert 'staging'in c['Role'].lower(),r['function']+' role is not staging'
 assert not l.list_aliases(FunctionName=r['function'])['Aliases'],r['function']+' has aliases requiring separate effective-route review'
 candidate=p/(r['function']+'-candidate.zip');assert base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode()==r['candidateCodeSha256']
record={'part':284,'status':'PUBLISHING','account':'699561669180','region':'us-east-1','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'iamChanged':False,'configurationChanged':False,'hostingChanged':False,'businessDataModified':False,'functions':[],'reviewedFunctions':22,'unitTests':839,'actualHostAllocationFactories':42,'actualHostLifecycleFactories':29};doc.write_text(json.dumps(record,indent=2)+'\n');published=[]
try:
 for r in sorted(packages,key=lambda x:x['function']=='WizzUser-CreateOrder-staging'):
  name=r['function'];print('Publishing '+name,flush=True)
  l.update_function_code(FunctionName=name,ZipFile=(p/(name+'-candidate.zip')).read_bytes(),RevisionId=r['baseRevisionId'])
  # Track immediately so a failed waiter can still trigger a guarded rollback.
  published.append(r);c=wait(name);assert c['CodeSha256']==r['candidateCodeSha256']
  base=json.loads((p/(name+'-config.private.json')).read_text());assert settings(c)==settings(base)
  record['functions'].append({'function':name,'baseCodeSha256':r['baseCodeSha256'],'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'changedFiles':r['changedFiles'],'otherEntriesPreserved':True,'settingsPreserved':True});doc.write_text(json.dumps(record,indent=2)+'\n')
  print('Verified '+name,flush=True)
 # These probes reject missing authentication or return OPTIONS; no order/financial action.
 payload={'httpMethod':'GET','path':'/staff/company-accounts','headers':{},'queryStringParameters':{'from':'2026-10-01','through':'2026-10-22'}}
 result=l.invoke(FunctionName='staging-wizz-staff-service',Payload=json.dumps(payload).encode());body=json.loads(result['Payload'].read());assert not result.get('FunctionError')and body.get('statusCode')==401,body
 record['companyAccountsUnauthenticatedReadRejected']=True
 for name in ['WizzUser-CreateOrder-staging','WizzUser-DeliveryQuotes-staging','WizzUser-CancelOrder-staging']:
  result=l.invoke(FunctionName=name,Payload=json.dumps({'httpMethod':'OPTIONS','headers':{},'body':'{}'}).encode());body=json.loads(result['Payload'].read());assert not result.get('FunctionError')and body.get('statusCode')in [200,204],(name,body)
 record['optionsSmokePassed']=True
 # Verify the complete set again after admission has been switched.
 for r in packages:assert l.get_function_configuration(FunctionName=r['function'])['CodeSha256']==r['candidateCodeSha256']
 record['status']='PUBLISHED_VERIFIED';record['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();record['humanAcceptance']='PENDING';doc.write_text(json.dumps(record,indent=2)+'\n');print('PASS coordinated publication verified; no business records changed.',flush=True)
except Exception as error:
 record['status']='ROLLING_BACK';record['error']=str(error);record['rollback']=[];doc.write_text(json.dumps(record,indent=2)+'\n')
 for r in reversed(published):
  name=r['function']
  try:
   c=l.get_function_configuration(FunctionName=name)
   if c['CodeSha256']!=r['candidateCodeSha256']:record['rollback'].append({'function':name,'status':'SKIPPED_CONCURRENT_CODE_CHANGE'});continue
   l.update_function_code(FunctionName=name,ZipFile=(p/(name+'-base.zip')).read_bytes(),RevisionId=c['RevisionId']);c=wait(name);assert c['CodeSha256']==r['baseCodeSha256'];record['rollback'].append({'function':name,'status':'RESTORED'})
  except Exception as rollbackError:record['rollback'].append({'function':name,'status':'FAILED','error':str(rollbackError)})
 record['status']='FAILED_ROLLBACK_RECORDED';doc.write_text(json.dumps(record,indent=2)+'\n');raise
