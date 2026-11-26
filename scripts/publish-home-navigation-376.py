"""Publish reviewed staging category controls without altering authored content or unrelated files."""
from pathlib import Path
import json,subprocess,hashlib,base64,zipfile,urllib.request,time
R=Path(__file__).resolve().parents[1];P=Path('/tmp/nav376');B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';BASE='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return hashlib.sha256(b).hexdigest()
assert aws('sts','get-caller-identity')['Account']=='699561669180'
assert 'All tests passed!' in Path('/tmp/nav376-flutter.log').read_text()
assert 'fail 0' in Path('/tmp/nav376-node.log').read_text()
assert Path('/tmp/nav376-browser.log').read_text().count('PASS navigation editor')==2
old=json.loads((P/'live.json').read_text())['Configuration'];live=aws('lambda','get-function-configuration','--function-name','staging-wizz-staff-service');assert live['RevisionId']==old['RevisionId'] and live['CodeSha256']==old['CodeSha256'],'LAMBDA_DRIFT'
with zipfile.ZipFile(P/'before.zip') as z:
 data={n:z.read(n) for n in z.namelist()};key='_discount_review/central-staff/index.js';s=data[key].decode()
 for method in ['feed','route']:
  needle='require(process.env.LAMBDA_TASK_ROOT + "/home-copy-374.js").'+method+'('
  assert s.count(needle)==1,(method,s.count(needle));s=s.replace(needle,'require(process.env.LAMBDA_TASK_ROOT + "/home-navigation-376.js").'+method+'(')
 needle='require(process.env.LAMBDA_TASK_ROOT+"/interfaces-362.js").catalogRoute('
 assert s.count(needle)==1;s=s.replace(needle,'require(process.env.LAMBDA_TASK_ROOT+"/home-navigation-376.js").catalogRoute(')
 data[key]=s.encode();data['home-navigation-376.js']=(P/'home-navigation-376.js').read_bytes()
 with zipfile.ZipFile(P/'candidate.zip','w',zipfile.ZIP_DEFLATED) as target:
  for n,b in data.items():target.writestr(n,b)
 assert all(data[n]==z.read(n) for n in z.namelist() if n!=key)
baseJob=json.loads((P/'hosting.json').read_text())['jobSummaries'][0]['jobId'];latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']==baseJob and latest['status']=='SUCCEED','HOSTING_DRIFT'
files=['pages/home-layout.html','home-layout.js'];hashes={}
with zipfile.ZipFile(P/'hosting-before.zip') as z:
 data={n:z.read(n) for n in z.namelist()}
 for name in files:
  assert urllib.request.urlopen(BASE+name+'?pre376='+baseJob,timeout=40).read()==data[name],'HOSTING_BYTES_DRIFT '+name
  data[name]=(R/'frontend'/name).read_bytes();hashes[name]=sha(data[name])
 with zipfile.ZipFile(P/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED) as target:
  for n,b in data.items():target.writestr(n,b)
 assert all(data[n]==z.read(n) for n in z.namelist() if n not in files)
r={'part':376,'status':'PREPARED','environment':'staging','customerBuild':319,'backendTests':22,'flutterTests':14,'browserWidths':[390,1280],'authoredContentChanged':False,'description':'Home category strip reads explicit activity, cuisine and brand selectors. Existing classification catalog reused; no invented merchant tags. Draft/publish/rollback, regions, audience, dates, images and ordering controlled from home editor.'};dest=R/'docs/home-navigation-376.json'
def save():dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
save()
aws('lambda','update-function-code','--function-name','staging-wizz-staff-service','--revision-id',old['RevisionId'],'--zip-file','fileb://'+str(P/'candidate.zip'))
for _ in range(60):
 live=aws('lambda','get-function-configuration','--function-name','staging-wizz-staff-service')
 if live['LastUpdateStatus']=='Successful':break
 assert live['LastUpdateStatus']!='Failed';time.sleep(1)
else:raise RuntimeError('Lambda pending')
assert live['CodeSha256']==base64.b64encode(hashlib.sha256((P/'candidate.zip').read_bytes()).digest()).decode()
for k in ['Handler','Runtime','Role','Environment','Timeout','MemorySize','Architectures','Layers']:assert live.get(k)==old.get(k),k
r.update(status='BACKEND_PUBLISHED',backendSha256=live['CodeSha256']);save();print('Backend published, permissions and configuration preserved',flush=True)
feed=json.loads(urllib.request.urlopen('https://7oum9md7v6.execute-api.us-east-1.amazonaws.com/staging/staff/public/home-slideshow?layoutVersion=3',timeout=40).read());assert 'navigation' in feed['layout'];assert 'draftNavigation' not in feed['layout'];assert isinstance(feed['layout']['welcome']['searchHints'],list);r['publicFeedVerified']=True;save()
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');job=d['jobId'];urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=(P/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=45).read();aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);r.update(status='HOSTING_PUBLISHING',hostingJob=job);save();print('Hosting started '+job,flush=True)
for _ in range(60):
 status=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if status=='SUCCEED':break
 assert status not in ['FAILED','CANCELLED'];time.sleep(2)
else:raise RuntimeError('Hosting pending')
for name,digest in hashes.items():assert sha(urllib.request.urlopen(BASE+name+'?verify376='+job,timeout=40).read())==digest,name
r.update(status='PUBLISHED_STAGING_VERIFIED',hostingHashes=hashes);save();print('PASS public feed and hosted bytes',flush=True)
