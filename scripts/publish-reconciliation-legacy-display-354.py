"""Preserve unknown correction positions in historical statements as unknown, not zero."""
from pathlib import Path
import json,subprocess,urllib.request,zipfile,copy,hashlib,time
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/reconciliation-354/hosting';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return hashlib.sha256(b).hexdigest()
dest=R/'docs/reconciliation-publication-354.json';r=json.loads(dest.read_text());h=r['hosting'];assert r['status']=='PUBLISHED_STAGING_BYTE_VERIFIED_HUMAN_ACCEPTANCE_OPEN';last=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert last['jobId']==h['jobId'] and last['status']=='SUCCEED'
z=zipfile.ZipFile(P/'candidate.zip');files={'company-accounts.js':(R/'frontend/company-accounts.js').read_bytes(),'pages/financial-management.html':z.read('pages/financial-management.html').replace(b'../company-accounts.js?v=354',b'../company-accounts.js?v=354a')}
for f in files:assert sha(z.read(f))==h['sourceHashes'][f] and urllib.request.urlopen(base+f+'?base354a='+last['jobId'],timeout=55).read()==z.read(f)
candidate=P/'legacy-display-candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),files.get(info.filename,z.read(info.filename)))
with zipfile.ZipFile(candidate) as out:assert all(out.read(k)==z.read(k) for k in z.namelist() if k not in files)
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');job=d['jobId']
with urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=candidate.read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=55) as response:assert response.status in [200,201]
latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId'] in [job,last['jobId']]
aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);print('Started final display job',job,flush=True)
for _ in range(120):
 status=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if status=='SUCCEED':break
 assert status not in ['FAILED','CANCELLED'];time.sleep(5)
else:raise RuntimeError('Hosting pending')
for f,raw in files.items():assert urllib.request.urlopen(base+f+'?verify354a='+job,timeout=55).read()==raw;h['sourceHashes'][f]=sha(raw)
h['previousDisplayJob']=h['jobId'];h['jobId']=job;r['legacyMissingPositionsShownAsUnknown']=True;dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');(R/'frontend/pages/financial-management.html').write_bytes(files['pages/financial-management.html']);print('PASS final display byte verified')
