from pathlib import Path
import datetime,hashlib,json,subprocess,time,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/dispatch-followup-340');B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m'
def aws(*args):return json.loads(subprocess.check_output(B+list(args)+['--output','json']))
backend=json.loads((R/'docs/dispatch-followup-publication-340.json').read_text());assert backend['status']=='BACKEND_PUBLISHED_VERIFIED'
h=json.loads((P/'hosting-review.json').read_text());assert h['otherEntriesPreserved']
for f,digest in h['sourceHashes'].items():assert hashlib.sha256((R/'frontend'/f).read_bytes()).hexdigest()==digest,'SOURCE_DRIFT '+f
latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['status']=='SUCCEED'and latest['jobId']==h['baseJob'],'HOSTING_DRIFT'
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');req=urllib.request.Request(d['zipUploadUrl'],data=(P/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'})
with urllib.request.urlopen(req,timeout=180)as response:assert response.status in (200,201)
job=d['jobId'];aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);print('Started reviewed hosting job '+job,flush=True)
for _ in range(120):
 state=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in ('FAILED','CANCELLED'),state
 time.sleep(5)
else:raise RuntimeError('Hosting still pending')
base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
for f,digest in h['sourceHashes'].items():assert hashlib.sha256(urllib.request.urlopen(base+f+'?verify340='+job,timeout=60).read()).hexdigest()==digest,'HOSTED_BYTE_MISMATCH '+f
backend.update(status='PUBLISHED_BYTE_VERIFIED',hosting={'jobId':job,'previousJob':h['baseJob'],'changedFiles':h['changedFiles'],'sourceHashes':h['sourceHashes'],'otherEntriesPreserved':True,'settingsPublishedShellPreserved':True},publishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());(R/'docs/dispatch-followup-publication-340.json').write_text(json.dumps(backend,indent=2)+'\n');print('PASS all followup UI assets published and byte verified',flush=True)
