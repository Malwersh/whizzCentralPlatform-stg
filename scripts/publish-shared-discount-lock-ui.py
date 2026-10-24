"""Overlay tested lock labels and actions on current Staging hosting, preserving unrelated assets."""
import sys,pathlib,json,zipfile,copy,re,urllib.request,hashlib,subprocess,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/shared-lock-release');assert json.loads((O/'publication.json').read_text())['status']=='PUBLISHED_VERIFIED'
a=session().client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED'
meta=a.get_job(**args,jobId=base['jobId'])['job'];url=next(s['artifactsUrl'] for s in meta['steps'] if s.get('artifactsUrl'));(O/'frontend.base.zip').write_bytes(urllib.request.urlopen(url,timeout=60).read());files=['commercial-management.js','data-service.js','promotions-workspace.js'];changes={}
previousReport=json.loads((O/'frontend-publication.json').read_text()) if (O/'frontend-publication.json').exists() else {}
previousBytes={}
if previousReport.get('status')=='PUBLISHED_VERIFIED' and previousReport.get('jobId')==base['jobId']:
 with zipfile.ZipFile(O/'frontend.candidate.zip') as previous:previousBytes={n:previous.read(n) for n in files}
with zipfile.ZipFile(O/'frontend.base.zip') as old:
 for name in files:
  expected=previousBytes.get(name) or subprocess.check_output(['git','show','HEAD:frontend/'+name],cwd=R);assert old.read(name)==expected,'LIVE_HOSTING_DRIFT '+name
  changes[name]=(R/'frontend'/name).read_bytes()
 for name in old.namelist():
  if not name.endswith('.html'):continue
  body=old.read(name).decode();updated=body
  for script in files:updated=re.sub(r'('+re.escape(script)+r')(?:\?[^"\s<>]*)?(?=")',r'\1?v=shared-lock-238',updated)
  if body!=updated:changes[name]=updated.encode()
 with zipfile.ZipFile(O/'frontend.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for item in old.infolist():out.writestr(copy.copy(item),changes.get(item.filename,old.read(item.filename)))
 with zipfile.ZipFile(O/'frontend.candidate.zip') as new:assert all(old.read(n)==new.read(n) for n in old.namelist() if n not in changes)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'];d=a.create_deployment(**args);data=(O/'frontend.candidate.zip').read_bytes();urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=data,method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).read();a.start_deployment(**args,jobId=d['jobId']);report={'status':'PUBLISHING','jobId':d['jobId'],'baseJobId':base['jobId'],'changedFiles':list(changes),'businessDataWritten':False};save=lambda:(O/'frontend-publication.json').write_text(json.dumps(report,indent=2));save()
for _ in range(90):
 status=a.get_job(**args,jobId=d['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert status=='SUCCEED',status
for n in files:
 actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=shared-lock-238',timeout=30).read();assert actual==changes[n],n
report.update(status='PUBLISHED_VERIFIED',hostedBytesMatched=True);save();print(json.dumps(report))
