"""Patch only the delivery settings section/script atop a fresh Staging Amplify artifact."""
import boto3,json,urllib.request,urllib.parse,hashlib,zipfile,re,os,time,copy
from pathlib import Path
root=Path('/private/tmp/dispatch50-release-final');repo=Path.cwd();s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';api=s.client('amplify');app='d2vmebm1e1n95m';branch='staging'
jobs=api.list_jobs(appId=app,branchName=branch,maxResults=10)['jobSummaries'];latest=jobs[0];assert latest['status']=='SUCCEED';job=api.get_job(appId=app,branchName=branch,jobId=latest['jobId'])['job'];url=next(x['artifactsUrl'] for x in job['steps'] if x.get('artifactsUrl'));assert urllib.parse.urlparse(url).scheme=='https' and urllib.parse.urlparse(url).hostname.endswith('.amazonaws.com');before=root/'frontend.rollback.zip';before.write_bytes(urllib.request.urlopen(url,timeout=90).read());before.chmod(0o600)
with zipfile.ZipFile(before) as a:
 html=a.read('pages/settings.html').decode();local=(repo/'frontend/pages/settings.html').read_text();ls=local.index('<section id="delivery-operations"');le=local.index('</section>',ls)+len('</section>');section=local[ls:le]
 if '<section id="delivery-operations"' in html:
  start=html.index('<section id="delivery-operations"');end=html.index('</section>',start)+len('</section>');candidate=html[:start]+section+html[end:]
 else:
  assert html.count('</main>')==1;candidate=html.replace('</main>',section+'</main>')
 if 'settings-delivery-operations.js?' in candidate:
  candidate,count=re.subn(r'(settings-delivery-operations\.js\?v=)[^"\s]+',r'\g<1>20261016-ops50',candidate);assert count==1
 else:
  assert candidate.count('</body>')==1;candidate=candidate.replace('</body>','<script src="../settings-delivery-operations.js?v=20261016-ops50"></script></body>')
 replacements={'pages/settings.html':candidate.encode(),'settings-delivery-operations.js':(repo/'frontend/settings-delivery-operations.js').read_bytes()};after=root/'frontend.candidate.zip'
 with zipfile.ZipFile(after,'w',zipfile.ZIP_DEFLATED) as b:
  for info in a.infolist():b.writestr(copy.copy(info),replacements.get(info.filename,a.read(info.filename)))
  for name,data in replacements.items():
   if name not in a.namelist():b.writestr(name,data)
 with zipfile.ZipFile(after) as b:
  assert not set(a.namelist())-set(b.namelist());assert {n for n in a.namelist() if a.read(n)!=b.read(n)}|set(b.namelist())-set(a.namelist())==set(replacements)
 assert api.list_jobs(appId=app,branchName=branch,maxResults=1)['jobSummaries'][0]['jobId']==latest['jobId'],'AMPLIFY_CONCURRENT_RELEASE'
 (root/'frontend-plan.json').write_text(json.dumps({'baseJobId':latest['jobId'],'baseSha256':hashlib.sha256(before.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(after.read_bytes()).hexdigest()},indent=2)+'\n')
 data=after.read_bytes();d=api.create_deployment(appId=app,branchName=branch);upload=d['zipUploadUrl'];assert urllib.parse.urlparse(upload).scheme=='https' and urllib.parse.urlparse(upload).hostname.endswith('.amazonaws.com');urllib.request.urlopen(urllib.request.Request(upload,data=data,method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).read();api.start_deployment(appId=app,branchName=branch,jobId=d['jobId']);print(json.dumps({'jobId':d['jobId'],'status':'STARTED'}),flush=True)
 while True:
  state=api.get_job(appId=app,branchName=branch,jobId=d['jobId'])['job']['summary']['status']
  if state in ['SUCCEED','FAILED','CANCELLED']:break
  time.sleep(3)
 assert state=='SUCCEED'
 checks=[]
 for n,data in replacements.items():
  for attempt in range(30):
   actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?release=dispatch-policy50-'+str(attempt),timeout=30).read()
   if actual==data:break
   time.sleep(3)
  assert actual==data,'PUBLIC_BYTES_MISMATCH';checks.append({'path':n,'sha256':hashlib.sha256(actual).hexdigest()})
 report={'baseJobId':latest['jobId'],'jobId':d['jobId'],'status':state,'onlyChanged':checks,'preservedEntries':len(set(a.namelist())-set(replacements)),'activation':False};p=root/'frontend-publication.json';p.write_text(json.dumps(report,indent=2)+'\n');p.chmod(0o600);print(json.dumps(report))
