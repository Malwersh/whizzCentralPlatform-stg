"""Selective staging publication. Keeps colleague handler and every unrelated hosted entry."""
import pathlib,json,zipfile,copy,hashlib,base64,sys,urllib.request,time
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/general321');base=json.loads((p/'base-safe.json').read_text())
def sha(raw):return base64.b64encode(hashlib.sha256(raw).digest()).decode()
def config_hash(c):
 fields=['Role','Handler','Runtime','Timeout','MemorySize','Environment','Layers','Architectures','VpcConfig','KMSKeyArn','FileSystemConfigs','EphemeralStorage','TracingConfig']
 return hashlib.sha256(json.dumps({k:c.get(k)for k in fields},sort_keys=True).encode()).hexdigest()
def overlay(source,dest,changes):
 with zipfile.ZipFile(source)as old:
  assert set(changes)<=set(old.namelist())
  with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED)as new:
   for entry in old.infolist():new.writestr(copy.copy(entry),changes.get(entry.filename,old.read(entry.filename)))
  with zipfile.ZipFile(dest)as new:
   assert set(old.namelist())==set(new.namelist())
   for n in old.namelist():assert new.read(n)==changes.get(n,old.read(n)),n
assert 'fail 0' in (p/'financial-tests.log').read_text()
assert 'fail 0' in (p/'staff-tests.log').read_text()
assert 'PASS:' in (p/'browser-general.log').read_text()
assert 'draftForms' in (p/'browser-existing.log').read_text()
assert 'All tests passed' in (p/'flutter-tests.log').read_text()
assert 'warning ' not in (p/'flutter-analyze.log').read_text()
with zipfile.ZipFile(p/'quotes-base.zip')as z:
 assert b"require('./storefront-route-runtime')"in z.read('index.js')
overlay(p/'quotes-base.zip',p/'quotes-updated.zip',{'storefront-route-runtime.js':(p/'storefront-route-runtime.js').read_bytes()})
files=['delivery-pricing.js','pages/delivery-pricing.html']
overlay(p/'hosting-base.zip',p/'hosting-updated.zip',{n:(root/'frontend'/n).read_bytes()for n in files})
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};name=base['function']
c=l.get_function_configuration(FunctionName=name);assert c['CodeSha256']==base['codeSha256']and c['RevisionId']==base['revisionId']and config_hash(c)==base['configHash'],'Concurrent quote change'
assert not l.list_aliases(FunctionName=name)['Aliases']
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['hostingJobId'],'Concurrent hosting change'
record={'part':321,'status':'PUBLISHING','function':name,'baseCodeSha256':c['CodeSha256'],'changedLambdaEntries':['storefront-route-runtime.js'],'colleagueHandlerPreserved':True,'hostingFiles':files,'businessDataWrites':0,'configurationChanged':False,'iamChanged':False}
doc=root/'docs/general-pricing-code-publication-321.json';doc.write_text(json.dumps(record,indent=2)+'\n')
l.update_function_code(FunctionName=name,ZipFile=(p/'quotes-updated.zip').read_bytes(),RevisionId=c['RevisionId'])
for _ in range(90):
 c=l.get_function_configuration(FunctionName=name)
 if c.get('LastUpdateStatus')=='Successful':break
 assert c.get('LastUpdateStatus')!='Failed';time.sleep(1)
assert c.get('LastUpdateStatus')=='Successful'and c['CodeSha256']==sha((p/'quotes-updated.zip').read_bytes())and config_hash(c)==base['configHash']
record['codeSha256']=c['CodeSha256'];record['quotePublished']=True;doc.write_text(json.dumps(record,indent=2)+'\n')
r=l.invoke(FunctionName=name,Payload=json.dumps({'httpMethod':'OPTIONS','headers':{}}).encode());reply=json.loads(r['Payload'].read());assert not r.get('FunctionError')and reply['statusCode']==204
print('PASS: route module published; colleague handler and all settings preserved.',flush=True)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['hostingJobId'],'Concurrent hosting change'
u=a.create_deployment(**args);record['hostingJobId']=u['jobId'];doc.write_text(json.dumps(record,indent=2)+'\n')
urllib.request.urlopen(urllib.request.Request(u['zipUploadUrl'],data=(p/'hosting-updated.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=u['jobId'])
for _ in range(90):
 status=a.get_job(**args,jobId=u['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert status=='SUCCEED',status
for n in files:
 raw=(root/'frontend'/n).read_bytes()
 for attempt in range(8):
  actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?verify=321-'+str(attempt),timeout=30).read()
  if raw==actual:break
  time.sleep(2)
 assert raw==actual,n
record['status']='PUBLISHED_VERIFIED';record['hostedBytesVerified']=True;record['unrelatedArchiveEntriesPreserved']=True;doc.write_text(json.dumps(record,indent=2)+'\n');print('PASS: live pricing UI verified; unrelated hosted files preserved.',flush=True)
