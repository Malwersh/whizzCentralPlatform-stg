from pathlib import Path
import json,subprocess,urllib.request,urllib.error,zipfile,io,copy,hashlib,time
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/home-layout-workflow-361';P.mkdir(parents=True,exist_ok=True);B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*args):
 raw=subprocess.check_output(B+list(args)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return hashlib.sha256(b).hexdigest()
assert Path('/tmp/layout361-workflow-browser.log').read_text().count('PASS section workflow UI')==2
assert aws('sts','get-caller-identity')['Account']=='699561669180'
j=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert j['status']=='SUCCEED'
steps=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',j['jobId'])['job']['steps'];url=[v['artifactsUrl'] for v in steps if v.get('artifactsUrl')][-1]
try:raw=urllib.request.urlopen(url,timeout=45).read()
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 proof=json.loads((P/'current-capture-proof.json').read_text());assert proof['jobId']==j['jobId'];raw=(P/'current-captured.zip').read_bytes();assert sha(raw)==proof['sha256'];z=zipfile.ZipFile(io.BytesIO(raw));assert all(sha(z.read(f))==digest for f,digest in proof['sourceHashes'].items())
z=zipfile.ZipFile(io.BytesIO(raw));(P/'before.zip').write_bytes(raw);files=['home-layout.js','pages/home-layout.html'];changes={f:(R/'frontend'/f).read_bytes() for f in files}
for f in files:assert urllib.request.urlopen(base+f+'?beforeworkflow361='+j['jobId'],timeout=45).read()==z.read(f)
with zipfile.ZipFile(P/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
with zipfile.ZipFile(P/'candidate.zip') as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
r={'part':361,'scope':'staging','status':'PREPARED_SECTION_EDITOR_WORKFLOW','baseJob':j['jobId'],'changedFiles':files,'allOtherEntriesPreserved':True,'backendChanged':False,'layoutRecordsWritten':0,'financialRecordsWritten':0,'tests':['Chrome 390px','Chrome 1280px','independent edit/preview/cancel','isolated save','pause/reorder remain drafts','review before publish','conflict retains unsaved input','read-only controls'],'sourceHashes':{f:sha(v) for f,v in changes.items()},'baseCaptureProof':'backend/.tmp/home-layout-workflow-361/current-capture-proof.json','preservedCurrentUpdates':['campaign-image.js','home-slideshow.js','pages/promotions.html','commercial-management.js','pages/merchants.html']};dest=R/'docs/home-layout-workflow-publication-361.json'
def save():dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
save();latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']==j['jobId']
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');job=d['jobId'];(P/'deployment.private.json').write_text(json.dumps({'jobId':job}));urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=(P/'candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=45).read();aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);r['jobId']=job;r['status']='PUBLISHING';save();print('Started UI-only hosting job',job,flush=True)
for _ in range(120):
 state=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in ['FAILED','CANCELLED'];time.sleep(3)
else:raise RuntimeError('Hosting pending')
for f,digest in r['sourceHashes'].items():assert sha(urllib.request.urlopen(base+f+'?verifyworkflow361='+job,timeout=45).read())==digest
with zipfile.ZipFile(P/'before.zip') as before:
 for f in r['preservedCurrentUpdates']:assert urllib.request.urlopen(base+f+'?preservedworkflow361='+job,timeout=45).read()==before.read(f)
r['status']='PUBLISHED_STAGING_BYTES_VERIFIED';save();print('PASS hosting bytes verified; backend and saved user sections unchanged',flush=True)
