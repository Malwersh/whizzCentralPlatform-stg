"""Publish the benefit form only, preserving every unrelated file in the current hosting artifact."""
import sys,pathlib,json,zipfile,copy,urllib.request,time,hashlib
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/benefits-ui-287')
a=session().client('amplify');args=dict(appId='d2vmebm1e1n95m',branchName='staging');base=json.loads((p/'base.json').read_text())
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'],'Hosting changed; recapture and review before publishing'
with zipfile.ZipFile(p/'base.zip') as old:
 page=old.read('pages/promotions.html').decode();import re
 page,count=re.subn(r'platform-benefits-admin\.js\?v=[^"\s]+','platform-benefits-admin.js?v=20261022-benefits287',page);assert count==1
 changes={'platform-benefits-admin.js':(root/'frontend/platform-benefits-admin.js').read_bytes(),'pages/promotions.html':page.encode()}
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 with zipfile.ZipFile(p/'candidate.zip') as new:
  assert new.namelist()==old.namelist();assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in changes)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId']
u=a.create_deployment(**args);record={'part':287,'status':'PUBLISHING','baseJobId':base['jobId'],'jobId':u['jobId'],'changedFiles':list(changes),'otherHostingEntriesPreserved':True,'backendChanged':False,'businessDataWritten':False,'percentage':'handoff to existing protected percentage offer editor; no new benefit schema','browserChecks':'fixed-benefit payload, conditional fields, direct-target validation, draft reset, percentage editor handoff, responsive 390/768/1440px','sha256':{n:hashlib.sha256(b).hexdigest() for n,b in changes.items()}}
doc=root/'docs/benefits-ui-publication-287.json';doc.write_text(json.dumps(record,indent=2)+'\n')
urllib.request.urlopen(urllib.request.Request(u['zipUploadUrl'],data=(p/'candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=u['jobId']);print('Started staging hosting',u['jobId'],flush=True)
for _ in range(100):
 state=a.get_job(**args,jobId=u['jobId'])['job']['summary']['status']
 if state in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert state=='SUCCEED',state
for n,b in changes.items():
 for attempt in range(8):
  live=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?verify=287-'+str(attempt),timeout=30).read()
  if live==b:break
  time.sleep(3)
 assert live==b,n
record['status']='PUBLISHED_VERIFIED';doc.write_text(json.dumps(record,indent=2)+'\n');print('PASS: live form and cache-version verified; other site files preserved.',flush=True)
