from pathlib import Path
import subprocess,json,hashlib,base64,time,urllib.request,urllib.error,zipfile
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/audit-trail-358';H=P/'hosting';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return hashlib.sha256(b).hexdigest()
assert aws('sts','get-caller-identity')['Account']=='699561669180';assert 'pass 21' in Path('/tmp/audit358-unit.log').read_text();assert Path('/tmp/audit358-browser.log').read_text().count('PASS audit UI')==2;assert json.loads((P/'query-permission-proof.json').read_text())['decision']=='allowed'
m=json.loads((P/'backend-manifest.json').read_text());c=aws('lambda','get-function-configuration','--function-name',m['name']);assert c['RevisionId']==m['revisionId'] and c['CodeSha256']==m['beforeSha256'];assert base64.b64encode(hashlib.sha256((P/'candidate.zip').read_bytes()).digest()).decode()==m['candidateSha256']
h=json.loads((H/'manifest.json').read_text());latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']==h['baseJob'] and latest['status']=='SUCCEED';assert sha((H/'candidate.zip').read_bytes())==h['candidateSha256']
r={'part':358,'scope':'staging','status':'PUBLISHING','financialRecordsWritten':0,'existingAuditRecordsChanged':False,'newIamPermissions':False};dest=R/'docs/audit-trail-publication-358.json'
def save():dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
save();aws('lambda','update-function-code','--function-name',m['name'],'--revision-id',m['revisionId'],'--zip-file','fileb://'+str(P/'candidate.zip'))
for _ in range(90):
 v=aws('lambda','get-function-configuration','--function-name',m['name'])
 if v['LastUpdateStatus']=='Successful':break
 assert v['LastUpdateStatus']!='Failed';time.sleep(1)
else:raise RuntimeError('Backend update pending')
assert v['CodeSha256']==m['candidateSha256'];assert all(v.get(k)==c.get(k) for k in ['Handler','Runtime','Role','Environment','MemorySize','Timeout','Layers','Architectures','VpcConfig']);r['backend']={'name':m['name'],'sha256':v['CodeSha256'],'configurationPreserved':True,'changedFiles':m['changedFiles'],'allOtherEntriesPreserved':True};r['status']='BACKEND_PUBLISHED';save();print('Published audit backend; configuration and unrelated entries preserved',flush=True)
with zipfile.ZipFile(H/'before.zip') as z:
 for f in ['staff.js','assets/js/rbac.js','assets/js/login.js','pages/staff.html']:assert urllib.request.urlopen(base+f+'?base358='+h['baseJob'],timeout=55).read()==z.read(f),'HOSTING_DRIFT '+f
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');job=d['jobId'];(H/'deployment.private.json').write_text(json.dumps({'jobId':job}));urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=(H/'candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=55).read();latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId'] in [job,h['baseJob']];aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);print('Started audit hosting',job,flush=True)
for _ in range(120):
 state=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in ['FAILED','CANCELLED'];time.sleep(3)
else:raise RuntimeError('Hosting pending')
for f,digest in h['sourceHashes'].items():assert sha(urllib.request.urlopen(base+f+'?verify358='+job,timeout=55).read())==digest,'HOSTED_BYTES '+f
for f in ['staff.js','assets/js/rbac.js','assets/js/login.js','pages/staff.html']:(R/'frontend'/f).write_bytes((H/'check'/f).read_bytes())
r['hosting']={'jobId':job,'previousJob':h['baseJob'],'sourceHashes':h['sourceHashes'],'allOtherEntriesPreserved':True};r['status']='PUBLISHED_STAGING_BYTE_VERIFIED_HUMAN_ACCEPTANCE_PENDING';save();print('PASS audit hosting bytes verified; no historical records or financial values changed',flush=True)
