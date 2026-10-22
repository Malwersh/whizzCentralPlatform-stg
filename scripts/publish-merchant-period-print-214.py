"""Publish only reviewed finance page assets, preserving all other hosted bytes."""
import sys,pathlib,json,urllib.request,zipfile,copy,hashlib,time
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
p=pathlib.Path('/private/tmp/period-print-214/hosting');p.mkdir(parents=True,exist_ok=True)
a=session().client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'}
base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED'
meta=a.get_job(**args,jobId=base['jobId'])['job']
url=next(v['artifactsUrl'] for v in meta['steps'] if v.get('artifactsUrl'))
(p/'base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read())
changes={n:pathlib.Path('frontend',n).read_bytes() for n in ['pages/finance.html','settlement-orders.js','merchant-financial-account.js','merchant-period-print.js']}
with zipfile.ZipFile(p/'base.zip') as old:
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for item in old.infolist():out.writestr(copy.copy(item),changes.get(item.filename,old.read(item.filename)))
  for n,b in changes.items():
   if n not in old.namelist():out.writestr(n,b)
 with zipfile.ZipFile(p/'candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'],'HOSTING_DRIFT'
up=a.create_deployment(**args);b=(p/'candidate.zip').read_bytes()
r={'part':214,'baseJobId':base['jobId'],'jobId':up['jobId'],'changedFiles':list(changes),'otherFilesPreserved':True,'status':'UPLOADING','sha256':hashlib.sha256(b).hexdigest()}
doc=pathlib.Path('docs/merchant-period-print-publication-214.json')
def save():doc.write_text(json.dumps(r,indent=2)+'\n')
save();urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=b,method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read()
a.start_deployment(**args,jobId=up['jobId']);print('Staging deployment '+up['jobId'],flush=True)
for _ in range(90):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
r['status']=status;save();assert status=='SUCCEED'
for n,data in changes.items():
 for attempt in range(12):
  hosted=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=214-'+str(attempt),timeout=30).read()
  if hosted==data:break
  time.sleep(3)
 assert hosted==data,'HOSTED_BYTES_MISMATCH '+n
r['hostedBytesVerified']=True;save();print('Period summary print published and exact bytes verified.',flush=True)
