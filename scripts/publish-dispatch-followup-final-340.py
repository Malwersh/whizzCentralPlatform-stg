"""Publish reviewed followup bundles only; preserve all other deployed entries."""
from pathlib import Path
import copy,base64,datetime,hashlib,io,json,subprocess,time,urllib.request,zipfile
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/dispatch-followup-340');B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m'
def aws(*args):return json.loads(subprocess.check_output(B+list(args)+['--output','json']))
def sha(b):return hashlib.sha256(b).hexdigest()
def overlay(data,replacements):
 src=zipfile.ZipFile(io.BytesIO(data));out=io.BytesIO();names=src.namelist();assert set(replacements)<=set(names)
 with zipfile.ZipFile(out,'w')as z:
  for entry in src.infolist():z.writestr(copy.copy(entry),replacements.get(entry.filename,src.read(entry.filename)))
 candidate=out.getvalue();dst=zipfile.ZipFile(io.BytesIO(candidate));assert dst.namelist()==names
 assert all(dst.read(n)==src.read(n)for n in names if n not in replacements)
 return candidate
receiptPath=R/'docs/dispatch-followup-publication-340.json';receipt=json.loads(receiptPath.read_text());assert receipt['status']=='PUBLISHED_BYTE_VERIFIED'
resume='durableRestartFix'in receipt
if resume:
 assert 'hosting'not in receipt['durableRestartFix'],'Already fully published'
 for item in receipt['durableRestartFix']['functions']:assert aws('lambda','get-function-configuration','--function-name',item['name'])['CodeSha256']==item['codeSha256'],'LAMBDA_DRIFT'
changes=[]
for name,entry,expected in [('staging-wizz-staff-service','dispatch-reviews-340.js',receipt['functions'][0]['publishedCodeSha256']),('staging-cod-integration','dispatch-followup-monitor-340.js',receipt['monitorFinal']['codeSha256'])]:
 if resume:continue
 before=aws('lambda','get-function','--function-name',name);config=before['Configuration'];assert config['CodeSha256']==expected,'LAMBDA_DRIFT'
 data=urllib.request.urlopen(before['Code']['Location'],timeout=90).read();candidate=overlay(data,{entry:(P/entry).read_bytes()});path=P/(name+'-final.zip');path.write_bytes(candidate)
 result=aws('lambda','update-function-code','--function-name',name,'--revision-id',config['RevisionId'],'--zip-file','fileb://'+str(path));subprocess.check_call(B+['lambda','wait','function-updated-v2','--function-name',name])
 after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(candidate).digest()).decode();assert after.get('Environment')==config.get('Environment')
 changes.append({'name':name,'beforeCodeSha256':expected,'codeSha256':after['CodeSha256'],'changedFiles':[entry],'otherEntriesPreserved':True,'configurationPreserved':True,'lastModified':after['LastModified']});print('Verified '+name,flush=True)
if not resume:receipt['durableRestartFix']={'functions':changes,'publishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'keepOpenUntilDurableStarted':True};receiptPath.write_text(json.dumps(receipt,indent=2)+'\n')
latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']==receipt['hosting']['jobId']and latest['status']=='SUCCEED','HOSTING_DRIFT'
base=(P/'hosting-candidate.zip').read_bytes();old=zipfile.ZipFile(io.BytesIO(base));url='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
for f,digest in receipt['hosting']['sourceHashes'].items():
 assert sha(old.read(f))==digest
 assert sha(urllib.request.urlopen(url+f+'?base340final=218',timeout=60).read())==digest,'HOSTED_DRIFT '+f
replacements={f:(R/'frontend'/f).read_bytes()for f in ['dispatch-reviews.js','dispatch-followup-ui.js']};candidate=overlay(base,replacements);(P/'hosting-final.zip').write_bytes(candidate)
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging')
with urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=candidate,method='PUT',headers={'Content-Type':'application/zip'}),timeout=180)as response:assert response.status in (200,201)
job=d['jobId'];aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);print('Started hosting '+job,flush=True)
for _ in range(120):
 state=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in ('FAILED','CANCELLED'),state
 time.sleep(5)
else:raise RuntimeError('Hosting pending')
hashes={f:sha(content)for f,content in replacements.items()}
for f,digest in hashes.items():assert sha(urllib.request.urlopen(url+f+'?verify340final='+job,timeout=60).read())==digest
receipt['durableRestartFix']['hosting']={'jobId':job,'previousJob':latest['jobId'],'sourceHashes':hashes,'otherEntriesPreserved':True};receiptPath.write_text(json.dumps(receipt,indent=2)+'\n');print('PASS final backend and hosting byte verification',flush=True)
