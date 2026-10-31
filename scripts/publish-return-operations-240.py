"""Publish tested bounded packages only after explicit metadata access approval."""
import pathlib,sys,json,hashlib,base64,time,urllib.request,zipfile,copy
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=r/'backend/.tmp/order-exceptions-work/return-240';s=session();l=s.client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
assert json.loads((r/'docs/return-operations-access-240.json').read_text())['status']=='APPLIED'
for f in ['wallet-tests-final.log','captured-final.log','staff-tests.log']:assert 'fail 0' in(p/f).read_text(),f
for f in ['browser.log','findings-browser.log','authorization-browser.log']:assert 'PASS 'in(p/f).read_text(),f
manifest=json.loads((p/'package-manifest.json').read_text());record={'part':240,'status':'PUBLISHING','functions':[],'financialWritesByAgent':False};doc=r/'docs/return-operations-publication-240.json'
def save():doc.write_text(json.dumps(record,indent=2)+'\n')
# Verify every service before the first mutation.
for row in manifest:assert l.get_function_configuration(FunctionName=row['name'])['CodeSha256']==row['baseCodeSha256'],'LIVE_CODE_DRIFT '+row['label']
for row in manifest:
 name=row['name'];current=l.get_function_configuration(FunctionName=name);assert current['CodeSha256']==row['baseCodeSha256']
 raw=(p/(row['label']+'-candidate.zip')).read_bytes();assert hashlib.sha256(raw).hexdigest()==row['candidateSha256']
 l.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(80):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(raw)
 for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage']:assert current.get(k)==after.get(k),'CONFIG_DRIFT '+k
 record['functions'].append({**row,'codeSha256':sha(raw),'configurationPreserved':True});save();print('Published '+name,flush=True)
record['status']='FUNCTIONS_PUBLISHED';save()
a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED'
meta=a.get_job(**args,jobId=base['jobId'])['job'];url=next(v['artifactsUrl']for v in meta['steps']if v.get('artifactsUrl'));hp=p/'hosting';hp.mkdir(exist_ok=True);(hp/'base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read())
changes={n:(r/'frontend'/n).read_bytes()for n in ['pages/order-exceptions.html','order-exception-cases.js','return-operations-settings.js']}
with zipfile.ZipFile(hp/'base.zip')as old:
 with zipfile.ZipFile(hp/'candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for n,b in changes.items():
   if n not in old.namelist():out.writestr(n,b)
 with zipfile.ZipFile(hp/'candidate.zip')as out:assert all(out.read(n)==old.read(n)for n in old.namelist()if n not in changes)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'],'HOSTING_DRIFT'
up=a.create_deployment(**args);raw=(hp/'candidate.zip').read_bytes();record['hosting']={'baseJobId':base['jobId'],'jobId':up['jobId'],'changedFiles':list(changes),'otherFilesPreserved':True,'status':'UPLOADING'};save()
urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=raw,method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=up['jobId']);print('Hosting '+up['jobId'],flush=True)
for _ in range(90):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
record['hosting']['status']=status;save();assert status=='SUCCEED'
for n,b in changes.items():
 for attempt in range(12):
  hosted=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=240-'+str(attempt),timeout=30).read()
  if hosted==b:break
  time.sleep(3)
 assert hosted==b,'HOSTED_BYTES_MISMATCH '+n
record['hosting']['hostedBytesVerified']=True;record['status']='PUBLISHED';save();print('PASS bounded services and exact hosted bytes published.',flush=True)
