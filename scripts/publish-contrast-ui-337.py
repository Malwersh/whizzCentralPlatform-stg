"""Overlay only reviewed contrast assets on the current staging hosting artifact."""
from pathlib import Path
import copy, datetime, hashlib, io, json, subprocess, time, urllib.request, zipfile
R=Path(__file__).resolve().parents[1]
P=Path('/private/tmp/contrast-ui-337'); P.mkdir(exist_ok=True)
B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
APP='d2vmebm1e1n95m'; BRANCH='staging'
def aws(*args): return json.loads(subprocess.check_output(B+list(args)+['--output','json']))
def latest(): return aws('amplify','list-jobs','--app-id',APP,'--branch-name',BRANCH,'--max-results','1')['jobSummaries'][0]
base=latest(); assert base['status']=='SUCCEED'
job=aws('amplify','get-job','--app-id',APP,'--branch-name',BRANCH,'--job-id',base['jobId'])
urls=[s['artifactsUrl'] for s in job['job']['steps'] if s.get('artifactsUrl')]
try:
 data=urllib.request.urlopen(urls[-1],timeout=60).read()
except Exception:
 # Previous verified publication retained its exact archive locally.
 receipt=json.loads((R/'docs/driver-map-tools-publication-329.json').read_text())
 assert receipt['hosting']['jobId']==base['jobId'] and receipt['hosting']['hostedBytesVerified']
 data=Path('/private/tmp/driver-map-tools-329/hosting-candidate.zip').read_bytes()
z=zipfile.ZipFile(io.BytesIO(data))
files=['assets/js/contrast-controls.js','assets/js/navigation.js','styles/wizz-theme-config.js','styles/platform-theme.css','styles/design-system.css']
changes={f:(R/'frontend'/f).read_bytes() for f in files}
url='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
# Verify overlaid existing files match current hosting before changing them.
for f in files:
 if f in z.namelist(): assert urllib.request.urlopen(url+f+'?before337='+base['jobId'],timeout=60).read()==z.read(f),f
candidate=P/'hosting-candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist(): out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for f,b in changes.items():
  if f not in z.namelist(): out.writestr(f,b)
with zipfile.ZipFile(candidate) as out:
 assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
assert latest()['jobId']==base['jobId']
deploy=aws('amplify','create-deployment','--app-id',APP,'--branch-name',BRANCH)
request=urllib.request.Request(deploy['zipUploadUrl'],data=candidate.read_bytes(),method='PUT',headers={'Content-Type':'application/zip'})
with urllib.request.urlopen(request,timeout=180) as response: assert response.status in (200,201)
id=deploy['jobId']; aws('amplify','start-deployment','--app-id',APP,'--branch-name',BRANCH,'--job-id',id)
print('Started staging contrast hosting job '+id,flush=True)
for _ in range(120):
 summary=aws('amplify','get-job','--app-id',APP,'--branch-name',BRANCH,'--job-id',id)['job']['summary']
 if summary['status']=='SUCCEED': break
 assert summary['status'] not in ('FAILED','CANCELLED'),summary['status']
 time.sleep(5)
else: raise RuntimeError('Hosting deployment still pending')
for f,b in changes.items(): assert urllib.request.urlopen(url+f+'?verify337='+id,timeout=60).read()==b,f
receipt={'part':337,'scope':'staging','status':'PUBLISHED_BYTE_VERIFIED','hostingJob':id,'previousHostingJob':base['jobId'],'changedFiles':files,'otherEntriesPreserved':True,'sourceHashes':{f:hashlib.sha256(b).hexdigest() for f,b in changes.items()},'publishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(R/'docs/contrast-ui-publication-337.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('PASS: contrast assets published and verified; unrelated hosting entries preserved',flush=True)
