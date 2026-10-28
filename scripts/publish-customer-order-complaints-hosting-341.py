"""Publish only reviewed C05 frontend files after approved backend publication."""
from pathlib import Path
import hashlib,json,os,subprocess,time,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/customer-complaints-341');B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m'
def aws(*args):return json.loads(subprocess.check_output(B+list(args)+['--output','json']))
def sha(b):return hashlib.sha256(b).hexdigest()
if os.environ.get('C05_STAGING_PUBLISH_APPROVED')!='YES':raise SystemExit('Explicit user approval required before staging publication')
r=json.loads((R/'docs/customer-order-complaints-publication-341.json').read_text());assert r['status']=='BACKEND_PUBLISHED_VERIFIED'
h=json.loads((P/'hosting-review.json').read_text());candidate=P/'hosting-candidate.zip';assert sha(candidate.read_bytes())==h['candidateSHA256']
for f,digest in h['sourceHashes'].items():assert sha((R/'frontend'/f).read_bytes())==digest,'SOURCE_DRIFT '+f
latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']==h['baseJob']and latest['status']=='SUCCEED','HOSTING_DRIFT'
base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
for f,digest in h['baseChangedFileHashes'].items():assert sha(urllib.request.urlopen(base+f+'?before341=219',timeout=60).read())==digest,'HOSTED_BASE_DRIFT '+f
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging')
with urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=candidate.read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=180)as response:assert response.status in (200,201)
job=d['jobId'];aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);print('Started reviewed hosting job '+job,flush=True)
for _ in range(120):
 state=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in ('FAILED','CANCELLED'),state
 time.sleep(5)
else:raise RuntimeError('Hosting still pending')
for f,digest in h['candidateEntryHashes'].items():assert sha(urllib.request.urlopen(base+f+'?verify341='+job,timeout=60).read())==digest,'HOSTED_BYTE_MISMATCH '+f
r.update(status='PUBLISHED_STAGING_BYTE_VERIFIED',hosting={'jobId':job,'previousJob':h['baseJob'],'sourceHashes':h['candidateEntryHashes'],'unrelatedEntriesPreserved':True});(R/'docs/customer-order-complaints-publication-341.json').write_text(json.dumps(r,indent=2)+'\n');print('PASS backend and frontend publication verified',flush=True)
