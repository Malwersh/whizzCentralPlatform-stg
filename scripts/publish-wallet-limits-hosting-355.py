"""Publish the reviewed five-file A10 hosting overlay on staging."""
from pathlib import Path
import hashlib,json,subprocess,time,urllib.request,zipfile
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/wallet-limits-355/hosting';APP='d2vmebm1e1n95m';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*args):
 raw=subprocess.check_output(B+list(args)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(data):return hashlib.sha256(data).hexdigest()
r=json.loads((R/'docs/wallet-operating-limits-publication-355.json').read_text());assert r['status']=='BACKEND_PUBLISHED_VERIFIED_HUMAN_ACCEPTANCE_OPEN'
h=json.loads((P/'manifest.json').read_text());candidate=P/'candidate.zip';assert sha(candidate.read_bytes())==h['candidateSha256']
for f,digest in h['sourceHashes'].items():
 assert sha((P/'check'/f).read_bytes())==digest
 if not f.startswith('pages/'):assert sha((R/'frontend'/f).read_bytes())==digest
latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']==h['baseJob'] and latest['status']=='SUCCEED','HOSTING_DRIFT'
base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
with zipfile.ZipFile(P/'before.zip') as z:
 for f in h['changedFiles']:
  if f in z.namelist():assert urllib.request.urlopen(base+f+'?before354='+h['baseJob'],timeout=55).read()==z.read(f),'LIVE_DRIFT '+f
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');job=d['jobId']
(P/'deployment.private.json').write_text(json.dumps({'jobId':job,'baseJob':h['baseJob']}))
with urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=candidate.read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=55) as response:assert response.status in (200,201)
latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId'] in (job,h['baseJob']),'CONCURRENT_DEPLOYMENT'
aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);print('Started hosting '+job,flush=True)
for _ in range(120):
 state=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in ('FAILED','CANCELLED'),state
 time.sleep(5)
else:raise RuntimeError('Hosting pending')
for f,digest in h['sourceHashes'].items():assert sha(urllib.request.urlopen(base+f+'?verify354='+job,timeout=55).read())==digest,'HOSTED_BYTE_MISMATCH '+f
r.update(status='PUBLISHED_STAGING_BYTE_VERIFIED_HUMAN_ACCEPTANCE_OPEN',hosting={'jobId':job,'previousJob':h['baseJob'],'sourceHashes':h['sourceHashes'],'unrelatedEntriesPreserved':True});(R/'docs/wallet-operating-limits-publication-355.json').write_text(json.dumps(r,indent=2)+'\n')

for f in ['pages/finance.html']:(R/'frontend'/f).write_bytes((P/'check'/f).read_bytes())
print('PASS hosted bytes verified',flush=True)
